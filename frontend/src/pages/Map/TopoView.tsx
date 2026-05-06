import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoMercator, geoPath, type GeoProjection } from "d3-geo";
import regionConfig from "@region/region.config.json";
import riversData from "@region/map/rivers.json";
import roadsData from "@region/map/roads.json";
import { stationApi, dataApi } from "@/services/api";

/**
 * 拓扑视图（Canvas 位图 + CSS Transform · 高性能零重绘）
 * ---------------------------------------------------------
 * 三层架构：
 *   1. <canvas> — 静态路网位图，CSS transform 控制平移缩放（GPU 合成层）
 *   2. <div overlay> — 站点标注层，同步 CSS transform
 *   3. 工具条/图例/统计 — 固定定位，不跟随变换
 *
 * 性能关键：
 *   - 路网只渲染一次为 Canvas 位图，交互时仅操作 CSS transform
 *   - 原生事件监听，绕过 React 合成事件系统
 *   - 站点 overlay 的 hover 只改局部 state，不影响 Canvas 层
 */

const CANVAS_SCALE = 2; // 2x 分辨率（Retina 清晰）

const ROAD_LAYERS = [
  { key: "tertiary",  color: "#5d7286", width: 0.38 },
  { key: "secondary", color: "#9fb4c7", width: 0.55 },
  { key: "primary",   color: "#ffd84a", width: 0.9  },
  { key: "trunk",     color: "#ffa24a", width: 1.2  },
  { key: "motorway",  color: "#ff7a4a", width: 1.6  },
] as const;

const RIVER_LAYERS = [
  { key: "stream", color: "#7dc4ff", width: 0.55 },
  { key: "river",  color: "#3fa9ff", width: 1.3  },
] as const;

const STATION_COLOR: Record<string, string> = {
  water_source:     "#3fa9ff",
  industrial_park:  "#ff7a4a",
  boundary_section: "#ffd84a",
  rural_water:      "#7ed957",
};
const DEFAULT_STATION_COLOR = "#ffcc00";

type AnyGeoJSON = {
  features: Array<{
    geometry: { type: string; coordinates: unknown };
    properties?: Record<string, unknown>;
  }>;
};

interface StationItem {
  id: string;
  station_code: string;
  station_name: string;
  station_type: string;
  region?: string;
  longitude?: number;
  latitude?: number;
  status: string;
}

interface ProjectedStation extends StationItem {
  x: number;
  y: number;
}

export default function TopoView() {
  const center = regionConfig.center as [number, number];
  const osmBounds = regionConfig.osmBounds as {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef({ tx: 0, ty: 0, k: 1 });
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const [stations, setStations] = useState<StationItem[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const [stationData, setStationData] = useState<Record<string, any>>({});
  const fetchingRef = useRef<Set<string>>(new Set());

  // 计算投影参数（只算一次）
  const geo = useMemo(() => {
    const proj: GeoProjection = geoMercator()
      .center(center)
      .scale(60000)
      .translate([0, 0]);
    const pathGen = geoPath(proj as never);

    const corners: [number, number][] = [
      [osmBounds.minLon, osmBounds.minLat],
      [osmBounds.maxLon, osmBounds.minLat],
      [osmBounds.maxLon, osmBounds.maxLat],
      [osmBounds.minLon, osmBounds.maxLat],
    ];
    const pts = corners.map((c) => proj(c)!).filter(Boolean) as [number, number][];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = Math.max(maxX - minX, maxY - minY) * 0.02;
    const w = maxX - minX + pad * 2;
    const h = maxY - minY + pad * 2;
    const originX = minX - pad;
    const originY = minY - pad;

    return { proj, pathGen, w, h, originX, originY };
  }, [center, osmBounds]);

  // 站点投影
  const stationPoints: ProjectedStation[] = useMemo(() => {
    if (!geo) return [];
    return stations
      .filter(
        (s) =>
          s.longitude! >= osmBounds.minLon &&
          s.longitude! <= osmBounds.maxLon &&
          s.latitude! >= osmBounds.minLat &&
          s.latitude! <= osmBounds.maxLat
      )
      .map((s) => {
        const [px, py] = geo.proj([s.longitude!, s.latitude!])!;
        // 转换到 canvas 坐标系
        const x = px - geo.originX;
        const y = py - geo.originY;
        return { ...s, x, y };
      });
  }, [geo, stations, osmBounds]);

  // 拉站点数据
  useEffect(() => {
    stationApi
      .getStations({ limit: 1000 })
      .then((res: unknown) => {
        const anyRes = res as { items?: StationItem[]; data?: { items?: StationItem[] } };
        const items = anyRes?.items ?? anyRes?.data?.items ?? [];
        setStations(items.filter((s) => s.longitude != null && s.latitude != null));
      })
      .catch(() => setStations([]));
  }, []);

  // 悬浮时拉取站点最新数据（用 station_code 匹配 TDengine 子表）
  useEffect(() => {
    if (!hovered) return;
    const station = stationPoints.find(s => s.id === hovered);
    if (!station) return;
    const code = station.station_code;
    // 已缓存或正在拉取则跳过
    if (stationData[code] || fetchingRef.current.has(code)) return;
    fetchingRef.current.add(code);
    dataApi.getLatestData(code)
      .then((res: any) => {
        const d = res?.data ?? res;
        setStationData(prev => ({ ...prev, [code]: d }));
      })
      .catch(() => {
        setStationData(prev => ({ ...prev, [code]: { _error: true } }));
      })
      .finally(() => { fetchingRef.current.delete(code); });
  }, [hovered, stationPoints, stationData]);

  // Canvas 一次性绘制路网
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !geo) return;

    const { w, h, originX, originY, pathGen } = geo;
    const cw = Math.ceil(w * CANVAS_SCALE);
    const ch = Math.ceil(h * CANVAS_SCALE);
    canvas.width = cw;
    canvas.height = ch;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(CANVAS_SCALE, CANVAS_SCALE);
    ctx.translate(-originX, -originY);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // 绘制道路
    ctx.globalAlpha = 0.85;
    for (const layer of ROAD_LAYERS) {
      ctx.strokeStyle = layer.color;
      ctx.lineWidth = layer.width;
      for (const f of (roadsData as AnyGeoJSON).features) {
        const hw = f.properties?.highway as string;
        if (hw !== layer.key) continue;
        const path2d = pathToPath2D(pathGen(f as never));
        if (path2d) ctx.stroke(path2d);
      }
    }

    // 绘制河流
    ctx.globalAlpha = 0.95;
    for (const layer of RIVER_LAYERS) {
      ctx.strokeStyle = layer.color;
      ctx.lineWidth = layer.width;
      for (const f of (riversData as AnyGeoJSON).features) {
        const kind = (f.properties?.waterway as string) === "river" ? "river" : "stream";
        if (kind !== layer.key) continue;
        const path2d = pathToPath2D(pathGen(f as never));
        if (path2d) ctx.stroke(path2d);
      }
    }

    ctx.globalAlpha = 1;
    setCanvasReady(true);
  }, [geo]);

  // 应用 CSS transform（直接操作 DOM，不经过 React）
  const applyTransform = useCallback(() => {
    const { tx, ty, k } = transformRef.current;
    const t = `translate(${tx}px, ${ty}px) scale(${k})`;
    if (canvasRef.current) canvasRef.current.style.transform = t;
    if (overlayRef.current) overlayRef.current.style.transform = t;
  }, []);

  // 原生事件监听（绕过 React 合成事件系统）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      // 鼠标在容器内的坐标
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const { tx, ty, k } = transformRef.current;
      const factor = e.deltaY < 0 ? 1.25 : 0.8;
      const newK = Math.max(0.3, Math.min(60, k * factor));

      // 以鼠标位置为锚点缩放
      const newTx = mx - (mx - tx) * (newK / k);
      const newTy = my - (my - ty) * (newK / k);

      transformRef.current = { tx: newTx, ty: newTy, k: newK };
      applyTransform();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragRef.current = {
        x: e.clientX,
        y: e.clientY,
        tx: transformRef.current.tx,
        ty: transformRef.current.ty,
      };
      container.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      transformRef.current.tx = dragRef.current.tx + dx;
      transformRef.current.ty = dragRef.current.ty + dy;
      applyTransform();
    };

    const onPointerUp = () => {
      dragRef.current = null;
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointerleave", onPointerUp);

    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointerleave", onPointerUp);
    };
  }, [applyTransform]);

  // 工具方法
  const zoomBy = useCallback((factor: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const { tx, ty, k } = transformRef.current;
    const newK = Math.max(0.3, Math.min(60, k * factor));
    transformRef.current = {
      tx: cx - (cx - tx) * (newK / k),
      ty: cy - (cy - ty) * (newK / k),
      k: newK,
    };
    applyTransform();
  }, [applyTransform]);

  const resetView = useCallback(() => {
    transformRef.current = { tx: 0, ty: 0, k: 1 };
    applyTransform();
  }, [applyTransform]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        background: "radial-gradient(ellipse at center, #0f1a2a 0%, #050a14 80%)",
        position: "relative",
        overflow: "hidden",
        userSelect: "none",
        cursor: dragRef.current ? "grabbing" : "grab",
      }}
    >
      {/* Canvas 位图层 */}
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          transformOrigin: "0 0",
          willChange: "transform",
        }}
      />

      {/* 站点 overlay 层 */}
      <div
        ref={overlayRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: geo ? `${geo.w}px` : 0,
          height: geo ? `${geo.h}px` : 0,
          transformOrigin: "0 0",
          willChange: "transform",
          pointerEvents: "none",
        }}
      >
        {canvasReady && stationPoints.map((s) => {
          const color = STATION_COLOR[s.station_type] || DEFAULT_STATION_COLOR;
          const isHover = hovered === s.id;
          const size = isHover ? 10 : 7;
          return (
            <div
              key={s.id}
              style={{
                position: "absolute",
                left: s.x - size / 2,
                top: s.y - size / 2,
                width: size,
                height: size,
                borderRadius: "50%",
                background: color,
                border: "1px solid rgba(255,255,255,0.7)",
                pointerEvents: "auto",
                cursor: "pointer",
                transition: "width 0.1s, height 0.1s",
              }}
              onMouseEnter={() => setHovered(s.id)}
              onMouseLeave={() => setHovered(null)}
            />
          );
        })}
      </div>

      {/* 站点悬浮数据卡片（固定定位，不跟随变换） */}
      {hovered && (() => {
        const station = stationPoints.find(s => s.id === hovered);
        if (!station) return null;
        const latest = stationData[station.station_code];
        return (
          <StationCard station={station} data={latest} />
        );
      })()}

      {/* 加载提示 */}
      {!canvasReady && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#6b8aa8",
            fontSize: 14,
            letterSpacing: 2,
          }}
        >
          拓扑渲染中 …
        </div>
      )}

      {/* 工具条 */}
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          zIndex: 20,
        }}
      >
        <ToolBtn onClick={() => zoomBy(1.4)} title="放大">＋</ToolBtn>
        <ToolBtn onClick={() => zoomBy(1 / 1.4)} title="缩小">－</ToolBtn>
        <ToolBtn onClick={resetView} title="复位">⟳</ToolBtn>
      </div>

      {/* 站点统计（左上角） */}
      {canvasReady && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            color: "#cfd9e6",
            fontFamily: "system-ui, -apple-system, 'Microsoft YaHei'",
            fontSize: 11,
            background: "rgba(12,22,38,0.85)",
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.08)",
            zIndex: 20,
          }}
        >
          站点 <span style={{ color: "#ffcc00" }}>{stationPoints.length}</span>
          {hovered && (
            <>
              {"  ·  "}
              <span style={{ color: "#fff" }}>{stationPoints.find(s => s.id === hovered)?.station_name}</span>
            </>
          )}
        </div>
      )}

      {/* 右下图例 */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          right: 16,
          color: "#cfd9e6",
          fontFamily: "system-ui, -apple-system, 'Microsoft YaHei'",
          fontSize: 11,
          background: "rgba(12,22,38,0.85)",
          padding: "10px 14px",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.08)",
          lineHeight: 1.8,
          zIndex: 20,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4, color: "#fff" }}>图例</div>
        <LegendDot color="#ff7a4a" label="motorway" />
        <LegendDot color="#ffa24a" label="trunk" />
        <LegendDot color="#ffd84a" label="primary" />
        <LegendDot color="#9fb4c7" label="secondary" />
        <LegendDot color="#5d7286" label="tertiary" />
        <div style={{ height: 6 }} />
        <LegendDot color="#3fa9ff" label="river" />
        <LegendDot color="#7dc4ff" label="stream" />
        <div style={{ height: 6 }} />
        <LegendDot color="#3fa9ff" label="water_source" dot />
        <LegendDot color="#ff7a4a" label="industrial_park" dot />
        <LegendDot color="#ffd84a" label="boundary_section" dot />
        <LegendDot color="#7ed957" label="rural_water" dot />
      </div>
    </div>
  );
}

/** 站点悬浮数据卡片 */
const METRIC_LABELS: Record<string, { label: string; unit: string; decimals: number }> = {
  ph: { label: 'pH', unit: '', decimals: 2 },
  do: { label: 'DO', unit: 'mg/L', decimals: 2 },
  nh3_n: { label: '氨氮', unit: 'mg/L', decimals: 3 },
  codmn: { label: '高锰盐', unit: 'mg/L', decimals: 2 },
  turbidity: { label: '浊度', unit: 'NTU', decimals: 1 },
  water_temperature: { label: '水温', unit: '℃', decimals: 1 },
  conductivity: { label: '电导率', unit: 'μS/cm', decimals: 0 },
  total_p: { label: '总磷', unit: 'mg/L', decimals: 3 },
  total_n: { label: '总氮', unit: 'mg/L', decimals: 2 },
};

const STATION_TYPE_LABEL: Record<string, string> = {
  water_source: '水源地',
  industrial_park: '工业园区',
  boundary_section: '跨界断面',
  rural_water: '农村水体',
};

function StationCard({ station, data }: { station: ProjectedStation; data: any }) {
  const color = STATION_COLOR[station.station_type] || DEFAULT_STATION_COLOR;
  const typeLabel = STATION_TYPE_LABEL[station.station_type] || station.station_type;

  // 解析时间戳
  const ts = data?.ts ?? data?.data?.ts;
  const tsStr = ts
    ? new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  // 解析指标数据（兼容多种响应格式）
  const metrics = data?.data ?? data;
  const isLoading = !data;
  const isError = data?._error;

  return (
    <div
      style={{
        position: "absolute",
        top: 60,
        left: 16,
        width: 280,
        background: "rgba(10, 18, 32, 0.94)",
        border: `1px solid ${color}44`,
        borderRadius: 10,
        padding: "12px 14px",
        zIndex: 30,
        pointerEvents: "none",
        fontFamily: "system-ui, -apple-system, 'Microsoft YaHei'",
      }}
    >
      {/* 头部 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
        <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{station.station_name}</span>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, fontSize: 11 }}>
        <span style={{ color: color, background: `${color}18`, padding: "1px 6px", borderRadius: 4 }}>{typeLabel}</span>
        <span style={{ color: "#94a3b8" }}>{station.station_code}</span>
        {station.region && <span style={{ color: "#64748b" }}>{station.region}</span>}
      </div>

      {/* 数据区 */}
      {isLoading && (
        <div style={{ color: "#64748b", fontSize: 11, textAlign: "center", padding: "8px 0" }}>加载中…</div>
      )}
      {isError && (
        <div style={{ color: "#64748b", fontSize: 11, textAlign: "center", padding: "8px 0" }}>暂无数据（未接入或数据源不可用）</div>
      )}
      {!isLoading && !isError && metrics && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px 8px" }}>
            {Object.entries(METRIC_LABELS).map(([key, cfg]) => {
              const v = metrics[key];
              const val = v != null && isFinite(Number(v)) ? Number(v) : null;
              return (
                <div key={key} style={{ padding: "3px 0" }}>
                  <div style={{ color: "#64748b", fontSize: 10 }}>{cfg.label}</div>
                  <div style={{ color: val != null ? "#e2e8f0" : "#475569", fontSize: 12, fontWeight: 500 }}>
                    {val != null ? val.toFixed(cfg.decimals) : '-'}
                    {val != null && cfg.unit && <span style={{ color: "#64748b", fontSize: 9, marginLeft: 2 }}>{cfg.unit}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          {/* 时间戳 */}
          {tsStr && (
            <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "#475569", fontSize: 10 }}>最后更新</span>
              <span style={{ color: "#94a3b8", fontSize: 10 }}>{tsStr}</span>
            </div>
          )}
        </>
      )}
      {!isLoading && !isError && !metrics && (
        <div style={{ color: "#64748b", fontSize: 11, textAlign: "center", padding: "8px 0" }}>暂无监测数据</div>
      )}
    </div>
  );
}

/** 将 d3 path string 转为 Path2D 对象供 Canvas 使用 */
function pathToPath2D(d: string | null): Path2D | null {
  if (!d) return null;
  return new Path2D(d);
}

function ToolBtn(props: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={props.onClick}
      title={props.title}
      style={{
        width: 32,
        height: 32,
        border: "1px solid rgba(255,255,255,0.1)",
        background: "rgba(12,22,38,0.85)",
        color: "#cfd9e6",
        fontSize: 16,
        lineHeight: 1,
        cursor: "pointer",
        borderRadius: 6,
      }}
    >
      {props.children}
    </button>
  );
}

function LegendDot({
  color,
  label,
  dot = false,
}: {
  color: string;
  label: string;
  dot?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          display: "inline-block",
          width: dot ? 8 : 18,
          height: dot ? 8 : 2,
          background: color,
          borderRadius: dot ? "50%" : 1,
        }}
      />
      <span>{label}</span>
    </div>
  );
}

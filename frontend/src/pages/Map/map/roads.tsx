import { useMemo } from "react";
import {
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  NormalBlending,
  TubeGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { GeoProjection } from "d3-geo";

import roadData from "@region/map/roads.json";
import regionConfig from "@region/region.config.json";

/* ═══════════════════════════════════════
   OSM 边界 — 超出此范围的路段直接剔除
   ═══════════════════════════════════════ */
const BOUNDS = regionConfig.osmBounds;

function hasPointInBounds(coords: number[][]): boolean {
  for (const [lon, lat] of coords) {
    if (
      lon >= BOUNDS.minLon &&
      lon <= BOUNDS.maxLon &&
      lat >= BOUNDS.minLat &&
      lat <= BOUNDS.maxLat
    ) {
      return true;
    }
  }
  return false;
}

function clipToBounds(coords: number[][]): number[][] {
  return coords.filter(
    ([lon, lat]) =>
      lon >= BOUNDS.minLon - 0.05 &&
      lon <= BOUNDS.maxLon + 0.05 &&
      lat >= BOUNDS.minLat - 0.05 &&
      lat <= BOUNDS.maxLat + 0.05
  );
}

/** 计算经纬度坐标序列的地理长度（km） */
function geoLengthKm(coords: number[][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lon1, lat1] = coords[i - 1];
    const [lon2, lat2] = coords[i];
    const dLat = (lat2 - lat1) * 111.32;
    const dLon = (lon2 - lon1) * 111.32 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
    total += Math.sqrt(dLat * dLat + dLon * dLon);
  }
  return total;
}

// ★ 道路最短长度阈值（km），低于此值的路段将被移除
const MIN_ROAD_LENGTH_KM = 0;

/** Douglas-Peucker 抽稀 */
function simplifyCoords(coords: number[][], tolerance: number): number[][] {
  if (coords.length <= 2) return coords;

  let maxDist = 0;
  let maxIdx = 0;

  const [sx, sy] = coords[0];
  const [ex, ey] = coords[coords.length - 1];
  const lenSq = (ey - sy) ** 2 + (ex - sx) ** 2;
  if (lenSq === 0) return [coords[0], coords[coords.length - 1]];
  const len = Math.sqrt(lenSq);

  for (let i = 1; i < coords.length - 1; i++) {
    const [px, py] = coords[i];
    const dist =
      Math.abs((ey - sy) * px - (ex - sx) * py + ex * sy - ey * sx) / len;
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > tolerance) {
    const left = simplifyCoords(coords.slice(0, maxIdx + 1), tolerance);
    const right = simplifyCoords(coords.slice(maxIdx), tolerance);
    return [...left.slice(0, -1), ...right];
  }

  return [coords[0], coords[coords.length - 1]];
}

/* ═══════════════════════════════════════
   路网等级配置
   ═══════════════════════════════════════ */
interface RoadConfig {
  width: number;
  color: string;
  minPoints: number;
  tolerance: number;
}

const ROAD_CONFIG: Record<string, RoadConfig> = {
  motorway: { width: 0.005, color: "#e0e0e0", minPoints: 3, tolerance: 0.003 },
  trunk:    { width: 0.004, color: "#c8c8c8", minPoints: 3, tolerance: 0.004 },
  primary:  { width: 0.003, color: "#b0b0b0", minPoints: 3, tolerance: 0.005 },
};

/* ═══════════════════════════════════════
   主组件 — 按等级合并渲染
   ═══════════════════════════════════════ */
export interface RoadsProps {
  projection: GeoProjection;
  depth: number;
}

export default function Roads({ projection, depth }: RoadsProps) {
  const roadLayers = useMemo(() => {
    const features = (roadData as any).features as any[];

    // 按路网等级分组收集 TubeGeometry
    const geosByType: Record<string, TubeGeometry[]> = {};
    let rendered = 0;
    let skipped = 0;

    for (const feature of features) {
      const roadType: string = feature.properties.roadType;
      const config = ROAD_CONFIG[roadType];
      if (!config) { skipped++; continue; }

      const rawCoords: number[][] = feature.geometry.coordinates;

      // 最小点数过滤
      if (rawCoords.length < config.minPoints) { skipped++; continue; }

      // 长度过滤：移除过短的路段
      if (geoLengthKm(rawCoords) < MIN_ROAD_LENGTH_KM) { skipped++; continue; }

      // 边界裁剪
      if (!hasPointInBounds(rawCoords)) { skipped++; continue; }

      const clipped = clipToBounds(rawCoords);
      if (clipped.length < 2) continue;

      // 抽稀
      const simplified = simplifyCoords(clipped, config.tolerance);
      if (simplified.length < 2) continue;

      // 投影
      const points = simplified.map((coord) => {
        const [x, y] = projection(coord as [number, number])!;
        return new Vector3(x, -y, depth + 0.003);
      });

      const curve = new CatmullRomCurve3(points, false, "catmullrom", 0.3);
      const tubeSeg = Math.min(16, Math.max(4, simplified.length));

      if (!geosByType[roadType]) geosByType[roadType] = [];
      geosByType[roadType].push(
        new TubeGeometry(curve, tubeSeg, config.width, 3, false)
      );
      rendered++;
    }

    console.log(`[Roads] rendered=${rendered}, skipped=${skipped}`);

    // 合并每种等级的几何体
    const layers: { geometry: BufferGeometry; color: Color; roadType: string }[] = [];

    for (const [roadType, geos] of Object.entries(geosByType)) {
      if (geos.length === 0) continue;
      const merged = mergeGeometries(geos, false);
      if (merged) {
        layers.push({
          geometry: merged,
          color: new Color(ROAD_CONFIG[roadType].color),
          roadType,
        });
      }
    }

    return layers;
  }, [projection, depth]);

  return (
    <group>
      {roadLayers.map((layer) => (
        <mesh
          key={layer.roadType}
          geometry={layer.geometry}
          renderOrder={5}
          frustumCulled={false}>
          <meshBasicMaterial
            transparent
            color={layer.color}
            opacity={0.6}
            side={DoubleSide}
            blending={NormalBlending}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

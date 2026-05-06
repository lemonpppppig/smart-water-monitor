import { useMemo, useState, useEffect, useRef } from "react";
import { Vector3, Color, type Group } from "three";
import { useFrame } from "@react-three/fiber";
import type { GeoProjection } from "d3-geo";
import Cones from "./cone";
import Label from "./label";
import { stationApi } from "@/services/api";
import { useConfigStore } from "../stores";

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

// 赣州流域河流上的监测站点默认数据（坐标基于行政区中心就近匹配匹配可渲染河流点）
const FALLBACK_STATIONS: StationItem[] = [
  { id: '1', station_code: 'WS001', station_name: '赣江水源地站', station_type: 'water_source', region: '章贡区', longitude: 114.9501322, latitude: 25.8638905, status: 'active' },
  { id: '2', station_code: 'WS002', station_name: '章江水源地站', station_type: 'water_source', region: '章贡区', longitude: 114.9318298, latitude: 25.8440238, status: 'active' },
  { id: '3', station_code: 'WS003', station_name: '贡水水源地站', station_type: 'water_source', region: '赣县区', longitude: 115.0203385, latitude: 25.8550753, status: 'active' },
  { id: '4', station_code: 'IP001', station_name: '赣州经开区工业监测站', station_type: 'industrial_park', region: '赣县区', longitude: 114.984947, latitude: 25.8471573, status: 'active' },
  { id: '5', station_code: 'IP002', station_name: '南康工业区监测站', station_type: 'industrial_park', region: '南康区', longitude: 114.7588168, latitude: 25.6607702, status: 'active' },
  { id: '6', station_code: 'IP003', station_name: '桃江工业园监测站', station_type: 'industrial_park', region: '信丰县', longitude: 114.9317872, latitude: 25.390462, status: 'active' },
  { id: '7', station_code: 'BS001', station_name: '赣江出境断面站', station_type: 'boundary_section', region: '章贡区', longitude: 114.9341583, latitude: 26.302264, status: 'active' },
  { id: '8', station_code: 'BS002', station_name: '贡水于都-赣县断面站', station_type: 'boundary_section', region: '赣县区', longitude: 115.2505116, latitude: 25.9093852, status: 'active' },
  { id: '9', station_code: 'BS003', station_name: '上犹江入章江断面站', station_type: 'boundary_section', region: '南康区', longitude: 114.5496583, latitude: 25.7797642, status: 'active' },
  { id: '10', station_code: 'BS004', station_name: '梅江汇入贡水断面站', station_type: 'boundary_section', region: '赣县区', longitude: 115.7222939, latitude: 26.1954068, status: 'active' },
  { id: '11', station_code: 'RW001', station_name: '崇义江农村水体站', station_type: 'rural_water', region: '崇义县', longitude: 114.3056953, latitude: 25.7011119, status: 'active' },
  { id: '12', station_code: 'RW002', station_name: '章江农村水体站', station_type: 'rural_water', region: '大余县', longitude: 114.3579876, latitude: 25.3960472, status: 'active' },
  { id: '13', station_code: 'RW003', station_name: '平江农村水体站', station_type: 'rural_water', region: '兴国县', longitude: 115.3540306, latitude: 26.2968891, status: 'active' },
  { id: '14', station_code: 'RW004', station_name: '琴江农村水体站', station_type: 'rural_water', region: '石城县', longitude: 116.3456763, latitude: 26.3359702, status: 'active' },
  { id: '15', station_code: 'RW005', station_name: '贡水乡村监测站', station_type: 'rural_water', region: '于都县', longitude: 115.4197515, latitude: 25.9564292, status: 'maintenance' },
];

export interface StationsProps {
  projection: GeoProjection;
  depth: number;
}

export default function Stations({ projection, depth }: StationsProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [stations, setStations] = useState<StationItem[]>(FALLBACK_STATIONS);
  const groupRef = useRef<Group>(null!);
  const worldPosStoredRef = useRef(false);

  useEffect(() => {
    stationApi
      .getStations({ limit: 1000 })
      .then((res: any) => {
        const items = res?.items ?? res?.data?.items ?? [];
        const valid = items.filter((s: StationItem) => s.longitude && s.latitude);
        if (valid.length > 0) setStations(valid);
      })
      .catch(() => {
        // API不可用时保持FALLBACK数据
      });
  }, []);

  const data = useMemo(() => {
    worldPosStoredRef.current = false; // 数据变化时重新计算世界坐标
    return stations.map((s) => {
      const [x, y] = projection([s.longitude!, s.latitude!])!;
      return {
        ...s,
        name: s.station_name,
        status: s.status === "active" ? "正常" : "异常",
        center: new Vector3(x, -y, 0),
        points: [],
      };
    });
  }, [projection, stations]);

  // 每帧检查：一旦 group 的世界矩阵就绪，计算并存储站点世界坐标
  useFrame(() => {
    if (worldPosStoredRef.current || data.length === 0 || !groupRef.current) return;
    // 确保矩阵已更新
    groupRef.current.updateWorldMatrix(true, false);
    const positions: Record<string, [number, number, number]> = {};
    data.forEach((s) => {
      const wp = s.center.clone();
      groupRef.current.localToWorld(wp);
      positions[s.name] = [wp.x, wp.y, wp.z];
    });
    useConfigStore.getState().setStationWorldPositions(positions);
    worldPosStoredRef.current = true;
  });

  return (
    <group ref={groupRef}>
      <Cones
        data={data}
        color={new Color(0xffcc00)}
        onPointerOver={(index) => {
          setHoveredIndex(index);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHoveredIndex(null);
          document.body.style.cursor = "auto";
        }}
      />
      {data.map((s, i) => (
        <Label
          key={i}
          center
          position={[s.center.x, s.center.y, depth + 0.3]}
          distanceFactor={3}
          zIndexRange={[100, 1000]}>
          <div
            style={{
              background: "rgba(0, 0, 0, 0.6)",
              padding: "1px 4px",
              borderRadius: "3px",
              border: `1px solid ${hoveredIndex === i ? "#ffffff" : "#ffcc00"}`,
              color: hoveredIndex === i ? "#ffffff" : "#ffcc00",
              fontSize: "10px",
              whiteSpace: "nowrap",
              transition: "all 0.3s ease",
              transform: hoveredIndex === i ? "scale(1.15)" : "scale(1)",
            }}>
            {s.name}
          </div>
        </Label>
      ))}

      {hoveredIndex !== null && (
        <Label
          center
          position={[
            data[hoveredIndex].center.x,
            data[hoveredIndex].center.y,
            depth + 0.5,
          ]}
          distanceFactor={3}
          zIndexRange={[1000, 2000]}>
          <div
            style={{
              background: "rgba(16, 24, 44, 0.9)",
              padding: "8px",
              borderRadius: "6px",
              border: "1px solid #8fc2ff",
              color: "#ffffff",
              width: "120px",
              boxShadow: "0 0 12px rgba(143, 194, 255, 0.3)",
              pointerEvents: "none",
            }}>
            <div
              style={{
                fontSize: "11px",
                fontWeight: "bold",
                marginBottom: "4px",
                borderBottom: "1px solid rgba(143, 194, 255, 0.3)",
                paddingBottom: "3px",
                color: "#8fc2ff",
              }}>
              {data[hoveredIndex].name}
            </div>
            <div style={{ fontSize: "10px", marginBottom: "4px" }}>
              状态:{" "}
              <span
                style={{
                  color:
                    data[hoveredIndex].status === "正常" ? "#00ffcc" : "#ff4444",
                }}>
                {data[hoveredIndex].status}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <div style={{ fontSize: "10px", color: "#ffffff" }}>
                类型:{" "}
                <span style={{ fontSize: "10px", color: "#00ffcc" }}>
                  {data[hoveredIndex].station_type}
                </span>
              </div>
              {data[hoveredIndex].region && (
                <div style={{ fontSize: "10px", color: "#ffffff" }}>
                  区域:{" "}
                  <span style={{ fontSize: "10px", color: "#00ffcc" }}>
                    {data[hoveredIndex].region}
                  </span>
                </div>
              )}
            </div>
          </div>
        </Label>
      )}
    </group>
  );
}

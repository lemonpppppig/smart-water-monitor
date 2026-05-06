import { useMemo, useRef } from "react";
import { useFrame, extend } from "@react-three/fiber";
import { shaderMaterial } from "@react-three/drei";
import {
  AdditiveBlending,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  NormalBlending,
  ShaderMaterial,
  TubeGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { GeoProjection } from "d3-geo";

import riverData from "@region/map/rivers.json";
import regionConfig from "@region/region.config.json";

/* ═══════════════════════════════════════
   着色器：核心层 - 流动波纹
   ═══════════════════════════════════════ */
const RiverCoreMaterial = extend(
  shaderMaterial(
    { uTime: 0, uColor: new Color("#80d8ff"), uOpacity: 1.0 },
    `varying vec2 vUv;
     void main() {
       vUv = uv;
       gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
     }`,
    `uniform float uTime;
     uniform vec3 uColor;
     uniform float uOpacity;
     varying vec2 vUv;
     void main() {
       float flow = fract(vUv.x * 4.0 - uTime * 0.8);
       float wave = smoothstep(0.0, 0.4, flow) * smoothstep(1.0, 0.6, flow);
       float edgeFade = smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.8, vUv.y);
       float brightness = (0.55 + wave * 0.45) * edgeFade;
       gl_FragColor = vec4(uColor * brightness, brightness * uOpacity);
     }`
  )
);

/* ═══════════════════════════════════════
   着色器：发光层 - 静态光晕
   ═══════════════════════════════════════ */
const RiverGlowMaterial = extend(
  shaderMaterial(
    { uColor: new Color("#40c4ff"), uOpacity: 0.4 },
    `varying vec2 vUv;
     void main() {
       vUv = uv;
       gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
     }`,
    `uniform vec3 uColor;
     uniform float uOpacity;
     varying vec2 vUv;
     void main() {
       float centerDist = abs(vUv.y - 0.5) * 2.0;
       float glow = exp(-centerDist * centerDist * 3.0);
       float edgeFade = smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
       float alpha = glow * edgeFade * uOpacity;
       gl_FragColor = vec4(uColor * (glow * 1.5), alpha);
     }`
  )
);

/* ═══════════════════════════════════════
   工具函数
   ═══════════════════════════════════════ */

// OSM 边界 — 超出此范围的河流直接剔除（来源：region.config.json）
const BOUNDS = regionConfig.osmBounds;

/** 检查坐标是否有任意一点落在边界内 */
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

/** 将经纬度坐标裁剪到边界框内（保留边界交叉点的连续性） */
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

// ★ 河流最短长度阈值（km），低于此值的河流将被移除
const MIN_RIVER_LENGTH_KM = 5;

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
   主组件 — 几何体合并渲染
   ═══════════════════════════════════════
   优化要点：
   1. 所有河流 TubeGeometry 合并为 2 个 mesh（core + glow）
      → draw call 从 3806 降到 2
   2. 边界裁剪 — 地形外的河流直接剔除
   3. 更激进的抽稀 — 减少顶点数
   4. 减少管段/截面数 — tubeSegments 按需、radialSegments=3
   5. 单个 useFrame 替代 1903 个
   ═══════════════════════════════════════ */

export interface RiversProps {
  projection: GeoProjection;
  depth: number;
}

export default function Rivers({ projection, depth }: RiversProps) {
  const coreMatRef = useRef<ShaderMaterial>(null!);

  // 单个 useFrame 驱动所有河流动画
  useFrame((_, delta) => {
    if (coreMatRef.current) {
      coreMatRef.current.uniforms.uTime.value += delta;
    }
  });

  const { coreGeometry, glowGeometry } = useMemo(() => {
    const features = (riverData as any).features as any[];
    const coreGeos: TubeGeometry[] = [];
    const glowGeos: TubeGeometry[] = [];

    let skippedBounds = 0;
    let skippedTiny = 0;
    let rendered = 0;

    for (const feature of features) {
      const isRiver = feature.properties.waterway === "river";
      if (!isRiver) { skippedTiny++; continue; }
      const rawCoords: number[][] = feature.geometry.coordinates;

      // ① 最小点数过滤
      if (rawCoords.length < 3) {
        skippedTiny++;
        continue;
      }

      // ①-b 长度过滤：移除过短的河流
      if (geoLengthKm(rawCoords) < MIN_RIVER_LENGTH_KM) {
        skippedTiny++;
        continue;
      }

      // ② 边界裁剪：无任何点在边界内则跳过
      if (!hasPointInBounds(rawCoords)) {
        skippedBounds++;
        continue;
      }

      // ③ 裁剪到边界框（带少量缓冲）
      const clipped = clipToBounds(rawCoords);
      if (clipped.length < 2) continue;

      // ④ 抽稀：更激进的容差
      const tolerance = isRiver ? 0.004 : 0.01;
      const simplified = simplifyCoords(clipped, tolerance);
      if (simplified.length < 2) continue;

      // ⑤ 投影到 3D 坐标
      const points = simplified.map((coord) => {
        const [x, y] = projection(coord as [number, number])!;
        return new Vector3(x, -y, depth + 0.005);
      });

      const curve = new CatmullRomCurve3(points, false, "catmullrom", 0.3);
      const ptCount = simplified.length;

      // ⑥ 管段数按需分配（不再统一 64 段）
      const tubeSeg = Math.min(24, Math.max(6, ptCount * 2));

      // ⑦ 宽度计算
      const coreWidth = isRiver
        ? Math.min(0.018, 0.005 + ptCount * 0.00003)
        : Math.min(0.007, 0.003 + ptCount * 0.00001);
      const glowWidth = coreWidth * 2.5;

      // ⑧ 生成 TubeGeometry（radialSegments=3 → 三角形截面，更省顶点）
      coreGeos.push(new TubeGeometry(curve, tubeSeg, coreWidth, 3, false));
      glowGeos.push(new TubeGeometry(curve, tubeSeg, glowWidth, 3, false));
      rendered++;
    }

    console.log(
      `[Rivers] rendered=${rendered}, skippedBounds=${skippedBounds}, skippedTiny=${skippedTiny}`
    );

    return {
      coreGeometry:
        coreGeos.length > 0 ? mergeGeometries(coreGeos, false) : null,
      glowGeometry:
        glowGeos.length > 0 ? mergeGeometries(glowGeos, false) : null,
    };
  }, [projection, depth]);

  // 合并完成后释放中间几何体已由 GC 处理（mergeGeometries 不 clone）

  if (!coreGeometry || !glowGeometry) return null;

  return (
    <group>
      {/* 发光层 */}
      <mesh renderOrder={7} geometry={glowGeometry} frustumCulled={false}>
        <RiverGlowMaterial
          transparent
          depthWrite={false}
          side={DoubleSide}
          blending={AdditiveBlending}
          uColor={new Color("#40c4ff")}
          uOpacity={0.15}
        />
      </mesh>
      {/* 核心层 */}
      <mesh renderOrder={8} geometry={coreGeometry} frustumCulled={false}>
        <RiverCoreMaterial
          ref={coreMatRef}
          transparent
          depthWrite={false}
          side={DoubleSide}
          blending={NormalBlending}
          uColor={new Color("#80d8ff")}
          uOpacity={0.8}
        />
      </mesh>
    </group>
  );
}

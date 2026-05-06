import { useLayoutEffect, useMemo, useRef } from "react";
import { Center, useTexture } from "@react-three/drei";
import {
  Box2,
  ClampToEdgeWrapping,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Shape,
  Vector2,
  type Group,
} from "three";
import { geoMercator } from "d3-geo";
import { useFrame, useThree } from "@react-three/fiber";
import { gsap } from "gsap";
import ShiftMaterial from "./shaderMaterial";
import ShapeBox from "./shape";
import Rivers from "./river";
import Roads from "./roads";
import Stations from "./stations";
import { useConfigStore } from "../stores";

// 区域化资产：Vite alias @region 指向 regions/<VITE_REGION>。
// 交付时按城市切换 .env 中的 VITE_REGION 即可投射到不同的地图/贴图。
import regionConfig from "@region/region.config.json";
import gnNormalMap from "@region/map/normal_map.png";


const OSM_BOUNDS = regionConfig.osmBounds;
const NORMAL_MAP_BOUNDS = regionConfig.normalMapBounds;

const CENTER: [number, number] = (regionConfig.center as [number, number]) ?? [
  (OSM_BOUNDS.minLon + OSM_BOUNDS.maxLon) / 2,
  (OSM_BOUNDS.minLat + OSM_BOUNDS.maxLat) / 2,
];

export interface BaseProps {
  depth?: number;
}

export default function Base(props: BaseProps) {
  const { depth = 1 } = props;
  const groupRef = useRef<Group>(null!);
  const camera = useThree((state) => state.camera);

  const projection = useMemo(() => {
    return geoMercator().center(CENTER).translate([0, 0]);
  }, []);

  /* ── 从 OSM 边界框创建地形形状 ── */
  const { shapes, bbox, uvBbox } = useMemo(() => {
    const bbox = new Box2();

    const toV2 = (coord: [number, number]) => {
      const [x, y] = projection(coord)!;
      const v = new Vector2(x, -y);
      bbox.expandByPoint(v);
      return v;
    };

    // 计算法线贴图实际地理范围的投影坐标（用于 UV 对齐）
    const nmCorners: [number, number][] = [
      [NORMAL_MAP_BOUNDS.minLon, NORMAL_MAP_BOUNDS.minLat],
      [NORMAL_MAP_BOUNDS.maxLon, NORMAL_MAP_BOUNDS.maxLat],
    ];
    const uvBbox = new Box2();
    for (const c of nmCorners) {
      const [x, y] = projection(c)!;
      uvBbox.expandByPoint(new Vector2(x, -y));
    }

    // 用 OSM 边界框的四个角 + 大幅外扩创建无边界地形
    const pad = 0.5; // 外扩 50% — 超低视角下需要更大的地形范围
    const latRange = OSM_BOUNDS.maxLat - OSM_BOUNDS.minLat;
    const lonRange = OSM_BOUNDS.maxLon - OSM_BOUNDS.minLon;
    const corners: [number, number][] = [
      [OSM_BOUNDS.minLon - lonRange * pad, OSM_BOUNDS.minLat - latRange * pad],
      [OSM_BOUNDS.maxLon + lonRange * pad, OSM_BOUNDS.minLat - latRange * pad],
      [OSM_BOUNDS.maxLon + lonRange * pad, OSM_BOUNDS.maxLat + latRange * pad],
      [OSM_BOUNDS.minLon - lonRange * pad, OSM_BOUNDS.maxLat + latRange * pad],
    ];

    const points = corners.map(toV2);
    const shape = new Shape(points);

    return { shapes: [shape], bbox, uvBbox };
  }, [projection]);

  /* ── 入场动画 ── */
  useLayoutEffect(() => {
    if (!groupRef.current) return;
    const tl = gsap.timeline();

    tl.to(camera.position, {
      x: -0.6,
      y: 3.5,
      z: -0.65,
      duration: 2.5,
      ease: "circ.out",
      onComplete: () => {
        useConfigStore.setState({ mapPlayComplete: true });
      },
    });
    tl.to(groupRef.current.position, { x: 0, y: 0, z: 0, duration: 1 }, 2.5);

    tl.to(
      groupRef.current.scale,
      {
        x: 1,
        y: 1,
        z: 1,
        duration: 1,
        ease: "circ.out",
      },
      2.5
    );
    groupRef.current.traverse((obj) => {
      if (obj instanceof Mesh) {
        tl.to(obj.material, { opacity: 1, duration: 1, ease: "circ.out" }, 2.5);
      }
    });

    return () => {
      tl.kill();
    };
  }, [camera]);

  return (
    <Center top>
      <group
        castShadow
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[0.9, 0.9, 0.9]}
        position={[0, 0.1, 0]}>
        <group ref={groupRef} scale={[1, 1, 0]} position={[0, 0, -0.01]}>
          {/* 地形 */}
          <Terrain shapes={shapes} bbox={bbox} uvBbox={uvBbox} depth={depth} />
          {/* 河流 */}
          <Rivers projection={projection} depth={depth} />
          {/* 路网 */}
          <Roads projection={projection} depth={depth} />
          <Stations projection={projection} depth={depth} />
        </group>
      </group>
    </Center>
  );
}

/* ── 地形组件 ── */
function Terrain(props: { shapes: Shape[]; bbox: Box2; uvBbox: Box2; depth: number }) {
  const { shapes, bbox, uvBbox, depth } = props;
  const materialRef = useRef<ShaderMaterial>(null!);
  const texture = useTexture(gnNormalMap);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;

  useFrame((_, delta) => {
    if (materialRef.current) {
      materialRef.current.uniforms.time.value += delta / 3;
    }
  });

  return (
    <ShapeBox bbox={bbox} uvBbox={uvBbox} args={[shapes, { depth, bevelEnabled: false }]}>
      <meshStandardMaterial
        transparent
        attach="material-0"
        color="#1a2a30"
        normalMap={texture}
        normalScale={[0.3, 0.3]}
        metalness={0.6}
        roughness={0.5}
        side={DoubleSide}
        opacity={0}
      />
      <ShiftMaterial
        transparent
        attach="material-1"
        ref={materialRef}
        opacity={0}
        depth={depth}
      />
    </ShapeBox>
  );
}

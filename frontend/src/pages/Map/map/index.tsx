import { Suspense, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { gsap } from "gsap";
import Lights from "./lights";
import Mirror from "./mirror";
import Base from "./base";
import Bottom from "./bottom";
import BeamLight from "./beamLight";
import { useConfigStore } from "../stores";

const CanvasWrapper = styled.div`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
`;

/** 监听 focusedStation 变化，动画移动相机到站点的实际世界坐标 */
function CameraController({ controlsRef }: { controlsRef: React.RefObject<any> }) {
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    const unsub = useConfigStore.subscribe(
      (s) => s.focusedStation,
      (station) => {
        if (!station || !controlsRef.current) return;
        // 从 store 中获取站点的实际世界坐标
        const positions = useConfigStore.getState().stationWorldPositions;
        const wp = station.name ? positions[station.name] : null;
        if (!wp) return;

        const target: [number, number, number] = [wp[0], 0, wp[2]]; // XZ平面，Y=0
        const controls = controlsRef.current;

        // 动画目标点
        gsap.to(controls.target, {
          x: target[0],
          y: target[1],
          z: target[2],
          duration: 1.2,
          ease: 'power2.inOut',
          onUpdate: () => controls.update(),
        });

        // 相机跟随移动，保持当前视角高度
        const offsetX = camera.position.x - controls.target.x;
        const offsetY = camera.position.y - controls.target.y;
        const offsetZ = camera.position.z - controls.target.z;
        gsap.to(camera.position, {
          x: target[0] + offsetX,
          y: target[1] + offsetY,
          z: target[2] + offsetZ,
          duration: 1.2,
          ease: 'power2.inOut',
        });
      }
    );
    return unsub;
  }, [camera, controlsRef]);

  return null;
}

export default function Map() {
  const [key, setKey] = useState(0);
  const mapPlayComplete = useConfigStore((s: any) => s.mapPlayComplete);
  const controlsRef = useRef<any>(null);
  
  useEffect(() => {
    const timer = setTimeout(() => setKey(k => k + 1), 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <CanvasWrapper>
      <Canvas
        key={key}
        camera={{
          fov: 35,
          position: [-0.6, 5, -0.65],
          near: 0.1,
          far: 50,
        }}
        dpr={[1, 1.5]}>
        <fog attach="fog" args={["#000000", 3, 10]} />
        <color attach="background" args={["#000000"]} />
        <Lights />
        <Suspense fallback={null}>
          <Base />
        </Suspense>
        <Bottom />
        <Mirror />
        <BeamLight />
        <CameraController controlsRef={controlsRef} />
        <OrbitControls
          ref={controlsRef}
          enabled={mapPlayComplete}
          target={[-0.6, 0, -0.65]}
          enableDamping
          dampingFactor={0.08}
          zoomSpeed={0.3}
          minDistance={1.5}
          maxDistance={8}
          maxPolarAngle={1.2}
          minPolarAngle={0}
          enablePan
          panSpeed={0.5}
        />
      </Canvas>
      
      <style>{`
        canvas {
          display: block;
        }
      `}</style>
    </CanvasWrapper>
  );
}

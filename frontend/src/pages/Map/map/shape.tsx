import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";
import { Box2, Float32BufferAttribute, Mesh } from "three";
import type { ThreeElements } from "@react-three/fiber";

export type ShapeProps = Omit<React.JSX.IntrinsicElements["mesh"], "args"> & {
  ref?: Ref<Mesh>;
  args?: ThreeElements["extrudeGeometry"]["args"];
  bbox: Box2;
  uvBbox?: Box2;
};

export default function ShapeBox(props: ShapeProps) {
  const { ref, args, bbox, uvBbox, children, ...meshProps } = props;
  const meshRef = useRef<Mesh>(null!);

  useImperativeHandle(ref, () => meshRef.current);
  useLayoutEffect(() => {
    const { geometry } = meshRef.current;

    const pos = geometry.attributes.position;
    const uvBox = uvBbox || bbox;
    const width = uvBox.max.x - uvBox.min.x;
    const height = uvBox.max.y - uvBox.min.y;

    const uv: number[] = [];
    let x = 0,
      y = 0,
      u = 0,
      v = 0;
    for (let i = 0; i < pos.count; i++) {
      x = pos.getX(i);
      y = pos.getY(i);
      u = (x - uvBox.min.x) / width;
      v = (y - uvBox.min.y) / height;
      uv.push(u, v);
    }

    geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  });

  return (
    <mesh ref={meshRef} {...meshProps}>
      <extrudeGeometry attach="geometry" args={args} />
      {children}
    </mesh>
  );
}

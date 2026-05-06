import { useEffect, useMemo } from "react";
import styled from "styled-components";
import { useConfigStore } from "./stores";
import Map from "./map";
import Panel from "./panel";
import TopoView from "./TopoView";

const Wrapper = styled.div`
  position: relative;
  width: 100vw;
  height: 100vh;
`;

export default function Index() {
  // URL ?topo=1 则切换到零贴图拓扑视图（供合肥/南昌等新城市预览）
  const useTopo = useMemo(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("topo") === "1";
  }, []);

  useEffect(() => {
    if (useTopo) return;
    return useConfigStore.getState().reset();
  }, [useTopo]);

  if (useTopo) return <TopoView />;

  return (
    <Wrapper>
      <Map />
      <Panel />
    </Wrapper>
  );
}

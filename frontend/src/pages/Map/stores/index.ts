import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

export interface FocusedStation {
  longitude: number;
  latitude: number;
  name?: string;
}

/** 站点在3D场景中的世界坐标映射 */
export type StationWorldPositions = Record<string, [number, number, number]>;

interface ConfigStore {
  mapPlayComplete: boolean;
  focusedStation: FocusedStation | null;
  stationWorldPositions: StationWorldPositions;
  setFocusedStation: (station: FocusedStation | null) => void;
  setStationWorldPositions: (positions: StationWorldPositions) => void;
  toggle: (key: keyof Omit<ConfigStore, "toggle" | "setFocusedStation" | "setStationWorldPositions">) => void;
  reset: () => void;
}

export const useConfigStore = create<ConfigStore>()(
  subscribeWithSelector((set, _, store) => ({
    mapPlayComplete: false,
    focusedStation: null,
    stationWorldPositions: {},
    setFocusedStation: (station) => set({ focusedStation: station }),
    setStationWorldPositions: (positions) => set({ stationWorldPositions: positions }),
    toggle: (key) => set((s) => ({ [key]: !s[key] })),
    reset: () => set(store.getInitialState()),
  }))
);

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { Station, Alert, AgentStatus, SystemStatus, User } from '../types';

// 用户状态
interface UserState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  logout: () => void;
}

export const useUserStore = create<UserState>()(
  devtools(
    persist(
      (set) => ({
        user: null,
        token: null,
        isAuthenticated: false,
        setUser: (user) => set({ user, isAuthenticated: !!user }),
        setToken: (token) => set({ token }),
        logout: () => set({ user: null, token: null, isAuthenticated: false }),
      }),
      { name: 'user-storage' }
    )
  )
);

// 站点状态
interface StationState {
  stations: Station[];
  selectedStation: Station | null;
  loading: boolean;
  setStations: (stations: Station[]) => void;
  setSelectedStation: (station: Station | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useStationStore = create<StationState>()(
  devtools((set) => ({
    stations: [],
    selectedStation: null,
    loading: false,
    setStations: (stations) => set({ stations }),
    setSelectedStation: (station) => set({ selectedStation: station }),
    setLoading: (loading) => set({ loading }),
  }))
);

// 预警状态
interface AlertState {
  alerts: Alert[];
  unreadCount: number;
  loading: boolean;
  setAlerts: (alerts: Alert[]) => void;
  addAlert: (alert: Alert) => void;
  setUnreadCount: (count: number) => void;
  setLoading: (loading: boolean) => void;
}

export const useAlertStore = create<AlertState>()(
  devtools((set) => ({
    alerts: [],
    unreadCount: 0,
    loading: false,
    setAlerts: (alerts) => set({ alerts }),
    addAlert: (alert) => set((state) => ({ alerts: [alert, ...state.alerts] })),
    setUnreadCount: (count) => set({ unreadCount: count }),
    setLoading: (loading) => set({ loading }),
  }))
);

// 智能体状态
interface AgentState {
  systemStatus: SystemStatus | null;
  agents: AgentStatus[];
  tasks: any[];
  loading: boolean;
  setSystemStatus: (status: SystemStatus | null) => void;
  setAgents: (agents: AgentStatus[]) => void;
  setTasks: (tasks: any[]) => void;
  setLoading: (loading: boolean) => void;
}

export const useAgentStore = create<AgentState>()(
  devtools((set) => ({
    systemStatus: null,
    agents: [],
    tasks: [],
    loading: false,
    setSystemStatus: (status) => set({ systemStatus: status }),
    setAgents: (agents) => set({ agents }),
    setTasks: (tasks) => set({ tasks }),
    setLoading: (loading) => set({ loading }),
  }))
);

// 全局UI状态
interface UIState {
  sidebarCollapsed: boolean;
  theme: 'light' | 'dark';
  /** 演示模式：开启后，所有暴露具体地址信息的字段在前端展示层做脱敏 */
  demoMode: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setDemoMode: (v: boolean) => void;
  toggleDemoMode: () => void;
}

export const useUIStore = create<UIState>()(
  devtools(
    persist(
      (set) => ({
        sidebarCollapsed: false,
        theme: 'light',
        demoMode: true, // 默认开启演示模式
        setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
        setTheme: (theme) => set({ theme }),
        toggleTheme: () => set((state) => ({ theme: state.theme === 'light' ? 'dark' : 'light' })),
        setDemoMode: (v) => set({ demoMode: v }),
        toggleDemoMode: () => set((state) => ({ demoMode: !state.demoMode })),
      }),
      { name: 'ui-storage' }
    )
  )
);

import { ConfigProvider } from 'antd';
import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router";
import { Route, BrowserRouter as Router, Routes, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import AlertDetail from './pages/AlertDetail';
import AlertRules from './pages/AlertRules';
import Alerts from './pages/Alerts';
import CaseDetail from './pages/CaseDetail';
import Dashboard from './pages/Dashboard';
import Graph from './pages/Graph';
import GraphAdmin from './pages/GraphAdmin';
import Home from './pages/Home';
import Knowledge from './pages/Knowledge';
import KnowledgeDocDetail from './pages/KnowledgeDocDetail';
import Models from './pages/Models';
import PollutionSources from './pages/PollutionSources';
import Prediction from './pages/Prediction';
import Reports from './pages/Reports';
import RiverTopology from './pages/RiverTopology';
import Settings from './pages/Settings';
import StationDetail from './pages/StationDetail';
import Stations from './pages/Stations';
import MqttConnections from './pages/MqttConnections';
import MqttData from './pages/MqttData';
import Agents from './pages/Agents';
import Disposal from './pages/Disposal';
import DisposalDetail from './pages/Disposal/Detail';
import AlertAnalysis from './pages/AlertAnalysis';

// Ant Design theme configuration
const themeConfig = {
  token: {
    colorPrimary: '#0891b2',
    colorSuccess: '#10b981',
    colorWarning: '#f59e0b',
    colorError: '#ef4444',
    colorInfo: '#3b82f6',
    borderRadius: 8,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  components: {
    Button: { borderRadius: 8, controlHeight: 40 },
    Input: { borderRadius: 8, controlHeight: 40 },
    Select: { borderRadius: 8, controlHeight: 40 },
    Card: { borderRadius: 12 },
    Modal: { borderRadius: 16 },
    Table: { borderRadius: 12 },
  },
};

function AppContent() {
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        containerRef.current,
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: 0.6, ease: "power3.out" }
      );
    }, containerRef);
    return () => ctx.revert();
  }, [location.key]);

  return (
    <div ref={containerRef}>
      <Routes>
        <Route path="/" element={<Layout />}>
          {/* 1. 运行态势 */}
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />

          {/* 2. 站点中心 */}
          <Route path="stations" element={<Stations />} />
          <Route path="stations/:id" element={<StationDetail />} />

          {/* 3. AI 智能分析 */}
          <Route path="ai/prediction" element={<Prediction />} />
          <Route path="ai/agents" element={<Agents />} />
          <Route path="ai/models" element={<Models />} />
          <Route path="ai/graph" element={<Graph />} />
          <Route path="ai/graph/pollution-sources" element={<PollutionSources />} />
          <Route path="ai/graph/rivers" element={<RiverTopology />} />
          <Route path="ai/graph/admin" element={<GraphAdmin />} />

          {/* 4. 预警与处置 */}
          <Route path="alerts" element={<Alerts />} />
          <Route path="alerts/analysis" element={<AlertAnalysis />} />
          <Route path="alerts/analysis/:alertId" element={<AlertAnalysis />} />
          <Route path="alerts/rules" element={<AlertRules />} />
          <Route path="alerts/:id" element={<AlertDetail />} />
          <Route path="disposal" element={<Disposal />} />
          <Route path="disposal/:id" element={<DisposalDetail />} />

          {/* 5. 知识与报告 */}
          <Route path="knowledge" element={<Knowledge />} />
          <Route path="knowledge/cases/:id" element={<CaseDetail />} />
          <Route path="knowledge/docs/:id" element={<KnowledgeDocDetail />} />
          <Route path="reports" element={<Reports />} />

          {/* 6. 系统管理 */}
          <Route path="system/mqtt" element={<MqttConnections />} />
          <Route path="system/mqtt/data" element={<MqttData />} />
          <Route path="system/users" element={<Settings initialTab="users" />} />
          <Route path="system/roles" element={<Settings initialTab="roles" />} />
          <Route path="system/params" element={<Settings initialTab="system" />} />
          <Route path="system/logs" element={<Settings initialTab="logs" />} />
          <Route path="system/backup" element={<Navigate to="/system/logs" replace />} />

          {/* 旧路径重定向（保持向后兼容） */}
          <Route path="agents" element={<Navigate to="/ai/agents" replace />} />
          <Route path="prediction" element={<Navigate to="/ai/prediction" replace />} />
          <Route path="models" element={<Navigate to="/ai/models" replace />} />
          <Route path="graph" element={<Navigate to="/ai/graph" replace />} />
          <Route path="graph/pollution-sources" element={<Navigate to="/ai/graph/pollution-sources" replace />} />
          <Route path="graph/river-topology" element={<Navigate to="/ai/graph/rivers" replace />} />
          <Route path="alert-rules" element={<Navigate to="/alerts/rules" replace />} />
          <Route path="mqtt/connections" element={<Navigate to="/system/mqtt" replace />} />
          <Route path="mqtt/data" element={<Navigate to="/system/mqtt/data" replace />} />
          <Route path="settings" element={<Navigate to="/system/users" replace />} />
        </Route>
      </Routes>
    </div>
  );
}

function App() {
  return (
    <ConfigProvider theme={themeConfig}>
      <Router>
        <AppContent />
      </Router>
    </ConfigProvider>
  );
}

export default App;

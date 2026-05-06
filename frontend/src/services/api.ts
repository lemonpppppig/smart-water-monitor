import axios from 'axios';
import { useUIStore } from '../store';
import { maskDeep } from '../utils/mask';

// API基础配置
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// 路径白名单：命中的请求在响应拦截器中跳过脱敏（返回原文）
// 用于图谱编辑页：编辑时需要看到真实数据，显示由页面自己调用 maskName 控制
const MASK_SKIP_PATH_PATTERNS: RegExp[] = [
  /\/api\/v1\/ai\/graph-admin\//,
];

function shouldSkipMask(url?: string, config?: any): boolean {
  if (config?._skipMask) return true;
  if (!url) return false;
  return MASK_SKIP_PATH_PATTERNS.some((re) => re.test(url));
}

// 创建axios实例
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器
api.interceptors.response.use(
  (response) => {
    const data = response.data;
    // 跳过二进制响应（报告下载等）
    if (response.config.responseType === 'blob' || response.config.responseType === 'arraybuffer') {
      return data;
    }
    // 跳过指定路径或显式标记 _skipMask 的请求
    if (shouldSkipMask(response.config.url, response.config)) {
      return data;
    }
    // 演示模式开启时，对返回数据做深度脱敏
    try {
      const { demoMode } = useUIStore.getState();
      return demoMode ? maskDeep(data) : data;
    } catch {
      return data;
    }
  },
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// 站点服务API
export const stationApi = {
  getStations: (params?: any) => api.get('/api/v1/stations', { params }),
  getStation: (id: string) => api.get(`/api/v1/stations/${id}`),
  createStation: (data: any) => api.post('/api/v1/stations', data),
  updateStation: (id: string, data: any) => api.put(`/api/v1/stations/${id}`, data),
  deleteStation: (id: string) => api.delete(`/api/v1/stations/${id}`),
  batchDeleteStations: (ids: string[]) => api.post('/api/v1/stations/batch-delete', { ids }),
  getNearbyStations: (lat: number, lng: number, radius: number) => 
    api.get('/api/v1/stations/nearby', { params: { lat, lng, radius } }),

  // 站点指标配置（per-station）
  listStationMetrics: (stationId: string) => api.get(`/api/v1/stations/${stationId}/metrics`),
  createStationMetric: (stationId: string, data: any) => api.post(`/api/v1/stations/${stationId}/metrics`, data),
  updateStationMetric: (stationId: string, metricId: string, data: any) =>
    api.put(`/api/v1/stations/${stationId}/metrics/${metricId}`, data),
  deleteStationMetric: (stationId: string, metricId: string) =>
    api.delete(`/api/v1/stations/${stationId}/metrics/${metricId}`),
  getStationDetail: (stationId: string) => api.get(`/api/v1/stations/${stationId}/detail`),
};

// 指标目录 API（全局字典）
export const metricCatalogApi = {
  list: (params?: { keyword?: string; category?: string; is_active?: boolean }) =>
    api.get('/api/v1/metric-catalog', { params }),
  get: (id: string) => api.get(`/api/v1/metric-catalog/${id}`),
  create: (data: any) => api.post('/api/v1/metric-catalog', data),
  update: (id: string, data: any) => api.put(`/api/v1/metric-catalog/${id}`, data),
  remove: (id: string) => api.delete(`/api/v1/metric-catalog/${id}`),
  batchDelete: (ids: string[]) => api.post('/api/v1/metric-catalog/batch-delete', { ids }),
};

// 地图要素 API
export const mapFeatureApi = {
  list: (params?: { feature_type?: string; keyword?: string; is_active?: boolean }) =>
    api.get('/api/v1/map-features', { params }),
  get: (id: string) => api.get(`/api/v1/map-features/${id}`),
  create: (data: any) => api.post('/api/v1/map-features', data),
  update: (id: string, data: any) => api.put(`/api/v1/map-features/${id}`, data),
  remove: (id: string) => api.delete(`/api/v1/map-features/${id}`),
  batchDelete: (ids: string[]) => api.post('/api/v1/map-features/batch-delete', { ids }),
};

// 预警服务API
export const alertApi = {
  getAlerts: (params?: any) => api.get('/api/v1/alerts', { params }),
  getAlert: (id: string) => api.get(`/api/v1/alerts/${id}`),
  createAlert: (data: any) => api.post('/api/v1/alerts', data),
  updateAlert: (id: string, data: any) => api.put(`/api/v1/alerts/${id}`, data),
  deleteAlert: (id: string) => api.delete(`/api/v1/alerts/${id}`),
  batchDeleteAlerts: (ids: string[]) => api.post('/api/v1/alerts/batch-delete', { ids }),
  confirmAlert: (id: string, data: any) => api.post(`/api/v1/alerts/${id}/confirm`, data),
  resolveAlert: (id: string, data: any) => api.post(`/api/v1/alerts/${id}/resolve`, data),
  getAlertStatistics: () => api.get('/api/v1/alerts/statistics/summary'),
  getAlertRules: (params?: any) => api.get('/api/v1/alerts/rules', { params }),
  getAlertRule: (id: string) => api.get(`/api/v1/alerts/rules/${id}`),
  createAlertRule: (data: any) => api.post('/api/v1/alerts/rules', data),
  updateAlertRule: (id: string, data: any) => api.put(`/api/v1/alerts/rules/${id}`, data),
  deleteAlertRule: (id: string) => api.delete(`/api/v1/alerts/rules/${id}`),
  batchDeleteAlertRules: (ids: string[]) => api.post('/api/v1/alerts/rules/batch-delete', { ids }),
  checkRules: (data: any) => api.post('/api/v1/alerts/rules/check', data),
};

// AI引擎API
export const aiApi = {
  // 系统状态
  getSystemStatus: () => api.get('/api/v1/ai/agents/status'),
  
  // Agent相关
  getAgents: () => api.get('/api/v1/ai/agents'),
  submitTask: (data: any) => api.post('/api/v1/ai/agents/task', data),
  getTaskResult: (taskId: string) => api.get(`/api/v1/ai/agents/task/${taskId}`),
  listTasks: (params?: { limit?: number; offset?: number; status?: string; task_type?: string; station_id?: string }) =>
    api.get('/api/v1/ai/agents/tasks', { params }),
  
  // AI 对话
  chat: (data: { message: string; context?: any }) => api.post('/api/v1/ai/chat', data),
  getChatHistory: (sessionId?: string) => api.get('/api/v1/ai/chat/history', { params: { session_id: sessionId } }),
  
  // 异常检测
  detectAnomaly: (data: any) => api.post('/api/v1/ai/anomaly/detect', data),
  
  // 预测（已降级：LSTM AE 不做趋势预测，保留仅兼容旧调用）
  predict: (data: any) => api.post('/api/v1/ai/prediction/forecast', data),
  predictRisk: (data: any) => api.post('/api/v1/ai/prediction/risk', data),

  // 模型评估：LSTM AutoEncoder 重构误差
  evaluateReconstruction: (data: { station_id: string; metric: string; hours: number }) =>
    api.post('/api/v1/ai/evaluation/reconstruction', data),
  
  // 知识推理
  identifyPollution: (data: any) => api.post('/api/v1/ai/knowledge/identify', data),
  analyzeComprehensive: (data: any) => api.post('/api/v1/ai/knowledge/analyze', data),
  getEmergencyPlan: (type: string) => api.get(`/api/v1/ai/knowledge/emergency-plan/${type}`),
  
  // 图计算
  traceSource: (data: any) => api.post('/api/v1/ai/graph/trace-source', data),
  analyzeSpread: (data: any) => api.post('/api/v1/ai/graph/spread-analysis', data),
  getUpstream: (stationId: string, maxDepth?: number) => 
    api.get(`/api/v1/ai/graph/upstream/${stationId}`, { params: { max_depth: maxDepth } }),
  getDownstream: (stationId: string, maxDepth?: number) => 
    api.get(`/api/v1/ai/graph/downstream/${stationId}`, { params: { max_depth: maxDepth } }),
  
  // 图谱数据查询
  getRivers: () => api.get('/api/v1/ai/graph/rivers'),
  getRiverTopology: () => api.get('/api/v1/ai/graph/rivers/topology'),
  getPollutionSources: (params?: { source_type?: string; district_code?: string; risk_level?: string }) =>
    api.get('/api/v1/ai/graph/pollution-sources', { params }),
  getPollutionSourceDetail: (sourceId: string) => api.get(`/api/v1/ai/graph/pollution-sources/${sourceId}`),
  getConfluences: () => api.get('/api/v1/ai/graph/confluences'),
  getDistricts: () => api.get('/api/v1/ai/graph/districts'),
  getGraphStatistics: () => api.get('/api/v1/ai/graph/statistics'),

  // 知识文档库
  getKnowledgeDocs: (params?: { category?: string; keyword?: string; page?: number; size?: number }) =>
    api.get('/api/v1/ai/knowledge-docs', { params }),
  getKnowledgeDoc: (id: string) => api.get(`/api/v1/ai/knowledge-docs/${id}`),
  getKnowledgeDocCategories: () => api.get('/api/v1/ai/knowledge-docs/categories'),
};

// 报告服务API
export const reportApi = {
  generateReport: (data: any) => api.post('/api/v1/reports/generate', data),
  getReports: (params?: any) => api.get('/api/v1/reports', { params }),
  getReport: (id: string) => api.get(`/api/v1/reports/${id}`),
  updateReport: (id: string, data: any) => api.put(`/api/v1/reports/${id}`, data),
  deleteReport: (id: string) => api.delete(`/api/v1/reports/${id}`),
  batchDeleteReports: (ids: string[]) => api.post('/api/v1/reports/batch-delete', { ids }),
  downloadReport: (id: string) => api.get(`/api/v1/reports/${id}/download`, { responseType: 'blob' }),
  getReportStatistics: () => api.get('/api/v1/reports/statistics/summary'),
  // 报告模板
  getTemplates: (params?: any) => api.get('/api/v1/reports/templates', { params }),
  getTemplate: (id: string) => api.get(`/api/v1/reports/templates/${id}`),
  createTemplate: (data: any) => api.post('/api/v1/reports/templates', data),
  updateTemplate: (id: string, data: any) => api.put(`/api/v1/reports/templates/${id}`, data),
  deleteTemplate: (id: string) => api.delete(`/api/v1/reports/templates/${id}`),
  // 定时报告
  getScheduledReports: (params?: any) => api.get('/api/v1/reports/scheduled', { params }),
  getScheduledReport: (id: string) => api.get(`/api/v1/reports/scheduled/${id}`),
  createScheduledReport: (data: any) => api.post('/api/v1/reports/scheduled', data),
  updateScheduledReport: (id: string, data: any) => api.put(`/api/v1/reports/scheduled/${id}`, data),
  deleteScheduledReport: (id: string) => api.delete(`/api/v1/reports/scheduled/${id}`),
};

// 数据服务API
export const dataApi = {
  getLatestData: (stationId: string) => api.get(`/api/v1/data/stations/${stationId}/latest`),
  getHistoryData: (stationId: string, params?: any) => 
    api.get(`/api/v1/data/stations/${stationId}/history`, { params }),
  getStatistics: (stationId: string, params?: any) => 
    api.get(`/api/v1/data/stations/${stationId}/statistics`, { params }),
};

// 通知服务API
export const notificationApi = {
  getNotifications: (params?: { notification_type?: string; level?: string; is_read?: boolean; recipient?: string; source?: string; limit?: number; skip?: number }) =>
    api.get('/api/v1/notifications', { params }),
  getNotification: (id: string) => api.get(`/api/v1/notifications/${id}`),
  createNotification: (data: any) => api.post('/api/v1/notifications', data),
  updateNotification: (id: string, data: any) => api.put(`/api/v1/notifications/${id}`, data),
  markAsRead: (id: string) => api.post(`/api/v1/notifications/${id}/read`),
  markAllAsRead: (recipient?: string) =>
    api.post('/api/v1/notifications/mark-all-read', null, { params: recipient ? { recipient } : {} }),
  deleteNotification: (id: string) => api.delete(`/api/v1/notifications/${id}`),
  batchDeleteNotifications: (ids: string[]) => api.post('/api/v1/notifications/batch-delete', { ids }),
  getStatistics: () => api.get('/api/v1/notifications/statistics'),
};

// MQTT管理API
export const mqttApi = {
  getConnections: () => api.get('/api/v1/mqtt/connections'),
  getConnectionsByStation: (stationId: string) => api.get(`/api/v1/mqtt/connections/by-station/${stationId}`),
  createConnection: (data: any) => api.post('/api/v1/mqtt/connections', data),
  updateConnection: (id: string, data: any) => api.put(`/api/v1/mqtt/connections/${id}`, data),
  deleteConnection: (id: string) => api.delete(`/api/v1/mqtt/connections/${id}`),
  testConnection: (id: string) => api.post(`/api/v1/mqtt/connections/${id}/test`),
  startConnection: (id: string) => api.post(`/api/v1/mqtt/connections/${id}/start`),
  stopConnection: (id: string) => api.post(`/api/v1/mqtt/connections/${id}/stop`),
  getStatus: (id: string) => api.get(`/api/v1/mqtt/connections/${id}/status`),
  getLatestData: (params?: any) => api.get('/api/v1/mqtt/data/latest', { params }),
  getHistoryData: (params?: any) => api.get('/api/v1/mqtt/data/history', { params }),
  getDataStatistics: () => api.get('/api/v1/mqtt/data/statistics'),
};

// 模型管理 API
export const modelApi = {
  getModels: (params?: any) => api.get('/api/v1/ai/models', { params }),
  getModel: (id: string) => api.get(`/api/v1/ai/models/${id}`),
  getTrainingHistory: (id: string, params?: { limit?: number; offset?: number }) =>
    api.get(`/api/v1/ai/models/${id}/training-history`, { params }),
  trainModel: (data: any) => api.post('/api/v1/ai/models/train', data),
  deployModel: (id: string) => api.post(`/api/v1/ai/models/${id}/deploy`),
  undeployModel: (id: string) => api.post(`/api/v1/ai/models/${id}/undeploy`),
  deleteModel: (id: string) => api.delete(`/api/v1/ai/models/${id}`),
  // 站点级模型绑定
  listStationModels: (params?: { status?: string; limit?: number; offset?: number }) =>
    api.get('/api/v1/ai/models/stations', { params }),
  getStationModelStatus: (stationId: string) =>
    api.get(`/api/v1/ai/models/status/${stationId}`),
  deleteAgentTask: (taskId: string) => api.delete(`/api/v1/ai/agents/task/${taskId}`),
  batchDeleteAgentTasks: (ids: string[]) =>
    api.post('/api/v1/ai/agents/tasks/batch-delete', { ids }),
};

// 图谱管理 API（河流/污染源/交汇点/行政区/应急预案，基于 Neo4j 持久化）
export const graphAdminApi = {
  // 河流
  createRiver: (data: any) => api.post('/api/v1/ai/graph-admin/rivers', data),
  updateRiver: (riverId: string, data: any) => api.put(`/api/v1/ai/graph-admin/rivers/${riverId}`, data),
  deleteRiver: (riverId: string) => api.delete(`/api/v1/ai/graph-admin/rivers/${riverId}`),
  createRiverFlow: (data: { upstream_id: string; downstream_id: string; distance_km?: number; confluence_id?: string }) =>
    api.post('/api/v1/ai/graph-admin/rivers/flows', data),
  deleteRiverFlow: (upstream_id: string, downstream_id: string) =>
    api.delete('/api/v1/ai/graph-admin/rivers/flows', { params: { upstream_id, downstream_id } }),

  // 污染源
  createPollutionSource: (data: any) => api.post('/api/v1/ai/graph-admin/pollution-sources', data),
  updatePollutionSource: (sourceId: string, data: any) =>
    api.put(`/api/v1/ai/graph-admin/pollution-sources/${sourceId}`, data),
  deletePollutionSource: (sourceId: string) =>
    api.delete(`/api/v1/ai/graph-admin/pollution-sources/${sourceId}`),
  bindPollutionToRiver: (sourceId: string, riverId: string) =>
    api.post(`/api/v1/ai/graph-admin/pollution-sources/${sourceId}/river/${riverId}`),
  unbindPollutionFromRiver: (sourceId: string, riverId: string) =>
    api.delete(`/api/v1/ai/graph-admin/pollution-sources/${sourceId}/river/${riverId}`),

  // 站点拓扑：上下游 + 挂到河流 + 属性更新
  updateStation: (stationId: string, data: { name?: string; station_name?: string; river_km?: number; district?: string }) =>
    api.put(`/api/v1/ai/graph-admin/stations/${stationId}`, data),
  createStationFlow: (data: { upstream_id: string; downstream_id: string; distance_km?: number; travel_hours?: number }) =>
    api.post('/api/v1/ai/graph-admin/stations/flows', data),
  deleteStationFlow: (upstream_id: string, downstream_id: string) =>
    api.delete('/api/v1/ai/graph-admin/stations/flows', { params: { upstream_id, downstream_id } }),
  bindStationToRiver: (stationId: string, riverId: string) =>
    api.post(`/api/v1/ai/graph-admin/stations/${stationId}/river/${riverId}`),
  unbindStationFromRiver: (stationId: string, riverId: string) =>
    api.delete(`/api/v1/ai/graph-admin/stations/${stationId}/river/${riverId}`),

  // 交汇点
  createConfluence: (data: any) => api.post('/api/v1/ai/graph-admin/confluences', data),
  updateConfluence: (id: string, data: any) => api.put(`/api/v1/ai/graph-admin/confluences/${id}`, data),
  deleteConfluence: (id: string) => api.delete(`/api/v1/ai/graph-admin/confluences/${id}`),
  // 交汇点拓扑关系（河流↔交汇点）
  createConfluenceInflow: (data: { river_id: string; confluence_id: string; distance_km?: number }) =>
    api.post('/api/v1/ai/graph-admin/confluences/inflow', data),
  deleteConfluenceInflow: (river_id: string, confluence_id: string) =>
    api.delete('/api/v1/ai/graph-admin/confluences/inflow', { params: { river_id, confluence_id } }),
  createConfluenceOutflow: (data: { confluence_id: string; river_id: string; distance_km?: number }) =>
    api.post('/api/v1/ai/graph-admin/confluences/outflow', data),
  deleteConfluenceOutflow: (confluence_id: string, river_id: string) =>
    api.delete('/api/v1/ai/graph-admin/confluences/outflow', { params: { confluence_id, river_id } }),

  // 行政区
  createDistrict: (data: any) => api.post('/api/v1/ai/graph-admin/districts', data),
  updateDistrict: (code: string, data: any) => api.put(`/api/v1/ai/graph-admin/districts/${code}`, data),
  deleteDistrict: (code: string) => api.delete(`/api/v1/ai/graph-admin/districts/${code}`),

  // 图谱快照 + 批量导入 (画布编辑器专用)
  getGraphSnapshot: () => api.get('/api/v1/ai/graph-admin/graph/snapshot'),
  bulkImportTopology: (kind: 'river_flow'|'station_river'|'station_flow'|'pollution_river'|'river_confluence_in'|'river_confluence_out', items: any[], dryRun = false, signal?: AbortSignal) =>
    api.post('/api/v1/ai/graph-admin/import/bulk', { kind, items, dry_run: dryRun }, { signal }),

  // 画布坐标持久化（用户拖拽后保存布局）
  getCanvasLayout: () => api.get('/api/v1/ai/graph-admin/graph/canvas-layout'),
  saveCanvasLayout: (layouts: Array<{ node_type: 'river'|'station'|'confluence'|'pollution'; node_id: string; x: number; y: number }>) =>
    api.post('/api/v1/ai/graph-admin/graph/canvas-layout', { layouts }),
  resetCanvasLayout: (node_type: 'river'|'station'|'confluence'|'pollution', node_id: string) =>
    api.delete(`/api/v1/ai/graph-admin/graph/canvas-layout/${node_type}/${encodeURIComponent(node_id)}`),

  // 应急预案
  listEmergencyPlans: () => api.get('/api/v1/ai/graph-admin/emergency-plans'),
  getEmergencyPlan: (id: string) => api.get(`/api/v1/ai/graph-admin/emergency-plans/${id}`),
  createEmergencyPlan: (data: any) => api.post('/api/v1/ai/graph-admin/emergency-plans', data),
  updateEmergencyPlan: (id: string, data: any) =>
    api.put(`/api/v1/ai/graph-admin/emergency-plans/${id}`, data),
  deleteEmergencyPlan: (id: string) => api.delete(`/api/v1/ai/graph-admin/emergency-plans/${id}`),
};

// 认证 API
export const authApi = {
  login: (username: string, password: string) =>
    api.post('/api/v1/auth/login', { username, password }),
  logout: () => api.post('/api/v1/auth/logout'),
  me: () => api.get('/api/v1/auth/me'),
  changePassword: (old_password: string, new_password: string) =>
    api.post('/api/v1/auth/change-password', { old_password, new_password }),
};

// 用户管理 API
export const userApi = {
  listUsers: (params?: any) => api.get('/api/v1/system/users', { params }),
  getUser: (id: string) => api.get(`/api/v1/system/users/${id}`),
  createUser: (data: any) => api.post('/api/v1/system/users', data),
  updateUser: (id: string, data: any) => api.put(`/api/v1/system/users/${id}`, data),
  deleteUser: (id: string) => api.delete(`/api/v1/system/users/${id}`),
  batchDeleteUsers: (ids: string[]) =>
    api.post('/api/v1/system/users/batch-delete', { ids }),
};

// 角色权限 API
export const roleApi = {
  listRoles: () => api.get('/api/v1/system/roles'),
  getRole: (id: string) => api.get(`/api/v1/system/roles/${id}`),
  createRole: (data: any) => api.post('/api/v1/system/roles', data),
  updateRole: (id: string, data: any) => api.put(`/api/v1/system/roles/${id}`, data),
  deleteRole: (id: string) => api.delete(`/api/v1/system/roles/${id}`),
  listPermissions: () => api.get('/api/v1/system/roles/permissions'),
};

// 操作日志 API
export const logApi = {
  listLogs: (params?: any) => api.get('/api/v1/system/logs', { params }),
  createLog: (data: any) => api.post('/api/v1/system/logs', data),
  deleteLog: (id: string) => api.delete(`/api/v1/system/logs/${id}`),
  batchDeleteLogs: (ids: string[]) =>
    api.post('/api/v1/system/logs/batch-delete', { ids }),
  cleanOldLogs: (days: number) =>
    api.post('/api/v1/system/logs/clean', null, { params: { days } }),
};

export default api;

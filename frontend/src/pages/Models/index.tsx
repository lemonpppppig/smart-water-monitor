// Models page: 4-Tab 全生命周期管理（v2 - 含 400 No metrics 引导 Modal）
import { useEffect, useMemo, useState } from 'react';
import {
  LineChartOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
  ExperimentOutlined,
  ClusterOutlined,
  ShareAltOutlined,
  RobotOutlined,
  ApiOutlined,
  DatabaseOutlined,
  ClockCircleOutlined,
  InfoCircleOutlined,
  HistoryOutlined,
  BarChartOutlined,
  PlayCircleOutlined,
  CloseCircleOutlined,
  FieldTimeOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import {
  Button,
  Tag,
  Modal,
  Form,
  InputNumber,
  Select,
  message,
  Empty,
  Tabs,
  Alert,
  Table,
  Tooltip,
  Input,
  Space,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import ReactECharts from 'echarts-for-react';
import { GlassCard } from '../../components/GlassCard';
import { aiApi, modelApi, stationApi } from '../../services/api';

// ============ 类型定义 ============
interface EngineCard {
  id: string;
  name: string;
  type: string;
  description: string;
  icon: React.ReactNode;
  gradient: string;
  capabilities: string[];
  tech: string;
  apiPath: string;
}

/** AI 能力总览卡片 —— 纯展示，不承载任何训练/部署操作 */
const ENGINE_REGISTRY: EngineCard[] = [
  {
    id: 'lstm-prediction',
    name: 'LSTM 时序预测',
    type: 'LSTM + Attention',
    description: '站点级多变量时序建模，输出 24-168h 预测值与置信区间',
    icon: <LineChartOutlined className="text-2xl text-white" />,
    gradient: 'from-cyan-500 to-blue-600',
    capabilities: ['趋势预测', '异常检测'],
    tech: 'PyTorch',
    apiPath: '/ai/prediction/*',
  },
  {
    id: 'knowledge-reasoning',
    name: '知识推理',
    type: '规则 + 案例',
    description: '基于领域规则与案例库的污染识别与应急预案推荐',
    icon: <DatabaseOutlined className="text-2xl text-white" />,
    gradient: 'from-purple-500 to-pink-600',
    capabilities: ['污染识别', '案例匹配'],
    tech: '规则引擎',
    apiPath: '/ai/knowledge/*',
  },
  {
    id: 'graph-engine',
    name: '图计算引擎',
    type: 'Neo4j / Cypher',
    description: '基于流域拓扑图的污染溯源、扩散预测与路径分析',
    icon: <ShareAltOutlined className="text-2xl text-white" />,
    gradient: 'from-green-500 to-teal-600',
    capabilities: ['污染溯源', '上下游查询'],
    tech: 'Neo4j',
    apiPath: '/ai/graph/*',
  },
  {
    id: 'agent-orchestrator',
    name: '多智能体协调器',
    type: 'LangGraph',
    description: '多个专家智能体协同完成复杂决策链路',
    icon: <RobotOutlined className="text-2xl text-white" />,
    gradient: 'from-amber-500 to-orange-600',
    capabilities: ['任务调度', '决策链路'],
    tech: 'LangGraph',
    apiPath: '/ai/agents/*',
  },
];

interface ApiModelMeta {
  id?: string;
  name?: string;
  version?: string;
  accuracy?: number;
  latency?: number;
  status?: string;
  updated_at?: string;
}

interface StationModelBinding {
  station_id: string;
  station_name?: string | null;
  model_type?: string;
  metrics: string[];
  epochs?: number;
  final_loss?: number | null;
  samples?: number | null;
  data_source?: string | null;
  version?: number | null;
  status?: string;
  error?: string | null;
  trained_at?: string | null;
  updated_at?: string | null;
}

interface StationOption {
  value: string;
  label: string;
  station_code?: string;
}

interface TrainingTaskItem {
  task_id: string;
  task_type: string;
  station_id?: string;
  status: string;
  priority?: number;
  created_at?: string;
  started_at?: string;
  completed_at?: string;
  payload?: any;
  result?: any;
  error?: string;
}

const METRIC_OPTIONS = [
  { value: 'ph', label: 'pH 值' },
  { value: 'do', label: '溶解氧 (DO)' },
  { value: 'nh3_n', label: '氨氮 (NH3-N)' },
  { value: 'codmn', label: '高锰酸盐指数 (CODMn)' },
  { value: 'codcr', label: 'COD (CODCr)' },
  { value: 'total_n', label: '总氮 (TN)' },
  { value: 'total_p', label: '总磷 (TP)' },
  { value: 'turbidity', label: '浊度' },
  { value: 'conductivity', label: '电导率' },
  { value: 'water_temperature', label: '水温' },
];

const TASK_STATUS_COLOR: Record<string, string> = {
  pending: 'gold',
  submitted: 'gold',
  running: 'processing',
  completed: 'green',
  failed: 'red',
  cancelled: 'default',
};

const TASK_STATUS_LABEL: Record<string, string> = {
  pending: '排队中',
  submitted: '排队中',
  running: '训练中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

function durationText(started?: string, completed?: string): string {
  if (!started || !completed) return '-';
  const s = new Date(started).getTime();
  const c = new Date(completed).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(c)) return '-';
  const ms = c - s;
  if (!Number.isFinite(ms) || ms < 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = sec / 60;
  if (min < 60) return `${min.toFixed(1)}min`;
  return `${(min / 60).toFixed(1)}h`;
}

// ============ 主组件 ============
export default function Models() {
  // ===== 基础数据 =====
  const [trainModalOpen, setTrainModalOpen] = useState(false);
  const [trainLoading, setTrainLoading] = useState(false);
  const [form] = Form.useForm();
  const [stationOptions, setStationOptions] = useState<StationOption[]>([]);
  const [apiModels, setApiModels] = useState<ApiModelMeta[]>([]);
  const [stationModels, setStationModels] = useState<StationModelBinding[]>([]);
  const [stationModelsLoading, setStationModelsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchKey, setSearchKey] = useState('');
  const [activeTab, setActiveTab] = useState<string>('binding');

  // ===== Tab 2: 训练任务流水 =====
  const [trainingTasks, setTrainingTasks] = useState<TrainingTaskItem[]>([]);
  const [trainingTasksLoading, setTrainingTasksLoading] = useState(false);
  const [taskStatusFilter, setTaskStatusFilter] = useState<string>('');

  // ===== Tab 3: 版本历史 =====
  // 默认全量拉取所有站点的训练历史，本地按站点 / 关键词筛选
  const [historyStationId, setHistoryStationId] = useState<string | undefined>();
  const [historySearchKey, setHistorySearchKey] = useState('');
  const [historyItems, setHistoryItems] = useState<TrainingTaskItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ===== Tab 4: 模型评估（LSTM 重构误差） =====
  const [evalStationId, setEvalStationId] = useState<string | undefined>();
  const [evalMetric, setEvalMetric] = useState<string>('ph');
  const [evalHours, setEvalHours] = useState<number>(72);
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalSeries, setEvalSeries] = useState<
    Array<{ timestamp: string; actual: number; reconstructed: number; error: number }>
  >([]);
  const [evalStats, setEvalStats] = useState<{
    mean_error: number;
    p95_error: number;
    max_error: number;
    anomaly_threshold: number;
    anomaly_count: number;
    sample_count: number;
  } | null>(null);
  const [evalMetricsTrained, setEvalMetricsTrained] = useState<string[]>([]);
  const [evalWindowInfo, setEvalWindowInfo] = useState<{
    used: number;
    requested: number;
    attempts: Array<{ hours: number; rows: number }>;
  } | null>(null);
  const [evalAnalysis, setEvalAnalysis] = useState<{
    quality: 'excellent' | 'good' | 'fair' | 'poor';
    quality_label: string;
    quality_score: number;
    rel_error: number;
    stability: 'stable' | 'moderate' | 'spiky';
    stability_label: string;
    spike_ratio: number;
    anomaly_ratio: number;
    bias: 'higher' | 'lower' | 'balanced';
    bias_label: string;
    bias_pct: number;
    worst_segments: Array<{ start: string; end: string; peak_error: number; count: number }>;
    conclusion: string;
    suggestions: string[];
  } | null>(null);

  // ===== 加载 =====
  const loadData = async () => {
    try {
      const [stationRes, modelsRes] = await Promise.all([
        stationApi.getStations({ size: 200 }).catch(() => null),
        modelApi.getModels().catch(() => null),
      ]);
      if (stationRes) {
        const items = ((stationRes as any)?.items ||
          (stationRes as any)?.data?.items ||
          (stationRes as any)?.data ||
          stationRes) as any[];
        if (Array.isArray(items)) {
          setStationOptions(
            items.map((s) => ({
              value: s.station_code || s.id,
              label: s.name || s.station_name || s.station_code || s.id,
              station_code: s.station_code,
            })),
          );
        }
      }
      if (modelsRes) {
        const items = ((modelsRes as any)?.items ||
          (modelsRes as any)?.data?.items ||
          (modelsRes as any)?.data ||
          modelsRes) as any[];
        if (Array.isArray(items)) setApiModels(items);
      }
    } catch (err) {
      console.error('加载基础数据失败', err);
    }
  };

  const loadStationModels = async () => {
    setStationModelsLoading(true);
    try {
      const res: any = await modelApi.listStationModels({ limit: 500 });
      const data = res?.data || res;
      setStationModels(data?.items || []);
    } catch (err) {
      console.warn('加载站点模型绑定失败', err);
      setStationModels([]);
    } finally {
      setStationModelsLoading(false);
    }
  };

  const loadTrainingTasks = async () => {
    setTrainingTasksLoading(true);
    try {
      const res: any = await aiApi.listTasks({ task_type: 'training', limit: 200 });
      const data = res?.data || res;
      const items = (data?.tasks || data?.items || []) as any[];
      setTrainingTasks(Array.isArray(items) ? items : []);
    } catch (err) {
      console.warn('加载训练任务失败', err);
      setTrainingTasks([]);
    } finally {
      setTrainingTasksLoading(false);
    }
  };

  // Tab 3：默认全量拉取所有站点的训练历史（task_type=training，任意状态）
  const loadTrainingHistory = async () => {
    setHistoryLoading(true);
    try {
      const res: any = await aiApi.listTasks({ task_type: 'training', limit: 200 });
      const data = res?.data || res;
      const items = (data?.tasks || data?.items || []) as TrainingTaskItem[];
      setHistoryItems(Array.isArray(items) ? items : []);
    } catch (err) {
      console.warn('加载训练历史失败', err);
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const runEvaluation = async () => {
    if (!evalStationId || !evalMetric) {
      message.warning('请先选择站点和指标');
      return;
    }
    setEvalLoading(true);
    setEvalSeries([]);
    setEvalStats(null);
    setEvalMetricsTrained([]);
    setEvalWindowInfo(null);
    setEvalAnalysis(null);
    try {
      const res: any = await aiApi.evaluateReconstruction({
        station_id: evalStationId,
        metric: evalMetric,
        hours: evalHours,
      });
      const data = res?.data || res;
      const series = (data?.series || []) as Array<{
        timestamp: string;
        actual: number;
        reconstructed: number;
        error: number;
      }>;
      setEvalSeries(Array.isArray(series) ? series : []);
      setEvalStats(data?.stats || null);
      setEvalAnalysis(data?.analysis || null);
      setEvalMetricsTrained(Array.isArray(data?.metrics_trained) ? data.metrics_trained : []);
      if (data?.window_hours_used != null) {
        setEvalWindowInfo({
          used: Number(data.window_hours_used),
          requested: Number(data.window_hours_requested || data.window_hours_used),
          attempts: Array.isArray(data.fetch_attempts) ? data.fetch_attempts : [],
        });
      }
      if (!series || series.length === 0) {
        message.warning('模型成功返回但没有有效重构点，请拉更长的历史窗口');
      }
    } catch (err: any) {
      console.error(err);
      const detail =
        err?.response?.data?.detail ||
        err?.response?.data?.message ||
        err?.message ||
        '未知错误';
      message.error(`评估失败：${detail}`);
    } finally {
      setEvalLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    loadStationModels();
  }, []);

  useEffect(() => {
    if (activeTab === 'tasks') loadTrainingTasks();
    if (activeTab === 'history') loadTrainingHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // 轮询：若存在 running/pending 的训练任务，当前 Tab 2/3/1 都需要追踪状态变化
  useEffect(() => {
    const hasRunningStationModel = stationModels.some(
      (m) => m.status === 'training' || m.status === 'pending',
    );
    const hasRunningTask = trainingTasks.some(
      (t) => t.status === 'running' || t.status === 'pending' || t.status === 'submitted',
    );
    const historyRunning = historyItems.some(
      (t) => t.status === 'running' || t.status === 'pending',
    );
    const needPoll =
      (activeTab === 'binding' && hasRunningStationModel) ||
      (activeTab === 'tasks' && (hasRunningTask || hasRunningStationModel)) ||
      (activeTab === 'history' && (historyRunning || hasRunningStationModel));
    if (!needPoll) return;
    const timer = setInterval(() => {
      if (activeTab === 'binding') loadStationModels();
      if (activeTab === 'tasks') loadTrainingTasks();
      if (activeTab === 'history') loadTrainingHistory();
    }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, stationModels, trainingTasks, historyItems]);

  // ====== 以站点为主轴，左 JOIN 绑定数据 ======
  const mergedRows = useMemo<StationModelBinding[]>(() => {
    const bindingMap = new Map(stationModels.map((m) => [m.station_id, m]));
    const rows: StationModelBinding[] = stationOptions.map((s) => {
      const binding = bindingMap.get(s.value);
      if (binding) {
        return {
          ...binding,
          station_name: binding.station_name || s.label,
        };
      }
      return {
        station_id: s.value,
        station_name: s.label,
        metrics: [],
        status: 'untrained',
      };
    });
    for (const binding of stationModels) {
      if (!stationOptions.find((s) => s.value === binding.station_id)) {
        rows.push(binding);
      }
    }
    const order: Record<string, number> = {
      active: 0,
      training: 1,
      pending: 2,
      failed: 3,
      untrained: 4,
    };
    rows.sort((a, b) => {
      const ao = order[a.status || 'untrained'] ?? 9;
      const bo = order[b.status || 'untrained'] ?? 9;
      return ao - bo;
    });
    return rows;
  }, [stationModels, stationOptions]);

  // ====== Tab 4 评估站点下拉：按训练状态分组，未训练置灰 ======
  const evalStationOptions = useMemo(() => {
    const trained = mergedRows.filter((r) => r.status === 'active');
    const training = mergedRows.filter((r) => r.status === 'training' || r.status === 'pending');
    const failed = mergedRows.filter((r) => r.status === 'failed');
    const untrained = mergedRows.filter((r) => !r.status || r.status === 'untrained');
    const toOpt = (r: StationModelBinding, suffix: string, disabled: boolean) => ({
      value: r.station_id,
      label: `${r.station_id}${r.station_name ? ' · ' + r.station_name : ''}${suffix}`,
      disabled,
    });
    const groups: any[] = [];
    if (trained.length > 0) {
      groups.push({
        label: `✓ 已训练（可评估 · ${trained.length}）`,
        options: trained.map((r) => toOpt(r, '', false)),
      });
    }
    if (training.length > 0) {
      groups.push({
        label: `⏳ 训练中（${training.length}）`,
        options: training.map((r) => toOpt(r, '（训练中）', true)),
      });
    }
    if (failed.length > 0) {
      groups.push({
        label: `✗ 训练失败（${failed.length}）`,
        options: failed.map((r) => toOpt(r, '（失败）', true)),
      });
    }
    if (untrained.length > 0) {
      groups.push({
        label: `○ 未训练（${untrained.length}）`,
        options: untrained.map((r) => toOpt(r, '（未训练）', true)),
      });
    }
    return groups;
  }, [mergedRows]);

  const filteredRows = useMemo<StationModelBinding[]>(() => {
    const key = searchKey.trim().toLowerCase();
    return mergedRows.filter((r) => {
      if (statusFilter && (r.status || 'untrained') !== statusFilter) return false;
      if (key) {
        const hay = `${r.station_id} ${r.station_name || ''}`.toLowerCase();
        if (!hay.includes(key)) return false;
      }
      return true;
    });
  }, [mergedRows, statusFilter, searchKey]);

  const stats = useMemo(() => {
    const total = mergedRows.length;
    const active = mergedRows.filter((r) => r.status === 'active').length;
    const running = mergedRows.filter((r) => r.status === 'training' || r.status === 'pending').length;
    const failed = mergedRows.filter((r) => r.status === 'failed').length;
    const untrained = total - active - running - failed;
    return { total, active, running, failed, untrained };
  }, [mergedRows]);

  // 过滤后的训练任务
  const filteredTrainingTasks = useMemo(() => {
    return trainingTasks.filter((t) => !taskStatusFilter || t.status === taskStatusFilter);
  }, [trainingTasks, taskStatusFilter]);

  // ====== 训练弹窗 ======
  const openTrainModal = (preset?: { station_id?: string; metrics?: string[] }) => {
    form.setFieldsValue({
      station_id: preset?.station_id,
      metrics: preset?.metrics || [],
      epochs: 50,
      lookback_days: 30,
    });
    setTrainModalOpen(true);
  };

  const handleTrainSubmit = () => {
    form
      .validateFields()
      .then(async (values) => {
        const metrics: string[] = Array.isArray(values.metrics) ? values.metrics : [];
        setTrainLoading(true);
        const stationLabel =
          stationOptions.find((s) => s.value === values.station_id)?.label || values.station_id;
        try {
          await modelApi.trainModel({
            station_id: values.station_id,
            metrics: metrics.length > 0 ? metrics : undefined,
            epochs: values.epochs || 50,
            lookback_days: values.lookback_days || 30,
          });
          const hint = metrics.length > 0 ? `覆盖 ${metrics.length} 个指标` : '覆盖该站点全部启用指标';
          message.success(`已为 「${stationLabel}」 提交站点级模型训练任务（${hint}）`);
          setTrainModalOpen(false);
          // Tab 1 站点绑定
          loadStationModels();
          setTimeout(loadStationModels, 2500);
          setTimeout(loadStationModels, 8000);
          // Tab 2 训练任务流水（不论当前是否在该 Tab，都提前拉）
          setTimeout(loadTrainingTasks, 800);
          setTimeout(loadTrainingTasks, 8000);
          // Tab 3 版本历史（全量表刷新）
          setTimeout(loadTrainingHistory, 1500);
          setTimeout(loadTrainingHistory, 8000);
        } catch (err: any) {
          console.error(err);
          const detail =
            err?.response?.data?.detail ||
            err?.response?.data?.message ||
            err?.message;
          const status = err?.response?.status;
          if (status === 400 && typeof detail === 'string' && detail.toLowerCase().includes('no metrics')) {
            Modal.warning({
              title: '该站点未配置可训练指标',
              width: 520,
              content: (
                <div className="text-sm text-gray-700 space-y-2">
                  <p>
                    后端返回：<code className="text-red-500">{detail}</code>
                  </p>
                  <p>原因：站点 <strong>{stationLabel}</strong> 在 <code>station_metrics</code> 表中没有 <code>is_enabled=true</code> 的启用指标。</p>
                  <p>解决方案（任选一）：</p>
                  <ul className="list-disc pl-5 text-xs text-gray-600">
                    <li>在本弹窗手动选上要训练的指标（<strong>推荐</strong>）</li>
                    <li>去 「站点管理 → 指标配置」 给该站点开启常用指标</li>
                  </ul>
                </div>
              ),
            });
          } else if (typeof detail === 'string' && detail) {
            message.error(`训练任务提交失败：${detail}`);
          } else {
            message.error('训练任务提交失败（后端 AI 引擎未启用或网络异常）');
          }
        } finally {
          setTrainLoading(false);
        }
      })
      .catch(() => {});
  };

  // ====== 图表 option ======
  // Tab 3 本地筛选：站点 + 关键词
  const filteredHistoryItems = useMemo(() => {
    const key = historySearchKey.trim().toLowerCase();
    return historyItems.filter((t) => {
      if (historyStationId) {
        const sid = t.station_id || t.payload?.station_id;
        if (sid !== historyStationId) return false;
      }
      if (key) {
        const hay = [
          t.task_id,
          t.station_id,
          t.payload?.station_id,
          t.payload?.station_name,
          (t.payload?.metrics || []).join(','),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(key)) return false;
      }
      return true;
    });
  }, [historyItems, historyStationId, historySearchKey]);

  // Loss 趋势：仅当筛选后仅剩单一站点时有意义
  const historyLossOption = useMemo(() => {
    const rows = [...filteredHistoryItems].reverse(); // 按时间升序
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['Final Loss'] },
      grid: { left: 50, right: 20, top: 40, bottom: 40 },
      xAxis: {
        type: 'category' as const,
        data: rows.map((r) =>
          (r.created_at || r.started_at || '').slice(5, 16).replace('T', ' '),
        ),
      },
      yAxis: { type: 'value' as const, scale: true },
      series: [
        {
          name: 'Final Loss',
          type: 'line' as const,
          smooth: true,
          data: rows.map((r) => {
            const v = r.result?.final_loss;
            return v == null ? null : Number(v);
          }),
          markPoint: { data: [{ type: 'min' }, { type: 'max' }] },
          itemStyle: { color: '#10b981' },
          lineStyle: { color: '#10b981' },
        },
      ],
    };
  }, [filteredHistoryItems]);

  const evalChartOption = useMemo(() => {
    const xs = evalSeries.map((p) => String(p.timestamp).slice(5, 16).replace('T', ' '));
    const actualData = evalSeries.map((p) => p.actual);
    const recData = evalSeries.map((p) => p.reconstructed);
    const errData = evalSeries.map((p) => p.error);
    const threshold = evalStats?.anomaly_threshold;
    return {
      tooltip: { trigger: 'axis' as const },
      legend: { data: ['实际值', 'LSTM 重构值', '重构误差'] },
      grid: [
        { left: 50, right: 30, top: 40, height: '55%' },
        { left: 50, right: 30, top: '72%', height: '22%' },
      ],
      xAxis: [
        { type: 'category' as const, data: xs, gridIndex: 0, boundaryGap: false },
        { type: 'category' as const, data: xs, gridIndex: 1, axisLabel: { show: false } },
      ],
      yAxis: [
        { type: 'value' as const, scale: true, gridIndex: 0, name: evalMetric },
        { type: 'value' as const, scale: true, gridIndex: 1, name: '误差', axisLabel: { fontSize: 10 } },
      ],
      series: [
        {
          name: '实际值',
          type: 'line' as const,
          smooth: true,
          symbol: 'none',
          data: actualData,
          itemStyle: { color: '#f59e0b' },
          lineStyle: { color: '#f59e0b', width: 2 },
          xAxisIndex: 0,
          yAxisIndex: 0,
        },
        {
          name: 'LSTM 重构值',
          type: 'line' as const,
          smooth: true,
          symbol: 'none',
          data: recData,
          itemStyle: { color: '#06b6d4' },
          lineStyle: { color: '#06b6d4', width: 2, type: 'dashed' as const },
          xAxisIndex: 0,
          yAxisIndex: 0,
        },
        {
          name: '重构误差',
          type: 'bar' as const,
          data: errData,
          itemStyle: { color: '#8b5cf6' },
          xAxisIndex: 1,
          yAxisIndex: 1,
          markLine:
            threshold != null
              ? {
                  silent: true,
                  symbol: 'none',
                  lineStyle: { color: '#ef4444', type: 'dashed' as const },
                  data: [{ yAxis: threshold, label: { formatter: `异常阈值 ${threshold.toFixed(3)}` } }],
                }
              : undefined,
        },
      ],
    };
  }, [evalSeries, evalStats, evalMetric]);

  // ====== Tab 渲染 ======
  const renderBindingTab = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <ExperimentOutlined className="text-cyan-600" />
            站点模型绑定
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            每行对应一个站点，状态由 <code className="text-gray-600">ai_station_models</code> 表与{' '}
            <code className="text-gray-600">stations</code> 表合并得到。
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Input.Search
            placeholder="搜索站点编码或名称"
            allowClear
            size="middle"
            onSearch={setSearchKey}
            onChange={(e) => !e.target.value && setSearchKey('')}
            style={{ width: 220 }}
          />
          <Select
            placeholder="状态筛选"
            allowClear
            size="middle"
            value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v || '')}
            style={{ width: 140 }}
            options={[
              { value: 'active', label: '已绑定' },
              { value: 'training', label: '训练中' },
              { value: 'pending', label: '排队中' },
              { value: 'failed', label: '失败' },
              { value: 'untrained', label: '未训练' },
            ]}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              loadData();
              loadStationModels();
            }}
            loading={stationModelsLoading}
          >
            刷新
          </Button>
          <Button
            type="primary"
            icon={<ExperimentOutlined />}
            onClick={() => openTrainModal()}
            className="bg-cyan-600 hover:bg-cyan-700"
          >
            训练新站点模型
          </Button>
        </div>
      </div>
      <Table<StationModelBinding>
        rowKey="station_id"
        size="middle"
        dataSource={filteredRows}
        loading={stationModelsLoading}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        locale={{
          emptyText: <Empty description="没有匹配站点。请先在「站点管理」添加站点，或调整筛选条件。" />,
        }}
        scroll={{ x: 1100 }}
        columns={buildStationBindingColumns({
          onTrain: (station_id, metrics) => openTrainModal({ station_id, metrics }),
          onViewHistory: (station_id) => {
            setHistoryStationId(station_id);
            setActiveTab('history');
            loadTrainingHistory();
          },
        })}
      />

      {/* AI 引擎能力一览 */}
      <div className="pt-4 border-t border-gray-100">
        <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <ApiOutlined className="text-gray-600" />
          AI 引擎能力一览
          <Tooltip title="仅作能力展示。只有 LSTM 时序预测支持训练，其余引擎为规则/图算法类服务，无训练概念。">
            <InfoCircleOutlined className="text-gray-400 text-sm" />
          </Tooltip>
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {ENGINE_REGISTRY.map((engine) => (
            <div key={engine.id} className="p-3 bg-gray-50 rounded-lg border border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                <div
                  className={`w-9 h-9 rounded-lg bg-gradient-to-br ${engine.gradient} flex items-center justify-center flex-shrink-0`}
                >
                  {engine.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <h5 className="text-xs font-semibold text-gray-900 truncate">{engine.name}</h5>
                  <p className="text-[11px] text-gray-500 truncate">{engine.type}</p>
                </div>
              </div>
              <p className="text-[11px] text-gray-600 mb-2 line-clamp-2 min-h-[32px]">
                {engine.description}
              </p>
              <div className="flex flex-wrap gap-1">
                {engine.capabilities.map((c) => (
                  <Tag key={c} color="cyan" className="text-[11px] m-0 leading-4">
                    {c}
                  </Tag>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* API 模型清单（折叠在底部） */}
      {apiModels.length > 0 && (
        <div className="pt-4 border-t border-gray-100">
          <h4 className="text-sm font-semibold text-gray-700 mb-2">API 模型清单</h4>
          <div className="space-y-1">
            {apiModels.map((m, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded text-xs"
              >
                <div>
                  <span className="font-medium text-gray-900">{m.name || m.id}</span>
                  <span className="text-gray-500 ml-2">版本 {m.version || '-'}</span>
                </div>
                <Tag color={m.status === 'stopped' ? 'default' : 'green'}>
                  {m.status === 'stopped' ? '已停用' : m.status || '运行中'}
                </Tag>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderTasksTab = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <FieldTimeOutlined className="text-cyan-600" />
            训练任务流水
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            来源：<code>ai_agent_tasks</code> 表 · <code>task_type = training</code>。包含所有历史触发的训练任务（running / completed / failed）。
          </p>
        </div>
        <Space wrap>
          <Select
            placeholder="状态筛选"
            allowClear
            size="middle"
            value={taskStatusFilter || undefined}
            onChange={(v) => setTaskStatusFilter(v || '')}
            style={{ width: 140 }}
            options={[
              { value: 'running', label: '训练中' },
              { value: 'completed', label: '已完成' },
              { value: 'failed', label: '失败' },
              { value: 'pending', label: '排队中' },
            ]}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={loadTrainingTasks}
            loading={trainingTasksLoading}
          >
            刷新
          </Button>
          <Button
            type="primary"
            icon={<ExperimentOutlined />}
            onClick={() => openTrainModal()}
            className="bg-cyan-600 hover:bg-cyan-700"
          >
            发起新训练
          </Button>
        </Space>
      </div>
      <Table<TrainingTaskItem>
        rowKey="task_id"
        size="middle"
        dataSource={filteredTrainingTasks}
        loading={trainingTasksLoading}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        scroll={{ x: 1200 }}
        locale={{ emptyText: <Empty description="暂无训练任务。先在「站点模型绑定」Tab 发起训练。" /> }}
        columns={buildTrainingTaskColumns({
          onViewStation: (sid) => {
            setHistoryStationId(sid);
            setActiveTab('history');
            loadTrainingHistory();
          },
        })}
      />
    </div>
  );

  const renderHistoryTab = () => {
    const singleStation = !!historyStationId && filteredHistoryItems.length > 0;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <HistoryOutlined className="text-cyan-600" />
              版本历史
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              默认展示全部站点的训练记录（task_type=<code>training</code>），选中单一站点时额外绘制 Loss 趋势。
            </p>
          </div>
          <Space wrap>
            <Select
              allowClear
              showSearch
              placeholder="站点筛选（默认全部）"
              style={{ width: 260 }}
              value={historyStationId}
              onChange={(v) => setHistoryStationId(v)}
              filterOption={(input, option) =>
                (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())
              }
              options={stationOptions}
            />
            <Input.Search
              placeholder="搜索站点/任务ID/指标"
              allowClear
              style={{ width: 240 }}
              value={historySearchKey}
              onChange={(e) => setHistorySearchKey(e.target.value)}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => loadTrainingHistory()}
              loading={historyLoading}
            >
              刷新
            </Button>
          </Space>
        </div>

        {singleStation && (
          <GlassCard className="p-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Loss 趋势（单站点）</h4>
            <ReactECharts option={historyLossOption} style={{ height: 280 }} />
          </GlassCard>
        )}

        <Table<TrainingTaskItem>
          rowKey="task_id"
          size="middle"
          dataSource={filteredHistoryItems}
          loading={historyLoading}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          scroll={{ x: 1300 }}
          locale={{
            emptyText: (
              <Empty
                description={
                  historyItems.length === 0
                    ? '暂无训练历史。请先在「站点模型绑定」Tab 发起训练。'
                    : '当前筛选条件下没有记录，请调整站点或关键词。'
                }
              />
            ),
          }}
          columns={buildHistoryColumns()}
        />
      </div>
    );
  };

  const renderEvalTab = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <BarChartOutlined className="text-cyan-600" />
            模型评估
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            评估逻辑：拉取站点最近 N 小时历史 → LSTM AutoEncoder 滑窗重构 → 统计每个时刻的 <strong>重构误差</strong> 及分布。
          </p>
          <p className="text-xs text-amber-600 mt-1">
            ⚠️ 仅「已训练」站点可评估，下拉已按训练状态分组，未训练站点置灰不可选。若无可用站点，请先到「站点模型绑定」Tab 发起训练。
          </p>
        </div>
        <Space wrap>
          <Select
            showSearch
            placeholder="选择站点（可搜索）"
            style={{ width: 280 }}
            value={evalStationId}
            onChange={setEvalStationId}
            filterOption={(input, option: any) =>
              (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())
            }
            options={evalStationOptions}
            notFoundContent={<span className="text-xs text-gray-400">暂无匹配站点</span>}
          />
          <Select
            placeholder="选择指标"
            style={{ width: 180 }}
            value={evalMetric}
            onChange={setEvalMetric}
            options={METRIC_OPTIONS}
          />
          <InputNumber
            min={1}
            max={168}
            value={evalHours}
            onChange={(v) => setEvalHours(Number(v) || 24)}
            addonAfter="小时"
            style={{ width: 140 }}
          />
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={runEvaluation}
            loading={evalLoading}
            className="bg-cyan-600 hover:bg-cyan-700"
          >
            运行评估
          </Button>
        </Space>
      </div>

      {/* 指标卡 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatTile
          title="平均重构误差"
          value={evalStats ? evalStats.mean_error.toFixed(4) : '-'}
          color="text-blue-600"
          icon={<BarChartOutlined className="text-xl text-blue-500" />}
        />
        <StatTile
          title="P95 重构误差"
          value={evalStats ? evalStats.p95_error.toFixed(4) : '-'}
          color="text-purple-600"
          icon={<LineChartOutlined className="text-xl text-purple-500" />}
        />
        <StatTile
          title="最大误差"
          value={evalStats ? evalStats.max_error.toFixed(4) : '-'}
          color="text-rose-600"
          icon={<ApiOutlined className="text-xl text-rose-500" />}
        />
        <StatTile
          title={`异常点次${evalStats ? ` (>${evalStats.anomaly_threshold.toFixed(3)})` : ''}`}
          value={evalStats ? `${evalStats.anomaly_count}` : '-'}
          color="text-amber-600"
          icon={<ExclamationCircleOutlined className="text-xl text-amber-500" />}
        />
        <StatTile
          title="有效样本数"
          value={evalStats ? `${evalStats.sample_count} 点` : '-'}
          color="text-green-600"
          icon={<CheckCircleOutlined className="text-xl text-green-500" />}
        />
      </div>

      {/* 图表 */}
      <GlassCard className="p-4">
        {evalSeries.length === 0 ? (
          <Empty description="选择站点与指标后，点击「运行评估」" />
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-gray-700">实际值 vs LSTM 重构值 + 重构误差</h4>
              {evalMetricsTrained.length > 0 && (
                <span className="text-xs text-gray-500">
                  该模型训练指标：
                  <span className="text-gray-700 font-medium ml-1">{evalMetricsTrained.join(', ')}</span>
                </span>
              )}
            </div>
            {evalWindowInfo && evalWindowInfo.used !== evalWindowInfo.requested && (
              <Alert
                type="warning"
                showIcon
                className="mb-3"
                message={`已自动扩窗：用户请求 ${evalWindowInfo.requested}h 样本不足，系统拉伸到 ${evalWindowInfo.used}h`}
                description={`拉取尝试：${evalWindowInfo.attempts.map((a) => `${a.hours}h→${a.rows}行`).join('  /  ')}`}
              />
            )}
            <ReactECharts option={evalChartOption} style={{ height: 420 }} />
            <Alert
              type="info"
              showIcon
              className="mt-3"
              message="读图说明"
              description={
                <span className="text-xs text-gray-600">
                  上图：橙色实线 = 实际观测值，青色虚线 = LSTM AE 重构值，两线贴合度越高说明模型对该站点行为拟合越好。下图：紫色柱状 = 绝对重构误差，红色虚线 = 异常阈值 (均值 + 2×标准差)，超阈点计入「异常点次」。
                </span>
              }
            />
          </>
        )}
      </GlassCard>

      {/* 智能分析卡片 */}
      {evalAnalysis && evalSeries.length > 0 && (
        <GlassCard className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
            <h4 className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <ExperimentOutlined className="text-cyan-600" />
              智能分析
            </h4>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">综合评分</span>
              <div className="w-40 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    evalAnalysis.quality === 'excellent'
                      ? 'bg-green-500'
                      : evalAnalysis.quality === 'good'
                      ? 'bg-blue-500'
                      : evalAnalysis.quality === 'fair'
                      ? 'bg-amber-500'
                      : 'bg-rose-500'
                  }`}
                  style={{ width: `${Math.max(5, Math.min(100, evalAnalysis.quality_score))}%` }}
                />
              </div>
              <span
                className={`text-lg font-bold ${
                  evalAnalysis.quality === 'excellent'
                    ? 'text-green-600'
                    : evalAnalysis.quality === 'good'
                    ? 'text-blue-600'
                    : evalAnalysis.quality === 'fair'
                    ? 'text-amber-600'
                    : 'text-rose-600'
                }`}
              >
                {evalAnalysis.quality_score}
                <span className="text-xs text-gray-400 font-normal"> / 100</span>
              </span>
            </div>
          </div>

          {/* 4 个彩色 Tag 维度 */}
          <div className="flex flex-wrap gap-2 mb-3">
            <Tag
              color={
                evalAnalysis.quality === 'excellent'
                  ? 'success'
                  : evalAnalysis.quality === 'good'
                  ? 'blue'
                  : evalAnalysis.quality === 'fair'
                  ? 'gold'
                  : 'error'
              }
            >
              拟合质量：{evalAnalysis.quality_label}
            </Tag>
            <Tag
              color={
                evalAnalysis.stability === 'stable'
                  ? 'success'
                  : evalAnalysis.stability === 'moderate'
                  ? 'gold'
                  : 'error'
              }
            >
              误差分布：{evalAnalysis.stability_label}（P95/均值={evalAnalysis.spike_ratio}）
            </Tag>
            <Tag
              color={
                evalAnalysis.bias === 'balanced'
                  ? 'success'
                  : evalAnalysis.bias === 'higher'
                  ? 'error'
                  : 'blue'
              }
            >
              偏离方向：{evalAnalysis.bias_label}
              {evalAnalysis.bias !== 'balanced'
                ? ` (${evalAnalysis.bias_pct > 0 ? '+' : ''}${(evalAnalysis.bias_pct * 100).toFixed(2)}%)`
                : ''}
            </Tag>
            <Tag
              color={
                evalAnalysis.anomaly_ratio > 0.1
                  ? 'error'
                  : evalAnalysis.anomaly_ratio > 0.05
                  ? 'gold'
                  : 'success'
              }
            >
              异常占比：{(evalAnalysis.anomaly_ratio * 100).toFixed(2)}%
            </Tag>
            <Tag color="default">相对误差：{(evalAnalysis.rel_error * 100).toFixed(2)}%</Tag>
          </div>

          {/* 结论文案 */}
          <div className="bg-gradient-to-r from-cyan-50 to-blue-50 border-l-4 border-cyan-400 p-3 rounded mb-3">
            <p className="text-sm text-gray-700 leading-relaxed m-0">
              <span className="text-cyan-600 font-semibold mr-1">结论·</span>
              {evalAnalysis.conclusion}
            </p>
          </div>

          {/* 异常时段 + 建议双栏 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 异常时段 */}
            <div>
              <h5 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1">
                <ExclamationCircleOutlined className="text-rose-500" />
                重点异常时段 (Top 3)
              </h5>
              {evalAnalysis.worst_segments.length === 0 ? (
                <div className="text-xs text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded">
                  未检出连续异常窗口
                </div>
              ) : (
                <div className="space-y-2">
                  {evalAnalysis.worst_segments.map((seg, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between bg-rose-50 border border-rose-100 rounded px-3 py-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-gray-800 font-medium truncate">
                          {String(seg.start).slice(5, 16).replace('T', ' ')} →{' '}
                          {String(seg.end).slice(5, 16).replace('T', ' ')}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">连续 {seg.count} 个超阈点</div>
                      </div>
                      <div className="ml-3 text-right">
                        <div className="text-xs text-gray-400">峰值误差</div>
                        <div className="text-sm font-bold text-rose-600">{seg.peak_error}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 建议 */}
            <div>
              <h5 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1">
                <InfoCircleOutlined className="text-cyan-500" />
                运维建议
              </h5>
              <ul className="space-y-2 m-0 p-0 list-none">
                {evalAnalysis.suggestions.map((s, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-2 bg-cyan-50 border border-cyan-100 rounded px-3 py-2"
                  >
                    <CheckCircleOutlined className="text-cyan-500 mt-0.5 flex-shrink-0" />
                    <span className="text-xs text-gray-700 leading-relaxed">{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </GlassCard>
      )}
    </div>
  );

  // ====== 主渲染 ======
  return (
    <div className="space-y-6">
      {/* 顶部说明 */}
      <Alert
        type="info"
        showIcon
        icon={<InfoCircleOutlined />}
        message="站点级 LSTM 模型全生命周期管理"
        description={
          <span className="text-xs text-gray-600">
            4 个 Tab 覆盖「绑定 → 训练 → 版本 → 评估」闭环：Tab 1 一键发起训练，Tab 2 查看训练任务流水，Tab 3 按站点看历史版本 Loss 曲线，Tab 4 基于 LSTM AutoEncoder 重构历史数据 → 计算每时刻重构误差 + 异常点统计。
          </span>
        }
      />

      {/* 统计条 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatTile
          title="站点总数"
          value={stats.total}
          color="text-gray-800"
          icon={<ClusterOutlined className="text-xl text-gray-400" />}
        />
        <StatTile
          title="已绑定模型"
          value={stats.active}
          color="text-green-600"
          icon={<CheckCircleOutlined className="text-xl text-green-500" />}
        />
        <StatTile
          title="训练中/排队"
          value={stats.running}
          color="text-blue-600"
          icon={<ClockCircleOutlined className="text-xl text-blue-500" />}
        />
        <StatTile
          title="训练失败"
          value={stats.failed}
          color="text-red-500"
          icon={<CloseCircleOutlined className="text-xl text-red-400" />}
        />
        <StatTile
          title="未训练"
          value={stats.untrained}
          color="text-gray-500"
          icon={<ExperimentOutlined className="text-xl text-gray-400" />}
        />
      </div>

      {/* 4-Tab 主容器 */}
      <GlassCard className="p-5">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'binding',
              label: (
                <span>
                  <ExperimentOutlined /> 站点模型绑定
                </span>
              ),
              children: renderBindingTab(),
            },
            {
              key: 'tasks',
              label: (
                <span>
                  <FieldTimeOutlined /> 训练任务流水
                </span>
              ),
              children: renderTasksTab(),
            },
            {
              key: 'history',
              label: (
                <span>
                  <HistoryOutlined /> 版本历史
                </span>
              ),
              children: renderHistoryTab(),
            },
            {
              key: 'eval',
              label: (
                <span>
                  <BarChartOutlined /> 模型评估
                </span>
              ),
              children: renderEvalTab(),
            },
          ]}
        />
      </GlassCard>

      {/* 训练弹窗 */}
      <Modal
        title="训练站点模型（一站一模型）"
        open={trainModalOpen}
        onOk={handleTrainSubmit}
        onCancel={() => setTrainModalOpen(false)}
        confirmLoading={trainLoading}
        okText="提交训练"
        cancelText="取消"
        width={560}
      >
        <Alert
          type="info"
          showIcon
          className="mb-4"
          message="训练粒度：一站一模型（多指标联合建模）"
          description={
            <span className="text-xs text-gray-600">
              每个站点训练一个 <strong>多变量 LSTM 自编码器</strong>，输入维度 = 所选指标个数。模型文件命名为{' '}
              <code className="mx-1">{'{station_id}_station_lstm.pt'}</code>。
              <br />
              指标留空时，后端会自动拉取 <code>station_metrics</code> 中 <code>is_enabled=true</code> 的指标；
              <strong className="text-amber-600">若该站未配置启用指标，请在下方手动多选。</strong>
            </span>
          }
        />
        <Form form={form} layout="vertical">
          <Form.Item name="station_id" label="训练站点" rules={[{ required: true, message: '请选择站点' }]}>
            <Select
              placeholder="选择站点（一站一模型）"
              options={stationOptions}
              showSearch
              filterOption={(input, option) =>
                (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item
            name="metrics"
            label="训练指标（可多选，留空=全部）"
            tooltip="指标作为模型输入通道。留空即自动拉取该站 station_metrics 中全部启用指标。"
          >
            <Select
              mode="multiple"
              allowClear
              placeholder="留空 = 自动拉取该站全部启用指标"
              maxTagCount="responsive"
              options={METRIC_OPTIONS}
            />
          </Form.Item>
          <div className="grid grid-cols-2 gap-3">
            <Form.Item name="epochs" label="训练轮数" initialValue={50}>
              <InputNumber min={10} max={200} className="w-full" />
            </Form.Item>
            <Form.Item
              name="lookback_days"
              label="历史数据回望（天）"
              initialValue={30}
              tooltip="从 TDengine 拉近 N 天数据用于训练；不足时自动回落合成数据"
            >
              <InputNumber min={1} max={365} className="w-full" />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}

// ============ 子组件：StatTile ============
function StatTile({
  title,
  value,
  color,
  icon,
}: {
  title: string;
  value: React.ReactNode;
  color: string;
  icon?: React.ReactNode;
}) {
  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-3">
        {icon}
        <div className="min-w-0">
          <p className="text-xs text-gray-500 truncate">{title}</p>
          <p className={`text-lg font-semibold truncate ${color}`}>{value}</p>
        </div>
      </div>
    </GlassCard>
  );
}

// ============ 工具：站点模型绑定表列 ============
function buildStationBindingColumns(args: {
  onTrain: (station_id: string, metrics: string[]) => void;
  onViewHistory: (station_id: string) => void;
}): ColumnsType<StationModelBinding> {
  const { onTrain, onViewHistory } = args;
  const statusColor: Record<string, string> = {
    active: 'green',
    training: 'blue',
    pending: 'gold',
    failed: 'red',
    untrained: 'default',
  };
  const statusLabel: Record<string, string> = {
    active: '已绑定',
    training: '训练中',
    pending: '排队中',
    failed: '失败',
    untrained: '未训练',
  };
  return [
    {
      title: '站点',
      dataIndex: 'station_name',
      key: 'station',
      width: 220,
      fixed: 'left' as const,
      render: (_: any, row) => (
        <div>
          <div className="font-medium text-gray-900">{row.station_name || row.station_id}</div>
          <div className="text-xs text-gray-400 font-mono">{row.station_id}</div>
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (status: string | undefined, row) => {
        const s = status || 'untrained';
        return (
          <Tooltip title={row.error || ''}>
            <Tag color={statusColor[s] || 'default'}>{statusLabel[s] || s}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '覆盖指标',
      dataIndex: 'metrics',
      key: 'metrics',
      render: (metrics: string[]) => (
        <div className="flex flex-wrap gap-1">
          {(metrics || []).map((m) => (
            <Tag key={m} color="blue">
              {m}
            </Tag>
          ))}
          {(!metrics || metrics.length === 0) && <span className="text-xs text-gray-400">-</span>}
        </div>
      ),
    },
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      width: 70,
      render: (v?: number | null) => (v ? `v${v}` : '-'),
    },
    {
      title: 'Loss',
      dataIndex: 'final_loss',
      key: 'final_loss',
      width: 90,
      render: (v?: number | null) => (v != null ? v.toFixed(4) : '-'),
    },
    {
      title: '样本 / 来源',
      key: 'samples',
      width: 130,
      render: (_: any, row) => (
        <div className="text-xs">
          <div>{row.samples ?? '-'} 条</div>
          <div className="text-gray-400">{row.data_source || '-'}</div>
        </div>
      ),
    },
    {
      title: '上次训练',
      dataIndex: 'trained_at',
      key: 'trained_at',
      width: 160,
      render: (v?: string | null) => (v ? new Date(v).toLocaleString('zh-CN') : '-'),
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      fixed: 'right' as const,
      render: (_: any, row) => {
        const s = row.status || 'untrained';
        const isActive = s === 'active';
        const isRunning = s === 'training' || s === 'pending';
        return (
          <Space size="small">
            <Button
              size="small"
              type={isActive ? 'default' : 'primary'}
              icon={<ExperimentOutlined />}
              disabled={isRunning}
              onClick={() => onTrain(row.station_id, row.metrics || [])}
              className={isActive ? '' : 'bg-cyan-600 hover:bg-cyan-700'}
            >
              {isRunning ? '进行中' : isActive ? '重训' : '训练'}
            </Button>
            <Tooltip title="查看版本历史">
              <Button
                size="small"
                icon={<HistoryOutlined />}
                onClick={() => onViewHistory(row.station_id)}
              />
            </Tooltip>
          </Space>
        );
      },
    },
  ];
}

// ============ 工具：训练任务流水表列 ============
function buildTrainingTaskColumns(args: {
  onViewStation: (stationId: string) => void;
}): ColumnsType<TrainingTaskItem> {
  const { onViewStation } = args;
  return [
    {
      title: '任务 ID',
      dataIndex: 'task_id',
      key: 'task_id',
      width: 220,
      fixed: 'left' as const,
      render: (v: string) => <code className="text-xs text-gray-600">{v}</code>,
    },
    {
      title: '站点',
      dataIndex: 'station_id',
      key: 'station_id',
      width: 160,
      render: (v: string | undefined, row) => {
        const sid = v || row.payload?.station_id;
        if (!sid) return <span className="text-gray-400">-</span>;
        return (
          <Button type="link" size="small" className="p-0" onClick={() => onViewStation(sid)}>
            {row.payload?.station_name || sid}
          </Button>
        );
      },
    },
    {
      title: '指标',
      key: 'metrics',
      width: 180,
      render: (_: any, row) => {
        const metrics = row.payload?.metrics as string[] | undefined;
        if (!metrics || metrics.length === 0) return <span className="text-xs text-gray-400">全部</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {metrics.slice(0, 3).map((m) => (
              <Tag key={m} color="blue" className="text-xs">
                {m}
              </Tag>
            ))}
            {metrics.length > 3 && <Tag className="text-xs">+{metrics.length - 3}</Tag>}
          </div>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: string, row) => (
        <Tooltip title={row.error || ''}>
          <Tag color={TASK_STATUS_COLOR[s] || 'default'}>{TASK_STATUS_LABEL[s] || s}</Tag>
        </Tooltip>
      ),
    },
    {
      title: 'Epochs',
      key: 'epochs',
      width: 80,
      render: (_: any, row) => row.payload?.epochs ?? '-',
    },
    {
      title: 'Final Loss',
      key: 'final_loss',
      width: 100,
      render: (_: any, row) => {
        const v = row.result?.final_loss;
        return v != null ? Number(v).toFixed(4) : '-';
      },
    },
    {
      title: '开始时间',
      dataIndex: 'started_at',
      key: 'started_at',
      width: 160,
      render: (v?: string) => (v ? new Date(v).toLocaleString('zh-CN') : '-'),
    },
    {
      title: '耗时',
      key: 'duration',
      width: 90,
      render: (_: any, row) => durationText(row.started_at, row.completed_at),
    },
  ];
}

// ============ 工具：版本历史表列 ============
function buildHistoryColumns(): ColumnsType<TrainingTaskItem> {
  return [
    {
      title: '站点',
      key: 'station',
      width: 180,
      render: (_: any, row) => {
        const sid = row.station_id || row.payload?.station_id;
        const name = row.payload?.station_name;
        return (
          <div className="flex flex-col">
            <span className="text-sm text-gray-800">{name || sid || '-'}</span>
            {name && sid && <span className="text-xs text-gray-400">{sid}</span>}
          </div>
        );
      },
    },
    {
      title: '版本',
      key: 'version',
      width: 90,
      render: (_: any, row) => {
        const v = row.result?.version;
        return v ? <Tag color="cyan">v{v}</Tag> : <span className="text-gray-400">-</span>;
      },
    },
    {
      title: '训练时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
      render: (v?: string) => (v ? new Date(v).toLocaleString('zh-CN') : '-'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: string, row) => (
        <Tooltip title={row.error || ''}>
          <Tag color={TASK_STATUS_COLOR[s] || 'default'}>{TASK_STATUS_LABEL[s] || s}</Tag>
        </Tooltip>
      ),
    },
    {
      title: 'Epochs',
      key: 'epochs',
      width: 80,
      render: (_: any, row) => row.payload?.epochs ?? '-',
    },
    {
      title: 'Final Loss',
      key: 'final_loss',
      width: 100,
      render: (_: any, row) => {
        const v = row.result?.final_loss;
        return v != null ? Number(v).toFixed(4) : '-';
      },
    },
    {
      title: '样本',
      key: 'samples',
      width: 90,
      render: (_: any, row) => row.result?.samples ?? '-',
    },
    {
      title: '数据源',
      key: 'data_source',
      width: 110,
      render: (_: any, row) => row.result?.data_source ?? '-',
    },
    {
      title: '耗时',
      key: 'duration',
      width: 90,
      render: (_: any, row) => durationText(row.started_at, row.completed_at),
    },
    {
      title: '错误',
      key: 'error',
      ellipsis: true,
      render: (_: any, row) => (row.error ? <span className="text-xs text-red-500">{row.error}</span> : '-'),
    },
  ];
}

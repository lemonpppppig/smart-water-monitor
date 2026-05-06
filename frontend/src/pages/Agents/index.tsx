import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  RobotOutlined,
  ThunderboltOutlined,
  ApartmentOutlined,
  BookOutlined,
  ReloadOutlined,
  SendOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  ExclamationCircleOutlined,
  DashboardOutlined,
  SettingOutlined,
  UnorderedListOutlined,
  FileTextOutlined,
  LockOutlined,
  InfoCircleOutlined,
  StopOutlined,
  RedoOutlined,
  DeleteOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  Button, Tag, Select, Form, Modal, Drawer, message, Empty, Spin,
  Segmented, Tabs, Table, Alert, Tooltip, Input, Progress, Popconfirm, Space,
} from 'antd';
import { ReasoningCard } from '../../components/ReasoningCard';
import { aiApi, stationApi, modelApi } from '../../services/api';

/**
 * 智能体运维中心
 * 页面定位：仅做"运行状态 / 配置查看 / 任务流水 / 运行日志"四件事，
 *         不承担业务分析入口（业务触发统一从 预警智能分析工作台 进入）。
 * 业务提交弹窗保留为 Tab 3 右上角「测试提交」，仅供运维自测。
 *
 * 后端约束（已核对）：
 *  - GET /api/v1/ai/agents/status 仅返回聚合计数（system_mode / active_agents /
 *    total_agents / pending_tasks / running_tasks / active_alerts）——
 *    不下发 per-agent 明细
 *  - 无运行时配置写接口 → Config Tab 只读
 *  - 无流式日志接口 → Logs Tab 由 listTasks 事件反推
 */

type TabKey = 'overview' | 'config' | 'tasks' | 'logs';

interface AgentCard {
  key: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  taskType: string;
  mode: 'async' | 'sync';
  /** 默认配置（只读展示） */
  config: {
    maxConcurrency: number;
    timeoutSec: number;
    retries: number;
    queueCap: number;
  };
}

const AGENT_CATALOG: AgentCard[] = [
  {
    key: 'anomaly_detection',
    name: '异常检测',
    description: '基于 LSTM 与阈值规则识别水质指标异常，输出置信度评估',
    icon: <ThunderboltOutlined />,
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    taskType: 'anomaly_detection',
    mode: 'async',
    config: { maxConcurrency: 4, timeoutSec: 30, retries: 2, queueCap: 100 },
  },
  {
    key: 'source_tracing',
    name: '污染溯源',
    description: '基于河网图谱定位上游可疑污染源并还原传播路径',
    icon: <ApartmentOutlined />,
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    taskType: 'source_tracing',
    mode: 'async',
    config: { maxConcurrency: 2, timeoutSec: 45, retries: 1, queueCap: 50 },
  },
  {
    key: 'knowledge_reasoning',
    name: '知识推理',
    description: '识别污染类型并匹配相似历史案例与应急预案',
    icon: <BookOutlined />,
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    taskType: 'knowledge_reasoning',
    mode: 'sync',
    config: { maxConcurrency: 8, timeoutSec: 15, retries: 0, queueCap: 200 },
  },
  {
    key: 'comprehensive_analysis',
    name: '综合分析',
    description: '编排多个智能体完成 异常→识别→溯源→预案 的完整决策链',
    icon: <RobotOutlined />,
    iconBg: 'bg-indigo-50',
    iconColor: 'text-indigo-600',
    taskType: 'comprehensive_analysis',
    mode: 'sync',
    config: { maxConcurrency: 2, timeoutSec: 60, retries: 1, queueCap: 30 },
  },
];

interface TaskItem {
  task_id: string;
  task_type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | string;
  created_at: string;
  completed_at?: string | null;
  started_at?: string | null;
  result?: any;
  payload?: any;
  mode?: 'async' | 'sync' | string;
  error?: string | null;
  assigned_to?: string | null;
  priority?: number;
}

interface StationOption {
  id: string;
  station_name: string;
  station_code: string;
}

interface LogEntry {
  ts: string;
  level: 'info' | 'warn' | 'error';
  agent: string;
  task_id: string;
  message: string;
}

export default function Agents() {
  const [systemStatus, setSystemStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [stations, setStations] = useState<StationOption[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  // 测试提交弹窗（仅 Tab 3 使用）
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [targetAgent, setTargetAgent] = useState<AgentCard | null>(null);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  // 任务流水筛选
  const [taskStatusFilter, setTaskStatusFilter] = useState<string>('all');
  const [taskTypeFilter, setTaskTypeFilter] = useState<string>('all');
  const [taskSearch, setTaskSearch] = useState<string>('');
  const [selectedTaskIds, setSelectedTaskIds] = useState<React.Key[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);

  // 任务详情抽屉
  const [detailTask, setDetailTask] = useState<TaskItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // 日志筛选
  const [logLevelFilter, setLogLevelFilter] = useState<string>('all');
  const [logAgentFilter, setLogAgentFilter] = useState<string>('all');

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await aiApi.getSystemStatus();
      setSystemStatus(res);
    } catch (err) {
      console.warn('getSystemStatus failed', err);
      setSystemStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStations = useCallback(async () => {
    try {
      const res: any = await stationApi.getStations({ limit: 1000 });
      const items = res?.items ?? res?.data?.items ?? [];
      setStations(items);
    } catch {
      setStations([]);
    }
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const res: any = await aiApi.listTasks({ limit: 100 });
      const items: TaskItem[] = res?.items ?? res?.data?.items ?? [];
      setTasks(items);
    } catch (err) {
      console.warn('listTasks failed', err);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchStations();
    fetchTasks();
    const timer = setInterval(() => {
      fetchStatus();
      fetchTasks();
    }, 5000);
    return () => clearInterval(timer);
  }, [fetchStatus, fetchStations, fetchTasks]);

  /** 从任务历史反推每个 agent 最近一次活动，用来显示"近似在线状态" */
  const getAgentRuntime = (key: string) => {
    const myTasks = tasks.filter((t) => t.task_type === key);
    const running = myTasks.find((t) => t.status === 'running' || t.status === 'pending');
    const last = myTasks[0];
    const recentFail = myTasks.slice(0, 5).filter((t) => t.status === 'failed').length;
    return {
      running: !!running,
      lastAt: last?.created_at,
      recentFail,
      total: myTasks.length,
    };
  };

  const openSubmit = (agent: AgentCard) => {
    setTargetAgent(agent);
    form.resetFields();
    setSubmitModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (!targetAgent) return;
      setSubmitting(true);
      const station = stations.find((s) => s.id === values.station_id);

      if (targetAgent.mode === 'sync') {
        setSubmitModalOpen(false);
        message.loading({ content: '正在分析…', key: 'sync-analyze', duration: 0 });
        try {
          if (targetAgent.taskType === 'knowledge_reasoning') {
            await aiApi.identifyPollution({
              station_id: values.station_id,
              station_code: station?.station_code,
              metrics: { [values.indicator]: null },
            });
          } else {
            await aiApi.analyzeComprehensive({
              data: {
                station_id: values.station_id,
                station_code: station?.station_code,
                indicator: values.indicator,
              },
            });
          }
          message.success({ content: '分析完成', key: 'sync-analyze' });
          await fetchTasks();
        } catch (e: any) {
          message.error({ content: '分析失败：' + (e?.message || '后端不可用'), key: 'sync-analyze' });
          await fetchTasks();
        }
        return;
      }

      await aiApi.submitTask({
        task_type: targetAgent.taskType,
        payload: {
          station_id: values.station_id,
          station_code: station?.station_code,
          indicator: values.indicator,
        },
        priority: values.priority ?? 1,
      });
      message.success('测试任务已提交');
      setSubmitModalOpen(false);
      await fetchTasks();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error('提交失败：' + (err?.message || '后端不可用'));
    } finally {
      setSubmitting(false);
    }
  };

  const openDetail = (t: TaskItem) => {
    setDetailTask(t);
    setDetailOpen(true);
  };

  /** 取消 / 删除一条任务（后端无专用 cancel 接口，统一用 DELETE） */
  const handleCancelTask = async (t: TaskItem) => {
    try {
      await modelApi.deleteAgentTask(t.task_id);
      message.success(t.status === 'completed' || t.status === 'failed' ? '已删除' : '已取消');
      await fetchTasks();
    } catch (e: any) {
      message.error('操作失败：' + (e?.message || '后端不可用'));
    }
  };

  /** 重试任务：读原始 payload 重新 submitTask；同步任务重试需调对应 REST */
  const handleRetryTask = async (t: TaskItem) => {
    try {
      if (t.mode === 'sync') {
        message.loading({ content: '正在重试…', key: 'retry', duration: 0 });
        if (t.task_type === 'knowledge_reasoning') {
          await aiApi.identifyPollution(t.payload || {});
        } else if (t.task_type === 'comprehensive_analysis') {
          await aiApi.analyzeComprehensive({ data: t.payload || {} });
        } else {
          await aiApi.submitTask({ task_type: t.task_type, payload: t.payload || {}, priority: t.priority ?? 1 });
        }
        message.success({ content: '重试已完成', key: 'retry' });
      } else {
        await aiApi.submitTask({ task_type: t.task_type, payload: t.payload || {}, priority: t.priority ?? 1 });
        message.success('已重新入队');
      }
      await fetchTasks();
    } catch (e: any) {
      message.error('重试失败：' + (e?.message || '后端不可用'));
    }
  };

  /** 批量删除选中 */
  const handleBatchDelete = async () => {
    if (selectedTaskIds.length === 0) return;
    setBatchLoading(true);
    try {
      await modelApi.batchDeleteAgentTasks(selectedTaskIds as string[]);
      message.success(`已删除 ${selectedTaskIds.length} 条`);
      setSelectedTaskIds([]);
      await fetchTasks();
    } catch (e: any) {
      message.error('批量删除失败：' + (e?.message || '后端不可用'));
    } finally {
      setBatchLoading(false);
    }
  };

  /** 一键清理已完成 / 失败 */
  const handleCleanFinished = async (targetStatus: 'completed' | 'failed' | 'both') => {
    const ids = tasks
      .filter((t) => targetStatus === 'both' ? (t.status === 'completed' || t.status === 'failed') : t.status === targetStatus)
      .map((t) => t.task_id);
    if (ids.length === 0) {
      message.info('无可清理的任务');
      return;
    }
    setBatchLoading(true);
    try {
      await modelApi.batchDeleteAgentTasks(ids);
      message.success(`已清理 ${ids.length} 条`);
      setSelectedTaskIds([]);
      await fetchTasks();
    } catch (e: any) {
      message.error('清理失败：' + (e?.message || '后端不可用'));
    } finally {
      setBatchLoading(false);
    }
  };

  // 聚合统计
  const activeAgents = systemStatus?.active_agents ?? systemStatus?.data?.active_agents ?? 0;
  const totalAgents = systemStatus?.total_agents ?? systemStatus?.data?.total_agents ?? AGENT_CATALOG.length;
  const pendingCount = systemStatus?.pending_tasks ?? tasks.filter((t) => t.status === 'pending').length;
  const runningCount = systemStatus?.running_tasks ?? tasks.filter((t) => t.status === 'running').length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const systemMode = systemStatus?.system_mode ?? systemStatus?.data?.system_mode;
  const modeText = systemMode === 'alert' ? '预警态' : systemMode === 'normal' ? '正常' : loading ? '检测中' : '不可用';
  const modeColor = systemMode === 'alert' ? 'red' : systemMode === 'normal' ? 'green' : 'default';

  /** 任务事件反推日志流（每个任务最多产出 3 条：created / started / finished） */
  const logEntries = useMemo<LogEntry[]>(() => {
    const list: LogEntry[] = [];
    for (const t of tasks) {
      list.push({
        ts: t.created_at,
        level: 'info',
        agent: t.task_type,
        task_id: t.task_id,
        message: `任务创建 (${t.mode || 'async'}, priority=${t.priority ?? '-'})`,
      });
      if (t.started_at) {
        list.push({
          ts: t.started_at,
          level: 'info',
          agent: t.task_type,
          task_id: t.task_id,
          message: `任务开始执行${t.assigned_to ? `，分配给 ${t.assigned_to}` : ''}`,
        });
      }
      if (t.status === 'completed' && t.completed_at) {
        list.push({
          ts: t.completed_at,
          level: 'info',
          agent: t.task_type,
          task_id: t.task_id,
          message: '任务完成',
        });
      }
      if (t.status === 'failed') {
        list.push({
          ts: t.completed_at || t.created_at,
          level: 'error',
          agent: t.task_type,
          task_id: t.task_id,
          message: `任务失败：${t.error || '未知错误'}`,
        });
      }
    }
    list.sort((a, b) => (a.ts < b.ts ? 1 : -1));
    return list;
  }, [tasks]);

  const filteredLogs = logEntries.filter((l) => {
    if (logLevelFilter !== 'all' && l.level !== logLevelFilter) return false;
    if (logAgentFilter !== 'all' && l.agent !== logAgentFilter) return false;
    return true;
  });

  const filteredTasks = tasks.filter((t) => {
    if (taskStatusFilter !== 'all') {
      if (taskStatusFilter === 'running') {
        if (!(t.status === 'pending' || t.status === 'running' || t.status === 'submitted')) return false;
      } else if (t.status !== taskStatusFilter) return false;
    }
    if (taskTypeFilter !== 'all' && t.task_type !== taskTypeFilter) return false;
    if (taskSearch && !t.task_id.includes(taskSearch)) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      {/* 页面头 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">智能体运维中心</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            只做运行状态 / 配置查看 / 队列健康 / 运行日志，业务分析请前往「预警智能分析」
          </p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => { fetchStatus(); fetchTasks(); }}>刷新</Button>
      </div>

      {/* 顶部聚合统计（跨 Tab 常驻） */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: '在线智能体', value: `${activeAgents} / ${totalAgents}` },
          { label: '排队任务', value: pendingCount },
          { label: '进行中', value: runningCount },
          { label: '已完成', value: completedCount },
          { label: '系统模式', value: <Tag color={modeColor} className="m-0">{modeText}</Tag> },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-slate-200 rounded-md px-4 py-3">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className="text-xl font-semibold text-slate-900 mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as TabKey)}
        items={[
          { key: 'overview', label: <span><DashboardOutlined /> 运行状态</span>, children: renderOverview() },
          { key: 'config', label: <span><SettingOutlined /> 配置管理</span>, children: renderConfig() },
          { key: 'tasks', label: <span><UnorderedListOutlined /> 任务队列</span>, children: renderTasks() },
          { key: 'logs', label: <span><FileTextOutlined /> 运行日志</span>, children: renderLogs() },
        ]}
      />

      {/* 测试提交弹窗 */}
      <Modal
        title={targetAgent ? `测试提交：${targetAgent.name}` : '测试提交'}
        open={submitModalOpen}
        onCancel={() => setSubmitModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={submitting}
        okText="提交"
        cancelText="取消"
      >
        <Alert
          type="warning"
          showIcon
          className="mb-3"
          message="仅供运维自测"
          description="日常业务触发请从「预警智能分析」工作台进入。此处提交的任务上下文不完整，结果仅用于验证链路是否可用。"
        />
        <Form form={form} layout="vertical">
          <Form.Item name="station_id" label="目标站点" rules={[{ required: true, message: '请选择站点' }]}>
            <Select
              showSearch
              placeholder="选择要分析的监测站点"
              optionFilterProp="label"
              options={stations.map((s) => ({ value: s.id, label: `${s.station_code} · ${s.station_name}` }))}
              notFoundContent={<Spin size="small" />}
            />
          </Form.Item>
          <Form.Item name="indicator" label="监测指标" initialValue="pH">
            <Select
              options={[
                { value: 'pH', label: 'pH 值' },
                { value: 'do', label: '溶解氧 (DO)' },
                { value: 'cod', label: 'COD' },
                { value: 'nh3n', label: '氨氮' },
                { value: 'tp', label: '总磷' },
                { value: 'tn', label: '总氮' },
              ]}
            />
          </Form.Item>
          <Form.Item name="priority" label="优先级" initialValue={1}>
            <Select
              options={[
                { value: 0, label: '低' },
                { value: 1, label: '正常' },
                { value: 2, label: '高' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 任务详情抽屉 */}
      <Drawer
        title={detailTask ? `${taskTypeLabel(detailTask.task_type)} · ${detailTask.task_id}` : '任务详情'}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={540}
      >
        {detailTask && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <InfoBlock label="状态">
                <Tag color={taskStatusColor(detailTask.status)} className="m-0">{taskStatusLabel(detailTask.status)}</Tag>
              </InfoBlock>
              <InfoBlock label="模式">{detailTask.mode === 'sync' ? '同步' : '异步'}</InfoBlock>
              <InfoBlock label="任务类型">{taskTypeLabel(detailTask.task_type)}</InfoBlock>
              <InfoBlock label="优先级">{detailTask.priority ?? '-'}</InfoBlock>
              <InfoBlock label="创建时间">{detailTask.created_at ? new Date(detailTask.created_at).toLocaleString('zh-CN') : '-'}</InfoBlock>
              <InfoBlock label="完成时间">{detailTask.completed_at ? new Date(detailTask.completed_at).toLocaleString('zh-CN') : '-'}</InfoBlock>
              <InfoBlock label="分配给">{detailTask.assigned_to || '-'}</InfoBlock>
            </div>

            {detailTask.payload && (
              <div>
                <p className="text-xs text-slate-500 mb-1">任务载荷</p>
                <pre className="bg-slate-50 border border-slate-200 rounded p-3 text-xs text-slate-700 overflow-auto max-h-40">
{JSON.stringify(detailTask.payload, null, 2)}
                </pre>
              </div>
            )}

            {detailTask.error && (
              <div>
                <p className="text-xs text-slate-500 mb-1">错误信息</p>
                <pre className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700 overflow-auto max-h-40">
{detailTask.error}
                </pre>
              </div>
            )}

            <div>
              <p className="text-xs text-slate-500 mb-1">分析结果</p>
              {detailTask.result ? (
                <div className="space-y-3">
                  <TaskResultReasoning task={detailTask} />
                  <details className="text-xs">
                    <summary className="cursor-pointer text-slate-500 hover:text-slate-700">查看完整 JSON</summary>
                    <pre className="mt-2 bg-slate-50 border border-slate-200 rounded p-3 text-xs text-slate-700 overflow-auto max-h-96">
{JSON.stringify(detailTask.result, null, 2)}
                    </pre>
                  </details>
                </div>
              ) : (
                <div className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded p-3">
                  {detailTask.status === 'completed' ? '结果为空' : '任务尚未完成，等待后台生成结果…'}
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );

  // ==================== Tab 1：运行状态 ====================
  function renderOverview() {
    return (
      <div className="space-y-5">
        <div>
          <h3 className="text-sm font-medium text-slate-700 mb-3">核心智能体</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {AGENT_CATALOG.map((agent) => {
              const rt = getAgentRuntime(agent.key);
              const online = activeAgents > 0 || tasks.length > 0; // 保守估计
              const statusLabel = !online ? '不可用' : rt.running ? '忙碌' : '空闲';
              const statusColor = !online ? 'bg-slate-300' : rt.running ? 'bg-blue-500' : 'bg-emerald-500';
              return (
                <div
                  key={agent.key}
                  className="bg-white border border-slate-200 rounded-md p-4 flex flex-col hover:border-slate-300 transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-9 h-9 rounded-md ${agent.iconBg} ${agent.iconColor} flex items-center justify-center text-lg`}>
                      {agent.icon}
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                      <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
                      {statusLabel}
                    </span>
                  </div>
                  <h4 className="text-sm font-medium text-slate-900">{agent.name}</h4>
                  <p className="text-xs text-slate-500 mt-1 mb-3 flex-1 leading-relaxed">{agent.description}</p>
                  <div className="grid grid-cols-3 text-[11px] pt-3 border-t border-slate-100">
                    <div>
                      <p className="text-slate-400">累计</p>
                      <p className="text-slate-900 font-medium mt-0.5">{rt.total}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">近5次失败</p>
                      <p className={`font-medium mt-0.5 ${rt.recentFail > 0 ? 'text-red-600' : 'text-slate-900'}`}>{rt.recentFail}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">模式</p>
                      <p className="text-slate-900 font-medium mt-0.5">{agent.mode === 'sync' ? '同步' : '异步'}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 决策链路 */}
        <div>
          <h3 className="text-sm font-medium text-slate-700 mb-3">决策链路</h3>
          <div className="bg-white border border-slate-200 rounded-md p-5">
            <div className="flex flex-wrap items-center">
              {[
                { n: 1, title: '异常检测', desc: '捕获指标偏离' },
                { n: 2, title: '污染识别', desc: '定位污染类型' },
                { n: 3, title: '上游溯源', desc: '追溯潜在污染源' },
                { n: 4, title: '预案推荐', desc: '匹配应急方案' },
              ].map((step, i, arr) => (
                <div key={step.n} className="flex items-center flex-1 min-w-[160px]">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 text-xs flex items-center justify-center font-medium">
                      {step.n}
                    </div>
                    <div>
                      <p className="text-sm text-slate-900">{step.title}</p>
                      <p className="text-xs text-slate-400">{step.desc}</p>
                    </div>
                  </div>
                  {i < arr.length - 1 && <div className="flex-1 border-t border-dashed border-slate-200 mx-3" />}
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-4">
              综合分析智能体按顺序编排其他智能体，每步结果落到预警详情与分析报告中。此处仅为流程示意，业务触发请前往「预警智能分析」。
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ==================== Tab 2：配置管理 ====================
  function renderConfig() {
    return (
      <div className="space-y-3">
        <Alert
          type="info"
          showIcon
          icon={<LockOutlined />}
          message="当前版本为只读配置"
          description="后端尚未开放运行时配置写接口，以下为系统默认参数。如需修改，请联系后端在 coordinator 配置文件中调整后重启服务。"
        />
        <div className="bg-white border border-slate-200 rounded-md">
          <Table
            rowKey="key"
            size="middle"
            pagination={false}
            dataSource={AGENT_CATALOG}
            columns={[
              {
                title: '智能体',
                dataIndex: 'name',
                render: (_: any, r: AgentCard) => (
                  <div className="flex items-center gap-2">
                    <span className={`w-7 h-7 rounded ${r.iconBg} ${r.iconColor} inline-flex items-center justify-center`}>{r.icon}</span>
                    <div>
                      <p className="text-sm text-slate-900 m-0">{r.name}</p>
                      <p className="text-xs text-slate-400 m-0 font-mono">{r.key}</p>
                    </div>
                  </div>
                ),
              },
              { title: '模式', dataIndex: 'mode', width: 80, render: (v) => v === 'sync' ? <Tag>同步</Tag> : <Tag color="blue">异步</Tag> },
              { title: '最大并发', dataIndex: ['config', 'maxConcurrency'], width: 100, align: 'right' as const },
              { title: '超时 (s)', dataIndex: ['config', 'timeoutSec'], width: 100, align: 'right' as const },
              { title: '重试次数', dataIndex: ['config', 'retries'], width: 100, align: 'right' as const },
              { title: '队列容量', dataIndex: ['config', 'queueCap'], width: 100, align: 'right' as const },
              {
                title: '能力描述',
                dataIndex: 'description',
                render: (v) => <span className="text-xs text-slate-500">{v}</span>,
              },
              {
                title: '操作',
                width: 100,
                render: () => (
                  <Tooltip title="运行时配置写接口暂未开放">
                    <Button size="small" disabled icon={<SettingOutlined />}>编辑</Button>
                  </Tooltip>
                ),
              },
            ]}
          />
        </div>

        {/* 全局调度器参数 */}
        <div className="bg-white border border-slate-200 rounded-md p-4">
          <h4 className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-1.5">
            <InfoCircleOutlined /> 调度器参数
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <KV k="轮询间隔" v="5s" />
            <KV k="任务默认优先级" v="1（正常）" />
            <KV k="任务历史保留" v="100 条" />
            <KV k="LLM 客户端" v="未启用" tip="当前项目未接入 LLM，智能体使用规则+模型推理" />
          </div>
        </div>
      </div>
    );
  }

  // ==================== Tab 3：任务队列健康视图 ====================
  function renderTasks() {
    // 按 agent 分组聚合聚阶（只统计 pending，作为"队列堆积"；running 不算堆积）
    const agentBacklog = AGENT_CATALOG.map((a) => {
      const pending = tasks.filter((t) => t.task_type === a.taskType && (t.status === 'pending' || t.status === 'submitted')).length;
      const running = tasks.filter((t) => t.task_type === a.taskType && t.status === 'running').length;
      const usage = Math.min(100, Math.round(((pending + running) / Math.max(1, a.config.queueCap)) * 100));
      return { ...a, pending, running, usage };
    });
    const totalPending = agentBacklog.reduce((s, a) => s + a.pending, 0);
    const totalRunning = agentBacklog.reduce((s, a) => s + a.running, 0);
    const totalCap = AGENT_CATALOG.reduce((s, a) => s + a.config.queueCap, 0);
    const globalUsage = Math.min(100, Math.round(((totalPending + totalRunning) / Math.max(1, totalCap)) * 100));
    const BACKLOG_WARN = 10;
    const BACKLOG_CRITICAL = 30;
    const backlogLevel: 'ok' | 'warn' | 'critical' = totalPending >= BACKLOG_CRITICAL ? 'critical' : totalPending >= BACKLOG_WARN ? 'warn' : 'ok';

    const completedCnt = tasks.filter((t) => t.status === 'completed').length;
    const failedCnt = tasks.filter((t) => t.status === 'failed').length;

    return (
      <div className="space-y-3">
        {/* 健康条 */}
        <div className="bg-white border border-slate-200 rounded-md p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h4 className="text-sm font-medium text-slate-700 m-0">队列健康度</h4>
              <p className="text-xs text-slate-400 mt-0.5">
                排队 {totalPending} · 运行中 {totalRunning} · 总容量 {totalCap}
              </p>
            </div>
            <Tag color={backlogLevel === 'critical' ? 'red' : backlogLevel === 'warn' ? 'orange' : 'green'} className="m-0">
              {backlogLevel === 'critical' ? '严重堆积' : backlogLevel === 'warn' ? '堆积告警' : '健康'}
            </Tag>
          </div>
          <Progress
            percent={globalUsage}
            strokeColor={globalUsage >= 80 ? '#dc2626' : globalUsage >= 50 ? '#f59e0b' : '#10b981'}
            showInfo
            format={(p) => `${p}%`}
          />
          {backlogLevel !== 'ok' && (
            <Alert
              type={backlogLevel === 'critical' ? 'error' : 'warning'}
              showIcon
              icon={<WarningOutlined />}
              className="mt-3"
              message={backlogLevel === 'critical' ? `任务队列已堆积 ${totalPending} 条排队任务` : `队列出现堆积，当前排队 ${totalPending} 条`}
              description="建议先清理无效任务或为对应智能体扩容并发。运行中的任务取消会强制丢弃结果。"
            />
          )}
          {/* 每 agent 堆积网格 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            {agentBacklog.map((a) => (
              <div key={a.key} className="border border-slate-200 rounded-md px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-600 font-medium">{a.name}</span>
                  <span className="text-[11px] text-slate-400">{a.pending + a.running}/{a.config.queueCap}</span>
                </div>
                <Progress
                  percent={a.usage}
                  showInfo={false}
                  size="small"
                  strokeColor={a.usage >= 80 ? '#dc2626' : a.usage >= 50 ? '#f59e0b' : '#10b981'}
                  className="mt-1"
                />
                <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                  <span>排队 {a.pending}</span>
                  <span>· 运行 {a.running}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 筛选 + 操作 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="small"
              value={taskStatusFilter}
              onChange={(v) => setTaskStatusFilter(v as string)}
              options={[
                { label: '全部', value: 'all' },
                { label: '进行中', value: 'running' },
                { label: '已完成', value: 'completed' },
                { label: '失败', value: 'failed' },
              ]}
            />
            <Select
              size="small"
              value={taskTypeFilter}
              onChange={setTaskTypeFilter}
              style={{ width: 160 }}
              options={(() => {
                const known = new Set(AGENT_CATALOG.map((a) => a.taskType));
                const extra = Array.from(new Set(tasks.map((t) => t.task_type))).filter((k) => !known.has(k));
                return [
                  { value: 'all', label: '全部类型' },
                  ...AGENT_CATALOG.map((a) => ({ value: a.taskType, label: a.name })),
                  ...extra.map((k) => ({ value: k, label: taskTypeLabel(k) })),
                ];
              })()}
            />
            <Input.Search
              size="small"
              allowClear
              placeholder="搜索 task_id"
              value={taskSearch}
              onChange={(e) => setTaskSearch(e.target.value)}
              style={{ width: 200 }}
            />
          </div>
          <Space size={8}>
            <Button size="small" icon={<ReloadOutlined />} onClick={fetchTasks}>刷新</Button>
            <Popconfirm
              title={`确认删除选中的 ${selectedTaskIds.length} 条任务？`}
              disabled={selectedTaskIds.length === 0}
              onConfirm={handleBatchDelete}
              okButtonProps={{ danger: true, loading: batchLoading }}
            >
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={selectedTaskIds.length === 0}
              >
                删除选中 ({selectedTaskIds.length})
              </Button>
            </Popconfirm>
            <Popconfirm
              title={`确认清理已完成 (${completedCnt}) + 失败 (${failedCnt}) 共 ${completedCnt + failedCnt} 条？`}
              disabled={completedCnt + failedCnt === 0}
              onConfirm={() => handleCleanFinished('both')}
              okButtonProps={{ loading: batchLoading }}
            >
              <Button
                size="small"
                icon={<DeleteOutlined />}
                disabled={completedCnt + failedCnt === 0}
              >
                清理历史
              </Button>
            </Popconfirm>
            <Tooltip title="仅供运维自测使用，不会推送到业务处置流程">
              <Button
                size="small"
                icon={<SendOutlined />}
                onClick={() => openSubmit(AGENT_CATALOG[0])}
              >
                测试提交
              </Button>
            </Tooltip>
          </Space>
        </div>

        {/* 任务表格 */}
        <Table<TaskItem>
          rowKey="task_id"
          size="middle"
          dataSource={filteredTasks}
          pagination={{ pageSize: 15, size: 'small', showSizeChanger: false }}
          rowSelection={{
            selectedRowKeys: selectedTaskIds,
            onChange: (keys) => setSelectedTaskIds(keys),
          }}
          columns={[
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (_: any, t) => (
                <div className="flex items-center gap-1.5">
                  <TaskStatusIcon status={t.status} />
                  <Tag color={taskStatusColor(t.status)} className="m-0">{taskStatusLabel(t.status)}</Tag>
                </div>
              ),
            },
            {
              title: '任务',
              render: (_: any, t) => (
                <div className="min-w-0">
                  <p className="text-sm text-slate-900 m-0 truncate">
                    {taskTypeLabel(t.task_type)}
                    {t.mode === 'sync' && (
                      <span className="ml-2 text-[10px] text-slate-400 border border-slate-200 rounded px-1 py-0.5">同步</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400 font-mono m-0 truncate">{t.task_id}</p>
                </div>
              ),
            },
            {
              title: '目标站点',
              width: 200,
              render: (_: any, t) => {
                const p = t.payload || {};
                const sid = p.station_id || p.data?.station_id;
                const code = p.station_code || p.data?.station_code;
                const metric = p.metric || p.indicator || p.data?.metric || p.data?.indicator;
                if (!sid && !code && !metric) return <span className="text-xs text-slate-400">-</span>;
                return (
                  <div className="min-w-0">
                    <p className="text-xs text-slate-700 m-0 truncate font-mono">{code || sid || '-'}</p>
                    {metric && <p className="text-[11px] text-slate-400 m-0">指标 {metric}</p>}
                  </div>
                );
              },
            },
            {
              title: '优先级',
              dataIndex: 'priority',
              width: 80,
              render: (v) => v === 2 ? <Tag color="red">高</Tag> : v === 0 ? <Tag>低</Tag> : <Tag color="blue">正常</Tag>,
            },
            {
              title: '创建时间',
              dataIndex: 'created_at',
              width: 170,
              render: (v) => v ? <span className="text-xs text-slate-500">{new Date(v).toLocaleString('zh-CN')}</span> : '-',
            },
            {
              title: '耗时',
              width: 90,
              render: (_: any, t) => {
                if (!t.started_at && !t.completed_at) return <span className="text-xs text-slate-400">-</span>;
                const s = new Date(t.started_at || t.created_at).getTime();
                const e = t.completed_at ? new Date(t.completed_at).getTime() : Date.now();
                const sec = Math.max(0, Math.round((e - s) / 1000));
                return <span className="text-xs text-slate-500">{sec}s</span>;
              },
            },
            {
              title: '操作',
              width: 180,
              fixed: 'right' as const,
              render: (_: any, t) => {
                const isRunning = t.status === 'pending' || t.status === 'running' || t.status === 'submitted';
                const isFinished = t.status === 'completed' || t.status === 'failed';
                return (
                  <Space size={4}>
                    <Button size="small" type="link" onClick={() => openDetail(t)}>详情</Button>
                    {isRunning && (
                      <Popconfirm
                        title="确认取消此任务？"
                        description={t.status === 'running' ? '运行中的任务将被强制丢弃结果' : undefined}
                        onConfirm={() => handleCancelTask(t)}
                      >
                        <Button size="small" type="link" danger icon={<StopOutlined />}>取消</Button>
                      </Popconfirm>
                    )}
                    {isFinished && (
                      <>
                        <Button size="small" type="link" icon={<RedoOutlined />} onClick={() => handleRetryTask(t)}>重试</Button>
                        <Popconfirm title="确认删除此记录？" onConfirm={() => handleCancelTask(t)}>
                          <Button size="small" type="link" danger icon={<DeleteOutlined />}>删除</Button>
                        </Popconfirm>
                      </>
                    )}
                  </Space>
                );
              },
            },
          ]}
          locale={{ emptyText: <Empty description="暂无任务记录" /> }}
        />
      </div>
    );
  }

  // ==================== Tab 4：运行日志 ====================
  function renderLogs() {
    return (
      <div className="space-y-3">
        <Alert
          type="info"
          showIcon
          message="日志由任务事件反推生成"
          description="后端暂未提供流式日志接口，当前展示基于最近 100 条任务的生命周期事件（创建 / 开始 / 完成 / 失败）。"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size="small"
            value={logLevelFilter}
            onChange={(v) => setLogLevelFilter(v as string)}
            options={[
              { label: '全部', value: 'all' },
              { label: 'INFO', value: 'info' },
              { label: 'WARN', value: 'warn' },
              { label: 'ERROR', value: 'error' },
            ]}
          />
          <Select
            size="small"
            value={logAgentFilter}
            onChange={setLogAgentFilter}
            style={{ width: 160 }}
            options={[
              { value: 'all', label: '全部智能体' },
              ...AGENT_CATALOG.map((a) => ({ value: a.taskType, label: a.name })),
            ]}
          />
          <span className="text-xs text-slate-400">共 {filteredLogs.length} 条</span>
        </div>
        <div className="bg-slate-950 text-slate-100 rounded-md font-mono text-xs max-h-[560px] overflow-auto">
          {filteredLogs.length === 0 ? (
            <div className="p-10"><Empty description={<span className="text-slate-400">暂无日志</span>} /></div>
          ) : (
            <div>
              {filteredLogs.map((l, idx) => (
                <div
                  key={idx}
                  className="px-4 py-1.5 border-b border-slate-800 hover:bg-slate-900 cursor-pointer flex gap-3"
                  onClick={() => {
                    const t = tasks.find((x) => x.task_id === l.task_id);
                    if (t) openDetail(t);
                  }}
                >
                  <span className="text-slate-500 shrink-0">{new Date(l.ts).toLocaleString('zh-CN')}</span>
                  <span className={`shrink-0 w-12 ${logLevelColor(l.level)}`}>[{l.level.toUpperCase()}]</span>
                  <span className="text-sky-300 shrink-0">{taskTypeLabel(l.agent)}</span>
                  <span className="text-slate-400 shrink-0 font-mono">{l.task_id.slice(0, 8)}</span>
                  <span className="text-slate-100 truncate">{l.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
}

// ==================== 复用子组件 ====================
function TaskStatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircleOutlined className="text-emerald-500 text-lg" />;
  if (status === 'failed') return <ExclamationCircleOutlined className="text-red-500 text-lg" />;
  if (status === 'running' || status === 'pending' || status === 'submitted')
    return <LoadingOutlined className="text-blue-500 text-lg" spin />;
  return <ClockCircleOutlined className="text-slate-400 text-lg" />;
}

function taskStatusColor(status: string) {
  if (status === 'completed') return 'green';
  if (status === 'failed') return 'red';
  if (status === 'running' || status === 'pending' || status === 'submitted') return 'blue';
  return 'default';
}

function taskStatusLabel(status: string) {
  const map: Record<string, string> = {
    pending: '待处理',
    submitted: '已提交',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
  };
  return map[status] || status;
}

function taskTypeLabel(taskType: string) {
  const map: Record<string, string> = {
    anomaly_detection: '异常检测',
    source_tracing: '污染溯源',
    knowledge_reasoning: '知识推理',
    comprehensive_analysis: '综合分析',
    risk_prediction: '风险预测',
    spread_analysis: '扩散分析',
  };
  return map[taskType] || taskType;
}

function logLevelColor(level: string) {
  if (level === 'error') return 'text-red-400';
  if (level === 'warn') return 'text-amber-400';
  return 'text-emerald-400';
}

function InfoBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <div className="text-sm text-slate-900 mt-0.5">{children}</div>
    </div>
  );
}

function KV({ k, v, tip }: { k: string; v: React.ReactNode; tip?: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500 flex items-center gap-1">
        {k}
        {tip && <Tooltip title={tip}><InfoCircleOutlined className="text-slate-400" /></Tooltip>}
      </p>
      <p className="text-slate-900 mt-0.5">{v}</p>
    </div>
  );
}

/**
 * 任务结果的双输出渲染：根据 task_type 分发到不同的推理卡片配置
 */
function TaskResultReasoning({ task }: { task: any }) {
  const result = task?.result || {};
  const human: string | undefined = result.human;
  const machine: Record<string, any> | undefined = result.machine;

  if (!human && !machine) {
    return (
      <pre className="bg-slate-50 border border-slate-200 rounded p-3 text-xs text-slate-700 overflow-auto max-h-96">
        {JSON.stringify(result, null, 2)}
      </pre>
    );
  }

  const taskType = task?.task_type;
  let title = '智能体推理链';
  let machineKeys: {
    key: string;
    label: string;
    color?: boolean;
    formatter?: (v: any) => string;
  }[] = [];

  if (taskType === 'anomaly_detection') {
    title = '异常研判';
    machineKeys = [
      { key: 'severity', label: '严重度', color: true },
      { key: 'action', label: '推荐动作' },
    ];
  } else if (taskType === 'source_tracing') {
    title = '多假设推理';
    machineKeys = [
      { key: 'source', label: '判定源头' },
      { key: 'confidence', label: '置信度', formatter: (v) => (v != null ? `${Math.round(Number(v) * 100)}%` : '-') },
      { key: 'alert', label: '是否预警下游', formatter: (v) => (v ? '是' : '否') },
    ];
  } else {
    title = '综合研判';
    machineKeys = [
      { key: 'priority', label: '优先级', color: true },
      { key: 'level', label: '等级' },
      { key: 'dept', label: '责任部门' },
      { key: 'response_time', label: '响应时限' },
    ];
  }

  return <ReasoningCard title={title} human={human} machine={machine} machineKeys={machineKeys} />;
}

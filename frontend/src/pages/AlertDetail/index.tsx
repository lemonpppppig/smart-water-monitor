import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftOutlined,
  AlertOutlined,
  EnvironmentOutlined,
  ExclamationCircleOutlined,
  RobotOutlined,
  BranchesOutlined,
  BulbOutlined,
  FileTextOutlined,
  ReloadOutlined,
  SendOutlined,
  LoadingOutlined,
  NodeIndexOutlined,
  WarningOutlined,
  SafetyOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  Button,
  Tag,
  Timeline,
  Descriptions,
  Tabs,
  Progress,
  Steps,
  Card,
  Statistic,
  message,
  Empty,
  Spin,
} from 'antd';
import ReactECharts from 'echarts-for-react';
import { GlassCard } from '../../components/GlassCard';
import { ReasoningCard } from '../../components/ReasoningCard';
import { alertApi, aiApi, dataApi, stationApi } from '../../services/api';

const { TabPane } = Tabs;

interface AlertDetailData {
  id: string;
  alert_code: string;
  station_id: string;
  alert_type: string;
  alert_level: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description?: string;
  metrics?: Record<string, any>;
  pollution_type?: string;
  source_analysis?: Record<string, any>;
  status: 'pending' | 'confirmed' | 'processing' | 'resolved';
  confirmed_by?: string;
  confirmed_at?: string;
  resolved_by?: string;
  resolved_at?: string;
  resolution_notes?: string;
  created_at: string;
  updated_at: string;
}

interface AIAnalysisResult {
  pollutionType?: { type: string; confidence: number };
  possibleCauses?: Array<{ cause: string; probability: number }>;
  riskLevel?: string;
  riskScore?: number;
  affectedArea?: string;
}

interface TraceResult {
  sourceStation?: { id: string; name: string; distance?: string; time?: string } | null;
  pollutionSources?: Array<{ name: string; type: string; distance: string; risk: string }>;
  flowPath?: string[];
}

interface Recommendation {
  step: number;
  title: string;
  description: string;
  status: 'done' | 'doing' | 'pending';
  responsible?: string;
}

const levelConfig: Record<string, { text: string; color: string }> = {
  critical: { text: '紧急', color: 'red' },
  high: { text: '高级', color: 'orange' },
  medium: { text: '中级', color: 'gold' },
  low: { text: '低级', color: 'green' },
};

const statusConfig: Record<string, { text: string; color: string }> = {
  pending: { text: '待处理', color: 'red' },
  confirmed: { text: '已确认', color: 'orange' },
  processing: { text: '处理中', color: 'blue' },
  resolved: { text: '已解决', color: 'green' },
};

function formatTime(s?: string) {
  if (!s) return '-';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { hour12: false });
}

function pickIndicator(a: AlertDetailData): { name: string; value: number | null } {
  if (a.metrics && typeof a.metrics === 'object') {
    const entries = Object.entries(a.metrics);
    for (const [k, v] of entries) {
      if (typeof v === 'number') return { name: k, value: v };
      if (v && typeof v === 'object' && typeof (v as any).value === 'number') {
        return { name: k, value: (v as any).value };
      }
    }
    if (entries.length > 0) return { name: entries[0][0], value: null };
  }
  return { name: a.alert_type || '-', value: null };
}

export default function AlertDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [alert, setAlert] = useState<AlertDetailData | null>(null);
  const [stationInfo, setStationInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [aiAnalysis, setAIAnalysis] = useState<AIAnalysisResult | null>(null);
  const [traceResult, setTraceResult] = useState<TraceResult | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  // 智能体双输出原始推理文本与决策字段（PPT Part 2/3/4 "人看+机器看"）
  const [aiReasoning, setAIReasoning] = useState<{
    anomaly?: { human?: string | null; machine?: Record<string, any> | null };
    pollution?: { human?: string | null; machine?: Record<string, any> | null };
    trace?: { human?: string | null; machine?: Record<string, any> | null };
  }>({});
  const [trendSeries, setTrendSeries] = useState<{ times: string[]; values: number[] }>({
    times: [],
    values: [],
  });

  const indicator = alert ? pickIndicator(alert) : { name: '-', value: null };

  const loadDetail = async (withAnalysis = true) => {
    if (!id) return;
    setLoading(true);
    try {
      const res: any = await alertApi.getAlert(id);
      const data = (res?.data || res) as AlertDetailData;
      setAlert(data);

      // 并行拉站点信息 + 历史数据
      const stationId = data.station_id;
      if (stationId) {
        stationApi
          .getStation(stationId)
          .then((r: any) => setStationInfo(r?.data || r))
          .catch(() => setStationInfo(null));

        dataApi
          .getHistoryData(stationId, { hours: 8, limit: 16 })
          .then((r: any) => {
            const rows = (r?.data || r?.items || r) as any[];
            if (!Array.isArray(rows)) return;
            const ind = pickIndicator(data);
            const times: string[] = [];
            const values: number[] = [];
            rows.forEach((row) => {
              const t = row.timestamp || row.time || row.created_at;
              const vSrc = ind.name && row[ind.name] !== undefined ? row[ind.name] : row.value;
              if (t !== undefined && typeof vSrc === 'number') {
                const d = new Date(t);
                times.push(Number.isNaN(d.getTime()) ? String(t) : d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
                values.push(vSrc);
              }
            });
            setTrendSeries({ times, values });
          })
          .catch(() => setTrendSeries({ times: [], values: [] }));
      }

      if (withAnalysis) {
        runAIAnalysis(data);
      }
    } catch (err) {
      console.error('加载预警详情失败', err);
      message.error('加载预警详情失败');
      setAlert(null);
    } finally {
      setLoading(false);
    }
  };

  const runAIAnalysis = async (data: AlertDetailData): Promise<boolean> => {
    setAnalyzing(true);
    let successCount = 0;
    try {
      // Step A: 先拿异常+溯源（并行）——Part 2 和 Part 3 相互独立
      const primaryMetric = pickIndicator(data);
      const primaryValue = primaryMetric.value;
      const historySeries =
        typeof primaryValue === 'number' ? [primaryValue] : [0];

      const [anomalyRes, traceRes] = await Promise.all([
        aiApi
          .detectAnomaly({
            station_id: data.station_id,
            metric: primaryMetric.name || 'nh3_n',
            data: historySeries,
          })
          .catch(() => null),
        aiApi
          .traceSource({
            station_id: data.station_id,
            alert_id: data.id,
            pollution_type: data.pollution_type,
          })
          .catch(() => null),
      ]);

      const a: any = (anomalyRes as any)?.data || anomalyRes;
      const t: any = (traceRes as any)?.data || traceRes;
      if (anomalyRes) successCount++;
      if (traceRes) successCount++;

      // Step B: 污染识别 + 扩散分析（携带上文并行）
      const topSource = (t?.sources || [])[0];
      const source_info = topSource
        ? {
            station_name: topSource.station_name,
            distance: topSource.distance,
            confidence: topSource.confidence,
          }
        : null;
      const anomalies_payload = a?.anomalies || null;

      const [pollutionRes, spreadRes] = await Promise.all([
        aiApi
          .identifyPollution({
            station_id: data.station_id,
            metrics: data.metrics || {},
            alert_level: data.alert_level,
            anomalies: anomalies_payload,
            source_info,
          })
          .catch(() => null),
        aiApi
          .analyzeSpread({
            station_id: data.station_id,
            pollution_type: data.pollution_type,
          })
          .catch(() => null),
      ]);

      if (pollutionRes) successCount++;
      if (spreadRes) successCount++;

      const p: any = (pollutionRes as any)?.data || pollutionRes;
      const s: any = (spreadRes as any)?.data || spreadRes;

      const pollutionType =
        p?.pollution_type || p?.type
          ? { type: p.pollution_type || p.type, confidence: Math.round((p.confidence || p.probability || 0) * (p.confidence > 1 ? 1 : 100)) }
          : data.pollution_type
            ? { type: data.pollution_type, confidence: 80 }
            : undefined;

      setAIAnalysis({
        pollutionType,
        possibleCauses: p?.possible_causes || p?.causes || [],
        riskLevel: s?.risk_level || p?.risk_level,
        riskScore: s?.risk_score ?? p?.risk_score,
        affectedArea: s?.affected_area || s?.affected_range,
      });

      if (t) {
        setTraceResult({
          sourceStation: t.source_station
            ? {
                id: t.source_station.id,
                name: t.source_station.name,
                distance: t.source_station.distance,
                time: t.source_station.transit_time || t.source_station.time,
              }
            : null,
          pollutionSources: t.pollution_sources || t.sources || [],
          flowPath: t.flow_path || t.path || [],
        });
      }

      // 保存智能体双输出原始字段，供 Tab 中直接渲染
      setAIReasoning({
        anomaly: a ? { human: a.human, machine: a.machine } : undefined,
        pollution: p ? { human: p.human, machine: p.machine } : undefined,
        trace: t ? { human: t.human, machine: t.machine } : undefined,
      });

      // 处置建议
      const ptype = pollutionType?.type || data.pollution_type;
      if (ptype) {
        try {
          const planRes: any = await aiApi.getEmergencyPlan(ptype);
          const plan = planRes?.data || planRes;
          // 后端 EmergencyPlanResponse = {actions: string[], departments: string[]}
          const steps = plan?.steps || plan?.recommendations || plan?.actions || [];
          const depts = plan?.departments || [];
          setRecommendations(
            (steps as any[]).map((s, i) => {
              if (typeof s === 'string') {
                return {
                  step: i + 1,
                  title: s,
                  description: '',
                  status: (i === 0 ? 'doing' : 'pending') as any,
                  responsible: depts[i],
                };
              }
              return {
                step: i + 1,
                title: s.title || s.name || s.action || `步骤 ${i + 1}`,
                description: s.description || s.detail || '',
                status: (s.status || (i === 0 ? 'doing' : 'pending')) as any,
                responsible: s.responsible || s.owner || s.department || depts[i],
              };
            }),
          );
        } catch {
          setRecommendations([]);
        }
      }
    } catch (err) {
      console.error('AI 分析失败', err);
      return false;
    } finally {
      setAnalyzing(false);
    }
    return successCount > 0;
  };

  useEffect(() => {
    loadDetail(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleReanalyze = async () => {
    if (!alert) return;
    message.loading({ content: 'AI正在重新分析...', key: 'reanalyze', duration: 0 });
    const ok = await runAIAnalysis(alert);
    if (ok) {
      message.success({ content: '分析完成', key: 'reanalyze' });
    } else {
      message.error({ content: 'AI 分析失败，请检查 AI 服务是否可用', key: 'reanalyze' });
    }
  };

  // 注：确认/解决等状态推进已收敛到处置单详情页，本页只做历史、AI 分析查看与流转。

  const timeline = useMemo(() => {
    if (!alert) return [];
    const events: Array<{ time: string; event: string; status: string }> = [];
    events.push({
      time: formatTime(alert.created_at),
      event: '系统检测到异常，触发预警',
      status: alert.alert_level === 'critical' ? 'error' : 'warning',
    });
    if (alert.confirmed_at) {
      events.push({
        time: formatTime(alert.confirmed_at),
        event: `${alert.confirmed_by || '管理员'}确认预警，开始处理`,
        status: 'info',
      });
    }
    if (alert.resolved_at) {
      events.push({
        time: formatTime(alert.resolved_at),
        event: `${alert.resolved_by || '处理人员'}已处理完成`,
        status: 'success',
      });
    }
    return events;
  }, [alert]);

  if (loading || !alert) {
    return (
      <div className="flex items-center justify-center h-96">
        {loading ? (
          <LoadingOutlined className="text-4xl text-cyan-500" />
        ) : (
          <Empty description="未找到预警信息" />
        )}
      </div>
    );
  }

  const level = levelConfig[alert.alert_level] || levelConfig.low;
  const status = statusConfig[alert.status] || statusConfig.pending;

  // 阈值信息（从 metrics 中推断，若有）
  const thresholdMin = (alert.metrics as any)?.threshold_min ?? 0;
  const thresholdMax = (alert.metrics as any)?.threshold_max ?? (alert.metrics as any)?.threshold;
  const currentValue = indicator.value ?? (alert.metrics as any)?.value ?? null;
  const unit = (alert.metrics as any)?.unit || '';

  const trendOption = {
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: trendSeries.times,
      axisLine: { lineStyle: { color: '#e5e7eb' } },
      axisLabel: { color: '#6b7280' },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      splitLine: { lineStyle: { color: '#f3f4f6' } },
      axisLabel: { color: '#6b7280' },
    },
    series: [
      {
        data: trendSeries.values,
        type: 'line',
        smooth: true,
        lineStyle: { color: '#0891b2', width: 2 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(8, 145, 178, 0.3)' },
              { offset: 1, color: 'rgba(8, 145, 178, 0.05)' },
            ],
          },
        },
        markLine:
          thresholdMax !== undefined
            ? {
                silent: true,
                data: [
                  { yAxis: thresholdMax, lineStyle: { color: '#ef4444', type: 'dashed' }, label: { formatter: '上限' } },
                  ...(thresholdMin > 0
                    ? [
                        {
                          yAxis: thresholdMin,
                          lineStyle: { color: '#f59e0b', type: 'dashed' },
                          label: { formatter: '下限' },
                        },
                      ]
                    : []),
                ],
              }
            : undefined,
      },
    ],
    grid: { left: 10, right: 10, top: 20, bottom: 10, containLabel: true },
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/alerts')}>
            返回
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-gray-900">{alert.title}</h1>
              <Tag color={level.color}>{level.text}</Tag>
              <Tag color={status.color}>{status.text}</Tag>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {alert.alert_code} · {formatTime(alert.created_at)}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button icon={<ReloadOutlined />} onClick={handleReanalyze} loading={analyzing}>
            重新分析
          </Button>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={() => navigate(`/alerts/analysis/${alert.id}`)}
            className="bg-cyan-600 hover:bg-cyan-700"
          >
            进入智能分析
          </Button>
          {alert.status !== 'resolved' && (
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={() => navigate(`/disposal/${alert.id}`)}
              className="bg-green-600 hover:bg-green-700"
            >
              转入处置
            </Button>
          )}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <GlassCard className="p-5">
          <Statistic
            title="当前值"
            value={currentValue ?? '-'}
            suffix={unit}
            valueStyle={{
              color:
                currentValue != null && thresholdMax != null && currentValue > thresholdMax
                  ? '#ef4444'
                  : '#10b981',
            }}
            prefix={<AlertOutlined />}
          />
        </GlassCard>
        <GlassCard className="p-5">
          <Statistic
            title="阈值范围"
            value={thresholdMax !== undefined ? `${thresholdMin} - ${thresholdMax}` : '-'}
            suffix={unit}
            prefix={<SafetyOutlined />}
          />
        </GlassCard>
        <GlassCard className="p-5">
          <Statistic
            title="风险评分"
            value={aiAnalysis?.riskScore ?? '-'}
            suffix={aiAnalysis?.riskScore != null ? '/ 100' : ''}
            valueStyle={{
              color:
                (aiAnalysis?.riskScore ?? 0) > 70
                  ? '#ef4444'
                  : (aiAnalysis?.riskScore ?? 0) > 40
                    ? '#f59e0b'
                    : '#10b981',
            }}
            prefix={<ExclamationCircleOutlined />}
          />
        </GlassCard>
        <GlassCard className="p-5">
          <Statistic
            title="影响范围"
            value={aiAnalysis?.affectedArea || '-'}
            prefix={<EnvironmentOutlined />}
          />
        </GlassCard>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left: Details & Trend */}
        <div className="xl:col-span-2 space-y-6">
          <GlassCard className="p-6">
            <Tabs activeKey={activeTab} onChange={setActiveTab}>
              <TabPane tab="概览" key="overview">
                <div className="space-y-6">
                  {/* 基本信息 */}
                  <Descriptions column={2} size="small">
                    <Descriptions.Item label="监测站点">
                      {stationInfo?.name || alert.station_id}
                    </Descriptions.Item>
                    <Descriptions.Item label="位置">
                      {stationInfo?.location || stationInfo?.address || '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="监测指标">{indicator.name}</Descriptions.Item>
                    <Descriptions.Item label="触发时间">{formatTime(alert.created_at)}</Descriptions.Item>
                    <Descriptions.Item label="预警类型">{alert.alert_type}</Descriptions.Item>
                    <Descriptions.Item label="污染类型">
                      {alert.pollution_type || aiAnalysis?.pollutionType?.type || '-'}
                    </Descriptions.Item>
                  </Descriptions>

                  {/* 描述 */}
                  <div className="p-4 bg-gray-50 rounded-xl">
                    <p className="text-gray-700">{alert.description || '-'}</p>
                  </div>

                  {/* 数据趋势 */}
                  <div>
                    <h4 className="font-medium text-gray-900 mb-3">数据趋势</h4>
                    {trendSeries.times.length > 0 ? (
                      <ReactECharts option={trendOption} style={{ height: 200 }} />
                    ) : (
                      <Empty description="暂无历史趋势数据" />
                    )}
                  </div>
                </div>
              </TabPane>

              <TabPane
                tab={
                  <span>
                    <RobotOutlined className="mr-1" />
                    AI 分析
                  </span>
                }
                key="analysis"
              >
                <Spin spinning={analyzing}>
                  <div className="space-y-6">
                    {/* 智能体综合研判（Part 4 双输出）*/}
                    <ReasoningCard
                      title="智能体异常诊断"
                      icon={<ThunderboltOutlined className="text-orange-500" />}
                      human={aiReasoning.anomaly?.human}
                      machine={aiReasoning.anomaly?.machine}
                      machineKeys={[
                        { key: 'severity', label: '严重程度', color: true },
                        { key: 'action', label: '下一步动作' },
                      ]}
                    />

                    <ReasoningCard
                      title="智能体综合研判"
                      icon={<RobotOutlined className="text-cyan-500" />}
                      human={aiReasoning.pollution?.human}
                      machine={aiReasoning.pollution?.machine}
                      machineKeys={[
                        { key: 'priority', label: '优先级', color: true },
                        { key: 'level', label: '等级' },
                        { key: 'dept', label: '责任部门' },
                        { key: 'response_time', label: '响应时限' },
                      ]}
                    />

                    {aiAnalysis?.pollutionType ? (
                      <div className="p-4 bg-gradient-to-r from-cyan-50 to-blue-50 rounded-xl border border-cyan-100">
                        <div className="flex items-center gap-3 mb-3">
                          <RobotOutlined className="text-xl text-cyan-500" />
                          <h4 className="font-medium text-gray-900">污染类型识别</h4>
                        </div>
                        <div className="flex items-center gap-4">
                          <Tag color="cyan" className="text-base px-3 py-1">
                            {aiAnalysis.pollutionType.type}
                          </Tag>
                          <span className="text-gray-500">
                            置信度: {aiAnalysis.pollutionType.confidence}%
                          </span>
                        </div>
                      </div>
                    ) : (
                      <Empty description="暂无AI识别结果" />
                    )}

                    {aiAnalysis?.possibleCauses && aiAnalysis.possibleCauses.length > 0 && (
                      <div>
                        <h4 className="font-medium text-gray-900 mb-3">可能原因分析</h4>
                        <div className="space-y-3">
                          {aiAnalysis.possibleCauses.map((cause, idx) => (
                            <div key={idx} className="flex items-center gap-4">
                              <span className="text-gray-700 w-32">{cause.cause}</span>
                              <Progress
                                percent={cause.probability}
                                size="small"
                                strokeColor={cause.probability > 50 ? '#0891b2' : '#94a3b8'}
                                className="flex-1"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {(aiAnalysis?.riskLevel || aiAnalysis?.affectedArea) && (
                      <div>
                        <h4 className="font-medium text-gray-900 mb-3">风险评估</h4>
                        <div className="grid grid-cols-2 gap-4">
                          <Card size="small">
                            <Statistic
                              title="风险等级"
                              value={
                                aiAnalysis.riskLevel === 'high'
                                  ? '高'
                                  : aiAnalysis.riskLevel === 'medium'
                                    ? '中'
                                    : aiAnalysis.riskLevel === 'low'
                                      ? '低'
                                      : '-'
                              }
                              valueStyle={{
                                color:
                                  aiAnalysis.riskLevel === 'high'
                                    ? '#ef4444'
                                    : aiAnalysis.riskLevel === 'medium'
                                      ? '#f59e0b'
                                      : '#10b981',
                              }}
                            />
                          </Card>
                          <Card size="small">
                            <Statistic title="影响范围" value={aiAnalysis.affectedArea || '-'} />
                          </Card>
                        </div>
                      </div>
                    )}
                  </div>
                </Spin>
              </TabPane>

              <TabPane
                tab={
                  <span>
                    <BranchesOutlined className="mr-1" />
                    溯源追踪
                  </span>
                }
                key="trace"
              >
                <div className="space-y-6">
                  {/* 智能体多假设推理（Part 3 双输出）*/}
                  <ReasoningCard
                    title="智能体多假设推理"
                    icon={<BranchesOutlined className="text-amber-500" />}
                    human={aiReasoning.trace?.human}
                    machine={aiReasoning.trace?.machine}
                    machineKeys={[
                      { key: 'source', label: '判定源头' },
                      {
                        key: 'confidence',
                        label: '置信度',
                        formatter: (v) =>
                          v != null ? `${Math.round(Number(v) * 100)}%` : '-',
                      },
                      {
                        key: 'alert',
                        label: '是否预警下游',
                        formatter: (v) => (v ? '是' : '否'),
                      },
                    ]}
                  />

                  {traceResult?.sourceStation && (
                    <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
                      <div className="flex items-center gap-3 mb-3">
                        <NodeIndexOutlined className="text-xl text-amber-500" />
                        <h4 className="font-medium text-gray-900">上游关联站点</h4>
                      </div>
                      <div className="flex items-center gap-6">
                        <span className="font-medium">{traceResult.sourceStation.name}</span>
                        {traceResult.sourceStation.distance && (
                          <span className="text-gray-500">距离: {traceResult.sourceStation.distance}</span>
                        )}
                        {traceResult.sourceStation.time && (
                          <span className="text-gray-500">传输时间: {traceResult.sourceStation.time}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {traceResult?.pollutionSources && traceResult.pollutionSources.length > 0 ? (
                    <div>
                      <h4 className="font-medium text-gray-900 mb-3">周边污染源</h4>
                      <div className="space-y-3">
                        {traceResult.pollutionSources.map((source, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                          >
                            <div className="flex items-center gap-3">
                              <WarningOutlined
                                className={source.risk === 'high' ? 'text-red-500' : 'text-amber-500'}
                              />
                              <div>
                                <p className="font-medium text-gray-900">{source.name}</p>
                                <p className="text-sm text-gray-500">
                                  {source.type} · 距离 {source.distance}
                                </p>
                              </div>
                            </div>
                            <Tag color={source.risk === 'high' ? 'red' : 'orange'}>
                              {source.risk === 'high' ? '高风险' : '中风险'}
                            </Tag>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    !traceResult?.sourceStation && <Empty description="暂无溯源结果" />
                  )}

                  {traceResult?.flowPath && traceResult.flowPath.length > 0 && (
                    <div>
                      <h4 className="font-medium text-gray-900 mb-3">水流路径</h4>
                      <div className="flex items-center gap-2 flex-wrap">
                        {traceResult.flowPath.map((node, idx) => (
                          <span key={idx} className="flex items-center">
                            <span className="px-3 py-1 bg-cyan-100 text-cyan-700 rounded-full text-sm">
                              {node}
                            </span>
                            {idx < (traceResult.flowPath?.length ?? 0) - 1 && (
                              <span className="mx-2 text-gray-400">→</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </TabPane>

              <TabPane
                tab={
                  <span>
                    <BulbOutlined className="mr-1" />
                    处置建议
                  </span>
                }
                key="recommendation"
              >
                {recommendations.length > 0 ? (
                  <Steps
                    direction="vertical"
                    size="small"
                    current={Math.max(
                      0,
                      recommendations.findIndex((r) => r.status === 'doing'),
                    )}
                    items={recommendations.map((rec) => ({
                      title: rec.title,
                      description: (
                        <div>
                          <p className="text-gray-600">{rec.description}</p>
                          {rec.responsible && (
                            <p className="text-xs text-gray-400 mt-1">
                              <TeamOutlined className="mr-1" />
                              {rec.responsible}
                            </p>
                          )}
                        </div>
                      ),
                      status:
                        rec.status === 'done'
                          ? 'finish'
                          : rec.status === 'doing'
                            ? 'process'
                            : 'wait',
                    }))}
                  />
                ) : (
                  <Empty description="暂无处置预案，请先完成AI分析" />
                )}
              </TabPane>
            </Tabs>
          </GlassCard>
        </div>

        {/* Right: Timeline & Actions */}
        <div className="space-y-6">
          <GlassCard className="p-6">
            <h3 className="font-semibold text-gray-900 mb-4">处理时间线</h3>
            {timeline.length > 0 ? (
              <Timeline
                items={timeline.map((item) => ({
                  color:
                    item.status === 'error'
                      ? 'red'
                      : item.status === 'warning'
                        ? 'orange'
                        : item.status === 'success'
                          ? 'green'
                          : 'blue',
                  children: (
                    <div>
                      <p className="text-sm text-gray-700">{item.event}</p>
                      <p className="text-xs text-gray-400">{item.time}</p>
                    </div>
                  ),
                }))}
              />
            ) : (
              <Empty description="暂无时间线" />
            )}
          </GlassCard>

          <GlassCard className="p-6">
            <h3 className="font-semibold text-gray-900 mb-4">快捷操作</h3>
            <div className="space-y-3">
              <Button
                block
                type="primary"
                icon={<ThunderboltOutlined />}
                onClick={() => navigate(`/alerts/analysis/${alert.id}`)}
                className="bg-cyan-600 hover:bg-cyan-700"
              >
                进入智能分析工作台
              </Button>
              <Button
                block
                icon={<SendOutlined />}
                onClick={() => navigate(`/disposal/${alert.id}`)}
              >
                转入协同处置
              </Button>
              <Button block icon={<FileTextOutlined />} onClick={() => navigate('/reports')}>
                生成分析报告
              </Button>
              <Button block icon={<BranchesOutlined />} onClick={() => navigate('/ai/graph')}>
                查看流域拓扑
              </Button>
              <Button
                block
                icon={<EnvironmentOutlined />}
                onClick={() => navigate(`/stations/${alert.station_id}`)}
              >
                查看站点详情
              </Button>
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}

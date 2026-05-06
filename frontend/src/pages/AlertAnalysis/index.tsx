import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  RadarChartOutlined,
  BranchesOutlined,
  BulbOutlined,
  RobotOutlined,
  NodeIndexOutlined,
  WarningOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined,
  SendOutlined,
  EnvironmentOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Button, Tag, Tabs, Spin, Empty, Progress, Input, Select, Card, Statistic } from 'antd';
import { GlassCard } from '../../components/GlassCard';
import { ReasoningCard } from '../../components/ReasoningCard';
import { alertApi, aiApi } from '../../services/api';

/**
 * 预警智能分析工作台
 * - 左侧：预警事件列表（可筛选、搜索）
 * - 右侧：选中事件的 4 类 AI 分析（诊断 / 溯源 / 扩散 / 建议）
 * - 核心复用 aiApi.identifyPollution / traceSource / analyzeSpread / getEmergencyPlan
 *
 * 路由：
 *   /alerts/analysis              - 默认选中最近一条未解决的预警
 *   /alerts/analysis/:alertId     - 直接定位到指定事件
 */

interface AlertItem {
  id: string;
  alert_code?: string;
  title?: string;
  description?: string;
  alert_level?: 'critical' | 'high' | 'medium' | 'low';
  status?: 'pending' | 'confirmed' | 'processing' | 'resolved';
  station_id?: string;
  metrics?: Record<string, any>;
  alert_type?: string;
  pollution_type?: string;
  created_at?: string;
}

const LEVEL_MAP: Record<string, { text: string; color: string }> = {
  critical: { text: '紧急', color: 'red' },
  high: { text: '高', color: 'orange' },
  medium: { text: '中', color: 'gold' },
  low: { text: '低', color: 'green' },
};

export default function AlertAnalysis() {
  const { alertId } = useParams<{ alertId: string }>();
  const navigate = useNavigate();

  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(alertId || null);
  const [keyword, setKeyword] = useState('');
  const [levelFilter, setLevelFilter] = useState<string | undefined>(undefined);

  const selected = useMemo(
    () => alerts.find((a) => a.id === selectedId) || null,
    [alerts, selectedId],
  );

  const [analyzing, setAnalyzing] = useState(false);
  const [anomaly, setAnomaly] = useState<any>(null);
  const [pollution, setPollution] = useState<any>(null);
  const [trace, setTrace] = useState<any>(null);
  const [spread, setSpread] = useState<any>(null);
  const [plan, setPlan] = useState<any[]>([]);

  // 加载预警列表
  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const res: any = await alertApi.getAlerts({ page: 1, size: 100 });
      const items = (res?.items || res?.data?.items || []) as AlertItem[];
      setAlerts(items);
      if (!selectedId && items.length > 0) {
        const firstUnresolved = items.find((a) => a.status !== 'resolved') || items[0];
        setSelectedId(firstUnresolved.id);
      }
    } catch {
      setAlerts([]);
    } finally {
      setListLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (alertId && alertId !== selectedId) setSelectedId(alertId);
  }, [alertId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 选中变化时触发 AI 分析
  const runAnalysis = useCallback(async (a: AlertItem) => {
    setAnalyzing(true);
    setAnomaly(null);
    setPollution(null);
    setTrace(null);
    setSpread(null);
    setPlan([]);
    try {
      // Step A: 异常检测 + 溯源（并行）
      const metrics = a.metrics || {};
      const firstMetricEntry = Object.entries(metrics).find(
        ([, v]) => typeof v === 'number',
      );
      const primaryMetric = firstMetricEntry ? (firstMetricEntry[0] as string) : 'nh3_n';
      const primaryValue = firstMetricEntry ? (firstMetricEntry[1] as number) : 0;

      const [aRes, tRes] = await Promise.all([
        aiApi
          .detectAnomaly({
            station_id: a.station_id,
            metric: primaryMetric,
            data: [primaryValue],
          })
          .catch(() => null),
        aiApi
          .traceSource({
            station_id: a.station_id,
            alert_id: a.id,
            pollution_type: a.pollution_type,
          })
          .catch(() => null),
      ]);

      const aData = (aRes as any)?.data || aRes;
      const tData = (tRes as any)?.data || tRes;
      setAnomaly(aData || null);
      setTrace(tData || null);

      // Step B: 污染识别 + 扩散分析（携带上文并行）
      const topSource = (tData?.sources || [])[0];
      const source_info = topSource
        ? {
            station_name: topSource.station_name,
            distance: topSource.distance,
            confidence: topSource.confidence,
          }
        : null;
      const anomalies_payload = aData?.anomalies || null;

      const [p, s] = await Promise.all([
        aiApi
          .identifyPollution({
            station_id: a.station_id,
            metrics: a.metrics || {},
            alert_level: a.alert_level,
            anomalies: anomalies_payload,
            source_info,
          })
          .catch(() => null),
        aiApi
          .analyzeSpread({
            station_id: a.station_id,
            pollution_type: a.pollution_type,
          })
          .catch(() => null),
      ]);
      setPollution((p as any)?.data || p || null);
      setSpread((s as any)?.data || s || null);

      const ptype = (p as any)?.pollution_type || a.pollution_type;
      if (ptype) {
        try {
          const planRes: any = await aiApi.getEmergencyPlan(ptype);
          const planData = planRes?.data || planRes;
          // 后端返回 {actions: string[], departments: string[]}，优先读 actions
          const rawSteps =
            planData?.steps || planData?.recommendations || planData?.actions || [];
          const normalized = rawSteps.map((s: any, idx: number) =>
            typeof s === 'string'
              ? { step: idx + 1, action: s, department: (planData?.departments || [])[idx] }
              : s,
          );
          setPlan(normalized);
        } catch {
          setPlan([]);
        }
      }
    } finally {
      setAnalyzing(false);
    }
  }, []);

  useEffect(() => {
    if (selected) runAnalysis(selected);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    return alerts.filter((a) => {
      if (levelFilter && a.alert_level !== levelFilter) return false;
      if (keyword) {
        const q = keyword.toLowerCase();
        const hay = `${a.alert_code || ''} ${a.title || ''} ${a.description || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [alerts, keyword, levelFilter]);

  return (
    <div className="flex gap-4 h-[calc(100vh-120px)]">
      {/* 左侧：事件列表 */}
      <div className="w-80 flex-shrink-0 flex flex-col">
        <div className="mb-3">
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2 mb-1">
            <RadarChartOutlined className="text-cyan-500" />
            智能分析工作台
          </h1>
          <p className="text-xs text-gray-500">选择事件 → 查看 AI 诊断 / 溯源 / 扩散 / 建议</p>
        </div>

        <div className="space-y-2 mb-3">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索预警编号 / 标题"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <div className="flex gap-2">
            <Select
              allowClear
              size="small"
              placeholder="严重程度"
              value={levelFilter}
              onChange={(v) => setLevelFilter(v)}
              options={Object.entries(LEVEL_MAP).map(([k, v]) => ({ value: k, label: v.text }))}
              className="flex-1"
            />
            <Button size="small" icon={<ReloadOutlined />} onClick={loadList}>
              刷新
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-1 space-y-2">
          {listLoading ? (
            <div className="flex justify-center py-8">
              <Spin />
            </div>
          ) : filtered.length === 0 ? (
            <Empty description="暂无预警事件" />
          ) : (
            filtered.map((a) => {
              const lvl = LEVEL_MAP[a.alert_level || 'low'] || LEVEL_MAP.low;
              const isActive = a.id === selectedId;
              return (
                <div
                  key={a.id}
                  onClick={() => {
                    setSelectedId(a.id);
                    navigate(`/alerts/analysis/${a.id}`, { replace: true });
                  }}
                  className={`p-3 rounded-xl cursor-pointer transition border ${
                    isActive
                      ? 'bg-cyan-50 border-cyan-300 shadow-sm'
                      : 'bg-white border-gray-100 hover:border-cyan-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <Tag color={lvl.color}>{lvl.text}</Tag>
                    <span className="text-xs text-gray-400">
                      {a.created_at ? new Date(a.created_at).toLocaleString('zh-CN', { hour12: false }) : ''}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-gray-900 line-clamp-1">
                    {a.title || a.alert_type || '预警事件'}
                  </div>
                  <div className="text-xs text-gray-500 line-clamp-1 mt-1">
                    {a.alert_code || a.id}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 右侧：分析主区 */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {!selected ? (
          <GlassCard className="p-16">
            <Empty description="请在左侧选择一个预警事件" />
          </GlassCard>
        ) : (
          <AnalysisPanel
            alert={selected}
            analyzing={analyzing}
            anomaly={anomaly}
            pollution={pollution}
            trace={trace}
            spread={spread}
            plan={plan}
            onReanalyze={() => runAnalysis(selected)}
          />
        )}
      </div>
    </div>
  );
}

/* ============================ 子组件 ============================ */

function AnalysisPanel({
  alert,
  analyzing,
  anomaly,
  pollution,
  trace,
  spread,
  plan,
  onReanalyze,
}: {
  alert: AlertItem;
  analyzing: boolean;
  anomaly: any;
  pollution: any;
  trace: any;
  spread: any;
  plan: any[];
  onReanalyze: () => void;
}) {
  const navigate = useNavigate();
  const lvl = LEVEL_MAP[alert.alert_level || 'low'] || LEVEL_MAP.low;

  return (
    <div className="space-y-4">
      {/* 事件头部 */}
      <GlassCard className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Tag color={lvl.color}>{lvl.text}</Tag>
              <span className="text-xs font-mono text-gray-500">{alert.alert_code || alert.id}</span>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">{alert.title}</h2>
            <p className="text-sm text-gray-600 mt-1 line-clamp-2">{alert.description}</p>
          </div>
          <div className="flex gap-2">
            <Button icon={<ReloadOutlined />} onClick={onReanalyze} loading={analyzing}>
              重新分析
            </Button>
            <Button
              icon={<EnvironmentOutlined />}
              onClick={() => navigate(`/stations/${alert.station_id}`)}
            >
              站点详情
            </Button>
            <Button
              type="primary"
              icon={<SendOutlined />}
              className="bg-cyan-600 hover:bg-cyan-700"
              onClick={() => navigate(`/disposal/${alert.id}`)}
            >
              转入处置
            </Button>
          </div>
        </div>
      </GlassCard>

      <Spin spinning={analyzing}>
        <Tabs
          defaultActiveKey="diagnosis"
          items={[
            {
              key: 'diagnosis',
              label: (
                <span>
                  <RobotOutlined /> AI 诊断
                </span>
              ),
              children: <DiagnosisSection anomaly={anomaly} data={pollution} spread={spread} />,
            },
            {
              key: 'trace',
              label: (
                <span>
                  <BranchesOutlined /> 溯源追踪
                </span>
              ),
              children: <TraceSection data={trace} />,
            },
            {
              key: 'spread',
              label: (
                <span>
                  <NodeIndexOutlined /> 扩散分析
                </span>
              ),
              children: <SpreadSection data={spread} />,
            },
            {
              key: 'plan',
              label: (
                <span>
                  <BulbOutlined /> 处置建议
                </span>
              ),
              children: <PlanSection plan={plan} />,
            },
          ]}
        />
      </Spin>
    </div>
  );
}

function DiagnosisSection({ anomaly, data, spread }: { anomaly: any; data: any; spread: any }) {
  const ptype = data?.pollution_type || data?.type;
  const confidence = data?.confidence ? Math.round(data.confidence * (data.confidence > 1 ? 1 : 100)) : null;
  const causes = data?.possible_causes || data?.causes || [];
  const riskLevel = spread?.risk_level || data?.risk_level;
  const riskScore = spread?.risk_score ?? data?.risk_score;
  const affected = spread?.affected_area || spread?.affected_range;

  if (!anomaly && !data && !spread) return <Empty description="暂无 AI 诊断结果" />;

  return (
    <GlassCard className="p-6 space-y-6">
      {/* 智能体双输出：Part 2 异常诊断（human）+ machine 严重度/建议动作 */}
      <ReasoningCard
        title="智能体异常诊断"
        icon={<RobotOutlined className="text-rose-500" />}
        human={anomaly?.human}
        machine={anomaly?.machine}
        machineKeys={[
          { key: 'severity', label: '严重度', color: true },
          { key: 'action', label: '建议动作' },
        ]}
      />

      {/* 智能体双输出：Part 4 综合研判（human）+ machine 决策摘要 */}
      <ReasoningCard
        title="智能体综合研判"
        icon={<RobotOutlined className="text-cyan-500" />}
        human={data?.human}
        machine={data?.machine}
        machineKeys={[
          { key: 'priority', label: '优先级', color: true },
          { key: 'level', label: '等级' },
          { key: 'dept', label: '责任部门' },
          { key: 'response_time', label: '响应时限' },
        ]}
      />

      {ptype && (
        <div className="p-4 bg-gradient-to-r from-cyan-50 to-blue-50 rounded-xl border border-cyan-100">
          <div className="flex items-center gap-3 mb-2">
            <RobotOutlined className="text-xl text-cyan-500" />
            <h4 className="font-medium text-gray-900">污染类型识别</h4>
          </div>
          <div className="flex items-center gap-4">
            <Tag color="cyan" className="text-base px-3 py-1">
              {ptype}
            </Tag>
            {confidence != null && <span className="text-gray-500">置信度: {confidence}%</span>}
          </div>
        </div>
      )}

      {causes.length > 0 && (
        <div>
          <h4 className="font-medium text-gray-900 mb-3">可能原因分析</h4>
          <div className="space-y-2">
            {causes.map((c: any, idx: number) => (
              <div key={idx} className="flex items-center gap-4">
                <span className="text-gray-700 w-32 truncate">{c.cause || c.name}</span>
                <Progress
                  percent={Math.round((c.probability || 0) * (c.probability > 1 ? 1 : 100))}
                  size="small"
                  className="flex-1"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {(riskLevel || affected || riskScore != null) && (
        <div>
          <h4 className="font-medium text-gray-900 mb-3">风险评估</h4>
          <div className="grid grid-cols-3 gap-3">
            <Card size="small">
              <Statistic title="风险等级" value={riskLevel || '-'} />
            </Card>
            <Card size="small">
              <Statistic
                title="风险评分"
                value={riskScore ?? '-'}
                suffix={riskScore != null ? '/ 100' : ''}
                valueStyle={{ color: (riskScore ?? 0) > 70 ? '#ef4444' : '#0891b2' }}
              />
            </Card>
            <Card size="small">
              <Statistic title="影响范围" value={affected || '-'} />
            </Card>
          </div>
        </div>
      )}
    </GlassCard>
  );
}

function TraceSection({ data }: { data: any }) {
  if (!data) return <Empty description="暂无溯源结果" />;
  const sources = data?.pollution_sources || data?.sources || [];
  const path = data?.flow_path || data?.path || [];
  const src = data?.source_station;
  return (
    <GlassCard className="p-6 space-y-6">
      {/* 智能体双输出：Part 3 多假设推理（human）+ machine 决策摘要 */}
      <ReasoningCard
        title="智能体多假设推理"
        icon={<BranchesOutlined className="text-amber-500" />}
        human={data?.human}
        machine={data?.machine}
        machineKeys={[
          { key: 'source', label: '判定源头' },
          { key: 'confidence', label: '置信度', formatter: (v: any) => (v != null ? `${Math.round(Number(v) * 100)}%` : '-') },
          { key: 'alert', label: '是否预警下游', formatter: (v: any) => (v ? '是' : '否') },
        ]}
      />

      {src && (
        <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
          <div className="flex items-center gap-3 mb-2">
            <NodeIndexOutlined className="text-xl text-amber-500" />
            <h4 className="font-medium text-gray-900">上游关联站点</h4>
          </div>
          <div className="flex items-center gap-6 flex-wrap">
            <span className="font-medium">{src.name}</span>
            {src.distance && <span className="text-gray-500">距离: {src.distance}</span>}
            {(src.transit_time || src.time) && (
              <span className="text-gray-500">传输时间: {src.transit_time || src.time}</span>
            )}
          </div>
        </div>
      )}

      {sources.length > 0 && (
        <div>
          <h4 className="font-medium text-gray-900 mb-3">周边污染源</h4>
          <div className="space-y-2">
            {sources.map((s: any, idx: number) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <WarningOutlined className={s.risk === 'high' ? 'text-red-500' : 'text-amber-500'} />
                  <div>
                    <p className="font-medium text-gray-900">{s.name}</p>
                    <p className="text-xs text-gray-500">
                      {s.type} · 距离 {s.distance}
                    </p>
                  </div>
                </div>
                <Tag color={s.risk === 'high' ? 'red' : 'orange'}>
                  {s.risk === 'high' ? '高风险' : '中风险'}
                </Tag>
              </div>
            ))}
          </div>
        </div>
      )}

      {path.length > 0 && (
        <div>
          <h4 className="font-medium text-gray-900 mb-3">水流路径</h4>
          <div className="flex items-center gap-2 flex-wrap">
            {path.map((node: string, idx: number) => (
              <span key={idx} className="flex items-center">
                <span className="px-3 py-1 bg-cyan-100 text-cyan-700 rounded-full text-sm">{node}</span>
                {idx < path.length - 1 && <span className="mx-2 text-gray-400">→</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </GlassCard>
  );
}

function SpreadSection({ data }: { data: any }) {
  if (!data) return <Empty description="暂无扩散分析结果" />;
  const affected = data?.affected_stations || data?.downstream_stations || [];
  // 后端 SpreadAnalysisResponse 无顶层 radius/eta，从 affected_stations 聚合
  const distances = affected.map((s: any) => Number(s.distance)).filter((n: number) => !isNaN(n));
  const aggRadius = distances.length ? Math.max(...distances) : null;
  const etas = affected
    .map((s: any) => s.estimated_arrival || s.eta)
    .filter((v: any) => !!v);
  const aggEta = etas.length ? etas.sort()[0] : null;
  const radiusDisplay = data?.spread_radius ?? data?.radius ?? aggRadius ?? '-';
  const etaDisplay = data?.eta || data?.arrival_time || aggEta || '-';
  return (
    <GlassCard className="p-6 space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card size="small">
          <Statistic
            title="扩散半径"
            value={radiusDisplay}
            suffix={radiusDisplay !== '-' ? 'km' : ''}
            prefix={<ThunderboltOutlined />}
          />
        </Card>
        <Card size="small">
          <Statistic title="影响站点数" value={affected.length} prefix={<EnvironmentOutlined />} />
        </Card>
        <Card size="small">
          <Statistic
            title="预计到达"
            value={etaDisplay}
            prefix={<ExclamationCircleOutlined />}
          />
        </Card>
      </div>

      {affected.length > 0 && (
        <div>
          <h4 className="font-medium text-gray-900 mb-3">受影响下游站点</h4>
          <div className="space-y-2">
            {affected.map((s: any, idx: number) => (
              <div
                key={idx}
                className="p-3 bg-gray-50 rounded-lg flex items-center justify-between"
              >
                <span className="font-medium">{s.name || s.station_name || s.id}</span>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  {s.distance != null && <span>距离: {s.distance}km</span>}
                  {(s.estimated_arrival || s.eta) && <span>到达: {s.estimated_arrival || s.eta}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </GlassCard>
  );
}

function PlanSection({ plan }: { plan: any[] }) {
  if (!plan || plan.length === 0) return <Empty description="暂无应急处置建议" />;
  return (
    <GlassCard className="p-6">
      <div className="space-y-3">
        {plan.map((s: any, idx: number) => (
          <div key={idx} className="flex gap-3 p-3 rounded-lg border border-gray-100">
            <div className="w-8 h-8 rounded-full bg-cyan-500 text-white flex items-center justify-center font-semibold text-sm flex-shrink-0">
              {s.step ?? idx + 1}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900">
                {s.title || s.name || s.action || `步骤 ${idx + 1}`}
              </p>
              {(s.description || s.detail) && (
                <p className="text-sm text-gray-600 mt-1">{s.description || s.detail}</p>
              )}
              {(s.responsible || s.department) && (
                <p className="text-xs text-gray-400 mt-1">责任部门：{s.responsible || s.department}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

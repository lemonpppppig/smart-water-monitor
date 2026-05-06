import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LineChartOutlined,
  AreaChartOutlined,
  AlertOutlined,
  EnvironmentOutlined,
  ClockCircleOutlined,
  ReloadOutlined,
  RobotOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { Button, Select, Tabs, Tag, Progress, Spin, Empty, message } from 'antd';
import ReactECharts from 'echarts-for-react';
import { GlassCard } from '../../components/GlassCard';
import { aiApi, stationApi } from '../../services/api';

const { TabPane } = Tabs;

const METRIC_OPTIONS = [
  { value: 'ph', label: 'pH值' },
  { value: 'do', label: '溶解氧' },
  { value: 'nh3n', label: '氨氮' },
  { value: 'tp', label: '总磷' },
  { value: 'cod', label: 'COD' },
  { value: 'turbidity', label: '浊度' },
];

const HOURS_MAP: Record<string, number> = {
  '24h': 24,
  '72h': 72,
  '7d': 168,
};

interface StationItem {
  id: string;
  name?: string;
  station_code?: string;
  station_name?: string;
  status?: string;
}

interface PredictionPoint {
  timestamp: string;
  value: number;
  lower_bound: number;
  upper_bound: number;
}

interface PredictionResp {
  station_id: string;
  metric: string;
  predictions: PredictionPoint[];
  horizon_hours: number;
}

interface RiskRow {
  station_id: string;
  station_name: string;
  metric: string;
  current_value?: number;
  risk_level: string;
  risk_probability: number;
  predicted_max?: number;
}

interface StatCardProps {
  title: string;
  value: string | number;
  subValue?: string;
  icon: React.ReactNode;
  color: string;
  trend?: 'up' | 'down';
}

function StatCard({ title, value, subValue, icon, color, trend }: StatCardProps) {
  return (
    <GlassCard className="p-5 transition-all duration-300 hover:-translate-y-1">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 mb-1">{title}</p>
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            {trend && (
              <span className={trend === 'up' ? 'text-red-500' : 'text-green-500'}>
                {trend === 'up' ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
              </span>
            )}
          </div>
          {subValue && <p className="text-xs text-gray-400 mt-1">{subValue}</p>}
        </div>
        <div className={`text-2xl ${color}`}>{icon}</div>
      </div>
    </GlassCard>
  );
}

function riskLevelToColor(level?: string): string {
  if (level === 'high' || level === 'critical') return '#ef4444';
  if (level === 'medium') return '#f59e0b';
  return '#10b981';
}

function riskLevelLabel(level?: string): string {
  if (level === 'critical') return '紧急';
  if (level === 'high') return '高';
  if (level === 'medium') return '中';
  if (level === 'low') return '低';
  return '-';
}

export default function Prediction() {
  const [stations, setStations] = useState<StationItem[]>([]);
  const [selectedStation, setSelectedStation] = useState<string | undefined>();
  const [selectedMetric, setSelectedMetric] = useState('ph');
  const [timeRange, setTimeRange] = useState('24h');
  const [predLoading, setPredLoading] = useState(false);
  const [prediction, setPrediction] = useState<PredictionResp | null>(null);
  const [riskRows, setRiskRows] = useState<RiskRow[]>([]);
  const [riskLoading, setRiskLoading] = useState(false);

  // 初始化站点列表
  useEffect(() => {
    (async () => {
      try {
        const res: any = await stationApi.getStations({ size: 50 });
        const items = (res?.items || res?.data?.items || res?.data || res) as StationItem[];
        const list = Array.isArray(items) ? items : [];
        setStations(list);
        if (list.length > 0 && !selectedStation) {
          setSelectedStation(list[0].id);
        }
      } catch (err) {
        console.error('加载站点列表失败', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPrediction = useCallback(async () => {
    if (!selectedStation) return;
    setPredLoading(true);
    try {
      const res: any = await aiApi.predict({
        station_id: selectedStation,
        metric: selectedMetric,
        hours: HOURS_MAP[timeRange] || 24,
      });
      const data = (res?.data || res) as PredictionResp;
      setPrediction(data);
    } catch (err) {
      console.error('预测调用失败', err);
      setPrediction(null);
    } finally {
      setPredLoading(false);
    }
  }, [selectedStation, selectedMetric, timeRange]);

  // 批量加载所有站点在所选指标上的风险预测
  // 说明：每次调用均会在后端 ai_agent_tasks 落对应数量的 risk_prediction 记录，因此：
  // 1) 站点数降到 top3，避免单次刷出 8+ 任务
  // 2) metric 切换加 debounce，避免快速切换时的雪崩调用
  const loadRiskTable = useCallback(async () => {
    if (stations.length === 0) return;
    setRiskLoading(true);
    try {
      const topStations = stations.slice(0, 3);
      const results = await Promise.all(
        topStations.map((s) =>
          aiApi
            .predictRisk({ station_id: s.id, metric: selectedMetric, hours: 24 })
            .then((res: any) => ({ ...(res?.data || res), _station: s }))
            .catch(() => null),
        ),
      );
      const rows: RiskRow[] = results
        .filter((r: any) => r)
        .map((r: any) => {
          const maxVal = r?.prediction?.predictions?.length
            ? Math.max(...r.prediction.predictions.map((p: PredictionPoint) => p.value))
            : undefined;
          return {
            station_id: r.station_id || r._station.id,
            station_name: r._station.name || r._station.station_name || r.station_id,
            metric: r.metric || selectedMetric,
            risk_level: r.risk_level || 'low',
            risk_probability: Math.round((r.risk_probability ?? 0) * (r.risk_probability > 1 ? 1 : 100)),
            predicted_max: maxVal,
          };
        });
      setRiskRows(rows);
    } catch (err) {
      console.error('风险预测批量失败', err);
      setRiskRows([]);
    } finally {
      setRiskLoading(false);
    }
  }, [stations, selectedMetric]);

  useEffect(() => {
    loadPrediction();
  }, [loadPrediction]);

  // metric/stations 变化时 debounce 触发风险表，避免快速切换制造大量任务
  useEffect(() => {
    if (stations.length === 0) return;
    const timer = setTimeout(() => {
      loadRiskTable();
    }, 500);
    return () => clearTimeout(timer);
  }, [loadRiskTable, stations.length]);

  const handleRefresh = () => {
    loadPrediction();
    loadRiskTable();
    message.success('已刷新');
  };

  // 图表数据
  const chartData = useMemo(() => {
    if (!prediction?.predictions?.length) {
      return { times: [], values: [] as number[], upper: [] as number[], lower: [] as number[] };
    }
    return {
      times: prediction.predictions.map((p) => {
        const d = new Date(p.timestamp);
        return Number.isNaN(d.getTime())
          ? p.timestamp
          : d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      }),
      values: prediction.predictions.map((p) => Number(p.value.toFixed(3))),
      upper: prediction.predictions.map((p) => Number(p.upper_bound.toFixed(3))),
      lower: prediction.predictions.map((p) => Number(p.lower_bound.toFixed(3))),
    };
  }, [prediction]);

  const trendChartOption = {
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    legend: { data: ['预测值', '置信上限', '置信下限'], bottom: 0 },
    xAxis: {
      type: 'category',
      data: chartData.times,
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
        name: '预测值',
        type: 'line',
        data: chartData.values,
        smooth: true,
        lineStyle: { color: '#0891b2', width: 3 },
        itemStyle: { color: '#0891b2' },
        symbol: 'circle',
        symbolSize: 6,
      },
      {
        name: '置信上限',
        type: 'line',
        data: chartData.upper,
        smooth: true,
        lineStyle: { color: '#94a3b8', width: 1, type: 'dashed' },
        itemStyle: { color: '#94a3b8' },
        symbol: 'none',
      },
      {
        name: '置信下限',
        type: 'line',
        data: chartData.lower,
        smooth: true,
        lineStyle: { color: '#94a3b8', width: 1, type: 'dashed' },
        itemStyle: { color: '#94a3b8' },
        symbol: 'none',
        areaStyle: { color: 'rgba(8, 145, 178, 0.1)', origin: 'start' },
      },
    ],
    grid: { left: 10, right: 10, top: 40, bottom: 50, containLabel: true },
  };

  // 热力图
  const heatmapOption = useMemo(() => {
    if (riskRows.length === 0) return null;
    const stationNames = riskRows.map((r) => r.station_name);
    const data = riskRows.map((r, i) => [0, i, r.risk_probability]);
    return {
      tooltip: { position: 'top', formatter: (p: any) => `${stationNames[p.data[1]]}: ${p.data[2]}%` },
      xAxis: { type: 'category', data: [selectedMetric.toUpperCase()], axisLabel: { color: '#6b7280' } },
      yAxis: { type: 'category', data: stationNames, axisLabel: { color: '#6b7280' } },
      visualMap: {
        min: 0,
        max: 100,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        inRange: { color: ['#d1fae5', '#fef3c7', '#fee2e2'] },
      },
      series: [
        {
          type: 'heatmap',
          data,
          label: { show: true, formatter: (p: any) => `${p.data[2]}%` },
        },
      ],
      grid: { left: 100, right: 20, top: 20, bottom: 60 },
    };
  }, [riskRows, selectedMetric]);

  const stats = useMemo(() => {
    const highRisk = riskRows.filter((r) => r.risk_probability > 50).length;
    const avg =
      riskRows.length > 0
        ? Math.round(riskRows.reduce((a, b) => a + b.risk_probability, 0) / riskRows.length)
        : 0;
    return { highRisk, avg };
  }, [riskRows]);

  const predictedMax = prediction?.predictions?.length
    ? Math.max(...prediction.predictions.map((p) => p.value))
    : null;
  const predictedMin = prediction?.predictions?.length
    ? Math.min(...prediction.predictions.map((p) => p.value))
    : null;
  const exceedProb = useMemo(() => {
    if (!prediction?.predictions?.length) return null;
    const exceeded = prediction.predictions.filter((p) => p.upper_bound > (selectedMetric === 'ph' ? 9.0 : 99999));
    return Math.round((exceeded.length / prediction.predictions.length) * 100);
  }, [prediction, selectedMetric]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-wrap">
          <Select
            value={selectedStation}
            onChange={setSelectedStation}
            style={{ width: 200 }}
            placeholder="选择站点"
            options={stations.map((s) => ({ value: s.id, label: s.name || s.station_name || s.id }))}
          />
          <Select
            value={selectedMetric}
            onChange={setSelectedMetric}
            style={{ width: 120 }}
            options={METRIC_OPTIONS}
          />
          <Select
            value={timeRange}
            onChange={setTimeRange}
            style={{ width: 140 }}
            options={[
              { value: '24h', label: '未来24小时' },
              { value: '72h', label: '未来72小时' },
              { value: '7d', label: '未来7天' },
            ]}
          />
        </div>
        <Button icon={<ReloadOutlined />} onClick={handleRefresh}>
          刷新预测
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="高风险站点"
          value={stats.highRisk}
          subValue={`基于 ${selectedMetric.toUpperCase()} 指标预测`}
          icon={<AlertOutlined />}
          color="text-red-500"
          trend={stats.highRisk > 0 ? 'up' : undefined}
        />
        <StatCard
          title="平均预警概率"
          value={`${stats.avg}%`}
          subValue={`${riskRows.length} 个站点`}
          icon={<AreaChartOutlined />}
          color="text-amber-500"
        />
        <StatCard
          title="预测时长"
          value={prediction ? `${prediction.horizon_hours}h` : '-'}
          subValue="LSTM 时序预测"
          icon={<ClockCircleOutlined />}
          color="text-cyan-500"
        />
        <StatCard
          title="模型"
          value="LSTM"
          subValue="在线推理引擎"
          icon={<RobotOutlined />}
          color="text-green-500"
        />
      </div>

      {/* Main Content */}
      <GlassCard className="p-6">
        <Tabs defaultActiveKey="trend">
          <TabPane
            tab={
              <span>
                <LineChartOutlined className="mr-1" />
                趋势预测
              </span>
            }
            key="trend"
          >
            <Spin spinning={predLoading}>
              <div className="space-y-4">
                {prediction ? (
                  <>
                    <ReactECharts option={trendChartOption} style={{ height: 350 }} />
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                      <div className="p-4 bg-gray-50 rounded-xl">
                        <p className="text-sm text-gray-500 mb-1">预测最高值</p>
                        <p className="text-xl font-semibold text-red-500">
                          {predictedMax != null ? predictedMax.toFixed(3) : '-'}
                        </p>
                      </div>
                      <div className="p-4 bg-gray-50 rounded-xl">
                        <p className="text-sm text-gray-500 mb-1">预测最低值</p>
                        <p className="text-xl font-semibold text-green-500">
                          {predictedMin != null ? predictedMin.toFixed(3) : '-'}
                        </p>
                      </div>
                      <div className="p-4 bg-gray-50 rounded-xl">
                        <p className="text-sm text-gray-500 mb-1">超标概率</p>
                        <p className="text-xl font-semibold text-amber-500">
                          {exceedProb != null ? `${exceedProb}%` : '-'}
                        </p>
                      </div>
                    </div>
                  </>
                ) : (
                  <Empty description="暂无预测结果（请确认站点已上报数据）" />
                )}
              </div>
            </Spin>
          </TabPane>

          <TabPane
            tab={
              <span>
                <AlertOutlined className="mr-1" />
                风险评估
              </span>
            }
            key="risk"
          >
            <Spin spinning={riskLoading}>
              <div className="space-y-6">
                {heatmapOption && (
                  <div>
                    <h4 className="font-medium text-gray-900 mb-3">风险热力图（按站点）</h4>
                    <ReactECharts option={heatmapOption} style={{ height: 300 }} />
                  </div>
                )}

                <div>
                  <h4 className="font-medium text-gray-900 mb-3">风险预警详情</h4>
                  {riskRows.length === 0 ? (
                    <Empty description="暂无风险预测数据" />
                  ) : (
                    <div className="space-y-3">
                      {riskRows
                        .sort((a, b) => b.risk_probability - a.risk_probability)
                        .map((risk, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between p-4 bg-gray-50 rounded-xl"
                          >
                            <div className="flex items-center gap-4">
                              <div
                                className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                  risk.risk_probability > 50
                                    ? 'bg-red-100 text-red-500'
                                    : risk.risk_probability > 30
                                      ? 'bg-amber-100 text-amber-500'
                                      : 'bg-green-100 text-green-500'
                                }`}
                              >
                                {risk.risk_probability > 50 ? (
                                  <ExclamationCircleOutlined />
                                ) : risk.risk_probability > 30 ? (
                                  <AlertOutlined />
                                ) : (
                                  <CheckCircleOutlined />
                                )}
                              </div>
                              <div>
                                <p className="font-medium text-gray-900">
                                  {risk.station_name} - {risk.metric.toUpperCase()}
                                </p>
                                <p className="text-sm text-gray-500">
                                  风险等级:{' '}
                                  <span style={{ color: riskLevelToColor(risk.risk_level) }}>
                                    {riskLevelLabel(risk.risk_level)}
                                  </span>
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-6">
                              <div className="text-center">
                                <p className="text-xs text-gray-400">预测最大值</p>
                                <p className="font-medium">
                                  {risk.predicted_max != null ? risk.predicted_max.toFixed(3) : '-'}
                                </p>
                              </div>
                              <div className="text-center">
                                <p className="text-xs text-gray-400">风险概率</p>
                                <p
                                  className={`font-medium ${
                                    risk.risk_probability > 50 ? 'text-red-500' : ''
                                  }`}
                                >
                                  {risk.risk_probability}%
                                </p>
                              </div>
                              <Progress
                                type="circle"
                                percent={risk.risk_probability}
                                size={50}
                                strokeColor={riskLevelToColor(risk.risk_level)}
                              />
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            </Spin>
          </TabPane>

          <TabPane
            tab={
              <span>
                <AreaChartOutlined className="mr-1" />
                AI 洞察
              </span>
            }
            key="insight"
          >
            <div className="space-y-6">
              <div className="p-4 bg-gradient-to-r from-cyan-50 to-blue-50 rounded-xl border border-cyan-100">
                <div className="flex items-start gap-3">
                  <RobotOutlined className="text-xl text-cyan-500 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-gray-900 mb-1">AI 预测分析</h4>
                    <p className="text-sm text-gray-600">
                      {stats.highRisk > 0
                        ? `检测到 ${stats.highRisk} 个站点在未来24小时内存在较高的 ${selectedMetric.toUpperCase()} 异常风险，建议重点关注并加强监测频率。`
                        : '当前所有监测站点指标预计保持稳定，风险水平较低，建议维持常规监测频率。'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-medium text-gray-900 mb-3">高风险站点 TOP 3</h4>
                  <div className="space-y-3">
                    {riskRows.length === 0 ? (
                      <Empty description="暂无数据" />
                    ) : (
                      riskRows
                        .sort((a, b) => b.risk_probability - a.risk_probability)
                        .slice(0, 3)
                        .map((r, idx) => (
                          <div key={idx} className="p-3 bg-gray-50 rounded-lg">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium">{r.station_name}</span>
                              <Tag color={r.risk_probability > 50 ? 'red' : 'orange'}>
                                {r.risk_probability}%
                              </Tag>
                            </div>
                            <p className="text-sm text-gray-500">
                              {r.metric.toUpperCase()} · 风险等级 {riskLevelLabel(r.risk_level)}
                            </p>
                          </div>
                        ))
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="font-medium text-gray-900 mb-3">建议行动</h4>
                  <div className="space-y-3">
                    {[
                      {
                        icon: <AlertOutlined />,
                        text: '对高风险站点提高采样频率至每15-30分钟',
                      },
                      {
                        icon: <EnvironmentOutlined />,
                        text: '结合图计算结果排查上游潜在污染源',
                      },
                      {
                        icon: <ClockCircleOutlined />,
                        text: '在预测超标时段前启动预防性处置措施',
                      },
                    ].map((item, idx) => (
                      <div key={idx} className="flex items-start gap-3 p-3 bg-cyan-50 rounded-lg">
                        <span className="text-cyan-500 mt-0.5">{item.icon}</span>
                        <p className="text-sm text-gray-700">{item.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </TabPane>
        </Tabs>
      </GlassCard>
    </div>
  );
}

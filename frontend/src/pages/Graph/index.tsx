import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  SearchOutlined,
  ArrowRightOutlined,
  ClockCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  NodeIndexOutlined,
  BranchesOutlined,
  ApartmentOutlined,
  RobotOutlined,
  ExclamationCircleOutlined,
  EnvironmentOutlined,
} from '@ant-design/icons';
import { Button, Input, Select, Tabs, Tag, message, Progress, Spin, Empty, InputNumber } from 'antd';
import ReactECharts from 'echarts-for-react';
import { GlassCard } from '../../components/GlassCard';
import { aiApi, stationApi } from '../../services/api';

const { TabPane } = Tabs;

interface RiverNode {
  id: string;
  name: string;
  level?: number;
  system?: string;
  sub_system?: string;
  length_km?: number;
}

interface RiverRelation {
  source: string;
  target: string;
  distance_km?: number;
  confluence_id?: string;
}

interface PollutionSourceResult {
  station_id: string;
  station_name: string;
  station_type: string;
  distance: number;
  travel_time: number;
  confidence: number;
}

interface PollutionSourceEntity {
  source_id: string;
  name: string;
  source_type?: string;
  category?: string;
  entity_label?: string;
  river_id?: string;
  district_code?: string;
  longitude?: number;
  latitude?: number;
  pollutants?: string[];
  risk_level?: string;
}

interface TraceResp {
  target_station: string;
  detection_time: string;
  sources: PollutionSourceResult[];
  pollution_sources?: PollutionSourceEntity[];
  total_sources: number;
  total_pollution_entities?: number;
  confidence: number;
  message?: string;
}

interface SpreadItem {
  station_id: string;
  station_name: string;
  distance: number;
  estimated_arrival: string;
  hours_from_now: number;
}

interface SpreadResp {
  source_station: string;
  detection_time: string;
  forecast_hours: number;
  affected_stations: SpreadItem[];
  total_affected: number;
}

interface GraphStats {
  total_stations?: number;
  total_rivers?: number;
  total_pollution_sources?: number;
  total_relations?: number;
}

interface StationOpt {
  id: string;
  name?: string;
  station_name?: string;
}

export default function Graph() {
  const [stations, setStations] = useState<StationOpt[]>([]);
  const [selectedStation, setSelectedStation] = useState<string | undefined>();
  const [analysisType, setAnalysisType] = useState<'trace' | 'spread'>('trace');
  const [lookbackHours, setLookbackHours] = useState(24);
  const [activeTab, setActiveTab] = useState('topology');
  const [topology, setTopology] = useState<{ rivers: RiverNode[]; relations: RiverRelation[] }>({
    rivers: [],
    relations: [],
  });
  const [topoLoading, setTopoLoading] = useState(false);
  const [graphStats, setGraphStats] = useState<GraphStats | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [traceResp, setTraceResp] = useState<TraceResp | null>(null);
  const [spreadResp, setSpreadResp] = useState<SpreadResp | null>(null);
  const [keyword, setKeyword] = useState('');
  const [systemFilter, setSystemFilter] = useState<string | undefined>();

  const loadTopology = useCallback(async () => {
    setTopoLoading(true);
    try {
      const res: any = await aiApi.getRiverTopology();
      const data = (res?.data || res) as { rivers: RiverNode[]; relations: RiverRelation[] };
      setTopology({ rivers: data.rivers || [], relations: data.relations || [] });
    } catch (err) {
      console.error('加载河流拓扑失败', err);
      setTopology({ rivers: [], relations: [] });
    } finally {
      setTopoLoading(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const res: any = await aiApi.getGraphStatistics();
      setGraphStats((res?.data || res) as GraphStats);
    } catch (err) {
      console.error('加载图统计失败', err);
    }
  }, []);

  const loadStations = useCallback(async () => {
    try {
      const res: any = await stationApi.getStations({ size: 100 });
      const items = (res?.items || res?.data?.items || res?.data || res) as StationOpt[];
      setStations(Array.isArray(items) ? items : []);
    } catch {
      setStations([]);
    }
  }, []);

  useEffect(() => {
    loadTopology();
    loadStats();
    loadStations();
  }, [loadTopology, loadStats, loadStations]);

  const systemOptions = useMemo(() => {
    const sysSet = new Set<string>();
    topology.rivers.forEach((r) => r.system && sysSet.add(r.system));
    return [
      { value: undefined, label: '全部流域' },
      ...Array.from(sysSet).map((s) => ({ value: s, label: s })),
    ];
  }, [topology]);

  const filteredTopology = useMemo(() => {
    let rivers = topology.rivers;
    if (systemFilter) rivers = rivers.filter((r) => r.system === systemFilter);
    if (keyword) {
      const kw = keyword.toLowerCase();
      rivers = rivers.filter((r) => r.name?.toLowerCase().includes(kw));
    }
    const riverIds = new Set(rivers.map((r) => r.id));
    const relations = topology.relations.filter(
      (rel) => riverIds.has(rel.source) && riverIds.has(rel.target),
    );
    return { rivers, relations };
  }, [topology, systemFilter, keyword]);

  // 拓扑图配置
  const getGraphOption = () => {
    const nodeData = filteredTopology.rivers.map((r) => ({
      id: r.id,
      name: r.name,
      symbolSize: 20 + Math.min(40, (r.length_km || 10) / 5),
      category: r.level || 0,
      value: r.length_km,
      itemStyle: {
        color:
          r.level === 1
            ? '#0891b2'
            : r.level === 2
              ? '#06b6d4'
              : r.level === 3
                ? '#67e8f9'
                : '#a5f3fc',
      },
    }));

    const linkData = filteredTopology.relations.map((rel) => ({
      source: rel.source,
      target: rel.target,
      lineStyle: { width: 2, curveness: 0.15, color: '#0891b2' },
    }));

    return {
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          if (params.dataType === 'node') {
            const r = filteredTopology.rivers.find((x) => x.id === params.data.id);
            return `${r?.name || ''}<br/>流域: ${r?.system || '-'}<br/>长度: ${r?.length_km ?? '-'} km`;
          }
          return `${params.data.source} → ${params.data.target}`;
        },
      },
      legend: { data: ['1级', '2级', '3级', '4级'], bottom: 0 },
      series: [
        {
          type: 'graph',
          layout: 'force',
          roam: true,
          draggable: true,
          label: { show: true, position: 'bottom', formatter: '{b}', fontSize: 10 },
          edgeSymbol: ['circle', 'arrow'],
          edgeSymbolSize: [3, 8],
          force: { repulsion: 200, edgeLength: [50, 150] },
          categories: [{ name: '1级' }, { name: '2级' }, { name: '3级' }, { name: '4级' }],
          data: nodeData,
          links: linkData,
          emphasis: { focus: 'adjacency', lineStyle: { width: 4 } },
        },
      ],
    };
  };

  const handleStartAnalysis = async () => {
    if (!selectedStation) {
      message.warning('请选择目标站点');
      return;
    }
    setIsAnalyzing(true);
    try {
      if (analysisType === 'trace') {
        const res: any = await aiApi.traceSource({
          station_id: selectedStation,
          lookback_hours: lookbackHours,
        });
        setTraceResp((res?.data || res) as TraceResp);
        setActiveTab('trace');
        message.success('溯源分析完成');
      } else {
        const res: any = await aiApi.analyzeSpread({
          station_id: selectedStation,
          forecast_hours: lookbackHours,
        });
        setSpreadResp((res?.data || res) as SpreadResp);
        setActiveTab('spread');
        message.success('扩散分析完成');
      }
    } catch (err) {
      console.error(err);
      message.error('分析失败，请检查后端图引擎是否可用');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Input
            placeholder="搜索河流..."
            prefix={<SearchOutlined className="text-gray-400" />}
            className="w-56"
            allowClear
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select
            placeholder="选择流域"
            className="w-40"
            allowClear
            value={systemFilter}
            onChange={setSystemFilter}
            options={systemOptions as any}
          />
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => { loadTopology(); loadStats(); }}>
          刷新
        </Button>
      </div>

      {/* 图统计 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <GlassCard className="p-4">
          <div className="flex items-center gap-3">
            <ApartmentOutlined className="text-xl text-cyan-500" />
            <div>
              <p className="text-xs text-gray-500">河流节点</p>
              <p className="text-xl font-semibold">
                {graphStats?.total_rivers ?? topology.rivers.length}
              </p>
            </div>
          </div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="flex items-center gap-3">
            <BranchesOutlined className="text-xl text-blue-500" />
            <div>
              <p className="text-xs text-gray-500">汇流关系</p>
              <p className="text-xl font-semibold">
                {graphStats?.total_relations ?? topology.relations.length}
              </p>
            </div>
          </div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="flex items-center gap-3">
            <EnvironmentOutlined className="text-xl text-green-500" />
            <div>
              <p className="text-xs text-gray-500">监测站点</p>
              <p className="text-xl font-semibold">{graphStats?.total_stations ?? '-'}</p>
            </div>
          </div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="flex items-center gap-3">
            <ExclamationCircleOutlined className="text-xl text-amber-500" />
            <div>
              <p className="text-xs text-gray-500">污染源</p>
              <p className="text-xl font-semibold">{graphStats?.total_pollution_sources ?? '-'}</p>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left: Graph Visualization */}
        <div className="xl:col-span-2">
          <GlassCard className="p-6 min-h-[600px]">
            <Tabs activeKey={activeTab} onChange={setActiveTab}>
              <TabPane
                tab={
                  <span>
                    <ApartmentOutlined /> 拓扑视图
                  </span>
                }
                key="topology"
              >
                <Spin spinning={topoLoading}>
                  {filteredTopology.rivers.length > 0 ? (
                    <ReactECharts option={getGraphOption()} style={{ height: '520px' }} />
                  ) : (
                    <div className="h-[500px] flex items-center justify-center">
                      <Empty description="暂无河流拓扑数据（请确认 Neo4j 已初始化）" />
                    </div>
                  )}
                </Spin>
              </TabPane>

              <TabPane
                tab={
                  <span>
                    <NodeIndexOutlined /> 溯源追踪
                  </span>
                }
                key="trace"
              >
                <div className="h-[500px] overflow-y-auto">
                  {traceResp ? (
                    <div className="space-y-4">
                      <div className="p-4 bg-red-50 rounded-xl border border-red-100">
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="font-medium text-gray-900">
                              目标站点: {traceResp.target_station}
                            </h4>
                            <p className="text-sm text-gray-600 mt-1">
                              检测时间: {new Date(traceResp.detection_time).toLocaleString('zh-CN')}
                            </p>
                            <p className="text-sm text-gray-600">
                              识别 <span className="text-red-500 font-medium">{traceResp.total_sources}</span>{' '}
                              个可能污染源
                            </p>
                          </div>
                          <Tag color="red" className="px-3 py-1">
                            整体置信度 {Math.round(traceResp.confidence * 100)}%
                          </Tag>
                        </div>
                      </div>

                      <div>
                        <h4 className="font-medium text-gray-900 mb-3">可能污染源</h4>
                        {traceResp.sources.length === 0 ? (
                          <Empty description="未发现上游污染源" />
                        ) : (
                          <div className="space-y-2">
                            {traceResp.sources.map((source, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                              >
                                <div className="flex items-center gap-3">
                                  <div
                                    className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-medium ${
                                      source.confidence > 0.7
                                        ? 'bg-red-500'
                                        : source.confidence > 0.4
                                          ? 'bg-amber-500'
                                          : 'bg-gray-400'
                                    }`}
                                  >
                                    {idx + 1}
                                  </div>
                                  <div>
                                    <p className="font-medium text-gray-900">{source.station_name}</p>
                                    <p className="text-xs text-gray-500">
                                      {source.station_type} · 距离 {source.distance.toFixed(1)} km · 传播{' '}
                                      {source.travel_time.toFixed(1)} h
                                    </p>
                                  </div>
                                </div>
                                <Progress
                                  type="circle"
                                  percent={Math.round(source.confidence * 100)}
                                  size={45}
                                  strokeColor={
                                    source.confidence > 0.7
                                      ? '#ef4444'
                                      : source.confidence > 0.4
                                        ? '#f59e0b'
                                        : '#6b7280'
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* 路径沿线污染源（图谱结合） */}
                      {traceResp.pollution_sources && traceResp.pollution_sources.length > 0 && (
                        <div>
                          <h4 className="font-medium text-gray-900 mb-3">
                            路径沿线污染源
                            <span className="text-xs text-gray-400 ml-2">来自污染图谱 · 共 {traceResp.total_pollution_entities ?? traceResp.pollution_sources.length} 个</span>
                          </h4>
                          <div className="space-y-2">
                            {traceResp.pollution_sources.map((ps, idx) => {
                              const labelColor =
                                ps.entity_label === 'IndustrialSource'
                                  ? 'red'
                                  : ps.entity_label === 'AgriculturalSource'
                                    ? 'green'
                                    : 'blue';
                              const labelText =
                                ps.entity_label === 'IndustrialSource'
                                  ? '工业源'
                                  : ps.entity_label === 'AgriculturalSource'
                                    ? '农业源'
                                    : '市政源';
                              const riskColor =
                                ps.risk_level === 'high'
                                  ? 'text-red-600 bg-red-50'
                                  : ps.risk_level === 'medium'
                                    ? 'text-amber-600 bg-amber-50'
                                    : 'text-gray-600 bg-gray-50';
                              return (
                                <div
                                  key={ps.source_id || idx}
                                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                                >
                                  <div className="flex items-center gap-3">
                                    <Tag color={labelColor} className="m-0">{labelText}</Tag>
                                    <div>
                                      <p className="font-medium text-gray-900">{ps.name}</p>
                                      <p className="text-xs text-gray-500">
                                        {ps.source_type}{ps.river_id ? ` · ${ps.river_id}` : ''}
                                        {ps.pollutants && ps.pollutants.length > 0 ? ` · ${ps.pollutants.join('/')}` : ''}
                                      </p>
                                    </div>
                                  </div>
                                  {ps.risk_level && (
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${riskColor}`}>
                                      {ps.risk_level === 'high' ? '高风险' : ps.risk_level === 'medium' ? '中风险' : '低风险'}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <Empty description="请在右侧选择目标站点并点击开始分析" />
                  )}
                </div>
              </TabPane>

              <TabPane
                tab={
                  <span>
                    <BranchesOutlined /> 扩散预测
                  </span>
                }
                key="spread"
              >
                <div className="h-[500px] overflow-y-auto">
                  {spreadResp ? (
                    <div className="space-y-4">
                      <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
                        <h4 className="font-medium text-gray-900">
                          源头站点: {spreadResp.source_station}
                        </h4>
                        <p className="text-sm text-gray-600 mt-1">
                          预测时长: {spreadResp.forecast_hours} 小时 · 影响站点{' '}
                          <span className="text-red-500 font-medium">{spreadResp.total_affected}</span> 个
                        </p>
                      </div>

                      {spreadResp.affected_stations.length === 0 ? (
                        <Empty description="未发现下游受影响站点" />
                      ) : (
                        <div className="space-y-2">
                          {spreadResp.affected_stations.map((item, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                            >
                              <div>
                                <p className="font-medium text-gray-900">{item.station_name}</p>
                                <p className="text-xs text-gray-500">
                                  距离 {item.distance.toFixed(1)} km · 预计到达{' '}
                                  {new Date(item.estimated_arrival).toLocaleString('zh-CN')}
                                </p>
                              </div>
                              <Tag color={item.hours_from_now < 2 ? 'red' : 'orange'}>
                                {item.hours_from_now.toFixed(1)} 小时后
                              </Tag>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <Empty description="请在右侧选择源头站点并点击开始分析" />
                  )}
                </div>
              </TabPane>
            </Tabs>
          </GlassCard>
        </div>

        {/* Right: Analysis Panel */}
        <div className="space-y-4">
          <GlassCard className="p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">图计算分析</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-2">分析类型</label>
                <Select
                  value={analysisType}
                  onChange={(v) => setAnalysisType(v as 'trace' | 'spread')}
                  className="w-full"
                  options={[
                    { value: 'trace', label: '污染溯源（回溯上游）' },
                    { value: 'spread', label: '扩散预测（推算下游）' },
                  ]}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-2">目标站点</label>
                <Select
                  placeholder="选择站点"
                  value={selectedStation}
                  onChange={setSelectedStation}
                  className="w-full"
                  showSearch
                  filterOption={(input, option) =>
                    (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())
                  }
                  options={stations.map((s) => ({
                    value: s.id,
                    label: s.name || s.station_name || s.id,
                  }))}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-2">
                  {analysisType === 'trace' ? '回溯时长（小时）' : '预测时长（小时）'}
                </label>
                <InputNumber
                  value={lookbackHours}
                  onChange={(v) => setLookbackHours(Number(v) || 24)}
                  min={1}
                  max={168}
                  className="w-full"
                />
              </div>

              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleStartAnalysis}
                loading={isAnalyzing}
                className="w-full bg-cyan-600 hover:bg-cyan-700"
              >
                {isAnalyzing ? '分析中...' : '开始分析'}
              </Button>
            </div>
          </GlassCard>

          {/* AI 说明 */}
          <GlassCard className="p-5">
            <div className="flex items-start gap-3">
              <RobotOutlined className="text-xl text-cyan-500 mt-0.5" />
              <div>
                <h4 className="font-medium text-gray-900 mb-1">图计算说明</h4>
                <p className="text-sm text-gray-600 leading-relaxed">
                  基于 Neo4j 构建的流域拓扑图，支持污染溯源与扩散预测。溯源算法根据河流流向与平均流速估算污染物传播路径；扩散预测计算下游所有可达站点的到达时间。
                </p>
              </div>
            </div>
          </GlassCard>

          {/* 最近分析 */}
          {(traceResp || spreadResp) && (
            <GlassCard className="p-5">
              <h4 className="font-medium text-gray-900 mb-3">最近分析</h4>
              <div className="space-y-2 text-sm">
                {traceResp && (
                  <div className="p-2 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-700">溯源: {traceResp.target_station}</span>
                      <Tag color="red">{traceResp.total_sources} 源</Tag>
                    </div>
                    <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                      <ClockCircleOutlined />
                      {new Date(traceResp.detection_time).toLocaleString('zh-CN')}
                    </p>
                  </div>
                )}
                {spreadResp && (
                  <div className="p-2 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-700">扩散: {spreadResp.source_station}</span>
                      <Tag color="orange">{spreadResp.total_affected} 站点</Tag>
                    </div>
                    <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                      <ArrowRightOutlined />
                      {spreadResp.forecast_hours} 小时预测
                    </p>
                  </div>
                )}
              </div>
            </GlassCard>
          )}
        </div>
      </div>
    </div>
  );
}

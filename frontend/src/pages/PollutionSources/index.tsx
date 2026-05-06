import { useState, useMemo, useEffect } from 'react';
import {
  SearchOutlined,
  FilterOutlined,
  ReloadOutlined,
  EnvironmentOutlined,
  AlertOutlined,
  ExperimentOutlined,
  WarningOutlined,
  EyeOutlined,
  AimOutlined,
  NodeIndexOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { Button, Input, Select, Table, Tag, Drawer, Descriptions, Tabs, Badge, Spin, message } from 'antd';
import ReactECharts from 'echarts-for-react';
import { GlassCard } from '../../components/GlassCard';
import { aiApi } from '../../services/api';

const { TabPane } = Tabs;

// 污染源数据类型
interface PollutionSource {
  source_id: string;
  name: string;
  category: string;
  source_type: string;
  river_id: string;
  river_name: string | null;
  district_code: string;
  longitude: number;
  latitude: number;
  pollutants: string[];
  risk_level: string;
  discharge_volume?: number;
  capacity?: number;
  livestock_count?: number;
  area_km2?: number;
  affected_stations?: string[];
}

// 河流数据类型
interface River {
  id: string;
  name: string;
  level: number;
  system: string;
  sub_system: string;
  length_km?: number;
}

// 河流关系类型
interface RiverRelation {
  source: string;
  target: string;
  distance_km?: number;
  confluence_id?: string;
}

// 污染源类型配置
const sourceTypeConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  IndustrialSource: { label: '工业源', color: 'red', icon: <ExperimentOutlined /> },
  AgriculturalSource: { label: '农业源', color: 'green', icon: <EnvironmentOutlined /> },
  MunicipalSource: { label: '市政源', color: 'blue', icon: <AlertOutlined /> },
};

// 风险等级配置
const riskLevelConfig: Record<string, { label: string; color: string }> = {
  high: { label: '高风险', color: 'red' },
  medium: { label: '中风险', color: 'orange' },
  low: { label: '低风险', color: 'green' },
};

// 污染物名称映射
const pollutantNames: Record<string, string> = {
  heavy_metals: '重金属',
  ph: 'pH值',
  conductivity: '电导率',
  codcr: 'CODcr',
  codmn: 'CODmn',
  turbidity: '浊度',
  voc: 'VOC',
  nh3_n: '氨氮',
  total_n: '总氮',
  total_p: '总磷',
  pesticide: '农药残留',
  do: '溶解氧',
  tss: '悬浮物',
};

// ECharts 图谱配置 - 关联河流水系
const getGraphOption = (
  sources: PollutionSource[],
  rivers: River[],
  riverRelations: RiverRelation[],
  selectedId?: string
) => {
  // 获取与当前污染源关联的河流ID
  const relatedRiverIds = new Set(sources.map((s) => s.river_id));
  
  // 过滤出关联的河流（包括这些河流的上下游）
  const filteredRivers = rivers.filter((r) => relatedRiverIds.has(r.id));
  
  // 添加上游河流（通过关系查找）
  riverRelations.forEach((rel) => {
    if (relatedRiverIds.has(rel.target)) {
      const upstreamRiver = rivers.find((r) => r.id === rel.source);
      if (upstreamRiver && !filteredRivers.find((r) => r.id === upstreamRiver.id)) {
        filteredRivers.push(upstreamRiver);
        relatedRiverIds.add(upstreamRiver.id);
      }
    }
  });

  // 创建河流节点 - category 3 (青色)
  const riverNodes = filteredRivers.map((r) => ({
    id: r.id,
    name: r.name,
    category: 3, // 河流类别
    symbolSize: r.level === 1 ? 60 : r.level === 2 ? 50 : 40,
    symbol: 'roundRect',
    itemStyle: {
      borderWidth: 2,
      borderColor: '#0891b2',
    },
    value: r.length_km || 100,
    isRiver: true,
  }));

  // 创建污染源节点
  const sourceNodes = sources.map((s) => ({
    id: s.source_id,
    name: s.name,
    category: s.category === 'IndustrialSource' ? 0 : s.category === 'AgriculturalSource' ? 1 : 2,
    symbolSize: s.risk_level === 'high' ? 45 : s.risk_level === 'medium' ? 35 : 28,
    itemStyle: {
      borderWidth: selectedId === s.source_id ? 3 : 0,
      borderColor: '#1890ff',
    },
    value: s.discharge_volume || s.capacity || s.area_km2 || 1000,
    isRiver: false,
  }));

  const nodes = [...riverNodes, ...sourceNodes];

  // 创建边：污染源 -> 河流 (DISCHARGES_TO)
  const links: { source: string; target: string; lineStyle?: any; label?: any }[] = [];
  
  // 污染源到河流的排放关系
  sources.forEach((s) => {
    if (relatedRiverIds.has(s.river_id)) {
      links.push({
        source: s.source_id,
        target: s.river_id,
        lineStyle: {
          color: '#06b6d4',
          width: 1.5,
          type: 'solid',
        },
      });
    }
  });

  // 河流之间的汇入关系 (FLOWS_INTO)
  riverRelations.forEach((rel) => {
    if (relatedRiverIds.has(rel.source) && relatedRiverIds.has(rel.target)) {
      links.push({
        source: rel.source,
        target: rel.target,
        lineStyle: {
          color: '#0284c7',
          width: 3,
          type: 'solid',
        },
      });
    }
  });

  return {
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => {
        if (params.dataType === 'node') {
          const nodeData = params.data;
          if (nodeData.isRiver) {
            const river = rivers.find((r) => r.id === nodeData.id);
            if (river) {
              return `
                <div style="font-weight: bold; margin-bottom: 4px; color: #0891b2">🌊 ${river.name}</div>
                <div>水系: ${river.sub_system || river.system}</div>
                <div>等级: ${river.level}级河流</div>
                ${river.length_km ? `<div>长度: ${river.length_km} km</div>` : ''}
              `;
            }
          } else {
            const source = sources.find((s) => s.source_id === nodeData.id);
            if (source) {
              const config = sourceTypeConfig[source.category] || sourceTypeConfig.IndustrialSource;
              return `
                <div style="font-weight: bold; margin-bottom: 4px">${source.name}</div>
                <div>类型: ${config.label}</div>
                <div>排入河流: ${source.river_name || source.river_id}</div>
                <div>风险: ${riskLevelConfig[source.risk_level]?.label || source.risk_level}</div>
              `;
            }
          }
        } else if (params.dataType === 'edge') {
          return '排放关系';
        }
        return '';
      },
    },
    legend: {
      data: ['工业源', '农业源', '市政源', '河流水系'],
      top: 10,
      left: 10,
    },
    series: [
      {
        type: 'graph',
        layout: 'force',
        data: nodes,
        links: links,
        categories: [
          { name: '工业源', itemStyle: { color: '#ef4444' } },
          { name: '农业源', itemStyle: { color: '#22c55e' } },
          { name: '市政源', itemStyle: { color: '#3b82f6' } },
          { name: '河流水系', itemStyle: { color: '#06b6d4' }, symbol: 'roundRect' },
        ],
        roam: true,
        label: {
          show: true,
          position: 'bottom',
          fontSize: 10,
          formatter: (params: any) => {
            const name = params.data.name;
            if (params.data.isRiver) {
              return name.length > 6 ? name.slice(0, 6) + '...' : name;
            }
            return name.length > 8 ? name.slice(0, 8) + '...' : name;
          },
        },
        force: {
          repulsion: 600,
          edgeLength: [60, 120],
          gravity: 0.08,
          friction: 0.6,
        },
        emphasis: {
          focus: 'adjacency',
          lineStyle: { width: 4 },
        },
        lineStyle: {
          color: '#999',
          width: 1.5,
          curveness: 0.2,
        },
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: [4, 8],
      },
    ],
  };
};

export default function PollutionSources() {
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [riskFilter, setRiskFilter] = useState<string>('all');
  const [selectedSource, setSelectedSource] = useState<PollutionSource | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pollutionSources, setPollutionSources] = useState<PollutionSource[]>([]);
  const [rivers, setRivers] = useState<River[]>([]);
  const [riverRelations, setRiverRelations] = useState<RiverRelation[]>([]);
  const [statistics, setStatistics] = useState<any>(null);

  // 加载数据
  const loadData = async () => {
    setLoading(true);
    try {
      const [sourcesRes, statsRes, topologyRes] = await Promise.all([
        aiApi.getPollutionSources() as Promise<any>,
        aiApi.getGraphStatistics() as Promise<any>,
        aiApi.getRiverTopology() as Promise<any>,
      ]);
      setPollutionSources(sourcesRes.pollution_sources || []);
      setStatistics(statsRes);
      setRivers(topologyRes.rivers || []);
      setRiverRelations(topologyRes.relations || []);
    } catch (error) {
      console.error('Failed to load pollution sources:', error);
      message.error('加载污染源数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // 过滤数据
  const filteredSources = useMemo(() => {
    return pollutionSources.filter((s) => {
      const matchSearch = s.name.includes(searchText) || s.source_id.includes(searchText);
      const matchType = typeFilter === 'all' || s.category === typeFilter;
      const matchRisk = riskFilter === 'all' || s.risk_level === riskFilter;
      return matchSearch && matchType && matchRisk;
    });
  }, [searchText, typeFilter, riskFilter, pollutionSources]);

  // 统计数据
  const stats = useMemo(() => {
    if (statistics) {
      return {
        total: statistics.pollution_sources || 0,
        industrial: statistics.by_category?.industrial || 0,
        agricultural: statistics.by_category?.agricultural || 0,
        municipal: statistics.by_category?.municipal || 0,
        highRisk: pollutionSources.filter((s) => s.risk_level === 'high').length,
      };
    }
    return {
      total: pollutionSources.length,
      industrial: pollutionSources.filter((s) => s.category === 'IndustrialSource').length,
      agricultural: pollutionSources.filter((s) => s.category === 'AgriculturalSource').length,
      municipal: pollutionSources.filter((s) => s.category === 'MunicipalSource').length,
      highRisk: pollutionSources.filter((s) => s.risk_level === 'high').length,
    };
  }, [statistics, pollutionSources]);

  const handleViewDetail = (source: PollutionSource) => {
    setSelectedSource(source);
    setDrawerOpen(true);
  };

  const columns = [
    {
      title: '污染源名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: PollutionSource) => (
        <div className="flex items-center gap-2">
          {(sourceTypeConfig[record.category] || sourceTypeConfig.IndustrialSource).icon}
          <span className="font-medium">{text}</span>
        </div>
      ),
    },
    {
      title: '类型',
      dataIndex: 'category',
      key: 'category',
      render: (type: string) => {
        const config = sourceTypeConfig[type] || sourceTypeConfig.IndustrialSource;
        return <Tag color={config.color}>{config.label}</Tag>;
      },
    },
    {
      title: '关联河流',
      dataIndex: 'river_name',
      key: 'river_name',
      render: (river: string, record: PollutionSource) => <Tag color="cyan">{river || record.river_id}</Tag>,
    },
    {
      title: '风险等级',
      dataIndex: 'risk_level',
      key: 'risk_level',
      render: (level: string) => {
        const config = riskLevelConfig[level] || riskLevelConfig.medium;
        return (
          <Badge
            status={level === 'high' ? 'error' : level === 'medium' ? 'warning' : 'success'}
            text={config.label}
          />
        );
      },
    },
    {
      title: '主要污染物',
      dataIndex: 'pollutants',
      key: 'pollutants',
      render: (pollutants: string[]) => (
        <div className="flex flex-wrap gap-1">
          {(pollutants || []).slice(0, 2).map((p) => (
            <Tag key={p} color="default" className="text-xs">
              {pollutantNames[p] || p}
            </Tag>
          ))}
          {pollutants && pollutants.length > 2 && (
            <Tag color="default" className="text-xs">
              +{pollutants.length - 2}
            </Tag>
          )}
        </div>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: PollutionSource) => (
        <div className="flex gap-2">
          <Button type="text" icon={<EyeOutlined />} size="small" onClick={() => handleViewDetail(record)}>
            详情
          </Button>
          <Button type="text" icon={<AimOutlined />} size="small">
            定位
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Input
            placeholder="搜索污染源..."
            prefix={<SearchOutlined className="text-gray-400" />}
            className="w-64"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <Select
            value={typeFilter}
            onChange={setTypeFilter}
            className="w-32"
            options={[
              { value: 'all', label: '全部类型' },
              { value: 'IndustrialSource', label: '工业源' },
              { value: 'AgriculturalSource', label: '农业源' },
              { value: 'MunicipalSource', label: '市政源' },
            ]}
          />
          <Select
            value={riskFilter}
            onChange={setRiskFilter}
            className="w-32"
            options={[
              { value: 'all', label: '全部风险' },
              { value: 'high', label: '高风险' },
              { value: 'medium', label: '中风险' },
              { value: 'low', label: '低风险' },
            ]}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button icon={<ReloadOutlined />} onClick={loadData} loading={loading}>刷新</Button>
          <Button icon={<FilterOutlined />}>高级筛选</Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {[
          { icon: NodeIndexOutlined, label: '污染源总数', value: stats.total, color: 'text-gray-600' },
          { icon: ExperimentOutlined, label: '工业源', value: stats.industrial, color: 'text-red-500' },
          { icon: EnvironmentOutlined, label: '农业源', value: stats.agricultural, color: 'text-green-500' },
          { icon: AlertOutlined, label: '市政源', value: stats.municipal, color: 'text-blue-500' },
          { icon: WarningOutlined, label: '高风险源', value: stats.highRisk, color: 'text-amber-500' },
        ].map((stat, idx) => (
          <GlassCard key={idx} className="p-4">
            <div className="flex items-center gap-3">
              <stat.icon className={`text-2xl ${stat.color}`} />
              <div>
                <p className="text-sm text-gray-500">{stat.label}</p>
                <p className="text-2xl font-semibold text-gray-900">{stat.value}</p>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      {/* Main Content */}
      {loading ? (
        <div className="flex items-center justify-center h-96">
          <Spin indicator={<LoadingOutlined style={{ fontSize: 48 }} spin />} tip="加载污染源数据..." />
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Graph View */}
          <GlassCard className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">污染源与河流关系图谱</h3>
            <ReactECharts
              option={getGraphOption(filteredSources, rivers, riverRelations, selectedSource?.source_id)}
              style={{ height: '450px' }}
              onEvents={{
                click: (params: any) => {
                  if (params.dataType === 'node') {
                    const source = filteredSources.find((s) => s.source_id === params.data.id);
                    if (source) handleViewDetail(source);
                  }
                },
              }}
            />
          </GlassCard>

          {/* Table View */}
          <GlassCard className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">污染源列表</h3>
            <Table
              columns={columns}
              dataSource={filteredSources}
              rowKey="source_id"
              pagination={{ pageSize: 6 }}
              size="small"
              onRow={(record) => ({
                onClick: () => setSelectedSource(record),
                className: selectedSource?.source_id === record.source_id ? 'bg-cyan-50' : '',
              })}
            />
          </GlassCard>
        </div>
      )}

      {/* Detail Drawer */}
      <Drawer
        title={
          <div className="flex items-center gap-2">
            {selectedSource && (sourceTypeConfig[selectedSource.category] || sourceTypeConfig.IndustrialSource).icon}
            <span>{selectedSource?.name}</span>
          </div>
        }
        placement="right"
        width={480}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        {selectedSource && (
          <Tabs defaultActiveKey="basic">
            <TabPane tab="基本信息" key="basic">
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="污染源ID">{selectedSource.source_id}</Descriptions.Item>
                <Descriptions.Item label="污染源类型">
                  <Tag color={(sourceTypeConfig[selectedSource.category] || sourceTypeConfig.IndustrialSource).color}>
                    {(sourceTypeConfig[selectedSource.category] || sourceTypeConfig.IndustrialSource).label}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="具体类型">{selectedSource.source_type}</Descriptions.Item>
                <Descriptions.Item label="关联河流">
                  <Tag color="cyan">{selectedSource.river_name || selectedSource.river_id}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="风险等级">
                  <Badge
                    status={
                      selectedSource.risk_level === 'high'
                        ? 'error'
                        : selectedSource.risk_level === 'medium'
                          ? 'warning'
                          : 'success'
                    }
                    text={(riskLevelConfig[selectedSource.risk_level] || riskLevelConfig.medium).label}
                  />
                </Descriptions.Item>
                <Descriptions.Item label="经纬度">
                  {selectedSource.longitude}, {selectedSource.latitude}
                </Descriptions.Item>
              </Descriptions>
            </TabPane>
            <TabPane tab="排放信息" key="discharge">
              <Descriptions column={1} bordered size="small">
                {selectedSource.discharge_volume && (
                  <Descriptions.Item label="日排放量">{selectedSource.discharge_volume} m³/d</Descriptions.Item>
                )}
                {selectedSource.capacity && (
                  <Descriptions.Item label="处理能力">{selectedSource.capacity} m³/d</Descriptions.Item>
                )}
                {selectedSource.area_km2 && (
                  <Descriptions.Item label="种植面积">{selectedSource.area_km2} km²</Descriptions.Item>
                )}
                {selectedSource.livestock_count && (
                  <Descriptions.Item label="养殖规模">{selectedSource.livestock_count} 头</Descriptions.Item>
                )}
                <Descriptions.Item label="主要污染物">
                  <div className="flex flex-wrap gap-1">
                    {(selectedSource.pollutants || []).map((p) => (
                      <Tag key={p} color="orange">
                        {pollutantNames[p] || p}
                      </Tag>
                    ))}
                  </div>
                </Descriptions.Item>
              </Descriptions>
            </TabPane>
            <TabPane tab="关联关系" key="relations">
              <div className="space-y-4">
                <div className="p-3 rounded-lg bg-gray-50">
                  <p className="text-sm text-gray-500 mb-2">排放至河流 (DISCHARGES_TO)</p>
                  <Tag color="blue">{selectedSource.river_name || selectedSource.river_id}</Tag>
                </div>
                <div className="p-3 rounded-lg bg-gray-50">
                  <p className="text-sm text-gray-500 mb-2">影响下游站点 (UPSTREAM_OF)</p>
                  <div className="flex flex-wrap gap-1">
                    {(selectedSource.affected_stations || []).length > 0 ? (
                      selectedSource.affected_stations!.map((st) => (
                        <Tag key={st} color="cyan">{st}</Tag>
                      ))
                    ) : (
                      <span className="text-gray-400">暂无关联站点</span>
                    )}
                  </div>
                </div>
              </div>
            </TabPane>
          </Tabs>
        )}
      </Drawer>
    </div>
  );
}

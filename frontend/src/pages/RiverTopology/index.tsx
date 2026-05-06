import { useState, useMemo, useEffect } from 'react';
import {
  SearchOutlined,
  FilterOutlined,
  ReloadOutlined,
  BranchesOutlined,
  EnvironmentOutlined,
  ArrowRightOutlined,
  InfoCircleOutlined,
  AimOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { Button, Input, Select, Table, Tag, Drawer, Descriptions, Tabs, Card, Statistic, Spin, message } from 'antd';
import ReactECharts from 'echarts-for-react';
import { GlassCard } from '../../components/GlassCard';
import { aiApi } from '../../services/api';

const { TabPane } = Tabs;

// 河流数据类型
interface River {
  id: string;
  river_id?: string;
  name: string;
  level: number;
  system: string;
  sub_system: string;
  length_km: number;
  basin_area_km2?: number;
  type?: string;
  downstream_river_id?: string;
  downstream_river_name?: string;
}

// 交汇点数据类型
interface Confluence {
  confluence_id: string;
  name: string;
  longitude: number;
  latitude: number;
  district_code: string;
  district_name: string | null;
  priority: number;
  description: string;
  is_boundary?: boolean;
}

// 河流等级配置
const riverLevelConfig: Record<number, { label: string; color: string }> = {
  1: { label: '干流', color: 'blue' },
  2: { label: '一级支流', color: 'cyan' },
  3: { label: '二级支流', color: 'green' },
  4: { label: '三级支流', color: 'default' },
};

// 水系配置
const waterSystemConfig: Record<string, { label: string; color: string }> = {
  Yangtze: { label: '长江水系', color: 'blue' },
  Pearl: { label: '珠江水系', color: 'green' },
};

// 构建树形图数据
const buildTreeData = (rivers: River[], system: string) => {
  const systemRivers = rivers.filter((r) => r.system === system);
  const mainRiver = systemRivers.find((r) => r.level === 1);
  if (!mainRiver) return null;

  const buildChildren = (parentId: string): any[] => {
    const children = systemRivers.filter((r) => r.downstream_river_id === parentId);
    return children.map((c) => ({
      name: c.name,
      value: c.basin_area_km2 || c.length_km * 10,
      children: buildChildren(c.id || c.river_id || ''),
      itemStyle: {
        color:
          c.level === 2 ? '#0891b2' : c.level === 3 ? '#22c55e' : '#94a3b8',
      },
    }));
  };

  return {
    name: mainRiver.name,
    value: mainRiver.basin_area_km2 || mainRiver.length_km * 10,
    children: buildChildren(mainRiver.id || mainRiver.river_id || ''),
    itemStyle: { color: '#1d4ed8' },
  };
};

// ECharts 树形图配置
const getTreeOption = (rivers: River[], system: string) => {
  const treeData = buildTreeData(rivers, system);
  if (!treeData) return {};

  return {
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => {
        return `${params.data.name}<br/>流域面积: ${params.data.value} km²`;
      },
    },
    series: [
      {
        type: 'tree',
        data: [treeData],
        left: '10%',
        right: '10%',
        top: '10%',
        bottom: '10%',
        symbol: 'circle',
        symbolSize: 14,
        orient: 'TB',
        expandAndCollapse: true,
        initialTreeDepth: 3,
        label: {
          position: 'top',
          verticalAlign: 'middle',
          align: 'center',
          fontSize: 12,
          fontWeight: 'bold',
        },
        leaves: {
          label: {
            position: 'bottom',
            verticalAlign: 'middle',
            align: 'center',
          },
        },
        lineStyle: {
          color: '#94a3b8',
          width: 2,
          curveness: 0.5,
        },
        emphasis: {
          focus: 'descendant',
        },
      },
    ],
  };
};

// ECharts 桑基图配置
const getSankeyOption = (rivers: River[]) => {
  const nodes = rivers.map((r) => ({
    name: r.name,
    itemStyle: {
      color: r.level === 1 ? '#1d4ed8' : r.level === 2 ? '#0891b2' : r.level === 3 ? '#22c55e' : '#94a3b8',
    },
  }));

  const links = rivers
    .filter((r) => r.downstream_river_id)
    .map((r) => {
      const target = rivers.find((t) => (t.id || t.river_id) === r.downstream_river_id);
      return {
        source: r.name,
        target: target?.name || '',
        value: (r.basin_area_km2 || r.length_km * 10) / 100,
      };
    })
    .filter((l) => l.target);

  return {
    tooltip: {
      trigger: 'item',
      triggerOn: 'mousemove',
    },
    series: [
      {
        type: 'sankey',
        layout: 'none',
        emphasis: {
          focus: 'adjacency',
        },
        data: nodes,
        links: links,
        lineStyle: {
          color: 'gradient',
          curveness: 0.5,
        },
        label: {
          fontSize: 12,
        },
      },
    ],
  };
};

export default function RiverTopology() {
  const [searchText, setSearchText] = useState('');
  const [systemFilter, setSystemFilter] = useState<string>('Yangtze');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [selectedRiver, setSelectedRiver] = useState<River | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewType, setViewType] = useState<'tree' | 'sankey'>('tree');
  const [loading, setLoading] = useState(true);
  const [rivers, setRivers] = useState<River[]>([]);
  const [confluences, setConfluences] = useState<Confluence[]>([]);

  // 加载数据
  const loadData = async () => {
    setLoading(true);
    try {
      const [riversRes, confluencesRes] = await Promise.all([
        aiApi.getRivers() as Promise<any>,
        aiApi.getConfluences() as Promise<any>,
      ]);
      setRivers(riversRes.rivers || []);
      setConfluences(confluencesRes.confluences || []);
    } catch (error) {
      console.error('Failed to load river topology:', error);
      message.error('加载河流数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // 过滤数据
  const filteredRivers = useMemo(() => {
    return rivers.filter((r) => {
      const matchSearch = r.name.includes(searchText);
      const matchSystem = r.system === systemFilter;
      const matchLevel = levelFilter === 'all' || r.level === parseInt(levelFilter);
      return matchSearch && matchSystem && matchLevel;
    });
  }, [searchText, systemFilter, levelFilter, rivers]);

  // 统计数据
  const stats = useMemo(() => {
    const systemRivers = rivers.filter((r) => r.system === systemFilter);
    return {
      total: systemRivers.length,
      totalLength: systemRivers.reduce((sum, r) => sum + (r.length_km || 0), 0),
      totalBasin: systemRivers.reduce((sum, r) => sum + (r.basin_area_km2 || 0), 0),
      confluences: confluences.length,
    };
  }, [systemFilter, rivers, confluences]);

  const handleViewDetail = (river: River) => {
    setSelectedRiver(river);
    setDrawerOpen(true);
  };

  // 获取上下游关系
  const getUpstreamRivers = (riverId: string) => {
    return rivers.filter((r) => r.downstream_river_id === riverId);
  };

  const getDownstreamRiver = (riverId: string) => {
    const river = rivers.find((r) => (r.id || r.river_id) === riverId);
    if (river?.downstream_river_id) {
      return rivers.find((r) => (r.id || r.river_id) === river.downstream_river_id);
    }
    return null;
  };

  const columns = [
    {
      title: '河流名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => (
        <div className="flex items-center gap-2">
          <BranchesOutlined className="text-cyan-500" />
          <span className="font-medium">{text}</span>
        </div>
      ),
    },
    {
      title: '河流等级',
      dataIndex: 'level',
      key: 'level',
      render: (level: number) => {
        const config = riverLevelConfig[level] || riverLevelConfig[4];
        return <Tag color={config.color}>{config.label}</Tag>;
      },
    },
    {
      title: '所属水系',
      dataIndex: 'sub_system',
      key: 'sub_system',
      render: (text: string) => <Tag color="blue">{text}</Tag>,
    },
    {
      title: '河长(km)',
      dataIndex: 'length_km',
      key: 'length_km',
      render: (val: number) => <span className="font-medium">{val?.toFixed(1) || '-'}</span>,
    },
    {
      title: '流域面积(km²)',
      dataIndex: 'basin_area_km2',
      key: 'basin_area_km2',
      render: (val: number) => <span className="font-medium">{val?.toLocaleString() || '-'}</span>,
    },
    {
      title: '汇入河流',
      dataIndex: 'downstream_river_name',
      key: 'downstream_river_name',
      render: (name: string) => {
        if (!name) return <Tag color="gold">干流/出境</Tag>;
        return <Tag color="cyan">{name}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: River) => (
        <div className="flex gap-2">
          <Button type="text" icon={<InfoCircleOutlined />} size="small" onClick={() => handleViewDetail(record)}>
            详情
          </Button>
          <Button type="text" icon={<AimOutlined />} size="small">
            溯源
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
            placeholder="搜索河流..."
            prefix={<SearchOutlined className="text-gray-400" />}
            className="w-64"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <Select
            value={systemFilter}
            onChange={setSystemFilter}
            className="w-32"
            options={[
              { value: 'Yangtze', label: '长江水系' },
              { value: 'Pearl', label: '珠江水系' },
            ]}
          />
          <Select
            value={levelFilter}
            onChange={setLevelFilter}
            className="w-32"
            options={[
              { value: 'all', label: '全部等级' },
              { value: '1', label: '干流' },
              { value: '2', label: '一级支流' },
              { value: '3', label: '二级支流' },
              { value: '4', label: '三级支流' },
            ]}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button icon={<ReloadOutlined />} onClick={loadData} loading={loading}>刷新</Button>
          <Button icon={<FilterOutlined />}>高级筛选</Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <GlassCard className="p-4">
          <Statistic
            title={<span className="text-gray-600">河流数量</span>}
            value={stats.total}
            suffix="条"
            valueStyle={{ color: '#0891b2' }}
          />
        </GlassCard>
        <GlassCard className="p-4">
          <Statistic
            title={<span className="text-gray-600">总河长</span>}
            value={stats.totalLength.toFixed(1)}
            suffix="km"
            valueStyle={{ color: '#22c55e' }}
          />
        </GlassCard>
        <GlassCard className="p-4">
          <Statistic
            title={<span className="text-gray-600">流域总面积</span>}
            value={stats.totalBasin.toLocaleString()}
            suffix="km²"
            valueStyle={{ color: '#3b82f6' }}
          />
        </GlassCard>
        <GlassCard className="p-4">
          <Statistic
            title={<span className="text-gray-600">主要交汇点</span>}
            value={stats.confluences}
            suffix="处"
            valueStyle={{ color: '#f59e0b' }}
          />
        </GlassCard>
      </div>

      {/* Main Content */}
      {loading ? (
        <div className="flex items-center justify-center h-96">
          <Spin indicator={<LoadingOutlined style={{ fontSize: 48 }} spin />} tip="加载河流数据..." />
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
          {/* Graph View */}
          <div className="xl:col-span-3">
            <GlassCard className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  {waterSystemConfig[systemFilter].label} - 河流拓扑图
                </h3>
                <Select
                  value={viewType}
                  onChange={setViewType}
                  className="w-28"
                  size="small"
                  options={[
                    { value: 'tree', label: '树形视图' },
                    { value: 'sankey', label: '桑基视图' },
                  ]}
                />
              </div>
              {viewType === 'tree' ? (
                <ReactECharts
                  option={getTreeOption(rivers, systemFilter)}
                  style={{ height: '500px' }}
                  onEvents={{
                    click: (params: any) => {
                      const river = rivers.find((r) => r.name === params.data.name);
                      if (river) handleViewDetail(river);
                    },
                  }}
                />
              ) : (
                <ReactECharts
                  option={getSankeyOption(filteredRivers)}
                  style={{ height: '500px' }}
                  onEvents={{
                    click: (params: any) => {
                      if (params.dataType === 'node') {
                        const river = rivers.find((r) => r.name === params.data.name);
                        if (river) handleViewDetail(river);
                      }
                    },
                  }}
                />
              )}
            </GlassCard>
          </div>

          {/* Side Panel */}
          <div className="xl:col-span-2 space-y-4">
            {/* Confluence List */}
            <GlassCard className="p-5">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">主要交汇点</h3>
              <div className="space-y-3">
                {confluences.map((conf) => (
                  <div
                    key={conf.confluence_id}
                    className="p-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-gray-900">{conf.name}</span>
                      <Tag color={conf.priority >= 5 ? 'red' : 'orange'}>
                        优先级 {conf.priority}
                      </Tag>
                    </div>
                    <div className="text-sm text-gray-500 flex items-center gap-1">
                      <ArrowRightOutlined className="text-xs" />
                      {conf.description}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      <EnvironmentOutlined /> {conf.district_name || conf.district_code}
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>

            {/* Quick Stats */}
            <GlassCard className="p-5">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">河流等级分布</h3>
              <div className="space-y-3">
                {[1, 2, 3, 4].map((level) => {
                  const count = rivers.filter(
                    (r) => r.system === systemFilter && r.level === level
                  ).length;
                  const percentage = stats.total > 0 ? (count / stats.total) * 100 : 0;
                  return (
                    <div key={level}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">{riverLevelConfig[level].label}</span>
                        <span className="font-medium">{count} 条</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${percentage}%`,
                            backgroundColor:
                              level === 1 ? '#1d4ed8' : level === 2 ? '#0891b2' : level === 3 ? '#22c55e' : '#94a3b8',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          </div>
        </div>
      )}

      {/* Table */}
      {!loading && (
        <GlassCard className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">河流列表</h3>
          <Table
            columns={columns}
            dataSource={filteredRivers}
            rowKey={(r) => r.id || r.river_id || r.name}
            pagination={{ pageSize: 8 }}
            onRow={(record) => ({
              onClick: () => setSelectedRiver(record),
              className: selectedRiver && (selectedRiver.id || selectedRiver.river_id) === (record.id || record.river_id) ? 'bg-cyan-50' : '',
            })}
          />
        </GlassCard>
      )}

      {/* Detail Drawer */}
      <Drawer
        title={
          <div className="flex items-center gap-2">
            <BranchesOutlined className="text-cyan-500" />
            <span>{selectedRiver?.name}</span>
          </div>
        }
        placement="right"
        width={500}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        {selectedRiver && (
          <Tabs defaultActiveKey="basic">
            <TabPane tab="基本信息" key="basic">
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="河流ID">{selectedRiver.id || selectedRiver.river_id}</Descriptions.Item>
                <Descriptions.Item label="河流名称">{selectedRiver.name}</Descriptions.Item>
                <Descriptions.Item label="河流等级">
                  <Tag color={(riverLevelConfig[selectedRiver.level] || riverLevelConfig[4]).color}>
                    {(riverLevelConfig[selectedRiver.level] || riverLevelConfig[4]).label}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="所属水系">
                  <Tag color={(waterSystemConfig[selectedRiver.system] || waterSystemConfig.Yangtze).color}>
                    {(waterSystemConfig[selectedRiver.system] || waterSystemConfig.Yangtze).label}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="子水系">{selectedRiver.sub_system}</Descriptions.Item>
                <Descriptions.Item label="河长">{selectedRiver.length_km} km</Descriptions.Item>
                <Descriptions.Item label="流域面积">{selectedRiver.basin_area_km2?.toLocaleString() || '-'} km²</Descriptions.Item>
              </Descriptions>
            </TabPane>
            <TabPane tab="上下游关系" key="relations">
              <div className="space-y-4">
                {/* 下游 */}
                <Card size="small" title="汇入河流 (FLOWS_INTO)">
                  {(() => {
                    const downstream = getDownstreamRiver(selectedRiver.id || selectedRiver.river_id || '');
                    return downstream ? (
                      <div className="flex items-center gap-2">
                        <ArrowRightOutlined className="text-cyan-500" />
                        <Tag color="blue">{downstream.name}</Tag>
                        <span className="text-gray-500 text-sm">
                          ({(riverLevelConfig[downstream.level] || riverLevelConfig[4]).label})
                        </span>
                      </div>
                    ) : (
                      <span className="text-gray-400">干流/出境河流</span>
                    );
                  })()}
                </Card>

                {/* 上游 */}
                <Card size="small" title="上游支流">
                  {(() => {
                    const upstream = getUpstreamRivers(selectedRiver.id || selectedRiver.river_id || '');
                    return upstream.length > 0 ? (
                      <div className="space-y-2">
                        {upstream.map((r) => (
                          <div key={r.id || r.river_id} className="flex items-center gap-2">
                            <ArrowRightOutlined className="text-green-500 rotate-180" />
                            <Tag color="cyan">{r.name}</Tag>
                            <span className="text-gray-500 text-sm">
                              ({r.length_km} km)
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-400">无上游支流（源头）</span>
                    );
                  })()}
                </Card>
              </div>
            </TabPane>
            <TabPane tab="监测站点" key="stations">
              <div className="text-center text-gray-400 py-8">
                <EnvironmentOutlined className="text-4xl mb-2" />
                <p>关联监测站点</p>
                <p className="text-sm">点击查看站点详情</p>
              </div>
            </TabPane>
          </Tabs>
        )}
      </Drawer>
    </div>
  );
}

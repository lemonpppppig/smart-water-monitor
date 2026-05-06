import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftOutlined,
  EnvironmentOutlined,
  WifiOutlined,
  AlertOutlined,
  HistoryOutlined,
  DashboardOutlined,
  ReloadOutlined,
  ApiOutlined,
  LoadingOutlined,
  PlusOutlined,
  DisconnectOutlined,
  EditOutlined,
  ExperimentOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
} from '@ant-design/icons';
import { Button, Tabs, Tag, Spin, Empty, message, Descriptions, DatePicker, Select, Space, Popconfirm, Tooltip } from 'antd';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import { GlassCard } from '../../components/GlassCard';
import { stationApi, dataApi, mqttApi, alertApi } from '../../services/api';
import BindingEditorModal from '../MqttConnections/BindingEditorModal';
import { MQTT_MODULES } from '../../constants/mqttModules';

const { RangePicker } = DatePicker;

const typeMap: Record<string, string> = {
  water_source: '水源地',
  industrial_park: '工业园区',
  boundary_section: '跨界断面',
  rural_water: '农村水体',
};

const statusMap: Record<string, { text: string; color: string }> = {
  active: { text: '在线', color: 'success' },
  inactive: { text: '离线', color: 'default' },
  maintenance: { text: '维护中', color: 'warning' },
};

// 水质指标中文映射
const fieldLabelMap: Record<string, { label: string; unit: string }> = {
  ph: { label: 'pH值', unit: '' },
  dissolved_oxygen: { label: '溶解氧', unit: 'mg/L' },
  turbidity: { label: '浊度', unit: 'NTU' },
  conductivity: { label: '电导率', unit: 'μS/cm' },
  water_temperature: { label: '水温', unit: '°C' },
  cod: { label: 'COD', unit: 'mg/L' },
  ammonia_nitrogen: { label: '氨氮', unit: 'mg/L' },
  total_phosphorus: { label: '总磷', unit: 'mg/L' },
  total_nitrogen: { label: '总氮', unit: 'mg/L' },
  permanganate_index: { label: '高锰酸盐指数', unit: 'mg/L' },
  transparency: { label: '透明度', unit: 'cm' },
  chlorophyll_a: { label: '叶绿素a', unit: 'μg/L' },
  algae_density: { label: '藻密度', unit: '万cells/L' },
  flow_rate: { label: '流速', unit: 'm/s' },
  water_level: { label: '水位', unit: 'm' },
  air_pressure: { label: '气压', unit: 'hPa' },
  illuminance: { label: '光照', unit: 'lux' },
  air_temperature: { label: '气温', unit: '°C' },
  humidity: { label: '湿度', unit: '%' },
};

// 可绘图的水质字段
const chartableFields = [
  'ph', 'dissolved_oxygen', 'turbidity', 'conductivity', 'water_temperature',
  'cod', 'ammonia_nitrogen', 'total_phosphorus', 'total_nitrogen',
  'permanganate_index', 'chlorophyll_a', 'water_level', 'flow_rate',
];

const mqttStatusConfig: Record<string, { text: string; color: string }> = {
  connected: { text: '已连接', color: 'success' },
  disconnected: { text: '已断开', color: 'default' },
  connecting: { text: '连接中', color: 'processing' },
  error: { text: '错误', color: 'error' },
};

export default function StationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // 站点基础信息
  const [station, setStation] = useState<any>(null);
  const [stationLoading, setStationLoading] = useState(true);

  // 最新数据
  const [latestData, setLatestData] = useState<any>(null);
  const [latestLoading, setLatestLoading] = useState(false);

  // 历史数据
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(7, 'day'),
    dayjs(),
  ]);
  const [selectedFields, setSelectedFields] = useState<string[]>(['ph', 'dissolved_oxygen', 'cod']);

  // MQTT 连接
  const [mqttConns, setMqttConns] = useState<any[]>([]);
  const [mqttLoading, setMqttLoading] = useState(false);
  const [bindingOpen, setBindingOpen] = useState(false);
  const [bindingEditing, setBindingEditing] = useState<any>(null);
  const [testingConnId, setTestingConnId] = useState<string | null>(null);

  // 预警
  const [alerts, setAlerts] = useState<any[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);

  // 获取站点基础信息
  const fetchStation = useCallback(async () => {
    if (!id) return;
    setStationLoading(true);
    try {
      const res: any = await stationApi.getStation(id);
      setStation(res);
    } catch {
      message.error('获取站点信息失败');
    } finally {
      setStationLoading(false);
    }
  }, [id]);

  // 获取最新数据
  const fetchLatestData = useCallback(async () => {
    if (!id) return;
    setLatestLoading(true);
    try {
      const res: any = await dataApi.getLatestData(id);
      // 后端可能返回 {data: null} 或直接返回数据对象
      if (res?.data === null || res?.message) {
        setLatestData(null);
      } else {
        setLatestData(res);
      }
    } catch {
      // TDengine 可能未就绪
      setLatestData(null);
    } finally {
      setLatestLoading(false);
    }
  }, [id]);

  // 获取历史数据
  const fetchHistoryData = useCallback(async () => {
    if (!id || !dateRange) return;
    setHistoryLoading(true);
    try {
      const res: any = await dataApi.getHistoryData(id, {
        start_time: dateRange[0].toISOString(),
        end_time: dateRange[1].toISOString(),
      });
      setHistoryData(res?.data || []);
    } catch {
      setHistoryData([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [id, dateRange]);

  // 获取 MQTT 连接
  const fetchMqttConns = useCallback(async () => {
    if (!id) return;
    setMqttLoading(true);
    try {
      const res: any = await mqttApi.getConnectionsByStation(id);
      setMqttConns(res?.connections || []);
    } catch {
      setMqttConns([]);
    } finally {
      setMqttLoading(false);
    }
  }, [id]);

  // 获取预警
  const fetchAlerts = useCallback(async () => {
    if (!id) return;
    setAlertsLoading(true);
    try {
      const res: any = await alertApi.getAlerts({ station_id: id, limit: 20 });
      setAlerts(res?.items || res?.alerts || []);
    } catch {
      setAlerts([]);
    } finally {
      setAlertsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchStation();
    fetchLatestData();
    fetchMqttConns();
    fetchAlerts();
  }, [fetchStation, fetchLatestData, fetchMqttConns, fetchAlerts]);

  const handleRefresh = () => {
    fetchStation();
    fetchLatestData();
    fetchMqttConns();
    fetchAlerts();
  };

  // 构建历史趋势图表配置
  const getChartOption = () => {
    if (!historyData.length) return {};

    const colors = ['#0891b2', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    const series = selectedFields.map((field, idx) => {
      const info = fieldLabelMap[field] || { label: field, unit: '' };
      return {
        name: info.label,
        type: 'line',
        smooth: true,
        data: historyData.map((d: any) => d[field] ?? null),
        itemStyle: { color: colors[idx % colors.length] },
        connectNulls: true,
      };
    });

    return {
      tooltip: { trigger: 'axis' },
      legend: {
        data: selectedFields.map((f) => (fieldLabelMap[f]?.label || f)),
      },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        data: historyData.map((d: any) =>
          d.ts ? dayjs(d.ts).format('MM-DD HH:mm') : ''
        ),
      },
      yAxis: { type: 'value' },
      series,
    };
  };

  // 渲染最新数据卡片
  const renderLatestMetrics = () => {
    if (latestLoading) return <Spin indicator={<LoadingOutlined />} />;
    if (!latestData) return <Empty description="暂无实时数据（TDengine 可能未连接）" />;

    const metrics = Object.entries(latestData)
      .filter(([key]) => fieldLabelMap[key] && latestData[key] != null)
      .map(([key, value]) => ({
        key,
        label: fieldLabelMap[key].label,
        value: typeof value === 'number' ? value.toFixed(2) : value,
        unit: fieldLabelMap[key].unit,
      }));

    if (!metrics.length) return <Empty description="暂无监测指标数据" />;

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {metrics.map((item) => (
          <div key={item.key} className="p-4 rounded-xl bg-gray-50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-500">{item.label}</span>
            </div>
            <div className="text-2xl font-semibold text-gray-900">
              {String(item.value)}
              <span className="text-sm font-normal text-gray-500 ml-1">{item.unit}</span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // 数据源绑定 Tab 动作
  const handleAddBinding = () => {
    setBindingEditing(null);
    setBindingOpen(true);
  };
  const handleEditBinding = (conn: any) => {
    setBindingEditing(conn);
    setBindingOpen(true);
  };
  const handleUnbind = async (conn: any) => {
    try {
      await mqttApi.updateConnection(conn.id, { station_id: null, station_name: null });
      message.success('已解除绑定');
      fetchMqttConns();
    } catch {
      message.error('解绑失败');
    }
  };
  const handleTestConn = async (connId: string) => {
    setTestingConnId(connId);
    try {
      const res: any = await mqttApi.testConnection(connId);
      if (res?.success) message.success('连接测试成功');
      else message.warning(`测试失败：${res?.message || '未知'}`);
    } catch {
      message.error('测试请求失败');
    } finally {
      setTestingConnId(null);
    }
  };
  const handleStartConn = async (connId: string) => {
    try {
      await mqttApi.startConnection(connId);
      message.success('订阅已启动');
      fetchMqttConns();
    } catch {
      message.error('启动失败');
    }
  };
  const handleStopConn = async (connId: string) => {
    try {
      await mqttApi.stopConnection(connId);
      message.success('订阅已停止');
      fetchMqttConns();
    } catch {
      message.error('停止失败');
    }
  };

  // 渲染数据源绑定 Tab：模块矩阵 + 详细列表
  const renderBindings = () => {
    // topic 已统一（water_environment/sensors/data），模块完全以后端 module_keys 为准
    const keysOfConn = (c: any): string[] => (Array.isArray(c?.module_keys) ? c.module_keys : []);
    const boundByModule: Record<string, any[]> = {};
    const unconfigured: any[] = [];
    mqttConns.forEach((c) => {
      const keys = keysOfConn(c);
      if (keys.length) {
        keys.forEach((k) => {
          (boundByModule[k] = boundByModule[k] || []).push(c);
        });
      } else {
        unconfigured.push(c);
      }
    });

    return (
      <Spin spinning={mqttLoading}>
        {/* 顶部操作 */}
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-gray-500">
            已绑定 <b className="text-gray-900">{mqttConns.length}</b> 个数据源
            {unconfigured.length > 0 && (
              <span className="ml-2 text-amber-600">
                （其中 <b>{unconfigured.length}</b> 条未配置模块，请编辑补全）
              </span>
            )}
          </div>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchMqttConns}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddBinding}>
              新增绑定
            </Button>
          </Space>
        </div>

        {/* 模块矩阵：速览哪些模块已绑 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {MQTT_MODULES.map((m) => {
            const bound = boundByModule[m.key] || [];
            const hasBound = bound.length > 0;
            return (
              <div
                key={m.key}
                className={`p-3 rounded-xl border ${hasBound ? 'border-cyan-200 bg-cyan-50' : 'border-dashed border-gray-200 bg-gray-50'}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-gray-900">{m.label}</span>
                  <Tag color={hasBound ? m.color : 'default'}>{m.key.toUpperCase()}</Tag>
                </div>
                <div className="text-xs text-gray-500">
                  {hasBound ? `${bound.length} 个绑定` : '未绑定'}
                </div>
              </div>
            );
          })}
        </div>

        {/* 详细列表 */}
        {mqttConns.length === 0 ? (
          <Empty description="该站点暂未绑定 MQTT 数据源">
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddBinding}>
              新增第一个绑定
            </Button>
          </Empty>
        ) : (
          <div className="space-y-3">
            {mqttConns.map((conn: any) => {
              const cfg = mqttStatusConfig[conn.status] || mqttStatusConfig.disconnected;
              const connKeys = keysOfConn(conn);
              const isConnected = conn.status === 'connected';
              return (
                <div
                  key={conn.id}
                  className={`p-4 rounded-xl border bg-white ${connKeys.length ? 'border-gray-100' : 'border-amber-200 bg-amber-50/40'}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-medium text-gray-900">{conn.name || conn.id}</span>
                        {connKeys.length === 0 && (
                          <Tag
                            color="warning"
                            className="cursor-pointer"
                            onClick={() => handleEditBinding(conn)}
                          >
                            未配置模块·点击补全
                          </Tag>
                        )}
                        {connKeys.map((mk) => {
                          const modLabel = MQTT_MODULES.find((m) => m.key === mk)?.label;
                          return (
                            <Tag key={mk} color="cyan">
                              {mk.toUpperCase()}{modLabel ? ` · ${modLabel}` : ''}
                            </Tag>
                          );
                        })}
                        <Tag color={cfg.color}>{cfg.text}</Tag>
                      </div>
                      <div className="text-sm text-gray-500 break-all">
                        {conn.broker_host}:{conn.broker_port} / {conn.topic}
                      </div>
                    </div>
                    <Space>
                      <Tooltip title="测试连接">
                        <Button
                          size="small"
                          icon={<ExperimentOutlined />}
                          loading={testingConnId === conn.id}
                          onClick={() => handleTestConn(conn.id)}
                        />
                      </Tooltip>
                      {isConnected ? (
                        <Tooltip title="停止订阅">
                          <Button size="small" danger icon={<PauseCircleOutlined />} onClick={() => handleStopConn(conn.id)} />
                        </Tooltip>
                      ) : (
                        <Tooltip title="启动订阅">
                          <Button size="small" style={{ color: '#10b981' }} icon={<PlayCircleOutlined />} onClick={() => handleStartConn(conn.id)} />
                        </Tooltip>
                      )}
                      <Tooltip title="编辑">
                        <Button size="small" icon={<EditOutlined />} onClick={() => handleEditBinding(conn)} />
                      </Tooltip>
                      <Popconfirm
                        title="确定解除该站点与此连接的绑定？连接本身保留。"
                        onConfirm={() => handleUnbind(conn)}
                        okText="解绑"
                        cancelText="取消"
                      >
                        <Tooltip title="解除绑定">
                          <Button size="small" danger icon={<DisconnectOutlined />} />
                        </Tooltip>
                      </Popconfirm>
                    </Space>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Spin>
    );
  };

  if (stationLoading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Spin size="large" tip="加载站点信息..." />
      </div>
    );
  }

  const stationInfo = station || {};
  const sStatus = statusMap[stationInfo.status] || { text: stationInfo.status || '未知', color: 'default' };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/stations')}>
            返回
          </Button>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              {stationInfo.station_name || '未知站点'}
            </h1>
            <p className="text-sm text-gray-500">{stationInfo.station_code || id}</p>
          </div>
          <Tag color={sStatus.color}>{sStatus.text}</Tag>
        </div>
        <Button icon={<ReloadOutlined />} onClick={handleRefresh}>刷新数据</Button>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <GlassCard className="p-5">
          <div className="flex items-center gap-3">
            <EnvironmentOutlined className="text-2xl text-cyan-500" />
            <div>
              <p className="text-sm text-gray-500">位置</p>
              <p className="font-medium text-gray-900">
                {stationInfo.region || stationInfo.address || '未设置'}
              </p>
            </div>
          </div>
        </GlassCard>
        <GlassCard className="p-5">
          <div className="flex items-center gap-3">
            <DashboardOutlined className="text-2xl text-blue-500" />
            <div>
              <p className="text-sm text-gray-500">站点类型</p>
              <p className="font-medium text-gray-900">
                {typeMap[stationInfo.station_type] || stationInfo.station_type || '未知'}
              </p>
            </div>
          </div>
        </GlassCard>
        <GlassCard className="p-5">
          <div className="flex items-center gap-3">
            <EnvironmentOutlined className="text-2xl text-green-500" />
            <div>
              <p className="text-sm text-gray-500">经纬度</p>
              <p className="font-medium text-gray-900">
                {stationInfo.longitude?.toFixed(4) ?? '-'}, {stationInfo.latitude?.toFixed(4) ?? '-'}
              </p>
            </div>
          </div>
        </GlassCard>
        <GlassCard className="p-5">
          <div className="flex items-center gap-3">
            <WifiOutlined className="text-2xl text-purple-500" />
            <div>
              <p className="text-sm text-gray-500">MQTT数据源</p>
              <p className="font-medium text-gray-900">
                {mqttLoading ? '加载中...' : `${mqttConns.length} 个连接`}
              </p>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Main Content Tabs */}
      <GlassCard className="p-6">
        <Tabs
          defaultActiveKey="realtime"
          items={[
            {
              key: 'realtime',
              label: <span><DashboardOutlined /> 实时数据</span>,
              children: renderLatestMetrics(),
            },
            {
              key: 'history',
              label: <span><HistoryOutlined /> 历史趋势</span>,
              children: (
                <div className="space-y-4">
                  <div className="flex items-center gap-4 flex-wrap">
                    <RangePicker
                      value={dateRange}
                      onChange={(dates) => {
                        if (dates && dates[0] && dates[1]) {
                          setDateRange([dates[0], dates[1]]);
                        }
                      }}
                      showTime
                    />
                    <Select
                      mode="multiple"
                      value={selectedFields}
                      onChange={setSelectedFields}
                      style={{ minWidth: 300 }}
                      placeholder="选择监测指标"
                      options={chartableFields.map((f) => ({
                        value: f,
                        label: fieldLabelMap[f]?.label || f,
                      }))}
                      maxTagCount={3}
                    />
                    <Button type="primary" onClick={fetchHistoryData} loading={historyLoading}>
                      查询
                    </Button>
                  </div>
                  {historyData.length > 0 ? (
                    <ReactECharts option={getChartOption()} style={{ height: '400px' }} />
                  ) : (
                    <Empty description="暂无历史数据，请点击查询" />
                  )}
                </div>
              ),
            },
            {
              key: 'bindings',
              label: <span><ApiOutlined /> 数据源绑定</span>,
              children: renderBindings(),
            },
            {
              key: 'alerts',
              label: <span><AlertOutlined /> 预警记录</span>,
              children: (
                <Spin spinning={alertsLoading}>
                  {alerts.length === 0 ? (
                    <Empty description="暂无预警记录" />
                  ) : (
                    <div className="space-y-3">
                      {alerts.map((alert: any, idx: number) => (
                        <div key={alert.id || idx} className="p-4 rounded-xl bg-gray-50 flex items-center justify-between">
                          <div>
                            <div className="font-medium text-gray-900">
                              {alert.alert_type || alert.type || '预警'}
                            </div>
                            <div className="text-sm text-gray-500 mt-1">
                              {alert.message || alert.content || '无详细描述'}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm text-gray-500">
                              {alert.created_at ? dayjs(alert.created_at).format('YYYY-MM-DD HH:mm') : '-'}
                            </div>
                            <Tag color={alert.status === 'resolved' ? 'green' : alert.status === 'confirmed' ? 'blue' : 'orange'}>
                              {alert.status === 'resolved' ? '已解决' : alert.status === 'confirmed' ? '已确认' : '待处理'}
                            </Tag>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Spin>
              ),
            },
            {
              key: 'info',
              label: <span><EnvironmentOutlined /> 基础信息</span>,
              children: (
                <Descriptions bordered column={2} size="middle">
                  <Descriptions.Item label="站点名称">{stationInfo.station_name || '-'}</Descriptions.Item>
                  <Descriptions.Item label="站点编码">{stationInfo.station_code || '-'}</Descriptions.Item>
                  <Descriptions.Item label="站点类型">{typeMap[stationInfo.station_type] || stationInfo.station_type || '-'}</Descriptions.Item>
                  <Descriptions.Item label="监测状态">
                    <Tag color={sStatus.color}>{sStatus.text}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="所属区域">{stationInfo.region || '-'}</Descriptions.Item>
                  <Descriptions.Item label="详细地址">{stationInfo.address || '-'}</Descriptions.Item>
                  <Descriptions.Item label="经度">{stationInfo.longitude?.toFixed(6) ?? '-'}</Descriptions.Item>
                  <Descriptions.Item label="纬度">{stationInfo.latitude?.toFixed(6) ?? '-'}</Descriptions.Item>
                  <Descriptions.Item label="创建时间">
                    {stationInfo.created_at ? dayjs(stationInfo.created_at).format('YYYY-MM-DD HH:mm:ss') : '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="更新时间">
                    {stationInfo.updated_at ? dayjs(stationInfo.updated_at).format('YYYY-MM-DD HH:mm:ss') : '-'}
                  </Descriptions.Item>
                </Descriptions>
              ),
            },
          ]}
        />
      </GlassCard>

      {/* 数据源绑定弹窗 */}
      <BindingEditorModal
        open={bindingOpen}
        onClose={() => setBindingOpen(false)}
        onSuccess={() => {
          setBindingOpen(false);
          fetchMqttConns();
        }}
        editing={bindingEditing}
        stationId={id}
        stationCode={stationInfo.station_code}
        stationName={stationInfo.station_name}
        existingConnections={mqttConns}
      />
    </div>
  );
}

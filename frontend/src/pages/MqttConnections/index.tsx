import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Table,
  Tag,
  Space,
  Select,
  message,
  Popconfirm,
  Tooltip,
  Input,
} from 'antd';
import {
  PlusOutlined,
  ApiOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  ExperimentOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { mqttApi, stationApi } from '../../services/api';
import BindingEditorModal from './BindingEditorModal';
import { MQTT_MODULES, MODULE_LABEL_MAP } from '../../constants/mqttModules';

interface MqttConnection {
  id: string;
  name: string;
  broker_host: string;
  broker_port: number;
  topic: string;
  username?: string;
  password?: string;
  client_id?: string;
  qos: number;
  station_id?: string;
  station_name?: string;
  status: 'disconnected' | 'connected' | 'connecting' | 'error';
  created_at: string;
  last_active_at?: string;
  error_message?: string;
}

interface StationOption {
  id: string;
  station_name: string;
  station_code: string;
}

const statusConfig: Record<string, { text: string; color: string }> = {
  connected: { text: '已连接', color: 'success' },
  disconnected: { text: '已断开', color: 'default' },
  connecting: { text: '连接中', color: 'processing' },
  error: { text: '错误', color: 'error' },
};

const STATION_FILTER_ALL = '__all__';
const STATION_FILTER_UNBOUND = '__unbound__';

export default function MqttConnections() {
  const navigate = useNavigate();
  const [connections, setConnections] = useState<MqttConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConn, setEditingConn] = useState<MqttConnection | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [stationOptions, setStationOptions] = useState<StationOption[]>([]);
  const [stationFilter, setStationFilter] = useState<string>(STATION_FILTER_ALL);
  const [moduleFilter, setModuleFilter] = useState<string | undefined>(undefined);
  const [keyword, setKeyword] = useState<string>('');

  const fetchConnections = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await mqttApi.getConnections();
      setConnections(res.connections || []);
    } catch {
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStations = useCallback(async () => {
    try {
      const res: any = await stationApi.getStations({ limit: 1000 });
      const items = res?.items ?? res?.data?.items ?? [];
      setStationOptions(items);
    } catch {
      setStationOptions([]);
    }
  }, []);

  useEffect(() => {
    fetchConnections();
    fetchStations();
  }, [fetchConnections, fetchStations]);

  const handleAdd = () => {
    setEditingConn(null);
    setModalOpen(true);
  };

  const handleEdit = (record: MqttConnection) => {
    setEditingConn(record);
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await mqttApi.deleteConnection(id);
      message.success('已删除');
      fetchConnections();
    } catch {
      message.error('删除失败');
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const res: any = await mqttApi.testConnection(id);
      if (res.success) message.success('连接测试成功');
      else message.warning(`连接测试失败: ${res.message}`);
    } catch {
      message.error('测试请求失败');
    } finally {
      setTestingId(null);
    }
  };

  const handleStart = async (id: string) => {
    try {
      await mqttApi.startConnection(id);
      message.success('订阅已启动');
      fetchConnections();
    } catch (err: any) {
      message.error('启动失败: ' + (err.response?.data?.detail || '未知错误'));
    }
  };

  const handleStop = async (id: string) => {
    try {
      await mqttApi.stopConnection(id);
      message.success('订阅已停止');
      fetchConnections();
    } catch {
      message.error('停止失败');
    }
  };

  // 统一取一条连接的模块 keys：topic 已统一，仅以后端 module_keys 为准
  const keysOfConn = (c: any): string[] => (Array.isArray(c?.module_keys) ? c.module_keys : []);

  // 筛选
  const filteredConnections = useMemo(() => {
    return connections.filter((c) => {
      if (stationFilter === STATION_FILTER_UNBOUND) {
        if (c.station_id) return false;
      } else if (stationFilter !== STATION_FILTER_ALL) {
        if (c.station_id !== stationFilter) return false;
      }
      if (moduleFilter) {
        const mks = keysOfConn(c);
        if (!mks.includes(moduleFilter)) return false;
      }
      if (keyword) {
        const kw = keyword.trim().toLowerCase();
        const hit =
          (c.name || '').toLowerCase().includes(kw) ||
          (c.topic || '').toLowerCase().includes(kw) ||
          (c.broker_host || '').toLowerCase().includes(kw);
        if (!hit) return false;
      }
      return true;
    });
  }, [connections, stationFilter, moduleFilter, keyword]);

  // 统计：未绑定数量
  const unboundCount = useMemo(
    () => connections.filter((c) => !c.station_id).length,
    [connections],
  );

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 140,
      render: (text: string) => text || '-',
    },
    {
      title: '绑定站点',
      key: 'station',
      width: 180,
      render: (_: any, record: MqttConnection) =>
        record.station_id ? (
          <a onClick={() => navigate(`/stations/${record.station_id}`)} className="text-cyan-600">
            {record.station_name || record.station_id}
          </a>
        ) : (
          <Tag color="warning">未绑定</Tag>
        ),
    },
    {
      title: '模块',
      key: 'module',
      width: 200,
      render: (_: any, record: MqttConnection) => {
        const mks = keysOfConn(record);
        if (!mks.length) return <span className="text-gray-300">-</span>;
        return (
          <Space size={[4, 4]} wrap>
            {mks.map((mk) => (
              <Tag key={mk} color="blue">
                {mk.toUpperCase()}{MODULE_LABEL_MAP[mk] ? ` · ${MODULE_LABEL_MAP[mk]}` : ''}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: 'Broker',
      key: 'broker',
      width: 180,
      render: (_: any, record: MqttConnection) =>
        `${record.broker_host}:${record.broker_port}`,
    },
    {
      title: 'Topic',
      dataIndex: 'topic',
      key: 'topic',
      width: 260,
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const cfg = statusConfig[status] || statusConfig.disconnected;
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '最后活跃',
      dataIndex: 'last_active_at',
      key: 'last_active_at',
      width: 180,
      render: (text: string) => (text ? new Date(text).toLocaleString() : '-'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      render: (_: any, record: MqttConnection) => (
        <Space size="small">
          <Tooltip title="测试连接">
            <Button
              type="text"
              size="small"
              icon={<ExperimentOutlined />}
              loading={testingId === record.id}
              onClick={() => handleTest(record.id)}
            />
          </Tooltip>
          {record.status === 'connected' ? (
            <Tooltip title="停止订阅">
              <Button type="text" size="small" danger icon={<PauseCircleOutlined />} onClick={() => handleStop(record.id)} />
            </Tooltip>
          ) : (
            <Tooltip title="启动订阅">
              <Button
                type="text"
                size="small"
                style={{ color: '#10b981' }}
                icon={<PlayCircleOutlined />}
                onClick={() => handleStart(record.id)}
              />
            </Tooltip>
          )}
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          </Tooltip>
          <Popconfirm
            title="确定删除此连接？"
            onConfirm={() => handleDelete(record.id)}
            okText="删除"
            cancelText="取消"
          >
            <Tooltip title="删除">
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ApiOutlined className="text-cyan-500" />
            MQTT 连接管理
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            管理外部 MQTT 数据源连接，按站点/模块筛选；未绑定连接 {unboundCount} 个
          </p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchConnections}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            新增连接
          </Button>
        </Space>
      </div>

      {/* 筛选工具条 */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 flex flex-wrap items-center gap-3">
        <Select
          value={stationFilter}
          onChange={setStationFilter}
          style={{ width: 260 }}
          showSearch
          optionFilterProp="label"
          options={[
            { value: STATION_FILTER_ALL, label: '全部站点' },
            { value: STATION_FILTER_UNBOUND, label: `⚠️ 未绑定（${unboundCount}）` },
            ...stationOptions.map((s) => ({
              value: s.id,
              label: `${s.station_name} (${s.station_code})`,
            })),
          ]}
        />
        <Select
          value={moduleFilter}
          onChange={setModuleFilter}
          style={{ width: 200 }}
          allowClear
          placeholder="筛选模块类型"
          options={MQTT_MODULES.map((m) => ({
            value: m.key,
            label: `${m.key.toUpperCase()} - ${m.label}`,
          }))}
        />
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索名称 / topic / broker"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 260 }}
        />
        <span className="text-sm text-gray-500 ml-auto">
          共 <b className="text-gray-900">{filteredConnections.length}</b> / {connections.length} 条
        </span>
      </div>

      {/* 连接列表 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <Table
          columns={columns}
          dataSource={filteredConnections}
          rowKey="id"
          loading={loading}
          pagination={false}
          locale={{ emptyText: '暂无匹配连接，请调整筛选或新增连接' }}
        />
      </div>

      {/* 新增/编辑弹窗（共享组件） */}
      <BindingEditorModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={() => {
          setModalOpen(false);
          fetchConnections();
        }}
        editing={editingConn || undefined}
        existingConnections={connections}
      />
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { Tabs, Table, Tag, Space, Button, Card, Statistic, Empty } from 'antd';
import {
  DatabaseOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  CloudServerOutlined,
} from '@ant-design/icons';
import { mqttApi } from '../../services/api';

interface MessageEntry {
  conn_id: string;
  receive_time: string;
  topic: string;
  module_types: string[];
  raw: Record<string, any>;
  water_quality_count: number;
  environment_count: number;
}

interface DataStats {
  total_messages: number;
  total_water_quality_records: number;
  total_environment_records: number;
  last_receive_time: string | null;
  buffer_size: number;
  active_subscribers: number;
  errors: number;
}

const MODULE_LABELS: Record<string, string> = {
  m1: '水质基础 (pH/电导率/水温)',
  m2: '营养盐 (氨氮/总磷/总氮)',
  m3: '生物 (溶解氧/叶绿素/蓝绿藻)',
  m4: '水文 (透明度/流速/流量/水位)',
  ap: '气压',
  ill: '光照',
  th: '温湿度',
};

const MODULE_COLORS: Record<string, string> = {
  m1: 'blue',
  m2: 'green',
  m3: 'purple',
  m4: 'cyan',
  ap: 'orange',
  ill: 'gold',
  th: 'magenta',
};

export default function MqttData() {
  const [messages, setMessages] = useState<MessageEntry[]>([]);
  const [stats, setStats] = useState<DataStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [msgRes, statsRes]: any[] = await Promise.all([
        mqttApi.getLatestData({ limit: 100 }),
        mqttApi.getDataStatistics(),
      ]);
      setMessages(msgRes.messages || []);
      setStats(statsRes);
    } catch {
      setMessages([]);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // 自动刷新每10秒
    const timer = setInterval(fetchData, 10000);
    return () => clearInterval(timer);
  }, [fetchData]);

  const filteredMessages = activeTab === 'all'
    ? messages
    : messages.filter(m => m.module_types.includes(activeTab));

  const columns = [
    {
      title: '接收时间',
      dataIndex: 'receive_time',
      key: 'receive_time',
      width: 200,
      render: (text: string) => new Date(text).toLocaleString(),
    },
    {
      title: '模块类型',
      dataIndex: 'module_types',
      key: 'module_types',
      width: 260,
      render: (types: string[]) => (
        <Space size={[4, 4]} wrap>
          {types.map(t => (
            <Tag key={t} color={MODULE_COLORS[t] || 'default'}>
              {MODULE_LABELS[t] || t}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '水质记录数',
      dataIndex: 'water_quality_count',
      key: 'wq_count',
      width: 100,
      render: (n: number) => n > 0 ? <Tag color="blue">{n}</Tag> : '-',
    },
    {
      title: '环境记录数',
      dataIndex: 'environment_count',
      key: 'env_count',
      width: 100,
      render: (n: number) => n > 0 ? <Tag color="green">{n}</Tag> : '-',
    },
    {
      title: '连接ID',
      dataIndex: 'conn_id',
      key: 'conn_id',
      width: 100,
      ellipsis: true,
    },
    {
      title: '原始数据',
      dataIndex: 'raw',
      key: 'raw',
      ellipsis: true,
      render: (raw: any) => (
        <span className="text-xs text-gray-500 font-mono">
          {JSON.stringify(raw).slice(0, 120)}...
        </span>
      ),
    },
  ];

  const tabItems = [
    { key: 'all', label: '全部' },
    { key: 'm1', label: '水质基础' },
    { key: 'm2', label: '营养盐' },
    { key: 'm3', label: '生物' },
    { key: 'm4', label: '水文' },
    { key: 'ap', label: '气压' },
    { key: 'ill', label: '光照' },
    { key: 'th', label: '温湿度' },
  ];

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <DatabaseOutlined className="text-cyan-500" />
            MQTT 数据查看
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            查看通过 MQTT 接收到的传感器数据，支持按模块类型筛选
          </p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>
          刷新
        </Button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card size="small" className="shadow-sm">
          <Statistic
            title="总消息数"
            value={stats?.total_messages || 0}
            prefix={<CloudServerOutlined className="text-blue-500" />}
          />
        </Card>
        <Card size="small" className="shadow-sm">
          <Statistic
            title="水质记录"
            value={stats?.total_water_quality_records || 0}
            prefix={<ThunderboltOutlined className="text-cyan-500" />}
          />
        </Card>
        <Card size="small" className="shadow-sm">
          <Statistic
            title="环境记录"
            value={stats?.total_environment_records || 0}
            prefix={<ThunderboltOutlined className="text-green-500" />}
          />
        </Card>
        <Card size="small" className="shadow-sm">
          <Statistic
            title="活跃订阅"
            value={stats?.active_subscribers || 0}
            prefix={<CloudServerOutlined className="text-purple-500" />}
          />
        </Card>
        <Card size="small" className="shadow-sm">
          <Statistic
            title="最后接收"
            value={
              stats?.last_receive_time
                ? new Date(stats.last_receive_time).toLocaleTimeString()
                : '-'
            }
            prefix={<ClockCircleOutlined className="text-orange-500" />}
          />
        </Card>
      </div>

      {/* 数据表格 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={tabItems}
          className="px-4 pt-2"
        />
        <Table
          columns={columns}
          dataSource={filteredMessages}
          rowKey={(_, index) => String(index)}
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
          scroll={{ x: 1000 }}
          locale={{ emptyText: <Empty description="暂无数据，请先在连接管理中启动 MQTT 订阅" /> }}
          expandable={{
            expandedRowRender: (record) => (
              <pre className="text-xs bg-gray-50 p-4 rounded-lg overflow-auto max-h-64 font-mono">
                {JSON.stringify(record.raw, null, 2)}
              </pre>
            ),
            rowExpandable: (record) => !!record.raw,
          }}
        />
      </div>
    </div>
  );
}

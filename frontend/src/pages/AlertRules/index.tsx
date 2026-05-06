import { useState, useEffect } from 'react';
import {
  BellOutlined,
  SearchOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  PauseCircleOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  NotificationOutlined,
  MailOutlined,
  MessageOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Button, Input, Table, Tag, Switch, Modal, Form, Select, message, Popconfirm } from 'antd';
import { GlassCard } from '../../components/GlassCard';
import { alertApi } from '../../services/api';

const { TextArea } = Input;

interface AlertRule {
  id: string;
  rule_name: string;
  rule_type: string;
  station_ids?: string[] | null;
  metric_codes?: string[] | null;
  conditions: Record<string, any>;
  alert_level: string;
  notification_channels: string[];
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

const metrics = [
  { value: 'ph', label: 'pH值' },
  { value: 'do', label: '溶解氧' },
  { value: 'cod', label: 'COD' },
  { value: 'nh3n', label: '氨氮' },
  { value: 'tp', label: '总磷' },
  { value: 'turbidity', label: '浊度' },
  { value: 'conductivity', label: '电导率' },
  { value: 'temperature', label: '温度' },
];

const conditions = [
  { value: 'gt', label: '大于' },
  { value: 'lt', label: '小于' },
  { value: 'eq', label: '等于' },
  { value: 'range', label: '范围外' },
];

const levels = [
  { value: 'low', label: '提示', color: 'blue' },
  { value: 'medium', label: '警告', color: 'orange' },
  { value: 'high', label: '严重', color: 'red' },
  { value: 'critical', label: '紧急', color: 'red' },
];

function formatConditionsSummary(c: Record<string, any>): { condition: string; threshold: string } {
  if (!c) return { condition: '-', threshold: '-' };
  const op = c.operator || c.condition;
  const condLabel = conditions.find((x) => x.value === op)?.label || op || '-';
  if (op === 'range') {
    return { condition: '范围外', threshold: `${c.min ?? ''} - ${c.max ?? ''}` };
  }
  return { condition: condLabel, threshold: String(c.threshold ?? c.value ?? '-') };
}

function formatDate(s?: string) {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('zh-CN');
}

export default function AlertRules() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [form] = Form.useForm();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');

  const loadRules = async () => {
    setLoading(true);
    try {
      const res: any = await alertApi.getAlertRules({ size: 100 });
      const items = (res?.items || res?.data?.items || res?.data || []) as AlertRule[];
      setRules(Array.isArray(items) ? items : []);
    } catch (err) {
      console.error('加载预警规则失败', err);
      setRules([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  const handleAdd = () => {
    setEditingRule(null);
    form.resetFields();
    form.setFieldsValue({ rule_type: 'threshold', alert_level: 'medium' });
    setIsModalOpen(true);
  };

  const handleEdit = (record: AlertRule) => {
    setEditingRule(record);
    const summary = formatConditionsSummary(record.conditions);
    form.setFieldsValue({
      rule_name: record.rule_name,
      rule_type: record.rule_type,
      metric: record.metric_codes?.[0],
      condition: record.conditions?.operator || record.conditions?.condition,
      threshold:
        summary.threshold !== '-' ? summary.threshold : String(record.conditions?.threshold ?? ''),
      alert_level: record.alert_level,
      stations: record.station_ids || [],
      notification_channels: record.notification_channels || [],
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await alertApi.deleteAlertRule(id);
      message.success('删除成功');
      loadRules();
    } catch (err) {
      console.error(err);
      message.error('删除失败');
    }
  };

  const handleToggle = async (rule: AlertRule, enabled: boolean) => {
    try {
      await alertApi.updateAlertRule(rule.id, { is_enabled: enabled });
      message.success(enabled ? '规则已启用' : '规则已停用');
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, is_enabled: enabled } : r)));
    } catch (err) {
      console.error(err);
      message.error('操作失败');
    }
  };

  const buildConditions = (values: any): Record<string, any> => {
    const op = values.condition;
    if (op === 'range') {
      const parts = String(values.threshold || '').split(/[-~]/).map((s) => s.trim());
      return { operator: 'range', min: Number(parts[0]) || 0, max: Number(parts[1]) || 0 };
    }
    return { operator: op, threshold: Number(values.threshold) };
  };

  const handleModalOk = () => {
    form
      .validateFields()
      .then(async (values) => {
        const payload = {
          rule_name: values.rule_name,
          rule_type: values.rule_type || 'threshold',
          metric_codes: values.metric ? [values.metric] : [],
          station_ids: Array.isArray(values.stations)
            ? values.stations.filter((s: string) => s !== 'all')
            : [],
          conditions: buildConditions(values),
          alert_level: values.alert_level,
          notification_channels: values.notification_channels || [],
        };
        try {
          if (editingRule) {
            await alertApi.updateAlertRule(editingRule.id, payload);
            message.success('更新成功');
          } else {
            await alertApi.createAlertRule(payload);
            message.success('创建成功');
          }
          setIsModalOpen(false);
          loadRules();
        } catch (err) {
          console.error(err);
          message.error(editingRule ? '更新失败' : '创建失败');
        }
      })
      .catch(() => {});
  };

  const filteredRules = keyword
    ? rules.filter((r) => r.rule_name?.toLowerCase().includes(keyword.toLowerCase()))
    : rules;

  const columns = [
    {
      title: '规则名称',
      dataIndex: 'rule_name',
      key: 'rule_name',
      render: (text: string, record: AlertRule) => (
        <div>
          <p className="font-medium text-gray-900">{text}</p>
          <p className="text-xs text-gray-500">
            {record.metric_codes?.join(', ') || record.rule_type}
          </p>
        </div>
      ),
    },
    {
      title: '触发条件',
      key: 'condition',
      render: (_: any, record: AlertRule) => {
        const { condition, threshold } = formatConditionsSummary(record.conditions);
        return (
          <span>
            {condition} {threshold}
          </span>
        );
      },
    },
    {
      title: '级别',
      dataIndex: 'alert_level',
      key: 'alert_level',
      render: (level: string) => {
        const levelConfig = levels.find((l) => l.value === level) || {
          label: level,
          color: 'default',
        };
        return (
          <Tag color={levelConfig.color}>
            {level === 'low' && <InfoCircleOutlined className="mr-1" />}
            {(level === 'medium' || level === 'high') && <WarningOutlined className="mr-1" />}
            {level === 'critical' && <BellOutlined className="mr-1" />}
            {levelConfig.label}
          </Tag>
        );
      },
    },
    {
      title: '通知方式',
      dataIndex: 'notification_channels',
      key: 'notification_channels',
      render: (notify: string[] = []) => (
        <div className="flex gap-1">
          {notify.includes('app') && <NotificationOutlined className="text-cyan-500" />}
          {notify.includes('email') && <MailOutlined className="text-blue-500" />}
          {notify.includes('sms') && <MessageOutlined className="text-green-500" />}
        </div>
      ),
    },
    {
      title: '应用站点',
      dataIndex: 'station_ids',
      key: 'station_ids',
      render: (stations: string[] | null) => (
        <span className="text-sm text-gray-600">
          {!stations || stations.length === 0
            ? '全部站点'
            : stations.length > 2
              ? `${stations[0]?.slice(0, 8)}等${stations.length}个`
              : stations.map((s) => s.slice(0, 8)).join(', ')}
        </span>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (t: string) => formatDate(t),
    },
    {
      title: '状态',
      dataIndex: 'is_enabled',
      key: 'is_enabled',
      render: (enabled: boolean, record: AlertRule) => (
        <Switch
          checked={enabled}
          onChange={(checked) => handleToggle(record, checked)}
          checkedChildren="启用"
          unCheckedChildren="停用"
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: AlertRule) => (
        <div className="flex gap-2">
          <Button type="text" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除"
            description="删除后无法恢复，是否继续？"
            onConfirm={() => handleDelete(record.id)}
            okText="删除"
            cancelText="取消"
          >
            <Button type="text" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Input
          placeholder="搜索规则..."
          prefix={<SearchOutlined className="text-gray-400" />}
          className="w-80"
          allowClear
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div className="flex gap-2">
          <Button icon={<ReloadOutlined />} onClick={loadRules}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAdd}
            className="bg-cyan-600 hover:bg-cyan-700"
          >
            新建规则
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          {
            icon: CheckCircleOutlined,
            label: '已启用规则',
            value: rules.filter((r) => r.is_enabled).length,
            color: 'text-green-500',
          },
          {
            icon: PauseCircleOutlined,
            label: '已停用规则',
            value: rules.filter((r) => !r.is_enabled).length,
            color: 'text-gray-500',
          },
          {
            icon: WarningOutlined,
            label: '严重级别规则',
            value: rules.filter((r) => r.alert_level === 'critical' || r.alert_level === 'high').length,
            color: 'text-red-500',
          },
          {
            icon: BellOutlined,
            label: '规则总数',
            value: rules.length,
            color: 'text-cyan-500',
          },
        ].map((stat, idx) => (
          <GlassCard key={idx} className="p-5">
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

      {/* Rules Table */}
      <GlassCard className="p-6">
        <Table
          columns={columns}
          dataSource={filteredRules}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </GlassCard>

      {/* Modal */}
      <Modal
        title={editingRule ? '编辑规则' : '新建规则'}
        open={isModalOpen}
        onOk={handleModalOk}
        onCancel={() => setIsModalOpen(false)}
        width={600}
      >
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item
            name="rule_name"
            label="规则名称"
            rules={[{ required: true, message: '请输入规则名称' }]}
          >
            <Input placeholder="例如：pH值异常预警" />
          </Form.Item>

          <Form.Item name="rule_type" label="规则类型" initialValue="threshold">
            <Select
              options={[
                { value: 'threshold', label: '阈值规则' },
                { value: 'trend', label: '趋势规则' },
                { value: 'composite', label: '复合规则' },
              ]}
            />
          </Form.Item>

          <div className="grid grid-cols-2 gap-4">
            <Form.Item
              name="metric"
              label="监测指标"
              rules={[{ required: true, message: '请选择监测指标' }]}
            >
              <Select options={metrics} placeholder="选择指标" />
            </Form.Item>

            <Form.Item
              name="alert_level"
              label="预警级别"
              rules={[{ required: true, message: '请选择预警级别' }]}
            >
              <Select options={levels.map((l) => ({ value: l.value, label: l.label }))} placeholder="选择级别" />
            </Form.Item>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Form.Item
              name="condition"
              label="触发条件"
              rules={[{ required: true, message: '请选择触发条件' }]}
            >
              <Select options={conditions} placeholder="选择条件" />
            </Form.Item>

            <Form.Item
              name="threshold"
              label="阈值"
              rules={[{ required: true, message: '请输入阈值' }]}
            >
              <Input placeholder="例如：7.0 或 6.5-8.5" />
            </Form.Item>
          </div>

          <Form.Item name="stations" label="应用站点（留空表示全部站点）">
            <Select mode="tags" placeholder="输入站点ID，可多选" />
          </Form.Item>

          <Form.Item name="notification_channels" label="通知方式">
            <Select
              mode="multiple"
              placeholder="选择通知方式"
              options={[
                { value: 'app', label: '应用推送' },
                { value: 'email', label: '邮件通知' },
                { value: 'sms', label: '短信通知' },
              ]}
            />
          </Form.Item>

          <Form.Item name="description" label="规则说明">
            <TextArea rows={3} placeholder="请输入规则说明（可选）" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

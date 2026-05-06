import { useEffect, useMemo, useState } from 'react';
import {
  UserOutlined,
  SafetyOutlined,
  SettingOutlined,
  FileTextOutlined,
  DatabaseOutlined,
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  SearchOutlined,
  ReloadOutlined,
  ExperimentOutlined,
  EnvironmentOutlined,
} from '@ant-design/icons';
import {
  Button,
  Table,
  Tag,
  Modal,
  Form,
  Input,
  InputNumber,
  message,
  Select,
  Checkbox,
  Switch,
  Popconfirm,
} from 'antd';
import { GlassCard } from '../../components/GlassCard';
import { userApi, roleApi, logApi, metricCatalogApi, mapFeatureApi } from '../../services/api';

// ==================== 类型 ====================
interface UserRow {
  id: string;
  username: string;
  email?: string;
  phone?: string;
  full_name?: string;
  role_id?: string;
  role_code?: string;
  role_name?: string;
  status: 'active' | 'inactive';
  last_login?: string;
  last_login_ip?: string;
}

interface RoleRow {
  id: string;
  code: string;
  name: string;
  description?: string;
  permissions: string[];
  is_builtin?: boolean;
}

interface LogRow {
  id: string;
  username?: string;
  action: string;
  module?: string;
  method?: string;
  path?: string;
  ip?: string;
  status: 'success' | 'failed' | string;
  status_code?: number;
  duration_ms?: number;
  created_at?: string;
}

interface PermissionGroup {
  module: string;
  module_name: string;
  permissions: string[];
}

interface MetricCatalogRow {
  id: string;
  metric_code: string;
  metric_name: string;
  category?: string;
  unit?: string;
  description?: string;
  upper_limit?: number;
  lower_limit?: number;
  standard_limit?: number;
  standard_code?: string;
  is_active: boolean;
  display_order?: number;
}

interface MapFeatureRow {
  id: string;
  feature_type: string;
  name: string;
  description?: string;
  geometry_type?: string;
  coordinates?: any;
  properties?: Record<string, any>;
  style?: Record<string, any>;
  is_active: boolean;
}

const settingsMenu = [
  { key: 'users', label: '用户管理', icon: <UserOutlined /> },
  { key: 'roles', label: '角色权限', icon: <SafetyOutlined /> },
  { key: 'metrics', label: '指标目录', icon: <ExperimentOutlined /> },
  { key: 'mapFeatures', label: '地图要素', icon: <EnvironmentOutlined /> },
  { key: 'system', label: '系统参数', icon: <SettingOutlined /> },
  { key: 'logs', label: '日志管理', icon: <FileTextOutlined /> },
  { key: 'backup', label: '数据备份', icon: <DatabaseOutlined /> },
];

const asArray = <T,>(res: any): T[] => {
  if (Array.isArray(res)) return res as T[];
  if (Array.isArray(res?.items)) return res.items as T[];
  if (Array.isArray(res?.data)) return res.data as T[];
  return [];
};

export default function Settings({ initialTab }: { initialTab?: string } = {}) {
  const [activeTab, setActiveTab] = useState(initialTab || 'users');

  // --------- Users ---------
  const [users, setUsers] = useState<UserRow[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userLoading, setUserLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [userForm] = Form.useForm();

  // --------- Roles ---------
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [permissionGroups, setPermissionGroups] = useState<PermissionGroup[]>([]);
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleRow | null>(null);
  const [roleForm] = Form.useForm();

  // --------- Logs ---------
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logLoading, setLogLoading] = useState(false);
  const [logFilter, setLogFilter] = useState<{ status?: string; keyword?: string }>({});

  // --------- Metric Catalog ---------
  const [metrics, setMetrics] = useState<MetricCatalogRow[]>([]);
  const [metricLoading, setMetricLoading] = useState(false);
  const [metricSearch, setMetricSearch] = useState('');
  const [metricCategory, setMetricCategory] = useState<string | undefined>();
  const [metricModalOpen, setMetricModalOpen] = useState(false);
  const [editingMetric, setEditingMetric] = useState<MetricCatalogRow | null>(null);
  const [metricForm] = Form.useForm();

  // --------- Map Features ---------
  const [features, setFeatures] = useState<MapFeatureRow[]>([]);
  const [featureLoading, setFeatureLoading] = useState(false);
  const [featureTypeFilter, setFeatureTypeFilter] = useState<string | undefined>();
  const [featureKeyword, setFeatureKeyword] = useState('');
  const [featureModalOpen, setFeatureModalOpen] = useState(false);
  const [editingFeature, setEditingFeature] = useState<MapFeatureRow | null>(null);
  const [featureForm] = Form.useForm();

  useEffect(() => {
    if (initialTab && initialTab !== activeTab) setActiveTab(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  useEffect(() => {
    if (activeTab === 'users') {
      loadUsers();
      loadRoles();
    } else if (activeTab === 'roles') {
      loadRoles();
      loadPermissions();
    } else if (activeTab === 'logs') {
      loadLogs();
    } else if (activeTab === 'metrics') {
      loadMetrics();
    } else if (activeTab === 'mapFeatures') {
      loadFeatures();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // ==================== Users ====================
  const loadUsers = async () => {
    setUserLoading(true);
    try {
      const res: any = await userApi.listUsers({ keyword: userSearch || undefined, limit: 100 });
      setUsers(asArray<UserRow>(res));
      setUserTotal(res?.total ?? asArray<UserRow>(res).length);
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '加载用户失败');
    } finally {
      setUserLoading(false);
    }
  };

  const openUserModal = (row?: UserRow) => {
    setEditingUser(row || null);
    if (row) {
      userForm.setFieldsValue({
        username: row.username,
        email: row.email,
        phone: row.phone,
        full_name: row.full_name,
        role_code: row.role_code,
        status: row.status,
      });
    } else {
      userForm.resetFields();
      userForm.setFieldsValue({ status: 'active' });
    }
    setUserModalOpen(true);
  };

  const submitUser = async () => {
    const values = await userForm.validateFields();
    try {
      if (editingUser) {
        await userApi.updateUser(editingUser.id, values);
        message.success('用户信息已更新');
      } else {
        await userApi.createUser(values);
        message.success('用户已创建');
      }
      setUserModalOpen(false);
      loadUsers();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '操作失败');
    }
  };

  const removeUser = async (row: UserRow) => {
    try {
      await userApi.deleteUser(row.id);
      message.success('已删除');
      loadUsers();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '删除失败');
    }
  };

  // ==================== Roles ====================
  const loadRoles = async () => {
    setRolesLoading(true);
    try {
      const res: any = await roleApi.listRoles();
      setRoles(asArray<RoleRow>(res));
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '加载角色失败');
    } finally {
      setRolesLoading(false);
    }
  };

  const loadPermissions = async () => {
    try {
      const res: any = await roleApi.listPermissions();
      setPermissionGroups(res?.groups || []);
    } catch {
      setPermissionGroups([]);
    }
  };

  const openRoleModal = (row?: RoleRow) => {
    setEditingRole(row || null);
    if (row) {
      roleForm.setFieldsValue({
        code: row.code,
        name: row.name,
        description: row.description,
        permissions: row.permissions || [],
      });
    } else {
      roleForm.resetFields();
      roleForm.setFieldsValue({ permissions: [] });
    }
    setRoleModalOpen(true);
  };

  const submitRole = async () => {
    const values = await roleForm.validateFields();
    try {
      if (editingRole) {
        const { code, ...rest } = values;
        await roleApi.updateRole(editingRole.id, rest);
        message.success('角色已更新');
      } else {
        await roleApi.createRole(values);
        message.success('角色已创建');
      }
      setRoleModalOpen(false);
      loadRoles();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '操作失败');
    }
  };

  const removeRole = async (row: RoleRow) => {
    try {
      await roleApi.deleteRole(row.id);
      message.success('已删除');
      loadRoles();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '删除失败');
    }
  };

  // ==================== Logs ====================
  const loadLogs = async () => {
    setLogLoading(true);
    try {
      const params: any = { limit: 100 };
      if (logFilter.status) params.status = logFilter.status;
      if (logFilter.keyword) params.keyword = logFilter.keyword;
      const res: any = await logApi.listLogs(params);
      setLogs(asArray<LogRow>(res));
      setLogTotal(res?.total ?? asArray<LogRow>(res).length);
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '加载日志失败');
    } finally {
      setLogLoading(false);
    }
  };

  const removeLog = async (row: LogRow) => {
    try {
      await logApi.deleteLog(row.id);
      message.success('已删除');
      loadLogs();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '删除失败');
    }
  };

  const cleanOldLogs = () => {
    Modal.confirm({
      title: '清理旧日志',
      content: '将清理 90 天前的日志记录，是否继续？',
      okType: 'danger',
      okText: '确认清理',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res: any = await logApi.cleanOldLogs(90);
          message.success(`已清理 ${res?.deleted ?? 0} 条记录`);
          loadLogs();
        } catch (err: any) {
          message.error(err?.response?.data?.detail || '清理失败');
        }
      },
    });
  };

  // ==================== Metric Catalog ====================
  const loadMetrics = async () => {
    setMetricLoading(true);
    try {
      const params: any = {};
      if (metricSearch) params.keyword = metricSearch;
      if (metricCategory) params.category = metricCategory;
      const res: any = await metricCatalogApi.list(params);
      setMetrics(asArray<MetricCatalogRow>(res));
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '加载指标失败');
    } finally {
      setMetricLoading(false);
    }
  };

  const openMetricModal = (row?: MetricCatalogRow) => {
    setEditingMetric(row || null);
    if (row) {
      metricForm.setFieldsValue({ ...row });
    } else {
      metricForm.resetFields();
      metricForm.setFieldsValue({ is_active: true, display_order: 0 });
    }
    setMetricModalOpen(true);
  };

  const submitMetric = async () => {
    const values = await metricForm.validateFields();
    try {
      if (editingMetric) {
        const { metric_code, ...rest } = values;
        await metricCatalogApi.update(editingMetric.id, rest);
        message.success('指标已更新');
      } else {
        await metricCatalogApi.create(values);
        message.success('指标已创建');
      }
      setMetricModalOpen(false);
      loadMetrics();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '操作失败');
    }
  };

  const removeMetric = async (row: MetricCatalogRow) => {
    try {
      await metricCatalogApi.remove(row.id);
      message.success('已删除');
      loadMetrics();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '删除失败');
    }
  };

  // ==================== Map Features ====================
  const loadFeatures = async () => {
    setFeatureLoading(true);
    try {
      const params: any = {};
      if (featureTypeFilter) params.feature_type = featureTypeFilter;
      if (featureKeyword) params.keyword = featureKeyword;
      const res: any = await mapFeatureApi.list(params);
      setFeatures(asArray<MapFeatureRow>(res));
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '加载地图要素失败');
    } finally {
      setFeatureLoading(false);
    }
  };

  const openFeatureModal = (row?: MapFeatureRow) => {
    setEditingFeature(row || null);
    if (row) {
      featureForm.setFieldsValue({
        ...row,
        coordinates: row.coordinates ? JSON.stringify(row.coordinates) : '',
        properties: row.properties ? JSON.stringify(row.properties) : '',
        style: row.style ? JSON.stringify(row.style) : '',
      });
    } else {
      featureForm.resetFields();
      featureForm.setFieldsValue({
        geometry_type: 'Point',
        is_active: true,
      });
    }
    setFeatureModalOpen(true);
  };

  const submitFeature = async () => {
    const values = await featureForm.validateFields();
    // 将 JSON 字段反序列化
    try {
      values.coordinates = values.coordinates ? JSON.parse(values.coordinates) : null;
    } catch { message.error('coordinates 必须为合法 JSON'); return; }
    try {
      values.properties = values.properties ? JSON.parse(values.properties) : {};
    } catch { message.error('properties 必须为合法 JSON'); return; }
    try {
      values.style = values.style ? JSON.parse(values.style) : {};
    } catch { message.error('style 必须为合法 JSON'); return; }
    try {
      if (editingFeature) {
        await mapFeatureApi.update(editingFeature.id, values);
        message.success('已更新');
      } else {
        await mapFeatureApi.create(values);
        message.success('已创建');
      }
      setFeatureModalOpen(false);
      loadFeatures();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '操作失败');
    }
  };

  const removeFeature = async (row: MapFeatureRow) => {
    try {
      await mapFeatureApi.remove(row.id);
      message.success('已删除');
      loadFeatures();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '删除失败');
    }
  };

  // ==================== Columns ====================
  const userColumns = [
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '姓名', dataIndex: 'full_name', key: 'full_name' },
    { title: '邮箱', dataIndex: 'email', key: 'email' },
    {
      title: '角色',
      dataIndex: 'role_name',
      key: 'role_name',
      render: (name: string) => (name ? <Tag color="blue">{name}</Tag> : <span className="text-gray-400">-</span>),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'active' ? 'green' : 'default'}>
          {status === 'active' ? '启用' : '禁用'}
        </Tag>
      ),
    },
    {
      title: '最后登录',
      dataIndex: 'last_login',
      key: 'last_login',
      render: (t?: string) => <span className="text-gray-500">{t ? new Date(t).toLocaleString() : '-'}</span>,
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_: any, row: UserRow) => (
        <div className="flex items-center gap-2">
          <Button type="text" icon={<EditOutlined />} onClick={() => openUserModal(row)} className="text-cyan-600">
            编辑
          </Button>
          <Popconfirm title="确定删除该用户？" okType="danger" onConfirm={() => removeUser(row)}>
            <Button type="text" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  const roleColumns = [
    { title: '代码', dataIndex: 'code', key: 'code', render: (code: string) => <Tag color="cyan">{code}</Tag> },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '说明', dataIndex: 'description', key: 'description' },
    {
      title: '权限数',
      key: 'perms_count',
      render: (_: any, row: RoleRow) => <span className="text-gray-600">{row.permissions?.length || 0}</span>,
    },
    {
      title: '内置',
      dataIndex: 'is_builtin',
      key: 'is_builtin',
      render: (v: boolean) => (v ? <Tag color="blue">内置</Tag> : <Tag>自定义</Tag>),
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_: any, row: RoleRow) => (
        <div className="flex items-center gap-2">
          <Button type="text" icon={<EditOutlined />} onClick={() => openRoleModal(row)} className="text-cyan-600">
            编辑
          </Button>
          <Popconfirm
            title={row.is_builtin ? '内置角色不可删除' : '确定删除该角色？'}
            okType="danger"
            disabled={row.is_builtin}
            onConfirm={() => removeRole(row)}
          >
            <Button type="text" danger icon={<DeleteOutlined />} disabled={row.is_builtin}>
              删除
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  const logColumns = [
    { title: '用户', dataIndex: 'username', key: 'username', render: (v?: string) => v || <span className="text-gray-400">-</span> },
    { title: '操作', dataIndex: 'action', key: 'action' },
    { title: '模块', dataIndex: 'module', key: 'module', render: (v?: string) => v ? <Tag>{v}</Tag> : '-' },
    { title: '方法', dataIndex: 'method', key: 'method', render: (v?: string) => v && <Tag color="blue">{v}</Tag> },
    { title: '路径', dataIndex: 'path', key: 'path', render: (v?: string) => <span className="font-mono text-xs text-gray-500">{v}</span> },
    { title: 'IP', dataIndex: 'ip', key: 'ip' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (v: string, row: LogRow) => (
        <Tag color={v === 'success' ? 'green' : 'red'}>
          {v === 'success' ? '成功' : '失败'}
          {row.status_code ? ` ${row.status_code}` : ''}
        </Tag>
      ),
    },
    { title: '耗时', dataIndex: 'duration_ms', key: 'duration_ms', render: (v?: number) => v != null ? `${v} ms` : '-' },
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (t?: string) => <span className="text-gray-500">{t ? new Date(t).toLocaleString() : '-'}</span>,
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: any, row: LogRow) => (
        <Popconfirm title="删除该条日志？" okType="danger" onConfirm={() => removeLog(row)}>
          <Button type="text" danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  const metricColumns = [
    { title: '编码', dataIndex: 'metric_code', key: 'metric_code', render: (v: string) => <Tag color="cyan">{v}</Tag> },
    { title: '名称', dataIndex: 'metric_name', key: 'metric_name' },
    { title: '类别', dataIndex: 'category', key: 'category', render: (v?: string) => v ? <Tag>{v}</Tag> : <span className="text-gray-400">-</span> },
    { title: '单位', dataIndex: 'unit', key: 'unit', render: (v?: string) => v || <span className="text-gray-400">-</span> },
    { title: '上限', dataIndex: 'upper_limit', key: 'upper_limit', render: (v?: number) => v ?? '-' },
    { title: '下限', dataIndex: 'lower_limit', key: 'lower_limit', render: (v?: number) => v ?? '-' },
    { title: '标准值', dataIndex: 'standard_limit', key: 'standard_limit', render: (v?: number) => v ?? '-' },
    { title: '标准', dataIndex: 'standard_code', key: 'standard_code', render: (v?: string) => v || <span className="text-gray-400">-</span> },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '停用'}</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_: any, row: MetricCatalogRow) => (
        <div className="flex items-center gap-2">
          <Button type="text" icon={<EditOutlined />} onClick={() => openMetricModal(row)} className="text-cyan-600">编辑</Button>
          <Popconfirm title="确定删除该指标？" okType="danger" onConfirm={() => removeMetric(row)}>
            <Button type="text" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  const featureColumns = [
    { title: '类型', dataIndex: 'feature_type', key: 'feature_type', render: (v: string) => <Tag color="geekblue">{v}</Tag> },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '几何', dataIndex: 'geometry_type', key: 'geometry_type', render: (v?: string) => v ? <Tag>{v}</Tag> : '-' },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '停用'}</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_: any, row: MapFeatureRow) => (
        <div className="flex items-center gap-2">
          <Button type="text" icon={<EditOutlined />} onClick={() => openFeatureModal(row)} className="text-cyan-600">编辑</Button>
          <Popconfirm title="确定删除该要素？" okType="danger" onConfirm={() => removeFeature(row)}>
            <Button type="text" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  const roleOptions = useMemo(
    () => roles.map((r) => ({ value: r.code, label: `${r.name}（${r.code}）` })),
    [roles]
  );

  // ==================== render ====================
  const renderUsers = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="搜索用户名/邮箱/姓名"
          prefix={<SearchOutlined />}
          allowClear
          value={userSearch}
          onChange={(e) => setUserSearch(e.target.value)}
          onPressEnter={loadUsers}
          style={{ width: 260 }}
        />
        <Button icon={<ReloadOutlined />} onClick={loadUsers}>刷新</Button>
        <div className="flex-1" />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openUserModal()} className="bg-cyan-600 hover:bg-cyan-700">
          新增用户
        </Button>
      </div>
      <Table
        columns={userColumns}
        dataSource={users}
        rowKey="id"
        loading={userLoading}
        pagination={{ pageSize: 10, total: userTotal, showSizeChanger: false }}
      />
    </div>
  );

  const renderRoles = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button icon={<ReloadOutlined />} onClick={loadRoles}>刷新</Button>
        <div className="flex-1" />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openRoleModal()} className="bg-cyan-600 hover:bg-cyan-700">
          新增角色
        </Button>
      </div>
      <Table columns={roleColumns} dataSource={roles} rowKey="id" loading={rolesLoading} pagination={false} />
    </div>
  );

  const renderLogs = () => (
    <div className="space-y-4">
      <div className="flex gap-2 items-center flex-wrap">
        <Select
          placeholder="全部状态"
          allowClear
          style={{ width: 140 }}
          value={logFilter.status}
          onChange={(v) => setLogFilter({ ...logFilter, status: v })}
          options={[
            { value: 'success', label: '成功' },
            { value: 'failed', label: '失败' },
          ]}
        />
        <Input
          placeholder="搜索操作/路径/用户"
          prefix={<SearchOutlined />}
          allowClear
          value={logFilter.keyword}
          onChange={(e) => setLogFilter({ ...logFilter, keyword: e.target.value })}
          onPressEnter={loadLogs}
          style={{ width: 240 }}
        />
        <Button type="primary" onClick={loadLogs} className="bg-cyan-600">查询</Button>
        <Button icon={<ReloadOutlined />} onClick={() => { setLogFilter({}); setTimeout(loadLogs, 0); }}>重置</Button>
        <div className="flex-1" />
        <Button danger icon={<DeleteOutlined />} onClick={cleanOldLogs}>清理旧日志</Button>
      </div>
      <Table
        columns={logColumns}
        dataSource={logs}
        rowKey="id"
        loading={logLoading}
        size="small"
        pagination={{ pageSize: 20, total: logTotal, showSizeChanger: false }}
      />
    </div>
  );

  const renderMetrics = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder="搜索编码/名称"
          prefix={<SearchOutlined />}
          allowClear
          value={metricSearch}
          onChange={(e) => setMetricSearch(e.target.value)}
          onPressEnter={loadMetrics}
          style={{ width: 220 }}
        />
        <Select
          placeholder="全部类别"
          allowClear
          style={{ width: 140 }}
          value={metricCategory}
          onChange={setMetricCategory}
          options={[
            { value: '物理', label: '物理' },
            { value: '化学', label: '化学' },
            { value: '生物', label: '生物' },
            { value: '重金属', label: '重金属' },
          ]}
        />
        <Button type="primary" onClick={loadMetrics} className="bg-cyan-600">查询</Button>
        <Button icon={<ReloadOutlined />} onClick={() => { setMetricSearch(''); setMetricCategory(undefined); setTimeout(loadMetrics, 0); }}>重置</Button>
        <div className="flex-1" />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openMetricModal()} className="bg-cyan-600 hover:bg-cyan-700">
          新增指标
        </Button>
      </div>
      <Table
        columns={metricColumns}
        dataSource={metrics}
        rowKey="id"
        loading={metricLoading}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        size="small"
      />
    </div>
  );

  const renderFeatures = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Select
          placeholder="全部类型"
          allowClear
          style={{ width: 160 }}
          value={featureTypeFilter}
          onChange={setFeatureTypeFilter}
          options={[
            { value: 'river', label: '河流' },
            { value: 'watershed', label: '流域边界' },
            { value: 'station', label: '监测点' },
            { value: 'pollution', label: '污染标记' },
            { value: 'poi', label: 'POI 兴趣点' },
          ]}
        />
        <Input
          placeholder="搜索名称"
          prefix={<SearchOutlined />}
          allowClear
          value={featureKeyword}
          onChange={(e) => setFeatureKeyword(e.target.value)}
          onPressEnter={loadFeatures}
          style={{ width: 200 }}
        />
        <Button type="primary" onClick={loadFeatures} className="bg-cyan-600">查询</Button>
        <Button icon={<ReloadOutlined />} onClick={() => { setFeatureTypeFilter(undefined); setFeatureKeyword(''); setTimeout(loadFeatures, 0); }}>重置</Button>
        <div className="flex-1" />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openFeatureModal()} className="bg-cyan-600 hover:bg-cyan-700">
          新增要素
        </Button>
      </div>
      <Table
        columns={featureColumns}
        dataSource={features}
        rowKey="id"
        loading={featureLoading}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        size="small"
      />
    </div>
  );

  const renderSystemParams = () => (
    <div className="space-y-4">
      {[
        { key: 'data_retention', label: '数据保留天数', value: '365', unit: '天' },
        { key: 'alert_threshold', label: '预警阈值敏感度', value: '中', unit: '' },
        { key: 'sync_interval', label: '数据同步间隔', value: '5', unit: '分钟' },
        { key: 'session_timeout', label: '会话超时时间', value: '30', unit: '分钟' },
      ].map((param) => (
        <div key={param.key} className="flex items-center justify-between p-4 rounded-xl bg-white border border-gray-100">
          <div>
            <p className="font-medium text-gray-900">{param.label}</p>
            <p className="text-sm text-gray-500">当前值: {param.value}{param.unit}</p>
          </div>
          <Button icon={<EditOutlined />}>编辑</Button>
        </div>
      ))}
      <p className="text-xs text-gray-400">注：系统参数表将在后续版本接入配置中心，当前为只读示意。</p>
    </div>
  );

  const renderBackup = () => (
    <div className="space-y-4">
      <div className="p-5 rounded-xl bg-white border border-gray-100">
        <h4 className="font-semibold mb-4">备份策略</h4>
        <div className="flex items-center justify-between mb-3">
          <span>自动备份</span>
          <Switch defaultChecked />
        </div>
        <div className="flex items-center justify-between mb-3">
          <span>备份频率</span>
          <Select defaultValue="daily" style={{ width: 140 }} options={[
            { value: 'hourly', label: '每小时' },
            { value: 'daily', label: '每日' },
            { value: 'weekly', label: '每周' },
          ]} />
        </div>
        <div className="flex items-center justify-between">
          <span>保留份数</span>
          <Select defaultValue="30" style={{ width: 140 }} options={[
            { value: '7', label: '7 份' },
            { value: '30', label: '30 份' },
            { value: '90', label: '90 份' },
          ]} />
        </div>
      </div>
      <div className="p-4 bg-blue-50 rounded-xl text-sm text-blue-700">
        备份能力将在 P4 阶段接入真实后端；当前为 UI 占位。
      </div>
    </div>
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'users': return renderUsers();
      case 'roles': return renderRoles();
      case 'metrics': return renderMetrics();
      case 'mapFeatures': return renderFeatures();
      case 'logs': return renderLogs();
      case 'system': return renderSystemParams();
      case 'backup': return renderBackup();
      default: return null;
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 min-h-[500px]">
      {/* Sidebar */}
      <GlassCard className="w-full lg:w-56 rounded-2xl p-4 flex-shrink-0">
        <nav className="space-y-1">
          {settingsMenu.map((item) => (
            <button
              key={item.key}
              onClick={() => setActiveTab(item.key)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-left ${
                activeTab === item.key ? 'bg-cyan-50 text-cyan-600' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span className={activeTab === item.key ? 'text-cyan-500' : 'text-gray-400'}>{item.icon}</span>
              <span className="font-medium">{item.label}</span>
            </button>
          ))}
        </nav>
      </GlassCard>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <GlassCard className="rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">
            {settingsMenu.find((m) => m.key === activeTab)?.label}
          </h3>
          {renderContent()}
        </GlassCard>
      </div>

      {/* User Modal */}
      <Modal
        title={editingUser ? '编辑用户' : '新增用户'}
        open={userModalOpen}
        onCancel={() => setUserModalOpen(false)}
        onOk={submitUser}
        okText={editingUser ? '保存' : '创建'}
        destroyOnClose
      >
        <Form form={userForm} layout="vertical" className="mt-4">
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input placeholder="请输入用户名" disabled={!!editingUser} />
          </Form.Item>
          {!editingUser && (
            <Form.Item name="password" label="密码" rules={[{ required: true, min: 4, message: '至少 4 位' }]}>
              <Input.Password placeholder="初始密码" />
            </Form.Item>
          )}
          {editingUser && (
            <Form.Item name="password" label="重置密码（留空则不修改）">
              <Input.Password placeholder="留空则不修改" />
            </Form.Item>
          )}
          <Form.Item name="full_name" label="姓名"><Input placeholder="姓名" /></Form.Item>
          <Form.Item name="email" label="邮箱"><Input placeholder="邮箱" /></Form.Item>
          <Form.Item name="phone" label="手机号"><Input placeholder="手机号" /></Form.Item>
          <Form.Item name="role_code" label="角色">
            <Select placeholder="选择角色" options={roleOptions} allowClear />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue="active">
            <Select options={[{ value: 'active', label: '启用' }, { value: 'inactive', label: '禁用' }]} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Metric Modal */}
      <Modal
        title={editingMetric ? '编辑指标' : '新增指标'}
        open={metricModalOpen}
        onCancel={() => setMetricModalOpen(false)}
        onOk={submitMetric}
        okText={editingMetric ? '保存' : '创建'}
        width={640}
        destroyOnClose
      >
        <Form form={metricForm} layout="vertical" className="mt-4">
          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="metric_code" label="指标编码" rules={[{ required: true, message: '请输入编码' }]}>
              <Input placeholder="例如：pH" disabled={!!editingMetric} />
            </Form.Item>
            <Form.Item name="metric_name" label="指标名称" rules={[{ required: true, message: '请输入名称' }]}>
              <Input placeholder="例如：pH 值" />
            </Form.Item>
            <Form.Item name="category" label="类别">
              <Select allowClear placeholder="选择类别" options={[
                { value: '物理', label: '物理' },
                { value: '化学', label: '化学' },
                { value: '生物', label: '生物' },
                { value: '重金属', label: '重金属' },
              ]} />
            </Form.Item>
            <Form.Item name="unit" label="单位"><Input placeholder="mg/L / ℃ / NTU" /></Form.Item>
            <Form.Item name="upper_limit" label="上限"><InputNumber style={{ width: '100%' }} placeholder="限值上界" /></Form.Item>
            <Form.Item name="lower_limit" label="下限"><InputNumber style={{ width: '100%' }} placeholder="限值下界" /></Form.Item>
            <Form.Item name="standard_limit" label="标准值"><InputNumber style={{ width: '100%' }} placeholder="标准限值" /></Form.Item>
            <Form.Item name="standard_code" label="适用标准"><Input placeholder="例如：GB3838-III类" /></Form.Item>
            <Form.Item name="display_order" label="排序" initialValue={0}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="is_active" label="状态" valuePropName="checked" initialValue={true}>
              <Switch checkedChildren="启用" unCheckedChildren="停用" />
            </Form.Item>
          </div>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} placeholder="指标说明 / 备注" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Map Feature Modal */}
      <Modal
        title={editingFeature ? '编辑地图要素' : '新增地图要素'}
        open={featureModalOpen}
        onCancel={() => setFeatureModalOpen(false)}
        onOk={submitFeature}
        okText={editingFeature ? '保存' : '创建'}
        width={720}
        destroyOnClose
      >
        <Form form={featureForm} layout="vertical" className="mt-4">
          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="feature_type" label="要素类型" rules={[{ required: true, message: '请选择类型' }]}>
              <Select placeholder="选择要素类型" options={[
                { value: 'river', label: '河流' },
                { value: 'watershed', label: '流域边界' },
                { value: 'station', label: '监测点' },
                { value: 'pollution', label: '污染标记' },
                { value: 'poi', label: 'POI 兴趣点' },
              ]} />
            </Form.Item>
            <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
              <Input placeholder="例如：湘江干流" />
            </Form.Item>
            <Form.Item name="geometry_type" label="几何类型">
              <Select options={[
                { value: 'Point', label: 'Point' },
                { value: 'LineString', label: 'LineString' },
                { value: 'Polygon', label: 'Polygon' },
                { value: 'MultiLineString', label: 'MultiLineString' },
                { value: 'MultiPolygon', label: 'MultiPolygon' },
              ]} />
            </Form.Item>
            <Form.Item name="is_active" label="状态" valuePropName="checked" initialValue={true}>
              <Switch checkedChildren="启用" unCheckedChildren="停用" />
            </Form.Item>
          </div>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="要素描述" />
          </Form.Item>
          <Form.Item
            name="coordinates"
            label="坐标 (GeoJSON coordinates)"
            extra="Point: [lng, lat]；LineString: [[lng,lat], ...]；Polygon: [[[lng,lat], ...]]"
          >
            <Input.TextArea rows={3} placeholder='例如：[112.987, 28.234]' />
          </Form.Item>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="properties" label="属性 JSON">
              <Input.TextArea rows={3} placeholder='例如：{"level": 3, "length_km": 12}' />
            </Form.Item>
            <Form.Item name="style" label="样式 JSON">
              <Input.TextArea rows={3} placeholder='例如：{"color": "#2563eb", "weight": 3}' />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      {/* Role Modal */}
      <Modal
        title={editingRole ? '编辑角色' : '新增角色'}
        open={roleModalOpen}
        onCancel={() => setRoleModalOpen(false)}
        onOk={submitRole}
        okText={editingRole ? '保存' : '创建'}
        width={720}
        destroyOnClose
      >
        <Form form={roleForm} layout="vertical" className="mt-4">
          <Form.Item name="code" label="角色代码" rules={[{ required: true, message: '请输入角色代码' }]}>
            <Input placeholder="例如：operator" disabled={!!editingRole} />
          </Form.Item>
          <Form.Item name="name" label="角色名称" rules={[{ required: true, message: '请输入角色名称' }]}>
            <Input placeholder="例如：操作员" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} placeholder="角色说明" />
          </Form.Item>
          <Form.Item name="permissions" label="权限" rules={[{ required: true, message: '请至少选择一项权限' }]}>
            <Checkbox.Group className="w-full">
              <div className="space-y-3 w-full">
                {permissionGroups.map((g) => (
                  <div key={g.module} className="p-3 rounded-lg border border-gray-100">
                    <div className="text-sm font-semibold text-gray-700 mb-2">{g.module_name}</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {g.permissions.map((p) => (
                        <Checkbox key={p} value={p}>{p}</Checkbox>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Checkbox.Group>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  EnvironmentOutlined,
  ReloadOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { Button, Input, Table, Tag, Modal, Form, Select, message, Spin } from 'antd';
import { stationApi } from '@/services/api';

interface Station {
  id: string;
  station_code: string;
  station_name: string;
  station_type: string;
  status: 'active' | 'inactive' | 'maintenance';
  longitude: number;
  latitude: number;
  region?: string;
  address?: string;
  config?: any;
  created_at?: string;
  updated_at?: string;
}

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

export default function Stations() {
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStation, setEditingStation] = useState<Station | null>(null);
  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const fetchStations = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await stationApi.getStations({
        station_type: filterType || undefined,
        status: filterStatus || undefined,
        limit: 1000,
      });
      const items = res?.items ?? res?.data?.items ?? [];
      setStations(items);
    } catch (err) {
      console.error('Failed to fetch stations:', err);
      message.error('获取站点列表失败');
    } finally {
      setLoading(false);
    }
  }, [filterType, filterStatus]);

  useEffect(() => {
    fetchStations();
  }, [fetchStations]);

  const filteredStations = stations.filter((station) => {
    if (!searchText) return true;
    const text = searchText.toLowerCase();
    return station.station_name.toLowerCase().includes(text) ||
           station.station_code.toLowerCase().includes(text);
  });

  const handleAdd = () => {
    setEditingStation(null);
    form.resetFields();
    setIsModalOpen(true);
  };

  const handleEdit = (station: Station) => {
    setEditingStation(station);
    form.setFieldsValue({
      station_name: station.station_name,
      station_code: station.station_code,
      station_type: station.station_type,
      status: station.status,
      longitude: station.longitude,
      latitude: station.latitude,
      region: station.region,
      address: station.address,
    });
    setIsModalOpen(true);
  };

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个站点吗？此操作不可恢复。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await stationApi.deleteStation(id);
          message.success('站点已删除');
          fetchStations();
        } catch {
          message.error('删除失败');
        }
      },
    });
  };

  const handleSave = async (values: any) => {
    try {
      if (editingStation) {
        await stationApi.updateStation(editingStation.id, values);
        message.success('站点已更新');
      } else {
        await stationApi.createStation(values);
        message.success('站点已创建');
      }
      setIsModalOpen(false);
      fetchStations();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '操作失败');
    }
  };

  const columns = [
    {
      title: '站点编码',
      dataIndex: 'station_code',
      key: 'station_code',
      width: 140,
    },
    {
      title: '站点名称',
      dataIndex: 'station_name',
      key: 'station_name',
      render: (text: string, record: Station) => (
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate(`/stations/${record.id}`)}>
          <EnvironmentOutlined className="text-cyan-500" />
          <span className="font-medium text-cyan-600 hover:text-cyan-700 hover:underline">{text}</span>
        </div>
      ),
    },
    {
      title: '类型',
      dataIndex: 'station_type',
      key: 'station_type',
      width: 120,
      render: (type: string) => (
        <Tag color="blue">{typeMap[type] || type}</Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const info = statusMap[status] || { text: status, color: 'default' };
        return (
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${
              status === 'active' ? 'bg-green-500' :
              status === 'inactive' ? 'bg-gray-400' : 'bg-amber-500'
            }`} />
            <Tag color={info.color}>{info.text}</Tag>
          </div>
        );
      },
    },
    {
      title: '区域',
      dataIndex: 'region',
      key: 'region',
      width: 100,
    },
    {
      title: '经度',
      dataIndex: 'longitude',
      key: 'longitude',
      width: 120,
      render: (val: number) => val?.toFixed(4) ?? '-',
    },
    {
      title: '纬度',
      dataIndex: 'latitude',
      key: 'latitude',
      width: 120,
      render: (val: number) => val?.toFixed(4) ?? '-',
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 170,
      render: (text: string) => (
        <span className="text-gray-500 text-sm">{text ? new Date(text).toLocaleString('zh-CN') : '-'}</span>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_: any, record: Station) => (
        <div className="flex items-center gap-2">
          <Button
            type="text"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/stations/${record.id}`)}
            className="text-cyan-600 hover:text-cyan-700"
          >
            查看
          </Button>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
            className="text-cyan-600 hover:text-cyan-700"
          >
            编辑
          </Button>
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record.id)}
          >
            删除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Input
            placeholder="搜索站点名称或编码..."
            prefix={<SearchOutlined className="text-gray-400" />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-64"
            allowClear
          />
          <Select
            placeholder="全部类型"
            allowClear
            value={filterType}
            onChange={setFilterType}
            className="w-32"
            options={[
              { value: 'water_source', label: '水源地' },
              { value: 'industrial_park', label: '工业园区' },
              { value: 'boundary_section', label: '跨界断面' },
              { value: 'rural_water', label: '农村水体' },
            ]}
          />
          <Select
            placeholder="全部状态"
            allowClear
            value={filterStatus}
            onChange={setFilterStatus}
            className="w-32"
            options={[
              { value: 'active', label: '在线' },
              { value: 'inactive', label: '离线' },
              { value: 'maintenance', label: '维护中' },
            ]}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={fetchStations}
            loading={loading}
          >
            刷新
          </Button>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleAdd}
          className="bg-cyan-600 hover:bg-cyan-700"
        >
          新增站点
        </Button>
      </div>

      {/* Table */}
      <Spin spinning={loading}>
        <div
          className="rounded-xl overflow-hidden"
          style={{
            background: 'rgba(255, 255, 255, 0.7)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
          }}
        >
          <Table
            columns={columns}
            dataSource={filteredStations}
            rowKey="id"
            pagination={{
              pageSize: 10,
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条`,
            }}
          />
        </div>
      </Spin>

      {/* Add/Edit Modal */}
      <Modal
        title={editingStation ? '编辑站点' : '新增站点'}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={() => form.submit()}
        width={640}
        okText={editingStation ? '保存' : '创建'}
        cancelText="取消"
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          className="mt-4"
        >
          <div className="grid grid-cols-2 gap-4">
            <Form.Item
              name="station_name"
              label="站点名称"
              rules={[{ required: true, message: '请输入站点名称' }]}
            >
              <Input placeholder="请输入站点名称" />
            </Form.Item>
            <Form.Item
              name="station_code"
              label="站点编码"
              rules={[{ required: true, message: '请输入站点编码' }]}
            >
              <Input placeholder="如：WS001" disabled={!!editingStation} />
            </Form.Item>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Form.Item
              name="station_type"
              label="站点类型"
              rules={[{ required: true, message: '请选择站点类型' }]}
            >
              <Select placeholder="请选择">
                <Select.Option value="water_source">水源地</Select.Option>
                <Select.Option value="industrial_park">工业园区</Select.Option>
                <Select.Option value="boundary_section">跨界断面</Select.Option>
                <Select.Option value="rural_water">农村水体</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item
              name="status"
              label="监测状态"
              initialValue="active"
              rules={[{ required: true, message: '请选择监测状态' }]}
            >
              <Select placeholder="请选择">
                <Select.Option value="active">在线</Select.Option>
                <Select.Option value="inactive">离线</Select.Option>
                <Select.Option value="maintenance">维护中</Select.Option>
              </Select>
            </Form.Item>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="region" label="所属区域">
              <Input placeholder="如：章贡区" />
            </Form.Item>
          </div>

          <Form.Item label="位置信息">
            <div className="p-4 rounded-lg bg-gray-50 border border-dashed border-gray-300 text-center text-gray-400 cursor-not-allowed">
              <EnvironmentOutlined className="text-2xl mb-2" />
              <p>地图选择功能开发中</p>
              <p className="text-xs mt-1">请在下方手动输入经纬度</p>
            </div>
          </Form.Item>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Form.Item
              name="longitude"
              label="经度"
              rules={[{ required: true, message: '请输入经度' }]}
            >
              <Input type="number" placeholder="经度" />
            </Form.Item>
            <Form.Item
              name="latitude"
              label="纬度"
              rules={[{ required: true, message: '请输入纬度' }]}
            >
              <Input type="number" placeholder="纬度" />
            </Form.Item>
          </div>

          <Form.Item
            name="address"
            label="详细地址"
          >
            <Input.TextArea rows={2} placeholder="请输入详细地址" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

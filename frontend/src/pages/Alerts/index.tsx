import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BellOutlined,
  ClockCircleOutlined,
  EnvironmentOutlined,
  CheckCircleOutlined,
  EyeOutlined,
  SettingOutlined,
  ExclamationCircleOutlined,
  RobotOutlined,
  ArrowRightOutlined,
  ReloadOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { Button, Tag, Modal, message, Empty, Spin, Select, Input } from 'antd';
import { GlassCard } from '../../components/GlassCard';
import { alertApi } from '../../services/api';

interface AlertItem {
  id: string;
  alert_code: string;
  title: string;
  description?: string;
  alert_level: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'confirmed' | 'processing' | 'resolved';
  station_id: string;
  metrics?: Record<string, any>;
  alert_type?: string;
  created_at: string;
}

interface AlertStatistics {
  total: number;
  by_status: Record<string, number>;
  by_level: Record<string, number>;
}

const levelMap: Record<string, { text: string; color: string; bg: string; border: string }> = {
  critical: { text: '紧急', color: '#dc2626', bg: '#fee2e2', border: '#fecaca' },
  high: { text: '高', color: '#ea580c', bg: '#ffedd5', border: '#fed7aa' },
  medium: { text: '中', color: '#d97706', bg: '#fef3c7', border: '#fde68a' },
  low: { text: '低', color: '#059669', bg: '#d1fae5', border: '#a7f3d0' },
};

const statusMap: Record<string, { text: string; color: string }> = {
  pending: { text: '待处理', color: 'red' },
  confirmed: { text: '已确认', color: 'orange' },
  processing: { text: '处理中', color: 'blue' },
  resolved: { text: '已解决', color: 'green' },
};

interface StatCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}

function StatCard({ title, value, icon, color }: StatCardProps) {
  return (
    <GlassCard className="p-6 transition-all duration-300 hover:-translate-y-1">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 mb-1">{title}</p>
          <p className="text-3xl font-bold text-gray-900">{value}</p>
        </div>
        <div className={`text-3xl ${color}`}>{icon}</div>
      </div>
    </GlassCard>
  );
}

function formatTime(s?: string) {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { hour12: false });
}

function pickIndicator(a: AlertItem): string {
  if (a.metrics && typeof a.metrics === 'object') {
    const keys = Object.keys(a.metrics);
    if (keys.length > 0) return keys[0];
  }
  return a.alert_type || '-';
}

export default function Alerts() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [statistics, setStatistics] = useState<AlertStatistics | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<AlertItem | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [levelFilter, setLevelFilter] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [keyword, setKeyword] = useState('');
  // 错误提示节流：仅首次失败时提示，避免筛选切换时反复弹窗
  const alertsErrorNotifiedRef = useRef(false);
  const statsErrorNotifiedRef = useRef(false);

  const loadAlerts = async () => {
    setLoading(true);
    try {
      const params: any = { page: 1, size: 50 };
      if (levelFilter) params.alert_level = levelFilter;
      if (statusFilter) params.status = statusFilter;
      const res: any = await alertApi.getAlerts(params);
      const items = (res?.items || res?.data?.items || res?.data || []) as AlertItem[];
      setAlerts(Array.isArray(items) ? items : []);
      alertsErrorNotifiedRef.current = false;
    } catch (err) {
      console.error('加载预警列表失败', err);
      setAlerts([]);
      if (!alertsErrorNotifiedRef.current) {
        message.error('预警列表加载失败，请检查预警服务是否可用');
        alertsErrorNotifiedRef.current = true;
      }
    } finally {
      setLoading(false);
    }
  };

  const loadStatistics = async () => {
    try {
      const res: any = await alertApi.getAlertStatistics();
      const data = res?.data || res;
      setStatistics(data);
      statsErrorNotifiedRef.current = false;
    } catch (err) {
      console.error('加载预警统计失败', err);
      setStatistics(null);
      if (!statsErrorNotifiedRef.current) {
        message.warning('预警统计数据暂不可用');
        statsErrorNotifiedRef.current = true;
      }
    }
  };

  useEffect(() => {
    loadAlerts();
    loadStatistics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelFilter, statusFilter]);

  const filteredAlerts = keyword
    ? alerts.filter(
        (a) =>
          a.title?.toLowerCase().includes(keyword.toLowerCase()) ||
          a.alert_code?.toLowerCase().includes(keyword.toLowerCase()) ||
          a.description?.toLowerCase().includes(keyword.toLowerCase()),
      )
    : alerts;

  const stats = statistics
    ? {
        total: statistics.total ?? 0,
        pending: statistics.by_status?.pending ?? 0,
        processing: statistics.by_status?.processing ?? 0,
        resolved: statistics.by_status?.resolved ?? 0,
      }
    : {
        total: alerts.length,
        pending: alerts.filter((a) => a.status === 'pending').length,
        processing: alerts.filter((a) => a.status === 'processing').length,
        resolved: alerts.filter((a) => a.status === 'resolved').length,
      };

  const handleViewDetail = (alert: AlertItem) => {
    setSelectedAlert(alert);
    setIsDetailOpen(true);
  };

  const handleProcess = async (alertId: string) => {
    try {
      await alertApi.confirmAlert(alertId, { confirmed_by: localStorage.getItem('username') || 'admin' });
      message.success('已开始处理该预警');
      loadAlerts();
      loadStatistics();
    } catch (err) {
      console.error(err);
      message.error('操作失败，请稍后重试');
    }
  };

  const handleResolve = async (alertId: string) => {
    try {
      await alertApi.resolveAlert(alertId, { resolved_by: localStorage.getItem('username') || 'admin' });
      message.success('预警已标记为已解决');
      loadAlerts();
      loadStatistics();
    } catch (err) {
      console.error(err);
      message.error('操作失败，请稍后重试');
    }
  };

  const handleDelete = (alertId: string) => {
    Modal.confirm({
      title: '确认删除该预警?',
      content: '删除后不可恢复',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await alertApi.deleteAlert(alertId);
          message.success('预警已删除');
          setIsDetailOpen(false);
          loadAlerts();
          loadStatistics();
        } catch (err) {
          console.error(err);
          message.error('删除失败，请稍后重试');
        }
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
        <StatCard title="总预警数" value={stats.total} icon={<BellOutlined />} color="text-cyan-500" />
        <StatCard
          title="待处理"
          value={stats.pending}
          icon={<ExclamationCircleOutlined />}
          color="text-red-500"
        />
        <StatCard
          title="处理中"
          value={stats.processing}
          icon={<ClockCircleOutlined />}
          color="text-blue-500"
        />
        <StatCard
          title="已解决"
          value={stats.resolved}
          icon={<CheckCircleOutlined />}
          color="text-green-500"
        />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="text-lg font-semibold text-gray-900">预警事件</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <Input.Search
            placeholder="搜索标题 / 编码 / 描述"
            allowClear
            onSearch={setKeyword}
            onChange={(e) => !e.target.value && setKeyword('')}
            style={{ width: 220 }}
          />
          <Select
            placeholder="级别"
            allowClear
            style={{ width: 100 }}
            value={levelFilter}
            onChange={setLevelFilter}
            options={[
              { value: 'critical', label: '紧急' },
              { value: 'high', label: '高' },
              { value: 'medium', label: '中' },
              { value: 'low', label: '低' },
            ]}
          />
          <Select
            placeholder="状态"
            allowClear
            style={{ width: 110 }}
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'pending', label: '待处理' },
              { value: 'confirmed', label: '已确认' },
              { value: 'processing', label: '处理中' },
              { value: 'resolved', label: '已解决' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => { loadAlerts(); loadStatistics(); }}>
            刷新
          </Button>
          <Button
            icon={<SettingOutlined />}
            onClick={() => navigate('/alerts/rules')}
            className="border-gray-300 text-gray-600"
          >
            预警规则配置
          </Button>
        </div>
      </div>

      {/* Alert List */}
      <Spin spinning={loading}>
        <div className="space-y-4">
          {filteredAlerts.length === 0 && !loading ? (
            <GlassCard className="p-10">
              <Empty description="暂无预警数据" />
            </GlassCard>
          ) : (
            filteredAlerts.map((alert) => {
              const level = levelMap[alert.alert_level] || levelMap.low;
              const status = statusMap[alert.status] || statusMap.pending;
              const indicator = pickIndicator(alert);

              return (
                <GlassCard key={alert.id} className="p-5 transition-all duration-200 hover:shadow-lg">
                  {/* Header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span
                        className="px-3 py-1 rounded-full text-xs font-medium"
                        style={{
                          backgroundColor: level.bg,
                          color: level.color,
                          border: `1px solid ${level.border}`,
                        }}
                      >
                        {level.text}
                      </span>
                      <span className="text-sm text-gray-500 font-mono">{alert.alert_code}</span>
                      <span className="text-sm text-gray-400 flex items-center gap-1">
                        <ClockCircleOutlined /> {formatTime(alert.created_at)}
                      </span>
                    </div>
                    <Tag color={status.color}>{status.text}</Tag>
                  </div>

                  {/* Content */}
                  <h4 className="text-lg font-semibold text-gray-900 mb-2">{alert.title}</h4>
                  <p className="text-gray-600 mb-4">{alert.description || '-'}</p>

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                    <div className="flex items-center gap-4 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <EnvironmentOutlined /> 站点 {alert.station_id?.slice(0, 8)}
                      </span>
                      <span>·</span>
                      <span>{indicator}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="text"
                        icon={<EyeOutlined />}
                        onClick={() => handleViewDetail(alert)}
                        className="text-gray-500 hover:text-gray-700"
                      >
                        预览
                      </Button>
                      <Button
                        type="text"
                        icon={<RobotOutlined />}
                        onClick={() => navigate(`/alerts/${alert.id}`)}
                        className="text-cyan-600 hover:text-cyan-700"
                      >
                        AI分析 <ArrowRightOutlined />
                      </Button>
                      {alert.status === 'pending' && (
                        <Button
                          type="primary"
                          onClick={() => handleProcess(alert.id)}
                          className="bg-cyan-600 hover:bg-cyan-700"
                        >
                          处理
                        </Button>
                      )}
                      {(alert.status === 'confirmed' || alert.status === 'processing') && (
                        <Button
                          type="primary"
                          onClick={() => handleResolve(alert.id)}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          解决
                        </Button>
                      )}
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleDelete(alert.id)}
                      >
                        删除
                      </Button>
                    </div>
                  </div>
                </GlassCard>
              );
            })
          )}
        </div>
      </Spin>

      {/* Detail Modal */}
      <Modal
        title="预警详情"
        open={isDetailOpen}
        onCancel={() => setIsDetailOpen(false)}
        footer={null}
        width={600}
      >
        {selectedAlert && (
          <div className="space-y-4 mt-4">
            <div className="flex items-center gap-3">
              <span
                className="px-3 py-1 rounded-full text-sm font-medium"
                style={{
                  backgroundColor: (levelMap[selectedAlert.alert_level] || levelMap.low).bg,
                  color: (levelMap[selectedAlert.alert_level] || levelMap.low).color,
                }}
              >
                {(levelMap[selectedAlert.alert_level] || levelMap.low).text}
              </span>
              <span className="text-gray-500 font-mono">{selectedAlert.alert_code}</span>
            </div>

            <div>
              <h3 className="text-xl font-bold text-gray-900">{selectedAlert.title}</h3>
              <p className="text-gray-600 mt-2">{selectedAlert.description || '-'}</p>
            </div>

            <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-gray-50">
              <div>
                <p className="text-sm text-gray-500">关联站点</p>
                <p className="font-medium text-gray-900">{selectedAlert.station_id}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">监测指标</p>
                <p className="font-medium text-gray-900">{pickIndicator(selectedAlert)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">发生时间</p>
                <p className="font-medium text-gray-900">{formatTime(selectedAlert.created_at)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">当前状态</p>
                <Tag color={(statusMap[selectedAlert.status] || statusMap.pending).color}>
                  {(statusMap[selectedAlert.status] || statusMap.pending).text}
                </Tag>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button onClick={() => setIsDetailOpen(false)}>关闭</Button>
              <Button
                type="primary"
                icon={<RobotOutlined />}
                onClick={() => {
                  setIsDetailOpen(false);
                  navigate(`/alerts/${selectedAlert.id}`);
                }}
                className="bg-cyan-600 hover:bg-cyan-700"
              >
                查看 AI 分析
              </Button>
              {selectedAlert.status === 'pending' && (
                <Button
                  type="primary"
                  onClick={() => {
                    handleProcess(selectedAlert.id);
                    setIsDetailOpen(false);
                  }}
                  className="bg-green-600 hover:bg-green-700"
                >
                  开始处理
                </Button>
              )}
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={() => handleDelete(selectedAlert.id)}
              >
                删除
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ToolOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  SearchOutlined,
  EnvironmentOutlined,
  ArrowRightOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Button, Tag, Input, Select, Empty, Spin } from 'antd';
import { GlassCard } from '../../components/GlassCard';
import { alertApi } from '../../services/api';

/**
 * 响应处置中心（列表）
 * 处置单来源于预警单：status in ['confirmed','processing','resolved']
 * - 待派发 = confirmed
 * - 进行中 = processing
 * - 已闭环 = resolved
 */

interface AlertLike {
  id: string;
  code?: string;
  title?: string;
  description?: string;
  level?: 'critical' | 'high' | 'medium' | 'low' | string;
  status?: string;
  station_name?: string;
  station?: string | { name: string };
  indicator?: string;
  created_at?: string;
  createdAt?: string;
}

const STATUS_TABS: Array<{ key: string; label: string; statuses: string[]; color: string }> = [
  { key: 'pending', label: '待派发', statuses: ['confirmed'], color: 'orange' },
  { key: 'processing', label: '进行中', statuses: ['processing'], color: 'blue' },
  { key: 'resolved', label: '已闭环', statuses: ['resolved'], color: 'green' },
];

const LEVEL_MAP: Record<string, { text: string; color: string; bg: string }> = {
  critical: { text: '紧急', color: '#dc2626', bg: '#fee2e2' },
  high: { text: '高', color: '#ea580c', bg: '#ffedd5' },
  medium: { text: '中', color: '#d97706', bg: '#fef3c7' },
  low: { text: '低', color: '#059669', bg: '#d1fae5' },
};

export default function Disposal() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<AlertLike[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('processing');
  const [searchText, setSearchText] = useState('');
  const [levelFilter, setLevelFilter] = useState<string | null>(null);

  const fetchDisposalList = useCallback(async () => {
    setLoading(true);
    try {
      // 拉取所有非 pending 的预警，前端按 tab 再过滤
      const res: any = await alertApi.getAlerts({ limit: 200 });
      const items = res?.items ?? res?.data?.items ?? res ?? [];
      setAlerts(Array.isArray(items) ? items : []);
    } catch (err) {
      console.warn('fetch alerts failed', err);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDisposalList();
    const timer = setInterval(fetchDisposalList, 30000);
    return () => clearInterval(timer);
  }, [fetchDisposalList]);

  const filtered = useMemo(() => {
    const tab = STATUS_TABS.find((t) => t.key === activeTab);
    const targetStatuses = tab?.statuses || [];
    return alerts.filter((a) => {
      if (!targetStatuses.includes(String(a.status))) return false;
      if (levelFilter && a.level !== levelFilter) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        const hay = `${a.code || ''} ${a.title || ''} ${a.description || ''} ${getStationName(a)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [alerts, activeTab, searchText, levelFilter]);

  const stats = useMemo(() => {
    return {
      pending: alerts.filter((a) => a.status === 'confirmed').length,
      processing: alerts.filter((a) => a.status === 'processing').length,
      resolved: alerts.filter((a) => a.status === 'resolved').length,
    };
  }, [alerts]);

  return (
    <div className="space-y-6">
      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatBlock title="待派发" value={stats.pending} icon={<ExclamationCircleOutlined />} color="text-orange-500" />
        <StatBlock title="进行中" value={stats.processing} icon={<ClockCircleOutlined />} color="text-blue-500" />
        <StatBlock title="已闭环" value={stats.resolved} icon={<CheckCircleOutlined />} color="text-green-500" />
      </div>

      {/* 工具栏 */}
      <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2 rounded-full text-sm transition-all ${
                activeTab === t.key
                  ? 'bg-cyan-600 text-white shadow'
                  : 'bg-white/70 text-gray-600 hover:bg-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索单号 / 站点 / 指标"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-64"
          />
          <Select
            allowClear
            placeholder="严重程度"
            value={levelFilter || undefined}
            onChange={(v) => setLevelFilter(v || null)}
            options={Object.entries(LEVEL_MAP).map(([k, v]) => ({ value: k, label: v.text }))}
            className="w-32"
          />
          <Button icon={<ReloadOutlined />} onClick={fetchDisposalList} loading={loading}>
            刷新
          </Button>
        </div>
      </div>

      {/* 处置单列表 */}
      <div>
        {loading ? (
          <div className="flex justify-center py-16">
            <Spin size="large" />
          </div>
        ) : filtered.length === 0 ? (
          <GlassCard className="p-12">
            <Empty description={`暂无「${STATUS_TABS.find((t) => t.key === activeTab)?.label}」处置单`} />
          </GlassCard>
        ) : (
          <div className="space-y-4">
            {filtered.map((a) => (
              <GlassCard key={a.id} className="p-5 transition hover:shadow-lg">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <LevelBadge level={String(a.level)} />
                      <span className="text-sm text-gray-500 font-mono">{a.code || a.id}</span>
                      <Tag icon={<ToolOutlined />} color="cyan">处置单</Tag>
                    </div>
                    <h4 className="text-lg font-semibold text-gray-900 mb-1">{a.title || '预警事件'}</h4>
                    <p className="text-sm text-gray-600 mb-2 line-clamp-2">{a.description}</p>
                    <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                      <span className="flex items-center gap-1">
                        <EnvironmentOutlined /> {getStationName(a)}
                      </span>
                      {a.indicator && <span>· {a.indicator}</span>}
                      {(a.created_at || a.createdAt) && (
                        <span className="flex items-center gap-1">
                          <ClockCircleOutlined /> {formatTime(a.created_at || a.createdAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button onClick={() => navigate(`/alerts/${a.id}`)}>AI 分析</Button>
                    <Button
                      type="primary"
                      icon={<ArrowRightOutlined />}
                      onClick={() => navigate(`/disposal/${a.id}`)}
                      className="bg-cyan-600 hover:bg-cyan-700"
                    >
                      处置跟踪
                    </Button>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatBlock({ title, value, icon, color }: { title: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <GlassCard className="p-5">
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

function LevelBadge({ level }: { level: string }) {
  const cfg = LEVEL_MAP[level] || { text: level, color: '#6b7280', bg: '#f3f4f6' };
  return (
    <span
      className="px-3 py-1 rounded-full text-xs font-medium"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}
    >
      {cfg.text}
    </span>
  );
}

function getStationName(a: AlertLike): string {
  if (!a) return '-';
  if (a.station_name) return a.station_name;
  if (typeof a.station === 'string') return a.station;
  if (a.station && typeof a.station === 'object' && 'name' in a.station) return a.station.name;
  return '-';
}

function formatTime(t?: string): string {
  if (!t) return '-';
  try {
    return new Date(t).toLocaleString('zh-CN');
  } catch {
    return t;
  }
}

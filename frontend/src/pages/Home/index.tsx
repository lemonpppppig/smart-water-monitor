import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DashboardOutlined,
  EnvironmentOutlined,
  BellOutlined,
  RobotOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Button, Empty, Spin, Tag } from 'antd';
import ReactECharts from 'echarts-for-react';
import { GlassCard } from '../../components/GlassCard';
import { alertApi, dataApi, stationApi } from '../../services/api';

interface HomeAlert {
  id: string;
  title: string;
  level: string;
  time: string;
  station: string;
}

const quickLinks = [
  { title: '监测大屏', icon: DashboardOutlined, path: '/dashboard', color: 'text-cyan-500', desc: '实时数据可视化' },
  { title: '站点管理', icon: EnvironmentOutlined, path: '/stations', color: 'text-emerald-500', desc: '站点信息维护' },
  { title: '预警中心', icon: BellOutlined, path: '/alerts', color: 'text-amber-500', desc: '异常事件处理' },
  { title: '智能体管理', icon: RobotOutlined, path: '/ai/agents', color: 'text-violet-500', desc: 'AI任务调度' },
];

interface StatCardProps {
  title: string;
  value: string | number;
  trend?: string;
  trendUp?: boolean;
  color: string;
  icon: React.ReactNode;
}

function StatCard({ title, value, trend, trendUp, color, icon }: StatCardProps) {
  return (
    <GlassCard className="relative overflow-hidden p-6 transition-all duration-300 hover:-translate-y-1">
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${color}`} style={{ borderRadius: '2px 0 0 2px' }} />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 mb-1">{title}</p>
          <p className="text-3xl font-bold text-gray-900">{value}</p>
          {trend && (
            <p className={`text-xs mt-2 flex items-center ${trendUp ? 'text-green-600' : 'text-red-600'}`}>
              {trendUp ? <CheckCircleOutlined className="mr-1" /> : <WarningOutlined className="mr-1" />}
              {trend}
            </p>
          )}
        </div>
        <div className={`text-3xl ${color}`}>{icon}</div>
      </div>
    </GlassCard>
  );
}

function formatRelativeTime(iso?: string) {
  if (!iso) return '-';
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60 / 1000)}分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 60 / 60 / 1000)}小时前`;
  return date.toLocaleString('zh-CN');
}

export default function Home() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [loading, setLoading] = useState(false);
  const [stationTotal, setStationTotal] = useState(0);
  const [stationOnline, setStationOnline] = useState(0);
  const [todayAlerts, setTodayAlerts] = useState(0);
  const [pendingAlerts, setPendingAlerts] = useState(0);
  const [recentAlerts, setRecentAlerts] = useState<HomeAlert[]>([]);
  const [trendSeries, setTrendSeries] = useState<{ x: string[]; y: number[] }>({ x: [], y: [] });
  const [trendStationName, setTrendStationName] = useState('');

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [stationRes, alertStatsRes, alertListRes] = await Promise.all([
        stationApi.getStations({ page: 1, size: 500 }).catch(() => null),
        alertApi.getAlertStatistics().catch(() => null),
        alertApi.getAlerts({ page: 1, size: 5 }).catch(() => null),
      ]);

      // 站点统计
      const stationItems: any[] = (stationRes as any)?.items || (stationRes as any) || [];
      setStationTotal((stationRes as any)?.total ?? stationItems.length ?? 0);
      const online = stationItems.filter(s => s.status === 'online' || s.status === 'active' || s.status === 'normal').length;
      setStationOnline(online);

      // 预警统计
      const stats: any = alertStatsRes || {};
      setTodayAlerts(stats.today ?? stats.total ?? 0);
      setPendingAlerts((stats.by_status?.pending ?? 0) + (stats.by_status?.new ?? 0));

      // 最近预警
      const alertItems: any[] = (alertListRes as any)?.items || [];
      setRecentAlerts(alertItems.slice(0, 5).map(a => ({
        id: a.id,
        title: a.title || a.alert_code || '未命名预警',
        level: a.alert_level || 'low',
        time: formatRelativeTime(a.created_at),
        station: a.station_id ? String(a.station_id).slice(0, 8) : '未知站点',
      })));

      // 水质趋势：取第一个站点最近24小时
      if (stationItems.length > 0) {
        const firstStation = stationItems[0];
        setTrendStationName(firstStation.station_name || firstStation.name || '站点');
        try {
          const end = new Date();
          const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
          const hist: any = await dataApi.getHistoryData(firstStation.id, {
            metric_code: 'pH',
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            limit: 24,
          });
          const points: any[] = hist?.items || hist?.data || hist || [];
          const xs = points.map(p => new Date(p.timestamp || p.time || p.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
          const ys = points.map(p => Number(p.value ?? p.ph ?? 0));
          setTrendSeries({ x: xs, y: ys });
        } catch {
          setTrendSeries({ x: [], y: [] });
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const trendOption = useMemo(() => ({
    xAxis: {
      type: 'category',
      data: trendSeries.x,
      axisLine: { lineStyle: { color: '#e5e7eb' } },
      axisLabel: { color: '#6b7280' },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      splitLine: { lineStyle: { color: '#f3f4f6' } },
      axisLabel: { color: '#6b7280' },
    },
    tooltip: { trigger: 'axis' },
    series: [
      {
        name: 'pH',
        data: trendSeries.y,
        type: 'line',
        smooth: true,
        lineStyle: { color: '#0891b2', width: 3 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(8, 145, 178, 0.3)' },
              { offset: 1, color: 'rgba(8, 145, 178, 0.05)' },
            ],
          },
        },
        symbol: 'circle',
        symbolSize: 8,
        itemStyle: { color: '#0891b2', borderWidth: 2, borderColor: '#fff' },
      },
    ],
    grid: { left: 16, right: 16, top: 16, bottom: 16, containLabel: true },
  }), [trendSeries]);

  const onlineRate = stationTotal > 0 ? ((stationOnline / stationTotal) * 100).toFixed(1) : '0';

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">欢迎回来，管理员</h2>
          <p className="text-gray-500 mt-1">今天是 {currentTime.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p>
        </div>
        <div className="flex items-center gap-4">
          <Button icon={<ReloadOutlined />} onClick={loadData} loading={loading}>刷新</Button>
          <p className="text-3xl font-light text-gray-700">
            {currentTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
        <StatCard
          title="总站点数"
          value={stationTotal}
          trend={stationTotal > 0 ? `${stationTotal} 个接入` : '暂无站点'}
          trendUp={true}
          color="text-blue-500"
          icon={<EnvironmentOutlined />}
        />
        <StatCard
          title="在线站点"
          value={stationOnline}
          trend={`${onlineRate}% 在线率`}
          trendUp={stationOnline === stationTotal}
          color="text-green-500"
          icon={<CheckCircleOutlined />}
        />
        <StatCard
          title="今日预警"
          value={todayAlerts}
          trend={pendingAlerts > 0 ? `待处理 ${pendingAlerts}` : '全部已处理'}
          trendUp={pendingAlerts === 0}
          color="text-amber-500"
          icon={<BellOutlined />}
        />
        <StatCard
          title="系统状态"
          value={pendingAlerts > 0 ? '预警中' : '正常'}
          color="text-cyan-500"
          icon={<CheckCircleOutlined />}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <GlassCard className="p-6 h-80">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                水质趋势 · pH · {trendStationName || '加载中'}
              </h3>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-cyan-500" />
                <span className="text-sm text-gray-500">pH值</span>
              </div>
            </div>
            <Spin spinning={loading} wrapperClassName="h-full">
              {trendSeries.x.length > 0 ? (
                <ReactECharts option={trendOption} style={{ height: 'calc(100% - 40px)' }} />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <Empty description="暂无监测数据" />
                </div>
              )}
            </Spin>
          </GlassCard>
        </div>

        {/* Recent Alerts */}
        <GlassCard className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">最近预警</h3>
            <Link to="/alerts" className="text-sm text-cyan-600 hover:text-cyan-700 flex items-center">
              查看全部 <ArrowRightOutlined className="ml-1" />
            </Link>
          </div>
          {recentAlerts.length === 0 ? (
            <Empty description="暂无预警" />
          ) : (
            <div className="space-y-3">
              {recentAlerts.map((alert) => (
                <Link
                  to={`/alerts/${alert.id}`}
                  key={alert.id}
                  className="block p-4 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{alert.title}</p>
                      <p className="text-sm text-gray-500 mt-1">{alert.station} · {alert.time}</p>
                    </div>
                    <Tag
                      color={alert.level === 'critical' || alert.level === 'high' ? 'red' : alert.level === 'medium' ? 'orange' : 'blue'}
                      className="border-0"
                    >
                      {alert.level === 'critical' ? '紧急' : alert.level === 'high' ? '高' : alert.level === 'medium' ? '中' : '低'}
                    </Tag>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      {/* Quick Access */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">快速入口</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
          {quickLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.path}
                to={link.path}
                className="group relative overflow-hidden rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1"
                style={{
                  background: 'rgba(255, 255, 255, 0.7)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                }}
              >
                <div className={`text-4xl ${link.color} mb-4 group-hover:scale-110 transition-transform`}>
                  <Icon />
                </div>
                <h4 className="text-lg font-semibold text-gray-900 mb-1">{link.title}</h4>
                <p className="text-sm text-gray-500">{link.desc}</p>
                <ArrowRightOutlined className="absolute bottom-6 right-6 text-gray-300 group-hover:text-cyan-500 group-hover:translate-x-1 transition-all" />
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

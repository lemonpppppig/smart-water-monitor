import { useState, useEffect, useMemo } from 'react';

import {
  BellOutlined,
  ClockCircleOutlined,
  RobotOutlined,
  SyncOutlined,
  ArrowRightOutlined,
  AimOutlined,
} from '@ant-design/icons';
import { Tag, Progress, Button } from 'antd';
import { useNavigate } from 'react-router-dom';

import { aiApi, alertApi, dataApi, stationApi } from '@/services/api';
import { useConfigStore } from '../Map/stores';
import { useUIStore } from '@/store';
import { maskDeep } from '@/utils/mask';

import TopoView from '../Map/TopoView';

const STATION_TYPE_MAP: Record<string, string> = {
  water_source: '水源地',
  industrial_park: '工业园区',
  boundary_section: '跨界断面',
  rural_water: '农村水体',
};

const TYPE_COLORS: Record<string, string> = {
  water_source: '#22d3ee',
  industrial_park: '#fb923c',
  boundary_section: '#a78bfa',
  rural_water: '#34d399',
};

interface StationItem {
  id: string;
  station_code: string;
  station_name: string;
  station_type: string;
  region?: string;
  longitude?: number;
  latitude?: number;
  status: string;
}

interface StationMetric {
  ph: number | null;
  do: number | null;
  status: 'normal' | 'warning' | 'offline';
}

interface AlertRow {
  id: string;
  title: string;
  level: string;
  time: string;
  station: string;
}

// 接入站点全量实时指标（对齐 TDengine water_quality 超级表）
interface StationLatest {
  ts?: string | null;
  ph?: number | null;
  do?: number | null;
  nh3_n?: number | null;
  codmn?: number | null;
  codcr?: number | null;
  turbidity?: number | null;
  conductivity?: number | null;
  water_temperature?: number | null;
  chlorophyll?: number | null;
  blue_green_algae?: number | null;
  total_n?: number | null;
  total_p?: number | null;
  transparency?: number | null;
  orp?: number | null;
}

// 指标展示配置（对齐 metrics_catalog III 类水阈值）
const METRIC_CARDS: Array<{
  key: keyof StationLatest;
  label: string;
  unit: string;
  decimals: number;
  warn?: (v: number) => boolean;
  color: string;
}> = [
  { key: 'nh3_n',             label: '氨氮',       unit: 'mg/L',    decimals: 2, warn: v => v > 1.0,      color: '#f472b6' },
  { key: 'codmn',             label: '高锰盐',   unit: 'mg/L',    decimals: 2, warn: v => v > 6.0,      color: '#facc15' },
  { key: 'turbidity',         label: '浊度',       unit: 'NTU',     decimals: 1, warn: v => v > 3.0,      color: '#fb923c' },
  { key: 'conductivity',      label: '电导率',   unit: 'μS/cm',  decimals: 0, warn: v => v > 1000,     color: '#818cf8' },
  { key: 'water_temperature', label: '水温',       unit: '℃',      decimals: 1, warn: v => v > 35 || v < 0, color: '#38bdf8' },
  { key: 'chlorophyll',       label: '叶绿素a',  unit: 'μg/L',   decimals: 1, warn: v => v > 10,       color: '#4ade80' },
  { key: 'total_n',           label: '总氮',       unit: 'mg/L',    decimals: 2, warn: v => v > 1.0,      color: '#a78bfa' },
  { key: 'total_p',           label: '总磷',       unit: 'mg/L',    decimals: 3, warn: v => v > 0.05,     color: '#f87171' },
];

// 赣州流域监测站点默认数据（后端未就绪时兜底）
// 注：这里保留原文，使用时经过 applyMaskIfDemo 统一处理
const FALLBACK_STATIONS_RAW: StationItem[] = [
  { id: 'fb-1', station_code: 'WS001', station_name: '赣江水源地站', station_type: 'water_source', region: '章贡区', longitude: 114.9501322, latitude: 25.8638905, status: 'active' },
  { id: 'fb-2', station_code: 'WS002', station_name: '章江水源地站', station_type: 'water_source', region: '章贡区', longitude: 114.9318298, latitude: 25.8440238, status: 'active' },
  { id: 'fb-3', station_code: 'IP001', station_name: '赣州经开区工业监测站', station_type: 'industrial_park', region: '赣县区', longitude: 114.984947, latitude: 25.8471573, status: 'active' },
  { id: 'fb-4', station_code: 'BS001', station_name: '赣江出境断面站', station_type: 'boundary_section', region: '章贡区', longitude: 114.9341583, latitude: 26.302264, status: 'active' },
  { id: 'fb-5', station_code: 'RW001', station_name: '崇义江农村水体站', station_type: 'rural_water', region: '崇义县', longitude: 114.3056953, latitude: 25.7011119, status: 'active' },
];

const applyMaskIfDemo = <T,>(v: T): T => (useUIStore.getState().demoMode ? maskDeep(v) : v);
const FALLBACK_STATIONS: StationItem[] = applyMaskIfDemo(FALLBACK_STATIONS_RAW);

function classifyStatus(ph: number | null, doVal: number | null, stationStatus: string): StationMetric['status'] {
  if (stationStatus === 'offline' || stationStatus === 'maintenance') return 'offline';
  if (ph == null && doVal == null) return 'offline';
  const phOk = ph == null || (ph >= 6.5 && ph <= 8.5);
  const doOk = doVal == null || doVal >= 5.0;
  return phOk && doOk ? 'normal' : 'warning';
}

function formatRelativeTime(iso?: string) {
  if (!iso) return '-';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60 / 1000)}分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 60 / 60 / 1000)}小时前`;
  return new Date(iso).toLocaleString('zh-CN');
}

const HOURS_24 = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

export default function Dashboard() {
  const navigate = useNavigate();
  const setFocusedStation = useConfigStore((s) => s.setFocusedStation);

  const [stations, setStations] = useState<StationItem[]>(FALLBACK_STATIONS);
  const [isFallback, setIsFallback] = useState(false);
  const [metricsMap, setMetricsMap] = useState<Record<string, StationMetric>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [alertStats, setAlertStats] = useState<{ total: number; by_level: Record<string, number> }>({ total: 0, by_level: {} });
  const [phSeries, setPhSeries] = useState<{ labels: string[]; values: (number | null)[] }>({ labels: HOURS_24, values: [] });
  const [doSeries, setDoSeries] = useState<{ labels: string[]; values: (number | null)[] }>({ labels: HOURS_24, values: [] });
  const [chartStationName, setChartStationName] = useState('');
  const [activeLatest, setActiveLatest] = useState<StationLatest | null>(null);
  const [phStat, setPhStat] = useState<{ cur: number | null; min: number | null; max: number | null }>({ cur: null, min: null, max: null });
  const [doStat, setDoStat] = useState<{ cur: number | null; min: number | null; max: number | null }>({ cur: null, min: null, max: null });

  const [aiStatus, setAiStatus] = useState({
    isRunning: true,
    mode: '-',
    activeAgents: 0,
    runningTasks: 0,
    currentStation: '',
    currentIndex: 0,
    progress: 0,
  });

  // 加载站点 + 最新水质
  useEffect(() => {
    (async () => {
      try {
        const res: any = await stationApi.getStations({ page: 1, size: 500 });
        const items: StationItem[] = res?.items || [];
        const valid = items.filter(s => s.longitude && s.latitude);
        const finalStations = valid.length > 0 ? valid : FALLBACK_STATIONS;
        setStations(finalStations);
        setIsFallback(valid.length === 0);

        // 并行拉取各站点最新数据
        const pairs = await Promise.all(finalStations.map(async (s) => {
          try {
            const latest: any = await dataApi.getLatestData(s.id);
            // latest 可能是 { metrics: {ph: x, dissolved_oxygen: y} } 或数组
            const m = latest?.metrics || latest?.values || latest || {};
            const ph = Number(m.pH ?? m.ph ?? m.PH ?? null);
            const doVal = Number(m.DO ?? m.do ?? m.dissolved_oxygen ?? null);
            const met: StationMetric = {
              ph: isFinite(ph) && ph > 0 ? ph : null,
              do: isFinite(doVal) && doVal > 0 ? doVal : null,
              status: 'normal',
            };
            met.status = classifyStatus(met.ph, met.do, s.status);
            return [s.id, met] as const;
          } catch {
            return [s.id, { ph: null, do: null, status: 'offline' as const }] as const;
          }
        }));
        const map: Record<string, StationMetric> = {};
        pairs.forEach(([id, m]) => { map[id] = m; });
        setMetricsMap(map);
      } catch {
        // 保留 FALLBACK
        setIsFallback(true);
      }
    })();
  }, []);

  // 加载预警列表与统计
  useEffect(() => {
    (async () => {
      try {
        const [listRes, statsRes] = await Promise.all([
          alertApi.getAlerts({ page: 1, size: 5 }).catch(() => null),
          alertApi.getAlertStatistics().catch(() => null),
        ]);
        const items: any[] = (listRes as any)?.items || [];
        setAlerts(items.map(a => ({
          id: a.id,
          title: a.title || a.alert_code || '未命名预警',
          level: a.alert_level || 'low',
          time: formatRelativeTime(a.created_at),
          station: a.station_id ? String(a.station_id).slice(0, 8) : '-',
        })));
        const stats: any = statsRes || {};
        setAlertStats({
          total: stats.total ?? items.length ?? 0,
          by_level: stats.by_level || {},
        });
      } catch {
        setAlerts([]);
      }
    })();
  }, []);

  // AI 系统状态
  useEffect(() => {
    (async () => {
      try {
        const res: any = await aiApi.getSystemStatus();
        setAiStatus(prev => ({
          ...prev,
          mode: res?.mode || res?.status || 'running',
          activeAgents: res?.active_agents ?? res?.agent_count ?? 0,
          runningTasks: res?.running_tasks ?? res?.task_count ?? 0,
          isRunning: (res?.status || 'running') !== 'stopped',
        }));
      } catch {
        /* keep default */
      }
    })();
  }, []);

  // 自动识别"已接入数据"的站点：metricsMap 中存在非空 ph/do 或状态非 offline
  const activeStation = useMemo(() => {
    // 优先用户手动选择
    if (selectedId) {
      const picked = stations.find(s => s.id === selectedId);
      if (picked) return picked;
    }
    // 其次挑选有实时数据的站点（正常或异常，均代表已接入）
    const connected = stations.find(s => {
      const m = metricsMap[s.id];
      return m && m.status !== 'offline' && (m.ph != null || m.do != null);
    });
    if (connected) return connected;
    // 兜底：第一个站点
    return stations[0];
  }, [stations, metricsMap, selectedId]);

  // 加载已接入站点的 24h 趋势 + 全量最新指标
  useEffect(() => {
    const target = activeStation;
    if (!target) return;
    setChartStationName(target.station_name);
    (async () => {
      const end = new Date();
      const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
      const params = { start_time: start.toISOString(), end_time: end.toISOString(), limit: 48 };
      try {
        const [phRes, doRes, latestRes] = await Promise.all([
          dataApi.getHistoryData(target.id, { ...params, metric_code: 'pH' }).catch(() => null),
          dataApi.getHistoryData(target.id, { ...params, metric_code: 'DO' }).catch(() => null),
          dataApi.getLatestData(target.id).catch(() => null),
        ]);
        const extract = (res: any) => {
          const items: any[] = res?.items || res?.data || res || [];
          const labels = items.map(p => new Date(p.timestamp || p.time || p.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
          const values = items.map(p => {
            const v = Number(p.value ?? p.pH ?? p.DO ?? null);
            return isFinite(v) ? v : null;
          });
          return { labels, values };
        };
        const ph = extract(phRes);
        const doData = extract(doRes);
        setPhSeries(ph.labels.length ? ph : { labels: HOURS_24, values: [] });
        setDoSeries(doData.labels.length ? doData : { labels: HOURS_24, values: [] });

        // 计算 24h min/max/cur
        const stat = (values: (number | null)[]) => {
          const nums = values.filter((v): v is number => v != null && isFinite(v));
          if (!nums.length) return { cur: null, min: null, max: null };
          return { cur: nums[nums.length - 1], min: Math.min(...nums), max: Math.max(...nums) };
        };
        setPhStat(stat(ph.values));
        setDoStat(stat(doData.values));

        // 全量实时指标
        const latest: any = latestRes || {};
        const toNum = (v: any) => {
          const n = Number(v);
          return isFinite(n) ? n : null;
        };
        setActiveLatest({
          ts: latest.ts ?? latest.timestamp ?? null,
          ph: toNum(latest.ph ?? latest.pH),
          do: toNum(latest.do ?? latest.DO ?? latest.dissolved_oxygen),
          nh3_n: toNum(latest.nh3_n),
          codmn: toNum(latest.codmn),
          codcr: toNum(latest.codcr),
          turbidity: toNum(latest.turbidity),
          conductivity: toNum(latest.conductivity),
          water_temperature: toNum(latest.water_temperature),
          chlorophyll: toNum(latest.chlorophyll),
          blue_green_algae: toNum(latest.blue_green_algae),
          total_n: toNum(latest.total_n),
          total_p: toNum(latest.total_p),
          transparency: toNum(latest.transparency),
          orp: toNum(latest.orp),
        });
      } catch {
        setPhSeries({ labels: HOURS_24, values: [] });
        setDoSeries({ labels: HOURS_24, values: [] });
        setActiveLatest(null);
        setPhStat({ cur: null, min: null, max: null });
        setDoStat({ cur: null, min: null, max: null });
      }
    })();
  }, [activeStation]);

  // AI 巡检进度模拟（使用真实站点列表轮询）
  useEffect(() => {
    if (!aiStatus.isRunning || stations.length === 0) return;
    if (!aiStatus.currentStation) {
      setAiStatus(prev => ({ ...prev, currentStation: stations[0].station_name, currentIndex: 0 }));
    }
    const interval = setInterval(() => {
      setAiStatus(prev => {
        const newProgress = prev.progress + Math.random() * 5;
        if (newProgress >= 100) {
          const nextIdx = (prev.currentIndex + 1) % stations.length;
          return {
            ...prev,
            progress: 0,
            currentIndex: nextIdx,
            currentStation: stations[nextIdx].station_name,
          };
        }
        return { ...prev, progress: Math.min(newProgress, 99) };
      });
    }, 800);
    return () => clearInterval(interval);
  }, [aiStatus.isRunning, stations]);

  // 水质统计
  const waterStats = useMemo(() => {
    const total = stations.length || 1;
    let normal = 0, warning = 0, offline = 0;
    stations.forEach(s => {
      const m = metricsMap[s.id];
      const st = m?.status || 'offline';
      if (st === 'normal') normal++;
      else if (st === 'warning') warning++;
      else offline++;
    });
    return {
      good: ((normal / total) * 100).toFixed(1),
      warn: ((warning / total) * 100).toFixed(1),
      offline: ((offline / total) * 100).toFixed(1),
    };
  }, [stations, metricsMap]);

  // TopoView 用 useMemo 隔离，避免面板 state 更新导致重渲染
  const topoElement = useMemo(() => <TopoView />, []);



  const handleStationClick = (station: StationItem) => {
    setSelectedId(station.id === selectedId ? null : station.id);
    if (station.longitude && station.latitude) {
      setFocusedStation({
        longitude: station.longitude,
        latitude: station.latitude,
        name: station.station_name,
      });
    }
  };

  const levelToDotColor: Record<string, string> = {
    critical: 'bg-red-500',
    high: 'bg-red-500',
    medium: 'bg-amber-500',
    low: 'bg-green-500',
  };

  return (
    <div className="h-full w-full bg-[#050a14] text-slate-200 overflow-hidden relative font-sans">
      <div className="absolute inset-0 z-0">
        {topoElement}
      </div>

      <div className="absolute inset-0 z-10 pointer-events-none flex flex-col justify-between p-4">
        {/* 顶部标题 */}
        <div className="pointer-events-auto text-center pt-2">
          <div className="relative inline-block">
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-cyan-500/20 blur-3xl"></div>
            <h1 className="relative text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-white to-cyan-300 tracking-[0.2em] drop-shadow-[0_0_15px_rgba(34,211,238,0.5)]">
              水环境监测数字孪生平台
            </h1>
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-3/4 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent"></div>
            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-1/2 h-px bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent"></div>
          </div>
          <div className="mt-3 flex items-center justify-center gap-4">
            <div className="w-16 h-px bg-gradient-to-r from-transparent to-cyan-500/50"></div>
            <span className="text-xs text-cyan-400/70 tracking-[0.3em] font-light uppercase">Water Environment Digital Twin</span>
            <div className="w-16 h-px bg-gradient-to-l from-transparent to-cyan-500/50"></div>
          </div>
          {isFallback && (
            <div className="mt-2">
              <Tag color="orange" className="border-0 bg-orange-500/20 text-orange-300 text-xs">
                ⚠ 当前显示为演示站点数据，站点服务未接入或不可用
              </Tag>
            </div>
          )}
        </div>

        <div className="flex-1 flex justify-between items-start mt-2 min-h-0">
          {/* 左侧面板 */}
          <div className="w-80 flex flex-col gap-3 pointer-events-auto">
            <div className="glass-panel p-3 rounded-xl border border-white/10 bg-slate-900/80 shadow-lg">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-cyan-400 font-semibold text-sm tracking-wide">监测站点</h3>
                <span className="text-xs text-slate-500">{stations.length} 个</span>
              </div>
              <div className="space-y-1.5 max-h-[360px] overflow-y-auto custom-scrollbar pr-1">
                {stations.map((station) => {
                  const metric = metricsMap[station.id] || { ph: null, do: null, status: 'offline' as const };
                  const isSelected = station.id === selectedId;
                  const typeColor = TYPE_COLORS[station.station_type] || '#94a3b8';
                  return (
                    <div
                      key={station.id}
                      className={`p-2 rounded-lg cursor-pointer transition-all duration-200 border ${
                        isSelected
                          ? 'bg-cyan-950/50 border-cyan-500/40 shadow-[0_0_12px_rgba(34,211,238,0.15)]'
                          : 'bg-slate-800/40 border-transparent hover:bg-slate-800/60'
                      }`}
                      onClick={() => handleStationClick(station)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            metric.status === 'normal' ? 'bg-[#00ff88]' :
                            metric.status === 'warning' ? 'bg-[#ffaa00]' : 'bg-slate-500'
                          }`} />
                          <span className="text-sm font-medium text-slate-300 truncate">{station.station_name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="text-[10px] px-1 py-0.5 rounded" style={{ color: typeColor, background: `${typeColor}15` }}>
                            {STATION_TYPE_MAP[station.station_type] || station.station_type}
                          </span>
                          {isSelected && <AimOutlined className="text-cyan-400 text-xs" />}
                        </div>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-400 pl-3.5">
                        <span>pH <span className={metric.ph != null && metric.ph < 6.5 ? 'text-amber-400' : 'text-slate-300'}>{metric.ph?.toFixed(1) ?? '-'}</span></span>
                        <span>DO <span className={metric.do != null && metric.do < 5.0 ? 'text-amber-400' : 'text-slate-300'}>{metric.do?.toFixed(1) ?? '-'}</span></span>
                        <span className="text-slate-500 ml-auto text-[10px]">{station.region}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 水质统计 */}
            <div className="glass-panel p-3 rounded-xl border border-white/10 bg-slate-900/80 shadow-lg">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-cyan-400 font-semibold text-sm tracking-wide">水质统计</h3>
                <span className="text-xs text-slate-500">实时</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-2.5 rounded-lg bg-slate-800/40 border border-cyan-500/20">
                  <div className="text-xs text-slate-400 mb-1">正常</div>
                  <div className="text-xl font-bold text-[#00ff88]">{waterStats.good}%</div>
                  <div className="text-[10px] text-slate-500 mt-1">pH/DO 达标</div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-800/40 border border-amber-500/20">
                  <div className="text-xs text-slate-400 mb-1">异常</div>
                  <div className="text-xl font-bold text-[#ffaa00]">{waterStats.warn}%</div>
                  <div className="text-[10px] text-slate-500 mt-1">pH/DO 偏离</div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-800/40 border border-slate-500/20 col-span-2">
                  <div className="text-xs text-slate-400 mb-1">离线/无数据</div>
                  <div className="text-xl font-bold text-slate-400">{waterStats.offline}%</div>
                  <div className="text-[10px] text-slate-500 mt-1">数据未上传</div>
                </div>
              </div>
            </div>
          </div>

          {/* 右侧面板 */}
          <div className="w-80 flex flex-col gap-3 pointer-events-auto">
            <div className="glass-panel p-3 rounded-xl border border-cyan-500/20 bg-slate-900/85 shadow-lg">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-cyan-400 font-semibold flex items-center gap-2 text-sm">
                  <RobotOutlined className="text-cyan-300" /> AI 巡检
                </h3>
                <Tag color={aiStatus.isRunning ? 'cyan' : 'default'} className="border-0 bg-slate-800 text-xs">
                  {aiStatus.isRunning ? <><SyncOutlined spin className="text-cyan-400" /> 运行中</> : '已暂停'}
                </Tag>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 mb-2">
                <div>活跃智能体: <span className="text-cyan-300 font-semibold">{aiStatus.activeAgents}</span></div>
                <div>运行任务: <span className="text-cyan-300 font-semibold">{aiStatus.runningTasks}</span></div>
              </div>
              <div className="p-2.5 rounded-lg bg-cyan-950/30 border border-cyan-500/20 mb-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-slate-400 text-xs truncate">当前: {aiStatus.currentStation || '-'}</span>
                  <span className="text-cyan-300 text-xs">{Math.round(aiStatus.progress)}%</span>
                </div>
                <Progress
                  percent={Math.round(aiStatus.progress)}
                  size="small"
                  strokeColor={{ '0%': '#06b6d4', '100%': '#22d3ee' }}
                  railColor="rgba(255,255,255,0.1)"
                  showInfo={false}
                />
              </div>
              <div className="flex gap-2">
                <Button size="small" type="text" className="flex-1 text-xs text-slate-400 hover:text-white" onClick={() => navigate('/ai/agents')}>详情</Button>
                <Button
                  size="small" type="primary" ghost
                  className="flex-1 text-xs border-cyan-500/50 text-cyan-400"
                  onClick={() => setAiStatus(prev => ({ ...prev, isRunning: !prev.isRunning }))}
                >
                  {aiStatus.isRunning ? '暂停' : '启动'}
                </Button>
              </div>
            </div>

            {/* 实时预警 */}
            <div className="glass-panel p-3 rounded-xl border border-white/10 bg-slate-900/80 shadow-lg">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-cyan-400 font-semibold flex items-center gap-2 text-sm">
                  <BellOutlined className="text-amber-400" /> 实时预警
                </h3>
                <span className="text-xs text-cyan-500 bg-cyan-950/50 px-2 py-0.5 rounded border border-cyan-500/20">{alertStats.total}条</span>
              </div>
              <div className="space-y-2">
                {alerts.length === 0 ? (
                  <div className="text-center text-slate-500 text-xs py-4">暂无预警</div>
                ) : alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="p-2.5 rounded-lg bg-slate-800/40 hover:bg-slate-800/60 border border-transparent transition-all cursor-pointer"
                    onClick={() => navigate(`/alerts/${alert.id}`)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${levelToDotColor[alert.level] || 'bg-slate-500'}`} />
                      <span className="text-slate-200 text-sm truncate">{alert.title}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500 pl-3">
                      <span>{alert.station}</span>
                      <span className="flex items-center gap-1">
                        <ClockCircleOutlined className="text-xs" /> {alert.time}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <Button type="link" className="text-cyan-500 hover:text-cyan-300 text-xs mt-2 p-0 h-auto" onClick={() => navigate('/alerts')}>
                查看全部 <ArrowRightOutlined className="text-xs" />
              </Button>
            </div>
          </div>
        </div>

        {/* 底部概览条 */}
        <div className="pointer-events-auto mt-auto mx-4 mb-2">
          <div className="glass-panel rounded-xl border border-white/10 bg-slate-900/85 shadow-lg px-5 py-3">
            <div className="flex items-center justify-between gap-6">
              {/* 站点总览 */}
              <div className="flex items-center gap-4">
                <div className="text-xs text-slate-400 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                  <span>监测站点</span>
                  <span className="text-cyan-300 font-bold text-sm ml-1">{stations.length}</span>
                </div>
                <div className="w-px h-4 bg-slate-700"></div>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#00ff88]"></span> 正常 <span className="text-[#00ff88] font-semibold">{waterStats.good}%</span></span>
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#ffaa00]"></span> 异常 <span className="text-[#ffaa00] font-semibold">{waterStats.warn}%</span></span>
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-slate-500"></span> 离线 <span className="text-slate-400 font-semibold">{waterStats.offline}%</span></span>
                </div>
              </div>

              {/* 核心水质指标（当前站点） */}
              <div className="flex items-center gap-4">
                <div className="text-[11px] text-slate-500 mr-1">{chartStationName || '—'}</div>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-slate-400">pH <span className={`font-bold ${phStat.cur != null && (phStat.cur < 6.5 || phStat.cur > 8.5) ? 'text-amber-300' : 'text-cyan-300'}`}>{phStat.cur?.toFixed(2) ?? '-'}</span></span>
                  <span className="text-slate-400">DO <span className={`font-bold ${doStat.cur != null && doStat.cur < 5.0 ? 'text-amber-300' : 'text-green-300'}`}>{doStat.cur?.toFixed(2) ?? '-'}</span> <span className="text-slate-600">mg/L</span></span>
                  {activeLatest?.nh3_n != null && <span className="text-slate-400">氨氮 <span className={`font-bold ${activeLatest.nh3_n > 1.0 ? 'text-amber-300' : 'text-slate-200'}`}>{activeLatest.nh3_n.toFixed(2)}</span></span>}
                  {activeLatest?.turbidity != null && <span className="text-slate-400">浊度 <span className={`font-bold ${activeLatest.turbidity > 3.0 ? 'text-amber-300' : 'text-slate-200'}`}>{activeLatest.turbidity.toFixed(1)}</span></span>}
                </div>
                {activeLatest?.ts && (
                  <span className="text-[10px] text-slate-600">
                    {formatRelativeTime(typeof activeLatest.ts === 'string' ? activeLatest.ts : new Date(activeLatest.ts as any).toISOString())}
                  </span>
                )}
              </div>

              {/* 预警概览 */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs">
                  <BellOutlined className="text-amber-400" />
                  <span className="text-slate-400">预警</span>
                  <span className="text-amber-300 font-bold">{alertStats.total}</span>
                </div>
                {alertStats.by_level.critical > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">紧急 {alertStats.by_level.critical}</span>}
                {alertStats.by_level.high > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30">高 {alertStats.by_level.high}</span>}
              </div>

              {/* AI 状态 */}
              <div className="flex items-center gap-2 text-xs">
                <RobotOutlined className="text-cyan-400" />
                <span className="text-slate-400">AI</span>
                {aiStatus.isRunning
                  ? <span className="text-cyan-300 flex items-center gap-1"><SyncOutlined spin className="text-[10px]" /> 巡检中</span>
                  : <span className="text-slate-500">已暂停</span>
                }
              </div>

              {/* 时间 */}
              <div className="text-[11px] text-slate-500 flex items-center gap-1">
                <ClockCircleOutlined className="text-[10px]" />
                {new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .glass-panel { box-shadow: 0 4px 30px rgba(0, 0, 0, 0.3); }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.05); border-radius: 2px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 2px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.4); }
      `}</style>
    </div>
  );
}

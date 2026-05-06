import { useState, useEffect } from 'react';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  SyncOutlined,
  ExclamationCircleOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Progress, Tag, Timeline, Button, message } from 'antd';
import ReactECharts from 'echarts-for-react';
import { GlassCard } from '../GlassCard';

interface TrackingData {
  alertId: string;
  indicator: string;
  unit: string;
  threshold: { min: number; max: number };
  currentValue: number;
  initialValue: number;
  targetValue: number;
  trend: 'up' | 'down' | 'stable';
  status: 'recovering' | 'stable' | 'worsening' | 'resolved';
  startTime: string;
  estimatedRecoveryTime: string;
  historyData: { time: string; value: number }[];
  measures: { time: string; action: string; result: string }[];
}

// 模拟跟踪数据
const mockTrackingData: TrackingData = {
  alertId: '1',
  indicator: 'pH值',
  unit: '',
  threshold: { min: 6.5, max: 9.0 },
  currentValue: 8.5,
  initialValue: 9.2,
  targetValue: 7.5,
  trend: 'down',
  status: 'recovering',
  startTime: '2024-03-13 14:32:00',
  estimatedRecoveryTime: '约2小时后',
  historyData: [
    { time: '14:30', value: 9.2 },
    { time: '14:45', value: 9.1 },
    { time: '15:00', value: 9.0 },
    { time: '15:15', value: 8.8 },
    { time: '15:30', value: 8.6 },
    { time: '15:45', value: 8.5 },
  ],
  measures: [
    { time: '14:45', action: '启动加密监测', result: '每15分钟采样一次' },
    { time: '15:00', action: '执法人员到达现场', result: '已定位污染源' },
    { time: '15:30', action: '责令停止排放', result: '上游企业已停止排放' },
  ],
};

const statusConfig: Record<string, { text: string; color: string; icon: React.ReactNode }> = {
  recovering: { text: '恢复中', color: 'blue', icon: <SyncOutlined spin /> },
  stable: { text: '已稳定', color: 'orange', icon: <ClockCircleOutlined /> },
  worsening: { text: '恶化中', color: 'red', icon: <ExclamationCircleOutlined /> },
  resolved: { text: '已恢复', color: 'green', icon: <CheckCircleOutlined /> },
};

interface DisposalTrackingProps {
  alertId: string;
  onRefresh?: () => void;
}

export default function DisposalTracking({ alertId, onRefresh }: DisposalTrackingProps) {
  const [data, setData] = useState<TrackingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // 模拟加载数据
  useEffect(() => {
    setLoading(true);
    setTimeout(() => {
      setData(mockTrackingData);
      setLoading(false);
    }, 500);
  }, [alertId]);

  // 自动刷新
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      // 模拟数据更新
      if (data) {
        const newValue = Math.max(
          data.threshold.min,
          data.currentValue - (Math.random() * 0.1)
        );
        setData((prev) =>
          prev
            ? {
                ...prev,
                currentValue: parseFloat(newValue.toFixed(2)),
                historyData: [
                  ...prev.historyData.slice(-5),
                  { time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), value: newValue },
                ],
              }
            : null
        );
      }
    }, 10000); // 每10秒更新一次

    return () => clearInterval(interval);
  }, [autoRefresh, data]);

  const handleRefresh = () => {
    message.info('正在刷新数据...');
    onRefresh?.();
  };

  if (loading || !data) {
    return (
      <GlassCard className="p-6">
        <div className="flex items-center justify-center h-40">
          <SyncOutlined spin className="text-2xl text-cyan-500" />
        </div>
      </GlassCard>
    );
  }

  const status = statusConfig[data.status];
  const recoveryProgress = Math.round(
    ((data.initialValue - data.currentValue) / (data.initialValue - data.targetValue)) * 100
  );

  // 趋势图配置
  const trendOption = {
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: data.historyData.map((d) => d.time),
      axisLine: { lineStyle: { color: '#e5e7eb' } },
      axisLabel: { color: '#6b7280', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      min: data.threshold.min - 0.5,
      max: data.threshold.max + 0.5,
      axisLine: { show: false },
      splitLine: { lineStyle: { color: '#f3f4f6' } },
      axisLabel: { color: '#6b7280', fontSize: 11 },
    },
    series: [
      {
        data: data.historyData.map((d) => d.value),
        type: 'line',
        smooth: true,
        lineStyle: { color: '#0891b2', width: 2 },
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
        symbolSize: 6,
        itemStyle: { color: '#0891b2' },
      },
    ],
    grid: { left: 10, right: 10, top: 10, bottom: 10, containLabel: true },
    markLine: {
      silent: true,
      data: [
        { yAxis: data.threshold.max, lineStyle: { color: '#ef4444', type: 'dashed' } },
        { yAxis: data.targetValue, lineStyle: { color: '#10b981', type: 'dashed' } },
      ],
    },
  };

  return (
    <GlassCard className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-gray-900">处置效果跟踪</h3>
          <Tag icon={status.icon} color={status.color}>
            {status.text}
          </Tag>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="small"
            type={autoRefresh ? 'primary' : 'default'}
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={autoRefresh ? 'bg-cyan-500' : ''}
          >
            {autoRefresh ? '自动刷新中' : '开启自动刷新'}
          </Button>
          <Button size="small" icon={<ReloadOutlined />} onClick={handleRefresh}>
            刷新
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="text-center p-3 bg-gray-50 rounded-xl">
          <p className="text-xs text-gray-500 mb-1">初始值</p>
          <p className="text-lg font-semibold text-red-500">
            {data.initialValue} {data.unit}
          </p>
        </div>
        <div className="text-center p-3 bg-gray-50 rounded-xl">
          <p className="text-xs text-gray-500 mb-1">当前值</p>
          <p className="text-lg font-semibold text-cyan-600 flex items-center justify-center gap-1">
            {data.currentValue} {data.unit}
            {data.trend === 'down' && <ArrowDownOutlined className="text-green-500 text-sm" />}
            {data.trend === 'up' && <ArrowUpOutlined className="text-red-500 text-sm" />}
          </p>
        </div>
        <div className="text-center p-3 bg-gray-50 rounded-xl">
          <p className="text-xs text-gray-500 mb-1">目标值</p>
          <p className="text-lg font-semibold text-green-500">
            {data.targetValue} {data.unit}
          </p>
        </div>
        <div className="text-center p-3 bg-gray-50 rounded-xl">
          <p className="text-xs text-gray-500 mb-1">预计恢复</p>
          <p className="text-lg font-semibold text-gray-700">{data.estimatedRecoveryTime}</p>
        </div>
      </div>

      {/* Recovery Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-600">恢复进度</span>
          <span className="text-sm font-medium text-cyan-600">{Math.min(100, Math.max(0, recoveryProgress))}%</span>
        </div>
        <Progress
          percent={Math.min(100, Math.max(0, recoveryProgress))}
          strokeColor={{
            '0%': '#0891b2',
            '100%': '#10b981',
          }}
          showInfo={false}
        />
      </div>

      {/* Trend Chart */}
      <div className="mb-6">
        <h4 className="text-sm font-medium text-gray-700 mb-2">实时趋势</h4>
        <ReactECharts option={trendOption} style={{ height: 150 }} />
      </div>

      {/* Measures Timeline */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-3">处置措施</h4>
        <Timeline
          items={data.measures.map((m) => ({
            color: 'cyan',
            children: (
              <div>
                <p className="text-sm text-gray-700">{m.action}</p>
                <p className="text-xs text-gray-500">{m.time} · {m.result}</p>
              </div>
            ),
          }))}
        />
      </div>
    </GlassCard>
  );
}

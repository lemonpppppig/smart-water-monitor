import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  ToolOutlined,
  EnvironmentOutlined,
  SendOutlined,
  SyncOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Button, Tag, Input, Modal, message, Steps, Timeline, Spin } from 'antd';
import { GlassCard } from '../../components/GlassCard';
import { alertApi } from '../../services/api';

/**
 * 处置单详情页
 * 承载：处置步骤推进、协作备注、效果验证
 * - 用 alertApi.getAlert 拿基础信息
 * - 用 alertApi.confirmAlert / resolveAlert 推进状态
 */

interface AlertDetailLike {
  id: string;
  code?: string;
  title?: string;
  description?: string;
  level?: string;
  status?: string;
  station_name?: string;
  station?: any;
  indicator?: string;
  created_at?: string;
  createdAt?: string;
  confirmed_at?: string | null;
  resolved_at?: string | null;
  recommendations?: any[];
  timeline?: any[];
  notes?: Array<{ time: string; author: string; content: string }>;
}

const STATUS_STEP_MAP: Record<string, number> = {
  pending: 0,
  confirmed: 1,
  processing: 2,
  resolved: 3,
};

export default function DisposalDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<AlertDetailLike | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveNote, setResolveNote] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [notes, setNotes] = useState<Array<{ time: string; author: string; content: string }>>([]);
  const [submitting, setSubmitting] = useState(false);

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res: any = await alertApi.getAlert(id);
      const payload: AlertDetailLike = res?.data || res || {};
      setData(payload);
      if (Array.isArray(payload.notes)) setNotes(payload.notes);
    } catch (err) {
      console.warn('getAlert failed', err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const handleConfirm = async () => {
    if (!id) return;
    setSubmitting(true);
    try {
      await alertApi.confirmAlert(id, {});
      message.success('已确认处置单');
      fetchDetail();
    } catch (err: any) {
      message.error('确认失败：' + (err?.message || '后端不可用'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartProcess = async () => {
    if (!id) return;
    setSubmitting(true);
    try {
      // 后端无 process 接口时，前端通过 updateAlert 推进（若失败也只提示）
      await (alertApi as any).updateAlert?.(id, { status: 'processing' });
      message.success('已进入处理中');
      fetchDetail();
    } catch (err: any) {
      // 兜底：仅在前端态推进
      message.warning('后端未就绪，仅在本地推进状态');
      setData((prev) => (prev ? { ...prev, status: 'processing' } : prev));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolve = async () => {
    if (!id) return;
    setSubmitting(true);
    try {
      await alertApi.resolveAlert(id, { note: resolveNote });
      message.success('处置单已闭环');
      setResolveOpen(false);
      setResolveNote('');
      fetchDetail();
    } catch (err: any) {
      message.error('闭环失败：' + (err?.message || '后端不可用'));
    } finally {
      setSubmitting(false);
    }
  };

  const addNote = () => {
    if (!noteInput.trim()) return;
    const note = {
      time: new Date().toLocaleString('zh-CN'),
      author: '当前用户',
      content: noteInput.trim(),
    };
    setNotes((prev) => [note, ...prev]);
    setNoteInput('');
    message.success('备注已添加（暂存本地）');
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spin size="large" />
      </div>
    );
  }

  if (!data) {
    return (
      <GlassCard className="p-8 text-center">
        <p className="text-gray-500">处置单不存在或加载失败</p>
        <Button className="mt-4" onClick={() => navigate('/disposal')}>
          返回列表
        </Button>
      </GlassCard>
    );
  }

  const stepIndex = STATUS_STEP_MAP[String(data.status)] ?? 0;
  const stationName = getStationName(data);

  return (
    <div className="space-y-6">
      {/* 顶栏 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/disposal')}>
          返回处置中心
        </Button>
        <div className="flex items-center gap-2">
          <Button
            icon={<ThunderboltOutlined />}
            onClick={() => navigate(`/alerts/analysis/${id}`)}
          >
            查看智能分析
          </Button>
          {data.status === 'pending' && (
            <Button type="primary" loading={submitting} onClick={handleConfirm} className="bg-cyan-600 hover:bg-cyan-700">
              确认派发
            </Button>
          )}
          {(data.status === 'confirmed' || data.status === 'pending') && (
            <Button type="primary" loading={submitting} onClick={handleStartProcess} className="bg-blue-600 hover:bg-blue-700">
              开始处理
            </Button>
          )}
          {data.status === 'processing' && (
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              onClick={() => setResolveOpen(true)}
              className="bg-green-600 hover:bg-green-700"
            >
              确认闭环
            </Button>
          )}
          <Button icon={<SyncOutlined />} onClick={fetchDetail}>
            刷新
          </Button>
        </div>
      </div>

      {/* 基本信息 */}
      <GlassCard className="p-6">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <Tag icon={<ToolOutlined />} color="cyan">处置单</Tag>
          <span className="font-mono text-sm text-gray-500">{data.code || data.id}</span>
          <Tag color={statusTagColor(data.status)}>{statusLabel(data.status)}</Tag>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">{data.title}</h2>
        <p className="text-gray-600 mb-4">{data.description}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-xl bg-gray-50">
          <InfoCell label="关联站点" value={stationName} icon={<EnvironmentOutlined />} />
          <InfoCell label="监测指标" value={data.indicator || '-'} />
          <InfoCell label="发生时间" value={formatTime(data.created_at || data.createdAt)} />
          <InfoCell label="严重程度" value={levelLabel(data.level)} />
        </div>
      </GlassCard>

      {/* 处置步骤 */}
      <GlassCard className="p-6">
        <h3 className="font-semibold text-gray-900 mb-4">处置进度</h3>
        <Steps
          current={stepIndex}
          items={[
            { title: '预警触发', description: formatTime(data.created_at || data.createdAt) },
            { title: '确认派发', description: data.confirmed_at ? formatTime(data.confirmed_at) : '待确认' },
            { title: '处置中', description: stepIndex >= 2 ? '跟进中' : '待开始' },
            { title: '闭环归档', description: data.resolved_at ? formatTime(data.resolved_at) : '待闭环' },
          ]}
        />
      </GlassCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 处置建议（来自 AI 分析） */}
        <GlassCard className="p-6">
          <h3 className="font-semibold text-gray-900 mb-4">推荐处置步骤</h3>
          {Array.isArray(data.recommendations) && data.recommendations.length > 0 ? (
            <div className="space-y-3">
              {data.recommendations.map((r: any, idx: number) => (
                <div key={idx} className="flex gap-3 p-3 rounded-lg border border-gray-100">
                  <div className="w-8 h-8 rounded-full bg-cyan-500 text-white flex items-center justify-center font-semibold text-sm flex-shrink-0">
                    {r.step ?? idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900">{r.title || r.name}</p>
                    <p className="text-sm text-gray-600 mt-1">{r.description || r.desc}</p>
                    {r.responsible && (
                      <p className="text-xs text-gray-400 mt-1">负责人：{r.responsible}</p>
                    )}
                  </div>
                  <Tag color={stepStatusColor(r.status)}>{stepStatusLabel(r.status)}</Tag>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">
              暂无处置建议。可前往
              <a
                className="text-cyan-600 mx-1"
                onClick={() => navigate(`/alerts/analysis/${data.id}`)}
              >
                智能分析工作台
              </a>
              生成 AI 推荐方案。
            </p>
          )}
        </GlassCard>

        {/* 协作备注 */}
        <GlassCard className="p-6">
          <h3 className="font-semibold text-gray-900 mb-4">协作备注</h3>
          <div className="flex gap-2 mb-4">
            <Input.TextArea
              rows={2}
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="添加处置备注或沟通记录"
            />
            <Button icon={<SendOutlined />} type="primary" onClick={addNote} className="bg-cyan-600 hover:bg-cyan-700">
              发送
            </Button>
          </div>
          {notes.length > 0 ? (
            <Timeline
              items={notes.map((n) => ({
                color: 'cyan',
                children: (
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">{n.author}</span>
                      <span className="text-xs text-gray-400">{n.time}</span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{n.content}</p>
                  </div>
                ),
              }))}
            />
          ) : (
            <p className="text-sm text-gray-400">暂无备注</p>
          )}
        </GlassCard>
      </div>

      {/* 事件时间线 */}
      {Array.isArray(data.timeline) && data.timeline.length > 0 && (
        <GlassCard className="p-6">
          <h3 className="font-semibold text-gray-900 mb-4">事件时间线</h3>
          <Timeline
            items={data.timeline.map((e: any) => ({
              color: e.status === 'warning' ? 'orange' : e.status === 'success' ? 'green' : 'blue',
              children: (
                <div>
                  <span className="text-sm text-gray-500 mr-2">{e.time}</span>
                  <span className="text-sm text-gray-900">{e.event}</span>
                </div>
              ),
            }))}
          />
        </GlassCard>
      )}

      {/* 闭环确认弹窗 */}
      <Modal
        title="确认处置闭环"
        open={resolveOpen}
        onCancel={() => setResolveOpen(false)}
        onOk={handleResolve}
        confirmLoading={submitting}
        okText="确认闭环"
        cancelText="取消"
      >
        <p className="text-sm text-gray-600 mb-3">请填写处置结论和效果说明：</p>
        <Input.TextArea
          rows={4}
          value={resolveNote}
          onChange={(e) => setResolveNote(e.target.value)}
          placeholder="如：上游排污口已关停，水质已恢复至 II 类，持续观察 2 小时无反弹。"
        />
      </Modal>
    </div>
  );
}

function InfoCell({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-sm font-medium text-gray-900 flex items-center gap-1">
        {icon}
        {value}
      </p>
    </div>
  );
}

function statusLabel(s?: string): string {
  const map: Record<string, string> = {
    pending: '待派发',
    confirmed: '已确认',
    processing: '处理中',
    resolved: '已闭环',
  };
  return map[String(s)] || s || '-';
}

function statusTagColor(s?: string): string {
  const map: Record<string, string> = {
    pending: 'red',
    confirmed: 'orange',
    processing: 'blue',
    resolved: 'green',
  };
  return map[String(s)] || 'default';
}

function levelLabel(l?: string): string {
  const map: Record<string, string> = { critical: '紧急', high: '高', medium: '中', low: '低' };
  return map[String(l)] || l || '-';
}

function stepStatusLabel(s?: string) {
  const map: Record<string, string> = { done: '已完成', doing: '进行中', pending: '待处理' };
  return map[String(s)] || s || '待处理';
}

function stepStatusColor(s?: string) {
  const map: Record<string, string> = { done: 'green', doing: 'blue', pending: 'default' };
  return map[String(s)] || 'default';
}

function getStationName(a: AlertDetailLike): string {
  if (a.station_name) return a.station_name;
  if (typeof a.station === 'string') return a.station;
  if (a.station && typeof a.station === 'object' && 'name' in a.station) return (a.station as any).name;
  return '-';
}

function formatTime(t?: string | null): string {
  if (!t) return '-';
  try {
    return new Date(t).toLocaleString('zh-CN');
  } catch {
    return t;
  }
}

// 仅用于消除未使用变量警告（Ant Icons 在 Steps 里按字符串渲染）
void ExclamationCircleOutlined;
void ClockCircleOutlined;

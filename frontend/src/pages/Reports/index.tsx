import { useEffect, useState } from 'react';
import {
  FileTextOutlined,
  DownloadOutlined,
  DeleteOutlined,
  PlusOutlined,
  CalendarOutlined,
  FilePdfOutlined,
  SearchOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  EyeOutlined,
  RobotOutlined,
  BarChartOutlined,
  AlertOutlined,
  EnvironmentOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Button, Input, Tag, Modal, DatePicker, Checkbox, message, Drawer, Descriptions, Divider, Select, Empty, Spin, Tabs, Table, Form, Popconfirm } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { GlassCard } from '../../components/GlassCard';
import { reportApi, stationApi } from '../../services/api';

const { RangePicker } = DatePicker;

interface Report {
  id: string;
  report_code: string;
  report_name: string;
  report_type: string;
  status: string;
  file_format: string;
  file_size?: number;
  file_path?: string;
  content?: any;
  station_id?: string;
  start_time?: string;
  end_time?: string;
  created_at: string;
  created_by?: string;
  error_message?: string;
}

interface Station {
  id: string;
  station_name: string;
}

const typeMap: Record<string, { text: string; color: string; icon: React.ReactNode }> = {
  daily: { text: '日报', color: 'blue', icon: <CalendarOutlined /> },
  weekly: { text: '周报', color: 'cyan', icon: <CalendarOutlined /> },
  monthly: { text: '月报', color: 'purple', icon: <CalendarOutlined /> },
  alert: { text: '预警报告', color: 'red', icon: <FileTextOutlined /> },
  custom: { text: '自定义', color: 'orange', icon: <FileTextOutlined /> },
};

const statusMap: Record<string, { text: string; color: string; icon: React.ReactNode }> = {
  pending: { text: '排队中', color: 'default', icon: <ClockCircleOutlined /> },
  generating: { text: '生成中', color: 'processing', icon: <ClockCircleOutlined /> },
  completed: { text: '已完成', color: 'success', icon: <CheckCircleOutlined /> },
  failed: { text: '失败', color: 'error', icon: <CloseCircleOutlined /> },
};

function formatSize(bytes?: number) {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function Reports() {
  const [mainTab, setMainTab] = useState<'list' | 'scheduled' | 'templates'>('list');
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);
  const [stations, setStations] = useState<Station[]>([]);
  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState<string | undefined>();
  const [filterStatus, setFilterStatus] = useState<string | undefined>();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [reportType, setReportType] = useState('monthly');
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [selectedStationId, setSelectedStationId] = useState<string | undefined>();
  const [fileFormat, setFileFormat] = useState('pdf');
  const [submitting, setSubmitting] = useState(false);

  const [previewReport, setPreviewReport] = useState<Report | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDetail, setPreviewDetail] = useState<Report | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [stats, setStats] = useState<any>({});

  const loadReports = async () => {
    setLoading(true);
    try {
      const params: any = { page: 1, size: 50 };
      if (filterType) params.report_type = filterType;
      if (filterStatus) params.status = filterStatus;
      const res: any = await reportApi.getReports(params);
      setReports(res?.items || []);
    } catch {
      setReports([]);
    } finally {
      setLoading(false);
    }
  };

  const loadStatistics = async () => {
    try {
      const res: any = await reportApi.getReportStatistics();
      setStats(res || {});
    } catch {
      setStats({});
    }
  };

  const loadStations = async () => {
    try {
      const res: any = await stationApi.getStations({ page: 1, size: 200 });
      setStations(res?.items || []);
    } catch {
      setStations([]);
    }
  };

  useEffect(() => {
    loadReports();
    loadStatistics();
    loadStations();
  }, []);

  useEffect(() => {
    loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType, filterStatus]);

  const filteredReports = reports.filter(r =>
    !searchText || r.report_name?.toLowerCase().includes(searchText.toLowerCase()) || r.report_code?.toLowerCase().includes(searchText.toLowerCase())
  );

  const resetForm = () => {
    setReportType('monthly');
    setDateRange(null);
    setSelectedStationId(undefined);
    setFileFormat('pdf');
  };

  const handleGenerate = async () => {
    if (!dateRange || !dateRange[0] || !dateRange[1]) {
      message.warning('请选择时间范围');
      return;
    }
    setSubmitting(true);
    try {
      const payload: any = {
        report_type: reportType,
        report_name: `${typeMap[reportType]?.text || '自定义'}-${dateRange[0].format('YYYYMMDD')}-${dateRange[1].format('YYYYMMDD')}`,
        start_time: dateRange[0].toISOString(),
        end_time: dateRange[1].toISOString(),
        file_format: fileFormat,
        created_by: 'admin',
      };
      if (selectedStationId) payload.station_id = selectedStationId;

      await reportApi.generateReport(payload);
      message.success('报告生成任务已提交');
      setIsModalOpen(false);
      resetForm();
      await loadReports();
      await loadStatistics();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '报告生成任务提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownload = async (report: Report) => {
    if (report.status !== 'completed') {
      message.warning('报告尚未生成完成');
      return;
    }
    try {
      const blob: any = await reportApi.downloadReport(report.id);
      const url = window.URL.createObjectURL(new Blob([blob]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${report.report_name}.${report.file_format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      message.success('开始下载');
    } catch {
      message.error('下载失败');
    }
  };

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这份报告吗？',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await reportApi.deleteReport(id);
          message.success('报告已删除');
          loadReports();
          loadStatistics();
        } catch {
          message.error('删除失败');
        }
      },
    });
  };

  const handlePreview = async (report: Report) => {
    setPreviewReport(report);
    setPreviewOpen(true);
    setPreviewDetail(null);
    setPreviewLoading(true);
    try {
      const detail: any = await reportApi.getReport(report.id);
      setPreviewDetail(detail);
    } catch {
      setPreviewDetail(report);
    } finally {
      setPreviewLoading(false);
    }
  };

  const renderPreviewContent = () => {
    const detail = previewDetail || previewReport;
    if (!detail) return null;
    const content = detail.content || {};
    const summary = content.summary || {};
    const findings = content.recommendations || content.key_findings || [];
    const alerts = content.alerts || [];

    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">{detail.report_name}</h3>
          <Descriptions size="small" column={2}>
            <Descriptions.Item label="报告编码">{detail.report_code}</Descriptions.Item>
            <Descriptions.Item label="报告类型">
              <Tag color={typeMap[detail.report_type]?.color}>{typeMap[detail.report_type]?.text || detail.report_type}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="生成时间">{detail.created_at?.slice(0, 19).replace('T', ' ')}</Descriptions.Item>
            <Descriptions.Item label="文件大小">{formatSize(detail.file_size)}</Descriptions.Item>
            <Descriptions.Item label="开始时间">{detail.start_time?.slice(0, 19).replace('T', ' ') || '-'}</Descriptions.Item>
            <Descriptions.Item label="结束时间">{detail.end_time?.slice(0, 19).replace('T', ' ') || '-'}</Descriptions.Item>
          </Descriptions>
        </div>

        <Divider />

        {summary.ai_summary || summary.text ? (
          <div className="p-4 bg-gradient-to-r from-cyan-50 to-blue-50 rounded-xl border border-cyan-100">
            <div className="flex items-start gap-3">
              <RobotOutlined className="text-xl text-cyan-500 mt-0.5" />
              <div>
                <h4 className="font-medium text-gray-900 mb-2">AI 智能摘要</h4>
                <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{summary.ai_summary || summary.text}</p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 bg-gray-50 rounded-xl text-center">
            <EnvironmentOutlined className="text-2xl text-cyan-500 mb-2" />
            <p className="text-2xl font-bold text-gray-900">{summary.station_count ?? summary.stations ?? '-'}</p>
            <p className="text-xs text-gray-500">监测站点</p>
          </div>
          <div className="p-4 bg-gray-50 rounded-xl text-center">
            <AlertOutlined className="text-2xl text-amber-500 mb-2" />
            <p className="text-2xl font-bold text-gray-900">{summary.alert_count ?? alerts.length ?? '-'}</p>
            <p className="text-xs text-gray-500">预警事件</p>
          </div>
          <div className="p-4 bg-gray-50 rounded-xl text-center">
            <BarChartOutlined className="text-2xl text-green-500 mb-2" />
            <p className="text-2xl font-bold text-gray-900">{summary.water_quality_grade || summary.avg_quality || '-'}</p>
            <p className="text-xs text-gray-500">水质等级</p>
          </div>
        </div>

        {findings.length > 0 && (
          <div>
            <h4 className="font-medium text-gray-900 mb-3">关键发现 / 建议</h4>
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
              {findings.map((f: any, i: number) => <li key={i}>{typeof f === 'string' ? f : f.text || f.content}</li>)}
            </ul>
          </div>
        )}

        {!content || Object.keys(content).length === 0 ? (
          <Empty description="报告详细内容尚在生成中" />
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Tabs
        activeKey={mainTab}
        onChange={(k) => setMainTab(k as any)}
        items={[
          { key: 'list', label: '报告列表' },
          { key: 'scheduled', label: '定时报告' },
          { key: 'templates', label: '模板管理' },
        ]}
      />
      {mainTab === 'scheduled' && <ScheduledReportsPanel />}
      {mainTab === 'templates' && <ReportTemplatesPanel />}
      {mainTab === 'list' && (
        <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: '报告总数', value: stats.total_reports ?? reports.length, color: 'text-blue-500', icon: <FileTextOutlined /> },
          { label: '近7天生成', value: stats.recent_7_days ?? '-', color: 'text-cyan-500', icon: <CalendarOutlined /> },
          { label: '已完成', value: stats.by_status?.completed ?? '-', color: 'text-green-500', icon: <CheckCircleOutlined /> },
          { label: '失败', value: stats.by_status?.failed ?? '-', color: 'text-red-500', icon: <CloseCircleOutlined /> },
        ].map((s, i) => (
          <GlassCard key={i} className="p-5">
            <div className="flex items-center gap-3">
              <div className={`text-2xl ${s.color}`}>{s.icon}</div>
              <div>
                <p className="text-sm text-gray-500">{s.label}</p>
                <p className="text-2xl font-semibold text-gray-900">{s.value}</p>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex gap-3 flex-1 flex-wrap">
          <Input
            placeholder="搜索报告名称/编码..."
            prefix={<SearchOutlined className="text-gray-400" />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-64"
            allowClear
          />
          <Select
            placeholder="报告类型"
            value={filterType}
            onChange={setFilterType}
            allowClear
            style={{ width: 140 }}
            options={Object.entries(typeMap).map(([k, v]) => ({ value: k, label: v.text }))}
          />
          <Select
            placeholder="状态"
            value={filterStatus}
            onChange={setFilterStatus}
            allowClear
            style={{ width: 140 }}
            options={Object.entries(statusMap).map(([k, v]) => ({ value: k, label: v.text }))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => { loadReports(); loadStatistics(); }} loading={loading}>刷新</Button>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalOpen(true)} className="bg-cyan-600 hover:bg-cyan-700">
          生成报告
        </Button>
      </div>

      {/* Report List */}
      <Spin spinning={loading}>
        {filteredReports.length === 0 ? (
          <GlassCard className="p-12"><Empty description="暂无报告" /></GlassCard>
        ) : (
          <div className="space-y-3">
            {filteredReports.map((report) => {
              const type = typeMap[report.report_type] || typeMap.custom;
              const status = statusMap[report.status] || statusMap.pending;
              return (
                <GlassCard key={report.id} className="p-5 transition-all duration-200 hover:shadow-lg flex items-center gap-4">
                  <div className="text-3xl text-red-500"><FilePdfOutlined /></div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-gray-900">{report.report_name}</h4>
                    <div className="flex items-center gap-3 text-sm text-gray-500 mt-1">
                      <Tag color={type.color} icon={type.icon} className="border-0">{type.text}</Tag>
                      <span>·</span>
                      <span>{report.report_code}</span>
                      <span>·</span>
                      <span>{report.created_at?.slice(0, 19).replace('T', ' ')}</span>
                      {report.status === 'completed' && (
                        <>
                          <span>·</span>
                          <span>{formatSize(report.file_size)}</span>
                        </>
                      )}
                    </div>
                    {report.error_message && <p className="text-xs text-red-500 mt-1">{report.error_message}</p>}
                  </div>
                  <div className="flex items-center gap-4">
                    <Tag icon={status.icon} color={status.color} className="border-0 px-3 py-1">{status.text}</Tag>
                    {report.status === 'completed' && (
                      <>
                        <Button type="text" icon={<EyeOutlined />} onClick={() => handlePreview(report)} className="text-gray-500 hover:text-gray-700">预览</Button>
                        <Button type="text" icon={<DownloadOutlined />} onClick={() => handleDownload(report)} className="text-cyan-600 hover:text-cyan-700">下载</Button>
                      </>
                    )}
                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleDelete(report.id)}>删除</Button>
                  </div>
                </GlassCard>
              );
            })}
          </div>
        )}
      </Spin>

      {/* Generate Modal */}
      <Modal
        title="生成报告"
        open={isModalOpen}
        onCancel={() => { setIsModalOpen(false); resetForm(); }}
        onOk={handleGenerate}
        confirmLoading={submitting}
        width={560}
        okText="开始生成"
        cancelText="取消"
      >
        <div className="space-y-5 mt-4">
          <div>
            <label className="block text-sm text-gray-600 mb-2">报告类型</label>
            <div className="flex gap-2 flex-wrap">
              {Object.entries(typeMap).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => setReportType(k)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    reportType === k ? 'bg-cyan-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {v.text}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-2">时间范围 *</label>
            <RangePicker
              value={dateRange as any}
              onChange={(v) => setDateRange(v as any)}
              className="w-full"
              showTime
              defaultValue={[dayjs().subtract(7, 'day'), dayjs()]}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-2">站点（可选，不选则生成全流域报告）</label>
            <Select
              placeholder="选择站点"
              value={selectedStationId}
              onChange={setSelectedStationId}
              allowClear
              showSearch
              filterOption={(input, option) => String(option?.label || '').toLowerCase().includes(input.toLowerCase())}
              style={{ width: '100%' }}
              options={stations.map(s => ({ value: s.id, label: s.station_name }))}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-2">文件格式</label>
            <div className="flex gap-2">
              {['pdf', 'excel'].map((f) => (
                <Checkbox key={f} checked={fileFormat === f} onChange={() => setFileFormat(f)}>
                  {f.toUpperCase()}
                </Checkbox>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* Preview Drawer */}
      <Drawer
        title={<div className="flex items-center gap-3"><FilePdfOutlined className="text-red-500" /><span>报告预览</span></div>}
        placement="right"
        width={720}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        extra={
          previewReport && (
            <Button type="primary" icon={<DownloadOutlined />} onClick={() => handleDownload(previewReport)} className="bg-cyan-600">
              下载报告
            </Button>
          )
        }
      >
        <Spin spinning={previewLoading}>
          {renderPreviewContent()}
        </Spin>
      </Drawer>
        </div>
      )}
    </div>
  );
}

// ==================== 定时报告面板 ====================
interface ScheduledReport {
  id: string;
  schedule_name: string;
  report_type: string;
  cron_expression: string;
  station_id?: string;
  file_format: string;
  recipients?: string[];
  is_active: boolean;
  last_run?: string;
  next_run?: string;
  created_at?: string;
}

function ScheduledReportsPanel() {
  const [items, setItems] = useState<ScheduledReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledReport | null>(null);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const res: any = await reportApi.getScheduledReports({ size: 100 });
      setItems(res?.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openForm = (row?: ScheduledReport) => {
    setEditing(row || null);
    if (row) {
      form.setFieldsValue({
        ...row,
        recipients: (row.recipients || []).join(','),
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ report_type: 'daily', cron_expression: '0 2 * * *', file_format: 'pdf', is_active: true });
    }
    setModalOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const payload: any = {
      ...values,
      recipients: typeof values.recipients === 'string'
        ? values.recipients.split(/[,;\n]/).map((s: string) => s.trim()).filter(Boolean)
        : values.recipients,
    };
    try {
      if (editing) {
        await reportApi.updateScheduledReport(editing.id, payload);
        message.success('已更新');
      } else {
        await reportApi.createScheduledReport(payload);
        message.success('已创建');
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '操作失败');
    }
  };

  const remove = async (row: ScheduledReport) => {
    try {
      await reportApi.deleteScheduledReport(row.id);
      message.success('已删除');
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '删除失败');
    }
  };

  const columns = [
    { title: '任务名', dataIndex: 'schedule_name', key: 'schedule_name' },
    { title: '报告类型', dataIndex: 'report_type', key: 'report_type', render: (v: string) => <Tag color={typeMap[v]?.color}>{typeMap[v]?.text || v}</Tag> },
    { title: 'Cron', dataIndex: 'cron_expression', key: 'cron_expression', render: (v: string) => <span className="font-mono text-xs">{v}</span> },
    { title: '格式', dataIndex: 'file_format', key: 'file_format', render: (v: string) => <Tag>{v?.toUpperCase()}</Tag> },
    { title: '状态', dataIndex: 'is_active', key: 'is_active', render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '停用'}</Tag> },
    { title: '上次执行', dataIndex: 'last_run', key: 'last_run', render: (t?: string) => <span className="text-gray-500 text-xs">{t ? new Date(t).toLocaleString() : '-'}</span> },
    { title: '下次执行', dataIndex: 'next_run', key: 'next_run', render: (t?: string) => <span className="text-gray-500 text-xs">{t ? new Date(t).toLocaleString() : '-'}</span> },
    {
      title: '操作', key: 'action', width: 160,
      render: (_: any, row: ScheduledReport) => (
        <div className="flex items-center gap-1">
          <Button type="link" size="small" onClick={() => openForm(row)}>编辑</Button>
          <Popconfirm title="确定删除？" okType="danger" onConfirm={() => remove(row)}>
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="text-sm text-gray-500">按 Cron 定时自动生成报告的任务配置</div>
        <div className="flex gap-2">
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm()} className="bg-cyan-600 hover:bg-cyan-700">新增定时任务</Button>
        </div>
      </div>
      <Table columns={columns} dataSource={items} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} />
      <Modal
        title={editing ? '编辑定时任务' : '新增定时任务'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        okText={editing ? '保存' : '创建'}
        destroyOnClose
      >
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item name="schedule_name" label="任务名" rules={[{ required: true }]}>
            <Input placeholder="例如：流域日报自动生成" />
          </Form.Item>
          <Form.Item name="report_type" label="报告类型" rules={[{ required: true }]}>
            <Select options={Object.entries(typeMap).map(([k, v]) => ({ value: k, label: v.text }))} />
          </Form.Item>
          <Form.Item
            name="cron_expression"
            label="Cron 表达式"
            rules={[{ required: true }]}
            extra="例如：0 2 * * *（每日 02:00）；0 0 * * 1（每周一）"
          >
            <Input placeholder="0 2 * * *" />
          </Form.Item>
          <Form.Item name="file_format" label="文件格式" rules={[{ required: true }]}>
            <Select options={[{ value: 'pdf', label: 'PDF' }, { value: 'excel', label: 'EXCEL' }]} />
          </Form.Item>
          <Form.Item name="recipients" label="接收人邮箱" extra="多个请用逗号 / 分号 / 换行分隔">
            <Input.TextArea rows={2} placeholder="a@example.com, b@example.com" />
          </Form.Item>
          <Form.Item name="is_active" label="启用" valuePropName="checked">
            <Checkbox>启用该定时任务</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// ==================== 报告模板面板 ====================
interface ReportTemplate {
  id: string;
  template_code: string;
  template_name: string;
  report_type: string;
  description?: string;
  is_active: boolean;
  created_at?: string;
}

function ReportTemplatesPanel() {
  const [items, setItems] = useState<ReportTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ReportTemplate | null>(null);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const res: any = await reportApi.getTemplates({ size: 100 });
      setItems(res?.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openForm = (row?: ReportTemplate) => {
    setEditing(row || null);
    if (row) {
      form.setFieldsValue(row);
    } else {
      form.resetFields();
      form.setFieldsValue({ is_active: true, report_type: 'daily' });
    }
    setModalOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    try {
      if (editing) {
        await reportApi.updateTemplate(editing.id, values);
        message.success('已更新');
      } else {
        await reportApi.createTemplate(values);
        message.success('已创建');
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '操作失败');
    }
  };

  const remove = async (row: ReportTemplate) => {
    try {
      await reportApi.deleteTemplate(row.id);
      message.success('已删除');
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '删除失败');
    }
  };

  const columns = [
    { title: '模板编码', dataIndex: 'template_code', key: 'template_code', render: (v: string) => <Tag color="cyan">{v}</Tag> },
    { title: '模板名称', dataIndex: 'template_name', key: 'template_name' },
    { title: '类型', dataIndex: 'report_type', key: 'report_type', render: (v: string) => <Tag color={typeMap[v]?.color}>{typeMap[v]?.text || v}</Tag> },
    { title: '说明', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: '状态', dataIndex: 'is_active', key: 'is_active', render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '停用'}</Tag> },
    {
      title: '操作', key: 'action', width: 160,
      render: (_: any, row: ReportTemplate) => (
        <div className="flex items-center gap-1">
          <Button type="link" size="small" onClick={() => openForm(row)}>编辑</Button>
          <Popconfirm title="确定删除？" okType="danger" onConfirm={() => remove(row)}>
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="text-sm text-gray-500">报告模板管理（支持 Jinja2 模板绑定）</div>
        <div className="flex gap-2">
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm()} className="bg-cyan-600 hover:bg-cyan-700">新增模板</Button>
        </div>
      </div>
      <Table columns={columns} dataSource={items} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} />
      <Modal
        title={editing ? '编辑模板' : '新增模板'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        okText={editing ? '保存' : '创建'}
        destroyOnClose
      >
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item name="template_code" label="模板编码" rules={[{ required: true }]}>
            <Input placeholder="例如：daily_v1" disabled={!!editing} />
          </Form.Item>
          <Form.Item name="template_name" label="模板名称" rules={[{ required: true }]}>
            <Input placeholder="模板名称" />
          </Form.Item>
          <Form.Item name="report_type" label="报告类型" rules={[{ required: true }]}>
            <Select options={Object.entries(typeMap).map(([k, v]) => ({ value: k, label: v.text }))} />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} placeholder="模板说明" />
          </Form.Item>
          <Form.Item name="is_active" label="启用" valuePropName="checked">
            <Checkbox>启用该模板</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

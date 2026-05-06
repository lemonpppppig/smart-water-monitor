/**
 * 批量导入 CSV Modal
 * - 4 类拓扑绑定：river_flow / station_river / station_flow / pollution_river
 * - 流程：选类型 → 下载模板(可选) → 粘贴/上传 CSV → 预览 → 试运行 → 确认导入
 */
import { useMemo, useRef, useState } from 'react';
import {
  Modal, Radio, Button, Upload, message, Table, Tag, Space, Input, Divider, Alert, Tooltip, Progress, InputNumber,
} from 'antd';
import { DownloadOutlined, UploadOutlined, ExperimentOutlined, SaveOutlined, InboxOutlined, StopOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import api, { graphAdminApi } from '../../services/api';

export type ImportKind = 'river_flow' | 'station_river' | 'station_flow' | 'pollution_river' | 'river_confluence_in' | 'river_confluence_out';

const KIND_META: Record<ImportKind, { label: string; headers: string[]; required: string[]; desc: string }> = {
  river_flow:           { label: '河流流向',         headers: ['upstream_id', 'downstream_id', 'distance_km', 'confluence_id'], required: ['upstream_id', 'downstream_id'], desc: 'River -[:FLOWS_INTO]-> River' },
  station_river:        { label: '站点挂河流',     headers: ['station_id', 'river_id'],                                      required: ['station_id', 'river_id'],        desc: 'Station -[:ON_RIVER]-> River' },
  station_flow:   { label: '站点上下游',   headers: ['upstream_id', 'downstream_id', 'distance_km', 'travel_hours'], required: ['upstream_id', 'downstream_id'], desc: 'Station -[:UPSTREAM_OF]-> Station' },
  pollution_river:{ label: '污染源挂河流', headers: ['source_id', 'river_id'],                                       required: ['source_id', 'river_id'],         desc: 'PollutionSource -[:DISCHARGES_TO]-> River' },
  river_confluence_in:  { label: '河流汇入交汇点', headers: ['river_id', 'confluence_id', 'distance_km'],                  required: ['river_id', 'confluence_id'],     desc: 'River -[:FLOWS_INTO_CONFLUENCE]-> Confluence' },
  river_confluence_out: { label: '交汇点下泄河流', headers: ['confluence_id', 'river_id', 'distance_km'],                  required: ['confluence_id', 'river_id'],     desc: 'Confluence -[:CONFLUENCE_FLOWS_TO]-> River' },
};

/** 简易 CSV 解析：第一行表头，逗号分隔，不支持复杂引号转义。 */
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((s) => s.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((s) => s.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function BulkImportModal({ open, onClose, onSuccess }: Props) {
  const [kind, setKind] = useState<ImportKind>('river_flow');
  const [rawText, setRawText] = useState('');
  const [loading, setLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [batchSize, setBatchSize] = useState(100);
  const [progress, setProgress] = useState<{ done: number; total: number; success: number; failed: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const meta = KIND_META[kind];
  const parsed = useMemo(() => parseCSV(rawText), [rawText]);

  // 前端快速校验
  const rowErrors = useMemo(() => {
    const errs: Record<number, string> = {};
    parsed.forEach((row, i) => {
      const missing = meta.required.filter((k) => !row[k]);
      if (missing.length) errs[i] = `缺少: ${missing.join(', ')}`;
    });
    return errs;
  }, [parsed, meta]);

  const downloadTemplate = () => {
    api.get('/api/v1/ai/graph-admin/import/template', { params: { kind }, responseType: 'blob' })
      .then((res) => {
        const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = `template_${kind}.csv`;
        document.body.appendChild(link); link.click();
        document.body.removeChild(link); URL.revokeObjectURL(url);
      })
      .catch(() => message.error('模板下载失败'));
  };

  const uploadProps: UploadProps = {
    accept: '.csv,text/csv',
    showUploadList: false,
    beforeUpload: (file) => {
      const reader = new FileReader();
      reader.onload = (e) => setRawText(String(e.target?.result || ''));
      reader.readAsText(file, 'utf-8');
      return false; // 阻止默认上传
    },
  };

  const runImport = async (dryRun: boolean) => {
    if (!parsed.length) { message.warning('CSV 为空'); return; }
    setLoading(true);
    setDryRunResult(null);

    // 试运行：不分批，一次性提交快速获取整体校验结果
    if (dryRun) {
      try {
        const res = await graphAdminApi.bulkImportTopology(kind, parsed, true);
        setDryRunResult(res.data);
        message.info(`试运行：共 ${res.data.total} 行，校验通过 ${res.data.success} 行，失败 ${res.data.failed} 行`);
      } catch (err: any) {
        message.error(err?.response?.data?.detail || '试运行失败');
      } finally {
        setLoading(false);
      }
      return;
    }

    // 正式导入：分批提交 + 进度条 + 支持取消
    const total = parsed.length;
    const bs = Math.max(1, Math.min(batchSize, 500));
    let cursor = 0;
    let success = 0;
    let failed = 0;
    const allErrors: any[] = [];
    abortRef.current = new AbortController();
    setProgress({ done: 0, total, success: 0, failed: 0 });

    try {
      while (cursor < total) {
        if (abortRef.current?.signal.aborted) throw new Error('__ABORTED__');
        const chunk = parsed.slice(cursor, cursor + bs);
        const res = await graphAdminApi.bulkImportTopology(kind, chunk, false, abortRef.current.signal);
        const data = res.data;
        success += data.success || 0;
        failed += data.failed || 0;
        if (data.errors?.length) {
          // 将批内行号偏移还原为全局行号
          allErrors.push(...data.errors.map((e: any) => ({ ...e, row: (e.row ?? 0) + cursor })));
        }
        cursor += chunk.length;
        setProgress({ done: cursor, total, success, failed });
      }
      setDryRunResult({ total, success, failed, errors: allErrors, dry_run: false });
      if (failed === 0) {
        message.success(`导入完成：${success} 行`);
        onSuccess();
        handleClose();
      } else {
        message.warning(`部分失败：成功 ${success} 行，失败 ${failed} 行（见下方错误列表）`);
      }
    } catch (err: any) {
      if (err?.message === '__ABORTED__' || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') {
        message.warning(`已取消：已提交 ${cursor}/${total} 行，成功 ${success}，失败 ${failed}`);
        setDryRunResult({ total: cursor, success, failed, errors: allErrors, dry_run: false, cancelled: true });
      } else {
        message.error(err?.response?.data?.detail || '导入失败');
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const cancelImport = () => {
    abortRef.current?.abort();
  };

  const handleClose = () => {
    if (loading) { message.warning('导入进行中，请先取消或等待完成'); return; }
    setRawText('');
    setDryRunResult(null);
    setProgress(null);
    onClose();
  };

  // 预览表列
  const previewCols = [
    { title: '#', dataIndex: '_idx', width: 50, render: (_: any, __: any, i: number) => i + 1 },
    ...meta.headers.map((h) => ({ title: h, dataIndex: h, key: h })),
    {
      title: '校验',
      key: '_status',
      width: 180,
      render: (_: any, __: any, i: number) => rowErrors[i]
        ? <Tag color="red">{rowErrors[i]}</Tag>
        : <Tag color="green">OK</Tag>,
    },
  ];

  return (
    <Modal
      title={<Space>批量导入拓扑关系 <Tag color="blue">{meta.label}</Tag></Space>}
      open={open}
      onCancel={handleClose}
      width={900}
      footer={[
        <Button key="cancel" onClick={handleClose} disabled={loading}>关闭</Button>,
        loading && progress ? (
          <Button key="abort" danger icon={<StopOutlined />} onClick={cancelImport}>取消导入</Button>
        ) : null,
        <Button key="dry" icon={<ExperimentOutlined />} onClick={() => runImport(true)} loading={loading && !progress} disabled={!parsed.length || loading}>
          试运行
        </Button>,
        <Button key="submit" type="primary" icon={<SaveOutlined />} onClick={() => runImport(false)} loading={loading && !!progress} disabled={!parsed.length || loading}>
          确认导入 {parsed.length > 0 && `(${parsed.length} 行)`}
        </Button>,
      ]}
      destroyOnHidden
    >
      <div className="space-y-3">
        <Radio.Group value={kind} onChange={(e) => { setKind(e.target.value); setRawText(''); setDryRunResult(null); }}>
          {(Object.keys(KIND_META) as ImportKind[]).map((k) => (
            <Radio.Button key={k} value={k}>{KIND_META[k].label}</Radio.Button>
          ))}
        </Radio.Group>

        <Alert
          type="info"
          showIcon
          message={<span>关系：<code>{meta.desc}</code></span>}
          description={
            <div style={{ fontSize: 12 }}>
              列名必须与表头一致，逗号分隔；必填：
              {meta.required.map((r) => <Tag key={r} color="red" style={{ marginLeft: 4 }}>{r}</Tag>)}
              其他列可选，留空即可。
            </div>
          }
        />

        <Space wrap>
          <Tooltip title="下载含表头+示例行的 CSV 模板">
            <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>下载模板</Button>
          </Tooltip>
          <Upload {...uploadProps}>
            <Button icon={<UploadOutlined />}>上传 CSV 文件</Button>
          </Upload>
          <Tooltip title="大文件会按此大小分批提交，推荐 50~200">
            <Space size={4}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>批大小</span>
              <InputNumber min={1} max={500} value={batchSize} onChange={(v) => setBatchSize(Number(v) || 100)} size="small" style={{ width: 80 }} disabled={loading} />
            </Space>
          </Tooltip>
          <span style={{ color: '#6b7280', fontSize: 12 }}>或直接粘贴到下方</span>
        </Space>

        <Input.TextArea
          value={rawText}
          onChange={(e) => { setRawText(e.target.value); setDryRunResult(null); }}
          rows={6}
          placeholder={`${meta.headers.join(',')}\n${meta.headers.map((_, i) => i === 0 ? 'VAL_A' : i === 1 ? 'VAL_B' : '').join(',')}`}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />

        {parsed.length > 0 && (
          <>
            <Divider style={{ margin: '8px 0' }}>预览（{parsed.length} 行，前 20 行）</Divider>
            <Table
              size="small"
              columns={previewCols as any}
              dataSource={parsed.slice(0, 20).map((r, i) => ({ ...r, key: i }))}
              pagination={false}
              scroll={{ y: 200 }}
            />
            {Object.keys(rowErrors).length > 0 && (
              <Alert type="warning" showIcon message={`${Object.keys(rowErrors).length} 行本地校验未通过，会被后端拒绝`} />
            )}
          </>
        )}

        {progress && (
          <div style={{ padding: '8px 12px', background: '#f0f9ff', borderRadius: 6, border: '1px solid #bae6fd' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
              <span>导入进度：{progress.done} / {progress.total}</span>
              <Space size={8}>
                <Tag color="green">成功 {progress.success}</Tag>
                <Tag color="red">失败 {progress.failed}</Tag>
              </Space>
            </div>
            <Progress
              percent={progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}
              status={loading ? 'active' : (progress.failed > 0 ? 'exception' : 'success')}
              size="small"
            />
          </div>
        )}

        {dryRunResult && (
          <>
            <Divider style={{ margin: '8px 0' }}>
              {dryRunResult.dry_run ? '试运行结果' : '导入结果'}
            </Divider>
            <Space>
              <Tag color="blue">总数 {dryRunResult.total}</Tag>
              <Tag color="green">成功 {dryRunResult.success}</Tag>
              <Tag color="red">失败 {dryRunResult.failed}</Tag>
            </Space>
            {dryRunResult.errors?.length > 0 && (
              <div style={{ marginTop: 8, maxHeight: 140, overflow: 'auto', background: '#fef2f2', padding: 8, borderRadius: 6, fontSize: 12, fontFamily: 'monospace' }}>
                {dryRunResult.errors.map((e: any, i: number) => (
                  <div key={i}>行 {e.row}: {e.reason}</div>
                ))}
              </div>
            )}
          </>
        )}

        {!parsed.length && (
          <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af', border: '2px dashed #e5e7eb', borderRadius: 8 }}>
            <InboxOutlined style={{ fontSize: 32 }} />
            <div>上传 CSV 或粘贴内容以预览</div>
          </div>
        )}
      </div>
    </Modal>
  );
}

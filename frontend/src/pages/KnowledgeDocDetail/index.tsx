import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeftOutlined, TagsOutlined, CalendarOutlined, BankOutlined } from '@ant-design/icons';
import { Button, Tag, Spin, Descriptions, Empty } from 'antd';
import { GlassCard } from '../../components/GlassCard';
import { aiApi } from '../../services/api';

const CATEGORY_LABELS: Record<string, string> = {
  regulation: '法规标准',
  standard: '技术规范',
  manual: '操作手册',
  policy: '规划政策',
  case_study: '案例研究',
};

interface DocDetail {
  id: string;
  doc_code: string;
  title: string;
  category: string;
  sub_category?: string;
  summary?: string;
  content: string;
  source?: string;
  publish_date?: string;
  effective_date?: string;
  tags: string[];
}

export default function KnowledgeDocDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    aiApi.getKnowledgeDoc(id)
      .then((res: any) => setDoc(res))
      .catch(() => setDoc(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Spin size="large" />
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="space-y-4">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/knowledge')}>返回知识中心</Button>
        <Empty description="文档不存在或已删除" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* 顶部导航 */}
      <div className="flex items-center gap-4">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/knowledge')}>返回</Button>
        <Tag color="blue">{CATEGORY_LABELS[doc.category] || doc.category}</Tag>
        {doc.sub_category && <Tag>{doc.sub_category}</Tag>}
      </div>

      {/* 文档元信息 */}
      <GlassCard className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{doc.title}</h1>
        {doc.summary && (
          <p className="text-gray-600 mb-4 text-sm leading-relaxed bg-gray-50 p-3 rounded-lg">{doc.summary}</p>
        )}
        <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }}>
          {doc.source && (
            <Descriptions.Item label={<span><BankOutlined className="mr-1" />来源</span>}>{doc.source}</Descriptions.Item>
          )}
          {doc.publish_date && (
            <Descriptions.Item label={<span><CalendarOutlined className="mr-1" />发布日期</span>}>{doc.publish_date}</Descriptions.Item>
          )}
          {doc.effective_date && (
            <Descriptions.Item label="生效日期">{doc.effective_date}</Descriptions.Item>
          )}
        </Descriptions>
        {doc.tags && doc.tags.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <TagsOutlined className="text-gray-400" />
            {doc.tags.map((t, i) => <Tag key={i} color="cyan">{t}</Tag>)}
          </div>
        )}
      </GlassCard>

      {/* 文档正文 */}
      <GlassCard className="p-6">
        <h3 className="text-lg font-semibold mb-4 pb-2 border-b border-gray-200">正文内容</h3>
        <div className="prose prose-sm max-w-none prose-headings:text-gray-900 prose-p:text-gray-700 prose-table:text-sm">
          <MarkdownRenderer content={doc.content} />
        </div>
      </GlassCard>
    </div>
  );
}

/**
 * 简易 Markdown 渲染器（无需额外依赖）
 * 支持标题、列表、表格、粗体、段落
 */
function MarkdownRenderer({ content }: { content: string }) {
  const html = markdownToHtml(content);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

function markdownToHtml(md: string): string {
  let html = md
    // 转义 HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 表格处理（先处理，避免被其他规则干扰）
  html = html.replace(/^(\|.+\|)\n(\|[-:| ]+\|)\n((?:\|.+\|\n?)*)/gm, (_match, header, _sep, body) => {
    const headerCells = header.split('|').filter((c: string) => c.trim());
    const rows = body.trim().split('\n').filter((r: string) => r.trim());
    let table = '<table class="border-collapse border border-gray-300 w-full my-3 text-sm"><thead><tr>';
    headerCells.forEach((c: string) => { table += `<th class="border border-gray-300 px-3 py-2 bg-gray-50 font-semibold text-left">${c.trim()}</th>`; });
    table += '</tr></thead><tbody>';
    rows.forEach((row: string) => {
      const cells = row.split('|').filter((c: string) => c.trim());
      table += '<tr>';
      cells.forEach((c: string) => { table += `<td class="border border-gray-300 px-3 py-2">${c.trim()}</td>`; });
      table += '</tr>';
    });
    table += '</tbody></table>';
    return table;
  });

  // 标题
  html = html.replace(/^#### (.+)$/gm, '<h4 class="text-base font-semibold mt-4 mb-2">$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-5 mb-2">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mt-6 mb-3 pb-1 border-b border-gray-200">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-6 mb-4">$1</h1>');

  // 粗体
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // 无序列表
  html = html.replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>');

  // 有序列表
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>');

  // 段落（非空行且非 HTML 标签开头）
  html = html.replace(/^(?!<[hluotd]|<li|<strong|<table)(.+)$/gm, '<p class="my-1 leading-relaxed">$1</p>');

  // 空行 → 间距
  html = html.replace(/\n{2,}/g, '<div class="h-2"></div>');
  html = html.replace(/\n/g, '');

  return html;
}

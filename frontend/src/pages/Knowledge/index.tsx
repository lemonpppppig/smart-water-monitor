import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOutlined,
  SearchOutlined,
  ReloadOutlined,
  FileTextOutlined,
  SafetyOutlined,
  ExperimentOutlined,
  EyeOutlined,
  DownloadOutlined,
  RobotOutlined,
  ReadOutlined,
} from '@ant-design/icons';
import { Button, Input, Tabs, Tag, Table, Modal, Descriptions, message, Empty, Spin, Select } from 'antd';
import { GlassCard } from '../../components/GlassCard';
import { aiApi, alertApi } from '../../services/api';

const { TabPane } = Tabs;

// 污染类型定义 - 与后端 /api/v1/ai/knowledge/emergency-plan/{type} 对齐
const POLLUTION_TYPES = [
  { code: 'organic', name: '有机污染', category: '化学污染', description: 'COD、BOD超标导致的有机污染，表现为溶解氧降低、水体黑臭。' },
  { code: 'eutrophication', name: '富营养化', category: '生物污染', description: '氮磷超标引起的水体富营养化，易引发藻类爆发。' },
  { code: 'heavy_metal', name: '重金属污染', category: '化学污染', description: '铅、汞、镉、铬等重金属超标，长期危害生态与人体健康。' },
  { code: 'oil', name: '石油类污染', category: '物理污染', description: '石油类物质泄漏或排放，形成漂浮油膜，阻碍氧交换。' },
  { code: 'pathogen', name: '病原微生物', category: '生物污染', description: '细菌、病毒等病原微生物超标，影响饮用水安全。' },
  { code: 'chemical', name: '化学物质污染', category: '化学污染', description: '酚类、氰化物、农药等合成化学物质污染。' },
];

// 法规标准 - 静态引用
const REGULATIONS = [
  { id: 'GB3838-2002', name: '地表水环境质量标准 GB3838-2002', category: '国家标准', status: '现行' },
  { id: 'GB8978-1996', name: '污水综合排放标准 GB8978-1996', category: '国家标准', status: '现行' },
  { id: 'law-01', name: '中华人民共和国水污染防治法', category: '法律法规', status: '现行' },
  { id: 'tech-01', name: '饮用水水源保护区划分技术规范 HJ/T 338', category: '技术规范', status: '现行' },
  { id: 'HJ91', name: '地表水和污水监测技术规范 HJ/T 91', category: '技术规范', status: '现行' },
];

interface EmergencyPlan {
  type: string;
  name: string;
  category: string;
  level: string;
  plan: any;
  updateTime: string;
}

interface HistoricalCase {
  id: string;
  title: string;
  type: string;
  date: string;
  status: string;
  level?: string;
}

interface KnowledgeDoc {
  id: string;
  doc_code: string;
  title: string;
  category: string;
  sub_category?: string;
  summary?: string;
  source?: string;
  publish_date?: string;
  effective_date?: string;
  tags: string[];
}

const CATEGORY_LABELS: Record<string, string> = {
  regulation: '法规标准',
  standard: '技术规范',
  manual: '操作手册',
  policy: '规划政策',
  case_study: '案例研究',
};

export default function Knowledge() {
  const [activeTab, setActiveTab] = useState('pollution');
  const [search, setSearch] = useState('');
  const [plans, setPlans] = useState<EmergencyPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [cases, setCases] = useState<HistoricalCase[]>([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailData, setDetailData] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsTotal, setDocsTotal] = useState(0);
  const [docCategory, setDocCategory] = useState<string | undefined>(undefined);
  const [docPage, setDocPage] = useState(1);
  const navigate = useNavigate();

  const loadPlans = async () => {
    setPlansLoading(true);
    try {
      const results = await Promise.all(
        POLLUTION_TYPES.map(async (t) => {
          try {
            const plan: any = await aiApi.getEmergencyPlan(t.code);
            return {
              type: t.code,
              name: `${t.name}应急处置预案`,
              category: t.name,
              level: plan?.severity || plan?.level || '一般',
              plan,
              updateTime: plan?.updated_at || plan?.last_updated || new Date().toISOString().slice(0, 10),
            } as EmergencyPlan;
          } catch {
            return null;
          }
        })
      );
      setPlans(results.filter(Boolean) as EmergencyPlan[]);
    } finally {
      setPlansLoading(false);
    }
  };

  const loadCases = async () => {
    setCasesLoading(true);
    try {
      const res: any = await alertApi.getAlerts({ page: 1, size: 20, status: 'resolved' });
      const items: any[] = res?.items || [];
      setCases(items.map(a => ({
        id: a.id,
        title: a.title || a.alert_code || '未命名案例',
        type: a.pollution_type || '未分类',
        date: (a.resolved_at || a.created_at || '').slice(0, 10),
        status: a.status === 'resolved' ? '已解决' : '处理中',
        level: a.alert_level,
      })));
    } catch {
      setCases([]);
    } finally {
      setCasesLoading(false);
    }
  };

  const loadDocs = async (page = 1, category?: string) => {
    setDocsLoading(true);
    try {
      const res: any = await aiApi.getKnowledgeDocs({ page, size: 10, category, keyword: search || undefined });
      setDocs(res?.items || []);
      setDocsTotal(res?.total || 0);
    } catch {
      setDocs([]);
    } finally {
      setDocsLoading(false);
    }
  };

  useEffect(() => {
    loadPlans();
    loadCases();
    loadDocs();
  }, []);

  const openPollutionDetail = async (type: string, name: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailData({ __meta: { title: `${name} · 应急处置预案`, type } });
    try {
      const plan: any = await aiApi.getEmergencyPlan(type);
      setDetailData({ __meta: { title: `${name} · 应急处置预案`, type }, ...plan });
    } catch {
      message.error('预案加载失败，请检查 AI 服务是否在线');
      setDetailData({ __meta: { title: `${name} · 应急处置预案`, type }, error: true });
    } finally {
      setDetailLoading(false);
    }
  };

  const filteredPollution = POLLUTION_TYPES.filter(p =>
    !search || p.name.includes(search) || p.description.includes(search) || p.category.includes(search)
  );
  const filteredPlans = plans.filter(p => !search || p.name.includes(search) || p.category.includes(search));
  const filteredCases = cases.filter(c => !search || c.title.includes(search) || c.type.includes(search));
  const filteredRegs = REGULATIONS.filter(r => !search || r.name.includes(search));

  const pollutionColumns = [
    { title: '污染类型', dataIndex: 'name', key: 'name' },
    { title: '分类', dataIndex: 'category', key: 'category', render: (t: string) => <Tag color="blue">{t}</Tag> },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_: any, record: typeof POLLUTION_TYPES[0]) => (
        <div className="flex gap-2">
          <Button type="text" icon={<EyeOutlined />} size="small" onClick={() => openPollutionDetail(record.code, record.name)}>查看预案</Button>
        </div>
      ),
    },
  ];

  const planColumns = [
    { title: '预案名称', dataIndex: 'name', key: 'name' },
    { title: '适用类型', dataIndex: 'category', key: 'category' },
    { title: '级别', dataIndex: 'level', key: 'level', render: (t: string) => <Tag color={t === '严重' || t === 'critical' ? 'red' : 'orange'}>{t}</Tag> },
    { title: '更新时间', dataIndex: 'updateTime', key: 'updateTime' },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_: any, record: EmergencyPlan) => (
        <div className="flex gap-2">
          <Button type="text" icon={<EyeOutlined />} size="small" onClick={() => openPollutionDetail(record.type, record.name)}>查看</Button>
        </div>
      ),
    },
  ];

  const caseColumns = [
    { title: '案例标题', dataIndex: 'title', key: 'title' },
    { title: '污染类型', dataIndex: 'type', key: 'type' },
    { title: '发生时间', dataIndex: 'date', key: 'date' },
    {
      title: '级别',
      dataIndex: 'level',
      key: 'level',
      render: (t?: string) => <Tag color={t === 'critical' || t === 'high' ? 'red' : t === 'medium' ? 'orange' : 'blue'}>{t || '低'}</Tag>,
    },
    { title: '状态', dataIndex: 'status', key: 'status', render: (t: string) => <Tag color={t === '已解决' ? 'green' : 'orange'}>{t}</Tag> },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: any, record: HistoricalCase) => (
        <div className="flex gap-2">
          <Button type="text" icon={<EyeOutlined />} size="small" onClick={() => navigate(`/alerts/${record.id}`)}>详情</Button>
        </div>
      ),
    },
  ];

  const regulationColumns = [
    { title: '法规名称', dataIndex: 'name', key: 'name' },
    { title: '分类', dataIndex: 'category', key: 'category' },
    { title: '状态', dataIndex: 'status', key: 'status', render: () => <Tag color="green">现行</Tag> },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: () => (
        <div className="flex gap-2">
          <Button type="text" icon={<DownloadOutlined />} size="small" disabled>下载</Button>
        </div>
      ),
    },
  ];

  const renderPlanDetail = () => {
    if (detailLoading) {
      return <div className="py-8 text-center"><Spin /></div>;
    }
    if (!detailData || detailData.error) {
      return <Empty description="暂无预案数据" />;
    }
    const plan = detailData;
    return (
      <div className="space-y-4">
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="污染类型">{plan.pollution_type || detailData.__meta?.type || '-'}</Descriptions.Item>
          <Descriptions.Item label="严重级别">{plan.severity || plan.level || '一般'}</Descriptions.Item>
          <Descriptions.Item label="响应时限" span={2}>{plan.response_time || plan.sla || '24小时'}</Descriptions.Item>
        </Descriptions>

        {Array.isArray(plan.immediate_actions) && plan.immediate_actions.length > 0 && (
          <div>
            <h4 className="font-semibold mb-2">立即处置措施</h4>
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
              {plan.immediate_actions.map((a: any, i: number) => <li key={i}>{typeof a === 'string' ? a : a.action || a.description}</li>)}
            </ul>
          </div>
        )}
        {Array.isArray(plan.steps) && plan.steps.length > 0 && (
          <div>
            <h4 className="font-semibold mb-2">处置步骤</h4>
            <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
              {plan.steps.map((s: any, i: number) => <li key={i}>{typeof s === 'string' ? s : s.action || s.description}</li>)}
            </ol>
          </div>
        )}
        {Array.isArray(plan.long_term_actions) && plan.long_term_actions.length > 0 && (
          <div>
            <h4 className="font-semibold mb-2">长期应对措施</h4>
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
              {plan.long_term_actions.map((a: any, i: number) => <li key={i}>{typeof a === 'string' ? a : a.action || a.description}</li>)}
            </ul>
          </div>
        )}
        {Array.isArray(plan.responsible_parties) && plan.responsible_parties.length > 0 && (
          <div>
            <h4 className="font-semibold mb-2">责任主体</h4>
            <div className="flex gap-2 flex-wrap">
              {plan.responsible_parties.map((p: string, i: number) => <Tag key={i} color="cyan">{p}</Tag>)}
            </div>
          </div>
        )}
        {plan.recommendations && (
          <div>
            <h4 className="font-semibold mb-2">AI 建议</h4>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{plan.recommendations}</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Input
          placeholder="搜索知识库..."
          prefix={<SearchOutlined className="text-gray-400" />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-80"
          allowClear
        />
        <Button
          icon={<ReloadOutlined />}
          onClick={() => { loadPlans(); loadCases(); }}
          loading={plansLoading || casesLoading}
        >
          刷新
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {[
          { icon: ExperimentOutlined, label: '污染类型', value: POLLUTION_TYPES.length, color: 'text-blue-500' },
          { icon: SafetyOutlined, label: '应急预案', value: plans.length, color: 'text-green-500' },
          { icon: FileTextOutlined, label: '历史案例', value: cases.length, color: 'text-amber-500' },
          { icon: BookOutlined, label: '法规标准', value: REGULATIONS.length, color: 'text-purple-500' },
          { icon: ReadOutlined, label: '文档库', value: docsTotal, color: 'text-cyan-500' },
        ].map((stat, idx) => (
          <GlassCard key={idx} className="p-5">
            <div className="flex items-center gap-3">
              <stat.icon className={`text-2xl ${stat.color}`} />
              <div>
                <p className="text-sm text-gray-500">{stat.label}</p>
                <p className="text-2xl font-semibold text-gray-900">{stat.value}</p>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      <GlassCard className="p-6">
        <Tabs activeKey={activeTab} onChange={setActiveTab}>
          <TabPane tab={<span><ExperimentOutlined /> 污染类型</span>} key="pollution">
            <Table columns={pollutionColumns} dataSource={filteredPollution} rowKey="code" pagination={{ pageSize: 8 }} />
          </TabPane>
          <TabPane tab={<span><SafetyOutlined /> 应急预案</span>} key="plans">
            <Table
              columns={planColumns}
              dataSource={filteredPlans}
              rowKey="type"
              pagination={{ pageSize: 8 }}
              loading={plansLoading}
              locale={{ emptyText: <Empty description="AI 服务暂未返回预案数据" /> }}
            />
          </TabPane>
          <TabPane tab={<span><FileTextOutlined /> 历史案例</span>} key="cases">
            <Table
              columns={caseColumns}
              dataSource={filteredCases}
              rowKey="id"
              pagination={{ pageSize: 8 }}
              loading={casesLoading}
              locale={{ emptyText: <Empty description="暂无已解决案例" /> }}
            />
          </TabPane>
          <TabPane tab={<span><BookOutlined /> 法规标准</span>} key="regulations">
            <Table columns={regulationColumns} dataSource={filteredRegs} rowKey="id" pagination={{ pageSize: 8 }} />
          </TabPane>
          <TabPane tab={<span><ReadOutlined /> 文档库</span>} key="docs">
            <div className="mb-4 flex gap-3">
              <Select
                placeholder="按分类筛选"
                allowClear
                style={{ width: 160 }}
                value={docCategory}
                onChange={(val) => { setDocCategory(val); setDocPage(1); loadDocs(1, val); }}
                options={Object.entries(CATEGORY_LABELS).map(([k, v]) => ({ value: k, label: v }))}
              />
            </div>
            <Table
              columns={[
                { title: '文档标题', dataIndex: 'title', key: 'title', ellipsis: true,
                  render: (t: string, record: KnowledgeDoc) => (
                    <a onClick={() => navigate(`/knowledge/docs/${record.id}`)} className="text-cyan-600 hover:underline cursor-pointer">{t}</a>
                  ),
                },
                { title: '分类', dataIndex: 'category', key: 'category',
                  render: (t: string) => <Tag color="blue">{CATEGORY_LABELS[t] || t}</Tag>,
                },
                { title: '来源', dataIndex: 'source', key: 'source', ellipsis: true },
                { title: '发布日期', dataIndex: 'publish_date', key: 'publish_date', width: 120 },
                { title: '标签', dataIndex: 'tags', key: 'tags',
                  render: (tags: string[]) => tags?.slice(0, 3).map((t, i) => <Tag key={i} className="mr-1">{t}</Tag>),
                },
                { title: '操作', key: 'action', width: 100,
                  render: (_: any, record: KnowledgeDoc) => (
                    <Button type="text" icon={<EyeOutlined />} size="small" onClick={() => navigate(`/knowledge/docs/${record.id}`)}>查看</Button>
                  ),
                },
              ]}
              dataSource={docs}
              rowKey="id"
              loading={docsLoading}
              pagination={{
                current: docPage,
                pageSize: 10,
                total: docsTotal,
                onChange: (p) => { setDocPage(p); loadDocs(p, docCategory); },
              }}
              locale={{ emptyText: <Empty description="暂无文档数据" /> }}
            />
          </TabPane>
        </Tabs>
      </GlassCard>

      <Modal
        title={<span><RobotOutlined className="mr-2 text-cyan-500" />{detailData?.__meta?.title || 'AI 应急预案'}</span>}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={<Button onClick={() => setDetailOpen(false)}>关闭</Button>}
        width={720}
        destroyOnClose
      >
        {renderPlanDetail()}
      </Modal>
    </div>
  );
}

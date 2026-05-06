import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftOutlined,
  EnvironmentOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  FileTextOutlined,
  TeamOutlined,
  ExperimentOutlined,
  NodeIndexOutlined,
  SolutionOutlined,
} from '@ant-design/icons';
import { Button, Tag, Timeline, Card, Statistic, Steps, Tabs, List, Avatar } from 'antd';
import { GlassCard } from '../../components/GlassCard';
import ReactECharts from 'echarts-for-react';

const { TabPane } = Tabs;

// 模拟案例详情数据
const mockCaseDetails: Record<string, {
  id: number;
  title: string;
  type: string;
  status: string;
  date: string;
  location: string;
  description: string;
  severity: 'critical' | 'major' | 'minor';
  pollutants: { name: string; value: number; standard: number; unit: string }[];
  affectedStations: string[];
  timeline: { time: string; event: string; type: 'info' | 'warning' | 'success' | 'error' }[];
  measures: { step: number; title: string; description: string; status: 'finish' | 'process' | 'wait' }[];
  team: { name: string; role: string; avatar?: string }[];
  result: { indicator: string; before: number; after: number; unit: string }[];
  similarCases: { id: number; title: string; similarity: number }[];
}> = {
  '1': {
    id: 1,
    title: '某工业园区COD超标事件',
    type: '有机污染',
    status: '已解决',
    date: '2024-03-10',
    location: '章贡区工业园区东区',
    description: '章贡区工业园区东区污水处理站出水COD持续超标，经排查为上游某食品加工企业违规排放高浓度有机废水所致。该事件导致下游章江水质短期恶化，需要紧急处置。',
    severity: 'major',
    pollutants: [
      { name: 'COD', value: 85, standard: 40, unit: 'mg/L' },
      { name: 'BOD5', value: 32, standard: 20, unit: 'mg/L' },
      { name: '氨氮', value: 12, standard: 8, unit: 'mg/L' },
    ],
    affectedStations: ['ST_002', 'ST_028', 'ST_033'],
    timeline: [
      { time: '2024-03-10 08:30', event: '监测站点ST_002检测到COD异常升高，触发黄色预警', type: 'warning' },
      { time: '2024-03-10 09:00', event: '系统自动进行溯源分析，定位上游可疑污染源', type: 'info' },
      { time: '2024-03-10 09:45', event: '现场排查确认为某食品加工企业违规排放', type: 'error' },
      { time: '2024-03-10 10:30', event: '执法人员到达现场，责令企业停止排放', type: 'info' },
      { time: '2024-03-10 14:00', event: '启动应急处理方案，投加絮凝剂', type: 'info' },
      { time: '2024-03-11 06:00', event: 'COD指标恢复正常范围', type: 'success' },
      { time: '2024-03-12 09:00', event: '事件结案，企业被处以罚款', type: 'success' },
    ],
    measures: [
      { step: 1, title: '预警触发', description: '监测数据异常，系统自动预警', status: 'finish' },
      { step: 2, title: '溯源定位', description: '基于图谱分析定位污染源', status: 'finish' },
      { step: 3, title: '现场排查', description: '执法人员现场核实', status: 'finish' },
      { step: 4, title: '应急处置', description: '启动应急预案进行处置', status: 'finish' },
      { step: 5, title: '效果验证', description: '持续监测确认恢复正常', status: 'finish' },
    ],
    team: [
      { name: '张明', role: '应急指挥' },
      { name: '李华', role: '技术专家' },
      { name: '王强', role: '执法人员' },
      { name: '赵琳', role: '监测人员' },
    ],
    result: [
      { indicator: 'COD', before: 85, after: 35, unit: 'mg/L' },
      { indicator: 'BOD5', before: 32, after: 15, unit: 'mg/L' },
      { indicator: '氨氮', before: 12, after: 5, unit: 'mg/L' },
    ],
    similarCases: [
      { id: 2, title: '某河段藻类爆发事件', similarity: 72 },
      { id: 5, title: '某化工厂排放超标', similarity: 88 },
    ],
  },
  '2': {
    id: 2,
    title: '某河段藻类爆发事件',
    type: '富营养化',
    status: '已解决',
    date: '2024-02-28',
    location: '赣县区桃江段',
    description: '桃江赣县段出现大面积藻类爆发，水体呈绿色，透明度明显下降。经分析为上游农业面源污染导致氮磷超标所致。',
    severity: 'major',
    pollutants: [
      { name: '总氮', value: 3.5, standard: 2.0, unit: 'mg/L' },
      { name: '总磷', value: 0.4, standard: 0.2, unit: 'mg/L' },
      { name: '叶绿素a', value: 65, standard: 25, unit: 'μg/L' },
    ],
    affectedStations: ['ST_010', 'ST_016', 'ST_027'],
    timeline: [
      { time: '2024-02-28 07:00', event: '群众举报河流发绿', type: 'warning' },
      { time: '2024-02-28 08:30', event: '监测站点确认叶绿素a超标', type: 'warning' },
      { time: '2024-02-28 10:00', event: '专家组现场勘察', type: 'info' },
      { time: '2024-02-28 14:00', event: '启动物理打捞+生物治理', type: 'info' },
      { time: '2024-03-05 09:00', event: '藻类基本清除，水质恢复', type: 'success' },
    ],
    measures: [
      { step: 1, title: '预警触发', description: '群众举报+监测预警', status: 'finish' },
      { step: 2, title: '原因分析', description: '确定为农业面源污染', status: 'finish' },
      { step: 3, title: '应急处置', description: '物理打捞+生物治理', status: 'finish' },
      { step: 4, title: '源头管控', description: '加强农业面源管理', status: 'finish' },
      { step: 5, title: '效果验证', description: '持续监测确认恢复', status: 'finish' },
    ],
    team: [
      { name: '刘伟', role: '应急指挥' },
      { name: '陈芳', role: '生态专家' },
    ],
    result: [
      { indicator: '总氮', before: 3.5, after: 1.8, unit: 'mg/L' },
      { indicator: '总磷', before: 0.4, after: 0.15, unit: 'mg/L' },
      { indicator: '叶绿素a', before: 65, after: 20, unit: 'μg/L' },
    ],
    similarCases: [
      { id: 1, title: '某工业园区COD超标事件', similarity: 72 },
    ],
  },
};

// 污染物对比图表配置
const getPollutantChartOption = (pollutants: { name: string; value: number; standard: number; unit: string }[]) => ({
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'shadow' },
  },
  legend: {
    data: ['实测值', '标准值'],
    top: 10,
  },
  xAxis: {
    type: 'category',
    data: pollutants.map((p) => p.name),
  },
  yAxis: {
    type: 'value',
    name: '浓度',
  },
  series: [
    {
      name: '实测值',
      type: 'bar',
      data: pollutants.map((p) => ({
        value: p.value,
        itemStyle: { color: p.value > p.standard ? '#ef4444' : '#22c55e' },
      })),
      barWidth: '30%',
    },
    {
      name: '标准值',
      type: 'bar',
      data: pollutants.map((p) => p.standard),
      barWidth: '30%',
      itemStyle: { color: '#94a3b8' },
    },
  ],
});

// 处置效果图表配置
const getResultChartOption = (result: { indicator: string; before: number; after: number; unit: string }[]) => ({
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'shadow' },
  },
  legend: {
    data: ['处置前', '处置后'],
    top: 10,
  },
  xAxis: {
    type: 'category',
    data: result.map((r) => r.indicator),
  },
  yAxis: {
    type: 'value',
    name: '浓度',
  },
  series: [
    {
      name: '处置前',
      type: 'bar',
      data: result.map((r) => r.before),
      barWidth: '30%',
      itemStyle: { color: '#ef4444' },
    },
    {
      name: '处置后',
      type: 'bar',
      data: result.map((r) => r.after),
      barWidth: '30%',
      itemStyle: { color: '#22c55e' },
    },
  ],
});

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const caseData = mockCaseDetails[id || '1'];

  if (!caseData) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <WarningOutlined className="text-6xl text-gray-300 mb-4" />
        <p className="text-gray-500">案例不存在</p>
        <Button type="primary" className="mt-4" onClick={() => navigate('/knowledge')}>
          返回知识库
        </Button>
      </div>
    );
  }

  const severityConfig = {
    critical: { label: '严重', color: 'red' },
    major: { label: '较大', color: 'orange' },
    minor: { label: '一般', color: 'blue' },
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/knowledge')}
        >
          返回
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-gray-900">{caseData.title}</h1>
            <Tag color={caseData.status === '已解决' ? 'green' : 'orange'}>{caseData.status}</Tag>
            <Tag color={severityConfig[caseData.severity].color}>
              {severityConfig[caseData.severity].label}
            </Tag>
          </div>
          <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <ExperimentOutlined /> {caseData.type}
            </span>
            <span className="flex items-center gap-1">
              <ClockCircleOutlined /> {caseData.date}
            </span>
            <span className="flex items-center gap-1">
              <EnvironmentOutlined /> {caseData.location}
            </span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <GlassCard className="p-4">
          <Statistic
            title={<span className="text-gray-600">超标污染物</span>}
            value={caseData.pollutants.length}
            suffix="项"
            prefix={<ExperimentOutlined className="text-red-500" />}
          />
        </GlassCard>
        <GlassCard className="p-4">
          <Statistic
            title={<span className="text-gray-600">影响站点</span>}
            value={caseData.affectedStations.length}
            suffix="个"
            prefix={<EnvironmentOutlined className="text-orange-500" />}
          />
        </GlassCard>
        <GlassCard className="p-4">
          <Statistic
            title={<span className="text-gray-600">处置措施</span>}
            value={caseData.measures.length}
            suffix="步"
            prefix={<SolutionOutlined className="text-blue-500" />}
          />
        </GlassCard>
        <GlassCard className="p-4">
          <Statistic
            title={<span className="text-gray-600">参与人员</span>}
            value={caseData.team.length}
            suffix="人"
            prefix={<TeamOutlined className="text-green-500" />}
          />
        </GlassCard>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="xl:col-span-2 space-y-6">
          {/* Case Description */}
          <GlassCard className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <FileTextOutlined className="text-cyan-500" />
              事件概述
            </h3>
            <p className="text-gray-600 leading-relaxed">{caseData.description}</p>
          </GlassCard>

          {/* Pollutant Analysis */}
          <GlassCard className="p-6">
            <Tabs defaultActiveKey="chart">
              <TabPane tab="污染物分析" key="chart">
                <ReactECharts option={getPollutantChartOption(caseData.pollutants)} style={{ height: '300px' }} />
              </TabPane>
              <TabPane tab="处置效果" key="result">
                <ReactECharts option={getResultChartOption(caseData.result)} style={{ height: '300px' }} />
              </TabPane>
            </Tabs>
          </GlassCard>

          {/* Processing Steps */}
          <GlassCard className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <NodeIndexOutlined className="text-cyan-500" />
              处置流程
            </h3>
            <Steps
              current={caseData.measures.filter((m) => m.status === 'finish').length - 1}
              items={caseData.measures.map((m) => ({
                title: m.title,
                description: m.description,
                status: m.status,
              }))}
            />
          </GlassCard>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Timeline */}
          <GlassCard className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <ClockCircleOutlined className="text-cyan-500" />
              事件时间线
            </h3>
            <Timeline
              items={caseData.timeline.map((item) => ({
                color:
                  item.type === 'success'
                    ? 'green'
                    : item.type === 'error'
                      ? 'red'
                      : item.type === 'warning'
                        ? 'orange'
                        : 'blue',
                children: (
                  <div>
                    <p className="text-xs text-gray-400">{item.time}</p>
                    <p className="text-sm text-gray-700">{item.event}</p>
                  </div>
                ),
              }))}
            />
          </GlassCard>

          {/* Team */}
          <GlassCard className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <TeamOutlined className="text-cyan-500" />
              处置团队
            </h3>
            <List
              itemLayout="horizontal"
              dataSource={caseData.team}
              renderItem={(item) => (
                <List.Item>
                  <List.Item.Meta
                    avatar={<Avatar style={{ backgroundColor: '#0891b2' }}>{item.name[0]}</Avatar>}
                    title={item.name}
                    description={item.role}
                  />
                </List.Item>
              )}
            />
          </GlassCard>

          {/* Similar Cases */}
          <GlassCard className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <NodeIndexOutlined className="text-cyan-500" />
              相似案例
            </h3>
            <div className="space-y-3">
              {caseData.similarCases.map((c) => (
                <Card
                  key={c.id}
                  size="small"
                  hoverable
                  onClick={() => navigate(`/knowledge/cases/${c.id}`)}
                  className="cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-gray-700">{c.title}</span>
                    <Tag color={c.similarity >= 80 ? 'green' : 'orange'}>{c.similarity}%</Tag>
                  </div>
                </Card>
              ))}
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}

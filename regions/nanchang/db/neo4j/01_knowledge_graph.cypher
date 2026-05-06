// 流域水环境AI智能监测与预警平台 - 知识图谱初始化脚本
// 用于初始化站点拓扑、污染规则、应急预案、部门等知识数据

// ==============================================
// 创建约束和索引
// ==============================================

CREATE CONSTRAINT station_id IF NOT EXISTS FOR (s:Station) REQUIRE s.station_id IS UNIQUE;
CREATE CONSTRAINT pollution_type_id IF NOT EXISTS FOR (p:PollutionType) REQUIRE p.type_id IS UNIQUE;
CREATE CONSTRAINT rule_id IF NOT EXISTS FOR (r:Rule) REQUIRE r.rule_id IS UNIQUE;
CREATE CONSTRAINT plan_id IF NOT EXISTS FOR (p:EmergencyPlan) REQUIRE p.plan_id IS UNIQUE;
CREATE CONSTRAINT department_id IF NOT EXISTS FOR (d:Department) REQUIRE d.dept_id IS UNIQUE;
CREATE CONSTRAINT pollution_source_id IF NOT EXISTS FOR (s:PollutionSource) REQUIRE s.source_id IS UNIQUE;

// ==============================================
// 创建污染类型节点
// ==============================================

MERGE (p:PollutionType {type_id: 'domestic_sewage'})
SET p.name = '生活污水',
    p.description = '高氨氮、低溶解氧',
    p.judgment_basis = '氨氮↑ + 溶解氧↓',
    p.indicators = ['nh3_n', 'do', 'codmn', 'ph'],
    p.severity = 'medium',
    p.created_at = datetime();

MERGE (p:PollutionType {type_id: 'industrial_wastewater'})
SET p.name = '工业废水',
    p.description = '高COD、重金属',
    p.judgment_basis = 'COD↑ + pH异常 + 电导率↑',
    p.indicators = ['codcr', 'codmn', 'ph', 'conductivity'],
    p.severity = 'high',
    p.created_at = datetime();

MERGE (p:PollutionType {type_id: 'agricultural_runoff'})
SET p.name = '农业面源',
    p.description = '高总氮、高总磷',
    p.judgment_basis = '总氮↑ + 总磷↑',
    p.indicators = ['total_n', 'total_p', 'nh3_n'],
    p.severity = 'medium',
    p.created_at = datetime();

MERGE (p:PollutionType {type_id: 'algae_bloom'})
SET p.name = '藻类爆发',
    p.description = '高叶绿素、高pH、高溶解氧日间波动',
    p.judgment_basis = '叶绿素↑ + pH↑',
    p.indicators = ['chlorophyll', 'ph', 'do'],
    p.severity = 'high',
    p.created_at = datetime();

MERGE (p:PollutionType {type_id: 'black_odor'})
SET p.name = '黑臭水体',
    p.description = '低溶解氧、低透明度、高硫化物',
    p.judgment_basis = '溶解氧↓ + 透明度↓ + ORP↓',
    p.indicators = ['do', 'transparency', 'orp'],
    p.severity = 'critical',
    p.created_at = datetime();

// ==============================================
// 创建规则节点
// ==============================================

// 生活污水规则
MERGE (r:Rule {rule_id: 'rule_domestic_nh3n'})
SET r.metric = 'nh3_n', r.min_value = 2.0, r.weight = 0.4, r.description = '氨氮超标';
MERGE (r:Rule {rule_id: 'rule_domestic_do'})
SET r.metric = 'do', r.max_value = 5.0, r.weight = 0.3, r.description = '溶解氧偏低';
MERGE (r:Rule {rule_id: 'rule_domestic_codmn'})
SET r.metric = 'codmn', r.min_value = 10.0, r.weight = 0.2, r.description = '高锰酸盐指数超标';
MERGE (r:Rule {rule_id: 'rule_domestic_ph'})
SET r.metric = 'ph', r.min_value = 6.5, r.max_value = 8.5, r.weight = 0.1, r.description = 'pH正常范围';

// 工业废水规则
MERGE (r:Rule {rule_id: 'rule_industrial_codcr'})
SET r.metric = 'codcr', r.min_value = 100.0, r.weight = 0.4, r.description = 'CODCr超标';
MERGE (r:Rule {rule_id: 'rule_industrial_codmn'})
SET r.metric = 'codmn', r.min_value = 15.0, r.weight = 0.3, r.description = '高锰酸盐指数超标';
MERGE (r:Rule {rule_id: 'rule_industrial_ph'})
SET r.metric = 'ph', r.min_value = 0, r.max_value = 6.0, r.weight = 0.15, r.description = 'pH偏酸';
MERGE (r:Rule {rule_id: 'rule_industrial_conductivity'})
SET r.metric = 'conductivity', r.min_value = 2000.0, r.weight = 0.15, r.description = '电导率超标';

// 农业面源规则
MERGE (r:Rule {rule_id: 'rule_agricultural_total_n'})
SET r.metric = 'total_n', r.min_value = 5.0, r.weight = 0.4, r.description = '总氮超标';
MERGE (r:Rule {rule_id: 'rule_agricultural_total_p'})
SET r.metric = 'total_p', r.min_value = 0.5, r.weight = 0.4, r.description = '总磷超标';
MERGE (r:Rule {rule_id: 'rule_agricultural_nh3n'})
SET r.metric = 'nh3_n', r.min_value = 1.0, r.weight = 0.2, r.description = '氨氮偏高';

// 藻类爆发规则
MERGE (r:Rule {rule_id: 'rule_algae_chlorophyll'})
SET r.metric = 'chlorophyll', r.min_value = 30.0, r.weight = 0.5, r.description = '叶绿素超标';
MERGE (r:Rule {rule_id: 'rule_algae_ph'})
SET r.metric = 'ph', r.min_value = 8.5, r.weight = 0.25, r.description = 'pH偏碱';
MERGE (r:Rule {rule_id: 'rule_algae_do'})
SET r.metric = 'do', r.min_value = 10.0, r.weight = 0.25, r.description = '溶解氧偏高';

// 黑臭水体规则
MERGE (r:Rule {rule_id: 'rule_black_do'})
SET r.metric = 'do', r.max_value = 2.0, r.weight = 0.4, r.description = '溶解氧极低';
MERGE (r:Rule {rule_id: 'rule_black_transparency'})
SET r.metric = 'transparency', r.max_value = 25.0, r.weight = 0.3, r.description = '透明度极低';
MERGE (r:Rule {rule_id: 'rule_black_orp'})
SET r.metric = 'orp', r.max_value = -200.0, r.weight = 0.3, r.description = 'ORP负值';

// ==============================================
// 创建部门节点
// ==============================================

MERGE (d:Department {dept_id: 'ecology_env'})
SET d.name = '生态环境局', d.phone = '12369', d.responsibility = '环境监测与执法';

MERGE (d:Department {dept_id: 'urban_mgmt'})
SET d.name = '城管局', d.phone = '12319', d.responsibility = '城市管理与执法';

MERGE (d:Department {dept_id: 'water_affairs'})
SET d.name = '水务局', d.phone = '12345', d.responsibility = '水资源管理';

MERGE (d:Department {dept_id: 'industry_info'})
SET d.name = '工信局', d.phone = '12345', d.responsibility = '工业企业监管';

MERGE (d:Department {dept_id: 'emergency_mgmt'})
SET d.name = '应急管理局', d.phone = '119', d.responsibility = '应急救援与处置';

MERGE (d:Department {dept_id: 'agriculture'})
SET d.name = '农业农村局', d.phone = '12316', d.responsibility = '农业生产监管';

MERGE (d:Department {dept_id: 'housing_urban'})
SET d.name = '住建局', d.phone = '12319', d.responsibility = '城市建设与市政';

// ==============================================
// 创建应急预案节点
// ==============================================

MERGE (p:EmergencyPlan {plan_id: 'plan_domestic_sewage'})
SET p.name = '生活污水应急预案',
    p.actions = ['排查上游排污口', '加强污水处理厂监管', '加密监测频次', '启动应急处理设施'],
    p.priority = 'high',
    p.response_time = '2小时内',
    p.created_at = datetime();

MERGE (p:EmergencyPlan {plan_id: 'plan_industrial_wastewater'})
SET p.name = '工业废水应急预案',
    p.actions = ['排查工业园区企业', '检查企业污水处理设施', '取样送检重金属指标', '责令超标企业停产整改'],
    p.priority = 'critical',
    p.response_time = '1小时内',
    p.created_at = datetime();

MERGE (p:EmergencyPlan {plan_id: 'plan_agricultural_runoff'})
SET p.name = '农业面源应急预案',
    p.actions = ['排查农田退水', '检查畜禽养殖场', '控制化肥农药使用', '建设生态沟渠'],
    p.priority = 'medium',
    p.response_time = '4小时内',
    p.created_at = datetime();

MERGE (p:EmergencyPlan {plan_id: 'plan_algae_bloom'})
SET p.name = '藻类爆发应急预案',
    p.actions = ['启动蓝藻打捞', '投放除藻剂', '增加水体流动性', '加密藻类监测'],
    p.priority = 'high',
    p.response_time = '2小时内',
    p.created_at = datetime();

MERGE (p:EmergencyPlan {plan_id: 'plan_black_odor'})
SET p.name = '黑臭水体应急预案',
    p.actions = ['排查污染源', '清淤疏浚', '生态补水', '曝气增氧'],
    p.priority = 'high',
    p.response_time = '4小时内',
    p.created_at = datetime();

// ==============================================
// 创建污染源节点
// ==============================================

MERGE (s:PollutionSource {source_id: 'src_sewage_plant'})
SET s.name = '污水处理厂', s.type = 'point_source', s.causes = ['domestic_sewage'];

MERGE (s:PollutionSource {source_id: 'src_industrial_park'})
SET s.name = '工业园区', s.type = 'point_source', s.causes = ['industrial_wastewater'];

MERGE (s:PollutionSource {source_id: 'src_chemical_plant'})
SET s.name = '化工厂', s.type = 'point_source', s.causes = ['industrial_wastewater'];

MERGE (s:PollutionSource {source_id: 'src_farm'})
SET s.name = '养殖场', s.type = 'nonpoint_source', s.causes = ['agricultural_runoff', 'domestic_sewage'];

MERGE (s:PollutionSource {source_id: 'src_farmland'})
SET s.name = '农田', s.type = 'nonpoint_source', s.causes = ['agricultural_runoff'];

MERGE (s:PollutionSource {source_id: 'src_urban_runoff'})
SET s.name = '城市径流', s.type = 'nonpoint_source', s.causes = ['domestic_sewage', 'black_odor'];

// ==============================================
// 创建关系：污染类型 -> 规则
// ==============================================

MATCH (p:PollutionType {type_id: 'domestic_sewage'}), (r:Rule) WHERE r.rule_id STARTS WITH 'rule_domestic_'
MERGE (p)-[:HAS_RULE]->(r);

MATCH (p:PollutionType {type_id: 'industrial_wastewater'}), (r:Rule) WHERE r.rule_id STARTS WITH 'rule_industrial_'
MERGE (p)-[:HAS_RULE]->(r);

MATCH (p:PollutionType {type_id: 'agricultural_runoff'}), (r:Rule) WHERE r.rule_id STARTS WITH 'rule_agricultural_'
MERGE (p)-[:HAS_RULE]->(r);

MATCH (p:PollutionType {type_id: 'algae_bloom'}), (r:Rule) WHERE r.rule_id STARTS WITH 'rule_algae_'
MERGE (p)-[:HAS_RULE]->(r);

MATCH (p:PollutionType {type_id: 'black_odor'}), (r:Rule) WHERE r.rule_id STARTS WITH 'rule_black_'
MERGE (p)-[:HAS_RULE]->(r);

// ==============================================
// 创建关系：污染类型 -> 应急预案
// ==============================================

MATCH (p:PollutionType {type_id: 'domestic_sewage'}), (plan:EmergencyPlan {plan_id: 'plan_domestic_sewage'})
MERGE (p)-[:HAS_PLAN]->(plan);

MATCH (p:PollutionType {type_id: 'industrial_wastewater'}), (plan:EmergencyPlan {plan_id: 'plan_industrial_wastewater'})
MERGE (p)-[:HAS_PLAN]->(plan);

MATCH (p:PollutionType {type_id: 'agricultural_runoff'}), (plan:EmergencyPlan {plan_id: 'plan_agricultural_runoff'})
MERGE (p)-[:HAS_PLAN]->(plan);

MATCH (p:PollutionType {type_id: 'algae_bloom'}), (plan:EmergencyPlan {plan_id: 'plan_algae_bloom'})
MERGE (p)-[:HAS_PLAN]->(plan);

MATCH (p:PollutionType {type_id: 'black_odor'}), (plan:EmergencyPlan {plan_id: 'plan_black_odor'})
MERGE (p)-[:HAS_PLAN]->(plan);

// ==============================================
// 创建关系：应急预案 -> 部门
// ==============================================

MATCH (plan:EmergencyPlan {plan_id: 'plan_domestic_sewage'}), (d:Department) 
WHERE d.dept_id IN ['ecology_env', 'urban_mgmt', 'water_affairs']
MERGE (plan)-[:INVOLVES]->(d);

MATCH (plan:EmergencyPlan {plan_id: 'plan_industrial_wastewater'}), (d:Department) 
WHERE d.dept_id IN ['ecology_env', 'industry_info', 'emergency_mgmt']
MERGE (plan)-[:INVOLVES]->(d);

MATCH (plan:EmergencyPlan {plan_id: 'plan_agricultural_runoff'}), (d:Department) 
WHERE d.dept_id IN ['agriculture', 'ecology_env']
MERGE (plan)-[:INVOLVES]->(d);

MATCH (plan:EmergencyPlan {plan_id: 'plan_algae_bloom'}), (d:Department) 
WHERE d.dept_id IN ['water_affairs', 'ecology_env', 'urban_mgmt']
MERGE (plan)-[:INVOLVES]->(d);

MATCH (plan:EmergencyPlan {plan_id: 'plan_black_odor'}), (d:Department) 
WHERE d.dept_id IN ['housing_urban', 'water_affairs', 'ecology_env']
MERGE (plan)-[:INVOLVES]->(d);

// ==============================================
// 创建关系：污染源 -> 污染类型
// ==============================================

MATCH (s:PollutionSource), (p:PollutionType)
WHERE p.type_id IN s.causes
MERGE (s)-[:CAUSES]->(p);

// ==============================================
// 清理旧版演示站点及 FLOWS_TO 关系
// （早期演示数据，已由 03_monitoring_stations.cypher 的 73 个正式站点替代）
// ==============================================

// 删除旧版 FLOWS_TO 关系
MATCH ()-[r:FLOWS_TO]->() DELETE r;

// 删除无 river_id 的演示站点
MATCH (s:Station)
WHERE s.station_id IN ['S001','S002','S003','S004','S005','WS001','IP001','BS001','RW001']
DETACH DELETE s;


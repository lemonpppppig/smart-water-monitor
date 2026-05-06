-- ============================================================
-- 补齐后端 ORM 已定义但 01~03 未建的表 DDL
-- 让 Docker 初始化路径不再依赖 SQLAlchemy create_all 兜底
-- ============================================================

-- ==============================================
-- 1. metrics_catalog（全局指标字典，来自 backend/app/station/models.py::MetricCatalog）
-- ==============================================
CREATE TABLE IF NOT EXISTS metrics_catalog (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    metric_code VARCHAR(32) UNIQUE NOT NULL,
    metric_name VARCHAR(64) NOT NULL,
    category VARCHAR(32),
    unit VARCHAR(16),
    description TEXT,
        upper_limit DECIMAL(20, 4),
        lower_limit DECIMAL(20, 4),
        standard_limit DECIMAL(20, 4),
    standard_code VARCHAR(64),
    is_active BOOLEAN DEFAULT true,
    display_order DECIMAL(10, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE metrics_catalog IS '全局水质指标字典';

CREATE TRIGGER update_metrics_catalog_updated_at BEFORE UPDATE ON metrics_catalog
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==============================================
-- 2. map_features（地图要素叠加图层）
-- ==============================================
CREATE TABLE IF NOT EXISTS map_features (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    feature_type VARCHAR(32) NOT NULL,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    geometry_type VARCHAR(16) DEFAULT 'Point',
    coordinates JSONB,
    properties JSONB DEFAULT '{}',
    style JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE map_features IS '地图要素表（河流标注/流域边界/POI/污染标记等）';

CREATE INDEX IF NOT EXISTS idx_map_features_type ON map_features(feature_type);

CREATE TRIGGER update_map_features_updated_at BEFORE UPDATE ON map_features
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==============================================
-- 3. notifications（系统通知）
-- ==============================================
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(256) NOT NULL,
    content TEXT,
    notification_type VARCHAR(32) NOT NULL DEFAULT 'system',
    level VARCHAR(16) DEFAULT 'info',
    source VARCHAR(64),
    source_id VARCHAR(64),
    recipient VARCHAR(128),
    is_read BOOLEAN DEFAULT false NOT NULL,
    read_at TIMESTAMP WITH TIME ZONE,
    meta JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE notifications IS '系统通知表';

CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(notification_type);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);

CREATE TRIGGER update_notifications_updated_at BEFORE UPDATE ON notifications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==============================================
-- 4. reports（如 01_init 已建则跳过，补齐 report_name/start_time/end_time 字段）
-- ==============================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reports' AND column_name='report_name') THEN
        ALTER TABLE reports ADD COLUMN report_name VARCHAR(256);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reports' AND column_name='start_time') THEN
        ALTER TABLE reports ADD COLUMN start_time TIMESTAMP WITH TIME ZONE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reports' AND column_name='end_time') THEN
        ALTER TABLE reports ADD COLUMN end_time TIMESTAMP WITH TIME ZONE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reports' AND column_name='file_path') THEN
        ALTER TABLE reports ADD COLUMN file_path VARCHAR(512);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reports' AND column_name='file_format') THEN
        ALTER TABLE reports ADD COLUMN file_format VARCHAR(16) DEFAULT 'pdf';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reports' AND column_name='status') THEN
        ALTER TABLE reports ADD COLUMN status VARCHAR(16) DEFAULT 'completed';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reports' AND column_name='error_message') THEN
        ALTER TABLE reports ADD COLUMN error_message TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reports' AND column_name='created_by') THEN
        ALTER TABLE reports ADD COLUMN created_by VARCHAR(64);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reports' AND column_name='updated_at') THEN
        ALTER TABLE reports ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
    END IF;
END $$;

-- ==============================================
-- 5. report_templates（报告模板）
-- ==============================================
CREATE TABLE IF NOT EXISTS report_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_code VARCHAR(64) UNIQUE NOT NULL,
    template_name VARCHAR(128) NOT NULL,
    template_type VARCHAR(32) NOT NULL,
    description TEXT,
    content_structure JSONB,
    is_default VARCHAR(16) DEFAULT 'false',
    is_enabled VARCHAR(16) DEFAULT 'true',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE report_templates IS '报告模板表';

CREATE TRIGGER update_report_templates_updated_at BEFORE UPDATE ON report_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==============================================
-- 6. scheduled_reports（定时报告配置）
-- ==============================================
CREATE TABLE IF NOT EXISTS scheduled_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    schedule_name VARCHAR(128) NOT NULL,
    report_type VARCHAR(32) NOT NULL,
    station_ids JSONB,
    cron_expression VARCHAR(64),
    recipients JSONB,
    is_enabled VARCHAR(16) DEFAULT 'true',
    last_run_at TIMESTAMP WITH TIME ZONE,
    next_run_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE scheduled_reports IS '定时报告计划表';

CREATE TRIGGER update_scheduled_reports_updated_at BEFORE UPDATE ON scheduled_reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==============================================
-- 7. mqtt_connections（MQTT连接配置，来自 backend/app/data/models/db_models.py）
-- ==============================================
CREATE TABLE IF NOT EXISTS mqtt_connections (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(128) DEFAULT '',
    broker_host VARCHAR(256) NOT NULL,
    broker_port INTEGER DEFAULT 1883,
    topic VARCHAR(512) NOT NULL,
    module_keys VARCHAR(128) DEFAULT '',
    username VARCHAR(128),
    password VARCHAR(256),
    client_id VARCHAR(128),
    qos INTEGER DEFAULT 1,
    station_id VARCHAR(64),
    station_name VARCHAR(128),
    status VARCHAR(16) DEFAULT 'disconnected',
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_active_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE mqtt_connections IS 'MQTT 连接配置表';

CREATE TRIGGER update_mqtt_connections_updated_at BEFORE UPDATE ON mqtt_connections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==============================================
-- 8. ai_agent_tasks（智能体任务）
-- ==============================================
CREATE TABLE IF NOT EXISTS ai_agent_tasks (
    task_id VARCHAR(128) PRIMARY KEY,
    task_type VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    priority INTEGER DEFAULT 1,
    mode VARCHAR(16) DEFAULT 'async',
    payload JSONB,
    result JSONB,
    error TEXT,
    assigned_to VARCHAR(64),
    station_id VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE
);
COMMENT ON TABLE ai_agent_tasks IS '智能体任务持久化表';
CREATE INDEX IF NOT EXISTS idx_ai_tasks_type ON ai_agent_tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_status ON ai_agent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_station ON ai_agent_tasks(station_id);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_created ON ai_agent_tasks(created_at);

-- ==============================================
-- 9. ai_station_models（站点级模型绑定）
-- ==============================================
CREATE TABLE IF NOT EXISTS ai_station_models (
    station_id VARCHAR(128) PRIMARY KEY,
    station_name VARCHAR(128),
    model_type VARCHAR(32) DEFAULT 'lstm_autoencoder',
    metrics JSONB,
    epochs INTEGER DEFAULT 50,
    final_loss DOUBLE PRECISION,
    samples INTEGER,
    data_source VARCHAR(32) DEFAULT 'tdengine',
    model_file VARCHAR(256),
    params_file VARCHAR(256),
    version INTEGER DEFAULT 1,
    status VARCHAR(16) DEFAULT 'pending',
    error TEXT,
    trained_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE ai_station_models IS '站点级 LSTM 模型绑定表';
CREATE INDEX IF NOT EXISTS idx_ai_models_status ON ai_station_models(status);

CREATE TRIGGER update_ai_station_models_updated_at BEFORE UPDATE ON ai_station_models
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==============================================
-- 10. graph_canvas_layout（图谱画布坐标持久化）
-- ==============================================
CREATE TABLE IF NOT EXISTS graph_canvas_layout (
    id SERIAL PRIMARY KEY,
    node_type VARCHAR(32) NOT NULL,
    node_id VARCHAR(128) NOT NULL,
    x DOUBLE PRECISION NOT NULL,
    y DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_graph_canvas_layout_type_id UNIQUE (node_type, node_id)
);
COMMENT ON TABLE graph_canvas_layout IS '图谱画布节点坐标持久化表';
CREATE INDEX IF NOT EXISTS idx_gcl_type ON graph_canvas_layout(node_type);

-- ==============================================
-- 知识文档库表
-- ==============================================
CREATE TABLE IF NOT EXISTS knowledge_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doc_code VARCHAR(64) UNIQUE NOT NULL,
    title VARCHAR(256) NOT NULL,
    category VARCHAR(64) NOT NULL,         -- regulation / standard / manual / case_study / policy
    sub_category VARCHAR(64),
    summary TEXT,
    content TEXT NOT NULL,                  -- 富文本正文（Markdown）
    source VARCHAR(256),                   -- 来源 / 发文机关
    publish_date DATE,
    effective_date DATE,
    tags TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE knowledge_documents IS '知识文档库（法规、规范、操作手册、案例等文档）';

CREATE INDEX IF NOT EXISTS idx_kd_category ON knowledge_documents(category);
CREATE INDEX IF NOT EXISTS idx_kd_tags ON knowledge_documents USING GIN(tags);

CREATE TRIGGER update_knowledge_documents_updated_at BEFORE UPDATE ON knowledge_documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 种子文档数据
INSERT INTO knowledge_documents (doc_code, title, category, sub_category, summary, content, source, publish_date, effective_date, tags, sort_order) VALUES
('REG-GB3838-2002', '地表水环境质量标准 GB 3838-2002', 'regulation', '国家标准',
 '规定了地表水环境质量标准值及水质评价、监测方法，将水质按功能分为五类。',
 E'# 地表水环境质量标准 GB 3838-2002\n\n## 1 适用范围\n\n本标准适用于中华人民共和国领域内江河、湖泊、运河、渠道、水库等具有使用功能的地表水水域。\n\n## 2 水域功能和标准分类\n\n依据地表水水域环境功能和保护目标，按功能高低依次划分为五类：\n\n| 类别 | 功能 | 主要指标限值 |\n|------|------|-------------|\n| Ⅰ类 | 源头水、国家自然保护区 | pH 6-9, DO≥7.5, CODMn≤2 |\n| Ⅱ类 | 集中式生活饮用水源地一级保护区 | pH 6-9, DO≥6, CODMn≤4 |\n| Ⅲ类 | 集中式生活饮用水源地二级保护区 | pH 6-9, DO≥5, CODMn≤6 |\n| Ⅳ类 | 一般工业用水及人体非直接接触的娱乐用水 | pH 6-9, DO≥3, CODMn≤10 |\n| Ⅴ类 | 农业用水及一般景观要求水域 | pH 6-9, DO≥2, CODMn≤15 |\n\n## 3 基本项目标准限值\n\n### 3.1 常规指标\n\n| 指标 | Ⅰ类 | Ⅱ类 | Ⅲ类 | Ⅳ类 | Ⅴ类 | 单位 |\n|------|------|------|------|------|------|------|\n| pH | 6-9 | 6-9 | 6-9 | 6-9 | 6-9 | - |\n| 溶解氧(DO) | ≥7.5 | ≥6 | ≥5 | ≥3 | ≥2 | mg/L |\n| 高锰酸盐指数 | ≤2 | ≤4 | ≤6 | ≤10 | ≤15 | mg/L |\n| 化学需氧量(COD) | ≤15 | ≤15 | ≤20 | ≤30 | ≤40 | mg/L |\n| 氨氮(NH₃-N) | ≤0.15 | ≤0.5 | ≤1.0 | ≤1.5 | ≤2.0 | mg/L |\n| 总磷(TP) | ≤0.02 | ≤0.1 | ≤0.2 | ≤0.3 | ≤0.4 | mg/L |\n| 总氮(TN) | ≤0.2 | ≤0.5 | ≤1.0 | ≤1.5 | ≤2.0 | mg/L |\n\n### 3.2 特定项目\n\n本标准还规定了重金属（铜、锌、铅、镉、汞、砷、铬等）、有机物（挥发酚、石油类、阴离子表面活性剂等）的标准限值。\n\n## 4 水质评价\n\n单因子评价法：取各项指标中最差的一项作为水质类别。\n\n## 5 监测要求\n\n- 监测频次：每月至少1次\n- 采样方法：按 HJ/T 91 执行\n- 分析方法：按国家标准分析方法执行',
 '国家环境保护总局', '2002-04-28', '2002-06-01',
 ARRAY['水质标准', '地表水', 'GB3838', '五类水'], 1),

('REG-GB8978-1996', '污水综合排放标准 GB 8978-1996', 'regulation', '国家标准',
 '规定了工业废水和城镇污水排放的污染物最高允许浓度。',
 E'# 污水综合排放标准 GB 8978-1996\n\n## 1 适用范围\n\n本标准适用于排入地表水、地下水和城市下水道的工业废水和城镇污水。\n\n## 2 标准分级\n\n根据排放去向，分为三级：\n\n- **一级标准**：排入GB3838 Ⅲ类水域（划定的保护区和游泳区除外）\n- **二级标准**：排入GB3838 Ⅳ、Ⅴ类水域\n- **三级标准**：排入设置二级污水处理厂的城镇下水道\n\n## 3 主要排放限值\n\n| 污染物 | 一级 | 二级 | 三级 | 单位 |\n|--------|------|------|------|------|\n| pH | 6-9 | 6-9 | 6-9 | - |\n| 悬浮物(SS) | 70 | 150 | 400 | mg/L |\n| 化学需氧量(COD) | 100 | 150 | 500 | mg/L |\n| 生化需氧量(BOD₅) | 20 | 30 | 300 | mg/L |\n| 氨氮 | 15 | 25 | - | mg/L |\n| 总氮 | - | - | - | mg/L |\n| 总磷 | 0.5 | 1.0 | - | mg/L |\n| 石油类 | 5 | 10 | 20 | mg/L |\n| 动植物油 | 10 | 15 | 100 | mg/L |\n\n## 4 监测与实施\n\n- 排放口须设置明显标志\n- 废水排放须安装流量计\n- 新建项目自立项起执行本标准',
 '国家环境保护局', '1996-10-04', '1998-01-01',
 ARRAY['排放标准', '污水', 'GB8978', '工业废水'], 2),

('REG-WATER-LAW', '中华人民共和国水污染防治法', 'regulation', '法律法规',
 '我国水污染防治的基本法律，规定了水污染防治的标准和措施、水污染事故处置等内容。',
 E'# 中华人民共和国水污染防治法\n\n（2017年6月27日修订）\n\n## 第一章 总则\n\n**第一条** 为了保护和改善环境，防治水污染，保护水生态，保障饮用水安全，维护公众健康，推进生态文明建设，促进经济社会可持续发展，制定本法。\n\n**第二条** 本法适用于中华人民共和国领域内的江河、湖泊、运河、渠道、水库等地表水体以及地下水体的污染防治。\n\n## 第四章 水污染防治措施\n\n### 第一节 一般规定\n\n**第三十三条** 禁止向水体排放油类、酸液、碱液或者剧毒废液。\n\n**第三十四条** 禁止在水体清洗装贮过油类或者有毒污染物的车辆和容器。\n\n**第三十五条** 禁止向水体排放、倾倒放射性固体废物或者含有高放射性和中放射性物质的废水。\n\n### 第三节 工业水污染防治\n\n**第四十五条** 排放工业废水的企业应当采取有效措施，收集和处理产生的全部废水，防止污染环境。含有毒有害水污染物的工业废水应当分类收集和处理，不得稀释排放。\n\n## 第六章 水污染事故处置\n\n**第七十八条** 企业事业单位发生事故或者其他突发性事件，造成或者可能造成水污染事故的，应当立即启动本单位的应急方案，采取应急措施，并向事故发生地的县级以上地方人民政府或者环境保护主管部门报告。\n\n## 第七章 法律责任\n\n**第八十三条** 违反本法规定，有下列行为之一的，由县级以上人民政府环境保护主管部门责令改正或者责令限制生产、停产整治，并处十万元以上一百万元以下的罚款。',
 '全国人民代表大会常务委员会', '2017-06-27', '2018-01-01',
 ARRAY['水污染防治', '法律', '环保法规'], 3),

('STD-HJT91', '地表水和污水监测技术规范 HJ/T 91-2002', 'standard', '技术规范',
 '规定了地表水和污水监测的布点、采样、保存、分析和质量控制等技术要求。',
 E'# 地表水和污水监测技术规范 HJ/T 91-2002\n\n## 1 监测方案\n\n### 1.1 布点原则\n\n- 在水质均匀的河段设置代表性断面\n- 饮用水源地上游 100m 处设置对照断面\n- 排污口下游 500m 处设置控制断面\n- 充分混合后设置削减断面\n\n### 1.2 采样频次\n\n| 水体类型 | 常规监测 | 加密监测 |\n|----------|----------|----------|\n| 河流 | 每月1次 | 每周1次 |\n| 湖泊 | 每月1次 | 每周1-2次 |\n| 水库 | 每季度1次 | 每月1次 |\n\n## 2 采样方法\n\n### 2.1 河流采样\n\n- 水面下 0.5m 处采集水样\n- 大型河流按主泓线设置采样垂线\n- 河宽 <50m：设1条垂线\n- 河宽 50-100m：设2条垂线（左右各1/4处）\n- 河宽 >100m：设3条以上垂线\n\n### 2.2 样品保存\n\n| 分析项目 | 容器材质 | 保存方法 | 保存期限 |\n|----------|----------|----------|----------|\n| pH、DO | 玻璃 | 现场测定 | - |\n| COD | 玻璃 | 加 H₂SO₄ 至 pH<2 | 5天 |\n| 氨氮 | 塑料 | 加 H₂SO₄ 至 pH<2 | 7天 |\n| 总磷 | 玻璃 | 加 H₂SO₄ 至 pH<2 | 24小时 |\n\n## 3 质量保证\n\n- 现场空白：每批次至少1个\n- 平行样：每批次10%\n- 加标回收率：75%-125%\n- 标准曲线相关系数 r≥0.999',
 '国家环境保护总局', '2002-12-01', '2003-01-01',
 ARRAY['监测规范', 'HJ91', '采样', '质量控制'], 4),

('MAN-EMERGENCY-01', '水环境突发污染事件应急处置手册', 'manual', '操作手册',
 '详细描述水环境突发污染事件的分级响应程序、处置措施和报告要求。',
 E'# 水环境突发污染事件应急处置手册\n\n## 1 事件分级\n\n| 级别 | 条件 | 响应 |\n|------|------|------|\n| Ⅰ级（特大） | 跨省级行政区域、直接经济损失>1亿元 | 国家级响应 |\n| Ⅱ级（重大） | 跨市级行政区域、直接经济损失2000万-1亿 | 省级响应 |\n| Ⅲ级（较大） | 跨县级行政区域、直接经济损失500万-2000万 | 市级响应 |\n| Ⅳ级（一般） | 单县区域内、直接经济损失<500万 | 县级响应 |\n\n## 2 应急响应程序\n\n### 2.1 接报与研判（0-30分钟）\n\n1. 接到水质异常报警或群众举报\n2. 值班人员立即核实信息来源和初步情况\n3. 通知监测部门启动应急监测\n4. 初步研判事件级别和影响范围\n\n### 2.2 先期处置（30分钟-2小时）\n\n1. 启动应急监测，加密监测频次至每2小时1次\n2. 排查污染来源，封堵可疑排污口\n3. 通知下游取水口做好防范\n4. 必要时启动备用水源\n\n### 2.3 应急处置（2-24小时）\n\n**生活污水类**\n- 协调污水处理厂加大处理力度\n- 检查管网是否有溢流\n- 投放应急除污剂\n\n**工业废水类**\n- 责令排污企业停产\n- 围堵已排出的污水\n- 取样送检，锁定特征污染物\n- 视情况启动司法程序\n\n**农业面源类**\n- 截断农田退水入河通道\n- 设置生态拦截沟渠\n- 加强水体自净监测\n\n### 2.4 事后恢复\n\n1. 持续监测至水质恢复Ⅲ类标准\n2. 编制事件调查报告\n3. 总结经验教训，完善应急预案\n\n## 3 报告要求\n\n- **初报**：事件发生后1小时内\n- **续报**：每4小时或情况变化时\n- **终报**：事件结束后5个工作日内\n\n## 4 物资储备清单\n\n| 类别 | 物资 | 最低储备量 |\n|------|------|-----------|\n| 监测设备 | 便携式多参数水质仪 | 3台 |\n| 监测设备 | 便携式重金属分析仪 | 2台 |\n| 处置材料 | 活性炭 | 5吨 |\n| 处置材料 | 围油栏 | 500米 |\n| 处置材料 | 中和剂（石灰） | 10吨 |\n| 防护装备 | 防化服 | 20套 |',
 '南昌市生态环境局', '2024-01-15', '2024-02-01',
 ARRAY['应急处置', '突发事件', '操作手册', '分级响应'], 5),

('MAN-MONITOR-SOP', '自动监测站运维标准操作规程', 'manual', '操作手册',
 '水质自动监测站日常巡检、设备维护、数据审核的标准化操作流程。',
 E'# 自动监测站运维标准操作规程\n\n## 1 日常巡检\n\n### 1.1 巡检频次\n\n- 正常运行：每周1次现场巡检\n- 汛期/异常期：每日巡检\n- 远程监控：每日2次数据查看\n\n### 1.2 巡检内容\n\n| 序号 | 检查项目 | 标准/要求 | 备注 |\n|------|----------|-----------|------|\n| 1 | 站房环境 | 温度18-28℃、湿度<80% | 记录温湿度 |\n| 2 | 供电系统 | UPS 正常、电池容量>80% | 检查告警灯 |\n| 3 | 采水系统 | 水泵正常、管路无堵塞 | 检查流量 |\n| 4 | 分析仪器 | 各项指标在质控范围内 | 查看质控结果 |\n| 5 | 数据传输 | 通讯正常、数据完整 | 检查缺数率 |\n| 6 | 试剂余量 | 各试剂≥30%容量 | 记录余量 |\n\n## 2 设备维护\n\n### 2.1 定期维护计划\n\n| 维护项目 | 频次 | 操作内容 |\n|----------|------|----------|\n| 清洗采样管路 | 每周 | 用纯水冲洗进样管路 |\n| 校准仪器 | 每月 | 用标准液校准各分析仪 |\n| 更换试剂 | 按需 | 试剂低于20%时更换 |\n| 更换泵管 | 每季度 | 蠕动泵泵管更换 |\n| 全面维护 | 每半年 | 全面检修所有设备 |\n\n## 3 数据审核\n\n### 3.1 异常数据判定\n\n- 数据突变：相邻两次数据变化超过正常范围50%\n- 数据恒值：连续6小时以上数据无变化\n- 数据缺失：连续2小时以上无数据上报\n- 超限数据：超出仪器量程范围\n\n### 3.2 审核流程\n\n1. 系统自动标记异常数据\n2. 运维人员24小时内复核\n3. 确认异常原因并处理\n4. 补充备注说明',
 '南昌市环境监测站', '2024-03-01', '2024-04-01',
 ARRAY['运维', '巡检', '自动监测站', 'SOP'], 6),

('POL-YANGTZE', '长江流域水环境保护规划要点', 'policy', '规划政策',
 '长江经济带水环境保护工作的主要目标、重点任务和保障措施摘要。',
 E'# 长江流域水环境保护规划要点\n\n## 1 总体目标\n\n到2025年：\n- 长江干流水质保持Ⅱ类\n- 主要支流水质达到Ⅲ类及以上比例≥95%\n- 劣Ⅴ类水体全面消除\n- 饮用水水源地水质达标率100%\n\n## 2 重点任务\n\n### 2.1 工业污染防治\n\n- 沿江1公里范围内禁止新建化工项目\n- 推进化工企业"关改搬转"\n- 工业园区全面建成污水集中处理设施\n\n### 2.2 城镇生活污染治理\n\n- 城市建成区基本消除黑臭水体\n- 城镇污水收集处理率≥95%\n- 污泥无害化处置率≥90%\n\n### 2.3 农业面源污染防治\n\n- 化肥农药使用量零增长\n- 畜禽粪污综合利用率≥80%\n- 规模化养殖场粪污处理设施配套率100%\n\n### 2.4 生态保护修复\n\n- 长江十年禁渔\n- 湿地保护率≥70%\n- 水土流失综合治理面积≥5万km²\n\n## 3 赣江流域要求（与南昌相关）\n\n- 赣江干流水质保持Ⅱ类\n- 鄱阳湖总磷浓度逐年下降\n- 南昌段重点排污口全面达标排放\n- 建设完善水质自动监测网络',
 '生态环境部', '2023-06-15', '2023-07-01',
 ARRAY['长江保护', '流域规划', '水环境', '赣江'], 7)

ON CONFLICT (doc_code) DO NOTHING;

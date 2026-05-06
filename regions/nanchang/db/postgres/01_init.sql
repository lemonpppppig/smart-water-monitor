-- 流域水环境AI智能监测与预警平台 - 数据库初始化脚本

-- 创建扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;  -- pgvector 用于案例向量搜索

-- 1. 监测站点表
CREATE TABLE IF NOT EXISTS stations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    station_code VARCHAR(64) UNIQUE NOT NULL,
    station_name VARCHAR(128) NOT NULL,
    station_type VARCHAR(32) NOT NULL,
    region VARCHAR(64),
    address VARCHAR(256),
    longitude DECIMAL(10, 7),
    latitude DECIMAL(10, 7),
    geom GEOMETRY(POINT, 4326),
    status VARCHAR(16) DEFAULT 'active',
    config JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE stations IS '监测站点信息表';
COMMENT ON COLUMN stations.station_code IS '站点编码';
COMMENT ON COLUMN stations.station_name IS '站点名称';
COMMENT ON COLUMN stations.station_type IS '站点类型: water_source, industrial_park, boundary_section, rural_water';
COMMENT ON COLUMN stations.region IS '所属区域';
COMMENT ON COLUMN stations.address IS '详细地址';
COMMENT ON COLUMN stations.longitude IS '经度';
COMMENT ON COLUMN stations.latitude IS '纬度';
COMMENT ON COLUMN stations.geom IS '空间坐标';
COMMENT ON COLUMN stations.status IS '状态: active, inactive, maintenance';
COMMENT ON COLUMN stations.config IS '站点配置(监测指标、阈值等)';

-- 2. 监测指标配置表
CREATE TABLE IF NOT EXISTS station_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    metric_code VARCHAR(32) NOT NULL,
    metric_name VARCHAR(64) NOT NULL,
    unit VARCHAR(16),
    upper_limit DECIMAL(10, 4),
    lower_limit DECIMAL(10, 4),
    standard_limit DECIMAL(10, 4),
    is_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(station_id, metric_code)
);

COMMENT ON TABLE station_metrics IS '站点监测指标配置表';
COMMENT ON COLUMN station_metrics.metric_code IS '指标编码: ph, do, nh3_n, codmn, turbidity, conductivity等';
COMMENT ON COLUMN station_metrics.metric_name IS '指标名称';
COMMENT ON COLUMN station_metrics.unit IS '单位';
COMMENT ON COLUMN station_metrics.upper_limit IS '上限阈值';
COMMENT ON COLUMN station_metrics.lower_limit IS '下限阈值';
COMMENT ON COLUMN station_metrics.standard_limit IS '标准限值';

-- 3. 预警事件表
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_code VARCHAR(64) UNIQUE NOT NULL,
    station_id UUID NOT NULL REFERENCES stations(id),
    alert_type VARCHAR(32) NOT NULL,
    alert_level VARCHAR(16) NOT NULL,
    title VARCHAR(256) NOT NULL,
    description TEXT,
    metrics JSONB,
    pollution_type VARCHAR(64),
    source_analysis JSONB,
    status VARCHAR(16) DEFAULT 'pending',
    confirmed_by VARCHAR(64),
    confirmed_at TIMESTAMP WITH TIME ZONE,
    resolved_by VARCHAR(64),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE alerts IS '预警事件表';
COMMENT ON COLUMN alerts.alert_code IS '预警编码';
COMMENT ON COLUMN alerts.alert_type IS '预警类型: threshold, anomaly, prediction';
COMMENT ON COLUMN alerts.alert_level IS '预警级别: low, medium, high, critical';
COMMENT ON COLUMN alerts.title IS '预警标题';
COMMENT ON COLUMN alerts.description IS '预警描述';
COMMENT ON COLUMN alerts.metrics IS '相关指标数据';
COMMENT ON COLUMN alerts.pollution_type IS '污染类型识别结果';
COMMENT ON COLUMN alerts.source_analysis IS '溯源分析结果';
COMMENT ON COLUMN alerts.status IS '状态: pending, confirmed, processing, resolved, ignored';
COMMENT ON COLUMN alerts.confirmed_by IS '确认人';
COMMENT ON COLUMN alerts.confirmed_at IS '确认时间';
COMMENT ON COLUMN alerts.resolved_by IS '处理人';
COMMENT ON COLUMN alerts.resolved_at IS '处理时间';
COMMENT ON COLUMN alerts.resolution_notes IS '处理备注';

-- 4. 预警规则表
CREATE TABLE IF NOT EXISTS alert_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_name VARCHAR(128) NOT NULL,
    rule_type VARCHAR(32) NOT NULL,
    station_ids UUID[],
    metric_codes VARCHAR(32)[],
    conditions JSONB NOT NULL,
    alert_level VARCHAR(16) NOT NULL,
    notification_channels VARCHAR(32)[] DEFAULT '{}',
    is_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE alert_rules IS '预警规则配置表';
COMMENT ON COLUMN alert_rules.rule_name IS '规则名称';
COMMENT ON COLUMN alert_rules.rule_type IS '规则类型: threshold, trend, composite';
COMMENT ON COLUMN alert_rules.station_ids IS '适用站点ID列表,空表示全部';
COMMENT ON COLUMN alert_rules.metric_codes IS '适用指标编码列表';
COMMENT ON COLUMN alert_rules.conditions IS '规则条件配置';
COMMENT ON COLUMN alert_rules.alert_level IS '触发预警级别';
COMMENT ON COLUMN alert_rules.notification_channels IS '通知渠道: app, sms, email, wechat';

-- 5. 用户表
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(64) UNIQUE NOT NULL,
    password_hash VARCHAR(256) NOT NULL,
    real_name VARCHAR(64),
    phone VARCHAR(16),
    email VARCHAR(128),
    role VARCHAR(32) DEFAULT 'operator',
    department VARCHAR(64),
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE users IS '系统用户表';
COMMENT ON COLUMN users.role IS '角色: admin, manager, operator, viewer';
COMMENT ON COLUMN users.department IS '部门';

-- 6. 操作日志表
CREATE TABLE IF NOT EXISTS operation_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(64) NOT NULL,
    resource_type VARCHAR(64),
    resource_id VARCHAR(64),
    details JSONB,
    ip_address VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE operation_logs IS '操作日志表';
COMMENT ON COLUMN operation_logs.action IS '操作类型';
COMMENT ON COLUMN operation_logs.resource_type IS '资源类型';
COMMENT ON COLUMN operation_logs.resource_id IS '资源ID';
COMMENT ON COLUMN operation_logs.details IS '操作详情';
COMMENT ON COLUMN operation_logs.ip_address IS 'IP地址';

-- 7. 报告表
CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_code VARCHAR(64) UNIQUE NOT NULL,
    report_type VARCHAR(32) NOT NULL,
    title VARCHAR(256) NOT NULL,
    alert_id UUID REFERENCES alerts(id),
    station_ids UUID[],
    content JSONB,
    file_url VARCHAR(512),
    file_size INTEGER,
    generated_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE reports IS '分析报告表';
COMMENT ON COLUMN reports.report_code IS '报告编码';
COMMENT ON COLUMN reports.report_type IS '报告类型: traceability, decision, daily, weekly, monthly';
COMMENT ON COLUMN reports.title IS '报告标题';
COMMENT ON COLUMN reports.alert_id IS '关联预警ID';
COMMENT ON COLUMN reports.station_ids IS '涉及站点';
COMMENT ON COLUMN reports.content IS '报告内容';
COMMENT ON COLUMN reports.file_url IS '文件存储地址';
COMMENT ON COLUMN reports.file_size IS '文件大小(字节)';
COMMENT ON COLUMN reports.generated_by IS '生成人';

-- 8. Agent状态表
CREATE TABLE IF NOT EXISTS agent_states (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_name VARCHAR(64) NOT NULL,
    agent_type VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL,
    current_task JSONB,
    last_heartbeat TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metrics JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agent_name)
);

COMMENT ON TABLE agent_states IS '智能体状态表';
COMMENT ON COLUMN agent_states.agent_name IS 'Agent名称';
COMMENT ON COLUMN agent_states.agent_type IS 'Agent类型: coordinator, monitor, analysis, decision';
COMMENT ON COLUMN agent_states.status IS '状态: online, offline, busy, error';
COMMENT ON COLUMN agent_states.current_task IS '当前执行任务';
COMMENT ON COLUMN agent_states.metrics IS '性能指标';

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_stations_type ON stations(station_type);
CREATE INDEX IF NOT EXISTS idx_stations_region ON stations(region);
CREATE INDEX IF NOT EXISTS idx_stations_status ON stations(status);
CREATE INDEX IF NOT EXISTS idx_stations_geom ON stations USING GIST(geom);

CREATE INDEX IF NOT EXISTS idx_alerts_station ON alerts(station_id);
CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_alerts_level ON alerts(alert_level);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);

CREATE INDEX IF NOT EXISTS idx_operation_logs_user ON operation_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_operation_logs_action ON operation_logs(action);
CREATE INDEX IF NOT EXISTS idx_operation_logs_created ON operation_logs(created_at);

-- 创建更新时间触发器
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_stations_updated_at BEFORE UPDATE ON stations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_station_metrics_updated_at BEFORE UPDATE ON station_metrics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_alerts_updated_at BEFORE UPDATE ON alerts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_alert_rules_updated_at BEFORE UPDATE ON alert_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agent_states_updated_at BEFORE UPDATE ON agent_states
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 插入默认用户 (密码: admin123)
INSERT INTO users (username, password_hash, real_name, role) VALUES 
    ('admin', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.VTtYA.qGZvKG6G', '系统管理员', 'admin')
ON CONFLICT (username) DO NOTHING;

-- 插入赣州流域监测站点数据（坐标位于实际河流上）
INSERT INTO stations (station_code, station_name, station_type, region, address, longitude, latitude, geom, status, config) VALUES
    -- 水源地监测站（坐标基于行政区中心就近匹配可渲染河流点）
    ('WS001', '赣江水源地站', 'water_source', '章贡区', '赣州市章贡区赣江段', 114.9501322, 25.8638905, ST_SetSRID(ST_MakePoint(114.9501322, 25.8638905), 4326), 'active', '{"sensors": ["ph", "do", "nh3_n", "codmn", "turbidity", "conductivity", "chlorophyll", "blue_green_algae"]}'),
    ('WS002', '章江水源地站', 'water_source', '章贡区', '赣州市章贡区章江段', 114.9318298, 25.8440238, ST_SetSRID(ST_MakePoint(114.9318298, 25.8440238), 4326), 'active', '{"sensors": ["ph", "do", "nh3_n", "codmn", "turbidity", "conductivity", "chlorophyll", "blue_green_algae"]}'),
    ('WS003', '贡水水源地站', 'water_source', '赣县区', '赣州市赣县区贡水段', 115.0203385, 25.8550753, ST_SetSRID(ST_MakePoint(115.0203385, 25.8550753), 4326), 'active', '{"sensors": ["ph", "do", "nh3_n", "codmn", "turbidity", "conductivity", "chlorophyll", "blue_green_algae"]}'),
    -- 工业园区监测站
    ('IP001', '赣州经开区工业监测站', 'industrial_park', '赣县区', '赣州经济技术开发区贡水沿线', 114.984947, 25.8471573, ST_SetSRID(ST_MakePoint(114.984947, 25.8471573), 4326), 'active', '{"sensors": ["ph", "do", "nh3_n", "codmn", "turbidity", "conductivity", "codcr", "heavy_metals"]}'),
    ('IP002', '南康工业区监测站', 'industrial_park', '南康区', '赣州市南康区章江工业段', 114.7588168, 25.6607702, ST_SetSRID(ST_MakePoint(114.7588168, 25.6607702), 4326), 'active', '{"sensors": ["ph", "do", "nh3_n", "codmn", "turbidity", "conductivity", "codcr", "heavy_metals"]}'),
    ('IP003', '桃江工业园监测站', 'industrial_park', '信丰县', '赣州市信丰县桃江沿线', 114.9317872, 25.390462, ST_SetSRID(ST_MakePoint(114.9317872, 25.390462), 4326), 'active', '{"sensors": ["ph", "do", "nh3_n", "codmn", "turbidity", "conductivity", "codcr", "heavy_metals"]}'),
    -- 跨界断面监测站
    ('BS001', '赣江出境断面站', 'boundary_section', '章贡区', '赣州市赣江干流出境断面', 114.9341583, 26.302264, ST_SetSRID(ST_MakePoint(114.9341583, 26.302264), 4326), 'active', '{"sensors": ["ph", "do", "nh3_n", "codmn", "turbidity", "conductivity", "total_n", "total_p"]}'),
    ('BS002', '贡水于都-赣县断面站', 'boundary_section', '赣县区', '贡水于都县与赣县区交界', 115.2505116, 25.9093852, ST_SetSRID(ST_MakePoint(115.2505116, 25.9093852), 4326), 'active', '{"sensors": ["ph", "do", "nh3_n", "codmn", "turbidity", "conductivity", "total_n", "total_p"]}'),
    ('BS003', '上犹江入章江断面站', 'boundary_section', '南康区', '上犹江汇入章江交汇处', 114.5496583, 25.7797642, ST_SetSRID(ST_MakePoint(114.5496583, 25.7797642), 4326), 'active', '{"sensors": ["ph", "do", "nh3_n", "codmn", "turbidity", "conductivity", "total_n", "total_p"]}'),
    ('BS004', '梅江汇入贡水断面站', 'boundary_section', '赣县区', '梅江与贡水交汇断面', 115.7222939, 26.1954068, ST_SetSRID(ST_MakePoint(115.7222939, 26.1954068), 4326), 'active', '{"sensors": ["ph", "do", "nh3_n", "codmn", "turbidity", "conductivity", "total_n", "total_p"]}'),
    -- 农村水体监测站
    ('RW001', '崇义江农村水体站', 'rural_water', '崇义县', '赣州市崇义县崇义江段', 114.3056953, 25.7011119, ST_SetSRID(ST_MakePoint(114.3056953, 25.7011119), 4326), 'active', '{"sensors": ["ph", "do", "nh3_n", "codmn", "turbidity", "conductivity", "transparency", "orp"]}'),
    ('RW002', '章江农村水体站', 'rural_water', '大余县', '赣州市大余县章江段', 114.3579876, 25.3960472, ST_SetSRID(ST_MakePoint(114.3579876, 25.3960472), 4326), 'active', '{"sensors": ["ph", "do", "nh3_n", "codmn", "turbidity", "conductivity", "transparency", "orp"]}'),
    ('RW003', '平江农村水体站', 'rural_water', '兴国县', '赣州市兴国县平江段', 115.3540306, 26.2968891, ST_SetSRID(ST_MakePoint(115.3540306, 26.2968891), 4326), 'active', '{"sensors": ["ph", "do", "nh3_n", "codmn", "turbidity", "conductivity", "transparency", "orp"]}'),
    ('RW004', '琴江农村水体站', 'rural_water', '石城县', '赣州市石城县琴江段', 116.3456763, 26.3359702, ST_SetSRID(ST_MakePoint(116.3456763, 26.3359702), 4326), 'active', '{"sensors": ["ph", "do", "nh3_n", "codmn", "turbidity", "conductivity", "transparency", "orp"]}'),
    ('RW005', '贡水乡村监测站', 'rural_water', '于都县', '赣州市于都县贡水段', 115.4197515, 25.9564292, ST_SetSRID(ST_MakePoint(115.4197515, 25.9564292), 4326), 'maintenance', '{"sensors": ["ph", "do", "nh3_n", "codmn", "turbidity", "conductivity", "transparency", "orp"]}')
ON CONFLICT (station_code) DO NOTHING;

-- ==============================================
-- 知识库相关表
-- ==============================================

-- 9. 历史案例表（用于案例推理 CBR）
CREATE TABLE IF NOT EXISTS pollution_cases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_code VARCHAR(64) UNIQUE NOT NULL,
    pollution_type VARCHAR(64) NOT NULL,
    station_id UUID REFERENCES stations(id),
    occurrence_date DATE NOT NULL,
    description TEXT,
    features JSONB NOT NULL,  -- 污染特征数据
    feature_vector vector(16),  -- 特征向量（用于相似度搜索）
    cause TEXT,  -- 污染原因
    source TEXT,  -- 污染源
    actions_taken TEXT[],  -- 采取的措施
    outcome TEXT,  -- 处置结果
    recovery_days INTEGER,  -- 恢复天数
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE pollution_cases IS '历史污染案例库';
COMMENT ON COLUMN pollution_cases.case_code IS '案例编码';
COMMENT ON COLUMN pollution_cases.pollution_type IS '污染类型';
COMMENT ON COLUMN pollution_cases.features IS '污染特征数据 JSON';
COMMENT ON COLUMN pollution_cases.feature_vector IS '特征向量（pgvector）';
COMMENT ON COLUMN pollution_cases.cause IS '污染原因';
COMMENT ON COLUMN pollution_cases.source IS '污染源';
COMMENT ON COLUMN pollution_cases.actions_taken IS '采取的措施';
COMMENT ON COLUMN pollution_cases.outcome IS '处置结果';
COMMENT ON COLUMN pollution_cases.recovery_days IS '恢复天数';

-- 创建案例向量索引（用于相似度搜索）
CREATE INDEX IF NOT EXISTS idx_pollution_cases_vector ON pollution_cases USING ivfflat (feature_vector vector_cosine_ops) WITH (lists = 10);
CREATE INDEX IF NOT EXISTS idx_pollution_cases_type ON pollution_cases(pollution_type);

CREATE TRIGGER update_pollution_cases_updated_at BEFORE UPDATE ON pollution_cases
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 插入示例案例数据
INSERT INTO pollution_cases (case_code, pollution_type, occurrence_date, description, features, feature_vector, cause, source, actions_taken, outcome, recovery_days) VALUES
    ('CASE-2024-001', 'domestic_sewage', '2024-03-15', '清河中游氨氮异常', 
     '{"nh3_n": 5.2, "do": 3.1, "codmn": 15.0, "ph": 7.2}',
     '[5.2, 3.1, 15.0, 7.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]',
     '上游污水处理厂故障', '清河上游工业园区',
     ARRAY['排查上游排污口', '加强污水处理厂监管', '加密监测频次'],
     '确认为生活污水排放，已责令整改', 3),
    ('CASE-2024-002', 'industrial_wastewater', '2024-05-20', '工业园区COD超标', 
     '{"codcr": 150.0, "codmn": 20.0, "ph": 4.5, "conductivity": 3000.0}',
     '[0, 0, 20.0, 4.5, 150.0, 3000.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]',
     '化工企业偷排', '苏州工业园区某化工厂',
     ARRAY['排查工业园区企业', '检查企业污水处理设施', '取样送检重金属指标', '责令超标企业停产整改'],
     '确认为工业废水偷排，企业已停产', 7),
    ('CASE-2024-003', 'algae_bloom', '2024-07-10', '太湖东岸藻类爆发', 
     '{"chlorophyll": 50.0, "ph": 9.0, "do": 12.0}',
     '[0, 12.0, 0, 9.0, 0, 0, 50.0, 0, 0, 0, 0, 0, 0, 0, 0, 0]',
     '高温+营养盐富集', '太湖东岸',
     ARRAY['启动蓝藻打捞', '投放除藻剂', '增加水体流动性', '加密藻类监测'],
     '藻类爆发预警，已启动应急预案', 5),
    ('CASE-2024-004', 'agricultural_runoff', '2024-08-25', '农田退水污染', 
     '{"total_n": 8.5, "total_p": 0.8, "nh3_n": 2.5}',
     '[2.5, 0, 0, 0, 0, 0, 0, 0, 8.5, 0.8, 0, 0, 0, 0, 0, 0]',
     '雨季农田退水', '扬州市郊区农田',
     ARRAY['排查农田退水', '检查畜禽养殖场', '控制化肥农药使用', '建设生态沟渠'],
     '农业面源污染已控制', 10),
    ('CASE-2024-005', 'black_odor', '2024-09-08', '城市河道黑臭', 
     '{"do": 1.5, "transparency": 15.0, "orp": -250.0}',
     '[0, 1.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 15.0, -250.0, 0, 0, 0]',
     '污水直排+底泥沉积', '南京市某城市河道',
     ARRAY['排查污染源', '清淤疏浚', '生态补水', '曝气增氧'],
     '黑臭水体已治理', 30)
ON CONFLICT (case_code) DO NOTHING;

-- ==============================================
-- 指标阈值配置（标准阈值）
-- ==============================================

-- 为所有站点配置监测指标阈值
DO $$
DECLARE
    v_station RECORD;
BEGIN
    -- 水源地监测站阈值（最严格）
    FOR v_station IN SELECT id FROM stations WHERE station_type = 'water_source' LOOP
        INSERT INTO station_metrics (station_id, metric_code, metric_name, unit, lower_limit, upper_limit, standard_limit) VALUES
            (v_station.id, 'ph', 'pH值', '', 6.0, 9.0, 7.5),
            (v_station.id, 'do', '溶解氧', 'mg/L', 5.0, 20.0, 6.0),
            (v_station.id, 'nh3_n', '氨氮', 'mg/L', 0, 1.0, 0.5),
            (v_station.id, 'codmn', '高锰酸盐指数', 'mg/L', 0, 6.0, 4.0),
            (v_station.id, 'turbidity', '浊度', 'NTU', 0, 10.0, 5.0),
            (v_station.id, 'conductivity', '电导率', 'μS/cm', 0, 1500.0, 1000.0)
        ON CONFLICT (station_id, metric_code) DO NOTHING;
    END LOOP;
    
    -- 工业园区监测站阈值
    FOR v_station IN SELECT id FROM stations WHERE station_type = 'industrial_park' LOOP
        INSERT INTO station_metrics (station_id, metric_code, metric_name, unit, lower_limit, upper_limit, standard_limit) VALUES
            (v_station.id, 'ph', 'pH值', '', 6.0, 9.0, 7.0),
            (v_station.id, 'do', '溶解氧', 'mg/L', 2.0, 20.0, 4.0),
            (v_station.id, 'nh3_n', '氨氮', 'mg/L', 0, 2.0, 1.5),
            (v_station.id, 'codmn', '高锰酸盐指数', 'mg/L', 0, 15.0, 10.0),
            (v_station.id, 'codcr', '化学需氧量', 'mg/L', 0, 100.0, 60.0),
            (v_station.id, 'conductivity', '电导率', 'μS/cm', 0, 2000.0, 1500.0)
        ON CONFLICT (station_id, metric_code) DO NOTHING;
    END LOOP;
    
    -- 跨界断面监测站阈值
    FOR v_station IN SELECT id FROM stations WHERE station_type = 'boundary_section' LOOP
        INSERT INTO station_metrics (station_id, metric_code, metric_name, unit, lower_limit, upper_limit, standard_limit) VALUES
            (v_station.id, 'ph', 'pH值', '', 6.0, 9.0, 7.5),
            (v_station.id, 'do', '溶解氧', 'mg/L', 2.0, 20.0, 5.0),
            (v_station.id, 'nh3_n', '氨氮', 'mg/L', 0, 2.0, 1.0),
            (v_station.id, 'codmn', '高锰酸盐指数', 'mg/L', 0, 15.0, 8.0),
            (v_station.id, 'total_n', '总氮', 'mg/L', 0, 2.0, 1.5),
            (v_station.id, 'total_p', '总磷', 'mg/L', 0, 0.4, 0.2)
        ON CONFLICT (station_id, metric_code) DO NOTHING;
    END LOOP;
    
    -- 农村水体监测站阈值（较宽松）
    FOR v_station IN SELECT id FROM stations WHERE station_type = 'rural_water' LOOP
        INSERT INTO station_metrics (station_id, metric_code, metric_name, unit, lower_limit, upper_limit, standard_limit) VALUES
            (v_station.id, 'ph', 'pH值', '', 6.0, 9.0, 7.0),
            (v_station.id, 'do', '溶解氧', 'mg/L', 2.0, 20.0, 3.0),
            (v_station.id, 'nh3_n', '氨氮', 'mg/L', 0, 2.0, 1.5),
            (v_station.id, 'codmn', '高锰酸盐指数', 'mg/L', 0, 15.0, 10.0),
            (v_station.id, 'transparency', '透明度', 'cm', 25.0, 200.0, 50.0),
            (v_station.id, 'orp', '氧化还原电位', 'mV', -200.0, 500.0, 100.0)
        ON CONFLICT (station_id, metric_code) DO NOTHING;
    END LOOP;
END $$;

-- 通用阈值配置表（不依赖站点）
CREATE TABLE IF NOT EXISTS metric_thresholds (
    id SERIAL PRIMARY KEY,
    metric_code VARCHAR(32) UNIQUE NOT NULL,
    metric_name VARCHAR(64) NOT NULL,
    unit VARCHAR(16),
    lower_limit DECIMAL(10, 4),
    upper_limit DECIMAL(10, 4),
    standard_limit DECIMAL(10, 4),
    description TEXT
);

COMMENT ON TABLE metric_thresholds IS '通用指标阈值配置（默认阈值）';

-- 插入通用阈值
INSERT INTO metric_thresholds (metric_code, metric_name, unit, lower_limit, upper_limit, standard_limit, description) VALUES
    ('ph', 'pH值', '', 6.0, 9.0, 7.5, '地表水环境质量标准'),
    ('do', '溶解氧', 'mg/L', 2.0, 20.0, 5.0, 'III类水标准'),
    ('nh3_n', '氨氮', 'mg/L', 0, 2.0, 1.0, 'III类水标准'),
    ('codmn', '高锰酸盐指数', 'mg/L', 0, 15.0, 6.0, 'III类水标准'),
    ('codcr', '化学需氧量', 'mg/L', 0, 100.0, 40.0, 'III类水标准'),
    ('total_n', '总氮', 'mg/L', 0, 2.0, 1.0, 'III类水标准'),
    ('total_p', '总磷', 'mg/L', 0, 0.4, 0.2, 'III类水标准'),
    ('turbidity', '浊度', 'NTU', 0, 50.0, 20.0, '一般水体标准'),
    ('conductivity', '电导率', 'μS/cm', 0, 2000.0, 1000.0, '一般水体标准'),
    ('transparency', '透明度', 'cm', 25.0, 200.0, 50.0, '黑臭水体评价标准'),
    ('orp', '氧化还原电位', 'mV', -200.0, 500.0, 100.0, '黑臭水体评价标准'),
    ('chlorophyll', '叶绿素a', 'μg/L', 0, 50.0, 25.0, '藻类爆发评价'),
    ('blue_green_algae', '蓝绿藻', 'cells/mL', 0, 100000, 50000, '蓝藻预警阈值')
ON CONFLICT (metric_code) DO NOTHING;

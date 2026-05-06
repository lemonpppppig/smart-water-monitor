-- ============================================================
-- 南昌市历史案例数据初始化脚本
-- 用于案例推理(CBR)的知识库
-- 水系：赣江 + 抚河（鄱阳湖 / 长江流域）
-- ============================================================

-- ==============================================
-- 1. 创建案例表（如不存在）
-- ==============================================

CREATE TABLE IF NOT EXISTS pollution_cases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_code VARCHAR(64) UNIQUE NOT NULL,
    pollution_type VARCHAR(64) NOT NULL,
    station_id UUID REFERENCES stations(id),
    occurrence_date DATE NOT NULL,
    description TEXT,
    features JSONB NOT NULL,
    feature_vector TEXT,
    cause TEXT,
    source TEXT,
    actions_taken TEXT[],
    outcome TEXT,
    recovery_days INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE pollution_cases IS '历史污染案例库';

CREATE INDEX IF NOT EXISTS idx_pollution_cases_type ON pollution_cases(pollution_type);

-- ==============================================
-- 2. 创建阈值配置表（如不存在）
-- ==============================================

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

COMMENT ON TABLE metric_thresholds IS '通用指标阈值配置表';

-- ==============================================
-- 3. 插入通用阈值配置
-- ==============================================

INSERT INTO metric_thresholds (metric_code, metric_name, unit, lower_limit, upper_limit, standard_limit, description) VALUES
    ('ph', 'pH值', '-', 6.5, 8.5, 7.5, '地表水III类标准'),
    ('do', '溶解氧', 'mg/L', 5.0, NULL, 5.0, '≥5mg/L为III类'),
    ('nh3_n', '氨氮', 'mg/L', NULL, 1.0, 1.0, '≤1.0mg/L为III类'),
    ('codmn', '高锰酸盐指数', 'mg/L', NULL, 6.0, 6.0, '≤6mg/L为III类'),
    ('codcr', '化学需氧量', 'mg/L', NULL, 20.0, 20.0, '≤20mg/L为III类'),
    ('total_n', '总氮', 'mg/L', NULL, 1.0, 1.0, '≤1.0mg/L为III类'),
    ('total_p', '总磷', 'mg/L', NULL, 0.2, 0.2, '≤0.2mg/L为III类'),
    ('turbidity', '浊度', 'NTU', NULL, 10.0, 10.0, '一般标准'),
    ('conductivity', '电导率', 'μS/cm', NULL, 1500.0, 1000.0, '一般参考值'),
    ('chlorophyll', '叶绿素a', 'μg/L', NULL, 30.0, 20.0, '富营养化指标'),
    ('transparency', '透明度', 'cm', 25.0, NULL, 50.0, '≥25cm为非黑臭'),
    ('orp', '氧化还原电位', 'mV', -200.0, NULL, 50.0, '≥-200mV为非黑臭')
ON CONFLICT (metric_code) DO NOTHING;

-- ==============================================
-- 4. 插入南昌地区历史案例数据
-- ==============================================

INSERT INTO pollution_cases (case_code, pollution_type, occurrence_date, description, features, feature_vector, cause, source, actions_taken, outcome, recovery_days) VALUES
    -- 生活污水类
    ('NC-2024-001', 'domestic_sewage', '2024-03-15', '玉带河东湖段氨氮异常升高',
     '{"nh3_n": 4.8, "do": 3.2, "codmn": 12.5, "ph": 7.1}',
     '[4.8, 3.2, 12.5, 7.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]',
     '东湖老城合流制溢流', '东湖区老纺织厂区周边合流制',
     ARRAY['排查污水处理厂运行状态', '启动应急调蓄池', '加密监测频次至每2小时', '通知下游赣江干流预警'],
     '污水处理厂紧急扩容，48小时内恢复正常', 2),

    ('NC-2024-002', 'domestic_sewage', '2024-06-20', '象湖水系青云谱段氨氮超标',
     '{"nh3_n": 3.5, "do": 4.1, "codmn": 9.8, "ph": 7.3}',
     '[3.5, 4.1, 9.8, 7.3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]',
     '暴雨导致污水管网溢流', '青云谱区象湖污水处理厂',
     ARRAY['排查溢流点位', '启动移动污水处理设备', '加强管网巡查'],
     '修复溢流点，3天内水质恢复', 3),

    ('NC-2025-001', 'domestic_sewage', '2025-01-10', '红谷滩城市径流面源污染',
     '{"nh3_n": 5.2, "do": 2.8, "codmn": 14.0, "ph": 6.9}',
     '[5.2, 2.8, 14.0, 6.9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]',
     '春节期间污水量激增，处理能力不足', '红谷滩 CBD 周边',
     ARRAY['启动备用处理线', '临时增设曝气设备', '协调周边支援'],
     '5天内完成应急处置', 5),

    -- 工业废水类
    ('NC-2024-003', 'industrial_wastewater', '2024-05-08', '南昌经开区赣江西支 COD 异常',
     '{"codcr": 180.0, "codmn": 25.0, "ph": 5.2, "conductivity": 2800.0}',
     '[0, 0, 25.0, 5.2, 180.0, 2800.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]',
     '某汽车零部件厂偷排废水', '南昌经开区汽车工业园（江铃）',
     ARRAY['紧急排查园区企业', '对可疑企业取样检测', '责令违规企业停产', '启动应急监测'],
     '查明污染源并责令整改，7天恢复', 7),

    ('NC-2024-004', 'industrial_wastewater', '2024-08-15', '进贤抚河段化工废水预警',
     '{"codcr": 120.0, "codmn": 18.0, "ph": 4.8, "conductivity": 3200.0}',
     '[0, 0, 18.0, 4.8, 120.0, 3200.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]',
     '医疗器械产业园排放异常', '进贤医疗器械产业园',
     ARRAY['立即关停排污口', '检查尾水处理设施', '启动应急处理', '通知下游鄱阳湖流域'],
     '设施修复后恢复正常，10天完成', 10),

    ('NC-2025-002', 'industrial_wastewater', '2025-02-20', '小蓝经开区玉带河化工废水污染',
     '{"codcr": 150.0, "codmn": 22.0, "ph": 3.5, "conductivity": 4000.0}',
     '[0, 0, 22.0, 3.5, 150.0, 4000.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]',
     '化工企业设备故障导致泄漏', '小蓝经开区生物医药产业园',
     ARRAY['紧急封堵泄漏点', '投放中和剂', '启动下游预警', '环保执法介入'],
     '3天内控制污染扩散，企业停产整顿', 8),

    -- 农业面源类
    ('NC-2024-005', 'agricultural_runoff', '2024-07-25', '安义潦河上游总氮总磷超标',
     '{"total_n": 6.5, "total_p": 0.65, "nh3_n": 1.8}',
     '[1.8, 0, 0, 0, 0, 0, 0, 0, 6.5, 0.65, 0, 0, 0, 0, 0, 0]',
     '暴雨冲刷农田退水入河', '安义县水稻种植区',
     ARRAY['排查农田退水口', '建设生态拦截沟', '指导农户科学施肥', '加强雨季监测'],
     '雨季过后逐步恢复，15天达标', 15),

    ('NC-2024-006', 'agricultural_runoff', '2024-09-10', '南昌县东新水稻基地氮磷污染',
     '{"total_n": 8.2, "total_p": 0.85, "nh3_n": 2.2}',
     '[2.2, 0, 0, 0, 0, 0, 0, 0, 8.2, 0.85, 0, 0, 0, 0, 0, 0]',
     '大闸蟹养殖场尾水直排', '进贤军山湖大闸蟹养殖基地',
     ARRAY['责令养殖场停止直排', '清理河道淤积物', '建设养殖尾水处理设施'],
     '养殖场整改完成，12天恢复', 12),

    -- 藻类爆发类
    ('NC-2024-007', 'algae_bloom', '2024-08-05', '鄱阳湖南岸蓝藻爆发预警',
     '{"chlorophyll": 45.0, "ph": 9.2, "do": 14.0}',
     '[0, 14.0, 0, 9.2, 0, 0, 45.0, 0, 0, 0, 0, 0, 0, 0, 0, 0]',
     '高温+赣江营养盐输入', '鄱阳湖南岸水产基地附近水域',
     ARRAY['启动藻类打捞', '投放除藻微生物', '加强湖区调水增加流动', '发布水源预警'],
     '持续打捞7天，藻类密度下降', 7),

    ('NC-2025-003', 'algae_bloom', '2025-03-01', '艾溪湖电子信息园周边藻类异常',
     '{"chlorophyll": 38.0, "ph": 8.8, "do": 12.5}',
     '[0, 12.5, 0, 8.8, 0, 0, 38.0, 0, 0, 0, 0, 0, 0, 0, 0, 0]',
     '春季水温回升+上游营养盐输入', '高新区艾溪湖电子信息园周边湖面',
     ARRAY['加密藻类监测', '协调上游控制营养盐', '准备打捞设备待命'],
     '气温下降后自然消退，5天恢复', 5),

    -- 黑臭水体类
    ('NC-2024-008', 'black_odor', '2024-04-18', '青山湖区玉带河段黑臭',
     '{"do": 1.2, "transparency": 12.0, "orp": -280.0}',
     '[0, 1.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12.0, -280.0, 0, 0, 0]',
     '雨污混流+底泥污染', '青山湖区城区内河',
     ARRAY['排查雨污混接点', '底泥清淤', '曝气增氧', '生态补水'],
     '综合治理30天后消除黑臭', 30),

    ('NC-2024-009', 'black_odor', '2024-10-05', '象湖水系青云谱段黑臭水体',
     '{"do": 0.8, "transparency": 8.0, "orp": -320.0}',
     '[0, 0.8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8.0, -320.0, 0, 0, 0]',
     '生活污水直排+垃圾堆积', '青云谱区城乡结合部',
     ARRAY['清理河道垃圾', '封堵直排口', '安装曝气设备', '定期补水'],
     '45天综合整治后达标', 45)
ON CONFLICT (case_code) DO UPDATE SET
    description = EXCLUDED.description,
    features = EXCLUDED.features,
    feature_vector = EXCLUDED.feature_vector,
    cause = EXCLUDED.cause,
    source = EXCLUDED.source,
    actions_taken = EXCLUDED.actions_taken,
    outcome = EXCLUDED.outcome,
    recovery_days = EXCLUDED.recovery_days;

-- ==============================================
-- 5. 创建案例-站点关联视图
-- ==============================================

CREATE OR REPLACE VIEW case_station_view AS
SELECT
    pc.case_code,
    pc.pollution_type,
    pc.description,
    pc.cause,
    pc.source,
    pc.actions_taken,
    pc.outcome,
    pc.recovery_days,
    pc.occurrence_date,
    s.station_code,
    s.station_name,
    s.region
FROM pollution_cases pc
LEFT JOIN stations s ON pc.station_id = s.id;

COMMENT ON VIEW case_station_view IS '案例与站点关联视图';

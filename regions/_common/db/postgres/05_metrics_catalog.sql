-- ============================================================
-- 指标字典种子：对齐 TDengine water_quality 超级表 20 列
-- 用于前端指标选择器、阈值编辑器、指标百科
-- ============================================================

INSERT INTO metrics_catalog (metric_code, metric_name, category, unit, description, upper_limit, lower_limit, standard_limit, standard_code, display_order) VALUES
('ph',                'pH值',           '基础',  '',       'pH值，反映水体酸碱度，Ⅲ类水标准范围 6.0~9.0',                                9.0,   6.0,   9.0,   'GB3838-2002-III', 1),
('do',                '溶解氧',         '基础',  'mg/L',   'DO，水中溶解的氧气含量，Ⅲ类水≥5mg/L',                                       14.0,  0.0,   5.0,   'GB3838-2002-III', 2),
('codmn',             '高锰酸盐指数',   '有机',  'mg/L',   'CODMn，反映水中有机物污染程度，Ⅲ类水≤6mg/L',                                 30.0,  0.0,   6.0,   'GB3838-2002-III', 3),
('codcr',             '化学需氧量',     '有机',  'mg/L',   'CODCr，反映水中还原性物质总量，Ⅲ类水≤20mg/L',                                150.0, 0.0,   20.0,  'GB3838-2002-III', 4),
('nh3_n',             '氨氮',           '营养盐','mg/L',   'NH3-N，表征氮污染，Ⅲ类水≤1.0mg/L',                                           10.0,  0.0,   1.0,   'GB3838-2002-III', 5),
('total_n',           '总氮',           '营养盐','mg/L',   'TN，所有含氮化合物之和，Ⅲ类水≤1.0mg/L',                                      20.0,  0.0,   1.0,   'GB3838-2002-III', 6),
('total_p',           '总磷',           '营养盐','mg/L',   'TP，反映富营养化风险，Ⅲ类水（湖库）≤0.05mg/L',                                2.0,   0.0,   0.05,  'GB3838-2002-III', 7),
('turbidity',         '浊度',           '物理',  'NTU',    '反映水体透明程度，饮用水源≤3 NTU',                                           1000.0,0.0,   3.0,   'GB5749-2022',     8),
('conductivity',      '电导率',         '物理',  'μS/cm',  '反映水中溶解性盐类含量',                                                     2000.0,0.0,   1000.0,NULL,              9),
('water_temperature', '水温',           '物理',  '℃',     '水体温度，影响生物活性与溶解氧',                                             40.0,  0.0,   NULL,  NULL,              10),
('chlorophyll',       '叶绿素a',        '藻类',  'μg/L',   '反映藻类密度，>10μg/L 需关注藻华',                                           200.0, 0.0,   10.0,  NULL,              11),
('blue_green_algae',  '蓝绿藻密度',     '藻类',  'cells/mL','蓝藻细胞密度，>10000 cells/mL 触发预警',                                    1.0e8, 0.0,   10000.0,NULL,             12),
('transparency',      '透明度',         '物理',  'cm',     '塞氏盘深度，反映水体清澈度',                                                 500.0, 0.0,   NULL,  NULL,              13),
('orp',               '氧化还原电位',   '化学',  'mV',     'ORP，反映水体氧化还原状态',                                                  800.0, -500.0,NULL,  NULL,              14),
('tds',               '溶解性总固体',   '物理',  'mg/L',   'TDS，水中溶解物质总量',                                                      2000.0,0.0,   1000.0,NULL,              15),
('sal',               '盐度',           '物理',  'ppt',    '水中盐类含量',                                                               40.0,  0.0,   NULL,  NULL,              16),
('flow_speed',        '流速',           '水文',  'm/s',    '水流速度',                                                                   10.0,  0.0,   NULL,  NULL,              17),
('flow_rate',         '流量',           '水文',  'm³/s',   '断面瞬时流量',                                                               10000.0,0.0,  NULL,  NULL,              18),
('water_level',       '水位',           '水文',  'm',      '水位高程',                                                                   200.0, 0.0,   NULL,  NULL,              19)
ON CONFLICT (metric_code) DO UPDATE SET
    metric_name   = EXCLUDED.metric_name,
    unit          = EXCLUDED.unit,
    description   = EXCLUDED.description,
    upper_limit   = EXCLUDED.upper_limit,
    lower_limit   = EXCLUDED.lower_limit,
    standard_limit= EXCLUDED.standard_limit,
    display_order = EXCLUDED.display_order,
    updated_at    = CURRENT_TIMESTAMP;

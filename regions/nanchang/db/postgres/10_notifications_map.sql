-- ============================================================
-- 系统通知 + 地图要素种子（南昌）
-- ============================================================

-- ==============================================
-- 1. notifications：系统/预警/报告通知
-- ==============================================
INSERT INTO notifications (title, content, notification_type, level, source, source_id, recipient, is_read, created_at) VALUES
('新预警：南昌经开区工业站 NH3-N 超标', '过去 30 分钟氨氮持续 >1.8mg/L，疑似工业废水偷排。点击查看溯源分析',
    'alert', 'warning', 'alert-service', 'ALERT-2026-0001', 'admin', false,
    CURRENT_TIMESTAMP - INTERVAL '25 minutes'),
('鄱阳湖南岸湖滨站蓝绿藻暴发预警', '蓝绿藻密度 15800 cells/mL，已触发Ⅰ级响应',
    'alert', 'error', 'alert-service', 'ALERT-2026-0002', 'admin', false,
    CURRENT_TIMESTAMP - INTERVAL '2 hours'),
('湾里象湖乡村站 CODMn 异常', 'LSTM 模型检测异常，建议立即联动上游站点',
    'alert', 'warning', 'ai-engine', 'ALERT-2026-0003', 'admin', false,
    CURRENT_TIMESTAMP - INTERVAL '5 hours'),
('报告已生成：RPT-2025-A-0001', '南昌经开区工业站 NH3-N 超标溯源分析报告生成完毕',
    'report', 'info', 'report-service', 'RPT-2025-A-0001', 'admin', true,
    CURRENT_TIMESTAMP - INTERVAL '12 hours'),
('报告已生成：今日水质日报', '南昌赣江抚河流域水质日报已生成，合格率 94.5%',
    'report', 'info', 'report-service', 'RPT-2026-D-0001', 'admin', true,
    CURRENT_TIMESTAMP - INTERVAL '1 day'),
('模型训练完成：NC_RW004', '湾里象湖乡村站 LSTM 模型 v2 训练完成，Loss=0.0263',
    'model', 'success', 'ai-engine', 'NC_RW004', 'admin', true,
    CURRENT_TIMESTAMP - INTERVAL '1 hour'),
('MQTT 连接 mqtt-0099 异常', '连接到 test.mosquitto.org 失败，已自动禁用',
    'system', 'warning', 'data-service', 'mqtt-0099-disabled', 'admin', true,
    CURRENT_TIMESTAMP - INTERVAL '30 days'),
('系统欢迎通知', '欢迎使用流域水环境 AI 智能监测与预警平台（南昌版）',
    'system', 'info', 'system', NULL, 'admin', true,
    CURRENT_TIMESTAMP - INTERVAL '90 days')
ON CONFLICT DO NOTHING;

-- ==============================================
-- 2. map_features：地图要素
-- ==============================================
INSERT INTO map_features (feature_type, name, description, geometry_type, coordinates, properties, style) VALUES
('basin_boundary', '南昌市赣江抚河流域边界',
    '南昌市境内赣江、抚河干流及主要支流所覆盖的流域范围',
    'Polygon',
    '[[[115.27,28.26],[116.80,28.26],[116.80,28.55],[116.60,29.00],[116.00,29.05],[115.50,28.90],[115.30,28.60],[115.27,28.26]]]'::jsonb,
    '{"area_km2":7195,"main_river":"赣江/抚河","total_stations":15}'::jsonb,
    '{"stroke":"#1890ff","strokeWidth":2,"fill":"#1890ff","fillOpacity":0.05}'::jsonb),
('water_plant', '南昌市青云水厂',
    '供水人口 140 万，取水自象湖水系',
    'Point', '[115.9070,28.6152]'::jsonb,
    '{"capacity_m3_per_day":400000,"source_river":"象湖水系"}'::jsonb,
    '{"icon":"water_plant","color":"#13c2c2"}'::jsonb),
('water_plant', '南昌市红谷滩水厂',
    '供水人口 90 万，取水自赣江中支',
    'Point', '[115.8420,28.6910]'::jsonb,
    '{"capacity_m3_per_day":280000,"source_river":"赣江中支（罗家集）"}'::jsonb,
    '{"icon":"water_plant","color":"#13c2c2"}'::jsonb),
('sewage_outlet', '青云谱象湖污水处理厂总排口',
    '象湖水系城市污水集中处理后总排口',
    'Point', '[115.9150,28.6320]'::jsonb,
    '{"discharge_m3_per_day":450000,"pollutant_main":["NH3-N","CODCr"]}'::jsonb,
    '{"icon":"outlet","color":"#fa541c"}'::jsonb),
('pollution_marker', 'NC-2024-003 事件点',
    '2024年5月 南昌经开区工业站 COD 异常事件',
    'Point', '[115.8130,28.7520]'::jsonb,
    '{"case_id":"NC-2024-003","pollution_type":"industrial_wastewater","status":"resolved"}'::jsonb,
    '{"icon":"warning","color":"#f5222d","size":"large"}'::jsonb),
('pollution_marker', 'NC-2024-007 藻华事件点',
    '2024年8月 鄱阳湖南岸蓝藻爆发',
    'Point', '[116.3580,28.9420]'::jsonb,
    '{"case_id":"NC-2024-007","pollution_type":"algae_bloom","status":"resolved"}'::jsonb,
    '{"icon":"algae","color":"#52c41a","size":"large"}'::jsonb),
('protection_zone', '溪霞水库一级保护区',
    '新建区溪霞水库饮用水水源一级保护区',
    'Polygon',
    '[[[115.92,28.93],[115.96,28.93],[115.96,28.96],[115.92,28.96],[115.92,28.93]]]'::jsonb,
    '{"level":"I","total_area_km2":8.5}'::jsonb,
    '{"stroke":"#faad14","fill":"#faad14","fillOpacity":0.15}'::jsonb),
('district_center', '南昌市人民政府',
    '南昌市政府所在地（东湖区）',
    'Point', '[115.8975,28.6850]'::jsonb,
    '{"admin_level":"city"}'::jsonb,
    '{"icon":"govt","color":"#722ed1"}'::jsonb)
ON CONFLICT DO NOTHING;

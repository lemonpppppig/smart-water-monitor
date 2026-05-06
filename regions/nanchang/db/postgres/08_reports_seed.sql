-- ============================================================
-- 报告模板 + 报告记录 + 定时任务种子（南昌）
-- 依赖：01_init.sql 已建 reports 表；04_additional_tables 补了
--       report_templates / scheduled_reports 以及 reports 的附加列
-- ============================================================

-- ==============================================
-- 1. report_templates：3 个默认模板
-- ==============================================
INSERT INTO report_templates (template_code, template_name, template_type, description, content_structure, is_default, is_enabled) VALUES
('TPL_DAILY_WQ',     '日常水质日报模板',   'daily_report',
    '按日汇总所有站点 pH/DO/NH3-N/CODMn 四项核心指标，含合格率与趋势',
    '{"sections":["overview","station_summary","metric_trend","exceeded_stations","conclusion"],"default_metrics":["ph","do","nh3_n","codmn"]}'::jsonb,
    'true', 'true'),
('TPL_ALERT_REPORT', '预警事件分析报告',   'alert_report',
    '单次预警事件深度分析：异常指标、溯源路径、相似案例、处置建议',
    '{"sections":["alert_overview","anomaly_detail","traceability","similar_cases","recommendations"]}'::jsonb,
    'true', 'true'),
('TPL_MONTHLY_SUMMARY','月度水环境综合报告','monthly_report',
    '月度综合分析：流域水质达标率、超标排名、治理成效、下月建议',
    '{"sections":["executive_summary","basin_overview","station_ranking","compliance_rate","treatment_effectiveness","next_month_plan"],"default_metrics":["ph","do","nh3_n","codmn","codcr","total_p"]}'::jsonb,
    'false', 'true')
ON CONFLICT (template_code) DO UPDATE SET
    template_name = EXCLUDED.template_name,
    description = EXCLUDED.description,
    updated_at = CURRENT_TIMESTAMP;

-- ==============================================
-- 2. reports：10 条历史报告
-- ==============================================
INSERT INTO reports (
    report_code, report_type, title, alert_id, station_ids,
    content, file_url, file_size, generated_by, created_at,
    report_name, start_time, end_time, file_path, file_format, status
)
SELECT
    'RPT-2026-D-' || LPAD(ROW_NUMBER() OVER (ORDER BY gs DESC)::text, 4, '0') AS report_code,
    'daily' AS report_type,
    '南昌赣江抚河流域水质日报 ' || to_char(gs, 'YYYY-MM-DD') AS title,
    NULL AS alert_id,
    (SELECT ARRAY_AGG(id) FROM stations WHERE station_code LIKE 'NC_%') AS station_ids,
    jsonb_build_object(
        'report_date', to_char(gs, 'YYYY-MM-DD'),
        'total_stations', 15,
        'online_stations', 14,
        'compliance_rate', round((0.85 + random() * 0.12)::numeric, 4),
        'exceeded_stations', (random() * 3)::int,
        'summary', '整体水质' || CASE WHEN random() > 0.5 THEN '达到Ⅲ类标准' ELSE '达到Ⅱ类标准' END
    ) AS content,
    '/minio/reports/daily/' || to_char(gs, 'YYYYMMDD') || '.pdf' AS file_url,
    (200000 + (random() * 500000)::int) AS file_size,
    NULL::uuid AS generated_by,
    gs + INTERVAL '23 hours' AS created_at,
    '南昌赣江抚河流域水质日报 ' || to_char(gs, 'YYYY-MM-DD') AS report_name,
    gs AS start_time,
    gs + INTERVAL '23 hours 59 minutes' AS end_time,
    '/app/reports/daily/' || to_char(gs, 'YYYYMMDD') || '.pdf' AS file_path,
    'pdf' AS file_format,
    'completed' AS status
FROM generate_series(
    CURRENT_DATE - INTERVAL '7 days',
    CURRENT_DATE - INTERVAL '1 days',
    INTERVAL '1 day'
) AS gs
ON CONFLICT (report_code) DO NOTHING;

-- 3 条预警事件报告
INSERT INTO reports (
    report_code, report_type, title, station_ids,
    content, file_url, file_size, created_at,
    report_name, start_time, end_time, file_path, file_format, status
) VALUES
('RPT-2025-A-0001', 'traceability', '南昌经开区工业站 NH3-N 超标溯源分析报告',
    ARRAY(SELECT id FROM stations WHERE station_code IN ('NC_IP001','NC_WS002')),
    '{"alert_type":"threshold","exceeded_metric":"nh3_n","peak_value":2.38,"standard_limit":1.0,"source_candidates":[{"name":"某汽车零部件厂","distance_km":1.2,"probability":0.78},{"name":"生活污水排口B","distance_km":0.6,"probability":0.15}],"similar_cases":["NC-2024-003"],"recommendations":"立即排查上游 2 公里内排污口并加强采样频率"}'::jsonb,
    '/minio/reports/alert/RPT-2025-A-0001.pdf', 412800,
    CURRENT_TIMESTAMP - INTERVAL '12 hours',
    '南昌经开区工业站 NH3-N 超标溯源分析报告',
    CURRENT_TIMESTAMP - INTERVAL '18 hours', CURRENT_TIMESTAMP - INTERVAL '12 hours',
    '/app/reports/alert/RPT-2025-A-0001.pdf', 'pdf', 'completed'),
('RPT-2025-A-0002', 'traceability', '鄱阳湖南岸湖滨站藻华预警分析报告',
    ARRAY(SELECT id FROM stations WHERE station_code = 'NC_RW005'),
    '{"alert_type":"anomaly","exceeded_metric":"blue_green_algae","peak_value":15800,"standard_limit":10000,"algae_risk_level":"high","similar_cases":["NC-2024-007"],"recommendations":"控制赣江营养盐输入，加密藻类密度监测"}'::jsonb,
    '/minio/reports/alert/RPT-2025-A-0002.pdf', 356400,
    CURRENT_TIMESTAMP - INTERVAL '2 days',
    '鄱阳湖南岸湖滨站藻华预警分析报告',
    CURRENT_TIMESTAMP - INTERVAL '3 days', CURRENT_TIMESTAMP - INTERVAL '2 days',
    '/app/reports/alert/RPT-2025-A-0002.pdf', 'pdf', 'completed'),
('RPT-2025-A-0003', 'decision', '赣江入鄱阳湖断面 CODMn 异常决策建议报告',
    ARRAY(SELECT id FROM stations WHERE station_code IN ('NC_BS001','NC_BS003','NC_RW004')),
    '{"alert_type":"anomaly","exceeded_metric":"codmn","peak_value":8.6,"standard_limit":6.0,"upstream_impact":"南昌经开区—青云谱段","recommendations":"沿赣江干流启动联合采样，重点排查南昌经开区排口"}'::jsonb,
    '/minio/reports/alert/RPT-2025-A-0003.pdf', 488200,
    CURRENT_TIMESTAMP - INTERVAL '5 days',
    '赣江入鄱阳湖断面 CODMn 异常决策建议报告',
    CURRENT_TIMESTAMP - INTERVAL '6 days', CURRENT_TIMESTAMP - INTERVAL '5 days',
    '/app/reports/alert/RPT-2025-A-0003.pdf', 'pdf', 'completed')
ON CONFLICT (report_code) DO NOTHING;

-- ==============================================
-- 3. scheduled_reports：2 个定时计划
-- ==============================================
INSERT INTO scheduled_reports (
    schedule_name, report_type, station_ids, cron_expression,
    recipients, is_enabled, next_run_at
) VALUES
('每日流域水质日报',    'daily',    '"all"'::jsonb,
    '0 8 * * *',
    '["env-team@nanchang.gov.cn","water-manager@nanchang.gov.cn"]'::jsonb,
    'true',
    date_trunc('day', CURRENT_TIMESTAMP) + INTERVAL '1 day 8 hours'),
('月度综合分析报告',    'monthly',  '"all"'::jsonb,
    '0 9 1 * *',
    '["leadership@nanchang.gov.cn"]'::jsonb,
    'true',
    date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month 9 hours')
ON CONFLICT DO NOTHING;

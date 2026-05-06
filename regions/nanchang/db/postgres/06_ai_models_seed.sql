-- ============================================================
-- ai_station_models 种子（南昌）
-- 预置 10 条 active 状态模型，station_id 使用南昌 NC_* 站点编码
-- 覆盖 9 条 pollution_cases 相关站点，支撑「训练就绪/一键回放」演示
-- ============================================================

INSERT INTO ai_station_models (
    station_id, station_name, model_type, metrics, epochs,
    final_loss, samples, data_source, model_file, params_file,
    version, status, trained_at
) VALUES
('NC_WS001', '象湖水源地',            'lstm_autoencoder',
    '["ph","do","nh3_n","codmn","turbidity"]'::jsonb, 50, 0.0124, 12800, 'tdengine',
    '/app/models/NC_WS001_v1.pt', '/app/models/NC_WS001_v1.json', 1, 'active',
    CURRENT_TIMESTAMP - INTERVAL '3 days'),
('NC_IP001', '南昌经开区工业站',      'lstm_autoencoder',
    '["ph","do","nh3_n","codmn","turbidity","codcr"]'::jsonb, 50, 0.0218, 12960, 'tdengine',
    '/app/models/NC_IP001_v1.pt', '/app/models/NC_IP001_v1.json', 1, 'active',
    CURRENT_TIMESTAMP - INTERVAL '2 days'),
('NC_WS002', '罗家集赣江中支水源地',  'lstm_autoencoder',
    '["ph","do","nh3_n","codmn","turbidity"]'::jsonb, 50, 0.0156, 12864, 'tdengine',
    '/app/models/NC_WS002_v1.pt', '/app/models/NC_WS002_v1.json', 1, 'active',
    CURRENT_TIMESTAMP - INTERVAL '2 days'),
('NC_RW005', '鄱阳湖南岸湖滨站',      'lstm_autoencoder',
    '["ph","do","nh3_n","codmn","chlorophyll","blue_green_algae"]'::jsonb, 60, 0.0189, 13104, 'tdengine',
    '/app/models/NC_RW005_v1.pt', '/app/models/NC_RW005_v1.json', 1, 'active',
    CURRENT_TIMESTAMP - INTERVAL '1 days'),
('NC_IP003', '进贤工业园工业站',      'lstm_autoencoder',
    '["ph","do","nh3_n","total_p","codmn"]'::jsonb, 50, 0.0143, 12720, 'tdengine',
    '/app/models/NC_IP003_v1.pt', '/app/models/NC_IP003_v1.json', 1, 'active',
    CURRENT_TIMESTAMP - INTERVAL '1 days'),
('NC_BS003', '潦河入赣江断面站',      'lstm_autoencoder',
    '["ph","do","nh3_n","codmn","turbidity"]'::jsonb, 50, 0.0175, 12816, 'tdengine',
    '/app/models/NC_BS003_v1.pt', '/app/models/NC_BS003_v1.json', 1, 'active',
    CURRENT_TIMESTAMP - INTERVAL '5 hours'),
('NC_BS001', '赣江入鄱阳湖断面站',    'lstm_autoencoder',
    '["ph","do","nh3_n","codmn","total_p","codcr"]'::jsonb, 60, 0.0209, 13248, 'tdengine',
    '/app/models/NC_BS001_v1.pt', '/app/models/NC_BS001_v1.json', 1, 'active',
    CURRENT_TIMESTAMP - INTERVAL '3 hours'),
('NC_BS002', '抚河入鄱阳湖断面站',    'lstm_autoencoder',
    '["ph","do","nh3_n","codmn","turbidity"]'::jsonb, 50, 0.0162, 12648, 'tdengine',
    '/app/models/NC_BS002_v1.pt', '/app/models/NC_BS002_v1.json', 1, 'active',
    CURRENT_TIMESTAMP - INTERVAL '6 hours'),
('NC_BS004', '锦江入赣江断面站',      'lstm_autoencoder',
    '["ph","do","nh3_n","codmn","turbidity"]'::jsonb, 50, 0.0148, 12720, 'tdengine',
    '/app/models/NC_BS004_v1.pt', '/app/models/NC_BS004_v1.json', 1, 'active',
    CURRENT_TIMESTAMP - INTERVAL '8 hours'),
('NC_RW004', '湾里象湖乡村站',        'lstm_autoencoder',
    '["ph","do","nh3_n","codmn","total_p","codcr","turbidity"]'::jsonb, 80, 0.0263, 13392, 'tdengine',
    '/app/models/NC_RW004_v1.pt', '/app/models/NC_RW004_v1.json', 2, 'active',
    CURRENT_TIMESTAMP - INTERVAL '1 hours')
ON CONFLICT (station_id) DO UPDATE SET
    station_name = EXCLUDED.station_name,
    status = EXCLUDED.status,
    trained_at = EXCLUDED.trained_at,
    updated_at = CURRENT_TIMESTAMP;

-- graph_canvas_layout：不预置坐标，交由前端算法布局（computeRiverNetworkLayout）
-- 如需重置：TRUNCATE TABLE graph_canvas_layout;

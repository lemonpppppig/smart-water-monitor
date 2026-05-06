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

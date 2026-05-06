-- ============================================================
-- MQTT 连接种子（南昌）：
-- 1) 一条外部数据源（公网 MQTT Broker 示例）
-- 2) 多条本地 EMQX 监听连接，覆盖南昌重点站点主题
-- ============================================================

INSERT INTO mqtt_connections (
    id, name, broker_host, broker_port, topic, module_keys,
    username, password, client_id, qos,
    station_id, station_name, status, created_at
) VALUES
(
    'mqtt-0001-external-source',
    '南昌公网 MQTT 数据源',
    '120.77.155.186', 1883,
    'water_environment/sensors/data',
    'ph,do,nh3_n,codmn,turbidity,conductivity,water_temperature',
    'user_nc_05', 'user_nc_05',
    'water-env-backend-ext', 1,
    NULL, '多站点复用',
    'connected',
    CURRENT_TIMESTAMP - INTERVAL '7 days'
),
(
    'mqtt-0002-emqx-local-all',
    '本地 EMQX 通配订阅',
    'emqx', 1883,
    'water/+/data',
    'ph,do,nh3_n,codmn,turbidity',
    NULL, NULL,
    'water-env-backend-local', 1,
    NULL, '本地全站点',
    'connected',
    CURRENT_TIMESTAMP - INTERVAL '7 days'
),
(
    'mqtt-0010-bs001-ganjiang',
    '赣江入鄱阳湖断面实时采集',
    'emqx', 1883,
    'water/NC_BS001/data',
    'ph,do,nh3_n,codmn,turbidity,codcr,total_p',
    NULL, NULL,
    'client-nc-bs001', 1,
    'NC_BS001', '赣江入鄱阳湖断面站',
    'connected',
    CURRENT_TIMESTAMP - INTERVAL '5 days'
),
(
    'mqtt-0011-ip001-industrial',
    '南昌经开区工业站',
    'emqx', 1883,
    'water/NC_IP001/data',
    'ph,do,nh3_n,codmn,turbidity,codcr',
    NULL, NULL,
    'client-nc-ip001', 1,
    'NC_IP001', '南昌经开区工业站',
    'connected',
    CURRENT_TIMESTAMP - INTERVAL '5 days'
),
(
    'mqtt-0012-rw005-algae',
    '鄱阳湖南岸湖滨藻类监测',
    'emqx', 1883,
    'water/NC_RW005/data',
    'ph,do,chlorophyll,blue_green_algae,total_p',
    NULL, NULL,
    'client-nc-rw005', 1,
    'NC_RW005', '鄱阳湖南岸湖滨站',
    'connected',
    CURRENT_TIMESTAMP - INTERVAL '3 days'
),
(
    'mqtt-0020-rw004-outlet',
    '湾里象湖乡村站',
    'emqx', 1883,
    'water/NC_RW004/data',
    'ph,do,nh3_n,codmn,turbidity,total_p,chlorophyll',
    NULL, NULL,
    'client-nc-rw004', 1,
    'NC_RW004', '湾里象湖乡村站',
    'connected',
    CURRENT_TIMESTAMP - INTERVAL '7 days'
),
(
    'mqtt-0099-disabled',
    '历史测试连接（已停用）',
    'test.mosquitto.org', 1883,
    'water/test/#',
    'ph,do',
    NULL, NULL,
    'client-test', 0,
    NULL, NULL,
    'disconnected',
    CURRENT_TIMESTAMP - INTERVAL '30 days'
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    broker_host = EXCLUDED.broker_host,
    topic = EXCLUDED.topic,
    status = EXCLUDED.status,
    updated_at = CURRENT_TIMESTAMP;

-- ============================================================
-- 南昌市业务种子数据
-- 依赖 01_init.sql 已建好 stations / pollution_cases 等基础表
-- 本文件：清理赣州模板遗留示例数据，并补入南昌本地业务数据
-- bbox: 28.2663-28.9991 N, 115.2734-116.7908 E
-- ============================================================

-- ------------------------------------------------------------
-- 0. 清理 01_init.sql 中内嵌的赣州 FALLBACK 示例（station + pollution_cases）
-- ------------------------------------------------------------
DELETE FROM stations WHERE station_code IN (
    'WS001','WS002','WS003',
    'IP001','IP002','IP003','IP004',
    'BS001','BS002','BS003','BS004',
    'RW001','RW002','RW003','RW004','RW005'
);

DELETE FROM pollution_cases WHERE case_code IN (
    'CASE-2024-001','CASE-2024-002','CASE-2024-003','CASE-2024-004','CASE-2024-005'
);

-- ------------------------------------------------------------
-- 1. 扩展表：rivers / districts / confluences / station_upstream / river_districts
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rivers (
    river_id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    river_level SMALLINT NOT NULL,                  -- 1 干流 / 2 一级支流 / 3 二级支流 / 4 沟渠
    parent_river_id VARCHAR(32) REFERENCES rivers(river_id),
    river_system VARCHAR(32),                       -- Yangtze / Poyang
    sub_system VARCHAR(32),                         -- Ganjiang / Fuhe / ...
    length_km NUMERIC(10,2),
    basin_area_km2 NUMERIC(12,2),
    description TEXT,
    geom GEOMETRY(LINESTRING, 4326),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS districts (
    code VARCHAR(16) PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    parent_code VARCHAR(16) REFERENCES districts(code),
    level SMALLINT NOT NULL,                        -- 0 省 / 1 市 / 2 区县
    center_lon NUMERIC(10,6),
    center_lat NUMERIC(10,6),
    geom GEOMETRY(MULTIPOLYGON, 4326)
);

CREATE TABLE IF NOT EXISTS confluences (
    confluence_id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(64),
    main_river_id VARCHAR(32) REFERENCES rivers(river_id),
    tributary_river_id VARCHAR(32) REFERENCES rivers(river_id),
    longitude NUMERIC(10,6),
    latitude NUMERIC(10,6),
    geom GEOMETRY(POINT, 4326)
);

CREATE TABLE IF NOT EXISTS station_upstream (
    id SERIAL PRIMARY KEY,
    upstream_station_code VARCHAR(32) NOT NULL,
    downstream_station_code VARCHAR(32) NOT NULL,
    distance_km NUMERIC(10,2),
    UNIQUE(upstream_station_code, downstream_station_code)
);

CREATE TABLE IF NOT EXISTS river_districts (
    id SERIAL PRIMARY KEY,
    river_id VARCHAR(32) NOT NULL REFERENCES rivers(river_id),
    district_code VARCHAR(16) NOT NULL REFERENCES districts(code),
    UNIQUE(river_id, district_code)
);

-- ------------------------------------------------------------
-- 2. 行政区（南昌市 + 9 个区县）
-- ------------------------------------------------------------
INSERT INTO districts (code, name, parent_code, level, center_lon, center_lat) VALUES
    ('360100', '南昌市',    NULL,     1, 115.8921, 28.6820),
    ('360102', '东湖区',    '360100', 2, 115.8975, 28.6850),
    ('360103', '西湖区',    '360100', 2, 115.8772, 28.6570),
    ('360104', '青云谱区',  '360100', 2, 115.9150, 28.6320),
    ('360111', '青山湖区',  '360100', 2, 115.9620, 28.6820),
    ('360112', '新建区',    '360100', 2, 115.8150, 28.6920),
    ('360113', '红谷滩区',  '360100', 2, 115.8350, 28.6900),
    ('360121', '南昌县',    '360100', 2, 116.0380, 28.5460),
    ('360123', '安义县',    '360100', 2, 115.5480, 28.8460),
    ('360124', '进贤县',    '360100', 2, 116.2420, 28.3760)
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------
-- 3. 河流（赣江 + 抚河水系，鄱阳湖/长江流域）
-- ------------------------------------------------------------
INSERT INTO rivers (river_id, name, river_level, parent_river_id, river_system, sub_system, length_km, basin_area_km2, description) VALUES
    ('R_GANJIANG',        '赣江(南昌段)',   1, NULL,          'Yangtze', 'Ganjiang', 766.0, 83500.0, '江西第一大河，南昌段约 80 公里'),
    ('R_FUHE',            '抚河',           1, NULL,          'Yangtze', 'Fuhe',     349.0, 15811.0, '江西第二大河，进贤段流入鄱阳湖'),
    ('R_LIAOHE',          '潦河',           2, 'R_GANJIANG',  'Yangtze', 'Ganjiang', 148.0,  4380.0, '赣江下游西岸一级支流，流经安义、新建'),
    ('R_JINJIANG_NC',     '锦江',           2, 'R_GANJIANG',  'Yangtze', 'Ganjiang', 294.0,  7879.0, '赣江右岸一级支流'),
    ('R_GANJIANG_WEST',   '赣江西支',       2, 'R_GANJIANG',  'Yangtze', 'Ganjiang',  45.0,   900.0, '赣江入鄱阳湖前分流之西支'),
    ('R_GANJIANG_MIDDLE', '赣江中支',       2, 'R_GANJIANG',  'Yangtze', 'Ganjiang',  38.0,   600.0, '赣江入鄱阳湖前分流之中支'),
    ('R_GANJIANG_NORTH',  '赣江北支',       2, 'R_GANJIANG',  'Yangtze', 'Ganjiang',  42.0,   850.0, '赣江入鄱阳湖前分流之北支'),
    ('R_YUHE',            '玉带河',         3, 'R_GANJIANG',  'Yangtze', 'Ganjiang',  22.0,    80.0, '南昌市区内河，青山湖—赣江'),
    ('R_XIANHU',          '象湖水系',       3, 'R_GANJIANG',  'Yangtze', 'Ganjiang',  15.0,    60.0, '青云谱区象湖—抚河故道—赣江')
ON CONFLICT (river_id) DO NOTHING;

-- ------------------------------------------------------------
-- 4. 交汇点
-- ------------------------------------------------------------
INSERT INTO confluences (confluence_id, name, main_river_id, tributary_river_id, longitude, latitude) VALUES
    ('C_NC_001', '赣江西支分流点',   'R_GANJIANG', 'R_GANJIANG_WEST',   115.8250, 28.7350),
    ('C_NC_002', '赣江中支分流点',   'R_GANJIANG', 'R_GANJIANG_MIDDLE', 115.8820, 28.7580),
    ('C_NC_003', '赣江北支分流点',   'R_GANJIANG', 'R_GANJIANG_NORTH',  115.9580, 28.8120),
    ('C_NC_004', '潦河入赣江口',     'R_GANJIANG', 'R_LIAOHE',          115.7720, 28.8220),
    ('C_NC_005', '锦江入赣江口',     'R_GANJIANG', 'R_JINJIANG_NC',     115.7050, 28.4480),
    ('C_NC_006', '玉带河入赣江口',   'R_GANJIANG', 'R_YUHE',            115.8920, 28.6750),
    ('C_NC_007', '象湖入赣江口',     'R_GANJIANG', 'R_XIANHU',          115.8680, 28.6280),
    ('C_NC_008', '抚河入鄱阳湖口',   'R_FUHE',     NULL,                116.5720, 28.5150)
ON CONFLICT (confluence_id) DO NOTHING;

-- ------------------------------------------------------------
-- 5. 监测站点（15 个）
--    4 大类型：water_source / industrial_park / boundary_section / rural_water
--    全部落在南昌 bbox 内
-- ------------------------------------------------------------
INSERT INTO stations (station_code, station_name, station_type, longitude, latitude, geom) VALUES
    -- 水源地
    ('NC_WS001', '象湖水源地',            'water_source',    115.9070, 28.6152, ST_SetSRID(ST_MakePoint(115.9070, 28.6152), 4326)),
    ('NC_WS002', '罗家集赣江中支水源地',  'water_source',    115.8420, 28.6910, ST_SetSRID(ST_MakePoint(115.8420, 28.6910), 4326)),
    ('NC_WS003', '溪霞水库水源地',        'water_source',    115.9350, 28.9420, ST_SetSRID(ST_MakePoint(115.9350, 28.9420), 4326)),

    -- 工业园区
    ('NC_IP001', '南昌经开区工业站',      'industrial_park', 115.8130, 28.7520, ST_SetSRID(ST_MakePoint(115.8130, 28.7520), 4326)),
    ('NC_IP002', '高新区艾溪湖工业站',    'industrial_park', 115.9890, 28.6830, ST_SetSRID(ST_MakePoint(115.9890, 28.6830), 4326)),
    ('NC_IP003', '进贤工业园工业站',      'industrial_park', 116.3520, 28.3680, ST_SetSRID(ST_MakePoint(116.3520, 28.3680), 4326)),

    -- 跨界断面
    ('NC_BS001', '赣江入鄱阳湖断面站',    'boundary_section',116.1720, 28.9780, ST_SetSRID(ST_MakePoint(116.1720, 28.9780), 4326)),
    ('NC_BS002', '抚河入鄱阳湖断面站',    'boundary_section',116.5480, 28.4820, ST_SetSRID(ST_MakePoint(116.5480, 28.4820), 4326)),
    ('NC_BS003', '潦河入赣江断面站',      'boundary_section',115.7680, 28.8250, ST_SetSRID(ST_MakePoint(115.7680, 28.8250), 4326)),
    ('NC_BS004', '锦江入赣江断面站',      'boundary_section',115.7120, 28.4520, ST_SetSRID(ST_MakePoint(115.7120, 28.4520), 4326)),

    -- 农村水体
    ('NC_RW001', '安义潦河上游乡村站',    'rural_water',     115.4820, 28.8510, ST_SetSRID(ST_MakePoint(115.4820, 28.8510), 4326)),
    ('NC_RW002', '进贤抚河乡村站',        'rural_water',     116.2630, 28.3920, ST_SetSRID(ST_MakePoint(116.2630, 28.3920), 4326)),
    ('NC_RW003', '南昌县东新乡村站',      'rural_water',     116.1280, 28.4820, ST_SetSRID(ST_MakePoint(116.1280, 28.4820), 4326)),
    ('NC_RW004', '湾里象湖乡村站',        'rural_water',     115.7280, 28.7520, ST_SetSRID(ST_MakePoint(115.7280, 28.7520), 4326)),
    ('NC_RW005', '鄱阳湖南岸湖滨站',      'rural_water',     116.3580, 28.9420, ST_SetSRID(ST_MakePoint(116.3580, 28.9420), 4326))
ON CONFLICT (station_code) DO NOTHING;

-- ------------------------------------------------------------
-- 6. 站点上下游关系（沿河顺流方向）
-- ------------------------------------------------------------
INSERT INTO station_upstream (upstream_station_code, downstream_station_code, distance_km) VALUES
    -- 赣江主干（南 → 北 → 鄱阳湖）
    ('NC_RW003', 'NC_WS002', 20.0),
    ('NC_WS002', 'NC_BS001', 35.0),
    -- 赣江西支
    ('NC_IP001', 'NC_BS001', 25.0),
    -- 玉带河 → 赣江
    ('NC_IP002', 'NC_WS002', 15.0),
    -- 象湖水系
    ('NC_WS001', 'NC_RW004', 12.0),
    ('NC_RW004', 'NC_IP001', 18.0),
    -- 潦河
    ('NC_RW001', 'NC_BS003', 40.0),
    -- 抚河
    ('NC_RW002', 'NC_IP003',  8.0),
    ('NC_IP003', 'NC_BS002', 28.0)
ON CONFLICT (upstream_station_code, downstream_station_code) DO NOTHING;

-- ------------------------------------------------------------
-- 7. 河流—行政区关系
-- ------------------------------------------------------------
INSERT INTO river_districts (river_id, district_code) VALUES
    ('R_GANJIANG',        '360112'),
    ('R_GANJIANG',        '360113'),
    ('R_GANJIANG',        '360102'),
    ('R_GANJIANG',        '360103'),
    ('R_GANJIANG',        '360104'),
    ('R_GANJIANG',        '360121'),
    ('R_FUHE',            '360124'),
    ('R_FUHE',            '360121'),
    ('R_LIAOHE',          '360123'),
    ('R_LIAOHE',          '360112'),
    ('R_JINJIANG_NC',     '360112'),
    ('R_GANJIANG_WEST',   '360112'),
    ('R_GANJIANG_WEST',   '360113'),
    ('R_GANJIANG_MIDDLE', '360112'),
    ('R_GANJIANG_MIDDLE', '360102'),
    ('R_GANJIANG_NORTH',  '360112'),
    ('R_YUHE',            '360111'),
    ('R_YUHE',            '360102'),
    ('R_XIANHU',          '360104')
ON CONFLICT (river_id, district_code) DO NOTHING;

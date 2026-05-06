// ============================================================
// 南昌市河流拓扑 + 行政区 + 交汇点
// 与 regions/nanchang/db/postgres/02_nanchang_data.sql 同步
// ============================================================

// ==============================================
// 0. 约束与索引
// ==============================================

CREATE CONSTRAINT river_id_unique IF NOT EXISTS
FOR (r:River) REQUIRE r.river_id IS UNIQUE;

CREATE CONSTRAINT district_code_unique IF NOT EXISTS
FOR (d:District) REQUIRE d.code IS UNIQUE;

CREATE CONSTRAINT confluence_id_unique IF NOT EXISTS
FOR (c:Confluence) REQUIRE c.confluence_id IS UNIQUE;

CREATE CONSTRAINT station_id_unique IF NOT EXISTS
FOR (s:Station) REQUIRE s.station_id IS UNIQUE;

CREATE INDEX river_name_idx IF NOT EXISTS FOR (r:River) ON (r.name);
CREATE INDEX district_name_idx IF NOT EXISTS FOR (d:District) ON (d.name);

// ==============================================
// 1. 行政区节点（南昌市 + 9 个区县）
// ==============================================

MERGE (d:District {code: '360100'}) SET d.name = '南昌市',   d.level = 1, d.parent_code = NULL,     d.center_lon = 115.8921, d.center_lat = 28.6820;
MERGE (d:District {code: '360102'}) SET d.name = '东湖区',   d.level = 2, d.parent_code = '360100', d.center_lon = 115.8975, d.center_lat = 28.6850;
MERGE (d:District {code: '360103'}) SET d.name = '西湖区',   d.level = 2, d.parent_code = '360100', d.center_lon = 115.8772, d.center_lat = 28.6570;
MERGE (d:District {code: '360104'}) SET d.name = '青云谱区', d.level = 2, d.parent_code = '360100', d.center_lon = 115.9150, d.center_lat = 28.6320;
MERGE (d:District {code: '360111'}) SET d.name = '青山湖区', d.level = 2, d.parent_code = '360100', d.center_lon = 115.9620, d.center_lat = 28.6820;
MERGE (d:District {code: '360112'}) SET d.name = '新建区',   d.level = 2, d.parent_code = '360100', d.center_lon = 115.8150, d.center_lat = 28.6920;
MERGE (d:District {code: '360113'}) SET d.name = '红谷滩区', d.level = 2, d.parent_code = '360100', d.center_lon = 115.8350, d.center_lat = 28.6900;
MERGE (d:District {code: '360121'}) SET d.name = '南昌县',   d.level = 2, d.parent_code = '360100', d.center_lon = 116.0380, d.center_lat = 28.5460;
MERGE (d:District {code: '360123'}) SET d.name = '安义县',   d.level = 2, d.parent_code = '360100', d.center_lon = 115.5480, d.center_lat = 28.8460;
MERGE (d:District {code: '360124'}) SET d.name = '进贤县',   d.level = 2, d.parent_code = '360100', d.center_lon = 116.2420, d.center_lat = 28.3760;

// ==============================================
// 2. 河流节点（赣江 + 抚河水系）
// ==============================================

MERGE (r:River {river_id: 'R_GANJIANG'})        SET r.name = '赣江(南昌段)',  r.level = 1, r.parent_river_id = NULL,          r.system = 'Yangtze', r.sub_system = 'Ganjiang', r.length_km = 766.0, r.basin_area_km2 = 83500.0;
MERGE (r:River {river_id: 'R_FUHE'})            SET r.name = '抚河',           r.level = 1, r.parent_river_id = NULL,          r.system = 'Yangtze', r.sub_system = 'Fuhe',     r.length_km = 349.0, r.basin_area_km2 = 15811.0;
MERGE (r:River {river_id: 'R_LIAOHE'})          SET r.name = '潦河',           r.level = 2, r.parent_river_id = 'R_GANJIANG', r.system = 'Yangtze', r.sub_system = 'Ganjiang', r.length_km = 148.0, r.basin_area_km2 =  4380.0;
MERGE (r:River {river_id: 'R_JINJIANG_NC'})     SET r.name = '锦江',           r.level = 2, r.parent_river_id = 'R_GANJIANG', r.system = 'Yangtze', r.sub_system = 'Ganjiang', r.length_km = 294.0, r.basin_area_km2 =  7879.0;
MERGE (r:River {river_id: 'R_GANJIANG_WEST'})   SET r.name = '赣江西支',       r.level = 2, r.parent_river_id = 'R_GANJIANG', r.system = 'Yangtze', r.sub_system = 'Ganjiang', r.length_km =  45.0, r.basin_area_km2 =   900.0;
MERGE (r:River {river_id: 'R_GANJIANG_MIDDLE'}) SET r.name = '赣江中支',       r.level = 2, r.parent_river_id = 'R_GANJIANG', r.system = 'Yangtze', r.sub_system = 'Ganjiang', r.length_km =  38.0, r.basin_area_km2 =   600.0;
MERGE (r:River {river_id: 'R_GANJIANG_NORTH'})  SET r.name = '赣江北支',       r.level = 2, r.parent_river_id = 'R_GANJIANG', r.system = 'Yangtze', r.sub_system = 'Ganjiang', r.length_km =  42.0, r.basin_area_km2 =   850.0;
MERGE (r:River {river_id: 'R_YUHE'})            SET r.name = '玉带河',         r.level = 3, r.parent_river_id = 'R_GANJIANG', r.system = 'Yangtze', r.sub_system = 'Ganjiang', r.length_km =  22.0, r.basin_area_km2 =    80.0;
MERGE (r:River {river_id: 'R_XIANHU'})          SET r.name = '象湖水系',       r.level = 3, r.parent_river_id = 'R_GANJIANG', r.system = 'Yangtze', r.sub_system = 'Ganjiang', r.length_km =  15.0, r.basin_area_km2 =    60.0;

// ==============================================
// 3. 河流上下游关系 FLOWS_INTO（支流 → 干流）
//    关系名必须与后端 graph_admin.py snapshot 查询一致
//    confluence_id 属性用于前端画布桥接真实交汇点
// ==============================================

MATCH (a:River {river_id: 'R_LIAOHE'}),          (b:River {river_id: 'R_GANJIANG'}) MERGE (a)-[:FLOWS_INTO {confluence_id: 'C_NC_004', distance_km: 148}]->(b);
MATCH (a:River {river_id: 'R_JINJIANG_NC'}),     (b:River {river_id: 'R_GANJIANG'}) MERGE (a)-[:FLOWS_INTO {confluence_id: 'C_NC_005', distance_km: 294}]->(b);
MATCH (a:River {river_id: 'R_GANJIANG_WEST'}),   (b:River {river_id: 'R_GANJIANG'}) MERGE (a)-[:FLOWS_INTO {confluence_id: 'C_NC_001', distance_km: 45}]->(b);
MATCH (a:River {river_id: 'R_GANJIANG_MIDDLE'}), (b:River {river_id: 'R_GANJIANG'}) MERGE (a)-[:FLOWS_INTO {confluence_id: 'C_NC_002', distance_km: 38}]->(b);
MATCH (a:River {river_id: 'R_GANJIANG_NORTH'}),  (b:River {river_id: 'R_GANJIANG'}) MERGE (a)-[:FLOWS_INTO {confluence_id: 'C_NC_003', distance_km: 42}]->(b);
MATCH (a:River {river_id: 'R_YUHE'}),            (b:River {river_id: 'R_GANJIANG'}) MERGE (a)-[:FLOWS_INTO {confluence_id: 'C_NC_006', distance_km: 22}]->(b);
MATCH (a:River {river_id: 'R_XIANHU'}),          (b:River {river_id: 'R_GANJIANG'}) MERGE (a)-[:FLOWS_INTO {confluence_id: 'C_NC_007', distance_km: 15}]->(b);

// ==============================================
// 4. 交汇点节点
// ==============================================

MERGE (c:Confluence {confluence_id: 'C_NC_001'}) SET c.name = '赣江西支分流点',   c.longitude = 115.8250, c.latitude = 28.7350;
MERGE (c:Confluence {confluence_id: 'C_NC_002'}) SET c.name = '赣江中支分流点',   c.longitude = 115.8820, c.latitude = 28.7580;
MERGE (c:Confluence {confluence_id: 'C_NC_003'}) SET c.name = '赣江北支分流点',   c.longitude = 115.9580, c.latitude = 28.8120;
MERGE (c:Confluence {confluence_id: 'C_NC_004'}) SET c.name = '潦河入赣江口',     c.longitude = 115.7720, c.latitude = 28.8220;
MERGE (c:Confluence {confluence_id: 'C_NC_005'}) SET c.name = '锦江入赣江口',     c.longitude = 115.7050, c.latitude = 28.4480;
MERGE (c:Confluence {confluence_id: 'C_NC_006'}) SET c.name = '玉带河入赣江口',   c.longitude = 115.8920, c.latitude = 28.6750;
MERGE (c:Confluence {confluence_id: 'C_NC_007'}) SET c.name = '象湖入赣江口',     c.longitude = 115.8680, c.latitude = 28.6280;
MERGE (c:Confluence {confluence_id: 'C_NC_008'}) SET c.name = '抚河入鄱阳湖口',   c.longitude = 116.5720, c.latitude = 28.5150;

// ==============================================
// 5. 交汇点关系（关系名与后端 graph_admin.py 查询对齐）
//    FLOWS_INTO_CONFLUENCE: 支流 → 交汇点
//    CONFLUENCE_FLOWS_TO:   交汇点 → 干流
// ==============================================

MATCH (c:Confluence {confluence_id: 'C_NC_001'}), (r:River {river_id: 'R_GANJIANG'})        MERGE (c)-[:CONFLUENCE_FLOWS_TO]->(r);
MATCH (c:Confluence {confluence_id: 'C_NC_001'}), (r:River {river_id: 'R_GANJIANG_WEST'})   MERGE (r)-[:FLOWS_INTO_CONFLUENCE]->(c);

MATCH (c:Confluence {confluence_id: 'C_NC_002'}), (r:River {river_id: 'R_GANJIANG'})        MERGE (c)-[:CONFLUENCE_FLOWS_TO]->(r);
MATCH (c:Confluence {confluence_id: 'C_NC_002'}), (r:River {river_id: 'R_GANJIANG_MIDDLE'}) MERGE (r)-[:FLOWS_INTO_CONFLUENCE]->(c);

MATCH (c:Confluence {confluence_id: 'C_NC_003'}), (r:River {river_id: 'R_GANJIANG'})        MERGE (c)-[:CONFLUENCE_FLOWS_TO]->(r);
MATCH (c:Confluence {confluence_id: 'C_NC_003'}), (r:River {river_id: 'R_GANJIANG_NORTH'})  MERGE (r)-[:FLOWS_INTO_CONFLUENCE]->(c);

MATCH (c:Confluence {confluence_id: 'C_NC_004'}), (r:River {river_id: 'R_GANJIANG'})        MERGE (c)-[:CONFLUENCE_FLOWS_TO]->(r);
MATCH (c:Confluence {confluence_id: 'C_NC_004'}), (r:River {river_id: 'R_LIAOHE'})          MERGE (r)-[:FLOWS_INTO_CONFLUENCE]->(c);

MATCH (c:Confluence {confluence_id: 'C_NC_005'}), (r:River {river_id: 'R_GANJIANG'})        MERGE (c)-[:CONFLUENCE_FLOWS_TO]->(r);
MATCH (c:Confluence {confluence_id: 'C_NC_005'}), (r:River {river_id: 'R_JINJIANG_NC'})     MERGE (r)-[:FLOWS_INTO_CONFLUENCE]->(c);

MATCH (c:Confluence {confluence_id: 'C_NC_006'}), (r:River {river_id: 'R_GANJIANG'})        MERGE (c)-[:CONFLUENCE_FLOWS_TO]->(r);
MATCH (c:Confluence {confluence_id: 'C_NC_006'}), (r:River {river_id: 'R_YUHE'})            MERGE (r)-[:FLOWS_INTO_CONFLUENCE]->(c);

MATCH (c:Confluence {confluence_id: 'C_NC_007'}), (r:River {river_id: 'R_GANJIANG'})        MERGE (c)-[:CONFLUENCE_FLOWS_TO]->(r);
MATCH (c:Confluence {confluence_id: 'C_NC_007'}), (r:River {river_id: 'R_XIANHU'})          MERGE (r)-[:FLOWS_INTO_CONFLUENCE]->(c);

MATCH (c:Confluence {confluence_id: 'C_NC_008'}), (r:River {river_id: 'R_FUHE'})            MERGE (c)-[:CONFLUENCE_FLOWS_TO]->(r);

// ==============================================
// 6. 河流 IN_DISTRICT 关系（河流流经行政区）
// ==============================================

MATCH (r:River {river_id: 'R_GANJIANG'}),        (d:District {code: '360112'}) MERGE (r)-[:IN_DISTRICT]->(d);
MATCH (r:River {river_id: 'R_GANJIANG'}),        (d:District {code: '360113'}) MERGE (r)-[:IN_DISTRICT]->(d);
MATCH (r:River {river_id: 'R_GANJIANG'}),        (d:District {code: '360102'}) MERGE (r)-[:IN_DISTRICT]->(d);
MATCH (r:River {river_id: 'R_GANJIANG'}),        (d:District {code: '360103'}) MERGE (r)-[:IN_DISTRICT]->(d);
MATCH (r:River {river_id: 'R_GANJIANG'}),        (d:District {code: '360104'}) MERGE (r)-[:IN_DISTRICT]->(d);
MATCH (r:River {river_id: 'R_GANJIANG'}),        (d:District {code: '360121'}) MERGE (r)-[:IN_DISTRICT]->(d);
MATCH (r:River {river_id: 'R_FUHE'}),            (d:District {code: '360124'}) MERGE (r)-[:IN_DISTRICT]->(d);
MATCH (r:River {river_id: 'R_FUHE'}),            (d:District {code: '360121'}) MERGE (r)-[:IN_DISTRICT]->(d);
MATCH (r:River {river_id: 'R_LIAOHE'}),          (d:District {code: '360123'}) MERGE (r)-[:IN_DISTRICT]->(d);
MATCH (r:River {river_id: 'R_LIAOHE'}),          (d:District {code: '360112'}) MERGE (r)-[:IN_DISTRICT]->(d);
MATCH (r:River {river_id: 'R_JINJIANG_NC'}),     (d:District {code: '360112'}) MERGE (r)-[:IN_DISTRICT]->(d);
MATCH (r:River {river_id: 'R_GANJIANG_WEST'}),   (d:District {code: '360112'}) MERGE (r)-[:IN_DISTRICT]->(d);
MATCH (r:River {river_id: 'R_GANJIANG_WEST'}),   (d:District {code: '360113'}) MERGE (r)-[:IN_DISTRICT]->(d);
MATCH (r:River {river_id: 'R_GANJIANG_MIDDLE'}), (d:District {code: '360112'}) MERGE (r)-[:IN_DISTRICT]->(d);
MATCH (r:River {river_id: 'R_GANJIANG_MIDDLE'}), (d:District {code: '360102'}) MERGE (r)-[:IN_DISTRICT]->(d);
MATCH (r:River {river_id: 'R_GANJIANG_NORTH'}),  (d:District {code: '360112'}) MERGE (r)-[:IN_DISTRICT]->(d);
MATCH (r:River {river_id: 'R_YUHE'}),            (d:District {code: '360111'}) MERGE (r)-[:IN_DISTRICT]->(d);
MATCH (r:River {river_id: 'R_YUHE'}),            (d:District {code: '360102'}) MERGE (r)-[:IN_DISTRICT]->(d);
MATCH (r:River {river_id: 'R_XIANHU'}),          (d:District {code: '360104'}) MERGE (r)-[:IN_DISTRICT]->(d);

// ============================================================
// 南昌市监测站点节点 + ON_RIVER / IN_DISTRICT / UPSTREAM_OF 关系
// 15 个站点，与 regions/nanchang/db/postgres/02_nanchang_data.sql 同步
// ============================================================

// ==============================================
// 1. 监测站点节点（15 个）
// ==============================================

// 水源地
MERGE (s:Station {station_id: 'NC_WS001'}) SET s.name = '象湖水源地',            s.river_id = 'R_XIANHU',          s.district_code = '360104', s.station_type = 'water_source',     s.longitude = 115.9070, s.latitude = 28.6152;
MERGE (s:Station {station_id: 'NC_WS002'}) SET s.name = '罗家集赣江中支水源地',  s.river_id = 'R_GANJIANG_MIDDLE', s.district_code = '360113', s.station_type = 'water_source',     s.longitude = 115.8420, s.latitude = 28.6910;
MERGE (s:Station {station_id: 'NC_WS003'}) SET s.name = '溪霞水库水源地',        s.river_id = 'R_GANJIANG_NORTH',  s.district_code = '360112', s.station_type = 'water_source',     s.longitude = 115.9350, s.latitude = 28.9420;

// 工业园区
MERGE (s:Station {station_id: 'NC_IP001'}) SET s.name = '南昌经开区工业站',      s.river_id = 'R_GANJIANG_WEST',   s.district_code = '360113', s.station_type = 'industrial_park',  s.longitude = 115.8130, s.latitude = 28.7520;
MERGE (s:Station {station_id: 'NC_IP002'}) SET s.name = '高新区艾溪湖工业站',    s.river_id = 'R_YUHE',            s.district_code = '360111', s.station_type = 'industrial_park',  s.longitude = 115.9890, s.latitude = 28.6830;
MERGE (s:Station {station_id: 'NC_IP003'}) SET s.name = '进贤工业园工业站',      s.river_id = 'R_FUHE',            s.district_code = '360124', s.station_type = 'industrial_park',  s.longitude = 116.3520, s.latitude = 28.3680;

// 跨界断面
MERGE (s:Station {station_id: 'NC_BS001'}) SET s.name = '赣江入鄱阳湖断面站',    s.river_id = 'R_GANJIANG',        s.district_code = '360112', s.station_type = 'boundary_section', s.longitude = 116.1720, s.latitude = 28.9780;
MERGE (s:Station {station_id: 'NC_BS002'}) SET s.name = '抚河入鄱阳湖断面站',    s.river_id = 'R_FUHE',            s.district_code = '360124', s.station_type = 'boundary_section', s.longitude = 116.5480, s.latitude = 28.4820;
MERGE (s:Station {station_id: 'NC_BS003'}) SET s.name = '潦河入赣江断面站',      s.river_id = 'R_LIAOHE',          s.district_code = '360112', s.station_type = 'boundary_section', s.longitude = 115.7680, s.latitude = 28.8250;
MERGE (s:Station {station_id: 'NC_BS004'}) SET s.name = '锦江入赣江断面站',      s.river_id = 'R_JINJIANG_NC',     s.district_code = '360112', s.station_type = 'boundary_section', s.longitude = 115.7120, s.latitude = 28.4520;

// 农村水体
MERGE (s:Station {station_id: 'NC_RW001'}) SET s.name = '安义潦河上游乡村站',    s.river_id = 'R_LIAOHE',          s.district_code = '360123', s.station_type = 'rural_water',      s.longitude = 115.4820, s.latitude = 28.8510;
MERGE (s:Station {station_id: 'NC_RW002'}) SET s.name = '进贤抚河乡村站',        s.river_id = 'R_FUHE',            s.district_code = '360124', s.station_type = 'rural_water',      s.longitude = 116.2630, s.latitude = 28.3920;
MERGE (s:Station {station_id: 'NC_RW003'}) SET s.name = '南昌县东新乡村站',      s.river_id = 'R_GANJIANG',        s.district_code = '360121', s.station_type = 'rural_water',      s.longitude = 116.1280, s.latitude = 28.4820;
MERGE (s:Station {station_id: 'NC_RW004'}) SET s.name = '湾里象湖乡村站',        s.river_id = 'R_XIANHU',          s.district_code = '360104', s.station_type = 'rural_water',      s.longitude = 115.7280, s.latitude = 28.7520;
MERGE (s:Station {station_id: 'NC_RW005'}) SET s.name = '鄱阳湖南岸湖滨站',      s.river_id = 'R_GANJIANG',        s.district_code = '360112', s.station_type = 'rural_water',      s.longitude = 116.3580, s.latitude = 28.9420;

// ==============================================
// 2. ON_RIVER 关系（站点 → 所在河流）
// ==============================================

MATCH (s:Station), (r:River) WHERE s.river_id = r.river_id
MERGE (s)-[:ON_RIVER]->(r);

// ==============================================
// 3. IN_DISTRICT 关系（站点 → 所在行政区）
// ==============================================

MATCH (s:Station), (d:District) WHERE s.district_code = d.code
MERGE (s)-[:IN_DISTRICT]->(d);

// ==============================================
// 4. UPSTREAM_OF 关系（沿河顺流方向，与 PG station_upstream 对齐）
// ==============================================

// 赣江主干（南 → 北 → 鄱阳湖）
MATCH (s1:Station {station_id: 'NC_RW003'}), (s2:Station {station_id: 'NC_WS002'}) MERGE (s1)-[:UPSTREAM_OF {distance_km: 20.0}]->(s2);
MATCH (s1:Station {station_id: 'NC_WS002'}), (s2:Station {station_id: 'NC_BS001'}) MERGE (s1)-[:UPSTREAM_OF {distance_km: 35.0}]->(s2);

// 赣江西支
MATCH (s1:Station {station_id: 'NC_IP001'}), (s2:Station {station_id: 'NC_BS001'}) MERGE (s1)-[:UPSTREAM_OF {distance_km: 25.0}]->(s2);

// 玉带河 → 赣江
MATCH (s1:Station {station_id: 'NC_IP002'}), (s2:Station {station_id: 'NC_WS002'}) MERGE (s1)-[:UPSTREAM_OF {distance_km: 15.0}]->(s2);

// 象湖水系
MATCH (s1:Station {station_id: 'NC_WS001'}), (s2:Station {station_id: 'NC_RW004'}) MERGE (s1)-[:UPSTREAM_OF {distance_km: 12.0}]->(s2);
MATCH (s1:Station {station_id: 'NC_RW004'}), (s2:Station {station_id: 'NC_IP001'}) MERGE (s1)-[:UPSTREAM_OF {distance_km: 18.0}]->(s2);

// 潦河
MATCH (s1:Station {station_id: 'NC_RW001'}), (s2:Station {station_id: 'NC_BS003'}) MERGE (s1)-[:UPSTREAM_OF {distance_km: 40.0}]->(s2);

// 抚河
MATCH (s1:Station {station_id: 'NC_RW002'}), (s2:Station {station_id: 'NC_IP003'}) MERGE (s1)-[:UPSTREAM_OF {distance_km:  8.0}]->(s2);
MATCH (s1:Station {station_id: 'NC_IP003'}), (s2:Station {station_id: 'NC_BS002'}) MERGE (s1)-[:UPSTREAM_OF {distance_km: 28.0}]->(s2);

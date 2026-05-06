// ============================================================
// 南昌市站点拓扑补丁
// 在 03_monitoring_stations.cypher 的 UPSTREAM_OF 基础上：
//   1) 为所有已建关系补充 travel_hours 属性（按 distance_km/10 估算）
//   2) 补入几条跨河流汇入的追溯关系（赣江各支 → 赣江主干 → 鄱阳湖断面）
// 幂等：全部 MERGE/SET，可重复执行
// ============================================================

// ==============================================
// 1. 已存在 UPSTREAM_OF 关系批量补充 travel_hours
// ==============================================

MATCH (:Station)-[r:UPSTREAM_OF]->(:Station)
WHERE r.distance_km IS NOT NULL AND r.travel_hours IS NULL
SET r.travel_hours = r.distance_km / 10.0;

// ==============================================
// 2. 跨河汇入链：支流/分流 → 赣江主干入鄱阳湖断面
// ==============================================

// 赣江中支水源地 → 赣江入鄱阳湖断面（中支汇入北支之后入湖）
// 已在 03 定义为 NC_WS002 → NC_BS001，这里补属性
MATCH (up:Station {station_id: 'NC_WS002'}), (down:Station {station_id: 'NC_BS001'})
MERGE (up)-[r:UPSTREAM_OF]->(down) SET r.distance_km = 35.0, r.travel_hours = 3.5;

// 赣江西支工业站 → 赣江入鄱阳湖（经西支北行）
MATCH (up:Station {station_id: 'NC_IP001'}), (down:Station {station_id: 'NC_BS001'})
MERGE (up)-[r:UPSTREAM_OF]->(down) SET r.distance_km = 25.0, r.travel_hours = 2.5;

// 赣江北支溪霞水库 → 赣江入鄱阳湖断面
MATCH (up:Station {station_id: 'NC_WS003'}), (down:Station {station_id: 'NC_BS001'})
MERGE (up)-[r:UPSTREAM_OF]->(down) SET r.distance_km = 18.0, r.travel_hours = 1.8, r.cross_river = true;

// 玉带河（青山湖）高新区工业站 → 赣江中支水源地 → 赣江断面
MATCH (up:Station {station_id: 'NC_IP002'}), (down:Station {station_id: 'NC_WS002'})
MERGE (up)-[r:UPSTREAM_OF]->(down) SET r.distance_km = 15.0, r.travel_hours = 1.5, r.cross_river = true;

// 潦河入赣江后 → 赣江入鄱阳湖断面
MATCH (up:Station {station_id: 'NC_BS003'}), (down:Station {station_id: 'NC_BS001'})
MERGE (up)-[r:UPSTREAM_OF]->(down) SET r.distance_km = 45.0, r.travel_hours = 4.5, r.cross_river = true;

// 锦江入赣江后 → 南昌县东新（赣江下游）
MATCH (up:Station {station_id: 'NC_BS004'}), (down:Station {station_id: 'NC_RW003'})
MERGE (up)-[r:UPSTREAM_OF]->(down) SET r.distance_km = 42.0, r.travel_hours = 4.2, r.cross_river = true;

// 象湖水系 → 赣江西支入口（湾里象湖 → 南昌经开区）
// 已在 03 定义为 NC_RW004 → NC_IP001
MATCH (up:Station {station_id: 'NC_RW004'}), (down:Station {station_id: 'NC_IP001'})
MERGE (up)-[r:UPSTREAM_OF]->(down) SET r.distance_km = 18.0, r.travel_hours = 1.8, r.cross_river = true;

// 抚河入鄱阳湖断面 → 鄱阳湖南岸湖滨（入湖后湖面扩散）
MATCH (up:Station {station_id: 'NC_BS002'}), (down:Station {station_id: 'NC_RW005'})
MERGE (up)-[r:UPSTREAM_OF]->(down) SET r.distance_km = 55.0, r.travel_hours = 5.5, r.cross_river = true;

// 赣江入鄱阳湖断面 → 鄱阳湖南岸湖滨（湖面环流）
MATCH (up:Station {station_id: 'NC_BS001'}), (down:Station {station_id: 'NC_RW005'})
MERGE (up)-[r:UPSTREAM_OF]->(down) SET r.distance_km = 22.0, r.travel_hours = 2.2, r.cross_river = true;

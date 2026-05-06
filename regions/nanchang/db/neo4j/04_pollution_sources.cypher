// ============================================================
// 南昌市污染源数据（基于当地真实产业结构合理推测）
// 覆盖 9 个区县，涵盖工业 / 市政 / 农业三大类
// 产业画像：航空制造+卷烟（青云谱）、纺织食品（东湖）、高新电子 VIVO/欧菲光（青山湖）
//          经开区+江铃汽车（新建）、小蓝经开+医药（南昌县）、铝型材之都（安义）
//          医疗器械之都+钢铁笔业（进贤）、鄱阳湖水产养殖、鄱阳湖面源
// ============================================================

// ==============================================
// 约束与索引
// ==============================================

CREATE CONSTRAINT pollution_source_id IF NOT EXISTS FOR (s:PollutionSourceEntity) REQUIRE s.source_id IS UNIQUE;
CREATE INDEX pollution_source_type IF NOT EXISTS FOR (s:PollutionSourceEntity) ON (s.source_type);
CREATE INDEX pollution_source_river IF NOT EXISTS FOR (s:PollutionSourceEntity) ON (s.river_id);
CREATE INDEX pollution_source_district IF NOT EXISTS FOR (s:PollutionSourceEntity) ON (s.district_code);

// ==============================================
// 东湖区 (360102) - 老城区 + 纺织食品
// ==============================================

MERGE (s:PollutionSourceEntity:IndustrialSource {source_id: 'IND_DH_001'})
SET s.name = '东湖区老纺织厂区', s.source_type = 'textile', s.category = 'textile',
    s.river_id = 'R_YUHE', s.district_code = '360102', s.longitude = 115.9020, s.latitude = 28.6920,
    s.pollutants = ['codcr', 'color', 'ph', 'codmn'], s.discharge_volume = 1500, s.risk_level = 'medium';

MERGE (s:PollutionSourceEntity:MunicipalSource {source_id: 'MUN_DH_001'})
SET s.name = '东湖老城合流制溢流口', s.source_type = 'urban_runoff', s.category = 'stormwater',
    s.river_id = 'R_GANJIANG_MIDDLE', s.district_code = '360102', s.longitude = 115.8950, s.latitude = 28.6820,
    s.pollutants = ['turbidity', 'codmn', 'total_n'], s.area_km2 = 28, s.risk_level = 'medium';

// ==============================================
// 西湖区 (360103) - 服装贸易集群
// ==============================================

MERGE (s:PollutionSourceEntity:IndustrialSource {source_id: 'IND_XH_001'})
SET s.name = '西湖区服装产业园', s.source_type = 'garment', s.category = 'textile',
    s.river_id = 'R_GANJIANG_MIDDLE', s.district_code = '360103', s.longitude = 115.8720, s.latitude = 28.6520,
    s.pollutants = ['codcr', 'color', 'codmn', 'nh3_n'], s.discharge_volume = 1800, s.risk_level = 'medium';

MERGE (s:PollutionSourceEntity:MunicipalSource {source_id: 'MUN_XH_001'})
SET s.name = '西湖区朝阳污水处理厂', s.source_type = 'sewage_plant', s.category = 'municipal_sewage',
    s.river_id = 'R_GANJIANG_MIDDLE', s.district_code = '360103', s.longitude = 115.8680, s.latitude = 28.6480,
    s.pollutants = ['nh3_n', 'codmn', 'total_n', 'total_p'], s.capacity = 180000, s.risk_level = 'medium';

// ==============================================
// 青云谱区 (360104) - 航空工业 + 卷烟 + 象湖
// ==============================================

MERGE (s:PollutionSourceEntity:IndustrialSource {source_id: 'IND_QYP_001'})
SET s.name = '洪都航空工业集团厂区', s.source_type = 'aviation_manufacturing', s.category = 'aviation',
    s.river_id = 'R_XIANHU', s.district_code = '360104', s.longitude = 115.9120, s.latitude = 28.6180,
    s.pollutants = ['heavy_metals', 'oils', 'codcr', 'cyanide'], s.discharge_volume = 2800, s.risk_level = 'high';

MERGE (s:PollutionSourceEntity:IndustrialSource {source_id: 'IND_QYP_002'})
SET s.name = '南昌卷烟厂工业园', s.source_type = 'tobacco', s.category = 'food',
    s.river_id = 'R_XIANHU', s.district_code = '360104', s.longitude = 115.9080, s.latitude = 28.6250,
    s.pollutants = ['codcr', 'codmn', 'nh3_n'], s.discharge_volume = 1200, s.risk_level = 'medium';

MERGE (s:PollutionSourceEntity:MunicipalSource {source_id: 'MUN_QYP_001'})
SET s.name = '青云谱象湖污水处理厂', s.source_type = 'sewage_plant', s.category = 'municipal_sewage',
    s.river_id = 'R_XIANHU', s.district_code = '360104', s.longitude = 115.9050, s.latitude = 28.6100,
    s.pollutants = ['nh3_n', 'codmn', 'total_n', 'total_p'], s.capacity = 150000, s.risk_level = 'medium';

// ==============================================
// 青山湖区 (360111) - 高新 VIVO / 欧菲光 电子产业集群
// ==============================================

MERGE (s:PollutionSourceEntity:IndustrialSource {source_id: 'IND_QSH_001'})
SET s.name = '高新区艾溪湖电子信息园', s.source_type = 'electronics_manufacturing', s.category = 'electronics',
    s.river_id = 'R_YUHE', s.district_code = '360111', s.longitude = 115.9920, s.latitude = 28.6820,
    s.pollutants = ['heavy_metals', 'fluoride', 'ph', 'codcr'], s.discharge_volume = 3500, s.risk_level = 'high';

MERGE (s:PollutionSourceEntity:IndustrialSource {source_id: 'IND_QSH_002'})
SET s.name = '青山湖光学元件制造集群', s.source_type = 'optical_manufacturing', s.category = 'electronics',
    s.river_id = 'R_YUHE', s.district_code = '360111', s.longitude = 115.9780, s.latitude = 28.6720,
    s.pollutants = ['heavy_metals', 'codcr', 'fluoride'], s.discharge_volume = 2200, s.risk_level = 'high';

MERGE (s:PollutionSourceEntity:MunicipalSource {source_id: 'MUN_QSH_001'})
SET s.name = '青山湖污水处理厂', s.source_type = 'sewage_plant', s.category = 'municipal_sewage',
    s.river_id = 'R_YUHE', s.district_code = '360111', s.longitude = 115.9680, s.latitude = 28.6780,
    s.pollutants = ['nh3_n', 'codmn', 'total_n', 'total_p'], s.capacity = 220000, s.risk_level = 'medium';

// ==============================================
// 新建区 (360112) - 南昌经开区 + 江铃汽车
// ==============================================

MERGE (s:PollutionSourceEntity:IndustrialSource {source_id: 'IND_XJ_001'})
SET s.name = '南昌经开区汽车工业园（江铃）', s.source_type = 'auto_manufacturing', s.category = 'automotive',
    s.river_id = 'R_GANJIANG_WEST', s.district_code = '360112', s.longitude = 115.8180, s.latitude = 28.7620,
    s.pollutants = ['heavy_metals', 'oils', 'codcr', 'phosphate'], s.discharge_volume = 4200, s.risk_level = 'high';

MERGE (s:PollutionSourceEntity:IndustrialSource {source_id: 'IND_XJ_002'})
SET s.name = '新建经开区综合工业园', s.source_type = 'industrial_zone', s.category = 'mixed_industry',
    s.river_id = 'R_GANJIANG_WEST', s.district_code = '360112', s.longitude = 115.8020, s.latitude = 28.7450,
    s.pollutants = ['codcr', 'nh3_n', 'tss'], s.discharge_volume = 3000, s.risk_level = 'medium';

MERGE (s:PollutionSourceEntity:MunicipalSource {source_id: 'MUN_XJ_001'})
SET s.name = '新建区污水处理厂', s.source_type = 'sewage_plant', s.category = 'municipal_sewage',
    s.river_id = 'R_GANJIANG_WEST', s.district_code = '360112', s.longitude = 115.8120, s.latitude = 28.7380,
    s.pollutants = ['nh3_n', 'codmn', 'total_n', 'total_p'], s.capacity = 120000, s.risk_level = 'medium';

MERGE (s:PollutionSourceEntity:AgriculturalSource {source_id: 'AGR_XJ_001'})
SET s.name = '新建鄱阳湖南岸水产基地', s.source_type = 'aquaculture', s.category = 'fish_farm',
    s.river_id = 'R_GANJIANG_NORTH', s.district_code = '360112', s.longitude = 116.2120, s.latitude = 28.9520,
    s.pollutants = ['nh3_n', 'total_n', 'total_p'], s.area_km2 = 32, s.risk_level = 'high';

// ==============================================
// 红谷滩区 (360113) - 金融+商务 + 罗家集水源保护
// ==============================================

MERGE (s:PollutionSourceEntity:MunicipalSource {source_id: 'MUN_HGT_001'})
SET s.name = '红谷滩 CBD 污水处理厂', s.source_type = 'sewage_plant', s.category = 'municipal_sewage',
    s.river_id = 'R_GANJIANG_MIDDLE', s.district_code = '360113', s.longitude = 115.8350, s.latitude = 28.6750,
    s.pollutants = ['nh3_n', 'codmn', 'total_n'], s.capacity = 160000, s.risk_level = 'low';

MERGE (s:PollutionSourceEntity:MunicipalSource {source_id: 'MUN_HGT_002'})
SET s.name = '红谷滩城市径流面源', s.source_type = 'urban_runoff', s.category = 'stormwater',
    s.river_id = 'R_GANJIANG_WEST', s.district_code = '360113', s.longitude = 115.8250, s.latitude = 28.6880,
    s.pollutants = ['turbidity', 'codmn', 'total_n', 'oils'], s.area_km2 = 38, s.risk_level = 'medium';

// ==============================================
// 南昌县 (360121) - 小蓝经开区（汽车零部件 + 生物医药）
// ==============================================

MERGE (s:PollutionSourceEntity:IndustrialSource {source_id: 'IND_NCX_001'})
SET s.name = '小蓝经开区汽车零部件集群', s.source_type = 'auto_parts', s.category = 'automotive',
    s.river_id = 'R_GANJIANG', s.district_code = '360121', s.longitude = 116.0520, s.latitude = 28.5320,
    s.pollutants = ['heavy_metals', 'oils', 'codcr'], s.discharge_volume = 2800, s.risk_level = 'high';

MERGE (s:PollutionSourceEntity:IndustrialSource {source_id: 'IND_NCX_002'})
SET s.name = '小蓝经开区生物医药产业园', s.source_type = 'pharmaceutical', s.category = 'pharma',
    s.river_id = 'R_GANJIANG', s.district_code = '360121', s.longitude = 116.0680, s.latitude = 28.5420,
    s.pollutants = ['codcr', 'nh3_n', 'phenol', 'antibiotics'], s.discharge_volume = 2400, s.risk_level = 'high';

MERGE (s:PollutionSourceEntity:AgriculturalSource {source_id: 'AGR_NCX_001'})
SET s.name = '南昌县东新水稻基地', s.source_type = 'paddy_field', s.category = 'rice',
    s.river_id = 'R_GANJIANG', s.district_code = '360121', s.longitude = 116.1280, s.latitude = 28.4820,
    s.pollutants = ['total_n', 'total_p', 'pesticide'], s.area_km2 = 240, s.risk_level = 'medium';

MERGE (s:PollutionSourceEntity:MunicipalSource {source_id: 'MUN_NCX_001'})
SET s.name = '南昌县污水处理厂', s.source_type = 'sewage_plant', s.category = 'municipal_sewage',
    s.river_id = 'R_GANJIANG', s.district_code = '360121', s.longitude = 116.0350, s.latitude = 28.5480,
    s.pollutants = ['nh3_n', 'codmn', 'total_n'], s.capacity = 90000, s.risk_level = 'medium';

// ==============================================
// 安义县 (360123) - 中国铝型材之都
// ==============================================

MERGE (s:PollutionSourceEntity:IndustrialSource {source_id: 'IND_AY_001'})
SET s.name = '安义铝型材产业集群', s.source_type = 'aluminum_processing', s.category = 'metallurgy',
    s.river_id = 'R_LIAOHE', s.district_code = '360123', s.longitude = 115.5520, s.latitude = 28.8480,
    s.pollutants = ['heavy_metals', 'fluoride', 'ph', 'tss'], s.discharge_volume = 3800, s.risk_level = 'high';

MERGE (s:PollutionSourceEntity:IndustrialSource {source_id: 'IND_AY_002'})
SET s.name = '安义铝型材表面处理园', s.source_type = 'surface_treatment', s.category = 'metallurgy',
    s.river_id = 'R_LIAOHE', s.district_code = '360123', s.longitude = 115.5420, s.latitude = 28.8420,
    s.pollutants = ['heavy_metals', 'codcr', 'acid'], s.discharge_volume = 2000, s.risk_level = 'high';

MERGE (s:PollutionSourceEntity:MunicipalSource {source_id: 'MUN_AY_001'})
SET s.name = '安义县污水处理厂', s.source_type = 'sewage_plant', s.category = 'municipal_sewage',
    s.river_id = 'R_LIAOHE', s.district_code = '360123', s.longitude = 115.5480, s.latitude = 28.8440,
    s.pollutants = ['nh3_n', 'codmn', 'total_n'], s.capacity = 30000, s.risk_level = 'medium';

// ==============================================
// 进贤县 (360124) - 医疗器械之都 + 文港钢铁笔业
// ==============================================

MERGE (s:PollutionSourceEntity:IndustrialSource {source_id: 'IND_JX_001'})
SET s.name = '进贤医疗器械产业园', s.source_type = 'medical_device', s.category = 'medical',
    s.river_id = 'R_FUHE', s.district_code = '360124', s.longitude = 116.3550, s.latitude = 28.3720,
    s.pollutants = ['codcr', 'heavy_metals', 'solvent_residue'], s.discharge_volume = 2200, s.risk_level = 'high';

MERGE (s:PollutionSourceEntity:IndustrialSource {source_id: 'IND_JX_002'})
SET s.name = '文港钢铁笔业加工集群', s.source_type = 'metal_processing', s.category = 'manufacturing',
    s.river_id = 'R_FUHE', s.district_code = '360124', s.longitude = 116.2720, s.latitude = 28.3520,
    s.pollutants = ['heavy_metals', 'oils', 'tss'], s.discharge_volume = 1500, s.risk_level = 'medium';

MERGE (s:PollutionSourceEntity:AgriculturalSource {source_id: 'AGR_JX_001'})
SET s.name = '进贤军山湖大闸蟹养殖', s.source_type = 'aquaculture', s.category = 'crab_farm',
    s.river_id = 'R_FUHE', s.district_code = '360124', s.longitude = 116.4120, s.latitude = 28.4020,
    s.pollutants = ['nh3_n', 'total_n', 'total_p', 'codmn'], s.area_km2 = 45, s.risk_level = 'medium';

MERGE (s:PollutionSourceEntity:MunicipalSource {source_id: 'MUN_JX_001'})
SET s.name = '进贤县污水处理厂', s.source_type = 'sewage_plant', s.category = 'municipal_sewage',
    s.river_id = 'R_FUHE', s.district_code = '360124', s.longitude = 116.2450, s.latitude = 28.3780,
    s.pollutants = ['nh3_n', 'codmn', 'total_n'], s.capacity = 40000, s.risk_level = 'medium';

// ==============================================
// 关系：污染源 -[LOCATED_IN]-> 行政区
// ==============================================

MATCH (ps:PollutionSourceEntity), (d:District) WHERE ps.district_code = d.code
MERGE (ps)-[:LOCATED_IN]->(d);

// ==============================================
// 关系：污染源 -[DISCHARGES_TO]-> 河流
//    关系名与后端 graph_admin.py snapshot 查询一致
// ==============================================

MATCH (ps:PollutionSourceEntity), (r:River) WHERE ps.river_id = r.river_id
MERGE (ps)-[:DISCHARGES_TO]->(r);

// ==============================================
// 关系：污染源 -[UPSTREAM_OF]-> 监测站点（同河流、地理临近）
//    后端查询映射为前端 POLLUTION_UPSTREAM_OF 只读展示
// ==============================================

MATCH (ps:PollutionSourceEntity), (st:Station)
WHERE ps.river_id = st.river_id
  AND abs(ps.longitude - st.longitude) < 0.15
  AND abs(ps.latitude  - st.latitude)  < 0.15
MERGE (ps)-[:UPSTREAM_OF {distance_km: round(111.0 * sqrt((ps.longitude - st.longitude)^2 + (ps.latitude - st.latitude)^2) * 10) / 10}]->(st);

// ============================================================
// 南昌市历史污染事件（基于南昌实际产业与鄱阳湖/赣江治理重点合理推测）
// 事件主题：
//   - 赣江入鄱阳湖断面 CODMn 异常（春汛面源+上游累积）
//   - 抚河进贤段医疗器械废水
//   - 玉带河青山湖黑臭（高新电子+老旧合流）
//   - 象湖夏季蓝绿藻（青云谱老工业+面源）
//   - 南昌县小蓝经开区氨氮超标（汽车+医药）
//   - 潦河安义铝型材氟化物异常
//   - 鄱阳湖南岸春汛总磷偏高（水产面源+湖面扩散）
// 产出节点：PollutionEvent / Remediation
// 产出关系：OCCURRED_AT / ALONG_RIVER / MATCHES_TYPE / TREATED_BY / CAUSED / SIMILAR_TO
// ============================================================

// ==============================================
// 约束与索引
// ==============================================

CREATE CONSTRAINT pollution_event_case_id IF NOT EXISTS
FOR (e:PollutionEvent) REQUIRE e.case_id IS UNIQUE;

CREATE CONSTRAINT remediation_id IF NOT EXISTS
FOR (rm:Remediation) REQUIRE rm.remediation_id IS UNIQUE;

CREATE INDEX pollution_event_started_at IF NOT EXISTS
FOR (e:PollutionEvent) ON (e.started_at);

CREATE INDEX pollution_event_type IF NOT EXISTS
FOR (e:PollutionEvent) ON (e.pollution_type);

// ==============================================
// 1. 历史污染事件
// ==============================================

MERGE (e1:PollutionEvent {case_id: 'NC-2024-001'})
SET e1.title         = '赣江入鄱阳湖断面 CODMn 春汛异常',
    e1.pollution_type= 'organic_pollution',
    e1.severity      = 'high',
    e1.status        = 'resolved',
    e1.peak_value    = 8.6,
    e1.metric        = 'codmn',
    e1.started_at    = datetime('2024-04-08T06:00:00+08:00'),
    e1.resolved_at   = datetime('2024-04-11T18:00:00+08:00'),
    e1.affected_stations = ['NC_BS001','NC_RW005'],
    e1.description   = '春汛叠加上游面源冲刷，赣江入湖口有机物峰值 8.6 mg/L';

MERGE (e2:PollutionEvent {case_id: 'NC-2024-002'})
SET e2.title         = '抚河进贤段医疗器械废水 COD 超标',
    e2.pollution_type= 'industrial_wastewater',
    e2.severity      = 'high',
    e2.status        = 'resolved',
    e2.peak_value    = 62.0,
    e2.metric        = 'codcr',
    e2.started_at    = datetime('2024-06-14T22:00:00+08:00'),
    e2.resolved_at   = datetime('2024-06-17T10:00:00+08:00'),
    e2.affected_stations = ['NC_IP003','NC_BS002'],
    e2.description   = '医疗器械产业园夜间排放含溶剂废水，抚河进贤下游 COD 异常';

MERGE (e3:PollutionEvent {case_id: 'NC-2024-003'})
SET e3.title         = '玉带河青山湖段黑臭水体',
    e3.pollution_type= 'black_odor',
    e3.severity      = 'high',
    e3.status        = 'resolved',
    e3.peak_value    = 1.5,
    e3.metric        = 'do',
    e3.started_at    = datetime('2024-05-28T08:00:00+08:00'),
    e3.resolved_at   = datetime('2024-07-12T18:00:00+08:00'),
    e3.affected_stations = ['NC_IP002'],
    e3.description   = '青山湖高新电子园区与老旧合流管网溢流叠加，DO 降至 1.5 mg/L';

MERGE (e4:PollutionEvent {case_id: 'NC-2024-004'})
SET e4.title         = '象湖夏季蓝绿藻暴发',
    e4.pollution_type= 'algae_bloom',
    e4.severity      = 'critical',
    e4.status        = 'resolved',
    e4.peak_value    = 24000,
    e4.metric        = 'blue_green_algae',
    e4.started_at    = datetime('2024-08-03T11:00:00+08:00'),
    e4.resolved_at   = datetime('2024-08-28T17:00:00+08:00'),
    e4.affected_stations = ['NC_WS001','NC_RW004'],
    e4.description   = '青云谱老工业区营养盐累积叠加高温，象湖面源引发蓝绿藻暴发';

MERGE (e5:PollutionEvent {case_id: 'NC-2024-005'})
SET e5.title         = '南昌县小蓝经开区氨氮超标',
    e5.pollution_type= 'industrial_wastewater',
    e5.severity      = 'high',
    e5.status        = 'resolved',
    e5.peak_value    = 4.5,
    e5.metric        = 'nh3_n',
    e5.started_at    = datetime('2024-09-20T19:00:00+08:00'),
    e5.resolved_at   = datetime('2024-09-23T14:00:00+08:00'),
    e5.affected_stations = ['NC_RW003','NC_BS001'],
    e5.description   = '小蓝经开区生物医药+汽车零部件集中排放，下游赣江氨氮峰值 4.5 mg/L';

MERGE (e6:PollutionEvent {case_id: 'NC-2025-001'})
SET e6.title         = '潦河安义铝型材氟化物异常',
    e6.pollution_type= 'industrial_wastewater',
    e6.severity      = 'high',
    e6.status        = 'resolved',
    e6.peak_value    = 2.4,
    e6.metric        = 'fluoride',
    e6.started_at    = datetime('2025-03-05T14:00:00+08:00'),
    e6.resolved_at   = datetime('2025-03-08T10:00:00+08:00'),
    e6.affected_stations = ['NC_RW001','NC_BS003'],
    e6.description   = '安义铝型材表面处理车间酸洗废液管控失当，潦河上游氟化物飙升';

MERGE (e7:PollutionEvent {case_id: 'NC-2024-006'})
SET e7.title         = '鄱阳湖南岸春汛总磷偏高',
    e7.pollution_type= 'agricultural_runoff',
    e7.severity      = 'medium',
    e7.status        = 'resolved',
    e7.peak_value    = 0.25,
    e7.metric        = 'total_p',
    e7.started_at    = datetime('2024-03-22T09:00:00+08:00'),
    e7.resolved_at   = datetime('2024-03-30T16:00:00+08:00'),
    e7.affected_stations = ['NC_RW005'],
    e7.description   = '新建鄱阳湖南岸水产基地春投饵料集中叠加初春降雨冲刷';

// ==============================================
// 2. 事件 - 站点 (OCCURRED_AT)
// ==============================================

MATCH (e:PollutionEvent)
UNWIND e.affected_stations AS sid
MATCH (s:Station) WHERE s.station_id = sid
MERGE (e)-[:OCCURRED_AT]->(s);

// ==============================================
// 3. 事件 - 河流 (ALONG_RIVER)
// ==============================================

MATCH (e:PollutionEvent {case_id:'NC-2024-001'}), (r:River {river_id:'R_GANJIANG'})        MERGE (e)-[:ALONG_RIVER]->(r);
MATCH (e:PollutionEvent {case_id:'NC-2024-002'}), (r:River {river_id:'R_FUHE'})            MERGE (e)-[:ALONG_RIVER]->(r);
MATCH (e:PollutionEvent {case_id:'NC-2024-003'}), (r:River {river_id:'R_YUHE'})            MERGE (e)-[:ALONG_RIVER]->(r);
MATCH (e:PollutionEvent {case_id:'NC-2024-004'}), (r:River {river_id:'R_XIANHU'})          MERGE (e)-[:ALONG_RIVER]->(r);
MATCH (e:PollutionEvent {case_id:'NC-2024-005'}), (r:River {river_id:'R_GANJIANG'})        MERGE (e)-[:ALONG_RIVER]->(r);
MATCH (e:PollutionEvent {case_id:'NC-2025-001'}), (r:River {river_id:'R_LIAOHE'})          MERGE (e)-[:ALONG_RIVER]->(r);
MATCH (e:PollutionEvent {case_id:'NC-2024-006'}), (r:River {river_id:'R_GANJIANG_NORTH'})  MERGE (e)-[:ALONG_RIVER]->(r);

// ==============================================
// 4. 事件 → 污染类型 (MATCHES_TYPE)
// ==============================================

MATCH (e:PollutionEvent), (pt:PollutionType)
WHERE e.pollution_type = pt.code OR e.pollution_type = pt.type_code
MERGE (e)-[:MATCHES_TYPE]->(pt);

// ==============================================
// 5. 治理措施 (Remediation) & TREATED_BY
// ==============================================

MERGE (rm1:Remediation {remediation_id:'RM-NC-001'})
SET rm1.name = '沿江排污口联合执法+上游面源排查',
    rm1.duration_hours = 84, rm1.cost_rmb = 320000, rm1.effectiveness = 'high';
MATCH (e:PollutionEvent {case_id:'NC-2024-001'}), (rm:Remediation {remediation_id:'RM-NC-001'})
MERGE (e)-[:TREATED_BY]->(rm);

MERGE (rm2:Remediation {remediation_id:'RM-NC-002'})
SET rm2.name = '医疗器械园区夜排稽查+末端活性炭增设',
    rm2.duration_hours = 60, rm2.cost_rmb = 280000, rm2.effectiveness = 'high';
MATCH (e:PollutionEvent {case_id:'NC-2024-002'}), (rm:Remediation {remediation_id:'RM-NC-002'})
MERGE (e)-[:TREATED_BY]->(rm);

MERGE (rm3:Remediation {remediation_id:'RM-NC-003'})
SET rm3.name = '玉带河清淤+应急曝气+高新园区雨污分流',
    rm3.duration_hours = 1080, rm3.cost_rmb = 4500000, rm3.effectiveness = 'high';
MATCH (e:PollutionEvent {case_id:'NC-2024-003'}), (rm:Remediation {remediation_id:'RM-NC-003'})
MERGE (e)-[:TREATED_BY]->(rm);

MERGE (rm4:Remediation {remediation_id:'RM-NC-004'})
SET rm4.name = '象湖生物操纵+营养盐拦截+底泥改性',
    rm4.duration_hours = 600, rm4.cost_rmb = 1800000, rm4.effectiveness = 'high';
MATCH (e:PollutionEvent {case_id:'NC-2024-004'}), (rm:Remediation {remediation_id:'RM-NC-004'})
MERGE (e)-[:TREATED_BY]->(rm);

MERGE (rm5:Remediation {remediation_id:'RM-NC-005'})
SET rm5.name = '小蓝经开区污水厂提标+企业限产',
    rm5.duration_hours = 67, rm5.cost_rmb = 380000, rm5.effectiveness = 'high';
MATCH (e:PollutionEvent {case_id:'NC-2024-005'}), (rm:Remediation {remediation_id:'RM-NC-005'})
MERGE (e)-[:TREATED_BY]->(rm);

MERGE (rm6:Remediation {remediation_id:'RM-NC-006'})
SET rm6.name = '安义铝型材氟化物拦截+酸洗废液闭环',
    rm6.duration_hours = 68, rm6.cost_rmb = 520000, rm6.effectiveness = 'high';
MATCH (e:PollutionEvent {case_id:'NC-2025-001'}), (rm:Remediation {remediation_id:'RM-NC-006'})
MERGE (e)-[:TREATED_BY]->(rm);

MERGE (rm7:Remediation {remediation_id:'RM-NC-007'})
SET rm7.name = '水产基地饵料减量+生态浮床',
    rm7.duration_hours = 192, rm7.cost_rmb = 180000, rm7.effectiveness = 'medium';
MATCH (e:PollutionEvent {case_id:'NC-2024-006'}), (rm:Remediation {remediation_id:'RM-NC-007'})
MERGE (e)-[:TREATED_BY]->(rm);

// ==============================================
// 6. 污染源 → 事件 (CAUSED) 精确绑定
// ==============================================

MATCH (e:PollutionEvent {case_id:'NC-2024-001'}),
      (ps:PollutionSourceEntity) WHERE ps.category IN ['paddy_field','fish_farm'] AND ps.river_id = 'R_GANJIANG'
MERGE (ps)-[:CAUSED]->(e);

MATCH (e:PollutionEvent {case_id:'NC-2024-002'}),
      (ps:PollutionSourceEntity {source_id:'IND_JX_001'})
MERGE (ps)-[:CAUSED]->(e);

MATCH (e:PollutionEvent {case_id:'NC-2024-003'}),
      (ps:PollutionSourceEntity {source_id:'IND_QSH_001'})
MERGE (ps)-[:CAUSED]->(e);

MATCH (e:PollutionEvent {case_id:'NC-2024-004'}),
      (ps:PollutionSourceEntity) WHERE ps.district_code = '360104'
MERGE (ps)-[:CAUSED]->(e);

MATCH (e:PollutionEvent {case_id:'NC-2024-005'}),
      (ps:PollutionSourceEntity) WHERE ps.source_id IN ['IND_NCX_001','IND_NCX_002']
MERGE (ps)-[:CAUSED]->(e);

MATCH (e:PollutionEvent {case_id:'NC-2025-001'}),
      (ps:PollutionSourceEntity {source_id:'IND_AY_002'})
MERGE (ps)-[:CAUSED]->(e);

MATCH (e:PollutionEvent {case_id:'NC-2024-006'}),
      (ps:PollutionSourceEntity {source_id:'AGR_XJ_001'})
MERGE (ps)-[:CAUSED]->(e);

// ==============================================
// 7. 事件 - 事件：相似 (SIMILAR_TO)
// ==============================================

MATCH (e1:PollutionEvent {case_id:'NC-2024-001'}), (e2:PollutionEvent {case_id:'NC-2024-005'})
MERGE (e1)-[:SIMILAR_TO {score:0.78, reason:'均为赣江干流下游有机物/氮异常'}]->(e2);

MATCH (e1:PollutionEvent {case_id:'NC-2024-002'}), (e2:PollutionEvent {case_id:'NC-2025-001'})
MERGE (e1)-[:SIMILAR_TO {score:0.74, reason:'均为工业园区含溶剂/氟化物异常排放'}]->(e2);

MATCH (e1:PollutionEvent {case_id:'NC-2024-003'}), (e2:PollutionEvent {case_id:'NC-2024-004'})
MERGE (e1)-[:SIMILAR_TO {score:0.66, reason:'均为城市内湖/内河水质恶化'}]->(e2);

MATCH (e1:PollutionEvent {case_id:'NC-2024-001'}), (e2:PollutionEvent {case_id:'NC-2024-006'})
MERGE (e1)-[:SIMILAR_TO {score:0.60, reason:'均为鄱阳湖入湖区面源/春汛相关'}]->(e2);

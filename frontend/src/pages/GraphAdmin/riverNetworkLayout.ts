/**
 * 水系拓扑画布布局引擎 v2 —— 桑基式从右到左（高级别干流在左、低级别源头/支流在右），水系自上而下分泳道
 *
 * 核心理念：
 *   - 河流宽度 = max(站点数 × STATION_PITCH, maxRiverKm × PX_PER_KM, MIN_RIVER_WIDTH)
 *   - 河流之间的拓扑关系（FLOWS_INTO + 交汇点折叠）决定列号
 *   - 干流贴泳道基线；支流以干流为树根的**多叉树**向右递归展开，每个子树按叶子数占有独立 y 带
 *   - 孤立河流追加到水系底部
 *   - 污染源按河流分组均匀布在河流上方，上下双层交错避免重叠
 *
 * Pipeline：
 *   A  按 sub_system 分泳道（baseY 层级从上到下）
 *   B  站点定位 km 计算：优先使用 river_km（Neo4j 绝对桩号），无桩号时回退 UPSTREAM_OF BFS 累加
 *   C  构建 "河流 → 河流" DAG（FLOWS_INTO 直连 + 经交汇点折叠虚边）
 *   D  每泳道 Kahn 拓扑分层 → column 编号
 *   E  干流/支流判定：level=1 或 水系内终端河流视为干流
 *   F  按 column 逆序计算干流 x；支流构多叉树，按子树叶子数等比分配 y 带，按树深度递增 x
 *   G  站点沿河流条按定位 km 精确铺开（右→左，0=源头贴右端）
 *   H  交汇点贴 in/out 河流衔接处；污染源按河流分组均匀布列 + 双层交错
 */

export const STATION_PITCH = 150;        // 站点最小可读间距（高密度保护）
export const PX_PER_KM = 16;             // 站点在河流上按 river_km 比例定位的像素/千米
export const RIVER_PADDING = 80;          // 河流条两端留白
export const MIN_RIVER_WIDTH = 360;       // 无站点/站点极少时的最小宽度
export const COL_GAP = 400;               // 相邻列之间的间隔
export const BRANCH_Y_STEP = 500;         // 支流相对干流的 y 偏移步长（预留河流上方污染源 + 下方站点空间）
export const MAINLINE_ROW_GAP = 500;      // 同列多条干流时的 y 偏移

// 各水系的基线 y（自上而下分泳道）
// 支持中文键（赣州旧数据）和英文键（南昌等新区域）
const SUB_SYSTEM_BASE_Y: Record<string, number> = {
  '赣江水系': 500,
  'Ganjiang': 500,
  '东江水系': 1500,
  'Dongjiang': 1500,
  '北江水系': 2500,
  'Beijiang': 2500,
  'Fuhe': 1500,
  '抚河水系': 1500,
  '巢湖水系': 500,
  'Chaohu': 500,
};
const DEFAULT_BASE_Y = 3500;
const ORPHAN_Y_OFFSET = 900;              // 孤立河流相对水系 baseY 的下沉

export interface RiverRaw {
  river_id: string;
  name?: string;
  level?: number;
  system?: string;
  sub_system?: string;
  length_km?: number;
  [key: string]: any;
}

export interface StationRaw {
  station_id?: string;
  station_code?: string;
  station_name?: string;
  river_id?: string;
  river_km?: number;
  longitude?: number;
  latitude?: number;
  [key: string]: any;
}

export interface ConfluenceRaw {
  confluence_id: string;
  name?: string;
  longitude?: number;
  latitude?: number;
  confluence_type?: string;      // 'merge' | 'tributary'
  through_river_id?: string;     // 汇入型时贯通的主河流
  [key: string]: any;
}

export interface PollutionRaw {
  source_id: string;
  name?: string;
  river_id?: string;
  [key: string]: any;
}

export interface GraphEdgeRaw {
  source: string;
  target: string;
  type: string;
  props?: Record<string, any>;
}

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
  riverExtents: Map<string, { x: number; y: number; width: number }>;
  /** 汇入型交汇点所在的 through_river 及 x 偏移（用于构建河流顶部端口） */
  tributaryOnRiver: Map<string, { throughRiverId: string; portX: number }>;
}

function baseYOf(subSystem?: string): number {
  if (subSystem && SUB_SYSTEM_BASE_Y[subSystem] !== undefined) {
    return SUB_SYSTEM_BASE_Y[subSystem];
  }
  return DEFAULT_BASE_Y;
}

const stationKey = (s: StationRaw): string =>
  (s.station_code || s.station_id || '') as string;

export function computeRiverNetworkLayout(
  rivers: RiverRaw[],
  stations: StationRaw[],
  confluences: ConfluenceRaw[],
  pollutions: PollutionRaw[],
  edges: GraphEdgeRaw[],
  savedCoords?: Map<string, { x: number; y: number }>,
): LayoutResult {
  const positions = new Map<string, { x: number; y: number }>();
  const riverExtents = new Map<string, { x: number; y: number; width: number }>();
  const tributaryOnRiverMap = new Map<string, { throughRiverId: string; portX: number }>();

  const riverById = new Map<string, RiverRaw>();
  rivers.forEach((r) => riverById.set(r.river_id, r));

  // ========== Step A: 分水系 ==========
  const bySubSystem = new Map<string, RiverRaw[]>();
  rivers.forEach((r) => {
    const key = r.sub_system || r.system || '__unknown__';
    if (!bySubSystem.has(key)) bySubSystem.set(key, []);
    bySubSystem.get(key)!.push(r);
  });

  // ========== Step B: 站点定位 km 计算（优先 river_km，回退 BFS）+ 河流宽度 ==========
  // river_km 是 Neo4j 中的绝对桩号（0=源头），优先使用；
  // 缺 river_km 的站点回退 UPSTREAM_OF 边 BFS 累加 distance_km；
  // 仍无法定位的站点按字母序附加到末尾，以虚拟 2km 步距占位。
  const upstreamEdges = edges.filter((e) => e.type === 'UPSTREAM_OF');
  const nextOfStation = new Map<string, Array<{ to: string; distance_km?: number }>>();
  const prevOfStation = new Map<string, string[]>();
  upstreamEdges.forEach((e) => {
    if (!nextOfStation.has(e.source)) nextOfStation.set(e.source, []);
    nextOfStation.get(e.source)!.push({ to: e.target, distance_km: e.props?.distance_km });
    if (!prevOfStation.has(e.target)) prevOfStation.set(e.target, []);
    prevOfStation.get(e.target)!.push(e.source);
  });

  const stationsByRiver = new Map<string, StationRaw[]>();
  stations.forEach((s) => {
    if (!s.river_id) return;
    if (!stationsByRiver.has(s.river_id)) stationsByRiver.set(s.river_id, []);
    stationsByRiver.get(s.river_id)!.push(s);
  });

  // posKm: 每个站点在河流上的定位公里数（0=源头）
  const posKmOfStation = new Map<string, number>();
  const maxPosKmOfRiver = new Map<string, number>();

  stationsByRiver.forEach((group, rid) => {
    const keyToStation = new Map<string, StationRaw>();
    group.forEach((s) => keyToStation.set(stationKey(s), s));
    const keys = new Set(keyToStation.keys());

    // 第一轮：有 river_km 的站点直接采用
    group.forEach((s) => {
      if (s.river_km != null && s.river_km >= 0) {
        posKmOfStation.set(stationKey(s), s.river_km);
      }
    });

    // 第二轮：缺 river_km 的站点走 BFS 回退
    const needBfs = group.filter((s) => !posKmOfStation.has(stationKey(s)));
    if (needBfs.length > 0) {
      const sources = needBfs.filter((s) => {
        const prev = prevOfStation.get(stationKey(s)) || [];
        return !prev.some((p) => keys.has(p));
      });
      const q: Array<{ key: string; cum: number }> = [];
      sources.forEach((s) => {
        const k = stationKey(s);
        if (!posKmOfStation.has(k)) {
          posKmOfStation.set(k, 0);
          q.push({ key: k, cum: 0 });
        }
      });
      while (q.length > 0) {
        const { key, cum } = q.shift()!;
        const nexts = nextOfStation.get(key) || [];
        nexts.forEach((n) => {
          if (!keys.has(n.to) || posKmOfStation.has(n.to)) return;
          const c = cum + (n.distance_km || 0);
          posKmOfStation.set(n.to, c);
          q.push({ key: n.to, cum: c });
        });
      }
    }

    // 第三轮：仍无法定位的站点按字母序附加到末尾
    const maxAssigned = Math.max(0, ...[...posKmOfStation.entries()]
      .filter(([k]) => keys.has(k))
      .map(([, v]) => v));
    const missing = group
      .filter((s) => !posKmOfStation.has(stationKey(s)))
      .sort((a, b) => stationKey(a).localeCompare(stationKey(b)));
    missing.forEach((s, i) => {
      posKmOfStation.set(stationKey(s), maxAssigned + (i + 1) * 2);
    });

    const finalMax = Math.max(0, ...group.map((s) => posKmOfStation.get(stationKey(s)) || 0));
    maxPosKmOfRiver.set(rid, finalMax);
  });

  // 河流宽度 = max(MIN_RIVER_WIDTH, maxPosKm × PX_PER_KM + padding, 站点数 × STATION_PITCH + padding)
  const riverW = new Map<string, number>();
  rivers.forEach((r) => {
    const stationCount = stationsByRiver.get(r.river_id)?.length || 0;
    const maxKm = maxPosKmOfRiver.get(r.river_id) || 0;
    const wByKm = maxKm * PX_PER_KM + RIVER_PADDING * 2;
    const wByPitch = stationCount * STATION_PITCH + RIVER_PADDING * 2;
    riverW.set(r.river_id, Math.max(MIN_RIVER_WIDTH, wByKm, wByPitch));
  });

  // ========== Step C: 河流 → 河流 DAG ==========
  // 交汇点折叠：每个交汇点 c 的所有 in × 所有 out 生成虚边
  const cfIn = new Map<string, string[]>();   // confluenceId -> r_i[]
  const cfOut = new Map<string, string[]>();  // confluenceId -> r_o[]
  edges.filter((e) => e.type === 'FLOWS_INTO_CONFLUENCE').forEach((e) => {
    if (!cfIn.has(e.target)) cfIn.set(e.target, []);
    cfIn.get(e.target)!.push(e.source);
  });
  edges.filter((e) => e.type === 'CONFLUENCE_FLOWS_TO').forEach((e) => {
    if (!cfOut.has(e.source)) cfOut.set(e.source, []);
    cfOut.get(e.source)!.push(e.target);
  });

  interface RREdge { from: string; to: string; via?: string; }
  const rrEdges: RREdge[] = [];
  edges.filter((e) => e.type === 'FLOWS_INTO').forEach((e) => {
    rrEdges.push({ from: e.source, to: e.target });
  });
  confluences.forEach((c) => {
    const ins = cfIn.get(c.confluence_id) || [];
    const outs = cfOut.get(c.confluence_id) || [];
    ins.forEach((ri) => {
      outs.forEach((ro) => {
        rrEdges.push({ from: ri, to: ro, via: c.confluence_id });
      });
    });
  });

  // ========== 按水系循环 ==========
  bySubSystem.forEach((group, subSys) => {
    const baseY = baseYOf(subSys);
    const groupIds = new Set(group.map((r) => r.river_id));
    const localEdges = rrEdges.filter((e) => groupIds.has(e.from) && groupIds.has(e.to));

    // ===== Step D: Kahn 拓扑分层 =====
    const indeg = new Map<string, number>();
    const adj = new Map<string, string[]>();
    group.forEach((r) => {
      indeg.set(r.river_id, 0);
      adj.set(r.river_id, []);
    });
    localEdges.forEach((e) => {
      indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
      adj.get(e.from)!.push(e.to);
    });
    const column = new Map<string, number>();
    const queue: string[] = [];
    indeg.forEach((v, k) => {
      if (v === 0) {
        column.set(k, 0);
        queue.push(k);
      }
    });
    while (queue.length > 0) {
      const x = queue.shift()!;
      const xcol = column.get(x) || 0;
      adj.get(x)!.forEach((y) => {
        column.set(y, Math.max(column.get(y) || 0, xcol + 1));
        indeg.set(y, (indeg.get(y) || 0) - 1);
        if (indeg.get(y) === 0) queue.push(y);
      });
    }

    // ===== Step E: 干流 / 支流 / 孤立 判定 =====
    // 孤立：没有任何水系内 FLOWS_INTO/交汇 关系（既不是 from 也不是 to）
    const involved = new Set<string>();
    localEdges.forEach((e) => { involved.add(e.from); involved.add(e.to); });
    const orphanIds = new Set<string>();
    group.forEach((r) => {
      if (!involved.has(r.river_id)) orphanIds.add(r.river_id);
    });

    // 终端：在水系内无 FLOWS_INTO 下游（localEdges.from 里不含它）
    const hasLocalDown = new Set<string>();
    localEdges.forEach((e) => hasLocalDown.add(e.from));
    const terminalIds = new Set<string>();
    group.forEach((r) => {
      if (orphanIds.has(r.river_id)) return;
      if (!hasLocalDown.has(r.river_id)) terminalIds.add(r.river_id);
    });

    // 干流：level=1 或 终端河流（按用户约定：用 FLOWS_INTO 下游是否存在判定终端）
    const mainlineIds = new Set<string>();
    group.forEach((r) => {
      if (orphanIds.has(r.river_id)) return;
      if (r.level === 1 || terminalIds.has(r.river_id)) mainlineIds.add(r.river_id);
    });

    // ===== Step F: 定位 =====
    // 1) 干流按 column 逆序横向排开贴基线（column 大即下游干流在左、column 小即源头在右）
    const cols = new Map<number, RiverRaw[]>();
    group.forEach((r) => {
      if (orphanIds.has(r.river_id)) return;
      const c = column.get(r.river_id);
      if (c === undefined) return;
      if (!cols.has(c)) cols.set(c, []);
      cols.get(c)!.push(r);
    });

    const colMaxW = new Map<number, number>();
    cols.forEach((list, c) => {
      const mainsW = list.filter((r) => mainlineIds.has(r.river_id)).map((r) => riverW.get(r.river_id)!);
      colMaxW.set(c, mainsW.length > 0 ? Math.max(...mainsW) : MIN_RIVER_WIDTH);
    });
    const colStartX = new Map<number, number>();
    // 反转：column 越大越靠左（下游/干流端），column 越小越靠右（源头端）
    const sortedCols = [...cols.keys()].sort((a, b) => b - a);
    let cursor = 0;
    sortedCols.forEach((c) => {
      colStartX.set(c, cursor);
      cursor += (colMaxW.get(c) || MIN_RIVER_WIDTH) + COL_GAP;
    });

    // 先放干流
    sortedCols.forEach((c) => {
      const mains = cols.get(c)!.filter((r) => mainlineIds.has(r.river_id));
      mains.forEach((r, i) => {
        const yOffset = mains.length > 1
          ? (i - (mains.length - 1) / 2) * MAINLINE_ROW_GAP
          : 0;
        const x = colStartX.get(c)!;
        const y = baseY + yOffset;
        const w = riverW.get(r.river_id)!;
        positions.set(`river:${r.river_id}`, { x, y });
        riverExtents.set(r.river_id, { x, y, width: w });
      });
    });

    // 2) 支流：以干流为树根的多叉树布局
    //    沿 reverseAdj（下游→上游的反向邻接）多源 BFS 挂领支流，按最近下游干流分配子树
    //    y 按子树叶子数等比分配（每个子树拥有独立不冲突的 y 带），x 按树深度递增
    const reverseAdj = new Map<string, string[]>();
    localEdges.forEach((e) => {
      if (!reverseAdj.has(e.to)) reverseAdj.set(e.to, []);
      reverseAdj.get(e.to)!.push(e.from);
    });

    const treeChildren = new Map<string, string[]>();
    const treeDepth = new Map<string, number>();
    const treeVisited = new Set<string>(mainlineIds);
    const treeRoots = Array.from(mainlineIds);
    treeRoots.forEach((rid) => treeDepth.set(rid, 0));

    // 多源 BFS：越靠近干流的支流优先被认领，避免两条干流抢同一个支流
    const bfsQueue: Array<{ node: string; depth: number }> = treeRoots.map((r) => ({ node: r, depth: 0 }));
    while (bfsQueue.length > 0) {
      const { node, depth } = bfsQueue.shift()!;
      const ups = reverseAdj.get(node) || [];
      ups.forEach((u) => {
        if (treeVisited.has(u)) return;
        if (orphanIds.has(u)) return;
        treeVisited.add(u);
        treeDepth.set(u, depth + 1);
        if (!treeChildren.has(node)) treeChildren.set(node, []);
        treeChildren.get(node)!.push(u);
        bfsQueue.push({ node: u, depth: depth + 1 });
      });
    }

    // 未被认领的非干流非孤立 → 降级为孤立
    group.forEach((r) => {
      if (mainlineIds.has(r.river_id)) return;
      if (orphanIds.has(r.river_id)) return;
      if (!treeVisited.has(r.river_id)) orphanIds.add(r.river_id);
    });

    // 计算每个节点的叶子数（叶子自身=1）
    const leafCount = new Map<string, number>();
    const countLeaves = (n: string): number => {
      const cached = leafCount.get(n);
      if (cached !== undefined) return cached;
      const cs = treeChildren.get(n) || [];
      if (cs.length === 0) { leafCount.set(n, 1); return 1; }
      let sum = 0;
      cs.forEach((c) => { sum += countLeaves(c); });
      leafCount.set(n, sum);
      return sum;
    };
    treeRoots.forEach((mid) => countLeaves(mid));

    // 深度递增的 x 步长（每多一级支流向右再推一个节点宽 + 间隙）
    const X_PER_DEPTH = 480;
    const LEAF_Y = 380;  // 每叶子占用的 y 带高（站点/污染源卡片预留空间）

    // 递归布局：rootId 已放好，为其子在 yCenter±yHalfSpan 内按叶子数等比分配
    const layoutSubtree = (rootId: string, yCenter: number, yHalfSpan: number) => {
      const cs = treeChildren.get(rootId) || [];
      if (cs.length === 0) return;
      const rootExt = riverExtents.get(rootId);
      if (!rootExt) return;
      const totalLeaves = leafCount.get(rootId) || cs.length;
      let cumLeaves = 0;
      // 按 leaf 降序（大子树放到中间较稳定）
      const ordered = [...cs].sort((a, b) => (leafCount.get(b) || 1) - (leafCount.get(a) || 1));
      ordered.forEach((c) => {
        const cLeaves = leafCount.get(c) || 1;
        const ratioStart = cumLeaves / totalLeaves;
        const ratioEnd = (cumLeaves + cLeaves) / totalLeaves;
        const cBandTop = yCenter - yHalfSpan + ratioStart * 2 * yHalfSpan;
        const cBandBot = yCenter - yHalfSpan + ratioEnd * 2 * yHalfSpan;
        const cY = (cBandTop + cBandBot) / 2;
        cumLeaves += cLeaves;
        const cW = riverW.get(c)!;
        // 支流在树根右侧，按树深度递增 x（源头在最右）
        // 留出交汇点卡片宽度(200) + 两侧间距(160) 的空间
        const cX = rootExt.x + rootExt.width + 360 + (treeDepth.get(c)! - 1) * X_PER_DEPTH;
        positions.set(`river:${c}`, { x: cX, y: cY });
        riverExtents.set(c, { x: cX, y: cY, width: cW });
        layoutSubtree(c, cY, (cBandBot - cBandTop) / 2);
      });
    };

    treeRoots.forEach((mid) => {
      const mExt = riverExtents.get(mid);
      if (!mExt) return;
      const leaves = leafCount.get(mid) || 1;
      // 干流总 y 带半宽：按叶子数等比分配，上下各占 leaves * LEAF_Y / 2
      const halfSpan = Math.max(LEAF_Y * 1.2, (leaves * LEAF_Y) / 2);
      layoutSubtree(mid, mExt.y, halfSpan);
    });

    // 3) 孤立河流（含因无归属干流而升格的支流）：泳道底部一字排开
    const orphans = group.filter((r) => orphanIds.has(r.river_id));
    let orphanX = 0;
    orphans.forEach((r) => {
      const w = riverW.get(r.river_id)!;
      const y = baseY + ORPHAN_Y_OFFSET;
      positions.set(`river:${r.river_id}`, { x: orphanX, y });
      riverExtents.set(r.river_id, { x: orphanX, y, width: w });
      orphanX += w + 60;
    });
  });

  // ========== Step G: 站点按 river_km 精确定位 + 最小间距保护（河流卡片内部水流右→左，故 km=0 贴右端、km=max 贴左端）==========
  // posKmOfStation 已在 Step B 算好（优先 river_km，回退 BFS）
  stationsByRiver.forEach((group, rid) => {
    const ext = riverExtents.get(rid);
    if (!ext) return;
    // 按定位 km 升序（从上游到下游）
    const ordered = [...group].sort(
      (a, b) => (posKmOfStation.get(stationKey(a)) || 0) - (posKmOfStation.get(stationKey(b)) || 0),
    );
    // 翻转：上游在右，从河流右端往左累积；lastX 初始设为 +Infinity，每放一个向左收紧
    let lastX = Infinity;
    ordered.forEach((s) => {
      const km = posKmOfStation.get(stationKey(s)) || 0;
      let x = ext.x + ext.width - RIVER_PADDING - km * PX_PER_KM;
      if (x > lastX - STATION_PITCH) x = lastX - STATION_PITCH; // 防重叠（向左累积）
      // 不超出河流左端
      x = Math.max(x, ext.x + RIVER_PADDING / 2);
      positions.set(`station:${stationKey(s)}`, { x, y: ext.y + 80 });
      lastX = x;
    });
  });

  // ========== Step H: 交汇点（含卡片防撞递归推层）==========
  // 污染源布局常量（提前声明，汇入型定位依赖）
  const POLLUTION_Y_LAYER_GAP = 90;   // 上下两层的 y 间距
  const POLLUTION_BASE_UP = 140;      // 第一层向河流上方偏移
  // 统计画布的最大 y，孤立真实交汇点放最下方单独一带不干扰主拓扑
  let maxRiverBottom = 0;
  riverExtents.forEach((ext) => {
    if (ext.y > maxRiverBottom) maxRiverBottom = ext.y;
  });
  const orphanConfluenceBaseY = maxRiverBottom + 600;
  let orphanIdx = 0;
  
  // 交汇点卡片尺寸（KindNode 带 bizId 标签）的保守估计，用于碰撞检测
  const CF_CARD_W = 200;
  const CF_CARD_H = 54;
  const CF_LAYER_STEP = 180;         // 推层 y 步长（上下间距）
  const CF_MAX_LAYER = 8;            // 最多交替推层次数
  const CF_GAP_X = 100;              // 同层水平最小间隙（前后间距）
  const CF_GAP_Y = 160;              // 上下最小间隙（至少一个卡片高度的缓冲）
  // 已经落位的交汇点矩形列表 { x, y, w, h }
  const placedCf: Array<{ x: number; y: number; w: number; h: number }> = [];
  const isCollide = (x: number, y: number): boolean =>
    placedCf.some((p) => {
      const xOverlap = !(x + CF_CARD_W + CF_GAP_X < p.x || p.x + p.w + CF_GAP_X < x);
      const yOverlap = !(y + CF_CARD_H + CF_GAP_Y < p.y || p.y + p.h + CF_GAP_Y < y);
      return xOverlap && yOverlap;
    });
  
  // 先按"能定位的交汇点"排序（按期望 x 升序），先放的干流交汇点优先佔把基线层；
  // 后放的用交替收缩推层避开
  // 汇入型临时收集
  interface TribTemp { c: ConfluenceRaw; throughRid: string; throughExt: { x: number; y: number; width: number }; }
  const tribTemps: TribTemp[] = [];

  interface CFDesired { c: ConfluenceRaw; x: number; y: number; hasAnchor: boolean; }
  const desired: CFDesired[] = confluences.map((c) => {
    const ins = cfIn.get(c.confluence_id) || [];
    const outs = cfOut.get(c.confluence_id) || [];
    const inExts = ins.map((r) => riverExtents.get(r)).filter(Boolean) as Array<{ x: number; y: number; width: number }>;
    const outExts = outs.map((r) => riverExtents.get(r)).filter(Boolean) as Array<{ x: number; y: number; width: number }>;
    if (inExts.length === 0 && outExts.length === 0) {
      return { c, x: NaN, y: NaN, hasAnchor: false };
    }

    // 汇入型判定：
    //   1. 显式标记 confluence_type === 'tributary'
    //   2. 虚拟交汇点（vconf- 前缀，1入 1出）
    //   3. 拓扑结构推断：有至少 1 条入流河流 + 至少 1 条出流河流（典型支流汇入主河流模式）
    const isTributary = c.confluence_type === 'tributary'
      || (c.confluence_id.startsWith('vconf-') && ins.length === 1 && outs.length === 1)
      || (ins.length >= 1 && outs.length >= 1);  // 拓扑推断：有进有出即为汇入型
    const throughRid = c.through_river_id || (outs.length >= 1 ? outs[0] : undefined);

    if (isTributary && throughRid) {
      const throughExt = riverExtents.get(throughRid);
      if (throughExt) {
        // 收集汇入型，后续统一处理：交汇点与其支流河流同 Y 级别
        tribTemps.push({ c, throughRid, throughExt });
        return { c, x: NaN, y: NaN, hasAnchor: false }; // 占位，稍后覆写
      }
    }

    // 汇聚型 / 默认：交汇点在 in 河流左端与 out 河流右端之间中点
    const inLeft = inExts.length > 0
      ? inExts.reduce((a, e) => a + e.x, 0) / inExts.length
      : (outExts.reduce((a, e) => a + (e.x + e.width), 0) / outExts.length) + 100;
    const outRight = outExts.length > 0
      ? outExts.reduce((a, e) => a + (e.x + e.width), 0) / outExts.length
      : (inExts.reduce((a, e) => a + e.x, 0) / inExts.length) - 100;
    const midX = (inLeft + outRight) / 2 - CF_CARD_W / 2;
    const refY = outExts.length > 0
      ? outExts.reduce((a, e) => a + e.y, 0) / outExts.length
      : inExts.reduce((a, e) => a + e.y, 0) / inExts.length;
    return { c, x: midX, y: refY - 80, hasAnchor: true };
  });

  // ---- 汇入型交汇点：与其支流河流同 Y 级别，放在支流左端作为连接桥梁 ----
  tribTemps.forEach((t) => {
    const inRivers = cfIn.get(t.c.confluence_id) || [];
    // 找到支流河流的位置（支流流入交汇点，即 in 方向）
    const tributaryExts = inRivers.map((r) => riverExtents.get(r)).filter(Boolean) as Array<{ x: number; y: number; width: number }>;
    
    let cfX: number;
    let cfY: number;
    
    if (tributaryExts.length > 0) {
      // 交汇点与支流河流同 Y，放在支流左端外侧
      const tribExt = tributaryExts[0];
      cfX = tribExt.x - CF_CARD_W - 80;  // 支流左端向左偏移一个卡片宽 + 间距
      cfY = tribExt.y + (34 - CF_CARD_H) / 2;  // 对齐支流河流条中心（34=RiverBar高度）
    } else {
      // 无支流河流位置，回退到 through_river 上方
      cfX = t.throughExt.x + t.throughExt.width * 0.5 - CF_CARD_W / 2;
      cfY = t.throughExt.y - 200;
    }
    
    // 记录端口（用于连线判定交汇点在 through_river 上的接入位置）
    const portX = Math.max(0, Math.min(
      cfX + CF_CARD_W / 2 - t.throughExt.x,
      t.throughExt.width,
    ));
    tributaryOnRiverMap.set(t.c.confluence_id, {
      throughRiverId: t.throughRid,
      portX,
    });
    // 覆写 desired 中的占位项
    const slot = desired.find((d) => d.c.confluence_id === t.c.confluence_id);
    if (slot) {
      slot.x = cfX;
      slot.y = cfY;
      slot.hasAnchor = true;
    }
  });

  // 按期望 x 升序依次落位，冲突时交替上下推层
  desired
    .filter((d) => d.hasAnchor)
    .sort((a, b) => a.x - b.x)
    .forEach(({ c, x, y }) => {
      let fx = x;
      let fy = y;
      let layer = 0;
      while (isCollide(fx, fy) && layer < CF_MAX_LAYER) {
        layer += 1;
        // 交替方向：1 上, 2 下, 3 上两步, 4 下两步 ...
        const step = Math.ceil(layer / 2) * CF_LAYER_STEP;
        const dir = layer % 2 === 1 ? -1 : 1;
        fy = y + dir * step;
      }
      placedCf.push({ x: fx, y: fy, w: CF_CARD_W, h: CF_CARD_H });
      positions.set(`confluence:${c.confluence_id}`, { x: fx, y: fy });
    });
  // 孤立交汇点：最底带一字排开（宽度预留 CF_CARD_W + 间距）
  desired
    .filter((d) => !d.hasAnchor)
    .forEach(({ c }) => {
      const x = orphanIdx * (CF_CARD_W + 20);
      const y = orphanConfluenceBaseY + Math.floor(orphanIdx / 8) * 100;
      positions.set(`confluence:${c.confluence_id}`, { x, y });
      orphanIdx += 1;
    });

  // ========== 污染源：按河流分组均匀散列在河流上方，双层 y 交错避免重叠 ==========
  const dischargeOf = new Map<string, string>();
  edges.filter((e) => e.type === 'DISCHARGES_TO').forEach((e) => {
    dischargeOf.set(e.source, e.target);
  });

  const pollutionByRiver = new Map<string, PollutionRaw[]>();
  pollutions.forEach((p) => {
    const rid = dischargeOf.get(p.source_id) || p.river_id;
    if (!rid) return;
    if (!pollutionByRiver.has(rid)) pollutionByRiver.set(rid, []);
    pollutionByRiver.get(rid)!.push(p);
  });

  const POLLUTION_CARD_W = 140;       // 污染源卡片大致宽度（硬编码评估）
  pollutionByRiver.forEach((list, rid) => {
    const ext = riverExtents.get(rid);
    if (!ext) return;
    const sorted = [...list].sort((a, b) => (a.source_id || '').localeCompare(b.source_id || ''));
    const innerW = Math.max(0, ext.width - RIVER_PADDING * 2);
    // slot 宽度：至少 POLLUTION_CARD_W / 2（双层交错时同层间距翻倍）
    const slot = sorted.length > 0 ? Math.max(POLLUTION_CARD_W / 2, innerW / sorted.length) : 0;
    sorted.forEach((p, i) => {
      const x = ext.x + RIVER_PADDING + (i + 0.5) * slot - POLLUTION_CARD_W / 2;
      const y = ext.y - POLLUTION_BASE_UP - (i % 2) * POLLUTION_Y_LAYER_GAP;
      positions.set(`pollution:${p.source_id}`, { x, y });
    });
  });
  // 无归属河流的污染源：底部兄弟带兑底
  pollutions.forEach((p, idx) => {
    if (positions.has(`pollution:${p.source_id}`)) return;
    positions.set(`pollution:${p.source_id}`, { x: idx * 160, y: DEFAULT_BASE_Y + 500 });
  });

  // ========== 用户手工坐标覆盖 ==========
  if (savedCoords) {
    savedCoords.forEach((pos, nid) => {
      positions.set(nid, pos);
    });
  }

  return { positions, riverExtents, tributaryOnRiver: tributaryOnRiverMap };
}

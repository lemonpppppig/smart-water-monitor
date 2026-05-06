/**
 * 图谱可视化编辑器（P0 骨架）
 * - 左栏：节点类型工具箱（可拖拽到画布）
 * - 中栏：ReactFlow 画布，支持拖拽创建节点、连线创建关系
 * - 右栏：属性面板（Drawer），编辑/删除节点或边
 * - 顶栏：刷新 / 一键保存（脏标记聚合提交）
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  Handle, Position, addEdge, applyNodeChanges, applyEdgeChanges, useReactFlow,
  type Node, type Edge, type Connection, type NodeChange, type EdgeChange, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Button, Drawer, Form, Input, InputNumber, message, Space, Tag, Badge, Popconfirm, Dropdown,
  Select, Switch, Alert,
} from 'antd';
import type { MenuProps } from 'antd';
import { ReloadOutlined, SaveOutlined, ApartmentOutlined, NodeIndexOutlined, BranchesOutlined, EnvironmentOutlined, UploadOutlined, PartitionOutlined, UndoOutlined, RedoOutlined, DeploymentUnitOutlined, PushpinOutlined } from '@ant-design/icons';
import { graphAdminApi, stationApi } from '../../services/api';
import BulkImportModal from './BulkImportModal';
import dagre from '@dagrejs/dagre';
import RiverBar from './RiverBar';
import { computeRiverNetworkLayout, PX_PER_KM, RIVER_PADDING, MIN_RIVER_WIDTH } from './riverNetworkLayout';
import { useUIStore } from '../../store';
import { maskName } from '../../utils/mask';

/** 按当前演示模式决定是否脱敏节点显示名（仅用于画布展示，不影响表单回填） */
function displayName(name: string | undefined, demoMode: boolean, fallback?: string): string {
  const raw = name ?? fallback ?? '';
  return demoMode ? maskName(raw) : raw;
}

// ====== 类型与元数据 ======
// district 不再上画布，仅作属性面板下拉字典源
// confluence 依然上画布，作为河流衡接节点
type NodeKind = 'river' | 'station' | 'pollution' | 'confluence';
// 关系类型：
// - 可编辑：FLOWS_INTO / ON_RIVER / UPSTREAM_OF / DISCHARGES_TO / FLOWS_INTO_CONFLUENCE / CONFLUENCE_FLOWS_TO
// - 只读展示：POLLUTION_UPSTREAM_OF（污染源→站点的溯源链路，由初始化脚本维护）
type RelKind =
  | 'FLOWS_INTO'
  | 'ON_RIVER'
  | 'UPSTREAM_OF'
  | 'DISCHARGES_TO'
  | 'FLOWS_INTO_CONFLUENCE'
  | 'CONFLUENCE_FLOWS_TO'
  | 'POLLUTION_UPSTREAM_OF';
const READONLY_REL: ReadonlySet<RelKind> = new Set<RelKind>(['POLLUTION_UPSTREAM_OF']);
type DirtyState = 'new' | 'modified' | 'deleted';

interface NodeData {
  kind: NodeKind;
  bizId: string;
  name: string;
  raw: Record<string, any>;
  dirty?: DirtyState;
  [key: string]: unknown;
}

interface EdgeData {
  kind: RelKind;
  raw: Record<string, any>;
  dirty?: 'new' | 'deleted';
  originalSource?: string;
  originalTarget?: string;
  readonly?: boolean;
  [key: string]: unknown;
}

const KIND_META: Record<NodeKind, {
  label: string; color: string; icon: any; idField: string; nameField: string;
}> = {
  river:      { label: '河流',   color: '#0891b2', icon: BranchesOutlined,       idField: 'river_id',      nameField: 'name' },
  station:    { label: '站点',   color: '#16a34a', icon: EnvironmentOutlined,    idField: 'station_id',    nameField: 'station_name' },
  pollution:  { label: '污染源', color: '#dc2626', icon: NodeIndexOutlined,      idField: 'source_id',     nameField: 'name' },
  confluence: { label: '交汇点', color: '#d97706', icon: ApartmentOutlined,      idField: 'confluence_id', nameField: 'name' },
};

// 连线合法性规则：source|target -> 关系类型
// swap=true 表示用户拖拽方向与 Neo4j / RF 存储方向相反，需自动翻转
const REL_RULES: Record<string, { rel: RelKind; label: string; swap?: boolean }> = {
  'river|river':           { rel: 'FLOWS_INTO',             label: '河流流向' },
  'station|river':         { rel: 'ON_RIVER',               label: '站点所在河流' },
  'river|station':         { rel: 'ON_RIVER',               label: '站点所在河流', swap: true },   // 反向拖拽
  'station|station':       { rel: 'UPSTREAM_OF',            label: '站点上下游' },
  'pollution|river':       { rel: 'DISCHARGES_TO',          label: '污染源汇入' },
  'river|pollution':       { rel: 'DISCHARGES_TO',          label: '污染源汇入', swap: true },        // 反向拖拽
  'river|confluence':      { rel: 'FLOWS_INTO_CONFLUENCE',  label: '河流汇入交汇点' },
  'confluence|river':      { rel: 'CONFLUENCE_FLOWS_TO',    label: '交汇点下泄为河流' },
};

const nodeId = (kind: NodeKind, bizId: string) => `${kind}:${bizId}`;

// ====== 自定义节点（站点/污染源/交汇点）======
function KindNode({ data, selected }: NodeProps<Node<NodeData>>) {
  const demoMode = useUIStore((s) => s.demoMode);
  const meta = KIND_META[data.kind];
  const dirtyBg = data.dirty === 'new' ? '#dcfce7'
    : data.dirty === 'modified' ? '#fef3c7'
    : data.dirty === 'deleted' ? '#fee2e2' : '#ffffff';
  const Icon = meta.icon;

  // 交汇点分型：汇聚型(merge) vs 汇入型(tributary)
  const cType = data.kind === 'confluence' ? (data.raw?.confluence_type as string) : undefined;
  const labelText = data.kind === 'confluence'
    ? (cType === 'tributary' ? '汇入点' : cType === 'merge' ? '交汇点(汇聚)' : meta.label)
    : meta.label;
  const accentColor = data.kind === 'confluence'
    ? (cType === 'tributary' ? '#fb923c' : cType === 'merge' ? '#f59e0b' : meta.color)  // tributary: orange-400, merge: amber-500
    : meta.color;

  return (
    <div style={{
      padding: '8px 12px', borderRadius: 10, minWidth: 128,
      background: dirtyBg,
      border: `2px solid ${selected ? '#fbbf24' : accentColor}`,
      boxShadow: selected ? '0 0 0 3px rgba(251,191,36,.25)' : '0 2px 6px rgba(0,0,0,.08)',
      opacity: data.dirty === 'deleted' ? 0.5 : 1,
      position: 'relative',
    }}>
      {/* 四向 handle：水平桑基画布为右→左水流，故 right=target（上游入）、left=source（下游出）；top/bottom 维持原有语义 */}
      <Handle id="top" type="target" position={Position.Top} style={{ background: accentColor, width: 8, height: 8 }} />
      <Handle id="right" type="target" position={Position.Right} style={{ background: accentColor, width: 8, height: 8 }} />
      <div style={{ color: accentColor, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
        <Icon /> {labelText}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginTop: 2 }}>{displayName(data.name, demoMode, data.bizId)}</div>
      <div style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace' }}>{data.bizId}</div>
      <Handle id="bottom" type="source" position={Position.Bottom} style={{ background: accentColor, width: 8, height: 8 }} />
      <Handle id="left" type="source" position={Position.Left} style={{ background: accentColor, width: 8, height: 8 }} />
    </div>
  );
}
const nodeTypes = { kind: KindNode, riverBar: RiverBar };

// ====== 节点工具箱 ======
function NodePalette() {
  const onDragStart = (e: DragEvent<HTMLDivElement>, kind: NodeKind) => {
    e.dataTransfer.setData('application/graph-node-kind', kind);
    e.dataTransfer.effectAllowed = 'move';
  };
  return (
    <div style={{ padding: 12, borderRight: '1px solid #e5e7eb', background: '#fafafa', width: 200, overflow: 'auto' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 8 }}>节点工具箱</div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 12 }}>拖拽到画布即可新建</div>
      {(Object.keys(KIND_META) as NodeKind[]).map((k) => {
        const meta = KIND_META[k];
        const Icon = meta.icon;
        return (
          <div
            key={k}
            draggable
            onDragStart={(e) => onDragStart(e, k)}
            style={{
              padding: '10px 12px', marginBottom: 8, borderRadius: 8, cursor: 'grab',
              border: `2px dashed ${meta.color}`, background: '#fff',
              display: 'flex', alignItems: 'center', gap: 8,
              userSelect: 'none',
            }}
          >
            <Icon style={{ color: meta.color, fontSize: 16 }} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>{meta.label}</span>
          </div>
        );
      })}
      <div style={{ marginTop: 16, fontSize: 11, color: '#9ca3af', lineHeight: 1.6 }}>
        <div style={{ fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>合法连线</div>
        <div>河流 → 河流（流向）</div>
        <div>河流 → 交汇点（汇入）</div>
        <div>交汇点 → 河流（下泄）</div>
        <div>站点 → 河流（所在）</div>
        <div>站点 → 站点（上下游）</div>
        <div>污染源 → 河流（汇入）</div>
        <div style={{ fontWeight: 600, color: '#6b7280', marginTop: 8, marginBottom: 4 }}>只读展示</div>
        <div>污染源 → 站点（溯源链路）</div>
        <div style={{ fontSize: 10, color: '#cbd5e1', marginTop: 4 }}>行政区归属改在属性面板的下拉选择，不再上画布。</div>
      </div>
    </div>
  );
}

// ====== 主组件 ======
function GraphEditorInner() {
  const [nodes, setNodes] = useState<Node<NodeData>[]>([]);
  const [edges, setEdges] = useState<Edge<EdgeData>[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null);
  const demoMode = useUIStore((s) => s.demoMode);
  // 行政区下拉字典（不再上画布，仅供属性面板选择 district_code）
  const [districtOptions, setDistrictOptions] = useState<Array<{ value: string; label: string }>>([]);
  // 河流下拉选项（从画布当前河流节点动态派生）
  const riverOptions = useMemo(() =>
    nodes
      .filter(n => n.data.kind === 'river')
      .map(n => ({ label: `${displayName(n.data.name, demoMode, n.data.bizId)} (${n.data.bizId})`, value: n.data.bizId }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [nodes, demoMode]);
  // 默认显示污染源（节点和 DISCHARGES_TO 边），溯源链路默认折叠以减少画布噪声
  const [showPollution, setShowPollution] = useState(true);
  const [showTracing, setShowTracing] = useState(false);
  // 已保存的画布坐标（用户用了一次”保存布局“后回流持久化结果）
  const savedLayoutRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  // 保存布局按钮的 loading 态（独立于 saving）
  const [layoutSaving, setLayoutSaving] = useState(false);
  // 历史栈：用 ref 避免闭包陈旧；只记录语义变更，不记录拖拽位置
  const historyRef = useRef<{ nodes: Node<NodeData>[]; edges: Edge<EdgeData>[] }[]>([]);
  const historyIdxRef = useRef(-1);
  const [historyTick, setHistoryTick] = useState(0);
  // 同步最新 state 到 ref，供 scheduleCommit 读取
  const nodesRef = useRef<Node<NodeData>[]>([]);
  const edgesRef = useRef<Edge<EdgeData>[]>([]);
  const [form] = Form.useForm();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();

  // 脏计数
  const dirtyCount = useMemo(() => {
    const n = nodes.filter((x) => x.data.dirty).length;
    const e = edges.filter((x) => x.data?.dirty).length;
    return n + e;
  }, [nodes, edges]);

  // 初始加载：snapshot + PG 站点列表 + 已保存的画布布局
  // ignoreSaved=true 时抛弃已保存坐标，纯算法重排（布局菜单"水系拓扑重排"使用）
  const loadSnapshot = useCallback(async (ignoreSaved: boolean = false) => {
    setLoading(true);
    try {
      const [snapResp, stationResp, layoutResp] = await Promise.all([
        graphAdminApi.getGraphSnapshot(),
        stationApi.getStations({ limit: 1000 }).catch(() => ({ items: [] })),
        graphAdminApi.getCanvasLayout().catch(() => ({ data: [] })),
      ]);
      // axios 响应拦截器已返回 response.data，这里收到的已是 payload 本身
      const snap: any = snapResp;
      const nodesInput = snap?.nodes || {};
      const edgesInput: any[] = snap?.edges || [];
      const stationPayload: any = stationResp;
      const pgStations: any[] = stationPayload?.items || stationPayload?.data?.items || [];
      const layoutWrap: any = layoutResp;
      const layouts: any[] = Array.isArray(layoutWrap?.data)
        ? layoutWrap.data
        : Array.isArray(layoutWrap) ? layoutWrap : [];

      // 行政区节点改为下拉字典
      setDistrictOptions(
        (nodesInput.districts || []).map((d: any) => ({ value: d.code, label: `${d.name || ''}（${d.code}）` })),
      );

      // 挂已保存的画布坐标（用户拖拽过的节点会覆盖算法结果）
      const savedCoords = new Map<string, { x: number; y: number }>();
      if (!ignoreSaved) {
        layouts.forEach((l: any) => {
          if (l?.node_type && l?.node_id && typeof l.x === 'number' && typeof l.y === 'number') {
            savedCoords.set(`${l.node_type}:${l.node_id}`, { x: l.x, y: l.y });
          }
        });
        savedLayoutRef.current = savedCoords;
      }

      // 准备布局引擎的 4 类原始节点
      const riversRaw = nodesInput.rivers || [];
      const confluencesRaw = nodesInput.confluences || [];
      const stationsFromGraph = (nodesInput.stations || []).map((s: any) => ({
        ...s,
        station_code: s.station_code || s.station_id,
      }));
      const graphStationCodes = new Set(stationsFromGraph.map((s: any) => s.station_code));
      // PG 额外站点：只保留有 river_id 的（能绑定到河流的），过滤掉纯孤立站点
      const extraPgStations = pgStations
        .filter((s: any) => s.station_code && !graphStationCodes.has(s.station_code) && s.river_id)
        .map((s: any) => ({
          ...s,
          station_id: s.station_code,
        }));
      const stationsRaw = [...stationsFromGraph, ...extraPgStations];
      const pollutionsRaw = nodesInput.pollution_sources || [];

      // ============ 交汇点接桥：前端对所有 FLOWS_INTO 强制经过交汇点 ============
      // 1) 先识别已有真实交汇点桥接的河流对
      const realBridges = new Set<string>();
      {
        const tmpIn = new Map<string, string[]>();
        const tmpOut = new Map<string, string[]>();
        edgesInput.forEach((e: any) => {
          if (e.type === 'FLOWS_INTO_CONFLUENCE') {
            if (!tmpIn.has(e.target)) tmpIn.set(e.target, []);
            tmpIn.get(e.target)!.push(e.source);
          } else if (e.type === 'CONFLUENCE_FLOWS_TO') {
            if (!tmpOut.has(e.source)) tmpOut.set(e.source, []);
            tmpOut.get(e.source)!.push(e.target);
          }
        });
        tmpIn.forEach((ins, cfId) => {
          const outs = tmpOut.get(cfId) || [];
          ins.forEach((ri) => outs.forEach((ro) => realBridges.add(`${ri}>${ro}`)));
        });
      }

      // 2) 真实交汇点 id 集合（用于验证 FLOWS_INTO 上的 confluence_id 是否指向真节点）
      const realConfluenceIds = new Set<string>(
        confluencesRaw.map((c: any) => c.confluence_id).filter(Boolean),
      );

      // 2.5) 启发式补挥：基于 confluence.description（格式如“章江+贡水→赣江”、“桃江→贡水”）
      //       把没有 rel.confluence_id 的 FLOWS_INTO 自动认领到名称匹配的真实交汇点
      const nameToRiverId = new Map<string, string>();
      riversRaw.forEach((r: any) => {
        if (r?.name && r?.river_id) nameToRiverId.set(r.name, r.river_id);
      });
      const resolveRiverIdByName = (n: string): string | undefined => {
        if (!n) return undefined;
        const exact = nameToRiverId.get(n);
        if (exact) return exact;
        // 模糊匹配：互包含
        for (const [name, rid] of nameToRiverId) {
          if (name.includes(n) || n.includes(name)) return rid;
        }
        return undefined;
      };
      const descBridgeHint = new Map<string, string>(); // `${upId}>${downId}` -> cfId
      confluencesRaw.forEach((c: any) => {
        const desc = (c?.description || '') as string;
        if (!desc || typeof desc !== 'string') return;
        const arrowIdx = desc.indexOf('→');
        if (arrowIdx < 0) return;
        const leftPart = desc.slice(0, arrowIdx).trim();
        const rightPart = desc.slice(arrowIdx + 1).trim();
        const ups = leftPart.split(/[+、,，]/).map((s: string) => s.trim()).filter(Boolean);
        const downs = rightPart.split(/[+、,，]/).map((s: string) => s.trim()).filter(Boolean);
        ups.forEach((un: string) => {
          downs.forEach((dn: string) => {
            const upId = resolveRiverIdByName(un);
            const downId = resolveRiverIdByName(dn);
            if (upId && downId && upId !== downId) {
              const key = `${upId}>${downId}`;
              if (!descBridgeHint.has(key)) descBridgeHint.set(key, c.confluence_id);
            }
          });
        });
      });

      // 3) 遍历 FLOWS_INTO：
      //    a. 已有真实 FLOWS_INTO_CONFLUENCE+CONFLUENCE_FLOWS_TO 桥接 → 直接丢弃裸边
      //    b. rel.confluence_id 指向真实 Confluence → 生成两条虚拟边用该真节点接桥（最优）
      //    c. description 语义匹配命中真实交汇点 → 同样生成虚拟边用该真节点接桥
      //    d. 打底都没命中才生成 vconf 虚拟交汇点兄底
      const virtualConfluences: any[] = [];
      const virtualEdges: any[] = [];
      const seenVcf = new Set<string>();
      const realAttachedCfIds = new Set<string>();  // 被我们用 confluence_id 接桥的真实交汇点【用于下游定位参考】

      edgesInput.forEach((e: any) => {
        if (e.type !== 'FLOWS_INTO') return;
        if (realBridges.has(`${e.source}>${e.target}`)) return;

        // 候选 1：关系上的 confluence_id
        let cidToUse: string | undefined;
        const cidOnRel = e.props?.confluence_id;
        if (cidOnRel && realConfluenceIds.has(cidOnRel)) {
          cidToUse = cidOnRel;
        }
        // 候选 2：description 语义匹配
        if (!cidToUse) {
          const hint = descBridgeHint.get(`${e.source}>${e.target}`);
          if (hint && realConfluenceIds.has(hint)) cidToUse = hint;
        }

        if (cidToUse) {
          virtualEdges.push({
            source: e.source, target: cidToUse, type: 'FLOWS_INTO_CONFLUENCE',
            props: { distance_km: e.props?.distance_km, readonly: true, virtual: true },
          });
          virtualEdges.push({
            source: cidToUse, target: e.target, type: 'CONFLUENCE_FLOWS_TO',
            props: { readonly: true, virtual: true },
          });
          realAttachedCfIds.add(cidToUse);
          return;
        }

        // 兄底：生成 vconf
        const cfId = `vconf-${e.source}-${e.target}`;
        if (!seenVcf.has(cfId)) {
          seenVcf.add(cfId);
          virtualConfluences.push({
            confluence_id: cfId,
            name: '交汇点',
            virtual: true,
          });
        }
        virtualEdges.push({
          source: e.source, target: cfId, type: 'FLOWS_INTO_CONFLUENCE',
          props: { ...(e.props || {}), readonly: true, virtual: true },
        });
        virtualEdges.push({
          source: cfId, target: e.target, type: 'CONFLUENCE_FLOWS_TO',
          props: { readonly: true, virtual: true },
        });
      });

      const confluencesAll = [...confluencesRaw, ...virtualConfluences];
      // 4) 最终 edges：丢掉所有裸 FLOWS_INTO + 补入虚拟边
      const effectiveEdges: any[] = [
        ...edgesInput.filter((e: any) => e.type !== 'FLOWS_INTO'),
        ...virtualEdges,
      ];

      // 5) 为有 river_id 但缺 ON_RIVER 边的站点补虚拟 ON_RIVER 边，保证站点与河流连线
      const existingOnRiverSrc = new Set(
        effectiveEdges.filter((e: any) => e.type === 'ON_RIVER').map((e: any) => e.source),
      );
      const riverIdSet = new Set(riversRaw.map((r: any) => r.river_id));
      stationsRaw.forEach((s: any) => {
        const sid = s.station_code || s.station_id;
        if (!sid) return;
        const rid = s.river_id;
        if (!rid || !riverIdSet.has(rid)) return;   // 河流不存在时跳过
        if (existingOnRiverSrc.has(sid)) return;     // 已有 ON_RIVER 边
        effectiveEdges.push({
          source: sid, target: rid, type: 'ON_RIVER',
          props: { readonly: true, virtual: true },
        });
      });

      // 调用河流布局算法，一次性得到所有节点坐标 + 河流实际宽度
      const { positions, riverExtents, tributaryOnRiver } = computeRiverNetworkLayout(
        riversRaw, stationsRaw, confluencesAll, pollutionsRaw, effectiveEdges, savedCoords,
      );

      // ============ 构造 RiverBar 的动态端口（站点在底部、污染源在顶部）============
      const bottomPortsByRiver = new Map<string, Array<{ id: string; x: number }>>();
      const topPortsByRiver = new Map<string, Array<{ id: string; x: number }>>();
      const onRiverMap = new Map<string, string>();
      edgesInput.filter((e: any) => e.type === 'ON_RIVER').forEach((e: any) => {
        onRiverMap.set(e.source, e.target);
      });
      stationsRaw.forEach((s: any) => {
        const sid = s.station_code || s.station_id;
        if (!sid) return;
        const rid = onRiverMap.get(sid) || s.river_id;
        if (!rid) return;
        const ext = riverExtents.get(rid);
        const pos = positions.get(`station:${sid}`);
        if (!ext || !pos) return;
        if (!bottomPortsByRiver.has(rid)) bottomPortsByRiver.set(rid, []);
        bottomPortsByRiver.get(rid)!.push({ id: sid, x: pos.x - ext.x });
      });
      const dischargesMap = new Map<string, string>();
      edgesInput.filter((e: any) => e.type === 'DISCHARGES_TO').forEach((e: any) => {
        dischargesMap.set(e.source, e.target);
      });
      pollutionsRaw.forEach((p: any) => {
        const rid = dischargesMap.get(p.source_id) || p.river_id;
        if (!rid) return;
        const ext = riverExtents.get(rid);
        const pos = positions.get(`pollution:${p.source_id}`);
        if (!ext || !pos) return;
        if (!topPortsByRiver.has(rid)) topPortsByRiver.set(rid, []);
        topPortsByRiver.get(rid)!.push({ id: p.source_id, x: pos.x - ext.x });
      });
      bottomPortsByRiver.forEach((arr) => arr.sort((a, b) => a.x - b.x));
      topPortsByRiver.forEach((arr) => arr.sort((a, b) => a.x - b.x));
      
            // 汇入型交汇点：在 through_river 顶部添加端口（用于交汇点 bottom → 河流 top 短端连线）
            tributaryOnRiver.forEach(({ throughRiverId, portX }, cfId) => {
              if (!topPortsByRiver.has(throughRiverId)) topPortsByRiver.set(throughRiverId, []);
              topPortsByRiver.get(throughRiverId)!.push({ id: `cf-${cfId}`, x: portX });
            });
            // 汇入型交汇点 ID 集合（用于边 handle 分配）
            const tributaryCfIds = new Set(tributaryOnRiver.keys());

      const rfNodes: Node<NodeData>[] = [];
      const pushNode = (
        kind: NodeKind, bizId: string, name: string, raw: any,
        nodeType: 'kind' | 'riverBar' = 'kind',
      ) => {
        if (!bizId) return;
        const id = nodeId(kind, bizId);
        if (rfNodes.find((n) => n.id === id)) return;
        const pos = positions.get(id) || { x: 0, y: 0 };
        const renderWidth = kind === 'river' ? riverExtents.get(bizId)?.width : undefined;
        const extra: Record<string, any> = {};
        if (kind === 'river') {
          extra.bottomPorts = bottomPortsByRiver.get(bizId) || [];
          extra.topPorts = topPortsByRiver.get(bizId) || [];
        }
        rfNodes.push({
          id, type: nodeType, position: pos,
          data: { kind, bizId, name: name || bizId, raw, renderWidth, ...extra },
          hidden: kind === 'pollution' ? !showPollution : false,
        });
      };

      riversRaw.forEach((r: any) => pushNode('river', r.river_id, r.name, r, 'riverBar'));
      confluencesAll.forEach((c: any) => pushNode('confluence', c.confluence_id, c.name || '交汇点', c));
      // 过滤孤立站点：只保留有 river_id 或在 effectiveEdges 中出现过的站点
      const stationInEdge = new Set<string>();
      effectiveEdges.forEach((e: any) => {
        if (['ON_RIVER', 'UPSTREAM_OF', 'POLLUTION_UPSTREAM_OF'].includes(e.type)) {
          stationInEdge.add(e.source);
          stationInEdge.add(e.target);
        }
      });
      stationsRaw.forEach((s: any) => {
        const sid = s.station_code || s.station_id;
        if (!sid) return;
        // 有 river_id 或有边关联 → 上画布；否则跳过
        if (!s.river_id && !stationInEdge.has(sid)) return;
        pushNode('station', sid, s.station_name || s.name || sid, s);
      });
      pollutionsRaw.forEach((p: any) => pushNode('pollution', p.source_id, p.name, p));

      // ============ 构建 edges：指定 sourceHandle / targetHandle 让连线落在正确端口 ============
      const rfEdges: Edge<EdgeData>[] = effectiveEdges
        .map((e: any, idx: number) => {
          let srcKind: NodeKind | undefined;
          let tgtKind: NodeKind | undefined;
          // ON_RIVER 特殊处理：Neo4j 方向 station→river，但 ReactFlow 端口语义需要反转
          // 因为 KindNode.top = target、RiverBar.bot-* = source，所以 RF 边 source=river target=station
          if (e.type === 'FLOWS_INTO') { srcKind = 'river'; tgtKind = 'river'; }
          else if (e.type === 'ON_RIVER') { srcKind = 'river'; tgtKind = 'station'; }   // ← 反转
          else if (e.type === 'UPSTREAM_OF') { srcKind = 'station'; tgtKind = 'station'; }
          else if (e.type === 'DISCHARGES_TO') { srcKind = 'pollution'; tgtKind = 'river'; }
          else if (e.type === 'FLOWS_INTO_CONFLUENCE') { srcKind = 'river'; tgtKind = 'confluence'; }
          else if (e.type === 'CONFLUENCE_FLOWS_TO') { srcKind = 'confluence'; tgtKind = 'river'; }
          else if (e.type === 'POLLUTION_UPSTREAM_OF') { srcKind = 'pollution'; tgtKind = 'station'; }
          if (!srcKind || !tgtKind) return null;

          const readonly = e.props?.readonly === true || READONLY_REL.has(e.type as RelKind);
          const isVirtual = e.props?.virtual === true;
          const distKm = e.props?.distance_km;
          const travelH = e.props?.travel_hours;
          let label: string = e.type;
          if (e.type === 'FLOWS_INTO') label = distKm != null ? `汇入 · ${distKm}km` : '流向';
          else if (e.type === 'UPSTREAM_OF') {
            const parts: string[] = ['上下游'];
            if (distKm != null) parts.push(`${distKm}km`);
            if (travelH != null) parts.push(`${travelH}h`);
            label = parts.join(' · ');
          } else if (e.type === 'FLOWS_INTO_CONFLUENCE') label = isVirtual ? '汇入' : (distKm != null ? `汇入交汇点 · ${distKm}km` : '汇入交汇点');
          else if (e.type === 'CONFLUENCE_FLOWS_TO') label = isVirtual ? '下泄' : (distKm != null ? `下泄 · ${distKm}km` : '下泄');
          else if (e.type === 'ON_RIVER') label = '所在河流';
          else if (e.type === 'DISCHARGES_TO') label = '汇入河流';
          else if (e.type === 'POLLUTION_UPSTREAM_OF') label = distKm != null ? `溯源 · ${distKm}km` : '溯源';

          // UPSTREAM_OF 边：站点位置已能直观反映上下游，默认隐藏，用户打开“溯源”才显示做审计
          const hidden =
            (e.type === 'DISCHARGES_TO' && !showPollution) ||
            (e.type === 'POLLUTION_UPSTREAM_OF' && (!showPollution || !showTracing)) ||
            (e.type === 'UPSTREAM_OF' && !showTracing);

          // 指定 handle：ON_RIVER RF 方向 river→station（bot-*→top）；污染源→河流走 top-*；河流⇄交汇点/河流水平走 left→right
          let sourceHandle: string | undefined;
          let targetHandle: string | undefined;
          if (e.type === 'ON_RIVER') { sourceHandle = `bot-${e.source}`; targetHandle = 'top'; }  // RF: river(bot-*)→station(top)
          else if (e.type === 'DISCHARGES_TO') { sourceHandle = 'bottom'; targetHandle = `top-${e.source}`; }
          else if (e.type === 'FLOWS_INTO_CONFLUENCE') { sourceHandle = 'left'; targetHandle = 'right'; }
          else if (e.type === 'CONFLUENCE_FLOWS_TO') {
            // 汇入型：交汇点 bottom → through_river 的专属顶部端口
            const cfBizId = e.source;
            if (tributaryCfIds.has(cfBizId)) {
              sourceHandle = 'bottom'; targetHandle = `top-cf-${cfBizId}`;
            } else {
              sourceHandle = 'left'; targetHandle = 'right';
            }
          }
          else if (e.type === 'FLOWS_INTO') { sourceHandle = 'left'; targetHandle = 'right'; }

          // ON_RIVER: Neo4j 方向 station→river，RF 方向 river→station（Handle 类型匹配），需交换 source/target
          const rfSource = e.type === 'ON_RIVER' ? nodeId(srcKind, e.target) : nodeId(srcKind, e.source);
          const rfTarget = e.type === 'ON_RIVER' ? nodeId(tgtKind, e.source) : nodeId(tgtKind, e.target);
          // 交汇点相关边使用 smoothstep 路由，避免 bezier 穿越节点
          const edgeType = (e.type === 'FLOWS_INTO_CONFLUENCE' || e.type === 'CONFLUENCE_FLOWS_TO' || e.type === 'FLOWS_INTO')
            ? 'smoothstep' : undefined;
          return {
            id: `e-${idx}-${e.type}-${e.source}-${e.target}`,
            source: rfSource,
            target: rfTarget,
            ...(sourceHandle ? { sourceHandle } : {}),
            ...(targetHandle ? { targetHandle } : {}),
            ...(edgeType ? { type: edgeType } : {}),
            label,
            data: {
              kind: e.type as RelKind, raw: e.props || {},
              originalSource: e.source, originalTarget: e.target,
              readonly,
            },
            style: e.type === 'POLLUTION_UPSTREAM_OF'
              ? { stroke: '#f97316', strokeWidth: 1, strokeDasharray: '3 3', opacity: 0.75 }
              : isVirtual
                ? { stroke: '#94a3b8', strokeWidth: 1.2, opacity: 0.85 }
                : readonly
                  ? { stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 4', opacity: 0.7 }
                  : { stroke: '#64748b', strokeWidth: 1.5 },
            selectable: !readonly,
            hidden,
          } as Edge<EdgeData>;
        })
        .filter((x): x is Edge<EdgeData> => !!x);

      setNodes(rfNodes);
      setEdges(rfEdges);
      setSelected(null);
      // 重置历史栈：以当前快照为新基线
      historyRef.current = [];
      historyIdxRef.current = -1;
      queueMicrotask(() => pushHistory(rfNodes, rfEdges));
      // 重新布局后自动缩放至看到所有水系
      setTimeout(() => {
        try { fitView({ padding: 0.15, duration: 500 }); } catch { /* noop */ }
      }, 150);
    } catch (err: any) {
      console.error('[GraphEditor] loadSnapshot failed:', err);
      message.error(err?.response?.data?.detail || err?.message || '加载图谱失败');
    } finally {
      setLoading(false);
    }
    // 注：showPollution/showTracing 变化时不重新请求，由下方 useEffect 更新 hidden
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadSnapshot(); }, [loadSnapshot]);

  // 污染源 / 溯源链路 显隐切换（不触发 fetch，不入历史栈）
  useEffect(() => {
    setNodes((ns) => ns.map((n) =>
      n.data.kind === 'pollution' ? { ...n, hidden: !showPollution } : n,
    ));
    setEdges((es) => es.map((e) => {
      const k = (e.data as EdgeData)?.kind;
      if (k === 'DISCHARGES_TO') return { ...e, hidden: !showPollution };
      if (k === 'POLLUTION_UPSTREAM_OF') return { ...e, hidden: !showPollution || !showTracing };
      if (k === 'UPSTREAM_OF') return { ...e, hidden: !showTracing };
      return e;
    }));
  }, [showPollution, showTracing]);

  // 同步 nodes/edges 到 ref
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  // 推入一个快照到历史栈（最多 50 步）
  const pushHistory = useCallback((snapshotNodes: Node<NodeData>[], snapshotEdges: Edge<EdgeData>[]) => {
    const next = historyRef.current.slice(0, historyIdxRef.current + 1);
    next.push({
      nodes: snapshotNodes.map((n) => ({ ...n, data: { ...n.data } })),
      edges: snapshotEdges.map((e) => ({ ...e, data: { ...(e.data as EdgeData) } })),
    });
    const trimmed = next.slice(-50);
    historyRef.current = trimmed;
    historyIdxRef.current = trimmed.length - 1;
    setHistoryTick((t) => t + 1);
  }, []);

  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current--;
    const snap = historyRef.current[historyIdxRef.current];
    setNodes(snap.nodes.map((n) => ({ ...n, data: { ...n.data } })));
    setEdges(snap.edges.map((e) => ({ ...e, data: { ...(e.data as EdgeData) } })));
    setSelected(null);
    setHistoryTick((t) => t + 1);
    message.info('已撤销');
  }, []);

  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    const snap = historyRef.current[historyIdxRef.current];
    setNodes(snap.nodes.map((n) => ({ ...n, data: { ...n.data } })));
    setEdges(snap.edges.map((e) => ({ ...e, data: { ...(e.data as EdgeData) } })));
    setSelected(null);
    setHistoryTick((t) => t + 1);
    message.info('已重做');
  }, []);

  const canUndo = historyIdxRef.current > 0;
  const canRedo = historyIdxRef.current < historyRef.current.length - 1;
  void historyTick; // 触发按钮状态重新 render

  // 持久一个语义变更（在 setState 在 microtask 过后获取最新 ref）
  const scheduleCommit = useCallback(() => {
    queueMicrotask(() => pushHistory(nodesRef.current, edgesRef.current));
  }, [pushHistory]);

  // 键盘快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // ReactFlow 事件
  const onNodesChange = useCallback((changes: NodeChange[]) =>
    setNodes((nds) => applyNodeChanges(changes, nds) as Node<NodeData>[]), []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) =>
    setEdges((eds) => applyEdgeChanges(changes, eds) as Edge<EdgeData>[]), []);

  const onConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target) return;
    // 使用 nodesRef 取最新快照，避免闭包捕获过期 nodes 导致新节点查不到
    const latest = nodesRef.current;
    const src = latest.find((n) => n.id === conn.source);
    const tgt = latest.find((n) => n.id === conn.target);
    if (!src || !tgt) {
      console.warn('[onConnect] 节点未找到', conn.source, conn.target);
      return;
    }
    const rule = REL_RULES[`${src.data.kind}|${tgt.data.kind}`];
    if (!rule) {
      message.warning(`不允许从「${KIND_META[src.data.kind].label}」连到「${KIND_META[tgt.data.kind].label}」`);
      return;
    }
    // swap=true 表示用户拖拽方向与 RF 存储方向相反，需翻转 source/target
    const swap = !!rule.swap;
    const edgeSource = swap ? conn.target : conn.source;
    const edgeTarget = swap ? conn.source : conn.target;
    const srcNode = swap ? tgt : src;
    const tgtNode = swap ? src : tgt;
    const newEdge: Edge<EdgeData> = {
      id: `e-new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: edgeSource, target: edgeTarget, label: rule.rel,
      // 传递 handle 信息；swap 时也翻转 handle
      ...(swap
        ? { ...(conn.targetHandle ? { sourceHandle: conn.targetHandle } : {}),
            ...(conn.sourceHandle ? { targetHandle: conn.sourceHandle } : {}) }
        : { ...(conn.sourceHandle ? { sourceHandle: conn.sourceHandle } : {}),
            ...(conn.targetHandle ? { targetHandle: conn.targetHandle } : {}) }),
      data: {
        kind: rule.rel, raw: {}, dirty: 'new',
        originalSource: srcNode.data.bizId, originalTarget: tgtNode.data.bizId,
      },
      style: { stroke: '#16a34a', strokeWidth: 2, strokeDasharray: '5 5' },
    };
    setEdges((eds) => addEdge(newEdge, eds) as Edge<EdgeData>[]);
    scheduleCommit();
  }, [scheduleCommit]);

  // 画布 drop：创建新节点
  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData('application/graph-node-kind') as NodeKind;
    if (!kind || !KIND_META[kind]) return;
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const bizId = `NEW_${kind.toUpperCase()}_${Date.now().toString(36).slice(-5)}`;
    const isRiver = kind === 'river';
    const newNode: Node<NodeData> = {
      id: nodeId(kind, bizId),
      type: isRiver ? 'riverBar' : 'kind',
      position,
      data: {
        kind, bizId, name: '', raw: {}, dirty: 'new',
        ...(isRiver ? { renderWidth: MIN_RIVER_WIDTH, bottomPorts: [], topPorts: [] } : {}),
      },
    };
    setNodes((nds) => [...nds, newNode]);
    setSelected({ kind: 'node', id: newNode.id });
    scheduleCommit();
  }, [screenToFlowPosition]);

  // 属性面板同步
  useEffect(() => {
    if (!selected) { form.resetFields(); return; }
    if (selected.kind === 'node') {
      const n = nodes.find((x) => x.id === selected.id);
      if (n) {
        form.setFieldsValue({ bizId: n.data.bizId, name: n.data.name, ...n.data.raw });
        // 回填 river_id：从已有边推导所属河流
        if (n.data.kind === 'station') {
          const onRiverEdge = edges.find(e => e.data?.kind === 'ON_RIVER' && e.target === n.id && e.data?.dirty !== 'deleted');
          if (onRiverEdge) {
            const rn = nodes.find(r => r.id === onRiverEdge.source);
            if (rn) form.setFieldValue('river_id', rn.data.bizId);
          }
        } else if (n.data.kind === 'pollution') {
          const dtEdge = edges.find(e => e.data?.kind === 'DISCHARGES_TO' && e.source === n.id && e.data?.dirty !== 'deleted');
          if (dtEdge) {
            const rn = nodes.find(r => r.id === dtEdge.target);
            if (rn) form.setFieldValue('river_id', rn.data.bizId);
          }
        }
      }
    } else {
      const e = edges.find((x) => x.id === selected.id);
      if (e) form.setFieldsValue({ ...e.data?.raw });
    }
  }, [selected, nodes, edges, form]);

  const applyNodeEdit = () => {
    if (!selected || selected.kind !== 'node') return;
    const v = form.getFieldsValue();
    const currentNode = nodesRef.current.find(n => n.id === selected.id);
    if (!currentNode) return;
    const kind = currentNode.data.kind;

    // 1) 基本属性更新
    const { bizId, name, river_id: formRiverId, ...rest } = v;
    const finalBizId = bizId || currentNode.data.bizId;
    setNodes((nds) => nds.map((n) => {
      if (n.id !== selected.id) return n;
      const wasNew = n.data.dirty === 'new';
      return {
        ...n,
        data: {
          ...n.data,
          bizId: finalBizId,
          name: name || '',
          raw: { ...n.data.raw, ...rest, ...(formRiverId ? { river_id: formRiverId } : {}) },
          dirty: wasNew ? 'new' : 'modified',
        },
      };
    }));

    // 2) 自动挂载到河流（站点 / 污染源）
    if ((kind === 'station' || kind === 'pollution') && formRiverId) {
      const riverNodeId = nodeId('river', formRiverId);
      const riverNode = nodesRef.current.find(n => n.id === riverNodeId);
      if (!riverNode) {
        message.warning(`画布中未找到河流 ${formRiverId}，请先添加该河流`);
        scheduleCommit();
        return;
      }
      const edgeKind: RelKind = kind === 'station' ? 'ON_RIVER' : 'DISCHARGES_TO';
      const currentNodeId = currentNode.id;

      // 查找已有的挂载边
      const existingEdge = edgesRef.current.find(e => {
        if (e.data?.dirty === 'deleted') return false;
        if (edgeKind === 'ON_RIVER') return e.data?.kind === 'ON_RIVER' && e.target === currentNodeId;
        return e.data?.kind === 'DISCHARGES_TO' && e.source === currentNodeId;
      });
      const existingRiverId = existingEdge
        ? (edgeKind === 'ON_RIVER' ? existingEdge.source : existingEdge.target)
        : null;

      if (existingRiverId !== riverNodeId) {
        // 河流变了：删除旧边 + 创建新边
        if (existingEdge) {
          setEdges((eds) => eds.map(e => {
            if (e.id !== existingEdge.id) return e;
            const wasNew = e.data?.dirty === 'new';
            if (wasNew) return null as any; // 新增边直接移除
            return { ...e, data: { ...(e.data as EdgeData), dirty: 'deleted' as DirtyState }, style: { ...e.style, stroke: '#ef4444', strokeDasharray: '3 3' } };
          }).filter(Boolean) as Edge<EdgeData>[]);
        }
        // 创建新边
        const rfSource = edgeKind === 'ON_RIVER' ? riverNodeId : currentNodeId;
        const rfTarget = edgeKind === 'ON_RIVER' ? currentNodeId : riverNodeId;
        const neoSource = edgeKind === 'ON_RIVER' ? finalBizId : finalBizId;
        const neoTarget = formRiverId;
        const newEdge: Edge<EdgeData> = {
          id: `e-auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          source: rfSource, target: rfTarget, label: edgeKind,
          sourceHandle: edgeKind === 'ON_RIVER' ? 'bottom' : 'bottom',
          targetHandle: edgeKind === 'ON_RIVER' ? 'top' : 'top',
          data: { kind: edgeKind, raw: {}, dirty: 'new', originalSource: neoSource, originalTarget: neoTarget },
          style: { stroke: '#16a34a', strokeWidth: 2, strokeDasharray: '5 5' },
        };
        setEdges((eds) => addEdge(newEdge, eds) as Edge<EdgeData>[]);
      }

      // 3) 动态扩展河流宽度（若新站点的 river_km 超出当前河流渲染宽度）
      const riverKm = rest.river_km;
      let riverWidth = (riverNode.data as any).renderWidth || MIN_RIVER_WIDTH;
      if (riverKm != null && riverKm > 0) {
        const neededWidth = riverKm * PX_PER_KM + RIVER_PADDING * 2;
        if (neededWidth > riverWidth) {
          riverWidth = neededWidth;
          setNodes((nds) => nds.map((n) =>
            n.id === riverNodeId ? { ...n, data: { ...n.data, renderWidth: riverWidth } } : n
          ));
        }
      }
      if (riverKm != null && riverKm >= 0) {
        let x = riverNode.position.x + riverWidth - RIVER_PADDING - riverKm * PX_PER_KM;
        x = Math.max(x, riverNode.position.x + RIVER_PADDING / 2);
        x = Math.min(x, riverNode.position.x + riverWidth - RIVER_PADDING / 2);
        const y = kind === 'station' ? riverNode.position.y + 80 : riverNode.position.y - 70;
        setNodes((nds) => nds.map((n) =>
          n.id === currentNodeId ? { ...n, position: { x: x - 64, y } } : n
        ));
        message.success(`已自动挂载到「${riverNode.data.name || formRiverId}」的 ${riverKm}km 处`);
      } else {
        // 没有 km，放到河流中央
        const x = riverNode.position.x + riverWidth / 2;
        const y = kind === 'station' ? riverNode.position.y + 80 : riverNode.position.y - 70;
        setNodes((nds) => nds.map((n) =>
          n.id === currentNodeId ? { ...n, position: { x: x - 64, y } } : n
        ));
        message.info(`已关联到「${riverNode.data.name || formRiverId}」，填写公里桩号后将精确定位`);
      }
    } else {
      message.success('已暂存（点保存才会写入数据库）');
    }
    scheduleCommit();
  };

  const applyEdgeEdit = () => {
    if (!selected || selected.kind !== 'edge') return;
    const v = form.getFieldsValue();
    setEdges((eds) => eds.map((e) => {
      if (e.id !== selected.id) return e;
      return { ...e, data: { ...(e.data as EdgeData), raw: { ...(e.data as EdgeData).raw, ...v } } };
    }));
    message.success('边属性已暂存');
    scheduleCommit();
  };

  const deleteSelected = () => {
    if (!selected) return;
    if (selected.kind === 'node') {
      setNodes((nds) => {
        const target = nds.find((n) => n.id === selected.id);
        if (!target) return nds;
        if (target.data.dirty === 'new') {
          // 新节点直接移除，顺便清掉相关新边
          setEdges((eds) => eds.filter((e) => e.source !== selected.id && e.target !== selected.id));
          return nds.filter((n) => n.id !== selected.id);
        }
        return nds.map((n) => n.id === selected.id ? { ...n, data: { ...n.data, dirty: 'deleted' } } : n);
      });
    } else {
      setEdges((eds) => {
        const target = eds.find((e) => e.id === selected.id);
        if (!target) return eds;
        if ((target.data as EdgeData)?.readonly) {
          message.warning('该关系由初始化脚本维护（污染源溯源链路 UPSTREAM_OF），画布不可删除');
          return eds;
        }
        if (target.data?.dirty === 'new') return eds.filter((e) => e.id !== selected.id);
        return eds.map((e) => e.id === selected.id
          ? { ...e, data: { ...(e.data as EdgeData), dirty: 'deleted' }, style: { ...e.style, stroke: '#dc2626', strokeDasharray: '3 3' } }
          : e);
      });
    }
    setSelected(null);
    scheduleCommit();
  };

  // ====== 自动布局：按类型分层 + 同层按 bizId 排序后水平铺 ======
  const autoLayout = useCallback(() => {
    const Y_BY_KIND: Record<NodeKind, number> = { river: 60, confluence: 220, station: 380, pollution: 560 };
    const X_GAP = 180;
    const byKind: Record<NodeKind, Node<NodeData>[]> = { river: [], station: [], pollution: [], confluence: [] };
    nodes.forEach((n) => { byKind[n.data.kind].push(n); });
    (Object.keys(byKind) as NodeKind[]).forEach((k) => {
      byKind[k].sort((a, b) => a.data.bizId.localeCompare(b.data.bizId));
    });
    setNodes((nds) => nds.map((n) => {
      const layer = byKind[n.data.kind];
      const idx = layer.indexOf(n);
      return { ...n, position: { x: idx * X_GAP + 40, y: Y_BY_KIND[n.data.kind] } };
    }));
    message.success('已按类型分层重排');
    scheduleCommit();
  }, [nodes]);

  // ====== 智能布局：dagre 有向无环图算法（基于边的层级推断）======
  const smartLayout = useCallback((rankdir: 'LR' | 'TB' = 'LR') => {
    if (!nodes.length) { message.warning('画布为空'); return; }
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir, nodesep: 40, ranksep: 120, marginx: 40, marginy: 40 });
    const NODE_W = 170;
    const NODE_H = 64;
    nodes.filter((n) => n.data.dirty !== 'deleted').forEach((n) => {
      g.setNode(n.id, { width: NODE_W, height: NODE_H });
    });
    edges.filter((e) => e.data?.dirty !== 'deleted').forEach((e) => {
      if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
    });
    dagre.layout(g);
    setNodes((nds) => nds.map((n) => {
      if (!g.hasNode(n.id)) return n;
      const pos = g.node(n.id);
      // dagre 返回中心点，ReactFlow 要求左上角
      return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } };
    }));
    message.success(`智能布局完成（${rankdir === 'LR' ? '横向' : '纵向'}）`);
    scheduleCommit();
  }, [nodes, edges]);

  const layoutMenuItems: MenuProps['items'] = [
    { key: 'river', label: '水系拓扑（沿河流重排）', icon: <DeploymentUnitOutlined /> },
    { type: 'divider' },
    { key: 'lr', label: '智能布局（横向流程 LR）', icon: <DeploymentUnitOutlined /> },
    { key: 'tb', label: '智能布局（纵向流程 TB）', icon: <DeploymentUnitOutlined /> },
    { type: 'divider' },
    { key: 'stack', label: '简单分层（按类型）', icon: <PartitionOutlined /> },
  ];

  const onLayoutMenu: MenuProps['onClick'] = ({ key }) => {
    if (key === 'river') { loadSnapshot(true); message.success('已按水系拓扑重排（已忽略保存的自定义坐标）'); }
    else if (key === 'lr') smartLayout('LR');
    else if (key === 'tb') smartLayout('TB');
    else if (key === 'stack') autoLayout();
  };

  // ====== 保存当前画布坐标到 PG ======
  const saveLayout = async () => {
    const payloads = nodes
      .filter((n) => !n.data.dirty || n.data.dirty === 'modified')
      .map((n) => ({
        node_type: n.data.kind,
        node_id: n.data.bizId,
        x: Math.round(n.position.x),
        y: Math.round(n.position.y),
      }));
    if (!payloads.length) { message.info('暂无可保存的节点坐标'); return; }
    setLayoutSaving(true);
    try {
      await graphAdminApi.saveCanvasLayout(payloads);
      savedLayoutRef.current = new Map(
        payloads.map((p) => [`${p.node_type}:${p.node_id}`, { x: p.x, y: p.y }]),
      );
      message.success(`已保存 ${payloads.length} 个节点坐标`);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '保存布局失败');
    } finally {
      setLayoutSaving(false);
    }
  };

  // ====== 一键保存 ======
  const saveAll = async () => {
    // 自动暂存当前正在编辑的节点/边，避免用户填了表单但忘点暂存
    if (selected?.kind === 'node') applyNodeEdit();
    else if (selected?.kind === 'edge') applyEdgeEdit();
    // 等一帧让 setNodes/setEdges 生效
    await new Promise(r => setTimeout(r, 0));
    // 取 ref 最新值（applyNodeEdit 的 setNodes/setEdges 已经生效到 ref）
    const latestNodes = nodesRef.current;
    const latestEdges = edgesRef.current;
    setSaving(true);
    let success = 0;
    const errors: string[] = [];
    try {
      // 1. 删除边
      for (const e of latestEdges.filter((x) => x.data?.dirty === 'deleted')) {
        const d = e.data as EdgeData;
        if ((d as any).readonly) continue; // 只读边不应进入删除队列，防御性跳过
        try {
          if (d.kind === 'FLOWS_INTO') await graphAdminApi.deleteRiverFlow(d.originalSource!, d.originalTarget!);
          else if (d.kind === 'UPSTREAM_OF') await graphAdminApi.deleteStationFlow(d.originalSource!, d.originalTarget!);
          else if (d.kind === 'ON_RIVER') await graphAdminApi.unbindStationFromRiver(d.originalSource!, d.originalTarget!);
          else if (d.kind === 'DISCHARGES_TO') await graphAdminApi.unbindPollutionFromRiver(d.originalSource!, d.originalTarget!);
          else if (d.kind === 'FLOWS_INTO_CONFLUENCE') await graphAdminApi.deleteConfluenceInflow(d.originalSource!, d.originalTarget!);
          else if (d.kind === 'CONFLUENCE_FLOWS_TO') await graphAdminApi.deleteConfluenceOutflow(d.originalSource!, d.originalTarget!);
          success++;
        } catch (err: any) { errors.push(`删边 ${d.kind}: ${err?.response?.data?.detail || err.message}`); }
      }
      // 2. 删除节点
      for (const n of latestNodes.filter((x) => x.data.dirty === 'deleted')) {
        try {
          if (n.data.kind === 'river') await graphAdminApi.deleteRiver(n.data.bizId);
          else if (n.data.kind === 'pollution') await graphAdminApi.deletePollutionSource(n.data.bizId);
          else if (n.data.kind === 'confluence') await graphAdminApi.deleteConfluence(n.data.bizId);
          // station 不删（由 /stations API 管理）；district 已不上画布
          success++;
        } catch (err: any) { errors.push(`删节点 ${n.data.bizId}: ${err?.response?.data?.detail || err.message}`); }
      }
      // 3. 新建/更新节点
      for (const n of latestNodes.filter((x) => x.data.dirty === 'new' || x.data.dirty === 'modified')) {
        try {
          const { kind, bizId, name, raw } = n.data;
          if (kind === 'river') {
            if (n.data.dirty === 'new') await graphAdminApi.createRiver({ river_id: bizId, name, ...raw });
            else await graphAdminApi.updateRiver(bizId, { name, ...raw });
          } else if (kind === 'pollution') {
            if (n.data.dirty === 'new') await graphAdminApi.createPollutionSource({ source_id: bizId, name, source_type: raw.source_type || 'IndustrialSource', risk_level: raw.risk_level || 'medium', ...raw });
            else await graphAdminApi.updatePollutionSource(bizId, { name, ...raw });
          } else if (kind === 'confluence') {
            if (n.data.dirty === 'new') await graphAdminApi.createConfluence({ confluence_id: bizId, name, ...raw });
            else await graphAdminApi.updateConfluence(bizId, { name, ...raw });
          } else if (kind === 'station') {
            // 站点属性写入 Neo4j（name / river_km / district 等）
            await graphAdminApi.updateStation(bizId, { name, ...(raw.river_km != null ? { river_km: raw.river_km } : {}), ...(raw.district ? { district: raw.district } : {}) });
          }
          // station 的 PG 元信息由 /stations API 另行管理
          success++;
        } catch (err: any) { errors.push(`保存节点 ${n.data.bizId}: ${err?.response?.data?.detail || err.message}`); }
      }
      // 4. 新建边
      for (const e of latestEdges.filter((x) => x.data?.dirty === 'new')) {
        const d = e.data as EdgeData;
        try {
          const src = latestNodes.find((n) => n.id === e.source)!;
          const tgt = latestNodes.find((n) => n.id === e.target)!;
          if (d.kind === 'FLOWS_INTO') {
            await graphAdminApi.createRiverFlow({ upstream_id: src.data.bizId, downstream_id: tgt.data.bizId, distance_km: d.raw.distance_km, confluence_id: d.raw.confluence_id });
          } else if (d.kind === 'UPSTREAM_OF') {
            await graphAdminApi.createStationFlow({ upstream_id: src.data.bizId, downstream_id: tgt.data.bizId, distance_km: d.raw.distance_km, travel_hours: d.raw.travel_hours });
          } else if (d.kind === 'ON_RIVER') {
            // RF 方向反转了（src=river, tgt=station），保存时交换回 Neo4j 方向
            await graphAdminApi.bindStationToRiver(tgt.data.bizId, src.data.bizId);
          } else if (d.kind === 'DISCHARGES_TO') {
            await graphAdminApi.bindPollutionToRiver(src.data.bizId, tgt.data.bizId);
          } else if (d.kind === 'FLOWS_INTO_CONFLUENCE') {
            await graphAdminApi.createConfluenceInflow({ river_id: src.data.bizId, confluence_id: tgt.data.bizId, distance_km: d.raw.distance_km });
          } else if (d.kind === 'CONFLUENCE_FLOWS_TO') {
            await graphAdminApi.createConfluenceOutflow({ confluence_id: src.data.bizId, river_id: tgt.data.bizId, distance_km: d.raw.distance_km });
          }
          success++;
        } catch (err: any) { errors.push(`新建边 ${d.kind}: ${err?.response?.data?.detail || err.message}`); }
      }
      if (errors.length) {
        message.warning(`保存完成：成功 ${success} 条，失败 ${errors.length} 条`);
        console.warn('保存失败明细:\n' + errors.join('\n'));
      } else {
        message.success(`保存完成：共 ${success} 条变更`);
      }
      await loadSnapshot();
    } finally {
      setSaving(false);
    }
  };

  // ====== 渲染 ======
  const currentNode = selected?.kind === 'node' ? nodes.find((n) => n.id === selected.id) : undefined;
  const currentEdge = selected?.kind === 'edge' ? edges.find((e) => e.id === selected.id) : undefined;

  // 选中高亮：选中某个节点时，与其直接相关的边提亮、无关边减淡。
  // 不修改 edges state 本身（不影响保存/历史栈/dirty 追踪），只在渲染时派生一层样式覆盖
  const displayEdges = useMemo(() => {
    if (!selected || selected.kind !== 'node') return edges;
    const selId = selected.id;
    return edges.map((e) => {
      const related = e.source === selId || e.target === selId;
      const baseStyle = (e.style || {}) as CSSProperties;
      const overlay: CSSProperties = related
        ? { ...baseStyle, stroke: '#f59e0b', strokeWidth: 2.8, opacity: 1, strokeDasharray: undefined }
        : { ...baseStyle, opacity: 0.12 };
      return {
        ...e,
        style: overlay,
        animated: related ? true : (e as any).animated,
        zIndex: related ? 1000 : (e as any).zIndex,
        labelStyle: related
          ? { fill: '#b45309', fontWeight: 700 }
          : { fill: '#94a3b8', opacity: 0.4 },
      };
    });
  }, [edges, selected]);

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 180px)', minHeight: 520, border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
      <NodePalette />
      <div ref={wrapperRef} style={{ flex: 1, position: 'relative' }} onDrop={onDrop} onDragOver={onDragOver}>
        <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, display: 'flex', gap: 8 }}>
          <Button icon={<UndoOutlined />} onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)">撤销</Button>
          <Button icon={<RedoOutlined />} onClick={redo} disabled={!canRedo} title="重做 (Ctrl+Y)">重做</Button>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '0 8px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 }}>
            <EnvironmentOutlined style={{ color: '#dc2626' }} />
            <span style={{ color: '#6b7280' }}>污染源</span>
            <Switch size="small" checked={showPollution} onChange={setShowPollution} />
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '0 8px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 }}>
            <NodeIndexOutlined style={{ color: '#f97316' }} />
            <span style={{ color: '#6b7280' }}>溯源</span>
            <Switch size="small" checked={showTracing} onChange={setShowTracing} />
          </span>
          <Button icon={<PushpinOutlined />} loading={layoutSaving} onClick={saveLayout} title="把当前节点位置写入 PostgreSQL，下次打开保留">保存布局</Button>
          <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>导入 CSV</Button>
          <Dropdown menu={{ items: layoutMenuItems, onClick: onLayoutMenu }} trigger={['click']}>
            <Button icon={<PartitionOutlined />}>布局</Button>
          </Dropdown>
          <Badge count={dirtyCount} offset={[-6, 4]}>
            <Button icon={<ReloadOutlined />} onClick={() => loadSnapshot()} loading={loading}>刷新</Button>
          </Badge>
          <Popconfirm title={`将提交 ${dirtyCount} 条变更，确认？`} onConfirm={saveAll} disabled={dirtyCount === 0}>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={dirtyCount === 0}>
              一键保存 {dirtyCount > 0 && `(${dirtyCount})`}
            </Button>
          </Popconfirm>
        </div>
        <ReactFlow
          nodes={nodes}
          edges={displayEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, n) => setSelected({ kind: 'node', id: n.id })}
          onEdgeClick={(_, e) => setSelected({ kind: 'edge', id: e.id })}
          onPaneClick={() => setSelected(null)}
          fitView
          fitViewOptions={{ padding: 0.2 }}
        >
          <Background gap={16} size={1} />
          <Controls />
          <MiniMap pannable zoomable nodeColor={(n) => KIND_META[(n.data as NodeData).kind]?.color || '#999'} />
        </ReactFlow>
      </div>

      <Drawer
        title={currentNode ? `节点：${KIND_META[currentNode.data.kind].label}` : currentEdge ? `关系：${currentEdge.data?.kind}` : '属性面板'}
        open={!!selected}
        onClose={() => setSelected(null)}
        width={360}
        mask={false}
        extra={selected && (
          <Popconfirm title={selected.kind === 'node' ? '删除此节点？' : '删除此关系？'} onConfirm={deleteSelected}>
            <Button danger size="small">删除</Button>
          </Popconfirm>
        )}
      >
        {currentNode && (
          <Form form={form} layout="vertical" size="small">
            {currentNode.data.dirty && (
              <Tag color={currentNode.data.dirty === 'new' ? 'green' : currentNode.data.dirty === 'modified' ? 'gold' : 'red'}>
                {currentNode.data.dirty === 'new' ? '新增' : currentNode.data.dirty === 'modified' ? '已修改' : '待删除'}
              </Tag>
            )}
            <Form.Item label={KIND_META[currentNode.data.kind].idField} name="bizId" rules={[{ required: true }]}>
              <Input disabled={currentNode.data.dirty !== 'new'} />
            </Form.Item>
            <Form.Item label="名称" name="name" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            {currentNode.data.kind === 'river' && (
              <>
                <Form.Item label="级别" name="level"><InputNumber style={{ width: '100%' }} /></Form.Item>
                <Form.Item label="所属水系" name="system"><Input /></Form.Item>
                <Form.Item label="长度(km)" name="length_km"><InputNumber style={{ width: '100%' }} /></Form.Item>
              </>
            )}
            {currentNode.data.kind === 'station' && (
              <>
                <Alert type="info" showIcon banner
                  message="填写「所属河流」和「公里桩号」后暂存，将自动挂载到河流对应位置"
                  style={{ marginBottom: 12 }} />
                <Form.Item label="所属河流" name="river_id">
                  <Select options={riverOptions} allowClear showSearch
                          optionFilterProp="label" placeholder="选择所属河流" />
                </Form.Item>
                <Form.Item label="河流公里桩号" name="river_km">
                  <InputNumber style={{ width: '100%' }} min={0} step={0.1} placeholder="距源头 km（0=源头）" />
                </Form.Item>
                <Form.Item label="行政区" name="district_code">
                  <Select options={districtOptions} allowClear showSearch
                          optionFilterProp="label" placeholder="选择行政区" />
                </Form.Item>
              </>
            )}
            {currentNode.data.kind === 'pollution' && (
              <>
                <Alert type="info" showIcon banner
                  message="填写「所属河流」后暂存，将自动挂载到河流上方"
                  style={{ marginBottom: 12 }} />
                <Form.Item label="类别" name="source_type"><Input placeholder="IndustrialSource / AgriculturalSource / MunicipalSource" /></Form.Item>
                <Form.Item label="风险等级" name="risk_level"><Input placeholder="critical / high / medium / low" /></Form.Item>
                <Form.Item label="所属河流" name="river_id">
                  <Select options={riverOptions} allowClear showSearch
                          optionFilterProp="label" placeholder="选择所属河流" />
                </Form.Item>
                <Form.Item label="河流公里桩号" name="river_km">
                  <InputNumber style={{ width: '100%' }} min={0} step={0.1} placeholder="距源头 km" />
                </Form.Item>
                <Form.Item label="行政区" name="district_code">
                  <Select options={districtOptions} allowClear showSearch
                          optionFilterProp="label" placeholder="选择行政区" />
                </Form.Item>
              </>
            )}
            {currentNode.data.kind === 'confluence' && (
              <>
                <Form.Item label="交汇类型" name="confluence_type">
                  <Select placeholder="选择交汇类型" allowClear options={[
                    { label: '汇聚型（多河合一）', value: 'merge' },
                    { label: '汇入型（支流注入）', value: 'tributary' },
                  ]} />
                </Form.Item>
                <Form.Item noStyle shouldUpdate={(prev, cur) => prev.confluence_type !== cur.confluence_type}>
                  {({ getFieldValue }) => getFieldValue('confluence_type') === 'tributary' ? (
                    <Form.Item label="贯通河流" name="through_river_id">
                      <Select options={riverOptions} allowClear showSearch
                              optionFilterProp="label" placeholder="选择贯通的主河流" />
                    </Form.Item>
                  ) : null}
                </Form.Item>
                <Form.Item label="经度" name="longitude"><InputNumber style={{ width: '100%' }} /></Form.Item>
                <Form.Item label="纬度" name="latitude"><InputNumber style={{ width: '100%' }} /></Form.Item>
                <Form.Item label="河流公里桩号" name="river_km">
                  <InputNumber style={{ width: '100%' }} min={0} step={0.1} placeholder="在下游河流的 km" />
                </Form.Item>
                <Form.Item label="行政区" name="district_code">
                  <Select options={districtOptions} allowClear showSearch
                          optionFilterProp="label" placeholder="选择行政区" />
                </Form.Item>
              </>
            )}
            <Space>
              <Button type="primary" onClick={applyNodeEdit}>暂存修改</Button>
            </Space>
          </Form>
        )}
        {currentEdge && (
          <Form form={form} layout="vertical" size="small">
            {currentEdge.data?.dirty && (
              <Tag color={currentEdge.data.dirty === 'new' ? 'green' : 'red'}>
                {currentEdge.data.dirty === 'new' ? '新增' : '待删除'}
              </Tag>
            )}
            <div style={{ marginBottom: 12, fontSize: 12, color: '#6b7280' }}>
              {currentEdge.data?.originalSource || currentEdge.source} → {currentEdge.data?.originalTarget || currentEdge.target}
            </div>
            {(currentEdge.data?.kind === 'FLOWS_INTO' || currentEdge.data?.kind === 'UPSTREAM_OF'
              || currentEdge.data?.kind === 'FLOWS_INTO_CONFLUENCE' || currentEdge.data?.kind === 'CONFLUENCE_FLOWS_TO') && (
              <Form.Item label="距离 (km)" name="distance_km"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
            )}
            {currentEdge.data?.kind === 'UPSTREAM_OF' && (
              <Form.Item label="流速时长 (h)" name="travel_hours"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
            )}
            {currentEdge.data?.kind === 'FLOWS_INTO' && (
              <Form.Item label="交汇点 ID" name="confluence_id"><Input /></Form.Item>
            )}
            <Space>
              <Button type="primary" onClick={applyEdgeEdit}>暂存修改</Button>
            </Space>
          </Form>
        )}
      </Drawer>

      <BulkImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={() => { setImportOpen(false); loadSnapshot(); }}
      />
    </div>
  );
}

export default function GraphEditor() {
  return (
    <ReactFlowProvider>
      <GraphEditorInner />
    </ReactFlowProvider>
  );
}

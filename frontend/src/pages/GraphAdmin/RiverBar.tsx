/**
 * RiverBar 自定义节点：河流长条 + 动态多端口
 *
 * - 宽度由 layout 引擎按站点数/站点 cum_km 计算，经 data.renderWidth 传入
 * - 卡片内部水流方向：右（上游）→ 左（下游），与画布整体桑基方向一致
 * - 左端 left Handle：source，输出到下游 FLOWS_INTO_CONFLUENCE / FLOWS_INTO
 * - 右端 right Handle：target，接收上游 CONFLUENCE_FLOWS_TO
 * - 底部 bottomPorts：每个站点一个 handle，id = `bot-${stationBizId}`
 * - 顶部 topPorts：每个污染源一个 handle，id = `top-${pollutionBizId}`
 */
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { MIN_RIVER_WIDTH, STATION_PITCH, RIVER_PADDING } from './riverNetworkLayout';
import { useUIStore } from '../../store';
import { maskName } from '../../utils/mask';

interface RiverPort {
  id: string;
  x: number; // 相对河流左端的像素 x
}

interface RiverBarData {
  kind: 'river';
  bizId: string;
  name: string;
  raw: Record<string, any>;
  dirty?: 'new' | 'modified' | 'deleted';
  renderWidth?: number;
  bottomPorts?: RiverPort[]; // 站点端口（底部）
  topPorts?: RiverPort[];    // 污染源端口（顶部）
  [key: string]: unknown;
}

const LEVEL_COLOR: Record<number, string> = {
  1: '#0c4a6e',
  2: '#0369a1',
  3: '#0891b2',
  4: '#38bdf8',
};

export default function RiverBar({ data, selected }: NodeProps<Node<RiverBarData>>) {
  const demoMode = useUIStore((s) => s.demoMode);
  const lengthKm = (data.raw?.length_km as number | undefined) ?? 0;
  const level = (data.raw?.level as number | undefined) ?? 2;
  const width = data.renderWidth ?? MIN_RIVER_WIDTH;
  const color = LEVEL_COLOR[level] || LEVEL_COLOR[2];

  const dirtyBg = data.dirty === 'new' ? 'rgba(34,197,94,0.15)'
    : data.dirty === 'modified' ? 'rgba(250,204,21,0.2)'
    : data.dirty === 'deleted' ? 'rgba(239,68,68,0.15)'
    : 'rgba(255,255,255,0.96)';

  // 背景刻度线：按站点最小间距布置
  const ticks: number[] = [];
  const inner = Math.max(0, width - RIVER_PADDING * 2);
  const slotCount = Math.floor(inner / STATION_PITCH);
  for (let i = 1; i < slotCount; i++) {
    ticks.push(RIVER_PADDING + i * STATION_PITCH);
  }

  const bottomPorts: RiverPort[] = Array.isArray(data.bottomPorts) ? data.bottomPorts : [];
  const topPorts: RiverPort[] = Array.isArray(data.topPorts) ? data.topPorts : [];

  return (
    <div
      style={{
        width,
        height: 34,
        borderRadius: 8,
        background: dirtyBg,
        border: `2px solid ${selected ? '#fbbf24' : color}`,
        boxShadow: selected
          ? '0 0 0 3px rgba(251,191,36,.25)'
          : '0 2px 6px rgba(0,0,0,.1)',
        position: 'relative',
        fontSize: 12,
        opacity: data.dirty === 'deleted' ? 0.5 : 1,
        overflow: 'visible',
      }}
    >
      {/* 左端：下游输出口（水流离开此河流流向下游） */}
      <Handle
        id="left"
        type="source"
        position={Position.Left}
        style={{ background: color, width: 10, height: 10, left: -5 }}
      />
      {/* 右端：上游汇入接收口（上游河流的水从这里注入） */}
      <Handle
        id="right"
        type="target"
        position={Position.Right}
        style={{ background: color, width: 10, height: 10, right: -5 }}
      />

      {/* 顶部端口：污染源(红色) + 汇入型交汇点(绿色)，按 x 定位 */}
      {topPorts.map((p) => {
        const isCf = p.id.startsWith('cf-');
        return (
          <Handle
            key={`top-${p.id}`}
            id={`top-${p.id}`}
            type="target"
            position={Position.Top}
            style={{
              background: isCf ? '#fb923c' : '#dc2626',
              width: isCf ? 9 : 7,
              height: isCf ? 9 : 7,
              top: isCf ? -5 : -4,
              left: Math.max(4, Math.min(width - 4, p.x)) - (isCf ? 4.5 : 3.5),
            }}
          />
        );
      })}
      {/* 通用 top handle：始终渲染，供新污染源连线落位 */}
      <Handle id="top" type="target" position={Position.Top} style={{ background: color, width: 8, height: 8, top: -4, opacity: topPorts.length > 0 ? 0.35 : 1 }} />

      {/* 底部站点端口：每个站点一个 handle，按 x 定位 */}
      {bottomPorts.map((p) => (
        <Handle
          key={`bot-${p.id}`}
          id={`bot-${p.id}`}
          type="source"
          position={Position.Bottom}
          style={{
            background: '#16a34a',
            width: 7,
            height: 7,
            bottom: -4,
            left: Math.max(4, Math.min(width - 4, p.x)) - 3.5,
          }}
        />
      ))}
      {/* 通用 bottom handle：始终渲染，供新站点连线落位（同时作为 target 接收站点→河流拖拽） */}
      <Handle id="bottom" type="source" position={Position.Bottom} style={{ background: color, width: 8, height: 8, bottom: -4, opacity: bottomPorts.length > 0 ? 0.35 : 1 }} />
      <Handle id="bottom-in" type="target" position={Position.Bottom} style={{ background: '#16a34a', width: 10, height: 10, bottom: -5, opacity: 0.5 }} />

      {/* 水流方向指示（右 → 左）：右侧浅源头 → 左侧深干流下游 */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: 0,
          width: '100%',
          height: 4,
          transform: 'translateY(-50%)',
          background: `linear-gradient(270deg, ${color}22, ${color})`,
          borderRadius: 2,
          pointerEvents: 'none',
        }}
      />
      {/* 站位刻度线 */}
      {ticks.map((t) => (
        <div
          key={t}
          style={{
            position: 'absolute',
            top: 4,
            left: t,
            width: 1,
            height: 10,
            background: `${color}55`,
            pointerEvents: 'none',
          }}
        />
      ))}
      {/* 河流名 */}
      <div
        style={{
          position: 'absolute',
          top: -20,
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 12,
          fontWeight: 700,
          color: color,
          whiteSpace: 'nowrap',
          textShadow: '0 1px 2px rgba(255,255,255,0.9)',
          pointerEvents: 'none',
        }}
      >
        {demoMode ? maskName(data.name || data.bizId) : (data.name || data.bizId)}
        {lengthKm ? (
          <span style={{ fontSize: 10, color: '#64748b', fontWeight: 400, marginLeft: 6 }}>
            {lengthKm}km
          </span>
        ) : null}
      </div>
      <div style={{ position: 'absolute', bottom: -16, left: 2, fontSize: 10, color: '#94a3b8', pointerEvents: 'none' }}>
        汇入
      </div>
      <div style={{ position: 'absolute', bottom: -16, right: 2, fontSize: 10, color: '#94a3b8', pointerEvents: 'none' }}>
        源头
      </div>
    </div>
  );
}

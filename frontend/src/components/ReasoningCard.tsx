import React from 'react';
import { Tag } from 'antd';

/**
 * 智能体推理链展示卡片（machine + human 双输出对齐 PPT 约定）
 * - human：自然语言推理，按「冒号分隔的多行文本」解析为结构化条目
 * - machine：关键决策字段，以 Tag 方式展示
 * - 特殊字段 similar_cases / actions 自动扩展渲染
 */
export interface ReasoningCardProps {
  title: string;
  icon?: React.ReactNode;
  human?: string | null;
  machine?: Record<string, any> | null;
  machineKeys?: {
    key: string;
    label: string;
    color?: boolean;
    formatter?: (v: any) => string;
  }[];
}

export function ReasoningCard({
  title,
  icon,
  human,
  machine,
  machineKeys,
}: ReasoningCardProps) {
  if (!human && !machine) return null;

  const lines = (human || '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const idx = l.indexOf('：');
      const idx2 = idx >= 0 ? idx : l.indexOf(':');
      if (idx2 < 0) return { label: '', text: l };
      return { label: l.slice(0, idx2).trim(), text: l.slice(idx2 + 1).trim() };
    });

  return (
    <div className="p-4 bg-gradient-to-br from-slate-50 to-cyan-50/40 rounded-xl border border-cyan-100">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h4 className="font-medium text-gray-900">{title}</h4>
        <Tag color="cyan" className="text-[10px]">
          AI 推理链
        </Tag>
      </div>

      {lines.length > 0 && (
        <div className="space-y-2 mb-3">
          {lines.map((ln, i) => (
            <div key={i} className="flex gap-2 text-sm">
              {ln.label && (
                <span className="flex-shrink-0 font-medium text-cyan-700 min-w-[80px]">
                  {ln.label}
                </span>
              )}
              <span className="text-gray-700 flex-1 whitespace-pre-wrap">{ln.text}</span>
            </div>
          ))}
        </div>
      )}

      {machine && machineKeys && machineKeys.length > 0 && (
        <div className="pt-3 border-t border-cyan-100/60 flex flex-wrap gap-2">
          {machineKeys.map((mk) => {
            const raw = (machine as any)[mk.key];
            if (raw === undefined || raw === null || raw === '') return null;
            const text = mk.formatter ? mk.formatter(raw) : String(raw);
            const tagColor = mk.color
              ? raw === 'red' || raw === 'critical'
                ? 'red'
                : raw === 'orange' || raw === 'high'
                  ? 'orange'
                  : raw === 'yellow' || raw === 'medium'
                    ? 'gold'
                    : 'blue'
              : undefined;
            return (
              <Tag key={mk.key} color={tagColor} className="m-0">
                <span className="text-gray-500 mr-1">{mk.label}:</span>
                <span className="font-medium">{text}</span>
              </Tag>
            );
          })}
          {Array.isArray((machine as any).similar_cases) &&
            (machine as any).similar_cases.length > 0 && (
              <div className="w-full mt-2 text-xs text-gray-500">
                <span className="mr-1">相似案例:</span>
                {(machine as any).similar_cases.slice(0, 3).map((c: any, i: number) => (
                  <span key={i} className="mr-2">
                    {c.case_code}
                    {c.recovery_days != null ? `(${c.recovery_days}天)` : ''}
                  </span>
                ))}
              </div>
            )}
          {Array.isArray((machine as any).actions) && (machine as any).actions.length > 0 && (
            <div className="w-full mt-2 text-xs text-gray-600">
              <span className="text-gray-500 mr-1">推荐措施:</span>
              {(machine as any).actions.slice(0, 4).map((a: string, i: number) => (
                <span
                  key={i}
                  className="inline-block mr-2 px-2 py-0.5 bg-white rounded border border-gray-200"
                >
                  {i + 1}. {a}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ReasoningCard;

import type { CSSProperties, ReactNode } from 'react';
import { useMaskedText } from '../hooks/useMaskedText';

interface MaskedTextProps {
  /** 要展示的原始文本（演示模式下会被脱敏） */
  text: unknown;
  /**
   * 脱敏模式：
   *  - 'name'：按后缀规则整值脱敏（默认；适用于地名、站点名、河流名）
   *  - 'free'：自由文本词典式替换（适用于预警 title/description 等含地名的自由文本）
   */
  mode?: 'name' | 'free';
  /** 可选前缀（如"站点："），不会被脱敏 */
  prefix?: ReactNode;
  /** 可选后缀，不会被脱敏 */
  suffix?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * 文本脱敏展示组件
 * 自动订阅 useUIStore.demoMode，切换时组件自动重新渲染
 *
 * 用法：
 *   <MaskedText text={station.station_name} />
 *   <MaskedText text={alert.description} mode="free" />
 */
export function MaskedText({ text, mode = 'name', prefix, suffix, className, style }: MaskedTextProps) {
  const mask = useMaskedText();
  return (
    <span className={className} style={style}>
      {prefix}
      {mask(text, mode)}
      {suffix}
    </span>
  );
}

export default MaskedText;

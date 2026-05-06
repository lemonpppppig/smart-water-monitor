import { useUIStore } from '../store';
import { maskName, maskFreeText } from '../utils/mask';

/**
 * 根据当前演示模式返回一个文本脱敏函数
 * - 演示模式 ON：对文本按后缀规则脱敏
 * - 演示模式 OFF：原样返回
 *
 * 用法：
 *   const mask = useMaskedText();
 *   <Tooltip title={mask(station.station_name)}>...</Tooltip>
 */
export function useMaskedText() {
  const demoMode = useUIStore((s) => s.demoMode);
  return (text: unknown, mode: 'name' | 'free' = 'name'): string => {
    if (!demoMode) return text === null || text === undefined ? '' : String(text);
    return mode === 'free' ? maskFreeText(text) : maskName(text);
  };
}

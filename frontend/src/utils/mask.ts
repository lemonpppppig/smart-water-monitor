/**
 * 地名脱敏核心算法
 *
 * 规则（方案 A · 动态星号数）：
 *   1. 优先按 SUFFIX_LV1 复合后缀最长匹配 → "***" + 后缀（星号数 = 原长度 - 后缀长度，最少 3）
 *   2. 若未命中，按 SUFFIX_LV2 单字后缀匹配 → 同上
 *   3. 兜底（都不命中）：首字 + *** + 尾字；长度 ≤ 2 时全部替换为 *
 *
 * 示例：
 *   章贡区         → ***区
 *   赣江           → ***江
 *   赣江水源地站    → *****站
 *   章江赣江汇合处  → ****汇合处
 *   赣州钢铁厂      → ***钢铁厂
 *   信丰脐橙产业基地 → ****脐橙产业基地
 */

import {
  SUFFIX_LV1,
  SUFFIX_LV2,
  SENSITIVE_FIELDS,
  FREE_TEXT_FIELDS,
  MASK_REPLACE_DICT,
} from './maskDict';

const MIN_STARS = 3;

function stars(n: number): string {
  return '*'.repeat(Math.max(MIN_STARS, n));
}

/** 缓存已脱敏结果，避免重复计算 */
const maskCache = new Map<string, string>();

/**
 * 单个文本脱敏（按后缀规则）
 */
export function maskName(text: unknown): string {
  if (text === null || text === undefined) return '';
  const s = String(text);
  if (!s) return '';

  const cached = maskCache.get(s);
  if (cached !== undefined) return cached;

  let result: string;

  if (s.length <= 1) {
    result = '*';
  } else {
    // Level 1 复合后缀（最长优先）
    let matched = false;
    for (const suf of SUFFIX_LV1) {
      if (s.length > suf.length && s.endsWith(suf)) {
        result = stars(s.length - suf.length) + suf;
        matched = true;
        break;
      }
    }
    // Level 2 单字后缀
    if (!matched) {
      const last = s.charAt(s.length - 1);
      if (SUFFIX_LV2.includes(last)) {
        result = stars(s.length - 1) + last;
        matched = true;
      }
    }
    // 兜底：首 + *** + 尾
    if (!matched) {
      if (s.length === 2) result = s.charAt(0) + '*';
      else result = s.charAt(0) + '***' + s.charAt(s.length - 1);
    }
  }

  maskCache.set(s, result!);
  return result!;
}

/**
 * 自由文本脱敏：用 MASK_REPLACE_DICT 中的词典条目做 replace
 * （预警 title/description/cause 这类含地名的自由文本）
 */
export function maskFreeText(text: unknown): string {
  if (text === null || text === undefined) return '';
  let s = String(text);
  if (!s) return '';

  for (const key of MASK_REPLACE_DICT) {
    if (s.includes(key)) {
      // 整个字符串里所有出现的位置都替换
      s = s.split(key).join(maskName(key));
    }
  }
  return s;
}

/**
 * 深度脱敏：递归遍历对象，对命中字段名的值应用脱敏
 *   - SENSITIVE_FIELDS：整值脱敏（maskName）
 *   - FREE_TEXT_FIELDS：词典式替换（maskFreeText）
 *
 * 注意事项：
 *   - 不修改原对象（浅拷贝 + 递归返回新对象）
 *   - 跳过 null / Date / Blob / File / ArrayBuffer / FormData 等非普通对象
 */
export function maskDeep<T = unknown>(data: T): T {
  return _walk(data) as T;
}

function _walk(val: unknown, parentKey?: string): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') {
    if (parentKey && SENSITIVE_FIELDS.includes(parentKey)) {
      return maskName(val);
    }
    if (parentKey && FREE_TEXT_FIELDS.includes(parentKey)) {
      return maskFreeText(val);
    }
    return val;
  }
  if (typeof val !== 'object') return val;

  // 跳过特殊对象
  if (
    val instanceof Date ||
    val instanceof Blob ||
    val instanceof ArrayBuffer ||
    (typeof FormData !== 'undefined' && val instanceof FormData) ||
    (typeof File !== 'undefined' && val instanceof File)
  ) {
    return val;
  }

  if (Array.isArray(val)) {
    return val.map((item) => _walk(item, parentKey));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    out[k] = _walk(v, k);
  }
  return out;
}

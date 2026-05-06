/**
 * MQTT 模块类型枚举与字段映射
 * - 用于站点数据源绑定 Tab、MQTT 连接管理、MQTT 实时数据页共用
 * - 与后端 data-service 里的 module_types 解析保持一致
 */

export interface MqttModuleDef {
  key: string;
  label: string;
  color: string;
  /** 该模块下预期采集的指标字段（用于在绑定弹窗里显示"字段映射预览"） */
  metrics: string[];
}

export const MQTT_MODULES: MqttModuleDef[] = [
  { key: 'm1', label: '水质基础', color: 'blue', metrics: ['ph', 'conductivity', 'water_temperature', 'turbidity'] },
  { key: 'm2', label: '营养盐', color: 'green', metrics: ['ammonia_nitrogen', 'total_phosphorus', 'total_nitrogen'] },
  { key: 'm3', label: '生物指标', color: 'purple', metrics: ['dissolved_oxygen', 'chlorophyll_a', 'algae_density'] },
  { key: 'm4', label: '水文要素', color: 'cyan', metrics: ['transparency', 'flow_rate', 'water_level'] },
  { key: 'ap', label: '气压', color: 'orange', metrics: ['air_pressure'] },
  { key: 'ill', label: '光照', color: 'gold', metrics: ['illuminance'] },
  { key: 'th', label: '温湿度', color: 'magenta', metrics: ['air_temperature', 'humidity'] },
];

export const MODULE_LABEL_MAP: Record<string, string> = MQTT_MODULES.reduce(
  (acc, m) => ({ ...acc, [m.key]: m.label }),
  {},
);

export const MODULE_COLOR_MAP: Record<string, string> = MQTT_MODULES.reduce(
  (acc, m) => ({ ...acc, [m.key]: m.color }),
  {},
);

/**
 * 统一 Topic：所有模块共享一个 topic，设备通过 payload 里的 m1/m2/m3/m4/ap/ill/th
 * 等键分发不同类型的数据；topic 本身不再承担模块区分职责。
 */
export const DEFAULT_MQTT_TOPIC = 'water_environment/sensors/data';

/**
 * 历史兼容：老数据的 topic 可能是 .../m1 的后缀式，已弃用。
 * 新逻辑一律优先读后端 connection.module_keys，此函数仅用于绝对兄底。
 */
export function guessModuleFromTopic(topic: string): string | null {
  if (!topic) return null;
  const lower = topic.toLowerCase();
  for (const m of MQTT_MODULES) {
    if (lower.endsWith('/' + m.key) || lower.includes('/' + m.key + '/')) return m.key;
  }
  return null;
}

/**
 * @deprecated topic 已统一为 DEFAULT_MQTT_TOPIC，无需拼接模块后缀。
 * 保留签名仅为了避免老调用点报错，统一返回 DEFAULT_MQTT_TOPIC。
 */
export function suggestTopic(_stationCode: string, _moduleKey: string): string {
  return DEFAULT_MQTT_TOPIC;
}

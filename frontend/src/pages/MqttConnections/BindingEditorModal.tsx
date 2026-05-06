import { useEffect, useState } from 'react';
import { Modal, Form, Input, InputNumber, Select, Tag, Alert, Space, message } from 'antd';
import { mqttApi, stationApi } from '@/services/api';
import { MQTT_MODULES, DEFAULT_MQTT_TOPIC } from '@/constants/mqttModules';

/**
 * 通用"MQTT 连接/绑定"编辑弹窗
 *
 * 用法：
 *   - 站点详情里给当前站点加 topic：<BindingEditorModal stationId=xxx stationCode=xxx />
 *   - 全局 MQTT 页新增/编辑：<BindingEditorModal editing={conn} />
 *
 * 能力：
 *   - 自动校验"同一站点 + 同一 module"是否冲突（前端层拦截）
 *   - 填完 topic 后自动推测 module；反之选了 module 可一键带出推荐 topic
 *   - 显示该 module 下会被解析写入的指标字段，让绑定"可解释"
 */

export interface BindingEditorModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** 编辑已有连接时传入 */
  editing?: any;
  /** 站点视角：预绑定到该站点 */
  stationId?: string;
  stationCode?: string;
  stationName?: string;
  /** 已有连接列表，用于冲突校验 */
  existingConnections?: Array<{ id: string; station_id?: string; topic?: string }>;
}

export default function BindingEditorModal({
  open,
  onClose,
  onSuccess,
  editing,
  stationId,
  stationCode,
  stationName,
  existingConnections = [],
}: BindingEditorModalProps) {
  const [form] = Form.useForm();
  const isEdit = !!editing;

  useEffect(() => {
    if (!open) return;
    if (editing) {
      // 模块以后端 module_keys 为准；topic 已统一为 DEFAULT_MQTT_TOPIC，不再从后缀反推
      const mks: string[] = Array.isArray(editing.module_keys) ? editing.module_keys : [];
      form.setFieldsValue({
        ...editing,
        topic: editing.topic || DEFAULT_MQTT_TOPIC,
        module_key: mks,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        name: stationName ? `${stationName} 传感器` : '水利环境传感器',
        broker_host: '120.77.155.186',
        broker_port: 1883,
        username: 'user_slhj_05',
        password: 'user_slhj_05',
        qos: 1,
        topic: DEFAULT_MQTT_TOPIC,
        station_id: stationId,
        station_name: stationName,
      });
    }
  }, [open, editing, stationId, stationName, form]);

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const { module_key: _mk, ...rest } = values;
    const moduleKeys: string[] = Array.isArray(_mk) ? _mk : _mk ? [_mk] : [];
    const payload: any = { ...rest, module_keys: moduleKeys };

    // 站点视角下 stationId 作为 prop 传入，Form 内没有对应 Form.Item，
    // validateFields 不会返回该字段，这里显式回填，避免保存后绑定丢失站点
    if (!isEdit && stationId) {
      payload.station_id = stationId;
      if (stationName) payload.station_name = stationName;
    }

    // 冲突校验：同站点下已存在相同模块的绑定（排除自己）
    if (payload.station_id && moduleKeys.length) {
      const conflictModules = moduleKeys.filter((mk) =>
        existingConnections.some((c: any) => {
          if (c.id === editing?.id) return false;
          if (c.station_id !== payload.station_id) return false;
          const existingKeys: string[] = Array.isArray(c.module_keys) ? c.module_keys : [];
          return existingKeys.includes(mk);
        }),
      );
      if (conflictModules.length) {
        const labels = conflictModules
          .map((mk) => MQTT_MODULES.find((m) => m.key === mk)?.label || mk)
          .join('、');
        Modal.confirm({
          title: '绑定冲突',
          content: `站点已存在"${labels}"模块的绑定，是否继续？`,
          onOk: () => doSubmit(payload),
        });
        return;
      }
    }
    await doSubmit(payload);
  };

  const doSubmit = async (payload: any) => {
    try {
      let saved: any = null;
      if (isEdit) {
        saved = await mqttApi.updateConnection(editing.id, payload);
      } else {
        saved = await mqttApi.createConnection(payload);
      }
      // 从返回体穿透后端实际落库的 module_keys，验证字段是否真的被持久化
      const returned: string[] = saved?.connection?.module_keys ?? saved?.module_keys ?? [];
      const expected: string[] = payload.module_keys || [];
      if (expected.length && returned.length === 0) {
        // 代码包已发出但后端没射着。最可能的原因：后端还是旧版本，module_keys 字段未上线
        Modal.warning({
          title: '模块未落库',
          content:
            '连接已创建，但后端返回的 module_keys 为空。请确认后端已重启使用最新代码，或检查 mqtt_connections 表是否已有 module_keys 列。',
        });
      } else {
        message.success(isEdit ? '绑定已更新' : '绑定已保存');
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || '请检查后端是否可用';
      Modal.error({ title: '操作失败', content: String(detail) });
    }
  };

  return (
    <Modal
      title={isEdit ? '编辑 MQTT 连接' : stationName ? `为「${stationName}」新增数据源` : '新增 MQTT 连接'}
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      okText="保存"
      cancelText="取消"
      width={620}
      destroyOnClose
    >
      {stationName && !isEdit && (
        <Alert
          type="info"
          showIcon
          className="mb-4"
          message={`将自动绑定到站点：${stationName}（${stationCode || stationId}）`}
        />
      )}
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="连接名称">
          <Input placeholder="如: 水利环境传感器" />
        </Form.Item>

        {!stationId && (
          <Form.Item name="station_id" label="绑定站点（可选）">
            <StationSelect />
          </Form.Item>
        )}
        <Form.Item name="station_name" hidden>
          <Input />
        </Form.Item>

        <div className="grid grid-cols-2 gap-4">
          <Form.Item
            name="module_key"
            label="模块类型"
            rules={[{ required: true, type: 'array', min: 1, message: '至少选择一个模块' }]}
            extra={
              <span className="text-xs text-gray-400">
                设备会把 m1/m2/m3/m4/ap/ill/th 等模块数据分多条消息发到同一 topic，此处勾选本连接要采集的模块
              </span>
            }
          >
            <Select
              mode="multiple"
              placeholder="选择模块（可多选，对应 payload 中的 m1/m2/ap 等 key）"
              allowClear
              maxTagCount="responsive"
              options={MQTT_MODULES.map((m) => ({
                value: m.key,
                label: `${m.key.toUpperCase()} - ${m.label}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="qos" label="QoS">
            <InputNumber min={0} max={2} className="w-full" />
          </Form.Item>
        </div>

        <Form.Item
          name="topic"
          label="订阅主题 (Topic)"
          rules={[{ required: true, message: '请输入 Topic' }]}
          extra={
            <span className="text-xs text-gray-400">
              所有模块共享同一 topic（默认 {DEFAULT_MQTT_TOPIC}），后端按 payload 里的 m1/m2/ap/... 键自动分发解析，无需通过 topic 后缀区分模块
            </span>
          }
        >
          <Input placeholder={DEFAULT_MQTT_TOPIC} />
        </Form.Item>

        <ModulePreview />

        <div className="grid grid-cols-3 gap-4">
          <Form.Item
            name="broker_host"
            label="Broker 地址"
            rules={[{ required: true, message: '请输入 Broker 地址' }]}
            className="col-span-2"
          >
            <Input placeholder="如: 120.77.155.186" />
          </Form.Item>
          <Form.Item name="broker_port" label="端口" rules={[{ required: true }]}>
            <InputNumber min={1} max={65535} className="w-full" />
          </Form.Item>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Form.Item name="username" label="用户名">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item name="password" label="密码">
            <Input.Password placeholder="可选" />
          </Form.Item>
        </div>
        <Form.Item name="client_id" label="Client ID">
          <Input placeholder="留空自动生成" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** 内部：站点选择器（懒加载） */
function StationSelect(props: any) {
  const [options, setOptions] = useState<Array<{ value: string; label: string; station_name?: string }>>([]);
  useEffect(() => {
    stationApi
      .getStations({ limit: 1000 })
      .then((res: any) => {
        const items = res?.items ?? res?.data?.items ?? [];
        setOptions(
          items.map((s: any) => ({
            value: s.id,
            label: `${s.station_name} (${s.station_code})`,
            station_name: s.station_name,
          })),
        );
      })
      .catch(() => setOptions([]));
  }, []);
  return (
    <Select
      {...props}
      allowClear
      showSearch
      placeholder="选择要绑定的站点"
      optionFilterProp="label"
      options={options}
    />
  );
}

/** 内部：根据 module_key 显示所选模块会解析出哪些指标（支持多选） */
function ModulePreview() {
  return (
    <Form.Item shouldUpdate noStyle>
      {({ getFieldValue }) => {
        const raw = getFieldValue('module_key');
        const keys: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
        const mods = keys
          .map((k) => MQTT_MODULES.find((m) => m.key === k))
          .filter(Boolean) as typeof MQTT_MODULES;
        if (!mods.length) return null;
        return (
          <div className="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-100 space-y-2">
            <div className="text-xs text-gray-500">所选模块将解析并写入以下指标：</div>
            {mods.map((mod) => (
              <div key={mod.key} className="flex items-start gap-2">
                <Tag color={mod.color} className="shrink-0">
                  {mod.key.toUpperCase()} · {mod.label}
                </Tag>
                <Space size={[4, 4]} wrap>
                  {mod.metrics.map((m) => (
                    <Tag key={m} color={mod.color}>
                      {m}
                    </Tag>
                  ))}
                </Space>
              </div>
            ))}
          </div>
        );
      }}
    </Form.Item>
  );
}



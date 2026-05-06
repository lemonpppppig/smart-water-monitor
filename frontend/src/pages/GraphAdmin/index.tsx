/**
 * 图谱数据管理 - 画布编辑器模式（P0 骨架）
 *
 * 旧版表单/Table CRUD 已整页升级为可视化画布编辑器。
 * 所有拓扑节点（河流/站点/污染源/交汇点/行政区）与关系（FLOWS_INTO/LOCATED_ON/
 * UPSTREAM_OF/DISCHARGES_TO）统一在画布上创建、连线、编辑、删除。
 *
 * 应急预案 (EmergencyPlan) 不是拓扑节点，后端 API 保留但前端管理界面延后到 P1。
 */
import GraphEditor from './GraphEditor';

export default function GraphAdmin() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">图谱数据管理</h2>
          <p className="text-sm text-gray-500 mt-1">
            拖拽左侧节点类型到画布创建节点；按住节点端点拖到另一节点建立关系；选中后右侧编辑；点「一键保存」批量提交。
          </p>
        </div>
      </div>
      <GraphEditor />
    </div>
  );
}

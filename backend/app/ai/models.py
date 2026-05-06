"""
AI 域 SQLAlchemy ORM 模型
"""
from datetime import datetime
from sqlalchemy import Column, String, DateTime, JSON, Integer, Text, Float, UniqueConstraint, Index
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class AgentTaskORM(Base):
    """智能体任务持久化表"""
    __tablename__ = "ai_agent_tasks"

    task_id = Column(String(128), primary_key=True, comment="任务ID")
    task_type = Column(String(64), nullable=False, index=True, comment="任务类型")
    status = Column(
        String(32),
        nullable=False,
        default="pending",
        index=True,
        comment="状态: pending/running/completed/failed",
    )
    priority = Column(Integer, default=1, comment="优先级 1-10")
    mode = Column(String(16), default="async", comment="模式: async/sync")
    payload = Column(JSON, comment="任务载荷")
    result = Column(JSON, comment="任务结果")
    error = Column(Text, comment="错误信息")
    assigned_to = Column(String(64), comment="分配给哪个 Agent")
    station_id = Column(String(64), index=True, comment="目标站点ID(便于检索)")
    created_at = Column(
        DateTime(timezone=True), default=datetime.utcnow, index=True, comment="创建时间"
    )
    started_at = Column(DateTime(timezone=True), comment="开始时间")
    completed_at = Column(DateTime(timezone=True), comment="完成时间")

    def to_dict(self):
        return {
            "task_id": self.task_id,
            "task_type": self.task_type,
            "status": self.status,
            "priority": self.priority,
            "mode": self.mode,
            "payload": self.payload,
            "result": self.result,
            "error": self.error,
            "assigned_to": self.assigned_to,
            "station_id": self.station_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }


class AgentStationModel(Base):
    """站点级模型绑定表

    训练粒度：一站一模型，模型同时覆盖该站点选定的 N 个指标
    （多变量 LSTM 自编码器，input_size = len(metrics)）。
    """

    __tablename__ = "ai_station_models"

    station_id = Column(String(128), primary_key=True, comment="业务 station_code")
    station_name = Column(String(128), comment="站点名称（快照）")
    model_type = Column(String(32), default="lstm_autoencoder", comment="模型类型")
    metrics = Column(JSON, comment="训练覆盖的指标编码列表")
    epochs = Column(Integer, default=50, comment="训练轮数")
    final_loss = Column(Float, comment="最终损失")
    samples = Column(Integer, comment="训练样本数")
    data_source = Column(String(32), default="tdengine", comment="训练数据来源: tdengine/synthetic")
    model_file = Column(String(256), comment="模型文件相对路径")
    params_file = Column(String(256), comment="归一化参数文件相对路径")
    version = Column(Integer, default=1, comment="模型版本，每次重训递增")
    status = Column(
        String(16),
        default="pending",
        index=True,
        comment="状态: pending/training/active/failed",
    )
    error = Column(Text, comment="错误信息")
    trained_at = Column(DateTime(timezone=True), comment="上次训练完成时间")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, comment="创建时间")
    updated_at = Column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        comment="更新时间",
    )

    def to_dict(self):
        return {
            "station_id": self.station_id,
            "station_name": self.station_name,
            "model_type": self.model_type,
            "metrics": self.metrics or [],
            "epochs": self.epochs,
            "final_loss": self.final_loss,
            "samples": self.samples,
            "data_source": self.data_source,
            "model_file": self.model_file,
            "params_file": self.params_file,
            "version": self.version,
            "status": self.status,
            "error": self.error,
            "trained_at": self.trained_at.isoformat() if self.trained_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class GraphCanvasLayoutORM(Base):
    """图谱画布节点坐标持久化表

    用户在 GraphEditor 拖拽节点后保存的布局坐标。
    节点由 (node_type, node_id) 全局唯一定位：
      - node_type: river / station / confluence / pollution
      - node_id: 业务 ID（river_id / station_code / confluence_id / source_id）
    """

    __tablename__ = "graph_canvas_layout"
    __table_args__ = (
        UniqueConstraint("node_type", "node_id", name="uq_graph_canvas_layout_type_id"),
        Index("idx_gcl_type", "node_type"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    node_type = Column(String(32), nullable=False, comment="节点类型")
    node_id = Column(String(128), nullable=False, comment="业务ID")
    x = Column(Float, nullable=False, comment="画布 x 坐标")
    y = Column(Float, nullable=False, comment="画布 y 坐标")
    updated_at = Column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        comment="更新时间",
    )

    def to_dict(self):
        return {
            "node_type": self.node_type,
            "node_id": self.node_id,
            "x": self.x,
            "y": self.y,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

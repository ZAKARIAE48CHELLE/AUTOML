import datetime
from sqlalchemy import Column, String, Integer, DateTime, Text, JSON, ForeignKey
from .database import Base


def _utcnow() -> datetime.datetime:
    """Naive UTC timestamp (replaces the deprecated datetime.utcnow)."""
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)

class WorkflowModel(Base):
    __tablename__ = "workflows"

    id = Column(String(64), primary_key=True, index=True)
    project_id = Column(String(64), index=True, nullable=False)
    name = Column(String(255), nullable=False)
    version = Column(Integer, default=1)
    status = Column(String(32), default="draft")  # draft, ready, active, archived
    graph_json = Column(JSON, nullable=False)
    canonical_hash = Column(String(64), nullable=False)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

class WorkflowExecutionModel(Base):
    __tablename__ = "workflow_executions"

    id = Column(String(64), primary_key=True, index=True)
    workflow_id = Column(String(64), ForeignKey("workflows.id"), index=True, nullable=False)
    status = Column(String(32), default="pending")  # pending, running, succeeded, failed, cancelled
    trigger_type = Column(String(32), default="manual")
    current_node = Column(String(64), nullable=True)
    logs_json = Column(JSON, nullable=True)
    started_at = Column(DateTime, default=_utcnow)
    finished_at = Column(DateTime, nullable=True)


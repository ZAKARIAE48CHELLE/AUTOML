import datetime
from sqlalchemy import Column, String, Integer, DateTime, Text, JSON, Float
from .database import Base


def _utcnow() -> datetime.datetime:
    """Naive UTC timestamp (replaces the deprecated datetime.utcnow)."""
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)

class ModelCatalogModel(Base):
    __tablename__ = "model_catalog"

    id = Column(String(64), primary_key=True, index=True)
    family = Column(String(64), index=True, nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    default_params = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=_utcnow)

class TrainingJobModel(Base):
    __tablename__ = "training_jobs"

    id = Column(String(64), primary_key=True, index=True)
    project_id = Column(String(64), index=True, nullable=False)
    dataset_version_id = Column(String(64), nullable=False)
    model_name = Column(String(255), nullable=False)
    status = Column(String(64), default="pending")
    metrics = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    completed_at = Column(DateTime, nullable=True)


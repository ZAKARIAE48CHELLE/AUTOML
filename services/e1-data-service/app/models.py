import datetime
from sqlalchemy import Column, String, Integer, DateTime, Text, JSON, ForeignKey
from .database import Base


def utcnow() -> datetime.datetime:
    """Naive UTC timestamp (columns are TIMESTAMP WITHOUT TIME ZONE; serialize with iso_utc)."""
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


class UserModel(Base):
    __tablename__ = "users"

    id = Column(String(64), primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    name = Column(String(255), nullable=False)
    role = Column(String(64), default="user")
    created_at = Column(DateTime, default=utcnow)


class ProjectModel(Base):
    __tablename__ = "projects"

    id = Column(String(64), primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    role = Column(String(64), default="owner")
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)


class DatasetModel(Base):
    __tablename__ = "datasets"

    id = Column(String(64), primary_key=True, index=True)
    project_id = Column(String(64), ForeignKey("projects.id"), index=True, nullable=False)
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=utcnow)


class DatasetVersionModel(Base):
    __tablename__ = "dataset_versions"

    id = Column(String(64), primary_key=True, index=True)
    dataset_id = Column(String(64), ForeignKey("datasets.id"), index=True, nullable=False)
    project_id = Column(String(64), nullable=False)
    name = Column(String(255), nullable=False)
    version = Column(Integer, default=1)
    checksum = Column(String(128), nullable=False)
    schema_json = Column(JSON, nullable=True)
    # First PREVIEW_MAX_ROWS rows, typed (int/float/str/None). Used for preview, profiling and splits
    # until the raw file is kept in object storage.
    preview_rows = Column(JSON, nullable=True)
    num_rows = Column(Integer, default=0)
    num_columns = Column(Integer, default=0)
    status = Column(String(32), default="ready")
    uri = Column(String(512), nullable=True)
    created_at = Column(DateTime, default=utcnow)


class PreprocessSpecModel(Base):
    __tablename__ = "preprocess_specs"

    id = Column(String(64), primary_key=True, index=True)
    dataset_version_id = Column(String(64), ForeignKey("dataset_versions.id"), index=True, nullable=False)
    version = Column(Integer, nullable=False, default=1)
    steps = Column(JSON, nullable=False)
    content_hash = Column(String(128), nullable=False, index=True)
    created_at = Column(DateTime, default=utcnow)


class SplitModel(Base):
    __tablename__ = "splits"

    id = Column(String(64), primary_key=True, index=True)
    dataset_version_id = Column(String(64), ForeignKey("dataset_versions.id"), index=True, nullable=False)
    split_spec = Column(JSON, nullable=False)
    checksum = Column(String(128), nullable=False)
    counts = Column(JSON, nullable=False)
    target_distribution = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=utcnow)

import datetime
from sqlalchemy import Column, String, Integer, DateTime, Text, JSON, ForeignKey
from .database import Base

class UserModel(Base):
    __tablename__ = "users"

    id = Column(String(64), primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    name = Column(String(255), nullable=False)
    role = Column(String(64), default="user")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class ProjectModel(Base):
    __tablename__ = "projects"

    id = Column(String(64), primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    role = Column(String(64), default="owner")
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class DatasetModel(Base):
    __tablename__ = "datasets"

    id = Column(String(64), primary_key=True, index=True)
    project_id = Column(String(64), ForeignKey("projects.id"), index=True, nullable=False)
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class DatasetVersionModel(Base):
    __tablename__ = "dataset_versions"

    id = Column(String(64), primary_key=True, index=True)
    dataset_id = Column(String(64), ForeignKey("datasets.id"), index=True, nullable=False)
    project_id = Column(String(64), nullable=False)
    name = Column(String(255), nullable=False)
    version = Column(Integer, default=1)
    checksum = Column(String(128), nullable=False)
    schema_json = Column(JSON, nullable=True)
    num_rows = Column(Integer, default=0)
    num_columns = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


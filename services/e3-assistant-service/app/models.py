import datetime
from sqlalchemy import Column, String, Integer, DateTime, Text, JSON, ForeignKey
from .database import Base


def _utcnow() -> datetime.datetime:
    """Naive UTC timestamp (replaces the deprecated datetime.utcnow)."""
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)

class ConversationModel(Base):
    __tablename__ = "conversations"

    id = Column(String(64), primary_key=True, index=True)
    project_id = Column(String(64), index=True, nullable=False)
    title = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=_utcnow)

class MessageModel(Base):
    __tablename__ = "messages"

    id = Column(String(64), primary_key=True, index=True)
    conversation_id = Column(String(64), ForeignKey("conversations.id"), index=True, nullable=False)
    role = Column(String(32), nullable=False)  # user, assistant, system
    origin = Column(String(32), default="human")  # human, ai
    content = Column(Text, nullable=False)
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=_utcnow)

class ProposalModel(Base):
    __tablename__ = "proposals"

    id = Column(String(64), primary_key=True, index=True)
    conversation_id = Column(String(64), ForeignKey("conversations.id"), index=True, nullable=False)
    project_id = Column(String(64), index=True, nullable=False)
    title = Column(String(255), nullable=False)
    origin = Column(String(32), default="ai")
    rationale = Column(Text, nullable=True)
    payload_json = Column(JSON, nullable=True)
    status = Column(String(32), default="pending")  # pending, accepted, rejected
    created_at = Column(DateTime, default=_utcnow)


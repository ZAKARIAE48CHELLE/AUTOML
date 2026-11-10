import os
import logging
from typing import Generator, Dict, Any
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker, Session

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./e3_dev.db")
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def check_db_health() -> Dict[str, Any]:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {
            "status": "connected",
            "dialect": engine.dialect.name
        }
    except Exception as e:
        logger.warning(f"Database health check failed: {e}")
        return {
            "status": "disconnected",
            "error": str(e)
        }

def seed_initial_data(session: Session):
    from .models import ConversationModel, MessageModel, ProposalModel
    try:
        if session.query(ConversationModel).count() == 0:
            logger.info("Seeding initial data into E3 database...")
            conv = ConversationModel(
                id="conv_churn_01",
                project_id="p_churn",
                title="Telco Churn Copilot Assistant"
            )
            session.add(conv)
            session.flush()

            m1 = MessageModel(
                id="msg_01",
                conversation_id="conv_churn_01",
                role="assistant",
                origin="ai",
                content="Bonjour ! Je suis votre copilote IA pour le projet Churn Prediction Pro. Je peux vous assister dans la préparation des données et l'entraînement de vos modèles."
            )
            m2 = MessageModel(
                id="msg_02",
                conversation_id="conv_churn_01",
                role="user",
                origin="human",
                content="Peux-tu me recommander un pipeline optimal pour prédire le désabonnement client ?"
            )
            m3 = MessageModel(
                id="msg_03",
                conversation_id="conv_churn_01",
                role="assistant",
                origin="ai",
                content="Certainement ! J'ai inspecté le dataset telco_churn.csv. Je recommande une imputation médiane, un One-Hot Encoding pour les variables contractuelles, et un classifieur XGBoost avec 150 estimateurs."
            )
            prop = ProposalModel(
                id="prop_01",
                conversation_id="conv_churn_01",
                project_id="p_churn",
                title="Pipeline de Classification Churn XGBoost",
                origin="ai",
                rationale="Optimisé pour maximiser le ROC-AUC sur données déséquilibrées (Ratio 73:27).",
                payload_json={"model": "xgboost", "metric": "roc_auc", "target": "churn"},
                status="pending"
            )
            session.add(m1)
            session.add(m2)
            session.add(m3)
            session.add(prop)
            session.commit()
            logger.info("E3 initial data seeded.")
    except Exception as e:
        session.rollback()
        logger.warning(f"Seeding failed in E3: {e}")

def init_db():
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables initialized successfully.")
        with SessionLocal() as session:
            seed_initial_data(session)
    except Exception as e:
        logger.warning(f"Database initialization warning: {e}")

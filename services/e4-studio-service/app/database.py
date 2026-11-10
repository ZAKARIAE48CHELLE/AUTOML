import os
import logging
from typing import Generator, Dict, Any
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker, Session

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./e4_dev.db")
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
    from .models import WorkflowModel, WorkflowExecutionModel
    try:
        if session.query(WorkflowModel).count() == 0:
            logger.info("Seeding initial data into E4 database...")
            nodes = [
                {"id": "node_import", "type": "dataset_import", "data": {"dataset_id": "ds_churn"}},
                {"id": "node_split", "type": "data_split", "data": {"ratios": [0.7, 0.15, 0.15]}},
                {"id": "node_train", "type": "model_train", "data": {"model_name": "XGBoost Classifier"}},
                {"id": "node_evaluate", "type": "model_evaluate", "data": {"threshold": 0.85}}
            ]
            edges = [
                {"id": "e1", "source": "node_import", "target": "node_split"},
                {"id": "e2", "source": "node_split", "target": "node_train"},
                {"id": "e3", "source": "node_train", "target": "node_evaluate"}
            ]
            wf = WorkflowModel(
                id="wf_churn_01",
                project_id="p_churn",
                name="Pipeline Entraînement Churn XGBoost",
                version=1,
                status="ready",
                graph_json={"nodes": nodes, "edges": edges},
                canonical_hash="sha256:7b91c84d6e1f029a837c"
            )
            session.add(wf)
            session.flush()

            exec_run = WorkflowExecutionModel(
                id="exec_churn_01",
                workflow_id="wf_churn_01",
                status="succeeded",
                trigger_type="manual",
                current_node="node_evaluate",
                logs_json=[
                    {"timestamp": "2026-11-10T12:00:00Z", "node": "node_import", "message": "Dataset chargé avec 7,043 lignes."},
                    {"timestamp": "2026-11-10T12:00:02Z", "node": "node_split", "message": "Split stratifié 70/15/15 validé."},
                    {"timestamp": "2026-11-10T12:00:15Z", "node": "node_train", "message": "Entraînement complété. ROC-AUC=0.934."},
                    {"timestamp": "2026-11-10T12:00:16Z", "node": "node_evaluate", "message": "Évaluation franchie avec succès."}
                ]
            )
            session.add(exec_run)
            session.commit()
            logger.info("E4 initial data seeded.")
    except Exception as e:
        session.rollback()
        logger.warning(f"Seeding failed in E4: {e}")

def init_db():
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables initialized successfully.")
        with SessionLocal() as session:
            seed_initial_data(session)
    except Exception as e:
        logger.warning(f"Database initialization warning: {e}")

import os
import logging
from typing import Generator, Dict, Any
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker, Session

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./e2_dev.db")
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
    from .models import ModelCatalogModel, TrainingJobModel
    try:
        if session.query(ModelCatalogModel).count() == 0:
            logger.info("Seeding initial data into E2 database...")
            rf = ModelCatalogModel(
                id="model_rf",
                family="ensemble",
                name="Random Forest Classifier",
                description="Bagging ensemble of decision trees for tabular classification",
                default_params={"n_estimators": 100, "max_depth": 10}
            )
            xgb = ModelCatalogModel(
                id="model_xgb",
                family="gradient_boosting",
                name="XGBoost Classifier",
                description="Extreme gradient boosting for tabular data with high precision",
                default_params={"n_estimators": 150, "learning_rate": 0.05, "max_depth": 6}
            )
            lgb = ModelCatalogModel(
                id="model_lgb",
                family="gradient_boosting",
                name="LightGBM Classifier",
                description="Fast, distributed, high performance gradient boosting framework",
                default_params={"n_estimators": 120, "learning_rate": 0.03, "num_leaves": 31}
            )
            job = TrainingJobModel(
                id="job_train_rf_01",
                project_id="p_churn",
                dataset_version_id="dsv_churn_v1",
                model_name="XGBoost Classifier",
                status="succeeded",
                metrics={"accuracy": 0.892, "roc_auc": 0.934, "f1": 0.865, "loss": 0.241}
            )
            session.add(rf)
            session.add(xgb)
            session.add(lgb)
            session.add(job)
            session.commit()
            logger.info("E2 initial data seeded.")
    except Exception as e:
        session.rollback()
        logger.warning(f"Seeding failed in E2: {e}")

def init_db():
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables initialized successfully.")
        with SessionLocal() as session:
            seed_initial_data(session)
    except Exception as e:
        logger.warning(f"Database initialization warning: {e}")

import os
import logging
from typing import Generator, Dict, Any
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
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
            from .contracts import contracts
            catalog_rows = [ModelCatalogModel(id=m["id"], family=m["family"], name=m["label"],
                                              description=f"{m['family']} — {', '.join(m['task'])}",
                                              default_params={k: p["default"] for k, p in m["params_schema"].get("properties", {}).items() if "default" in p})
                            for m in contracts.MODELS]
            job = TrainingJobModel(
                id="job_train_rf_01",
                project_id="p_churn",
                dataset_version_id="dsv_churn_v1",
                model_name="XGBoost Classifier",
                status="succeeded",
                metrics={"accuracy": 0.892, "roc_auc": 0.934, "f1": 0.865, "loss": 0.241}
            )
            session.add_all(catalog_rows)
            session.add(job)
            session.commit()
            logger.info("E2 initial data seeded.")
    except Exception as e:
        session.rollback()
        logger.warning(f"Seeding failed in E2: {e}")

def ensure_database_exists() -> None:
    """Create the service database on PostgreSQL if it is missing.

    docker/postgres/init-db.sql only runs on a fresh volume, so a volume created
    before that script existed would otherwise leave the service without a database.
    """
    url = make_url(DATABASE_URL)
    if not url.drivername.startswith("postgresql") or not url.database:
        return
    admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT", pool_pre_ping=True)
    try:
        with admin.connect() as conn:
            exists = conn.execute(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": url.database}).scalar()
            if not exists:
                logger.info(f"Creating missing database {url.database}")
                conn.execute(text(f'CREATE DATABASE "{url.database}"'))
    finally:
        admin.dispose()


def init_db():
    """Prepare the database. Raises on failure so the container restarts instead of serving 500s."""
    try:
        ensure_database_exists()
        from . import models  # noqa: F401  (register tables on Base.metadata)
        Base.metadata.create_all(bind=engine)
        with SessionLocal() as session:
            seed_initial_data(session)
        logger.info("Database ready.")
    except Exception:
        logger.exception("Database initialization failed")
        raise

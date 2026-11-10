import os
import logging
from typing import Generator, Dict, Any
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker, Session

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./e1_dev.db")
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
    from .models import UserModel, ProjectModel, DatasetModel, DatasetVersionModel
    try:
        if session.query(ProjectModel).count() == 0:
            logger.info("Seeding initial data into E1 database...")
            user = UserModel(
                id="u_dev1",
                email="zakariae@emsi.ma",
                name="Chelle Zakariae",
                role="owner"
            )
            project = ProjectModel(
                id="p_churn",
                name="Churn Prediction Pro",
                role="owner",
                description="Telco customer churn prediction and retention modeling"
            )
            dataset = DatasetModel(
                id="ds_churn",
                project_id="p_churn",
                name="telco_churn.csv"
            )
            schema_sample = [
                {"name": "customer_id", "dtype": "string", "nullable": False},
                {"name": "tenure_months", "dtype": "int", "nullable": False},
                {"name": "monthly_charges", "dtype": "float", "nullable": False},
                {"name": "churn", "dtype": "string", "nullable": False}
            ]
            version = DatasetVersionModel(
                id="dsv_churn_v1",
                dataset_id="ds_churn",
                project_id="p_churn",
                name="telco_churn.csv",
                version=1,
                checksum="sha256:d8f72a4b8c9e",
                schema_json=schema_sample,
                num_rows=7043,
                num_columns=21,
                status="ready",
                uri="s3://data/telco_churn.csv"
            )
            session.add(user)
            session.flush()
            session.add(project)
            session.flush()
            session.add(dataset)
            session.flush()
            session.add(version)
            session.commit()
            logger.info("E1 initial data seeded.")
    except Exception as e:
        session.rollback()
        logger.warning(f"Seeding failed: {e}")

def init_db():
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables initialized successfully.")
        with SessionLocal() as session:
            seed_initial_data(session)
    except Exception as e:
        logger.warning(f"Database initialization warning: {e}")

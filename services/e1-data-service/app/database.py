import os
import logging
import random
from typing import Generator, Dict, Any
from sqlalchemy import create_engine, text, inspect
from sqlalchemy.engine import make_url
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
        return {"status": "connected", "dialect": engine.dialect.name}
    except Exception as e:
        logger.warning(f"Database health check failed: {e}")
        return {"status": "disconnected", "error": str(e)}


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


# Additive columns introduced after the first release. create_all() never alters
# existing tables, so add them explicitly until Alembic migrations are in place.
_ADDED_COLUMNS = {
    "dataset_versions": {"preview_rows": "JSON"},
}


def ensure_columns() -> None:
    insp = inspect(engine)
    with engine.begin() as conn:
        for table, cols in _ADDED_COLUMNS.items():
            if not insp.has_table(table):
                continue
            existing = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in cols.items():
                if name not in existing:
                    logger.info(f"Adding column {table}.{name}")
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


SEED_SCHEMA = [
    {"name": "customer_id", "dtype": "string", "nullable": False},
    {"name": "tenure_months", "dtype": "int", "nullable": False},
    {"name": "monthly_charges", "dtype": "float", "nullable": True},
    {"name": "contract_type", "dtype": "category", "nullable": False},
    {"name": "churn", "dtype": "category", "nullable": False},
]


def seed_rows(n: int = 200):
    """Deterministic synthetic telco-churn sample used by the demo project."""
    rng = random.Random(42)
    contracts = ["Month-to-month", "One year", "Two year"]
    rows = []
    for i in range(1, n + 1):
        contract = rng.choices(contracts, weights=[55, 25, 20])[0]
        tenure = rng.randint(1, 72)
        charges = round(rng.uniform(18.0, 118.0), 2)
        p_churn = 0.45 if contract == "Month-to-month" else 0.1
        if tenure < 12:
            p_churn += 0.2
        rows.append({
            "customer_id": f"CUST-{i:04d}",
            "tenure_months": tenure,
            "monthly_charges": None if rng.random() < 0.04 else charges,
            "contract_type": contract,
            "churn": "Yes" if rng.random() < p_churn else "No",
        })
    return rows


def seed_initial_data(session: Session):
    from .models import UserModel, ProjectModel, DatasetModel, DatasetVersionModel
    if session.query(ProjectModel).count() == 0:
        logger.info("Seeding initial data into E1 database...")
        rows = seed_rows()
        if session.get(UserModel, "u_dev1") is None:
            session.add(UserModel(id="u_dev1", email="zakariae@emsi.ma", name="Chelle Zakariae", role="owner"))
        session.add(ProjectModel(id="p_churn", name="Churn Prediction Pro", role="owner",
                                 description="Telco customer churn prediction and retention modeling"))
        session.flush()
        session.add(DatasetModel(id="ds_churn", project_id="p_churn", name="telco_churn.csv"))
        session.flush()
        session.add(DatasetVersionModel(
            id="dsv_churn_v1", dataset_id="ds_churn", project_id="p_churn", name="telco_churn.csv",
            version=1, checksum="sha256:d8f72a4b8c9e", schema_json=SEED_SCHEMA, preview_rows=rows,
            num_rows=len(rows), num_columns=len(SEED_SCHEMA), status="ready",
            uri="s3://datasets/p_churn/telco_churn.csv",
        ))
        session.commit()
        logger.info("E1 initial data seeded.")
        return

    # Repair the demo version seeded by the first release (4-column schema, no rows).
    v = session.get(DatasetVersionModel, "dsv_churn_v1")
    if v is not None and not v.preview_rows:
        rows = seed_rows()
        v.schema_json = SEED_SCHEMA
        v.preview_rows = rows
        v.num_rows = len(rows)
        v.num_columns = len(SEED_SCHEMA)
        session.commit()
        logger.info("Repaired demo dataset version dsv_churn_v1.")


def init_db():
    """Prepare the database. Raises on failure so the container restarts instead of serving 500s."""
    try:
        ensure_database_exists()
        from . import models  # noqa: F401  (register tables on Base.metadata)
        Base.metadata.create_all(bind=engine)
        ensure_columns()
        with SessionLocal() as session:
            seed_initial_data(session)
        logger.info("E1 database ready.")
    except Exception:
        logger.exception("E1 database initialization failed")
        raise

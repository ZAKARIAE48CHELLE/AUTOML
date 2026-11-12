import datetime
import logging
import uuid
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from .database import check_db_health, init_db
from .models import ModelCatalogModel, TrainingJobModel
from .schemas import (
    ModelSpec, TrainingResources, TrainingValidateRequest, ValidationReport,
    ValidationLayer, ValidationIssue, TrainingJob, Study, StudyTrial,
    ExperimentRun, CompareRequest, Leaderboard, LeaderboardEntry,
    ModelVersion, ModelDetail, PredictRequest, PredictResult
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(
    title="AI Studio - E2 Model Training Service",
    description="Microservice responsible for model catalog, training, Optuna tuning, experiment tracking, and inference",
    version="1.0.0",
    lifespan=lifespan
)

logger = logging.getLogger(__name__)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Uniform ApiError responses: {code, message, details, request_id}
_DEFAULT_CODES = {400: "BAD_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND",
                  405: "METHOD_NOT_ALLOWED", 409: "CONFLICT", 422: "VALIDATION_ERROR"}


def _rid() -> str:
    return f"req_{uuid.uuid4().hex[:8]}"


def api_error(status_code: int, code: str, message: str, details: Any = None) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message, "details": details})


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    if isinstance(exc.detail, dict) and "code" in exc.detail:
        body = {"code": exc.detail["code"], "message": exc.detail.get("message", ""), "details": exc.detail.get("details")}
    else:
        body = {"code": _DEFAULT_CODES.get(exc.status_code, "ERROR"), "message": str(exc.detail), "details": None}
    return JSONResponse(status_code=exc.status_code, content={**body, "request_id": _rid()}, headers=getattr(exc, "headers", None))


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = [{"loc": list(e.get("loc", [])), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"code": "VALIDATION_ERROR", "message": "Requête invalide.",
                                                  "details": {"errors": errors}, "request_id": _rid()})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"code": "INTERNAL", "message": "Erreur interne du service.",
                                                  "details": None, "request_id": _rid()})

MINIMIZE_METRICS = {"log_loss", "loss", "rmse", "mse", "mae"}

MODELS_CATALOG = [
    {
        "id": "model_rf",
        "version": "1.0",
        "family": "ensemble",
        "label": "Random Forest",
        "task": ["classification", "regression"],
        "modality": "tabular",
        "params_schema": {
            "type": "object",
            "properties": {
                "n_estimators": {"type": "integer", "default": 100, "minimum": 10, "maximum": 1000},
                "max_depth": {"type": "integer", "default": 10, "minimum": 1, "maximum": 50}
            }
        },
        "dependencies": ["scikit-learn>=1.5.0"],
        "determinism": "exact",
        "deep_learning": False
    },
    {
        "id": "model_xgb",
        "version": "1.0",
        "family": "gradient_boosting",
        "label": "XGBoost Classifier",
        "task": ["classification", "regression"],
        "modality": "tabular",
        "params_schema": {
            "type": "object",
            "properties": {
                "n_estimators": {"type": "integer", "default": 150, "minimum": 10, "maximum": 2000},
                "learning_rate": {"type": "number", "default": 0.05, "minimum": 0.001, "maximum": 1.0},
                "max_depth": {"type": "integer", "default": 6, "minimum": 1, "maximum": 20}
            }
        },
        "dependencies": ["xgboost>=2.0.0"],
        "determinism": "tolerance",
        "deep_learning": False
    },
    {
        "id": "model_mlp",
        "version": "1.0",
        "family": "deep_learning",
        "label": "Tabular MLP Neural Net",
        "task": ["classification", "regression"],
        "modality": "tabular",
        "params_schema": {
            "type": "object",
            "properties": {
                "hidden_layers": {"type": "string", "default": "128,64"},
                "learning_rate": {"type": "number", "default": 0.001},
                "epochs": {"type": "integer", "default": 30}
            }
        },
        "dependencies": ["torch>=2.4.0"],
        "determinism": "tolerance",
        "deep_learning": True
    }
]

RUNS_DB = {
    "run_rf_01": {
        "id": "run_rf_01",
        "project_id": "p_churn",
        "name": "Random Forest Baseline",
        "model_id": "model_rf",
        "config_hash": "sha256:cfg_rf_001",
        "protocol_hash": "sha256:proto_churn_v1",
        "split_id": "split_01",
        "preprocess_spec_id": "prep_01",
        "primary_metric": "accuracy",
        "params": {"n_estimators": 100, "max_depth": 10},
        "metrics": {"accuracy": 0.842, "f1": 0.821, "roc_auc": 0.887},
        "metrics_std": {"accuracy": 0.012, "f1": 0.015},
        "test_metrics": {"accuracy": 0.835, "f1": 0.815},
        "test_evaluated": True,
        "artifacts": [{"name": "model.pkl", "kind": "scikit-learn", "checksum": "sha256:art_rf_001"}],
        "curve": [{"epoch": 1, "train": 0.72, "validation": 0.70}, {"epoch": 2, "train": 0.85, "validation": 0.84}],
        "mlflow_run_id": "mlflow_rf_001",
        "execution_id": "exec_01",
        "workflow_version_id": "wfv_01",
        "created_at": "2026-11-05T10:30:00Z",
        "duration_s": 14.2,
        "seed": 42
    },
    "run_xgb_01": {
        "id": "run_xgb_01",
        "project_id": "p_churn",
        "name": "XGBoost Fine-Tuned",
        "model_id": "model_xgb",
        "config_hash": "sha256:cfg_xgb_001",
        "protocol_hash": "sha256:proto_churn_v1",
        "split_id": "split_01",
        "preprocess_spec_id": "prep_01",
        "primary_metric": "accuracy",
        "params": {"n_estimators": 150, "learning_rate": 0.05, "max_depth": 6},
        "metrics": {"accuracy": 0.879, "f1": 0.865, "roc_auc": 0.923},
        "metrics_std": {"accuracy": 0.009, "f1": 0.011},
        "test_metrics": {"accuracy": 0.871, "f1": 0.858},
        "test_evaluated": True,
        "artifacts": [{"name": "xgboost.json", "kind": "xgboost", "checksum": "sha256:art_xgb_001"}],
        "curve": [{"epoch": 1, "train": 0.75, "validation": 0.73}, {"epoch": 5, "train": 0.89, "validation": 0.87}],
        "mlflow_run_id": "mlflow_xgb_001",
        "execution_id": "exec_01",
        "workflow_version_id": "wfv_01",
        "created_at": "2026-11-05T10:45:00Z",
        "duration_s": 28.5,
        "seed": 42
    }
}

MODELS_REGISTRY = {
    "mv_xgb_prod": {
        "id": "mv_xgb_prod",
        "name": "Customer Churn Predictor",
        "version": 1,
        "run_id": "run_xgb_01",
        "alias": "production",
        "artifact_ref": "s3://models/p_churn/xgb_churn_v1.tar.gz",
        "created_at": "2026-11-05T11:00:00Z",
        "input_schema": [
            {"name": "tenure_months", "dtype": "int", "nullable": False},
            {"name": "monthly_charges", "dtype": "float", "nullable": True},
            {"name": "contract_type", "dtype": "category", "nullable": False}
        ],
        "environment": ["python==3.12", "xgboost==2.0.0"],
        "checksum": "sha256:mod_prod_001",
        "test_evaluated": True,
        "workflow_version_id": "wfv_01"
    }
}

JOBS_DB = {
    "job_train_01": {
        "id": "job_train_01",
        "status": "succeeded",
        "progress": 1.0,
        "metrics": {"accuracy": 0.879},
        "run_id": "run_xgb_01",
        "model_id": "model_xgb",
        "project_id": "p_churn",
        "created_at": "2026-11-05T10:44:00Z"
    }
}

STUDIES_DB = {
    "study_01": {
        "id": "study_01",
        "job_id": "job_train_01",
        "status": "succeeded",
        "run_id": "run_xgb_01",
        "trials": [{"n": 1, "value": 0.82}, {"n": 2, "value": 0.85}, {"n": 3, "value": 0.879}],
    }
}

# -------------------------------------------------------------
# Health Checks
# -------------------------------------------------------------
@app.get("/health/live", tags=["Health"])
def health_live():
    return {"status": "ok", "service": "e2-training-service", "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()}

@app.get("/health/ready", tags=["Health"])
def health_ready():
    db_health = check_db_health()
    is_ready = db_health.get("status") == "connected"
    return JSONResponse(
        status_code=200 if is_ready else 503,
        content={"status": "ready" if is_ready else "degraded", "service": "e2-training-service", "database": db_health, "mlflow": "ready"}
    )

# -------------------------------------------------------------
# Models Catalog & Hardware Resources
# -------------------------------------------------------------
@app.get("/models/catalog", response_model=List[ModelSpec], tags=["Catalog"])
def get_catalog(task: Optional[str] = None, modality: Optional[str] = "tabular"):
    res = []
    for m in MODELS_CATALOG:
        if task and task not in m["task"]:
            continue
        if modality and m.get("modality") != modality:
            continue
        res.append(ModelSpec(**m))
    return res

@app.get("/training/resources", response_model=TrainingResources, tags=["Training"])
def get_resources():
    return TrainingResources(
        cpu=8,
        gpu=1,
        max_minutes=120,
        concurrency=4,
        budget_caps={"trials": 100, "max_minutes": 60, "models": 10}
    )

@app.post("/training/validate", response_model=ValidationReport, tags=["Training"])
def validate_training(req: TrainingValidateRequest):
    return ValidationReport(
        subject={"kind": "TrainingConfig", "id": req.model_id},
        content_hash=f"sha256:{uuid.uuid4().hex[:12]}",
        status="ok",
        layers=[
            ValidationLayer(layer="training", status="ok", issues=[])
        ]
    )

# -------------------------------------------------------------
# Jobs & Tuning Studies
# -------------------------------------------------------------
@app.get("/training/jobs", response_model=List[TrainingJob], tags=["Training"])
def list_training_jobs(project_id: Optional[str] = None):
    return [TrainingJob(**j) for j in JOBS_DB.values() if not project_id or j.get("project_id") == project_id]

@app.get("/training/jobs/{id}", response_model=TrainingJob, tags=["Training"])
def get_training_job(id: str):
    j = JOBS_DB.get(id)
    if not j:
        raise api_error(404, "NOT_FOUND", f"Job introuvable : {id}")
    return TrainingJob(**j)

@app.get("/tuning/studies/{id}", response_model=Study, tags=["Tuning"])
def get_study(id: str):
    s = STUDIES_DB.get(id)
    if not s:
        raise api_error(404, "NOT_FOUND", f"Étude introuvable : {id}")
    job = JOBS_DB.get(s["job_id"])
    if job is None:
        raise api_error(409, "JOB_MISSING", f"Le job {s['job_id']} de cette étude est introuvable.")
    trials = [StudyTrial(**t) for t in s["trials"]]
    return Study(
        id=s["id"],
        job_id=s["job_id"],
        status=s["status"],
        run_id=s.get("run_id"),
        trials=trials,
        best_trial=max(trials, key=lambda t: t.value) if trials else None,
        job=TrainingJob(**job),
    )

# -------------------------------------------------------------
# Experiments & Leaderboards
# -------------------------------------------------------------
@app.get("/experiments", response_model=List[ExperimentRun], tags=["Experiments"])
def list_experiments(project_id: Optional[str] = None, model_id: Optional[str] = None, execution_id: Optional[str] = None):
    res = []
    for r in RUNS_DB.values():
        if project_id and r["project_id"] != project_id: continue
        if model_id and r["model_id"] != model_id: continue
        if execution_id and r.get("execution_id") != execution_id: continue
        res.append(ExperimentRun(**r))
    return res

@app.get("/experiments/{id}", response_model=ExperimentRun, tags=["Experiments"])
def get_experiment_run(id: str):
    r = RUNS_DB.get(id)
    if not r:
        raise api_error(404, "NOT_FOUND", f"Run introuvable : {id}")
    return ExperimentRun(**r)

@app.post("/experiments/compare", response_model=Leaderboard, tags=["Experiments"])
def compare_experiments(req: CompareRequest):
    if not req.run_ids:
        raise api_error(400, "VALIDATION", "Au moins un run est requis.")
    missing = [rid for rid in req.run_ids if rid not in RUNS_DB]
    if missing:
        raise api_error(404, "NOT_FOUND", f"Run introuvable : {missing[0]}")
    runs = [RUNS_DB[rid] for rid in req.run_ids]
    if len({r["protocol_hash"] for r in runs}) > 1:
        raise api_error(422, "PROTOCOL_MISMATCH",
                        "Les runs ne partagent pas le même protocole (split, métrique principale, validation).",
                        {"protocols": [{"run_id": r["id"], "protocol_hash": r["protocol_hash"],
                                        "primary_metric": r["primary_metric"]} for r in runs]})
    metric = runs[0]["primary_metric"]
    direction = "minimize" if metric in MINIMIZE_METRICS else "maximize"
    worst = float("inf") if direction == "minimize" else float("-inf")
    sorted_runs = sorted(runs, key=lambda r: r["metrics"].get(metric, worst), reverse=direction == "maximize")
    entries = [LeaderboardEntry(run_id=r["id"], rank=i, metrics=r["metrics"]) for i, r in enumerate(sorted_runs, 1)]
    return Leaderboard(protocol_hash=runs[0]["protocol_hash"], primary_metric=metric, direction=direction, entries=entries)

# -------------------------------------------------------------
# Model Registry & Inference
# -------------------------------------------------------------
@app.get("/models/registry", response_model=List[ModelVersion], tags=["Registry"])
def list_registry(project_id: Optional[str] = None):
    return [ModelVersion(**m) for m in MODELS_REGISTRY.values()
            if not project_id or RUNS_DB.get(m["run_id"], {}).get("project_id") == project_id]

@app.get("/models/registry/{id}", response_model=ModelDetail, tags=["Registry"])
def get_registry_model(id: str):
    m = MODELS_REGISTRY.get(id)
    if not m:
        raise api_error(404, "NOT_FOUND", f"Modèle introuvable dans le registre : {id}")
    run = RUNS_DB.get(m["run_id"])
    if run is None:
        raise api_error(409, "RUN_MISSING", f"Le run {m['run_id']} de ce modèle est introuvable.")
    return ModelDetail(**m, run=ExperimentRun(**run))

@app.post("/inference/predict", response_model=PredictResult, tags=["Inference"])
def predict(req: PredictRequest):
    records = req.records or []
    preds = []
    probs = []
    for r in records:
        tenure = r.get("tenure_months", 12)
        p_churn = 0.85 if tenure < 6 else 0.15
        pred = "Yes" if p_churn > 0.5 else "No"
        preds.append(pred)
        probs.append([round(1.0 - p_churn, 3), round(p_churn, 3)])
    if not records:
        preds = ["No"]
        probs = [[0.85, 0.15]]
    return PredictResult(
        predictions=preds,
        probabilities=probs,
        classes=["No", "Yes"],
        schema_warnings=[]
    )


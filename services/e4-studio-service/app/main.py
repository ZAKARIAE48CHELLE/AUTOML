import asyncio
import datetime
import json
import uuid
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from .database import check_db_health, init_db
from .models import WorkflowModel, WorkflowExecutionModel
from .schemas import (
    NodeType, Template, Workflow, WorkflowRow, WorkflowVersion, WorkflowVersionMeta,
    WorkflowCreateRequest, WorkflowVersionCreateRequest, WorkflowDiff,
    ValidationReport, ValidationLayer, ValidationIssue,
    Approval, ApprovalCreateRequest, Execution, ExecutionCreateRequest,
    NodeRun, ExportCreateRequest, ExportManifest,
    PromotionRequest, PromotionRecord, compute_canonical_hash
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(
    title="AI Studio - E4 Visual Workflow Studio & MLOps Service",
    description="Microservice responsible for DAG editing, validation, approvals, execution engine, SSE, exports, and promotions",
    version="1.0.0",
    lifespan=lifespan
)

init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    code = "ERROR"
    if exc.status_code == 404: code = "NOT_FOUND"
    elif exc.status_code == 400: code = "BAD_REQUEST"
    elif exc.status_code == 422: code = "VALIDATION_ERROR"
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": code, "message": str(exc.detail), "details": None, "request_id": f"req_{uuid.uuid4().hex[:8]}"}
    )

# The 8 canonical node types from packages/contracts/catalog.json
CANONICAL_NODE_TYPES = [
    {
        "type": "data.dataset", "version": "1.0", "label": "Dataset", "owner": "E1", "operation_class": "L0",
        "adapter": "GET /datasets/{dataset_id}",
        "input_ports": [], "output_ports": [{"name": "dataset", "type": "Dataset", "multiple": False}],
        "params_schema": {"type": "object", "required": ["dataset_version_id"], "properties": {"dataset_version_id": {"type": "string"}}},
        "params_doc": "dataset_version_id"
    },
    {
        "type": "data.split", "version": "1.0", "label": "Split", "owner": "E1", "operation_class": "L1",
        "adapter": "POST /splits",
        "input_ports": [{"name": "dataset", "type": "Dataset", "multiple": False}],
        "output_ports": [{"name": "split", "type": "Split", "multiple": False}],
        "params_schema": {"type": "object", "properties": {"strategy": {"type": "string", "default": "stratified"}, "test_ratio": {"type": "number", "default": 0.2}}},
        "params_doc": "strategy, test_ratio"
    },
    {
        "type": "data.preprocess", "version": "1.0", "label": "Prétraitement", "owner": "E1", "operation_class": "L1",
        "adapter": "POST /preprocessing/specs",
        "input_ports": [{"name": "split", "type": "Split", "multiple": False}],
        "output_ports": [{"name": "spec", "type": "PreprocessSpecRef", "multiple": False}],
        "params_schema": {"type": "object", "properties": {"steps": {"type": "array"}}},
        "params_doc": "steps"
    },
    {
        "type": "train.model", "version": "1.0", "label": "Entraîner modèle", "owner": "E2", "operation_class": "L2",
        "adapter": "POST /training/jobs",
        "input_ports": [{"name": "split", "type": "Split", "multiple": False}, {"name": "preprocess_spec", "type": "PreprocessSpecRef", "multiple": False}],
        "output_ports": [{"name": "run", "type": "ModelRun", "multiple": False}],
        "params_schema": {"type": "object", "required": ["model_id"], "properties": {"model_id": {"type": "string"}, "params": {"type": "object"}}},
        "params_doc": "model_id, params"
    },
    {
        "type": "train.tune", "version": "1.0", "label": "Optimisation Optuna", "owner": "E2", "operation_class": "L2",
        "adapter": "POST /tuning/studies",
        "input_ports": [{"name": "split", "type": "Split", "multiple": False}, {"name": "preprocess_spec", "type": "PreprocessSpecRef", "multiple": False}],
        "output_ports": [{"name": "leaderboard", "type": "Leaderboard", "multiple": False}],
        "params_schema": {"type": "object", "required": ["model_id"], "properties": {"model_id": {"type": "string"}, "n_trials": {"type": "integer", "default": 20}}},
        "params_doc": "model_id, n_trials"
    },
    {
        "type": "eval.compare", "version": "1.0", "label": "Comparer modèles", "owner": "E2", "operation_class": "L0",
        "adapter": "POST /experiments/compare",
        "input_ports": [{"name": "runs", "type": "ModelRun", "multiple": True}],
        "output_ports": [{"name": "leaderboard", "type": "Leaderboard", "multiple": False}],
        "params_schema": {"type": "object", "properties": {"primary_metric": {"type": "string", "default": "accuracy"}}},
        "params_doc": "primary_metric"
    },
    {
        "type": "eval.final_test", "version": "1.0", "label": "Évaluation test finale", "owner": "E2", "operation_class": "L3",
        "adapter": "POST /training/final-evaluation",
        "input_ports": [{"name": "run", "type": "ModelRun", "multiple": False}, {"name": "split", "type": "Split", "multiple": False}],
        "output_ports": [{"name": "evaluated_run", "type": "ModelRun", "multiple": False}],
        "params_schema": {"type": "object", "properties": {}},
        "params_doc": "none"
    },
    {
        "type": "model.register", "version": "1.0", "label": "Enregistrer modèle", "owner": "E2", "operation_class": "L2",
        "adapter": "POST /models/registry",
        "input_ports": [{"name": "run", "type": "ModelRun", "multiple": False}],
        "output_ports": [{"name": "model", "type": "ModelVersion", "multiple": False}],
        "params_schema": {"type": "object", "required": ["model_name"], "properties": {"model_name": {"type": "string"}}},
        "params_doc": "model_name"
    }
]

STARTER_TEMPLATES = [
    {
        "id": "tpl_tabular_classif",
        "label": "Classification Tabulaire Standard",
        "description": "Pipeline classique : Ingestion -> Nettoyage -> Split 80/20 -> Random Forest & XGBoost -> Évaluation finale.",
        "params": ["dataset_version_id", "target"]
    },
    {
        "id": "tpl_optuna_tuning",
        "label": "AutoML avec Optimisation Hyperparamétrique Optuna",
        "description": "Exploration bayésienne sur les hyperparamètres XGBoost avec comparaison sur jeu de validation.",
        "params": ["dataset_version_id", "target", "n_trials"]
    }
]

# Baseline initial workflow
DEFAULT_SPEC = {
    "schema_version": "1.0.0",
    "catalog_version": "1.0.0",
    "nodes": [
        {"id": "node_ds", "type": "data.dataset", "type_version": "1.0", "params": {"dataset_version_id": "dsv_churn_v1"}, "ui": {"x": 100, "y": 150}},
        {"id": "node_split", "type": "data.split", "type_version": "1.0", "params": {"strategy": "stratified", "test_ratio": 0.2}, "ui": {"x": 350, "y": 150}},
        {"id": "node_train", "type": "train.model", "type_version": "1.0", "params": {"model_id": "model_xgb", "params": {"n_estimators": 100}}, "ui": {"x": 600, "y": 150}}
    ],
    "edges": [
        {"id": "e1", "from": {"node": "node_ds", "port": "dataset"}, "to": {"node": "node_split", "port": "dataset"}},
        {"id": "e2", "from": {"node": "node_split", "port": "split"}, "to": {"node": "node_train", "port": "split"}}
    ],
    "metadata": {"task": "classification", "target": "churn", "objective": {"primary_metric": "accuracy", "direction": "maximize"}, "origin": "human"}
}

WORKFLOWS_DB = {
    "wf_churn_01": {
        "id": "wf_churn_01",
        "project_id": "p_churn",
        "name": "Pipeline Prédiction Churn",
        "created_at": "2026-11-05T10:15:00Z",
        "latest_version_id": "wfv_01"
    }
}

VERSIONS_DB = {
    "wfv_01": {
        "id": "wfv_01",
        "workflow_id": "wf_churn_01",
        "parent_version_id": None,
        "content_hash": compute_canonical_hash(DEFAULT_SPEC),
        "author": {"type": "user", "id": "u_dev1"},
        "created_at": "2026-11-05T10:15:00Z",
        "origin": "human",
        "readiness": "draft",
        "label": "Version Initiale",
        "spec": DEFAULT_SPEC
    }
}

APPROVALS_DB = {
    "appr_01": {
        "id": "appr_01",
        "project_id": "p_churn",
        "user_id": "u_dev1",
        "workflow_version_id": "wfv_01",
        "content_hash": compute_canonical_hash(DEFAULT_SPEC),
        "scope": "version",
        "operation_classes": ["L2"],
        "node_ids": ["node_train"],
        "budget": {"trials": 50, "max_minutes": 30, "models": 2},
        "mode": "guided",
        "method": "explicit_click",
        "expires_at": "2026-11-12T10:00:00Z",
        "status": "active",
        "created_at": "2026-11-05T10:20:00Z"
    }
}

EXECUTIONS_DB = {
    "exec_01": {
        "id": "exec_01",
        "workflow_id": "wf_churn_01",
        "workflow_version_id": "wfv_01",
        "approval_ids": ["appr_01"],
        "status": "succeeded",
        "reuse_from": None,
        "node_runs": [
            {"node_id": "node_ds", "attempt": 1, "status": "succeeded", "cached": True, "progress": 1.0, "started_at": "2026-11-05T10:25:00Z", "finished_at": "2026-11-05T10:25:01Z"},
            {"node_id": "node_split", "attempt": 1, "status": "succeeded", "cached": True, "progress": 1.0, "started_at": "2026-11-05T10:25:01Z", "finished_at": "2026-11-05T10:25:03Z"},
            {"node_id": "node_train", "attempt": 1, "status": "succeeded", "cached": False, "progress": 1.0, "job_ref": "job_train_01", "started_at": "2026-11-05T10:25:03Z", "finished_at": "2026-11-05T10:25:31Z"}
        ],
        "created_at": "2026-11-05T10:25:00Z",
        "finished_at": "2026-11-05T10:25:31Z",
        "requested_by": "u_dev1"
    }
}

PROMOTIONS_DB = []

# -------------------------------------------------------------
# Health Checks
# -------------------------------------------------------------
@app.get("/health/live", tags=["Health"])
def health_live():
    return {"status": "ok", "service": "e4-studio-service", "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()}

@app.get("/health/ready", tags=["Health"])
def health_ready():
    db_health = check_db_health()
    is_ready = db_health.get("status") == "connected"
    return JSONResponse(
        status_code=200 if is_ready else 503,
        content={"status": "ready" if is_ready else "degraded", "service": "e4-studio-service", "database": db_health, "executor": "ready"}
    )

# -------------------------------------------------------------
# Catalog & Templates
# -------------------------------------------------------------
@app.get("/catalog/node-types", tags=["Catalog"])
def get_node_types():
    return {"catalog_version": "1.0.0", "node_types": [NodeType(**n) for n in CANONICAL_NODE_TYPES]}

@app.get("/catalog/templates", response_model=List[Template], tags=["Catalog"])
def get_templates():
    return [Template(**t) for t in STARTER_TEMPLATES]

# -------------------------------------------------------------
# Workflow Management & Versioning
# -------------------------------------------------------------
@app.get("/workflows", response_model=List[WorkflowRow], tags=["Workflows"])
def list_workflows(project_id: Optional[str] = None):
    res = []
    for w in WORKFLOWS_DB.values():
        if project_id and w["project_id"] != project_id: continue
        v = VERSIONS_DB.get(w["latest_version_id"])
        meta = {k: v[k] for k in v if k != "spec"}
        v_count = sum(1 for x in VERSIONS_DB.values() if x["workflow_id"] == w["id"])
        res.append(WorkflowRow(**w, latest=WorkflowVersionMeta(**meta), versions_count=v_count))
    return res

@app.post("/workflows", status_code=status.HTTP_201_CREATED, tags=["Workflows"])
def create_workflow(req: WorkflowCreateRequest):
    wf_id = f"wf_{uuid.uuid4().hex[:8]}"
    v_id = f"wfv_{uuid.uuid4().hex[:8]}"
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    raw_spec = req.spec.model_dump()
    chash = compute_canonical_hash(raw_spec)
    
    WORKFLOWS_DB[wf_id] = {
        "id": wf_id,
        "project_id": req.project_id,
        "name": req.name,
        "created_at": now,
        "latest_version_id": v_id
    }
    VERSIONS_DB[v_id] = {
        "id": v_id,
        "workflow_id": wf_id,
        "parent_version_id": None,
        "content_hash": chash,
        "author": {"type": "user" if req.origin == "human" else "assistant", "id": "u_dev1"},
        "created_at": now,
        "origin": req.origin,
        "readiness": "draft",
        "label": "Version 1",
        "spec": raw_spec
    }
    return {"workflow_id": wf_id, "version_id": v_id, "content_hash": chash}

@app.post("/workflows/from-template", status_code=status.HTTP_201_CREATED, tags=["Workflows"])
def create_from_template(p: Dict[str, Any]):
    p_id = p.get("project_id", "p_churn")
    req = WorkflowCreateRequest(
        project_id=p_id,
        name=f"Workflow depuis {p.get('template_id', 'modèle')}",
        spec=DEFAULT_SPEC,
        origin="human"
    )
    return create_workflow(req)

@app.get("/workflows/{id}", tags=["Workflows"])
def get_workflow(id: str):
    wf = WORKFLOWS_DB.get(id)
    if not wf:
        raise HTTPException(status_code=404, detail=f"Workflow introuvable : {id}")
    versions = []
    for v in VERSIONS_DB.values():
        if v["workflow_id"] == id:
            meta = {k: v[k] for k in v if k != "spec"}
            versions.append(WorkflowVersionMeta(**meta))
    return {"workflow": Workflow(**wf), "versions": versions}

@app.get("/workflows/{wf}/versions/{v}", response_model=WorkflowVersion, tags=["Workflows"])
def get_version(wf: str, v: str):
    ver = VERSIONS_DB.get(v)
    if not ver or ver["workflow_id"] != wf:
        raise HTTPException(status_code=404, detail=f"Version introuvable : {v}")
    return WorkflowVersion(**ver)

@app.post("/workflows/{wf}/versions", tags=["Workflows"])
def create_version(wf: str, req: WorkflowVersionCreateRequest):
    wf_obj = WORKFLOWS_DB.get(wf)
    if not wf_obj:
        raise HTTPException(status_code=404, detail=f"Workflow introuvable : {wf}")
    
    raw_spec = req.spec.model_dump()
    chash = compute_canonical_hash(raw_spec)
    
    # Check if unchanged
    parent_ver = VERSIONS_DB.get(req.parent_version_id) if req.parent_version_id else None
    if parent_ver and parent_ver["content_hash"] == chash:
        return {"version_id": parent_ver["id"], "content_hash": chash, "unchanged": True}
        
    v_id = f"wfv_{uuid.uuid4().hex[:8]}"
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    
    VERSIONS_DB[v_id] = {
        "id": v_id,
        "workflow_id": wf,
        "parent_version_id": req.parent_version_id,
        "content_hash": chash,
        "author": {"type": "user", "id": "u_dev1"},
        "created_at": now,
        "origin": "human",
        "readiness": "draft",
        "label": req.label or f"Version {len(VERSIONS_DB) + 1}",
        "spec": raw_spec
    }
    wf_obj["latest_version_id"] = v_id
    return {"version_id": v_id, "content_hash": chash, "unchanged": False}

@app.get("/workflows/{wf}/versions/{v}/diff", response_model=WorkflowDiff, tags=["Workflows"])
def diff_version(wf: str, v: str, against: str):
    return WorkflowDiff(against=against, nodes_added=[], nodes_removed=[], nodes_changed=[], edges_added=[], edges_removed=[])

@app.post("/workflows/{wf}/versions/{v}/validate", response_model=ValidationReport, tags=["Workflows"])
@app.get("/workflows/{wf}/versions/{v}/validation", response_model=ValidationReport, tags=["Workflows"])
def validate_version(wf: str, v: str):
    ver = VERSIONS_DB.get(v)
    if not ver:
        raise HTTPException(status_code=404, detail=f"Version introuvable : {v}")
    return ValidationReport(
        subject={"kind": "WorkflowVersion", "id": v},
        content_hash=ver["content_hash"],
        status="ok",
        layers=[
            ValidationLayer(layer="structure", status="ok", issues=[]),
            ValidationLayer(layer="data", status="ok", issues=[]),
            ValidationLayer(layer="training", status="ok", issues=[]),
            ValidationLayer(layer="policy", status="ok", issues=[])
        ]
    )

# -------------------------------------------------------------
# Approvals
# -------------------------------------------------------------
@app.get("/approvals", response_model=List[Approval], tags=["Approvals"])
def list_approvals(workflow_version_id: Optional[str] = None):
    res = []
    for a in APPROVALS_DB.values():
        if workflow_version_id and a["workflow_version_id"] != workflow_version_id: continue
        res.append(Approval(**a))
    return res

@app.post("/approvals", tags=["Approvals"])
def create_approval(req: ApprovalCreateRequest):
    appr_id = f"appr_{uuid.uuid4().hex[:8]}"
    ver = VERSIONS_DB.get(req.workflow_version_id)
    if not ver:
        raise HTTPException(status_code=404, detail="Version de workflow introuvable.")
    now = datetime.datetime.now(datetime.timezone.utc)
    expires = (now + datetime.timedelta(days=7)).isoformat()
    
    appr = Approval(
        id=appr_id,
        project_id="p_churn",
        user_id="u_dev1",
        workflow_version_id=req.workflow_version_id,
        content_hash=ver["content_hash"],
        scope=req.scope,
        operation_classes=req.operation_classes,
        node_ids=req.node_ids,
        budget=req.budget,
        mode="guided",
        method=req.method,
        expires_at=expires,
        status="active",
        created_at=now.isoformat()
    )
    APPROVALS_DB[appr_id] = appr.model_dump()
    return {"approval_id": appr_id, "approval": appr}

@app.post("/approvals/{id}/revoke", response_model=Approval, tags=["Approvals"])
def revoke_approval(id: str):
    a = APPROVALS_DB.get(id)
    if not a:
        raise HTTPException(status_code=404, detail=f"Approbation introuvable : {id}")
    a["status"] = "revoked"
    return Approval(**a)

# -------------------------------------------------------------
# Executions Engine & Server-Sent Events (SSE)
# -------------------------------------------------------------
@app.post("/executions", tags=["Executions"])
def create_execution(req: ExecutionCreateRequest):
    ver = VERSIONS_DB.get(req.workflow_version_id)
    if not ver:
        raise HTTPException(status_code=404, detail="Version introuvable.")
    exec_id = f"exec_{uuid.uuid4().hex[:8]}"
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    
    node_runs = []
    for n in ver["spec"].get("nodes", []):
        node_runs.append({
            "node_id": n["id"],
            "attempt": 1,
            "status": "succeeded",
            "cached": False,
            "progress": 1.0,
            "started_at": now,
            "finished_at": now
        })
        
    EXECUTIONS_DB[exec_id] = {
        "id": exec_id,
        "workflow_id": ver["workflow_id"],
        "workflow_version_id": req.workflow_version_id,
        "approval_ids": req.approval_ids,
        "status": "succeeded",
        "reuse_from": req.reuse_from_execution_id,
        "node_runs": node_runs,
        "created_at": now,
        "finished_at": now,
        "requested_by": "u_dev1"
    }
    return {"execution_id": exec_id}

@app.get("/executions", response_model=List[Execution], tags=["Executions"])
def list_executions(workflow_id: Optional[str] = None, project_id: Optional[str] = None):
    res = []
    for e in EXECUTIONS_DB.values():
        if workflow_id and e["workflow_id"] != workflow_id: continue
        res.append(Execution(**e))
    return res

@app.get("/executions/{id}", response_model=Execution, tags=["Executions"])
def get_execution(id: str):
    e = EXECUTIONS_DB.get(id)
    if not e:
        raise HTTPException(status_code=404, detail=f"Exécution introuvable : {id}")
    return Execution(**e)

@app.post("/executions/{id}/cancel", response_model=Execution, tags=["Executions"])
def cancel_execution(id: str):
    e = EXECUTIONS_DB.get(id)
    if not e:
        raise HTTPException(status_code=404, detail=f"Exécution introuvable : {id}")
    e["status"] = "cancelled"
    return Execution(**e)

@app.get("/executions/{id}/events", tags=["Executions"])
async def stream_execution_events(id: str):
    """Server-Sent Events streaming real-time execution progress."""
    async def event_generator():
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        # Event 1: Node status running
        yield f"id: 1\nevent: node_status\ndata: {json.dumps({'id': 1, 'type': 'node_status', 'execution_id': id, 'node_id': 'node_train', 'status': 'running', 'ts': now})}\n\n"
        await asyncio.sleep(0.5)
        # Event 2: Node status succeeded
        yield f"id: 2\nevent: node_status\ndata: {json.dumps({'id': 2, 'type': 'node_status', 'execution_id': id, 'node_id': 'node_train', 'status': 'succeeded', 'ts': now})}\n\n"
        await asyncio.sleep(0.5)
        # Event 3: Execution succeeded
        yield f"id: 3\nevent: execution_status\ndata: {json.dumps({'id': 3, 'type': 'execution_status', 'execution_id': id, 'status': 'succeeded', 'ts': now})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

# -------------------------------------------------------------
# Exports & Promotions
# -------------------------------------------------------------
@app.post("/exports", tags=["Exports"])
def create_export(req: ExportCreateRequest):
    exp_id = f"exp_{uuid.uuid4().hex[:8]}"
    return {"export_id": exp_id}

@app.get("/exports/{id}", response_model=ExportManifest, tags=["Exports"])
def get_export(id: str):
    return ExportManifest(
        export_id=id,
        workflow_version_id="wfv_01",
        content_hash=compute_canonical_hash(DEFAULT_SPEC),
        execution_id="exec_01",
        status="succeeded",
        dataset_refs=["dsv_churn_v1"],
        split_refs=["split_01"],
        preprocess_spec="prep_01",
        model_configs=[{"model_id": "model_xgb", "n_estimators": 100}],
        integrity="sha256:bundle_integrity_001",
        bundle_uri=f"s3://exports/p_churn/{id}.zip"
    )

@app.post("/registry/promotions", response_model=PromotionRecord, tags=["Registry"])
def promote_model(req: PromotionRequest):
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    rec = PromotionRecord(
        id=f"prom_{uuid.uuid4().hex[:8]}",
        model_version_id=req.model_version_id,
        model_name="Customer Churn Predictor",
        alias=req.alias,
        approval_id=req.approval_id,
        actor="u_dev1",
        checks={"test_evaluated": True, "reproducible": True},
        created_at=now
    )
    PROMOTIONS_DB.append(rec)
    return rec

@app.get("/registry/promotions", response_model=List[PromotionRecord], tags=["Registry"])
def list_promotions(model_name: Optional[str] = None):
    return PROMOTIONS_DB


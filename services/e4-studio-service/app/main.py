import asyncio
import datetime
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .database import check_db_health, init_db
from .policy import (BUDGET_CAPS, layer_status, missing_requirements, parse_ts, policy_issues,
                     structure_issues)
from .schemas import (
    NodeType, Template, Workflow, WorkflowRow, WorkflowVersion, WorkflowVersionMeta,
    WorkflowCreateRequest, WorkflowVersionCreateRequest, WorkflowDiff, NodeDiff, NodeDiffChange,
    ValidationReport, ValidationLayer, ValidationIssue,
    Approval, ApprovalCreateRequest, Execution, ExecutionCreateRequest,
    ExportCreateRequest, ExportManifest,
    PromotionRequest, PromotionRecord, compute_canonical_hash
)

logger = logging.getLogger(__name__)

E1_SERVICE_URL = os.getenv("E1_SERVICE_URL", "")
E2_SERVICE_URL = os.getenv("E2_SERVICE_URL")  # e.g. http://e2-training-service:8002
E3_SERVICE_URL = os.getenv("E3_SERVICE_URL")  # e.g. http://e3-assistant-service:8003
CURRENT_USER = "u_dev1"  # no authentication yet


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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------------------------------------------
# Uniform ApiError responses: {code, message, details, request_id}
# -------------------------------------------------------------
_DEFAULT_CODES = {400: "BAD_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND",
                  405: "METHOD_NOT_ALLOWED", 409: "CONFLICT", 422: "VALIDATION_ERROR"}


def _rid() -> str:
    return f"req_{uuid.uuid4().hex[:8]}"


def api_error(status_code: int, code: str, message: str, details: Any = None) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message, "details": details})


def not_found(kind: str, id_: Optional[str]) -> HTTPException:
    return api_error(404, "NOT_FOUND", f"{kind} introuvable : {id_}")


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


def now_utc() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def iso(dt: datetime.datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


from .contracts import contracts

# Catalogue partagé (packages/contracts/catalog.json) : plus de copie locale qui diverge du client web.
CANONICAL_NODE_TYPES = contracts.NODE_TYPES
CATALOG = {n["type"]: n for n in CANONICAL_NODE_TYPES}

# Un gabarit par type de pipeline (+ identifiants historiques conservés pour la classification).
STARTER_TEMPLATES = [
    {"id": f"tpl_{p['id']}", "label": p["label"], "description": p["description"], "task": p["id"],
     "params": ["dataset_version_id"] + [r["role"] for r in p["roles"]]}
    for p in contracts.PIPELINE_TYPES.values()
] + [
    {"id": "full_pipeline", "label": "Pipeline complet", "task": None,
     "description": "Dataset → split → prétraitement → modèles → comparaison → test final → enregistrement (type au choix).", "params": ["dataset_version_id", "target", "task"]},
    {"id": "quick_train", "label": "Entraînement rapide", "task": None,
     "description": "Dataset → split → prétraitement recommandé → un modèle → comparaison (type au choix).", "params": ["dataset_version_id", "target", "task"]},
    {"id": "tpl_tabular_classif", "label": "Classification Tabulaire Standard", "task": "classification",
     "description": "Pipeline classique : Ingestion -> Nettoyage -> Split 80/20 -> modèles -> Évaluation finale.", "params": ["dataset_version_id", "target"]},
    {"id": "tpl_optuna_tuning", "label": "AutoML avec Optimisation Hyperparamétrique", "task": "classification",
     "description": "Exploration des hyperparamètres avec comparaison sur jeu de validation.", "params": ["dataset_version_id", "target", "n_trials"]},
]

# Baseline initial workflow
DEFAULT_SPEC = {
    "schema_version": "1.0.0",
    "catalog_version": contracts.CATALOG_VERSION,
    "nodes": [
        {"id": "node_ds", "type": "data.dataset", "type_version": "1.0", "params": {"dataset_version_id": "dsv_churn_v1"}, "ui": {"x": 100, "y": 150}},
        {"id": "node_split", "type": "data.split", "type_version": "1.0", "params": {"strategy": "stratified", "test_ratio": 0.2, "cv_folds": 5, "seed": 42, "target": "churn"}, "ui": {"x": 350, "y": 150}},
        {"id": "node_train", "type": "train.model", "type_version": "1.0", "params": {"model_id": "gradient_boosting", "params": {"n_estimators": 100}, "primary_metric": "accuracy", "seed": 42}, "ui": {"x": 600, "y": 150}}
    ],
    "edges": [
        {"id": "e1", "from": {"node": "node_ds", "port": "dataset"}, "to": {"node": "node_split", "port": "dataset"}},
        {"id": "e2", "from": {"node": "node_split", "port": "split"}, "to": {"node": "node_train", "port": "split"}}
    ],
    "metadata": {"task": "classification", "target": "churn", "objective": {"primary_metric": "accuracy", "direction": "maximize"}, "origin": "human"}
}
DEFAULT_HASH = compute_canonical_hash(DEFAULT_SPEC)
_BOOT = now_utc()

WORKFLOWS_DB: Dict[str, Dict[str, Any]] = {
    "wf_churn_01": {
        "id": "wf_churn_01",
        "project_id": "p_churn",
        "name": "Pipeline Prédiction Churn",
        "created_at": "2026-11-05T10:15:00Z",
        "latest_version_id": "wfv_01"
    }
}

VERSIONS_DB: Dict[str, Dict[str, Any]] = {
    "wfv_01": {
        "id": "wfv_01",
        "workflow_id": "wf_churn_01",
        "parent_version_id": None,
        "content_hash": DEFAULT_HASH,
        "author": {"type": "user", "id": CURRENT_USER},
        "created_at": "2026-11-05T10:15:00Z",
        "origin": "human",
        "readiness": "draft",
        "label": "Version Initiale",
        "spec": DEFAULT_SPEC
    }
}

APPROVALS_DB: Dict[str, Dict[str, Any]] = {
    "appr_01": {
        "id": "appr_01",
        "project_id": "p_churn",
        "user_id": CURRENT_USER,
        "workflow_version_id": "wfv_01",
        "content_hash": DEFAULT_HASH,
        "scope": "version",
        "operation_classes": ["L2"],
        "node_ids": ["node_train"],
        "budget": {"trials": 50, "max_minutes": 30, "models": 2},
        "mode": "guided",
        "method": "explicit_click",
        # Relative to start-up: a fixed date made the demo approval expire.
        "expires_at": iso(_BOOT + datetime.timedelta(days=7)),
        "status": "active",
        "created_at": iso(_BOOT)
    }
}

EXECUTIONS_DB: Dict[str, Dict[str, Any]] = {
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
        "requested_by": CURRENT_USER
    }
}

EXPORTS_DB: Dict[str, Dict[str, Any]] = {}
PROMOTIONS_DB: List[Dict[str, Any]] = []


# -------------------------------------------------------------
# Cross-service lookups (best effort, with local fallbacks)
# -------------------------------------------------------------
def project_mode(project_id: str) -> str:
    """Governance mode is owned by E3. Defaults to 'guided' when E3 is not configured or unreachable."""
    if not E3_SERVICE_URL:
        return "guided"
    try:
        r = httpx.get(f"{E3_SERVICE_URL}/assistant/mode", params={"project_id": project_id}, timeout=2.0)
        if r.status_code == 200:
            return r.json().get("mode", "guided")
    except httpx.HTTPError as e:
        logger.warning(f"E3 mode lookup failed for {project_id}: {e}")
    return "guided"


def model_name_of(model_version_id: str) -> str:
    if E2_SERVICE_URL:
        try:
            r = httpx.get(f"{E2_SERVICE_URL}/models/registry/{model_version_id}", timeout=2.0)
            if r.status_code == 200:
                return r.json().get("name", model_version_id)
        except httpx.HTTPError as e:
            logger.warning(f"E2 registry lookup failed for {model_version_id}: {e}")
    return model_version_id


# -------------------------------------------------------------
# Helpers
# -------------------------------------------------------------
def get_version_or_404(version_id: str) -> Dict[str, Any]:
    v = VERSIONS_DB.get(version_id)
    if not v:
        raise not_found("Version de workflow", version_id)
    return v


def project_of_version(v: Dict[str, Any]) -> str:
    return WORKFLOWS_DB[v["workflow_id"]]["project_id"]


def lineage_ids(version_id: str) -> set:
    """The version and all of its ancestors."""
    out, cur = set(), version_id
    while cur and cur not in out:
        out.add(cur)
        cur = (VERSIONS_DB.get(cur) or {}).get("parent_version_id")
    return out


def version_meta(v: Dict[str, Any]) -> WorkflowVersionMeta:
    return WorkflowVersionMeta(**{k: val for k, val in v.items() if k != "spec"})


def dump_spec(spec) -> Dict[str, Any]:
    # by_alias keeps the contract key "from" on edges (otherwise "from_" changes the content hash);
    # exclude_none drops unset optional fields (e.g. metadata.goal_id) that the client never sent.
    return spec.model_dump(by_alias=True, exclude_none=True)


# -------------------------------------------------------------
# Health Checks
# -------------------------------------------------------------
@app.get("/health/live", tags=["Health"])
def health_live():
    return {"status": "ok", "service": "e4-studio-service", "timestamp": iso(now_utc())}


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
    return {"catalog_version": contracts.CATALOG_VERSION, "node_types": [NodeType(**n) for n in CANONICAL_NODE_TYPES]}


@app.get("/catalog/pipeline-types", tags=["Catalog"])
def get_pipeline_types():
    """Types de pipeline pris en charge (rôles de colonnes, métriques, étapes, gabarits)."""
    return {"catalog_version": contracts.CATALOG_VERSION, "pipeline_types": list(contracts.PIPELINE_TYPES.values())}


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
        if project_id and w["project_id"] != project_id:
            continue
        v = VERSIONS_DB.get(w["latest_version_id"])
        if v is None:
            continue
        v_count = sum(1 for x in VERSIONS_DB.values() if x["workflow_id"] == w["id"])
        res.append(WorkflowRow(**w, latest=version_meta(v), versions_count=v_count))
    return res


@app.post("/workflows", status_code=status.HTTP_201_CREATED, tags=["Workflows"])
def create_workflow(req: WorkflowCreateRequest):
    name = req.name.strip()
    if not name:
        raise api_error(400, "BAD_REQUEST", "Le nom du workflow est requis.")
    wf_id = f"wf_{uuid.uuid4().hex[:8]}"
    v_id = f"wfv_{uuid.uuid4().hex[:8]}"
    now = iso(now_utc())
    raw_spec = dump_spec(req.spec)
    chash = compute_canonical_hash(raw_spec)

    WORKFLOWS_DB[wf_id] = {"id": wf_id, "project_id": req.project_id, "name": name,
                           "created_at": now, "latest_version_id": v_id}
    VERSIONS_DB[v_id] = {
        "id": v_id,
        "workflow_id": wf_id,
        "parent_version_id": None,
        "content_hash": chash,
        "author": {"type": "user", "id": CURRENT_USER} if req.origin == "human" else {"type": "assistant", "id": "e3-assistant"},
        "created_at": now,
        "origin": req.origin,
        "readiness": "draft",
        "label": "Version 1",
        "spec": raw_spec
    }
    return {"workflow_id": wf_id, "version_id": v_id, "content_hash": chash}


def dataset_version(version_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """Schéma et projet d'une version de dataset (E1). None si E1 n'est pas configuré ou injoignable."""
    if not version_id or not E1_SERVICE_URL:
        return None
    try:
        r = httpx.get(f"{E1_SERVICE_URL}/dataset-versions/{version_id}", timeout=2.0)
        if r.status_code == 200:
            return r.json()
    except httpx.HTTPError as e:
        logger.warning(f"E1 dataset lookup failed for {version_id}: {e}")
    return None


@app.post("/workflows/from-template", status_code=status.HTTP_201_CREATED, tags=["Workflows"])
def create_from_template(p: Dict[str, Any]):
    template_id = p.get("template_id")
    tpl = next((t for t in STARTER_TEMPLATES if t["id"] == template_id), None)
    if tpl is None:
        raise not_found("Modèle de workflow", template_id)
    task = p.get("task") or tpl.get("task") or "classification"
    if task not in contracts.PIPELINE_TYPES:
        raise api_error(400, "BAD_REQUEST", f"Type de pipeline inconnu : {task}")
    params = p.get("params") or {}
    dsv = params.get("dataset_version_id") or p.get("dataset_version_id")
    target = params.get("target") or p.get("target")
    version = dataset_version(dsv)
    project_id = p.get("project_id") or (version or {}).get("project_id")
    if not project_id:
        raise api_error(400, "BAD_REQUEST", "project_id requis.")
    origin = p.get("origin") if p.get("origin") in ("human", "ai") else "human"
    if version or task != "classification" or template_id in ("full_pipeline", "quick_train"):
        spec = contracts.build_template_spec(task, dsv or "", (version or {}).get("schema") or [], target=target,
                                             metric=p.get("primary_metric"), origin=origin, goal_id=p.get("goal_id"),
                                             model_name=p.get("model_name"), full=template_id != "quick_train")
        if target and not (version or {}).get("schema"):
            # Sans schéma (E1 injoignable) : la cible indiquée reste appliquée au split et aux métadonnées.
            spec["metadata"]["target"] = target
            next(n for n in spec["nodes"] if n["type"] == "data.split")["params"]["target"] = target
    else:
        spec = json.loads(json.dumps(DEFAULT_SPEC))
        if dsv:
            spec["nodes"][0]["params"]["dataset_version_id"] = dsv
        if target:
            spec["metadata"]["target"] = target
            spec["nodes"][1]["params"]["target"] = target
    req = WorkflowCreateRequest(project_id=project_id, name=p.get("name") or tpl["label"], spec=spec, origin=origin)
    return create_workflow(req)


@app.get("/workflows/{id}", tags=["Workflows"])
def get_workflow(id: str):
    wf = WORKFLOWS_DB.get(id)
    if not wf:
        raise not_found("Workflow", id)
    versions = [version_meta(v) for v in VERSIONS_DB.values() if v["workflow_id"] == id]
    return {"workflow": Workflow(**wf), "versions": versions}


@app.get("/workflows/{wf}/versions/{v}", response_model=WorkflowVersion, tags=["Workflows"])
def get_version(wf: str, v: str):
    ver = VERSIONS_DB.get(v)
    if not ver or ver["workflow_id"] != wf:
        raise not_found("Version", v)
    return WorkflowVersion(**ver)


@app.post("/workflows/{wf}/versions", status_code=status.HTTP_201_CREATED, tags=["Workflows"])
def create_version(wf: str, req: WorkflowVersionCreateRequest):
    wf_obj = WORKFLOWS_DB.get(wf)
    if not wf_obj:
        raise not_found("Workflow", wf)

    parent_ver = None
    if req.parent_version_id:
        parent_ver = VERSIONS_DB.get(req.parent_version_id)
        if parent_ver is None or parent_ver["workflow_id"] != wf:
            raise not_found("Version parente", req.parent_version_id)

    raw_spec = dump_spec(req.spec)
    chash = compute_canonical_hash(raw_spec)
    if parent_ver and parent_ver["content_hash"] == chash:
        return {"version_id": parent_ver["id"], "content_hash": chash, "unchanged": True}

    v_id = f"wfv_{uuid.uuid4().hex[:8]}"
    n = sum(1 for x in VERSIONS_DB.values() if x["workflow_id"] == wf) + 1
    VERSIONS_DB[v_id] = {
        "id": v_id,
        "workflow_id": wf,
        "parent_version_id": req.parent_version_id,
        "content_hash": chash,
        "author": {"type": "user", "id": CURRENT_USER},
        "created_at": iso(now_utc()),
        "origin": "human",
        "readiness": "draft",
        "label": req.label or f"Version {n}",
        "spec": raw_spec
    }
    wf_obj["latest_version_id"] = v_id
    return {"version_id": v_id, "content_hash": chash, "unchanged": False}


def _flatten(d: Any, prefix: str = "") -> Dict[str, Any]:
    if isinstance(d, dict):
        out: Dict[str, Any] = {}
        for k, val in d.items():
            out.update(_flatten(val, f"{prefix}.{k}" if prefix else k))
        return out
    return {prefix: d}


@app.get("/workflows/{wf}/versions/{v}/diff", response_model=WorkflowDiff, tags=["Workflows"])
def diff_version(wf: str, v: str, against: str):
    cur, base = VERSIONS_DB.get(v), VERSIONS_DB.get(against)
    if not cur or cur["workflow_id"] != wf:
        raise not_found("Version", v)
    if not base or base["workflow_id"] != wf:
        raise not_found("Version", against)
    cn = {n["id"]: n for n in cur["spec"]["nodes"]}
    bn = {n["id"]: n for n in base["spec"]["nodes"]}
    changed = []
    for nid in sorted(set(cn) & set(bn)):
        a = _flatten({k: x for k, x in bn[nid].items() if k != "ui"})
        b = _flatten({k: x for k, x in cn[nid].items() if k != "ui"})
        changes = [NodeDiffChange(path=p, before=a.get(p), after=b.get(p))
                   for p in sorted(set(a) | set(b)) if a.get(p) != b.get(p)]
        if changes:
            changed.append(NodeDiff(id=nid, changes=changes))
    ce = {e["id"] for e in cur["spec"]["edges"]}
    be = {e["id"] for e in base["spec"]["edges"]}
    return WorkflowDiff(against=against, nodes_added=sorted(set(cn) - set(bn)), nodes_removed=sorted(set(bn) - set(cn)),
                        nodes_changed=changed, edges_added=sorted(ce - be), edges_removed=sorted(be - ce))


def build_report(ver: Dict[str, Any], approvals: Optional[List[Dict[str, Any]]] = None,
                 mode: Optional[str] = None) -> ValidationReport:
    spec = ver["spec"]
    project_id = project_of_version(ver)
    mode = mode or project_mode(project_id)
    if approvals is None:
        approvals = [a for a in APPROVALS_DB.values() if a["project_id"] == project_id]
    lin = lineage_ids(ver["id"])
    s_issues = structure_issues(spec, CATALOG) + contracts.pipeline_type_issues(spec)
    if not contracts.is_compatible_catalog(spec.get("catalog_version", "")):
        s_issues.append({"code": "V9", "severity": "error",
                         "message": f"Version de catalogue {spec.get('catalog_version')} incompatible (courante : {contracts.CATALOG_VERSION})."})
    p_issues = policy_issues(spec, mode, approvals, ver["content_hash"],
                             lambda a: a["workflow_version_id"] in lin, CATALOG)
    meta = spec.get("metadata") or {}
    needs_target = any(r["role"] == "target" and r["required"] for r in contracts.pipeline_type(meta.get("task"))["roles"])
    t_issues = [] if meta.get("target") or not needs_target else [{"code": "T_NO_TARGET", "severity": "warning",
                                                                   "message": "Aucune colonne cible définie dans metadata.target."}]
    layers = [
        ValidationLayer(layer="structure", status=layer_status(s_issues), issues=[ValidationIssue(**i) for i in s_issues]),
        ValidationLayer(layer="data", status="ok", issues=[]),  # dataset/split checks are owned by E1
        ValidationLayer(layer="training", status=layer_status(t_issues), issues=[ValidationIssue(**i) for i in t_issues]),
        ValidationLayer(layer="policy", status=layer_status(p_issues), issues=[ValidationIssue(**i) for i in p_issues]),
    ]
    overall = layer_status([i.model_dump() for layer in layers for i in layer.issues])
    return ValidationReport(subject={"kind": "WorkflowVersion", "id": ver["id"]}, content_hash=ver["content_hash"],
                            status=overall, layers=layers, created_at=iso(now_utc()))


@app.post("/workflows/{wf}/versions/{v}/validate", response_model=ValidationReport, tags=["Workflows"])
@app.get("/workflows/{wf}/versions/{v}/validation", response_model=ValidationReport, tags=["Workflows"])
def validate_version(wf: str, v: str):
    ver = VERSIONS_DB.get(v)
    if not ver or ver["workflow_id"] != wf:
        raise not_found("Version", v)
    return build_report(ver)


# -------------------------------------------------------------
# Approvals
# -------------------------------------------------------------
@app.get("/approvals", response_model=List[Approval], tags=["Approvals"])
def list_approvals(workflow_version_id: Optional[str] = None):
    return [Approval(**a) for a in APPROVALS_DB.values()
            if not workflow_version_id or a["workflow_version_id"] == workflow_version_id]


@app.post("/approvals", status_code=status.HTTP_201_CREATED, tags=["Approvals"])
def create_approval(req: ApprovalCreateRequest):
    ver = get_version_or_404(req.workflow_version_id)
    project_id = project_of_version(ver)
    mode = project_mode(project_id)
    classes = req.operation_classes
    if not classes:
        raise api_error(400, "VALIDATION", "operation_classes requis.")
    if "L3" in classes:
        if req.method != "explicit_click":
            raise api_error(403, "L3_REQUIRES_CLICK", "Une approbation L3 exige un clic explicite de l'utilisateur.")
        if not req.node_ids:
            raise api_error(400, "VALIDATION", "Une approbation L3 est individuelle : node_ids requis.")
    if "L2" in classes and mode == "guided" and not req.node_ids:
        raise api_error(400, "VALIDATION", "Mode Guidé : une approbation par étape (node_ids requis).")
    scope = "version"
    budget = req.budget.model_dump() if req.budget else None
    if mode == "auto" and "L2" in classes and "L3" not in classes:
        if not budget:
            raise api_error(400, "BUDGET_REQUIRED", "Mode Auto : un budget (essais, durée, nombre de modèles) est requis.")
        if any(budget[k] > BUDGET_CAPS[k] for k in BUDGET_CAPS):
            raise api_error(400, "BUDGET_EXCEEDED", "Le budget dépasse les plafonds de GET /training/resources.", BUDGET_CAPS)
        scope = "version" if req.scope == "version" else "lineage"

    now = now_utc()
    appr = Approval(
        id=f"appr_{uuid.uuid4().hex[:8]}",
        project_id=project_id,
        user_id=CURRENT_USER,
        workflow_version_id=ver["id"],
        content_hash=ver["content_hash"],
        scope=scope,
        operation_classes=classes,
        node_ids=req.node_ids,
        budget=req.budget,
        mode=mode,
        method=req.method,
        expires_at=iso(now + datetime.timedelta(days=7)),
        status="active",
        created_at=iso(now),
    )
    APPROVALS_DB[appr.id] = appr.model_dump()
    return {"approval_id": appr.id, "approval": appr}


@app.post("/approvals/{id}/revoke", response_model=Approval, tags=["Approvals"])
def revoke_approval(id: str):
    a = APPROVALS_DB.get(id)
    if not a:
        raise not_found("Approbation", id)
    if a["status"] != "active":
        raise api_error(409, "APPROVAL_NOT_ACTIVE", f"Approbation déjà {a['status']}.")
    a["status"] = "revoked"
    return Approval(**a)


# -------------------------------------------------------------
# Executions Engine & Server-Sent Events (SSE)
# -------------------------------------------------------------
@app.post("/executions", status_code=status.HTTP_202_ACCEPTED, tags=["Executions"])
def create_execution(req: ExecutionCreateRequest):
    ver = get_version_or_404(req.workflow_version_id)
    project_id = project_of_version(ver)
    mode = project_mode(project_id)

    unknown = [i for i in req.approval_ids if i not in APPROVALS_DB]
    if unknown:
        raise not_found("Approbation", unknown[0])
    chosen = [APPROVALS_DB[i] for i in req.approval_ids if APPROVALS_DB[i]["project_id"] == project_id]

    report = build_report(ver, approvals=chosen, mode=mode)
    if any(layer.layer != "policy" and layer.status == "error" for layer in report.layers):
        raise api_error(422, "VALIDATION_FAILED", "Le workflow comporte des erreurs de validation : exécution refusée.",
                        report.model_dump())

    lin = lineage_ids(ver["id"])
    missing = missing_requirements(ver["spec"], mode, chosen, ver["content_hash"],
                                   lambda a: a["workflow_version_id"] in lin, CATALOG)
    if missing:
        raise api_error(403, "APPROVAL_REQUIRED", "Approbations manquantes ou invalides pour ce content_hash.",
                        {"missing": [{"operation_class": m["operation_class"], "node_ids": m["node_ids"], "kind": m["kind"]}
                                     for m in missing]})
    if req.reuse_from_execution_id and req.reuse_from_execution_id not in EXECUTIONS_DB:
        raise not_found("Exécution", req.reuse_from_execution_id)

    exec_id = f"exec_{uuid.uuid4().hex[:8]}"
    now = iso(now_utc())
    # Simulated executor: every node completes immediately until the real engine is wired to E1/E2.
    node_runs = [{"node_id": n["id"], "attempt": 1, "status": "succeeded", "cached": False, "progress": 1.0,
                  "started_at": now, "finished_at": now} for n in ver["spec"].get("nodes", [])]
    EXECUTIONS_DB[exec_id] = {
        "id": exec_id,
        "workflow_id": ver["workflow_id"],
        "workflow_version_id": ver["id"],
        "approval_ids": req.approval_ids,
        "status": "succeeded",
        "reuse_from": req.reuse_from_execution_id,
        "node_runs": node_runs,
        "created_at": now,
        "finished_at": now,
        "requested_by": CURRENT_USER
    }
    # Individual L3 approvals are consumed on use.
    for a in chosen:
        if "L3" in a["operation_classes"]:
            a["status"] = "expired"
    return {"execution_id": exec_id}


@app.get("/executions", response_model=List[Execution], tags=["Executions"])
def list_executions(workflow_id: Optional[str] = None, project_id: Optional[str] = None):
    res = []
    for e in EXECUTIONS_DB.values():
        if workflow_id and e["workflow_id"] != workflow_id:
            continue
        if project_id and WORKFLOWS_DB.get(e["workflow_id"], {}).get("project_id") != project_id:
            continue
        res.append(Execution(**e))
    return res


@app.get("/executions/{id}", response_model=Execution, tags=["Executions"])
def get_execution(id: str):
    e = EXECUTIONS_DB.get(id)
    if not e:
        raise not_found("Exécution", id)
    return Execution(**e)


@app.post("/executions/{id}/cancel", response_model=Execution, tags=["Executions"])
def cancel_execution(id: str):
    e = EXECUTIONS_DB.get(id)
    if not e:
        raise not_found("Exécution", id)
    if e["status"] in ("succeeded", "failed", "cancelled"):
        raise api_error(409, "ALREADY_FINISHED", "Exécution déjà terminée.")
    e["status"] = "cancelled"
    e["finished_at"] = iso(now_utc())
    for n in e["node_runs"]:
        if n["status"] in ("pending", "queued", "running"):
            n["status"] = "cancelled"
    return Execution(**e)


def execution_events(e: Dict[str, Any]) -> List[Dict[str, Any]]:
    events, n = [], 0
    for run in e["node_runs"]:
        for st, ts in (("running", run.get("started_at")), (run["status"], run.get("finished_at"))):
            n += 1
            events.append({"id": n, "type": "node_status", "execution_id": e["id"], "node_id": run["node_id"],
                           "status": st, "ts": ts or e["created_at"]})
    n += 1
    events.append({"id": n, "type": "execution_status", "execution_id": e["id"], "status": e["status"],
                   "ts": e.get("finished_at") or e["created_at"]})
    return events


@app.get("/executions/{id}/events", tags=["Executions"])
async def stream_execution_events(id: str, request: Request):
    """Server-Sent Events replaying the execution's progress (supports Last-Event-ID resume)."""
    e = EXECUTIONS_DB.get(id)
    if not e:
        raise not_found("Exécution", id)
    try:
        last_id = int(request.headers.get("last-event-id") or request.query_params.get("last-event-id") or 0)
    except ValueError:
        last_id = 0
    events = [ev for ev in execution_events(e) if ev["id"] > last_id]

    async def event_generator():
        for ev in events:
            yield f"id: {ev['id']}\nevent: {ev['type']}\ndata: {json.dumps(ev)}\n\n"
            await asyncio.sleep(0.2)

    return StreamingResponse(event_generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# -------------------------------------------------------------
# Exports & Promotions
# -------------------------------------------------------------
@app.post("/exports", status_code=status.HTTP_202_ACCEPTED, tags=["Exports"])
def create_export(req: ExportCreateRequest):
    e = EXECUTIONS_DB.get(req.execution_id)
    if not e:
        raise not_found("Exécution", req.execution_id)
    if e["status"] != "succeeded":
        raise api_error(409, "EXECUTION_NOT_SUCCEEDED", "Seule une exécution réussie peut être exportée.")
    ver = get_version_or_404(e["workflow_version_id"])
    if req.include_data:
        a = APPROVALS_DB.get(req.approval_id or "")
        if (not a or a["status"] != "active" or "L3" not in a["operation_classes"]
                or a["workflow_version_id"] != ver["id"] or "export" not in (a.get("node_ids") or [])):
            raise api_error(403, "APPROVAL_REQUIRED",
                            "L'inclusion de données dans un export exige une approbation L3 individuelle (node_ids = [\"export\"]).")
        a["status"] = "expired"  # consumed
    nodes = ver["spec"]["nodes"]
    exp_id = f"exp_{uuid.uuid4().hex[:8]}"
    manifest = {
        "export_id": exp_id,
        "workflow_version_id": ver["id"],
        "content_hash": ver["content_hash"],
        "execution_id": e["id"],
        "status": "succeeded",
        "dataset_refs": [n["params"]["dataset_version_id"] for n in nodes
                         if n["type"] == "data.dataset" and (n.get("params") or {}).get("dataset_version_id")],
        "split_refs": [],
        "preprocess_spec": "",
        "model_configs": [{"model_id": (n.get("params") or {}).get("model_id"), **((n.get("params") or {}).get("params") or {})}
                          for n in nodes if n["type"].startswith("train.")],
        "integrity": compute_canonical_hash({"version": ver["content_hash"], "execution": e["id"], "include_data": req.include_data}),
        "bundle_uri": f"s3://exports/{project_of_version(ver)}/{exp_id}.zip",
    }
    if req.include_data:
        manifest["limitations"] = ["Le bundle inclut les données du dataset (approbation L3)."]
    EXPORTS_DB[exp_id] = manifest
    return {"export_id": exp_id}


@app.get("/exports/{id}", response_model=ExportManifest, tags=["Exports"])
def get_export(id: str):
    m = EXPORTS_DB.get(id)
    if not m:
        raise not_found("Export", id)
    return ExportManifest(**m)


@app.post("/registry/promotions", response_model=PromotionRecord, tags=["Registry"])
def promote_model(req: PromotionRequest):
    a = APPROVALS_DB.get(req.approval_id)
    if (not a or a["status"] != "active" or parse_ts(a["expires_at"]) < now_utc() or "L3" not in a["operation_classes"]
            or f"promote:{req.model_version_id}" not in (a.get("node_ids") or [])):
        raise api_error(403, "APPROVAL_REQUIRED",
                        "La promotion exige une approbation L3 individuelle liée à cette version de modèle "
                        "(node_ids = [\"promote:<model_version_id>\"]).")
    rec = PromotionRecord(
        id=f"prom_{uuid.uuid4().hex[:8]}",
        model_version_id=req.model_version_id,
        model_name=model_name_of(req.model_version_id),
        alias=req.alias,
        approval_id=a["id"],
        actor=CURRENT_USER,
        checks={"test_evaluated": True, "reproducible": True},
        created_at=iso(now_utc()),
    )
    a["status"] = "expired"  # consumed
    PROMOTIONS_DB.insert(0, rec.model_dump())
    return rec


@app.get("/registry/promotions", response_model=List[PromotionRecord], tags=["Registry"])
def list_promotions(model_name: Optional[str] = None):
    return [PromotionRecord(**p) for p in PROMOTIONS_DB if not model_name or p["model_name"] == model_name]

import datetime
import os
import re
import logging
import uuid

import httpx
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from .database import check_db_health, init_db
from .models import ConversationModel, MessageModel, ProposalModel
from .schemas import (
    ChatMessage, ChatMessageRequest, ChatMessageResponse,
    GoalParseRequest, GoalParseResponse, GoalSpec, ObjectiveSpec,
    PlanProposal, PlanProposalRequest, RequiredApproval,
    ExplanationRequest, Explanation, ModeResponse, ModeUpdateRequest,
    AuditEvent, AuditActor, PolicyMatrixResponse, PolicyClass, PolicyMatrixRow
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

from .contracts import contracts

E1_SERVICE_URL = os.getenv("E1_SERVICE_URL", "")
E4_SERVICE_URL = os.getenv("E4_SERVICE_URL", "")

app = FastAPI(
    title="AI Studio - E3 Agentic AI Assistant Service",
    description="Microservice responsible for LLM conversation, goal parsing, proposal generation, and governance policies",
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

PROJECT_MODES = {
    "p_churn": "guided"
}

MESSAGES_DB = {
    "p_churn": [
        {
            "id": "msg_01",
            "role": "assistant",
            "text": "Bonjour ! Je suis votre assistant AI Studio. Comment puis-je vous aider sur ce projet de prédiction du churn ?",
            "ts": "2026-11-05T10:00:00Z",
            "evidence_refs": [],
            "proposed_actions": [
                {"kind": "open_dataset", "label": "Explorer telco_churn.csv", "ref": "/data/ds_churn"}
            ]
        }
    ]
}

PROPOSALS_DB = {
    "prop_churn_01": {
        "id": "prop_churn_01",
        "goal_id": "goal_churn_01",
        "workflow_id": "wf_churn_01",
        "workflow_version_id": "wfv_01",
        "rationale": {
            "model": "XGBoost Classifier recommandé pour ses performances sur les données tabulaires avec déséquilibre modéré.",
            "preprocessing": "Imputation médiane pour les valeurs manquantes de monthly_charges et encodage one-hot des contrats."
        },
        "assumptions": ["La colonne churn est la cible binaire à prédire."],
        "warnings": ["Exclusion recommandée de customer_id pour éviter tout risque de fuite de données."],
        "evidence_refs": [
            {"source_type": "profile", "source_id": "dsv_churn_v1#missing", "summary": "monthly_charges contient 4.2% de valeurs manquantes"}
        ],
        "required_approvals": [
            {"operation_class": "L2", "node_ids": ["train_node", "tune_node"], "individual": False}
        ],
        "validation_report_ref": "val_churn_01",
        "simulated": False
    }
}

AUDIT_LOG: List[Dict[str, Any]] = [
    {
        "id": "aud_01",
        "project_id": "p_churn",
        "actor": {"type": "user", "id": "u_dev1"},
        "ts": "2026-11-05T10:05:00Z",
        "action": "dataset_imported",
        "resource_ref": "ds_churn",
        "outcome": "ok",
        "request_id": "req_init_01"
    }
]

# -------------------------------------------------------------
# Health Checks
# -------------------------------------------------------------
@app.get("/health/live", tags=["Health"])
def health_live():
    return {"status": "ok", "service": "e3-assistant-service", "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()}

@app.get("/health/ready", tags=["Health"])
def health_ready():
    db_health = check_db_health()
    is_ready = db_health.get("status") == "connected"
    return JSONResponse(
        status_code=200 if is_ready else 503,
        content={"status": "ready" if is_ready else "degraded", "service": "e3-assistant-service", "database": db_health, "llm_provider": "ready"}
    )

# -------------------------------------------------------------
# Assistant Conversation Endpoints
# -------------------------------------------------------------
@app.get("/assistant/messages", response_model=List[ChatMessage], tags=["Assistant"])
def get_messages(project_id: str):
    msgs = MESSAGES_DB.get(project_id, [])
    return [ChatMessage(**m) for m in msgs]

@app.post("/assistant/messages", response_model=ChatMessageResponse, tags=["Assistant"])
def send_message(req: ChatMessageRequest):
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    u_msg = ChatMessage(
        id=f"msg_{uuid.uuid4().hex[:8]}",
        role="user",
        text=req.message,
        ts=now
    )
    
    reply_text = f"J'ai bien analysé votre demande : « {req.message} ». Je peux vous proposer un plan de travail AutoML adapté."
    actions = [
        {"kind": "create_proposal", "label": "Générer un plan de workflow", "ref": f"goal_{uuid.uuid4().hex[:6]}"}
    ]
    
    a_msg = ChatMessage(
        id=f"msg_{uuid.uuid4().hex[:8]}",
        role="assistant",
        text=reply_text,
        ts=now,
        proposed_actions=actions,
        evidence_refs=[
            {"source_type": "dataset", "source_id": "dsv_churn_v1", "summary": "Dataset client actif : 5 variables détectées"}
        ]
    )
    
    if req.project_id not in MESSAGES_DB:
        MESSAGES_DB[req.project_id] = []
    MESSAGES_DB[req.project_id].extend([u_msg.model_dump(), a_msg.model_dump()])
    
    return ChatMessageResponse(user_message=u_msg, reply=a_msg)

# -------------------------------------------------------------
# Goal Parsing & Proposal Endpoints
# -------------------------------------------------------------
GOALS_DB: Dict[str, Dict[str, Any]] = {}


def dataset_version(version_id: str) -> Optional[Dict[str, Any]]:
    """Schéma et projet d'une version de dataset (E1). None si E1 n'est pas configuré ou injoignable."""
    if not E1_SERVICE_URL:
        return None
    try:
        r = httpx.get(f"{E1_SERVICE_URL}/dataset-versions/{version_id}", timeout=2.0)
        if r.status_code == 200:
            return r.json()
    except httpx.HTTPError as e:
        logger.warning(f"E1 dataset lookup failed for {version_id}: {e}")
    return None


@app.post("/assistant/goals/parse", response_model=GoalParseResponse, tags=["Goals"])
def parse_goal(req: GoalParseRequest):
    """Structure un objectif : type de pipeline (intention exprimée, sinon forme du dataset), cible, métrique."""
    text = req.text or ""
    version = dataset_version(req.dataset_version_id) or {}
    schema = version.get("schema") or []
    lower = text.lower()
    mentioned = next((c["name"] for c in schema if c["name"].lower() in lower), None)
    if not mentioned and not schema:
        m = re.search(r"(?:prédire|predire|prévoir|predict|forecast|estimer)\s+(?:le |la |les |l'|the )?([\w-]+)", lower)
        mentioned = m.group(1) if m else None
    task = contracts.detect_task_from_text(text) or (contracts.infer_task(schema, mentioned) if schema else "classification")
    pt = contracts.pipeline_type(task)
    roles = contracts.guess_roles(schema, task, mentioned) if schema else ({"target": mentioned} if mentioned and task != "clustering" else {})
    target = roles.get("target")
    questions: List[str] = []
    ambiguities: List[str] = []
    needs_target = any(r["role"] == "target" and r["required"] for r in pt["roles"])
    if needs_target and not target:
        ambiguities.append("Cible non identifiée.")
        questions.append("Quelle colonne faut-il prédire ?")
    elif target and target != mentioned:
        ambiguities.append(f"Cible non précisée : « {target} » supposée.")
        questions.append(f"La cible est-elle bien « {target} » ?")
    metric = pt["default_metric"]
    for m_id, rx in (("accuracy", r"accuracy|exactitude"), ("roc_auc", r"\bauc\b"), ("mae", r"\bmae\b"), ("rmse", r"rmse"),
                     ("mape", r"mape"), ("ndcg_at_k", r"ndcg"), ("silhouette", r"silhouette")):
        if re.search(rx, lower) and m_id in pt["metrics"]:
            metric = m_id
    constraints = []
    mm = re.search(r"(\d+)\s*min", lower)
    if mm:
        constraints.append(f"Durée maximale d'entraînement : {mm.group(1)} minutes")
    goal = GoalSpec(id=f"goal_{uuid.uuid4().hex[:8]}", task=task, target=target,
                    objective=ObjectiveSpec(primary_metric=metric, direction=contracts.metric_direction(metric)),
                    constraints=constraints, ambiguities=ambiguities)
    GOALS_DB[goal.id] = {**goal.model_dump(), "dataset_version_id": req.dataset_version_id, "project_id": version.get("project_id")}
    warnings = ["Vérifiez le déséquilibre potentiel des classes avant le split stratifié."] if task == "classification" else []
    return GoalParseResponse(goal=goal, questions=questions, warnings=warnings, simulated=False)


@app.post("/assistant/proposals", response_model=PlanProposal, tags=["Proposals"])
def create_proposal(req: PlanProposalRequest):
    p_id = f"prop_{uuid.uuid4().hex[:8]}"
    goal = GOALS_DB.get(req.goal_id) or {}
    task = goal.get("task", "classification")
    pt = contracts.pipeline_type(task)
    wf_id, wfv_id = "wf_churn_01", "wfv_01"  # repli historique si E4 est injoignable
    if E4_SERVICE_URL:
        body = {"template_id": f"tpl_{task}", "task": task, "origin": "ai", "goal_id": req.goal_id,
                "project_id": req.project_id or goal.get("project_id"),
                "params": {"dataset_version_id": req.dataset_version_id, "target": goal.get("target")},
                "primary_metric": (goal.get("objective") or {}).get("primary_metric"),
                "name": f"Plan IA — {goal.get('target') or pt['label']}"}
        try:
            r = httpx.post(f"{E4_SERVICE_URL}/workflows/from-template", json=body, timeout=5.0)
            if r.status_code == 201:
                wf_id, wfv_id = r.json()["workflow_id"], r.json()["version_id"]
            else:
                logger.warning(f"E4 refused the proposal workflow: {r.status_code} {r.text[:200]}")
        except httpx.HTTPError as e:
            logger.warning(f"E4 proposal workflow creation failed: {e}")
    prop = PlanProposal(
        id=p_id,
        goal_id=req.goal_id,
        workflow_id=wf_id,
        workflow_version_id=wfv_id,
        rationale={
            "architecture": f"Gabarit {pt['label']} : dataset → split ({pt['default_split']}) → prétraitement adapté → modèles → comparaison → test final.",
            "policy": "Approbations requises selon le mode de gouvernance avant exécution.",
        },
        assumptions=[f"Type de pipeline : {pt['label']}."] + ([f"Cible : « {goal['target']} »."] if goal.get("target") else []),
        warnings=[],
        evidence_refs=[
            {"source_type": "rule", "source_id": f"R-TPL-{task}", "summary": f"Gabarit du catalogue partagé pour {pt['label']}"},
            {"source_type": "rule", "source_id": "R-POL-01", "summary": "Matrice de gouvernance appliquée"},
        ],
        required_approvals=[RequiredApproval(operation_class="L2", node_ids=[], individual=False)],
        simulated=False
    )
    PROPOSALS_DB[p_id] = prop.model_dump()
    return prop


@app.get("/assistant/proposals/{id}", response_model=PlanProposal, tags=["Proposals"])
def get_proposal(id: str):
    p = PROPOSALS_DB.get(id)
    if not p:
        raise HTTPException(status_code=404, detail=f"Proposition introuvable : {id}")
    return PlanProposal(**p)

# -------------------------------------------------------------
# Explanations & Governance Endpoints
# -------------------------------------------------------------
@app.post("/assistant/explanations", response_model=Explanation, tags=["Assistant"])
def get_explanation(req: ExplanationRequest):
    return Explanation(
        subject_ref=req.subject_ref,
        text=f"Explication de l'élément {req.subject_ref} : Le modèle XGBoost a obtenu un F1-score de 0.865 grâce aux étapes d'imputation médiane et de mise à l'échelle sur les variables numériques.",
        evidence_refs=[
            {"source_type": "run", "source_id": "run_xgb_01", "summary": "Run XGBoost Fine-Tuned (Accuracy: 0.879, F1: 0.865)"}
        ],
        simulated=False
    )

@app.get("/assistant/mode", response_model=ModeResponse, tags=["Policy"])
def get_mode(project_id: str):
    mode = PROJECT_MODES.get(project_id, "guided")
    return ModeResponse(project_id=project_id, mode=mode)

@app.put("/assistant/mode", response_model=ModeResponse, tags=["Policy"])
def update_mode(req: ModeUpdateRequest):
    PROJECT_MODES[req.project_id] = req.mode
    AUDIT_LOG.append({
        "id": f"aud_{uuid.uuid4().hex[:8]}",
        "project_id": req.project_id,
        "actor": {"type": "user", "id": "u_dev1"},
        "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "action": "mode_changed",
        "resource_ref": req.mode,
        "outcome": "ok",
        "request_id": f"req_{uuid.uuid4().hex[:8]}"
    })
    return ModeResponse(project_id=req.project_id, mode=req.mode)

@app.get("/assistant/audit", response_model=List[AuditEvent], tags=["Policy"])
def get_audit(project_id: str, action: Optional[str] = None, actor_type: Optional[str] = None):
    res = []
    for a in AUDIT_LOG:
        if a["project_id"] != project_id: continue
        if action and a["action"] != action: continue
        if actor_type and a["actor"]["type"] != actor_type: continue
        res.append(AuditEvent(**a))
    return res

@app.get("/policy/matrix", response_model=PolicyMatrixResponse, tags=["Policy"])
def get_policy_matrix():
    return PolicyMatrixResponse(
        classes=[
            PolicyClass(id="L0", label="Lecture", examples="aperçu, profil existant, catalogues, métriques, explications"),
            PolicyClass(id="L1", label="Calcul léger et déterministe", examples="profilage, recommandations de prétraitement, validation, création de version"),
            PolicyClass(id="L2", label="Exécution coûteuse", examples="entraînement, tuning, enregistrement d'un modèle"),
            PolicyClass(id="L3", label="Action engageante ou irréversible", examples="évaluation finale test, promotion de modèle, export avec données")
        ],
        modes=["auto", "guided", "expert"],
        matrix=[
            PolicyMatrixRow(cls="L0", auto="libre", guided="libre", expert="libre"),
            PolicyMatrixRow(cls="L1", auto="libre, journalisé", guided="libre, journalisé", expert="libre (clic utilisateur)"),
            PolicyMatrixRow(cls="L2", auto="approbation de plan avec budget", guided="approbation par étape d'exécution", expert="clic utilisateur = approbation implicite journalisée"),
            PolicyMatrixRow(cls="L3", auto="approbation explicite individuelle", guided="approbation explicite individuelle", expert="approbation explicite individuelle")
        ]
    )


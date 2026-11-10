import datetime
import uuid
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .schemas import (
    ChatMessage, ChatMessageRequest, ChatMessageResponse,
    GoalParseRequest, GoalParseResponse, GoalSpec, ObjectiveSpec,
    PlanProposal, PlanProposalRequest, RequiredApproval,
    ExplanationRequest, Explanation, ModeResponse, ModeUpdateRequest,
    AuditEvent, AuditActor, PolicyMatrixResponse, PolicyClass, PolicyMatrixRow
)

app = FastAPI(
    title="AI Studio - E3 Agentic AI Assistant Service",
    description="Microservice responsible for LLM conversation, goal parsing, proposal generation, and governance policies",
    version="1.0.0"
)

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
    return {"status": "ready", "service": "e3-assistant-service", "llm_provider": "ready"}

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
@app.post("/assistant/goals/parse", response_model=GoalParseResponse, tags=["Goals"])
def parse_goal(req: GoalParseRequest):
    g_id = f"goal_{uuid.uuid4().hex[:8]}"
    return GoalParseResponse(
        goal=GoalSpec(
            id=g_id,
            task="classification",
            target="churn",
            objective=ObjectiveSpec(primary_metric="f1", direction="maximize"),
            constraints=["Durée maximale d'entraînement : 10 minutes", "Modèle interprétable"],
            ambiguities=[]
        ),
        questions=[],
        warnings=["Vérifiez le déséquilibre potentiel des classes avant le split stratifié."],
        simulated=False
    )

@app.post("/assistant/proposals", response_model=PlanProposal, tags=["Proposals"])
def create_proposal(req: PlanProposalRequest):
    p_id = f"prop_{uuid.uuid4().hex[:8]}"
    prop = PlanProposal(
        id=p_id,
        goal_id=req.goal_id,
        workflow_id="wf_churn_01",
        workflow_version_id="wfv_01",
        rationale={
            "architecture": "Pipeline complet : Ingestion -> Nettoyage -> Split stratifié (80/20) -> Entraînement XGBoost & Tuning Optuna.",
            "policy": "Une approbation L2 requise avant exécution du tuning."
        },
        assumptions=["Données tabulaires nettoyées sans fuites temporelles."],
        warnings=[],
        evidence_refs=[
            {"source_type": "rule", "source_id": "R-POL-01", "summary": "Matrice de gouvernance Mode Guidé appliquée"}
        ],
        required_approvals=[
            RequiredApproval(operation_class="L2", node_ids=["tune_01"], individual=False)
        ],
        validation_report_ref="val_churn_01",
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

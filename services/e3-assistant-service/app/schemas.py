from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel

Mode = Literal["auto", "guided", "expert"]
OpClass = Literal["L0", "L1", "L2", "L3"]
Task = Literal["classification", "regression"]

class EvidenceRef(BaseModel):
    source_type: Literal["profile", "run", "execution", "rule", "dataset"]
    source_id: str
    summary: str

class ProposedAction(BaseModel):
    kind: Literal["create_proposal", "open_proposal", "open_workflow", "open_dataset", "run_profile"]
    label: str
    ref: str

class ChatMessage(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    text: str
    ts: str
    evidence_refs: Optional[List[EvidenceRef]] = None
    proposed_actions: Optional[List[ProposedAction]] = None
    simulated: Optional[bool] = False

class ChatMessageRequest(BaseModel):
    project_id: str
    message: str
    context_refs: Optional[List[str]] = []

class ChatMessageResponse(BaseModel):
    user_message: ChatMessage
    reply: ChatMessage

class ObjectiveSpec(BaseModel):
    primary_metric: str
    direction: Literal["maximize", "minimize"] = "maximize"

class GoalSpec(BaseModel):
    id: str
    task: Task
    target: str
    objective: ObjectiveSpec
    constraints: List[str] = []
    ambiguities: List[str] = []

class GoalParseRequest(BaseModel):
    text: str
    dataset_version_id: str

class GoalParseResponse(BaseModel):
    goal: GoalSpec
    questions: List[str] = []
    warnings: List[str] = []
    simulated: bool = False

class RequiredApproval(BaseModel):
    operation_class: OpClass
    node_ids: List[str]
    individual: bool = False

class PlanProposal(BaseModel):
    id: str
    goal_id: str
    workflow_id: str
    workflow_version_id: str
    rationale: Dict[str, str]
    assumptions: List[str] = []
    warnings: List[str] = []
    evidence_refs: List[EvidenceRef] = []
    required_approvals: List[RequiredApproval]
    validation_report_ref: Optional[str] = None
    simulated: Optional[bool] = False

class PlanProposalRequest(BaseModel):
    goal_id: str
    dataset_version_id: str

class ExplanationRequest(BaseModel):
    subject_ref: str

class Explanation(BaseModel):
    subject_ref: str
    text: str
    evidence_refs: List[EvidenceRef] = []
    simulated: Optional[bool] = False

class ModeResponse(BaseModel):
    project_id: str
    mode: Mode

class ModeUpdateRequest(BaseModel):
    project_id: str
    mode: Mode

class AuditActor(BaseModel):
    type: Literal["user", "assistant", "system"]
    id: str

class AuditEvent(BaseModel):
    id: str
    project_id: str
    actor: AuditActor
    ts: str
    action: str
    resource_ref: Optional[str] = None
    outcome: Literal["ok", "refused", "error"] = "ok"
    reason: Optional[str] = None
    approval_id: Optional[str] = None
    request_id: str

class PolicyClass(BaseModel):
    id: OpClass
    label: str
    examples: str

class PolicyMatrixRow(BaseModel):
    cls: OpClass
    auto: str
    guided: str
    expert: str

class PolicyMatrixResponse(BaseModel):
    classes: List[PolicyClass]
    modes: List[str]
    matrix: List[PolicyMatrixRow]

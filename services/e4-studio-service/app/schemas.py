import hashlib
import json
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field

Mode = Literal["auto", "guided", "expert"]
OpClass = Literal["L0", "L1", "L2", "L3"]
Task = Literal["classification", "regression"]
JobStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
NodeStatus = Literal["pending", "queued", "running", "succeeded", "failed", "cancelled", "skipped"]
ExecutionStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
Readiness = Literal["draft", "validated", "approved"]
ApprovalStatus = Literal["active", "revoked", "expired"]

class PortDef(BaseModel):
    name: str
    type: str
    multiple: bool = False

class NodeType(BaseModel):
    type: str
    version: str
    label: str
    owner: str
    operation_class: OpClass
    adapter: str
    input_ports: List[PortDef]
    output_ports: List[PortDef]
    params_schema: Dict[str, Any]
    params_doc: str

class Template(BaseModel):
    id: str
    label: str
    description: str
    params: List[str]

class NodeUi(BaseModel):
    x: float
    y: float

class WorkflowNode(BaseModel):
    id: str
    type: str
    type_version: str
    params: Dict[str, Any]
    ui: Optional[NodeUi] = None

class PortRef(BaseModel):
    node: str
    port: str

class WorkflowEdge(BaseModel):
    id: str
    from_: PortRef = Field(alias="from")
    to: PortRef

    class Config:
        populate_by_name = True

class WorkflowMetadata(BaseModel):
    task: Task
    target: Optional[str] = None
    objective: Optional[Dict[str, str]] = None
    origin: Literal["human", "ai"] = "human"
    goal_id: Optional[str] = None

class WorkflowSpec(BaseModel):
    schema_version: str = "1.0.0"
    catalog_version: str = "1.0.0"
    nodes: List[WorkflowNode]
    edges: List[WorkflowEdge]
    metadata: WorkflowMetadata

class WorkflowAuthor(BaseModel):
    type: Literal["user", "assistant"]
    id: str

class WorkflowVersionMeta(BaseModel):
    id: str
    workflow_id: str
    parent_version_id: Optional[str] = None
    content_hash: str
    author: WorkflowAuthor
    created_at: str
    origin: Literal["human", "ai"] = "human"
    readiness: Readiness = "draft"
    label: Optional[str] = None

class WorkflowVersion(WorkflowVersionMeta):
    spec: WorkflowSpec

class Workflow(BaseModel):
    id: str
    project_id: str
    name: str
    created_at: str
    latest_version_id: str

class WorkflowRow(Workflow):
    latest: WorkflowVersionMeta
    versions_count: int

class WorkflowCreateRequest(BaseModel):
    project_id: str
    name: str
    spec: WorkflowSpec
    origin: Literal["human", "ai"] = "human"

class WorkflowVersionCreateRequest(BaseModel):
    parent_version_id: Optional[str] = None
    spec: WorkflowSpec
    label: Optional[str] = None

class NodeDiffChange(BaseModel):
    path: str
    before: Any
    after: Any

class NodeDiff(BaseModel):
    id: str
    changes: List[NodeDiffChange]

class WorkflowDiff(BaseModel):
    against: str
    nodes_added: List[str] = []
    nodes_removed: List[str] = []
    nodes_changed: List[NodeDiff] = []
    edges_added: List[str] = []
    edges_removed: List[str] = []

class ValidationIssue(BaseModel):
    code: str
    severity: Literal["error", "warning", "info"]
    node_id: Optional[str] = None
    path: Optional[str] = None
    message: str
    hint: Optional[str] = None

class ValidationLayer(BaseModel):
    layer: Literal["structure", "data", "training", "policy"]
    status: Literal["ok", "warning", "error"]
    issues: List[ValidationIssue]

class ValidationReport(BaseModel):
    subject: Dict[str, Any]
    content_hash: str
    status: Literal["ok", "warning", "error"]
    layers: List[ValidationLayer]
    catalog_version: str = "1.0.0"
    created_at: Optional[str] = None

class BudgetSpec(BaseModel):
    trials: int
    max_minutes: int
    models: int

class ApprovalCreateRequest(BaseModel):
    workflow_version_id: str
    operation_classes: List[OpClass]
    node_ids: Optional[List[str]] = None
    budget: Optional[BudgetSpec] = None
    method: Literal["explicit_click", "chat_confirm"] = "explicit_click"
    scope: Literal["version", "lineage"] = "version"

class Approval(BaseModel):
    id: str
    project_id: str
    user_id: str
    workflow_version_id: str
    content_hash: str
    scope: Literal["version", "lineage"] = "version"
    operation_classes: List[OpClass]
    node_ids: Optional[List[str]] = None
    budget: Optional[BudgetSpec] = None
    mode: Mode = "guided"
    method: Literal["explicit_click", "chat_confirm"] = "explicit_click"
    expires_at: str
    status: ApprovalStatus = "active"
    created_at: str

class NodeRun(BaseModel):
    node_id: str
    attempt: int = 1
    status: NodeStatus = "succeeded"
    cached: bool = False
    job_ref: Optional[str] = None
    error: Optional[Dict[str, str]] = None
    result_refs: Optional[List[Dict[str, str]]] = []
    progress: Optional[float] = 1.0
    started_at: Optional[str] = None
    finished_at: Optional[str] = None

class Execution(BaseModel):
    id: str
    workflow_id: str
    workflow_version_id: str
    approval_ids: List[str]
    status: ExecutionStatus = "succeeded"
    reuse_from: Optional[str] = None
    node_runs: List[NodeRun]
    created_at: str
    finished_at: Optional[str] = None
    requested_by: str

class ExecutionCreateRequest(BaseModel):
    workflow_version_id: str
    approval_ids: List[str]
    reuse_from_execution_id: Optional[str] = None

class ExportCreateRequest(BaseModel):
    execution_id: str
    include_data: bool = False
    approval_id: Optional[str] = None

class ExportManifest(BaseModel):
    export_id: str
    workflow_version_id: str
    content_hash: str
    execution_id: str
    status: JobStatus = "succeeded"
    dataset_refs: List[str] = []
    split_refs: List[str] = []
    preprocess_spec: str = ""
    model_configs: List[Dict[str, Any]] = []
    seeds: List[int] = [42]
    environment: List[str] = ["python==3.12", "scikit-learn==1.5.0", "xgboost==2.0.0"]
    code: List[Dict[str, str]] = []
    artifacts: List[Dict[str, Any]] = []
    limitations: List[str] = []
    integrity: str
    bundle_uri: Optional[str] = None

class PromotionRequest(BaseModel):
    model_version_id: str
    alias: Literal["staging", "production"]
    approval_id: str

class PromotionRecord(BaseModel):
    id: str
    model_version_id: str
    model_name: str
    alias: Literal["staging", "production"]
    approval_id: str
    actor: str
    checks: Dict[str, bool] = {"test_evaluated": True, "reproducible": True}
    created_at: str

# Deterministic SHA-256 hash calculation (excluding UI coordinates)
def compute_canonical_hash(spec: Dict[str, Any]) -> str:
    cleaned_nodes = []
    for n in spec.get("nodes", []):
        cn = {k: v for k, v in n.items() if k != "ui"}
        cleaned_nodes.append(cn)
    
    canonical_obj = {
        "schema_version": spec.get("schema_version", "1.0.0"),
        "catalog_version": spec.get("catalog_version", "1.0.0"),
        "nodes": sorted(cleaned_nodes, key=lambda x: x.get("id", "")),
        "edges": sorted(spec.get("edges", []), key=lambda x: x.get("id", "")),
        "metadata": spec.get("metadata", {})
    }
    dumped = json.dumps(canonical_obj, sort_keys=True, separators=(',', ':'))
    return f"sha256:{hashlib.sha256(dumped.encode('utf-8')).hexdigest()}"

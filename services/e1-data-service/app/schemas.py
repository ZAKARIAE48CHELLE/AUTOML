from typing import Any, Dict, List, Literal, Optional

from .contracts import contracts
from pydantic import BaseModel, ConfigDict, Field

# Common error schema
class ApiErrorDetail(BaseModel):
    code: str
    message: str
    details: Optional[Dict[str, Any]] = None
    request_id: Optional[str] = "req_e1_default"

# Auth
class LoginRequest(BaseModel):
    email: str
    password: str

class UserInfo(BaseModel):
    id: str
    name: str
    email: str

class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    user: UserInfo

class RefreshRequest(BaseModel):
    refresh_token: str

class RefreshResponse(BaseModel):
    access_token: str

# Projects
class ProjectCreate(BaseModel):
    name: str

class Project(BaseModel):
    id: str
    name: str
    role: Literal["owner", "editor", "viewer"] = "owner"
    created_at: str

class ProjectResponse(Project):
    project_id: str

# Datasets
class DatasetColumn(BaseModel):
    name: str
    dtype: Literal[tuple(contracts.DTYPES)]  # type: ignore[valid-type]
    nullable: bool = False

class DatasetVersion(BaseModel):
    id: str
    dataset_id: str
    project_id: str
    name: str
    version: int = 1
    checksum: str
    schema_: List[DatasetColumn] = Field(alias="schema")
    rows: int
    uri: str
    created_at: str
    status: Literal["importing", "ready", "failed"] = "ready"
    job_id: Optional[str] = None

    model_config = ConfigDict(populate_by_name=True)

class DatasetRow(BaseModel):
    id: str
    project_id: str
    name: str
    latest_version_id: Optional[str] = None
    rows: Optional[int] = None
    columns: Optional[int] = None
    status: Optional[Literal["importing", "ready", "failed"]] = "ready"
    created_at: Optional[str] = None

class DatasetDetail(BaseModel):
    id: str
    name: str
    project_id: str
    versions: List[DatasetVersion]

class DatasetImportResponse(BaseModel):
    dataset_id: str
    version_id: str
    job_id: str

class Preview(BaseModel):
    dataset_version_id: str
    columns: List[DatasetColumn]
    rows: List[Dict[str, Any]]
    total: int
    limit: int
    offset: int

# Profiling
class DataProfileColumn(BaseModel):
    name: str
    dtype: str
    missing_pct: float
    unique: int
    mean: Optional[float] = None
    std: Optional[float] = None
    min: Optional[float] = None
    max: Optional[float] = None
    top: Optional[List[Dict[str, Any]]] = None
    histogram: Optional[List[Dict[str, Any]]] = None

class DataAlert(BaseModel):
    code: str
    severity: Literal["info", "warning", "error"]
    column: Optional[str] = None
    message: str

class DataProfile(BaseModel):
    dataset_version_id: str
    columns: List[DataProfileColumn]
    alerts: List[DataAlert]
    computed_by: str
    rows: int
    status: Optional[Literal["computing", "ready", "failed"]] = "ready"

# Preprocessing
class PreprocessStep(BaseModel):
    type: str
    columns: Optional[List[str]] = None
    params: Optional[Dict[str, Any]] = None

class PreprocessTransform(BaseModel):
    type: str
    label: str
    applies_to: List[str]
    params_schema: Dict[str, Any]
    category: Optional[str] = None
    tasks: Optional[List[str]] = None
    deep_learning: Optional[bool] = None
    target_safe: Optional[bool] = None

class RecommendationRequest(BaseModel):
    dataset_version_id: str
    target: Optional[str] = None
    task: Literal[tuple(contracts.TASKS)] = "classification"  # type: ignore[valid-type]

class EvidenceRef(BaseModel):
    source_type: Literal["profile", "run", "execution", "rule", "dataset"]
    source_id: str
    summary: str

class RecommendationResponse(BaseModel):
    spec: Dict[str, Any]
    rule_ids: List[str]
    evidence_refs: List[EvidenceRef]

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

class PreprocessSpec(BaseModel):
    id: str
    version: int
    dataset_version_id: str
    steps: List[PreprocessStep]
    content_hash: str

class PreprocessSteps(BaseModel):
    steps: List[PreprocessStep]

class PreprocessSpecCreate(BaseModel):
    dataset_version_id: str
    spec: PreprocessSteps

class PreprocessValidateRequest(BaseModel):
    dataset_version_id: str
    spec: PreprocessSteps
    target: Optional[str] = None
    split_id: Optional[str] = None

class SpecPreviewRequest(BaseModel):
    split_id: Optional[str] = None

class ProfileRequest(BaseModel):
    dataset_version_id: Optional[str] = None

# Splits
class SplitSpec(BaseModel):
    strategy: Literal["random", "stratified", "group", "time"] = "stratified"
    test_ratio: float = Field(0.2, gt=0, lt=1)
    cv_folds: int = Field(5, ge=1)
    val_ratio: Optional[float] = Field(0.1, ge=0, lt=1)
    seed: int = 42
    target: Optional[str] = None  # requise selon le type de pipeline (règle V11 côté E4)
    group_column: Optional[str] = None
    time_column: Optional[str] = None
    text_column: Optional[str] = None
    image_column: Optional[str] = None
    user_column: Optional[str] = None
    item_column: Optional[str] = None

class SplitCreate(BaseModel):
    dataset_version_id: str
    split_spec: SplitSpec

class SplitTargetDistribution(BaseModel):
    label: str
    train: float  # share of the label within the train partition (0..1), as in the contract mock
    test: float

class SplitCounts(BaseModel):
    train: int
    validation: int
    test: int

class SplitVersion(BaseModel):
    id: str
    dataset_version_id: str
    split_spec: SplitSpec
    checksum: str
    counts: SplitCounts
    target_distribution: List[SplitTargetDistribution]


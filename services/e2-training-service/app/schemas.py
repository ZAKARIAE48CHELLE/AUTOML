from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel

Task = Literal["classification", "regression"]
JobStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]

class ModelSpec(BaseModel):
    id: str
    version: str
    family: str
    label: str
    task: List[Task]
    modality: Literal["tabular"] = "tabular"
    params_schema: Dict[str, Any]
    dependencies: List[str]
    determinism: Literal["exact", "tolerance"]
    deep_learning: Optional[bool] = False
    disabled: Optional[bool] = False

class TrainingResources(BaseModel):
    cpu: int
    gpu: int
    max_minutes: int
    concurrency: int
    budget_caps: Dict[str, int]

class TrainingValidateRequest(BaseModel):
    split_id: str
    preprocess_spec_id: str
    model_id: str
    params: Dict[str, Any]
    primary_metric: str
    budget: Optional[Dict[str, int]] = None

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

class TrainingJob(BaseModel):
    id: str
    status: JobStatus
    progress: float
    metrics: Optional[Dict[str, float]] = None
    logs_ref: Optional[str] = None
    run_id: Optional[str] = None
    error_code: Optional[str] = None
    message: Optional[str] = None
    model_id: str
    created_at: str

class StudyTrial(BaseModel):
    n: int
    value: float

class Study(BaseModel):
    id: str
    job_id: str
    status: JobStatus
    run_id: Optional[str] = None
    trials: List[StudyTrial]
    best_trial: Optional[StudyTrial] = None
    job: TrainingJob

class ArtifactRef(BaseModel):
    name: str
    kind: str
    checksum: str

class LearningCurvePoint(BaseModel):
    epoch: int
    train: float
    validation: float

class ExperimentRun(BaseModel):
    id: str
    project_id: str
    name: str
    model_id: str
    config_hash: str
    protocol_hash: str
    split_id: str
    preprocess_spec_id: str
    primary_metric: str
    params: Dict[str, Any]
    metrics: Dict[str, float]
    metrics_std: Optional[Dict[str, float]] = None
    test_metrics: Optional[Dict[str, float]] = None
    test_evaluated: bool = False
    artifacts: List[ArtifactRef] = []
    curve: Optional[List[LearningCurvePoint]] = None
    mlflow_run_id: str
    execution_id: Optional[str] = None
    workflow_version_id: Optional[str] = None
    created_at: str
    duration_s: float
    seed: int = 42

class CompareRequest(BaseModel):
    run_ids: List[str]

class LeaderboardEntry(BaseModel):
    run_id: str
    rank: int
    metrics: Dict[str, float]

class Leaderboard(BaseModel):
    protocol_hash: str
    primary_metric: str
    direction: Literal["maximize", "minimize"]
    entries: List[LeaderboardEntry]

class DatasetColumn(BaseModel):
    name: str
    dtype: str
    nullable: bool = False

class ModelVersion(BaseModel):
    id: str
    name: str
    version: int
    run_id: str
    alias: Optional[Literal["candidate", "staging", "production"]] = None
    artifact_ref: str
    created_at: str
    input_schema: Optional[List[DatasetColumn]] = None
    environment: Optional[List[str]] = None
    checksum: Optional[str] = None
    test_evaluated: bool = False
    workflow_version_id: Optional[str] = None

class ModelDetail(ModelVersion):
    run: ExperimentRun

class PredictRequest(BaseModel):
    model_version_id: str
    records: Optional[List[Dict[str, Any]]] = None
    dataset_version_id: Optional[str] = None

class PredictResult(BaseModel):
    predictions: List[Any]
    probabilities: Optional[List[List[float]]] = None
    classes: Optional[List[str]] = None
    schema_warnings: List[str] = []

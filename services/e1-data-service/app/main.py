import datetime
import uuid
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, Request, Response, UploadFile, File, Form, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from .database import check_db_health, init_db, get_db
from .models import UserModel, ProjectModel, DatasetModel, DatasetVersionModel
from .schemas import (
    ApiErrorDetail, AuthResponse, LoginRequest, RefreshRequest, RefreshResponse, UserInfo,
    Project, ProjectCreate, ProjectResponse,
    DatasetRow, DatasetDetail, DatasetVersion, DatasetColumn, DatasetImportResponse, Preview,
    DataProfile, DataProfileColumn, DataAlert,
    PreprocessTransform, RecommendationRequest, RecommendationResponse, PreprocessStep,
    ValidationReport, ValidationLayer, ValidationIssue, PreprocessSpec,
    SplitSpec, SplitVersion, SplitCounts, SplitTargetDistribution
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(
    title="AI Studio - E1 Data Intelligence Service",
    description="Microservice responsible for auth, projects, datasets, profiling, preprocessing, and splits",
    version="1.0.0",
    lifespan=lifespan
)

# Ensure tables and seed data are initialized immediately
init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom exception handler for uniform ApiError responses
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    code = "ERROR"
    if exc.status_code == 404: code = "NOT_FOUND"
    elif exc.status_code == 401: code = "UNAUTHORIZED"
    elif exc.status_code == 400: code = "BAD_REQUEST"
    elif exc.status_code == 422: code = "VALIDATION_ERROR"
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": code, "message": str(exc.detail), "details": None, "request_id": f"req_{uuid.uuid4().hex[:8]}"}
    )

# In-memory storage for demonstration & fast startup
DB = {
    "projects": [
        {"id": "p_churn", "name": "Churn Prediction Pro", "role": "owner", "created_at": "2026-11-05T10:00:00Z"}
    ],
    "datasets": [
        {"id": "ds_churn", "project_id": "p_churn", "name": "telco_churn.csv"}
    ],
    "versions": [
        {
            "id": "dsv_churn_v1",
            "dataset_id": "ds_churn",
            "project_id": "p_churn",
            "name": "telco_churn.csv",
            "version": 1,
            "checksum": "sha256:d8f72a4b8c9e",
            "schema": [
                {"name": "customer_id", "dtype": "string", "nullable": False},
                {"name": "tenure_months", "dtype": "int", "nullable": False},
                {"name": "monthly_charges", "dtype": "float", "nullable": True},
                {"name": "contract_type", "dtype": "category", "nullable": False},
                {"name": "churn", "dtype": "category", "nullable": False}
            ],
            "rows": 1000,
            "uri": "s3://datasets/p_churn/telco_churn.csv",
            "created_at": "2026-11-05T10:05:00Z",
            "status": "ready",
            "job_id": None
        }
    ],
    "rows": {
        "dsv_churn_v1": [
            {"customer_id": "CUST-001", "tenure_months": 12, "monthly_charges": 65.5, "contract_type": "Month-to-month", "churn": "Yes"},
            {"customer_id": "CUST-002", "tenure_months": 34, "monthly_charges": 89.2, "contract_type": "One year", "churn": "No"},
            {"customer_id": "CUST-003", "tenure_months": 2, "monthly_charges": 29.9, "contract_type": "Month-to-month", "churn": "Yes"},
            {"customer_id": "CUST-004", "tenure_months": 45, "monthly_charges": 42.3, "contract_type": "Two year", "churn": "No"},
            {"customer_id": "CUST-005", "tenure_months": 8, "monthly_charges": 75.0, "contract_type": "Month-to-month", "churn": "No"}
        ]
    },
    "specs": {},
    "splits": {}
}

# -------------------------------------------------------------
# Health Checks
# -------------------------------------------------------------
@app.get("/health/live", tags=["Health"])
def health_live():
    return {"status": "ok", "service": "e1-data-service", "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()}

@app.get("/health/ready", tags=["Health"])
def health_ready():
    db_health = check_db_health()
    is_ready = db_health.get("status") == "connected"
    return JSONResponse(
        status_code=200 if is_ready else 503,
        content={"status": "ready" if is_ready else "degraded", "service": "e1-data-service", "database": db_health}
    )

# -------------------------------------------------------------
# Auth Endpoints
# -------------------------------------------------------------
@app.post("/auth/login", response_model=AuthResponse, tags=["Auth"])
def login(req: LoginRequest, db: Session = Depends(get_db)):
    if not req.email or not req.password:
        raise HTTPException(status_code=400, detail="Email et mot de passe requis.")
    user = db.query(UserModel).filter(UserModel.email == req.email).first()
    if not user:
        user = UserModel(
            id=f"u_{uuid.uuid4().hex[:8]}",
            email=req.email,
            name=req.email.split("@")[0].capitalize(),
            role="owner"
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    return AuthResponse(
        access_token=f"jwt_access_{uuid.uuid4().hex[:12]}",
        refresh_token=f"jwt_refresh_{uuid.uuid4().hex[:12]}",
        user=UserInfo(id=user.id, name=user.name, email=user.email)
    )

@app.post("/auth/refresh", response_model=RefreshResponse, tags=["Auth"])
def refresh(req: RefreshRequest):
    return RefreshResponse(access_token=f"jwt_access_{uuid.uuid4().hex[:12]}")

# -------------------------------------------------------------
# Projects Endpoints (PostgreSQL CRUD)
# -------------------------------------------------------------
@app.get("/projects", response_model=List[Project], tags=["Projects"])
def list_projects(db: Session = Depends(get_db)):
    projects = db.query(ProjectModel).all()
    if not projects and DB.get("projects"):
        return [Project(**p) for p in DB["projects"]]
    return [
        Project(
            id=p.id,
            name=p.name,
            role=p.role or "owner",
            created_at=p.created_at.isoformat() if hasattr(p.created_at, "isoformat") else str(p.created_at)
        )
        for p in projects
    ]

@app.post("/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED, tags=["Projects"])
def create_project(req: ProjectCreate, db: Session = Depends(get_db)):
    p_id = f"p_{uuid.uuid4().hex[:8]}"
    now = datetime.datetime.now(datetime.timezone.utc)
    p = ProjectModel(id=p_id, name=req.name, role="owner", created_at=now)
    db.add(p)
    db.commit()
    db.refresh(p)
    # Also update in-memory DB for backwards compatibility
    DB["projects"].append({"id": p.id, "name": p.name, "role": p.role, "created_at": now.isoformat()})
    return ProjectResponse(
        project_id=p.id,
        id=p.id,
        name=p.name,
        role=p.role,
        created_at=p.created_at.isoformat()
    )

@app.get("/projects/{project_id}", tags=["Projects"])
def get_project(project_id: str, db: Session = Depends(get_db)):
    p = db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
    if not p:
        # fallback to in-memory
        p_mem = next((x for x in DB["projects"] if x["id"] == project_id), None)
        if not p_mem:
            raise HTTPException(status_code=404, detail=f"Projet introuvable : {project_id}")
        return {**p_mem, "members": [{"user_id": "u_dev1", "name": "Chelle Zakariae", "role": p_mem["role"]}]}
    return {
        "id": p.id,
        "name": p.name,
        "role": p.role,
        "created_at": p.created_at.isoformat() if hasattr(p.created_at, "isoformat") else str(p.created_at),
        "members": [{"user_id": "u_dev1", "name": "Chelle Zakariae", "role": p.role}]
    }

@app.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Projects"])
def delete_project(project_id: str, db: Session = Depends(get_db)):
    p = db.query(ProjectModel).filter(ProjectModel.id == project_id).first()
    if p:
        db.delete(p)
        db.commit()
    DB["projects"] = [x for x in DB["projects"] if x["id"] != project_id]
    return Response(status_code=status.HTTP_204_NO_CONTENT)

# -------------------------------------------------------------
# Datasets Endpoints (PostgreSQL CRUD)
# -------------------------------------------------------------
@app.get("/datasets", response_model=List[DatasetRow], tags=["Datasets"])
def list_datasets(project_id: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(DatasetModel)
    if project_id:
        query = query.filter(DatasetModel.project_id == project_id)
    datasets = query.all()
    if not datasets and DB.get("datasets"):
        results = []
        for d in DB["datasets"]:
            if project_id and d["project_id"] != project_id:
                continue
            versions = [v for v in DB["versions"] if v["dataset_id"] == d["id"]]
            last_v = versions[-1] if versions else None
            results.append(DatasetRow(
                id=d["id"],
                project_id=d["project_id"],
                name=d["name"],
                latest_version_id=last_v["id"] if last_v else None,
                rows=last_v["rows"] if last_v else 0,
                columns=len(last_v["schema"]) if last_v else 0,
                status=last_v["status"] if last_v else "ready",
                created_at=last_v["created_at"] if last_v else None
            ))
        return results

    results = []
    for d in datasets:
        last_v = db.query(DatasetVersionModel).filter(DatasetVersionModel.dataset_id == d.id).order_by(DatasetVersionModel.version.desc()).first()
        results.append(DatasetRow(
            id=d.id,
            project_id=d.project_id,
            name=d.name,
            latest_version_id=last_v.id if last_v else None,
            rows=last_v.num_rows if last_v else 0,
            columns=last_v.num_columns if last_v else 0,
            status=last_v.status if last_v else "ready",
            created_at=last_v.created_at.isoformat() if last_v and hasattr(last_v.created_at, "isoformat") else None
        ))
    return results

@app.post("/datasets", response_model=DatasetImportResponse, status_code=status.HTTP_202_ACCEPTED, tags=["Datasets"])
async def import_dataset(file: UploadFile = File(...), project_id: str = Form(...), db: Session = Depends(get_db)):
    ds_id = f"ds_{uuid.uuid4().hex[:8]}"
    v_id = f"dsv_{uuid.uuid4().hex[:8]}"
    job_id = f"job_{uuid.uuid4().hex[:8]}"
    now = datetime.datetime.now(datetime.timezone.utc)
    
    content = await file.read()
    text = content.decode("utf-8", errors="replace")
    lines = [l for l in text.splitlines() if l.strip()]
    
    schema_cols = []
    rows_data = []
    if lines:
        delimiter = ";" if ";" in lines[0] else ","
        header = [h.strip() for h in lines[0].split(delimiter)]
        data_lines = [l.split(delimiter) for l in lines[1:]]
        
        for i, col_name in enumerate(header):
            sample_vals = [r[i].strip() for r in data_lines if i < len(r)]
            nums = [v for v in sample_vals if v]
            is_num = all(v.replace(".", "", 1).isdigit() for v in nums) if nums else False
            dtype = "float" if is_num and any("." in v for v in nums) else ("int" if is_num else "string")
            schema_cols.append({"name": col_name, "dtype": dtype, "nullable": len(nums) < len(sample_vals)})
            
        for r in data_lines[:100]:
            row_dict = {}
            for i, h in enumerate(header):
                val = r[i].strip() if i < len(r) else None
                row_dict[h] = val
            rows_data.append(row_dict)
    else:
        schema_cols = [{"name": "col1", "dtype": "string", "nullable": False}]

    ds = DatasetModel(id=ds_id, project_id=project_id, name=file.filename, created_at=now)
    dv = DatasetVersionModel(
        id=v_id,
        dataset_id=ds_id,
        project_id=project_id,
        name=file.filename,
        version=1,
        checksum=f"sha256:{uuid.uuid4().hex[:12]}",
        schema_json=schema_cols,
        num_rows=max(len(lines) - 1, 0),
        num_columns=len(schema_cols),
        status="ready",
        uri=f"s3://datasets/{project_id}/{file.filename}",
        created_at=now
    )
    db.add(ds)
    db.add(dv)
    db.commit()

    DB["datasets"].append({"id": ds_id, "project_id": project_id, "name": file.filename})
    DB["versions"].append({
        "id": v_id,
        "dataset_id": ds_id,
        "project_id": project_id,
        "name": file.filename,
        "version": 1,
        "checksum": dv.checksum,
        "schema": schema_cols,
        "rows": dv.num_rows,
        "uri": dv.uri,
        "created_at": now.isoformat(),
        "status": "ready",
        "job_id": job_id
    })
    DB["rows"][v_id] = rows_data

    return DatasetImportResponse(dataset_id=ds_id, version_id=v_id, job_id=job_id)

@app.get("/datasets/{id}", response_model=DatasetDetail, tags=["Datasets"])
def get_dataset(id: str, db: Session = Depends(get_db)):
    d = db.query(DatasetModel).filter(DatasetModel.id == id).first()
    if not d:
        d_mem = next((x for x in DB["datasets"] if x["id"] == id), None)
        if not d_mem:
            raise HTTPException(status_code=404, detail=f"Dataset introuvable : {id}")
        versions = [DatasetVersion(**v) for v in DB["versions"] if v["dataset_id"] == id]
        return DatasetDetail(id=d_mem["id"], name=d_mem["name"], project_id=d_mem["project_id"], versions=versions)
    
    versions_db = db.query(DatasetVersionModel).filter(DatasetVersionModel.dataset_id == id).order_by(DatasetVersionModel.version.asc()).all()
    vers = []
    for v in versions_db:
        vers.append(DatasetVersion(
            id=v.id,
            dataset_id=v.dataset_id,
            project_id=v.project_id,
            name=v.name,
            version=v.version,
            checksum=v.checksum,
            schema=[DatasetColumn(**c) for c in (v.schema_json or [])],
            rows=v.num_rows,
            uri=v.uri or f"s3://datasets/{id}/{v.name}",
            created_at=v.created_at.isoformat() if hasattr(v.created_at, "isoformat") else str(v.created_at),
            status=v.status or "ready"
        ))
    return DatasetDetail(id=d.id, name=d.name, project_id=d.project_id, versions=vers)

@app.get("/datasets/{id}/preview", response_model=Preview, tags=["Datasets"])
def preview_dataset(id: str, dataset_version_id: Optional[str] = None, limit: int = 25, offset: int = 0):
    v = next((x for x in DB["versions"] if x["id"] == dataset_version_id or (not dataset_version_id and x["dataset_id"] == id)), None)
    if not v:
        raise HTTPException(status_code=404, detail="Version de dataset introuvable.")
    rows = DB["rows"].get(v["id"], [])
    paged = rows[offset:offset + limit]
    return Preview(
        dataset_version_id=v["id"],
        columns=[DatasetColumn(**c) for c in v["schema"]],
        rows=paged,
        total=len(rows),
        limit=limit,
        offset=offset
    )

@app.get("/datasets/{id}/profile", response_model=DataProfile, tags=["Datasets"])
@app.post("/datasets/{id}/profile", response_model=DataProfile, tags=["Datasets"])
def profile_dataset(id: str, dataset_version_id: Optional[str] = None):
    v = next((x for x in DB["versions"] if x["id"] == dataset_version_id or (not dataset_version_id and x["dataset_id"] == id)), None)
    if not v:
        raise HTTPException(status_code=404, detail="Version de dataset introuvable.")
    
    cols = []
    for c in v["schema"]:
        cols.append(DataProfileColumn(
            name=c["name"],
            dtype=c["dtype"],
            missing_pct=0.0 if not c.get("nullable") else 4.2,
            unique=min(v["rows"], 42),
            mean=45.2 if c["dtype"] in ("int", "float") else None,
            std=12.1 if c["dtype"] in ("int", "float") else None,
            min=1.0 if c["dtype"] in ("int", "float") else None,
            max=100.0 if c["dtype"] in ("int", "float") else None,
            top=[{"value": "Sample", "count": 20}] if c["dtype"] == "category" else None,
            histogram=[{"bin": "0-20", "count": 15}, {"bin": "20-40", "count": 25}] if c["dtype"] in ("int", "float") else None
        ))
        
    return DataProfile(
        dataset_version_id=v["id"],
        columns=cols,
        alerts=[
            DataAlert(code="ALERT_INFO", severity="info", column=None, message="Profilage automatique terminé sans anomalies majeures.")
        ],
        computed_by="e1-profiler-v1",
        rows=v["rows"],
        status="ready"
    )

# -------------------------------------------------------------
# Preprocessing Endpoints
# -------------------------------------------------------------
TRANSFORMS_CATALOG = [
    {"type": "impute_median", "label": "Imputation (médiane)", "applies_to": ["int", "float"], "params_schema": {"type": "object", "properties": {}}},
    {"type": "impute_mean", "label": "Imputation (moyenne)", "applies_to": ["int", "float"], "params_schema": {"type": "object", "properties": {}}},
    {"type": "impute_most_frequent", "label": "Imputation (valeur la plus fréquente)", "applies_to": ["int", "float", "category", "string", "bool"], "params_schema": {"type": "object", "properties": {}}},
    {"type": "onehot", "label": "Encodage one-hot", "applies_to": ["category", "string", "bool"], "params_schema": {"type": "object", "properties": {"max_categories": {"type": "integer", "default": 30}}}},
    {"type": "ordinal", "label": "Encodage ordinal", "applies_to": ["category", "string"], "params_schema": {"type": "object", "properties": {}}},
    {"type": "standard_scale", "label": "Standardisation", "applies_to": ["int", "float"], "params_schema": {"type": "object", "properties": {}}},
    {"type": "minmax_scale", "label": "Mise à l'échelle min-max", "applies_to": ["int", "float"], "params_schema": {"type": "object", "properties": {}}},
    {"type": "drop_columns", "label": "Exclure des colonnes", "applies_to": ["int", "float", "category", "string", "bool"], "params_schema": {"type": "object", "properties": {}}}
]

@app.get("/preprocessing/catalog", response_model=List[PreprocessTransform], tags=["Preprocessing"])
def get_preprocessing_catalog():
    return [PreprocessTransform(**t) for t in TRANSFORMS_CATALOG]

@app.post("/preprocessing/recommendations", response_model=RecommendationResponse, tags=["Preprocessing"])
def recommend_preprocessing(req: RecommendationRequest):
    v = next((x for x in DB["versions"] if x["id"] == req.dataset_version_id), None)
    if not v:
        raise HTTPException(status_code=404, detail="Version de dataset introuvable.")
    steps = [
        {"type": "drop_columns", "columns": [c["name"] for c in v["schema"] if c["name"].endswith("_id")]},
        {"type": "impute_median", "columns": [c["name"] for c in v["schema"] if c.get("nullable") and c["dtype"] in ("int", "float")]},
        {"type": "onehot", "columns": [c["name"] for c in v["schema"] if c["dtype"] in ("category", "string") and c["name"] != req.target and not c["name"].endswith("_id")]}
    ]
    # Filter out empty steps
    filtered_steps = [s for s in steps if s["columns"]]
    return RecommendationResponse(
        spec={"dataset_version_id": v["id"], "steps": filtered_steps},
        rule_ids=["R-ID-01", "R-IMP-01", "R-ENC-01"],
        evidence_refs=[
            {"source_type": "rule", "source_id": "R-ID-01", "summary": "Exclusion automatique des identifiants uniques"},
            {"source_type": "profile", "source_id": f"{v['id']}#missing", "summary": "Imputation des variables numériques avec valeurs manquantes"}
        ]
    )

@app.post("/preprocessing/validate", response_model=ValidationReport, tags=["Preprocessing"])
def validate_preprocessing(req: Dict[str, Any]):
    return ValidationReport(
        subject={"kind": "PreprocessSpec", "id": req.get("dataset_version_id", "dsv_preview")},
        content_hash=f"sha256:{uuid.uuid4().hex[:12]}",
        status="ok",
        layers=[
            ValidationLayer(layer="data", status="ok", issues=[])
        ]
    )

@app.post("/preprocessing/specs", tags=["Preprocessing"])
def save_preprocessing_spec(req: Dict[str, Any]):
    spec_id = f"prep_{uuid.uuid4().hex[:8]}"
    dsv_id = req.get("dataset_version_id", "dsv_churn_v1")
    steps = req.get("spec", {}).get("steps", [])
    DB["specs"][spec_id] = {
        "id": spec_id,
        "version": 1,
        "dataset_version_id": dsv_id,
        "steps": steps,
        "content_hash": f"sha256:{uuid.uuid4().hex[:12]}"
    }
    return {"spec_id": spec_id, "version": 1, "content_hash": DB["specs"][spec_id]["content_hash"]}

@app.get("/preprocessing/specs", response_model=List[PreprocessSpec], tags=["Preprocessing"])
def list_preprocessing_specs(dataset_version_id: Optional[str] = None):
    results = []
    for s in DB["specs"].values():
        if not dataset_version_id or s["dataset_version_id"] == dataset_version_id:
            results.append(PreprocessSpec(**s))
    return results

@app.post("/preprocessing/specs/{spec_id}/preview", tags=["Preprocessing"])
def preview_spec(spec_id: str, req: Dict[str, Any]):
    return {
        "columns_before": 5,
        "columns_after": 7,
        "missing_before": [{"column": "monthly_charges", "pct": 4.2}],
        "missing_after": [],
        "sample": "5 lignes transformées prêtes pour entraînement"
    }

# -------------------------------------------------------------
# Splits Endpoints
# -------------------------------------------------------------
@app.post("/splits", response_model=Dict[str, str], tags=["Splits"])
def create_split(req: Dict[str, Any]):
    split_id = f"split_{uuid.uuid4().hex[:8]}"
    dsv_id = req.get("dataset_version_id", "dsv_churn_v1")
    spec_data = req.get("split_spec", {})
    checksum = f"sha256:{uuid.uuid4().hex[:12]}"
    
    DB["splits"][split_id] = {
        "id": split_id,
        "dataset_version_id": dsv_id,
        "split_spec": spec_data,
        "checksum": checksum,
        "counts": {"train": 700, "validation": 100, "test": 200},
        "target_distribution": [
            {"label": "No", "train": 510, "test": 150},
            {"label": "Yes", "train": 190, "test": 50}
        ]
    }
    return {"split_id": split_id, "checksum": checksum}

@app.get("/splits", response_model=List[SplitVersion], tags=["Splits"])
def list_splits(dataset_version_id: Optional[str] = None):
    results = []
    for s in DB["splits"].values():
        if not dataset_version_id or s["dataset_version_id"] == dataset_version_id:
            results.append(SplitVersion(**s))
    return results

@app.get("/splits/{id}", response_model=SplitVersion, tags=["Splits"])
def get_split(id: str):
    s = DB["splits"].get(id)
    if not s:
        raise HTTPException(status_code=404, detail=f"Split introuvable : {id}")
    return SplitVersion(**s)


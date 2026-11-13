import datetime
import hashlib
import json
import logging
import uuid
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException as StarletteHTTPException

from .database import check_db_health, get_db, init_db
from .models import (DatasetModel, DatasetVersionModel, PreprocessSpecModel, ProjectModel, SplitModel,
                     UserModel, utcnow)
from .schemas import (
    AuthResponse, LoginRequest, RefreshRequest, RefreshResponse, UserInfo,
    Project, ProjectCreate, ProjectResponse,
    DatasetRow, DatasetDetail, DatasetVersion, DatasetColumn, DatasetImportResponse, Preview,
    DataProfile, DataProfileColumn, DataAlert,
    PreprocessTransform, RecommendationRequest, RecommendationResponse,
    ValidationReport, ValidationLayer, ValidationIssue, PreprocessSpec, PreprocessSpecCreate,
    PreprocessValidateRequest, SpecPreviewRequest, ProfileRequest,
    SplitCreate, SplitVersion,
)
from .tabular import CsvError, build_profile, parse_csv, split_counts, target_distribution

logger = logging.getLogger(__name__)


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


# -------------------------------------------------------------
# Helpers
# -------------------------------------------------------------
def iso_utc(dt: Optional[datetime.datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def canonical_hash(obj: Any) -> str:
    dumped = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return f"sha256:{hashlib.sha256(dumped.encode('utf-8')).hexdigest()}"


def get_version_or_404(db: Session, version_id: str) -> DatasetVersionModel:
    v = db.get(DatasetVersionModel, version_id)
    if v is None:
        raise api_error(404, "NOT_FOUND", f"Version de dataset introuvable : {version_id}")
    return v


def resolve_version(db: Session, dataset_id: str, version_id: Optional[str]) -> DatasetVersionModel:
    """Requested version of a dataset, or its latest one. 404 when either does not exist or they mismatch."""
    if db.get(DatasetModel, dataset_id) is None:
        raise api_error(404, "NOT_FOUND", f"Dataset introuvable : {dataset_id}")
    if version_id:
        v = db.get(DatasetVersionModel, version_id)
        if v is None or v.dataset_id != dataset_id:
            raise api_error(404, "NOT_FOUND", f"Version {version_id} introuvable pour le dataset {dataset_id}.")
        return v
    v = (db.query(DatasetVersionModel).filter(DatasetVersionModel.dataset_id == dataset_id)
         .order_by(DatasetVersionModel.version.desc()).first())
    if v is None:
        raise api_error(404, "NOT_FOUND", f"Aucune version pour le dataset {dataset_id}.")
    return v


def version_to_schema(v: DatasetVersionModel) -> DatasetVersion:
    return DatasetVersion(
        id=v.id, dataset_id=v.dataset_id, project_id=v.project_id, name=v.name, version=v.version,
        checksum=v.checksum, schema=[DatasetColumn(**c) for c in (v.schema_json or [])], rows=v.num_rows or 0,
        uri=v.uri or "", created_at=iso_utc(v.created_at), status=v.status or "ready",
    )


def schema_by_name(v: DatasetVersionModel) -> Dict[str, Dict[str, Any]]:
    return {c["name"]: c for c in (v.schema_json or [])}


# -------------------------------------------------------------
# Health Checks
# -------------------------------------------------------------
@app.get("/health/live", tags=["Health"])
def health_live():
    return {"status": "ok", "service": "e1-data-service", "timestamp": iso_utc(utcnow())}


@app.get("/health/ready", tags=["Health"])
def health_ready():
    db_health = check_db_health()
    is_ready = db_health.get("status") == "connected"
    return JSONResponse(
        status_code=200 if is_ready else 503,
        content={"status": "ready" if is_ready else "degraded", "service": "e1-data-service", "database": db_health}
    )


# -------------------------------------------------------------
# Auth Endpoints (development stub: no password check, tokens are not verified yet)
# -------------------------------------------------------------
@app.post("/auth/login", response_model=AuthResponse, tags=["Auth"])
def login(req: LoginRequest, db: Session = Depends(get_db)):
    email = req.email.strip().lower()
    if not email or "@" not in email or not req.password:
        raise api_error(400, "BAD_REQUEST", "Email et mot de passe requis.")
    user = db.query(UserModel).filter(UserModel.email == email).first()
    if not user:
        user = UserModel(id=f"u_{uuid.uuid4().hex[:8]}", email=email,
                         name=email.split("@")[0].capitalize(), role="owner")
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
# Projects
# -------------------------------------------------------------
def project_to_schema(p: ProjectModel) -> Project:
    return Project(id=p.id, name=p.name, role=p.role or "owner", created_at=iso_utc(p.created_at))


@app.get("/projects", response_model=List[Project], tags=["Projects"])
def list_projects(db: Session = Depends(get_db)):
    return [project_to_schema(p) for p in db.query(ProjectModel).order_by(ProjectModel.created_at).all()]


@app.post("/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED, tags=["Projects"])
def create_project(req: ProjectCreate, db: Session = Depends(get_db)):
    name = req.name.strip()
    if not name:
        raise api_error(400, "BAD_REQUEST", "Le nom du projet est requis.")
    p = ProjectModel(id=f"p_{uuid.uuid4().hex[:8]}", name=name, role="owner")
    db.add(p)
    db.commit()
    db.refresh(p)
    return ProjectResponse(project_id=p.id, **project_to_schema(p).model_dump())


@app.get("/projects/{project_id}", tags=["Projects"])
def get_project(project_id: str, db: Session = Depends(get_db)):
    p = db.get(ProjectModel, project_id)
    if not p:
        raise api_error(404, "NOT_FOUND", f"Projet introuvable : {project_id}")
    # Project membership is not modelled yet: every known user is reported as a member.
    members = [{"user_id": u.id, "name": u.name, "role": u.role or "owner"} for u in db.query(UserModel).all()]
    return {**project_to_schema(p).model_dump(), "members": members}


@app.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Projects"])
def delete_project(project_id: str, db: Session = Depends(get_db)):
    p = db.get(ProjectModel, project_id)
    if p is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    # Delete children first: the foreign keys have no ON DELETE CASCADE.
    ds_ids = [d.id for d in db.query(DatasetModel.id).filter(DatasetModel.project_id == project_id)]
    if ds_ids:
        v_ids = [v.id for v in db.query(DatasetVersionModel.id).filter(DatasetVersionModel.dataset_id.in_(ds_ids))]
        if v_ids:
            db.query(SplitModel).filter(SplitModel.dataset_version_id.in_(v_ids)).delete(synchronize_session=False)
            db.query(PreprocessSpecModel).filter(PreprocessSpecModel.dataset_version_id.in_(v_ids)).delete(synchronize_session=False)
            db.query(DatasetVersionModel).filter(DatasetVersionModel.id.in_(v_ids)).delete(synchronize_session=False)
        db.query(DatasetModel).filter(DatasetModel.id.in_(ds_ids)).delete(synchronize_session=False)
    db.delete(p)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# -------------------------------------------------------------
# Datasets
# -------------------------------------------------------------
@app.get("/datasets", response_model=List[DatasetRow], tags=["Datasets"])
def list_datasets(project_id: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(DatasetModel)
    if project_id:
        query = query.filter(DatasetModel.project_id == project_id)
    results = []
    for d in query.order_by(DatasetModel.created_at).all():
        last_v = (db.query(DatasetVersionModel).filter(DatasetVersionModel.dataset_id == d.id)
                  .order_by(DatasetVersionModel.version.desc()).first())
        results.append(DatasetRow(
            id=d.id, project_id=d.project_id, name=d.name,
            latest_version_id=last_v.id if last_v else None,
            rows=last_v.num_rows if last_v else 0,
            columns=last_v.num_columns if last_v else 0,
            status=last_v.status if last_v else "ready",
            created_at=iso_utc(last_v.created_at if last_v else d.created_at),
        ))
    return results


@app.post("/datasets", response_model=DatasetImportResponse, status_code=status.HTTP_202_ACCEPTED, tags=["Datasets"])
async def import_dataset(file: UploadFile = File(...), project_id: str = Form(...), db: Session = Depends(get_db)):
    if db.get(ProjectModel, project_id) is None:
        raise api_error(404, "NOT_FOUND", f"Projet introuvable : {project_id}")
    filename = (file.filename or "").strip()
    if not filename:
        raise api_error(400, "BAD_REQUEST", "Nom de fichier manquant.")
    try:
        parsed = await run_in_threadpool(parse_csv, file.file)
    except CsvError as e:
        raise api_error(400, "INVALID_CSV", str(e))
    except Exception as e:  # malformed CSV (csv.Error, field too large, ...)
        raise api_error(400, "INVALID_CSV", f"Fichier CSV illisible : {e}")

    ds_id = f"ds_{uuid.uuid4().hex[:8]}"
    v_id = f"dsv_{uuid.uuid4().hex[:8]}"
    job_id = f"job_{uuid.uuid4().hex[:8]}"
    db.add(DatasetModel(id=ds_id, project_id=project_id, name=filename))
    db.flush()
    db.add(DatasetVersionModel(
        id=v_id, dataset_id=ds_id, project_id=project_id, name=filename, version=1,
        checksum=parsed["checksum"], schema_json=parsed["schema"], preview_rows=parsed["rows"],
        num_rows=parsed["total_rows"], num_columns=len(parsed["schema"]), status="ready",
        uri=f"s3://datasets/{project_id}/{ds_id}/{filename}",
    ))
    db.commit()
    return DatasetImportResponse(dataset_id=ds_id, version_id=v_id, job_id=job_id)


@app.get("/dataset-versions/{version_id}", response_model=DatasetVersion, tags=["Datasets"])
def get_dataset_version(version_id: str, db: Session = Depends(get_db)):
    """Schéma et projet d'une version : utilisé par E3/E4 pour construire des pipelines typés."""
    return version_to_schema(get_version_or_404(db, version_id))


@app.get("/datasets/{id}", response_model=DatasetDetail, tags=["Datasets"])
def get_dataset(id: str, db: Session = Depends(get_db)):
    d = db.get(DatasetModel, id)
    if not d:
        raise api_error(404, "NOT_FOUND", f"Dataset introuvable : {id}")
    versions = (db.query(DatasetVersionModel).filter(DatasetVersionModel.dataset_id == id)
                .order_by(DatasetVersionModel.version.asc()).all())
    return DatasetDetail(id=d.id, name=d.name, project_id=d.project_id, versions=[version_to_schema(v) for v in versions])


@app.get("/datasets/{id}/preview", response_model=Preview, tags=["Datasets"])
def preview_dataset(id: str, dataset_version_id: Optional[str] = None, limit: int = 25, offset: int = 0,
                    db: Session = Depends(get_db)):
    v = resolve_version(db, id, dataset_version_id)
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    rows = v.preview_rows or []
    return Preview(
        dataset_version_id=v.id,
        columns=[DatasetColumn(**c) for c in (v.schema_json or [])],
        rows=rows[offset:offset + limit],
        total=len(rows),  # size of the stored preview sample (see DatasetVersion.rows for the full count)
        limit=limit,
        offset=offset,
    )


def _profile(v: DatasetVersionModel) -> DataProfile:
    rows = v.preview_rows or []
    prof = build_profile(v.schema_json or [], rows, v.num_rows or len(rows))
    computed_by = "e1-profiler-1.0" + (f" (échantillon de {len(rows)} lignes)" if prof["sampled"] else "")
    return DataProfile(
        dataset_version_id=v.id,
        columns=[DataProfileColumn(**c) for c in prof["columns"]],
        alerts=[DataAlert(**a) for a in prof["alerts"]],
        computed_by=computed_by,
        rows=v.num_rows or 0,
        status="ready",
    )


@app.get("/datasets/{id}/profile", response_model=DataProfile, tags=["Datasets"])
def get_profile(id: str, dataset_version_id: Optional[str] = None, db: Session = Depends(get_db)):
    return _profile(resolve_version(db, id, dataset_version_id))


@app.post("/datasets/{id}/profile", response_model=DataProfile, tags=["Datasets"])
def start_profile(id: str, dataset_version_id: Optional[str] = None,
                  req: Optional[ProfileRequest] = Body(None), db: Session = Depends(get_db)):
    # The web client sends the version in the JSON body; also accept it as a query parameter.
    version_id = (req.dataset_version_id if req else None) or dataset_version_id
    return _profile(resolve_version(db, id, version_id))


# -------------------------------------------------------------
# Preprocessing
# -------------------------------------------------------------
from .contracts import contracts

# Catalogue des transformations : source unique, le contrat partagé (tous types de pipeline).
TRANSFORMS_CATALOG = contracts.PREPROCESS_STEPS
TRANSFORMS_BY_TYPE = {t["type"]: t for t in TRANSFORMS_CATALOG}


@app.get("/preprocessing/catalog", response_model=List[PreprocessTransform], tags=["Preprocessing"])
def get_preprocessing_catalog():
    return [PreprocessTransform(**t) for t in TRANSFORMS_CATALOG]


def _id_like(v: DatasetVersionModel, profile_cols: Dict[str, Dict[str, Any]]) -> List[str]:
    """Identifier columns: named *_id / id, or text columns whose sampled values are all distinct."""
    sample_size = len(v.preview_rows or [])
    out = []
    for c in v.schema_json or []:
        n = c["name"]
        pc = profile_cols.get(n, {})
        all_distinct = (c["dtype"] in ("string", "category") and sample_size > 1
                        and pc.get("missing_pct", 0) == 0 and pc.get("unique") == sample_size)
        if n.lower() == "id" or n.lower().endswith("_id") or all_distinct:
            out.append(n)
    return out


def _profile_cols(v: DatasetVersionModel) -> Dict[str, Dict[str, Any]]:
    return {c["name"]: c for c in build_profile(v.schema_json or [], v.preview_rows or [], v.num_rows or 0)["columns"]}


@app.post("/preprocessing/recommendations", response_model=RecommendationResponse, tags=["Preprocessing"])
def recommend_preprocessing(req: RecommendationRequest, db: Session = Depends(get_db)):
    v = get_version_or_404(db, req.dataset_version_id)
    cols = schema_by_name(v)
    if req.target and req.target not in cols:
        raise api_error(400, "TARGET_NOT_FOUND", f"Colonne cible absente du dataset : {req.target}")
    if req.task not in ("classification", "regression"):
        # Autres types : gabarit du catalogue partagé, résolu sur les colonnes et rôles du dataset.
        schema = v.schema_json or []
        roles = contracts.guess_roles(schema, req.task, req.target)
        steps = contracts.template_steps(schema, req.task, roles)
        label = contracts.pipeline_type(req.task)["label"]
        return RecommendationResponse(
            spec={"dataset_version_id": v.id, "steps": steps},
            rule_ids=[f"R-TPL-{req.task}"],
            evidence_refs=[{"source_type": "rule", "source_id": f"R-TPL-{req.task}",
                            "summary": f"Gabarit {label} : {', '.join(s['type'] for s in steps) or 'aucune étape'}"}],
        )
    if not req.target:
        raise api_error(400, "TARGET_REQUIRED", "Colonne cible requise pour ce type de pipeline.")
    ids = [n for n in _id_like(v, _profile_cols(v)) if n != req.target]
    features = [c for c in (v.schema_json or []) if c["name"] != req.target and c["name"] not in ids]
    steps = [
        {"type": "drop_columns", "columns": ids},
        {"type": "impute_median", "columns": [c["name"] for c in features if c["dtype"] in ("int", "float") and c.get("nullable")]},
        {"type": "impute_most_frequent", "columns": [c["name"] for c in features if c["dtype"] in ("category", "string", "bool") and c.get("nullable")]},
        {"type": "onehot", "columns": [c["name"] for c in features if c["dtype"] in ("category", "string", "bool")]},
    ]
    filtered = [s for s in steps if s["columns"]]
    return RecommendationResponse(
        spec={"dataset_version_id": v.id, "steps": filtered},
        rule_ids=["R-ID-01", "R-IMP-01", "R-ENC-01"],
        evidence_refs=[
            {"source_type": "rule", "source_id": "R-ID-01", "summary": "Exclusion automatique des identifiants uniques"},
            {"source_type": "profile", "source_id": f"{v.id}#missing", "summary": "Imputation des variables avec valeurs manquantes"},
        ],
    )


def _validate_steps(db: Session, v: DatasetVersionModel, steps: List[Dict[str, Any]],
                    target: Optional[str], split_id: Optional[str]) -> List[ValidationIssue]:
    cols = schema_by_name(v)
    issues: List[ValidationIssue] = []
    for i, s in enumerate(steps):
        t = TRANSFORMS_BY_TYPE.get(s.get("type"))
        if t is None:
            issues.append(ValidationIssue(code="PP_UNKNOWN_TRANSFORM", severity="error", path=f"steps[{i}].type",
                                          message=f"Transformation inconnue : {s.get('type')}"))
            continue
        for c in s.get("columns") or []:
            if c not in cols:
                issues.append(ValidationIssue(code="PP_UNKNOWN_COLUMN", severity="error", path=f"steps[{i}].columns",
                                              message=f"Colonne inconnue : {c}"))
            elif cols[c]["dtype"] not in t["applies_to"]:
                issues.append(ValidationIssue(code="PP_DTYPE_MISMATCH", severity="error", path=f"steps[{i}].columns",
                                              message=f"{t['label']} ne s'applique pas à {c} ({cols[c]['dtype']}).",
                                              hint=f"Types acceptés : {', '.join(t['applies_to'])}"))
            if target and c == target and t["type"] != "drop_columns" and not t.get("target_safe"):
                issues.append(ValidationIssue(code="PP_TARGET_TRANSFORMED", severity="error", path=f"steps[{i}].columns",
                                              message=f"La cible {target} ne doit pas être transformée (fuite de données)."))
        if not s.get("columns"):
            issues.append(ValidationIssue(code="PP_EMPTY_STEP", severity="warning", path=f"steps[{i}].columns",
                                          message=f"Aucune colonne sélectionnée pour {t['label']}."))
    if target and any(s.get("type") == "drop_columns" and target in (s.get("columns") or []) for s in steps):
        issues.append(ValidationIssue(code="PP_TARGET_DROPPED", severity="error", message=f"La cible {target} est exclue."))
    if target and target not in cols:
        issues.append(ValidationIssue(code="PP_UNKNOWN_TARGET", severity="error", message=f"Colonne cible inconnue : {target}"))
    if split_id:
        sp = db.get(SplitModel, split_id)
        if sp is None or sp.dataset_version_id != v.id:
            issues.append(ValidationIssue(code="PP_SPLIT_MISMATCH", severity="error",
                                          message=f"Split {split_id} introuvable pour cette version de dataset."))
    return issues


def _layer_status(issues: List[ValidationIssue]) -> str:
    if any(i.severity == "error" for i in issues):
        return "error"
    if any(i.severity == "warning" for i in issues):
        return "warning"
    return "ok"


@app.post("/preprocessing/validate", response_model=ValidationReport, tags=["Preprocessing"])
def validate_preprocessing(req: PreprocessValidateRequest, db: Session = Depends(get_db)):
    v = get_version_or_404(db, req.dataset_version_id)
    steps = [s.model_dump(exclude_none=True) for s in req.spec.steps]
    issues = _validate_steps(db, v, steps, req.target, req.split_id)
    st = _layer_status(issues)
    return ValidationReport(
        subject={"kind": "PreprocessSpec", "id": v.id},
        content_hash=canonical_hash(steps),
        status=st,
        layers=[ValidationLayer(layer="data", status=st, issues=issues)],
        created_at=iso_utc(utcnow()),
    )


def spec_to_schema(s: PreprocessSpecModel) -> PreprocessSpec:
    return PreprocessSpec(id=s.id, version=s.version, dataset_version_id=s.dataset_version_id,
                          steps=s.steps or [], content_hash=s.content_hash)


@app.post("/preprocessing/specs", status_code=status.HTTP_201_CREATED, tags=["Preprocessing"])
def save_preprocessing_spec(req: PreprocessSpecCreate, db: Session = Depends(get_db)):
    v = get_version_or_404(db, req.dataset_version_id)
    steps = [s.model_dump(exclude_none=True) for s in req.spec.steps]
    errors = [i for i in _validate_steps(db, v, steps, None, None) if i.severity == "error"]
    if errors:
        raise api_error(400, "SPEC_INVALID", errors[0].message, [i.model_dump() for i in errors])
    chash = canonical_hash(steps)
    existing = (db.query(PreprocessSpecModel)
                .filter(PreprocessSpecModel.dataset_version_id == v.id, PreprocessSpecModel.content_hash == chash).first())
    if existing:
        return {"spec_id": existing.id, "version": existing.version, "content_hash": existing.content_hash}
    n = db.query(PreprocessSpecModel).filter(PreprocessSpecModel.dataset_version_id == v.id).count() + 1
    s = PreprocessSpecModel(id=f"prep_{uuid.uuid4().hex[:8]}", dataset_version_id=v.id, version=n,
                            steps=steps, content_hash=chash)
    db.add(s)
    db.commit()
    return {"spec_id": s.id, "version": s.version, "content_hash": s.content_hash}


@app.get("/preprocessing/specs", response_model=List[PreprocessSpec], tags=["Preprocessing"])
def list_preprocessing_specs(dataset_version_id: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(PreprocessSpecModel)
    if dataset_version_id:
        q = q.filter(PreprocessSpecModel.dataset_version_id == dataset_version_id)
    return [spec_to_schema(s) for s in q.order_by(PreprocessSpecModel.created_at).all()]


@app.get("/preprocessing/specs/{spec_id}", response_model=PreprocessSpec, tags=["Preprocessing"])
def get_preprocessing_spec(spec_id: str, db: Session = Depends(get_db)):
    s = db.get(PreprocessSpecModel, spec_id)
    if s is None:
        raise api_error(404, "NOT_FOUND", f"Spécification introuvable : {spec_id}")
    return spec_to_schema(s)


@app.post("/preprocessing/specs/{spec_id}/preview", tags=["Preprocessing"])
def preview_spec(spec_id: str, req: Optional[SpecPreviewRequest] = Body(None), db: Session = Depends(get_db)):
    s = db.get(PreprocessSpecModel, spec_id)
    if s is None:
        raise api_error(404, "NOT_FOUND", f"Spécification introuvable : {spec_id}")
    split_id = req.split_id if req else None
    if split_id:
        sp = db.get(SplitModel, split_id)
        if sp is None or sp.dataset_version_id != s.dataset_version_id:
            raise api_error(404, "NOT_FOUND", f"Split introuvable : {split_id}")
    v = get_version_or_404(db, s.dataset_version_id)
    prof = _profile_cols(v)
    steps = s.steps or []

    def cols_of(prefix: str) -> List[str]:
        return [c for st in steps if st.get("type", "").startswith(prefix) for c in (st.get("columns") or [])]

    dropped, imputed = set(cols_of("drop_columns")), set(cols_of("impute"))
    onehot = [c for c in dict.fromkeys(cols_of("onehot")) if c not in dropped]
    before = len(v.schema_json or [])
    after = before - len(dropped) - len(onehot) + sum(prof.get(c, {}).get("unique", 1) for c in onehot)
    missing_before = [{"column": n, "pct": c["missing_pct"]} for n, c in prof.items() if c["missing_pct"] > 0]
    missing_after = [m for m in missing_before if m["column"] not in imputed and m["column"] not in dropped]
    return {
        "split_id": split_id,
        "columns_before": before,
        "columns_after": after,
        "missing_before": missing_before,
        "missing_after": missing_after,
        "sample": f"{len(v.preview_rows or [])} lignes d'échantillon",
    }


# -------------------------------------------------------------
# Splits
# -------------------------------------------------------------
def split_to_schema(s: SplitModel) -> SplitVersion:
    return SplitVersion(id=s.id, dataset_version_id=s.dataset_version_id, split_spec=s.split_spec,
                        checksum=s.checksum, counts=s.counts, target_distribution=s.target_distribution)


@app.post("/splits", status_code=status.HTTP_201_CREATED, response_model=Dict[str, str], tags=["Splits"])
def create_split(req: SplitCreate, db: Session = Depends(get_db)):
    v = get_version_or_404(db, req.dataset_version_id)
    spec = req.split_spec
    cols = schema_by_name(v)
    if spec.target and spec.target not in cols:
        raise api_error(400, "SPLIT_INVALID", f"Colonne cible absente du dataset : {spec.target}")
    if spec.strategy == "stratified" and not spec.target:
        raise api_error(400, "SPLIT_INVALID", "Un split stratifié exige une colonne cible.")
    for role in ("text_column", "image_column", "user_column", "item_column"):
        col = getattr(spec, role)
        if col and col not in cols:
            raise api_error(400, "SPLIT_INVALID", f"Colonne {role} absente du dataset : {col}")
    if spec.strategy == "group" and (not spec.group_column or spec.group_column not in cols):
        raise api_error(400, "SPLIT_INVALID", "La stratégie « group » exige une group_column existante.")
    if spec.strategy == "time" and (not spec.time_column or spec.time_column not in cols):
        raise api_error(400, "SPLIT_INVALID", "La stratégie « time » exige une time_column existante.")
    spec_dict = spec.model_dump(exclude_none=True)
    counts = split_counts(v.num_rows or 0, spec.test_ratio, spec.cv_folds, spec.val_ratio)
    if counts["train"] <= 0 or counts["test"] <= 0:
        raise api_error(400, "SPLIT_INVALID", "Pas assez de lignes pour ce découpage.", counts)
    dist = target_distribution(v.preview_rows or [], spec.target, spec.test_ratio, spec.seed,
                               stratified=spec.strategy == "stratified") if spec.target else []
    checksum = canonical_hash({"dataset_checksum": v.checksum, "split_spec": spec_dict})
    existing = db.query(SplitModel).filter(SplitModel.dataset_version_id == v.id, SplitModel.checksum == checksum).first()
    if existing:
        return {"split_id": existing.id, "checksum": existing.checksum}
    s = SplitModel(id=f"split_{uuid.uuid4().hex[:8]}", dataset_version_id=v.id, split_spec=spec_dict,
                   checksum=checksum, counts=counts, target_distribution=dist)
    db.add(s)
    db.commit()
    return {"split_id": s.id, "checksum": s.checksum}


@app.get("/splits", response_model=List[SplitVersion], tags=["Splits"])
def list_splits(dataset_version_id: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(SplitModel)
    if dataset_version_id:
        q = q.filter(SplitModel.dataset_version_id == dataset_version_id)
    return [split_to_schema(s) for s in q.order_by(SplitModel.created_at).all()]


@app.get("/splits/{id}", response_model=SplitVersion, tags=["Splits"])
def get_split(id: str, db: Session = Depends(get_db)):
    s = db.get(SplitModel, id)
    if not s:
        raise api_error(404, "NOT_FOUND", f"Split introuvable : {id}")
    return split_to_schema(s)

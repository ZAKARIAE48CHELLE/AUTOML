"""
FastAPI Server for AutoML Multi-Project Interactive Interface
Exposes REST endpoints and serves the unified web dashboard.
"""

import os
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any

from integration_hub import (
    PROJECTS_META,
    get_dataset,
    execute_pipeline,
    predict_interactive,
    get_manual_content,
    get_selection_process,
    arbitrate_automl_choice,
    BASE_DIR
)

app = FastAPI(
    title="AutoML Multi-Paradigm Studio",
    description="Interactive platform integrating 8 AutoML paradigms from the AutoML Architecture Guide.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = os.path.join(BASE_DIR, "static")
os.makedirs(STATIC_DIR, exist_ok=True)


class PredictRequest(BaseModel):
    inputs: Dict[str, Any]


class ArbitrateRequest(BaseModel):
    priority: str = "accuracy"
    env: str = "python"
    max_latency_ms: float = 50.0
    requires_audit: bool = False
    budget_tight: bool = False


@app.get("/api/projects")
def list_projects():
    """Lists all 8 projects with paradigms, creators, badges, and default inputs."""
    return {"projects": list(PROJECTS_META.values())}


@app.get("/api/project/{project_id}")
def get_project_details(project_id: str):
    if project_id not in PROJECTS_META:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"project": PROJECTS_META[project_id]}


@app.get("/api/project/{project_id}/dataset")
def fetch_dataset(project_id: str, n_samples: int = 500):
    try:
        return get_dataset(project_id, n_samples=n_samples)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/project/{project_id}/pipeline")
def run_pipeline(project_id: str):
    try:
        results = execute_pipeline(project_id)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/project/{project_id}/predict")
def run_prediction(project_id: str, req: PredictRequest):
    try:
        result = predict_interactive(project_id, req.inputs)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/project/{project_id}/manual")
def fetch_manual(project_id: str):
    content = get_manual_content(project_id)
    return {"project_id": project_id, "manual": content}


@app.get("/api/project/{project_id}/selection-process")
def fetch_selection_process(project_id: str):
    try:
        return get_selection_process(project_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/arbitrate-framework")
def run_framework_arbitration(req: ArbitrateRequest):
    try:
        return arbitrate_automl_choice(req.model_dump())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/master-manual")
def fetch_master_manual():
    master_path = os.path.join(BASE_DIR, "MASTER_AUTOML_MANUAL.md")
    if os.path.exists(master_path):
        with open(master_path, "r", encoding="utf-8") as f:
            return {"manual": f.read()}
    return {"manual": "# Master Manual Not Found"}


@app.get("/", response_class=HTMLResponse)
def index_page():
    index_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_file):
        with open(index_file, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>AutoML Interface is building...</h1>"


# Mount static assets if present
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


if __name__ == "__main__":
    print("=" * 60)
    print("Starting AutoML Multi-Paradigm Interactive Interface on http://localhost:8000")
    print("=" * 60)
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=False)

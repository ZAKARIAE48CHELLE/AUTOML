import importlib
import os
import sys
from pathlib import Path
from fastapi.testclient import TestClient

root_dir = Path(__file__).resolve().parent.parent

def load_service(service_name: str):
    # Unload any previously loaded 'app' module
    to_delete = [m for m in sys.modules if m == "app" or m.startswith("app.")]
    for m in to_delete:
        del sys.modules[m]
    
    service_path = str(root_dir / "services" / service_name)
    # Remove all service directories from sys.path
    sys.path = [p for p in sys.path if not any(s in p for s in ["e1-data-service", "e2-training-service", "e3-assistant-service", "e4-studio-service"])]
    sys.path.insert(0, service_path)
    
    app_module = importlib.import_module("app.main")
    return app_module.app

def test_e1_data_service():
    app = load_service("e1-data-service")
    client = TestClient(app)
    
    # Health
    r = client.get("/health/live")
    assert r.status_code == 200
    assert r.json()["service"] == "e1-data-service"

    r_ready = client.get("/health/ready")
    assert r_ready.status_code == 200
    assert r_ready.json()["database"]["status"] == "connected"
    
    # Auth
    r = client.post("/auth/login", json={"email": "zakariae@emsi.ma", "password": "password123"})
    assert r.status_code == 200
    assert "access_token" in r.json()
    assert r.json()["user"]["email"] == "zakariae@emsi.ma"
    
    # Projects
    r = client.get("/projects")
    assert r.status_code == 200
    assert len(r.json()) > 0
    
    # Datasets
    r = client.get("/datasets")
    assert r.status_code == 200
    assert len(r.json()) > 0
    ds_id = r.json()[0]["id"]
    
    # Preview & Profile
    r = client.get(f"/datasets/{ds_id}/preview")
    assert r.status_code == 200
    assert "columns" in r.json()
    
    r = client.get(f"/datasets/{ds_id}/profile")
    assert r.status_code == 200
    assert r.json()["status"] == "ready"
    
    # Preprocessing
    r = client.get("/preprocessing/catalog")
    assert r.status_code == 200
    assert len(r.json()) >= 6
    
    r = client.post("/preprocessing/recommendations", json={
        "dataset_version_id": "dsv_churn_v1",
        "target": "churn",
        "task": "classification"
    })
    assert r.status_code == 200
    assert "spec" in r.json()

def test_e2_training_service():
    app = load_service("e2-training-service")
    client = TestClient(app)
    
    # Health
    r = client.get("/health/live")
    assert r.status_code == 200
    assert r.json()["service"] == "e2-training-service"

    r_ready = client.get("/health/ready")
    assert r_ready.status_code == 200
    assert r_ready.json()["database"]["status"] == "connected"
    
    # Catalog
    r = client.get("/models/catalog")
    assert r.status_code == 200
    assert len(r.json()) >= 3
    
    # Resources
    r = client.get("/training/resources")
    assert r.status_code == 200
    assert r.json()["concurrency"] > 0
    
    # Experiments
    r = client.get("/experiments")
    assert r.status_code == 200
    assert len(r.json()) > 0
    
    # Inference
    r = client.post("/inference/predict", json={
        "model_version_id": "mv_xgb_prod",
        "records": [{"tenure_months": 24, "monthly_charges": 55.0, "contract_type": "One year"}]
    })
    assert r.status_code == 200
    assert len(r.json()["predictions"]) == 1

def test_e3_assistant_service():
    app = load_service("e3-assistant-service")
    client = TestClient(app)
    
    # Health
    r = client.get("/health/live")
    assert r.status_code == 200
    assert r.json()["service"] == "e3-assistant-service"

    r_ready = client.get("/health/ready")
    assert r_ready.status_code == 200
    assert r_ready.json()["database"]["status"] == "connected"
    
    # Messages
    r = client.get("/assistant/messages?project_id=p_churn")
    assert r.status_code == 200
    assert len(r.json()) > 0
    
    # Goal parsing
    r = client.post("/assistant/goals/parse", json={
        "text": "Prédire le churn des clients avec XGBoost",
        "dataset_version_id": "dsv_churn_v1"
    })
    assert r.status_code == 200
    assert r.json()["goal"]["task"] == "classification"
    assert r.json()["goal"]["target"] == "churn"
    
    # Policy Matrix
    r = client.get("/policy/matrix")
    assert r.status_code == 200
    assert len(r.json()["classes"]) == 4

def test_e4_studio_service():
    app = load_service("e4-studio-service")
    from app.schemas import compute_canonical_hash
    client = TestClient(app)
    
    # Health
    r = client.get("/health/live")
    assert r.status_code == 200
    assert r.json()["service"] == "e4-studio-service"

    r_ready = client.get("/health/ready")
    assert r_ready.status_code == 200
    assert r_ready.json()["database"]["status"] == "connected"
    
    # Node types
    r = client.get("/catalog/node-types")
    assert r.status_code == 200
    assert len(r.json()["node_types"]) == 8
    
    # Templates
    r = client.get("/catalog/templates")
    assert r.status_code == 200
    assert len(r.json()) >= 2
    
    # Workflows
    r = client.get("/workflows")
    assert r.status_code == 200
    assert len(r.json()) > 0
    
    # Canonical hash determinism
    spec_a = {"nodes": [{"id": "n1", "ui": {"x": 10, "y": 20}}], "edges": [], "metadata": {}}
    spec_b = {"nodes": [{"id": "n1", "ui": {"x": 999, "y": 888}}], "edges": [], "metadata": {}}
    assert compute_canonical_hash(spec_a) == compute_canonical_hash(spec_b)
    
    # Validation
    r = client.post("/workflows/wf_churn_01/versions/wfv_01/validate")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    
    # Approvals & Executions
    r = client.get("/approvals")
    assert r.status_code == 200
    
    r = client.post("/executions", json={
        "workflow_version_id": "wfv_01",
        "approval_ids": ["appr_01"]
    })
    assert r.status_code == 200
    assert "execution_id" in r.json()

if __name__ == "__main__":
    print("Running E1 Data Service tests...")
    test_e1_data_service()
    print("PASS: E1 Data Service")
    
    print("Running E2 Training Service tests...")
    test_e2_training_service()
    print("PASS: E2 Training Service")
    
    print("Running E3 Assistant Service tests...")
    test_e3_assistant_service()
    print("PASS: E3 Assistant Service")
    
    print("Running E4 Studio Service tests...")
    test_e4_studio_service()
    print("PASS: E4 Studio Service")
    
    print("\nALL 4 MICROSERVICES PASSED VERIFICATION!")

"""Pipeline types (classification … recommendation) across the shared contract and the services.

The Python contract module mirrors packages/contracts/src/pipelines.ts: these tests pin the behaviour
the web client relies on (templates are valid, V11 catches inconsistent pipelines).
"""
import importlib.util
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from test_microservices import service  # noqa: F401  (fixture: loads one service on a temporary SQLite DB)

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("aistudio_contracts", ROOT / "packages" / "contracts" / "py" / "aistudio_contracts.py")
C = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(C)

col = lambda name, dtype, nullable=False: {"name": name, "dtype": dtype, "nullable": nullable}  # noqa: E731
SCHEMAS = {
    "classification": [col("customer_id", "string"), col("age", "int", True), col("plan", "category"), col("churn", "category")],
    "regression": [col("surface_m2", "float"), col("district", "category"), col("price", "float")],
    "clustering": [col("customer_id", "string"), col("annual_income_k", "float"), col("spending_score", "int"), col("region", "category")],
    "anomaly_detection": [col("tx_id", "string"), col("amount", "float"), col("hour", "int"), col("is_fraud", "bool")],
    "forecasting": [col("date", "datetime"), col("sales", "float"), col("promo", "bool")],
    "text_classification": [col("review_id", "string"), col("review_text", "text"), col("sentiment", "category")],
    "image_classification": [col("image_path", "image_path"), col("label", "category")],
    "recommendation": [col("user_id", "string"), col("item_id", "string"), col("rating", "int"), col("timestamp", "datetime")],
}


def _structure_issues():
    spec = importlib.util.spec_from_file_location("e4_policy", ROOT / "services" / "e4-studio-service" / "app" / "policy.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.structure_issues


def test_catalog_has_the_eight_types_and_consistent_models():
    assert sorted(C.TASKS) == sorted(SCHEMAS)
    for task, pt in C.PIPELINE_TYPES.items():
        assert pt["default_metric"] in pt["metrics"]
        assert any(task in m["task"] and not m["deep_learning"] for m in C.MODELS), f"{task}: no runnable (non G-DL) model"


@pytest.mark.parametrize("task", sorted(SCHEMAS))
def test_template_is_structurally_valid(task):
    spec = C.build_template_spec(task, "dsv_x", SCHEMAS[task])
    assert spec["metadata"]["task"] == task
    assert C.pipeline_type_issues(spec) == []
    errors = [i for i in _structure_issues()(spec, C.NODE_TYPE_BY_ID) if i["severity"] == "error"]
    assert errors == []


def test_roles_inference_and_text_detection():
    assert C.guess_roles(SCHEMAS["recommendation"], "recommendation") == {"user_column": "user_id", "item_column": "item_id", "target": "rating", "time_column": "timestamp"}
    assert C.guess_roles(SCHEMAS["forecasting"], "forecasting") == {"time_column": "date", "target": "sales"}
    assert C.infer_task(SCHEMAS["image_classification"], "label") == "image_classification"
    assert C.infer_task(SCHEMAS["clustering"]) == "clustering"
    assert C.detect_task_from_text("Détecter les fraudes") == "anomaly_detection"
    assert C.detect_task_from_text("Recommander des films aux utilisateurs") == "recommendation"


def test_v11_flags_inconsistent_forecasting():
    spec = C.build_template_spec("forecasting", "dsv_x", SCHEMAS["forecasting"])
    split = next(n for n in spec["nodes"] if n["type"] == "data.split")
    split["params"]["strategy"] = "random"
    del split["params"]["time_column"]
    next(n for n in spec["nodes"] if n["type"] == "train.model")["params"]["primary_metric"] = "f1"
    paths = {i.get("path") for i in C.pipeline_type_issues(spec)}
    assert {"strategy", "time_column", "primary_metric"} <= paths


def test_e4_validation_and_pipeline_types_endpoint(service):  # noqa: F811
    m = service("e4-studio-service")
    with TestClient(m.app) as c:
        assert len(c.get("/catalog/pipeline-types").json()["pipeline_types"]) == 8
        assert {"tpl_forecasting", "tpl_recommendation"} <= {t["id"] for t in c.get("/catalog/templates").json()}
        good = C.build_template_spec("text_classification", "dsv_x", SCHEMAS["text_classification"])
        vid = c.post("/workflows", json={"project_id": "p_churn", "name": "nlp", "spec": good}).json()["version_id"]
        wf = m.VERSIONS_DB[vid]["workflow_id"]
        rep = c.post(f"/workflows/{wf}/versions/{vid}/validate").json()
        assert next(layer for layer in rep["layers"] if layer["layer"] == "structure")["status"] != "error"
        bad = C.build_template_spec("text_classification", "dsv_x", SCHEMAS["text_classification"])
        del next(n for n in bad["nodes"] if n["type"] == "data.split")["params"]["text_column"]
        vid = c.post("/workflows", json={"project_id": "p_churn", "name": "nlp-bad", "spec": bad}).json()["version_id"]
        wf = m.VERSIONS_DB[vid]["workflow_id"]
        rep = c.post(f"/workflows/{wf}/versions/{vid}/validate").json()
        assert any(i["code"] == "V11" and i.get("path") == "text_column" for layer in rep["layers"] for i in layer["issues"])


def test_e2_training_validation_rules(service):  # noqa: F811
    m = service("e2-training-service")
    with TestClient(m.app) as c:
        base = {"split_id": "s", "preprocess_spec_id": "p", "params": {}}
        ok = c.post("/training/validate", json={**base, "model_id": "kmeans", "primary_metric": "silhouette", "task": "clustering"}).json()
        assert ok["status"] == "ok"
        bad = c.post("/training/validate", json={**base, "model_id": "kmeans", "primary_metric": "f1", "task": "forecasting"}).json()
        assert {i["code"] for i in bad["layers"][0]["issues"]} >= {"T_TASK", "T_METRIC"}
        dl = c.post("/training/validate", json={**base, "model_id": "resnet_transfer", "primary_metric": "accuracy", "task": "image_classification"}).json()
        assert "T_GATE_DL" in {i["code"] for i in dl["layers"][0]["issues"]}


def test_e3_goal_parsing_detects_pipeline_type(service):  # noqa: F811
    m = service("e3-assistant-service")
    with TestClient(m.app) as c:
        g = c.post("/assistant/goals/parse", json={"text": "Prévoir les ventes des prochaines semaines", "dataset_version_id": "dsv_x"}).json()["goal"]
        assert g["task"] == "forecasting" and g["objective"]["primary_metric"] == "mae" and g["objective"]["direction"] == "minimize"
        g = c.post("/assistant/goals/parse", json={"text": "Segmenter les clients", "dataset_version_id": "dsv_x"}).json()["goal"]
        assert g["task"] == "clustering" and g["target"] is None

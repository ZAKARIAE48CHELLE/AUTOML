"""Service-level tests for the four FastAPI microservices.

Each test loads one service with its own temporary SQLite database. Foreign keys are
enforced on SQLite so referential bugs show up here the way they would on PostgreSQL.
"""
import hashlib
import importlib
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

root_dir = Path(__file__).resolve().parent.parent
SERVICES = ["e1-data-service", "e2-training-service", "e3-assistant-service", "e4-studio-service"]


def load_service(service_name: str, db_path: Path, monkeypatch):
    """Import a service's `app.main` fresh, bound to the given SQLite file."""
    for m in [m for m in sys.modules if m == "app" or m.startswith("app.")]:
        del sys.modules[m]
    sys.path[:] = [p for p in sys.path if not any(s in p for s in SERVICES)]
    sys.path.insert(0, str(root_dir / "services" / service_name))
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path.as_posix()}")
    monkeypatch.delenv("E2_SERVICE_URL", raising=False)
    monkeypatch.delenv("E3_SERVICE_URL", raising=False)
    module = importlib.import_module("app.main")
    database = importlib.import_module("app.database")

    @event.listens_for(database.engine, "connect")
    def _fk_on(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    return module


@pytest.fixture
def service(tmp_path, monkeypatch):
    def _load(name: str, db_name: str = "svc.db"):
        return load_service(name, tmp_path / db_name, monkeypatch)
    return _load


def assert_api_error(r, status_code: int, code: str = None):
    assert r.status_code == status_code, r.text
    body = r.json()
    assert set(body) >= {"code", "message", "details", "request_id"}, body
    if code:
        assert body["code"] == code, body


# ---------------------------------------------------------------------------
# E1 Data Intelligence
# ---------------------------------------------------------------------------
CSV = (
    b'customer_id,age,score,plan,comment\n'
    b'C1,-5,3.2,basic,"hello, world"\n'
    b'C2,10,,premium,ok\n'
    b'C3,42,1e3,basic,NA\n'
    b'C4,7,2.5,basic,fine\n'
)


def upload(c, project_id="p_churn", content=CSV, name="t.csv"):
    return c.post("/datasets", files={"file": (name, content, "text/csv")}, data={"project_id": project_id})


def test_e1_health_and_seed(service):
    m = service("e1-data-service")
    with TestClient(m.app) as c:
        assert c.get("/health/live").json()["service"] == "e1-data-service"
        r = c.get("/health/ready")
        assert r.status_code == 200 and r.json()["database"]["status"] == "connected"
        r = c.post("/auth/login", json={"email": "zakariae@emsi.ma", "password": "password123"})
        assert r.status_code == 200 and r.json()["user"]["email"] == "zakariae@emsi.ma"
        assert len(c.get("/projects").json()) == 1

        ds = c.get("/datasets").json()
        assert ds[0]["id"] == "ds_churn"
        # Detail and preview now come from the same stored version (they used to disagree).
        detail = c.get("/datasets/ds_churn").json()["versions"][0]
        preview = c.get("/datasets/ds_churn/preview").json()
        assert len(detail["schema"]) == len(preview["columns"]) == 5
        assert preview["total"] == detail["rows"] == 200
        assert len(preview["rows"]) == 25

        prof = c.get("/datasets/ds_churn/profile").json()
        cols = {x["name"]: x for x in prof["columns"]}
        assert cols["monthly_charges"]["missing_pct"] > 0
        assert cols["tenure_months"]["histogram"] and cols["churn"]["top"]
        assert "HIGH_CARDINALITY" in {a["code"] for a in prof["alerts"]}

        assert len(c.get("/preprocessing/catalog").json()) >= 6
        rec = c.post("/preprocessing/recommendations",
                     json={"dataset_version_id": "dsv_churn_v1", "target": "churn", "task": "classification"}).json()
        steps = {s["type"]: s["columns"] for s in rec["spec"]["steps"]}
        assert steps["drop_columns"] == ["customer_id"]
        assert "churn" not in sum(steps.values(), [])


def test_e1_csv_parsing(service):
    m = service("e1-data-service")
    with TestClient(m.app) as c:
        r = upload(c)
        assert r.status_code == 202, r.text
        ds_id, v_id = r.json()["dataset_id"], r.json()["version_id"]
        v = c.get(f"/datasets/{ds_id}").json()["versions"][0]
        types = {col["name"]: col["dtype"] for col in v["schema"]}
        assert types["age"] == "int"            # negative numbers are numeric
        assert types["score"] == "float"        # empty cell + scientific notation
        assert v["rows"] == 4
        assert v["checksum"] == "sha256:" + hashlib.sha256(CSV).hexdigest()
        rows = c.get(f"/datasets/{ds_id}/preview", params={"dataset_version_id": v_id}).json()["rows"]
        assert rows[0]["comment"] == "hello, world"   # quoted delimiter kept in one field
        assert rows[0]["age"] == -5 and rows[1]["score"] is None and rows[2]["comment"] is None

        semi = b"a;b\n1;x\n2;y\n"
        r = upload(c, content=semi, name="semi.csv")
        ds2 = r.json()["dataset_id"]
        cols = c.get(f"/datasets/{ds2}/preview").json()["columns"]
        assert [x["name"] for x in cols] == ["a", "b"]

        assert_api_error(upload(c, content=b""), 400, "INVALID_CSV")
        assert_api_error(upload(c, content=b"a,b\n"), 400, "INVALID_CSV")


def test_e1_import_rejects_unknown_project(service):
    m = service("e1-data-service")
    with TestClient(m.app) as c:
        assert_api_error(upload(c, project_id="does_not_exist"), 404, "NOT_FOUND")


def test_e1_data_survives_restart(service):
    m = service("e1-data-service", "shared.db")
    with TestClient(m.app) as c:
        ds_id = upload(c).json()["dataset_id"]
    m2 = service("e1-data-service", "shared.db")  # fresh process state, same database
    with TestClient(m2.app) as c:
        assert c.get(f"/datasets/{ds_id}/preview").status_code == 200
        assert c.get(f"/datasets/{ds_id}/profile").status_code == 200


def test_e1_version_resolution(service):
    m = service("e1-data-service")
    with TestClient(m.app) as c:
        ds_id = upload(c).json()["dataset_id"]
        assert_api_error(c.get("/datasets/nope/preview"), 404)
        # Version that belongs to another dataset
        assert_api_error(c.get(f"/datasets/{ds_id}/preview", params={"dataset_version_id": "dsv_churn_v1"}), 404)
        # POST profile reads the version from the JSON body (as the web client sends it)
        r = c.post("/datasets/ds_churn/profile", json={"dataset_version_id": "dsv_churn_v1"})
        assert r.status_code == 200 and r.json()["dataset_version_id"] == "dsv_churn_v1"
        r = c.get("/datasets/ds_churn/preview", params={"limit": 1000})
        assert r.json()["limit"] == 100


def test_e1_delete_project_cascades(service):
    m = service("e1-data-service")
    with TestClient(m.app) as c:
        p = c.post("/projects", json={"name": "Temp"}).json()["id"]
        ds_id, v_id = (lambda j: (j["dataset_id"], j["version_id"]))(upload(c, project_id=p).json())
        assert c.post("/splits", json={"dataset_version_id": v_id,
                                       "split_spec": {"target": "plan", "strategy": "stratified", "test_ratio": 0.25, "cv_folds": 1}}).status_code == 201
        assert c.post("/preprocessing/specs", json={"dataset_version_id": v_id,
                                                    "spec": {"steps": [{"type": "drop_columns", "columns": ["customer_id"]}]}}).status_code == 201
        assert c.delete(f"/projects/{p}").status_code == 204
        assert_api_error(c.get(f"/datasets/{ds_id}"), 404)
        assert c.get("/splits", params={"dataset_version_id": v_id}).json() == []
        assert_api_error(c.get(f"/projects/{p}"), 404)
        assert c.delete(f"/projects/{p}").status_code == 204  # idempotent


def test_e1_splits(service):
    m = service("e1-data-service")
    with TestClient(m.app) as c:
        body = {"dataset_version_id": "dsv_churn_v1",
                "split_spec": {"target": "churn", "strategy": "stratified", "test_ratio": 0.2, "cv_folds": 5, "seed": 42}}
        r = c.post("/splits", json=body)
        assert r.status_code == 201
        sid = r.json()["split_id"]
        assert c.post("/splits", json=body).json()["split_id"] == sid  # same spec -> same split
        s = c.get(f"/splits/{sid}").json()
        assert s["counts"] == {"train": 128, "validation": 32, "test": 40}
        assert abs(sum(d["train"] for d in s["target_distribution"]) - 1) < 0.01
        assert len(c.get("/splits", params={"dataset_version_id": "dsv_churn_v1"}).json()) == 1

        # Missing target used to be accepted and then crash GET /splits with a 500.
        assert_api_error(c.post("/splits", json={"dataset_version_id": "dsv_churn_v1", "split_spec": {}}), 422, "VALIDATION_ERROR")
        assert_api_error(c.post("/splits", json={"dataset_version_id": "dsv_churn_v1", "split_spec": {"target": "nope"}}), 400, "SPLIT_INVALID")
        assert_api_error(c.post("/splits", json={"dataset_version_id": "dsv_churn_v1", "split_spec": {"target": "churn", "test_ratio": 1.5}}), 422)
        assert_api_error(c.post("/splits", json={"dataset_version_id": "nope", "split_spec": {"target": "churn"}}), 404)
        assert_api_error(c.get("/splits/nope"), 404)


def test_e1_preprocessing_specs_and_validation(service):
    m = service("e1-data-service")
    with TestClient(m.app) as c:
        steps = [{"type": "drop_columns", "columns": ["customer_id"]}, {"type": "onehot", "columns": ["contract_type"]}]
        r = c.post("/preprocessing/specs", json={"dataset_version_id": "dsv_churn_v1", "spec": {"steps": steps}})
        assert r.status_code == 201
        spec_id, chash = r.json()["spec_id"], r.json()["content_hash"]
        again = c.post("/preprocessing/specs", json={"dataset_version_id": "dsv_churn_v1", "spec": {"steps": steps}}).json()
        assert again["spec_id"] == spec_id and again["content_hash"] == chash
        assert c.get(f"/preprocessing/specs/{spec_id}").json()["steps"][0]["columns"] == ["customer_id"]

        split = c.post("/splits", json={"dataset_version_id": "dsv_churn_v1", "split_spec": {"target": "churn"}}).json()["split_id"]
        pv = c.post(f"/preprocessing/specs/{spec_id}/preview", json={"split_id": split}).json()
        assert pv["columns_before"] == 5 and pv["columns_after"] == 6  # -customer_id, contract_type -> 3 dummies
        assert_api_error(c.post(f"/preprocessing/specs/{spec_id}/preview", json={"split_id": "nope"}), 404)

        bad = [{"type": "standard_scale", "columns": ["contract_type"]}, {"type": "onehot", "columns": ["churn"]},
               {"type": "nope", "columns": []}]
        rep = c.post("/preprocessing/validate", json={"dataset_version_id": "dsv_churn_v1", "spec": {"steps": bad}, "target": "churn"}).json()
        codes = {i["code"] for i in rep["layers"][0]["issues"]}
        assert rep["status"] == "error"
        assert {"PP_DTYPE_MISMATCH", "PP_TARGET_TRANSFORMED", "PP_UNKNOWN_TRANSFORM"} <= codes
        ok = c.post("/preprocessing/validate", json={"dataset_version_id": "dsv_churn_v1", "spec": {"steps": steps}, "target": "churn"}).json()
        assert ok["status"] == "ok"
        assert_api_error(c.post("/preprocessing/specs", json={"dataset_version_id": "dsv_churn_v1",
                                                              "spec": {"steps": [{"type": "onehot", "columns": ["ghost"]}]}}), 400, "SPEC_INVALID")


def test_e1_error_format(service):
    m = service("e1-data-service")
    with TestClient(m.app) as c:
        assert_api_error(c.get("/no-such-route"), 404, "NOT_FOUND")
        assert_api_error(c.post("/preprocessing/recommendations", json={"dataset_version_id": "dsv_churn_v1"}), 422, "VALIDATION_ERROR")
        assert_api_error(c.post("/preprocessing/recommendations",
                                json={"dataset_version_id": "dsv_churn_v1", "target": "nope", "task": "classification"}), 400, "TARGET_NOT_FOUND")


# ---------------------------------------------------------------------------
# E2 Training
# ---------------------------------------------------------------------------
def test_e2_training_service(service):
    m = service("e2-training-service")
    with TestClient(m.app) as c:
        assert c.get("/health/live").json()["service"] == "e2-training-service"
        assert c.get("/health/ready").json()["database"]["status"] == "connected"
        assert len(c.get("/models/catalog").json()) >= 3
        assert c.get("/models/catalog", params={"modality": "image"}).json() == []
        assert c.get("/training/resources").json()["concurrency"] > 0
        assert len(c.get("/experiments").json()) > 0
        r = c.post("/inference/predict", json={"model_version_id": "mv_xgb_prod",
                                               "records": [{"tenure_months": 24, "monthly_charges": 55.0, "contract_type": "One year"}]})
        assert r.status_code == 200 and len(r.json()["predictions"]) == 1

        assert c.get("/tuning/studies/study_01").json()["best_trial"]["value"] == 0.879
        assert_api_error(c.get("/tuning/studies/whatever"), 404, "NOT_FOUND")

        lb = c.post("/experiments/compare", json={"run_ids": ["run_rf_01", "run_xgb_01"]}).json()
        assert [e["run_id"] for e in lb["entries"]] == ["run_xgb_01", "run_rf_01"]
        assert_api_error(c.post("/experiments/compare", json={"run_ids": []}), 400)
        assert_api_error(c.post("/experiments/compare", json={"run_ids": ["ghost"]}), 404)

        assert len(c.get("/training/jobs", params={"project_id": "p_churn"}).json()) == 1
        assert c.get("/training/jobs", params={"project_id": "other"}).json() == []
        assert c.get("/models/registry", params={"project_id": "other"}).json() == []
        assert_api_error(c.get("/models/registry/nope"), 404)


# ---------------------------------------------------------------------------
# E3 Assistant
# ---------------------------------------------------------------------------
def test_e3_assistant_service(service):
    m = service("e3-assistant-service")
    with TestClient(m.app) as c:
        assert c.get("/health/live").json()["service"] == "e3-assistant-service"
        assert c.get("/health/ready").json()["database"]["status"] == "connected"
        assert len(c.get("/assistant/messages", params={"project_id": "p_churn"}).json()) > 0
        r = c.post("/assistant/goals/parse", json={"text": "Prédire le churn des clients avec XGBoost", "dataset_version_id": "dsv_churn_v1"})
        assert r.status_code == 200 and r.json()["goal"]["target"] == "churn"
        assert len(c.get("/policy/matrix").json()["classes"]) == 4
        assert_api_error(c.get("/assistant/proposals/nope"), 404, "NOT_FOUND")
        assert_api_error(c.get("/assistant/messages"), 422, "VALIDATION_ERROR")


# ---------------------------------------------------------------------------
# E4 Studio
# ---------------------------------------------------------------------------
def spec_with(nodes, edges, target="churn"):
    return {"schema_version": "1.0.0", "catalog_version": "1.0.0", "nodes": nodes, "edges": edges,
            "metadata": {"task": "classification", "target": target, "origin": "human"}}


def node(id_, type_, **params):
    return {"id": id_, "type": type_, "type_version": "1.0", "params": params}


def edge(id_, a, ap, b, bp):
    return {"id": id_, "from": {"node": a, "port": ap}, "to": {"node": b, "port": bp}}


def test_e4_basics(service):
    m = service("e4-studio-service")
    with TestClient(m.app) as c:
        assert c.get("/health/live").json()["service"] == "e4-studio-service"
        assert c.get("/health/ready").json()["database"]["status"] == "connected"
        assert len(c.get("/catalog/node-types").json()["node_types"]) == 8
        assert len(c.get("/catalog/templates").json()) >= 2
        assert len(c.get("/workflows").json()) > 0

        h = m.compute_canonical_hash
        a = {"nodes": [{"id": "n1", "ui": {"x": 10, "y": 20}}], "edges": [], "metadata": {}}
        b = {"nodes": [{"id": "n1", "ui": {"x": 999, "y": 888}}], "edges": [], "metadata": {}}
        assert h(a) == h(b)

        rep = c.post("/workflows/wf_churn_01/versions/wfv_01/validate").json()
        assert rep["status"] != "error"
        assert {l["layer"]: l["status"] for l in rep["layers"]}["policy"] == "ok"  # appr_01 covers node_train
        r = c.post("/executions", json={"workflow_version_id": "wfv_01", "approval_ids": ["appr_01"]})
        assert r.status_code == 202 and "execution_id" in r.json()


def test_e4_content_hash_uses_contract_keys(service):
    m = service("e4-studio-service")
    with TestClient(m.app) as c:
        r = c.post("/workflows", json={"project_id": "p_churn", "name": "x", "spec": m.DEFAULT_SPEC, "origin": "human"})
        assert r.status_code == 201
        wf, vid, chash = r.json()["workflow_id"], r.json()["version_id"], r.json()["content_hash"]
        assert chash == m.compute_canonical_hash(m.DEFAULT_SPEC)
        assert "from" in m.VERSIONS_DB[vid]["spec"]["edges"][0]
        # Re-saving the same spec is detected as unchanged
        r = c.post(f"/workflows/{wf}/versions", json={"parent_version_id": vid, "spec": m.DEFAULT_SPEC})
        assert r.json()["unchanged"] is True
        # Version labels are numbered per workflow
        changed = spec_with(m.DEFAULT_SPEC["nodes"][:1], [])
        r = c.post(f"/workflows/{wf}/versions", json={"parent_version_id": vid, "spec": changed})
        v2 = r.json()["version_id"]
        assert m.VERSIONS_DB[v2]["label"] == "Version 2"
        d = c.get(f"/workflows/{wf}/versions/{v2}/diff", params={"against": vid}).json()
        assert d["nodes_removed"] == ["node_split", "node_train"] and d["edges_removed"] == ["e1", "e2"]
        assert_api_error(c.post(f"/workflows/{wf}/versions", json={"parent_version_id": "wfv_01", "spec": changed}), 404)


def test_e4_execution_requires_approvals(service):
    m = service("e4-studio-service")
    with TestClient(m.app) as c:
        r = c.post("/executions", json={"workflow_version_id": "wfv_01", "approval_ids": []})
        assert_api_error(r, 403, "APPROVAL_REQUIRED")
        assert r.json()["details"]["missing"][0]["node_ids"] == ["node_train"]
        assert_api_error(c.post("/executions", json={"workflow_version_id": "wfv_01", "approval_ids": ["ghost"]}), 404)

        # An approval is bound to a content hash: a modified version needs a new one.
        spec = dict(m.DEFAULT_SPEC, nodes=[dict(n) for n in m.DEFAULT_SPEC["nodes"]])
        spec["nodes"][2] = node("node_train", "train.model", model_id="model_rf")
        v2 = c.post("/workflows/wf_churn_01/versions", json={"parent_version_id": "wfv_01", "spec": spec}).json()["version_id"]
        assert_api_error(c.post("/executions", json={"workflow_version_id": v2, "approval_ids": ["appr_01"]}), 403)

        # Guided mode: one approval per step, node_ids required
        assert_api_error(c.post("/approvals", json={"workflow_version_id": v2, "operation_classes": ["L2"]}), 400)
        a = c.post("/approvals", json={"workflow_version_id": v2, "operation_classes": ["L2"], "node_ids": ["node_train"]})
        assert a.status_code == 201
        aid = a.json()["approval_id"]
        assert c.post("/executions", json={"workflow_version_id": v2, "approval_ids": [aid]}).status_code == 202

        # Revoked approvals no longer count; revoking twice is a conflict
        assert c.post(f"/approvals/{aid}/revoke").json()["status"] == "revoked"
        assert_api_error(c.post(f"/approvals/{aid}/revoke"), 409)
        assert_api_error(c.post("/executions", json={"workflow_version_id": v2, "approval_ids": [aid]}), 403)


def test_e4_l3_approval_is_individual_and_consumed(service):
    m = service("e4-studio-service")
    with TestClient(m.app) as c:
        spec = spec_with([node("ds", "data.dataset", dataset_version_id="dsv_churn_v1"),
                          node("sp", "data.split"),
                          node("tr", "train.model", model_id="model_rf"),
                          node("ft", "eval.final_test")],
                         [edge("e1", "ds", "dataset", "sp", "dataset"), edge("e2", "sp", "split", "tr", "split"),
                          edge("e3", "tr", "run", "ft", "run"), edge("e4", "sp", "split", "ft", "split")])
        r = c.post("/workflows", json={"project_id": "p_churn", "name": "l3", "spec": spec})
        vid = r.json()["version_id"]
        l2 = c.post("/approvals", json={"workflow_version_id": vid, "operation_classes": ["L2"], "node_ids": ["tr"]}).json()["approval_id"]
        assert_api_error(c.post("/approvals", json={"workflow_version_id": vid, "operation_classes": ["L3"], "node_ids": ["ft"],
                                                    "method": "chat_confirm"}), 403, "L3_REQUIRES_CLICK")
        l3 = c.post("/approvals", json={"workflow_version_id": vid, "operation_classes": ["L3"], "node_ids": ["ft"]}).json()["approval_id"]
        assert_api_error(c.post("/executions", json={"workflow_version_id": vid, "approval_ids": [l2]}), 403)
        assert c.post("/executions", json={"workflow_version_id": vid, "approval_ids": [l2, l3]}).status_code == 202
        assert m.APPROVALS_DB[l3]["status"] == "expired"
        assert_api_error(c.post("/executions", json={"workflow_version_id": vid, "approval_ids": [l2, l3]}), 403)


def test_e4_structural_validation_blocks_execution(service):
    m = service("e4-studio-service")
    with TestClient(m.app) as c:
        mistyped = spec_with([node("a", "data.split"), node("b", "data.split")],
                             [edge("e1", "a", "split", "b", "dataset"), edge("e2", "b", "split", "a", "dataset")])
        vid = c.post("/workflows", json={"project_id": "p_churn", "name": "bad", "spec": mistyped}).json()["version_id"]
        wf = m.VERSIONS_DB[vid]["workflow_id"]
        rep = c.get(f"/workflows/{wf}/versions/{vid}/validation").json()
        codes = {i["code"] for l in rep["layers"] for i in l["issues"]}
        assert rep["status"] == "error" and "S_PORT_TYPE_MISMATCH" in codes
        assert_api_error(c.post("/executions", json={"workflow_version_id": vid, "approval_ids": []}), 422, "VALIDATION_FAILED")

        unknown = spec_with([node("x", "data.nope"), node("t", "train.model")], [])
        vid = c.post("/workflows", json={"project_id": "p_churn", "name": "bad2", "spec": unknown}).json()["version_id"]
        wf = m.VERSIONS_DB[vid]["workflow_id"]
        codes = {i["code"] for l in c.get(f"/workflows/{wf}/versions/{vid}/validation").json()["layers"] for i in l["issues"]}
        assert {"S_UNKNOWN_NODE_TYPE", "S_MISSING_PARAM"} <= codes

        # The catalog's port types make a well-typed cycle impossible, so exercise the cycle detector directly.
        from app.policy import structure_issues
        cyc = spec_with([node("a", "eval.compare"), node("b", "eval.compare")], [])
        cyc["edges"] = [edge("e1", "a", "leaderboard", "b", "runs"), edge("e2", "b", "leaderboard", "a", "runs")]
        assert "S_CYCLE" in {i["code"] for i in structure_issues(cyc, m.CATALOG)}


def test_e4_auto_mode_plan_approval(service, monkeypatch):
    m = service("e4-studio-service")
    monkeypatch.setattr(m, "project_mode", lambda project_id: "auto")
    with TestClient(m.app) as c:
        assert_api_error(c.post("/approvals", json={"workflow_version_id": "wfv_01", "operation_classes": ["L2"]}), 400, "BUDGET_REQUIRED")
        assert_api_error(c.post("/approvals", json={"workflow_version_id": "wfv_01", "operation_classes": ["L2"],
                                                    "budget": {"trials": 500, "max_minutes": 1, "models": 1}}), 400, "BUDGET_EXCEEDED")
        r = c.post("/approvals", json={"workflow_version_id": "wfv_01", "operation_classes": ["L2"],
                                       "budget": {"trials": 10, "max_minutes": 10, "models": 1}})
        assert r.status_code == 201 and r.json()["approval"]["scope"] == "lineage"
        plan = r.json()["approval_id"]
        r = c.post("/approvals", json={"workflow_version_id": "wfv_01", "operation_classes": ["L2"], "scope": "version",
                                       "budget": {"trials": 10, "max_minutes": 10, "models": 1}})
        assert r.json()["approval"]["scope"] == "version"
        # A lineage approval keeps covering descendant versions of the approved one.
        spec = dict(m.DEFAULT_SPEC, nodes=[dict(n) for n in m.DEFAULT_SPEC["nodes"]])
        spec["nodes"][2] = node("node_train", "train.model", model_id="model_rf")
        v2 = c.post("/workflows/wf_churn_01/versions", json={"parent_version_id": "wfv_01", "spec": spec}).json()["version_id"]
        assert c.post("/executions", json={"workflow_version_id": v2, "approval_ids": [plan]}).status_code == 202


def test_e4_execution_lifecycle_exports_promotions(service):
    m = service("e4-studio-service")
    with TestClient(m.app) as c:
        assert_api_error(c.post("/executions/exec_01/cancel"), 409, "ALREADY_FINISHED")
        assert_api_error(c.post("/executions/nope/cancel"), 404)
        assert_api_error(c.get("/executions/nope/events"), 404)
        r = c.get("/executions/exec_01/events")
        assert r.status_code == 200 and "event: execution_status" in r.text and "node_train" in r.text
        r = c.get("/executions/exec_01/events", headers={"Last-Event-ID": "6"})
        assert r.text.count("event:") == 1

        assert len(c.get("/executions", params={"project_id": "p_churn"}).json()) == 1
        assert c.get("/executions", params={"project_id": "other"}).json() == []

        assert_api_error(c.get("/exports/nope"), 404)
        assert_api_error(c.post("/exports", json={"execution_id": "nope"}), 404)
        assert_api_error(c.post("/exports", json={"execution_id": "exec_01", "include_data": True}), 403, "APPROVAL_REQUIRED")
        exp = c.post("/exports", json={"execution_id": "exec_01"}).json()["export_id"]
        man = c.get(f"/exports/{exp}").json()
        assert man["dataset_refs"] == ["dsv_churn_v1"] and man["model_configs"][0]["model_id"] == "model_xgb"

        assert_api_error(c.post("/registry/promotions", json={"model_version_id": "mv_xgb_prod", "alias": "production",
                                                              "approval_id": "appr_01"}), 403, "APPROVAL_REQUIRED")
        a = c.post("/approvals", json={"workflow_version_id": "wfv_01", "operation_classes": ["L3"],
                                       "node_ids": ["promote:mv_xgb_prod"]}).json()["approval_id"]
        rec = c.post("/registry/promotions", json={"model_version_id": "mv_xgb_prod", "alias": "production", "approval_id": a})
        assert rec.status_code == 200
        assert len(c.get("/registry/promotions").json()) == 1
        assert c.get("/registry/promotions", params={"model_name": "other"}).json() == []
        assert_api_error(c.post("/registry/promotions", json={"model_version_id": "mv_xgb_prod", "alias": "production",
                                                              "approval_id": a}), 403)  # consumed

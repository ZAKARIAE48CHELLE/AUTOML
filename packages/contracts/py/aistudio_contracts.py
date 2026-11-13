"""Shared pipeline-type contracts for the Python services (E1–E4).

Single source of truth: packages/contracts/catalog.json and models.json — the same files the web client reads.
This module mirrors packages/contracts/src/pipelines.ts and the V11 rule of src/validator.ts so the
backends enforce exactly what the client validates.
"""
import copy
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

_DIR = Path(__file__).resolve().parent.parent


def _load(name: str) -> Dict[str, Any]:
    return json.loads((_DIR / name).read_text(encoding="utf-8"))


CATALOG: Dict[str, Any] = _load("catalog.json")
CATALOG_VERSION: str = CATALOG["catalog_version"]
NODE_TYPES: List[Dict[str, Any]] = CATALOG["node_types"]
NODE_TYPE_BY_ID: Dict[str, Dict[str, Any]] = {n["type"]: n for n in NODE_TYPES}
PIPELINE_TYPES: Dict[str, Dict[str, Any]] = {p["id"]: p for p in CATALOG["pipeline_types"]}
TASKS: List[str] = list(PIPELINE_TYPES)
METRICS: Dict[str, Dict[str, Any]] = {m["id"]: m for m in CATALOG["metrics"]}
MINIMIZE_METRICS = {k for k, m in METRICS.items() if m["direction"] == "minimize"}
PREPROCESS_STEPS: List[Dict[str, Any]] = CATALOG["preprocess_steps"]
STEP_BY_TYPE: Dict[str, Dict[str, Any]] = {s["type"]: s for s in PREPROCESS_STEPS}
MODELS: List[Dict[str, Any]] = _load("models.json")["models"]
MODEL_BY_ID: Dict[str, Dict[str, Any]] = {m["id"]: m for m in MODELS}
MODALITIES = ["tabular", "timeseries", "text", "image", "interactions"]
DTYPES = ["int", "float", "category", "string", "bool", "datetime", "text", "image_path"]
ROLE_KEYS = ["target", "time_column", "group_column", "text_column", "image_column", "user_column", "item_column"]


def is_compatible_catalog(version: str) -> bool:
    return str(version).split(".")[0] == CATALOG_VERSION.split(".")[0]


def pipeline_type(task: Optional[str]) -> Dict[str, Any]:
    return PIPELINE_TYPES.get(task or "classification", PIPELINE_TYPES["classification"])


def metric_direction(metric: str) -> str:
    return "minimize" if metric in MINIMIZE_METRICS else "maximize"


# ------------------------------------------------------------------ roles & inference
def _by_name(schema, pattern, dtypes=None) -> Optional[str]:
    rx = re.compile(pattern, re.I)
    return next((c["name"] for c in schema if rx.search(c["name"]) and (not dtypes or c["dtype"] in dtypes)), None)


def _of_type(schema, dtypes) -> List[Dict[str, Any]]:
    return [c for c in schema if c["dtype"] in dtypes]


def id_columns(schema) -> List[str]:
    return [c["name"] for c in schema if re.search(r"(^|_)id$", c["name"], re.I) and c["dtype"] in ("string", "int", "category")]


def guess_roles(schema: List[Dict[str, Any]], task: str, target: Optional[str] = None) -> Dict[str, str]:
    r: Dict[str, Optional[str]] = {}
    cat, num = ["category", "bool", "string"], ["float", "int"]
    if target and any(c["name"] == target for c in schema):
        r["target"] = target
    last = lambda pred: next((c["name"] for c in reversed(schema) if pred(c)), None)  # noqa: E731
    if task == "classification":
        r.setdefault("target", _by_name(schema, r"^(churn|label|class|target|y|outcome)$|^is_", cat + ["int"]) or last(lambda c: c["dtype"] in ("category", "bool")))
    elif task == "regression":
        r.setdefault("target", _by_name(schema, r"price|prix|amount|value|target|^y$", num) or last(lambda c: c["dtype"] == "float"))
    elif task == "anomaly_detection":
        r.setdefault("target", _by_name(schema, r"fraud|anomal|outlier|^is_|label", ["bool", "int", "category"]))
    elif task == "forecasting":
        r["time_column"] = _by_name(schema, r"date|time|day|timestamp|period", ["datetime", "int"]) or next((c["name"] for c in _of_type(schema, ["datetime"])), None)
        r.setdefault("target", _by_name(schema, r"sales|ventes|demand|value|load|traffic|count|qty|quantity", num) or last(lambda c: c["dtype"] == "float" and c["name"] != r.get("time_column")))
    elif task == "text_classification":
        r["text_column"] = next((c["name"] for c in _of_type(schema, ["text"])), None) or _by_name(schema, r"text|review|comment|message|body|content", ["string"])
        r.setdefault("target", _by_name(schema, r"sentiment|label|class|category|topic|target", cat + ["int"]) or next((c["name"] for c in schema if c["dtype"] == "category" and c["name"] != r.get("text_column")), None))
    elif task == "image_classification":
        r["image_column"] = next((c["name"] for c in _of_type(schema, ["image_path"])), None) or _by_name(schema, r"image|img|path|file", ["string"])
        r.setdefault("target", _by_name(schema, r"label|class|category|target", cat + ["int"]) or next((c["name"] for c in schema if c["dtype"] == "category" and c["name"] != r.get("image_column")), None))
    elif task == "recommendation":
        r["user_column"] = _by_name(schema, r"user|client|customer")
        r["item_column"] = _by_name(schema, r"item|product|movie|article|produit|song")
        r.setdefault("target", _by_name(schema, r"rating|note|score|stars|weight|count", num))
        r["time_column"] = _by_name(schema, r"date|time|timestamp", ["datetime", "int"])
    elif task == "clustering":
        r.pop("target", None)
    return {k: v for k, v in r.items() if v}


def infer_task(schema: List[Dict[str, Any]], target: Optional[str] = None) -> str:
    if _of_type(schema, ["image_path"]):
        return "image_classification"
    if _of_type(schema, ["text"]):
        return "text_classification"
    if _by_name(schema, r"user|client") and _by_name(schema, r"item|product|movie|article"):
        return "recommendation"
    col = next((c for c in schema if c["name"] == target), None)
    if not col:
        return "clustering"
    if col["dtype"] == "float" and _of_type(schema, ["datetime"]):
        return "forecasting"
    if col["dtype"] == "float" or (col["dtype"] == "int" and not re.search(r"^(is_|has_)|churn|label|class", col["name"], re.I)):
        return "regression"
    return "classification"


_TEXT_RULES = [
    ("recommendation", r"recommand|recommend|suggér|suggest|proposer des (articles|produits|films)"),
    ("image_classification", r"\bimages?\b|photos?|vision|visuel|caméra|camera|pixels?"),
    ("text_classification", r"\btextes?\b|avis|commentaires?|sentiment|e-?mails?|tickets?|\bnlp\b|reviews?|messages?"),
    ("forecasting", r"prévi|prévoir|prevoir|forecast|série temporelle|serie temporelle|time series|semaines? prochaines?|mois prochains?|futur"),
    ("anomaly_detection", r"anomal|fraud|outlier|atypique|intrusion|panne|aberrant"),
    ("clustering", r"segment|cluster|regroup|groupes? (de|d')|typolog|profils? (de )?clients"),
    ("regression", r"\bprix\b|montant|valeur numérique|régression|regression|estimer (le|la|un)"),
    ("classification", r"classer|classification|catégori|churn|prédire si|predict whether"),
]


def detect_task_from_text(text: str) -> Optional[str]:
    t = (text or "").lower()
    return next((task for task, rx in _TEXT_RULES if re.search(rx, t)), None)


# ------------------------------------------------------------------ templates
def template_steps(schema, task: str, roles: Dict[str, str]) -> List[Dict[str, Any]]:
    pt = pipeline_type(task)
    role_cols = set(roles.values())
    ids = [c for c in id_columns(schema) if c not in role_cols]
    features = [c for c in schema if c["name"] not in role_cols and c["name"] not in ids]
    steps: List[Dict[str, Any]] = []
    if ids and "drop_columns" in pt["step_types"]:
        steps.append({"type": "drop_columns", "columns": ids})
    for t in pt["template"]["steps"]:
        if t["type"] == "min_interactions":
            steps.append({"type": t["type"], "columns": [c for c in (roles.get("user_column"), roles.get("item_column")) if c]})
            continue
        if t.get("role"):
            cols = [roles[t["role"]]] if roles.get(t["role"]) else []
        else:
            cols = [c["name"] for c in features if c["dtype"] in (t.get("dtypes") or []) and (not t["type"].startswith("impute") or c.get("nullable"))]
        if cols:
            steps.append({"type": t["type"], "columns": cols})
    return steps


def _defaults(props: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    return {k: s["default"] for k, s in (props or {}).items() if "default" in s}


def build_template_spec(task: str, dsv_id: str, schema: List[Dict[str, Any]], target: Optional[str] = None,
                        metric: Optional[str] = None, origin: str = "human", goal_id: Optional[str] = None,
                        model_name: Optional[str] = None, gate_dl: bool = False, full: bool = True) -> Dict[str, Any]:
    """Complete, valid pipeline for a type (mirror of buildTemplateSpec in pipelines.ts)."""
    pt = pipeline_type(task)
    roles = guess_roles(schema, task, target)
    metric = metric if metric in pt["metrics"] else pt["default_metric"]
    models = [m for m in pt["template"]["models"] if gate_dl or not MODEL_BY_ID.get(m, {}).get("deep_learning")] or pt["template"]["models"][:1]
    split = {"strategy": pt["default_split"], "test_ratio": 0.2, "cv_folds": 3 if task in ("image_classification", "forecasting") else 5, "seed": 42, **roles}
    node = lambda i, t, p, col, row=0.0: {"id": i, "type": t, "type_version": "1.0", "params": p, "ui": {"x": col * 250, "y": row * 150}}  # noqa: E731
    edge = lambda i, fn, fp, tn, tp: {"id": i, "from": {"node": fn, "port": fp}, "to": {"node": tn, "port": tp}}  # noqa: E731
    nodes = [node("n1", "data.dataset", {"dataset_version_id": dsv_id}, 0), node("n2", "data.split", split, 1),
             node("n3", "data.preprocess", {"steps": template_steps(schema, task, roles)}, 2)]
    edges = [edge("e1", "n1", "dataset", "n2", "dataset"), edge("e2", "n2", "split", "n3", "split")]
    train_ids = []
    for i, mid in enumerate(models):
        nid = f"n{4 + i}"
        train_ids.append(nid)
        nodes.append(node(nid, "train.model", {"model_id": mid, "params": _defaults(MODEL_BY_ID.get(mid, {}).get("params_schema", {}).get("properties")),
                                               "primary_metric": metric, "seed": 42}, 3, i - (len(models) - 1) / 2))
        edges += [edge(f"e{len(edges) + 1}", "n2", "split", nid, "split"), edge(f"e{len(edges) + 2}", "n3", "spec", nid, "spec")]
    k = 4 + len(models)
    nodes.append(node(f"n{k}", "eval.compare", {"min_succeeded": 1}, 4))
    for t in train_ids:
        edges.append(edge(f"e{len(edges) + 1}", t, "run", f"n{k}", "runs"))
    if full:
        nodes += [node(f"n{k + 1}", "eval.final_test", {}, 5), node(f"n{k + 2}", "model.register", {"name": model_name or f"{task.replace('_', '-')}-model"}, 6)]
        edges += [edge(f"e{len(edges) + 1}", f"n{k}", "best", f"n{k + 1}", "run"), edge(f"e{len(edges) + 2}", f"n{k + 1}", "run", f"n{k + 2}", "run")]
    meta = {"task": task, "origin": origin, "objective": {"primary_metric": metric, "direction": metric_direction(metric)},
            "task_options": _defaults(pt["options_schema"].get("properties"))}
    if roles.get("target"):
        meta["target"] = roles["target"]
    if goal_id:
        meta["goal_id"] = goal_id
    return {"schema_version": "1.0", "catalog_version": CATALOG_VERSION, "nodes": nodes, "edges": edges, "metadata": meta}


# ------------------------------------------------------------------ V11 (mirror of pipelineTypeIssues)
def pipeline_type_issues(spec: Dict[str, Any]) -> List[Dict[str, Any]]:
    issues: List[Dict[str, Any]] = []
    task = (spec.get("metadata") or {}).get("task")
    pt = PIPELINE_TYPES.get(task)
    err = lambda msg, **kw: {"code": "V11", "severity": "error", "message": msg, **kw}  # noqa: E731
    if not pt:
        return [err(f"Type de pipeline inconnu « {task} ».", hint="Choisissez un type de pipeline du catalogue.")]
    for n in spec.get("nodes", []):
        p = n.get("params") or {}
        if n.get("type") == "data.split":
            if p.get("strategy") and p["strategy"] not in pt["split_strategies"]:
                issues.append(err(f"Stratégie de split « {p['strategy']} » non adaptée à : {pt['label']}.", node_id=n["id"], path="strategy",
                                  hint=f"Stratégies possibles : {', '.join(pt['split_strategies'])}."))
            for r in pt["roles"]:
                if r["required"] and not p.get(r["role"]):
                    issues.append(err(f"{r['label']} : obligatoire pour {pt['label']}.", node_id=n["id"], path=r["role"],
                                      hint="Renseignez la colonne dans les paramètres du split."))
        if n.get("type") == "data.preprocess":
            for i, st in enumerate(p.get("steps") or []):
                t = (st or {}).get("type")
                if t in STEP_BY_TYPE and t not in pt["step_types"]:
                    issues.append(err(f"Étape « {STEP_BY_TYPE[t]['label']} » non adaptée à : {pt['label']}.", node_id=n["id"], path=f"steps.{i}.type"))
        if n.get("type") in ("train.model", "train.tune") and p.get("primary_metric") and p["primary_metric"] not in pt["metrics"]:
            m = p["primary_metric"]
            issues.append(err(f"Métrique « {METRICS.get(m, {}).get('label', m)} » non adaptée à : {pt['label']}.", node_id=n["id"], path="primary_metric",
                              hint=f"Métriques possibles : {', '.join(pt['metrics'])}."))
    om = ((spec.get("metadata") or {}).get("objective") or {}).get("primary_metric")
    if om and om not in pt["metrics"]:
        issues.append({"code": "V11", "severity": "warning", "message": f"L'objectif ({om}) ne fait pas partie des métriques de {pt['label']}."})
    return issues


def clone(obj: Any) -> Any:
    return copy.deepcopy(obj)

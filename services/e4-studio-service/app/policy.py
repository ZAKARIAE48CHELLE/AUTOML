"""Governance policy and structural validation for workflow specs.

Python port of packages/contracts/src/policy.ts (requirements / satisfies) so the
real backend enforces exactly what the web client's mock enforces.
"""
import datetime
from typing import Any, Callable, Dict, List, Optional

# Same caps as E2 GET /training/resources (budget_caps).
BUDGET_CAPS = {"trials": 100, "max_minutes": 60, "models": 10}


def class_of(node_type: str, catalog: Dict[str, Dict[str, Any]]) -> str:
    return catalog.get(node_type, {}).get("operation_class", "L0")


def requirements(spec: Dict[str, Any], mode: str, catalog: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    nodes = spec.get("nodes", [])

    def ids(c: str) -> List[str]:
        return [n["id"] for n in nodes if class_of(n.get("type", ""), catalog) == c]

    out: List[Dict[str, Any]] = []
    l2, l3 = ids("L2"), ids("L3")
    if l2:
        if mode == "auto":
            out.append({"operation_class": "L2", "node_ids": l2, "individual": False, "kind": "plan"})
        elif mode == "guided":
            out += [{"operation_class": "L2", "node_ids": [i], "individual": True, "kind": "step"} for i in l2]
        else:  # expert: the user's click is the (journaled) approval
            out.append({"operation_class": "L2", "node_ids": l2, "individual": False, "kind": "click"})
    out += [{"operation_class": "L3", "node_ids": [i], "individual": True, "kind": "individual"} for i in l3]
    return out


def budget_needs(spec: Dict[str, Any]) -> Dict[str, int]:
    nodes = spec.get("nodes", [])
    tune = [n for n in nodes if n.get("type") == "train.tune"]

    def budget(n: Dict[str, Any], k: str) -> int:
        return int(((n.get("params") or {}).get("budget") or {}).get(k, 0) or 0)

    return {
        "trials": sum(budget(n, "trials") for n in tune),
        "max_minutes": sum(budget(n, "max_minutes") for n in tune),
        "models": len([n for n in nodes if str(n.get("type", "")).startswith("train.")]),
    }


def within_budget(need: Dict[str, int], b: Optional[Dict[str, int]]) -> bool:
    return bool(b) and all(need[k] <= b.get(k, 0) for k in ("trials", "max_minutes", "models"))


def parse_ts(s: str) -> datetime.datetime:
    dt = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=datetime.timezone.utc)


def is_live(a: Dict[str, Any], now: Optional[datetime.datetime] = None) -> bool:
    now = now or datetime.datetime.now(datetime.timezone.utc)
    return a.get("status") == "active" and parse_ts(a["expires_at"]) >= now


def satisfies(a: Dict[str, Any], r: Dict[str, Any], content_hash: str, spec: Dict[str, Any],
              in_lineage: Callable[[Dict[str, Any]], bool]) -> bool:
    if not is_live(a):
        return False
    if r["operation_class"] not in a.get("operation_classes", []):
        return False
    if a.get("content_hash") != content_hash:
        if not (a.get("scope") == "lineage" and r["operation_class"] != "L3" and in_lineage(a)):
            return False
    if r["kind"] == "plan":
        return within_budget(budget_needs(spec), a.get("budget"))
    if r["kind"] in ("step", "individual"):
        node_ids = a.get("node_ids") or []
        return all(i in node_ids for i in r["node_ids"])
    return True


def missing_requirements(spec, mode, approvals, content_hash, in_lineage, catalog) -> List[Dict[str, Any]]:
    return [r for r in requirements(spec, mode, catalog)
            if r["kind"] != "click" and not any(satisfies(a, r, content_hash, spec, in_lineage) for a in approvals)]


def policy_issues(spec, mode, approvals, content_hash, in_lineage, catalog) -> List[Dict[str, Any]]:
    messages = {
        "plan": "Approbation de plan (avec budget) requise pour les étapes coûteuses.",
        "individual": "Approbation individuelle explicite requise (action engageante).",
        "step": "Approbation requise pour cette étape.",
    }
    issues = []
    for r in missing_requirements(spec, mode, approvals, content_hash, in_lineage, catalog):
        issues.append({"code": "P_APPROVAL", "severity": "warning",
                       "node_id": r["node_ids"][0] if len(r["node_ids"]) == 1 else None,
                       "message": messages[r["kind"]],
                       "hint": "Approuvez cette version dans le mode revue avant de lancer l'exécution."})
    if mode == "expert":
        issues.append({"code": "P_EXPERT", "severity": "info",
                       "message": "Mode Expert : le clic « Lancer » vaut approbation des étapes L2 (journalisé)."})
    return issues


def structure_issues(spec: Dict[str, Any], catalog: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Graph-level checks: node types, ids, required params, edges/ports and cycles."""
    issues: List[Dict[str, Any]] = []
    nodes = spec.get("nodes", [])
    by_id: Dict[str, Dict[str, Any]] = {}
    for n in nodes:
        if n["id"] in by_id:
            issues.append({"code": "S_DUPLICATE_NODE", "severity": "error", "node_id": n["id"],
                           "message": f"Identifiant de nœud dupliqué : {n['id']}"})
        by_id[n["id"]] = n
        nt = catalog.get(n.get("type"))
        if nt is None:
            issues.append({"code": "S_UNKNOWN_NODE_TYPE", "severity": "error", "node_id": n["id"],
                           "message": f"Type de nœud inconnu : {n.get('type')}"})
            continue
        for p in nt["params_schema"].get("required", []):
            if (n.get("params") or {}).get(p) in (None, ""):
                issues.append({"code": "S_MISSING_PARAM", "severity": "error", "node_id": n["id"],
                               "path": f"params.{p}", "message": f"Paramètre requis manquant : {p}"})

    incoming: Dict[str, Dict[str, int]] = {n["id"]: {} for n in nodes}
    adj: Dict[str, List[str]] = {n["id"]: [] for n in nodes}
    for e in spec.get("edges", []):
        src, dst = e["from"], e["to"]
        sn, dn = by_id.get(src["node"]), by_id.get(dst["node"])
        if sn is None or dn is None:
            issues.append({"code": "S_DANGLING_EDGE", "severity": "error", "path": f"edges.{e['id']}",
                           "message": f"Arête {e['id']} vers un nœud inexistant."})
            continue
        st, dt = catalog.get(sn.get("type")), catalog.get(dn.get("type"))
        if st and dt:
            out_port = next((p for p in st["output_ports"] if p["name"] == src["port"]), None)
            in_port = next((p for p in dt["input_ports"] if p["name"] == dst["port"]), None)
            if out_port is None or in_port is None:
                issues.append({"code": "S_UNKNOWN_PORT", "severity": "error", "path": f"edges.{e['id']}",
                               "message": f"Port inconnu sur l'arête {e['id']}."})
                continue
            if out_port["type"] != in_port["type"]:
                issues.append({"code": "S_PORT_TYPE_MISMATCH", "severity": "error", "path": f"edges.{e['id']}",
                               "message": f"Types incompatibles : {out_port['type']} → {in_port['type']}."})
            cnt = incoming[dn["id"]].get(in_port["name"], 0) + 1
            incoming[dn["id"]][in_port["name"]] = cnt
            if cnt > 1 and not in_port.get("multiple"):
                issues.append({"code": "S_PORT_MULTIPLE", "severity": "error", "node_id": dn["id"],
                               "message": f"Le port {in_port['name']} n'accepte qu'une seule connexion."})
        adj[sn["id"]].append(dn["id"])

    for n in nodes:
        nt = catalog.get(n.get("type"))
        for p in (nt or {}).get("input_ports", []):
            if p["name"] not in incoming.get(n["id"], {}):
                issues.append({"code": "S_UNCONNECTED_INPUT", "severity": "warning", "node_id": n["id"],
                               "message": f"Entrée « {p['name']} » non connectée."})

    # Cycle detection: iterative DFS with white(0)/grey(1)/black(2) colouring.
    color = {i: 0 for i in adj}
    found_cycle = False
    for start in adj:
        if color[start] or found_cycle:
            continue
        stack = [(start, iter(adj[start]))]
        color[start] = 1
        while stack:
            node, it = stack[-1]
            nxt = next(it, None)
            if nxt is None:
                color[node] = 2
                stack.pop()
            elif color.get(nxt) == 1:
                issues.append({"code": "S_CYCLE", "severity": "error", "node_id": nxt,
                               "message": "Le workflow contient un cycle : un DAG est requis."})
                found_cycle = True
                break
            elif color.get(nxt) == 0:
                color[nxt] = 1
                stack.append((nxt, iter(adj[nxt])))
    return issues


def layer_status(issues: List[Dict[str, Any]]) -> str:
    if any(i["severity"] == "error" for i in issues):
        return "error"
    if any(i["severity"] == "warning" for i in issues):
        return "warning"
    return "ok"

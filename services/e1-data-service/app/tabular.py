import re
"""CSV ingestion, type inference, profiling and split helpers for E1.

Works on a bounded sample (PREVIEW_MAX_ROWS) kept in the database; the full row
count and checksum are computed by streaming the whole file once.
"""
import csv
import hashlib
import io
import math
import random
import statistics
from collections import Counter
from typing import Any, BinaryIO, Dict, List, Optional, Tuple

PREVIEW_MAX_ROWS = 1000
NA_TOKENS = {"", "na", "n/a", "nan", "null", "none"}
CANDIDATE_DELIMITERS = [",", ";", "\t", "|"]
NUMERIC = ("int", "float")


class CsvError(ValueError):
    pass


def _is_na(v: Optional[str]) -> bool:
    return v is None or v.strip().lower() in NA_TOKENS


def _parses(v: str, fn) -> bool:
    try:
        x = fn(v)
    except (ValueError, OverflowError):
        return False
    return not (isinstance(x, float) and (math.isnan(x) or math.isinf(x)))


def _clean_header(raw: List[str]) -> List[str]:
    out, seen = [], Counter()
    for i, h in enumerate(raw):
        name = h.strip() or f"col_{i + 1}"
        seen[name] += 1
        out.append(name if seen[name] == 1 else f"{name}_{seen[name]}")
    return out


def _pick_delimiter(first_line: str) -> str:
    counts = {d: first_line.count(d) for d in CANDIDATE_DELIMITERS}
    best = max(counts, key=counts.get)
    return best if counts[best] > 0 else ","


_IMAGE_RE = re.compile(r"\.(jpe?g|png|bmp|gif|webp|tiff?)$", re.I)
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?")


def infer_dtype(values: List[Optional[str]]) -> Tuple[str, bool]:
    present = [v.strip() for v in values if not _is_na(v)]
    nullable = len(present) < len(values)
    if not present:
        return "string", True
    if all(_parses(v, int) for v in present):
        return "int", nullable
    if all(_parses(v, float) for v in present):
        return "float", nullable
    if all(v.lower() in ("true", "false") for v in present):
        return "bool", nullable
    sample = present[:200]
    if all(_IMAGE_RE.search(v) for v in sample):
        return "image_path", nullable
    if all(_DATE_RE.match(v) for v in sample):
        return "datetime", nullable
    if sum(len(v) for v in sample) / len(sample) > 40 and sum(" " in v for v in sample) > 0.8 * len(sample):
        return "text", nullable
    uniq = len(set(present))
    if uniq <= 20 and uniq <= 0.5 * len(present):
        return "category", nullable
    return "string", nullable


def convert(v: Optional[str], dtype: str) -> Any:
    if _is_na(v):
        return None
    v = v.strip()
    if dtype == "int":
        return int(v)
    if dtype == "float":
        return float(v)
    if dtype == "bool":
        return v.lower() == "true"
    return v


class _HashingReader(io.RawIOBase):
    """Raw reader that feeds every byte read through sha256 (closing it leaves `f` open)."""

    def __init__(self, f: BinaryIO, hasher):
        self._f, self._h = f, hasher

    def readable(self) -> bool:
        return True

    def readinto(self, b) -> int:
        data = self._f.read(len(b))
        self._h.update(data)
        b[:len(data)] = data
        return len(data)


def parse_csv(f: BinaryIO, max_rows: int = PREVIEW_MAX_ROWS) -> Dict[str, Any]:
    """Stream a CSV file once. Returns schema, typed sample rows, total row count and sha256."""
    hasher = hashlib.sha256()
    text = io.TextIOWrapper(io.BufferedReader(_HashingReader(f, hasher)),
                            encoding="utf-8-sig", errors="replace", newline="")

    first = text.readline()
    while first and not first.strip():
        first = text.readline()
    if not first:
        raise CsvError("Le fichier est vide.")

    delimiter = _pick_delimiter(first)

    def all_lines():
        yield first
        yield from text

    reader = csv.reader(all_lines(), delimiter=delimiter)
    header = _clean_header(next(reader))
    raw_rows: List[List[Optional[str]]] = []
    total = 0
    for rec in reader:
        if not any(c.strip() for c in rec):
            continue
        total += 1
        if len(raw_rows) < max_rows:
            rec = rec[:len(header)] + [None] * (len(header) - len(rec))
            raw_rows.append(rec)
    text.read()  # drain so the checksum covers the whole file
    if total == 0:
        raise CsvError("Le fichier ne contient aucune ligne de données.")

    schema: List[Dict[str, Any]] = []
    rows: List[Dict[str, Any]] = [dict() for _ in raw_rows]
    for i, name in enumerate(header):
        col = [r[i] for r in raw_rows]
        dtype, nullable = infer_dtype(col)
        schema.append({"name": name, "dtype": dtype, "nullable": nullable})
        for row, v in zip(rows, col):
            row[name] = convert(v, dtype)

    return {
        "schema": schema,
        "rows": rows,
        "total_rows": total,
        "checksum": f"sha256:{hasher.hexdigest()}",
        "delimiter": delimiter,
    }


def build_profile(schema: List[Dict[str, Any]], rows: List[Dict[str, Any]], total_rows: int) -> Dict[str, Any]:
    n = len(rows) or 1
    scale = (total_rows / len(rows)) if rows else 1.0
    columns, alerts = [], []
    for c in schema:
        name, dtype = c["name"], c["dtype"]
        vals = [r.get(name) for r in rows]
        present = [v for v in vals if v is not None and v != ""]
        missing_pct = round((len(vals) - len(present)) / n * 100, 1)
        unique = len(set(present))
        col: Dict[str, Any] = {"name": name, "dtype": dtype, "missing_pct": missing_pct, "unique": unique}
        if dtype in NUMERIC and present:
            nums = [float(v) for v in present]
            lo, hi = min(nums), max(nums)
            bins = 8
            width = (hi - lo) / bins or 1.0
            hist = [{"bin": f"{round(lo + i * width, 2):g}", "count": 0} for i in range(bins)]
            for v in nums:
                hist[min(bins - 1, int((v - lo) / width))]["count"] += 1
            if scale != 1.0:
                for h in hist:
                    h["count"] = round(h["count"] * scale)
            col.update(mean=round(statistics.fmean(nums), 4), std=round(statistics.pstdev(nums), 4),
                       min=lo, max=hi, histogram=hist)
        elif present:
            top = Counter(str(v) for v in present).most_common(6)
            col["top"] = [{"value": v, "count": round(k * scale)} for v, k in top]
        columns.append(col)

        if dtype in ("string", "category") and len(present) > 1 and unique == len(present):
            alerts.append({"code": "HIGH_CARDINALITY", "severity": "warning", "column": name,
                           "message": "Colonne identifiant (valeurs uniques) : à exclure des variables explicatives."})
        if present and unique == 1 and len(present) > 1:
            alerts.append({"code": "CONSTANT", "severity": "warning", "column": name,
                           "message": "Colonne constante : aucune information pour le modèle."})
        if missing_pct > 0:
            alerts.append({"code": "MISSING", "severity": "warning" if missing_pct > 10 else "info", "column": name,
                           "message": f"{missing_pct} % de valeurs manquantes."})
    return {"columns": columns, "alerts": alerts, "sampled": len(rows) < total_rows}


def split_counts(total: int, test_ratio: float, cv_folds: int, val_ratio: Optional[float]) -> Dict[str, int]:
    test = round(total * test_ratio)
    rest = total - test
    val = round(rest / cv_folds) if cv_folds > 1 else round(rest * (val_ratio or 0.0))
    return {"train": rest - val, "validation": val, "test": test}


def target_distribution(rows: List[Dict[str, Any]], target: str, test_ratio: float, seed: int,
                        stratified: bool) -> List[Dict[str, Any]]:
    """Label shares in train/test for a seeded split of the stored sample."""
    labelled = [r for r in rows if r.get(target) is not None]
    if not labelled:
        return []
    rng = random.Random(seed)
    train: List[Dict[str, Any]] = []
    test: List[Dict[str, Any]] = []
    if stratified:
        groups: Dict[str, List[Dict[str, Any]]] = {}
        for r in labelled:
            groups.setdefault(str(r[target]), []).append(r)
        for key in sorted(groups):
            g = groups[key][:]
            rng.shuffle(g)
            k = round(len(g) * test_ratio)
            test += g[:k]
            train += g[k:]
    else:
        shuffled = labelled[:]
        rng.shuffle(shuffled)
        k = round(len(shuffled) * test_ratio)
        test, train = shuffled[:k], shuffled[k:]
    tr, te = Counter(str(r[target]) for r in train), Counter(str(r[target]) for r in test)
    labels = sorted(set(tr) | set(te))
    return [{"label": lab,
             "train": round(tr[lab] / len(train), 3) if train else 0.0,
             "test": round(te[lab] / len(test), 3) if test else 0.0} for lab in labels]

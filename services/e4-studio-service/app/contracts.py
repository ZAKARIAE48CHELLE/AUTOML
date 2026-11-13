"""Shared pipeline contracts (packages/contracts) — the same catalog the web client reads.

In Docker the folder is mounted read-only at CONTRACTS_DIR; locally the repository copy is used.
"""
import importlib.util
import os
from pathlib import Path

_DIR = Path(os.getenv("CONTRACTS_DIR") or Path(__file__).resolve().parents[3] / "packages" / "contracts")
_PATH = _DIR / "py" / "aistudio_contracts.py"
if not _PATH.is_file():
    raise RuntimeError(f"Contrats partagés introuvables : {_PATH} (montez packages/contracts et définissez CONTRACTS_DIR).")
_spec = importlib.util.spec_from_file_location("aistudio_contracts", _PATH)
contracts = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(contracts)

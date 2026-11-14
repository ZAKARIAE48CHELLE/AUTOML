# AutoML Unified Studio Web Interface

A standalone, non-intrusive web interface integrating all 8 AutoML projects:
- **AutoGluon** (01)
- **FLAML** (02)
- **H2O AutoML** (03)
- **PyCaret** (04)
- **TPOT** (05)
- **Auto-sklearn** (06)
- **TabPFN** (07)
- **Agentic AutoML** (08)

---

## Key Features

1. **Integrated Multi-Project Control Plane**: Switch seamlessly across all 8 AutoML projects.
2. **Live Dataset & Schema Viewer**: Inspect generated datasets, sample distributions, and column types.
3. **Interactive AutoML Pipeline Runner**: Launch optimization loops, stacking ensembles, or multi-agent self-healing cycles.
4. **Interactive Prediction Playground**: Test custom feature vectors and observe real-time predictions, decision confidence, and inference latency.
5. **Floating Bottom-Right Page Guide**: Docked at `bottom-4 right-4` on every page to provide instant documentation, CLI commands, OS prerequisites, and direct access to the project manual.
6. **Zero Impact on Existing Projects**: Completely self-contained within this folder; leaves existing code in projects `01` through `08` untouched.

---

## Quickstart

Run the interface using Python / Uvicorn:

```bash
cd D:\EMSI\5emme\AUTOML\automl_projects\automl_web_interface
python -m uvicorn app:app --host 0.0.0.0 --port 8501 --reload
```

Or double-click `start_interface.bat` on Windows.

Open your browser at:
👉 **[http://localhost:8501](http://localhost:8501)**

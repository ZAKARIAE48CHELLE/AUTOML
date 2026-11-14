# Agentic AutoML Project Manual: Multi-Agent LLM Orchestration

## 1. Overview & Paradigm
**Agentic AutoML** represents the convergence of Large Language Models (LLMs), autonomous multi-agent frameworks (e.g. Microsoft AutoGen, LangGraph, MLZero), and Machine Learning automation.

Instead of running black-box combinatorial parameter searches:
- Specialized AI agents collaborate in natural language and code.
- **Architect Agent**: Inspects business context, column distributions, and recommends pipeline architectures (e.g. feature scalers, categorical encoders, model family).
- **Coder Agent**: Writes production-grade Python/PyTorch/scikit-learn pipeline code following software engineering best practices.
- **Reviewer Agent**: Intercepts script execution in a sandbox, traps runtime errors, stack traces, and data mismatches, and sends structured diagnostics back to the Coder agent for instant self-healing.

---

## 2. Prerequisites & Environment
- **Operating Systems**: Windows, Linux, macOS.
- **Python Version**: 3.10 to 3.13.
- **Core Dependencies**: `pandas`, `numpy`, `scikit-learn`, `joblib`.
- **LLM Integrations (Optional)**: Compatible with local or cloud LLM backends (OpenAI API, Anthropic Claude, Google Gemini, Ollama) via AutoGen or custom agent harnesses.

---

## 3. Installation
Install project dependencies:

```bash
pip install -r requirements.txt
```

---

## 4. Project Structure
```
08_agentic_automl_project/
├── requirements.txt              # Standard Python scientific stack
├── dataset.py                    # Generates customer lifetime value (CLV) dataset
├── agent_system.py               # Implements Architect, Coder, and Reviewer agents
├── run_agentic_pipeline.py       # Orchestrates the autonomous multi-agent execution loop
├── verified_agentic_pipeline.py  # Production-ready code produced and verified by agents
└── MANUAL.md                     # Complete operating manual
```

---

## 5. Step-by-Step Usage Guide

### Step 1: Generate Dataset
```bash
python dataset.py
```
Generates `customer_lifetime_value.csv` with 1,500 customer records featuring mixed categorical attributes (device), continuous metrics (average cart value), discrete counters (annual visits), and lifetime revenue values.

### Step 2: Run Autonomous Multi-Agent Loop
```bash
python run_agentic_pipeline.py
```
- **Architect Turn**: Inspects column types, spots identifiers (`customer_id`), classifies problem as `REGRESSION`, and sets primary evaluation metric to $R^2$ and RMSE.
- **Coder Turn**: Generates `ColumnTransformer` with `StandardScaler` for numeric values and `OneHotEncoder` for categorical values, followed by `HistGradientBoostingRegressor`.
- **Reviewer Turn**: Executes pipeline in sandbox, confirms zero exceptions, checks regression score ($R^2 > 0.94$), and writes out `verified_agentic_pipeline.py`.

---

## 6. Production Deployment Summary
| Attribute | Specification |
|---|---|
| **Paradigm** | Agentic AI (Multi-Agent LLM Orchestration & Self-Healing Execution) |
| **Output** | Production-ready, human-readable Python pipeline code (`.py`) |
| **Execution Latency** | Instantaneous inference once generated and compiled (5 - 20 ms) |
| **Self-Correction** | Automatic runtime error trapping and multi-turn iterative repair |
| **Ideal Use Case** | Bespoke enterprise problem formulation, multimodal AutoML, automated code reviews, transparent pipeline generation |

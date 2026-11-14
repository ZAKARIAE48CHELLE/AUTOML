# TPOT Project Manual: Genetic Programming Pipeline Optimization

## 1. Overview & Paradigm
**TPOT** (Tree-based Pipeline Optimization Tool) uses **Genetic Programming** (powered by the DEAP library) to explore and construct end-to-end scikit-learn machine learning pipelines.

### Key Characteristics:
- **Evolutionary Pipeline Search**: Generates dynamic tree pipelines combining data cleaners, feature selectors (RFE, VarianceThreshold), transformers (PCA, Scalers), and estimators.
- **Genetic Operations**: Performs mutations, crossover, and fitness evaluations across generations of pipelines.
- **Audit-Ready Native Python Export**: Instead of saving a proprietary binary format, TPOT exports a **pure, readable Python script (`.py`)** containing standard `scikit-learn` code. The deployed model requires **ZERO TPOT runtime dependency**!

---

## 2. Prerequisites & Environment
- **Operating Systems**: Windows, Linux, macOS.
- **Python Version**: 3.10 to 3.13.
- **Core Dependencies**: `tpot`, `deap`, `scikit-learn`, `numpy`, `scipy`.

---

## 3. Installation
Install TPOT:

```bash
pip install tpot
```

Or install local project dependencies:
```bash
pip install -r requirements.txt
```

---

## 4. Project Structure
```
05_tpot_project/
├── requirements.txt           # Dependencies (tpot, scikit-learn, pandas, deap)
├── dataset.py                 # Generates cybersecurity network intrusion dataset
├── train.py                   # Runs genetic search and exports clean native Python code
├── tpot_exported_pipeline.py  # Generated pure scikit-learn script (Zero TPOT dependency)
├── predict.py                 # Evaluates and serves the exported native scikit-learn pipeline
└── MANUAL.md                  # Complete operating manual
```

---

## 5. Step-by-Step Usage Guide

### Step 1: Generate Dataset
```bash
python dataset.py
```
Outputs `network_traffic.csv` containing network traffic attributes (packet duration, protocols, failed logins, transfer sizes, anomaly labels).

### Step 2: Run Genetic Optimization
```bash
python train.py
```
- Evolves pipeline trees over `generations=3` with `population_size=15`.
- Evaluates pipelines using cross-validated ROC-AUC.
- Generates `tpot_exported_pipeline.py` containing the winning scikit-learn pipeline.

### Step 3: Serve the Audited Code in Production
```bash
python predict.py
```
- Imports the exported scikit-learn components (`make_pipeline`, `RobustScaler`, `ExtraTreesClassifier`).
- Executes fast scoring (5 - 20 ms latency) without requiring TPOT to be installed in the serving container.

---

## 6. Production Deployment Summary
| Attribute | Specification |
|---|---|
| **Serialization Formats** | **Native Python Source Code (`.py`)** |
| **Inference Latency** | 5 - 20 ms |
| **Python Dependency** | Yes (standard `scikit-learn` only; **zero** TPOT dependency) |
| **Ideal Use Case** | Highly regulated sectors (banking, healthcare, defense) requiring code auditing, legal compliance, and transparent source reviews |

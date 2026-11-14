# FLAML Project Manual: Fast & Lightweight AutoML (Microsoft Research)

## 1. Overview & Paradigm
**FLAML** (Fast and Lightweight AutoML) is developed by Microsoft Research. It is engineered for scenarios where computational resources, memory, or execution time are strictly capped.

### Key Characteristics:
- **BlendSearch Algorithm**: Combines global exploration (Bayesian optimization) with rapid local exploitation (cost-frugal search). It tests small, fast models first before scaling to heavier models.
- **Budget-Aware Optimization**: Explicitly takes a `time_budget` parameter (e.g. 30s, 60s, 300s) and guarantees the best possible model within that timeframe.
- **Low Memory Footprint**: Runs seamlessly on single-core laptops or resource-constrained container instances.
- **Distributed Scaling**: Optional cluster parallelization via Ray or Apache Spark.

---

## 2. Prerequisites & Environment
- **Operating Systems**: Windows, Linux, macOS.
- **Python Version**: 3.10 to 3.13.
- **Distributed Computing (Optional)**: Ray (`pip install ray`) or Apache Spark (`pip install pyspark`).

---

## 3. Installation
Install FLAML in your environment:

```bash
# Standard installation
pip install flaml[automl]

# With Ray / Spark distributed support:
pip install flaml[automl,ray,spark]
```

Or install using the local project requirements:
```bash
pip install -r requirements.txt
```

---

## 4. Project Structure
```
02_flaml_project/
├── requirements.txt       # Dependencies (flaml, scikit-learn, pandas, joblib)
├── dataset.py             # Generates realistic loan default dataset
├── train.py               # Runs budget-constrained BlendSearch and exports model
├── predict.py             # Loads trained model and scores loan applicants
└── MANUAL.md              # Complete operating manual
```

---

## 5. Step-by-Step Usage Guide

### Step 1: Generate Dataset
```bash
python dataset.py
```
Outputs `loan_default_data.csv` with synthetic loan applicants detailing credit score, debt-to-income ratio, annual income, home ownership, and loan intent.

### Step 2: Run FLAML Training Under Budget
```bash
python train.py
```
- Sets a strict `time_budget=30` (30 seconds).
- Explores LightGBM (`lgbm`), Random Forest (`rf`), XGBoost, Extra Trees, and CatBoost.
- Logs search steps to `flaml_search.log`.
- Outputs the winning estimator, optimal hyperparameters, and test ROC-AUC.
- Persists model artifact to `flaml_best_model.pkl`.

### Step 3: Run Fast Inference
```bash
python predict.py
```
Loads `flaml_best_model.pkl` and predicts approval status and default risk on incoming applications with sub-10ms response time.

---

## 6. Production Deployment Summary
| Attribute | Specification |
|---|---|
| **Serialization Formats** | Python Pickle / Joblib / MLflow Model Registry |
| **Inference Latency** | 10 - 20 ms |
| **Python Dependency** | Yes (Python + standard scikit-learn/LightGBM dependencies) |
| **Ideal Use Case** | Severely constrained CPU/RAM budgets, edge containers, fast prototyping, real-time AutoML retraining pipelines |

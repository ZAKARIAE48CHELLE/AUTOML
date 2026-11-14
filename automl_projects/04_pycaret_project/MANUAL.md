# PyCaret Project Manual: Low-Code Object-Oriented MLOps

## 1. Overview & Paradigm
**PyCaret** is an open-source, low-code machine learning library written in Python that wraps existing machine learning frameworks (scikit-learn, XGBoost, LightGBM, CatBoost) inside an intuitive, Object-Oriented MLOps architecture.

### Key Characteristics:
- **Unified Pipeline Orchestration**: A single call (`exp.setup(...)`) constructs an end-to-end preprocessing pipeline including missing value imputation, one-hot encoding, categorical binning, variance thresholding, and feature scaling.
- **Side-by-Side Model Comparison**: `exp.compare_models()` automatically evaluates 15+ candidate architectures under cross-validation.
- **Integrated MLOps & Interpretability**: Direct support for MLflow experiment tracking, SHAP interpretability graphs, and automated hyperparameter tuning.
- **Single-Artifact Pipeline Export**: `exp.save_model(...)` packages preprocessing transformers AND the trained estimator together in one `.pkl` artifact.

---

## 2. Prerequisites & Environment
- **Operating Systems**: Windows, Linux, macOS.
- **Python Version**: 3.10 to 3.13.
- **GPU Acceleration (Optional)**: RAPIDS cuML (`pip install pycaret[cuml]`).

---

## 3. Installation
Install PyCaret:

```bash
# Full installation with all dependencies
pip install pycaret[full]

# Lightweight core installation
pip install pycaret
```

Or install local project dependencies:
```bash
pip install -r requirements.txt
```

---

## 4. Project Structure
```
04_pycaret_project/
├── requirements.txt       # Dependencies (pycaret, scikit-learn, pandas, mlflow)
├── dataset.py             # Generates medical cardiovascular diagnostic dataset
├── train.py               # Runs PyCaret setup, comparison, tuning, and pipeline export
├── predict.py             # Loads end-to-end pickled pipeline and predicts on raw data
└── MANUAL.md              # Complete operating manual
```

---

## 5. Step-by-Step Usage Guide

### Step 1: Generate Dataset
```bash
python dataset.py
```
Generates `heart_disease.csv` simulating clinical observations (blood pressure, cholesterol, ECG/chest pain types, max heart rate, and heart disease diagnosis).

### Step 2: Run PyCaret Experiment & Tuning
```bash
python train.py
```
- Sets up `ClassificationExperiment` with automated normalization and validation split.
- Compares multiple classifiers (Random Forest, LightGBM, Gradient Boosting, Logistic Regression).
- Automatically selects the highest AUC model and tunes hyperparameters.
- Finalizes the pipeline across the complete dataset and exports `cardio_pipeline.pkl`.

### Step 3: Run End-to-End Pipeline Inference
```bash
python predict.py
```
Loads `cardio_pipeline.pkl` using `load_model()` and passes completely raw, unencoded records. The pipeline handles all preprocessing transformations and returns `prediction_label` and `prediction_score`.

---

## 6. Production Deployment Summary
| Attribute | Specification |
|---|---|
| **Serialization Formats** | Scikit-learn Pipeline `.pkl` / MLflow Model Registry |
| **Inference Latency** | 10 - 50 ms |
| **Python Dependency** | Yes (Python + scikit-learn / pycaret runtime) |
| **Ideal Use Case** | Rapid experimentation, MLOps tracking, fast business validation with rich interpretability (SHAP) |

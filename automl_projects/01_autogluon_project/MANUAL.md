# AutoGluon Project Manual: Multi-layer Stacking & Tabular AutoML

## 1. Overview & Paradigm
**AutoGluon** (developed by Amazon Web Services) is recognized as the leading AutoML library on the independent **TabArena** benchmark.
Its core paradigm revolves around:
- **Multi-layer Stacking & Ensembling**: Trains multiple families of models (XGBoost, CatBoost, LightGBM, neural networks, random forests) across multi-layer cascades, combining predictions via meta-learners with out-of-fold cross-validation to prevent data leakage.
- **Tabular Foundation Models**: Native support for modern deep learning architectures and foundation models.
- **Zero Data Preprocessing Burden**: Handles missing values, mixed types (text, categorical, dates, numeric), and normalization automatically.

---

## 2. Prerequisites & Environment
- **Operating Systems**: Windows, Linux, macOS.
  - *macOS note*: Requires `libomp` for LightGBM (`brew install libomp`).
- **Python Version**: 3.10 to 3.13.
- **Hardware Recommended**: Multi-core CPU (16 GB+ RAM); NVIDIA GPU recommended for `extreme` preset and deep learning backends.

---

## 3. Installation
Activate your virtual environment and install AutoGluon:

```bash
# Standard tabular installation
pip install autogluon.tabular[all]

# Or with full GPU foundation models:
pip install autogluon
```

To install local project requirements:
```bash
pip install -r requirements.txt
```

---

## 4. Project Structure
```
01_autogluon_project/
├── requirements.txt       # Project dependencies
├── dataset.py             # Generates realistic customer churn tabular dataset
├── train.py               # Fits TabularPredictor, shows leaderboard & metrics
├── predict.py             # Loads trained predictor & performs batch inference
├── export_onnx.py         # Explains and demonstrates ONNX deployment pipeline
└── MANUAL.md              # Complete operating manual
```

---

## 5. Step-by-Step Usage Guide

### Step 1: Generate Dataset
```bash
python dataset.py
```
Outputs `customer_churn.csv` with 2,000 synthetic records simulating customer demographics, billing, contract terms, customer service calls, and churn target.

### Step 2: Model Training & Stacking
```bash
python train.py
```
- Fits `TabularPredictor(label='churn', problem_type='binary', eval_metric='roc_auc')`.
- Explores presets: `medium_quality` (balanced) or `best_quality` (full multi-layer stacking with out-of-fold ensembling).
- Displays leaderboard showing all models, validation scores, and stacking weights.
- Saves model artifacts to `./autogluon_models`.

### Step 3: Run Production Inference
```bash
python predict.py
```
- Loads the persisted predictor with `TabularPredictor.load('./autogluon_models')`.
- Returns both class predictions (0 or 1) and churn probabilities (0.0 to 1.0) on unseen customers.

### Step 4: Low-Latency ONNX Deployment
```bash
python export_onnx.py
```
- Explains serialization to ONNX Runtime for deployment in C++, Go, or high-throughput microservices (achieving 1–5 ms latency).

---

## 6. Production Deployment Summary
| Attribute | Specification |
|---|---|
| **Serialization Formats** | PyTorch / Pickle / ONNX |
| **Inference Latency** | 1 - 5 ms (ONNX) / 10 - 30 ms (Python native) |
| **Python Dependency** | Optional (Can run in C++/Go via ONNX Runtime) |
| **Ideal Use Case** | Maximum predictive precision on structured/tabular enterprise data |

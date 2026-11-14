# Auto-sklearn Project Manual: Meta-Learning & Bayesian Optimization

## 1. Overview & Paradigm
**Auto-sklearn** is the pioneering automated machine learning toolkit built on top of `scikit-learn`.

### Key Characteristics:
- **Meta-Learning Warm Start (OpenML)**: Computes meta-features of the input dataset (number of samples, feature skewness, dimensionality, entropy) and initializes the search with algorithm configurations that succeeded on similar OpenML datasets.
- **Bayesian Optimization via SMAC3**: Uses Sequential Model-based Algorithm Configuration (Random Forest surrogate models) to navigate hyperparameters and data preprocessing steps.
- **Post-Hoc Ensemble Building**: Constructs an ensemble of the best models identified during optimization using ensemble selection.

---

## 2. Prerequisites & Environment
- **Operating Systems**: **Linux only** (Ubuntu, Debian, CentOS).
  - *Windows / macOS Requirement*: Must run via **Docker** or **WSL2** (Windows Subsystem for Linux).
- **Python Version**: 3.8 to 3.10.
- **System Unix Packages**:
  - `swig`
  - `build-essential` (C++11 compiler: `gcc`, `g++`)
  - `python3-dev`

---

## 3. Installation

### Method A: Docker (Recommended on Windows/macOS)
Build and run the provided container:
```bash
docker build -t autosklearn-project .
docker run --rm -v ${PWD}:/app autosklearn-project
```

### Method B: Native Linux / WSL2
```bash
sudo apt-get update && sudo apt-get install -y swig build-essential python3-dev
pip install auto-sklearn
pip install -r requirements.txt
```

---

## 4. Project Structure
```
06_autosklearn_project/
├── Dockerfile             # Multi-stage Linux container with SWIG & C++11 toolchain
├── requirements.txt       # Dependencies (auto-sklearn, scikit-learn, pandas, joblib)
├── dataset.py             # Generates bank marketing term deposit dataset
├── train.py               # Runs SMAC3 Bayesian search + OpenML meta-learning
├── predict.py             # Loads pickled ensemble and runs batch scoring
└── MANUAL.md              # Complete operating manual
```

---

## 5. Step-by-Step Usage Guide

### Step 1: Generate Dataset
```bash
python dataset.py
```
Creates `bank_marketing.csv` simulating telemarketing campaigns (call durations, account balances, loan status, campaign frequency, and deposit conversions).

### Step 2: Run Meta-Learning & Bayesian Optimization
```bash
# Via Python (Linux/WSL) or Docker
python train.py
```
- Extracts dataset meta-features and warm-starts using the top 15 OpenML configurations.
- Executes Bayesian optimization rounds via SMAC3.
- Builds an ensemble of models and saves `autosklearn_model.pkl`.

### Step 3: Run Production Scoring
```bash
python predict.py
```
Loads `autosklearn_model.pkl` and predicts conversion probability on incoming leads.

---

## 6. Production Deployment Summary
| Attribute | Specification |
|---|---|
| **Serialization Formats** | Standard Scikit-learn Pipeline via Pickle / Joblib |
| **Inference Latency** | 10 - 50 ms |
| **Python Dependency** | Yes (Linux-compatible Python environment) |
| **Ideal Use Case** | Academic research, benchmarks against standard scikit-learn baselines, Linux-based serverless or batch jobs |

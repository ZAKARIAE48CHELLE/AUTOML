# H2O AutoML Project Manual: Distributed In-Memory Engine (H2O.ai)

## 1. Overview & Paradigm
**H2O AutoML** is an enterprise-grade automated machine learning engine written in Java and executed inside a distributed JVM (Java Virtual Machine).

### Key Characteristics:
- **Parallel In-Memory Execution**: Distributes data structures and model calculations efficiently across all CPU cores or a cluster of physical nodes.
- **Stacked Ensembles**: Combines base algorithms (Distributed Random Forest, Extremely Randomized Trees, Generalized Linear Models, XGBoost, LightGBM, and Deep Learning Neural Nets) into:
  1. *All Models Stacked Ensemble*
  2. *Best of Family Stacked Ensemble*
- **Sub-millisecond (< 1ms) Ingestion**: Exports into **MOJO** (Model Object, Optimized) and **POJO** (Plain Old Java Object) files for ultra-low latency production deployment with zero Python dependency.

---

## 2. Prerequisites & Environment
- **Operating Systems**: Windows, Linux, macOS.
- **Python Version**: 3.10 to 3.13.
- **Mandatory System Dependency**:
  - **Java JDK/JRE 8 to 17** (or compatible LTS) must be installed.
  - The `JAVA_HOME` environment variable must point to your JDK directory and `java` must be in your system `PATH`.

---

## 3. Installation
Install the H2O Python package:

```bash
pip install h2o
```

Or install local requirements:
```bash
pip install -r requirements.txt
```

Verify Java installation:
```bash
java -version
```

---

## 4. Project Structure
```
03_h2o_automl_project/
├── requirements.txt       # Dependencies (h2o, pandas, numpy, scikit-learn)
├── dataset.py             # Generates employee attrition enterprise tabular dataset
├── train.py               # Starts JVM, trains AutoML ensemble, outputs leaderboard & MOJO
├── predict.py             # Runs H2O batch inference pipeline
├── export_mojo.py         # Demonstrates Java/C++ standalone MOJO serving (<1ms latency)
└── MANUAL.md              # Complete operating manual
```

---

## 5. Step-by-Step Usage Guide

### Step 1: Generate Dataset
```bash
python dataset.py
```
Creates `employee_attrition.csv` containing realistic corporate HR records (income, overtime, job satisfaction, tenure, and resignation status).

### Step 2: Launch In-Memory AutoML Training
```bash
python train.py
```
- Boots the local H2O JVM cluster (`h2o.init(nthreads=-1)`).
- Converts pandas DataFrame to a distributed `H2OFrame`.
- Trains multiple base learners and builds stacked ensembles.
- Displays the AutoML Leaderboard ranked by AUC / Logloss.
- Downloads the serialized MOJO zip package and `h2o-genmodel.jar` into `./saved_models`.

### Step 3: Run Python In-Cluster Inference
```bash
python predict.py
```
Loads the MOJO into the H2O engine and predicts attrition risk on unseen employee profiles.

### Step 4: Standalone Production Deployment (Java / C++)
```bash
python export_mojo.py
```
Exposes how Java applications (Spring Boot, Kafka consumers, microservices) embed the generated `.zip` MOJO file directly using `h2o-genmodel.jar` without running Python.

---

## 6. Production Deployment Summary
| Attribute | Specification |
|---|---|
| **Serialization Formats** | MOJO (Model Object, Optimized) binary zip / POJO pure Java class |
| **Inference Latency** | **< 1 millisecond** (< 1 ms) |
| **Python Dependency** | **None** (Self-contained in Java, C++, R, or Scala runtimes) |
| **Ideal Use Case** | Ultra-high throughput microservices, fraud detection, AdTech, banking and insurance core systems |

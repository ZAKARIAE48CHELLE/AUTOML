# TabPFN Project Manual: Tabular Foundation Models & In-Context Learning

## 1. Overview & Paradigm
**TabPFN** (Prior-Data Fitted Networks) represents the 2025/2026 paradigm shift in AutoML: **Tabular Foundation Models (In-Context Learning)**.

### Traditional AutoML vs TabPFN:
- **Traditional AutoML (CASH)**: Runs hundreds of iterative training rounds testing Random Forests, LightGBM, and Neural Nets, optimizing hyperparameters on the specific dataset. Requires minutes to hours.
- **TabPFN (Foundation Model)**: A large Transformer architecture pre-trained on millions of synthetic tabular datasets with varied causal structures, noise distributions, and priors.
- **Zero Training Time (0 seconds)**: The training dataset `(X_train, y_train)` is passed directly into the Transformer's attention context window in a single forward pass.

---

## 2. Prerequisites & Technical Specifications
- **Operating Systems**: Windows, Linux, macOS.
- **Python Version**: 3.10 to 3.13.
- **Hardware & VRAM**:
  - CPU: Runs out-of-the-box for small datasets (< 1,000 samples).
  - GPU: Strongly recommended for datasets with > 1,000 samples (requiring 16 GB to 32 GB+ VRAM for large context attention matrices).
- **Scope Limitations**:
  - Best suited for datasets up to ~10,000 samples and ~100 features.
  - Exclusively for tabular classification/regression tasks.

---

## 3. Installation
Install TabPFN and PyTorch:

```bash
pip install tabpfn torch
```

Or install local project dependencies:
```bash
pip install -r requirements.txt
```

---

## 4. Project Structure
```
07_tabpfn_project/
├── requirements.txt       # Dependencies (tabpfn, torch, scikit-learn, pandas)
├── dataset.py             # Generates complex non-linear biomarker drug response dataset
├── train_and_infer.py     # Measures 0-second fit time & demonstrates In-Context forward pass
└── MANUAL.md              # Complete operating manual
```

---

## 5. Step-by-Step Usage Guide

### Step 1: Generate Dataset
```bash
python dataset.py
```
Generates `biomarker_drug_response.csv` with 10 continuous genetic expression indicators exhibiting complex non-linear cross-feature interactions.

### Step 2: Run Zero-Shot In-Context Learning
```bash
python train_and_infer.py
```
- Instantiates pre-trained `TabPFNClassifier`.
- Feeds `X_train` and `y_train` into the Transformer context in **0.00 seconds** of gradient updates.
- Executes single-pass attention inference on the test set.
- Outputs ROC-AUC, classification accuracy, and per-sample latency.

---

## 6. Production Deployment Summary
| Attribute | Specification |
|---|---|
| **Paradigm** | In-Context Learning (Transformer Prior-Data Fitted Network) |
| **Training Time** | **0 seconds (Instant zero-shot)** |
| **Inference Latency** | 20 - 80 ms per batch (CPU) / 5 - 15 ms (GPU) |
| **VRAM Consumption** | Scales with context window (24 - 32 GB for large datasets) |
| **Ideal Use Case** | Small-to-medium clinical data, rapid zero-shot predictions, active learning, Bayesian cold-start |

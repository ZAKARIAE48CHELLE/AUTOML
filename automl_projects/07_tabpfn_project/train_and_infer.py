"""
TabPFN Training & In-Context Inference Script
Demonstrates Tabular Foundation Models (In-Context Learning zero-shot prediction).
Training time is virtually 0 seconds because training examples are fed into the Transformer context window.
"""

import os
import time
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, accuracy_score, classification_report
from dataset import generate_clinical_biomarker_dataset

try:
    from tabpfn import TabPFNClassifier
    TABPFN_AVAILABLE = True
except (ImportError, ModuleNotFoundError):
    TABPFN_AVAILABLE = False


def run_tabpfn_experiment():
    print("=" * 60)
    print("TabPFN: Prior-Data Fitted Networks (Tabular Foundation Model)")
    print("=" * 60)

    # 1. Generate clinical biomarker dataset
    df = generate_clinical_biomarker_dataset(n_samples=500)
    X = df.drop(columns=["drug_response"]).values
    y = df["drug_response"].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, random_state=42, stratify=y
    )
    print(f"Dataset split: Train={len(X_train)} samples, Test={len(X_test)} samples")

    if not TABPFN_AVAILABLE:
        print("\n[INFO] tabpfn is not installed in the current environment.")
        print("To install TabPFN, run:")
        print("    pip install tabpfn torch")
        print("\nHow Tabular Foundation Models Work (In-Context Learning):")
        print("""
from tabpfn import TabPFNClassifier

# 1. Instantiate pre-trained Transformer model:
classifier = TabPFNClassifier(device='cpu') # or device='cuda'

# 2. "Training" step: Takes ZERO optimization time!
# The entire (X_train, y_train) dataset is placed in the Transformer's attention context window.
start = time.time()
classifier.fit(X_train, y_train)
train_time = time.time() - start
print(f"Training Time: {train_time:.4f} seconds (Zero-shot in-context feed!)")

# 3. Direct forward-pass inference:
predictions = classifier.predict(X_test)
probabilities = classifier.predict_proba(X_test)
        """)
        return

    # 2. Run TabPFN
    print("\nLoading pre-trained TabPFN Transformer weights...")
    classifier = TabPFNClassifier(device="cpu", N_ensemble_configurations=8)

    # 3. "Fitting" (In-Context Loading)
    start_train = time.time()
    classifier.fit(X_train, y_train)
    fit_duration = time.time() - start_train
    print(f"In-Context Learning 'Fit' Duration: {fit_duration:.4f} seconds (Zero gradient descent!)")

    # 4. Forward Pass Inference
    start_infer = time.time()
    y_pred = classifier.predict(X_test)
    y_prob = classifier.predict_proba(X_test)[:, 1]
    infer_duration = time.time() - start_infer

    print(f"Inference Duration on {len(X_test)} test patients: {infer_duration:.4f} seconds")
    print(f"Per-sample Latency: {(infer_duration / len(X_test)) * 1000:.2f} ms")

    # 5. Metrics
    auc = roc_auc_score(y_test, y_prob)
    acc = accuracy_score(y_test, y_pred)
    print("\n" + "=" * 60)
    print(f"Zero-Shot Evaluation Results: ROC-AUC={auc:.4f}, Accuracy={acc:.2%}")
    print("=" * 60)
    print(classification_report(y_test, y_pred, target_names=["Non-Responder", "Responder"]))


if __name__ == "__main__":
    run_tabpfn_experiment()

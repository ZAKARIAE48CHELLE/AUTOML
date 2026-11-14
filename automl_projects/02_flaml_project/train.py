"""
FLAML Training Script
Demonstrates budget-constrained AutoML using Microsoft FLAML BlendSearch algorithm.
"""

import os
import joblib
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score
from dataset import generate_loan_dataset

try:
    from flaml import AutoML
    FLAML_AVAILABLE = True
except ImportError:
    FLAML_AVAILABLE = False


def train_flaml():
    print("=" * 60)
    print("FLAML (Fast and Lightweight AutoML - Microsoft Research)")
    print("=" * 60)

    # 1. Load data
    df = generate_loan_dataset(n_samples=2000)
    X = df.drop(columns=["applicant_id", "loan_status"])
    y = df["loan_status"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    print(f"Dataset split: Train={len(X_train)} samples, Test={len(X_test)} samples")

    model_path = os.path.join(os.path.dirname(__file__), "flaml_best_model.pkl")

    if not FLAML_AVAILABLE:
        print("\n[INFO] FLAML is not installed in current environment.")
        print("To install FLAML, run:")
        print("    pip install flaml[automl]")
        print("\nStandard FLAML execution syntax:")
        print("""
automl = AutoML()
settings = {
    "time_budget": 30,          # Total search time in seconds
    "metric": "roc_auc",        # Evaluation metric
    "task": "classification",   # Problem type
    "log_file_name": "flaml.log",
    "estimator_list": ["lgbm", "rf", "xgboost", "catboost", "extra_tree"],
    "seed": 42
}
automl.fit(X_train=X_train, y_train=y_train, **settings)
        """)
        return

    # 2. Configure FLAML BlendSearch
    time_budget = 30  # Search budget in seconds
    print(f"\nInitiating FLAML BlendSearch (time_budget = {time_budget} seconds)...")

    automl = AutoML()
    settings = {
        "time_budget": time_budget,
        "metric": "roc_auc",
        "task": "classification",
        "log_file_name": "flaml_search.log",
        "seed": 42,
        "verbose": 1
    }

    automl.fit(X_train=X_train, y_train=y_train, **settings)

    # 3. Best Model Results
    print("\n" + "=" * 60)
    print("FLAML Optimization Summary:")
    print("=" * 60)
    print(f"Best Estimator Found: {automl.best_estimator}")
    print(f"Best Loss (1 - ROC_AUC): {automl.best_loss:.5f}")
    print(f"Best ROC_AUC Score: {1 - automl.best_loss:.5f}")
    print(f"Total Search Time: {automl.time_to_find_best_model:.2f} seconds")
    print(f"Best Hyperparameters:\n{automl.best_config}")

    # 4. Evaluation on test set
    y_pred = automl.predict(X_test)
    y_prob = automl.predict_proba(X_test)[:, 1]

    print("\nTest Set Classification Report:")
    print(classification_report(y_test, y_pred))
    print(f"Test ROC-AUC Score: {roc_auc_score(y_test, y_prob):.4f}")

    # 5. Serialize model
    joblib.dump(automl, model_path)
    print(f"\nTrained FLAML model serialized to: {model_path}")


if __name__ == "__main__":
    train_flaml()

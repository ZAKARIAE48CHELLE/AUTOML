"""
Auto-sklearn Training Script
Demonstrates Meta-learning (OpenML warm start) and Bayesian Optimization (SMAC3).
Note: Auto-sklearn natively runs on Linux (Docker / WSL).
"""

import os
import sys
import joblib
import pandas as pd
from sklearn.model_selection import train_test_split
from dataset import generate_bank_dataset

try:
    import autosklearn.classification
    AUTOSKLEARN_AVAILABLE = True
except (ImportError, ModuleNotFoundError):
    AUTOSKLEARN_AVAILABLE = False


def train_autosklearn():
    print("=" * 60)
    print("Auto-sklearn: Meta-Learning & Bayesian Optimization (SMAC3)")
    print("=" * 60)

    # 1. Load data
    df = generate_bank_dataset(n_samples=1200)
    X = df.drop(columns=["subscribed"])
    y = df["subscribed"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    print(f"Dataset split: Train={len(X_train)} samples, Test={len(X_test)} samples")

    model_path = os.path.join(os.path.dirname(__file__), "autosklearn_model.pkl")

    if not AUTOSKLEARN_AVAILABLE:
        print("\n[NOTE] auto-sklearn is not detected in this environment.")
        print("Auto-sklearn requires Linux with SWIG, C++11, and python3-dev.")
        print("On Windows or macOS, run this project using Docker:")
        print("    docker build -t autosklearn-project .")
        print("    docker run --rm autosklearn-project")
        print("\nStandard Auto-sklearn Execution Syntax:")
        print("""
import autosklearn.classification

cls = autosklearn.classification.AutoSklearnClassifier(
    time_left_for_this_task=120,    # Total search budget in seconds
    per_run_time_limit=30,          # Max time per individual model run
    initial_configurations_via_metalearning=25, # OpenML Meta-learning warm start
    ensemble_kwargs={'ensemble_size': 20},      # Post-hoc Bayesian ensemble
    memory_limit=3072,              # Memory limit in MB
    seed=42
)

cls.fit(X_train, y_train)
print(cls.sprint_statistics())
print(cls.leaderboard())
        """)
        return

    # 2. Fit AutoSklearnClassifier
    print("\nFitting AutoSklearnClassifier (SMAC3 + Meta-learning, time_left=60s)...")
    cls = autosklearn.classification.AutoSklearnClassifier(
        time_left_for_this_task=60,
        per_run_time_limit=15,
        initial_configurations_via_metalearning=15,
        ensemble_kwargs={"ensemble_size": 15},
        memory_limit=3072,
        seed=42
    )

    cls.fit(X_train, y_train)

    # 3. Model Statistics and Leaderboard
    print("\n" + "=" * 60)
    print("Auto-sklearn Run Statistics:")
    print("=" * 60)
    print(cls.sprint_statistics())

    print("\nLeaderboard:")
    print(cls.leaderboard())

    # 4. Evaluate on test set
    score = cls.score(X_test, y_test)
    print(f"\nTest Accuracy Score: {score:.4f}")

    # 5. Save model
    joblib.dump(cls, model_path)
    print(f"\nAuto-sklearn model serialized to: {model_path}")


if __name__ == "__main__":
    train_autosklearn()

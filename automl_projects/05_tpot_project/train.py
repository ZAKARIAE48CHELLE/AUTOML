"""
TPOT Training Script
Demonstrates Tree-based Genetic Programming (DEAP) to evolve sklearn pipelines
and export 100% native Python scikit-learn code (Zero TPOT dependency at runtime).
"""

import os
import pandas as pd
from sklearn.model_selection import train_test_split
from dataset import generate_network_dataset

try:
    from tpot import TPOTClassifier
    TPOT_AVAILABLE = True
except ImportError:
    TPOT_AVAILABLE = False


def train_tpot():
    print("=" * 60)
    print("TPOT: Genetic Programming Tree-based Pipeline Optimization")
    print("=" * 60)

    # 1. Load data
    df = generate_network_dataset(n_samples=1000)
    # Convert categorical features for scikit-learn compatibility
    df_encoded = pd.get_dummies(df, columns=["protocol_type", "service"], drop_first=True)

    X = df_encoded.drop(columns=["is_intrusion"])
    y = df_encoded["is_intrusion"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, random_state=42, stratify=y
    )
    print(f"Dataset split: Train={len(X_train)} samples, Test={len(X_test)} samples")

    export_path = os.path.join(os.path.dirname(__file__), "tpot_exported_pipeline.py")

    if not TPOT_AVAILABLE:
        print("\n[INFO] TPOT is not installed in the current environment.")
        print("To install TPOT, run:")
        print("    pip install tpot")
        print("\nStandard TPOT execution syntax:")
        print("""
tpot = TPOTClassifier(
    generations=5,          # Number of genetic iterations
    population_size=20,     # Number of pipelines retained per generation
    scoring='roc_auc',
    cv=5,
    random_state=42,
    verbosity=2
)
tpot.fit(X_train, y_train)
tpot.export('tpot_exported_pipeline.py')
        """)

        # Generate a demonstration exported script so the user can see TPOT's output format
        print(f"\nWriting demonstration clean scikit-learn script to: {export_path}")
        with open(export_path, "w", encoding="utf-8") as f:
            f.write('''# Native Scikit-Learn Pipeline Exported by TPOT
# Note: This code has ZERO dependency on TPOT! It uses only standard scikit-learn.

import numpy as np
import pandas as pd
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import RobustScaler
from sklearn.ensemble import ExtraTreesClassifier

def get_pipeline():
    return make_pipeline(
        RobustScaler(),
        ExtraTreesClassifier(
            criterion="entropy",
            max_features=0.75,
            min_samples_leaf=2,
            min_samples_split=5,
            n_estimators=100,
            random_state=42
        )
    )

if __name__ == "__main__":
    print("Exported TPOT pipeline is ready to train and deploy with standard scikit-learn!")
''')
        return

    # 2. Run TPOT Genetic Algorithm
    print("\nRunning TPOT Genetic Search (generations=3, population_size=15)...")
    tpot = TPOTClassifier(
        generations=3,
        population_size=15,
        scoring="roc_auc",
        cv=3,
        random_state=42,
        verbosity=2,
        max_time_mins=3
    )

    tpot.fit(X_train, y_train)

    # 3. Evaluate score
    score = tpot.score(X_test, y_test)
    print(f"\nTPOT Best Pipeline Test ROC-AUC Score: {score:.4f}")

    # 4. Export native Python code
    tpot.export(export_path)
    print(f"\nPure Scikit-Learn Python script exported successfully to: {export_path}")
    print("This script can now be audited, inspected, and deployed with zero TPOT dependency!")


if __name__ == "__main__":
    train_tpot()

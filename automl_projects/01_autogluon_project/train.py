"""
AutoGluon Training Script
Demonstrates Multi-layer Stacking & Ensembling with AutoGluon TabularPredictor.
"""

import os
import sys
from sklearn.model_selection import train_test_split
from dataset import generate_churn_dataset

try:
    from autogluon.tabular import TabularPredictor
    AUTOGLUON_AVAILABLE = True
except ImportError:
    AUTOGLUON_AVAILABLE = False


def train_autogluon():
    print("=" * 60)
    print("AutoGluon Tabular: Multi-layer Stacking & Ensembling")
    print("=" * 60)

    # 1. Generate & prepare dataset
    df = generate_churn_dataset(n_samples=1500)
    # Drop customer_id identifier to prevent overfitting on IDs
    df = df.drop(columns=["customer_id"])

    train_data, test_data = train_test_split(df, test_size=0.2, random_state=42, stratify=df["churn"])
    print(f"Dataset split: Train={len(train_data)} rows, Test={len(test_data)} rows")

    model_dir = os.path.join(os.path.dirname(__file__), "autogluon_models")

    if not AUTOGLUON_AVAILABLE:
        print("\n[INFO] AutoGluon is not installed in the current environment.")
        print("To install AutoGluon, run:")
        print("    pip install autogluon.tabular[all]")
        print("\nDisplaying the expected AutoGluon execution pattern:")
        print("""
predictor = TabularPredictor(
    label='churn',
    problem_type='binary',
    eval_metric='roc_auc',
    path='./autogluon_models'
).fit(
    train_data=train_data,
    presets='medium_quality', # or 'best_quality' for multi-layer stacking
    time_limit=120
)

# Leaderboard:
leaderboard = predictor.leaderboard(test_data, silent=False)
        """)
        return

    # 2. Fit TabularPredictor
    print("\nStarting TabularPredictor fit (presets='medium_quality', time_limit=60s)...")
    predictor = TabularPredictor(
        label="churn",
        problem_type="binary",
        eval_metric="roc_auc",
        path=model_dir
    ).fit(
        train_data=train_data,
        presets="medium_quality",
        time_limit=60
    )

    # 3. Model Leaderboard
    print("\n" + "=" * 60)
    print("AutoGluon Leaderboard (Ensembles & Stacking Performance):")
    print("=" * 60)
    leaderboard = predictor.leaderboard(test_data, silent=False)

    # 4. Evaluation
    test_perf = predictor.evaluate(test_data)
    print("\nTest Set Evaluation:")
    for metric, score in test_perf.items():
        print(f"  {metric}: {score:.4f}")

    print(f"\nModel artifacts successfully saved to: {model_dir}")


if __name__ == "__main__":
    train_autogluon()

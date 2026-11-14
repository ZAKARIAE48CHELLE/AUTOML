"""
PyCaret Training Script
Demonstrates OOP MLOps Experiment, model comparison, tuning, and pipeline export.
"""

import os
import pandas as pd
from dataset import generate_cardio_dataset

try:
    from pycaret.classification import ClassificationExperiment
    PYCARET_AVAILABLE = True
except ImportError:
    PYCARET_AVAILABLE = False


def train_pycaret():
    print("=" * 60)
    print("PyCaret: Low-Code OOP MLOps Pipeline")
    print("=" * 60)

    # 1. Generate dataset
    df = generate_cardio_dataset(n_samples=1200)
    # Ignore unique patient ID
    df = df.drop(columns=["patient_id"])

    save_path = os.path.join(os.path.dirname(__file__), "cardio_pipeline")

    if not PYCARET_AVAILABLE:
        print("\n[INFO] pycaret is not installed in the current environment.")
        print("To install PyCaret, run:")
        print("    pip install pycaret[full]")
        print("\nStandard PyCaret OOP workflow:")
        print("""
from pycaret.classification import ClassificationExperiment

# 1. Setup automated data transformation pipeline
exp = ClassificationExperiment()
exp.setup(
    data=df,
    target='heart_disease',
    train_size=0.8,
    session_id=42,
    normalize=True,
    transformation=True,
    log_experiment=True, # MLflow tracking
    experiment_name='cardio_automl'
)

# 2. Compare 15+ algorithms across 10-fold CV
best_model = exp.compare_models(n_select=1, sort='AUC')

# 3. Fine-tune hyperparameters
tuned_model = exp.tune_model(best_model)

# 4. Finalize & Save Complete Pipeline
final_pipeline = exp.finalize_model(tuned_model)
exp.save_model(final_pipeline, 'cardio_pipeline')
        """)
        return

    # 2. Setup PyCaret Experiment
    print("\nInitializing PyCaret ClassificationExperiment...")
    exp = ClassificationExperiment()
    exp.setup(
        data=df,
        target="heart_disease",
        train_size=0.8,
        session_id=42,
        normalize=True,
        verbose=False
    )

    # 3. Compare models across cross-validation
    print("Comparing models (Random Forest, LightGBM, Logistic Regression, etc.)...")
    best_model = exp.compare_models(n_select=1, sort="AUC", verbose=False)
    print(f"\nWinning Model Architecture: {type(best_model).__name__}")

    # 4. Tune best model
    print("Fine-tuning hyperparameters...")
    tuned_model = exp.tune_model(best_model, optimize="AUC", n_iter=10, verbose=False)

    # 5. Finalize model (train on complete dataset)
    print("Finalizing pipeline on all training folds...")
    final_pipeline = exp.finalize_model(tuned_model)

    # 6. Save complete pipeline
    exp.save_model(final_pipeline, save_path)
    print(f"\nFull end-to-end preprocessing + model pipeline saved to: {save_path}.pkl")


if __name__ == "__main__":
    train_pycaret()

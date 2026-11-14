"""
H2O AutoML Inference Script
Demonstrates loading an H2O model or executing inference on incoming employee records.
"""

import os
import pandas as pd

try:
    import h2o
    H2O_AVAILABLE = True
except ImportError:
    H2O_AVAILABLE = False


def run_prediction():
    print("=" * 60)
    print("H2O AutoML: Inference Pipeline")
    print("=" * 60)

    if not H2O_AVAILABLE:
        print("[INFO] h2o package not found. Ensure `pip install h2o` is run.")
        return

    # Initialize H2O cluster
    h2o.init(nthreads=-1)

    # Sample employee records
    new_data = pd.DataFrame([
        {
            "age": 28,
            "department": "Sales",
            "monthly_income": 3200,
            "distance_from_home": 25,
            "job_satisfaction": 1,
            "work_life_balance": 1,
            "years_at_company": 2,
            "overtime": "Yes",
            "num_companies_worked": 5
        },
        {
            "age": 45,
            "department": "Research & Development",
            "monthly_income": 12500,
            "distance_from_home": 4,
            "job_satisfaction": 4,
            "work_life_balance": 3,
            "years_at_company": 12,
            "overtime": "No",
            "num_companies_worked": 2
        }
    ])

    hf_new = h2o.H2OFrame(new_data)

    models_dir = os.path.join(os.path.dirname(__file__), "saved_models")
    # If saved model exists, load it; otherwise show instructions
    mojo_files = [f for f in os.listdir(models_dir) if f.endswith(".zip")] if os.path.exists(models_dir) else []

    if mojo_files:
        mojo_path = os.path.join(models_dir, mojo_files[0])
        print(f"Loading MOJO package: {mojo_path}")
        model = h2o.import_mojo(mojo_path)
        predictions = model.predict(hf_new)
        pred_df = predictions.as_data_frame()
        print("\nPrediction Output:")
        print(pred_df)
    else:
        print("[NOTE] No saved MOJO zip file found in saved_models directory.")
        print("Run `python train.py` first to generate and save the model.")


if __name__ == "__main__":
    run_prediction()

"""
PyCaret Prediction Script
Loads the end-to-end serialized pipeline (preprocessing + model) and scores new records.
"""

import os
import pandas as pd

try:
    from pycaret.classification import load_model, predict_model
    PYCARET_AVAILABLE = True
except ImportError:
    PYCARET_AVAILABLE = False


def run_prediction():
    print("=" * 60)
    print("PyCaret: End-to-End Pipeline Inference")
    print("=" * 60)

    pipeline_path = os.path.join(os.path.dirname(__file__), "cardio_pipeline")

    # Sample unseen clinical records (raw categorical & unscaled values)
    new_patients = pd.DataFrame([
        {
            "age": 62,
            "sex": "Male",
            "chest_pain_type": "ASY",
            "resting_bp": 155,
            "cholesterol": 290,
            "fasting_bs": 1,
            "max_heart_rate": 115,
            "exercise_angina": "Y"
        },
        {
            "age": 34,
            "sex": "Female",
            "chest_pain_type": "ATA",
            "resting_bp": 118,
            "cholesterol": 185,
            "fasting_bs": 0,
            "max_heart_rate": 165,
            "exercise_angina": "N"
        }
    ])

    if not PYCARET_AVAILABLE or not os.path.exists(f"{pipeline_path}.pkl"):
        print(f"[NOTE] Pipeline '{pipeline_path}.pkl' not found or pycaret not installed.")
        print("To load and predict with PyCaret:")
        print("    pipeline = load_model('cardio_pipeline')")
        print("    predictions = predict_model(pipeline, data=new_patients)")
        print("The loaded pipeline executes all encodings, scalings, and model predictions in 1 call.")
        return

    pipeline = load_model(pipeline_path)
    predictions = predict_model(pipeline, data=new_patients)

    print("\nInference Output (Predictions with Probabilities):")
    cols_to_show = ["age", "sex", "chest_pain_type", "prediction_label", "prediction_score"]
    print(predictions[[c for c in cols_to_show if c in predictions.columns]])


if __name__ == "__main__":
    run_prediction()

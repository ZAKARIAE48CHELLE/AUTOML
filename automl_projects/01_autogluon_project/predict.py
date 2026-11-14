"""
AutoGluon Prediction & Inference Script
Loads trained TabularPredictor artifacts and executes batch predictions with probabilities.
"""

import os
import pandas as pd
from dataset import generate_churn_dataset

try:
    from autogluon.tabular import TabularPredictor
    AUTOGLUON_AVAILABLE = True
except ImportError:
    AUTOGLUON_AVAILABLE = False


def run_prediction():
    print("=" * 60)
    print("AutoGluon: Production Inference Pipeline")
    print("=" * 60)

    model_dir = os.path.join(os.path.dirname(__file__), "autogluon_models")

    # Sample batch for inference (without target column)
    new_customers = pd.DataFrame([
        {
            "age": 29,
            "tenure_months": 3,
            "monthly_charges": 89.5,
            "contract_type": "Month-to-month",
            "payment_method": "Electronic check",
            "support_tickets": 4,
            "streaming_service": "Yes",
            "total_charges": 268.5
        },
        {
            "age": 55,
            "tenure_months": 48,
            "monthly_charges": 45.0,
            "contract_type": "Two year",
            "payment_method": "Credit card",
            "support_tickets": 0,
            "streaming_service": "No",
            "total_charges": 2160.0
        }
    ])

    if not AUTOGLUON_AVAILABLE or not os.path.exists(model_dir):
        print(f"[NOTE] Model folder '{model_dir}' not found or AutoGluon not installed.")
        print("To load and predict in production:")
        print("    predictor = TabularPredictor.load('./autogluon_models')")
        print("    predictions = predictor.predict(new_data)")
        print("    probabilities = predictor.predict_proba(new_data)")
        return

    predictor = TabularPredictor.load(model_dir)
    predictions = predictor.predict(new_customers)
    probabilities = predictor.predict_proba(new_customers)

    results = new_customers.copy()
    results["predicted_churn"] = predictions
    results["churn_probability"] = probabilities[1]

    print("\nInference Results:")
    print(results[["contract_type", "monthly_charges", "support_tickets", "predicted_churn", "churn_probability"]])


if __name__ == "__main__":
    run_prediction()

"""
FLAML Prediction Script
Loads the serialized FLAML model and executes fast batch/online predictions.
"""

import os
import joblib
import pandas as pd


def run_prediction():
    print("=" * 60)
    print("FLAML: Low-Resource Inference Pipeline")
    print("=" * 60)

    model_path = os.path.join(os.path.dirname(__file__), "flaml_best_model.pkl")

    if not os.path.exists(model_path):
        print(f"[NOTE] Serialized model '{model_path}' not found.")
        print("Run `python train.py` first to train and persist the best model.")
        return

    # Load model
    automl = joblib.load(model_path)
    print(f"Loaded FLAML model (Best Estimator: {automl.best_estimator})")

    # Sample incoming loan applications
    incoming_apps = pd.DataFrame([
        {
            "annual_income": 85000.0,
            "credit_score": 745,
            "loan_amount": 12000.0,
            "debt_to_income": 0.18,
            "employment_years": 8,
            "home_ownership": "MORTGAGE",
            "loan_intent": "DEBT_CONSOLIDATION"
        },
        {
            "annual_income": 28000.0,
            "credit_score": 580,
            "loan_amount": 25000.0,
            "debt_to_income": 0.49,
            "employment_years": 1,
            "home_ownership": "RENT",
            "loan_intent": "PERSONAL"
        }
    ])

    predictions = automl.predict(incoming_apps)
    probabilities = automl.predict_proba(incoming_apps)[:, 1]

    results = incoming_apps.copy()
    results["predicted_default"] = predictions
    results["default_probability"] = probabilities

    print("\nInference Results:")
    for idx, row in results.iterrows():
        status = "REJECTED (High Risk)" if row["predicted_default"] == 1 else "APPROVED (Low Risk)"
        print(f"Applicant {idx + 1}: Score={row['credit_score']}, DTI={row['debt_to_income']:.2f} "
              f"--> Decision: {status} (Default Prob: {row['default_probability']:.2%})")


if __name__ == "__main__":
    run_prediction()

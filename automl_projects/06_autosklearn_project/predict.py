"""
Auto-sklearn Prediction Script
Loads the serialized Auto-sklearn ensemble and executes batch inference.
"""

import os
import joblib
import pandas as pd


def run_prediction():
    print("=" * 60)
    print("Auto-sklearn: Production Serving Pipeline")
    print("=" * 60)

    model_path = os.path.join(os.path.dirname(__file__), "autosklearn_model.pkl")

    if not os.path.exists(model_path):
        print(f"[NOTE] Model file '{model_path}' not found.")
        print("Run `python train.py` (or inside Docker) first to train the model.")
        return

    cls = joblib.load(model_path)
    print("Loaded Auto-sklearn ensemble pipeline.")

    # New client contacts
    new_contacts = pd.DataFrame([
        {
            "age": 42,
            "balance": 4500,
            "duration": 480,
            "campaign": 1,
            "pdays": -1,
            "previous": 0,
            "housing": 0,
            "loan": 0
        },
        {
            "age": 28,
            "balance": 250,
            "duration": 65,
            "campaign": 5,
            "pdays": -1,
            "previous": 0,
            "housing": 1,
            "loan": 1
        }
    ])

    predictions = cls.predict(new_contacts)
    probabilities = cls.predict_proba(new_contacts)[:, 1]

    results = new_contacts.copy()
    results["predicted_subscription"] = predictions
    results["subscription_probability"] = probabilities

    print("\nInference Output:")
    for idx, row in results.iterrows():
        status = "WILL SUBSCRIBE" if row["predicted_subscription"] == 1 else "WILL NOT SUBSCRIBE"
        print(f"Client #{idx + 1}: Balance=${row['balance']}, Duration={row['duration']}s "
              f"--> Prediction: {status} (Prob: {row['subscription_probability']:.2%})")


if __name__ == "__main__":
    run_prediction()

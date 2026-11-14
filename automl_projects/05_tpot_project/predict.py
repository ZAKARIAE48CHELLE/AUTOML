"""
TPOT Prediction Script
Demonstrates loading and serving the exported native Python pipeline.
Key Advantage: NO TPOT LIBRARY REQUIRED! Only scikit-learn is needed.
"""

import os
import pandas as pd
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import RobustScaler
from sklearn.ensemble import ExtraTreesClassifier
from dataset import generate_network_dataset


def run_prediction():
    print("=" * 60)
    print("TPOT: Serving Audited Native Scikit-Learn Pipeline")
    print("=" * 60)

    # Recreate the pipeline discovered by TPOT's genetic optimization
    pipeline = make_pipeline(
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

    # Train on reference dataset
    df = generate_network_dataset(n_samples=500)
    df_encoded = pd.get_dummies(df, columns=["protocol_type", "service"], drop_first=True)
    X_train = df_encoded.drop(columns=["is_intrusion"])
    y_train = df_encoded["is_intrusion"]

    print("Fitting native scikit-learn pipeline (zero TPOT dependencies)...")
    pipeline.fit(X_train, y_train)

    # Incoming live network telemetry
    live_packets = X_train.iloc[:2].copy()
    preds = pipeline.predict(live_packets)
    probs = pipeline.predict_proba(live_packets)[:, 1]

    print("\nLive Intrusion Detection Results:")
    for i, (pred, prob) in enumerate(zip(preds, probs)):
        status = "MALICIOUS (Intrusion Detected!)" if pred == 1 else "BENIGN (Normal Traffic)"
        print(f"Packet Stream #{i + 1}: Classification -> {status} (Attack Confidence: {prob:.2%})")


if __name__ == "__main__":
    run_prediction()

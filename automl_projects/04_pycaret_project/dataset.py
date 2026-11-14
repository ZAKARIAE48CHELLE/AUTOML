"""
Dataset Generator for PyCaret Project: Cardiovascular Disease Risk
Generates a structured medical diagnostic dataset with clinical features.
"""

import numpy as np
import pandas as pd


def generate_cardio_dataset(n_samples: int = 1500, random_state: int = 42) -> pd.DataFrame:
    np.random.seed(random_state)

    patient_ids = [f"PAT_{i:05d}" for i in range(1, n_samples + 1)]
    age = np.random.randint(30, 80, size=n_samples)
    sex = np.random.choice(["Male", "Female"], p=[0.52, 0.48], size=n_samples)
    resting_bp = np.clip(np.random.normal(130, 18, size=n_samples).astype(int), 90, 200)
    cholesterol = np.clip(np.random.normal(240, 45, size=n_samples).astype(int), 120, 400)
    fasting_bs = np.random.choice([0, 1], p=[0.85, 0.15], size=n_samples) # > 120 mg/dl
    chest_pain_type = np.random.choice(["ASY", "NAP", "ATA", "TA"], p=[0.50, 0.22, 0.18, 0.10], size=n_samples)
    max_heart_rate = np.clip(np.random.normal(140, 25, size=n_samples).astype(int), 70, 205)
    exercise_angina = np.random.choice(["Y", "N"], p=[0.38, 0.62], size=n_samples)

    # Risk function
    risk = (
        -4.5
        + (age > 55) * 0.9
        + (sex == "Male") * 0.8
        + (resting_bp > 140) * 0.7
        + (cholesterol > 260) * 0.6
        + fasting_bs * 0.5
        + (chest_pain_type == "ASY") * 1.3
        + (exercise_angina == "Y") * 1.1
        - (max_heart_rate / 60) * 0.5
        + np.random.normal(0, 0.5, size=n_samples)
    )
    heart_disease_prob = 1 / (1 + np.exp(-risk))
    heart_disease = (np.random.uniform(0, 1, size=n_samples) < heart_disease_prob).astype(int)

    df = pd.DataFrame({
        "patient_id": patient_ids,
        "age": age,
        "sex": sex,
        "chest_pain_type": chest_pain_type,
        "resting_bp": resting_bp,
        "cholesterol": cholesterol,
        "fasting_bs": fasting_bs,
        "max_heart_rate": max_heart_rate,
        "exercise_angina": exercise_angina,
        "heart_disease": heart_disease
    })

    return df


if __name__ == "__main__":
    df = generate_cardio_dataset(2000)
    df.to_csv("heart_disease.csv", index=False)
    print(f"Generated {len(df)} patient records. Disease positive rate: {df['heart_disease'].mean():.2%}")

"""
Dataset Generator for AutoGluon Project: Customer Churn Classification
Generates a realistic tabular dataset with numerical, categorical, and missing values.
"""

import numpy as np
import pandas as pd


def generate_churn_dataset(n_samples: int = 1500, random_state: int = 42) -> pd.DataFrame:
    np.random.seed(random_state)

    customer_ids = [f"CUST_{i:05d}" for i in range(1, n_samples + 1)]
    age = np.random.randint(18, 75, size=n_samples)
    tenure_months = np.random.randint(1, 72, size=n_samples)
    monthly_charges = np.round(np.random.uniform(20.0, 120.0, size=n_samples), 2)
    contract_type = np.random.choice(["Month-to-month", "One year", "Two year"], p=[0.55, 0.25, 0.20], size=n_samples)
    payment_method = np.random.choice(["Electronic check", "Mailed check", "Bank transfer", "Credit card"], size=n_samples)
    support_tickets = np.random.poisson(lam=1.5, size=n_samples)
    streaming_service = np.random.choice(["Yes", "No"], p=[0.48, 0.52], size=n_samples)
    total_charges = np.round(tenure_months * monthly_charges * np.random.uniform(0.95, 1.05, size=n_samples), 2)

    # Introduce some realistic missing values
    missing_indices = np.random.choice(n_samples, size=int(n_samples * 0.03), replace=False)
    total_charges[missing_indices] = np.nan

    # Target: Churn (1 = Yes, 0 = No) based on realistic latent probabilities
    churn_logit = (
        -1.5
        + (monthly_charges > 70) * 0.8
        + (contract_type == "Month-to-month") * 1.2
        - (tenure_months / 12) * 0.4
        + (support_tickets > 2) * 0.9
        + (payment_method == "Electronic check") * 0.5
        + np.random.normal(0, 0.5, size=n_samples)
    )
    churn_prob = 1 / (1 + np.exp(-churn_logit))
    churn = (np.random.uniform(0, 1, size=n_samples) < churn_prob).astype(int)

    df = pd.DataFrame({
        "customer_id": customer_ids,
        "age": age,
        "tenure_months": tenure_months,
        "monthly_charges": monthly_charges,
        "contract_type": contract_type,
        "payment_method": payment_method,
        "support_tickets": support_tickets,
        "streaming_service": streaming_service,
        "total_charges": total_charges,
        "churn": churn
    })

    return df


if __name__ == "__main__":
    df = generate_churn_dataset(2000)
    df.to_csv("customer_churn.csv", index=False)
    print(f"Generated dataset with {len(df)} rows. Target distribution:\n{df['churn'].value_counts(normalize=True)}")

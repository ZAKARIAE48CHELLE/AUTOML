"""
Dataset Generator for FLAML Project: Loan Default Prediction
Generates a structured financial tabular dataset for budget-constrained AutoML exploration.
"""

import numpy as np
import pandas as pd


def generate_loan_dataset(n_samples: int = 2000, random_state: int = 42) -> pd.DataFrame:
    np.random.seed(random_state)

    applicant_ids = [f"APP_{i:06d}" for i in range(1, n_samples + 1)]
    annual_income = np.round(np.random.lognormal(mean=10.8, sigma=0.6, size=n_samples), 2)
    credit_score = np.clip(np.random.normal(loc=680, scale=80, size=n_samples).astype(int), 300, 850)
    loan_amount = np.round(np.random.uniform(5000, 50000, size=n_samples), -2)
    debt_to_income = np.round(np.random.uniform(0.05, 0.55, size=n_samples), 3)
    employment_years = np.clip(np.random.exponential(scale=6, size=n_samples).astype(int), 0, 40)
    home_ownership = np.random.choice(["RENT", "MORTGAGE", "OWN"], p=[0.40, 0.48, 0.12], size=n_samples)
    loan_intent = np.random.choice(["PERSONAL", "EDUCATION", "MEDICAL", "VENTURE", "DEBT_CONSOLIDATION"], size=n_samples)

    # Compute default probability based on credit risk dynamics
    risk_score = (
        -0.006 * credit_score
        + 4.2 * debt_to_income
        + 0.000025 * loan_amount
        - 0.000015 * annual_income
        - 0.05 * employment_years
        + (home_ownership == "RENT") * 0.45
        + np.random.normal(0, 0.4, size=n_samples)
    )
    default_prob = 1 / (1 + np.exp(-risk_score))
    loan_status = (np.random.uniform(0, 1, size=n_samples) < default_prob).astype(int)

    df = pd.DataFrame({
        "applicant_id": applicant_ids,
        "annual_income": annual_income,
        "credit_score": credit_score,
        "loan_amount": loan_amount,
        "debt_to_income": debt_to_income,
        "employment_years": employment_years,
        "home_ownership": home_ownership,
        "loan_intent": loan_intent,
        "loan_status": loan_status
    })

    return df


if __name__ == "__main__":
    df = generate_loan_dataset(2500)
    df.to_csv("loan_default_data.csv", index=False)
    print(f"Generated {len(df)} loan records. Default rate: {df['loan_status'].mean():.2%}")

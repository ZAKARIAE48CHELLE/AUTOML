"""
Dataset Generator for H2O AutoML Project: Employee Attrition Prediction
Generates enterprise tabular data suitable for in-memory distributed processing.
"""

import numpy as np
import pandas as pd


def generate_attrition_dataset(n_samples: int = 2500, random_state: int = 42) -> pd.DataFrame:
    np.random.seed(random_state)

    employee_ids = [f"EMP_{i:05d}" for i in range(1, n_samples + 1)]
    age = np.random.randint(22, 60, size=n_samples)
    department = np.random.choice(["Sales", "Research & Development", "Human Resources"], p=[0.45, 0.45, 0.10], size=n_samples)
    monthly_income = np.random.randint(2500, 18000, size=n_samples)
    distance_from_home = np.random.randint(1, 35, size=n_samples)
    job_satisfaction = np.random.choice([1, 2, 3, 4], p=[0.15, 0.25, 0.35, 0.25], size=n_samples)
    work_life_balance = np.random.choice([1, 2, 3, 4], p=[0.12, 0.28, 0.40, 0.20], size=n_samples)
    years_at_company = np.clip(np.random.exponential(scale=5, size=n_samples).astype(int), 0, 30)
    overtime = np.random.choice(["Yes", "No"], p=[0.30, 0.70], size=n_samples)
    num_companies_worked = np.random.randint(0, 9, size=n_samples)

    # Attrition logit
    attrition_logit = (
        -1.2
        + (overtime == "Yes") * 1.3
        - (job_satisfaction - 1) * 0.5
        - (work_life_balance - 1) * 0.4
        + (distance_from_home > 15) * 0.6
        - (monthly_income / 5000) * 0.3
        + (num_companies_worked > 4) * 0.4
        + np.random.normal(0, 0.4, size=n_samples)
    )
    attrition_prob = 1 / (1 + np.exp(-attrition_logit))
    attrition = np.where(np.random.uniform(0, 1, size=n_samples) < attrition_prob, "Yes", "No")

    df = pd.DataFrame({
        "employee_id": employee_ids,
        "age": age,
        "department": department,
        "monthly_income": monthly_income,
        "distance_from_home": distance_from_home,
        "job_satisfaction": job_satisfaction,
        "work_life_balance": work_life_balance,
        "years_at_company": years_at_company,
        "overtime": overtime,
        "num_companies_worked": num_companies_worked,
        "attrition": attrition
    })

    return df


if __name__ == "__main__":
    df = generate_attrition_dataset(3000)
    df.to_csv("employee_attrition.csv", index=False)
    print(f"Generated {len(df)} records. Attrition distribution:\n{df['attrition'].value_counts(normalize=True)}")

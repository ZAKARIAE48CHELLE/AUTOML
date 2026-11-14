"""
Dataset Generator for Auto-sklearn Project: Bank Marketing Term Deposit
Generates structured tabular data for Meta-Learning and Bayesian Optimization.
"""

import numpy as np
import pandas as pd


def generate_bank_dataset(n_samples: int = 1500, random_state: int = 42) -> pd.DataFrame:
    np.random.seed(random_state)

    age = np.random.randint(18, 70, size=n_samples)
    balance = np.clip(np.random.normal(1400, 2500, size=n_samples).astype(int), -1000, 30000)
    duration = np.random.exponential(scale=250, size=n_samples).astype(int) # Call duration (secs)
    campaign = np.random.randint(1, 10, size=n_samples) # Number of contacts
    pdays = np.random.choice([-1, 30, 60, 90, 180], p=[0.75, 0.05, 0.08, 0.07, 0.05], size=n_samples)
    previous = np.where(pdays == -1, 0, np.random.randint(1, 5, size=n_samples))
    housing = np.random.choice([0, 1], p=[0.45, 0.55], size=n_samples)
    loan = np.random.choice([0, 1], p=[0.85, 0.15], size=n_samples)

    # Deposit subscription logit
    logit = (
        -2.8
        + (duration > 300) * 1.8
        + (balance > 2000) * 0.6
        - housing * 0.7
        - loan * 0.5
        + (pdays > 0) * 0.8
        - (campaign > 3) * 0.6
        + np.random.normal(0, 0.4, size=n_samples)
    )
    prob = 1 / (1 + np.exp(-logit))
    subscribed = (np.random.uniform(0, 1, size=n_samples) < prob).astype(int)

    df = pd.DataFrame({
        "age": age,
        "balance": balance,
        "duration": duration,
        "campaign": campaign,
        "pdays": pdays,
        "previous": previous,
        "housing": housing,
        "loan": loan,
        "subscribed": subscribed
    })

    return df


if __name__ == "__main__":
    df = generate_bank_dataset(2000)
    df.to_csv("bank_marketing.csv", index=False)
    print(f"Generated {len(df)} bank records. Subscription rate: {df['subscribed'].mean():.2%}")

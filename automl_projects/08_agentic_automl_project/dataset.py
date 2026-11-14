"""
Dataset Generator for Agentic AutoML Project: E-Commerce Customer Value
Generates a mixed tabular dataset with numerical, categorical, and missing columns
to test the autonomous decision-making of the Multi-Agent LLM system.
"""

import numpy as np
import pandas as pd


def generate_customer_value_dataset(n_samples: int = 1200, random_state: int = 42) -> pd.DataFrame:
    np.random.seed(random_state)

    customer_ids = [f"USR_{i:05d}" for i in range(1, n_samples + 1)]
    age = np.random.randint(18, 70, size=n_samples)
    device = np.random.choice(["iOS", "Android", "Desktop"], p=[0.40, 0.45, 0.15], size=n_samples)
    annual_visits = np.random.poisson(lam=12, size=n_samples)
    avg_cart_value = np.round(np.random.normal(75.0, 25.0, size=n_samples), 2)
    loyalty_member = np.random.choice([0, 1], p=[0.70, 0.30], size=n_samples)
    discount_affinity = np.round(np.random.uniform(0.0, 1.0, size=n_samples), 3)

    # Customer Lifetime Value (CLV in USD)
    clv = (
        150.0
        + annual_visits * 25.0
        + avg_cart_value * 3.5
        + loyalty_member * 200.0
        + (age / 10) * 15.0
        - discount_affinity * 40.0
        + np.random.normal(0, 30.0, size=n_samples)
    )
    clv = np.round(np.maximum(clv, 50.0), 2)

    df = pd.DataFrame({
        "customer_id": customer_ids,
        "age": age,
        "device": device,
        "annual_visits": annual_visits,
        "avg_cart_value": avg_cart_value,
        "loyalty_member": loyalty_member,
        "discount_affinity": discount_affinity,
        "customer_lifetime_value": clv
    })

    return df


if __name__ == "__main__":
    df = generate_customer_value_dataset(1500)
    df.to_csv("customer_lifetime_value.csv", index=False)
    print(f"Generated {len(df)} customer records. Mean CLV: ${df['customer_lifetime_value'].mean():.2f}")

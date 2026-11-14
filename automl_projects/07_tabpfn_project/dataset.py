"""
Dataset Generator for TabPFN Project: Clinical Drug Response & Biomarkers
TabPFN shines on small-to-medium datasets (<10,000 samples) with complex interactions.
"""

import numpy as np
import pandas as pd


def generate_clinical_biomarker_dataset(n_samples: int = 500, random_state: int = 42) -> pd.DataFrame:
    np.random.seed(random_state)

    # 10 continuous biological and genetic expression biomarkers
    biomarkers = {
        f"biomarker_{i:02d}": np.round(np.random.normal(loc=0.0, scale=1.0, size=n_samples), 4)
        for i in range(1, 11)
    }

    # Complex non-linear interaction typical of biological pathways
    latent_signal = (
        np.sin(biomarkers["biomarker_01"] * 2.5)
        + np.cos(biomarkers["biomarker_02"]) * biomarkers["biomarker_03"]
        - (biomarkers["biomarker_04"] ** 2) * 0.4
        + np.tanh(biomarkers["biomarker_05"] + biomarkers["biomarker_06"]) * 1.5
        + np.random.normal(0, 0.3, size=n_samples)
    )

    response_prob = 1 / (1 + np.exp(-latent_signal))
    drug_response = (np.random.uniform(0, 1, size=n_samples) < response_prob).astype(int)

    df = pd.DataFrame(biomarkers)
    df["drug_response"] = drug_response

    return df


if __name__ == "__main__":
    df = generate_clinical_biomarker_dataset(600)
    df.to_csv("biomarker_drug_response.csv", index=False)
    print(f"Generated {len(df)} patient records with 10 biomarkers. Response rate: {df['drug_response'].mean():.2%}")

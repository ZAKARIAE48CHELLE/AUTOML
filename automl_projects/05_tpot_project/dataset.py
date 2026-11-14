"""
Dataset Generator for TPOT Project: Network Intrusion Detection
Generates tabular cybersecurity network telemetry data.
"""

import numpy as np
import pandas as pd


def generate_network_dataset(n_samples: int = 1500, random_state: int = 42) -> pd.DataFrame:
    np.random.seed(random_state)

    duration = np.round(np.random.exponential(scale=2.5, size=n_samples), 3)
    protocol_type = np.random.choice(["TCP", "UDP", "ICMP"], p=[0.70, 0.25, 0.05], size=n_samples)
    service = np.random.choice(["http", "ftp", "smtp", "dns", "ssh", "other"], size=n_samples)
    src_bytes = np.random.randint(40, 65000, size=n_samples)
    dst_bytes = np.random.randint(40, 200000, size=n_samples)
    failed_logins = np.random.choice([0, 1, 2, 3], p=[0.92, 0.05, 0.02, 0.01], size=n_samples)
    logged_in = np.where(failed_logins > 0, 0, 1)
    count_srv = np.random.randint(1, 50, size=n_samples)
    same_srv_rate = np.round(np.random.uniform(0.1, 1.0, size=n_samples), 2)
    diff_srv_rate = np.round(1.0 - same_srv_rate, 2)

    # Anomaly indicator (0 = Normal traffic, 1 = Intrusion / Attack)
    attack_logit = (
        -2.5
        + (failed_logins > 0) * 2.2
        + (src_bytes > 45000) * 1.5
        + (dst_bytes < 100) * 1.2
        + (count_srv > 35) * 1.0
        + (diff_srv_rate > 0.6) * 1.4
        + np.random.normal(0, 0.5, size=n_samples)
    )
    attack_prob = 1 / (1 + np.exp(-attack_logit))
    is_intrusion = (np.random.uniform(0, 1, size=n_samples) < attack_prob).astype(int)

    df = pd.DataFrame({
        "duration": duration,
        "protocol_type": protocol_type,
        "service": service,
        "src_bytes": src_bytes,
        "dst_bytes": dst_bytes,
        "failed_logins": failed_logins,
        "logged_in": logged_in,
        "count_srv": count_srv,
        "same_srv_rate": same_srv_rate,
        "diff_srv_rate": diff_srv_rate,
        "is_intrusion": is_intrusion
    })

    return df


if __name__ == "__main__":
    df = generate_network_dataset(2000)
    df.to_csv("network_traffic.csv", index=False)
    print(f"Generated {len(df)} network records. Intrusion rate: {df['is_intrusion'].mean():.2%}")

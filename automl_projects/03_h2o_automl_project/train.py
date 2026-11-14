"""
H2O AutoML Training Script
Demonstrates JVM in-memory distributed algorithms, Stacked Ensembling, and Leaderboard.
"""

import os
import pandas as pd
from dataset import generate_attrition_dataset

try:
    import h2o
    from h2o.automl import H2OAutoML
    H2O_AVAILABLE = True
except ImportError:
    H2O_AVAILABLE = False


def train_h2o():
    print("=" * 60)
    print("H2O AutoML: Distributed In-Memory Engine (JVM)")
    print("=" * 60)

    # 1. Generate dataset
    df = generate_attrition_dataset(n_samples=2000)
    csv_path = os.path.join(os.path.dirname(__file__), "employee_attrition.csv")
    df.to_csv(csv_path, index=False)

    if not H2O_AVAILABLE:
        print("\n[INFO] h2o Python package is not installed in the current environment.")
        print("To install H2O, run:")
        print("    pip install h2o")
        print("\nNote: Ensure Java (JDK 8-17) is installed and JAVA_HOME is configured.")
        print("\nStandard H2O AutoML execution pattern:")
        print("""
import h2o
from h2o.automl import H2OAutoML

h2o.init(nthreads=-1, max_mem_size="4G")
hf = h2o.import_file("employee_attrition.csv")

# Identify predictors and response
y = "attrition"
x = [col for col in hf.columns if col not in [y, "employee_id"]]
hf[y] = hf[y].asfactor()

# Train AutoML (Stacked Ensembles + GBM + XGBoost + Deep Learning + DRF)
aml = H2OAutoML(max_runtime_secs=120, seed=42)
aml.train(x=x, y=y, training_frame=hf)

# Leaderboard:
print(aml.leaderboard.as_data_frame())

# Export MOJO:
mojo_path = aml.leader.download_mojo(path="./saved_models", get_genmodel_jar=True)
        """)
        return

    # 2. Initialize H2O cluster
    print("\nInitializing local H2O JVM cluster...")
    h2o.init(nthreads=-1, max_mem_size="2G")

    # 3. Import data into H2O distributed frame
    print("Importing dataset into H2O distributed in-memory frame...")
    hf = h2o.H2OFrame(df)
    hf["attrition"] = hf["attrition"].asfactor()

    y = "attrition"
    x = [col for col in hf.columns if col not in [y, "employee_id"]]

    train_frame, test_frame = hf.split_frame(ratios=[0.8], seed=42)
    print(f"Frames: Train={train_frame.nrows} rows, Test={test_frame.nrows} rows")

    # 4. Train H2O AutoML
    print("\nRunning H2O AutoML (max_runtime_secs=60)...")
    aml = H2OAutoML(
        max_runtime_secs=60,
        max_models=10,
        seed=42,
        project_name="attrition_automl"
    )
    aml.train(x=x, y=y, training_frame=train_frame)

    # 5. Display Leaderboard
    print("\n" + "=" * 60)
    print("H2O AutoML Leaderboard (Stacked Ensembles vs Base Learners):")
    print("=" * 60)
    lb = aml.leaderboard
    print(lb.head(rows=10))

    # 6. Evaluate Leader on Test Set
    perf = aml.leader.model_performance(test_frame)
    print("\nLeader Model Test Performance:")
    print(f"  AUC: {perf.auc():.4f}")
    print(f"  Logloss: {perf.logloss():.4f}")

    # 7. Download MOJO
    models_dir = os.path.join(os.path.dirname(__file__), "saved_models")
    os.makedirs(models_dir, exist_ok=True)
    mojo_path = aml.leader.download_mojo(path=models_dir, get_genmodel_jar=True)
    print(f"\nLeader MOJO bundle downloaded to: {mojo_path}")


if __name__ == "__main__":
    train_h2o()

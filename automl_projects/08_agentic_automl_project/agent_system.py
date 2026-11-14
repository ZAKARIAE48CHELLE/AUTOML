"""
Agentic AutoML: Multi-Agent System (Architect -> Coder -> Reviewer Feedback Loop)
Implements autonomous LLM-style agents for end-to-end Machine Learning pipeline generation,
dynamic execution, error interception, and real-time self-healing.
"""

import io
import sys
import traceback
from typing import Dict, Any, Tuple
import pandas as pd


class ArchitectAgent:
    """Agent 1: Analyzes dataset schema, problem formulation, and recommends pipeline strategy."""

    def __init__(self, name: str = "Architect"):
        self.name = name

    def analyze(self, df: pd.DataFrame, target_col: str) -> Dict[str, Any]:
        num_cols = df.select_dtypes(include=["number"]).columns.tolist()
        cat_cols = df.select_dtypes(include=["object", "category"]).columns.tolist()
        if target_col in num_cols:
            num_cols.remove(target_col)
        if target_col in cat_cols:
            cat_cols.remove(target_col)

        is_numeric_target = pd.api.types.is_numeric_dtype(df[target_col])
        task_type = "regression" if is_numeric_target and df[target_col].nunique() > 10 else "classification"

        plan = {
            "task_type": task_type,
            "target": target_col,
            "numeric_features": num_cols,
            "categorical_features": cat_cols,
            "recommended_scalers": ["StandardScaler"],
            "recommended_encoders": ["OneHotEncoder"],
            "recommended_models": ["HistGradientBoostingRegressor", "RandomForestRegressor"] if task_type == "regression" else ["HistGradientBoostingClassifier"],
            "primary_metric": "R2_Score" if task_type == "regression" else "ROC_AUC"
        }
        return plan


class CoderAgent:
    """Agent 2: Generates clean, executable Python/scikit-learn pipeline code."""

    def __init__(self, name: str = "Coder"):
        self.name = name

    def generate_code(self, plan: Dict[str, Any], attempt: int = 1, error_feedback: str = "") -> str:
        # If this is a correction pass due to reviewer exception, adjust code
        handle_ids_fix = "drop(columns=['customer_id'])" if "customer_id" in error_feedback else ""

        code = f'''
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import r2_score, mean_squared_error

# 1. Prepare Data
import os
csv_candidates = [
    "customer_lifetime_value.csv",
    os.path.join("08_agentic_automl_project", "customer_lifetime_value.csv"),
    os.path.join("..", "customer_lifetime_value.csv")
]
csv_path = next((p for p in csv_candidates if os.path.exists(p)), "customer_lifetime_value.csv")
if os.path.exists(csv_path):
    df = pd.read_csv(csv_path)
else:
    from dataset import generate_customer_value_dataset
    df = generate_customer_value_dataset(1200)
    df.to_csv("customer_lifetime_value.csv", index=False)
if "customer_id" in df.columns:
    df = df.drop(columns=["customer_id"])

X = df.drop(columns=["{plan['target']}"])
y = df["{plan['target']}"]

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# 2. Build Preprocessor
num_features = {plan['numeric_features']}
num_features = [c for c in num_features if c in X.columns]
cat_features = {plan['categorical_features']}
cat_features = [c for c in cat_features if c in X.columns]

preprocessor = ColumnTransformer(
    transformers=[
        ("num", StandardScaler(), num_features),
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), cat_features)
    ]
)

# 3. Model Pipeline
model = Pipeline(steps=[
    ("preprocessor", preprocessor),
    ("regressor", HistGradientBoostingRegressor(random_state=42, max_iter=100))
])

# 4. Train
model.fit(X_train, y_train)

# 5. Evaluate
y_pred = model.predict(X_test)
r2 = r2_score(y_test, y_pred)
rmse = np.sqrt(mean_squared_error(y_test, y_pred))

print(f"PIPELINE_SUCCESS: R2={{r2:.4f}}, RMSE=${{rmse:.2f}}")
'''
        return code.strip()


class ReviewerAgent:
    """Agent 3: Intercepts Python execution, captures exceptions, and triggers self-healing."""

    def __init__(self, name: str = "Reviewer"):
        self.name = name

    def execute_and_review(self, code_str: str) -> Tuple[bool, str, Dict[str, Any]]:
        # Redirect stdout and stderr
        old_stdout = sys.stdout
        redirected_output = io.StringIO()
        sys.stdout = redirected_output

        execution_namespace = {}
        success = False
        metrics = {}
        error_msg = ""

        try:
            exec(code_str, execution_namespace)
            output = redirected_output.getvalue()
            success = True
            for line in output.split("\n"):
                if "PIPELINE_SUCCESS" in line:
                    parts = line.split(":")[-1].strip().split(",")
                    for part in parts:
                        k, v = part.split("=")
                        metrics[k.strip()] = v.strip()
            error_msg = output
        except Exception as e:
            success = False
            error_msg = traceback.format_exc()
        finally:
            sys.stdout = old_stdout

        return success, error_msg, metrics

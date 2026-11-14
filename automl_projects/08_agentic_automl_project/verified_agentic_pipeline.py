import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import r2_score, mean_squared_error

# 1. Prepare Data
df = pd.read_csv("customer_lifetime_value.csv")
if "customer_id" in df.columns:
    df = df.drop(columns=["customer_id"])

X = df.drop(columns=["customer_lifetime_value"])
y = df["customer_lifetime_value"]

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# 2. Build Preprocessor
num_features = ['age', 'annual_visits', 'avg_cart_value', 'loyalty_member', 'discount_affinity']
num_features = [c for c in num_features if c in X.columns]
cat_features = ['customer_id', 'device']
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

print(f"PIPELINE_SUCCESS: R2={r2:.4f}, RMSE=\${rmse:.2f}")
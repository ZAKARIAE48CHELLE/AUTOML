import type { Task } from '@contracts/src'

/** Exemples de scripts par type de pipeline (alignés sur les jeux de démonstration). */
export const CODE_SAMPLES: Record<Task, string> = {
  classification: `import pandas as pd
from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.ensemble import RandomForestClassifier
import joblib

df = pd.read_csv("telecom_churn.csv")
num_cols = ["age", "data_gb"]
cat_cols = ["plan", "contract", "payment_method"]
X = df.drop(columns=["customer_id"]).drop("churn", axis=1)
y = df["churn"]
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, stratify=y, random_state=42)

pre = ColumnTransformer([
    ("num", SimpleImputer(strategy="median"), num_cols),
    ("cat", OneHotEncoder(handle_unknown="ignore"), cat_cols),
])
model = RandomForestClassifier(n_estimators=300, max_depth=12)
cv = StratifiedKFold(n_splits=5)
scores = cross_val_score(model, X_train, y_train, cv=cv, scoring="f1")
print(model.score(X_test, y_test))
joblib.dump(model, "churn-model.pkl")
`,
  regression: `import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import OneHotEncoder
from sklearn.linear_model import Ridge
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_squared_error

df = pd.read_csv("housing.csv")
y = df["price"]
X_train, X_test, y_train, y_test = train_test_split(df, y, test_size=0.2, random_state=42)
enc = OneHotEncoder()  # district
ridge = Ridge(alpha=1.0)
gbr = GradientBoostingRegressor(n_estimators=400, learning_rate=0.05)
print(mean_squared_error(y_test, gbr.predict(X_test)))
`,
  clustering: `import pandas as pd
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.cluster import KMeans
from sklearn.mixture import GaussianMixture
from sklearn.metrics import silhouette_score

df = pd.read_csv("clients_segmentation.csv")
X = df.drop(columns=["customer_id"])
scaler = StandardScaler()
km = KMeans(n_clusters=4, n_init=10)
gm = GaussianMixture(n_components=4)
print(silhouette_score(X, km.fit_predict(X)))
`,
  anomaly_detection: `import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import LocalOutlierFactor
from sklearn.metrics import average_precision_score

df = pd.read_csv("transactions_cartes.csv")
y = df["is_fraud"]
scaler = StandardScaler()
iso = IsolationForest(n_estimators=200)
lof = LocalOutlierFactor(n_neighbors=20)
print(average_precision_score(y, -iso.fit(df).score_samples(df)))
`,
  forecasting: `import pandas as pd
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_absolute_error
from statsmodels.tsa.holtwinters import ExponentialSmoothing
from lightgbm import LGBMRegressor

df = pd.read_csv("ventes_quotidiennes.csv", parse_dates=["date"])
y = df["sales"]
df["month"] = df["date"].dt.month
df["weekday"] = df["date"].dt.dayofweek
df["lag_1"], df["lag_7"] = df["sales"].shift(1), df["sales"].shift(7)
df["roll_7"] = df["sales"].rolling(7).mean()
tscv = TimeSeriesSplit(n_splits=3)
ets = ExponentialSmoothing(y, trend="add", seasonal="add", seasonal_periods=7)
gbm = LGBMRegressor(n_estimators=300, learning_rate=0.05)
print(mean_absolute_error(y_test, gbm.predict(X_test)))
`,
  text_classification: `import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.svm import LinearSVC
from sklearn.metrics import f1_score

df = pd.read_csv("avis_produits.csv")
df["review_text"] = df["review_text"].str.lower()
y = df["sentiment"]
X_train, X_test, y_train, y_test = train_test_split(df["review_text"], y, test_size=0.2, stratify=y, random_state=42)
vec = TfidfVectorizer(max_features=20000, ngram_range=(1, 2))
clf = LogisticRegression(C=2.0, max_iter=500)
svm = LinearSVC(C=1.0)
print(f1_score(y_test, clf.predict(X_test), average="macro"))
`,
  image_classification: `import pandas as pd
from torchvision import transforms
from skimage.feature import hog
from sklearn.svm import SVC

df = pd.read_csv("inspection_pieces.csv")
y = df["label"]
tf = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.RandomHorizontalFlip(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])
features = [hog(img, pixels_per_cell=(8, 8)) for img in images]
clf = SVC(kernel="linear", C=1.0)
print(clf.score(X_test, y_test))
`,
  recommendation: `import pandas as pd
import implicit
from implicit.als import AlternatingLeastSquares

ratings = pd.read_csv("notes_films.csv")
user_counts = ratings.groupby("user_id").size()
model = AlternatingLeastSquares(factors=64, regularization=0.01, iterations=15)
# évaluation : ndcg@10 sur les interactions retenues
`,
}

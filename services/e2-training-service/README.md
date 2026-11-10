# E2 Model Training Service (`services/e2-training-service`)

FastAPI microservice for Developer 2 (Model Training & Evaluation).

## Responsibilities
- Catalog of Machine Learning & Deep Learning algorithms (`/models/catalog`)
- Hardware resource caps and validation (`/training/resources`, `/training/validate`)
- Training & Optuna tuning jobs (`/training/jobs`, `/tuning/studies`)
- MLflow experiment tracking & metric comparisons (`/experiments`, `/experiments/compare`)
- Model registry and real-time batch inference (`/models/registry`, `/inference/predict`)

## Running Locally
```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload
```
Interactive API documentation: `http://localhost:8002/docs`

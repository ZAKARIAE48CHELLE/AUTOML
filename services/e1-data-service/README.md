# E1 Data Intelligence Service (`services/e1-data-service`)

FastAPI microservice for Developer 1 (Data Intelligence + Foundation).

## Responsibilities
- Authentication (`/auth/login`, `/auth/refresh`)
- Project management (`/projects`)
- Dataset ingestion, versioning, and sample preview (`/datasets`)
- Statistical profiling & automated EDA (`/datasets/{id}/profile`)
- Data cleaning & preprocessing transforms catalog (`/preprocessing`)
- Train/Validation/Test splitting (`/splits`)

## Running Locally
```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```
Interactive API documentation: `http://localhost:8001/docs`

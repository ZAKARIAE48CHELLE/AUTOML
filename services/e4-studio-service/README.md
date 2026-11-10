# E4 Workflow Studio & MLOps Service (`services/e4-studio-service`)

FastAPI microservice for Developer 4 (Visual Workflow Studio, DAG Engine & MLOps).

## Responsibilities
- 8 canonical DAG node types & starter pipeline templates (`/catalog/node-types`, `/catalog/templates`)
- Immutable workflow versioning with canonical SHA-256 content hashing (`/workflows`)
- Multi-layer validation (V1-V10) (`/workflows/{wf}/versions/{v}/validate`)
- Human-in-the-loop approvals tracking (`/approvals`)
- **Sole execution authority** (`POST /executions`)
- Server-Sent Events (SSE) progress streaming (`/executions/{id}/events`)
- Standalone reproducible project export bundles (`/exports`)
- Model promotion to staging & production (`/registry/promotions`)

## Running Locally
```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8004 --reload
```
Interactive API documentation: `http://localhost:8004/docs`


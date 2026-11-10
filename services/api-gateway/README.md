# API Gateway (`services/api-gateway`)

The reverse-proxy entrypoint for the AI Studio microservices architecture.

## Responsibilities
- Central public gateway running on port **8080**.
- Routes URL prefixes to their respective microservices:
  - `/auth/*`, `/projects/*`, `/datasets/*`, `/preprocessing/*`, `/splits/*` -> `e1-data-service:8001`
  - `/models/*`, `/training/*`, `/tuning/*`, `/experiments/*`, `/inference/*` -> `e2-training-service:8002`
  - `/assistant/*`, `/policy/*` -> `e3-assistant-service:8003`
  - `/catalog/*`, `/workflows/*`, `/executions/*`, `/approvals/*`, `/exports/*`, `/registry/*` -> `e4-studio-service:8004`
- Handles CORS for web frontend clients.
- Unbuffered SSE proxying for `/executions/{id}/events`.
- Proxied health endpoints:
  - `/health/live` (Gateway status)
  - `/health/e1` (Data service)
  - `/health/e2` (Training service)
  - `/health/e3` (Assistant service)
  - `/health/e4` (Studio service)

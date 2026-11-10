# E3 Agentic AI Assistant Service (`services/e3-assistant-service`)

FastAPI microservice for Developer 3 (Agentic AI & Human-in-the-Loop Governance).

## Responsibilities
- Natural-language user chat interface (`/assistant/messages`)
- Goal understanding & disambiguation (`/assistant/goals/parse`)
- Autonomous ML plan proposal generation (`/assistant/proposals`)
- Contextual explanations for predictions & errors (`/assistant/explanations`)
- Project governance modes (`auto`, `guided`, `expert`) & audit trail (`/assistant/mode`, `/assistant/audit`)
- L0-L3 policy matrix definition (`/policy/matrix`)

## Running Locally
```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8003 --reload
```
Interactive API documentation: `http://localhost:8003/docs`


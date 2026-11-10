# AI Studio — Intelligent AutoML & Deep Learning Platform

**An AI-powered, end-to-end Machine Learning and Deep Learning development platform.**

> **Project Status:** Under Development  
> **Project Type:** AI Engineering · AutoML · Agentic AI · MLOps  
> **Team:** 4 developers organized into 2 collaborative pairs

## Overview

AI Studio is an intelligent platform designed to simplify and automate the complete Machine Learning and Deep Learning lifecycle.

The platform aims to enable users with different levels of technical expertise to transform raw datasets into trained, evaluated, and reusable AI models through an intuitive interface powered by Large Language Models (LLMs).

By combining **Automated Machine Learning (AutoML), Agentic AI, visual workflow design, and MLOps**, AI Studio provides a unified environment for data exploration, model experimentation, and intelligent workflow orchestration.

The system is designed around a **human-in-the-loop approach**, allowing users to retain control over important decisions while benefiting from AI-assisted automation.

## Quickstart & Frontend Setup

Frontend de la plateforme AutoML & Deep Learning assistée par IA (4 modules : Data E1, Training E2, Assistant E3, Studio E4).
Il sert de contrat d'interface : le backend de chaque étudiant s'implémente derrière `apps/web/src/api/<module>.ts`.

### Lancer avec Docker Desktop

```bash
docker compose up --build                           # http://localhost:8080 (build de production, nginx)
docker compose --profile dev up --build web-dev    # http://localhost:5173 (rechargement à chaud)
```

Sans Docker : `npm install && npm run dev` (Node 22).

### Mock (DEV ONLY)

`apps/web/src/mock/` est un faux backend en mémoire (réinitialisé à chaque rechargement de page). Il n'est pas une référence métier.
`VITE_MOCK_MODULES=data,training,assistant,studio` (voir `.env.example`) : retirer un module de la liste envoie ses appels à `VITE_API_BASE_URL`.
Avec Docker : `VITE_MOCK_MODULES=data,assistant docker compose up --build` (les variables sont figées au build).

### Commandes

- `npm run dev` : Démarrer le serveur de développement
- `npm run build` : Compiler pour la production
- `npm run typecheck` : Vérification des types TypeScript
- `npm test` : Lancer les tests

## Module Ownership & Shared Contracts

| Module | Écrans (`src/modules/…`) | Contrat API |
|---|---|---|
| **E1 Data** | `data/` | `src/api/data.ts` |
| **E2 Training** | `training/` | `src/api/training.ts` |
| **E3 Assistant** | `assistant/` | `src/api/assistant.ts` |
| **E4 Studio** | `studio/` | `src/api/studio.ts` |

Contrats partagés : `packages/contracts` (types, catalogue des 8 types de nœuds, 65 endpoints, matrice de politique, validateur V1–V10). Les routes marquées « internal » ne sont jamais appelées par le frontend.
Les écarts entre le contrat v2 et ce que l'interface exige réellement sont documentés dans `docs/CONTRACT_GAPS.md`.

## Key Features

### Intelligent Data Understanding
- Dataset upload and validation.
- Automatic data profiling and exploratory data analysis (EDA).
- Interactive statistical visualizations.
- Missing-value, duplicate, outlier, and class-imbalance detection.
- Intelligent preprocessing recommendations.
- Reusable data transformation pipelines.

### AI-Powered ML/DL Assistant
- Natural-language understanding of user objectives.
- Automated ML workflow planning.
- AI-assisted model recommendations.
- Context-aware explanations of datasets and experiments.
- Intelligent analysis of model performance.
- Human approval and intervention mechanisms.

### Machine Learning & Deep Learning Studio
- Extensible catalog of ML and DL algorithms.
- Dynamic hyperparameter configuration.
- Model training and evaluation.
- Automated hyperparameter optimization.
- Model comparison and experiment tracking.
- Controlled integration of additional models.

### Visual Pipeline Builder
- Visual construction and modification of ML workflows.
- Configurable preprocessing and training components.
- AI-generated workflow visualization.
- Pipeline execution monitoring.
- Reusable and exportable workflow configurations.

### MLOps & Experiment Management
- Experiment tracking and reproducibility.
- Model versioning and registry.
- Performance monitoring.
- Reproducible project exports.
- Model inference and deployment capabilities.

## Platform Usage Modes

AI Studio is designed to support three complementary modes:

| Mode | Description |
|---|---|
| **Auto Mode** | AI proposes and orchestrates the ML workflow with appropriate approval checkpoints. |
| **Guided Mode** | Users select and configure models while receiving AI recommendations. |
| **Expert Mode** | Advanced control over preprocessing, pipelines, training, and experiments. |

## Proposed Architecture

The platform follows a modular architecture with four interconnected components.

```text
                     AI STUDIO PLATFORM
                             |
          +------------------+------------------+
          |                                     |
    User Interface                       AI Orchestrator
          |                                     |
          +------------------+------------------+
                             |
                  Workflow Coordination
                             |
          +------------------+------------------+
          |                  |                  |
    Data Intelligence   Model Training    Visual Workflow
          |                  |                  |
          +------------------+------------------+
                             |
                   Validation & Execution
                             |
                Experiment & Model Storage
```

The LLM acts as an intelligent orchestration layer, while deterministic tools and isolated execution environments handle data processing, training, and evaluation.

## Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Backend | Python, FastAPI |
| AI Orchestration | LangGraph, LLM APIs / Local LLMs |
| Machine Learning | Scikit-learn, XGBoost, LightGBM |
| Deep Learning | PyTorch |
| AutoML | AutoGluon |
| Hyperparameter Optimization | Optuna |
| Experiment Tracking | MLflow |
| Visualization | Plotly |
| Database | PostgreSQL |
| Object Storage | MinIO |
| Background Processing | Celery, Redis |
| Containerization | Docker, Docker Compose |

## Team Organization

Development is organized into **two collaborative pairs**, with four individual areas of responsibility.

| Developer | Module | Main Responsibilities |
|---|---|---|
| Developer 1 | Data Intelligence | Dataset processing, EDA, visualization, preprocessing, data pipelines |
| Developer 2 | Model Training | ML/DL algorithms, hyperparameters, training, evaluation, experiment tracking |
| Developer 3 | Agentic AI | LLM integration, intelligent planning, orchestration, AI research assistant |
| Developer 4 | Visual Workflow & MLOps | Visual pipeline builder, workflow management, model lifecycle, project export |

### Pair A — Data Intelligence & Model Training
Responsible for the data processing and machine learning execution capabilities.

### Pair B — Agentic AI & Visual Workflow
Responsible for intelligent orchestration, user interaction, visual workflow management, and reproducibility.

**All four modules are developed in parallel**, using shared API contracts, mock services, continuous integration, and regular team collaboration.

## Planned Development Milestones

- [ ] Establish shared architecture and API contracts.
- [ ] Implement project management and dataset upload.
- [ ] Develop data profiling and EDA capabilities.
- [ ] Implement preprocessing pipelines.
- [ ] Create the ML/DL model catalog.
- [ ] Implement configurable model training.
- [ ] Integrate experiment tracking and model evaluation.
- [ ] Develop the AI orchestration assistant.
- [ ] Build the visual pipeline editor.
- [ ] Integrate the complete end-to-end workflow.
- [ ] Implement reproducible project exports.
- [ ] Add model registry and inference capabilities.
- [ ] Extend support for advanced deep learning workflows.
- [ ] Complete integration, security, and performance testing.

## Example User Journey

**Objective:** Predict customer churn from a structured dataset.

1. Upload a customer dataset.
2. Describe the prediction objective in natural language.
3. Explore AI-assisted data profiling and visualizations.
4. Review preprocessing recommendations.
5. Select a classification model or accept an AI recommendation.
6. Configure training parameters.
7. Execute model training and hyperparameter optimization.
8. Compare evaluation metrics and experiments.
9. Inspect and modify the visual workflow.
10. Export the reproducible ML project or prepare the model for inference.

## Engineering Principles

The project follows these key principles:

- **Modularity:** Independent, interoperable components.
- **Reproducibility:** Traceable datasets, configurations, and experiments.
- **Explainability:** Understandable AI recommendations and model results.
- **User Control:** Explicit approval for important operations.
- **Security:** Controlled model installation and isolated execution.
- **Scalability:** Extensible architecture for additional algorithms and workflows.
- **Collaboration:** Shared contracts, version control, code review, and integration testing.

## Contributing

Development is initially coordinated by the project team.

Contributors should follow the shared coding conventions, maintain documented API contracts, create feature branches, and submit pull requests for review.

## License

License to be determined.

---

**AI Studio — Making Machine Learning more accessible, intelligent, and collaborative.**

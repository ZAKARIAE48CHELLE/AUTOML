# AI Studio — frontend v1

Frontend de la plateforme AutoML & Deep Learning assistée par IA (4 modules : Data E1, Training E2, Assistant E3, Studio E4).
Il sert de contrat d'interface : le backend de chaque étudiant s'implémente derrière `apps/web/src/api/<module>.ts`.

## Lancer avec Docker Desktop

```
docker compose up --build              # http://localhost:8080  (build de production, nginx)
docker compose --profile dev up --build web-dev   # http://localhost:5173  (rechargement à chaud)
```

Sans Docker : `npm install && npm run dev` (Node 22).

## Mock (DEV ONLY)

`apps/web/src/mock/` est un faux backend en mémoire (réinitialisé à chaque rechargement de page). Il n'est pas une référence métier.
`VITE_MOCK_MODULES=data,training,assistant,studio` (voir `.env.example`) : retirer un module de la liste envoie ses appels à `VITE_API_BASE_URL`.
Avec Docker : `VITE_MOCK_MODULES=data,assistant docker compose up --build` (les variables sont figées au build).

## Qui possède quoi

| Module | Écrans (`src/modules/…`) | Contrat API |
|---|---|---|
| E1 Data | `data/` | `src/api/data.ts` |
| E2 Training | `training/` | `src/api/training.ts` |
| E3 Assistant | `assistant/` | `src/api/assistant.ts` |
| E4 Studio | `studio/` | `src/api/studio.ts` |

Contrats partagés : `packages/contracts` (types, catalogue des 8 types de nœuds, 65 endpoints, matrice de politique, validateur V1–V10). Les routes marquées « internal » ne sont jamais appelées par le frontend.
Les écarts entre le contrat v2 et ce que l'interface exige réellement sont dans `docs/CONTRACT_GAPS.md`.

## Commandes

`npm run dev` · `npm run build` · `npm run typecheck` · `npm test`

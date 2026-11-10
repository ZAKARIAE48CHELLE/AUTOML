# Écarts de contrat découverts en construisant l'interface

Chaque ligne est une décision à trancher en équipe avant d'implémenter les backends. Les endpoints marqués (+) existent dans le mock mais PAS dans les documents v2.

## Endpoints manquants (+)
1. `GET /datasets?project_id=` (E1) — la liste des datasets n'existe pas dans le contrat.
2. `GET /splits?dataset_version_id=` et `GET /preprocessing/specs?dataset_version_id=` (E1) — nécessaires aux onglets Splits et Prétraitement.
3. `GET /training/jobs?project_id=` (E2) — le Centre d'entraînement liste les jobs récents.
4. `GET /catalog/templates` (E4) — `POST /workflows/from-template` exige un `template_id` que rien ne liste.
5. `GET /workflows/{id}/versions/{vid}/validation` (E4) — relire le dernier ValidationReport sans relancer la validation (la revue l'utilise).
6. `GET /assistant/messages?project_id=` (E3) — historique du chat.

## Champs ou liens manquants
7. Import de dataset : aucun endpoint de statut de job. Le mock expose `status` (importing/ready/failed) sur `DatasetVersion`.
8. `GET /datasets/{id}/profile` renvoie « DataProfile ou JobStatus » : l'interface distingue par la présence de `columns`. Préférer un champ `status` explicite.
9. `ExperimentRun`, `ModelVersion` : pas de lien `execution_id` / `workflow_version_id` garanti. Sans lui, la promotion (approbation L3 liée à une version de workflow) est impossible pour un modèle sans origine.
10. `POST /exports` avec `include_data=true` : l'approbation L3 requise n'a pas de champ dans la requête (le mock ajoute `approval_id`).
11. `Approval` : le mode Guidé (une approbation par étape) et les L3 exigent `node_ids`, absent de l'objet v2. Les approbations d'export et de promotion utilisent `node_ids = ["export"]` / `["promote:<id>"]` : à formaliser (champ `subject` ?).
12. Job → étude de tuning : aucun lien. L'interface passe `?study=<id>` depuis l'exécution.
13. `NodeRun` : progression et horodatages absents de l'objet v2 (ajoutés : `progress`, `started_at`, `finished_at`).
14. `AuditAction` : `mode_changed` et `dataset_imported` sont absents de la liste.
15. `PlanProposal` : pas de moyen de retrouver la proposition d'une version (l'interface passe `?proposal=`). Ajouter `GET /assistant/proposals?workflow_version_id=`.
16. Mise en page : `ui` est exclu du `content_hash` mais stocké dans la version immuable ; un changement de mise en page seule ne peut donc pas être enregistré.
17. Journaux d'un job : `logs_ref` sans endpoint de lecture.
18. Pagination, filtres et format d'erreur des listes non définis (le mock renvoie des tableaux complets).
19. Événements SSE : schéma non défini (le mock émet `{id, type, execution_id, node_id, status, ts}`).
20. Budget d'approbation : forme non définie (le mock : `{trials, max_minutes, models}`).
21. `content_hash` : le mock utilise un hash non cryptographique ; E4 doit utiliser SHA-256 sur la sérialisation canonique de `packages/contracts/src/hash.ts` (clés triées, `ui` exclu).

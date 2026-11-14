# Architecture & Guide de Sélection et d'Intégration AutoML
## Projet de Fin d'Études EMSI — Plateforme Distribuée Multi-Microservices

Ce document détaille les fondements théoriques, les algorithmes de sélection de modèles (**CASH**), la matrice de décision industrielle et le blueprint d'intégration des 8 bibliothèques AutoML dans l'architecture microservices EMSI (`services/e1-data-service`, `services/e2-training-service`, `services/e3-assistant-service`, `services/e4-studio-service`).

---

## 1. Fondements Théoriques : Le Problème CASH

Dans un projet de Machine Learning classique, le scientifique de données doit résoudre manuellement deux problèmes combinatoires intriqués :
1. **Sélection de l'algorithme** : Choisir parmi une famille d'estimateurs $A = \{A^{(1)}, A^{(2)}, \dots, A^{(R)}\}$ (e.g. LightGBM, CatBoost, XGBoost, Random Forest, Réseaux Neuronaux MLP).
2. **Optimisation des hyperparamètres** : Pour un algorithme $A^{(j)}$ ayant un domaine d'hyperparamètres $\Lambda^{(j)}$, trouver le vecteur $\lambda \in \Lambda^{(j)}$ qui minimise la perte de validation croisée.

Formellement, le problème **CASH** (*Combined Algorithm Selection and Hyperparameter Optimization*) s'exprime comme :

$$A^*, \lambda^* = \arg\min_{A^{(j)} \in A, \, \lambda \in \Lambda^{(j)}} \frac{1}{K} \sum_{k=1}^K \mathcal{L}\left(A^{(j)}_\lambda(D_{\text{train}}^{(k)}), D_{\text{val}}^{(k)}\right)$$

Face à l'explosion combinatoire de cet espace continu-discret non-convexe, la recherche par grille (*Grid Search*) est exponentielle et inefficace, tandis que la recherche aléatoire pure (*Random Search*) gaspille inutilement du temps de calcul sur des hyperparamètres non viables. Les bibliothèques modernes d'AutoML résolvent ce problème selon des paradigmes algorithmiques radicalement différents.

---

## 2. Analyse Approfondie des 8 Paradigmes de Sélection

### 2.1 AutoGluon (Amazon AWS) : Multi-layer Stacking & Ensembling
- **Stratégie de sélection** : AutoGluon part du principe que trouver le meilleur modèle unique est sous-optimal par rapport à une combinaison pondérée de modèles hétérogènes.
- **Mécanisme interne** :
  1. **Layer 1** : Entraîne simultanément plusieurs familles d'estimateurs (LightGBM, CatBoost, XGBoost, Random Forest, ExtraTrees, PyTorch MLP) en appliquant une validation croisée à $K$ plis ($k$-fold Out-Of-Fold).
  2. **Génération de méta-caractéristiques** : Les prédictions $OOF$ (probabilités des classes) issues du Layer 1 sont concaténées avec les caractéristiques d'origine sans risque de fuite de données (*data leakage*).
  3. **Layer 2** : Des méta-modèles sont entraînés sur ce nouveau jeu enrichi.
  4. **Weighted Ensemble** : Un algorithme glouton (Caruana selection) attribue des poids optimaux aux meilleurs modèles de chaque couche pour former l'ensemble final.
- **Forces** : Numéro 1 sur le benchmark indépendant TabArena ; gère nativement le texte, les données tabulaires et les images.
- **Export** : Graphe ONNX pour inférence C++/Go, ou modèle PyTorch sérialisé.

### 2.2 FLAML (Microsoft Research) : Frugal & Cost-Aware BlendSearch
- **Stratégie de sélection** : Optimisation sous contrainte stricte de budget temps (`time_budget`) et de coût de calcul.
- **Mécanisme interne** :
  1. FLAML ordonne les familles d'estimateurs selon leur **coût empirique d'évaluation** (e.g., LightGBM à faible profondeur est testé bien avant un XGBoost profond ou un réseau de neurones).
  2. **BlendSearch** alterne dynamiquement entre une exploration bayésienne globale (pour ne pas rester bloqué dans un optimum local) et une exploitation stochastique locale sans dérivée.
  3. Il démarre avec un espace de recherche minimal (petits arbres, taux d'apprentissage élevés) et élargit progressivement les bornes au fur et à mesure que le budget restant le permet.
- **Forces** : Idéal pour les environnements cloud à facturation à la seconde ou les serveurs à ressources limitées.

### 2.3 H2O AutoML : In-Memory Distributed JVM & Super Learner
- **Stratégie de sélection** : Calcul distribué en mémoire vive sur cluster JVM Java avec génération de deux Stacked Ensembles.
- **Mécanisme interne** :
  1. Les données sont réparties en mémoire sous forme de `H2OFrame` vectorisés.
  2. H2O lance des recherches aléatoires parallélisées sur 5 familles : Distributed Random Forest (DRF), Extremely Randomized Trees (XRT), Generalized Linear Model (GLM), Gradient Boosting Machine (GBM) et Deep Learning (Feedforward Neural Networks).
  3. À la fin du temps imparti, H2O synthétise deux ensembles via Super Learner :
     - **All Models Ensemble** : combine tous les modèles entraînés.
     - **Best of Family Ensemble** : sélectionne uniquement le champion de chaque famille.
- **Forces & Déploiement** : Exportation sous forme de binaire **MOJO** (Model Object, Optimized), exécutable en Java/C++ avec une latence inférieure à 1 milliseconde, sans aucune dépendance envers Python.

### 2.4 PyCaret : Low-Code OOP & MLOps Governance
- **Stratégie de sélection** : Approche orientée objet unifiée évaluant simultanément plus de 15 algorithmes scikit-learn standardisés.
- **Mécanisme interne** :
  1. `setup()` standardise l'imputation, l'encodage One-Hot/Target, le normalisation et la détection d'aberrations.
  2. `compare_models()` entraîne en parallèle une batterie d'algorithmes (Ridge, ElasticNet, SVM, Random Forest, AdaBoost, LightGBM) sur validation croisée.
  3. `blend_models()` ou `stack_models()` permet de créer des ensembles souples (*soft voting*) en une seule ligne de code.
- **Forces** : Intégration native avec MLflow, SHAP TreeExplainer et interface graphique low-code.

### 2.5 TPOT : Genetic Programming Pipeline Evolution (DEAP)
- **Stratégie de sélection** : Recherche stochastique globale par algorithmes génétiques.
- **Mécanisme interne** :
  1. Chaque pipeline complet (sélection de features, ACP, imputation, scaling, modèle de classification/régression) est représenté sous forme d'un **arbre syntaxique génétique** dans la bibliothèque DEAP.
  2. À chaque génération, les pipelines subissent des mutations (changement d'hyperparamètres, ajout de transformateurs) et des croisements (*crossovers*).
  3. Le critère d'optimisation intègre une pénalité de parcimonie (*parsimony pressure*) pour éviter que les pipelines ne deviennent inutilement complexes.
- **Forces & Audit** : TPOT exporte un fichier Python 100% natif en scikit-learn pur, auditable par des régulateurs bancaires ou médicaux sans dépendance envers TPOT.

### 2.6 Auto-sklearn : OpenML Meta-Learning Warm-Start & SMAC3
- **Stratégie de sélection** : Optimisation bayésienne guidée par l'expérience passée sur des centaines de jeux de données OpenML.
- **Mécanisme interne** :
  1. **Phase 1 (Meta-learning)** : Extrait 38 méta-caractéristiques du dataset ($N$, $P$, kurtosis, ratio catégoriel, entropie). Il recherche dans sa base de données les datasets les plus proches et amorce la recherche (*warm-start*) avec les meilleures configurations connues.
  2. **Phase 2 (SMAC3)** : Optimisation séquentielle par modèles de substitution (Sequential Model-based Algorithm Configuration) utilisant des forêts aléatoires pour modéliser la fonction de perte.
  3. **Phase 3 (Ensemble Selection)** : Post-traitement Caruana pour sélectionner les modèles du run.
- **Forces** : Excellente rigueur académique ; nécessite un environnement Linux natif ou un conteneur Docker.

### 2.7 TabPFN : Tabular Foundation Model (In-Context Learning)
- **Stratégie de sélection** : Zéro optimisation, zéro rétropropagation, inférence immédiate en une seule passe forward pass.
- **Mécanisme interne** :
  1. TabPFN est un grand modèle Transformer pré-entraîné sur des millions de jeux de données synthétiques issus de processus gaussiens et de priors bayésiens complexes.
  2. Lors de l'utilisation, le jeu de données d'entraînement et les échantillons de test sont passés ensemble dans le contexte du Transformer.
  3. Le modèle prédit directement la distribution a posteriori des classes sans mettre à jour aucun poids.
- **Forces** : Vitesse absolue (temps d'entraînement = 0.00 s), idéal pour les petits datasets ($N \le 10\,000$, $P \le 500$) et le cold-start en production.

### 2.8 Agentic AutoML : Multi-Agent Autonomous LLM Loop
- **Stratégie de sélection** : Collaboration heuristique entre 3 agents spécialisés (Architecte $\rightarrow$ Coder $\rightarrow$ Reviewer).
- **Mécanisme interne** :
  1. **Architect Agent** : Analyse la sémantique métier des colonnes, formule des hypothèses de feature engineering et choisit la famille d'algorithmes appropriée.
  2. **Coder Agent** : Génère le script Python complet (nettoyage, pipeline scikit-learn/LightGBM, métriques d'évaluation).
  3. **Reviewer Agent** : Exécute le code dans un bac à sable isolé, capture les stack traces, analyse les performances et renvoie un feedback correctif au Coder en cas d'erreur (boucle auto-réparatrice).
- **Forces** : Capacité à intégrer des connaissances métier qualitatives non structurées et à expliquer chaque décision en langage naturel.

---

## 3. Matrice de Décision Industrielle : Quel Framework Choisir ?

| Critère de Choix | Solution Recommandée | Alternative | Justification Technique |
| :--- | :--- | :--- | :--- |
| **Précision Maximale** (Kaggle / Compétition) | **AutoGluon** | Auto-sklearn | Le multi-layer stacking out-of-fold bat régulièrement les modèles uniques. |
| **Latence Ultra-Faible** (< 1 ms, IoT, Trading) | **H2O AutoML (MOJO)** | AutoGluon (ONNX) | MOJO compile en bytecode Java/C++ sans verrou GIL Python. |
| **Budget CPU Restreint / Frugalité Cloud** | **FLAML** | TabPFN | BlendSearch commence par les modèles légers et respecte la contrainte de temps à la seconde près. |
| **Cold-Start / Données Réduites (< 5k lignes)** | **TabPFN** | FLAML | In-Context Learning instantané (0s d'entraînement), très performant sur petites dimensions. |
| **Audit Réglementaire Strict (Banque / Santé)** | **TPOT** | PyCaret | Exporte un script Python scikit-learn standard transparent et inspectable. |
| **Expérimentation Rapide & Suivi MLOps** | **PyCaret** | AutoGluon | Wrapper élégant avec intégration MLflow et tracés SHAP en une seule commande. |
| **Recherche Académique & Meta-Learning** | **Auto-sklearn** | TPOT | Exploite les priors OpenML pour éviter le démarrage à froid de l'espace de recherche. |
| **Problématique Métier Floue / Données Hybrides**| **Agentic AutoML** | PyCaret | L'agent LLM raisonne sur la signification des colonnes et corrige son propre code. |

---

## 4. Architecture d'Intégration dans le Projet EMSI (`AUTOML`)

Dans le monorepo EMSI, 4 services coopèrent pour fournir la plateforme complète :

```
                  +-----------------------------------+
                  |        e4-studio-service          |
                  |     (Interface Web / Dashboard)    |
                  +-----------------+-----------------+
                                    |
                    REST / SSE HTTP |
                                    v
+-----------------------+   +-------+---------------+   +-----------------------+
|    e1-data-service    |<->|  e2-training-service  |<->|  e3-assistant-service |
| (Profilage & Données) |   | (Moteur AutoML Adap.) |   |   (Copilote IA LLM)   |
+-----------------------+   +-----------------------+   +-----------------------+
```

### 4.1 Rôle de Chaque Service
1. **`e1-data-service` (Étudiant 1)** :
   - Ingestion des fichiers CSV / Parquet.
   - Calcul des méta-caractéristiques (nombre de lignes $N$, colonnes $P$, ratio de valeurs manquantes, types categoriques vs numériques).
   - Nettoyage et encodage initial.
2. **`e2-training-service` (Étudiant 2 - Hub d'Entraînement)** :
   - Héberge le catalogue des algorithmes et les adaptateurs AutoML.
   - Reçoit la requête d'entraînement, instancie l'adaptateur sélectionné, exécute l'optimisation en arrière-plan et stocke les artefacts du modèle.
3. **`e3-assistant-service` (Étudiant 3 - Zakariae)** :
   - Assistant intelligent équipé du module Agentic.
   - Analyse le profil de données émis par `e1` et les contraintes exprimées par l'utilisateur pour **recommander la meilleure bibliothèque**.
   - Génère des explications d'inférence en langage naturel grâce à SHAP.
4. **`e4-studio-service` (Étudiant 4)** :
   - Interface utilisateur pour configurer les pipelines, suivre les courbes d'apprentissage et simuler des inférences en temps réel.

---

## 5. Le Patron de Conception `AutoMLAdapter`

Pour brancher les 8 bibliothèques de façon modulaire dans `services/e2-training-service`, nous appliquons le design pattern **Adapter**.

### 5.1 Interface Abstraite Commune (`base_adapter.py`)
```python
# services/e2-training-service/app/adapters/base_adapter.py
from abc import ABC, abstractmethod
import pandas as pd
from typing import Dict, Any, List

class BaseAutoMLAdapter(ABC):
    @abstractmethod
    def fit(self, train_data: pd.DataFrame, target_column: str, **kwargs) -> Dict[str, Any]:
        """Entraîne le pipeline AutoML sous les contraintes spécifiées."""
        pass

    @abstractmethod
    def predict(self, input_data: pd.DataFrame) -> Dict[str, Any]:
        """Exécute l'inférence sur de nouvelles données."""
        pass

    @abstractmethod
    def get_leaderboard(self) -> List[Dict[str, Any]]:
        """Renvoie le classement des modèles évalués avec leurs métriques."""
        pass

    @abstractmethod
    def export(self, export_path: str, format_type: str = "default") -> str:
        """Sérialise le modèle vers le format de déploiement (ONNX, MOJO, Pickle)."""
        pass
```

### 5.2 Exemple d'Adaptateur AutoGluon (`autogluon_adapter.py`)
```python
# services/e2-training-service/app/adapters/autogluon_adapter.py
import os
import pandas as pd
from autogluon.tabular import TabularPredictor
from .base_adapter import BaseAutoMLAdapter

class AutoGluonAdapter(BaseAutoMLAdapter):
    def __init__(self, time_limit: int = 120, eval_metric: str = "roc_auc"):
        self.time_limit = time_limit
        self.eval_metric = eval_metric
        self.predictor = None

    def fit(self, train_data: pd.DataFrame, target_column: str, **kwargs):
        presets = kwargs.get("presets", "medium_quality")
        save_path = kwargs.get("save_path", "./models_storage/autogluon")
        
        self.predictor = TabularPredictor(
            label=target_column,
            eval_metric=self.eval_metric,
            path=save_path
        ).fit(
            train_data=train_data,
            presets=presets,
            time_limit=self.time_limit
        )
        return self.get_leaderboard()

    def predict(self, input_data: pd.DataFrame):
        preds = self.predictor.predict(input_data)
        probs = self.predictor.predict_proba(input_data)
        return {
            "predictions": preds.tolist(),
            "probabilities": probs.to_dict(orient="records")
        }

    def get_leaderboard(self):
        lb = self.predictor.leaderboard(silent=True)
        return lb[['model', 'score_val', 'pred_time_val', 'fit_time']].to_dict(orient="records")

    def export(self, export_path: str, format_type: str = "default"):
        # AutoGluon est déjà persisté dans son répertoire de travail
        return os.path.abspath(self.predictor.path)
```

### 5.3 Exemple d'Adaptateur FLAML (`flaml_adapter.py`)
```python
# services/e2-training-service/app/adapters/flaml_adapter.py
import joblib
import pandas as pd
from flaml import AutoML
from .base_adapter import BaseAutoMLAdapter

class FLAMLAdapter(BaseAutoMLAdapter):
    def __init__(self, time_budget: int = 60, metric: str = "roc_auc"):
        self.time_budget = time_budget
        self.metric = metric
        self.automl = AutoML()

    def fit(self, train_data: pd.DataFrame, target_column: str, **kwargs):
        X = train_data.drop(columns=[target_column])
        y = train_data[target_column]
        task = kwargs.get("task", "classification")

        self.automl.fit(
            X_train=X,
            y_train=y,
            time_budget=self.time_budget,
            metric=self.metric,
            task=task,
            estimator_list=["lgbm", "rf", "xgboost", "extra_tree"],
            seed=42
        )
        return {
            "best_estimator": self.automl.best_estimator,
            "best_loss": self.automl.best_loss,
            "time_to_find": self.automl.time_to_find_best_model
        }

    def predict(self, input_data: pd.DataFrame):
        preds = self.automl.predict(input_data)
        probs = self.automl.predict_proba(input_data)
        return {
            "predictions": preds.tolist(),
            "probabilities": probs.tolist()
        }

    def get_leaderboard(self):
        return [
            {"model": self.automl.best_estimator, "best_loss": self.automl.best_loss}
        ]

    def export(self, export_path: str, format_type: str = "default"):
        target_file = f"{export_path}/flaml_model.pkl"
        joblib.dump(self.automl, target_file)
        return target_file
```

---

## 6. Bonnes Pratiques pour la Soutenance et la Production

1. **Isolation des dépendances** : H2O nécessite une JVM Java 8-17 ; Auto-sklearn nécessite Linux/Docker. Utilisez des conteneurs légers `Docker` dédiés pour chaque groupe d'adaptateurs afin d'éviter tout conflit de paquets Python.
2. **Export vers formats légers** :
   - En environnement Java (e.g. backend Spring Boot de l'EMSI), privilégiez **H2O MOJO** (temps de réponse < 1ms, zéro dépendance Python).
   - En environnement haute concurrence C++ ou Go, exportez les modèles AutoGluon / LightGBM vers le format **ONNX Runtime**.
3. **Surveillance & Dérive (Data Drift)** : Intégrez un vérificateur d'intégrité dans `e1-data-service` pour déclencher automatiquement un ré-entraînement via `e2-training-service` lorsque la distribution des données entrantes dévie au-delà du seuil de Kolmogorov-Smirnov.

import { matchText } from './resolver'

/* Index des pages de l'application (routes de App.tsx sans paramètre) : quand l'élément demandé n'est pas
 * à l'écran, Auto va sur la page la plus probable, la parcourt, puis montre l'élément (ou le titre de la page). */

export interface PageDef { path: string; title: string; keywords: string[] }

export const PAGES: PageDef[] = [
  { path: '/data', title: 'Données', keywords: ['data', 'datasets', 'jeux de donnees', 'fichiers', 'files', 'importer', 'import', 'upload', 'csv', 'profil', 'profiling', 'colonnes', 'columns'] },
  { path: '/training', title: 'Centre d’entraînement', keywords: ['entrainement', 'training', 'train', 'entrainer', 'lancer entrainement', 'jobs', 'budget', 'preparer'] },
  { path: '/training/models', title: 'Catalogue des modèles', keywords: ['catalogue', 'catalog', 'modeles disponibles', 'algorithmes', 'algorithms', 'hyperparametres', 'hyperparameters'] },
  { path: '/training/experiments', title: 'Expériences', keywords: ['experiences', 'experiments', 'runs', 'resultats', 'results', 'scores', 'metriques', 'metrics', 'comparer', 'compare', 'leaderboard', 'classement'] },
  { path: '/assistant', title: 'Assistant', keywords: ['assistant', 'ia', 'ai', 'objectif', 'goal', 'plan', 'proposition', 'proposal'] },
  { path: '/assistant/settings', title: 'Mode de l’assistant et politique', keywords: ['mode', 'politique', 'policy', 'approbations', 'approvals', 'guide', 'expert', 'auto'] },
  { path: '/assistant/audit', title: 'Journal des décisions', keywords: ['journal', 'audit', 'decisions', 'traces', 'historique assistant'] },
  { path: '/studio', title: 'Workflows', keywords: ['studio', 'workflows', 'workflow', 'pipelines', 'pipeline', 'nouveau workflow', 'gabarits', 'templates'] },
  { path: '/studio/executions', title: 'Exécutions', keywords: ['executions', 'execution', 'lancements', 'runs', 'historique', 'history', 'logs', 'progression'] },
  { path: '/studio/registry', title: 'Registre de modèles', keywords: ['registre', 'registry', 'modeles enregistres', 'saved models', 'deployer', 'deploy', 'production', 'alias', 'prediction', 'predire', 'predict'] },
  { path: '/settings', title: 'Personnalisation', keywords: ['personnaliser', 'personnalisation', 'personalize', 'customize', 'settings', 'parametres', 'reglages', 'preferences', 'apparence', 'appearance', 'theme', 'couleurs', 'colors', 'mascotte', 'auto'] },
]

/** Page la plus probable pour ces mots (null si aucune ne correspond vraiment). */
export function bestPage(words: string[]): PageDef | null {
  let best: PageDef | null = null, top = 0
  for (const p of PAGES) {
    const s = Math.max(matchText(words, p.title).score, ...p.keywords.map((k) => matchText(words, k).score))
    if (s > top + 1e-6) { top = s; best = p }
  }
  return top >= 0.8 ? best : null
}

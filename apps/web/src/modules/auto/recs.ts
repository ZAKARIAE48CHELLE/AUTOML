import type { AutoNotice } from './autoBus'

export type AutoMenuItem = AutoNotice & { context?: boolean }

/* Suggestions du clic droit sur Auto, selon la page ouverte. Fausses pour l'instant : l'agent réel (E3) les fournira. */
const BY_SECTION: [prefix: string, items: Omit<AutoMenuItem, 'id' | 'level' | 'context'>[]][] = [
  ['/data', [
    { title: 'Profiler un jeu de données', detail: 'Repérez valeurs manquantes et colonnes déséquilibrées avant d’entraîner.', to: '/data' },
    { title: 'Lancer un entraînement', detail: 'Vos données sont prêtes ? Passez au centre d’entraînement.', to: '/training' },
  ]],
  ['/training', [
    { title: 'Comparer vos expériences', detail: 'Mettez les scores côte à côte pour choisir le meilleur modèle.', to: '/training/experiments' },
    { title: 'Parcourir le catalogue', detail: 'Découvrez les modèles disponibles et leurs réglages.', to: '/training/models' },
  ]],
  ['/studio/registry', [
    { title: 'Revoir les exécutions', detail: 'Vérifiez l’historique avant de promouvoir un modèle.', to: '/studio/executions' },
  ]],
  ['/studio', [
    { title: 'Voir le registre des modèles', detail: 'Les modèles entraînés et leurs alias de déploiement.', to: '/studio/registry' },
    { title: 'Suivre les exécutions', detail: 'Progression en direct et journaux de chaque nœud.', to: '/studio/executions' },
  ]],
  ['/assistant', [
    { title: 'Consulter le journal d’audit', detail: 'Tout ce que l’assistant a proposé, et qui l’a approuvé.', to: '/assistant/audit' },
  ]],
  ['/settings', [
    { title: 'Retour aux données', detail: 'Reprenez là où vous en étiez.', to: '/data' },
  ]],
]
const DEFAULT: Omit<AutoMenuItem, 'id' | 'level' | 'context'>[] = [{ title: 'Ouvrir le Studio', detail: 'Construisez et exécutez vos pipelines.', to: '/studio' }]

export function contextRecs(pathname: string): AutoMenuItem[] {
  const hit = BY_SECTION.find(([p]) => pathname === p || pathname.startsWith(p + '/'))
  return (hit ? hit[1] : DEFAULT).map((r, i) => ({ ...r, id: `ctx-${i}-${r.to}`, level: 'tip', context: true }))
}

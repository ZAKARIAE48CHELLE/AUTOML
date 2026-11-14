import { MODEL_CATALOG, NODE_TYPES, PIPELINE_TYPES, PREPROCESS_STEPS } from '@contracts/src'

/* Registre des éléments de l'interface qu'Auto sait montrer. Un élément se déclare avec l'attribut
 * data-auto-target="<id>" ; plusieurs éléments peuvent partager un id (ils sont alors tous entourés). */

export interface Target {
  id: string
  label: string
  /** Mots-clés décisifs (le libellé en fait toujours partie). */
  keywords: string[]
  /** Mots-clés secondaires (clé technique du catalogue) : comptent moins que le libellé. */
  weak?: string[]
  /** Page où vit l'élément : Auto y navigue s'il n'est pas affiché. */
  route?: string
  /** Repli quand l'élément n'est pas monté (ex. l'onglet Studio pour un bloc de la palette). */
  parent?: string
  selector: string
  /** Désignation dans une phrase, avec article : « le bloc Split », « l’onglet Données ». */
  name: string
  /** Pronom complément : « je te le / la / les montre ». */
  pro?: 'le' | 'la' | 'les'
  /** Où se trouve l'élément, pour la bulle : « dans le panneau Blocs ». */
  where: string
  /** Ce qu'il faut faire quand seul le parent est visible. */
  missing?: string
}

export const targetSelector = (id: string) => `[data-auto-target="${id}"]`
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const clean = (s: string) => s.replace(/\s*\(G-DL\)/, '')

function t(id: string, label: string, name: string, where: string, keywords: string[] = [], extra: Partial<Target> = {}): Target {
  return { id, label, name, where, keywords: [label, ...keywords], selector: targetSelector(id), ...extra }
}

/** Id cible d'un bloc de la palette (nœud, étape de prétraitement ou modèle). */
export const blockTargetId = (b: { kind: 'node' | 'step'; type: string } | { kind: 'model'; model_id: string }) =>
  b.kind === 'model' ? `studio.block.model.${b.model_id}` : `studio.block.${b.type}`
/** Id cible d'un titre de section de la palette : « Prétraitement · Encodage » → studio.section.pretraitement. */
export const sectionTargetId = (title: string) => `studio.section.${slug(title.split(' · ')[0].split(' ')[0])}`

const OPEN_WORKFLOW = 'Ouvre un workflow dans le Studio, je te montre le bloc ensuite.'
const PALETTE = { parent: 'nav.studio', missing: OPEN_WORKFLOW }
const IN_PALETTE = 'dans le panneau Blocs, à gauche'

/* Blocs : générés depuis le catalogue partagé, jamais listés à la main. */
const BLOCKS: Target[] = [
  ...NODE_TYPES.map((n) => t(`studio.block.${n.type}`, n.label, `le bloc ${n.label}`, IN_PALETTE, [], { ...PALETTE, weak: [n.type] })),
  ...PREPROCESS_STEPS.map((s) => t(`studio.block.${s.type}`, clean(s.label), `le bloc ${clean(s.label)}`, IN_PALETTE, [], { ...PALETTE, weak: [s.type] })),
  ...MODEL_CATALOG.map((m) => t(`studio.block.model.${m.id}`, clean(m.label), `le modèle ${clean(m.label)}`, IN_PALETTE, [], { ...PALETTE, weak: [m.id] })),
]

const STUDIO: Target[] = [
  ...PIPELINE_TYPES.map((p) => t(`studio.type.${p.id}`, p.short_label, `le type ${p.short_label}`, 'en haut du panneau Blocs', [p.label], { ...PALETTE, missing: 'Ouvre un workflow dans le Studio, je te montre les types de pipeline ensuite.' })),
  t('studio.template', 'Construire le pipeline type', 'le bouton « Construire le pipeline type »', 'en haut du panneau Blocs', ['gabarit', 'template'], PALETTE),
  t('studio.progress', 'Pipeline complet ?', 'la progression du pipeline', 'dans le panneau Blocs', ['progression', 'progress', 'checklist'], { ...PALETTE, pro: 'la' }),
  ...([
    ['type', 'Type de pipeline', ['types pipeline']], ['donnees', 'Données', ['data']], ['decoupage', 'Découpage', []],
    ['pretraitement', 'Prétraitement', ['preprocessing']], ['modeles', 'Modèles', ['models']], ['optimisation', 'Optimisation', ['tuning']],
    ['evaluation', 'Évaluation', []], ['sortie', 'Sortie', ['export']],
  ] as const).map(([k, label, kw]) => t(`studio.section.${k}`, label, `la section ${label}`, IN_PALETTE, [...kw], { ...PALETTE, pro: 'la' })),
]

const MENU = 'dans le menu de gauche'
const NAV: Target[] = [
  t('nav.data', 'Données', 'l’onglet Données', MENU, ['data', 'datasets', 'jeux de donnees', 'fichiers', 'files']),
  t('nav.training', 'Entraînement', 'l’onglet Entraînement', MENU, ['training', 'train', 'entrainer', 'entrainements', 'jobs']),
  t('nav.assistant', 'Assistant', 'l’onglet Assistant', MENU, ['ia', 'ai', 'agent', 'objectif', 'goal']),
  t('nav.studio', 'Studio', 'l’onglet Studio', MENU, ['workflow', 'workflows', 'pipeline', 'pipelines', 'editeur', 'editor']),
  t('nav.registry', 'Registre', 'l’onglet Registre', MENU, ['registry', 'models', 'modeles', 'modeles enregistres', 'deployer', 'deploy', 'production', 'alias']),
  t('nav.settings', 'Personnaliser', 'l’onglet Personnaliser', 'en bas du menu de gauche',
    ['personnalisation', 'personalize', 'personalise', 'personalization', 'customize', 'customise', 'customization', 'settings', 'parametres', 'reglages', 'preferences', 'apparence', 'appearance', 'options', 'configuration']),
  t('nav.logout', 'Déconnexion', 'le bouton Déconnexion', 'en bas du menu de gauche', ['deconnecter', 'logout', 'log out', 'sign out', 'signout', 'quitter']),
]

const HEADER: Target[] = [
  t('header.project', 'Sélecteur de projet', 'le sélecteur de projet', 'en haut de la page', ['projet', 'project', 'projets', 'projects', 'changer projet', 'switch project']),
  t('header.mode', 'Mode de l’assistant', 'le badge du mode', 'en haut à droite', ['mode', 'badge', 'approbations', 'approvals', 'politique', 'policy']),
  t('header.theme', 'Thème', 'le bouton du thème', 'en haut à droite', ['mode sombre', 'dark mode', 'sombre', 'clair', 'theme', 'dark', 'light', 'nuit', 'night']),
  t('header.assistant', 'Bouton Assistant', 'le bouton Assistant', 'en haut à droite', ['chat', 'discussion', 'discuter', 'question']),
  t('chat.plan', 'Générer un plan de workflow', 'le bouton « Générer un plan de workflow »', 'dans le chat', ['plan'],
    { parent: 'header.assistant', missing: 'Ouvre l’assistant et décris ton objectif : le bouton apparaît sous sa réponse.' }),
]

/* Actions principales des pages : Auto y navigue s'il n'y est pas. */
const PAGES: Target[] = [
  t('data.import', 'Importer un fichier', 'le bouton « Importer un fichier »', 'en haut de la page Données', ['importer', 'import', 'upload', 'televerser', 'charger', 'csv', 'nouveau dataset', 'ajouter donnees'], { route: '/data', parent: 'nav.data' }),
  t('training.catalog', 'Catalogue', 'le catalogue des modèles', 'en haut du centre d’entraînement', ['catalogue modeles', 'catalog', 'model catalog', 'modeles disponibles', 'algorithmes', 'algorithms'], { route: '/training', parent: 'nav.training' }),
  t('training.experiments', 'Expériences', 'les expériences', 'en haut du centre d’entraînement', ['experiences', 'experiments', 'runs', 'resultats', 'results', 'comparer', 'compare', 'scores'], { route: '/training', parent: 'nav.training', pro: 'les' }),
  t('studio.executions', 'Exécutions', 'les exécutions', 'en haut de la page Studio', ['executions', 'execution', 'lancements', 'historique', 'history', 'logs'], { route: '/studio', parent: 'nav.studio', pro: 'les' }),
  t('studio.new', 'Nouveau workflow', 'le bouton « Nouveau workflow »', 'en haut de la page Studio', ['creer workflow', 'new workflow', 'create workflow', 'nouveau pipeline', 'new pipeline', 'create pipeline'], { route: '/studio', parent: 'nav.studio' }),
  t('assistant.audit', 'Journal des décisions', 'le journal des décisions', 'en haut de la page Assistant', ['journal', 'audit', 'decisions', 'trace', 'traces'], { route: '/assistant', parent: 'nav.assistant' }),
]
/** Repli quand l'élément est caché derrière l'éditeur plein écran. */
export const EDITOR_BACK = 'editor.back'

const SETTINGS: Target[] = [
  t(EDITOR_BACK, 'Retour au Studio', 'le bouton « Studio »', 'en haut à gauche de l’éditeur', ['quitter editeur', 'exit editor', 'retour', 'back']),
  t('settings.palette', 'Thème du mode sombre', 'les thèmes du mode sombre', 'sur la page Personnalisation', ['palette', 'couleurs', 'colors', 'colours', 'themes sombres', 'dark themes'], { route: '/settings', parent: 'nav.settings', pro: 'les' }),
  t('settings.auto', 'Auto, votre compagnon', 'la carte d’Auto', 'sur la page Personnalisation', ['mascotte', 'compagnon'], { route: '/settings', parent: 'nav.settings', pro: 'la' }),
]

export const TARGETS: Target[] = [...BLOCKS, ...STUDIO, ...NAV, ...HEADER, ...PAGES, ...SETTINGS]
export const TARGET_BY_ID: Record<string, Target> = Object.fromEntries(TARGETS.map((x) => [x.id, x]))

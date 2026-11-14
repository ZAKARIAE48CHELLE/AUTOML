import { describe, expect, it } from 'vitest'
import { levenshtein, locateRequest, matchText, resolveTargets } from './resolver'
import { bestPage } from './pages'

const ids = (text: string) => resolveTargets(text)?.targets.map((t) => t.id) ?? null

describe('résolution des demandes « où est… »', () => {
  it('comprend l’anglais approximatif', () => {
    expect(ids('whos me where the split is')).toEqual(['studio.block.data.split'])
  })
  it('anglais correct', () => {
    expect(ids('where is the split')).toEqual(['studio.block.data.split'])
  })
  it('français avec accents et ponctuation', () => {
    expect(ids('où est le bloc split ?')).toEqual(['studio.block.data.split'])
  })
  it('plusieurs blocs à égalité : tous renvoyés', () => {
    expect(ids('montre moi imputation')?.sort()).toEqual(['studio.block.impute_mean', 'studio.block.impute_median', 'studio.block.impute_most_frequent'])
  })
  it('libellé de plusieurs mots', () => {
    expect(ids('où est le bloc Exclure des colonnes ?')).toEqual(['studio.block.drop_columns'])
  })
  it('tolère les fautes de frappe', () => {
    expect(ids('where is the splt')).toEqual(['studio.block.data.split'])
  })
  it('un nom exact l’emporte sur un nom qui le contient', () => {
    expect(ids('montre régression')).toEqual(['studio.type.regression'])
  })
  it('un message très court qui n’est qu’un nom d’élément', () => {
    expect(ids('split')).toEqual(['studio.block.data.split'])
  })
  it('pas une demande d’emplacement : null', () => {
    expect(ids('explique moi le split')).toBeNull()
    expect(ids('Je veux prédire churn avec un budget de 10 min')).toBeNull()
  })
  it('charabia : null', () => {
    expect(ids('qsdkjh zzzz wxcv')).toBeNull()
    expect(ids('')).toBeNull()
  })
  it('toute l’application, en français comme en anglais', () => {
    expect(ids('show me where i can personalize the app')).toEqual(['nav.settings'])
    expect(ids('where do i customize the app')).toEqual(['nav.settings'])
    expect(ids('où je change le thème')).toEqual(['header.theme'])
    expect(ids('how do i log out')).toEqual(['nav.logout'])
    expect(ids('take me to the registry')).toEqual(['nav.registry'])
    expect(ids('where can i change project')).toEqual(['header.project'])
    expect(ids('où sont les expériences')).toEqual(['training.experiments'])
    expect(ids('where are the executions')).toEqual(['studio.executions'])
    expect(ids('where do i upload a csv')).toEqual(['data.import'])
    expect(ids('montre moi le journal des décisions')).toEqual(['assistant.audit'])
    expect(ids('where are my models')).toContain('nav.registry')
  })
  it('hors registre : une vraie demande d’emplacement part en recherche libre', () => {
    expect(locateRequest('where is the confusion matrix')).toEqual({ targets: [], words: ['confusion', 'matrix'], strength: 0 })
    expect(locateRequest('où est le bouton annuler')).toEqual({ targets: [], words: ['annuler'], strength: 0 })
    expect(locateRequest('where is the save button')?.words).toEqual(['save']) // « save » n'est pas « take »
    expect(locateRequest('where is the fullscreen button')?.words).toEqual(['fullscreen'])
    expect(locateRequest('explique moi le split')).toBeNull()
    expect(locateRequest('qsdkjh zzzz wxcv')).toBeNull()
    expect(locateRequest('where is the split')?.targets).toEqual(['studio.block.data.split'])
  })
  it('page la plus probable', () => {
    expect(bestPage(['experiments'])?.path).toBe('/training/experiments')
    expect(bestPage(['predire'])?.path).toBe('/studio/registry')
    expect(bestPage(['hyperparametres'])?.path).toBe('/training/models')
    expect(bestPage(['banane'])).toBeNull()
  })
  it('correspondance avec un texte quelconque de l’interface', () => {
    expect(matchText(['annuler'], 'Annuler').score).toBe(1)
    expect(matchText(['enregistrer'], 'Enregistrer la version').hits).toBe(1)
    expect(matchText(['matrix'], 'Matrice de confusion').score).toBeGreaterThan(0.5)
  })
  it('distance de Levenshtein', () => {
    expect(levenshtein('whos', 'show')).toBe(2)
    expect(levenshtein('split', 'split')).toBe(0)
  })
})

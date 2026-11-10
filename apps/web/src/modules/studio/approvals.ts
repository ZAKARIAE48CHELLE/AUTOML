import type * as C from '@contracts/src'
import { requirements, budgetNeeds } from '@contracts/src'
import { studioApi } from '@/api/studio'

/** Crée les approbations correspondant aux exigences de la politique (clic explicite de l'utilisateur) et retourne leurs ids. */
export async function createApprovals(versionId: string, spec: C.WorkflowSpec, mode: C.Mode, only?: (r: ReturnType<typeof requirements>[number]) => boolean): Promise<string[]> {
  const ids: string[] = []
  for (const r of requirements(spec, mode).filter((x) => x.kind !== 'click' && (!only || only(x)))) {
    const res = await studioApi.approve({ workflow_version_id: versionId, operation_classes: [r.operation_class], node_ids: r.kind === 'plan' ? undefined : r.node_ids, budget: r.kind === 'plan' ? budgetNeeds(spec) : undefined, method: 'explicit_click', scope: 'lineage' })
    ids.push(res.approval_id)
  }
  return ids
}

// Contrat E3 — Agentic AI. L'assistant ne lance jamais d'exécution : il crée des versions de workflow (origin = ai) et des PlanProposal.
import type * as C from '@contracts/src'
import { get, post, put } from './client'

export const assistantApi = {
  messages: (project_id: string) => get<C.ChatMessage[]>('/assistant/messages', { project_id }),
  send: (project_id: string, message: string, context_refs: string[] = []) => post<{ user_message: C.ChatMessage; reply: C.ChatMessage }>('/assistant/messages', { project_id, message, context_refs }),
  parseGoal: (text: string, dataset_version_id: string) => post<{ goal: C.GoalSpec; questions: string[]; warnings: string[]; simulated?: boolean }>('/assistant/goals/parse', { text, dataset_version_id }),
  propose: (goal_id: string, dataset_version_id: string) => post<C.PlanProposal>('/assistant/proposals', { goal_id, dataset_version_id }),
  proposal: (id: string) => get<C.PlanProposal>(`/assistant/proposals/${id}`),
  explain: (subject_ref: string) => post<C.Explanation>('/assistant/explanations', { subject_ref }),
  mode: (project_id: string) => get<{ project_id: string; mode: C.Mode }>('/assistant/mode', { project_id }),
  setMode: (project_id: string, mode: C.Mode) => put<{ project_id: string; mode: C.Mode }>('/assistant/mode', { project_id, mode }),
  audit: (project_id: string, f: { action?: string; actor_type?: string } = {}) => get<C.AuditEvent[]>('/assistant/audit', { project_id, ...f }),
  policy: () => get<{ classes: { id: C.OpClass; label: string; examples: string }[]; modes: string[]; matrix: { cls: C.OpClass; auto: string; guided: string; expert: string }[] }>('/policy/matrix'),
}

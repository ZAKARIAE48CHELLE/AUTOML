import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './shell/Layout'
import { Login } from './shell/Login'
import { Projects } from './shell/Projects'
import { DatasetsPage } from './modules/data/DatasetsPage'
import { DatasetDetail } from './modules/data/DatasetDetail'
import { TrainingCenter } from './modules/training/TrainingCenter'
import { JobDetail } from './modules/training/JobDetail'
import { ModelCatalog } from './modules/training/ModelCatalog'
import { Experiments } from './modules/training/Experiments'
import { RunDetail } from './modules/training/RunDetail'
import { AssistantPage } from './modules/assistant/AssistantPage'
import { ModeSettings } from './modules/assistant/ModeSettings'
import { AuditPage } from './modules/assistant/AuditPage'
import { WorkflowsList } from './modules/studio/WorkflowsList'
import { WorkflowEditor } from './modules/studio/WorkflowEditor'
import { ReviewPage } from './modules/studio/ReviewPage'
import { ExecutionsList } from './modules/studio/ExecutionsList'
import { ExecutionDetail } from './modules/studio/ExecutionDetail'
import { ExportPage } from './modules/studio/ExportPage'
import { RegistryPage } from './modules/studio/RegistryPage'

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/projects" element={<Projects />} />
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/data" replace />} />
        <Route path="/data" element={<DatasetsPage />} />
        <Route path="/data/:datasetId" element={<DatasetDetail />} />
        <Route path="/training" element={<TrainingCenter />} />
        <Route path="/training/jobs/:jobId" element={<JobDetail />} />
        <Route path="/training/models" element={<ModelCatalog />} />
        <Route path="/training/experiments" element={<Experiments />} />
        <Route path="/training/experiments/:runId" element={<RunDetail />} />
        <Route path="/assistant" element={<AssistantPage />} />
        <Route path="/assistant/settings" element={<ModeSettings />} />
        <Route path="/assistant/audit" element={<AuditPage />} />
        <Route path="/studio" element={<WorkflowsList />} />
        <Route path="/studio/workflows/:workflowId" element={<WorkflowEditor />} />
        <Route path="/studio/workflows/:workflowId/review/:versionId" element={<ReviewPage />} />
        <Route path="/studio/executions" element={<ExecutionsList />} />
        <Route path="/studio/executions/:executionId" element={<ExecutionDetail />} />
        <Route path="/studio/exports/:exportId" element={<ExportPage />} />
        <Route path="/studio/registry" element={<RegistryPage />} />
        <Route path="*" element={<Navigate to="/data" replace />} />
      </Route>
    </Routes>)
}

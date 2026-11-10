import { registerData } from './handlers/data'
import { registerTraining } from './handlers/training'
import { registerAssistant } from './handlers/assistant'
import { registerStudio } from './handlers/studio'
let done = false
export function registerAll() { if (done) return; done = true; registerData(); registerTraining(); registerStudio(); registerAssistant() }
export { dispatch, registeredRoutes } from './router'
export { resetDb, db } from './db'
export { subscribe } from './bus'
export { speed } from './util'

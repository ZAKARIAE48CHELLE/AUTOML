import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'framer-motion'
import { SessionProvider } from './lib/session'
import { App } from './App'
import '@xyflow/react/dist/style.css'
import './styles.css'

const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5_000 } } })
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={qc}><BrowserRouter><MotionConfig reducedMotion="user"><SessionProvider><App /></SessionProvider></MotionConfig></BrowserRouter></QueryClientProvider></React.StrictMode>)

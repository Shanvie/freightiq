import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import FreightIQ from './FreightIQ.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FreightIQ />
  </StrictMode>,
)

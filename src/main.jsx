import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import FocusPeaking from './FocusPeaking.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <div style={{ maxWidth: 1600, margin: '24px auto', padding: '0 16px' }}>
      <FocusPeaking />
    </div>
  </StrictMode>,
)

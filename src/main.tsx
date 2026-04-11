import { createRoot } from 'react-dom/client'
import { ensureDesktopBridge } from './cliproxyBridge'
import './index.css'
import App from './App'

void ensureDesktopBridge().finally(() => {
  createRoot(document.getElementById('root')!).render(<App />)
})

import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { setupMotion } from './app/motion.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'
import './app/look.css'
import './components/glass/glass.css'

ensureKatex()
setupTheme()
setupMotion()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)

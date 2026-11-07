import React from 'react'
import {createRoot} from 'react-dom/client'
import './style.css'
import App from './App'
import {PrefsProvider} from './prefs'

createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <PrefsProvider><App/></PrefsProvider>
    </React.StrictMode>
)

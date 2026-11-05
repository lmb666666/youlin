import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/query'
import App from './App'
import { ThemeProvider } from './lib/theme'
import { Toaster } from '@/components/ui/sonner'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        <Toaster position="top-center" richColors />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { TooltipProvider } from './components/ui/tooltip';
import './styles.css';

const root = document.getElementById('root');

if (!root) throw new Error('NodeVideo root element is missing.');

createRoot(root).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
);

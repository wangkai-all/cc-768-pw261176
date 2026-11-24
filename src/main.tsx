import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Apply the saved theme before the first paint so there is no flash.
try {
  const stored = localStorage.getItem('summary-bounds.theme');
  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme =
    stored === 'dark' || stored === 'light' ? stored : prefersDark ? 'dark' : 'light';
} catch {
  document.documentElement.dataset.theme = 'light';
}

const root = document.getElementById('root');
if (!root) throw new Error('缺少 #root 挂载点');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

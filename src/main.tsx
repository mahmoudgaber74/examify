import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { MarketingAnalytics } from './components/MarketingAnalytics.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <MarketingAnalytics>
        <App />
      </MarketingAnalytics>
    </ErrorBoundary>
  </StrictMode>
);

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { Notices } from './notices';
import './styles.css';

const isBroadcast = new URLSearchParams(window.location.search).get('view') === 'broadcast';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    {isBroadcast ? null : <Notices />}
  </React.StrictMode>,
);

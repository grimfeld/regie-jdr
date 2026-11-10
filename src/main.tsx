import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { Notices } from './notices';
import './styles.css';

const isBroadcast = new URLSearchParams(window.location.search).get('view') === 'broadcast';
// The Broadcast window's page styles (no theme, no minimum width, no cursor) key on this.
if (isBroadcast) document.documentElement.dataset.view = 'broadcast';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    {isBroadcast ? null : <Notices />}
  </React.StrictMode>,
);

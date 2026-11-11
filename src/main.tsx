import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { startAudioEngine } from './audioEngine';
import { ErrorBoundary } from './ErrorBoundary';
import { Notices } from './notices';
// Theme tokens first (CODING_STANDARDS.md, "Themes"), then the components that use them.
import './themes/tokens.css';
import './themes/unthemed.css';
import './themes/retro.css';
import './themes/imperium.css';
import './themes/fantasy.css';
import './styles.css';

const isBroadcast = new URLSearchParams(window.location.search).get('view') === 'broadcast';
// The Broadcast window's page styles (no theme, no minimum width, no cursor) key on this.
if (isBroadcast) document.documentElement.dataset.view = 'broadcast';

// A drop that no drop target took (any drop in the Broadcast window, which takes none) is
// refused, so a file dragged in from Explorer never opens in place of the app's page.
window.addEventListener('dragover', (event) => {
  if (event.defaultPrevented) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
});
window.addEventListener('drop', (event) => event.preventDefault());

// All app audio plays here, in the Control window (ADR-0002), outside React: it lives as long
// as the page. The Broadcast window has no audio engine and gets no audio data.
if (!isBroadcast && window.regieAudio) startAudioEngine(window.regieAudio);

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary window={isBroadcast ? 'broadcast' : 'control'}>
      <App />
    </ErrorBoundary>
    {isBroadcast ? null : <Notices />}
  </React.StrictMode>,
);

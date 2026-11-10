import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const devServer = { host: '127.0.0.1', port: 5173 };

/**
 * Content security policy of the app's pages: only the app's own scripts and
 * styles, and Media served through the `regie-media:` scheme.
 * The dev server additionally needs inline scripts and styles (React refresh
 * preamble, CSS injected by Vite) and its hot-reload WebSocket.
 */
function contentSecurityPolicy(mode: 'build' | 'serve'): string {
  const dev = mode === 'serve';
  const directives = {
    'default-src': ["'none'"],
    'script-src': ["'self'", ...(dev ? ["'unsafe-inline'"] : [])],
    'style-src': ["'self'", ...(dev ? ["'unsafe-inline'"] : [])],
    'img-src': ["'self'", 'regie-media:'],
    'media-src': ["'self'", 'regie-media:'],
    'font-src': ["'self'"],
    'connect-src': [
      "'self'",
      'regie-media:',
      ...(dev ? [`ws://${devServer.host}:${devServer.port}`] : []),
    ],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

function contentSecurityPolicyMeta(): Plugin {
  let mode: 'build' | 'serve' = 'build';
  return {
    name: 'regie-content-security-policy',
    configResolved(config) {
      mode = config.command;
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy(mode) },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  // Relative asset paths: the production build is loaded from disk with loadFile,
  // where an absolute `/assets/...` would resolve to the drive root.
  base: './',
  plugins: [react(), contentSecurityPolicyMeta()],
  server: { ...devServer, strictPort: true },
});

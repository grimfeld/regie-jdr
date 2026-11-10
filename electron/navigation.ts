/**
 * Whether `url` is one of the app's own pages, given the URL the app loads
 * (`entry`): the dev server origin in development, the built index.html on
 * disk in production. Windows may only navigate to these pages.
 */
export function isAppPage(url: string, entry: string): boolean {
  let target: URL;
  let app: URL;
  try {
    target = new URL(url);
    app = new URL(entry);
  } catch {
    return false;
  }
  // file:// URLs have an opaque origin: compare the file itself instead.
  if (app.protocol === 'file:')
    return target.protocol === 'file:' && target.pathname === app.pathname;
  return target.origin === app.origin;
}

import { describe, expect, it } from 'vitest';
import { isAppPage } from '../../electron/navigation';

describe('isAppPage, built app loaded from disk', () => {
  const entry = 'file:///C:/Program%20Files/Regie%20JDR/resources/app/dist/index.html';

  it('accepts the app page, with or without a query or hash', () => {
    expect(isAppPage(entry, entry)).toBe(true);
    expect(isAppPage(`${entry}?view=broadcast`, entry)).toBe(true);
    expect(isAppPage(`${entry}#top`, entry)).toBe(true);
  });

  it('refuses other files on disk', () => {
    expect(isAppPage('file:///C:/Windows/System32/drivers/etc/hosts', entry)).toBe(false);
    expect(
      isAppPage('file:///C:/Program%20Files/Regie%20JDR/resources/app/dist/other.html', entry),
    ).toBe(false);
  });

  it('refuses web pages and other schemes', () => {
    expect(isAppPage('https://example.com/', entry)).toBe(false);
    expect(isAppPage('regie-asset://assets/a.png', entry)).toBe(false);
    expect(isAppPage('javascript:alert(1)', entry)).toBe(false);
    expect(isAppPage('not a url', entry)).toBe(false);
  });
});

describe('isAppPage, development server', () => {
  const entry = 'http://127.0.0.1:5173';

  it('accepts any page of the dev server origin', () => {
    expect(isAppPage('http://127.0.0.1:5173/', entry)).toBe(true);
    expect(isAppPage('http://127.0.0.1:5173/?view=broadcast', entry)).toBe(true);
  });

  it('refuses other origins, including other ports and hosts', () => {
    expect(isAppPage('http://127.0.0.1:5174/', entry)).toBe(false);
    expect(isAppPage('http://localhost:5173/', entry)).toBe(false);
    expect(isAppPage('https://127.0.0.1:5173/', entry)).toBe(false);
  });
});

import { expect, openBroadcastWindow, test } from './harness';

test('both windows are sandboxed, context-isolated and without Node integration', async ({
  regie,
}) => {
  const { app, controlWindow } = regie;
  await openBroadcastWindow(app, controlWindow);

  const preferences = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => {
      // Undocumented in the typings, but returns the effective preferences of the page.
      const contents = window.webContents as unknown as {
        getLastWebPreferences(): Electron.WebPreferences | null;
      };
      const prefs = contents.getLastWebPreferences();
      return {
        sandbox: prefs?.sandbox,
        contextIsolation: prefs?.contextIsolation,
        nodeIntegration: prefs?.nodeIntegration,
      };
    }),
  );

  expect(preferences).toHaveLength(2);
  for (const prefs of preferences) {
    expect(prefs).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false });
  }
});

test('window.open is denied in both windows', async ({ regie }) => {
  const { app, controlWindow } = regie;
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);

  for (const page of [controlWindow, broadcastWindow]) {
    const opened = await page.evaluate(() => window.open('https://example.com/') !== null);
    expect(opened).toBe(false);
  }
  const windowCount = await app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
  );
  expect(windowCount).toBe(2);
});

test("navigation away from the app's own pages is blocked in both windows", async ({ regie }) => {
  const { app, controlWindow } = regie;
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);

  for (const page of [controlWindow, broadcastWindow]) {
    const appUrl = page.url();
    // Record, in the main process, whether the navigation request gets cancelled.
    await app.evaluate(({ webContents }) => {
      const record = globalThis as { navigationCancelled?: boolean };
      delete record.navigationCancelled;
      for (const contents of webContents.getAllWebContents()) {
        contents.once('will-frame-navigate', (event) =>
          setTimeout(() => (record.navigationCancelled = event.defaultPrevented)),
        );
      }
    });
    await page.evaluate(() => {
      window.location.href = 'https://example.com/';
    });
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as { navigationCancelled?: boolean }).navigationCancelled),
      )
      .toBe(true);
    expect(page.url()).toBe(appUrl);
  }
});

test('the app can still navigate within its own pages', async ({ regie }) => {
  const { controlWindow } = regie;
  await controlWindow.evaluate(() => {
    window.location.href = `${window.location.href.split('?')[0]}?view=stage`;
  });
  await expect(controlWindow.getByText('SCÈNE EN COURS')).toBeVisible();
});

test('the content security policy blocks inline scripts and remote content in both windows', async ({
  regie,
}) => {
  const { app, controlWindow, cspViolations } = regie;
  const broadcastWindow = await openBroadcastWindow(app, controlWindow);
  expect(cspViolations).toEqual([]);

  for (const page of [controlWindow, broadcastWindow]) {
    const outcome = await page.evaluate(async () => {
      const blocked: string[] = [];
      document.addEventListener('securitypolicyviolation', (event) =>
        blocked.push(event.effectiveDirective),
      );
      const inline = document.createElement('script');
      inline.textContent = 'window.inlineScriptRan = true';
      document.body.append(inline);
      const remoteScript = document.createElement('script');
      remoteScript.src = 'https://example.com/evil.js';
      document.body.append(remoteScript);
      const remoteImage = document.createElement('img');
      remoteImage.src = 'https://example.com/tracker.png';
      document.body.append(remoteImage);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const ran = (window as { inlineScriptRan?: boolean }).inlineScriptRan === true;
      return { ran, blocked: [...new Set(blocked)].sort() };
    });
    expect(outcome).toEqual({ ran: false, blocked: ['img-src', 'script-src-elem'] });
  }
});

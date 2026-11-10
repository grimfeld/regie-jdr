// The app's log file (core/logger.ts) wired to Electron: it lives in <userData>/logs/regie.log,
// every entry is echoed to the main-process console, and crashes anywhere end up in it.
import { app } from 'electron';
import path from 'node:path';
import { createFileLogger, type Logger, type LogLevel } from '../core/logger.js';

const consoleOf: Record<LogLevel, (text: string) => void> = {
  info: (text) => console.info(text),
  warn: (text) => console.warn(text),
  error: (text) => console.error(text),
};

let logger: Logger | undefined;

/**
 * Created on first use, not at import: main.ts may move the data folder (REGIE_USER_DATA_DIR)
 * after its imports run.
 */
function current(): Logger {
  logger ??= createFileLogger({
    directory: path.join(app.getPath('userData'), 'logs'),
    echo: (level, text) => consoleOf[level](text),
  });
  return logger;
}

/** The app's log. Use it instead of console.* in the main process. */
export const log: Logger = {
  info: (message, detail) => current().info(message, detail),
  warn: (message, detail) => current().warn(message, detail),
  error: (message, detail) => current().error(message, detail),
  get filePath() {
    return current().filePath;
  },
};

/**
 * Logs every failure the Game Master would otherwise lose: main-process exceptions and
 * rejections (handled here, so they no longer kill the app or pop up a dialog), crashed
 * window or helper processes, and errors printed in any window's console.
 */
export function installErrorLogging(): void {
  process.on('uncaughtException', (error) =>
    log.error('Uncaught exception in the main process', error),
  );
  process.on('unhandledRejection', (reason) =>
    log.error('Unhandled rejection in the main process', reason),
  );
  app.on('render-process-gone', (_event, contents, details) =>
    log.error(`Window process gone (${details.reason}): ${contents.getURL()}`),
  );
  app.on('child-process-gone', (_event, details) =>
    log.error(`Helper process gone (${details.type}, ${details.reason})`),
  );
  app.on('web-contents-created', (_event, contents) => {
    contents.on('console-message', (event) => {
      if (event.level === 'error')
        log.error(`Window error: ${event.message} (${event.sourceId}:${event.lineNumber})`);
    });
  });
}

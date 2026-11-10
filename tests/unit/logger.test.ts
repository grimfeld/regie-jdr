import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFileLogger } from '../../core/logger';
import { useTempDir } from './tempDir';

describe('file logger', () => {
  const dir = useTempDir();

  const logFolder = () => path.join(dir.path, 'logs');
  const readLog = (name = 'regie.log') => fs.readFileSync(path.join(logFolder(), name), 'utf8');

  it('writes timestamped entries with their level to a log file in the given folder', () => {
    const logger = createFileLogger({ directory: logFolder() });

    logger.info('Application démarrée');
    logger.warn('IPC message rejected: malformed payload for "display:set"');

    const lines = readLog().trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z INFO Application démarrée$/);
    expect(lines[1]).toMatch(/ WARN IPC message rejected: malformed payload for "display:set"$/);
    expect(logger.filePath).toBe(path.join(logFolder(), 'regie.log'));
  });

  it('rotates the file so the log folder stays bounded, keeping the newest entries', () => {
    const logger = createFileLogger({ directory: logFolder(), maxFileBytes: 1000, maxFiles: 3 });

    for (let n = 1; n <= 500; n++) logger.info(`entrée numéro ${String(n).padStart(3, '0')}`);

    const files = fs.readdirSync(logFolder()).sort();
    expect(files).toEqual(['regie.1.log', 'regie.2.log', 'regie.log']);
    const total = files.reduce(
      (sum, name) => sum + fs.statSync(path.join(logFolder(), name)).size,
      0,
    );
    expect(total).toBeLessThanOrEqual(3000);
    expect(readLog()).toContain('entrée numéro 500');
    expect(readLog('regie.1.log')).not.toContain('entrée numéro 500');
    const everything = files.map((name) => readLog(name)).join('');
    expect(everything).not.toContain('entrée numéro 001');
  });

  it('keeps the folder bounded even when a single entry is larger than a whole file', () => {
    const logger = createFileLogger({ directory: logFolder(), maxFileBytes: 1000, maxFiles: 2 });

    for (let n = 0; n < 5; n++) logger.error('énorme', 'x'.repeat(5000));

    for (const name of fs.readdirSync(logFolder())) {
      expect(fs.statSync(path.join(logFolder(), name)).size).toBeLessThanOrEqual(1000);
    }
    expect(fs.readdirSync(logFolder())).toHaveLength(2);
  });

  it('records the stack of an error passed as detail', () => {
    const logger = createFileLogger({ directory: logFolder() });

    logger.error('Uncaught exception in the main process', new Error('disque plein'));

    expect(readLog()).toMatch(
      /ERROR Uncaught exception in the main process\n {2}Error: disque plein\n {2}\s*at /,
    );
  });

  it('carries on silently when the log folder cannot be written', () => {
    fs.writeFileSync(path.join(dir.path, 'occupé'), '');
    const logger = createFileLogger({ directory: path.join(dir.path, 'occupé', 'logs') });

    expect(() => logger.error('perdu')).not.toThrow();
  });
});

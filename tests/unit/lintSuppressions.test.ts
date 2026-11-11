import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Lints `code` with the project's eslint.config.mjs, as an untyped script. */
async function messagesFor(code: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: fileURLToPath(new URL('../..', import.meta.url)) });
  const [result] = await eslint.lintText(code, { filePath: 'scripts/suppression-probe.mjs' });
  return result.messages.map((message) => message.ruleId ?? message.message);
}

const pause = 'debugger;'; // Refused by no-debugger.

describe('lint suppressions', () => {
  it('accepts a one-rule eslint-disable with a reason', async () => {
    expect(
      await messagesFor(`// eslint-disable-next-line no-debugger -- a reason\n${pause}`),
    ).toEqual([]);
    expect(await messagesFor(`${pause} // eslint-disable-line no-debugger -- a reason`)).toEqual(
      [],
    );
  });

  it.each([
    ['without a reason', `// eslint-disable-next-line no-debugger\n${pause}`],
    ['with an empty reason', `// eslint-disable-next-line no-debugger --\n${pause}`],
    ['without a rule', `// eslint-disable-next-line -- a reason\n${pause}`],
    ['for the whole file', `/* eslint-disable no-debugger -- a reason */\n${pause}`],
    ['as an inline rule setting', `/* eslint no-debugger: off */\n${pause}`],
  ])('refuses an eslint-disable %s', async (_case, code) => {
    expect(await messagesFor(code)).toContain('local/disable-directives');
  });

  it('refuses an eslint-disable that suppresses nothing', async () => {
    const messages = await messagesFor(
      '// eslint-disable-next-line no-debugger -- a reason\nexport const one = 1;',
    );
    expect(messages).toEqual([expect.stringContaining('Unused eslint-disable directive')]);
  });
});

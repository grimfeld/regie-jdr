// Lint rules. The why of each project rule is in CODING_STANDARDS.md.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Core modules the Control and Broadcast windows may import: no Node or Electron inside. */
const RENDERER_SAFE_CORE = ['onAir', 'mediaAddress', 'sceneEdits'];

const noElectronOrReact = [
  {
    name: 'electron',
    message: 'core/ and shared/ have no Electron dependency; wire it in electron/.',
  },
  { name: 'react', message: 'core/ and shared/ have no UI dependency.' },
];

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'dist-electron/',
      'release/',
      'node_modules/',
      'test-results/',
      'playwright-report/',
      '.claude/',
      '.agents/',
      'docs/',
    ],
  },

  js.configs.recommended,

  // TypeScript: strict, type-aware rules everywhere.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.app.json', './electron/tsconfig.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Every union `switch` names every case: a new ThemeId or Media kind cannot be forgotten.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: false },
      ],
      // `import type` for anything used only as a type (the preloads depend on it).
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      // Numbers in messages and file names are fine; objects and unknowns are not.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // `(text) => log.info(text)` and `onClick={() => setOpen(true)}` are the house style.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // `payload: void` is how shared/contract.ts says "no argument".
      '@typescript-eslint/no-invalid-void-type': 'off',
      // Unused parameters kept for an interface's shape are prefixed with `_`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },

  // Plain JavaScript (build hooks, release script, test fixtures): no type information.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['tests/app/fixtures/**/*.js'],
    languageOptions: { sourceType: 'commonjs' },
  },

  // Control and Broadcast windows: React, browser only.
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest']],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // Window consoles are captured into the app's log (electron/logging.ts).
      'no-console': ['error', { allow: ['error', 'warn'] }],
      // Callback props as properties (`onAdd: (image) => void`): safe to destructure.
      '@typescript-eslint/method-signature-style': ['error', 'property'],
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message: 'Windows reach the main process only through window.regie.',
            },
          ],
          patterns: [
            { group: ['node:*'], message: 'Windows run in the browser: no Node modules.' },
            {
              group: ['**/core/*', '**/core/**', ...RENDERER_SAFE_CORE.map((m) => `!**/core/${m}`)],
              allowTypeImports: true,
              message: `Windows may only run core modules free of Node: ${RENDERER_SAFE_CORE.join(', ')}. See CODING_STANDARDS.md.`,
            },
          ],
        },
      ],
    },
  },

  // Domain logic: Node only, no Electron, no UI.
  {
    files: ['core/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { paths: noElectronOrReact }],
    },
  },
  // Core modules the windows run: no Node either.
  {
    files: RENDERER_SAFE_CORE.map((m) => `core/${m}.ts`),
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: noElectronOrReact,
          patterns: [
            { group: ['node:*'], message: 'The windows run this module: no Node modules.' },
            {
              group: ['./*', '!./mediaAddress*', '!./onAir*', '!./sceneEdits*'],
              allowTypeImports: true,
              message: 'The windows run this module: import only renderer-safe core modules.',
            },
          ],
        },
      ],
    },
  },

  // The contract: types only, so the sandboxed preloads can import it.
  {
    files: ['shared/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: noElectronOrReact,
          patterns: [
            { group: ['node:*'], message: 'shared/ is types only.' },
            { group: ['../*'], message: 'shared/ depends on nothing outside shared/.' },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'Program > :matches(VariableDeclaration, FunctionDeclaration, ClassDeclaration, TSEnumDeclaration), ExportNamedDeclaration > :matches(VariableDeclaration, FunctionDeclaration, ClassDeclaration, TSEnumDeclaration), ExportDefaultDeclaration',
          message: 'shared/ is types only: the sandboxed preloads cannot load it at runtime.',
        },
      ],
    },
  },

  // Main process: Node and Electron; log through electron/logging.ts.
  {
    files: ['electron/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['electron/logging.ts'],
    rules: { 'no-console': 'off' }, // The logger's echo to the main-process console.
  },
  // Sandboxed preloads: only `electron` at runtime; everything else `import type`.
  {
    files: ['electron/preload-*.ts'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['*', '!electron'],
              allowTypeImports: true,
              message: 'A sandboxed preload can only require("electron"): use `import type`.',
            },
          ],
        },
      ],
      // A bridge call rejects with a plain IpcFailure: an Error would lose its fields crossing
      // the bridge (shared/contract.ts).
      '@typescript-eslint/only-throw-error': [
        'error',
        { allow: [{ from: 'file', name: 'IpcFailure', path: 'shared/contract.ts' }] },
      ],
    },
  },

  // Tests: Node; the console is allowed in harness diagnostics.
  {
    files: ['tests/**/*.{ts,tsx}', '*.config.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-console': 'off',
      // Asymmetric matchers (`expect.any(String)`) are typed `any` by Vitest and Playwright.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      // Playwright fixtures must destructure their first argument, even when empty: `({}, use)`.
      'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
);

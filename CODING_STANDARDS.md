# Coding standards

Rules a diff is reviewed against. Each one is checkable on the diff; `npm run lint` enforces the ones marked _(lint)_. Vocabulary is from `GLOSSARY.md`; decisions are in `docs/adr/`.

## Layers

| Folder      | Runs in                                | May import                                                                            |
| ----------- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| `shared/`   | nowhere: types only                    | `shared/` only _(lint)_                                                               |
| `core/`     | main process (Node)                    | `shared/`, `core/`, `node:*`; never `electron` or `react` _(lint)_                     |
| `electron/` | main process and preloads              | anything; preloads import only `electron` at runtime, the rest with `import type` _(lint)_ |
| `src/`      | Control and Broadcast windows          | `react`, `shared/` types, and only the Node-free core modules _(lint)_                |

- Domain logic lives in `core/`, testable without Electron. `electron/` wires it to Electron and stays thin.
- The Node-free core modules are listed in `RENDERER_SAFE_CORE` in `eslint.config.mjs` (`onAir`, `mediaAddress`, `sceneEdits`, `canvas`, `guards`). A new one imports no `node:*` and only other Node-free modules; add it to that list and to the pattern beside it.
- `shared/` holds no runtime code _(lint)_: the sandboxed preloads load nothing but `electron`.

## The window contract

- Every message between a window and the main process is a channel in `shared/contract.ts`. Adding one follows the checklist at the top of `core/ipc.ts` (contract, rule, handler, preload, bridge); the compiler refuses a channel missing a rule or a handler.
- Every payload from a window is untrusted: its rule parses it with a guard that keeps only the contract's fields. Mutations are `controlOnly`; the Broadcast window only reads and subscribes.
- Windows reach the main process only through `window.regie`, never `electron` _(lint)_.
- The broadcast stays a projection: what the Broadcast window receives (`OnAirState`) carries only what the players may see. A new field on a Scene, a placement, a Label or the on-air types fails `tests/unit/broadcastProjection.test.ts` until its allow-list says whether it goes on air.
- The Broadcast window may call only the channels its bridge (`electron/preload-broadcast.ts`) calls, all reads; `tests/unit/bridges.test.ts` checks the sender rules against both bridges.

## Untrusted data

- Values from disk or a window are `unknown` until a guard checks them (`isRecord` in `core/guards.ts`, `parse*` functions). Write a guard, not a cast.
- Stored documents are a `DocumentType` with a `version`, a migration per older version and a `parse` check (ADR-0001). A change to a stored shape bumps the version and adds the migration with a test.
- Read-modify-write on a file goes through a serial queue (`core/serialQueue.ts`).

## Errors

- Core code throws its module's error class (`CampaignError`, `MediaError`, `SceneError`, `DocumentError`) with a French message the Game Master can read; that message reaches the window through the IPC failure.
- Every promise is awaited, returned, or ends in `.catch` _(lint)_. `void promise` is for a call whose failure is already handled: in a window, a bridge call whose `IpcFailure` the notice handler shows (`src/notices.tsx`); in the main process, nothing (use `.catch` and log).
- A window shows failures with `showNotice(...)`, worded in French; it never shows a stack or a technical message.
- Every union `switch` handles every member _(lint)_, so a new `ThemeId` or Media kind fails lint where it is not handled.

## Logging

- The main process logs through `log` from `electron/logging.ts`; `console` is lint-banned outside that file _(lint)_.
- Core code does not log on its own: it throws, or reports through a callback it is given (`notify` in `core/storage/`), so tests can pass a fake. Code that does log takes a `Logger` or `Pick<Logger, ...>` parameter (`electron/ipc.ts`).
- Windows use `console.error`/`console.warn` only _(lint)_; errors printed in a window's console reach the log (`electron/logging.ts`).
- Log messages are English, for the developer; pass the error as `detail` so its stack is kept.

## Language and naming

- UI text, notices and error messages meant for the Game Master are French. Code, comments, log messages, test names and commits are English.
- `tests/unit/uiText.test.ts` flags common English words in the text a window shows (JSX text, text attributes, notices, other prose strings); a new English word it should catch goes on its list. It is a tripwire, not a proof: review still checks the wording.
- Names use the glossary's terms (Campaign, Scene, Active Scene, Selected Scene, Background, Overlay, Media, …), in code, tests and commits. A concept missing from the glossary is a question for `/domain-modeling`, not a new synonym.

## Types

- No `any`, no non-null assertion `!`, no unneeded type assertion _(lint)_. Narrow with a guard or a check that throws a clear error.
- `import type` for imports used only as types _(lint)_.
- React callback props are property signatures, `onAdd: (image: ImageMedia) => void` _(lint)_.

## Tests per change

- Logic in `core/` or `electron/` gets a unit test in `tests/unit/` (Vitest), written first where there is logic.
- A change the Game Master can see or do gets a whole-app test in `tests/app/` (Playwright, through `tests/app/harness.ts`).
- A bug fix comes with the test that failed before it.
- Gates, all green, none weakened: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:app`.

## Lint suppressions

- A rule is changed only in `eslint.config.mjs`, scoped to the files that need it, with a comment saying why; the commit body says why too.
- An inline `eslint-disable-next-line <rule> -- <reason>` is allowed only where the code cannot be written to satisfy the rule (a third-party type that is wrong, a platform API with no typed form), names one rule, and gives the reason _(lint)_. Never a file-wide or rule-less disable, nor a rule set in a comment (`/* eslint <rule>: off */`) _(lint)_; a disable that suppresses nothing is an error _(lint)_. Never `@ts-ignore`; `@ts-expect-error -- <reason>` only under the same condition.
- A test is never skipped, deleted or loosened to get to green.

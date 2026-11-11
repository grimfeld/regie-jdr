/**
 * What a window is told when a call fails: the French message of the app core's own errors
 * (CampaignError, MediaError, ImportError…), and for anything else, a file system refusal, a
 * stack overflow or a bug, a French sentence in their place. The technical detail is logged by
 * the caller (electron/ipc.ts), never shown: no `EPERM: operation not permitted, rename 'C:\…'`
 * and no stack reaches the Game Master. No Electron dependency.
 */
import { isRecord } from './guards.js';

/** Shown for an error the app does not know how to word. */
export const UNEXPECTED_FAILURE =
  'Une erreur inattendue a empêché l’opération d’aboutir. Le détail est dans le journal de ' +
  'l’application.';

/** French wording of the file system refusals the Game Master can do something about. */
const SYSTEM_FAILURES: Readonly<Record<string, string>> = {
  EPERM:
    'Windows a refusé l’accès à un fichier (ouvert dans un autre programme, antivirus, dossier ' +
    'protégé…) : l’opération n’a pas abouti.',
  EACCES:
    'Windows a refusé l’accès à un fichier (ouvert dans un autre programme, antivirus, dossier ' +
    'protégé…) : l’opération n’a pas abouti.',
  EBUSY:
    'Un fichier est utilisé par un autre programme : fermez-le, puis recommencez. L’opération ' +
    'n’a pas abouti.',
  ENOSPC:
    'Le disque est plein : libérez de la place, puis recommencez. L’opération n’a pas abouti.',
  EDQUOT:
    'Le disque est plein : libérez de la place, puis recommencez. L’opération n’a pas abouti.',
  ENOENT: 'Un fichier ou un dossier est introuvable : l’opération n’a pas abouti.',
  EROFS: 'Le disque est en lecture seule : l’opération n’a pas abouti.',
  ENAMETOOLONG:
    'Le chemin d’un fichier est trop long pour Windows : choisissez un dossier plus proche de ' +
    'la racine du disque.',
  EMFILE: 'Trop de fichiers sont ouverts en même temps : réessayez dans un instant.',
  ENFILE: 'Trop de fichiers sont ouverts en même temps : réessayez dans un instant.',
  EIO: 'Le disque n’a pas pu être lu ou écrit : l’opération n’a pas abouti.',
  EXDEV: 'Le fichier n’a pas pu être déplacé d’un disque à l’autre : l’opération n’a pas abouti.',
};

/** Error classes of the JavaScript engine itself: a bug or a resource limit, never worded. */
const ENGINE_ERRORS: readonly { prototype: Error }[] = [
  Error,
  RangeError,
  TypeError,
  SyntaxError,
  ReferenceError,
  EvalError,
  URIError,
  AggregateError,
];

/** Text that only a technical message carries: a system error code, a stack frame. */
const TECHNICAL = /\bE[A-Z]{2,}:|\n\s+at |Maximum call stack|\.[cm]?[jt]s:\d+/;

/** The system error code (`EPERM`…) of a Node error, if it is one. */
function systemCode(error: unknown): string | undefined {
  if (!isRecord(error) || typeof error.code !== 'string') return undefined;
  return /^E[A-Z0-9]+$/.test(error.code) ? error.code : undefined;
}

/** The French message a window may show for `error`, thrown by a call it made. */
export function messageForWindow(error: unknown): string {
  const code = systemCode(error);
  if (code !== undefined) return SYSTEM_FAILURES[code] ?? UNEXPECTED_FAILURE;
  if (!(error instanceof Error) || error instanceof DOMException) return UNEXPECTED_FAILURE;
  if (ENGINE_ERRORS.some((type) => Object.getPrototypeOf(error) === type.prototype)) {
    return UNEXPECTED_FAILURE;
  }
  if (!error.message || TECHNICAL.test(error.message)) return UNEXPECTED_FAILURE;
  return error.message;
}

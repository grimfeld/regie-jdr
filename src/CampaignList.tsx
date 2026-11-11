import { useState, type FormEvent } from 'react';
import { FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import type { CampaignDeletionSummary, CampaignTrashing } from '../shared/contract';
import type { Campaign, CampaignId } from '../shared/domain';
import { isIpcFailure, noticeFor } from './notices';

/**
 * The Game Master's wording for a failed bridge call: the French message thrown by the app core
 * (e.g. "Donnez un nom à la campagne."), or the generic notice for a rejected message.
 */
export function errorMessage(error: unknown): string {
  if (!isIpcFailure(error)) return error instanceof Error ? error.message : String(error);
  if (error.code === 'rejected') return noticeFor(error);
  const thrown = /IPC call failed: "[^"]*": (.*)$/s.exec(error.message);
  return thrown ? thrown[1] : noticeFor(error);
}

const sizeFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/** A size on disk the way Windows Explorer shows it in French: "12,3 Mo". */
export function formatSize(bytes: number): string {
  const units = ['octets', 'Ko', 'Mo', 'Go', 'To'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${sizeFormat.format(value)} ${units[unit]}`;
}

function countOf(count: number, one: string, many: string): string {
  return `${count} ${count > 1 ? many : one}`;
}

/** What deleting a Campaign takes away, for its confirmation: "2 scènes et 1 média, 3 Mo". */
export function deletionContents({
  sceneCount,
  mediaCount,
  sizeBytes,
}: CampaignDeletionSummary): string {
  const scenes = countOf(sceneCount, 'scène', 'scènes');
  const media = countOf(mediaCount, 'média', 'médias');
  return `${scenes} et ${media}, ${formatSize(sizeBytes)}`;
}

/** Deleting a Campaign, through the main process (ADR-0005). */
export interface CampaignDeletionActions {
  describe: (id: CampaignId) => Promise<CampaignDeletionSummary>;
  moveToTrash: (id: CampaignId) => Promise<CampaignTrashing>;
  deletePermanently: (id: CampaignId) => Promise<void>;
}

/**
 * A delete waiting for the Game Master: first the confirmation, then, only when the Recycle Bin
 * refused the Campaign, a second confirmation for a permanent delete.
 */
type PendingDeletion =
  | { step: 'confirm'; summary: CampaignDeletionSummary }
  | { step: 'permanent'; summary: CampaignDeletionSummary; reason: string };

interface Props {
  campaigns: Campaign[];
  onOpen: (id: CampaignId) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: CampaignId, name: string) => Promise<void>;
  /** Absent without a main process: nothing can be deleted. */
  deletion?: CampaignDeletionActions;
}

/**
 * The Campaign list home page: pick, create, rename or delete a Campaign. Delete is offered
 * only here, where every Campaign is closed.
 */
export function CampaignList({ campaigns, onOpen, onCreate, onRename, deletion }: Props) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<CampaignId | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<PendingDeletion | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function attempt(action: () => Promise<void>) {
    setError('');
    try {
      await action();
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    }
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    if (await attempt(() => onCreate(newName))) {
      setCreating(false);
      setNewName('');
    }
  }

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    if (renaming && (await attempt(() => onRename(renaming, renameTo)))) setRenaming(null);
  }

  async function startDelete(campaign: Campaign) {
    if (!deletion) return;
    setCreating(false);
    setRenaming(null);
    setPending(null);
    await attempt(async () => {
      setPending({ step: 'confirm', summary: await deletion.describe(campaign.id) });
    });
  }

  /** Runs a confirmed delete step; the buttons stay disabled until it answers. */
  async function deleteStep(step: () => Promise<void>) {
    setDeleting(true);
    try {
      if (!(await attempt(step))) setPending(null);
    } finally {
      setDeleting(false);
    }
  }

  async function confirm(pendingDeletion: PendingDeletion) {
    if (!deletion) return;
    const { summary } = pendingDeletion;
    if (pendingDeletion.step === 'permanent') {
      await deleteStep(async () => {
        await deletion.deletePermanently(summary.id);
        setPending(null);
      });
      return;
    }
    await deleteStep(async () => {
      const outcome = await deletion.moveToTrash(summary.id);
      setPending(outcome.deleted ? null : { step: 'permanent', summary, reason: outcome.reason });
    });
  }

  function startRename(campaign: Campaign) {
    setError('');
    setCreating(false);
    setPending(null);
    setRenaming(campaign.id);
    setRenameTo(campaign.name);
  }

  return (
    <section className="campaign-home">
      <div className="section-heading">
        <div>
          <span className="eyebrow">VOS PARTIES</span>
          <h1>Vos campagnes</h1>
        </div>
        {!creating && (
          <button
            className="primary-button"
            onClick={() => {
              setError('');
              setRenaming(null);
              setCreating(true);
            }}
          >
            <Plus size={16} /> Créer une campagne
          </button>
        )}
      </div>

      {creating && (
        <form className="campaign-form panel" onSubmit={(event) => void submitCreate(event)}>
          <label>
            Nom de la campagne
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <button className="primary-button" type="submit">
            Créer
          </button>
          <button className="secondary-button" type="button" onClick={() => setCreating(false)}>
            Annuler
          </button>
        </form>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {campaigns.length === 0 && <p className="asset-empty">Aucune campagne pour l’instant.</p>}

      <ul className="campaign-list" aria-label="Campagnes">
        {campaigns.map((campaign) => (
          <li key={campaign.id} className="campaign-item panel">
            {renaming === campaign.id ? (
              <form className="campaign-form" onSubmit={(event) => void submitRename(event)}>
                <label>
                  Nouveau nom
                  <input autoFocus value={renameTo} onChange={(e) => setRenameTo(e.target.value)} />
                </label>
                <button className="primary-button" type="submit">
                  Enregistrer
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setRenaming(null)}
                >
                  Annuler
                </button>
              </form>
            ) : (
              <>
                <button className="campaign-open" onClick={() => onOpen(campaign.id)}>
                  <FolderOpen size={18} />
                  <strong>{campaign.name}</strong>
                </button>
                <button
                  className="secondary-button"
                  aria-label={`Renommer ${campaign.name}`}
                  title="Renommer"
                  onClick={() => startRename(campaign)}
                >
                  <Pencil size={14} /> Renommer
                </button>
                {deletion && (
                  <button
                    className="secondary-button"
                    aria-label={`Supprimer ${campaign.name}`}
                    title="Supprimer"
                    onClick={() => void startDelete(campaign)}
                  >
                    <Trash2 size={14} aria-hidden /> Supprimer
                  </button>
                )}
              </>
            )}
            {pending?.summary.id === campaign.id && (
              <DeletionConfirmation
                pending={pending}
                busy={deleting}
                onCancel={() => setPending(null)}
                onConfirm={() => void confirm(pending)}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The confirmation of a delete: to the Recycle Bin first, permanent only once it refused. */
function DeletionConfirmation({
  pending,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: PendingDeletion;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { summary } = pending;
  const permanent = pending.step === 'permanent';
  return (
    <div
      className="media-delete-confirm campaign-delete-confirm"
      role="alertdialog"
      aria-label={permanent ? 'Supprimer définitivement la campagne' : 'Supprimer la campagne'}
      aria-describedby="campaign-delete-message"
    >
      {permanent ? (
        <p id="campaign-delete-message">
          {pending.reason} Supprimer définitivement « {summary.name} » ({deletionContents(summary)})
          ? Elle ne pourra pas être récupérée.
        </p>
      ) : (
        <p id="campaign-delete-message">
          Supprimer la campagne « {summary.name} » ? Elle contient {deletionContents(summary)}. Elle
          ira dans la corbeille de Windows, d’où vous pourrez la restaurer.
        </p>
      )}
      <div className="media-delete-actions">
        <button className="secondary-button" autoFocus disabled={busy} onClick={onCancel}>
          Annuler
        </button>
        <button className="primary-button" disabled={busy} onClick={onConfirm}>
          <Trash2 size={14} aria-hidden /> {permanent ? 'Supprimer définitivement' : 'Supprimer'}
        </button>
      </div>
    </div>
  );
}

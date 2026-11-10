import { useState, type FormEvent } from 'react';
import { FolderOpen, Pencil, Plus } from 'lucide-react';
import type { Campaign, CampaignId } from '../shared/domain';

/** Turns a failed bridge call into the French message the main process gave. */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '');
}

interface Props {
  campaigns: Campaign[];
  onOpen(id: CampaignId): void;
  onCreate(name: string): Promise<void>;
  onRename(id: CampaignId, name: string): Promise<void>;
}

/** The Campaign list home page: pick, create or rename a Campaign. */
export function CampaignList({ campaigns, onOpen, onCreate, onRename }: Props) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<CampaignId | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const [error, setError] = useState('');

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

  function startRename(campaign: Campaign) {
    setError('');
    setCreating(false);
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
        <form className="campaign-form panel" onSubmit={submitCreate}>
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
              <form className="campaign-form" onSubmit={submitRename}>
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
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

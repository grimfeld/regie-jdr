import { useCallback, useEffect, useState } from 'react';
import { Aperture, ArrowLeft, Maximize, MonitorPlay, Palette, Settings2 } from 'lucide-react';
import type { Campaign, CampaignId, ThemeId } from '../shared/domain';
import type { CampaignChanges, ControlBridge } from '../shared/contract';
import BroadcastView from './BroadcastView';
import { CampaignList, errorMessage } from './CampaignList';
import { FadeSetting } from './FadeSetting';
import { MediaLibrary } from './MediaLibrary';
import { PAD_KEY_POSITIONS, useShortcuts, type ShortcutHandlers } from './keyboard';
import { useListening } from './Listening';
import { NowPlaying, toggleSilence } from './NowPlaying';
import { OnAirMonitor } from './OnAirMonitor';
import { ScenesPanel } from './ScenesPanel';
import { SoundboardPanel, useSoundboard, type SoundboardControls } from './Soundboard';
import { showNotice } from './notices';

const themes: { id: ThemeId; label: string; subtitle: string }[] = [
  { id: 'retro', label: 'Rétro SF', subtitle: 'Terminaux, phosphore et écrans CRT' },
  { id: 'imperium', label: 'Imperium', subtitle: 'Gothique impérial, rouge, or et parchemin' },
  { id: 'fantasy', label: 'Fantasy', subtitle: 'Bois, cuir, pierre et parchemin' },
];

/** Theme of the Campaign list home page until the global Settings are read. */
const DEFAULT_HOME_THEME: ThemeId = 'imperium';

export default function App() {
  const isBroadcast = new URLSearchParams(window.location.search).get('view') === 'broadcast';
  // Each window's preload exposes its own bridge (see shared/contract.ts).
  if (isBroadcast) return <BroadcastView bridge={window.regie} />;
  return <ControlApp control={window.regie as ControlBridge | undefined} />;
}

function byName(a: Campaign, b: Campaign) {
  return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
}

/**
 * The Control window: the Campaign list home page, or the screen of the open Campaign.
 * On launch, the only Campaign (when there is exactly one) opens directly. On a reload of the
 * window, the Campaign the main process has open comes back as it was.
 */
function ControlApp({ control }: { control: ControlBridge | undefined }) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [openId, setOpenId] = useState<CampaignId | null>(null);
  // Messages from the main process, e.g. a corrupt file recovered from its backup.
  const collectNotices = useCallback(async () => {
    if (!control) return;
    (await control.takeNotices()).forEach(showNotice);
  }, [control]);

  /**
   * Opens a Campaign (or, with null, goes back to the Campaign list) and tells the on-air
   * state, which clears the Active Scene on every switch. A Campaign's screen shows once it is
   * open: its Media are only served for the open Campaign.
   */
  const enter = useCallback(
    async (id: CampaignId | null) => {
      if (!control) {
        setOpenId(id);
        return;
      }
      try {
        if (id) {
          await control.openCampaign(id);
          setOpenId(id);
        } else {
          setOpenId(null);
          await control.closeCampaign();
        }
      } catch (error) {
        showNotice(errorMessage(error));
      }
    },
    [control],
  );

  useEffect(() => {
    if (!control) return;
    let cancelled = false;
    Promise.all([control.listCampaigns(), control.getOnAir()])
      .then(([list, onAir]) => {
        if (cancelled) return;
        setCampaigns(list);
        // After a reload of this window the main process still has its Campaign open, with its
        // Active Scene, Blackout and undo histories: show it again, never open it anew.
        if (onAir.campaignId !== null && list.some((item) => item.id === onAir.campaignId)) {
          setOpenId(onAir.campaignId);
        } else if (list.length === 1) {
          void enter(list[0].id);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) showNotice(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) void collectNotices();
      });
    return () => {
      cancelled = true;
    };
  }, [control, collectNotices, enter]);

  // The global theme (Settings) dresses the home page; inside a Campaign, its own theme.
  const [homeTheme, setHomeTheme] = useState<ThemeId>(DEFAULT_HOME_THEME);
  useEffect(() => {
    if (!control) return;
    let cancelled = false;
    control
      .getSettings()
      .then((settings) => {
        if (!cancelled) setHomeTheme(settings.theme);
      })
      .catch((error: unknown) => {
        if (!cancelled) showNotice(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [control]);

  async function changeHomeTheme(next: ThemeId) {
    setHomeTheme(next);
    if (!control) return;
    try {
      setHomeTheme((await control.setHomeTheme(next)).theme);
    } catch (error) {
      showNotice(errorMessage(error));
    }
  }

  const openCampaign = campaigns?.find((c) => c.id === openId);
  const theme = openCampaign?.theme ?? homeTheme;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  async function create(name: string) {
    if (!control) return;
    const created = await control.createCampaign(name);
    setCampaigns((current) => [...(current ?? []), created].sort(byName));
    await enter(created.id);
  }

  async function update(id: CampaignId, changes: CampaignChanges) {
    if (!control) return;
    try {
      const updated = await control.updateCampaign(id, changes);
      setCampaigns((current) =>
        (current ?? []).map((c) => (c.id === updated.id ? updated : c)).sort(byName),
      );
    } finally {
      void collectNotices();
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Aperture size={19} />
          </div>
          <div>
            <strong>RÉGIE JDR</strong>
            <small>POSTE DU MAÎTRE DU JEU</small>
          </div>
        </div>
        <div className="topbar-right">
          {openCampaign ? (
            <button className="secondary-button" onClick={() => void enter(null)}>
              <ArrowLeft size={14} /> Campagnes
            </button>
          ) : (
            <HomeThemePicker theme={homeTheme} onChange={(next) => void changeHomeTheme(next)} />
          )}
          <button className="primary-button" onClick={() => void control?.openBroadcast()}>
            <MonitorPlay size={16} /> Ouvrir la diffusion
          </button>
          {/* The Broadcast window has no controls of its own; Esc there also leaves fullscreen. */}
          <button
            className="secondary-button"
            onClick={() => void control?.toggleBroadcastFullscreen()}
            title="Mettre la diffusion en plein écran, ou l’en sortir"
          >
            <Maximize size={14} /> Plein écran
          </button>
        </div>
      </header>
      {openCampaign ? (
        <CampaignScreen
          key={openCampaign.id}
          campaign={openCampaign}
          control={control}
          onThemeChange={(next) =>
            void update(openCampaign.id, { theme: next }).catch((error: unknown) => {
              showNotice(errorMessage(error));
            })
          }
        />
      ) : (
        campaigns && (
          <CampaignList
            campaigns={campaigns}
            onOpen={(id) => void enter(id)}
            onCreate={create}
            onRename={(id, name) => update(id, { name })}
          />
        )
      )}
      <footer className="footer">
        <span>
          RÉGIE JDR <span className="footer-muted">· Prototype 0.1</span>
        </span>
        <span>Fonctionnement local · Aucun compte requis</span>
      </footer>
    </main>
  );
}

/** Minimal picker for the home page theme (finished themes and their picker come later). */
function HomeThemePicker({
  theme,
  onChange,
}: {
  theme: ThemeId;
  onChange: (theme: ThemeId) => void;
}) {
  return (
    <label className="home-theme">
      <Palette size={14} />
      <select
        aria-label="Thème de l’accueil"
        value={theme}
        onChange={(e) => onChange(e.target.value as ThemeId)}
      >
        {themes.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface CampaignScreenProps {
  campaign: Campaign;
  control: ControlBridge | undefined;
  onThemeChange: (theme: ThemeId) => void;
}

/** The number keys play the first nine pads; the Silence key starts or lifts Silence. */
function useAudioShortcuts(control: ControlBridge | undefined, soundboard: SoundboardControls) {
  const handlers: ShortcutHandlers = { silence: () => void toggleSilence(control) };
  for (const position of PAD_KEY_POSITIONS) {
    handlers[`pad-${position}`] = () => soundboard.pressPosition(position);
  }
  useShortcuts(handlers);
}

/** The screen of the open Campaign: its Scenes, its Media library and its theme. */
function CampaignScreen({ campaign, control, onThemeChange }: CampaignScreenProps) {
  const theme = campaign.theme;
  /**
   * Bumped when a Media is deleted or renamed: the Scenes panel reloads (placements may be gone,
   * names may have changed).
   */
  const [mediaRevision, setMediaRevision] = useState(0);
  /** Bumped when Media were dropped on the Scene editor and imported: the library reloads. */
  const [importRevision, setImportRevision] = useState(0);

  const themeLabel = themes.find((t) => t.id === theme)?.label ?? 'Imperium';
  // Per Campaign, whichever Scene is active. Read again when a Media is deleted (its pads go).
  const soundboard = useSoundboard(control, campaign.id, mediaRevision);
  useAudioShortcuts(control, soundboard);
  // Started from the library, listed in the "En cours" strip: the players hear it (ADR-0002).
  const listening = useListening(control);

  return (
    <>
      <div className="campaign-bar">
        <div>
          <span className="eyebrow">CAMPAGNE</span>
          <h1>{campaign.name}</h1>
        </div>
        <div className="topbar-right">
          <span className="status-dot" /> SESSION LOCALE <span className="top-separator">|</span>
          <span className="theme-name">{themeLabel}</span>
        </div>
      </div>

      <div className="workspace">
        <section className="main-column">
          <ScenesPanel
            campaignId={campaign.id}
            control={control}
            mediaRevision={mediaRevision}
            onMediaImported={() => setImportRevision((revision) => revision + 1)}
          />

          <MediaLibrary
            campaignId={campaign.id}
            control={control}
            onMediaDeleted={() => setMediaRevision((revision) => revision + 1)}
            onMediaRenamed={() => setMediaRevision((revision) => revision + 1)}
            importRevision={importRevision}
            listening={listening}
          />
        </section>

        <aside className="control-column">
          <OnAirMonitor control={control} />
          <NowPlaying control={control} listening={listening.name} />
          <SoundboardPanel
            control={control}
            campaignId={campaign.id}
            soundboard={soundboard}
            libraryRevision={mediaRevision + importRevision}
          />
          <FadeSetting control={control} />
          <div className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">APPARENCE</span>
                <h2>
                  <Palette size={18} /> Thème de la campagne
                </h2>
              </div>
              <Settings2 size={17} />
            </div>
            <div className="theme-options">
              {themes.map((item) => (
                <button
                  key={item.id}
                  className={`theme-option ${theme === item.id ? 'selected' : ''}`}
                  onClick={() => onThemeChange(item.id)}
                >
                  <span className={`theme-swatch ${item.id}`}></span>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.subtitle}</small>
                  </span>
                  <span className="radio-indicator" />
                </button>
              ))}
            </div>
            {theme === 'imperium' && (
              <p className="theme-footnote">
                Esthétique impériale uniquement : gothique monumental, héraldique, rouge et or.
                Aucun élément Mechanicus ou démoniaque.
              </p>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

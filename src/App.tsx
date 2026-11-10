import { useCallback, useEffect, useState } from 'react';
import { Aperture, ArrowLeft, AudioLines, MonitorPlay, Music2, Palette, Play, Radio, Settings2, Volume2 } from 'lucide-react';
import type { Campaign, CampaignId, ThemeId } from '../shared/domain';
import type { BroadcastBridge, CampaignChanges, ControlBridge } from '../shared/contract';
import BroadcastView from './BroadcastView';
import { CampaignList, errorMessage } from './CampaignList';
import { MediaImage } from './MediaImage';
import { MediaLibrary } from './MediaLibrary';
import { ScenesPanel } from './ScenesPanel';
import { showNotice } from './notices';

/** Control window preview (prototype): local only, the Broadcast window shows what is on air. */
interface PreviewScene {
  title: string;
  /** `regie-asset:` address, or '' for none. */
  background: string;
  description: string;
}

const themes: { id: ThemeId; label: string; subtitle: string }[] = [
  { id: 'retro', label: 'Rétro SF', subtitle: 'Terminaux, phosphore et écrans CRT' },
  { id: 'imperium', label: 'Imperium', subtitle: 'Gothique impérial, rouge, or et parchemin' },
  { id: 'fantasy', label: 'Fantasy', subtitle: 'Bois, cuir, pierre et parchemin' }
];

/** Theme of the Campaign list home page, until the global theme setting lands. */
const HOME_THEME: ThemeId = 'imperium';

const initialPreview: PreviewScene = {
  title: 'Le sanctuaire oublié',
  background: '',
  description: 'Choisissez un décor pour commencer la scène.'
};

export default function App() {
  const isStage = new URLSearchParams(window.location.search).get('view') === 'stage';
  // Each window's preload exposes its own bridge (see shared/contract.ts).
  if (isStage) return <BroadcastView bridge={window.regie as BroadcastBridge | undefined} />;
  return <ControlApp control={window.regie as ControlBridge | undefined} />;
}

function byName(a: Campaign, b: Campaign) {
  return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
}

/**
 * The Control window: the Campaign list home page, or the screen of the open Campaign.
 * On launch, the only Campaign (when there is exactly one) opens directly.
 */
function ControlApp({ control }: { control: ControlBridge | undefined }) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [openId, setOpenId] = useState<CampaignId | null>(null);
  // Messages from the main process, e.g. a corrupt file recovered from its backup.
  const collectNotices = useCallback(async () => {
    if (!control) return;
    (await control.takeNotices()).forEach(showNotice);
  }, [control]);

  useEffect(() => {
    if (!control) return;
    let cancelled = false;
    control.listCampaigns()
      .then(list => {
        if (cancelled) return;
        setCampaigns(list);
        if (list.length === 1) void enter(list[0].id);
      })
      .catch(error => { if (!cancelled) showNotice(errorMessage(error)); })
      .finally(() => { if (!cancelled) void collectNotices(); });
    return () => { cancelled = true; };
  }, [control, collectNotices]);

  /**
   * Opens a Campaign (or, with null, goes back to the Campaign list) and tells the on-air
   * state, which clears the Active Scene on every switch.
   */
  async function enter(id: CampaignId | null) {
    setOpenId(id);
    if (!control) return;
    try {
      if (id) await control.openCampaign(id);
      else await control.closeCampaign();
    } catch (error) {
      showNotice(errorMessage(error));
    }
  }

  const openCampaign = campaigns?.find(c => c.id === openId);
  const theme = openCampaign?.theme ?? HOME_THEME;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  async function create(name: string) {
    if (!control) return;
    const created = await control.createCampaign(name);
    setCampaigns(current => [...(current ?? []), created].sort(byName));
    await enter(created.id);
  }

  async function update(id: CampaignId, changes: CampaignChanges) {
    if (!control) return;
    try {
      const updated = await control.updateCampaign(id, changes);
      setCampaigns(current => (current ?? []).map(c => (c.id === updated.id ? updated : c)).sort(byName));
    } finally {
      void collectNotices();
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Aperture size={19} /></div><div><strong>RÉGIE JDR</strong><small>POSTE DU MAÎTRE DU JEU</small></div></div>
        <div className="topbar-right">
          {openCampaign && <button className="secondary-button" onClick={() => void enter(null)}><ArrowLeft size={14} /> Campagnes</button>}
          <button className="primary-button" onClick={() => control?.openBroadcast()}><MonitorPlay size={16} /> Ouvrir la diffusion</button>
        </div>
      </header>
      {openCampaign
        ? <CampaignScreen key={openCampaign.id} campaign={openCampaign} control={control} onThemeChange={next => update(openCampaign.id, { theme: next }).catch(error => showNotice(errorMessage(error)))} />
        : campaigns && <CampaignList campaigns={campaigns} onOpen={id => void enter(id)} onCreate={create} onRename={(id, name) => update(id, { name })} />}
      <footer className="footer"><span>RÉGIE JDR <span className="footer-muted">· Prototype 0.1</span></span><span>Fonctionnement local · Aucun compte requis</span></footer>
    </main>
  );
}

interface CampaignScreenProps {
  campaign: Campaign;
  control: ControlBridge | undefined;
  onThemeChange(theme: ThemeId): void;
}

/** The screen of the open Campaign (prototype scene and library, replaced by later M0 tickets). */
function CampaignScreen({ campaign, control, onThemeChange }: CampaignScreenProps) {
  const theme = campaign.theme;
  const [scene, setScene] = useState<PreviewScene>(initialPreview);
  const [musicVolume, setMusicVolume] = useState(35);
  const [sfxVolume, setSfxVolume] = useState(75);
  const [localVolume, setLocalVolume] = useState(80);
  const [stageVolume, setStageVolume] = useState(80);

  const themeLabel = themes.find(t => t.id === theme)?.label ?? 'Imperium';

  function updateScene(next: PreviewScene) {
    setScene(next);
  }

  return (
    <>
      <div className="campaign-bar">
        <div><span className="eyebrow">CAMPAGNE</span><h1>{campaign.name}</h1></div>
        <div className="topbar-right"><span className="status-dot" /> SESSION LOCALE <span className="top-separator">|</span><span className="theme-name">{themeLabel}</span></div>
      </div>

      <div className="workspace">
        <section className="main-column">
          <div className="section-heading"><div><span className="eyebrow">RÉGIE VISUELLE</span><h2>La scène</h2></div></div>
          <div className="preview-frame">
            <div className="preview-topline"><span><span className="live-dot" /> APERÇU JOUEURS</span><span>16:9 · FENÊTRE INDÉPENDANTE</span></div>
            <div className="preview-scene">
              {scene.background ? <MediaImage address={scene.background} alt="" window="control" /> : <div className="empty-scene"><Aperture size={42}/><strong>Aucun décor chargé</strong><span>Importez une image pour commencer votre scène.</span></div>}
              <div className="preview-title"><span>SCÈNE ACTIVE</span><h2>{scene.title}</h2></div>
            </div>
            <div className="scene-edit"><label>TITRE DE LA SCÈNE<input value={scene.title} onChange={e => updateScene({ ...scene, title: e.target.value })} /></label><label>DESCRIPTION<input value={scene.description} onChange={e => updateScene({ ...scene, description: e.target.value })} /></label></div>
          </div>

          <ScenesPanel campaignId={campaign.id} control={control} />

          <MediaLibrary campaignId={campaign.id} control={control} onShowImage={(image, address) => updateScene({ ...scene, background: address, title: image.name })} />
        </section>

        <aside className="control-column">
          <div className="panel">
            <div className="panel-heading"><div><span className="eyebrow">AMBIANCE SONORE</span><h2><AudioLines size={18}/> Audio</h2></div><span className="panel-icon"><Volume2 size={17}/></span></div>
            <div className="audio-track"><div className="track-art"><Music2 size={20}/></div><div className="track-info"><strong>Aucune musique sélectionnée</strong><small>Importez une piste audio prochainement</small></div><button className="play-button" disabled title="Le moteur audio sera intégré à l’étape suivante"><Play size={15}/></button></div>
            <div className="slider-row"><label>Musique</label><input type="range" min="0" max="100" value={musicVolume} onChange={e => setMusicVolume(+e.target.value)}/><output>{musicVolume}%</output></div>
            <div className="slider-row"><label>Bruitages</label><input type="range" min="0" max="100" value={sfxVolume} onChange={e => setSfxVolume(+e.target.value)}/><output>{sfxVolume}%</output></div>
            <div className="audio-note"><Radio size={14}/> Mixage local et diffusion joueurs prévus</div>
          </div>

          <div className="panel">
            <div className="panel-heading"><div><span className="eyebrow">APPARENCE</span><h2><Palette size={18}/> Thème de la campagne</h2></div><Settings2 size={17}/></div>
            <div className="theme-options">
              {themes.map(item => <button key={item.id} className={`theme-option ${theme === item.id ? 'selected' : ''}`} onClick={() => onThemeChange(item.id)}><span className={`theme-swatch ${item.id}`}></span><span><strong>{item.label}</strong><small>{item.subtitle}</small></span><span className="radio-indicator"/></button>)}
            </div>
            {theme === 'imperium' && <p className="theme-footnote">Esthétique impériale uniquement : gothique monumental, héraldique, rouge et or. Aucun élément Mechanicus ou démoniaque.</p>}
          </div>

          <div className="panel">
            <div className="panel-heading"><div><span className="eyebrow">SORTIES AUDIO</span><h2><Volume2 size={18}/> Niveaux sonores</h2></div></div>
            <div className="slider-row"><label>Écoute MJ</label><input type="range" min="0" max="100" value={localVolume} onChange={e => setLocalVolume(+e.target.value)}/><output>{localVolume}%</output></div>
            <div className="slider-row"><label>Diffusion</label><input type="range" min="0" max="100" value={stageVolume} onChange={e => setStageVolume(+e.target.value)}/><output>{stageVolume}%</output></div>
            <p className="muted-note">Les sorties seront reliées au moteur audio lors de l'étape d'intégration.</p>
          </div>
        </aside>
      </div>
    </>
  );
}

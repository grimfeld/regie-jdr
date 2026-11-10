import { useEffect, useMemo, useState } from 'react';
import { SpikePanel } from './spike/SpikePanel';
import { Aperture, AudioLines, ImagePlus, MonitorPlay, Music2, Palette, Play, Plus, Radio, Settings2, Volume2 } from 'lucide-react';

type ThemeId = 'retro' | 'imperium' | 'fantasy';
type Scene = { title: string; background: string; description: string };
type Asset = { name: string; url: string };
const themes: { id: ThemeId; label: string; subtitle: string }[] = [
  { id: 'retro', label: 'Rétro SF', subtitle: 'Terminaux, phosphore et écrans CRT' },
  { id: 'imperium', label: 'Imperium', subtitle: 'Gothique impérial, rouge, or et parchemin' },
  { id: 'fantasy', label: 'Fantasy', subtitle: 'Bois, cuir, pierre et parchemin' }
];

const initialScene: Scene = {
  title: 'Le sanctuaire oublié',
  background: '',
  description: 'Choisissez un décor pour commencer la scène.'
};

export default function App() {
  const isStage = new URLSearchParams(window.location.search).get('view') === 'stage';
  const [theme, setTheme] = useState<ThemeId>('imperium');
  const [scene, setScene] = useState<Scene>(initialScene);
  const [musicVolume, setMusicVolume] = useState(35);
  const [sfxVolume, setSfxVolume] = useState(75);
  const [localVolume, setLocalVolume] = useState(80);
  const [stageVolume, setStageVolume] = useState(80);
  const [assets, setAssets] = useState<Asset[]>([]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (isStage) window.regie?.onSceneUpdated((next) => setScene(next as Scene));
  }, [isStage]);

  const themeLabel = useMemo(() => themes.find(t => t.id === theme)?.label ?? 'Imperium', [theme]);

  function updateScene(next: Scene) {
    setScene(next);
    window.regie?.updateScene(next);
  }

  async function addImages() {
    if (!window.regie?.importImages) return;
    const imported = await window.regie.importImages();
    if (imported.length === 0) return;
    setAssets(current => [...current, ...imported]);
    const first = imported[0];
    updateScene({ ...scene, background: first.url, title: first.name || 'Nouvelle scène' });
  }

  if (isStage) {
    return (
      <main className="stage-screen">
        {scene.background ? <img className="stage-background" src={scene.background} alt="" /> : null}
        <div className="stage-vignette" />
        <div className="stage-caption">
          <span className="eyebrow">SCÈNE EN COURS</span>
          <h1>{scene.title}</h1>
          <p>{scene.description}</p>
        </div>
        <button className="stage-fullscreen" onClick={() => window.regie?.toggleStageFullscreen()} title="Plein écran">⛶</button>
        <SpikePanel where="broadcast" />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Aperture size={19} /></div><div><strong>RÉGIE JDR</strong><small>POSTE DU MAÎTRE DU JEU</small></div></div>
        <div className="topbar-right"><span className="status-dot" /> SESSION LOCALE <span className="top-separator">|</span><span className="theme-name">{themeLabel}</span></div>
      </header>

      <div className="workspace">
        <section className="main-column">
          <div className="section-heading"><div><span className="eyebrow">RÉGIE VISUELLE</span><h1>La scène</h1></div><button className="primary-button" onClick={() => window.regie?.openStage()}><MonitorPlay size={16} /> Ouvrir la diffusion</button></div>
          <div className="preview-frame">
            <div className="preview-topline"><span><span className="live-dot" /> APERÇU JOUEURS</span><span>16:9 · FENÊTRE INDÉPENDANTE</span></div>
            <div className="preview-scene">
              {scene.background ? <img src={scene.background} alt="" /> : <div className="empty-scene"><Aperture size={42}/><strong>Aucun décor chargé</strong><span>Importez une image pour commencer votre scène.</span></div>}
              <div className="preview-title"><span>SCÈNE ACTIVE</span><h2>{scene.title}</h2></div>
            </div>
            <div className="scene-edit"><label>TITRE DE LA SCÈNE<input value={scene.title} onChange={e => updateScene({ ...scene, title: e.target.value })} /></label><label>DESCRIPTION<input value={scene.description} onChange={e => updateScene({ ...scene, description: e.target.value })} /></label></div>
          </div>

          <div className="section-heading compact"><div><span className="eyebrow">BIBLIOTHÈQUE PERSONNELLE</span><h2>Visuels importés</h2></div><button className="secondary-button" onClick={addImages}><ImagePlus size={16}/> Importer des images</button></div>
          <div className="asset-strip">
            {assets.length ? assets.map((asset, i) => <button className="asset-thumb" key={`${asset.url}-${i}`} title={asset.name} onClick={() => updateScene({ ...scene, background: asset.url, title: asset.name })}><img src={asset.url} alt={asset.name}/></button>) : <div className="asset-empty">Vos décors, portraits et créatures apparaîtront ici après import.</div>}
          </div>
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
            <div className="panel-heading"><div><span className="eyebrow">APPARENCE</span><h2><Palette size={18}/> Thème d'interface</h2></div><Settings2 size={17}/></div>
            <div className="theme-options">
              {themes.map(item => <button key={item.id} className={`theme-option ${theme === item.id ? 'selected' : ''}`} onClick={() => setTheme(item.id)}><span className={`theme-swatch ${item.id}`}></span><span><strong>{item.label}</strong><small>{item.subtitle}</small></span><span className="radio-indicator"/></button>)}
            </div>
            {theme === 'imperium' && <p className="theme-footnote">Esthétique impériale uniquement : gothique monumental, héraldique, rouge et or. Aucun élément Mechanicus ou démoniaque.</p>}
          </div>

          <div className="panel">
            <div className="panel-heading"><div><span className="eyebrow">SORTIES AUDIO</span><h2><Volume2 size={18}/> Niveaux sonores</h2></div></div>
            <div className="slider-row"><label>Écoute MJ</label><input type="range" min="0" max="100" value={localVolume} onChange={e => setLocalVolume(+e.target.value)}/><output>{localVolume}%</output></div>
            <div className="slider-row"><label>Diffusion</label><input type="range" min="0" max="100" value={stageVolume} onChange={e => setStageVolume(+e.target.value)}/><output>{stageVolume}%</output></div>
            <p className="muted-note">Les sorties seront reliées au moteur audio lors de l'étape d'intégration.</p>
          </div>
          <div className="panel scene-shortcut"><div><span className="eyebrow">SCÈNES PRÉPARÉES</span><strong>Rappel en un clic</strong><small>La sauvegarde des scènes arrive dans la prochaine étape.</small></div><button disabled title="Bientôt disponible"><Plus size={18}/></button></div>
        </aside>
      </div>
      <footer className="footer"><span>RÉGIE JDR <span className="footer-muted">· Prototype 0.1</span></span><span>Fonctionnement local · Aucun compte requis</span></footer>
      <SpikePanel where="control" />
    </main>
  );
}

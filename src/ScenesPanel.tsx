import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Clapperboard, History, Pencil, Plus, Radio, Redo2, Trash2, Undo2 } from 'lucide-react';
import type {
  AudioMedia,
  CampaignId,
  ImageMedia,
  NormalizedPoint,
  Scene,
  SceneId,
} from '../shared/domain';
import type { ControlBridge, SceneEdit, TransientEdit, UndoState } from '../shared/contract';
import { layOutCanvas } from '../core/canvas';
import { editorPictureOf } from '../core/onAir';
import { applySceneEdit, placementEdit, type PlacementTarget } from '../core/sceneEdits';
import { errorMessage } from './CampaignList';
import { editShortcutOf, type EditShortcut } from './keyboard';
import { droppedFiles, droppedMediaId } from './mediaDrag';
import { BackgroundList, OverlayList, useDropTarget } from './PlacementLists';
import { SceneCanvas } from './SceneCanvas';
import { SceneMusicList } from './SceneMusicList';
import { SceneTitleField } from './PlayerTextFields';
import { showNotice } from './notices';
import { useOnAir } from './useOnAir';
import { useBackgroundFraming } from './useBackgroundFraming';
import { useOverlayTransforms } from './useOverlayTransforms';

interface Props {
  campaignId: CampaignId;
  control: ControlBridge | undefined;
  /** Changes when a Media was deleted: Scenes and images are read again. */
  mediaRevision: number;
  /** Image files dropped on the editor were imported: the library reads its Media again. */
  onMediaImported: () => void;
}

/**
 * The open Campaign's Scenes: create a Scene, open one as the Selected Scene, and the editor of
 * the Selected Scene (rename, delete, Activate, its canvas, its Backgrounds). Each change is a
 * command the main process applies and saves; it goes on air only on the Active Scene.
 *
 * Opening a Campaign selects its last Active Scene (or its first Scene) without putting it on
 * air.
 */
export function ScenesPanel({ campaignId, control, mediaRevision, onMediaImported }: Props) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  /** The Scene the Game Master opened; undefined until they open one (see `selected`). */
  const [selectedId, setSelectedId] = useState<SceneId | undefined>(undefined);
  // Which Scene is on air.
  const onAir = useOnAir(control);
  const [images, setImages] = useState<ImageMedia[]>([]);
  const [sounds, setSounds] = useState<AudioMedia[]>([]);
  const [newName, setNewName] = useState('');
  const nameField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!control) return;
    let cancelled = false;
    control
      .listScenes(campaignId)
      .then((list) => {
        if (!cancelled) setScenes(list);
      })
      .catch((error: unknown) => {
        if (!cancelled) showNotice(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [control, campaignId, mediaRevision]);

  // The library's images, to draw and to place, and its sounds, to name. Read again whenever a
  // Scene is opened, when the picker gets focus and when a sound is dropped, so Media imported
  // meanwhile are known.
  const refreshImages = useCallback(() => {
    if (!control) return;
    control
      .listMedia(campaignId)
      .then((media) => {
        setImages(media.filter((m): m is ImageMedia => m.kind === 'image'));
        setSounds(media.filter((m): m is AudioMedia => m.kind === 'audio'));
      })
      .catch((error: unknown) => showNotice(errorMessage(error)));
  }, [control, campaignId]);
  useEffect(refreshImages, [refreshImages, selectedId, mediaRevision]);

  // The Scene that was last Active in this Campaign (Settings): selected on opening, and
  // highlighted so the Game Master can resume with one click. undefined until read.
  const [lastActiveId, setLastActiveId] = useState<SceneId | null | undefined>(undefined);
  useEffect(() => {
    if (!control) return;
    let cancelled = false;
    control
      .getSettings()
      .then((settings) => {
        if (!cancelled) setLastActiveId(settings.lastActiveSceneByCampaign[campaignId] ?? null);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLastActiveId(null);
          showNotice(errorMessage(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [control, campaignId]);

  // Until the Game Master opens a Scene: the last Active Scene, or else the first Scene.
  const openedId =
    selectedId ??
    (lastActiveId === undefined
      ? undefined
      : (scenes.find((scene) => scene.id === lastActiveId) ?? scenes.at(0))?.id);
  const selected = scenes.find((scene) => scene.id === openedId);
  const undoState = useUndoState(control, campaignId, selected);
  const isActive = (scene: Scene) =>
    onAir?.campaignId === campaignId && onAir.activeSceneId === scene.id;
  const hasActive = onAir?.campaignId === campaignId && onAir.activeSceneId !== null;
  const isLastActive = (scene: Scene) => !hasActive && scene.id === lastActiveId;

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!control) return;
    try {
      const scene = await control.createScene(campaignId, newName);
      setScenes((current) => [...current, scene]);
      setSelectedId(scene.id);
      setNewName('');
    } catch (error) {
      showNotice(errorMessage(error));
    }
  }

  /**
   * Sends an edit command and shows the Scene as saved; on failure, reloads the Scenes and
   * rethrows. Showing or hiding (a placement or a Label) shows at once (a checkbox must follow the click), then the saved
   * Scene replaces it.
   */
  async function edit(scene: Scene, command: SceneEdit) {
    if (command.kind === 'set-visible' || command.kind === 'set-label-visible') {
      const shownAtOnce = applySceneEdit(scene, command, () => '');
      setScenes((current) => current.map((item) => (item.id === scene.id ? shownAtOnce : item)));
    }
    if (!control) return;
    try {
      const saved = await control.editScene(campaignId, scene.id, command);
      setScenes((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    } catch (error) {
      setScenes(await control.listScenes(campaignId));
      throw error;
    }
  }

  function editShowingFailure(scene: Scene, command: SceneEdit) {
    edit(scene, command).catch((error: unknown) => showNotice(errorMessage(error)));
  }

  /**
   * Places `image` on `scene` as dropped on `target` (see `placementEdit`): the one placement
   * path for every drop, whether the image comes from the library or was just imported.
   */
  async function place(
    scene: Scene,
    image: ImageMedia,
    target: PlacementTarget,
    dropPoint?: NormalizedPoint,
  ) {
    if (!images.some((known) => known.id === image.id)) setImages((known) => [...known, image]);
    await edit(scene, placementEdit(image, target, dropPoint));
  }

  /**
   * Something dropped on the editor: a library image, placed with its current Image category,
   * or image files from Explorer, imported (refusals shown) then each placed the same way.
   */
  async function placeDropped(
    scene: Scene,
    event: DragEvent,
    target: PlacementTarget,
    dropPoint?: NormalizedPoint,
  ) {
    const mediaId = droppedMediaId(event);
    const files = droppedFiles(event);
    if (!control) return;
    try {
      if (mediaId === undefined) {
        if (files.length === 0) return;
        const { imported, refused } = await control.importDroppedMedia(campaignId, files, {
          accept: 'image',
        });
        refused.forEach(showNotice);
        if (imported.length > 0) onMediaImported();
        for (const media of imported) {
          if (media.kind === 'image') await place(scene, media, target, dropPoint);
        }
        return;
      }
      const library = (await control.listMedia(campaignId)).filter(
        (m): m is ImageMedia => m.kind === 'image',
      );
      setImages(library);
      const image = library.find((m) => m.id === mediaId);
      if (!image) throw new Error('Cette image n’est plus dans la bibliothèque.');
      await place(scene, image, target, dropPoint);
    } catch (error) {
      showNotice(errorMessage(error));
    }
  }

  /** Undoes or redoes the last edit of `scene` and shows the Scene as saved. */
  async function travel(scene: Scene, shortcut: EditShortcut) {
    if (!control) return;
    try {
      const saved =
        shortcut === 'undo'
          ? await control.undoSceneEdit(campaignId, scene.id)
          : await control.redoSceneEdit(campaignId, scene.id);
      setScenes((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    } catch (error) {
      showNotice(errorMessage(error));
      setScenes(await control.listScenes(campaignId));
    }
  }

  async function activate(scene: Scene) {
    if (!control) return;
    try {
      await control.activateScene(scene.id);
    } catch (error) {
      showNotice(errorMessage(error));
    }
  }

  async function remove(scene: Scene) {
    if (!control) return;
    try {
      await control.deleteScene(campaignId, scene.id);
      setScenes((current) => current.filter((item) => item.id !== scene.id));
      if (selectedId === scene.id) setSelectedId(undefined);
    } catch (error) {
      showNotice(errorMessage(error));
      setScenes(await control.listScenes(campaignId));
    }
  }

  return (
    <section className="panel scenes-panel" aria-label="Scènes">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">SCÈNES PRÉPARÉES</span>
          <h2>
            <Clapperboard size={18} /> Scènes
          </h2>
        </div>
      </div>

      <form className="campaign-form" onSubmit={(event) => void create(event)}>
        <label>
          NOM DE LA SCÈNE
          <input
            ref={nameField}
            aria-label="Nom de la scène"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        </label>
        <button className="primary-button" type="submit">
          <Plus size={14} /> Créer la scène
        </button>
      </form>

      <ul className="scene-list" aria-label="Scènes de la campagne">
        {scenes.map((scene) => (
          <li
            key={scene.id}
            className={
              [scene.id === openedId && 'selected', isLastActive(scene) && 'last-active']
                .filter(Boolean)
                .join(' ') || undefined
            }
          >
            <button
              className="scene-open"
              aria-pressed={scene.id === openedId}
              onClick={() => setSelectedId(scene.id)}
            >
              {scene.name}
            </button>
            {isActive(scene) && (
              <span className="scene-active-badge">
                <Radio size={12} /> Active
              </span>
            )}
            {isLastActive(scene) && (
              <span className="scene-last-badge">
                <History size={12} /> Dernière active
              </span>
            )}
          </li>
        ))}
      </ul>

      {selected ? (
        <SceneEditor
          key={selected.id}
          scene={selected}
          images={images}
          sounds={sounds}
          active={isActive(selected)}
          fadeDurationMs={onAir?.fadeDurationMs}
          undoState={undoState}
          onTravel={(shortcut) => void travel(selected, shortcut)}
          onRefreshImages={refreshImages}
          onEdit={(command) => edit(selected, command)}
          onEditShowingFailure={(command) => editShowingFailure(selected, command)}
          onTransient={(transient) =>
            control
              ? control.showTransientEdit(campaignId, selected.id, transient)
              : Promise.resolve()
          }
          onDrop={(event, target, dropPoint) =>
            void placeDropped(selected, event, target, dropPoint)
          }
          onActivate={() => void activate(selected)}
          onDelete={() => void remove(selected)}
        />
      ) : (
        scenes.length === 0 &&
        lastActiveId !== undefined && (
          <section className="scene-editor scene-editor-empty" aria-label="Scène ouverte">
            <p>Aucune scène dans cette campagne. Créez-en une pour commencer.</p>
            <button className="primary-button" onClick={() => nameField.current?.focus()}>
              <Plus size={14} /> Créer une scène
            </button>
          </section>
        )
      )}
    </section>
  );
}

interface EditorProps {
  scene: Scene;
  images: ImageMedia[];
  sounds: AudioMedia[];
  /** Whether the Selected Scene is the Active Scene: its edits go on air. */
  active: boolean;
  /** The fade duration setting (OnAirState.fadeDurationMs), undefined until known. */
  fadeDurationMs: number | undefined;
  /** What can be undone and redone on the Scene. */
  undoState: UndoState;
  /** Undoes or redoes the last edit of the Scene. */
  onTravel: (shortcut: EditShortcut) => void;
  onRefreshImages: () => void;
  /** Sends an edit; rejects with the failure, the Scene already reloaded. */
  onEdit: (command: SceneEdit) => Promise<void>;
  /** Sends an edit; a failure is shown as a notice. */
  onEditShowingFailure: (command: SceneEdit) => void;
  /** Shows a live drag's transient update on air (Active Scene only), unsaved. */
  onTransient: (edit: TransientEdit) => Promise<void>;
  /**
   * Something was dropped on the canvas (with the drop point, as canvas fractions) or on a
   * placement list. Read the event's data before awaiting anything.
   */
  onDrop: (event: DragEvent, target: PlacementTarget, dropPoint?: NormalizedPoint) => void;
  onActivate: () => void;
  /** Deletes the Scene, once the Game Master has confirmed. */
  onDelete: () => void;
}

/**
 * The editor of the Selected Scene: its name (rename), "EN DIRECT" when it is the Active
 * Scene, Activate and delete (after confirmation), its Scene title, its full composition drawn by the shared
 * renderer with Hidden placements in the GM-only style, and its Background and Overlay lists.
 * Library images dropped on the canvas or on a list are placed there. Overlays are moved,
 * resized and nudged on the canvas (useOverlayTransforms); a Background's framing sliders show
 * their framing live, on air too (useBackgroundFraming).
 */
function SceneEditor(props: EditorProps) {
  const { scene, images, active, onRefreshImages, onEdit, onEditShowingFailure, onDrop } = props;
  const canvasDrop = useDropTarget((event) => onDrop(event, 'canvas', canvasPoint(event)));
  const transforms = useOverlayTransforms({
    scene,
    active,
    onCommit: (command) =>
      onEdit(command).catch((error: unknown) => showNotice(errorMessage(error))),
    onTransient: props.onTransient,
  });
  const framing = useBackgroundFraming({
    active,
    onCommit: (command) =>
      onEdit(command).catch((error: unknown) => showNotice(errorMessage(error))),
    onTransient: props.onTransient,
  });
  const [renameTo, setRenameTo] = useState<string | null>(null);
  const [renameError, setRenameError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /** Undo or redo, if there is something to; a nudge burst still waiting is saved first. */
  function travel(shortcut: EditShortcut) {
    if (props.undoState[shortcut] === null) return;
    transforms.commitPending();
    props.onTravel(shortcut);
  }
  // Ctrl+Z / Ctrl+Y anywhere in the window, except while typing in a field.
  const latestTravel = useRef(travel);
  useEffect(() => {
    latestTravel.current = travel;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = editShortcutOf(event);
      if (!shortcut) return;
      event.preventDefault();
      latestTravel.current(shortcut);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    if (renameTo === null) return;
    setRenameError('');
    try {
      await onEdit({ kind: 'rename', name: renameTo });
      setRenameTo(null);
    } catch (error) {
      setRenameError(errorMessage(error));
    }
  }

  return (
    <section className="scene-editor" aria-label="Scène ouverte">
      {renameTo === null ? (
        <div className="scene-editor-heading">
          <h3>{scene.name}</h3>
          {active && (
            <span className="scene-live-marker" title="Vos modifications sont diffusées">
              <Radio size={12} /> EN DIRECT
            </span>
          )}
          <button
            className="secondary-button"
            onClick={() => {
              setConfirmingDelete(false);
              setRenameError('');
              setRenameTo(scene.name);
            }}
          >
            <Pencil size={14} /> Renommer
          </button>
          <button className="secondary-button" onClick={() => setConfirmingDelete(true)}>
            <Trash2 size={14} /> Supprimer
          </button>
          <button className="primary-button" onClick={props.onActivate}>
            Activer
          </button>
        </div>
      ) : (
        <form className="campaign-form" onSubmit={(event) => void submitRename(event)}>
          <label>
            Nouveau nom
            <input
              autoFocus
              aria-label="Nouveau nom de la scène"
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
            />
          </label>
          <button className="primary-button" type="submit">
            Enregistrer
          </button>
          <button className="secondary-button" type="button" onClick={() => setRenameTo(null)}>
            Annuler
          </button>
        </form>
      )}
      {renameError && (
        <p className="form-error" role="alert">
          {renameError}
        </p>
      )}
      <UndoBar state={props.undoState} onTravel={travel} />
      <SceneTitleField title={scene.title} onEdit={onEditShowingFailure} />

      {confirmingDelete && (
        <div
          className="media-delete-confirm"
          role="alertdialog"
          aria-label="Supprimer la scène"
          aria-describedby="scene-delete-message"
        >
          <p id="scene-delete-message">
            Supprimer la scène « {scene.name} » ? Cette action est définitive.
            {active && ' Elle est à l’antenne : la diffusion n’affichera plus rien.'}
          </p>
          <div className="media-delete-actions">
            <button
              className="secondary-button"
              autoFocus
              onClick={() => setConfirmingDelete(false)}
            >
              Annuler
            </button>
            <button className="primary-button" onClick={props.onDelete}>
              <Trash2 size={14} aria-hidden /> Supprimer la scène
            </button>
          </div>
        </div>
      )}

      <div
        className={`editor-canvas${canvasDrop.over ? ' drop-ready' : ''}`}
        role="group"
        aria-label="Composition de la scène"
        {...canvasDrop.props}
        {...transforms.canvasProps}
      >
        <SceneCanvas
          picture={editorPictureOf(framing.apply(transforms.scene), images)}
          window="control"
          fadeDurationMs={props.fadeDurationMs}
          editing={{
            selectedOverlayId: transforms.selectedId,
            onOverlayPointerDown: transforms.onOverlayPointerDown,
          }}
        />
      </div>

      <PlacementPicker
        images={images}
        onFocus={onRefreshImages}
        onAdd={(image, type) =>
          onEditShowingFailure({
            kind: type === 'background' ? 'place-background' : 'place-overlay',
            mediaId: image.id,
          })
        }
      />

      <div className="placement-lists">
        <BackgroundList
          scene={scene}
          images={images}
          onEdit={onEditShowingFailure}
          onDrop={(event) => onDrop(event, 'backgrounds')}
          framing={framing.gesture}
        />
        <OverlayList
          scene={scene}
          images={images}
          onEdit={onEditShowingFailure}
          onDrop={(event) => onDrop(event, 'overlays')}
        />
      </div>

      <div className="placement-lists">
        <SceneMusicList
          scene={scene}
          sounds={props.sounds}
          onAdd={(mediaId) => {
            if (!props.sounds.some((sound) => sound.id === mediaId)) onRefreshImages();
            onEditShowingFailure({ kind: 'add-music', mediaId });
          }}
        />
      </div>
    </section>
  );
}

/**
 * What can be undone and redone on the Selected Scene, read from the main process again
 * whenever the Scene changes (an edit, an undo, a redo, a reload).
 */
function useUndoState(
  control: ControlBridge | undefined,
  campaignId: CampaignId,
  scene: Scene | undefined,
): UndoState {
  // The state read for a Scene, so a Scene with no answer yet shows nothing to undo.
  const [read, setRead] = useState<{ scene: Scene; state: UndoState }>();
  useEffect(() => {
    if (!control || !scene) return;
    let cancelled = false;
    control
      .getUndoState(campaignId, scene.id)
      .then((state) => {
        if (!cancelled) setRead({ scene, state });
      })
      .catch((error: unknown) => {
        if (!cancelled) showNotice(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [control, campaignId, scene]);
  return read && read.scene.id === scene?.id ? read.state : NOTHING_TO_UNDO;
}

const NOTHING_TO_UNDO: UndoState = { undo: null, redo: null };

/** The undo and redo buttons, each naming the edit it would undo or redo. */
function UndoBar(props: { state: UndoState; onTravel: (shortcut: EditShortcut) => void }) {
  const { undo, redo } = props.state;
  return (
    <div className="undo-bar" role="toolbar" aria-label="Historique de la scène">
      <button
        className="secondary-button"
        disabled={undo === null}
        title="Ctrl+Z"
        onClick={() => props.onTravel('undo')}
      >
        <Undo2 size={14} aria-hidden /> {undo === null ? 'Rien à annuler' : `Annuler : ${undo}`}
      </button>
      <button
        className="secondary-button"
        disabled={redo === null}
        title="Ctrl+Y"
        onClick={() => props.onTravel('redo')}
      >
        <Redo2 size={14} aria-hidden /> {redo === null ? 'Rien à rétablir' : `Rétablir : ${redo}`}
      </button>
    </div>
  );
}

/**
 * Where a drop on the editor canvas lands, as canvas fractions: the canvas is letterboxed inside
 * the drawn area (the first child of the drop target), as the renderer lays it out.
 */
function canvasPoint(event: DragEvent<HTMLElement>): NormalizedPoint {
  const drawn = event.currentTarget.firstElementChild ?? event.currentTarget;
  const box = drawn.getBoundingClientRect();
  return layOutCanvas(
    { width: box.width, height: box.height },
    { backgrounds: [], overlays: [] },
  ).toCanvas({ x: event.clientX - box.left, y: event.clientY - box.top });
}

/** Placing an image without dragging: choose it, then add it as a Background or an Overlay. */
function PlacementPicker(props: {
  images: ImageMedia[];
  onFocus: () => void;
  onAdd: (image: ImageMedia, type: 'background' | 'overlay') => void;
}) {
  const { images, onFocus, onAdd } = props;
  const [chosenId, setChosenId] = useState('');
  const chosen = images.find((image) => image.id === chosenId) ?? images.at(0);
  return (
    <div className="background-picker">
      <label>
        IMAGE À PLACER
        <select
          aria-label="Image à placer"
          value={chosen?.id ?? ''}
          onFocus={onFocus}
          onChange={(e) => setChosenId(e.target.value)}
        >
          {images.length === 0 && <option value="">Importez d’abord une image</option>}
          {images.map((image) => (
            <option key={image.id} value={image.id}>
              {image.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="secondary-button"
        disabled={!chosen}
        onClick={() => chosen && onAdd(chosen, 'background')}
      >
        Ajouter en arrière-plan
      </button>
      <button
        className="secondary-button"
        disabled={!chosen}
        onClick={() => chosen && onAdd(chosen, 'overlay')}
      >
        Ajouter en superposition
      </button>
    </div>
  );
}

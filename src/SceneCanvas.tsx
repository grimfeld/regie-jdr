import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { OnAirBackground, OnAirOverlay, Transition } from '../shared/domain';
import { layOutCanvas, type Box, type Size } from '../core/canvas';
import {
  FADE_DURATION_MS,
  dissolveEnded,
  dissolveStarted,
  firstLayers,
  withLeaving,
  withNewestPicture,
  withoutLeaving,
  withTransition,
  type Fading,
  type TransitionLayer,
} from '../core/fades';
import { MediaImage } from './MediaImage';
import type { OverlayPart } from './useOverlayTransforms';

/** A Background to draw. `hidden` (editor only): Hidden, drawn in the GM-only style. */
export interface PictureBackground extends OnAirBackground {
  hidden?: boolean;
}

/** An Overlay to draw. `hidden`, `labelHidden` (editor only): drawn in the GM-only style. */
export interface PictureOverlay extends OnAirOverlay {
  hidden?: boolean;
  labelHidden?: boolean;
}

/**
 * What the renderer draws: placements bottom to top, Overlays above every Background, with
 * their Media addresses. A broadcast projection (OnAirScene) is one as it is.
 */
export interface Picture {
  backgrounds: readonly PictureBackground[];
  overlays: readonly PictureOverlay[];
  title?: string;
}

interface Props {
  /** null: an empty (black) canvas. */
  picture: Picture | null;
  /** Blackout: the canvas is black, whatever the picture. */
  blackout?: boolean;
  /** Which window draws it: decides what a missing Media looks like (see MediaImage). */
  window: 'control' | 'broadcast';
  /** The fade duration setting (OnAirState.fadeDurationMs); its default until it is known. */
  fadeDurationMs?: number;
  /**
   * On air only (OnAirState.transition): a new Transition id dissolves from what is drawn to
   * `picture` over its duration, once the incoming images are decoded. Without it (the editor),
   * a new picture changes item by item, each fading.
   */
  transition?: Pick<Transition, 'id' | 'durationMs'> | null;
  /**
   * Editor only: Overlays can be picked, moved and resized (src/useOverlayTransforms.ts). The
   * selected one is outlined, with a resize handle at its bottom-right corner. Absent in the
   * On-air monitor and the Broadcast window, which have nothing to interact with.
   */
  editing?: Editing;
}

interface Editing {
  selectedOverlayId: string | undefined;
  onOverlayPointerDown: (id: string, event: PointerEvent<HTMLElement>, part: OverlayPart) => void;
}

/** A box as absolute CSS placement (transform, so moving it never relays out the page). */
function placed(box: Box | undefined): CSSProperties {
  if (!box) return { visibility: 'hidden' };
  return {
    width: box.width,
    height: box.height,
    transform: `translate(${box.x}px, ${box.y}px)`,
  };
}

/** An item to draw; `steady` when it came in with its picture's dissolve: no fade of its own. */
type Drawn<T> = Fading<T> & { steady: boolean };

/**
 * The items to draw for `items`: each one, plus those just removed, kept as last drawn and
 * `leaving` until they have faded out (core/fades.ts). Hidden items never reach the Broadcast
 * window, so their fade-out there can only use what it last drew. With `steadyAtFirst` (read
 * once, when first drawn: a picture a Transition brings in, which dissolves as a whole), the
 * first items are `steady` until they leave; items added later fade in as usual.
 */
function useFading<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  fadeDurationMs: number,
  steadyAtFirst = false,
): Drawn<T>[] {
  // Pictures are rebuilt on every render: they are compared by content.
  const content = JSON.stringify(items);
  const [state, setState] = useState(() => ({
    content,
    drawn: withLeaving([], items, keyOf),
    steady: new Set(steadyAtFirst ? items.map(keyOf) : []),
  }));
  let { drawn, steady } = state;
  if (state.content !== content) {
    drawn = withLeaving(drawn, items, keyOf);
    // An item that leaves stops being steady: shown again, it fades in.
    const staying = drawn.filter((entry) => !entry.leaving && steady.has(entry.key));
    steady = new Set(staying.map((entry) => entry.key));
    setState({ content, drawn, steady });
  }
  // The timer restarts only when the set of leaving items changes, never on a mere redraw: a
  // live drag redraws every frame, and a Hidden item must still leave the Broadcast window's DOM
  // once its fade is over (ADR-0003).
  const leaving = JSON.stringify(drawn.filter((entry) => entry.leaving).map((entry) => entry.key));
  useEffect(() => {
    if (leaving === '[]') return;
    const timer = setTimeout(() => {
      setState((current) => ({ ...current, drawn: withoutLeaving(current.drawn) }));
    }, fadeDurationMs);
    return () => clearTimeout(timer);
  }, [leaving, fadeDurationMs]);
  return drawn.map((entry) => ({ ...entry, steady: steady.has(entry.key) }));
}

const byId = (item: { id: string }) => item.id;

/**
 * The proportions the Control window lays out a missing Media with, so its "Média manquant"
 * placeholder takes a place on the canvas (it has no image to measure). The Broadcast window
 * draws nothing for it.
 */
const MISSING_MEDIA_SIZE: Size = { width: 1, height: 1 };
const asText = (text: string) => text;

/**
 * How an item fades (styles.css): `waiting` stays transparent (its image is not decoded yet),
 * `shown` fades in, `leaving` fades out. A steady item (it dissolves in with its picture) is
 * `pending` (not drawn) until decoded, then `steady`: drawn at once, with no fade of its own.
 */
function fadeOf(
  entry: Drawn<unknown>,
  ready = true,
): 'waiting' | 'shown' | 'leaving' | 'pending' | 'steady' {
  if (entry.leaving) return 'leaving';
  if (entry.steady) return ready ? 'steady' : 'pending';
  return ready ? 'shown' : 'waiting';
}

interface PlacementProps {
  kind: 'background' | 'overlay';
  entry: Drawn<PictureBackground | PictureOverlay>;
  box: Box | undefined;
  window: 'control' | 'broadcast';
  onImageSize: (src: string, natural: Size) => void;
  /** Its image is decoded, or found missing: there is nothing more to wait for. */
  onSettled: (src: string) => void;
  /** Editor only, for an Overlay still on the Scene (not one fading out). */
  editing?: Editing;
  children?: ReactNode;
}

/**
 * A Background or an Overlay: transparent until its image is decoded, then it fades in. In the
 * editor, an Overlay can be picked, moved and resized.
 */
function Placement(props: PlacementProps) {
  const { kind, entry, box, window: shownIn, onImageSize, onSettled, editing, children } = props;
  const { item } = entry;
  // The image decoded, or found missing (Control window), by address: another address waits again.
  const [ready, setReady] = useState<string>();
  const selected = editing?.selectedOverlayId === item.id;
  return (
    <div
      className={[`canvas-${kind}`, item.hidden && 'is-hidden', selected && 'is-selected']
        .filter(Boolean)
        .join(' ')}
      data-background-id={kind === 'background' ? item.id : undefined}
      data-overlay-id={kind === 'overlay' ? item.id : undefined}
      data-fade={fadeOf(entry, ready === item.src)}
      style={placed(box)}
      {...(editing && {
        onPointerDown: (event: PointerEvent<HTMLElement>) =>
          editing.onOverlayPointerDown(item.id, event, 'move'),
        onDragStart: (event: DragEvent<HTMLElement>) => event.preventDefault(),
      })}
    >
      <MediaImage
        address={item.src}
        alt=""
        window={shownIn}
        onLoad={(natural) => onImageSize(item.src, natural)}
        onDecoded={() => {
          setReady(item.src);
          onSettled(item.src);
        }}
        onMissing={() => {
          onSettled(item.src);
          if (shownIn !== 'control') return;
          onImageSize(item.src, MISSING_MEDIA_SIZE);
          setReady(item.src);
        }}
      />
      {editing && selected && (
        <span
          className="canvas-overlay-handle"
          title="Redimensionner"
          onPointerDown={(event) => editing.onOverlayPointerDown(item.id, event, 'resize')}
        />
      )}
      {children}
    </div>
  );
}

/** An Overlay's Label: fades on show, hide and change of text. */
function OverlayLabel({
  overlay,
  fadeDurationMs,
  steadyAtFirst,
}: {
  overlay: PictureOverlay;
  fadeDurationMs: number;
  steadyAtFirst: boolean;
}) {
  const texts = useFading(
    overlay.label === undefined ? [] : [overlay.label],
    asText,
    fadeDurationMs,
    steadyAtFirst,
  );
  return texts.map((entry) => (
    <span
      key={entry.key}
      className={`canvas-label${overlay.labelHidden ? ' is-hidden' : ''}`}
      data-fade={fadeOf(entry)}
    >
      {entry.item}
    </span>
  ));
}

interface LayerProps {
  layer: TransitionLayer<Picture | null>;
  /** Read when first drawn: a Transition brought it in, so its items dissolve in with it. */
  steady: boolean;
  size: Size;
  imageSizes: Partial<Record<string, Size>>;
  onImageSize: (src: string, natural: Size) => void;
  window: 'control' | 'broadcast';
  fadeDurationMs: number;
  editing?: Editing;
  /** Every image of its picture is decoded (or missing): its dissolve can start. */
  onReady: (key: number) => void;
}

/**
 * One picture on its black backdrop (TransitionLayer in core/fades.ts): placements bottom to
 * top, Overlays above every Background, then the Scene title, so all of it dissolves together.
 */
function CanvasLayer(props: LayerProps) {
  const { layer, steady, size, imageSizes, onImageSize, window: shownIn } = props;
  const { fadeDurationMs, editing, onReady } = props;
  const { key, phase, picture } = layer;
  const backgrounds = useFading(picture?.backgrounds ?? [], byId, fadeDurationMs, steady);
  const overlays = useFading(picture?.overlays ?? [], byId, fadeDurationMs, steady);
  const titles = useFading(picture?.title ? [picture.title] : [], asText, fadeDurationMs, steady);
  // Media addresses whose image is decoded, or missing.
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());
  const [onSettled] = useState(
    () => (src: string) =>
      setSettled((known) => (known.has(src) ? known : new Set(known).add(src))),
  );

  const unsettled = [...backgrounds, ...overlays].filter(
    (entry) => !entry.leaving && !settled.has(entry.item.src),
  ).length;
  useEffect(() => {
    if (phase === 'waiting' && unsettled === 0) onReady(key);
  }, [phase, unsettled, key, onReady]);

  const layout = layOutCanvas(size, {
    backgrounds: backgrounds.map(({ item }) => ({ ...item, image: imageSizes[item.src] })),
    overlays: overlays.map(({ item }) => ({ ...item, image: imageSizes[item.src] })),
  });

  return (
    <div
      className="canvas-layer"
      data-transition={phase}
      style={
        {
          '--transition-duration': `${layer.durationMs}ms`,
        } as CSSProperties
      }
    >
      {backgrounds.map((entry) => (
        <Placement
          key={`background:${entry.key}`}
          kind="background"
          entry={entry}
          box={layout.backgrounds[entry.key]}
          window={shownIn}
          onImageSize={onImageSize}
          onSettled={onSettled}
        />
      ))}
      {overlays.map((entry) => (
        <Placement
          key={`overlay:${entry.key}`}
          kind="overlay"
          entry={entry}
          box={layout.overlays[entry.key]}
          window={shownIn}
          onImageSize={onImageSize}
          onSettled={onSettled}
          editing={entry.leaving ? undefined : editing}
        >
          <OverlayLabel
            overlay={entry.item}
            fadeDurationMs={fadeDurationMs}
            steadyAtFirst={entry.steady}
          />
        </Placement>
      ))}
      {titles.map((entry) => (
        <div key={`title:${entry.key}`} className="canvas-title" data-fade={fadeOf(entry)}>
          {entry.item}
        </div>
      ))}
    </div>
  );
}

/**
 * The pictures to draw, one layer each, as Transitions come (core/fades.ts): a new Transition
 * id puts the incoming picture on top, which dissolves in once its images are decoded and is
 * then drawn alone. Otherwise the newest picture follows `picture`, its items fading one by one.
 * Returns the layers, bottom first, and what to call when a layer's images are all decoded.
 */
function useTransitionLayers(
  picture: Picture | null,
  transition: Props['transition'],
): [readonly TransitionLayer<Picture | null>[], (key: number) => void] {
  // Pictures are rebuilt on every render: they are compared by content.
  const content = JSON.stringify(picture);
  const [state, setState] = useState(() => ({
    content,
    layers: firstLayers<Picture | null>(transition?.id ?? 0, picture),
  }));
  let { layers } = state;
  if (transition && transition.id !== layers.at(-1)?.key) {
    layers = withTransition(layers, transition.id, picture, transition.durationMs);
    setState({ content, layers });
  } else if (state.content !== content) {
    layers = withNewestPicture(layers, picture);
    setState({ content, layers });
  }

  const newest = layers.at(-1);
  const dissolving = newest?.phase === 'dissolving' ? newest : undefined;
  useEffect(() => {
    if (!dissolving) return;
    const { key, startedAt = Date.now(), durationMs } = dissolving;
    const timer = setTimeout(
      () => setState((current) => ({ ...current, layers: dissolveEnded(current.layers, key) })),
      Math.max(0, startedAt + durationMs - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [dissolving]);

  const [onReady] = useState(
    () => (key: number) =>
      setState((current) => ({
        ...current,
        layers: dissolveStarted(current.layers, key, Date.now()),
      })),
  );
  return [layers, onReady];
}

/**
 * The one renderer of a Scene, used by the editor, the On-air monitor and the Broadcast window
 * (ADR-0003), so all three show the same composition. It fills its container with black and
 * draws the fixed 16:9 canvas inside it, letterboxed, laid out by core/canvas.ts. DOM and CSS
 * only. An image takes its place once loaded (its proportions are needed for the layout), then
 * fades in; placements, Labels, the Scene title and Blackout fade in and out over the fade
 * duration. On air, a Transition dissolves the whole picture (useTransitionLayers), under
 * Blackout when it is on.
 */
export function SceneCanvas({
  picture,
  blackout = false,
  window: shownIn,
  fadeDurationMs = FADE_DURATION_MS.default,
  transition,
  editing,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  // Natural size of each loaded image, by Media address.
  const [imageSizes, setImageSizes] = useState<Partial<Record<string, Size>>>({});

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize((shown) =>
        shown.width === width && shown.height === height ? shown : { width, height },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const [layers, onReady] = useTransitionLayers(picture, transition);
  const blackouts = useFading(blackout ? ['blackout'] : [], asText, fadeDurationMs);

  const { canvas, scale } = layOutCanvas(size, { backgrounds: [], overlays: [] });
  const [imageSize] = useState(
    () => (src: string, natural: Size) =>
      setImageSizes((known) => (known[src] ? known : { ...known, [src]: natural })),
  );

  return (
    <div className="scene-canvas" ref={root} data-blackout={blackout}>
      <div
        className="scene-canvas-stage"
        style={
          {
            left: canvas.x,
            top: canvas.y,
            width: canvas.width,
            height: canvas.height,
            '--canvas-scale': scale,
            '--fade-duration': `${fadeDurationMs}ms`,
          } as CSSProperties
        }
      >
        {layers.map((layer, index) => (
          <CanvasLayer
            key={layer.key}
            layer={layer}
            steady={layer.phase === 'waiting'}
            size={size}
            imageSizes={imageSizes}
            onImageSize={imageSize}
            window={shownIn}
            fadeDurationMs={fadeDurationMs}
            editing={index === layers.length - 1 ? editing : undefined}
            onReady={onReady}
          />
        ))}
        {blackouts.map((entry) => (
          <div key={entry.key} className="canvas-blackout" data-fade={fadeOf(entry)} />
        ))}
      </div>
    </div>
  );
}

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
import type { OnAirBackground, OnAirOverlay } from '../shared/domain';
import { layOutCanvas, type Box, type Size } from '../core/canvas';
import { FADE_DURATION_MS, withLeaving, withoutLeaving, type Fading } from '../core/fades';
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

/**
 * The items to draw for `items`: each one, plus those just removed, kept as last drawn and
 * `leaving` until they have faded out (core/fades.ts). Hidden items never reach the Broadcast
 * window, so their fade-out there can only use what it last drew.
 */
function useFading<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  fadeDurationMs: number,
): Fading<T>[] {
  // Pictures are rebuilt on every render: they are compared by content.
  const content = JSON.stringify(items);
  const [state, setState] = useState(() => ({ content, drawn: withLeaving([], items, keyOf) }));
  let { drawn } = state;
  if (state.content !== content) {
    drawn = withLeaving(drawn, items, keyOf);
    setState({ content, drawn });
  }
  const leaving = drawn.some((entry) => entry.leaving);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => {
      setState((current) => ({ ...current, drawn: withoutLeaving(current.drawn) }));
    }, fadeDurationMs);
    return () => clearTimeout(timer);
  }, [drawn, leaving, fadeDurationMs]);
  return drawn;
}

const byId = (item: { id: string }) => item.id;
const asText = (text: string) => text;

/**
 * How an item fades (styles.css): `waiting` stays transparent (its image is not decoded yet),
 * `shown` fades in, `leaving` fades out.
 */
function fadeOf(entry: Fading<unknown>, ready = true): 'waiting' | 'shown' | 'leaving' {
  if (entry.leaving) return 'leaving';
  return ready ? 'shown' : 'waiting';
}

interface PlacementProps {
  kind: 'background' | 'overlay';
  entry: Fading<PictureBackground | PictureOverlay>;
  box: Box | undefined;
  window: 'control' | 'broadcast';
  onImageSize: (src: string, natural: Size) => void;
  /** Editor only, for an Overlay still on the Scene (not one fading out). */
  editing?: Editing;
  children?: ReactNode;
}

/**
 * A Background or an Overlay: transparent until its image is decoded, then it fades in. In the
 * editor, an Overlay can be picked, moved and resized.
 */
function Placement(props: PlacementProps) {
  const { kind, entry, box, window: shownIn, onImageSize, editing, children } = props;
  const { item } = entry;
  // The image decoded, by address: another address waits again.
  const [decoded, setDecoded] = useState<string>();
  const selected = editing?.selectedOverlayId === item.id;
  return (
    <div
      className={[`canvas-${kind}`, item.hidden && 'is-hidden', selected && 'is-selected']
        .filter(Boolean)
        .join(' ')}
      data-background-id={kind === 'background' ? item.id : undefined}
      data-overlay-id={kind === 'overlay' ? item.id : undefined}
      data-fade={fadeOf(entry, decoded === item.src)}
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
        onDecoded={() => setDecoded(item.src)}
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
}: {
  overlay: PictureOverlay;
  fadeDurationMs: number;
}) {
  const texts = useFading(
    overlay.label === undefined ? [] : [overlay.label],
    asText,
    fadeDurationMs,
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

/**
 * The one renderer of a Scene, used by the editor, the On-air monitor and the Broadcast window
 * (ADR-0003), so all three show the same composition. It fills its container with black and
 * draws the fixed 16:9 canvas inside it, letterboxed, laid out by core/canvas.ts. DOM and CSS
 * only. An image takes its place once loaded (its proportions are needed for the
 * layout), then fades in; placements, Labels, the Scene title and Blackout fade in and out over
 * the fade duration.
 */
export function SceneCanvas({
  picture,
  blackout = false,
  window: shownIn,
  fadeDurationMs = FADE_DURATION_MS.default,
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

  const backgrounds = useFading(picture?.backgrounds ?? [], byId, fadeDurationMs);
  const overlays = useFading(picture?.overlays ?? [], byId, fadeDurationMs);
  const titles = useFading(picture?.title ? [picture.title] : [], asText, fadeDurationMs);
  const blackouts = useFading(blackout ? ['blackout'] : [], asText, fadeDurationMs);

  const layout = layOutCanvas(size, {
    backgrounds: backgrounds.map(({ item }) => ({ ...item, image: imageSizes[item.src] })),
    overlays: overlays.map(({ item }) => ({ ...item, image: imageSizes[item.src] })),
  });
  const { canvas } = layout;
  const imageSize = (src: string, natural: Size) =>
    setImageSizes((known) => (known[src] ? known : { ...known, [src]: natural }));

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
            '--canvas-scale': layout.scale,
            '--fade-duration': `${fadeDurationMs}ms`,
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
            onImageSize={imageSize}
          />
        ))}
        {overlays.map((entry) => (
          <Placement
            key={`overlay:${entry.key}`}
            kind="overlay"
            entry={entry}
            box={layout.overlays[entry.key]}
            window={shownIn}
            onImageSize={imageSize}
            editing={entry.leaving ? undefined : editing}
          >
            <OverlayLabel overlay={entry.item} fadeDurationMs={fadeDurationMs} />
          </Placement>
        ))}
        {titles.map((entry) => (
          <div key={`title:${entry.key}`} className="canvas-title" data-fade={fadeOf(entry)}>
            {entry.item}
          </div>
        ))}
        {blackouts.map((entry) => (
          <div key={entry.key} className="canvas-blackout" data-fade={fadeOf(entry)} />
        ))}
      </div>
    </div>
  );
}

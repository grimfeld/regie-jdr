import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
} from 'react';
import type { OnAirBackground, OnAirOverlay } from '../shared/domain';
import { layOutCanvas, type Box, type Size } from '../core/canvas';
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
  /**
   * Editor only: Overlays can be picked, moved and resized (src/useOverlayTransforms.ts). The
   * selected one is outlined, with a resize handle at its bottom-right corner. Absent in the
   * On-air monitor and the Broadcast window, which have nothing to interact with.
   */
  editing?: {
    selectedOverlayId: string | undefined;
    onOverlayPointerDown: (id: string, event: PointerEvent<HTMLElement>, part: OverlayPart) => void;
  };
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
 * The one renderer of a Scene, used by the editor, the On-air monitor and the Broadcast window
 * (ADR-0003), so all three show the same composition. It fills its container with black and
 * draws the fixed 16:9 canvas inside it, letterboxed, laid out by core/canvas.ts. DOM and CSS
 * only. An image takes its place once loaded (its proportions are needed for the layout).
 */
export function SceneCanvas({ picture, blackout = false, window: shownIn, editing }: Props) {
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

  const backgrounds = picture?.backgrounds ?? [];
  const overlays = picture?.overlays ?? [];
  const layout = layOutCanvas(size, {
    backgrounds: backgrounds.map((item) => ({ ...item, image: imageSizes[item.src] })),
    overlays: overlays.map((item) => ({ ...item, image: imageSizes[item.src] })),
  });
  const { canvas } = layout;
  const loaded = (src: string) => (natural: Size) =>
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
          } as CSSProperties
        }
      >
        {backgrounds.map((item) => (
          <div
            key={item.id}
            className={`canvas-background${item.hidden ? ' is-hidden' : ''}`}
            data-background-id={item.id}
            style={placed(layout.backgrounds[item.id])}
          >
            <MediaImage address={item.src} alt="" window={shownIn} onLoad={loaded(item.src)} />
          </div>
        ))}
        {overlays.map((item) => {
          const selected = editing?.selectedOverlayId === item.id;
          return (
            <div
              key={item.id}
              className={['canvas-overlay', item.hidden && 'is-hidden', selected && 'is-selected']
                .filter(Boolean)
                .join(' ')}
              data-overlay-id={item.id}
              style={placed(layout.overlays[item.id])}
              {...(editing && {
                onPointerDown: (event: PointerEvent<HTMLElement>) =>
                  editing.onOverlayPointerDown(item.id, event, 'move'),
                onDragStart: (event: DragEvent<HTMLElement>) => event.preventDefault(),
              })}
            >
              <MediaImage address={item.src} alt="" window={shownIn} onLoad={loaded(item.src)} />
              {editing && selected && (
                <span
                  className="canvas-overlay-handle"
                  title="Redimensionner"
                  onPointerDown={(event) => editing.onOverlayPointerDown(item.id, event, 'resize')}
                />
              )}
              {item.label !== undefined && (
                <span className={`canvas-label${item.labelHidden ? ' is-hidden' : ''}`}>
                  {item.label}
                </span>
              )}
            </div>
          );
        })}
        {picture?.title ? <div className="canvas-title">{picture.title}</div> : null}
        {blackout && <div className="canvas-blackout" />}
      </div>
    </div>
  );
}

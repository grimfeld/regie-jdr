import { useState } from 'react';
import { ImageOff } from 'lucide-react';

interface Props {
  /** The image's Media address (`mediaAddress` in core/mediaAddress.ts). */
  address: string;
  alt: string;
  /** Which window shows it: decides what a missing Media looks like. */
  window: 'control' | 'broadcast';
  className?: string;
  /** Called with the image's natural size once it has loaded and is decoded. */
  onLoad?: (size: { width: number; height: number }) => void;
}

/**
 * An image Media. Every window shows image Media through this component, so a Media whose file
 * was deleted or moved outside the app (its address answers 404) never shows a broken image:
 * - Control window: a "Média manquant" placeholder, so the Game Master knows.
 * - Broadcast window: nothing at all; the image also stays hidden until it has loaded.
 * An image counts as loaded once decoded too, so it is never drawn half-done (the renderer
 * fades it in from then on).
 */
export function MediaImage({ address, alt, window: shownIn, className, onLoad }: Props) {
  // Per address, so another address (another Media, or the file put back) is tried again.
  const [state, setState] = useState<{ address: string; status: 'loaded' | 'missing' }>();
  const status = state?.address === address ? state.status : 'loading';

  if (status === 'missing') {
    if (shownIn === 'broadcast') return null;
    return (
      <span
        className={['media-missing', className].filter(Boolean).join(' ')}
        role="img"
        aria-label={alt ? `Média manquant : ${alt}` : 'Média manquant'}
        title="Le fichier de ce média a été supprimé ou déplacé hors de l’application."
      >
        <ImageOff size={18} aria-hidden="true" />
        <span aria-hidden="true">Média manquant</span>
      </span>
    );
  }

  return (
    <img
      className={className}
      src={address}
      alt={alt}
      hidden={shownIn === 'broadcast' && status !== 'loaded'}
      onLoad={(event) => {
        const image = event.currentTarget;
        const size = { width: image.naturalWidth, height: image.naturalHeight };
        const loaded = () => {
          setState({ address, status: 'loaded' });
          onLoad?.(size);
        };
        // A decoding failure still leaves a loaded image: show it as the browser can.
        void image.decode().then(loaded, loaded);
      }}
      onError={() => setState({ address, status: 'missing' })}
    />
  );
}

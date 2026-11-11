import { useState } from 'react';
import { ImageOff } from 'lucide-react';

interface Props {
  /** The image's Media address (`mediaAddress` in core/mediaAddress.ts). */
  address: string;
  alt: string;
  /** Which window shows it: decides what a missing Media looks like. */
  window: 'control' | 'broadcast';
  className?: string;
  /** Called with the image's natural size once it has loaded. */
  onLoad?: (size: { width: number; height: number }) => void;
  /** Called once the loaded image is decoded too: it can be drawn whole from then on. */
  onDecoded?: () => void;
  /** Called when the Media's file is missing (its address answers 404). */
  onMissing?: () => void;
}

/**
 * An image Media. Every window shows image Media through this component, so a Media whose file
 * was deleted or moved outside the app (its address answers 404) never shows a broken image:
 * - Control window: a "Média manquant" placeholder, so the Game Master knows.
 * - Broadcast window: nothing at all; the image also stays hidden until it has loaded and is
 *   decoded, so it is never drawn half-done.
 */
export function MediaImage(props: Props) {
  const { address, alt, window: shownIn, className, onLoad, onDecoded, onMissing } = props;
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
        onLoad?.({ width: image.naturalWidth, height: image.naturalHeight });
        const decoded = () => {
          setState({ address, status: 'loaded' });
          onDecoded?.();
        };
        // A decoding failure still leaves a loaded image: show it as the browser can.
        void image.decode().then(decoded, decoded);
      }}
      onError={() => {
        setState({ address, status: 'missing' });
        onMissing?.();
      }}
    />
  );
}

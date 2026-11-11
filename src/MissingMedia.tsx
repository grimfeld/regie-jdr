import { useEffect, useState } from 'react';
import { FileX } from 'lucide-react';
import type { Media, MediaId } from '../shared/domain';
import { mediaAddress } from '../core/mediaAddress';

/** Why a Media shows as missing, for the Game Master. */
export const MISSING_MEDIA_TITLE =
  'Le fichier de ce média a été supprimé ou déplacé hors de l’application.';

/**
 * The "Média manquant" badge of a Media whose file is missing, where it is listed without a
 * picture: audio in the library, in a Scene's Music and Ambience lists, on Soundboard pads.
 * Images show the same words in their place (src/MediaImage.tsx).
 */
export function MissingMediaBadge({ name }: { name: string }) {
  return (
    <span
      className="media-missing-badge"
      role="img"
      aria-label={`Média manquant : ${name}`}
      title={MISSING_MEDIA_TITLE}
    >
      <FileX size={12} aria-hidden="true" />
      <span aria-hidden="true">Média manquant</span>
    </span>
  );
}

/** Whether a Media address answers 404: its file is missing. Unknown (an error) is not. */
async function answersNotFound(address: string): Promise<boolean> {
  try {
    // One byte is enough to know: an audio file can be large.
    const response = await fetch(address, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
    await response.body?.cancel();
    return response.status === 404;
  } catch {
    return false;
  }
}

/**
 * Which of `media` have a missing file, by the rule images use (#13): its address answers 404.
 * Asked again when the list changes and when the Control window gets focus back, as after
 * deleting or moving a file in Explorer.
 */
export function useMissingMedia(media: readonly Media[]): ReadonlySet<MediaId> {
  const [missing, setMissing] = useState<ReadonlySet<MediaId>>(() => new Set());
  const [focused, setFocused] = useState(0);
  useEffect(() => {
    const ask = () => setFocused((count) => count + 1);
    window.addEventListener('focus', ask);
    return () => window.removeEventListener('focus', ask);
  }, []);

  // By value, so a new array of the same Media asks nothing again: one "<id> <address>" a line
  // (neither holds a space or a line break).
  const key = media.map((item) => `${item.id} ${mediaAddress(item)}`).join('\n');
  useEffect(() => {
    let cancelled = false;
    const lines = key === '' ? [] : key.split('\n');
    // answersNotFound never rejects: nothing to handle.
    void Promise.all(
      lines.map(async (line) => {
        const [id, address] = line.split(' ');
        return (await answersNotFound(address)) ? [id] : [];
      }),
    ).then((found) => {
      if (!cancelled) setMissing(new Set(found.flat()));
    });
    return () => {
      cancelled = true;
    };
  }, [key, focused]);
  return missing;
}

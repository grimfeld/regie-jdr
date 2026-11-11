import type { Chapter, ChapterId } from '../shared/domain';
import { chapterOf } from '../core/runningOrder';

/** The menu value for "in no Chapter" (a Chapter id is never empty). */
const NO_CHAPTER = '';

/**
 * The Chapter of the Selected Scene, chosen from the Campaign's Chapters or none: the keyboard
 * way to move a Scene into or out of a Chapter (it goes last there). A running order command,
 * not a Scene edit: never an undo step. Shown only when the Campaign has Chapters.
 */
export function SceneChapterField(props: {
  sceneId: string;
  chapters: readonly Chapter[];
  onMove: (chapterId: ChapterId | null) => void;
}) {
  const { sceneId, chapters, onMove } = props;
  if (chapters.length === 0) return null;
  return (
    <label className="scene-title-field">
      CHAPITRE
      <select
        aria-label="Chapitre"
        value={chapterOf(chapters, sceneId)?.id ?? NO_CHAPTER}
        onChange={(event) => {
          const chosen = event.target.value;
          onMove(chosen === NO_CHAPTER ? null : chosen);
        }}
      >
        <option value={NO_CHAPTER}>Hors chapitre</option>
        {chapters.map((chapter) => (
          <option key={chapter.id} value={chapter.id}>
            {chapter.name}
          </option>
        ))}
      </select>
    </label>
  );
}

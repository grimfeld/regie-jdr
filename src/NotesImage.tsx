import { createContext, useContext } from 'react';
import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import type { ImageMedia } from '../shared/domain';
import { mediaAddress } from '../core/mediaAddress';
import { isNotesMediaId } from '../core/notes';
import { MediaImage, MissingImage } from './MediaImage';

/**
 * The library's images, for the images in the Notes to be drawn from; undefined until the library
 * has been read (nothing is drawn yet, rather than "Média manquant").
 */
export const NotesImagesContext = createContext<readonly ImageMedia[] | undefined>(undefined);

/**
 * An image in the Notes: a block on its own line holding only a Media id (core/notes.ts), drawn
 * from the library like any image Media, "Média manquant" when its file or Media is gone.
 *
 * Copied and pasted inside the Notes it is an `<img data-media-id>` with no address; any other
 * pasted `<img>` is not an image node (its text alone is kept, as for other markup).
 * Node API: https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new/node
 * React node views: https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views/react
 */
export const NotesImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      mediaId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-media-id'),
        renderHTML: (attributes) => ({ 'data-media-id': attributes.mediaId as unknown }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img[data-media-id]',
        getAttrs: (element) =>
          isNotesMediaId(element.getAttribute('data-media-id')) ? null : false,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', HTMLAttributes];
  },

  addNodeView() {
    return ReactNodeViewRenderer(NotesImageView);
  },
});

function NotesImageView({ node }: ReactNodeViewProps) {
  const images = useContext(NotesImagesContext);
  const mediaId: unknown = node.attrs.mediaId;
  const image = images?.find((known) => known.id === mediaId);
  return (
    <NodeViewWrapper className="notes-image" data-drag-handle="">
      {images === undefined ? null : image ? (
        <MediaImage address={mediaAddress(image)} alt={image.name} window="control" />
      ) : (
        <MissingImage alt="" />
      )}
    </NodeViewWrapper>
  );
}

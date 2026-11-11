import { describe, expect, it } from 'vitest';
import {
  emptyNotes,
  MAX_NOTES_DEPTH,
  MAX_NOTES_SIZE,
  MAX_NOTES_IMAGE_WIDTH,
  MIN_NOTES_IMAGE_WIDTH,
  mediaOfNotes,
  notesFromPlainText,
  notesKeepingImages,
  parseNotes,
} from '../../core/notes';
import type { NotesDocument, NotesNode } from '../../shared/domain';

const text = (value: string, ...marks: ('bold' | 'italic')[]): NotesNode =>
  marks.length > 0
    ? { type: 'text', text: value, marks: marks.map((type) => ({ type })) }
    : { type: 'text', text: value };
const paragraph = (...content: NotesNode[]): NotesNode =>
  content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
const doc = (...content: NotesNode[]): NotesDocument => ({ type: 'doc', content });
const MAP_ID = '9b2d1c3e-1111-4d8e-9a43-0f0f2b0c1d2e';
const image = (mediaId: string = MAP_ID): NotesNode => ({ type: 'image', attrs: { mediaId } });

/** Every allowed kind of content, as the editor saves it. */
const everything = doc(
  { type: 'heading', attrs: { level: 1 }, content: [text('Le moulin')] },
  { type: 'heading', attrs: { level: 2 }, content: [text('Rez-de-chaussée')] },
  paragraph(text('Le meunier '), text('ment', 'bold'), text(' toujours', 'bold', 'italic')),
  paragraph(),
  {
    type: 'bulletList',
    content: [{ type: 'listItem', content: [paragraph(text('Farine'))] }],
  },
  {
    type: 'orderedList',
    attrs: { start: 3, type: null },
    content: [
      {
        type: 'listItem',
        content: [
          paragraph(text('Entrer')),
          {
            type: 'bulletList',
            content: [{ type: 'listItem', content: [paragraph(text('Sous-point'))] }],
          },
        ],
      },
    ],
  },
  {
    type: 'taskList',
    content: [
      { type: 'taskItem', attrs: { checked: true }, content: [paragraph(text('Indice trouvé'))] },
      { type: 'taskItem', attrs: { checked: false }, content: [paragraph()] },
    ],
  },
  { type: 'blockquote', content: [paragraph(text('« Qui va là ? »', 'italic')), image()] },
  image(),
  { type: 'image', attrs: { mediaId: MAP_ID, width: 40 } },
  {
    type: 'bulletList',
    content: [{ type: 'listItem', content: [paragraph(text('Plan')), image()] }],
  },
);

describe('parseNotes', () => {
  it('keeps every allowed kind of content as it is', () => {
    expect(parseNotes(everything)).toEqual(everything);
    expect(parseNotes(JSON.parse(JSON.stringify(everything)))).toEqual(everything);
  });

  it('accepts empty notes', () => {
    expect(parseNotes(emptyNotes())).toEqual(doc(paragraph()));
  });

  it('keeps only the Media id of an image, never a file address', () => {
    expect(
      parseNotes(
        doc({ type: 'image', attrs: { mediaId: MAP_ID, src: 'regie-media://x', alt: 'carte' } }),
      ),
    ).toEqual(doc(image()));
  });

  it('keeps an image width from 10 to 100 % of the panel, and none as the default size', () => {
    for (const width of [MIN_NOTES_IMAGE_WIDTH, 55, MAX_NOTES_IMAGE_WIDTH]) {
      const sized: NotesNode = { type: 'image', attrs: { mediaId: MAP_ID, width } };
      expect(parseNotes(doc(sized))).toEqual(doc(sized));
    }
    // The editor saves an image at its default size with a null width.
    expect(parseNotes(doc({ type: 'image', attrs: { mediaId: MAP_ID, width: null } }))).toEqual(
      doc(image()),
    );
  });

  it('drops fields that are not part of the notes', () => {
    const extra = {
      type: 'doc',
      extra: 1,
      content: [
        {
          type: 'heading',
          attrs: { level: 2, id: 'x', textAlign: 'center' },
          content: [
            { type: 'text', text: 'A', marks: [{ type: 'bold', attrs: { x: 1 } }], extra: 1 },
          ],
        },
        { type: 'paragraph', attrs: {}, content: [] },
      ],
    };
    expect(parseNotes(extra)).toEqual(
      doc({ type: 'heading', attrs: { level: 2 }, content: [text('A', 'bold')] }, paragraph()),
    );
  });

  it.each([
    ['not a document', 'texte'],
    ['no content', { type: 'doc' }],
    ['empty document', doc()],
    ['another root', { type: 'paragraph', content: [] }],
    [
      'a link mark',
      {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'a', marks: [{ type: 'link' }] }] },
        ],
      },
    ],
    [
      'a colour',
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'a', marks: [{ type: 'textStyle', attrs: { color: 'red' } }] },
            ],
          },
        ],
      },
    ],
    ['a table', doc({ type: 'table', content: [] })],
    ['an image with no Media id', doc({ type: 'image', attrs: {} })],
    ['an image with a file path', doc({ type: 'image', attrs: { src: 'C:/carte.png' } })],
    ['an image naming a file path as its Media', doc(image(String.raw`C:\Users\mj\carte.png`))],
    [
      'an image naming embedded data as its Media',
      doc(image('data:image/png;base64,iVBORw0KGgo=')),
    ],
    ['an image with a Media id in capitals', doc(image(MAP_ID.toUpperCase()))],
    ['an image with content', doc({ ...image(), content: [paragraph()] })],
    ['an image inside a paragraph', doc(paragraph(image()))],
    [
      'an image first in a list item',
      doc({ type: 'bulletList', content: [{ type: 'listItem', content: [image()] }] }),
    ],
    ['a heading level 3', doc({ type: 'heading', attrs: { level: 3 }, content: [text('a')] })],
    ['empty text', doc(paragraph({ type: 'text', text: '' }))],
    ['text at block level', doc(text('a'))],
    ['a block inside a paragraph', doc(paragraph(paragraph()))],
    ['a paragraph directly in a list', doc({ type: 'bulletList', content: [paragraph()] })],
    ['an empty list', doc({ type: 'bulletList', content: [] })],
    [
      'a task item without checked',
      doc({ type: 'taskList', content: [{ type: 'taskItem', content: [paragraph()] }] }),
    ],
    [
      'a non-integer list start',
      doc({
        type: 'orderedList',
        attrs: { start: 1.5 },
        content: [{ type: 'listItem', content: [paragraph()] }],
      }),
    ],
  ])('refuses %s', (_name, value) => {
    expect(parseNotes(value)).toBeUndefined();
  });

  it.each([9, 101, 0, -50, 55.5, Number.NaN, Infinity, '50', '50%', true])(
    'refuses an image width of %s',
    (width) => {
      expect(
        parseNotes({
          type: 'doc',
          content: [{ type: 'image', attrs: { mediaId: MAP_ID, width } }],
        }),
      ).toBeUndefined();
    },
  );

  it('refuses notes nested too deep', () => {
    let node: NotesNode = paragraph(text('fond'));
    for (let depth = 0; depth < MAX_NOTES_DEPTH; depth++) {
      node = { type: 'blockquote', content: [node] };
    }
    expect(parseNotes(doc(node))).toBeUndefined();
  });

  it('accepts notes nested as deep as allowed, marks and all', () => {
    let node: NotesNode = paragraph({ type: 'text', text: 'fond', marks: [{ type: 'bold' }] });
    for (let depth = 1; depth < MAX_NOTES_DEPTH; depth++) {
      node = { type: 'blockquote', content: [node] };
    }
    expect(parseNotes(doc(node))).toEqual(doc(node));
  });

  it('refuses notes nested too deep before walking them any deeper', () => {
    // Deep enough for a recursive walk (JSON.stringify, the parser) to be a risk: what lies
    // below the depth limit is never even looked at.
    let looked = false;
    let node: Record<string, unknown> = {
      type: 'paragraph',
      get content() {
        looked = true;
        return [text('fond')];
      },
    };
    for (let depth = 0; depth < MAX_NOTES_DEPTH + 20; depth++) {
      node = { type: 'blockquote', content: [node] };
    }
    expect(parseNotes({ type: 'doc', content: [node] })).toBeUndefined();
    expect(looked).toBe(false);
  });

  it('refuses notes nested a million levels deep without overflowing the stack', () => {
    let node: unknown = { type: 'paragraph' };
    for (let depth = 0; depth < 1_000_000; depth++) node = { type: 'blockquote', content: [node] };
    expect(parseNotes({ type: 'doc', content: [node] })).toBeUndefined();
  });

  it('refuses notes too large', () => {
    expect(parseNotes(doc(paragraph(text('a'.repeat(MAX_NOTES_SIZE)))))).toBeUndefined();
  });
});

describe('notesFromPlainText', () => {
  it('makes one paragraph per line, keeping empty lines and spaces', () => {
    expect(notesFromPlainText('Le traître\n\n  est le capitaine \r\nfin')).toEqual(
      doc(
        paragraph(text('Le traître')),
        paragraph(),
        paragraph(text('  est le capitaine ')),
        paragraph(text('fin')),
      ),
    );
  });

  it('turns no text into empty notes', () => {
    expect(notesFromPlainText('')).toEqual(emptyNotes());
  });

  it('gives notes that pass the check', () => {
    expect(parseNotes(notesFromPlainText('a\nb'))).toEqual(notesFromPlainText('a\nb'));
  });
});

const PORTRAIT_ID = '1c0ffee0-2222-4abc-8def-0123456789ab';
const quote = (...content: NotesNode[]): NotesNode => ({ type: 'blockquote', content });
const bullets = (...items: NotesNode[][]): NotesNode => ({
  type: 'bulletList',
  content: items.map((content) => ({ type: 'listItem', content })),
});

describe('mediaOfNotes', () => {
  it('finds no Media in Notes without images', () => {
    expect(mediaOfNotes(emptyNotes())).toEqual([]);
  });

  it('finds the Media of every image, nested in quotes and lists too, in document order', () => {
    const notes = doc(
      image(),
      quote(paragraph(text('Carte')), image(PORTRAIT_ID)),
      bullets([paragraph(text('Salle')), { type: 'image', attrs: { mediaId: MAP_ID, width: 40 } }]),
    );

    expect(mediaOfNotes(notes)).toEqual([MAP_ID, PORTRAIT_ID, MAP_ID]);
  });
});

describe('notesKeepingImages', () => {
  const notMap = (mediaId: string) => mediaId !== MAP_ID;

  it('gives back the same Notes when every image is kept', () => {
    const notes = doc(paragraph(text('Le moulin')), image(PORTRAIT_ID));

    expect(notesKeepingImages(notes, notMap)).toBe(notes);
  });

  it('removes the images of a Media wherever they stand, keeping everything else', () => {
    const notes = doc(
      paragraph(text('Le moulin')),
      image(),
      quote(paragraph(text('Carte')), image(), image(PORTRAIT_ID)),
      bullets([paragraph(text('Salle')), image()]),
    );

    expect(notesKeepingImages(notes, notMap)).toEqual(
      doc(
        paragraph(text('Le moulin')),
        quote(paragraph(text('Carte')), image(PORTRAIT_ID)),
        bullets([paragraph(text('Salle'))]),
      ),
    );
  });

  it('leaves an empty paragraph where only the removed images stood', () => {
    expect(notesKeepingImages(doc(image(), image()), notMap)).toEqual(emptyNotes());
    expect(notesKeepingImages(doc(quote(image())), notMap)).toEqual(doc(quote(paragraph())));
  });

  it('gives Notes that pass the check', () => {
    const notes = doc(quote(image()), bullets([paragraph(text('Salle')), image()]), image());

    const kept = notesKeepingImages(notes, notMap);

    expect(parseNotes(kept)).toEqual(kept);
  });
});

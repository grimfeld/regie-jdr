# Scene Notes stored as ProseMirror JSON, images as Media references

Scene Notes are rich text with inline images, edited with TipTap (ProseMirror) and stored as its structured JSON document inside the Scene. Images in Notes are ordinary Campaign Media referenced by id, never file paths or embedded base64. We chose structured JSON over Markdown or HTML because it round-trips the editor exactly, can be validated like any other Scene field, and lets us find every Media reference in Notes without parsing markup. We chose Media references over private per-Scene attachments so that Notes images share one storage path, one deduplication, the missing-Media placeholder and the delete warning that lists the Scenes using a Media.

## Consequences

- Plain-text notes from earlier schema versions are migrated to one paragraph per line.
- Media reference scans (delete warning, orphan detection, duplicate) must include images inside Notes.
- Swapping editors later means converting stored documents, not just replacing a component.
- Images pasted or dropped into Notes appear in the Campaign library.

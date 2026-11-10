# Subsystem: Media library

Source: #25 agent report, 2026-11-11. True as of `grimfeld/regie-jdr@5cbaeb5`.

- Thumbnails live in `campaigns/<id>/thumbnails/<hash>.png`, served at `regie-media://thumbnail/...` (`thumbnailAddress`). A missing thumbnail is regenerated on request; nothing is served once the Media file is gone.
- `createMediaLibrary(storage, resizer)` needs a resizer; tests use `tests/unit/fakeResizer.ts`.
- WebP thumbnails use the OS thumbnail provider (`createThumbnailFromPath`) because `nativeImage` decodes only PNG/JPEG. Windows and macOS only: on Linux (CI) a WebP shows "Média manquant".
- Library lists: "Images" and "Sons" (renamed from "Médias"). Rename works on both, via `media:rename`; renaming refreshes the Scenes panel.
- Search: `core/librarySearch` (renderer-safe, in `RENDERER_SAFE_CORE`). The list is windowed; the windowing math has unit tests.

## Open (2026-11-11)

- Nobody has checked by hand that ~500 images scroll smoothly. App tests use at most 3 images. List it in the M1 PR as a manual check.

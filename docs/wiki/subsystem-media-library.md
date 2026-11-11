# Subsystem: Media library

Source: #25 agent report, 2026-11-11. True as of `grimfeld/regie-jdr@5cbaeb5`.

- Thumbnails live in `campaigns/<id>/thumbnails/<hash>.png`, served at `regie-media://thumbnail/...` (`thumbnailAddress`). A missing thumbnail is regenerated on request; nothing is served once the Media file is gone.
- `createMediaLibrary(storage, resizer)` needs a resizer; tests use `tests/unit/fakeResizer.ts`.
- WebP thumbnails use the OS thumbnail provider (`createThumbnailFromPath`) because `nativeImage` decodes only PNG/JPEG. Windows and macOS only: on Linux (CI) a WebP shows "Média manquant".
- Library lists: "Images" and "Sons" (renamed from "Médias"). Rename works on both, via `media:rename`; renaming refreshes the Scenes panel.
- Search: `core/librarySearch` (renderer-safe, in `RENDERER_SAFE_CORE`). The list is windowed; the windowing math has unit tests.

## Open (2026-11-11)

- Nobody has checked by hand that ~500 images scroll smoothly. App tests use at most 3 images. List it in the M1 PR as a manual check.

## Explorer drag-import (#27, 2026-11-11, `a65b466`)

- Channel `media:import-dropped`. The Control bridge (`importDroppedImages`) reads paths with `webUtils.getPathForFile`; the page never names a path. Main goes through `library.import(..., {accept:'image'})`, like the picker.
- Main treats paths as untrusted: max 1000, absolute, no NUL; network-share (`\server\...`) and device paths refused (security choice, list in PR). Audio drops refused: « ce n’est pas une image ».
- Unreadable path (gone, folder) gives a French refusal per file instead of failing the batch, for picker imports too.
- `src/main.tsx` has a page-wide guard refusing drops no target took; that is why the Broadcast window ignores drops.
- Tests: `dropFiles` in `tests/app/harness.ts` simulates Explorer drops via a hidden file input, so files carry real paths. Synthetic drops ignore `dropEffect`.

## Audio library (#34, 2026-11-11, `m2-audio-mvp@398a0dd`)

- Supersedes the #27 note above for M2: as of `398a0dd`, audio dropped on the library (or imported with "Importer des sons") opens a role dialog (Musique / Ambiance / Bruitage / Annuler); cancelling imports nothing. Audio dropped on the Scene editor is still refused.
- `media:import-dropped` carries the import kind; bridge `importDroppedImages` renamed `importDroppedMedia(campaignId, files, kind)`.
- Duration: `core/audioDuration.ts` reads file headers (MP3, WAV, OGG Vorbis/Opus, FLAC, M4A), no dependency; unreadable → imports anyway, shows "–".
- Media index schema 2 (existing audio gets `durationSeconds: null`). Settings schema 3 adds `masterVolume` (default 1).
- Soundboard type gained `volume`; pads ordered by array position.

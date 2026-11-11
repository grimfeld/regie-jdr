# Subsystem: Campaign management (delete, Export, Import)

## Delete a Campaign (#59, 2026-11-12, `m4-campaign-themes-qol@7b57fe0`)

- `core/campaignDeletion.ts` behind a `Trash` interface; main implements it with `shell.trashItem`.
- Main checks: valid Campaign id; a real folder (no links/junctions) directly in the campaigns folder (realpaths compared) with a readable `campaign.json`; never the open Campaign.
- Permanent delete refused unless the bin just refused that same Campaign (a folder still on disk after the bin answers counts as refusal). Dialog 1 "Supprimer"; dialog 2 gives the reason with "Supprimer définitivement" / "Annuler".
- `SettingsStore.forgetCampaign` drops its last Active Scene.
- Control-only channels `campaigns:deletion-summary`, `campaigns:move-to-trash`, `campaigns:delete-permanently`.
- Tests never touch the real bin: unit tests use a fake trash in temp dirs; app tests replace `shell.trashItem` via `app.evaluate`.

## Export (#60, 2026-11-12, `m4-campaign-themes-qol@9bbfa9a`)

- Dependency `yazl` 3.3.1 (pure JS, named in ADR-0005). `yauzl` not yet installed (#61 adds it).
- Zip opens with `regie-export.json` (format version 1): each document's on-disk `schemaVersion`, each Media file's size. Documents = top-level `*.json` (no `.tmp`/`.bak`); Media = files listed in the Media index (no thumbnails).
- `core/campaignExport.ts` (manifest, entry list, `WriteArchive` type, unit-tested); `electron/zipArchive.ts` writes. Media streamed and stored; documents compressed. Written to a temp file then renamed: failure/cancel leaves nothing.
- Takes an AbortSignal and a byte progress callback (UI passes neither yet; #63).
- Channel `campaigns:export` `{ id }`; refuses the open Campaign; a document without `schemaVersion` stops export with a French message.
- Save dialog: Documents, "<name> – <date>.zip", Windows-forbidden chars → `_`. Notice counts missing Media left out.
- Not tested: a Campaign larger than memory (8 MB streamed in unit test). `tests/zipEntries.ts` is a test-only zip reader; swap for yauzl.

## Import (#61, 2026-11-12, `m4-campaign-themes-qol@ff3bb76`)

- Supersedes the #60 note "yauzl not yet installed": `yauzl` 3.4.0 (+ `@types/yauzl` 3.4.0); `tests/zipEntries.ts` reads with it; `tests/rawZip.ts` builds hostile zips byte by byte.
- Checks: manifest first, known format version. Entry kept only if its exact path is in the manifest; manifest paths are known documents or `media/<sha256><allowlisted ext>` (the allowlist is the zip-slip defence; yauzl `strictFileNames` also refuses `..`, absolute, backslash). Links, encrypted entries, case-insensitive duplicates refused.
- Bombs: streamed sizes must equal the manifest's; Media hash must match its name; caps on entry count, manifest and documents; total ≤ 50× zip size + 16 MiB, checked before unpacking.
- Documents: newer `schemaVersion` or unknown document refused ("from a newer version"); older migrated and saved at current version.
- Staging `<root>/imports/`, renamed atomically to a new id, never over an existing folder; failure/cancel removes it; main clears leftovers at startup. AbortSignal + Media-byte progress ready for #63.
- Choices: name clash check ignores case; a Media in the manifest but absent from the zip is allowed (shows missing). Highlight: outline + "Importée" badge, not saved.
- Hooks: #62 reuses `importCampaign` with `openZipArchive(path)` after main checks the dropped path. Gaps: no free-disk-space check; older-version migration covered by unit tests only.

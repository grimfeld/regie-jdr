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

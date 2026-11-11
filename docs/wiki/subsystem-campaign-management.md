# Subsystem: Campaign management (delete, Export, Import)

## Delete a Campaign (#59, 2026-11-12, `m4-campaign-themes-qol@7b57fe0`)

- `core/campaignDeletion.ts` behind a `Trash` interface; main implements it with `shell.trashItem`.
- Main checks: valid Campaign id; a real folder (no links/junctions) directly in the campaigns folder (realpaths compared) with a readable `campaign.json`; never the open Campaign.
- Permanent delete refused unless the bin just refused that same Campaign (a folder still on disk after the bin answers counts as refusal). Dialog 1 "Supprimer"; dialog 2 gives the reason with "Supprimer définitivement" / "Annuler".
- `SettingsStore.forgetCampaign` drops its last Active Scene.
- Control-only channels `campaigns:deletion-summary`, `campaigns:move-to-trash`, `campaigns:delete-permanently`.
- Tests never touch the real bin: unit tests use a fake trash in temp dirs; app tests replace `shell.trashItem` via `app.evaluate`.

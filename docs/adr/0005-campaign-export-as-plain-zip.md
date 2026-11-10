# Campaign Export is a plain zip; Import always creates a new Campaign; delete goes to the Recycle Bin

A Campaign Export is an ordinary `.zip` of the Campaign's folder (its versioned JSON documents and Media files, without `.tmp`, `.bak` or thumbnails), named "<Campaign name> – <date>.zip". We chose a plain zip over an app-specific extension because ADR-0001 already makes a Campaign "just its folder": the Game Master can open an Export in Windows Explorer, and nothing new needs to be documented or versioned beyond the documents' own `schemaVersion`. There is no automatic backup; backing up means Exporting.

Import always creates a new Campaign with a new id, adding "(importée)" to the name when it clashes. Because a Campaign's id is its folder name, re-importing an Export of a Campaign that still exists would otherwise collide; offering to replace it was rejected because Import would then become a way to lose work. Restoring from an Export is: Import, check, then delete the old Campaign.

Deleting a Campaign moves its folder to the Windows Recycle Bin (`shell.trashItem`) instead of removing it, so a mistaken delete is recoverable without building a trash screen in the app. If the Recycle Bin is unavailable (network drive, locked file), the app reports it and offers a permanent delete behind a second confirmation; it never falls back to a permanent delete silently.

## Consequences

- Exports can reach gigabytes, so zips are streamed: `yazl` to write, `yauzl` to read (pure JavaScript, no native build, consistent with ADR-0001). Media are stored without recompression; only documents are compressed.
- An Export is untrusted input on Import. It is unpacked into a temporary folder and checked before being moved into place in one step: no entry may escape the folder, Media must pass the import allowlist, documents must parse. A `schemaVersion` newer than the app understands is refused; older ones go through the usual migrations.
- Export and Import show progress and can be cancelled; cancelling leaves no partial zip and no half-imported folder.
- Media missing on disk are left out of an Export with a notice; an imported Campaign whose Media are missing opens normally and shows the missing-Media badge.
- Export and delete are offered only on the Campaign list, so the Campaign is closed and no write can race the copy or the delete.
- Global settings keyed by Campaign (the last Active Scene) are cleaned up on delete; an imported Campaign starts without such entries.

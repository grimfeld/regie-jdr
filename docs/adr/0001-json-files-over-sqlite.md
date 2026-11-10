# JSON files per Campaign instead of SQLite

Metadata (Campaigns, Scenes, Media index, settings) is stored as versioned JSON documents in each Campaign's folder, written atomically (temp file + rename), with Media binaries alongside as content-addressed files. SQLite was the spec's candidate. We chose JSON because the data is small (tens of Scenes, hundreds to low thousands of Media per Campaign), it needs no native module rebuild for Electron packaging, the files are human-readable and recoverable by hand, and exporting or deleting a Campaign is just its folder.

## Consequences

- Each document carries a `schemaVersion` and goes through a migration function on load.
- Persistence sits behind a small repository interface. If library search or tagging at scale outgrows in-memory filtering, moving to SQLite (preferably the built-in `node:sqlite`, avoiding `better-sqlite3` native builds) stays a contained change.

# Windows install checklist

Run on a Windows 11 PC before calling a build good. The installer is unsigned on purpose.

## Get the installer

- From CI: Actions → CI → a run on `main` (or **Run workflow** for any branch) → artifact `windows-installer` → `Regie-JDR-Setup-<version>.exe`.
- Or locally: `npm ci` then `npm run package:win` → `release/Regie-JDR-Setup-<version>.exe`.

## Checklist

1. **SmartScreen**: run the installer. Windows warns about an unknown publisher; choose "More info" → "Run anyway". Expected once per download.
2. **Install, choose folder**: the installer asks for the install folder. Pick a non-default folder (e.g. `D:\Apps\Regie JDR`) and finish.
3. **Shortcuts**: a "Regie JDR" shortcut is on the desktop and in the Start menu.
4. **Launch**: open it from the Start-menu shortcut. The Control window shows the app interface, not a blank window.
5. **Single instance**: launch it again from the desktop shortcut. No second app opens; the existing Control window comes to the front.
6. **Import an image**: import a PNG or JPEG. It appears in the library and in the preview.
7. **Broadcast window**: open the Broadcast window ("Ouvrir la diffusion"). It opens and shows the on-air content, with no broken images.
8. **Restart**: quit and relaunch. The imported image is still in the library.
9. **No run-as-Node**: in a terminal, `set ELECTRON_RUN_AS_NODE=1` then `"<install folder>\Regie JDR.exe" -e "console.log('node')"`. Nothing is printed: the app opens as normal (close it). The run-as-Node fuse is off.
10. **Uninstall**: Settings → Apps → Regie JDR → Uninstall. The install folder and both shortcuts are gone. (User data in `%APPDATA%\regie-jdr` is kept.)

## Automated or verified elsewhere

- CI builds the installer and fails if the packaged exe still has the run-as-Node fuse on.
- `tests/unit/fuses.test.ts` checks the fuse hook (`build/fuses.mjs`) on a copy of the Electron binary.
- The fuses switched off/on are listed in `build/fuses.mjs`. Debug flags (`--inspect`) and `NODE_OPTIONS` are ignored by the packaged app, so Playwright's Electron launcher cannot drive it; drive the installed app by hand, or attach with `--remote-debugging-port`.

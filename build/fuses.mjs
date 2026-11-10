// electron-builder afterPack hook: flips Electron fuses on the packaged executable.
// Fuses are bits baked into the Electron binary; flipping them closes ways to run
// arbitrary code through the installed app (e.g. ELECTRON_RUN_AS_NODE=1).
// Runs before the NSIS installer is built, so the installer ships the locked-down exe.
import path from 'node:path';
import { FuseV1Options, FuseVersion, flipFuses } from '@electron/fuses';

/** @param {string} exePath path to an Electron executable (packaged app or stock binary) */
export async function lockDownFuses(exePath) {
  await flipFuses(exePath, {
    version: FuseVersion.V1,
    // Fail the build if a future Electron adds a fuse we have not decided on.
    strictlyRequireAllFuses: true,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // electron-builder embeds the app.asar hash in the exe resources on Windows.
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    // Kept on: the app's pages load from file:// (Vite module scripts under dist/).
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
    [FuseV1Options.WasmTrapHandlers]: true,
  });
}

/** @param {import('electron-builder').AfterPackContext} context */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    throw new Error(`fuses hook: unsupported platform ${context.electronPlatformName}`);
  }
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  await lockDownFuses(exe);
}

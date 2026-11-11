# Subsystem: audio engine and mix

Source: #35 agent report, 2026-11-11. True as of `m2-audio-mvp@956ba64`. Design: ADR-0002 (audio plays in the Control window).

- Engine `src/audioEngine.ts` (Web Audio) starts outside React in the Control window, with its own bridge `window.regieAudio` (`getMix`, `onMixChanged`, `report`). Every audio channel is Control-only; the Broadcast window gets no audio data (`onAudioHalt` removed from it). Howler removed.
- Pure mix: `mixOf` in `core/audioMix.ts` (unit-tested). Voices keyed by Media id, each with a target gain; one fade duration per mix. Keying by Media id gives continuity across Activate for free (#38).
- Live audio state: `core/audioOnAir.ts`. Fade timings: `AUDIO_FADE_MS` in `core/fades.ts` (ready for M3 #50). `audioChangeOf(edit)` picks each `SceneEdit`'s fade.
- `SceneEdit` `add-music` (undo-covered). Master volume: `setMasterVolume`, `settings:set-master-volume`; default from `MASTER_VOLUME.default` in `core/audioMix.ts`.
- Media protocol serves byte ranges and CORS headers (`stream`, `corsEnabled`); without CORS Web Audio plays silence.
- "En cours" strip: `src/NowPlaying.tsx`.

## Plug-in points (2026-11-11)

- #36 Music controls: new state in `AudioOnAir`; `mixOf` already plays/pauses/stops current Music. Decide: adding Music to an Active Scene with no current Music is silent until next Activate.
- #37 Ambiences: `mixOf` already plays Ambiences that are on; add cases in `audioChangeOf`.
- #39 Soundboard: pad gain beside voice gains, plus a pad channel in the engine.
- #40 Silence: a flag zeroing targets in `mixOf`.
- #42 missing audio: engine already reports `failed`; leave missing Media out in `audioOf`.
- #36, #37, #39, #40 add controls to `src/NowPlaying.tsx`.

## Ambiences (#37, 2026-11-12, `4e88616`)

- Five `SceneEdit`s: add, remove, on/off, own volume, Scene Ambience level (one undo step each). `audioChangeOf`: on/off and removal fade 1 s, volume short ramp, add silent. Mix unchanged.
- UI `src/SceneAmbienceList.tsx` beside the Music list. Unit tests in `tests/unit/ambiences.test.ts`.
- Gap: volume sliders commit on release and are silent while dragging (no audio transient path yet).

## Soundboard (#39, 2026-11-12, `6b99c61`)

- Per Campaign: `soundboard.json` (document v1) via `core/soundboard.ts`. Outside undo. Only Sound effects become pads (checked in main and UI).
- `core/padVoices.ts`: max 8 pad voices, oldest cut first (`AUDIO_FADE_MS.pad` = 80 ms). Gain = Master × Soundboard level × pad volume, fixed at press. Engine side `src/padPlayer.ts`.
- Control-only channels: `audio:pad-command`, `audio:report-pads`, `soundboard:get`, `soundboard:edit`, `soundboard:press`. `AudioSounding.pads` feeds "En cours". `audio:get-mix` also resets main's pad bookkeeping (engine start/reload).
- #41 hook: `useSoundboard` in `CampaignScreen` (`src/App.tsx`) exposes `pressPosition(n)` (1-based).
- Known gaps: (preload done 2026-11-12, `51acc8d`) Sound effects decode on first press (no preload); level changes don't ramp a sounding pad; deleting a Media removes its pads silently (pads aren't counted as Media users).

## Music controls (#36, 2026-11-12, `5a330db`)

- Decision: adding Music to an Active Scene with no current Music is silent (added sounds never start themselves, like a new Ambience). Play with no current Music starts the Scene's first Music.
- Pause/resume and stop live only on the "En cours" strip. Removing the current Music stops it with the 0.3 s pause fade.
- Music level slider "Niveau" (`src/LevelSlider.tsx`) is heard while dragging; #37's `VolumeSlider` is not. Merge them once Ambience edits get live updates.

## Missing audio (#42, 2026-11-12, `13a1384`)

- A sound is missing when its address answers 404 (same check as images, M0 #13). On-air commands check on Activate and every Active Scene change; missing sounds are left out of the mix (`AudioMix.missing` always set; `MixInput.missing` optional; sounding state can be `missing`).
- One notice per missing or engine-`failed` sound, raised from the "En cours" strip (moved there so #39's Soundboard didn't duplicate it).
- Badges via `MissingMediaBadge` / `useMissingMedia` (`src/MissingMedia.tsx`) in library, Music/Ambience lists, pads; re-checked on change and window focus. New list views reuse them.
- Gaps: pressing a pad whose file is missing gives no notice. #36's level drag checks for missing files on every live update (watch cost).

## Silence (#40, 2026-11-12, `310287b`)

- Supersedes the #40 plug-in note: Silence is `MixInput.silence` (optional), not an `AudioOnAir` state field. In `mixOf` it sets every voice to gain 0 and paused, so lifting it restores the same mix with Music where it was.
- Starting Silence cuts sounding pads (`padVoices.clear('silence')`); pads pressed during Silence play normally. Activate and `clear()` lift it; never saved.
- State reaches the strip as `AudioSounding.silence` (Broadcast gets nothing). Control-only `audio:set-silence` / `ControlBridge.setSilence`.
- #41 hook (superseded 2026-11-12, `51acc8d`: use `toggleSilence` from `src/NowPlaying.tsx`): `setSilence(control, on)` exported from `src/NowPlaying.tsx`; current state `useSounding(control)?.silence`.
- During Silence the strip labels voices "silence" and hides pause/stop. Gap: a track or Ambience started during Silence shows "silence", not loading.

## Activate fades and continuity (#38, 2026-11-12, `1808490`)

- Continuity, the 1.5 s Activate fade and starting from the first Music already came from the #35 design; #38 pinned them with `tests/unit/activateAudio.test.ts` and a whole-app test in `tests/app/ambiences.spec.ts` (shared Ambience stays "playing" through Activate; proven to fail if voices are recreated).
- Engine (`6227c0f`): a new voice waits for its first `playing` event before fading in, so loading no longer eats the fade.
- Known issue: playback uses `<audio loop>`, which is not gapless and fires `waiting` at each loop. Short loops flicker "chargement…" in the strip and may leave an audible gap. App tests use 30 s tones to avoid it.

## Listening (#43, 2026-11-12)

- ADR-0002 branch: no private listening. "Écouter" on each library sound is enabled only while `listeningAllowed(sounding)` (`core/audioMix.ts`): Silence on, no voice `playing`, no pad. A warning "Écoute audible par les joueurs" shows while allowed. Missing files: disabled.
- `useListening` (`src/Listening.tsx`) plays through its own hidden `<audio class="listening-player">`, not the engine: mix, Scene and "En cours" untouched; it stops when the rule stops holding (Silence lifted, Activate, pad).
- Gaps: the "En cours" strip does not list a sound being listened to; listening plays at full element volume, not the Master volume. Manual Discord check (acceptance criterion) still to do by hand.

## Gapless loops (2026-11-12, `f9f5dc9`)

- Supersedes the "Known issue" in the #38 section above. Sounds of 60 s or less are decoded and looped by an `AudioBufferSourceNode` (seamless; pause keeps position). Longer ones stream via `<audio loop>`; a `waiting` during that loop restart is no longer shown as "chargement…" (the engine never seeks).
- 60 s threshold: ~23 MB per decoded stereo minute at 48 kHz; Web Audio spec and MDN advise streaming beyond about a minute.
- Test: 2 s Music and Ambience play 7 s and the strip shows only "playing" (`tests/app/ambiences.spec.ts`).
- Open: audible seam on long streamed loops (manual check); no automated test of resume position for short sounds.

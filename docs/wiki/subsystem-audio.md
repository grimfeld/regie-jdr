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
- Known gaps: Sound effects decode on first press (no preload); level changes don't ramp a sounding pad; deleting a Media removes its pads silently (pads aren't counted as Media users).

## Music controls (#36, 2026-11-12, `5a330db`)

- Decision: adding Music to an Active Scene with no current Music is silent (added sounds never start themselves, like a new Ambience). Play with no current Music starts the Scene's first Music.
- Pause/resume and stop live only on the "En cours" strip. Removing the current Music stops it with the 0.3 s pause fade.
- Music level slider "Niveau" (`src/LevelSlider.tsx`) is heard while dragging; #37's `VolumeSlider` is not. Merge them once Ambience edits get live updates.

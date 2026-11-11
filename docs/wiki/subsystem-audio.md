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

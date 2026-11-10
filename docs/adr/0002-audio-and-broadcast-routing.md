# Audio plays in the Control window; Discord carries all app audio

When the Game Master shares the Broadcast window on Discord (Applications tab, sound on), Discord carries **every sound Régie JDR plays, from either window**, not only the shared window's. So the audio engine lives in the **Control window**: closing or reloading the Broadcast window must never cut the music, and the choice of window makes no difference to what players hear. Decided from the Discord spike (#19), run on 2026-11-10 with a second account on a phone as listener; only what was observed is recorded here.

## Observed

Sound (a test tone from each window):

- The listener heard the Broadcast window's tone **and** the Control window's tone, separately and together. The Game Master heard both locally.
- With the Broadcast window closed, re-opened and re-shared, the listener still heard the Control window's tone.
- Stream volume on the phone was "a bit too quiet".
- No echo with the PC microphone muted, nor with it on — but the Game Master wore headphones. **Speakers + open microphone were not tested.**

Picture (same results in all four variants: default, background throttling off, Chromium window-occlusion tracking off, both off):

- Broadcast window fully visible, fully covered by the Control window, half covered by the Control window, half off-screen: the stream kept updating.
- Broadcast window **minimized**, or **covered by another application**: Discord paused the stream (black) **and the sound stopped for the listener**; both recovered by themselves once the window was visible again.

## Consequences

- **No private listening inside the app.** Any sound the app plays reaches players. Pre-listening to a track before playing it to players needs a separate output device; the separate local/broadcast mix (backlog B-02) stays deferred and needs its own justification.
- **No reason to ship the throttling or occlusion switches**: they changed nothing.
- **Broadcast window placement matters for sound, not just picture.** Minimizing it or letting another application cover it silences the players. Covering it with the Control window, or pushing it partly off-screen, is safe. The app should make this hard to get wrong (guidance in the UI, and a warning when the Broadcast window is minimized).
- **Levels:** the app's output may need to run louder by default; each player can also raise the stream volume on their side.
- Still to check later: echo when the Game Master uses speakers with an open microphone.

# Discord and single-monitor test script (issue #19)

This test finds out two things:

1. **Sound:** when you share the Broadcast window on Discord, which sounds from Régie JDR reach your players?
2. **Picture:** does the shared Broadcast window keep moving on stream when you cover it, push it partly off-screen, or minimize it?

You need about 45 minutes. Fill in the results tables at the end, then send them back (paste them into issue #19). Write only what you actually saw and heard.

This is a special test version of the app. It is thrown away afterwards.

---

## What the test version adds

Both windows show a black box with a yellow border, labelled **SPIKE #19**:

- A **START tone / STOP tone** button.
  - In the **Control window** (your Game Master window) the tone is a **low "boop"**, once per second.
  - In the **Broadcast window** the tone is a **high "bip-bip"**, once per second.
  - So you can always tell by ear which window a sound comes from.
- A **clock with tenths of a second**, a **frame counter**, and a **yellow bar** sliding left to right. In the Broadcast window they are big. If the clock stops on the phone, the stream is frozen.
- A line at the bottom saying which settings are on:
  - `Broadcast window background throttling: normal` or `DISABLED`
  - `Window occlusion tracking: normal` or `DISABLED`

  Always check this line matches the variant you meant to launch.

## The four variants

You run the same picture tests four times, once per variant. Only these two settings change:

| Variant | Background throttling (Broadcast window) | Window occlusion tracking |
| ------- | ---------------------------------------- | ------------------------- |
| **A**   | normal                                   | normal                    |
| **B**   | DISABLED                                 | normal                    |
| **C**   | normal                                   | DISABLED                  |
| **D**   | DISABLED                                 | DISABLED                  |

"Background throttling" is Chromium slowing down windows it thinks you are not looking at. "Window occlusion tracking" is Windows telling Chromium a window is hidden behind another one, so it can stop drawing it.

---

## Setup (once)

### On the PC

1. Open **PowerShell** (or Windows Terminal) in the `regie-jdr` folder.
2. Get the test version and build it:

   ```
   git fetch
   git checkout spike-19-discord
   npm ci
   npm run build
   ```

3. Close any other copy of Régie JDR. Only one copy must run at a time during the test.

### How to launch each variant

From the same PowerShell window, in the `regie-jdr` folder:

| Variant | Command              |
| ------- | -------------------- |
| A       | `npm run spike:a`    |
| B       | `npm run spike:b`    |
| C       | `npm run spike:c`    |
| D       | `npm run spike:d`    |

To switch variant: close the app completely (close both windows; the command in PowerShell ends), then run the next command.

<details>
<summary>Other ways to launch (only if the commands above do not work)</summary>

The same switches can be passed directly:

```
npx electron . --no-throttle                  # variant B
npx electron . --no-occlusion                 # variant C
npx electron . --no-throttle --no-occlusion   # variant D
```

Or with environment variables in PowerShell (they stay set until you close that PowerShell window):

```
$env:REGIE_SPIKE_NO_THROTTLE = "1"
$env:REGIE_SPIKE_NO_OCCLUSION = "1"
npm start
```

In `cmd.exe` use `set REGIE_SPIKE_NO_THROTTLE=1` instead. Remove them afterwards with `Remove-Item Env:REGIE_SPIKE_*`.

</details>

### Discord

1. **Two Discord accounts:**
   - Your normal account on the **PC** (the one that shares).
   - A second account on your **phone** (the listener, playing the role of a player).
2. Both join the **same voice channel** on a server where you can stream.
3. **Phone:** turn its microphone **off** (mute). Put the phone volume up. Ideally use headphones on the phone, or put it far enough from the PC speakers that you do not confuse the two.
4. **PC:** mute your Discord microphone for now (we test echo separately in step 7).
5. **PC:** in Discord, Settings → Voice & Video, note your output device (speakers or headset).

### Sharing the Broadcast window

Do this each time you launch a variant:

1. Launch the variant. In the Control window click **Ouvrir la diffusion** to open the Broadcast window.
2. Place the windows side by side on your single monitor: Control window on the left, Broadcast window on the right, about one third of the screen wide, fully visible.
3. In Discord on the PC, click the **Share your screen** button (screen icon near your name, or "Go Live").
4. Choose the **Applications** tab (not "Screens"), and pick the window titled **Régie JDR — Diffusion**.
5. Make sure **Sound** is turned **on** in the share options. Click **Go Live**.
6. On the phone, tap your stream to watch it. You should see the big clock moving.

---

## Test steps

### Part 1: sound (variant A only)

Launch **variant A**, open the Broadcast window and share it as above. Both tones are stopped at the start.

1. **Broadcast tone.** In the **Broadcast** window click **START tone** (high "bip-bip"). Wait 10 seconds.
   - Does the phone play the bip-bip? Is it clean, choppy, or delayed?
   - Do you hear the bip-bip on the PC (speakers/headset)?
   - Click **STOP tone** in the Broadcast window.
2. **Control tone.** In the **Control** window click **START tone** (low "boop"). Wait 10 seconds.
   - Does the phone play the boop?
   - Do you hear the boop on the PC?
   - Click **STOP tone** in the Control window.
3. **Both together.** Start both tones. On the phone, can you hear both the boop and the bip-bip? Stop both.
4. **Broadcast window closed.** Start the Control tone, then close the Broadcast window (the stream stops on the phone, that is expected). Re-open it with **Ouvrir la diffusion** and share it again. Does the phone hear the boop? Stop the tone.
5. **Discord volume.** Note whether the stream sound on the phone seemed loud enough compared with the voice volume.
6. **Echo check, part 1 (mic muted).** With your PC mic still muted, start the Broadcast tone. On the phone, do you hear the bip-bip **once** per second (clean) or **twice / with an echo**? Stop the tone.
7. **Echo check, part 2 (mic on).** Unmute your PC Discord microphone. If you use speakers, keep them on (this is the realistic case). Start the Broadcast tone. On the phone, do you now hear an echo or a doubled sound (the tone through the stream **and** through your microphone)? Mute your mic again and stop the tone.

### Part 2: picture (all four variants)

For **each variant A, B, C, D**: launch it, check the settings line on the Broadcast window matches the variant, share the Broadcast window, start the **Broadcast tone**, and watch the clock **on the phone** during each step. Hold each step for at least **15 seconds**.

For every step, write one of these:

- **OK**: the clock keeps moving smoothly on the phone.
- **Slow**: it moves but jumps / stutters (roughly how often it updates, e.g. "once per second").
- **Frozen**: the picture stops (note whether it recovers on its own after you undo the step).
- **Black / gone**: the stream shows black, or Discord stops/pauses the share.

Also note whether the **bip-bip keeps playing** on the phone during that step.

8. **Baseline.** Both windows side by side, fully visible. Expect OK.
9. **Fully covered.** Click on the Control window and maximize it (or drag it) so it covers the whole Broadcast window. Work in the Control window: type something in the scene title.
10. **Partly covered.** Restore the Control window so it covers about half of the Broadcast window.
11. **Partly off-screen.** Drag the Broadcast window so about half of it is past the right edge of the screen.
12. **Minimized.** Minimize the Broadcast window (the `_` button). Wait 15 seconds, then restore it and note whether the stream comes back by itself.
13. **Another app on top.** Put a different app (for example a browser) over the Broadcast window, fully covering it.

Then stop the tone, stop sharing, and close the app before launching the next variant.

---

## Results

Fill in each cell. If something was not tested, write "not tested". Add any comment you like.

### About the test

| Item                                | Value |
| ----------------------------------- | ----- |
| Date                                |       |
| Windows version (Settings → System → About) |       |
| Discord version on PC (Settings, bottom of the left menu) |       |
| Phone (model / Android or iOS)      |       |
| PC audio output (speakers / headset) |       |
| Monitor resolution                  |       |

### Sound (variant A)

| Step | Question                                                           | Answer (yes / no / comment) |
| ---- | ------------------------------------------------------------------ | --------------------------- |
| 1    | Listener (phone) hears the **Broadcast** tone (bip-bip)            |                             |
| 1    | Game Master hears the **Broadcast** tone locally on the PC         |                             |
| 2    | Listener (phone) hears the **Control** tone (boop)                 |                             |
| 2    | Game Master hears the **Control** tone locally on the PC           |                             |
| 3    | Listener hears both tones together                                 |                             |
| 4    | Listener hears the Control tone after the Broadcast window was closed and re-shared |              |
| 5    | Stream sound volume on the phone (too quiet / fine / too loud)     |                             |
| 6    | Echo or doubled sound on the phone, PC mic **muted**               |                             |
| 7    | Echo or doubled sound on the phone, PC mic **on**                  |                             |

Optional: repeat steps 1 and 2 quickly in variant D and note here if anything differs:

### Picture: does the stream keep updating?

Write OK / Slow / Frozen / Black, and "tone: yes/no" for whether the bip-bip still reaches the phone.

| Step | Situation                         | A (normal / normal) | B (throttling off) | C (occlusion off) | D (both off) |
| ---- | --------------------------------- | ------------------- | ------------------ | ----------------- | ------------ |
| 8    | Fully visible (baseline)          |                     |                    |                   |              |
| 9    | Fully covered by Control window   |                     |                    |                   |              |
| 10   | Partly covered by Control window  |                     |                    |                   |              |
| 11   | Partly off-screen                 |                     |                    |                   |              |
| 12   | Minimized                         |                     |                    |                   |              |
| 12   | Comes back by itself after restore |                    |                    |                   |              |
| 13   | Covered by another app            |                     |                    |                   |              |

### Anything else

Note anything surprising: Discord warnings, the Broadcast window missing from the Applications list, the share stopping on its own, sound cutting out, the app slowing down, etc.

---

Only what is written in these tables will be recorded. Nothing beyond it will be claimed about Discord.

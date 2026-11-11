# A fixed 16:9 canvas, one renderer, and a broadcast projection

Every Scene is composed on a fixed logical 16:9 canvas (1920×1080 units), and every position and size in a Scene is stored as a fraction of that canvas, never in pixels. One renderer (`src/SceneCanvas.tsx`) draws a picture onto that canvas, scaled to its container and letterboxed with black bars; the editor, the On-air monitor and the Broadcast window all use it, so the Game Master's view and the players' view cannot drift apart when the windows have different shapes. The layout math (letterboxing, Cover/Contain with zoom and focal point, Overlay size from the image's proportions, window points back to canvas fractions) is one pure function, `layOutCanvas` in `core/canvas.ts`, with no DOM or Electron dependency, so it is unit tested in Node. The renderer is DOM plus CSS (transform and opacity), not canvas or WebGL: it keeps images decoded by the browser, text crisp, and fades cheap.

The Broadcast window never receives a Scene. The main process sends it the **broadcast projection** of the Active Scene (`onAirSceneOf` in `core/onAir.ts`): visible Backgrounds and Overlays only, visible Labels only, the Scene title when set, Media addresses, and the Blackout flag. Hidden placements, notes, Scene names and Media names are removed before anything leaves the main process, so nothing hidden can leak through a glitch, the DevTools or a capture tool.

## Consequences

- Scene edits are commands (`SceneEdit` in `shared/contract.ts`) applied by the app core (`editScene` in `core/onAirCommands.ts`), not whole Scenes sent by a window. Applying one is pure and returns a new Scene, so an undo history can keep the Scene before each edit.
- Aspect ratios other than 16:9 are out of scope; supporting one later means a canvas size per Campaign, not a change to stored Scenes.
- The renderer needs each image's natural size before placing it, so an image takes its place only once loaded; this also means players never see a half-drawn frame.

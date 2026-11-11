/**
 * Domain types shared by the main process, both preload bridges and the interface.
 * Terms follow GLOSSARY.md. Types only: this file has no runtime code.
 */

export type CampaignId = string;
export type MediaId = string;
export type SceneId = string;

/** Interface theme, chosen globally (home page) and per Campaign. */
export type ThemeId = 'retro' | 'imperium' | 'fantasy';

/** ISO 8601 date-time string. */
export type Timestamp = string;

/** An independent collection of Scenes and Media belonging to one game. */
export interface Campaign {
  id: CampaignId;
  name: string;
  theme: ThemeId;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** How the Game Master intends to use an image. Changeable; never restricts placement. */
export type ImageCategory = 'scenery' | 'character';

/**
 * Role of an audio Media, fixed at import: Music (the looping atmosphere track, one at a time),
 * Sound effect (played once, on demand, never loops) or Ambience (looping background sound,
 * several can play together).
 */
export type AudioRole = 'music' | 'soundEffect' | 'ambience';

interface MediaBase {
  id: MediaId;
  campaignId: CampaignId;
  /** SHA-256 of the file content (hex). The stored file is named `<contentHash><extension>`. */
  contentHash: string;
  /** File name at import, without extension. Never changes. */
  originalName: string;
  /** Name shown in the library; the Game Master can change it. Initially `originalName`. */
  name: string;
  /** Lower-case, with the dot: `.png`. */
  extension: string;
}

export interface ImageMedia extends MediaBase {
  kind: 'image';
  category: ImageCategory;
}

export interface AudioMedia extends MediaBase {
  kind: 'audio';
  role: AudioRole;
  /** Length in seconds, read from the file at import; null when it could not be read. */
  durationSeconds: number | null;
}

/** A user-imported image or audio file kept in a Campaign's library. */
export type Media = ImageMedia | AudioMedia;

/** A point on the canvas, normalized: 0..1 on both axes, origin top-left. */
export interface NormalizedPoint {
  x: number;
  y: number;
}

/** Cover fills the canvas, cropping the image; Contain shows the whole image. */
export type BackgroundFit = 'cover' | 'contain';

/**
 * A full-canvas placement of an image Media, below every Overlay. Placements are stored as
 * fractions of the canvas, never pixels (core/canvas.ts lays them out).
 */
export interface Background {
  id: string;
  mediaId: MediaId;
  fit: BackgroundFit;
  /** 1 = the fitted size; above 1 zooms in. */
  zoom: number;
  /**
   * Focal point, for panning: which part of the image shows where it is larger than the canvas.
   * 0 aligns its left (top) edge with the canvas's, 1 its right (bottom) edge, 0.5 centres it.
   */
  focus: NormalizedPoint;
  visible: boolean;
}

/** A player-facing name plate on an Overlay, shown or hidden independently of it. */
export interface Label {
  text: string;
  visible: boolean;
}

/** A freely positioned and sized placement of an image Media, above every Background. */
export interface Overlay {
  id: string;
  mediaId: MediaId;
  /** Centre of the Overlay on the canvas. */
  position: NormalizedPoint;
  /** Height as a fraction of the canvas height; the width follows the image's proportions. */
  height: number;
  visible: boolean;
  label?: Label;
}

/** An Ambience listed on a Scene, switched on or off independently of the others. */
export interface SceneAmbience {
  mediaId: MediaId;
  /**
   * Whether it plays while the Scene is active; all that are on play together, looping. An
   * Ambience added to a Scene starts off.
   */
  on: boolean;
  /** 0..1 */
  volume: number;
}

/** Levels of a Scene, 0..1: its Music level and its Ambience level. */
export interface SceneVolumes {
  music: number;
  ambience: number;
}

/** A reusable, saved audiovisual setup in a Campaign. */
export interface Scene {
  id: SceneId;
  campaignId: CampaignId;
  /** Private to the Game Master, like the notes. */
  name: string;
  /** Player-facing Scene title, shown discreetly on the broadcast; '' for none. */
  title: string;
  /** Stacked bottom to top. */
  backgrounds: Background[];
  /** Stacked bottom to top, all above every Background. */
  overlays: Overlay[];
  /** Music Media, in order. One plays at a time, looping; the first starts on Activate. */
  music: MediaId[];
  ambiences: SceneAmbience[];
  volumes: SceneVolumes;
  /** Private to the Game Master: never shown in the Broadcast window. */
  notes: string;
}

/** One pad of a Soundboard, triggering a Sound effect once (pads never loop). */
export interface SoundboardPad {
  id: string;
  mediaId: MediaId;
  /** The name the pad shows; absent: the Sound effect's name. */
  label?: string;
  /** 0..1 */
  volume: number;
}

/** A Campaign's set of pads for triggering Sound effects, whichever Scene is active. */
export interface Soundboard {
  campaignId: CampaignId;
  /** In the Game Master's order; keys 1 to 9 trigger the first nine. */
  pads: SoundboardPad[];
  /** The Soundboard level, 0..1, applied to every pad. */
  volume: number;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Global settings, kept across restarts. */
export interface Settings {
  /** Theme of the Campaign list home page. */
  theme: ThemeId;
  windowBounds: {
    control?: WindowBounds;
    broadcast?: WindowBounds;
  };
  /** For highlighting only: nothing goes on air on restart. */
  lastActiveSceneByCampaign: Record<CampaignId, SceneId>;
  /**
   * How long showing, hiding and changing a placement, a Label or the Scene title takes, and
   * Blackout, in milliseconds (bounds in core/fades.ts). One setting for the whole app.
   */
  fadeDurationMs: number;
  /** The Master volume, 0..1, applied to all app audio. */
  masterVolume: number;
}

/** A visible Background as the Broadcast window draws it. */
export interface OnAirBackground {
  id: string;
  /** Media address (`regie-media:`). */
  src: string;
  fit: BackgroundFit;
  zoom: number;
  focus: NormalizedPoint;
}

/** A visible Overlay as the Broadcast window draws it. */
export interface OnAirOverlay {
  id: string;
  /** Media address (`regie-media:`). */
  src: string;
  position: NormalizedPoint;
  height: number;
  /** The Label's text, only when the Label is shown. */
  label?: string;
}

/**
 * The broadcast projection of the Active Scene: what players see of it, and nothing else. Its
 * visible Backgrounds and Overlays (bottom to top) with their Media addresses, visible Labels,
 * and the Scene title when set. Hidden placements and Labels, the Scene's name, its notes and
 * Media names never reach the Broadcast window.
 */
export interface OnAirScene {
  backgrounds: OnAirBackground[];
  overlays: OnAirOverlay[];
  /** Absent when the Scene has no Scene title. */
  title?: string;
}

/** What is on air, owned by the main process. `version` increases on every change. */
export interface OnAirState {
  campaignId: CampaignId | null;
  activeSceneId: SceneId | null;
  /** The Active Scene's broadcast projection; null when no Scene is active. */
  scene: OnAirScene | null;
  /**
   * Blackout: the broadcast is faded to black, leaving the Active Scene unchanged. Not part of
   * any Scene, never saved; cleared when a Campaign is opened, switched or closed.
   */
  blackout: boolean;
  /**
   * The fade duration setting (Settings.fadeDurationMs), so every renderer fades alike: the
   * Broadcast window reads no Settings.
   */
  fadeDurationMs: number;
  version: number;
}

/**
 * What the current Music of the Active Scene is doing. Stopped: no Music sounds, the Scene's
 * Ambiences play on.
 */
export type MusicPlayback = 'playing' | 'paused' | 'stopped';

/**
 * The audio part of the on-air state, owned by the main process beside OnAirState and never
 * sent to the Broadcast window. Never saved: cleared when a Campaign is opened, switched or
 * closed, and after a restart. Ambience on/off comes from the Active Scene itself.
 */
export interface AudioOnAirState {
  /**
   * The current Music: an entry of the Active Scene's Music list, or null for none. `take`
   * counts its starts over (AudioVoice `take`).
   */
  music: { mediaId: MediaId; playback: MusicPlayback; take: number } | null;
}

/**
 * One long-running sound of the mix: the current Music or a switched-on Ambience, always
 * looping. A voice is known by its Media: a Media in both the old and the new mix keeps
 * playing and only changes level.
 */
export interface AudioVoice {
  mediaId: MediaId;
  role: 'music' | 'ambience';
  /** The Media's name, for the Control window's "En cours" strip. */
  name: string;
  /** Media address (`regie-media:`). */
  src: string;
  /** Target level, 0..1, Master volume included. */
  gain: number;
  /** False: paused, keeping its position, so it resumes where it was. */
  playing: boolean;
  /**
   * Which start of the sound this is. The engine keeps a voice while both its Media and its
   * take stay the same; a new take starts the sound over from its beginning (a paused Music
   * Activated again, #38).
   */
  take: number;
}

/**
 * The mix: every voice that should be sounding, with its target level, and how long the
 * engine takes to get there (fading in new voices, ramping changed ones, fading out voices
 * that left). Computed by the app core (core/audioMix.ts), applied by the audio engine in the
 * Control window (ADR-0002). `version` increases on every change, like OnAirState's.
 */
export interface AudioMix {
  voices: AudioVoice[];
  /**
   * Voices left out because their Media's file is missing (deleted or moved outside the app,
   * its address answers 404): never played, shown as missing so the Game Master knows.
   */
  missing: MissingVoice[];
  fadeMs: number;
  version: number;
}

/** A voice the mix would play but leaves out: its Media's file is missing. */
export type MissingVoice = Pick<AudioVoice, 'mediaId' | 'role' | 'name'>;

/** What the audio engine says a voice is doing: what is actually sounding, not what was asked. */
export type VoiceState = 'loading' | 'playing' | 'paused' | 'failed';

/** A voice's state in the "En cours" strip: as the engine reports it, or missing (never played). */
export type SoundingState = VoiceState | 'missing';

/** The audio engine's report: the state of each voice it holds. */
export interface AudioEngineReport {
  voices: { mediaId: MediaId; state: VoiceState }[];
}

/** A voice of the mix with what the engine reports of it, for the "En cours" strip. */
export interface SoundingVoice {
  mediaId: MediaId;
  role: AudioVoice['role'];
  name: string;
  /** Loading until the engine reports it; missing when its file is (AudioMix `missing`). */
  state: SoundingState;
}

/**
 * What is sounding, as the "En cours" strip shows it: the mix as the engine last reported it,
 * the Soundboard pads the engine reports playing, and whether Silence is on.
 */
export interface AudioSounding {
  voices: SoundingVoice[];
  pads: SoundingPad[];
  /**
   * Silence: all audio faded out, the mix kept to come back when it is lifted. On air only,
   * never saved; audio only, apart from Blackout (picture only).
   */
  silence: boolean;
}

/**
 * A pad sound: one press of a Soundboard pad, playing its Sound effect once. Pressing a pad
 * that still sounds starts another, overlapping one. Numbered by the main process, in press
 * order.
 */
export type PadVoiceId = number;

/**
 * What the main process tells the audio engine about pad sounds (core/padVoices.ts): play one
 * at `gain` (Master volume included), or cut some with a short fade.
 */
export type PadCommand =
  | { kind: 'play'; voiceId: PadVoiceId; src: string; gain: number }
  | { kind: 'cut'; voiceIds: PadVoiceId[]; fadeMs: number };

/**
 * The audio engine's report on pad sounds: the state of each it holds, and the last pad sound
 * it was told to play. A pad sound up to that one that it no longer holds has ended.
 */
export interface PadReport {
  voices: { voiceId: PadVoiceId; state: VoiceState }[];
  upTo: PadVoiceId;
}

/** A Soundboard pad the engine reports sounding (at least one of its pad sounds playing). */
export interface SoundingPad {
  padId: string;
  /** The pad's name, for the "En cours" strip. */
  name: string;
}

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

/** Role of an audio Media, fixed at import. */
export type AudioRole = 'music' | 'soundEffect';

interface MediaBase {
  id: MediaId;
  campaignId: CampaignId;
  /** SHA-256 of the file content (hex). The stored file is named `<contentHash><extension>`. */
  contentHash: string;
  /** File name at import, without extension. */
  originalName: string;
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
}

/** A user-imported image or audio file kept in a Campaign's library. */
export type Media = ImageMedia | AudioMedia;

/** A point on the canvas, normalized: 0..1 on both axes, origin top-left. */
export interface NormalizedPoint {
  x: number;
  y: number;
}

export type BackgroundFit = 'cover' | 'contain' | 'stretch';

/** A full-canvas placement of an image Media, below every Overlay. */
export interface Background {
  id: string;
  mediaId: MediaId;
  fit: BackgroundFit;
  /** Focal point of the image inside the canvas. */
  position: NormalizedPoint;
  visible: boolean;
}

/** A freely positioned and sized placement of an image Media, above every Background. */
export interface Overlay {
  id: string;
  mediaId: MediaId;
  /** Centre of the Overlay on the canvas. */
  position: NormalizedPoint;
  /** 1 = natural size relative to the canvas height. */
  scale: number;
  /** Stacking order among Overlays: higher is in front. */
  zIndex: number;
  visible: boolean;
  label?: string;
}

/** A Sound effect that loops while its Scene is active. */
export interface LoopingSoundEffect {
  mediaId: MediaId;
  /** 0..1 */
  volume: number;
}

/** Volumes of a Scene, 0..1. */
export interface SceneVolumes {
  music: number;
  soundEffects: number;
}

/** A reusable, saved audiovisual setup in a Campaign. */
export interface Scene {
  id: SceneId;
  campaignId: CampaignId;
  name: string;
  /** Stacked bottom to top. */
  backgrounds: Background[];
  overlays: Overlay[];
  /** Music Media, in order. One plays at a time, looping; the first starts on Activate. */
  music: MediaId[];
  soundEffects: LoopingSoundEffect[];
  volumes: SceneVolumes;
  /** Private to the Game Master: never shown in the Broadcast window. */
  notes: string;
}

/** One pad of a Soundboard, triggering a Sound effect. */
export interface SoundboardPad {
  id: string;
  mediaId: MediaId;
  label?: string;
  loop: boolean;
  /** 0..1 */
  volume: number;
}

/** A Campaign's set of pads for triggering Sound effects, whichever Scene is active. */
export interface Soundboard {
  campaignId: CampaignId;
  pads: SoundboardPad[];
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
}

/** What is on air, owned by the main process. `version` increases on every change. */
export interface OnAirState {
  campaignId: CampaignId | null;
  activeSceneId: SceneId | null;
  version: number;
}

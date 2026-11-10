# Régie JDR

An audiovisual director's console for a tabletop RPG Game Master: it composes and broadcasts the visual and audio atmosphere of a session. Canonical terms are English; the French label shown in the UI is noted where it differs.

## Windows

**Control window**:
The Game Master's private window, where everything is prepared and operated. Players never see it.
UI: Poste du MJ
_Avoid_: GM window, main window, régie

**Broadcast window**:
The player-facing window, containing only what players are meant to see, and shared to remote players through Discord.
UI: Diffusion
_Avoid_: Stage, stage window, player window

## Organisation

**Campaign**:
An independent collection of Scenes and Media belonging to one game. Nothing is shared between Campaigns.
UI: Campagne
_Avoid_: Profile, project, game

## Media

**Media**:
A user-imported image or audio file kept in a Campaign's library, shown under a name the Game Master can change (initially the original file name).
UI: Médias
_Avoid_: Asset, file, resource

**Image category**:
The label on an image Media saying how the Game Master intends to use it: Scenery, Character or Reference. It filters the library and can be changed at any time; it does not restrict where the image may be placed.
_Avoid_: Image type, kind

**Scenery**:
An image Media categorised as a setting: map, landscape, interior. Usually placed as a Background.
UI: Décors
_Avoid_: Background (that is the placement), backdrop, map, wallpaper

**Character**:
An image Media categorised as a figure to appear over the setting: NPC, ally, enemy, creature. Usually placed as an Overlay.
UI: Personnage
_Avoid_: Token, sprite, portrait, creature

**Reference**:
An image Media categorised as material for the Game Master's eyes: stat block, secret map, screenshot. Usually shown in Notes. Images added through Notes start in this category.
UI: Référence
_Avoid_: Handout (that would be shown to players), attachment, document

**Music**:
An audio Media meant as the atmosphere track. Its role is fixed at import. A Scene may list several; only one plays at a time, looping until switched.
UI: Musique
_Avoid_: Track, song, BGM

**Sound effect**:
An audio Media played once, on demand, over everything else (sword clash, door, scream). Never loops. Its role is fixed at import.
UI: Bruitage
_Avoid_: SFX, sound, one-shot

**Ambience**:
An audio Media meant as a looping background sound under the Music (rain, fire, tavern crowd). A Scene may list several, each switched on or off independently; all that are on play together. Its role is fixed at import.
UI: Ambiance
_Avoid_: Ambient sound, loop, background sound, Sound effect (that is one-shot)

## Scenes

**Scene**:
A reusable, saved audiovisual setup in a Campaign: stacked Backgrounds, Overlays, Music, Ambiences, volumes and private notes.
UI: Scène
_Avoid_: Setup, preset, layout

**Notes**:
The Game Master's private rich text on a Scene, which may include images. Never shown to players.
UI: Notes
_Avoid_: Description, comments, script

**Scene title**:
An optional player-facing title of a Scene, shown discreetly on the broadcast. Separate from the Scene's name, which stays private.
UI: Titre affiché
_Avoid_: Caption, scene name (that is private), heading

**Background**:
A full-canvas placement of an image Media on a Scene, always below every Overlay. A Scene may stack several, each shown or hidden independently.
UI: Arrière-plan
_Avoid_: Backdrop, layer, Scenery (that is the category)

**Overlay**:
One freely positioned and sized placement of an image Media on a Scene, always above every Background, with its own visibility and optional Label. The same Media can be placed as several Overlays.
_Avoid_: Token, layer, instance, figure

**Label**:
A player-facing name plate on an Overlay, shown or hidden independently of the Overlay itself.
UI: Étiquette
_Avoid_: Caption, name, note

**Hidden**:
Said of a Background, Overlay or Label that is placed on a Scene but not shown to players. New placements start Hidden. Hidden content never reaches the Broadcast window.
UI: Masqué
_Avoid_: Invisible, disabled, off

**Active Scene**:
The single Scene currently on air in the Broadcast window. Editing it changes the broadcast immediately and is saved into the Scene; every other Scene is private.
UI: Scène active
_Avoid_: Live scene, current scene, on-air state

**Selected Scene**:
The Scene open in the Control window's editor. It may or may not be the Active Scene; only when it is do its edits go on air.
UI: Scène ouverte
_Avoid_: Current scene, edited scene, draft

**On-air monitor**:
The small read-only view in the Control window showing exactly what the Broadcast window shows.
UI: À l'antenne
_Avoid_: Preview, program monitor

**Blackout**:
A temporary on-air fade to black that hides the Active Scene from players without changing it. Picture only: audio keeps playing. Not saved into any Scene.
UI: Noir
_Avoid_: Fade-to-black, pause, curtain

**Silence**:
A temporary on-air fade-out of all audio, leaving the Active Scene and the picture unchanged. Lifting it brings the same mix back. Not saved into any Scene; Activating a Scene lifts it.
UI: Silence
_Avoid_: Stop all, mute, panic

**Soundboard**:
A Campaign's set of pads for triggering Sound effects during play, available whichever Scene is active, or none.
UI: Table de bruitages
_Avoid_: Sound panel, SFX board, pads

**Activate**:
Put a Scene on air, making it the Active Scene.
UI: Activer
_Avoid_: Take, load, go live, show

**Transition**:
How the picture changes from the outgoing Scene to the incoming one when a Scene is Activated: Crossfade (one dissolves into the other) or Cut (instant).
UI: Transition
_Avoid_: Fade (that is showing or hiding a placement), effect, wipe

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
A user-imported image or audio file kept in a Campaign's library.
UI: Médias
_Avoid_: Asset, file, resource

**Image category**:
The label on an image Media saying how the Game Master intends to use it: Scenery or Character. It filters the library and can be changed at any time; it does not restrict where the image may be placed.
_Avoid_: Image type, kind

**Scenery**:
An image Media categorised as a setting: map, landscape, interior. Usually placed as a Background.
UI: Décors
_Avoid_: Background (that is the placement), backdrop, map, wallpaper

**Character**:
An image Media categorised as a figure to appear over the setting: NPC, ally, enemy, creature. Usually placed as an Overlay.
UI: Personnage
_Avoid_: Token, sprite, portrait, creature

**Music**:
An audio Media meant as the atmosphere track. Its role is fixed at import. A Scene may list several; only one plays at a time, looping until switched.
UI: Musique
_Avoid_: Track, song, BGM

**Sound effect**:
An audio Media meant to be triggered over the music, once or looping (rain, fire, crowd). Its role is fixed at import.
UI: Bruitage
_Avoid_: SFX, sound, ambience, ambient sound

## Scenes

**Scene**:
A reusable, saved audiovisual setup in a Campaign: stacked Backgrounds, Overlays, Music, looping Sound effects, volumes and private notes.
UI: Scène
_Avoid_: Setup, preset, layout

**Background**:
A full-canvas placement of an image Media on a Scene, always below every Overlay. A Scene may stack several, each shown or hidden independently.
UI: Arrière-plan
_Avoid_: Backdrop, layer, Scenery (that is the category)

**Overlay**:
One freely positioned and sized placement of an image Media on a Scene, always above every Background, with its own visibility and optional label. The same Media can be placed as several Overlays.
_Avoid_: Token, layer, instance, figure

**Active Scene**:
The single Scene currently on air in the Broadcast window. Editing it changes the broadcast immediately and is saved into the Scene; every other Scene is private.
UI: Scène active
_Avoid_: Live scene, current scene, on-air state

**Soundboard**:
A Campaign's set of pads for triggering Sound effects during play, available whichever Scene is active.
UI: Table de bruitages
_Avoid_: Sound panel, SFX board, pads

**Activate**:
Put a Scene on air, making it the Active Scene.
UI: Activer
_Avoid_: Take, load, go live, show

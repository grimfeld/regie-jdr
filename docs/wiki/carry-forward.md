# Carry-forward: notes for later milestones

Facts learned in one milestone that a later milestone's agents must know. Each line dated with its source.

## For M2 (#33)

- 2026-11-11 (#32 brief): the "is the user typing" check for shortcuts is meant to be shared; #41 pad/Silence shortcuts should reuse it.

## For M3 (#45)

- 2026-11-11 (#31, `bbd3ac7`): fade timing lives in `core/fades.ts`; the Activate duration setting (#50) goes there. As of `bbd3ac7`, Activating another Scene already dissolves over the M1 fade duration; #48 (Crossfade on Activate) and #49 (Cut) replace that behaviour, and #50 says the M1 show/hide fade setting stays unchanged.
- 2026-11-11 (#32 brief): #56 Scene shortcuts reuse the shared "is the user typing" check.
- 2026-11-11 (#24, `4555b1c`): opening a Campaign already selects the last Active Scene; compare with #55 before building it.

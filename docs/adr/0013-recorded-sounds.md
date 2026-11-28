# ADR 0013: Recorded engine and door sounds

_[Français](0013-recorded-sounds.fr.md)_ · Status: accepted · Date: 2026-11-28

## Context

The first sounds of the game were synthesised with the Web Audio API (#115). Even with diesel
harmonics, detuned voices and a firing beat, the owner found the engine of poor quality, and
agreed to real recordings.

## Decision

- Two recordings of a MAN SG 220 city bus from the Work With Sounds project on Wikimedia
  Commons, CC BY 4.0: the engine (94 s, 0.8 MB) and the doors (20 s, 0.3 MB), kept unchanged as
  Ogg Vorbis in `assets/audio/` with `CREDITS.md`; credited in the READMEs and the menu credits.
- The engine plays the idling part of its recording in a loop (`loopStart`/`loopEnd`), faster
  with the speed and the throttle (`playbackRate`), behind a low-pass filter that opens under
  load. The doors play the opening or closing part of theirs. Where the parts lie in the files is
  in the `audio` group of `game.json`.
- The warning beeps, the stop request bell and the spoken announcement stay synthesised.

## Consequences

- 1.1 MB more for the static site, loaded at the first key press or click.
- Ogg Vorbis is decoded by Chrome, Edge and Firefox; Safari decodes it since version 17.
- The attribution must follow the files wherever the game is published.

## Rejected alternatives

- **Keeping the synthesis**: the owner found it of poor quality.
- **Freesound recordings**: downloads need an account and many are CC BY-NC.
- **Cutting the recordings to the parts played**: no audio tool in the toolchain; the parts are
  chosen by time in the settings instead.

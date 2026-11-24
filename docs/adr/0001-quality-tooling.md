# ADR 0001: Quality tooling for plain JavaScript and the Python data scripts

_[Français](0001-quality-tooling.fr.md)_ · Status: accepted · Date: 2026-11-24

## Context

The game is plain JavaScript ES modules served as static files, with no build step (a
choice already approved for the prototype). The shared conventions list tools for
TypeScript, not for plain JavaScript. The data scripts in `tools/` are Python, standard
library only.

## Decision

- **JavaScript**: Prettier for formatting; the TypeScript compiler in `checkJs` mode,
  `strict`, as a type checker only (`noEmit`), with types written as JSDoc comments;
  Vitest for unit tests. `@types/three` (same version as the vendored Three.js) gives
  the types of the 3D engine. Unit tests cover the pure game logic; rendering and UI
  modules are checked in the browser.
- **Python**: ruff (format and lint, including the `S` security rules), pyright strict,
  pytest with a coverage floor of 80 %, uv for the environment and poe as task runner.
  Pure helpers live in `tools/geo.py`, network and cache access in `tools/sources.py`.
- **Both**: pre-commit hooks (including gitleaks) and a GitHub Actions workflow running the
  same checks.

## Consequences

- No build step and no bundler: the browser still runs the source files as they are.
- Types are checked strictly but live in comments, which makes signatures longer.
- Node.js is needed for development only, not to play.

## Rejected alternatives

- **Converting to TypeScript**: needs a build step (or a dev server) to run the game,
  for little gain over `checkJs`.
- **ESLint**: the type checker and Prettier already catch what matters here; another
  configuration to maintain.
- **Jest**: needs extra setup for native ES modules; Vitest supports them directly.

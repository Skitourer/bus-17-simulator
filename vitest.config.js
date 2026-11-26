// @ts-check
/** Vitest setup: unit tests of the pure game logic (no DOM, no WebGL). */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // the game loads Three.js through an import map; tests use the same vendored file
    alias: { three: '/vendor/three.module.min.js' },
  },
  test: {
    include: ['tests/js/**/*.test.js'],
    coverage: {
      provider: 'v8',
      // pure logic only; rendering and UI modules are checked in the browser
      include: [
        'src/common/service.js',
        'src/common/astro.js',
        'src/common/keys.js',
        'src/i18n/i18n.js',
        'src/world/track.js',
        'src/hd2d/heightfield.js',
        'src/hd2d/drive.js',
        'src/hd2d/trailer.js',
        'src/hd2d/ground.js',
        'src/hd2d/orbit.js',
        'src/hd2d/shore.js',
        'src/hd2d/kerb.js',
        'src/hd2d/roofs.js',
        'src/hd2d/budget.js',
        'src/hd2d/fleet.js',
        'src/hd2d/tiling.js',
        'src/hd2d/daylight.js',
        'src/hd2d/lamps.js',
        'src/hd2d/season.js',
        'src/hd2d/traffic.js',
        'src/hd2d/pedestrians.js',
        'src/hd2d/debug.js',
        'src/hd2d/stops.js',
        'src/hd2d/views.js',
        'src/settings/settings.js',
        'src/settings/preferences.js',
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});

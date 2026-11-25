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
        'src/i18n/i18n.js',
        'src/world/track.js',
        'src/hd2d/heightfield.js',
        'src/hd2d/drive.js',
        'src/hd2d/ground.js',
        'src/hd2d/orbit.js',
        'src/hd2d/shore.js',
        'src/hd2d/debug.js',
        'src/hd2d/stops.js',
        'src/settings/settings.js',
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});

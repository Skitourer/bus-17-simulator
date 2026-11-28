"""Builds every data file of the game in order, with the progress of each step (#131).

Usage:  uv run poe build-data                  (every step)
        uv run poe build-data --from streets   (resume from a step: line, map, terrain, buildings, roads,
                                                streets, landmarks)
Each step is a script of tools/ run on its own; downloads are cached in tools/cache/, so a step run again
only downloads what is missing.
"""

import argparse
import os
import subprocess
import sys
import time

from sources import ROOT, progress_bar

STEPS: tuple[tuple[str, str, str], ...] = (
    ('line', 'build_line.py', 'lignes (GTFS M reso, altitudes IGN)'),
    ('map', 'build_map.py', 'fond de carte (OSM)'),
    ('terrain', 'build_terrain.py', 'relief (IGN RGE ALTI)'),
    ('buildings', 'build_buildings.py', 'batiments et arbres (IGN BD TOPO, OSM)'),
    ('roads', 'build_roads.py', 'graphe routier et feux (OSM)'),
    ('streets', 'build_streets.py', 'tuiles du monde'),
    ('landmarks', 'build_landmarks.py', 'monuments (OSM)'),
)


def steps_from(first: str) -> list[tuple[str, str, str]]:
    """The steps from `first` to the end."""
    names = [name for name, _, _ in STEPS]
    if first not in names:
        raise SystemExit(f'etape inconnue : {first} (etapes : {", ".join(names)})')
    return list(STEPS[names.index(first) :])


def main() -> None:
    parser = argparse.ArgumentParser(description='Builds every data file of the game in order.')
    parser.add_argument('--from', dest='first', default=STEPS[0][0], help='first step to run')
    todo = steps_from(parser.parse_args().first)
    start = time.monotonic()
    for k, (_, script, label) in enumerate(todo):
        print(f'\n=== {progress_bar(k, len(todo))} etape {k + 1}/{len(todo)} : {label} ===', flush=True)
        began = time.monotonic()
        # the scripts are the fixed list STEPS, run with the same interpreter
        command = [sys.executable, '-u', os.path.join(ROOT, 'tools', script)]
        result = subprocess.run(command, check=False)  # noqa: S603
        if result.returncode:
            raise SystemExit(f'echec de {script} : reprendre avec --from {todo[k][0]}')
        print(f'    {script} : {time.monotonic() - began:.0f} s', flush=True)
    print(f'\n=== {progress_bar(1, 1)} donnees a jour en {(time.monotonic() - start) / 60:.0f} min ===')


if __name__ == '__main__':
    main()

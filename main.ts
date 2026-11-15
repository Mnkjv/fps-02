// SABLE PROTOCOL — the make.fun entry program for threejs-fps-02.
//
// The game itself is the game/ folder beside this file: plain static
// files (an index.html, ES modules under src/, and the pinned three.js
// build under vendor/) that any static server can host and any desktop
// browser can play — no build step, no network, no assets to fetch.
// This program's job is only to hand that folder in:
//
//   1. it sanity-checks the hand-in against the scorer's published caps
//      (game file count and bytes, screenshot count and size, the entry
//      index.html present), so a malformed entry fails here, loudly,
//      instead of being scored as a broken game;
//   2. it copies game/ and screenshots/ into the output directory;
//   3. it writes dossier.json with the vendored make.fun library — the
//      document the judge reads: screenshots first, then the source in
//      import order, capped at the dossier's text budget.
//
// Run it the way the harness does, or locally with an output override:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Play the game locally with:  node serve.ts   (then http://localhost:8080)

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's caps, from the kit's reference/gate.json.
const GAME_MAX_FILES = 993;
const GAME_MAX_BYTES = 50331648; // 48 MiB
const SHOT_MAX_COUNT = 4;
const SHOT_MAX_BYTES = 262144; // 256 KiB each

function walk(dir: string, base: string, acc: { files: number; bytes: number }): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      acc.files += 1; // directories count toward the file cap too
      walk(path, base, acc);
    } else {
      acc.files += 1;
      acc.bytes += st.size;
    }
  }
}

function refuse(message: string): never {
  console.error(`sable-protocol: refusing to hand in: ${message}`);
  process.exit(1);
}

const gameDir = join(here, 'game');
if (!existsSync(join(gameDir, 'index.html'))) refuse('game/index.html is missing');
const gameStats = { files: 0, bytes: 0 };
walk(gameDir, gameDir, gameStats);
if (gameStats.files > GAME_MAX_FILES) refuse(`game/ holds ${gameStats.files} entries, over the ${GAME_MAX_FILES} cap`);
if (gameStats.bytes > GAME_MAX_BYTES) refuse(`game/ is ${gameStats.bytes} bytes, over the ${GAME_MAX_BYTES} cap`);

const shotsDir = join(here, 'screenshots');
const shots = existsSync(shotsDir) ? readdirSync(shotsDir).filter((n) => /\.(png|jpe?g)$/i.test(n)) : [];
if (shots.length < 3 || shots.length > SHOT_MAX_COUNT) refuse(`screenshots/ holds ${shots.length} images, need 3 or 4`);
for (const name of shots) {
  const size = statSync(join(shotsDir, name)).size;
  if (size > SHOT_MAX_BYTES) refuse(`screenshots/${name} is ${size} bytes, over the ${SHOT_MAX_BYTES} cap`);
}

mkdirSync(out, { recursive: true });
cpSync(gameDir, join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });

const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: SHOT_MAX_COUNT, max_bytes: SHOT_MAX_BYTES },
  game_max_files: GAME_MAX_FILES,
  game_max_bytes: GAME_MAX_BYTES,
});
writeFileSync(join(out, 'dossier.json'), dossier);
console.log(`sable-protocol: handed in ${gameStats.files} game files (${gameStats.bytes} bytes), ${shots.length} screenshots, dossier ${dossier.length} bytes`);

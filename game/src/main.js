// SABLE PROTOCOL — boot and game loop. A round-based tactical FPS in the
// browser: EMBER (you, attacking) against SABLE (defending), a charge to
// plant on one of two sites, money that carries between rounds, and nine
// bots who play the same rules you do. Everything runs from static files:
// three.js from the vendored copy, sound synthesized live, no network.
//
// The loop advances the match only while the player is actually playing:
// during the live phases that means pointer-locked (a click re-locks);
// during the buy phase the pointer is free for the buy menu. A ?shot=
// mode poses deterministic scenes for the entry screenshots.

import * as THREE from 'three';
import { MATCH } from './config.js';
import { buildWorld } from './world.js';
import { Match } from './match.js';
import { Hud } from './hud.js';
import { initAudio } from './audio.js';
import { makeRng } from './rng.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 320);
scene.add(camera); // the view-model gun is a child of the camera: it only renders if the camera is in the scene
buildWorld(scene);

const match = new Match(scene, camera);
const hud = new Hud(match);
match.player.attachInput(canvas);
// A handle for the browser console and for automated smoke tests: the
// whole match state is inspectable while the game runs.
window.__sable = { match, hud, scene };

const params = new URLSearchParams(window.location.search);
const shotMode = params.get('shot');
if (shotMode) match.rng = makeRng((parseInt(params.get('seed') || '1', 10) || 1) * 7919 + 17);

let playing = false;
let locked = false;
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
});
canvas.addEventListener('click', () => {
  if (playing && !locked && (match.phase === 'live' || match.phase === 'planted')) {
    canvas.requestPointerLock();
  }
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') { e.preventDefault(); hud.setScoreboardVisible(true); }
  if (e.code === 'KeyE') match.playerPlantHeld = true;
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Tab') hud.setScoreboardVisible(false);
  if (e.code === 'KeyE') match.playerPlantHeld = false;
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

document.getElementById('btn-play').addEventListener('click', () => {
  initAudio();
  document.getElementById('menu').style.display = 'none';
  document.getElementById('hud').style.display = 'block';
  playing = true;
  match.startMatch();
});
document.getElementById('btn-again').addEventListener('click', () => {
  document.getElementById('matchover').style.display = 'none';
  match.startMatch();
});
match.onEvent = (type, data) => {
  hud.handleEvent(type, data);
  if (type === 'matchOver') {
    const el = document.getElementById('matchover');
    document.getElementById('matchover-text').textContent =
      data.winner === 'draw' ? `DRAW — ${data.scores.ember} : ${data.scores.sable}`
        : data.winner === 'ember' ? `EMBER TAKES THE FOUNDRY — ${data.scores.ember} : ${data.scores.sable}`
          : `SABLE HOLDS THE FOUNDRY — ${data.scores.ember} : ${data.scores.sable}`;
    el.style.display = 'flex';
    document.exitPointerLock?.();
  }
};

// --- screenshot posing ----------------------------------------------------
// The kit photographs three moments: the buy, the fight, the aftermath.
// Each pose arranges real actors from a real match — nothing here is a
// mock-up, it is the game with its pieces placed.
function poseShot() {
  document.getElementById('menu').style.display = 'none';
  document.getElementById('hud').style.display = 'block';
  playing = true;
  match.startMatch();
  const p = match.player;
  if (shotMode === 'start') {
    hud.setBuyVisible(true);
    p.yaw = 0.72; // across the yard from the EMBER spawn, teammates in frame
    p.pitch = -0.03;
    return;
  }
  match.phase = 'live';
  match.phaseT = 74;
  if (shotMode === 'play' && params.get('free')) {
    // Free-play soak mode: no posing at all — the squads play a genuine
    // round from their spawns under their real orders, watched from the
    // EMBER spawn. Used by the automated end-to-end test.
    match.phaseT = MATCH.roundSeconds;
    return;
  }
  if (shotMode === 'play') {
    // The site A approach fight: the player holds the lane mouth south of
    // the choke container, two EMBER push with them, two SABLE hold the
    // site end of the lane. Everyone is ordered to hold, so the fight
    // happens in frame. (Sight lines verified against the collision map.)
    p.pos.set(-6, 0, -8);
    p.yaw = Math.atan2(-(-16 - p.pos.x), -(-14 - p.pos.z));
    p.pitch = -0.04;
    p.equipPrimary('ar7');
    const [e1, e2] = match.emberBots;
    e1.pos.set(-9, 0, -11); e1.yaw = 1.0; e1.equipPrimary('ar7');
    e2.pos.set(-3, 0, -13); e2.yaw = 1.2; e2.equipPrimary('kestrel');
    const [s1, s2] = match.sableBots;
    s1.pos.set(-16, 0, -14); s1.yaw = -2.1; s1.equipPrimary('ar7'); s1.crouch = true;
    s2.pos.set(-22, 0, -21); s2.yaw = -2.0; s2.equipPrimary('ar7');
    for (const b of [...match.emberBots, ...match.sableBots]) {
      b.order = { kind: 'hold' };
      b.syncFigure();
    }
    return;
  }
  if (shotMode === 'end') {
    match.scores = { ember: 5, sable: 3 };
    match.phase = 'end';
    match.phaseT = 4;
    const fallen = match.sableBots[0];
    fallen.health = 0;
    fallen.alive = false;
    fallen.pos.set(0, 0, -1);
    fallen.syncFigure();
    const mate = match.emberBots[0];
    mate.pos.set(3, 0, 2);
    mate.yaw = -0.4;
    mate.syncFigure();
    p.pos.set(-1.5, 0, 9);
    p.yaw = Math.atan2(-(fallen.pos.x - p.pos.x), -(fallen.pos.z - p.pos.z));
    p.pitch = -0.13;
    p.equipPrimary('ar7');
    hud.announce('ROUND WON by elimination', 'good');
    hud.setScoreboardVisible(true);
  }
}
if (shotMode) poseShot();

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (playing) {
    // The match waits for its player: without pointer lock in a live
    // phase the world holds still instead of playing itself.
    const advance = Boolean(shotMode) || locked
      || match.phase === 'buy' || match.phase === 'end' || match.phase === 'matchover';
    if (advance) match.update(dt);
    else match.player.syncCamera(dt);
    hud.setBuyVisible(match.phase === 'buy' && !shotMode ? true : shotMode === 'start');
    hud.el.lockTip.style.display = (!locked && !shotMode && (match.phase === 'live' || match.phase === 'planted')) ? 'block' : 'none';
    hud.refresh();
  }
  renderer.render(scene, camera);
}
loop();

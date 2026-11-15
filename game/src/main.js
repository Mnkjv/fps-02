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

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 320);
buildWorld(scene);

const match = new Match(scene, camera);
const hud = new Hud(match);
match.player.attachInput(canvas);

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
    p.yaw = 2.6;
    p.pitch = -0.04;
    return;
  }
  match.phase = 'live';
  match.phaseT = 74;
  if (shotMode === 'play') {
    // A lane fight near the furnace: the player holds the corner, two
    // EMBER push, two SABLE hold the far side.
    p.pos.set(-7.5, 0, 3.2);
    p.yaw = Math.atan2(-(2 - p.pos.x), -(-14 - p.pos.z));
    p.pitch = -0.02;
    p.equipPrimary('ar7');
    const [e1, e2] = match.emberBots;
    e1.pos.set(-4.5, 0, 6.5); e1.yaw = 2.6; e1.equipPrimary('ar7');
    e2.pos.set(-10.5, 0, 7.5); e2.yaw = 2.9; e2.equipPrimary('kestrel');
    const [s1, s2] = match.sableBots;
    s1.pos.set(2.5, 0, -13.5); s1.yaw = -0.7; s1.equipPrimary('ar7'); s1.crouch = true;
    s2.pos.set(6.5, 0, -10); s2.yaw = -1.1; s2.equipPrimary('ar7');
    for (const b of [...match.emberBots, ...match.sableBots]) b.syncFigure();
    return;
  }
  if (shotMode === 'end') {
    match.scores = { ember: 5, sable: 3 };
    match.phase = 'end';
    match.phaseT = 4;
    const fallen = match.sableBots[0];
    fallen.health = 0;
    fallen.alive = false;
    fallen.pos.set(-3, 0, -6);
    fallen.syncFigure();
    p.pos.set(-5.5, 0, -2.5);
    p.yaw = Math.atan2(-(fallen.pos.x - p.pos.x), -(fallen.pos.z - p.pos.z));
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

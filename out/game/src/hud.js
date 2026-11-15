// The HUD: everything the player reads while fighting. A top bar with the
// clock and the score, vitals and ammunition bottom-left and bottom-right,
// a killfeed, a live minimap (the Foundry from above, squads as dots, the
// charge as a blinking square), a buy menu for the freeze seconds, a
// scoreboard on Tab, and centre-screen announcements for the moments that
// matter — round start, the plant, the win. All of it is plain DOM over
// the canvas; this module owns the element contract that index.html
// provides.

import { MATCH, WEAPONS, ARMOR_PRICE } from './config.js';
import { BOXES, SITES, WORLD } from './world.js';

const $ = (id) => document.getElementById(id);
const fmt$ = (n) => '$' + n.toLocaleString('en-US');
const fmtClock = (s) => {
  s = Math.max(0, Math.ceil(s));
  return `${(s / 60) | 0}:${String(s % 60).padStart(2, '0')}`;
};

export class Hud {
  constructor(match) {
    this.match = match;
    this.el = {
      hud: $('hud'), timer: $('timer'), phase: $('phase-label'), round: $('round-label'),
      scoreE: $('score-ember'), scoreS: $('score-sable'),
      health: $('health'), armor: $('armor'), money: $('money'),
      ammo: $('ammo'), weapon: $('weapon-name'),
      killfeed: $('killfeed'), center: $('center-msg'), hit: $('hitmarker'),
      vignette: $('dmg-vignette'), bombBanner: $('bomb-banner'),
      minimap: $('minimap'), channelWrap: $('channel-wrap'),
      channelFill: $('channel-fill'), channelLabel: $('channel-label'),
      buyMenu: $('buy-menu'), buyMoney: $('buy-money'), buyMsg: $('buy-msg'),
      scoreboard: $('scoreboard'), sbRows: $('sb-rows'),
      carrier: $('carrier-tag'), lockTip: $('lock-tip'),
    };
    this.mapCtx = this.el.minimap.getContext('2d');
    this.lastHealth = 100;
    this.centerTimer = null;
    this.buyVisible = false;
    this.el.buyMenu.querySelectorAll('[data-item]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const err = this.match.buy(btn.dataset.item);
        this.el.buyMsg.textContent = err || 'Purchased.';
        this.refreshBuy();
      });
    });
  }

  // --- match events -----------------------------------------------------
  handleEvent(type, data) {
    const m = this.match;
    if (type === 'kill') {
      const k = data.killer;
      const line = document.createElement('div');
      line.className = 'kf-line';
      const kName = k ? (k.isPlayer ? 'You' : k.name) : '💥';
      const vName = data.victim.isPlayer ? 'You' : data.victim.name;
      line.innerHTML = `<b class="${k ? k.team : ''}">${kName}</b> ▸ <b class="${data.victim.team}">${vName}</b>${data.isHead ? ' ⌖' : ''}`;
      this.el.killfeed.prepend(line);
      while (this.el.killfeed.children.length > 5) this.el.killfeed.lastChild.remove();
      setTimeout(() => line.remove(), 4600);
      if (data.victim.isPlayer) this.flashVignette(0.55);
    } else if (type === 'hit') {
      if (data.attacker?.isPlayer) {
        this.el.hit.style.opacity = '1';
        this.el.hit.textContent = data.isHead ? '✕' : '×';
        setTimeout(() => { this.el.hit.style.opacity = '0'; }, 90);
      }
    } else if (type === 'plant') {
      this.announce(`CHARGE PLANTED — SITE ${data.site}`);
    } else if (type === 'roundStart') {
      this.announce(`ROUND ${data.round}`);
    } else if (type === 'roundEnd') {
      const youWon = data.winner === 'ember';
      const reason = {
        elimination: 'by elimination', detonation: 'by detonation',
        defuse: 'by defuse', time: 'on time',
      }[data.reason] || '';
      this.announce(youWon ? `ROUND WON ${reason}` : `ROUND LOST ${reason}`, youWon ? 'good' : 'bad');
    } else if (type === 'bombDropped') {
      this.announce('THE CHARGE IS DOWN');
    } else if (type === 'bombPickup') {
      if (data.by.isPlayer) this.announce('YOU HAVE THE CHARGE');
    }
  }

  announce(text, tone = '') {
    const c = this.el.center;
    c.textContent = text;
    c.className = 'show ' + tone;
    clearTimeout(this.centerTimer);
    this.centerTimer = setTimeout(() => { c.className = ''; }, 2300);
  }

  flashVignette(strength) {
    this.el.vignette.style.opacity = String(strength);
    setTimeout(() => { this.el.vignette.style.opacity = '0'; }, 160);
  }

  // --- buy menu ---------------------------------------------------------
  refreshBuy() {
    const p = this.match.player;
    this.el.buyMoney.textContent = fmt$(p.money);
    this.el.buyMenu.querySelectorAll('[data-item]').forEach((btn) => {
      const item = btn.dataset.item;
      const price = item === 'armor' ? ARMOR_PRICE : WEAPONS[item].price;
      const owned = item === 'armor' ? p.armor >= 100 : p.weapons.primary?.id === item;
      btn.disabled = owned || p.money < price;
      btn.querySelector('.owned').textContent = owned ? 'OWNED' : '';
    });
  }

  setBuyVisible(v) {
    if (v === this.buyVisible) return;
    this.buyVisible = v;
    this.el.buyMenu.style.display = v ? 'block' : 'none';
    if (v) { this.el.buyMsg.textContent = ''; this.refreshBuy(); }
  }

  setScoreboardVisible(v) {
    this.el.scoreboard.style.display = v ? 'block' : 'none';
    if (!v) return;
    const rows = [...this.match.all]
      .sort((a, b) => (b.alive - a.alive) || (a.team < b.team ? -1 : 1))
      .map((a) => `<tr class="${a.team}"><td>${a.isPlayer ? 'You' : a.name}</td><td>${a.team.toUpperCase()}</td><td>${a.alive ? a.health + ' hp' : 'DOWN'}</td><td>${fmt$(a.money)}</td><td>${a.weaponState().id.toUpperCase()}</td></tr>`)
      .join('');
    this.el.sbRows.innerHTML = rows;
  }

  // --- per-frame refresh --------------------------------------------------
  refresh() {
    const m = this.match;
    const p = m.player;
    this.el.timer.textContent = fmtClock(m.phaseT);
    this.el.timer.className = m.phase === 'planted' ? 'danger' : '';
    this.el.phase.textContent = {
      buy: 'BUY PHASE', live: 'ROUND LIVE', planted: 'CHARGE PLANTED',
      end: 'ROUND OVER', matchover: 'MATCH OVER',
    }[m.phase] || '';
    this.el.round.textContent = `ROUND ${m.round} / ${MATCH.maxRounds}`;
    this.el.scoreE.textContent = String(m.scores.ember);
    this.el.scoreS.textContent = String(m.scores.sable);
    this.el.health.textContent = String(Math.ceil(p.health));
    this.el.armor.textContent = String(Math.ceil(p.armor));
    this.el.money.textContent = fmt$(p.money);
    const st = p.weaponState();
    this.el.ammo.textContent = p.reloadTimer > 0 ? '— —' : `${st.mag} / ${st.reserve}`;
    this.el.weapon.textContent = WEAPONS[st.id].name;
    this.el.bombBanner.style.display = m.phase === 'planted' ? 'block' : 'none';
    this.el.carrier.style.display = (m.bomb.state === 'carried' && m.bomb.carrier === p) ? 'block' : 'none';
    if (p.health < this.lastHealth - 0.5) this.flashVignette(0.35);
    this.lastHealth = p.health;
    // Plant channel progress (the player planting, or a bot defuser).
    let channel = 0;
    let label = '';
    if (m.playerChannelT > 0) { channel = m.playerChannelT / MATCH.plantSeconds; label = 'PLANTING…'; }
    const defuser = m.sable.find((b) => b.alive && b.order?.kind === 'defuse');
    if (defuser && defuser.channelT > 0) { channel = defuser.channelT / MATCH.defuseSeconds; label = 'DEFUSE IN PROGRESS'; }
    this.el.channelWrap.style.display = channel > 0 ? 'block' : 'none';
    if (channel > 0) {
      this.el.channelFill.style.width = `${Math.min(100, channel * 100)}%`;
      this.el.channelLabel.textContent = label;
    }
    this.drawMinimap();
  }

  drawMinimap() {
    const ctx = this.mapCtx;
    const S = this.el.minimap.width;
    const toMap = (x, z) => [((x + WORLD.half + 2) / (WORLD.half * 2 + 4)) * S, ((z + WORLD.half + 2) / (WORLD.half * 2 + 4)) * S];
    ctx.fillStyle = '#10141a';
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#2a3138';
    for (const b of BOXES) {
      const [x0, z0] = toMap(b.x - b.w / 2, b.z - b.d / 2);
      const [x1, z1] = toMap(b.x + b.w / 2, b.z + b.d / 2);
      ctx.fillRect(x0, z0, x1 - x0, z1 - z0);
    }
    for (const id of ['A', 'B']) {
      const s = SITES[id];
      const [x, y] = toMap(s.x, s.z);
      ctx.strokeStyle = id === 'A' ? '#e8762d' : '#35b6a4';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, (s.radius / (WORLD.half * 2 + 4)) * S, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = 'bold 10px system-ui';
      ctx.fillText(id, x - 3, y + 3);
    }
    const m = this.match;
    if (m.bomb.pos && m.bomb.state !== 'carried') {
      const [x, y] = toMap(m.bomb.pos.x, m.bomb.pos.z);
      ctx.fillStyle = (Date.now() % 600 < 300) ? '#ffd94d' : '#8a6d00';
      ctx.fillRect(x - 3, y - 3, 6, 6);
    }
    for (const a of m.all) {
      if (!a.alive) continue;
      const [x, y] = toMap(a.pos.x, a.pos.z);
      ctx.fillStyle = a.isPlayer ? '#ffffff' : a.team === 'ember' ? '#e8762d' : '#35b6a4';
      ctx.beginPath();
      ctx.arc(x, y, a.isPlayer ? 3.4 : 2.6, 0, Math.PI * 2);
      ctx.fill();
      if (a.isPlayer) {
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - Math.sin(a.yaw) * 8, y - Math.cos(a.yaw) * 8);
        ctx.stroke();
      }
    }
  }
}

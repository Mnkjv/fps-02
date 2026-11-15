// SABLE PROTOCOL — match configuration.
// Every tunable that shapes a match lives here: the two squads, the weapon
// table, the economy and the round clock. The rest of the code reads these
// numbers and never hard-codes its own, so balancing is a one-file edit.

// The player leads the attacking squad (EMBER, orange). The defending squad
// (SABLE, teal) holds the two sites. Names, colours and fiction are original
// to this game; the structure — rounds, buys, a plant objective — is the
// genre's shared grammar.
export const SQUADS = {
  ember: { id: 'ember', name: 'EMBER', role: 'attack', color: 0xe8762d, css: '#e8762d' },
  sable: { id: 'sable', name: 'SABLE', role: 'defend', color: 0x35b6a4, css: '#35b6a4' },
};

export const MATCH = {
  playersPerTeam: 5, // the human plus four bot team-mates
  roundsToWin: 7, // short match: first to 7, at most 12 rounds
  maxRounds: 12,
  buySeconds: 12, // freeze time with the buy menu open
  roundSeconds: 100, // the round clock until the charge is planted
  bombSeconds: 35, // the charge timer once planted
  plantSeconds: 3, // hold-to-plant channel
  defuseSeconds: 5, // hold-to-defuse channel
  endSeconds: 5, // scoreboard pause between rounds
  startMoney: 800,
  maxMoney: 9000,
};

// price, damage per bullet (body), rounds per minute, magazine, reserve,
// spread in radians while still / while moving, and the range past which
// damage falls off. Accuracy is the game's core skill: standing still and
// firing in bursts is several times tighter than spraying on the move.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', slot: 'sidearm', price: 0,
    damage: 26, headMult: 3.4, rpm: 320, mag: 12, reserve: 48,
    reloadSeconds: 1.6, spreadStill: 0.006, spreadMove: 0.02,
    falloffStart: 18, falloffEnd: 45, tracer: 0xffd9a0, kick: 0.011,
  },
  kestrel: {
    id: 'kestrel', name: 'Kestrel SMG', slot: 'primary', price: 1100,
    damage: 22, headMult: 3.0, rpm: 780, mag: 32, reserve: 96,
    reloadSeconds: 2.1, spreadStill: 0.011, spreadMove: 0.032,
    falloffStart: 12, falloffEnd: 34, tracer: 0xffc37a, kick: 0.009,
  },
  ar7: {
    id: 'ar7', name: 'AR-7 Carbine', slot: 'primary', price: 2700,
    damage: 33, headMult: 3.6, rpm: 620, mag: 30, reserve: 90,
    reloadSeconds: 2.4, spreadStill: 0.004, spreadMove: 0.026,
    falloffStart: 30, falloffEnd: 80, tracer: 0xffe2ae, kick: 0.014,
  },
  longbow: {
    id: 'longbow', name: 'Longbow DMR', slot: 'primary', price: 4300,
    damage: 88, headMult: 2.2, rpm: 48, mag: 5, reserve: 20,
    reloadSeconds: 2.9, spreadStill: 0.0008, spreadMove: 0.05,
    falloffStart: 60, falloffEnd: 140, tracer: 0xfff3cf, kick: 0.05,
  },
};

export const ARMOR_PRICE = 650;
export const ARMOR_ABSORB = 0.55; // armour turns 55% of body damage away

export const REWARDS = {
  kill: 300,
  winElimination: 3250,
  winObjective: 3500, // detonation for EMBER, defuse for SABLE
  plantTeam: 800, // paid to EMBER the moment the charge is planted
  plantPersonal: 300,
  lossBase: 1400,
  lossStreakStep: 500, // each consecutive lost round adds this, to a cap
  lossStreakCap: 2900,
};

export const BOT_NAMES = {
  ember: ['Vex', 'Rook', 'Halo', 'Juno'],
  sable: ['Onyx', 'Fable', 'Cinder', 'Warden', 'Pivot'],
};

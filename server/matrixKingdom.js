const crypto = require('crypto');

const ROLE_DIST = {
  5:  { knights: 3, traitors: 1, smallGame: true  },
  6:  { knights: 4, traitors: 1, smallGame: true  },
  7:  { knights: 4, traitors: 2, smallGame: false },
  8:  { knights: 5, traitors: 2, smallGame: false },
  9:  { knights: 5, traitors: 3, smallGame: false },
  10: { knights: 6, traitors: 3, smallGame: false },
};

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildDeck() {
  return shuffle([...Array(6).fill('matrix'), ...Array(11).fill('rebel')]);
}

function createMKState(playersArray) {
  const n = playersArray.length;
  const dist = ROLE_DIST[n];
  if (!dist) return null;

  const roles = shuffle([
    ...Array(dist.knights).fill('knight'),
    ...Array(dist.traitors).fill('traitor'),
    'king'
  ]);

  const players = new Map();
  playersArray.forEach((p, i) => {
    players.set(p.id, {
      id: p.id, name: p.name, username: p.username || null,
      avatar: p.avatar || null, role: roles[i], isAlive: true,
    });
  });

  const order = shuffle([...players.keys()]);

  return {
    phase: 'intro',
    players,
    deck: buildDeck(),
    board: { matrix: 0, rebel: 0 },
    chaosCounter: 0,
    termLock: { leaderId: null, partnerId: null },
    leaderOrder: order,
    leaderIndex: 0,
    currentLeaderId: order[0],
    nominatedPartnerId: null,
    votes: new Map(),
    pendingCards: [],
    smallGame: dist.smallGame,
    pendingPower: null,
    powerResult: null,
    rolesRevealed: null,
    winner: null,
    winReason: null,
    lastCard: null,
    eventLog: [],
    readySet: new Set(),
  };
}

function getPlayersByRole(state, role) {
  return [...state.players.values()].filter(p => p.role === role);
}

function getAlive(state) {
  return [...state.players.values()].filter(p => p.isAlive);
}

function advanceLeader(state) {
  const aliveIds = new Set(getAlive(state).map(p => p.id));
  let idx = state.leaderIndex;
  for (let i = 0; i < state.leaderOrder.length; i++) {
    idx = (idx + 1) % state.leaderOrder.length;
    if (aliveIds.has(state.leaderOrder[idx])) break;
  }
  state.leaderIndex = idx;
  state.currentLeaderId = state.leaderOrder[idx];
}

// Power type unlocked when rebel count reaches threshold
function powerForRebel(rebelCount, smallGame) {
  if (!smallGame && rebelCount === 1) return 'role_spy';
  if (rebelCount === 2) return 'role_spy';
  if (rebelCount === 3) return 'deck_spy';
  if (rebelCount === 4) return 'execute';
  if (rebelCount === 5) return 'execute';
  return null;
}

function checkWin(state) {
  if (state.board.matrix >= 5) return { over: true, winner: 'knights', reason: '5 Matrix Kartı Masaya Yüklendi!' };
  if (state.board.rebel >= 6) return { over: true, winner: 'rebels', reason: '6 Asi Kartı Masaya Yüklendi!' };
  return { over: false };
}

function checkKingExecuted(state, targetId) {
  const p = state.players.get(targetId);
  if (p?.role === 'king') return { over: true, winner: 'knights', reason: 'Kral İdam Edildi! Şövalyeler Kazandı!' };
  return { over: false };
}

function checkKingPartnerApproved(state) {
  if (state.board.rebel >= 3) {
    const partner = state.players.get(state.nominatedPartnerId);
    if (partner?.role === 'king') {
      return { over: true, winner: 'rebels', reason: 'Kral Yaver Olarak Onaylandı! (3+ Asi Kartıyla Asilerin Zaferi!)' };
    }
  }
  return { over: false };
}

function getPublicState(state, roomPlayers) {
  const leader = state.players.get(state.currentLeaderId);
  const partner = state.nominatedPartnerId ? state.players.get(state.nominatedPartnerId) : null;
  let jaCount = 0, neinCount = 0;
  state.votes.forEach(v => { if (v === 'ja') jaCount++; else neinCount++; });

  return {
    mkPhase: state.phase,
    board: { ...state.board },
    chaosCounter: state.chaosCounter,
    termLock: { ...state.termLock },
    deckSize: state.deck.length,
    currentLeader: leader ? { id: leader.id, name: leader.name } : null,
    nominatedPartner: partner ? { id: partner.id, name: partner.name } : null,
    votes: { ja: jaCount, nein: neinCount, total: state.votes.size },
    players: [...state.players.values()].map(p => ({
      id: p.id, name: p.name,
      avatar: roomPlayers?.get(p.id)?.avatar || p.avatar,
      cosmetics: roomPlayers?.get(p.id)?.cosmetics || {},
      isAlive: p.isAlive,
    })),
    readyCount: state.readySet ? state.readySet.size : 0,
    readyPlayers: state.readySet ? [...state.readySet] : [],
    winner: state.winner,
    winReason: state.winReason,
    rolesRevealed: state.rolesRevealed || null,
    leaderHasPower: !!state.pendingPower,
    pendingPowerType: state.pendingPower?.type || null,
    lastCard: state.lastCard,
    eventLog: state.eventLog.slice(-8),
  };
}

function getPrivateState(state, playerId) {
  const p = state.players.get(playerId);
  if (!p) return null;

  const isLeader = playerId === state.currentLeaderId;
  const isPartner = playerId === state.nominatedPartnerId;

  const priv = { role: p.role, isAlive: p.isAlive, isLeader, isPartner };

  if (p.role === 'traitor') {
    priv.traitorAllies = getPlayersByRole(state, 'traitor')
      .filter(t => t.id !== playerId)
      .map(t => ({ id: t.id, name: t.name }));
    const king = getPlayersByRole(state, 'king')[0];
    priv.kingId = king?.id || null;
    priv.kingName = king?.name || null;
  }

  if (p.role === 'king' && state.smallGame) {
    const traitor = getPlayersByRole(state, 'traitor')[0];
    priv.traitorId = traitor?.id || null;
    priv.traitorName = traitor?.name || null;
  }

  if (state.phase === 'card_leader' && isLeader) priv.pendingCards = [...state.pendingCards];
  if (state.phase === 'card_partner' && isPartner) priv.pendingCards = [...state.pendingCards];

  if (isLeader && state.powerResult) priv.powerResult = { ...state.powerResult };

  return priv;
}

module.exports = {
  createMKState, getPublicState, getPrivateState,
  checkWin, checkKingExecuted, checkKingPartnerApproved,
  powerForRebel, advanceLeader, getAlive,
};

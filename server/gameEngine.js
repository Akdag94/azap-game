// ============================================================
// AZAP v4 - Oyun Motoru
// ============================================================
const { TEAMS, ROLES, PHASES, DEFAULT_CONFIG } = require('./gameConstants');
const crypto = require('crypto');

class GameEngine {
  constructor(code, leaderId) {
    this.code = code;
    this.leaderId = leaderId;
    this.players = new Map();
    this.spectators = new Map();
    this.phase = PHASES.LOBBY;
    this.round = 0;

    this.config = { ...DEFAULT_CONFIG };
    this.enabledRoles = new Set(Object.keys(ROLES).filter(k => k !== 'DELI' && ROLES[k].implemented !== false));
    this.insanityRate = 15;

    this.hainCount = 0;
    this.tarafsizCount = 0;
    this.manualCounts = false;
    this.hainKillMode = 'multi'; // her hain ayrı kill yapabilsin (yeni istek)

    // Rol seçim modu
    this.roleSelectionMode = 'auto'; // 'auto' veya 'pick' (oyuncular seçsin)
    this.roleSelectionPool = []; // 'pick' modunda her oyuncu için 3 rol seçeneği
    this.roleSelectionPicks = new Map(); // playerId -> { roleId, isRandom }
    this.roleSelectionOrder = [];  // playerId sırası
    this.roleSelectionIndex = 0;
    this.roleSelectionTimers = new Map();

    // Başkan
    this.presidentId = null;
    this.presidentVotes = new Map(); // voterId -> targetId

    // Runtime
    this.nightActions = new Map();
    this.hainKillVotesLive = new Map(); // hainId -> targetId  (canlı, herkes hain görür)
    this.hainAbilityChoices = new Map(); // hainId -> {action, abilityTargetId, ...}
    this.blocked = new Set();
    this.locked = new Map();       // çilingir: targetId -> çilingirId
    this.silenced = new Map();
    this.bombs = new Map();
    this.gaziUsed = new Set();
    this.savciUsed = new Set();
    this.serifUsed = new Set();    // şerif: tek kullanım
    this.serifPendingSuicide = new Set(); // şerif: ertesi gece intihar edecekler
    this.doktorSelfUsed = new Set();
    this.cellatTarget = new Map();
    this.cellatWon = new Set();
    this.nightReports = new Map();
    this.votes = new Map();
    this.voteTally = new Map();
    this.deadThisNight = [];
    this.actionHistory = new Map();
    this.gameLog = [];
    this.yamyamAbilities = new Map();

    this.gameEnded = false;
    this.gameResult = null;

    // MVP voting (oyun sonu - en iyi oyuncu)
    this.mvpVotes = new Map();
    this.mvpResult = null;

    // Suikastçı: her tur 1 hak (her gündüz başında sıfırlanır)
    this.suikastUsedThisRound = false;

    // ── YENİ ROLLER STATE'LERİ ──
    // Koruyucu (Masum, pasif): oyun başında atanan koruma hedefi
    this.koruyucuTargets = new Map();  // koruyucuId -> targetId
    // Demirci (Masum): çelik zırh kalıcı, tek saldırı emer
    this.steelArmor = new Map();       // targetId -> demirciId
    // İnfazcı (Masum, henüz IMPLEMENTED:false): zindan + infaz hakkı
    this.imprisoned = new Map();
    this.infazExecutionsLeft = new Map();
    // Gardiyan (Masum, henüz IMPLEMENTED:false): sokağa çıkma yasağı
    this.gardiyanShield = false;
    this.gardiyanUsed = new Set();
    // Engizitör (Masum, henüz IMPLEMENTED:false)
    this.engizitorUsed = new Set();
    // Ölümsüz (Masum, henüz IMPLEMENTED:false)
    this.olumsuzUsed = new Set();
    this.olumsuzPending = new Map();
    // Buzcu (Masum): 2 hak, karantinalar
    this.buzcuLeft = new Map();
    this.frozen = new Map();           // pid -> 1 (sonraki gündüz oylama dışı)
    // Köstebek (Hain, henüz IMPLEMENTED:false): state gerektirmez
    // Virüs (Hain, henüz IMPLEMENTED:false)
    this.infected = new Map();
    this.virusInactiveRounds = new Map();
    // Pusucu (Hain, henüz IMPLEMENTED:false)
    this.ambushTrap = new Map();
    // Hacker (Hain, henüz IMPLEMENTED:false)
    this.hackedTarget = new Map();
    // Veba (Tarafsız, henüz IMPLEMENTED:false)
    this.plagued = new Map();

  // ── SABOTAJ SİSTEMİ ──
    // Hain gece kolektif sabotaj oyu kullanır. 1 oy yeter
    this.sabotageVotes = new Set(); // hainId Set (bu gece sabotaj isteyenler)
    this.sabotagePending = false;   // gündüz başında pending olur, rastgele anda tetiklenir
    this.sabotagePendingFromSystem = false; // hain değil, sistem mi tetikliyor
    this.sabotageActive = false;    // şu an mini oyun çalışıyor mu
    this.sabotageStartedAt = 0;     // ne zaman başladı (timer ertelemesi için)
    this.sabotageTargets = new Map(); // pid -> { gameType, opponentType, opponentId, completed, won }
    this.sabotagePairs = new Map(); // gameId -> { players: [pid1, pid2], gameType, ... } (PvP eşleşmeler)
  }

  addPlayer(id, name, username, wins, avatar, mvp, isAdmin) {
    if (this.players.size >= this.config.MAX_PLAYERS) return false;
    if (this.phase !== PHASES.LOBBY && this.phase !== PHASES.POST_GAME) return false;
    this.players.set(id, {
      id, name, username, wins: wins || 0, mvp: mvp || 0, avatar: avatar || null,
      role: null, actualTeam: null, displayedRole: null,
      isAlive: true, isInsane: false, isTempInsane: false,
      isShielded: false, isImmortal: false, isSilenced: false,
      isReady: false, isAdmin: !!isAdmin
    });
    this.actionHistory.set(id, []);
    return true;
  }
  addSpectator(id, name, username, avatar) {
    this.spectators.set(id, { id, name, username, avatar: avatar || null });
  }
  removePlayer(id) { this.players.delete(id); this.actionHistory.delete(id); }
  removeSpectator(id) { this.spectators.delete(id); }
  // Aktif oyunda bağlantısı kopmuş oyuncuyu username ile bul, yeni socket ID ile güncelle
  rejoinPlayer(newId, username) {
    for (const [oldId, p] of this.players) {
      if (p.username === username) {
        if (oldId === newId) return { ok: true, alreadySame: true };
        const data = { ...p, id: newId };
        this.players.delete(oldId);
        this.players.set(newId, data);
        this.migratePlayerId(oldId, newId);
        // leaderId güncelle
        if (this.leaderId === oldId) this.leaderId = newId;
        return { ok: true, player: data, oldId };
      }
    }
    return { ok: false };
  }
  migratePlayerId(oldId, newId) {
    const moveSet = (set) => {
      if (set?.has(oldId)) {
        set.delete(oldId);
        set.add(newId);
      }
    };
    const moveMapKey = (map, patchValue) => {
      if (!map?.has(oldId)) return;
      const val = map.get(oldId);
      map.delete(oldId);
      map.set(newId, patchValue ? patchValue(val) : val);
    };
    const replace = (v) => v === oldId ? newId : v;
    const patchAction = (a) => a && typeof a === 'object' ? {
      ...a,
      pid: replace(a.pid),
      targetId: replace(a.targetId),
      killTargetId: replace(a.killTargetId),
      abilityTargetId: replace(a.abilityTargetId),
      target1Id: replace(a.target1Id),
      target2Id: replace(a.target2Id)
    } : a;

    moveMapKey(this.actionHistory);
    moveMapKey(this.nightActions, patchAction);
    moveMapKey(this.hainKillVotesLive, replace);
    moveMapKey(this.hainAbilityChoices, patchAction);
    moveMapKey(this.presidentVotes, replace);
    moveMapKey(this.votes, replace);
    moveMapKey(this.voteTally);
    moveMapKey(this.nightReports);
    moveMapKey(this.mvpVotes, replace);
    moveMapKey(this.cellatTarget, replace);
    moveMapKey(this.koruyucuTargets, replace);
    moveMapKey(this.locked, replace);
    moveMapKey(this.silenced, replace);
    moveMapKey(this.bombs, b => b && typeof b === 'object' ? { ...b, ownerId: replace(b.ownerId) } : b);
    moveMapKey(this.imprisoned, replace);
    moveMapKey(this.buzcuLeft);
    moveMapKey(this.frozen);
    moveMapKey(this.infected, info => info && typeof info === 'object' ? { ...info, byId: replace(info.byId) } : info);
    moveMapKey(this.virusInactiveRounds);
    moveMapKey(this.ambushTrap);
    moveMapKey(this.hackedTarget, replace);
    moveMapKey(this.steelArmor, replace);
    moveMapKey(this.plagued, replace);
    moveMapKey(this.yamyamAbilities);
    moveMapKey(this.sabotageTargets, t => t && typeof t === 'object' ? { ...t, opponentId: replace(t.opponentId) } : t);

    [
      this.blocked, this.gaziUsed, this.savciUsed, this.serifUsed, this.serifPendingSuicide,
      this.doktorSelfUsed, this.cellatWon, this.gardiyanUsed, this.engizitorUsed,
      this.olumsuzUsed, this.sabotageVotes
    ].forEach(moveSet);

    this.deadThisNight = this.deadThisNight.map(replace);
    this.roleSelectionOrder = this.roleSelectionOrder.map(replace);
    moveMapKey(this.roleSelectionPicks);
    moveMapKey(this.roleSelectionTimers);
    this.sabotagePairs.forEach(pair => {
      if (Array.isArray(pair.players)) pair.players = pair.players.map(replace);
    });
  }
  alive() { return [...this.players.values()].filter(p => p.isAlive); }
  rk(roleId) { return Object.keys(ROLES).find(k => ROLES[k].id === roleId); }
  ro(roleId) { const k = this.rk(roleId); return k ? ROLES[k] : null; }
  pn(pid) { return this.players.get(pid)?.name || '?'; }

  setConfig(c) {
    if (c.nightDuration) this.config.NIGHT_DURATION = Math.max(10, Math.min(120, c.nightDuration));
    if (c.discussionDuration) this.config.DISCUSSION_DURATION = Math.max(30, Math.min(600, c.discussionDuration));
    if (c.votingDuration) this.config.VOTING_DURATION = Math.max(10, Math.min(120, c.votingDuration));
    if (c.presidentVoteDuration) this.config.PRESIDENT_VOTE_DURATION = Math.max(10, Math.min(60, c.presidentVoteDuration));
  }
  setTeamCounts(h, t) {
    this.manualCounts = true;
    // Hain rolü sayısı (4) ve tarafsız rolü sayısı (4) ile sınırla
    const maxHain = Object.values(ROLES).filter(r => r.team === TEAMS.HAIN).length;
    const maxTarafsiz = Object.values(ROLES).filter(r => r.team === TEAMS.TARAFSIZ).length;
    this.hainCount = Math.max(0, Math.min(maxHain, h));
    this.tarafsizCount = Math.max(0, Math.min(maxTarafsiz, t));
  }
  setHainKillMode(m) { this.hainKillMode = m === 'single' ? 'single' : 'multi'; }
  setRoleSelectionMode(m) { this.roleSelectionMode = m === 'pick' ? 'pick' : 'auto'; }

  // ── ROL DAĞITIMI ──
  startGame() {
    const n = this.players.size;
    if (n < this.config.MIN_PLAYERS) return false;

    if (this.roleSelectionMode === 'pick') {
      return this._startRoleSelection();
    }
    return this._distributeAuto();
  }

  _calcCounts(n) {
    let hC, tC;
    if (this.manualCounts) {
      hC = this.hainCount; tC = this.tarafsizCount;
      // Eğer toplam (hain+tarafsız) oyuncu sayısını AŞIYORSA orantılı küçült
      if (hC + tC > n) {
        const ratio = n / (hC + tC);
        hC = Math.max(1, Math.floor(hC * ratio));
        tC = Math.max(0, n - hC);
      }
      // En az 1 hain olmalı
      if (hC < 1) hC = 1;
      if (hC > n - 1) hC = n - 1;
    } else {
      hC = Math.max(1, Math.floor(n / 4));
      tC = Math.max(0, Math.min(2, Math.floor((n - hC) / 6)));
    }
    return { hC, tC, mC: Math.max(0, n - hC - tC) };
  }

  _distributeAuto() {
    const n = this.players.size;
    const { hC, tC, mC } = this._calcCounts(n);
    let en = [...this.enabledRoles].filter(k => k !== 'DELI');
    // Deli oranı %0 ise Psikolog'u havuzdan çıkar (işlevsiz olur)
    if (this.insanityRate === 0) en = en.filter(k => k !== 'PSIKOLOG');
    const hains = en.map(k => ROLES[k]).filter(r => r && r.team === TEAMS.HAIN);
    const trs = en.map(k => ROLES[k]).filter(r => r && r.team === TEAMS.TARAFSIZ);
    const masums = en.map(k => ROLES[k]).filter(r => r && r.team === TEAMS.MASUM);
    if (hains.length === 0 || masums.length === 0) return false;

    const sel = [];
    // Önce tüm benzersiz rolleri kullan, ihtiyaç fazla ise yeniden karıştırıp ekle.
    const pick = (arr, c) => {
      if (arr.length === 0 || c <= 0) return;
      let bag = this.shuf([...arr]);
      let bi = 0;
      for (let i = 0; i < c; i++) {
        if (bi >= bag.length) { bag = this.shuf([...arr]); bi = 0; }
        sel.push({ ...bag[bi++] });
      }
    };
    pick(hains, hC); pick(trs, tC); pick(masums, mC);

    const final = this.shuf(sel);
    // ÖNEMLİ: hem rolleri hem oyuncu sırasını karıştır (eski oyuncuya hep aynı rol gelmesin)
    const pids = this.shuf([...this.players.keys()]);

    // Deli atama
    const masumIdx = [];
    final.forEach((r, i) => { if (r.team === TEAMS.MASUM) masumIdx.push(i); });
    const deliN = Math.max(0, Math.round(masumIdx.length * this.insanityRate / 100));
    const deliSet = new Set(this.shuf([...masumIdx]).slice(0, deliN));

    pids.forEach((pid, i) => {
      const p = this.players.get(pid);
      const r = final[i];
      p.role = r.id;
      p.actualTeam = r.team;
      p.isInsane = deliSet.has(i);
      p.displayedRole = r.id;
    });

    this._setupCellat();
    this._enterRoleReveal();
    return true;
  }

  _startRoleSelection() {
    const n = this.players.size;
    const { hC, tC, mC } = this._calcCounts(n);
    let en = [...this.enabledRoles].filter(k => k !== 'DELI');
    // Deli %0 ise psikolog havuzdan çıkar
    if (this.insanityRate === 0) en = en.filter(k => k !== 'PSIKOLOG');

    const hainRoles = en.map(k => ROLES[k]).filter(r => r && r.team === TEAMS.HAIN);
    const tarafsizRoles = en.map(k => ROLES[k]).filter(r => r && r.team === TEAMS.TARAFSIZ);
    const masumRoles = en.map(k => ROLES[k]).filter(r => r && r.team === TEAMS.MASUM);
    if (hainRoles.length === 0 || masumRoles.length === 0) return false;

    // ÖNEMLİ: Önceden sınırlı bir havuz YOK. Tüm enabled roller seçenek olarak verilebilir.
    // Sadece takım kotaları (hC/tC/mC) ve aynı rolün iki oyuncuda olmamasi (usedRoleIds) takip edilir.
    this._selPool = {
      hainRoles, tarafsizRoles, masumRoles,
      hainNeeded: hC,
      tarafsizNeeded: tC,
      masumNeeded: mC,
      hainPicked: 0,
      tarafsizPicked: 0,
      masumPicked: 0,
      usedRoleIds: new Set(), // o oyunda seçilmiş roller (benzersizlik)
      allEnabled: en
    };

    // Sıra: rastgele
    const pids = this.shuf([...this.players.keys()]);
    this.roleSelectionOrder = pids;
    this.roleSelectionIndex = 0;
    this.roleSelectionPicks.clear();
    this.roleSelectionPool = [];

    this.phase = PHASES.ROLE_SELECTION;
    return true;
  }

  // Her sıradaki oyuncuya dinamik seçenekler üret.
  // Seçenekler TÜM enabled rollerden (sadece kullanılmamış olanlardan) gelir.
  // Önceki oyuncunun bir rolü seçmemesi sonraki oyuncuya o rolün gelmesini engellemez.
  _generateOptionsForCurrent() {
    const sp = this._selPool;
    if (!sp) return null;
    const idx = this.roleSelectionIndex;
    const remaining = this.roleSelectionOrder.length - idx;
    const hainLeft = sp.hainNeeded - sp.hainPicked;
    const tarafsizLeft = sp.tarafsizNeeded - sp.tarafsizPicked;
    const masumLeft = sp.masumNeeded - sp.masumPicked;

    const availOf = (rolesArr) => rolesArr.filter(r => !sp.usedRoleIds.has(r.id));
    const hainAvail = availOf(sp.hainRoles);
    const tarafsizAvail = availOf(sp.tarafsizRoles);
    const masumAvail = availOf(sp.masumRoles);

    // ── Zorla atama durumları ──
    if (remaining <= hainLeft) {
      if (hainAvail.length === 0) return null;
      const opts = this.shuf([...hainAvail]).slice(0, Math.min(3, hainAvail.length));
      return { forced: true, options: opts.map(r => r.id), forcedTeam: 'hain' };
    }
    if (hainLeft === 0 && remaining <= tarafsizLeft) {
      if (tarafsizAvail.length === 0) return null;
      const opts = this.shuf([...tarafsizAvail]).slice(0, Math.min(3, tarafsizAvail.length));
      return { forced: true, options: opts.map(r => r.id), forcedTeam: 'tarafsız' };
    }

    // ── Normal: 3 seçenek üret ──
    const options = [];
    const addOne = (pool) => {
      const cand = pool.filter(r => !options.some(o => o.id === r.id));
      if (cand.length > 0) options.push(this.shuf(cand)[0]);
    };

    if (hainLeft > 0) addOne(hainAvail);
    if (tarafsizLeft > 0) addOne(tarafsizAvail);
    if (masumLeft > 0) addOne(masumAvail);

    let safety = 30;
    while (options.length < 3 && safety-- > 0) {
      const fillPool = [];
      if (hainLeft > 0) hainAvail.forEach(r => { if (!options.some(o => o.id === r.id)) fillPool.push(r); });
      if (tarafsizLeft > 0) tarafsizAvail.forEach(r => { if (!options.some(o => o.id === r.id)) fillPool.push(r); });
      if (masumLeft > 0) masumAvail.forEach(r => { if (!options.some(o => o.id === r.id)) fillPool.push(r); });
      if (fillPool.length === 0) break;
      options.push(this.shuf(fillPool)[0]);
    }

    if (options.length === 0) return null;
    return { forced: false, options: this.shuf(options).map(r => r.id) };
  }

  // Oyuncu rol seçer
  submitRoleChoice(pid, choice) {
    if (this.phase !== PHASES.ROLE_SELECTION) return false;
    const expected = this.roleSelectionOrder[this.roleSelectionIndex];
    if (expected !== pid) return false;

    const sp = this._selPool;
    if (!sp) return false;

    let chosenRoleId, isRandom = false;

    if (choice === 'random') {
      isRandom = true;
      const hainLeft = sp.hainNeeded - sp.hainPicked;
      const tarafsizLeft = sp.tarafsizNeeded - sp.tarafsizPicked;
      const masumLeft = sp.masumNeeded - sp.masumPicked;
      const remaining = this.roleSelectionOrder.length - this.roleSelectionIndex;

      const candidates = [];
      // Forced durumlarda: rastgele de aynı takımdan seçmeli
      if (remaining <= hainLeft) {
        // Zorla hain
        sp.hainRoles.filter(r => !sp.usedRoleIds.has(r.id)).forEach(r => candidates.push(r));
      } else if (hainLeft === 0 && remaining <= tarafsizLeft) {
        // Zorla tarafsız
        sp.tarafsizRoles.filter(r => !sp.usedRoleIds.has(r.id)).forEach(r => candidates.push(r));
      } else {
        // Normal: tüm açık takımlardan
        if (masumLeft > 0) sp.masumRoles.filter(r => !sp.usedRoleIds.has(r.id)).forEach(r => candidates.push(r));
        if (hainLeft > 0) sp.hainRoles.filter(r => !sp.usedRoleIds.has(r.id)).forEach(r => candidates.push(r));
        if (tarafsizLeft > 0) sp.tarafsizRoles.filter(r => !sp.usedRoleIds.has(r.id)).forEach(r => candidates.push(r));
      }

      if (candidates.length === 0) return false;
      chosenRoleId = this.shuf(candidates)[0].id;
    } else {
      // Manuel seçim — rolün havuzda (kullanılmamış) olduğunu kontrol et
      const choiceRole = this.ro(choice);
      if (!choiceRole || sp.usedRoleIds.has(choice)) return false;

      // Takım kotası kontrolü
      const hainLeft = sp.hainNeeded - sp.hainPicked;
      const tarafsizLeft = sp.tarafsizNeeded - sp.tarafsizPicked;
      const masumLeft = sp.masumNeeded - sp.masumPicked;

      if (choiceRole.team === TEAMS.HAIN && hainLeft <= 0) return false;
      if (choiceRole.team === TEAMS.TARAFSIZ && tarafsizLeft <= 0) return false;
      if (choiceRole.team === TEAMS.MASUM && masumLeft <= 0) return false;

      // Rol enabled olmalı
      const inEnabled = sp.allEnabled.some(k => ROLES[k]?.id === choice);
      if (!inEnabled) return false;

      chosenRoleId = choice;
    }

    // Havuz güncelle
    const chosenRole = this.ro(chosenRoleId);
    if (chosenRole) {
      sp.usedRoleIds.add(chosenRoleId);
      if (chosenRole.team === TEAMS.HAIN) sp.hainPicked++;
      else if (chosenRole.team === TEAMS.TARAFSIZ) sp.tarafsizPicked++;
      else sp.masumPicked++;
    }

    this.roleSelectionPicks.set(pid, {
      roleId: chosenRoleId,
      isRandom,
      displayedRole: isRandom ? null : chosenRoleId
    });
    this.roleSelectionIndex++;

    // Hepsi seçti mi?
    if (this.roleSelectionIndex >= this.roleSelectionOrder.length) {
      this._finalizeRoleSelection();
      return { done: true };
    }
    return { done: false, nextIndex: this.roleSelectionIndex };
  }

  _finalizeRoleSelection() {
    const pids = this.roleSelectionOrder;

    // Her oyuncunun seçtiği rolü ata
    pids.forEach(pid => {
      const p = this.players.get(pid);
      const pick = this.roleSelectionPicks.get(pid);
      if (!pick) return;
      const roleObj = this.ro(pick.roleId);
      p.role = pick.roleId;
      p.actualTeam = roleObj?.team;
      p.displayedRole = pick.roleId;
    });

    // Deli atama: masumlardan rastgele
    const masumPlayers = pids.map(pid => this.players.get(pid)).filter(p => p.actualTeam === TEAMS.MASUM);
    const deliN = Math.max(0, Math.round(masumPlayers.length * this.insanityRate / 100));
    const deliSet = this.shuf([...masumPlayers]).slice(0, deliN);
    deliSet.forEach(p => { p.isInsane = true; });

    // Temizle
    delete this._selPool;

    this._setupCellat();
    this._enterRoleReveal();
  }

  _setupCellat() {
    [...this.players.values()].filter(p => p.role === 'cellat').forEach(c => {
      const masums = [...this.players.values()].filter(p => p.id !== c.id && p.actualTeam === TEAMS.MASUM);
      if (masums.length > 0) {
        const t = masums[crypto.randomInt(0, masums.length)];
        this.cellatTarget.set(c.id, t.id);
      }
    });
    // Koruyucu: rastgele birini emanet et (kendi hariç, herkes — masum/hain/tarafsız/sk)
    [...this.players.values()].filter(p => p.role === 'koruyucu').forEach(k => {
      const others = [...this.players.values()].filter(p => p.id !== k.id);
      if (others.length > 0) {
        const t = others[crypto.randomInt(0, others.length)];
        this.koruyucuTargets.set(k.id, t.id);
      }
    });
    // Buzcu hakkı: 2 başlangıç
    [...this.players.values()].filter(p => p.role === 'buzcu').forEach(b => {
      this.buzcuLeft.set(b.id, 2);
    });
    // İnfazcı: 1 idam hakkı
    [...this.players.values()].filter(p => p.role === 'infazci').forEach(i => {
      this.infazExecutionsLeft.set(i.id, 1);
    });
    // Virüs: aksiyonsuz sayaç sıfır
    [...this.players.values()].filter(p => p.role === 'virus').forEach(v => {
      this.virusInactiveRounds.set(v.id, 0);
    });
  }

  _enterRoleReveal() {
    this.phase = PHASES.ROLE_REVEAL;
    this.round = 1;
    this.log('🎮 Roller dağıtıldı.');
  }

  // Rol gösterimi sonrası → Başkan oylama
  startPresidentVote() {
    this.phase = PHASES.PRESIDENT_VOTE;
    this.presidentVotes.clear();
    this.log('👑 Başkan oylaması başladı.');
  }

  submitPresidentVote(vid, tid) {
    if (this.phase !== PHASES.PRESIDENT_VOTE) return false;
    const v = this.players.get(vid);
    if (!v?.isAlive) return false;
    if (tid === 'skip' || tid === null) {
      this.presidentVotes.set(vid, 'skip');
      return true;
    }
    const t = this.players.get(tid);
    if (!t?.isAlive) return false;
    this.presidentVotes.set(vid, tid);
    return true;
  }

  resolvePresidentVote() {
    const tally = new Map();
    this.presidentVotes.forEach(tid => {
      if (tid === 'skip') return;
      tally.set(tid, (tally.get(tid) || 0) + 1);
    });
    let max = 0, candidates = [];
    tally.forEach((c, pid) => {
      if (c > max) { max = c; candidates = [pid]; }
      else if (c === max) candidates.push(pid);
    });

    if (candidates.length === 0) {
      // Kimse oy almamış: rastgele başkan
      const alive = this.alive();
      this.presidentId = alive[crypto.randomInt(0, alive.length)]?.id || null;
    } else {
      this.presidentId = candidates[crypto.randomInt(0, candidates.length)];
    }
    if (this.presidentId) {
      this.log(`👑 ${this.pn(this.presidentId)} başkan seçildi.`);
    }
    return this.presidentId;
  }

  getPresidentVoteTally() {
    const t = {};
    let skipCount = 0;
    this.presidentVotes.forEach((tid, vid) => {
      if (tid === 'skip') { skipCount++; return; }
      t[tid] = (t[tid] || 0) + 1;
    });
    if (skipCount > 0) t['__skip__'] = skipCount;
    return t;
  }

  // ── GECE ──
  startNight() {
    this.phase = PHASES.NIGHT;
    this.nightActions.clear();
    this.nightReports.clear();
    this.blocked.clear();
    this.locked.clear();
    this.deadThisNight = [];
    this.bombExplosions = [];
    this.hainKillVotesLive.clear();
    this.hainAbilityChoices.clear();
    this.players.forEach(p => { p.isShielded = false; p.isTempInsane = false; p.isSilenced = false; });
    this.silenced.clear();

    // Yeni rol gece state'leri
    this.imprisoned.clear();
    this.gardiyanShield = false;
    this.ambushTrap.clear();
    this.hackedTarget.clear();

    // Frozen sayacı: 1 olanlar gündüz açıldıktan sonra silinir, gece tekrar 0 olur
    // Burada hiçbir şey yapma — frozen kişiler gece de bloklu kalır (alt mantıkta)

    // Şerif intihar
    this.serifPendingSuicide.forEach(pid => {
      const p = this.players.get(pid);
      if (p?.isAlive) {
        p.isAlive = false;
        this.deadThisNight.push(pid);
        this.log(`🤠 ${p.name} (Şerif) vicdan azabından intihar etti.`);
      }
    });
    this.serifPendingSuicide.clear();

    // Ölümsüz dirilişi: önceki gece "ölü görünmüş" olanlar şimdi gerçekten geri döner
    this.olumsuzPending.forEach((revRound, pid) => {
      if (revRound === this.round) {
        const p = this.players.get(pid);
        if (p) {
          p.isAlive = true;
          this.log(`🪦 ${p.name} (Ölümsüz) geri döndü!`);
          // Tüm oyunculara bildirim için report
          // (Sabaha rapor gidecek)
        }
        this.olumsuzPending.delete(pid);
      }
    });

    this.sabotageVotes.clear();
    this.log(`🌙 Gece ${this.round}`);
  }

  // Hain canlı kill oyu
  setHainKillVote(pid, targetId) {
    const p = this.players.get(pid);
    if (!p?.isAlive || p.actualTeam !== TEAMS.HAIN) return false;
    if (this.phase !== PHASES.NIGHT) return false;
    if (targetId === null) {
      this.hainKillVotesLive.delete(pid);
    } else {
      // Toggle: aynı hedef tekrar seçilirse geri al
      if (this.hainKillVotesLive.get(pid) === targetId) {
        this.hainKillVotesLive.delete(pid);
      } else {
        this.hainKillVotesLive.set(pid, targetId);
      }
    }
    // Bu hain artık öldür modunda — yetenek seçimini sil
    this.hainAbilityChoices.delete(pid);
    this.nightActions.set(pid, { pid, role: p.role, team: p.actualTeam, action: 'kill', killTargetId: this.hainKillVotesLive.get(pid) || null });
    return true;
  }

  // Hain yetenek seçimi (öldür yerine)
  setHainAbility(pid, action) {
    const p = this.players.get(pid);
    if (!p?.isAlive || p.actualTeam !== TEAMS.HAIN) return false;
    if (this.phase !== PHASES.NIGHT) return false;
    this.hainKillVotesLive.delete(pid); // kill iptali
    this.hainAbilityChoices.set(pid, action);
    this.nightActions.set(pid, { pid, role: p.role, team: p.actualTeam, ...action });
    return true;
  }

  getHainKillVotes() {
    const o = {};
    this.hainKillVotesLive.forEach((tid, hid) => { o[hid] = tid; });
    return o;
  }

  submitAction(pid, action) {
    const p = this.players.get(pid);
    if (!p?.isAlive || this.phase !== PHASES.NIGHT) return false;

    // Yeni rol validasyonları (masum + tarafsız + hain hepsi için)
    if (p.role === 'demirci' && action.targetId === pid) return false; // Kendine zırh yok
    if (p.role === 'virus' && action.abilityTargetId === pid) return false; // Kendine virüs yok
    if (p.role === 'buzcu') {
      const left = this.buzcuLeft.has(pid) ? this.buzcuLeft.get(pid) : 2;
      if (left <= 0) return false; // Hak bitti
    }
    if (p.role === 'gardiyan' && action.action === 'shield') {
      if (this.gardiyanUsed.has(pid)) return false; // Zaten kullanıldı
    }
    if (p.role === 'pusucu') {
      // Kendine pusu kurabilir ama mantığı target gerektirmiyor — önemli değil
    }

    if (p.actualTeam === TEAMS.HAIN) {
      // Bombacı öldürme yapamaz
      if (p.role === 'bombaci' && action.action === 'kill') return false;
      // Bombacı: doğrudan nightActions'a
      if (p.role === 'bombaci') {
        this.nightActions.set(pid, { pid, role: p.role, team: p.actualTeam, ...action });
        return true;
      }
      // Pusucu, Hacker hain ability sayılır (kill değil)
      if (['pusucu', 'hacker'].includes(p.role)) {
        this.nightActions.set(pid, { pid, role: p.role, team: p.actualTeam, ...action });
        return true;
      }
      // Diğer hainler için özel akış
      if (action.action === 'kill') return this.setHainKillVote(pid, action.killTargetId);
      else return this.setHainAbility(pid, action);
    }
    this.nightActions.set(pid, { pid, role: p.role, team: p.actualTeam, ...action });
    return true;
  }

  isInsane(pid) { const p = this.players.get(pid); return p?.isInsane || p?.isTempInsane; }

  // ── GECE ÇÖZÜMLEME ──
  resolveNight() {
    const acts = [...this.nightActions.values()];
    const rep = new Map();
    this.players.forEach((_, id) => rep.set(id, []));

    // Gardiyan sokağa çıkma yasağı: bu gece gardiyan dışındaki tüm roller engellenir.
    // Bu yüzden bilgi rolleri rapor alamaz, saldırılar işlemez, tek kullanımlık haklar harcanmaz.
    acts.filter(a => a.role === 'gardiyan' && a.action === 'shield').forEach(a => {
      if (this.gardiyanUsed.has(a.pid)) return;
      const insane = this.isInsane(a.pid);
      this.gardiyanUsed.add(a.pid);
      if (insane) {
        rep.get(a.pid)?.push({ i: '🛡️', t: 'Sokağa çıkma yasağı ilan ettin! Ama sahte...' });
        this.hist(a.pid, 'Sokağa Çıkma Yasağı', '-', 'Sahte');
        return;
      }
      this.gardiyanShield = true;
      this.players.forEach((p, pid) => {
        if (!p.isAlive) return;
        this.blocked.add(pid);
        p.isShielded = true;
        rep.get(pid)?.push({ i: '🛡️', t: 'Bu gece SOKAĞA ÇIKMA YASAĞI vardı! Hiç kimse rol kullanamadı.' });
      });
      this.hist(a.pid, 'Sokağa Çıkma Yasağı', '-', 'Başarılı');
      this.log(`🛡️ Gardiyan ${this.pn(a.pid)} sokağa çıkma yasağı ilan etti.`);
    });

    if (this.gardiyanShield) {
      this.players.forEach(p => { p.isImmortal = false; });
      this.nightReports = rep;
      this.phase = PHASES.MORNING_REPORT;
      return rep;
    }

    // 1. POLİS + ÇİLİNGİR
    acts.filter(a => a.role === 'polis' && a.targetId).forEach(a => {
      const insane = this.isInsane(a.pid);
      if (!insane) {
        this.blocked.add(a.targetId);
        // Tutulan kişiye bildirim
        rep.get(a.targetId)?.push({ i: '🔦', t: 'Polis seni gece engelledi! Yeteneğini kullanamadın.' });
      }
      rep.get(a.pid)?.push({ i: '🔦', t: `${this.pn(a.targetId)} bu gece engellendi.` });
      this.hist(a.pid, 'Engelleme', this.pn(a.targetId), 'Başarılı');
    });

    // Çilingir: kilitle (blok + koruma) — deli ise hiçbir etkisi yok
    acts.filter(a => a.role === 'cilingir' && a.targetId).forEach(a => {
      const insane = this.isInsane(a.pid);
      const t = this.players.get(a.targetId);
      if (!t?.isAlive) return;
      if (!insane) {
        this.blocked.add(a.targetId);
        t.isShielded = true;
        this.locked.set(a.targetId, a.pid);
        rep.get(a.targetId)?.push({ i: '🔑', t: 'Çilingir seni evine kilitledi. Güvendeydin ama yetenek kullanamadın.' });
      }
      rep.get(a.pid)?.push({ i: '🔑', t: `${t.name} evine kilitlendi. Güvende ama yetenek kullanamaz.` });
      this.hist(a.pid, 'Kilitleme', t.name, 'Başarılı');
    });

    // BUZCU: Karantina (blok + koruma + ertesi gündüz oylama dışı)
    acts.filter(a => a.role === 'buzcu' && a.targetId).forEach(a => {
      const t = this.players.get(a.targetId); if (!t?.isAlive) return;
      const insane = this.isInsane(a.pid);
      if (!insane) {
        this.blocked.add(a.targetId);
        t.isShielded = true;
        this.locked.set(a.targetId, a.pid);
        // Hak azalt
        const left = (this.buzcuLeft.has(a.pid) ? this.buzcuLeft.get(a.pid) : 2) - 1;
        this.buzcuLeft.set(a.pid, left);
        // Ertesi gündüz oylama dışı
        this.frozen.set(a.targetId, 1);
        rep.get(a.targetId)?.push({ i: '❄️', t: 'Karantinaya alındın! Ertesi gündüz oylamaya katılamazsın.' });
      }
      rep.get(a.pid)?.push({ i: '❄️', t: `${t.name} karantinaya alındı. Kalan hak: ${this.buzcuLeft.get(a.pid)}` });
      this.hist(a.pid, 'Karantina', t.name, 'Başarılı');
    });

    // INFAZCI: zindan (blok + koruma)
    acts.filter(a => a.role === 'infazci' && a.targetId).forEach(a => {
      const t = this.players.get(a.targetId); if (!t?.isAlive) return;
      const insane = this.isInsane(a.pid);
      if (!insane) {
        this.blocked.add(a.targetId);
        t.isShielded = true;
        this.locked.set(a.targetId, a.pid);
        this.imprisoned.set(a.targetId, a.pid);
        // Eğer infazcı aynı zamanda execute=true gönderdiyse zindandakini idam et
        if (a.execute) {
          const left = this.infazExecutionsLeft.has(a.pid) ? this.infazExecutionsLeft.get(a.pid) : 1;
          if (left > 0) {
            this.infazExecutionsLeft.set(a.pid, left - 1);
            t.isAlive = false;
            this.deadThisNight.push(t.id);
            t.isShielded = false; // zaten ölü
            rep.get(a.pid)?.push({ i: '🔨', t: `${t.name} zindanda infaz edildi.` });
            rep.get(t.id)?.push({ i: '🔨', t: 'İnfazcı tarafından zindanda idam edildin!' });
            this.log(`🔨 İnfazcı ${this.pn(a.pid)} → ${t.name} idam`);
          } else {
            rep.get(a.pid)?.push({ i: '🔨', t: 'İnfaz hakkın bitti, sadece zindana attın.' });
          }
        } else {
          rep.get(a.targetId)?.push({ i: '🔨', t: 'Zindana atıldın. Yeteneğin engellendi ama saldırılardan korundun.' });
          rep.get(a.pid)?.push({ i: '🔨', t: `${t.name} zindana atıldı.` });
        }
      }
      this.hist(a.pid, 'Zindan', t.name, 'Başarılı');
    });

    // GARDİYAN: Sokağa çıkma yasağı (tüm köy korunur)
    acts.filter(a => a.role === 'gardiyan' && a.action === 'shield').forEach(a => {
      if (this.gardiyanUsed.has(a.pid)) return;
      const insane = this.isInsane(a.pid);
      if (insane) {
        rep.get(a.pid)?.push({ i: '🛡️', t: 'Sokağa çıkma yasağı ilan ettin! Ama sahte...' });
        return;
      }
      this.gardiyanUsed.add(a.pid);
      this.gardiyanShield = true;
      this.players.forEach(p => { if (p.isAlive) p.isShielded = true; });
      // Sabah herkes haberdar olsun
      this.players.forEach((_, pid) => {
        rep.get(pid)?.push({ i: '🛡️', t: 'Bu gece SOKAĞA ÇIKMA YASAĞI vardı! Hiç kimse zarar göremedi.' });
      });
      this.hist(a.pid, 'Sokağa Çıkma Yasağı', '-', 'Başarılı');
      this.log(`🛡️ Gardiyan ${this.pn(a.pid)} sokağa çıkma yasağı ilan etti.`);
    });

    // HACKER: bilgi toplayan rolü hedef alır
    acts.filter(a => a.role === 'hacker' && a.abilityTargetId).forEach(a => {
      const insane = this.isInsane(a.pid);
      if (insane) {
        rep.get(a.pid)?.push({ i: '💻', t: `${this.pn(a.abilityTargetId)} hacklendi (sahte)` });
        return;
      }
      this.hackedTarget.set(a.pid, a.abilityTargetId);
      rep.get(a.pid)?.push({ i: '💻', t: `${this.pn(a.abilityTargetId)} hacklendi.` });
      this.hist(a.pid, 'Hack', this.pn(a.abilityTargetId), 'Başarılı');
    });

    // PUSUCU: pusu kurar — kim ona gelirse rastgele biri ölür
    // Burada sadece hazırlık; gerçek tetikleme aşağıda kim kime gitti kontrolünde
    acts.filter(a => a.role === 'pusucu').forEach(a => {
      const insane = this.isInsane(a.pid);
      if (insane) {
        rep.get(a.pid)?.push({ i: '🪤', t: 'Pusu kurdun (sahte)' });
        return;
      }
      this.ambushTrap.set(a.pid, []); // Bu gece aktif
      rep.get(a.pid)?.push({ i: '🪤', t: 'Pusu kurdun. Bu gece sana gelen biri rastgele ölecek.' });
      this.hist(a.pid, 'Pusu', '-', 'Başarılı');
    });

    const eff = acts.filter(a => !this.blocked.has(a.pid));

    // 2. HİPNOTİZMACI + GÖLGE
    eff.filter(a => a.role === 'hipnotizmaci' && a.abilityTargetId).forEach(a => {
      const t = this.players.get(a.abilityTargetId);
      if (t?.isAlive) {
        // Çilingir kilitlediyse etki etmez
        if (this.locked.has(a.abilityTargetId)) {
          rep.get(a.pid)?.push({ i: '🌀', t: `${t.name} korunuyordu, hipnotize edemedin.` });
          this.hist(a.pid, 'Hipnotize', t.name, 'Engellendi (korunma)');
          return;
        }
        t.isTempInsane = true;
        rep.get(a.pid)?.push({ i: '🌀', t: `${t.name} bu gece deli yapıldı.` });
        this.hist(a.pid, 'Hipnotize', t.name, 'Başarılı');
      }
    });
    eff.filter(a => a.role === 'golge' && a.abilityTargetId).forEach(a => {
      const t = this.players.get(a.abilityTargetId);
      if (t?.isAlive) {
        // Çilingir kilitlediyse etki etmez
        if (this.locked.has(a.abilityTargetId)) {
          rep.get(a.pid)?.push({ i: '👤', t: `${t.name} korunuyordu, susturamadın.` });
          this.hist(a.pid, 'Susturma', t.name, 'Engellendi (korunma)');
          return;
        }
        t.isSilenced = true;
        this.silenced.set(a.abilityTargetId, a.pid);
        rep.get(a.pid)?.push({ i: '👤', t: `${t.name} yarın konuşamayacak.` });
        rep.get(a.abilityTargetId)?.push({ i: '🤐', t: 'Biri seni susturdu! Yarın konuşamayacaksın.' });
        this.hist(a.pid, 'Susturma', t.name, 'Başarılı');
      }
    });

    // 3. DOKTOR + GAZİ
    const doktorActs = eff.filter(a => a.role === 'doktor' && a.targetId);
    doktorActs.forEach(a => {
      const insane = this.isInsane(a.pid);
      const t = this.players.get(a.targetId);
      if (!t?.isAlive) return;
      if (a.targetId === a.pid) {
        if (this.doktorSelfUsed.has(a.pid)) {
          rep.get(a.pid)?.push({ i: '🩺', t: 'Kendini zaten korumuştun.' });
          return;
        }
        this.doktorSelfUsed.add(a.pid);
      }
      if (!insane) t.isShielded = true;
      this.hist(a.pid, 'Koruma', t.name, 'Bekliyor');
    });
    eff.filter(a => a.role === 'gazi' && a.action === 'activate').forEach(a => {
      if (this.gaziUsed.has(a.pid)) return;
      this.gaziUsed.add(a.pid);
      const insane = this.isInsane(a.pid);
      if (!insane) this.players.get(a.pid).isImmortal = true;
      rep.get(a.pid)?.push({ i: '🛡️', t: 'Bu gece ölümsüzsün!' });
      this.hist(a.pid, 'Ölümsüzlük', '-', 'Aktif');
    });

    // 4. HAİN ÖLDÜRME (her hain ayrı kill yapabilir - multi mode)
    const hainKills = eff.filter(a => a.team === TEAMS.HAIN && a.action === 'kill' && a.killTargetId);

    if (this.hainKillMode === 'single') {
      // Tek kill: en çok oy alan
      const tally = new Map();
      hainKills.forEach(a => tally.set(a.killTargetId, (tally.get(a.killTargetId) || 0) + 1));
      let max = 0, targets = [];
      tally.forEach((v, tid) => {
        if (v > max) { max = v; targets = [tid]; }
        else if (v === max) targets.push(tid);
      });
      if (targets.length > 0) {
        const target = targets[crypto.randomInt(0, targets.length)];
        this.tryKill(target, 'hain', rep, hainKills.map(a => a.pid));
      }
    } else {
      // Multi: her hain kendi hedefini öldürür
      const killed = new Set();
      hainKills.forEach(a => {
        if (!killed.has(a.killTargetId)) {
          this.tryKill(a.killTargetId, 'hain', rep, [a.pid]);
          killed.add(a.killTargetId);
        } else {
          rep.get(a.pid)?.push({ i: '🧛', t: `${this.pn(a.killTargetId)} zaten saldırıldı.` });
        }
      });
    }

    // 5. SERİ KATİL
    eff.filter(a => a.role === 'seri_katil' && a.action === 'kill' && a.targetId).forEach(a => {
      this.tryKill(a.targetId, 'seri_katil', rep, [a.pid]);
    });

    // 5b. ŞERİF (tek kullanım vurma)
    eff.filter(a => a.role === 'serif' && a.action === 'shoot' && a.targetId).forEach(a => {
      if (this.serifUsed.has(a.pid)) {
        rep.get(a.pid)?.push({ i: '🤠', t: 'Silahını zaten kullandın.' });
        return;
      }
      this.serifUsed.add(a.pid);
      const insane = this.isInsane(a.pid);
      const t = this.players.get(a.targetId);
      if (!t?.isAlive) return;

      if (insane) {
        // Deli Şerif: silah tutukluk yapar, kimse ölmez ama "Vurdun!" raporu alır
        rep.get(a.pid)?.push({ i: '🤠', t: `${t.name}'i vurdun!` });
        this.hist(a.pid, 'Vurma', t.name, 'Başarılı');
        this.log(`🤠 Deli Şerif ${this.pn(a.pid)} → ${t.name} (tutukluk - sahte)`);
      } else {
        const targetRole = this.ro(t.role);
        const targetTeam = t.actualTeam;
        if (targetTeam === TEAMS.HAIN || targetTeam === TEAMS.TARAFSIZ) {
          // Hain/Tarafsız vuruldu → hedef ölür
          if (!t.isShielded && !t.isImmortal) {
            t.isAlive = false;
            this.deadThisNight.push(t.id);
            rep.get(a.pid)?.push({ i: '🤠', t: `${t.name}'i vurdun! Kasaba için kahraman oldun!` });
            rep.get(t.id)?.push({ i: '🤠', t: 'Şerif tarafından vuruldun!' });
            this.log(`🤠 Şerif ${this.pn(a.pid)} → ${t.name} vuruldu (${targetTeam})`);
          } else {
            rep.get(a.pid)?.push({ i: '🤠', t: `${t.name}'i vurdun ama korunuyordu!` });
          }
          this.hist(a.pid, 'Vurma', t.name, 'Kahraman');
        } else {
          // Masum vuruldu → hedef ölür, şerif ertesi gece intihar
          if (!t.isShielded && !t.isImmortal) {
            t.isAlive = false;
            this.deadThisNight.push(t.id);
            rep.get(a.pid)?.push({ i: '🤠', t: `${t.name}'i vurdun... Ama masumlarmış! Vicdan azabı...` });
            rep.get(t.id)?.push({ i: '🤠', t: 'Şerif tarafından vuruldun!' });
            this.serifPendingSuicide.add(a.pid);
            this.log(`🤠 Şerif ${this.pn(a.pid)} → ${t.name} MASUM vuruldu. İntihar bekliyor.`);
          } else {
            rep.get(a.pid)?.push({ i: '🤠', t: `${t.name}'i vurdun ama korunuyordu!` });
          }
          this.hist(a.pid, 'Vurma', t.name, 'Masum - Vicdan azabı');
        }
      }
    });

    // 6. BOMBACI
    this.bombExplosions = []; // Patlama bilgisi frontend'e gönderilecek
    eff.filter(a => a.role === 'bombaci').forEach(a => {
      if (a.action === 'place' && a.abilityTargetId) {
        const t = this.players.get(a.abilityTargetId);
        if (t?.isAlive) {
          this.bombs.set(a.abilityTargetId, { placedRound: this.round, ownerId: a.pid });
          rep.get(a.pid)?.push({ i: '💣', t: `${t.name}'e bomba kondu.` });
          this.hist(a.pid, 'Bomba koyma', t.name, 'Yerleştirildi');
        }
      } else if (a.action === 'detonate') {
        const exp = [];
        this.bombs.forEach((b, tid) => {
          if (b.ownerId === a.pid && b.placedRound < this.round) {
            const t = this.players.get(tid);
            if (t?.isAlive && !t.isShielded && !t.isImmortal) {
              t.isAlive = false;
              this.deadThisNight.push(tid);
              rep.get(tid)?.push({ i: '💣', t: 'Üzerindeki bomba patladı!' });
              exp.push({ id: tid, name: t.name });
            }
          }
        });
        [...this.bombs.entries()].filter(([_, b]) => b.ownerId === a.pid && b.placedRound < this.round).forEach(([tid]) => this.bombs.delete(tid));
        rep.get(a.pid)?.push({ i: '💣', t: exp.length ? `Patlatıldı: ${exp.map(e => e.name).join(', ')}` : 'Patlatılacak bomba yok.' });
        this.hist(a.pid, 'Patlatma', exp.map(e => e.name).join(', ') || '-', exp.length ? 'Başarılı' : 'Boş');
        if (exp.length > 0) {
          this.bombExplosions = exp;
          // Herkese bomba patladı raporu
          this.players.forEach((_, pid) => {
            if (!exp.some(e => e.id === pid)) {
              rep.get(pid)?.push({ i: '💥', t: `BOMBA PATLADI! ${exp.map(e => e.name).join(', ')} patlamada hayatını kaybetti!` });
            }
          });
          this.log(`💥 BOMBA PATLADI: ${exp.map(e => e.name).join(', ')}`);
        }
      }
    });

    // 7. DOKTOR KURTARMA RAPORU
    doktorActs.forEach(a => {
      const insane = this.isInsane(a.pid);
      const t = this.players.get(a.targetId);
      if (!t) return;
      const wasAttacked = hainKills.some(k => k.killTargetId === a.targetId)
        || eff.some(k => k.role === 'seri_katil' && k.targetId === a.targetId);
      let txt;
      if (insane) {
        txt = crypto.randomInt(0, 2) > 0 ? `${t.name}'i kurtardın!` : `${t.name}'e saldırı olmadı.`;
      } else if (t.isShielded && wasAttacked && t.isAlive) {
        txt = `${t.name}'i kurtardın!`;
        rep.get(a.targetId)?.push({ i: '🩺', t: 'Saldırıya uğradın ama kurtarıldın!' });
      } else {
        txt = `${t.name}'e saldırı olmadı.`;
      }
      rep.get(a.pid)?.push({ i: '🩺', t: txt });
    });

    // 7b. KURBAN VASİYETİ
    // Kurban öldürüldüyse, kill moduna göre katil bilgisi verir
    this.deadThisNight.forEach(did => {
      const dead = this.players.get(did);
      if (!dead || dead.role !== 'kurban') return;
      const isDeadInsane = dead.isInsane || dead.isTempInsane;

      // Seri katil mi öldürdü?
      const skAction = eff.find(k => k.role === 'seri_katil' && k.targetId === did);
      const serifAction = eff.find(k => k.role === 'serif' && k.targetId === did);
      const hainKillAction = hainKills.find(k => k.killTargetId === did);

      if (skAction) {
        // Seri Katil öldürdüyse: seri katil iz bırakmaz, vasiyet sadece "Seri Katil tarafından öldürüldü" der
        // (Seri katilin KİM olduğunu vermez)
        this.players.forEach((_, pid) => {
          rep.get(pid)?.push({ i: '🩸', t: `Kurban ${dead.name} son nefesinde bir Seri Katil tarafından öldürüldüğünü söyledi!` });
        });
        this.log(`🩸 Kurban ${dead.name} → vasiyet: Seri Katil (anonim)`);
      } else if (serifAction) {
        // Şerif vurduysa
        const killerName = this.pn(serifAction.pid);
        if (isDeadInsane) {
          const allAlive = this.alive().filter(p => p.id !== did);
          const rp = allAlive[crypto.randomInt(0, allAlive.length)];
          const fakeName = rp ? rp.name : killerName;
          this.players.forEach((_, pid) => {
            rep.get(pid)?.push({ i: '🩸', t: `Kurban ${dead.name} son nefesinde katilinin ${fakeName} olduğunu söyledi!` });
          });
          this.log(`🩸 Deli Kurban ${dead.name} → sahte vasiyet: ${fakeName}`);
        } else {
          this.players.forEach((_, pid) => {
            rep.get(pid)?.push({ i: '🩸', t: `Kurban ${dead.name} son nefesinde katilinin ${killerName} olduğunu söyledi!` });
          });
          this.log(`🩸 Kurban ${dead.name} → vasiyet: ${killerName}`);
        }
      } else if (hainKillAction) {
        // Hainler öldürdü — kill moduna göre:
        let killerName = null;
        if (this.hainKillMode === 'single') {
          // Tek kill: oy veren hainlerden rastgele birini söyle (rol kullananı değil, oy vereni)
          const voters = hainKills.filter(k => k.killTargetId === did);
          if (voters.length > 0) {
            const randomVoter = voters[crypto.randomInt(0, voters.length)];
            killerName = this.pn(randomVoter.pid);
          }
        } else {
          // Multi kill: doğrudan öldüren kişiyi söyle
          killerName = this.pn(hainKillAction.pid);
        }

        if (killerName) {
          if (isDeadInsane) {
            const allAlive = this.alive().filter(p => p.id !== did);
            const rp = allAlive[crypto.randomInt(0, allAlive.length)];
            const fakeName = rp ? rp.name : killerName;
            this.players.forEach((_, pid) => {
              rep.get(pid)?.push({ i: '🩸', t: `Kurban ${dead.name} son nefesinde katilinin ${fakeName} olduğunu söyledi!` });
            });
            this.log(`🩸 Deli Kurban ${dead.name} → sahte vasiyet: ${fakeName}`);
          } else {
            this.players.forEach((_, pid) => {
              rep.get(pid)?.push({ i: '🩸', t: `Kurban ${dead.name} son nefesinde katilinin ${killerName} olduğunu söyledi!` });
            });
            this.log(`🩸 Kurban ${dead.name} → vasiyet: ${killerName}`);
          }
        }
      }
    });

    // 8. BİLGİ TOPLAMA
    eff.filter(a => a.role === 'savci' && a.targetId).forEach(a => {
      const insane = this.isInsane(a.pid);
      if (this.savciUsed.has(a.pid) && !insane) {
        rep.get(a.pid)?.push({ i: '⚖️', t: 'Sorgulama hakkını kullandın.' });
        return;
      }
      if (!insane) this.savciUsed.add(a.pid);
      const t = this.players.get(a.targetId); if (!t) return;
      const realRole = this.ro(t.role);
      if (insane) {
        const allR = Object.values(ROLES).filter(r => r.id !== 'deli');
        const fake = allR[crypto.randomInt(0, allR.length)];
        const fakeTeam = ['masum','hain','tarafsiz'][crypto.randomInt(0, 3)];
        rep.get(a.pid)?.push({ i: '⚖️', t: `${t.name}: ${fake.emoji} ${fake.name} (${fakeTeam})` });
      } else {
        rep.get(a.pid)?.push({ i: '⚖️', t: `${t.name}: ${realRole?.emoji} ${realRole?.name} (${t.actualTeam})` });
      }
      this.hist(a.pid, 'Sorgulama', t.name, insane ? realRole?.name : realRole?.name);
    });

    eff.filter(a => a.role === 'gazeteci' && a.targetId).forEach(a => {
      const insane = this.isInsane(a.pid);
      const t = this.players.get(a.targetId); if (!t) return;
      // Seri Katil iz bırakmaz — gazeteci her zaman "Rol kullanmadı" görür
      const isSK = t.role === 'seri_katil';
      const used = isSK ? false : this.nightActions.has(a.targetId);
      const result = insane ? crypto.randomInt(0, 2) > 0 : used;
      rep.get(a.pid)?.push({ i: '📰', t: `${t.name}: ${result ? 'Rol kullandı' : 'Rol kullanmadı'}` });
      this.hist(a.pid, 'Araştırma', t.name, result ? 'Aktif' : 'Pasif');
    });

    eff.filter(a => a.role === 'psikolog' && a.targetId).forEach(a => {
      const insane = this.isInsane(a.pid);
      const t = this.players.get(a.targetId); if (!t) return;
      const ti = t.isInsane || t.isTempInsane;
      const result = insane ? !ti : ti;
      rep.get(a.pid)?.push({ i: '🧠', t: `${t.name}: ${result ? 'Deli' : 'Aklı başında'}` });
      this.hist(a.pid, 'Analiz', t.name, result ? 'Deli' : 'Normal');
    });

    eff.filter(a => a.role === 'dedikoducu' && a.target1Id && a.target2Id).forEach(a => {
      const insane = this.isInsane(a.pid);
      const t1 = this.players.get(a.target1Id), t2 = this.players.get(a.target2Id);
      if (!t1 || !t2) return;
      // Hedeflerden biri engellenmiş (polis/çilingir) ise dedikoducu yeteneğini kullanamaz
      const t1Blocked = this.blocked.has(a.target1Id);
      const t2Blocked = this.blocked.has(a.target2Id);
      if (t1Blocked || t2Blocked) {
        const blockedName = t1Blocked ? t1.name : t2.name;
        rep.get(a.pid)?.push({ i: '🗣️', t: `${blockedName} ulaşılamadı, dedikoducu yapamadın.` });
        this.hist(a.pid, 'Dedikodu', `${t1.name} & ${t2.name}`, 'Engellendi');
        return;
      }
      const same = t1.actualTeam === t2.actualTeam;
      const result = insane ? crypto.randomInt(0, 2) > 0 : same;
      rep.get(a.pid)?.push({ i: '🗣️', t: `${t1.name} & ${t2.name}: ${result ? 'Aynı takım' : 'Farklı takım'}` });
      this.hist(a.pid, 'Dedikodu', `${t1.name} & ${t2.name}`, result ? 'Aynı' : 'Farklı');
    });

    eff.filter(a => a.role === 'ajan' && a.targetId).forEach(a => {
      const insane = this.isInsane(a.pid);
      const t = this.players.get(a.targetId); if (!t) return;
      const realR = this.ro(t.role);
      const realTeam = realR?.team || t.actualTeam;
      // Oyunda hangi takımlar var? Tarafsız hiç yoksa seçeneklerden çıkar
      const aliveAndDead = [...this.players.values()];
      const hasTarafsiz = aliveAndDead.some(p => p.actualTeam === TEAMS.TARAFSIZ);
      const all = Object.values(ROLES).filter(r => {
        if (r.id === 'deli') return false;
        // Tarafsız oyunda yoksa tarafsız rolleri seçeneklerden çıkar
        if (!hasTarafsiz && r.team === TEAMS.TARAFSIZ) return false;
        return true;
      });
      let opts;
      if (insane) {
        // Deli ajan: takımlar DOĞRU ama roller RASTGELE
        const shuffled = this.shuf([...all]);
        opts = shuffled.slice(0, 3).map(r => `${r.team} ${r.name}`);
      } else {
        // Normal: doğru cevap + 2 yanlış
        const correct = `${realTeam} ${realR.name}`;
        const others = this.shuf(all.filter(r => r.id !== t.role)).slice(0, 2)
          .map(r => `${r.team} ${r.name}`);
        opts = this.shuf([correct, ...others]);
      }
      rep.get(a.pid)?.push({ i: '🕵️', t: `${t.name}: ${opts.join(' / ')}` });
      this.hist(a.pid, 'Ajan', t.name, opts.join(', '));
    });

    // 8b. TAKİPÇİ
    eff.filter(a => a.role === 'takipci' && a.targetId).forEach(a => {
      const insane = this.isInsane(a.pid);
      const t = this.players.get(a.targetId); if (!t) return;
      // Seri Katil iz bırakmaz — takipçi de onu göremez
      if (t.role === 'seri_katil' && !insane) {
        rep.get(a.pid)?.push({ i: '👣', t: `${t.name}: Bu gece hiçbir şey yapmadı.` });
        this.hist(a.pid, 'Takip', t.name, 'Hiçbir şey yapmadı');
        return;
      }
      // Takip edilen kişinin gece aksiyonundaki hedefini bul
      const targetAction = this.nightActions.get(a.targetId);
      if (insane) {
        // Deli: rastgele bir isim ve rastgele aktif/pasif
        const allAlive = this.alive().filter(p => p.id !== a.pid);
        if (crypto.randomInt(0, 2) > 0 && allAlive.length > 0) {
          const rp = allAlive[crypto.randomInt(0, allAlive.length)];
          rep.get(a.pid)?.push({ i: '👣', t: `${t.name}: ${rp.name} kişisine rol kullandı.` });
          this.hist(a.pid, 'Takip', t.name, `${rp.name}'e gitti (sahte)`);
        } else {
          rep.get(a.pid)?.push({ i: '👣', t: `${t.name}: Bu gece hiçbir şey yapmadı.` });
          this.hist(a.pid, 'Takip', t.name, 'Hiçbir şey yapmadı');
        }
        return;
      }
      if (!targetAction) {
        rep.get(a.pid)?.push({ i: '👣', t: `${t.name}: Bu gece hiçbir şey yapmadı.` });
        this.hist(a.pid, 'Takip', t.name, 'Hiçbir şey yapmadı');
        return;
      }
      // Hedefin aksiyonundaki targetId'yi bul
      const actionTarget = targetAction.targetId || targetAction.killTargetId || targetAction.abilityTargetId || targetAction.target1Id;
      if (actionTarget) {
        const at = this.players.get(actionTarget);
        const atName = at ? at.name : '?';
        rep.get(a.pid)?.push({ i: '👣', t: `${t.name}: ${atName} kişisine rol kullandı.` });
        this.hist(a.pid, 'Takip', t.name, `${atName}'e gitti`);
      } else {
        rep.get(a.pid)?.push({ i: '👣', t: `${t.name}: Bu gece hiçbir şey yapmadı.` });
        this.hist(a.pid, 'Takip', t.name, 'Hiçbir şey yapmadı');
      }
    });

    // ── PUSU TETİKLEME ──
    // ambushTrap aktif olan pusucuların evine kim "geldiyse" (targetId/abilityTargetId/killTargetId/target1Id/target2Id pusucu olanlar)
    // bunlardan rastgele biri ölür
    this.ambushTrap.forEach((_, pusucuId) => {
      const visitors = [];
      eff.forEach(a => {
        if (a.pid === pusucuId) return;
        const targets = [a.targetId, a.abilityTargetId, a.killTargetId, a.target1Id, a.target2Id].filter(Boolean);
        if (targets.includes(pusucuId)) visitors.push(a.pid);
      });
      // Hain kill votes da kontrol et (multi mod)
      this.hainKillVotesLive.forEach((tid, hid) => {
        if (tid === pusucuId && !visitors.includes(hid)) visitors.push(hid);
      });
      if (visitors.length > 0) {
        const victim = visitors[crypto.randomInt(0, visitors.length)];
        const v = this.players.get(victim);
        if (v?.isAlive && !v.isShielded && !v.isImmortal) {
          v.isAlive = false;
          this.deadThisNight.push(victim);
          rep.get(victim)?.push({ i: '🪤', t: 'Bir pusuya düştün ve öldün!' });
          rep.get(pusucuId)?.push({ i: '🪤', t: `${v.name} pusuya düşüp öldü.` });
          this.log(`🪤 Pusucu ${this.pn(pusucuId)} → ${v.name} pusuda öldü`);
        }
      }
    });

    // ── DEMİRCİ ──
    // Çelik zırh: kalıcı korunma (bir saldırı emer)
    eff.filter(a => a.role === 'demirci' && a.targetId).forEach(a => {
      const t = this.players.get(a.targetId); if (!t?.isAlive) return;
      if (a.targetId === a.pid) return; // Kendine zırh yapamaz
      const insane = this.isInsane(a.pid);
      if (insane) {
        rep.get(a.pid)?.push({ i: '⚒️', t: `${t.name}'e zırh giydirdin (sahte)` });
        return;
      }
      this.steelArmor.set(a.targetId, a.pid);
      rep.get(a.pid)?.push({ i: '⚒️', t: `${t.name}'e Çelik Zırh giydirdin.` });
      this.hist(a.pid, 'Zırh', t.name, 'Aktif');
    });

    // ── KÖSTEBEK (Hain Savcı) ──
    // 2 rol seçeneği gösterir, biri gerçek. Hain rolleri seçenek olarak gelmez.
    eff.filter(a => a.role === 'kostebek' && a.targetId).forEach(a => {
      const t = this.players.get(a.targetId); if (!t) return;
      const insane = this.isInsane(a.pid);
      const realRole = this.ro(t.role);
      if (insane) {
        // Deli köstebek: 2 rastgele rol
        const allRoles = Object.values(ROLES).filter(r => r.id !== 'deli' && r.team !== TEAMS.HAIN);
        const sh = this.shuf([...allRoles]).slice(0, 2);
        rep.get(a.pid)?.push({ i: '🦔', t: `${t.name}: ${sh[0].name} veya ${sh[1].name}` });
        return;
      }
      // Hedef hain ise: hangi rol gösterilecek? "Hain seçenekte gelmez" — masum/tarafsız 2 rol gösterelim
      let candidates;
      if (t.actualTeam === TEAMS.HAIN) {
        // Hedef hain ise gerçek rolü hain — biz 2 sahte masum/tarafsız rol veriyoruz (ama tek bir doğru rolün olması lazım — bu özel durum, 2 rastgele masum/tarafsız ver)
        candidates = Object.values(ROLES).filter(r => r.id !== 'deli' && r.team !== TEAMS.HAIN);
        const sh = this.shuf([...candidates]).slice(0, 2);
        rep.get(a.pid)?.push({ i: '🦔', t: `${t.name}: ${sh[0].name} veya ${sh[1].name}` });
        this.hist(a.pid, 'Köstebek', t.name, `${sh[0].name}/${sh[1].name}`);
        return;
      }
      // Normal: gerçek rol + 1 sahte (hain olmayan)
      candidates = Object.values(ROLES).filter(r => r.id !== 'deli' && r.id !== t.role && r.team !== TEAMS.HAIN);
      const fake = this.shuf([...candidates])[0];
      const arr = this.shuf([realRole, fake]);
      rep.get(a.pid)?.push({ i: '🦔', t: `${t.name}: ${arr[0].name} veya ${arr[1].name}` });
      this.hist(a.pid, 'Köstebek', t.name, `${arr[0].name}/${arr[1].name}`);
    });

    // ── VİRÜS ──
    // Önce: önceki gece enfekte olan ve bu gece aksiyon yapan birini öldür (eğer hedefi varsa)
    this.infected.forEach((info, infectedId) => {
      // Bu gece aksiyon yaptı mı?
      const action = eff.find(a => a.pid === infectedId);
      if (!action) return;
      const actTarget = action.targetId || action.abilityTargetId || action.killTargetId || action.target1Id;
      if (!actTarget) return;
      const t = this.players.get(actTarget);
      if (!t?.isAlive) return;
      // Hedef öldür
      if (!t.isShielded && !t.isImmortal && !this.steelArmor.has(actTarget)) {
        t.isAlive = false;
        this.deadThisNight.push(actTarget);
        rep.get(actTarget)?.push({ i: '🦠', t: 'Bir virüse maruz kaldın ve öldün!' });
        // Virüs kendisi de bilgilendirilsin
        rep.get(info.byId)?.push({ i: '🦠', t: `${t.name} virüsünün kurbanı oldu (${this.pn(infectedId)} aracılığıyla).` });
        this.log(`🦠 Virüs etkili → ${t.name} öldü (taşıyıcı: ${this.pn(infectedId)})`);
      }
      // Enfeksiyon biter (tek seferlik)
      this.infected.delete(infectedId);
    });

    // Sonra: bu gece yeni virüs bulaştır
    eff.filter(a => a.role === 'virus' && a.abilityTargetId).forEach(a => {
      if (a.abilityTargetId === a.pid) return;
      const t = this.players.get(a.abilityTargetId); if (!t?.isAlive) return;
      const insane = this.isInsane(a.pid);
      if (insane) {
        rep.get(a.pid)?.push({ i: '🦠', t: `${t.name}'e virüs bulaştırdın (sahte)` });
        return;
      }
      this.infected.set(a.abilityTargetId, { byId: a.pid, sinceRound: this.round });
      this.virusInactiveRounds.set(a.pid, 0); // Aksiyon yaptı, sayaç sıfırlanır
      rep.get(a.pid)?.push({ i: '🦠', t: `${t.name}'e virüs bulaştı. Yarın yetenek kullanırsa hedefi ölecek.` });
      this.hist(a.pid, 'Virüs', t.name, 'Bulaştı');
    });

    // Virüs sahibi 2 gece aksiyon yapmadıysa öldür
    this.players.forEach(p => {
      if (p.role === 'virus' && p.isAlive) {
        const acted = eff.some(a => a.pid === p.id && a.abilityTargetId);
        const inactive = (this.virusInactiveRounds.get(p.id) || 0) + (acted ? 0 : 1);
        if (acted) this.virusInactiveRounds.set(p.id, 0);
        else this.virusInactiveRounds.set(p.id, inactive);
        if (inactive >= 2) {
          // 2.gece aksiyon yok — sabah ölür
          if (!p.isShielded && !p.isImmortal) {
            p.isAlive = false;
            this.deadThisNight.push(p.id);
            rep.get(p.id)?.push({ i: '🦠', t: 'Kendi virüsüne yenik düştün ve öldün!' });
            this.log(`🦠 Virüs ${p.name} kendi virüsüyle öldü`);
          }
        } else if (inactive === 1) {
          rep.get(p.id)?.push({ i: '🦠', t: '⚠️ Hastalandın! Bu gece de aksiyon yapmazsan ölürsün.' });
        }
      }
    });

    // ── VEBA ──
    eff.filter(a => a.role === 'veba' && a.targetId).forEach(a => {
      const t = this.players.get(a.targetId); if (!t?.isAlive) return;
      if (a.targetId === a.pid) return;
      this.plagued.set(a.targetId, a.pid);
      // Hedefe bildirim YOK (gizli)
      rep.get(a.pid)?.push({ i: '☠️', t: `${t.name}'e hastalık bulaştırdın.` });
      this.hist(a.pid, 'Hastalık', t.name, 'Bulaştı');
    });
    this.deadThisNight.forEach(did => {
      const dead = this.players.get(did); if (!dead) return;
      this.players.forEach(p => {
        if (p.role === 'yamyam' && p.isAlive) {
          const ya = this.yamyamAbilities.get(p.id) || [];
          ya.push(dead.role);
          this.yamyamAbilities.set(p.id, ya);
          rep.get(p.id)?.push({ i: '🍖', t: `${dead.name}'in yeteneği toplandı: ${this.ro(dead.role)?.name}` });
        }
      });
    });

    // ── ÖLÜMSÜZ ──
    // Ölü ama henüz canlanmamış olanlar için: bu gece öldüyse, ertesi gece dönsün
    this.deadThisNight.forEach(did => {
      const p = this.players.get(did);
      if (p?.role === 'olumsuz' && !this.olumsuzUsed.has(did)) {
        this.olumsuzUsed.add(did);
        // Ertesi gece dirilecek (round + 1)
        this.olumsuzPending.set(did, this.round + 1);
        // Ölmüş gibi görünür ama gerçekte dirilecek
        // (oyuna sabaha "ölü" olarak duyurulur, dödünce otomatik canlanır)
        rep.get(did)?.push({ i: '🪦', t: 'Öldün... ama Ölümsüzlüğün seni geri getirecek!' });
      }
    });

    // ── HACKER FİLTRESİ ──
    // Hacker hedefi olan ve bilgi toplayan rolün raporlarını sil
    // Bilgi toplayan roller: gazeteci, savcı, psikolog, dedikoducu, ajan, takipçi, polis (bilgi alır), köstebek, kostebek
    const infoCollectorRoles = ['gazeteci','savci','psikolog','dedikoducu','ajan','takipci','kostebek','polis','cilingir'];
    this.hackedTarget.forEach((targetId, hackerId) => {
      const t = this.players.get(targetId);
      if (!t?.isAlive) return;
      if (!infoCollectorRoles.includes(t.role)) return;
      // Eğer bu kişi gece aksiyon yaptıysa ve gazi gibi koruyucu kullanmadıysa raporları temizle
      const action = eff.find(a => a.pid === targetId);
      if (!action) return;
      // Gazi self-shield kullanmışsa hacker etkisiz
      if (action.role === 'gazi' && action.action === 'activate') return;
      // Raporları sil
      const oldReports = rep.get(targetId) || [];
      const filteredReports = oldReports.filter(r => 
        // Sadece sistem mesajlarını koru (saldırı, ölüm vb. bilgiler)
        !r.i || ['🛡️','⚒️','💀','🪦','🪤','🦠','🤐','🔑','🔦','❄️','🔨','💣'].includes(r.i)
      );
      filteredReports.push({ i: '💻', t: 'İletişim ağı bozuldu! Bu gece hiçbir bilgi raporu alamadın.' });
      rep.set(targetId, filteredReports);
      this.log(`💻 Hacker ${this.pn(hackerId)} → ${t.name} (raporlar silindi)`);
    });

    // ── VEBA SAYIM ──
    // Tüm hayatta olanlar hastalandı mı?
    const veba = [...this.players.values()].find(p => p.role === 'veba' && p.isAlive);
    if (veba) {
      const aliveNonVeba = this.alive().filter(p => p.id !== veba.id);
      const allInfected = aliveNonVeba.length > 0 && aliveNonVeba.every(p => this.plagued.has(p.id));
      if (allInfected) {
        // Veba kazandı — tüm hastaları öldür
        aliveNonVeba.forEach(p => {
          p.isAlive = false;
          this.deadThisNight.push(p.id);
          rep.get(p.id)?.push({ i: '☠️', t: 'Vebaya yenik düştün!' });
        });
        rep.get(veba.id)?.push({ i: '☠️', t: 'TÜM köy hastalandı! Sen kazandın!' });
        this.log(`☠️ Veba ${veba.name} tüm köyü etkiledi`);
        this.vebaWins = true; // checkWin bunu kullanacak
      }
    }

    this.players.forEach(p => { p.isImmortal = false; });
    this.nightReports = rep;
    // Sabotaj kontrolü
    this._checkSabotageActivation();
    this.phase = PHASES.MORNING_REPORT;
    return rep;
  }

  tryKill(tid, src, rep, attackers) {
    const t = this.players.get(tid);
    if (!t?.isAlive) return;
    // Çelik zırh: tek saldırı emer, sonra kırılır. Demirci'ye haber gitmez.
    if (this.steelArmor.has(tid)) {
      const demirciId = this.steelArmor.get(tid);
      this.steelArmor.delete(tid); // zırh kırıldı
      attackers.forEach(aid => {
        rep.get(aid)?.push({ i: '⚒️', t: `${t.name} bir zırhla korunuyordu! Saldırı emildi.` });
        this.hist(aid, 'Öldürme', t.name, 'Engellendi (zırh)');
      });
      // Hedefe bildirim — zırh seni kurtardı
      rep.get(tid)?.push({ i: '⚒️', t: 'Bir zırh seni saldırıdan korudu!' });
      this.log(`⚒️ ${t.name} çelik zırhla kurtarıldı (Demirci: ${this.pn(demirciId)})`);
      return;
    }
    if (t.isShielded || t.isImmortal) {
      attackers.forEach(aid => {
        rep.get(aid)?.push({ i: '❌', t: `${t.name} korunuyordu.` });
        this.hist(aid, 'Öldürme', t.name, 'Engellendi');
      });
    } else {
      t.isAlive = false;
      this.deadThisNight.push(tid);
      if (src === 'seri_katil') {
        rep.get(tid)?.push({ i: '🔪', t: 'Seri Katil tarafından öldürüldün!' });
        this.players.forEach((_, pid) => {
          if (pid !== tid) rep.get(pid)?.push({ i: '🔪', t: `${t.name} bir Seri Katil tarafından öldürüldü!` });
        });
        attackers.forEach(aid => {
          this.hist(aid, 'Öldürme', t.name, 'Başarılı');
        });
        this.log(`🔪 ${t.name} Seri Katil tarafından öldürüldü`);
      } else {
        const ic = '🧛';
        rep.get(tid)?.push({ i: ic, t: 'Hainler tarafından öldürüldün!' });
        attackers.forEach(aid => {
          rep.get(aid)?.push({ i: ic, t: `${t.name} öldürüldü.` });
          this.hist(aid, 'Öldürme', t.name, 'Başarılı');
        });
        this.log(`${ic} ${t.name} öldürüldü`);
      }
    }
  }

  // ── GÜN ──
  startDiscussion() {
    this.phase = PHASES.DAY_DISCUSSION;
    this.suikastUsedThisRound = false;
    this.log(`☀️ Gündüz ${this.round}`);
    if (this.deadThisNight.length) this.log(`💀 Ölenler: ${this.deadThisNight.map(id => this.pn(id)).join(', ')}`);
  }

  // Engizitör: tartışmada/oylamada bir kez kendini ifşa edip kişi infaz eder
  submitEngizitor(pid, targetId) {
    if (this.phase !== PHASES.DAY_DISCUSSION && this.phase !== PHASES.VOTING) {
      return { ok: false, err: 'Sadece gündüz kullanabilirsin!' };
    }
    const p = this.players.get(pid);
    if (!p?.isAlive || p.role !== 'engizitor') return { ok: false, err: 'Engizitör değilsin!' };
    if (this.engizitorUsed.has(pid)) return { ok: false, err: 'Yeteneğini zaten kullandın!' };
    const t = this.players.get(targetId);
    if (!t?.isAlive) return { ok: false, err: 'Hedef ölü!' };
    if (targetId === pid) return { ok: false, err: 'Kendine kullanamazsın!' };
    this.engizitorUsed.add(pid);
    // Hedefin takımını kontrol et
    if (t.actualTeam === TEAMS.MASUM) {
      // Yanlış — engizitör ölür
      p.isAlive = false;
      this.log(`⚖️ Engizitör ${p.name} ${t.name}'i hedef aldı ama o masum! Engizitör öldü.`);
      return { ok: true, killed: pid, killedName: p.name, msg: `${p.name} masum birini hedef aldı! Engizitör öldü.` };
    } else {
      // Hain veya tarafsız — hedef ölür
      t.isAlive = false;
      this.log(`⚖️ Engizitör ${p.name} ${t.name}'i ifşa etti ve infaz etti.`);
      return { ok: true, killed: targetId, killedName: t.name, msg: `Engizitör ${t.name}'i ifşa etti ve infaz etti!` };
    }
  }

  // ── SABOTAJ ──
  // Hain gece sabotaj oyu (kolektif). Çoğunluk → ertesi gündüz mini oyun aktive
  submitSabotage(pid) {
    if (this.phase !== PHASES.NIGHT) return { ok: false, err: 'Sadece gece sabotaj yapılabilir!' };
    const p = this.players.get(pid);
    if (!p?.isAlive || p.actualTeam !== TEAMS.HAIN) return { ok: false, err: 'Hain değilsin!' };
    if (this.sabotageVotes.has(pid)) {
      this.sabotageVotes.delete(pid);
    } else {
      this.sabotageVotes.add(pid);
    }
    return { ok: true, voted: this.sabotageVotes.has(pid), totalVotes: this.sabotageVotes.size };
  }

  // resolveNight sonunda: HERHANGİ bir hain oy verdiyse pending olur
  _checkSabotageActivation() {
    const aliveHain = this.alive().filter(p => p.actualTeam === TEAMS.HAIN);
    if (aliveHain.length === 0 || this.sabotageVotes.size === 0) {
      this.sabotagePending = false;
      return false;
    }
    // 1 hainin oyu yeter
    this.sabotagePending = true;
    return true;
  }

  // Gündüzde rastgele bir anda çağrılır (index.js setTimeout)
  // fromSystem: true ise oyun kendiliğinden başlatır (hainler de hedef olabilir)
  triggerSabotage(fromSystem = false) {
    if (!this.sabotagePending && !fromSystem) return false;
    if (this.phase !== PHASES.DAY_DISCUSSION && this.phase !== PHASES.VOTING) return false;
    if (this.sabotageActive) return false; // çakışma engellendi

    const aliveAll = this.alive();
    // Sistem sabotajında: tüm canlılar hedef olabilir (hain dahil, ama coin yok)
    // Hain sabotajında: sadece masum/tarafsız hedef
    const candidatePool = fromSystem
      ? aliveAll
      : aliveAll.filter(p => p.actualTeam !== TEAMS.HAIN);

    if (candidatePool.length === 0) {
      this.sabotagePending = false;
      return false;
    }

    // Hedef sayısı: 2-3 arası
    const numTargets = Math.min(
      candidatePool.length,
      Math.max(1, Math.min(3, Math.floor(candidatePool.length / 2)))
    );
    const selected = this.shuf([...candidatePool]).slice(0, numTargets);
    const gameTypes = ['xox', 'rps', 'colorword'];

    this.sabotageActive = true;
    this.sabotagePending = false;
    this.sabotagePendingFromSystem = fromSystem;
    this.sabotageStartedAt = Date.now();
    this.sabotageTargets.clear();
    this.sabotagePairs.clear();

    // Eşleşme: HER hedef AI'a karşı oynar (PvP iptal — kullanıcı isteği)
    const shuffled = this.shuf([...selected]);
    while (shuffled.length >= 1) {
      const p1 = shuffled.shift();
      const gType = gameTypes[crypto.randomInt(0, gameTypes.length)];
      this.sabotageTargets.set(p1.id, {
        gameType: gType,
        opponentType: 'ai',
        fromSystem,
        completed: false,
        won: false
      });
    }

    const targetNames = [...this.sabotageTargets.keys()].map(id => this.pn(id));
    this.log(`🚨 ${fromSystem ? 'SİSTEM' : 'HAIN'} SABOTAJI! ${targetNames.join(', ')} mini oyun çözmeli.`);
    return true;
  }

  _initPvPGameState(gameType) {
    if (gameType === 'xox') {
      return { board: Array(9).fill(null), turn: 0, symbols: ['X', 'O'], moves: [] };
    } else if (gameType === 'rps') {
      return { round: 1, maxRound: 3, scores: [0, 0], lastChoices: [null, null], roundLocked: false };
    } else if (gameType === 'colorword') {
      return { scores: [0, 0], target: 3, completed: [false, false] };
    }
    return {};
  }

  // Sabotaj mini oyun sonucu (AI modu — direkt kayıt)
  recordSabotageResult(pid, won) {
    const target = this.sabotageTargets.get(pid);
    if (!target) return false;
    if (target.completed) return false;
    if (target.opponentType !== 'ai') return false; // AI moduysa sadece direkt kaydedilir
    target.completed = true;
    target.won = won;
    this._maybeEndSabotage();
    return true;
  }

  // PvP oyun aksiyonu — gameEngine içinde çözüm
  submitSabotageMove(pid, moveData) {
    const target = this.sabotageTargets.get(pid);
    if (!target || target.opponentType !== 'player') return { ok: false, err: 'PvP oyununda değilsin' };
    const pair = this.sabotagePairs.get(target.gameId);
    if (!pair || pair.completed) return { ok: false, err: 'Oyun bitti' };
    const myIdx = pair.players.indexOf(pid);
    if (myIdx === -1) return { ok: false, err: 'Oyuncu yok' };

    if (pair.gameType === 'xox') {
      const idx = moveData.cellIndex;
      if (typeof idx !== 'number' || idx < 0 || idx > 8) return { ok: false, err: 'Geçersiz hücre' };
      if (pair.state.turn !== myIdx) return { ok: false, err: 'Senin sıran değil' };
      if (pair.state.board[idx] !== null) return { ok: false, err: 'Hücre dolu' };
      pair.state.board[idx] = pair.state.symbols[myIdx];
      pair.state.moves.push({ pid, cell: idx });
      // Win check
      const winner = this._xoxCheckWinner(pair.state.board);
      if (winner !== null) {
        pair.completed = true;
        if (winner === 'draw') {
          pair.players.forEach(p => {
            const t = this.sabotageTargets.get(p);
            if (t) { t.completed = true; t.won = false; }
          });
        } else {
          const winnerIdx = pair.state.symbols.indexOf(winner);
          const winnerPid = pair.players[winnerIdx];
          pair.players.forEach(p => {
            const t = this.sabotageTargets.get(p);
            if (t) { t.completed = true; t.won = (p === winnerPid); }
          });
        }
        this._maybeEndSabotage();
      } else {
        pair.state.turn = 1 - myIdx;
      }
      return { ok: true, state: pair.state, completed: pair.completed };
    }

    if (pair.gameType === 'rps') {
      const choice = moveData.choice;
      if (!['rock','paper','scissors'].includes(choice)) return { ok: false, err: 'Geçersiz seçim' };
      if (pair.state.lastChoices[myIdx]) return { ok: false, err: 'Bu round seçim yaptın' };
      pair.state.lastChoices[myIdx] = choice;
      // Her iki oyuncu da seçim yaptıysa round çözümle
      if (pair.state.lastChoices[0] && pair.state.lastChoices[1]) {
        const c0 = pair.state.lastChoices[0], c1 = pair.state.lastChoices[1];
        let roundWinner = null;
        if (c0 !== c1) {
          if (
            (c0==='rock'&&c1==='scissors') ||
            (c0==='paper'&&c1==='rock') ||
            (c0==='scissors'&&c1==='paper')
          ) { pair.state.scores[0]++; roundWinner = 0; }
          else { pair.state.scores[1]++; roundWinner = 1; }
        }
        pair.state.round++;
        if (pair.state.round > pair.state.maxRound) {
          pair.completed = true;
          const winnerIdx = pair.state.scores[0] > pair.state.scores[1] ? 0 :
                            pair.state.scores[0] < pair.state.scores[1] ? 1 : -1;
          pair.players.forEach((p, i) => {
            const t = this.sabotageTargets.get(p);
            if (t) { t.completed = true; t.won = (i === winnerIdx); }
          });
          this._maybeEndSabotage();
        } else {
          // Yeni round - seçimleri sıfırla (ama önce sonuç gönderilebilsin)
          // Bunu frontend tarafında animasyonla göstereceğiz
        }
      }
      return { ok: true, state: pair.state, completed: pair.completed };
    }

    if (pair.gameType === 'colorword') {
      // Cevap çoğu zaman doğru/yanlış
      const correct = !!moveData.correct;
      if (correct) pair.state.scores[myIdx]++;
      // İlk hedefe ulaşan kazanır
      if (pair.state.scores[myIdx] >= pair.state.target) {
        pair.completed = true;
        pair.players.forEach((p, i) => {
          const t = this.sabotageTargets.get(p);
          if (t) { t.completed = true; t.won = (i === myIdx); }
        });
        this._maybeEndSabotage();
      }
      return { ok: true, state: pair.state, completed: pair.completed, myScore: pair.state.scores[myIdx] };
    }
    return { ok: false, err: 'Bilinmeyen oyun' };
  }

  _xoxCheckWinner(board) {
    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (const [a,b,c] of lines) {
      if (board[a] && board[a]===board[b] && board[b]===board[c]) return board[a];
    }
    if (!board.includes(null)) return 'draw';
    return null;
  }

  _maybeEndSabotage() {
    // Tüm hedefler tamamlandı mı?
    const allDone = [...this.sabotageTargets.values()].every(t => t.completed);
    if (allDone) {
      this.sabotageActive = false;
      this.log(`🚨 Sabotaj tamamlandı. ${[...this.sabotageTargets.values()].filter(t => t.won).length} oyuncu kazandı.`);
    }
  }

  // Hain "sahte" oyun: coin yok, sadece eğlence (dummy state, no team game)
  // Frontend tarafında çözülür, backend tutmaz

  // Suikastçı suikast girişimi (her tur 1 hak; yanlış bilirse zaten ölür, doğruysa sonraki tur tekrar denenebilir)
  submitSuikast(pid, targetId, guessedRole) {
    // Hem tartışma hem oylama fazında çalışsın
    if (this.phase !== PHASES.DAY_DISCUSSION && this.phase !== PHASES.VOTING) {
      return { ok: false, err: 'Sadece gündüz suikast yapabilirsin!' };
    }
    const p = this.players.get(pid);
    if (!p?.isAlive || p.role !== 'suikastci') return { ok: false, err: 'Suikastçı değilsin!' };
    // Bu tur içinde sadece 1 deneme (her tur sıfırlanır)
    if (this.suikastUsedThisRound) return { ok: false, err: 'Bu tur zaten suikast denendi!' };
    const t = this.players.get(targetId);
    if (!t?.isAlive) return { ok: false, err: 'Hedef geçersiz!' };
    if (t.id === pid) return { ok: false, err: 'Kendine suikast yapamazsın!' };

    this.suikastUsedThisRound = true;
    const correct = t.role === guessedRole;
    let deadName, deadId;

    if (correct) {
      t.isAlive = false;
      deadName = t.name; deadId = t.id;
      this.log(`🗡️ Suikastçı ${p.name} → ${t.name} (${this.ro(guessedRole)?.name}) DOĞRU TAHMİN! Hedef anında öldü.`);
    } else {
      p.isAlive = false;
      deadName = p.name; deadId = p.id;
      this.log(`🗡️ Suikastçı ${p.name} → ${t.name} (${this.ro(guessedRole)?.name}) YANLIŞ! Suikastçı anında öldü.`);
    }
    // Suikastçıya özel detay (sadece kendisi görür)
    const privateResult = {
      correct, targetId: t.id, targetName: t.name, guessedRole,
      suikastciId: p.id, suikastciName: p.name
    };
    // Herkese giden anonim mesaj
    const publicResult = {
      deadId, deadName,
      // Kim öldürdü, neden öldü belli olmasın - sadece "gündüz öldürüldü"
      message: `${deadName} gündüz vakti öldürüldü.`
    };
    return { ok: true, privateResult, publicResult };
  }
  startVoting() {
    this.phase = PHASES.VOTING;
    this.votes.clear(); this.voteTally.clear();
    this.alive().forEach(p => this.voteTally.set(p.id, 0));
  }
  submitVote(vid, tid) {
    const v = this.players.get(vid);
    if (!v?.isAlive || this.phase !== PHASES.VOTING) return false;
    // Buzcu karantinasında ise oy veremez
    if (this.frozen.has(vid)) return false;
    // Oy zaten verilmişse değiştirilemez
    if (this.votes.has(vid)) return false;
    if (tid === 'skip' || tid === null) {
      this.votes.set(vid, 'skip');
      return true;
    }
    const t = this.players.get(tid);
    if (!t?.isAlive) return false;
    // Karantinadaki kişiye oy verilemez
    if (this.frozen.has(tid)) return false;
    this.votes.set(vid, tid);
    const w = this.getVoteWeight(vid);
    this.voteTally.set(tid, (this.voteTally.get(tid) || 0) + w);
    return true;
  }
  getVoteWeight(vid) {
    const v = this.players.get(vid);
    if (v?.role === 'muhtar') {
      if (v.isInsane || v.isTempInsane) { const r = crypto.randomInt(0, 100) / 100; return r < 0.25 ? -1 : r < 0.5 ? 0 : 2; }
      return 2;
    }
    return 1;
  }
  getVoteTally() {
    const r = {};
    this.voteTally.forEach((c, pid) => { if (c !== 0) r[pid] = c; });
    // Skip oy sayısı
    let skipCount = 0;
    this.votes.forEach(tid => { if (tid === 'skip') skipCount++; });
    if (skipCount > 0) r['__skip__'] = skipCount;
    return r;
  }

  resolveVoting() {
    let max = 0, elim = null, tied = false;
    this.voteTally.forEach((v, pid) => {
      if (v > max) { max = v; elim = this.players.get(pid); tied = false; }
      else if (v === max && max > 0) tied = true;
    });
    // Skip oylarını da say (toplam oy sayısı için)
    let skipCount = 0;
    this.votes.forEach(tid => { if (tid === 'skip') skipCount++; });

    // Çoğunluk gerekli: en yüksek oyun, canlı oyuncu sayısının yarısından FAZLA olması lazım
    const aliveCount = this.alive().length;
    const majority = Math.floor(aliveCount / 2) + 1; // 6 oyuncu → 4, 5 oyuncu → 3, 4 oyuncu → 3

    const result = { eliminated: null, message: '', dodoWins: false, cellatWins: null, voteTally: Object.fromEntries(this.voteTally), skipCount };

    if (max < majority || tied || max <= 0) {
      // Çoğunluk yok ya da beraberlik
      if (skipCount >= majority) {
        result.message = `${skipCount} kişi oy kullanmadı. Kimse asılmıyor.`;
        this.log(`⏭️ ${skipCount} skip — kimse asılmadı`);
      } else if (tied) {
        result.message = 'Berabere! Kimse elenmiyor.';
        this.log('⚖️ Berabere');
      } else {
        result.message = `Çoğunluk yok (${max}/${majority} gerekli). Kimse asılmıyor.`;
        this.log(`⚖️ Çoğunluk sağlanamadı: ${max}/${majority}`);
      }
    }
    else if (elim) {
      elim.isAlive = false;
      result.eliminated = { id: elim.id, name: elim.name };
      result.message = `${elim.name} mahalle dışına itildi!`;
      if (elim.role === 'dodo') result.dodoWins = true;
      this.cellatTarget.forEach((tid, cid) => { if (tid === elim.id && !this.cellatWon.has(cid)) { result.cellatWins = cid; this.cellatWon.add(cid); } });
      this.log(`🪦 ${elim.name} asıldı (${max} oy)`);
    }
    this.phase = PHASES.VOTE_RESULT;
    return result;
  }

  // ── MVP OYLAMA ──
  startMvpVote() {
    this.phase = 'mvp_vote';
    this.mvpVotes.clear();
  }

  submitMvpVote(vid, tid) {
    if (this.phase !== 'mvp_vote') return false;
    if (!this.players.has(vid) || !this.players.has(tid)) return false;
    if (vid === tid) return false; // kendine oy verme
    this.mvpVotes.set(vid, tid);
    return true;
  }

  getMvpTally() {
    const t = {};
    this.mvpVotes.forEach(tid => { t[tid] = (t[tid] || 0) + 1; });
    return t;
  }

  resolveMvpVote() {
    const tally = this.getMvpTally();
    let max = 0, candidates = [];
    Object.entries(tally).forEach(([pid, c]) => {
      if (c > max) { max = c; candidates = [pid]; }
      else if (c === max) candidates.push(pid);
    });
    let mvpId = null;
    if (candidates.length > 0) {
      mvpId = candidates[crypto.randomInt(0, candidates.length)];
    }
    this.mvpResult = {
      mvpId, tally,
      mvp: mvpId ? {
        id: mvpId,
        name: this.pn(mvpId),
        username: this.players.get(mvpId)?.username,
        avatar: this.players.get(mvpId)?.avatar
      } : null,
      votes: max
    };
    this.phase = 'mvp_result';
    return this.mvpResult;
  }

  checkWin() {
    const al = this.alive();
    const hains = al.filter(p => p.actualTeam === TEAMS.HAIN);
    const masums = al.filter(p => p.actualTeam === TEAMS.MASUM);
    const tarafsizlar = al.filter(p => p.actualTeam === TEAMS.TARAFSIZ);
    const sk = al.find(p => p.role === 'seri_katil');
    const muhtar = al.find(p => p.role === 'muhtar');

    // Veba kazandı (resolveNight sırasında set edilir, herkes hastaydı)
    if (this.vebaWins) {
      return { over: true, winner: 'veba', msg: '☠️ Veba tüm köyü etkiledi ve kazandı!' };
    }

    // Seri Katil son 1
    if (al.length === 1 && sk) {
      return { over: true, winner: 'seri_katil', msg: '🔪 Seri Katil son kişi olarak kazandı!' };
    }
    if (al.length === 2 && sk) {
      if (muhtar) return { over: false };
      return { over: true, winner: 'seri_katil', msg: '🔪 Seri Katil kazandı! Karşı koyacak kimse kalmadı.' };
    }

    // Hainler yok + SK yok → masumlar
    if (hains.length === 0 && !sk) {
      return { over: true, winner: TEAMS.MASUM, msg: '🌅 Masumlar kazandı!' };
    }
    // Masum yok + SK yok → hainler
    if (masums.length === 0 && !sk && hains.length > 0) {
      return { over: true, winner: TEAMS.HAIN, msg: '🧛 Hainler kazandı!' };
    }
    // 1H/1M/1T stalemate
    if (al.length === 3 && hains.length === 1 && masums.length === 1 && tarafsizlar.length === 1 && !sk) {
      return { over: false };
    }
    // Hain >= masum
    if (!sk && hains.length > 0 && hains.length >= masums.length && masums.length > 0) {
      return { over: true, winner: TEAMS.HAIN, msg: '🧛 Hainler kazandı!' };
    }

    return { over: false };
  }

  nextRound() {
    this.round++;
    // Frozen oyuncular: ertesi gündüz oylama dışıydı, şimdi normalleşir
    this.frozen.clear();
    this.startNight();
  }

  // POST-GAME: lobiye geri dön
  resetForNewGame() {
    this.phase = PHASES.LOBBY;
    this.round = 0;
    this.gameEnded = false;
    this.gameResult = null;
    this.nightActions.clear();
    this.hainKillVotesLive.clear();
    this.hainAbilityChoices.clear();
    this.blocked.clear();
    this.locked.clear();
    this.silenced.clear();
    this.bombs.clear();
    this.gaziUsed.clear();
    this.savciUsed.clear();
    this.serifUsed.clear();
    this.serifPendingSuicide.clear();
    this.doktorSelfUsed.clear();
    this.cellatTarget.clear();
    this.cellatWon.clear();
    this.nightReports.clear();
    this.votes.clear();
    this.voteTally.clear();
    this.deadThisNight = [];
    this.actionHistory.clear();
    this.gameLog = [];
    this.yamyamAbilities.clear();
    // Yeni rol state'leri
    this.koruyucuTargets.clear();
    this.steelArmor.clear();
    this.imprisoned.clear();
    this.infazExecutionsLeft.clear();
    this.gardiyanShield = false;
    this.gardiyanUsed.clear();
    this.engizitorUsed.clear();
    this.olumsuzUsed.clear();
    this.olumsuzPending.clear();
    this.buzcuLeft.clear();
    this.frozen.clear();
    this.infected.clear();
    this.virusInactiveRounds.clear();
    this.ambushTrap.clear();
    this.hackedTarget.clear();
    this.plagued.clear();
    // Sabotaj
    this.sabotageVotes.clear();
    this.sabotagePending = false;
    this.sabotageActive = false;
    this.sabotageStartedAt = 0;
    this.sabotageTargets.clear();
    this.sabotagePairs.clear();
    this.presidentId = null;
    this.presidentVotes.clear();
    this.roleSelectionPicks.clear();
    this.roleSelectionPool = [];
    this.roleSelectionOrder = [];
    this.roleSelectionIndex = 0;
    delete this._selPool;
    this.mvpVotes.clear();
    this.mvpResult = null;
    this.bombExplosions = [];
    this.suikastUsedThisRound = false;
    // Bahisler de temizlensin (yeni oyun)
    if (this.bets) this.bets.clear();

    this.players.forEach(p => {
      p.role = null; p.actualTeam = null; p.displayedRole = null;
      p.isAlive = true; p.isInsane = false; p.isTempInsane = false;
      p.isShielded = false; p.isImmortal = false; p.isSilenced = false;
      this.actionHistory.set(p.id, []);
    });
  }

  // ── HELPERS ──
  shuf(a) { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  hist(pid, action, target, result) { this.actionHistory.get(pid)?.push({ round: this.round, action, target, result }); }
  log(msg) { this.gameLog.push({ round: this.round, time: Date.now(), msg }); }

  // ── STATES ──
  publicState() {
    const players = [...this.players.values()].map(p => ({
      id: p.id, name: p.name, username: p.username, avatar: p.avatar,
      wins: p.wins, mvp: p.mvp, isAlive: p.isAlive, isPresident: p.id === this.presidentId
    }));
    return {
      code: this.code, phase: this.phase, round: this.round,
      config: this.config, leaderId: this.leaderId,
      enabledRoles: [...this.enabledRoles], insanityRate: this.insanityRate,
      hainKillMode: this.hainKillMode, manualCounts: this.manualCounts,
      hainCount: this.hainCount, tarafsizCount: this.tarafsizCount,
      roleSelectionMode: this.roleSelectionMode,
      players, presidentId: this.presidentId,
      spectators: [...this.spectators.values()].map(s => ({ id: s.id, name: s.name, avatar: s.avatar })),
      deadThisNight: this.deadThisNight,
      voteTally: this.phase === PHASES.VOTING ? Object.fromEntries(this.voteTally) : {},
      // Rol seçim aşaması: sıra gizli, sadece tamamlanan seçimler ve toplam ilerleme görünür
      roleSelection: this.phase === PHASES.ROLE_SELECTION ? (() => {
        const completed = this.roleSelectionOrder
          .slice(0, this.roleSelectionIndex)
          .map(pid => {
            const pick = this.roleSelectionPicks.get(pid);
            return {
              // DİKKAT: playerId, playerName ve avatar siliyoruz! Sadece rol gidiyor.
              picked: pick ? (pick.isRandom ? 'random' : pick.roleId) : null,
              isRandom: pick?.isRandom || false
            };
          });
        // Sırayı RASTGELE karıştır ki kim önce seçtiği belli olmasın
        const shuffledCompleted = this.shuf([...completed]);
        const total = this.roleSelectionOrder.length;
        const done = this.roleSelectionIndex;
        const currentPid = this.roleSelectionOrder[this.roleSelectionIndex] || null;
        return {
          completed: shuffledCompleted,
          total, done,
          currentPlayerId: currentPid,
          currentPlayerName: null,
          currentPlayerAvatar: null
        };
      })() : null,
      // Başkan oylama
      presidentVoteTally: this.phase === PHASES.PRESIDENT_VOTE ? this.getPresidentVoteTally() : {},
      // MVP oylama
      mvpTally: this.phase === 'mvp_vote' ? this.getMvpTally() : {},
      mvpResult: this.mvpResult,
      // Suikastçı: bu tur kullanıldı mı?
      suikastUsedThisRound: this.suikastUsedThisRound
    };
  }

  privateState(pid) {
    const p = this.players.get(pid);
    if (!p) return null;
    const ro = this.ro(p.displayedRole || p.role);
    let teammates = [];
    if (p.actualTeam === TEAMS.HAIN) {
      // Hainler birbirlerinin SADECE isim/avatarını bilir, rolünü değil
      teammates = [...this.players.values()]
        .filter(x => x.id !== pid && x.actualTeam === TEAMS.HAIN)
        .map(x => ({ id: x.id, name: x.name, avatar: x.avatar }));
    }

    // History (deli "Sahte" yerine "Başarılı" göster)
    const cleanHistory = (this.actionHistory.get(pid) || []).map(h => ({
      round: h.round, action: h.action, target: h.target,
      result: h.result === 'Sahte' ? 'Başarılı' : h.result
    }));

    // Rol seçim ekranında sadece sıra gelen kişi seçenekleri görür
    let myRoleOptions = null;
    let myRoleForced = false;
    let myRoleForcedTeam = null;
    if (this.phase === PHASES.ROLE_SELECTION) {
      const cur = this.roleSelectionOrder[this.roleSelectionIndex];
      if (cur === pid) {
        const opts = this._generateOptionsForCurrent();
        if (opts) {
          myRoleOptions = opts.options;
          myRoleForced = opts.forced;
          myRoleForcedTeam = opts.forcedTeam || null;
        }
      }
    }
    // Oyuncu kendi seçimini bilir (rastgele bile olsa rolü görür)
    const myPick = this.roleSelectionPicks.get(pid);
    const myPickInfo = myPick ? {
      roleId: myPick.roleId,
      isRandom: myPick.isRandom,
      roleName: this.ro(myPick.roleId)?.name,
      roleEmoji: this.ro(myPick.roleId)?.emoji
    } : null;

    // Hain kill votes (sadece hain görür)
    let hainKillVotes = null;
    if (p.actualTeam === TEAMS.HAIN) {
      hainKillVotes = {};
      this.hainKillVotesLive.forEach((tid, hid) => { hainKillVotes[hid] = tid; });
    }

    // Bombacı: kendi koyduğu bombaları gör
    let myBombs = [];
    if (p.role === 'bombaci') {
      this.bombs.forEach((b, tid) => {
        if (b.ownerId === pid) myBombs.push(tid);
      });
    }

    // ADMIN ÖZELLİĞİ: admin tüm oyuncuların rollerini görür (sadece admin'in kendi privateState'inde)
    let adminAllRoles = null;
    if (p.isAdmin) {
      adminAllRoles = [...this.players.values()].map(pp => {
        const r = this.ro(pp.role);
        return {
          id: pp.id, name: pp.name, isAlive: pp.isAlive,
          roleId: pp.role, roleName: r?.name || '?', roleEmoji: r?.emoji || '?',
          team: pp.actualTeam,
          isInsane: pp.isInsane,
          cellatTargetName: pp.role === 'cellat' ? this.pn(this.cellatTarget.get(pp.id)) : null
        };
      });
    }

    return {
      role: p.role, roleName: ro?.name, roleEmoji: ro?.emoji, roleDesc: ro?.desc,
      team: p.actualTeam, isAlive: p.isAlive, isSilenced: p.isSilenced,
      teammates, hasNightAction: ro?.hasNightAction && p.isAlive,
      cellatTarget: p.role === 'cellat' ? this.pn(this.cellatTarget.get(pid)) : null,
      cellatTargetId: p.role === 'cellat' ? this.cellatTarget.get(pid) : null,
      cellatWon: p.role === 'cellat' ? this.cellatWon.has(pid) : false,
      // Koruyucu: emanet edilen oyuncu (sadece koruyucu görür)
      koruyucuTarget: p.role === 'koruyucu' ? this.pn(this.koruyucuTargets.get(pid)) : null,
      koruyucuTargetId: p.role === 'koruyucu' ? this.koruyucuTargets.get(pid) : null,
      // Buzcu: kalan kullanım hakkı
      buzcuLeft: p.role === 'buzcu' ? (this.buzcuLeft.get(pid) ?? 2) : null,
      // Gardiyan: sokağa çıkma yasağını kullandı mı
      gardiyanUsed: p.role === 'gardiyan' ? this.gardiyanUsed.has(pid) : false,
      // İnfazcı: kalan idam hakkı
      infazExecutionsLeft: p.role === 'infazci' ? (this.infazExecutionsLeft.get(pid) ?? 1) : null,
      // Engizitör: yetenek kullanıldı mı (tartışma fazında butonu açar/kapar)
      engizitorUsed: p.role === 'engizitor' ? this.engizitorUsed.has(pid) : false,
      // Demirci: önceki turlardan kalan zırh sahipleri (kendi koyduğu)
      demirciArmored: p.role === 'demirci' ? [...this.steelArmor.entries()].filter(([_, dId]) => dId === pid).map(([tId, _]) => tId) : null,
      // Sabotaj: bu kişi sabotaja maruz kaldıysa
      sabotageGame: this.sabotageActive && this.sabotageTargets.has(pid)
        ? (() => {
            const t = this.sabotageTargets.get(pid);
            const out = {
              gameType: t.gameType,
              opponentType: t.opponentType,
              fromSystem: !!t.fromSystem,
              completed: t.completed,
              won: t.won
            };
            if (t.opponentType === 'player' && t.gameId) {
              const pair = this.sabotagePairs.get(t.gameId);
              if (pair) {
                const myIdx = pair.players.indexOf(pid);
                out.gameId = t.gameId;
                out.myIndex = myIdx;
                out.state = pair.state;
                out.pairCompleted = pair.completed;
              }
            }
            return out;
          })()
        : null,
      // Sabotaj oyu (sadece hainler görür)
      sabotageVoted: p.actualTeam === TEAMS.HAIN ? this.sabotageVotes.has(pid) : false,
      sabotageVoteCount: p.actualTeam === TEAMS.HAIN ? this.sabotageVotes.size : 0,
      gaziUsed: this.gaziUsed.has(pid), savciUsed: this.savciUsed.has(pid),
      serifUsed: this.serifUsed.has(pid),
      doktorSelfUsed: this.doktorSelfUsed.has(pid),
      reports: this.nightReports.get(pid) || [],
      history: cleanHistory,
      canKill: p.actualTeam === TEAMS.HAIN || p.role === 'seri_katil',
      canAbility: ro?.hasNightAction,
      hainKillMode: this.hainKillMode,
      hainKillVotes,
      myBombs,
      yamyamAbilities: p.role === 'yamyam' ? (this.yamyamAbilities.get(pid) || []).map(r => this.ro(r)?.name) : [],
      myRoleOptions,
      myRoleForced,
      myRoleForcedTeam,
      myPickInfo,
      isPresident: p.id === this.presidentId,
      presidentName: this.presidentId ? this.pn(this.presidentId) : null,
      avatar: p.avatar,
      username: p.username,
      isAdmin: !!p.isAdmin,
      adminAllRoles
    };
  }

  spectatorState() {
    return {
      phase: this.phase, round: this.round,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, username: p.username, avatar: p.avatar,
        role: p.role, roleName: this.ro(p.role)?.name, roleEmoji: this.ro(p.role)?.emoji,
        team: p.actualTeam, isAlive: p.isAlive, isInsane: p.isInsane,
        isSilenced: p.isSilenced, isPresident: p.id === this.presidentId
      })),
      gameLog: this.gameLog,
      presidentId: this.presidentId
    };
  }

  getWinners() {
    const wc = this.checkWin();
    let winnerKey = wc.winner;
    if (!wc.over) return [];
    return [...this.players.values()].filter(p => {
      // Cellat hedefini astırdıysa daima kazanır
      if (p.role === 'cellat' && this.cellatWon.has(p.id)) return true;
      // Yamyam: hain veya masum kazanırsa o da kazanır
      if (p.role === 'yamyam' && (winnerKey === TEAMS.MASUM || winnerKey === TEAMS.HAIN)) return true;
      // Koruyucu: koruduğu kişi hayattaysa kazanır (hangi takım kazansa)
      if (p.role === 'koruyucu') {
        const targetId = this.koruyucuTargets.get(p.id);
        const target = targetId ? this.players.get(targetId) : null;
        if (target?.isAlive) return true;
        return false; // koruduğu kişi öldüyse — masum bile olsa kazanamaz
      }
      // Veba kendi başına kazanır
      if (winnerKey === 'veba' && p.role === 'veba') return true;
      // Veba kazandıysa kimse onun yanında kazanmaz
      if (winnerKey === 'veba') return false;
      // Normal takım zaferi
      if (winnerKey === p.actualTeam) return true;
      if (winnerKey === 'seri_katil' && p.role === 'seri_katil') return true;
      if (winnerKey === 'dodo' && p.role === 'dodo') return true;
      return false;
    }).map(p => p.username).filter(Boolean);
  }
  getLosers() {
    const w = new Set(this.getWinners());
    return [...this.players.values()].map(p => p.username).filter(u => u && !w.has(u));
  }
}

module.exports = GameEngine;

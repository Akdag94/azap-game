// ============================================================
// AZAP v4 - Oyun Motoru
// ============================================================
const { TEAMS, ROLES, PHASES, DEFAULT_CONFIG } = require('./gameConstants');

class GameEngine {
  constructor(code, leaderId) {
    this.code = code;
    this.leaderId = leaderId;
    this.players = new Map();
    this.spectators = new Map();
    this.phase = PHASES.LOBBY;
    this.round = 0;

    this.config = { ...DEFAULT_CONFIG };
    this.enabledRoles = new Set(Object.keys(ROLES).filter(k => k !== 'DELI'));
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
    this.mvpVotes = new Map(); // voterId -> targetId
    this.mvpResult = null;

    // Suikastçı: her tur 1 hak (her gündüz başında sıfırlanır)
    this.suikastUsedThisRound = false;
  }

  addPlayer(id, name, username, wins, avatar, mvp) {
    if (this.players.size >= this.config.MAX_PLAYERS) return false;
    if (this.phase !== PHASES.LOBBY && this.phase !== PHASES.POST_GAME) return false;
    this.players.set(id, {
      id, name, username, wins: wins || 0, mvp: mvp || 0, avatar: avatar || null,
      role: null, actualTeam: null, displayedRole: null,
      isAlive: true, isInsane: false, isTempInsane: false,
      isShielded: false, isImmortal: false, isSilenced: false,
      isReady: false
    });
    this.actionHistory.set(id, []);
    return true;
  }
  addSpectator(id, name, username, avatar) {
    this.spectators.set(id, { id, name, username, avatar: avatar || null });
  }
  removePlayer(id) { this.players.delete(id); this.actionHistory.delete(id); }
  removeSpectator(id) { this.spectators.delete(id); }
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
      if (hC + tC >= n) { hC = Math.max(1, Math.floor(n / 4)); tC = 0; }
    } else {
      hC = Math.max(1, Math.floor(n / 4));
      tC = Math.max(0, Math.min(2, Math.floor((n - hC) / 6)));
    }
    return { hC, tC, mC: n - hC - tC };
  }

  _distributeAuto() {
    const n = this.players.size;
    const { hC, tC, mC } = this._calcCounts(n);
    const en = [...this.enabledRoles].filter(k => k !== 'DELI');
    const hains = en.map(k => ROLES[k]).filter(r => r && r.team === TEAMS.HAIN);
    const trs = en.map(k => ROLES[k]).filter(r => r && r.team === TEAMS.TARAFSIZ);
    const masums = en.map(k => ROLES[k]).filter(r => r && r.team === TEAMS.MASUM);
    if (hains.length === 0 || masums.length === 0) return false;

    const sel = [];
    // Önce tüm benzersiz rolleri kullan, ihtiyaç fazla ise yeniden karıştırıp ekle.
    // Böylece her oyunda farklı roller çıkma şansı en yüksek olur.
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
    const pids = [...this.players.keys()];

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
      p.displayedRole = r.id; // Deli bile kendi gerçek rol adını görür
    });

    this._setupCellat();
    this._enterRoleReveal();
    return true;
  }

  _startRoleSelection() {
    const n = this.players.size;
    const { hC, tC, mC } = this._calcCounts(n);
    const en = [...this.enabledRoles].filter(k => k !== 'DELI');

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
    // Kalan oyuncu sayısı == kalan hain sayısı → bu oyuncu MUTLAKA hain olmalı.
    if (remaining <= hainLeft) {
      if (hainAvail.length === 0) return null;
      const opts = this.shuf([...hainAvail]).slice(0, Math.min(3, hainAvail.length));
      return { forced: true, options: opts.map(r => r.id), forcedTeam: 'hain' };
    }
    // Kalan oyuncu == kalan tarafsız (hain bitmiş) → tarafsız zorla.
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

    // Her takımdan kotası açık olanlardan birer aday (mümkünse).
    if (hainLeft > 0) addOne(hainAvail);
    if (tarafsizLeft > 0) addOne(tarafsizAvail);
    if (masumLeft > 0) addOne(masumAvail);

    // 3'e tamamla — kotası açık takımlardan.
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

      const candidates = [];
      if (masumLeft > 0) sp.masumRoles.filter(r => !sp.usedRoleIds.has(r.id)).forEach(r => candidates.push(r));
      if (hainLeft > 0) sp.hainRoles.filter(r => !sp.usedRoleIds.has(r.id)).forEach(r => candidates.push(r));
      if (tarafsizLeft > 0) sp.tarafsizRoles.filter(r => !sp.usedRoleIds.has(r.id)).forEach(r => candidates.push(r));

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
        const t = masums[Math.floor(Math.random() * masums.length)];
        this.cellatTarget.set(c.id, t.id);
      }
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
      this.presidentId = alive[Math.floor(Math.random() * alive.length)]?.id || null;
    } else {
      this.presidentId = candidates[Math.floor(Math.random() * candidates.length)];
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

    // Şerif intihar: önceki turda masum vuran şerif bu gece ölür
    this.serifPendingSuicide.forEach(pid => {
      const p = this.players.get(pid);
      if (p?.isAlive) {
        p.isAlive = false;
        this.deadThisNight.push(pid);
        this.log(`🤠 ${p.name} (Şerif) vicdan azabından intihar etti.`);
      }
    });
    this.serifPendingSuicide.clear();
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
    if (p.actualTeam === TEAMS.HAIN) {
      // Bombacı öldürme yapamaz
      if (p.role === 'bombaci' && action.action === 'kill') return false;
      // Bombacı: doğrudan nightActions'a (hain ability oylama akışına girmez)
      if (p.role === 'bombaci') {
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
        // Kilitlenen kişiye bildirim
        rep.get(a.targetId)?.push({ i: '🔑', t: 'Çilingir seni evine kilitledi. Güvendeydin ama yetenek kullanamadın.' });
      }
      // Deli bile aynı raporu alır
      rep.get(a.pid)?.push({ i: '🔑', t: `${t.name} evine kilitlendi. Güvende ama yetenek kullanamaz.` });
      this.hist(a.pid, 'Kilitleme', t.name, 'Başarılı');
    });

    const eff = acts.filter(a => !this.blocked.has(a.pid) || a.role === 'seri_katil');

    // 2. HİPNOTİZMACI + GÖLGE
    eff.filter(a => a.role === 'hipnotizmaci' && a.abilityTargetId).forEach(a => {
      const t = this.players.get(a.abilityTargetId);
      if (t?.isAlive) {
        t.isTempInsane = true;
        rep.get(a.pid)?.push({ i: '🌀', t: `${t.name} bu gece deli yapıldı.` });
        this.hist(a.pid, 'Hipnotize', t.name, 'Başarılı');
      }
    });
    eff.filter(a => a.role === 'golge' && a.abilityTargetId).forEach(a => {
      const t = this.players.get(a.abilityTargetId);
      if (t?.isAlive) {
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
        const target = targets[Math.floor(Math.random() * targets.length)];
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
        txt = Math.random() > 0.5 ? `${t.name}'i kurtardın!` : `${t.name}'e saldırı olmadı.`;
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
          const rp = allAlive[Math.floor(Math.random() * allAlive.length)];
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
            const randomVoter = voters[Math.floor(Math.random() * voters.length)];
            killerName = this.pn(randomVoter.pid);
          }
        } else {
          // Multi kill: doğrudan öldüren kişiyi söyle
          killerName = this.pn(hainKillAction.pid);
        }

        if (killerName) {
          if (isDeadInsane) {
            const allAlive = this.alive().filter(p => p.id !== did);
            const rp = allAlive[Math.floor(Math.random() * allAlive.length)];
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
        const fake = allR[Math.floor(Math.random() * allR.length)];
        const fakeTeam = ['masum','hain','tarafsız'][Math.floor(Math.random() * 3)];
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
      const result = insane ? Math.random() > 0.5 : used;
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
      const result = insane ? Math.random() > 0.5 : same;
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
        if (Math.random() > 0.5 && allAlive.length > 0) {
          const rp = allAlive[Math.floor(Math.random() * allAlive.length)];
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

    // 9. YAMYAM
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

    this.players.forEach(p => { p.isImmortal = false; });
    this.nightReports = rep;
    this.phase = PHASES.MORNING_REPORT;
    return rep;
  }

  tryKill(tid, src, rep, attackers) {
    const t = this.players.get(tid);
    if (!t?.isAlive) return;
    // Seri katil korunmalardan da etkilenmez hedefte — HAYIR, hedef korunabilir.
    // Ama seri katil kendisi engellenemez (bu eff filtresinde yapıldı).
    if (t.isShielded || t.isImmortal) {
      attackers.forEach(aid => {
        rep.get(aid)?.push({ i: '❌', t: `${t.name} korunuyordu.` });
        this.hist(aid, 'Öldürme', t.name, 'Engellendi');
      });
    } else {
      t.isAlive = false;
      this.deadThisNight.push(tid);
      if (src === 'seri_katil') {
        // Seri katil öldürdüğünde: sabah herkes bilsin seri katil tarafından öldürüldüğünü
        rep.get(tid)?.push({ i: '🔪', t: 'Seri Katil tarafından öldürüldün!' });
        // Sabah raporunda herkes görsün
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
    this.suikastUsedThisRound = false; // suikastçı her tur 1 kez deneyebilir
    this.log(`☀️ Gündüz ${this.round}`);
    if (this.deadThisNight.length) this.log(`💀 Ölenler: ${this.deadThisNight.map(id => this.pn(id)).join(', ')}`);
  }

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
    // Skip desteği: tid === 'skip' veya null ise oy verilmez ama oy verdi sayılır
    if (tid === 'skip' || tid === null) {
      const old = this.votes.get(vid);
      if (old && old !== 'skip') { const w = this.getVoteWeight(vid); this.voteTally.set(old, (this.voteTally.get(old) || 0) - w); }
      this.votes.set(vid, 'skip');
      return true;
    }
    const t = this.players.get(tid);
    if (!t?.isAlive) return false;
    const old = this.votes.get(vid);
    if (old && old !== 'skip') { const w = this.getVoteWeight(vid); this.voteTally.set(old, (this.voteTally.get(old) || 0) - w); }
    this.votes.set(vid, tid);
    const w = this.getVoteWeight(vid);
    this.voteTally.set(tid, (this.voteTally.get(tid) || 0) + w);
    return true;
  }
  getVoteWeight(vid) {
    const v = this.players.get(vid);
    if (v?.role === 'muhtar') {
      if (v.isInsane || v.isTempInsane) { const r = Math.random(); return r < 0.25 ? -1 : r < 0.5 ? 0 : 2; }
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
    const result = { eliminated: null, message: '', dodoWins: false, cellatWins: null, voteTally: Object.fromEntries(this.voteTally) };
    if (tied || max <= 0) { result.message = 'Berabere! Kimse elenmiyor.'; this.log('⚖️ Berabere'); }
    else if (elim) {
      elim.isAlive = false;
      result.eliminated = { id: elim.id, name: elim.name };
      result.message = `${elim.name} mahalle dışına itildi!`;
      if (elim.role === 'dodo') result.dodoWins = true;
      this.cellatTarget.forEach((tid, cid) => { if (tid === elim.id && !this.cellatWon.has(cid)) { result.cellatWins = cid; this.cellatWon.add(cid); } });
      this.log(`🪦 ${elim.name} asıldı`);
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
      mvpId = candidates[Math.floor(Math.random() * candidates.length)];
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
    const sk = al.find(p => p.role === 'seri_katil');
    if (hains.length === 0 && !sk) return { over: true, winner: TEAMS.MASUM, msg: '🌅 Masumlar kazandı!' };
    if (hains.length >= masums.length && !sk) return { over: true, winner: TEAMS.HAIN, msg: '🧛 Hainler kazandı!' };
    if (sk && al.length <= 2) return { over: true, winner: 'seri_katil', msg: '🔪 Seri Katil kazandı!' };
    return { over: false };
  }

  nextRound() { this.round++; this.startNight(); }

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

    this.players.forEach(p => {
      p.role = null; p.actualTeam = null; p.displayedRole = null;
      p.isAlive = true; p.isInsane = false; p.isTempInsane = false;
      p.isShielded = false; p.isImmortal = false; p.isSilenced = false;
      this.actionHistory.set(p.id, []);
    });
  }

  // ── HELPERS ──
  shuf(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
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
      teammates = [...this.players.values()]
        .filter(x => x.id !== pid && x.actualTeam === TEAMS.HAIN)
        .map(x => ({ id: x.id, name: x.name, role: x.role, roleName: this.ro(x.role)?.name, emoji: this.ro(x.role)?.emoji, avatar: x.avatar }));
    }

    // History (deli "Sahte" yerine "Başarılı" göster)
    const cleanHistory = (this.actionHistory.get(pid) || []).map(h => ({
      round: h.round, action: h.action, target: h.target,
      result: h.result === 'Sahte' ? 'Başarılı' : h.result
    }));

    // Rol seçim ekranında sadece sıra gelen kişi seçenekleri görür
    let myRoleOptions = null;
    let myRoleForced = false;
    if (this.phase === PHASES.ROLE_SELECTION) {
      const cur = this.roleSelectionOrder[this.roleSelectionIndex];
      if (cur === pid) {
        const opts = this._generateOptionsForCurrent();
        if (opts) {
          myRoleOptions = opts.options;
          myRoleForced = opts.forced;
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

    return {
      role: p.role, roleName: ro?.name, roleEmoji: ro?.emoji, roleDesc: ro?.desc,
      team: p.actualTeam, isAlive: p.isAlive, isSilenced: p.isSilenced,
      teammates, hasNightAction: ro?.hasNightAction && p.isAlive,
      cellatTarget: p.role === 'cellat' ? this.pn(this.cellatTarget.get(pid)) : null,
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
      myPickInfo,
      isPresident: p.id === this.presidentId,
      presidentName: this.presidentId ? this.pn(this.presidentId) : null,
      avatar: p.avatar,
      username: p.username
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
    // Bağımsız kazanma durumları için checkWin'in dışındaki kontrolleri de yap
    let winnerKey = wc.winner;
    let manual = false;
    if (!wc.over) {
      // dodo/cellat kazanma yarış sonucu - bunlar resolveVote'ta tetiklenir, ama burada manuel destek yok
      // Bu method endGame içinden çağrılır, o zaman checkWin yetmiyorsa boş dönmesin diye gameResult'a bak
      return [];
    }
    return [...this.players.values()].filter(p => {
      if (winnerKey === p.actualTeam) return true;
      if (winnerKey === 'seri_katil' && p.role === 'seri_katil') return true;
      if (winnerKey === 'dodo' && p.role === 'dodo') return true;
      if (winnerKey === 'cellat' && p.role === 'cellat' && this.cellatWon.has(p.id)) return true;
      return false;
    }).map(p => p.username).filter(Boolean);
  }
  getLosers() {
    const w = new Set(this.getWinners());
    return [...this.players.values()].map(p => p.username).filter(u => u && !w.has(u));
  }
}

module.exports = GameEngine;
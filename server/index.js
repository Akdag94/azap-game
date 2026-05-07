const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const archiver = null; // archiver yoksa zip yapamayacağız, fallback olarak json+screenshots klasörü ver
const GameEngine = require('./gameEngine');
const Accounts = require('./accounts');
const Reports = require('./reports');
const { PHASES } = require('./gameConstants');


const app = express();
const server = http.createServer(app);
// 8MB buffer (screenshot için)
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 8e6,
  // Bağlantı dayanıklılığı — mobil ekranı kilitleme/sekme geçişi için
  pingTimeout: 60000,    // 60 sn yanıt gelmezse kopuk say (default 20s)
  pingInterval: 25000,   // 25 sn'de bir ping (default 25s)
  upgradeTimeout: 30000, // upgrade için 30 sn
  transports: ['websocket', 'polling'],
  allowEIO3: true
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// Report screenshot endpoint - sadece admin authentication ile bakılabilir
app.get('/admin/screenshot/:filename', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(403).send('Forbidden');
  // Token kontrolü: socket id token'ı admin authed.get'inden gelir
  const u = Array.from(authed.entries()).find(([sid, uname]) => sid === token);
  if (!u || !Accounts.isAdmin(u[1])) return res.status(403).send('Forbidden');
  const fpath = Reports.getScreenshotPath(req.params.filename);
  if (!fpath || !fs.existsSync(fpath)) return res.status(404).send('Not found');
  res.sendFile(fpath);
});

// Tüm raporları + ekran görüntülerini tek HTML dosyası olarak dışa aktar
app.get('/admin/export-reports', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(403).send('Forbidden');
  const u = Array.from(authed.entries()).find(([sid, uname]) => sid === token);
  if (!u || !Accounts.isAdmin(u[1])) return res.status(403).send('Forbidden');

  const reports = Reports.list();
  const screenshotDir = Reports.getScreenshotDir();
  // HTML olarak inline base64 görüntüler
  let html = `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><title>AZAP — Tüm Bug Raporları</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#1a1a1a;color:#e0e0e0;padding:20px;line-height:1.5}
h1{color:#c0392b;border-bottom:2px solid #c0392b;padding-bottom:8px;margin-bottom:20px}
.summary{background:#2a2a2a;padding:12px;border-radius:6px;margin-bottom:20px;font-size:14px}
.report{background:#252525;border-left:4px solid #c0392b;padding:16px;margin-bottom:16px;border-radius:4px}
.report.closed{border-left-color:#27ae60;opacity:0.7}
.report-hdr{display:flex;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px}
.report-id{font-family:monospace;color:#888;font-size:12px}
.report-user{color:#3498db;font-weight:600}
.report-status{padding:2px 8px;border-radius:3px;font-size:11px;background:#c0392b;color:#fff}
.report-status.closed{background:#27ae60}
.report-date{color:#888;font-size:12px}
.report-desc{background:#1a1a1a;padding:12px;border-radius:4px;margin:10px 0;white-space:pre-wrap;word-wrap:break-word;font-size:13px}
.report-img{max-width:100%;border:1px solid #444;border-radius:4px;margin-top:8px}
</style></head><body>
<h1>⛧ AZAP — Bug Raporları</h1>
<div class="summary">
<strong>Toplam Rapor:</strong> ${reports.length} •
<strong>Açık:</strong> ${reports.filter(r => r.status === 'open').length} •
<strong>Kapalı:</strong> ${reports.filter(r => r.status === 'closed').length} •
<strong>Dışa aktarma:</strong> ${new Date().toLocaleString('tr-TR')}
</div>
`;

  reports.forEach(r => {
    const date = new Date(r.createdAt).toLocaleString('tr-TR');
    let imgHtml = '';
    if (r.screenshot) {
      try {
        const buf = fs.readFileSync(path.join(screenshotDir, r.screenshot));
        const ext = r.screenshot.split('.').pop();
        const mime = ext === 'jpg' ? 'jpeg' : ext;
        imgHtml = `<img class="report-img" src="data:image/${mime};base64,${buf.toString('base64')}" alt="Screenshot">`;
      } catch (e) {
        imgHtml = `<div style="color:#888;font-style:italic">[Ekran görüntüsü yüklenemedi: ${r.screenshot}]</div>`;
      }
    }
    html += `<div class="report ${r.status === 'closed' ? 'closed' : ''}">
<div class="report-hdr">
  <div><span class="report-user">${r.username}</span> <span class="report-id">${r.id}</span></div>
  <div><span class="report-status ${r.status}">${r.status === 'closed' ? 'KAPALI' : 'AÇIK'}</span> <span class="report-date">${date}</span></div>
</div>
<div class="report-desc">${r.description.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
${imgHtml}
</div>`;
  });

  html += '</body></html>';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="azap-reports-${Date.now()}.html"`);
  res.send(html);
});

app.get('*', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
const rooms = new Map(), prooms = new Map(), authed = new Map(), timers = new Map();
const radioStartTime = Date.now(); // Sunucu ilk açıldığında radyoyu başlat


function genCode() { let c; do { c = String(1000 + Math.random() * 9000 | 0); } while (rooms.has(c)); return c; }
function startTimer(rc, dur, cb) {
  clearTimer(rc);
  const end = Date.now() + dur * 1000;
  timers.set(rc, setInterval(() => {
    const rem = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    io.to(rc).emit('timer', { rem, total: dur });
    if (rem <= 0) { clearTimer(rc); cb(); }
  }, 1000));
}
// Aynı kullanıcının başka socket'lerini kapat (çift bağlantı sorununu engelle)
function kickOldSessions(username, currentSocketId) {
  if (!username) return;
  const uname = username.toLowerCase().trim();
  const toKick = [];
  authed.forEach((u, sid) => {
    if (sid !== currentSocketId && u && u.toLowerCase().trim() === uname) {
      toKick.push(sid);
    }
  });
  toKick.forEach(sid => {
    const s = io.sockets.sockets.get(sid);
    if (s) {
      s.emit('forceLogout', { reason: 'Başka bir cihazda giriş yapıldı.' });
      s.disconnect(true);
    }
    authed.delete(sid);
  });
}

function clearTimer(rc) {
  if (timers.has(rc)) { clearInterval(timers.get(rc)); timers.delete(rc); }
  // Emit throttle timer'ı da temizle (oda silinirken)
  if (_emitTimers.has(rc)) { clearTimeout(_emitTimers.get(rc)); _emitTimers.delete(rc); }
  _emitPending.delete(rc);
}

// Faz akışı
function afterStart(rc) {
  const g = rooms.get(rc); if (!g) return;
  if (g.phase === PHASES.ROLE_SELECTION) {
    // Her oyuncuya max 25 saniye süre — otomatik geçişler
    startTimer(rc, g.config.ROLE_SELECTION_DURATION, () => autoPickIfNeeded(rc));
    emit(rc);
  } else if (g.phase === PHASES.ROLE_REVEAL) {
    emit(rc);
    startTimer(rc, g.config.ROLE_REVEAL_DURATION, () => toPresidentVote(rc));
  }
}

function autoPickIfNeeded(rc) {
  const g = rooms.get(rc); if (!g) return;
  if (g.phase !== PHASES.ROLE_SELECTION) return;
  // Sıradaki oyuncu seçim yapmadıysa rastgeleye basılmış say
  const cur = g.roleSelectionOrder[g.roleSelectionIndex];
  if (!cur) return;
  const r = g.submitRoleChoice(cur, 'random');
  emit(rc);
  if (r?.done) {
    // Rol seçim bitti → Role reveal
    startTimer(rc, g.config.ROLE_REVEAL_DURATION, () => toPresidentVote(rc));
  } else {
    // Sıradakine geç
    startTimer(rc, g.config.ROLE_SELECTION_DURATION, () => autoPickIfNeeded(rc));
  }
}

function toPresidentVote(rc) {
  const g = rooms.get(rc); if (!g) return;
  g.startPresidentVote(); emit(rc);
  startTimer(rc, g.config.PRESIDENT_VOTE_DURATION, () => {
    g.resolvePresidentVote(); emit(rc);
    setTimeout(() => toNight(rc), 2000);
  });
}

function toNight(rc) { const g = rooms.get(rc); if (!g) return; g.startNight(); emit(rc); startTimer(rc, g.config.NIGHT_DURATION, () => resolveNight(rc)); }
function resolveNight(rc) {
  const g = rooms.get(rc); if (!g) return;
  const reps = g.resolveNight(); emit(rc);
  g.players.forEach((_, pid) => io.sockets.sockets.get(pid)?.emit('report', { reports: reps.get(pid) || [], round: g.round }));
  // Bomba patladıysa tüm odaya bildir (efekt için)
  if (g.bombExplosions && g.bombExplosions.length > 0) {
    io.to(rc).emit('bombExplosion', { victims: g.bombExplosions });
  }
  // ÖNEMLİ: Gece bittikten sonra oyun bitti mi kontrol et
  const wc = g.checkWin();
  if (wc.over) {
    setTimeout(() => endGame(rc, wc, null), g.config.REPORT_DURATION * 1000);
    return;
  }
  startTimer(rc, g.config.REPORT_DURATION, () => toDay(rc));
}
function toDay(rc) { const g = rooms.get(rc); if (!g) return; g.startDiscussion(); emit(rc); startTimer(rc, g.config.DISCUSSION_DURATION, () => toVote(rc)); }
function toVote(rc) { const g = rooms.get(rc); if (!g) return; g.startVoting(); emit(rc); startTimer(rc, g.config.VOTING_DURATION, () => resolveVote(rc)); }
function resolveVote(rc) {
  const g = rooms.get(rc); if (!g) return;
  const res = g.resolveVoting();
  io.to(rc).emit('voteResult', res); emit(rc);
  let wc = g.checkWin();
  // Dodo kendini astırırsa anında oyun biter, tek başına kazanır
  if (!wc.over && res.dodoWins) {
    wc = { over: true, winner: 'dodo', msg: '🦤 Dodo kazandı! Kendini astırdı!' };
  } else if (res.cellatWins) {
    // Cellat hedefini astırdı: oyunu bitirme, sadece bildirim ve kazanma kayıtı
    // (Cellat artık kazananlar listesinde olacak ama oyun devam eder)
    const cellat = g.players.get(res.cellatWins);
    const target = g.players.get(g.cellatTarget.get(res.cellatWins));
    // ÖNEMLİ: cellat ismi tüm odaya gönderilmez (gizlilik). Sadece hedefin adı + cellat kurbanı olduğu bildirimi.
    io.to(rc).emit('cellatVictory', {
      targetName: target?.name || '?'
    });
    // Cellata özel bildirim (sadece kendisi görür)
    io.sockets.sockets.get(res.cellatWins)?.emit('cellatPrivateWin', {
      targetName: target?.name || '?'
    });
    g.log(`⛓️ Cellat ${cellat?.name} hedefi ${target?.name}'i astırdı!`);
  }
  if (wc.over) {
    setTimeout(() => endGame(rc, wc, res), g.config.RESULT_DURATION * 1000);
  } else {
    startTimer(rc, g.config.RESULT_DURATION, () => { g.nextRound(); emit(rc); startTimer(rc, g.config.NIGHT_DURATION, () => resolveNight(rc)); });
  }
}
function endGame(rc, wc, res) {
  const g = rooms.get(rc); if (!g) return;
  g.phase = PHASES.GAME_OVER;
  g.gameEnded = true;

  // Kazananları wc.winner'a göre hesapla
  const winnerKey = wc.winner;
  const winnerPlayers = [...g.players.values()].filter(p => {
    // Cellat hedefini astırmışsa daima kazanır (oyunu kim kazansa kazansın)
    if (p.role === 'cellat' && g.cellatWon.has(p.id)) return true;
    // Yamyam: hem hainlerle hem masumlarla kazanır (kazanan takım masum/hain ise)
    if (p.role === 'yamyam' && (winnerKey === TEAMS.MASUM || winnerKey === TEAMS.HAIN)) return true;
    if (winnerKey === p.actualTeam) return true;
    if (winnerKey === 'seri_katil' && p.role === 'seri_katil') return true;
    if (winnerKey === 'dodo' && p.role === 'dodo') return true;
    return false;
  });
  const winnerUsernames = winnerPlayers.map(p => p.username).filter(Boolean);
  const winnerSet = new Set(winnerUsernames);
  winnerUsernames.forEach(u => Accounts.record(u, true));
  [...g.players.values()].map(p => p.username).filter(u => u && !winnerSet.has(u)).forEach(u => Accounts.record(u, false));

  // Stats güncellemesi
  g.players.forEach(p => {
    const stats = Accounts.getStats(p.username);
    if (stats) {
      p.wins = stats.stats.won;
      p.mvp = stats.stats.mvp || 0;
      io.sockets.sockets.get(p.id)?.emit('statsUpdate', stats);
    }
  });

  const data = {
    ...wc, dodoWins: res?.dodoWins, cellatWins: res?.cellatWins,
    players: [...g.players.values()].map(p => {
      const ro = g.ro(p.role);
      return {
        id: p.id, name: p.name, username: p.username, avatar: p.avatar,
        role: p.role, roleName: ro?.name, roleEmoji: ro?.emoji,
        team: p.actualTeam, isAlive: p.isAlive, isInsane: p.isInsane,
        isWinner: winnerSet.has(p.username)
      };
    }),
    winners: winnerPlayers.map(p => ({
      id: p.id, name: p.name, username: p.username, avatar: p.avatar,
      roleName: g.ro(p.role)?.name, roleEmoji: g.ro(p.role)?.emoji,
      isInsane: p.isInsane
    }))
  };
  g.gameResult = data;
  io.to(rc).emit('gameOver', data); emit(rc);

  // 5 saniye sonra MVP oylama başlat
  setTimeout(() => {
    if (rooms.get(rc) && rooms.get(rc).phase === PHASES.GAME_OVER) {
      startMvpVote(rc);
    }
  }, 5000);
}

function startMvpVote(rc) {
  const g = rooms.get(rc); if (!g) return;
  g.startMvpVote();
  emit(rc);
  startTimer(rc, g.config.MVP_VOTE_DURATION, () => resolveMvp(rc));
}

function resolveMvp(rc) {
  const g = rooms.get(rc); if (!g) return;
  const result = g.resolveMvpVote();
  // MVP'ye 1 puan kaydet
  if (result.mvp?.username) {
    Accounts.recordMvp(result.mvp.username);
    // Stats güncellemesi: TÜM oyuncuları senkronla
    g.players.forEach(p => {
      const stats = Accounts.getStats(p.username);
      if (stats) {
        p.wins = stats.stats.won;
        p.mvp = stats.stats.mvp || 0;
        const s = io.sockets.sockets.get(p.id);
        if (s) s.emit('statsUpdate', stats);
      }
    });
  }
  io.to(rc).emit('mvpResult', result);
  emit(rc);
  startTimer(rc, g.config.MVP_RESULT_DURATION, () => {
    g.phase = PHASES.POST_GAME;
    emit(rc);
  });
}

// Emit throttling - aynı odaya kısa süre içinde birden fazla emit gelirse birleştir
const _emitTimers = new Map(); // rc -> timeout id
const _emitPending = new Set(); // rc set

function emit(rc) {
  // Aynı oda için 50ms içinde tekrarlanan emit'leri tek bir gerçek emit'e indir
  if (_emitTimers.has(rc)) {
    _emitPending.add(rc);
    return;
  }
  _emitImmediate(rc);
  _emitTimers.set(rc, setTimeout(() => {
    _emitTimers.delete(rc);
    if (_emitPending.has(rc)) {
      _emitPending.delete(rc);
      _emitImmediate(rc);
    }
  }, 50));
}

function _emitImmediate(rc) {
  const g = rooms.get(rc); if (!g) return;
  const pub = g.publicState();
  io.to(rc).emit('state', pub);
  // Sadece odadaki canlı/ölü oyunculara priv gönder (not: spec data sadece ölülere gönderiliyor)
  let spec = null;
  g.players.forEach((p, pid) => {
    const sock = io.sockets.sockets.get(pid);
    if (!sock) return;
    sock.emit('priv', g.privateState(pid));
    if (!p.isAlive) {
      if (!spec) spec = g.spectatorState(); // lazy compute
      sock.emit('spec', spec);
    }
  });
  if (g.spectators.size > 0) {
    if (!spec) spec = g.spectatorState();
    g.spectators.forEach((_, sid) => io.sockets.sockets.get(sid)?.emit('spec', spec));
  }
}

function emitVoteTally(rc) {
  const g = rooms.get(rc); if (!g || g.phase !== PHASES.VOTING) return;
  io.to(rc).emit('voteTally', g.getVoteTally());
}

function emitHainKillVotes(rc) {
  const g = rooms.get(rc); if (!g) return;
  const votes = g.getHainKillVotes();
  // Sadece hainlere gönder
  g.players.forEach(p => {
    if (p.actualTeam === 'hain') {
      io.sockets.sockets.get(p.id)?.emit('hainKillVotes', votes);
    }
  });
}

io.on('connection', (socket) => {
  socket.emit('sync_radio', {
    startTime: radioStartTime,
    serverTime: Date.now()
  });

  socket.on('auth:register', (d, cb) => { /* ... */ });
  socket.on('auth:register', (d, cb) => { const r = Accounts.register(d.username, d.password); if (r.success) { kickOldSessions(d.username.trim(), socket.id); authed.set(socket.id, d.username.trim()); } cb(r); });
  socket.on('auth:login', (d, cb) => {
    const r = Accounts.login(d.username, d.password, !!d.rememberMe);
    if (r.success) { kickOldSessions(d.username.trim(), socket.id); authed.set(socket.id, d.username.trim()); }
    cb(r);
  });
  // Token ile otomatik giriş
  socket.on('auth:loginByToken', ({ token }, cb) => {
    const r = Accounts.loginByToken(token);
    if (r.success) { kickOldSessions(r.user.username, socket.id); authed.set(socket.id, r.user.username); }
    cb(r);
  });
  // Çıkış yap
  socket.on('auth:logout', ({ token }, cb) => {
    if (token) Accounts.logoutToken(token);
    authed.delete(socket.id);
    cb?.({ success: true });
  });
  socket.on('auth:stats', (_, cb) => { const u = authed.get(socket.id); cb(u ? Accounts.getStats(u) : null); });
  socket.on('auth:leaderboard', (_, cb) => cb(Accounts.leaderboard()));
  socket.on('auth:changePassword', ({ oldPass, newPass }, cb) => {
    const u = authed.get(socket.id);
    if (!u) return cb({ success: false, error: 'Giriş yap!' });
    cb(Accounts.changePassword(u, oldPass, newPass));
  });
  socket.on('auth:setAvatar', ({ avatar }, cb) => {
    const u = authed.get(socket.id);
    if (!u) return cb({ success: false, error: 'Giriş yap!' });
    const r = Accounts.setAvatar(u, avatar);
    cb(r);
    // Aktif odadaki oyuncuların avatarını güncelle
    const rc = prooms.get(socket.id);
    if (rc && r.success) {
      const g = rooms.get(rc);
      if (g) {
        const p = g.players.get(socket.id);
        if (p) { p.avatar = r.avatar; emit(rc); }
        const s = g.spectators.get(socket.id);
        if (s) { s.avatar = r.avatar; emit(rc); }
      }
    }
  });

  socket.on('room:create', ({ playerName }, cb) => {
    const u = authed.get(socket.id);
    if (!u) return cb({ ok: false, err: 'Giriş yap!' });
    const stats = Accounts.getStats(u);
    const code = genCode(), g = new GameEngine(code, socket.id);
    g.addPlayer(socket.id, playerName, u, stats?.stats?.won || 0, stats?.avatar, stats?.stats?.mvp || 0, !!stats?.isAdmin);
    rooms.set(code, g); prooms.set(socket.id, code); socket.join(code);
    cb({ ok: true, code }); emit(code);
  });

  socket.on('room:join', ({ code, playerName }, cb) => {
    const u = authed.get(socket.id);
    if (!u) return cb({ ok: false, err: 'Giriş yap!' });
    const g = rooms.get(code);
    if (!g) return cb({ ok: false, err: 'Oda yok!' });
    if (g.phase !== PHASES.LOBBY && g.phase !== PHASES.POST_GAME) return cb({ ok: false, err: 'Oyun başlamış!' });
    const stats = Accounts.getStats(u);
    if (!g.addPlayer(socket.id, playerName, u, stats?.stats?.won || 0, stats?.avatar, stats?.stats?.mvp || 0, !!stats?.isAdmin)) return cb({ ok: false, err: 'Oda dolu!' });
    prooms.set(socket.id, code); socket.join(code);
    cb({ ok: true, code }); emit(code);
  });

  socket.on('room:spectate', ({ code }, cb) => {
    const u = authed.get(socket.id);
    if (!u) return cb({ ok: false, err: 'Giriş yap!' });
    const g = rooms.get(code);
    if (!g) return cb({ ok: false, err: 'Oda yok!' });
    const stats = Accounts.getStats(u);
    g.addSpectator(socket.id, u, u, stats?.avatar);
    prooms.set(socket.id, code); socket.join(code);
    cb({ ok: true, code, spectator: true }); emit(code);
  });

  socket.on('room:leave', () => {
    const rc = prooms.get(socket.id);
    if (rc) {
      const g = rooms.get(rc);
      if (g) {
        g.removePlayer(socket.id); g.removeSpectator(socket.id);
        if (g.players.size === 0 && g.spectators.size === 0) { rooms.delete(rc); clearTimer(rc); }
        else { 
          // Lider ayrıldıysa yeni lider seç
          if (g.leaderId === socket.id && g.players.size > 0) {
            g.leaderId = [...g.players.keys()][0];
          }
          emit(rc); 
        }
      }
      socket.leave(rc);
      prooms.delete(socket.id);
    }
  });

  // Yeni oyun (post-game'den lobiye) — herkes başlatabilir
  socket.on('room:newGame', () => {
    const rc = prooms.get(socket.id);
    const g = rooms.get(rc);
    if (!g) return;
    if (g.phase !== PHASES.GAME_OVER && g.phase !== PHASES.POST_GAME && g.phase !== 'mvp_result') return;
    g.resetForNewGame();
    clearTimer(rc);
    emit(rc);
  });

  socket.on('settings', (d) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc);
    if (!g || g.leaderId !== socket.id) return;
    if (g.phase !== PHASES.LOBBY) return;
    if (d.enabledRoles) g.enabledRoles = new Set(d.enabledRoles);
    if (d.insanityRate !== undefined) g.insanityRate = Math.max(0, Math.min(100, d.insanityRate));
    if (d.config) g.setConfig(d.config);
    if (d.hainKillMode) g.setHainKillMode(d.hainKillMode);
    if (d.roleSelectionMode) g.setRoleSelectionMode(d.roleSelectionMode);
    if (d.manualCounts !== undefined) {
      g.manualCounts = d.manualCounts;
      if (d.manualCounts && d.hainCount !== undefined && d.tarafsizCount !== undefined) {
        g.setTeamCounts(d.hainCount, d.tarafsizCount);
      }
    }
    // Throttle ile emit (lider slider'ı çok hızlı değiştirirse her değişimde state göndermesin)
    emit(rc);
  });

  socket.on('start', (_, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc);
    if (!g || g.leaderId !== socket.id) return cb?.({ ok: false, err: 'Yetki yok!' });
    if (g.players.size < g.config.MIN_PLAYERS) return cb?.({ ok: false, err: `En az ${g.config.MIN_PLAYERS} oyuncu!` });
    if (!g.startGame()) return cb?.({ ok: false, err: 'Dağıtım başarısız!' });
    cb?.({ ok: true });
    afterStart(rc);
  });

  // Rol seçimi (pick mode)
  socket.on('roleChoice', ({ choice }, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc); if (!g) return;
    const r = g.submitRoleChoice(socket.id, choice);
    if (r === false) return cb?.({ ok: false, err: 'Sıran değil!' });
    cb?.({ ok: true });
    emit(rc);
    if (r.done) {
      clearTimer(rc);
      startTimer(rc, g.config.ROLE_REVEAL_DURATION, () => toPresidentVote(rc));
    } else {
      // Süreyi sıfırla
      clearTimer(rc);
      startTimer(rc, g.config.ROLE_SELECTION_DURATION, () => autoPickIfNeeded(rc));
    }
  });

  // Başkan oylama
  socket.on('presidentVote', ({ targetId }, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc); if (!g) return;
    const ok = g.submitPresidentVote(socket.id, targetId);
    cb?.({ ok });
    if (ok) {
      // Sadece tally event'i (tüm state değil)
      io.to(rc).emit('presidentVoteTally', g.getPresidentVoteTally());
      // Tüm canlı oyuncular oy verdiyse süreyi atla
      if (g.phase === PHASES.PRESIDENT_VOTE) {
        const aliveCount = g.alive().length;
        if (g.presidentVotes.size >= aliveCount) {
          clearTimer(rc);
          g.resolvePresidentVote(); emit(rc);
          setTimeout(() => toNight(rc), 2000);
        }
      }
    }
  });

  socket.on('nightAction', (a, cb) => {
    try {
      const rc = prooms.get(socket.id), g = rooms.get(rc);
      if (!g) { cb?.({ ok: false, err: 'Oda bulunamadı' }); return; }
      const ok = g.submitAction(socket.id, a);
      cb?.({ ok });
      const p = g.players.get(socket.id);
      if (ok && p?.actualTeam === 'hain') {
        emitHainKillVotes(rc);
        g.players.forEach((pp, pid) => {
          if (pid !== socket.id && pp.actualTeam === 'hain')
            io.sockets.sockets.get(pid)?.emit('hainAction', { from: p.name, action: a.action || 'seçim' });
        });
      }
    } catch (e) {
      console.error('nightAction error:', e);
      cb?.({ ok: false, err: 'Sunucu hatası' });
    }
  });

  socket.on('hainChat', ({ msg }) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc); if (!g) return;
    const p = g.players.get(socket.id);
    if (p?.actualTeam !== 'hain') return;
    g.players.forEach((pp, pid) => {
      if (pp.actualTeam === 'hain')
        io.sockets.sockets.get(pid)?.emit('hainMsg', { from: p.name, msg });
    });
  });

  // Suikastçı gündüz suikast girişimi
  socket.on('suikast', ({ targetId, guessedRole }, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc); if (!g) return;
    const res = g.submitSuikast(socket.id, targetId, guessedRole);
    cb?.({ ok: res.ok, err: res.err });
    if (res.ok) {
      // Suikastçıya özel sonuç (kim öldürdü/öldü detayı)
      socket.emit('suikastPrivate', res.privateResult);
      // Tüm odaya anonim mesaj (sadece kim öldü, kim/neden öldürdü gizli)
      io.to(rc).emit('suikastPublic', res.publicResult);
      emit(rc);
      // Suikast sonrası oyun sonu kontrolü
      const wc = g.checkWin();
      if (wc.over) {
        setTimeout(() => endGame(rc, wc, null), 3000);
      }
    }
  });

  socket.on('vote', ({ targetId }, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc); if (!g) return;
    const ok = g.submitVote(socket.id, targetId);
    cb?.({ ok });
    if (ok) {
      emitVoteTally(rc);
      // Tüm canlı oyuncular oy verdiyse süreyi atla
      if (g.phase === PHASES.VOTING) {
        const aliveCount = g.alive().length;
        if (g.votes.size >= aliveCount) {
          clearTimer(rc);
          // Hemen sonuca geç
          resolveVote(rc);
        }
      }
    }
  });

  socket.on('mvpVote', ({ targetId }, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc); if (!g) return;
    const ok = g.submitMvpVote(socket.id, targetId);
    cb?.({ ok });
    if (ok) {
      // Anlık tally yayınla
      io.to(rc).emit('mvpTally', g.getMvpTally());
      // Tüm oyuncular oy verdiyse süreyi atla (MVP'de ölü oyuncular da oy verir)
      if (g.phase === 'mvp_vote') {
        const totalVoters = g.players.size;
        if (g.mvpVotes.size >= totalVoters) {
          clearTimer(rc);
          resolveMvp(rc);
        }
      }
    }
  });

  // ── BUG RAPOR (tüm kullanıcılar) ──
  socket.on('report:create', ({ description, screenshot }, cb) => {
    const u = authed.get(socket.id);
    const result = Reports.create({
      username: u || 'anonim',
      description,
      screenshot
    });
    cb?.(result);
  });

  // ── ADMIN HANDLERLARI ──
  // Tüm admin işlemleri admin kontrolünden geçer
  function requireAdmin(cb) {
    const u = authed.get(socket.id);
    if (!u || !Accounts.isAdmin(u)) {
      cb?.({ ok: false, err: 'Admin yetkin yok!' });
      return false;
    }
    return true;
  }

  // Kullanıcı listesi
  socket.on('admin:listUsers', (_, cb) => {
    if (!requireAdmin(cb)) return;
    cb?.({ ok: true, users: Accounts.listAll() });
  });

  // Yeni hesap oluştur
  socket.on('admin:createUser', ({ username, password, isAdmin }, cb) => {
    if (!requireAdmin(cb)) return;
    const r = Accounts.adminCreate(username, password, isAdmin);
    cb?.(r.success ? { ok: true } : { ok: false, err: r.error });
  });

  // Hesap sil
  socket.on('admin:deleteUser', ({ username }, cb) => {
    if (!requireAdmin(cb)) return;
    const r = Accounts.adminDelete(username);
    cb?.(r.success ? { ok: true } : { ok: false, err: r.error });
  });

  // İstatistik düzenleme
  socket.on('admin:setStats', ({ username, stats }, cb) => {
    if (!requireAdmin(cb)) return;
    const r = Accounts.adminSetStats(username, stats);
    cb?.(r.success ? { ok: true } : { ok: false, err: r.error });
  });

  // Admin yetkisi değiştir
  socket.on('admin:toggleAdmin', ({ username, isAdmin }, cb) => {
    if (!requireAdmin(cb)) return;
    const r = Accounts.adminToggle(username, isAdmin);
    cb?.(r.success ? { ok: true } : { ok: false, err: r.error });
  });

  // Şifre sıfırla
  socket.on('admin:resetPassword', ({ username, newPassword }, cb) => {
    if (!requireAdmin(cb)) return;
    const r = Accounts.adminResetPassword(username, newPassword);
    cb?.(r.success ? { ok: true } : { ok: false, err: r.error });
  });

  // Bug raporlarını listele
  socket.on('admin:listReports', (_, cb) => {
    if (!requireAdmin(cb)) return;
    cb?.({ ok: true, reports: Reports.list() });
  });

  // Rapor sil
  socket.on('admin:deleteReport', ({ id }, cb) => {
    if (!requireAdmin(cb)) return;
    const r = Reports.delete(id);
    cb?.(r.success ? { ok: true } : { ok: false });
  });

  // Rapor durumunu değiştir (open/closed)
  socket.on('admin:setReportStatus', ({ id, status }, cb) => {
    if (!requireAdmin(cb)) return;
    const r = Reports.setStatus(id, status);
    cb?.(r.success ? { ok: true } : { ok: false });
  });

  // Admin token al (screenshot URL'leri için)
  socket.on('admin:getToken', (_, cb) => {
    if (!requireAdmin(cb)) return;
    cb?.({ ok: true, token: socket.id });
  });

  socket.on('disconnect', () => {
    const rc = prooms.get(socket.id);
    if (rc) {
      const g = rooms.get(rc);
      if (g) {
        if (g.phase === PHASES.LOBBY || g.phase === PHASES.POST_GAME) {
          g.removePlayer(socket.id); g.removeSpectator(socket.id);
          if (g.players.size === 0 && g.spectators.size === 0) { rooms.delete(rc); clearTimer(rc); }
          else {
            if (g.leaderId === socket.id && g.players.size > 0) g.leaderId = [...g.players.keys()][0];
            emit(rc);
          }
        }
      }
      prooms.delete(socket.id);
    }
    authed.delete(socket.id);
  });
});

// Beklenmedik hatalar sunucuyu çökertmesin (donma yerine devam etsin)
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`\n  ⛧ AZAP v4 aktif: http://localhost:${PORT}\n  Created by Azad Akdağ\n`));
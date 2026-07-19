// ============================================================
// AZAP — Rol Motoru Otomatik Testleri
// Çalıştırma: node tests/role-tests.js
// GameEngine'i doğrudan kullanarak her rolün gece/gündüz
// çözümlemesini ve kritik kombinasyonları doğrular.
// ============================================================
const GameEngine = require('../server/gameEngine');
const { TEAMS, ROLES, PHASES } = require('../server/gameConstants');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}
function section(t) { console.log(`\n── ${t} ──`); }

function rk(roleId) { return Object.keys(ROLES).find(k => ROLES[k].id === roleId); }

// roleMap: { pid: roleId }, opts.insane: [pid]
function makeGame(roleMap, opts = {}) {
  const g = new GameEngine('TEST', Object.keys(roleMap)[0]);
  Object.entries(roleMap).forEach(([pid, roleId]) => {
    g.addPlayer(pid, pid, pid, 0, null, 0, false, {});
    const p = g.players.get(pid);
    p.role = roleId;
    p.actualTeam = ROLES[rk(roleId)].team;
    p.displayedRole = roleId;
    if (opts.insane && opts.insane.includes(pid)) p.isInsane = true;
  });
  g._setupCellat();
  g.round = 1;
  return g;
}
function night(g) { g.phase = PHASES.NIGHT; g.startNight(); }
function repTexts(rep, pid) { return (rep.get(pid) || []).map(r => r.t).join(' | '); }

// ─────────────────────────────────────────────
section('DOKTOR — koruma');
{
  const g = makeGame({ d: 'doktor', h: 'vampir', m: 'muhtar', m2: 'kurban' });
  night(g);
  g.submitAction('d', { action: 'ability', targetId: 'm' });
  g.submitAction('h', { action: 'kill', killTargetId: 'm' });
  const rep = g.resolveNight();
  check('Doktor korunan hedef ölmez', g.players.get('m').isAlive);
  check('Doktor "kurtardın" raporu alır', repTexts(rep, 'd').includes('kurtardın'));
  check('Saldıran hain "korunuyordu" görür', repTexts(rep, 'h').includes('korunuyordu'));
}
{
  const g = makeGame({ d: 'doktor', h: 'vampir', m: 'muhtar' });
  night(g);
  g.submitAction('d', { action: 'ability', targetId: 'd' }); // kendini koru (1. kez)
  const r1 = g.resolveNight();
  check('Doktor kendini 1 kez koruyabilir', g.doktorSelfUsed.has('d'));
  night(g);
  g.submitAction('d', { action: 'ability', targetId: 'd' });
  const r2 = g.resolveNight();
  check('Doktor 2. kez kendini koruyamaz', repTexts(r2, 'd').includes('zaten'));
  check('2. denemede kalkan uygulanmaz', !g.players.get('d').isShielded);
}

section('POLİS — engelleme');
{
  const g = makeGame({ p: 'polis', h: 'vampir', m: 'muhtar' });
  night(g);
  g.submitAction('h', { action: 'kill', killTargetId: 'm' });
  g.submitAction('p', { action: 'ability', targetId: 'h' });
  const rep = g.resolveNight();
  check('Polis haini engeller — kurban yaşar', g.players.get('m').isAlive);
  check('Polis "girişimi durduruldu" raporu alır', repTexts(rep, 'p').includes('engellendi'));
}
{
  // MANTIK KONTROLÜ: rehber "Seri Katil engellenemez" diyor
  const g = makeGame({ p: 'polis', sk: 'seri_katil', m: 'muhtar', h: 'vampir' });
  night(g);
  g.submitAction('sk', { action: 'kill', targetId: 'm' });
  g.submitAction('p', { action: 'ability', targetId: 'sk' });
  const rep = g.resolveNight();
  check('Seri Katil polis tarafından ENGELLENEMEZ (rehber kuralı)', !g.players.get('m').isAlive,
    'SK bloklandı, kurban yaşıyor — rehberle çelişki');
}

section('ÇİLİNGİR — kilit (koruma + blok)');
{
  const g = makeGame({ c: 'cilingir', h: 'vampir', m: 'savci', k: 'muhtar' });
  night(g);
  g.submitAction('c', { action: 'ability', targetId: 'm' });
  g.submitAction('h', { action: 'kill', killTargetId: 'm' });
  g.submitAction('m', { action: 'ability', targetId: 'h' }); // savcı sorgu — bloklu olmalı
  const rep = g.resolveNight();
  check('Kilitli hedef ölmez', g.players.get('m').isAlive);
  check('Kilitli hedef yetenek kullanamaz (savcı raporu yok)', !repTexts(rep, 'm').includes('Vampir'));
  check('Savcı hakkı bloklu gecede harcanmaz', !g.savciUsed.has('m'));
}
{
  const g = makeGame({ c: 'cilingir', hip: 'hipnotizmaci', m: 'muhtar', h2: 'golge' });
  night(g);
  g.submitAction('c', { action: 'ability', targetId: 'm' });
  g.submitAction('hip', { action: 'ability', abilityTargetId: 'm' });
  g.submitAction('h2', { action: 'ability', abilityTargetId: 'm' });
  const rep = g.resolveNight();
  check('Kilitli hedef hipnotize edilemez', !g.players.get('m').isTempInsane);
  check('Kilitli hedef susturulamaz', !g.players.get('m').isSilenced);
}

section('SAVCI — tek kullanım + deli tutarlılığı');
{
  const g = makeGame({ s: 'savci', h: 'vampir', m: 'muhtar' });
  night(g);
  g.submitAction('s', { action: 'ability', targetId: 'h' });
  const rep = g.resolveNight();
  check('Savcı gerçek rolü görür', repTexts(rep, 's').includes('Vampir'));
  check('Savcı hakkı tükenir', g.savciUsed.has('s'));
  night(g);
  g.submitAction('s', { action: 'ability', targetId: 'm' });
  const r2 = g.resolveNight();
  check('Savcı 2. kez kullanamaz', repTexts(r2, 's').includes('hakkını kullandın'));
}
{
  const g = makeGame({ s: 'savci', h: 'vampir', m: 'muhtar' }, { insane: ['s'] });
  night(g);
  g.submitAction('s', { action: 'ability', targetId: 'h' });
  const rep = g.resolveNight();
  check('DELİ savcı da hakkını tüketir (sızıntı düzeltmesi)', g.savciUsed.has('s'));
  // Rapor ile geçmiş TUTARLI olmalı (geçmişte gerçek rol sızmamalı)
  const hist = g.actionHistory.get('s') || [];
  const last = hist[hist.length - 1];
  const reportTxt = repTexts(rep, 's');
  check('DELİ savcı geçmişi raporla tutarlı (sızıntı yok)', last && reportTxt.includes(last.result),
    `hist: ${last && last.result} / rapor: ${reportTxt}`);
}

section('GAZİ — tek kullanımlık ölümsüzlük');
{
  const g = makeGame({ gz: 'gazi', sk: 'seri_katil', m: 'muhtar' });
  night(g);
  g.submitAction('gz', { action: 'activate' });
  g.submitAction('sk', { action: 'kill', targetId: 'gz' });
  const rep = g.resolveNight();
  check('Gazi ölümsüzken SK öldüremez', g.players.get('gz').isAlive);
  check('Gazi hakkı tükenir', g.gaziUsed.has('gz'));
}

section('ŞERİF — vurma senaryoları');
{
  const g = makeGame({ sf: 'serif', h: 'vampir', m: 'muhtar' });
  night(g);
  g.submitAction('sf', { action: 'shoot', targetId: 'h' });
  g.resolveNight();
  check('Şerif haini vurursa hain ölür', !g.players.get('h').isAlive);
  check('Şerif hayatta kalır (kahraman)', g.players.get('sf').isAlive);
}
{
  const g = makeGame({ sf: 'serif', h: 'vampir', m: 'muhtar' });
  night(g);
  g.submitAction('sf', { action: 'shoot', targetId: 'm' });
  g.resolveNight();
  check('Şerif masumu vurursa masum ölür', !g.players.get('m').isAlive);
  check('Şerif de anında ölür', !g.players.get('sf').isAlive);
}
{
  const g = makeGame({ sf: 'serif', h: 'vampir', m: 'muhtar' }, { insane: ['sf'] });
  night(g);
  g.submitAction('sf', { action: 'shoot', targetId: 'h' });
  const rep = g.resolveNight();
  check('DELİ şerif kimseyi öldürmez', g.players.get('h').isAlive);
  check('DELİ şerif normal şerifle aynı raporu alır', repTexts(rep, 'sf').includes('kahraman'));
  check('DELİ şerif hakkı tükenir', g.serifUsed.has('sf'));
}

section('BUZCU — karantina + deli sayacı');
{
  const g = makeGame({ b: 'buzcu', h: 'vampir', m: 'muhtar', m2: 'kurban' });
  night(g);
  g.submitAction('b', { action: 'ability', targetId: 'm' });
  g.submitAction('h', { action: 'kill', killTargetId: 'm' });
  g.resolveNight();
  check('Karantinadaki saldırıdan korunur', g.players.get('m').isAlive);
  check('Buzcu hakkı 2→1 düşer', g.buzcuLeft.get('b') === 1);
  check('Hedef ertesi gündüz frozen', g.frozen.has('m'));
  // Frozen oy veremez
  g.phase = PHASES.VOTING; g.startVoting();
  check('Frozen oyuncu oy veremez', g.submitVote('m', 'h') === false);
  check('Frozen oyuncuya oy verilemez', g.submitVote('h', 'm') === false);
}
{
  const g = makeGame({ b: 'buzcu', h: 'vampir', m: 'muhtar' }, { insane: ['b'] });
  night(g);
  g.submitAction('b', { action: 'ability', targetId: 'm' });
  g.resolveNight();
  check('DELİ buzcu sayacı da düşer (sızıntı düzeltmesi)', g.buzcuLeft.get('b') === 1);
  check('DELİ buzcu gerçek karantina uygulamaz', !g.frozen.has('m'));
}

section('DEMİRCİ — çelik zırh');
{
  const g = makeGame({ dm: 'demirci', h: 'vampir', m: 'muhtar', m2: 'kurban' });
  night(g);
  g.submitAction('dm', { action: 'ability', targetId: 'm' });
  g.resolveNight();
  check('Zırh giydirildi', g.steelArmor.has('m'));
  night(g);
  g.submitAction('h', { action: 'kill', killTargetId: 'm' });
  const rep2 = g.resolveNight();
  check('Zırh ilk saldırıyı emer', g.players.get('m').isAlive);
  check('Zırh kırılır', !g.steelArmor.has('m'));
  check('Hedef zırh bildirimi alır', repTexts(rep2, 'm').includes('zırh'));
  night(g);
  g.submitAction('dm', { action: 'ability', targetId: 'm' });
  const rep3 = g.resolveNight();
  check('Aynı kişiye ikinci zırh verilemez', repTexts(rep3, 'dm').includes('tekrar veremezsin'));
  check('Kendine zırh yapamaz (submitAction reddi)', g.submitAction('dm', { action: 'ability', targetId: 'dm' }) === false);
}

section('İNFAZCI — zindan + idam');
{
  const g = makeGame({ inf: 'infazci', h: 'vampir', m: 'muhtar' });
  night(g);
  g.submitAction('inf', { action: 'ability', targetId: 'h', execute: true });
  const rep = g.resolveNight();
  check('İnfazcı zindandakini idam eder', !g.players.get('h').isAlive);
  check('İdam hakkı tükenir', g.infazExecutionsLeft.get('inf') === 0);
}
{
  const g = makeGame({ inf: 'infazci', h: 'vampir', m: 'muhtar', m2: 'kurban' });
  night(g);
  g.submitAction('inf', { action: 'ability', targetId: 'm' });
  g.submitAction('h', { action: 'kill', killTargetId: 'm' });
  g.resolveNight();
  check('Zindandaki saldırıdan korunur', g.players.get('m').isAlive);
}
{
  const g = makeGame({ inf: 'infazci', h: 'vampir', m: 'muhtar' }, { insane: ['inf'] });
  night(g);
  g.submitAction('inf', { action: 'ability', targetId: 'h', execute: true });
  const rep = g.resolveNight();
  check('DELİ infazcı kimseyi öldürmez', g.players.get('h').isAlive);
  check('DELİ infazcı normal rapor alır (sızıntı düzeltmesi)', repTexts(rep, 'inf').includes('infaz edildi'));
  check('DELİ infazcı idam hakkı düşer', g.infazExecutionsLeft.get('inf') === 0);
}

section('GARDİYAN — sokağa çıkma yasağı');
{
  const g = makeGame({ gd: 'gardiyan', h: 'vampir', sk: 'seri_katil', m: 'muhtar' });
  night(g);
  g.submitAction('gd', { action: 'shield' });
  g.submitAction('h', { action: 'kill', killTargetId: 'm' });
  g.submitAction('sk', { action: 'kill', targetId: 'm' });
  const rep = g.resolveNight();
  check('Yasak gecesi kimse ölmez', g.players.get('m').isAlive);
  check('Yasak tek kullanımlık', g.gardiyanUsed.has('gd'));
  check('Herkese yasak duyurusu gider', repTexts(rep, 'm').includes('YASAĞI'));
}

section('ENGİZİTÖR — gündüz infaz');
{
  const g = makeGame({ e: 'engizitor', h: 'vampir', m: 'muhtar' });
  g.phase = PHASES.DAY_DISCUSSION;
  const r = g.submitEngizitor('e', 'h');
  check('Engizitör haini infaz eder', r.ok && !g.players.get('h').isAlive);
  check('Engizitör hayatta kalır', g.players.get('e').isAlive);
  const r2 = g.submitEngizitor('e', 'm');
  check('Engizitör 2. kez kullanamaz', r2.ok === false);
}
{
  const g = makeGame({ e: 'engizitor', h: 'vampir', m: 'muhtar' });
  g.phase = PHASES.DAY_DISCUSSION;
  const r = g.submitEngizitor('e', 'm');
  check('Masum infazında engizitör ölür', r.ok && !g.players.get('e').isAlive);
  check('DİKKAT: masum hedef ÖLMEZ mi kontrolü', g.players.get('m').isAlive,
    'kod hedefi öldürmüyor; rehber "hedef ölür VE sen de ölürsün" diyor — çelişki');
}

section('BOMBACI — koy & patlat');
{
  const g = makeGame({ bo: 'bombaci', m: 'muhtar', m2: 'kurban', m3: 'gazi' });
  night(g);
  g.submitAction('bo', { action: 'place', abilityTargetId: 'm' });
  g.resolveNight();
  check('Bomba yerleştirildi', g.bombs.has('m'));
  g.round++;
  night(g);
  g.submitAction('bo', { action: 'detonate' });
  const rep = g.resolveNight();
  check('Bomba patlar, hedef ölür', !g.players.get('m').isAlive);
  check('Bombacı kill oyu veremez', g.submitAction('bo', { action: 'kill', killTargetId: 'm2' }) === false);
}
{
  const g = makeGame({ bo: 'bombaci', m: 'muhtar', m2: 'kurban' });
  night(g);
  g.submitAction('bo', { action: 'place', abilityTargetId: 'm' });
  g.resolveNight();
  night(g); // aynı round'da (round arttırılmadı) patlatma denemesi
  g.submitAction('bo', { action: 'detonate' });
  g.resolveNight();
  check('Aynı gece koyulan bomba patlatılamaz', g.players.get('m').isAlive);
}

section('KÖSTEBEK — hain savcı');
{
  const g = makeGame({ ko: 'kostebek', m: 'savci', m2: 'muhtar' });
  night(g);
  g.submitAction('ko', { action: 'ability', targetId: 'm' });
  const rep = g.resolveNight();
  check('Köstebek 2 seçenekten birinde gerçek rolü görür', repTexts(rep, 'ko').includes('Savcı'));
}

section('PUSUCU — pusu');
{
  const g = makeGame({ pu: 'pusucu', m: 'savci', m2: 'muhtar', m3: 'kurban' });
  night(g);
  g.submitAction('pu', { action: 'ability' });
  g.submitAction('m', { action: 'ability', targetId: 'pu' }); // savcı pusucuya gider
  g.resolveNight();
  check('Pusuya gelen ziyaretçi ölür', !g.players.get('m').isAlive);
}

section('HACKER — ağ saldırısı');
{
  const g = makeGame({ hk: 'hacker', s: 'savci', p2: 'psikolog', m: 'muhtar' });
  night(g);
  g.submitAction('hk', { action: 'ability', abilityTargetId: 's' });
  g.submitAction('s', { action: 'ability', targetId: 'm' });
  g.submitAction('p2', { action: 'ability', targetId: 'm' });
  const rep = g.resolveNight();
  check('Hacklenen savcı bilgi alamaz', repTexts(rep, 's').includes('HACKLENDİN'));
  check('Aksiyon yapan DİĞER bilgi rolleri de etkilenir', repTexts(rep, 'p2').includes('HACKLENDİN'));
  check('Hacker hakkı 2→1 düşer', g.hackerUsesLeft.get('hk') === 1);
  check('Üst üste aynı hedef reddedilir', g.submitAction('hk', { action: 'ability', abilityTargetId: 's' }) === false);
}

section('VAMPİR + HAİN KILL MODLARI');
{
  const g = makeGame({ v: 'vampir', h2: 'golge', m: 'muhtar', m2: 'kurban', m3: 'gazi' });
  night(g);
  g.submitAction('v', { action: 'kill', killTargetId: 'm' });
  g.submitAction('h2', { action: 'kill', killTargetId: 'm2' });
  g.resolveNight();
  check('Multi modda her hain ayrı öldürür', !g.players.get('m').isAlive && !g.players.get('m2').isAlive);
}
{
  const g = makeGame({ v: 'vampir', h2: 'golge', m: 'muhtar', m2: 'kurban', m3: 'gazi' });
  g.setHainKillMode('single');
  night(g);
  g.submitAction('v', { action: 'kill', killTargetId: 'm' });
  g.submitAction('h2', { action: 'kill', killTargetId: 'm' });
  g.resolveNight();
  check('Single modda tek hedef ölür', !g.players.get('m').isAlive && g.players.get('m2').isAlive);
}

section('SERİ KATİL — kazanma & iz bırakmama');
{
  const g = makeGame({ sk: 'seri_katil', gz: 'gazeteci', m: 'muhtar' });
  night(g);
  g.submitAction('sk', { action: 'kill', targetId: 'gz' });
  g.submitAction('gz', { action: 'ability', targetId: 'sk' });
  const rep = g.resolveNight();
  check('Gazeteci SK için "rol kullanmadı" görür', repTexts(rep, 'gz').includes('kullanmadı'));
  const wc = g.checkWin();
  check('SK + muhtar kalınca oyun devam eder (muhtar istisnası)', wc.over === false);
}
{
  // SK engellenemezlik: polis + çilingir aynı gece SK'yı hedef alsa bile SK öldürür
  const g = makeGame({ sk: 'seri_katil', p: 'polis', c: 'cilingir', m: 'muhtar' });
  night(g);
  g.submitAction('p', { action: 'ability', targetId: 'sk' });
  g.submitAction('c', { action: 'ability', targetId: 'sk' });
  g.submitAction('sk', { action: 'kill', targetId: 'm' });
  const rep = g.resolveNight();
  check('SK polis+çilingir engeline rağmen öldürür', !g.players.get('m').isAlive);
  check('Polis SK için "hiçbir şey yapmadı" görür (iz yok)', repTexts(rep, 'p').includes('hiçbir şey yapmadı'));
}
{
  const g = makeGame({ sk: 'seri_katil', m: 'kurban' });
  night(g);
  g.submitAction('sk', { action: 'kill', targetId: 'm' });
  g.resolveNight();
  const wc = g.checkWin();
  check('SK son kişi kalınca kazanır', wc.over && wc.winner === 'seri_katil');
}

section('KURBAN — vasiyet');
{
  const g = makeGame({ ku: 'kurban', v: 'vampir', m: 'muhtar' });
  night(g);
  g.submitAction('v', { action: 'kill', killTargetId: 'ku' });
  const rep = g.resolveNight();
  check('Kurban vasiyeti katil adını verir (multi mod)', repTexts(rep, 'm').includes('katilinin v olduğunu'));
}
{
  const g = makeGame({ ku: 'kurban', sk: 'seri_katil', m: 'muhtar' });
  night(g);
  g.submitAction('sk', { action: 'kill', targetId: 'ku' });
  const rep = g.resolveNight();
  check('SK öldürünce vasiyet anonim kalır', repTexts(rep, 'm').includes('Seri Katil tarafından'));
}

section('VEBA — salgın zaferi');
{
  const g = makeGame({ vb: 'veba', m: 'muhtar', m2: 'kurban' });
  night(g);
  g.submitAction('vb', { action: 'ability', targetId: 'm' });
  g.resolveNight();
  night(g);
  g.submitAction('vb', { action: 'ability', targetId: 'm2' });
  g.resolveNight();
  const wc = g.checkWin();
  check('Herkes hastalanınca veba kazanır', wc.over && wc.winner === 'veba');
  check('Hastalar ölür', !g.players.get('m').isAlive && !g.players.get('m2').isAlive);
}

section('DODO & CELLAT — asılma');
{
  const g = makeGame({ dd: 'dodo', h: 'vampir', m: 'muhtar', m2: 'kurban' });
  g.phase = PHASES.VOTING; g.startVoting();
  g.submitVote('h', 'dd'); g.submitVote('m', 'dd'); g.submitVote('m2', 'dd'); g.submitVote('dd', 'skip');
  const res = g.resolveVoting();
  check('Dodo asılınca dodoWins', res.dodoWins === true);
}
{
  const g = makeGame({ ce: 'cellat', h: 'vampir', m: 'muhtar', m2: 'kurban' });
  const target = g.cellatTarget.get('ce');
  check('Cellat hedefi masumlar arasından atanır', ['m', 'm2'].includes(target));
  g.phase = PHASES.VOTING; g.startVoting();
  ['ce', 'h', 'm', 'm2'].forEach(pid => { if (g.players.get(pid).isAlive) g.submitVote(pid, target); });
  const res = g.resolveVoting();
  check('Cellat hedefi asılınca cellatWins', res.cellatWins === 'ce');
}

section('KORUYUCU & YAMYAM — kazanma koşulları');
{
  const g = makeGame({ kr: 'koruyucu', h: 'vampir', m: 'muhtar' });
  const kt = g.koruyucuTargets.get('kr');
  check('Koruyucuya hedef atanır', !!kt);
  // Hain kazanma senaryosu: masum ölür
  g.players.get('m').isAlive = false;
  const winners = g.getWinners();
  const kTarget = g.players.get(kt);
  if (kTarget.isAlive) check('Koruduğu yaşıyorsa koruyucu kazananlarda', winners.includes('kr'));
  else check('Koruduğu öldüyse koruyucu kazanamaz', !winners.includes('kr'));
}
{
  const g = makeGame({ y: 'yamyam', v: 'vampir', m: 'savci', m2: 'muhtar' });
  night(g);
  g.submitAction('v', { action: 'kill', killTargetId: 'm' });
  const rep = g.resolveNight();
  check('Yamyam gece ölenin rolünü toplar', (g.yamyamAbilities.get('y') || []).includes('savci'));
}

section('MUHTAR — oy ağırlığı');
{
  const g = makeGame({ mu: 'muhtar', h: 'vampir', m: 'kurban' });
  check('Muhtar oyu 2 sayılır', g.getVoteWeight('mu') === 2);
  check('Normal oyuncu oyu 1', g.getVoteWeight('m') === 1);
  const gi = makeGame({ mu: 'muhtar', h: 'vampir', m: 'kurban' }, { insane: ['mu'] });
  for (let i = 0; i < 20; i++) {
    const w = gi.getVoteWeight('mu');
    if (![1, 3].includes(w)) { check('DELİ muhtar ağırlığı 1 veya 3 (rehberle uyumlu)', false, `w=${w}`); break; }
    if (i === 19) check('DELİ muhtar ağırlığı 1 veya 3 (rehberle uyumlu)', true);
  }
}

section('SUİKASTÇI — gündüz tahmin');
{
  const g = makeGame({ su: 'suikastci', s: 'savci', m: 'muhtar' });
  g.phase = PHASES.DAY_DISCUSSION;
  const r = g.submitSuikast('su', 's', 'savci');
  check('Doğru tahmin hedefi öldürür', r.ok && !g.players.get('s').isAlive);
  const r2 = g.submitSuikast('su', 'm', 'muhtar');
  check('Aynı tur 2. deneme reddedilir', r2.ok === false);
}
{
  const g = makeGame({ su: 'suikastci', s: 'savci', m: 'muhtar' });
  g.phase = PHASES.DAY_DISCUSSION;
  const r = g.submitSuikast('su', 's', 'doktor');
  check('Yanlış tahmin suikastçıyı öldürür', r.ok && !g.players.get('su').isAlive && g.players.get('s').isAlive);
}

section('HİPNOTİZMACI + PSİKOLOG kombinasyonu');
{
  const g = makeGame({ hip: 'hipnotizmaci', ps: 'psikolog', m: 'muhtar' });
  night(g);
  g.submitAction('hip', { action: 'ability', abilityTargetId: 'm' });
  g.submitAction('ps', { action: 'ability', targetId: 'm' });
  const rep = g.resolveNight();
  check('Hipnotize edilen geçici deli olur', g.players.get('m').isTempInsane);
  check('Psikolog geçici deliyi tespit eder', repTexts(rep, 'ps').includes('Deli'));
}

section('GÖLGE — susturma');
{
  const g = makeGame({ go: 'golge', m: 'savci', m2: 'muhtar' });
  night(g);
  g.submitAction('go', { action: 'ability', abilityTargetId: 'm' });
  const rep = g.resolveNight();
  check('Hedef susturulur', g.players.get('m').isSilenced);
  check('Susturulan bilgilendirilir', repTexts(rep, 'm').includes('susturdu'));
  check('Susturulan gündüz konuşamaz (canSpeak)', (() => { g.phase = PHASES.DAY_DISCUSSION; return g.canSpeak('m') === false; })());
}

section('TAKİPÇİ & AJAN & DEDİKODUCU');
{
  const g = makeGame({ t: 'takipci', s: 'savci', m: 'muhtar' });
  night(g);
  g.submitAction('s', { action: 'ability', targetId: 'm' });
  g.submitAction('t', { action: 'ability', targetId: 's' });
  const rep = g.resolveNight();
  check('Takipçi hedefin kime gittiğini görür', repTexts(rep, 't').includes('m kişisine'));
}
{
  const g = makeGame({ a: 'ajan', v: 'vampir', m: 'muhtar' });
  night(g);
  g.submitAction('a', { action: 'ability', targetId: 'v' });
  const rep = g.resolveNight();
  check('Ajan seçeneklerinde gerçek rol var', repTexts(rep, 'a').includes('Vampir'));
}
{
  const g = makeGame({ de: 'dedikoducu', v: 'vampir', h2: 'golge', m: 'muhtar' });
  night(g);
  g.submitAction('de', { action: 'ability', target1Id: 'v', target2Id: 'h2' });
  const rep = g.resolveNight();
  check('Dedikoducu aynı takımı doğru bilir', repTexts(rep, 'de').includes('Aynı takım'));
}

section('VİRÜS — ölü kod tespiti');
{
  // "virus" rolü gameConstants ROLES içinde TANIMLI DEĞİL ama gameEngine'de
  // tam işlenmiş mantığı var (infected, virusInactiveRounds, resolveNight blokları).
  // Bu rol hiçbir oyuncuya atanamaz → ölü kod. Rapor bulgusu olarak kaydedildi.
  check('virus rolü ROLES içinde yok (ölü kod — rapor bulgusu)', !Object.values(ROLES).some(r => r.id === 'virus'));
}

section('KAZANMA KOŞULLARI (checkWin)');
{
  const g = makeGame({ h: 'vampir', m: 'muhtar' });
  const wc = g.checkWin();
  check('1 hain vs 1 masum → hainler kazanır', wc.over && wc.winner === TEAMS.HAIN);
}
{
  const g = makeGame({ h: 'vampir', m: 'muhtar', m2: 'kurban', m3: 'savci' });
  g.players.get('h').isAlive = false;
  const wc = g.checkWin();
  check('Hain kalmayınca masumlar kazanır', wc.over && wc.winner === TEAMS.MASUM);
}
{
  const g = makeGame({ h: 'vampir', m: 'muhtar', t: 'dodo' });
  const wc = g.checkWin();
  check('1H/1M/1T stalemate: oyun devam eder', wc.over === false,
    'NOT: tarafsız pasifse bu durum sonsuz döngüye girebilir');
}

section('OYLAMA — kilitli oy & pas');
{
  const g = makeGame({ h: 'vampir', m: 'muhtar', m2: 'kurban', m3: 'savci' });
  g.phase = PHASES.VOTING; g.startVoting();
  check('Oy verilebilir', g.submitVote('m', 'h') === true);
  check('Oy değiştirilemez', g.submitVote('m', 'm2') === false);
  g.submitVote('m2', 'h'); g.submitVote('m3', 'skip'); g.submitVote('h', 'skip');
  const res = g.resolveVoting();
  check('En çok oy alan asılır', res.eliminated && res.eliminated.id === 'h');
}

section('REJOIN — state migrasyonu');
{
  const g = makeGame({ p1: 'savci', h: 'vampir', m: 'muhtar' });
  night(g);
  g.submitAction('p1', { action: 'ability', targetId: 'h' });
  const res = g.rejoinPlayer('p1_NEW', 'p1');
  check('Rejoin eski kaydı bulur', res.ok === true);
  check('Oyuncu yeni ID ile kayıtlı', g.players.has('p1_NEW') && !g.players.has('p1'));
  check('Gece aksiyonu yeni ID\'ye taşınır', g.nightActions.has('p1_NEW'));
  check('Lider ID güncellenir', g.leaderId === 'p1_NEW');
  const rep = g.resolveNight();
  check('Rapor yeni ID ile alınır', (rep.get('p1_NEW') || []).length > 0);
}

section('SABOTAJ — kaldırıldı doğrulaması');
{
  const g = makeGame({ v: 'vampir', h2: 'golge', m: 'muhtar', m2: 'kurban' });
  night(g);
  const r = g.submitSabotage('v');
  check('Sabotaj oyu reddedilir', r.ok === false);
  g.submitAction('v', { action: 'kill', killTargetId: 'm' });
  g.resolveNight();
  check('Vampir olsa bile sabotaj pending olmaz', g.sabotagePending === false);
  check('triggerSabotage sistem çağrısı da pasif kalmalı', (() => {
    g.phase = PHASES.DAY_DISCUSSION;
    // toDay artık çağırmıyor; yine de fonksiyonun tek başına oyun kilitlemediğini doğrula
    return g.sabotageActive === false;
  })());
}

// ─────────────────────────────────────────────
console.log('\n════════════════════════════════');
console.log(`SONUÇ: ${pass} başarılı, ${fail} başarısız`);
if (failures.length) {
  console.log('\nBaşarısız olanlar:');
  failures.forEach(f => console.log('  ✗ ' + f));
}
process.exit(fail > 0 ? 1 : 0);

// Odaya katilma onayi (room:preview) entegrasyon testi — App Store 1.2
// Calistir: once sunucuyu ayaga kaldir, sonra:
//   node tests/room-preview-tests.js http://localhost:3999
// NOT: socket.io-client gerekir (npm i -D socket.io-client).
const { io } = require('socket.io-client');
const URL = process.argv[2] || 'http://localhost:3999';

const mk = () => io(URL, { transports: ['websocket'], timeout: 8000 });
const em = (s, ev, d) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout: ' + ev)), 8000);
  s.emit(ev, d, r => { clearTimeout(t); res(r); });
});
const ready = s => new Promise(r => s.on('connect', r));

let fail = 0;
const expect = (label, cond, detail) => { if (!cond) fail++; console.log(`${cond ? '✅' : '❌'} ${label}${detail ? ' → ' + detail : ''}`); };

(async () => {
  const host = mk(), guest = mk();
  await Promise.all([ready(host), ready(guest)]);
  const sfx = Date.now() % 100000;

  await em(host, 'auth:register', { username: 'PrevHost' + sfx, password: 'test123' });
  await em(guest, 'auth:register', { username: 'PrevGuest' + sfx, password: 'test123' });

  const room = await em(host, 'room:create', { playerName: 'Kurucu' });
  expect('Oda kuruldu', !!room.ok, room.code);

  // 1) Önizleme, katılmadan önce oyuncuları döndürmeli
  const prev = await em(guest, 'room:preview', { code: room.code });
  expect('Önizleme başarılı', !!prev.ok, prev.err);
  expect('Kurucu adı görünüyor', prev.leaderName === 'Kurucu', prev.leaderName);
  expect('Oyuncu listesi dolu', prev.players?.length === 1, JSON.stringify(prev.players?.map(p => p.name)));
  expect('Kurucu rozeti var', prev.players?.[0]?.isLeader === true);
  expect('İstatistik alanları var', typeof prev.players?.[0]?.wins === 'number' && typeof prev.players?.[0]?.mvp === 'number');
  expect('Kontenjan bilgisi var', prev.count === 1 && prev.max > 1, `${prev.count}/${prev.max}`);

  // 2) Önizleme YAN ETKİSİZ olmalı — misafir hâlâ odada olmamalı
  const prev2 = await em(host, 'room:preview', { code: room.code });
  expect('Önizleme odaya sokmuyor (yan etkisiz)', prev2.players.length === 1, prev2.players.length + ' oyuncu');

  // 3) Gizli oyun bilgisi sızmamalı
  const leaked = Object.keys(prev.players[0]).filter(k => /role|team|actual|hain/i.test(k));
  expect('Rol/takım bilgisi sızmıyor', leaked.length === 0, leaked.join(','));

  // 4) Onay sonrası gerçekten katılabilmeli
  const joined = await em(guest, 'room:join', { code: room.code, playerName: 'Misafir' });
  expect('Onaydan sonra katılım çalışıyor', !!joined.ok, joined.err);
  const prev3 = await em(host, 'room:preview', { code: room.code });
  expect('Katılınca liste güncelleniyor', prev3.count === 2, prev3.count + ' oyuncu');

  // 5) Olmayan oda
  const bad = await em(guest, 'room:preview', { code: '0000' });
  expect('Olmayan oda reddediliyor', !bad.ok, bad.err);

  // 6) Giriş yapmadan önizleme yapılamamalı
  const anon = mk(); await ready(anon);
  const anonPrev = await em(anon, 'room:preview', { code: room.code });
  expect('Girişsiz önizleme reddediliyor', !anonPrev.ok, anonPrev.err);
  anon.close();

  console.log(`\n${fail ? '❌ ' + fail + ' başarısız' : '✅ Tüm önizleme testleri geçti'}`);
  host.close(); guest.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HATA:', e.message); process.exit(1); });

// İçerik filtresi testleri (App Store Guideline 1.2)
// Çalıştır: node tests/content-filter-tests.js
const CF = require('../server/contentFilter');

let pass = 0, fail = 0;

function blocked(text, why) {
  const r = CF.check(text);
  if (!r.clean) { pass++; return; }
  fail++;
  console.error(`  ✗ ENGELLENMELİYDİ: ${JSON.stringify(text)}  (${why})`);
}

function allowed(text, why) {
  const r = CF.check(text);
  if (r.clean) { pass++; return; }
  fail++;
  console.error(`  ✗ YANLIŞ POZİTİF: ${JSON.stringify(text)} → "${r.match}"  (${why})`);
}

console.log('— Engellenmesi gerekenler —');
blocked('amk', 'düz küfür');
blocked('AMK', 'büyük harf');
blocked('a.m.k', 'noktalı kaçamak');
blocked('a m k', 'harf harf yazım');
blocked('orospu cocugu', 'çok kelimeli');
blocked('oooorospu', 'harf tekrarı');
blocked('s1ktir git', 'leetspeak');
blocked('$iktir', 'sembol değişimi');
blocked('siktir lan', 'cümle içinde');
blocked('senin ananı sikeyim', 'cümle içinde küfür');
blocked('piç', 'Türkçe karakter');
blocked('yarrağı', 'ek almış');
blocked('fuck you', 'İngilizce');
blocked('motherfucker', 'İngilizce bileşik');
blocked('n1gger', 'nefret söylemi + leet');
blocked('tecavüzcü', 'ciddi içerik');
blocked('porno izle', 'cinsel içerik');
blocked('Hitler', 'nefret söylemi');
blocked('ibne', 'homofobik');

console.log('— Geçmesi gerekenler (yanlış pozitif kontrolü) —');
allowed('sıkıntı yok', 'sik kökü masum kelimede');
allowed('sıkıntılı bir gece', 'sik kökü masum kelimede');
allowed('şikayet et', 'şikayet = sikayet');
allowed('şikayetçiyim', 'şikayet türevi');
allowed('sıkışık durumdayız', 'sikisik');
allowed('toplam 5 oy var', 'top kökü');
allowed('toplantı başlıyor', 'top kökü');
allowed('topu bana at', 'top kökü');
allowed('malzeme lazım', 'mal kökü');
allowed('maliyet yüksek', 'mal kökü');
allowed('analiz yaptım', 'anal kökü');
allowed('password', 'pass/ass kökü');
allowed('classic assassin', 'ass kökü');
allowed('memleket', 'meme kökü');
allowed('memur oldum', 'meme kökü');
allowed('Doktor kimdi', 'normal oyun mesajı');
allowed('bence hain sensin salak', 'oyun içi hafif atışma engellenmemeli');
allowed('Savcı sorgulasın onu', 'normal oyun mesajı');
allowed('Azat', 'normal kullanıcı adı');
allowed('', 'boş metin');
allowed('   ', 'sadece boşluk');

// ── Kullanıcı adı / oyuncu adı modu (strict) ──
function nameBlocked(text, why) {
  if (!CF.isCleanName(text)) { pass++; return; }
  fail++;
  console.error(`  ✗ AD ENGELLENMELİYDİ: ${JSON.stringify(text)}  (${why})`);
}
function nameAllowed(text, why) {
  if (CF.isCleanName(text)) { pass++; return; }
  fail++;
  console.error(`  ✗ AD YANLIŞ POZİTİF: ${JSON.stringify(text)}  (${why})`);
}

console.log('— Adlar: engellenmeli (bitişik yazım) —');
nameBlocked('fuckyou', 'bitişik İngilizce küfür');
nameBlocked('sikerim35', 'bitişik + rakam');
nameBlocked('OrospuCocugu', 'CamelCase');
nameBlocked('siktir123', 'bitişik + rakam');
nameBlocked('bigdickenergy', 'gömülü küfür');
nameBlocked('n1gg4', 'leet nefret söylemi');
nameBlocked('tecavuzcu_35', 'ciddi içerik');
nameBlocked('amk', 'kısaltma');

console.log('— Adlar: geçmeli —');
nameAllowed('Azat', 'normal ad');
nameAllowed('Kral_Arthur', 'normal ad');
nameAllowed('Sikayetci', 'şikayet kökü ada girerse');
nameAllowed('Toplamci', 'top kökü');
nameAllowed('Analizci', 'anal kökü');
nameAllowed('Malzemeci', 'mal kökü');
nameAllowed('Essex', 'sex kökü masum kelimede');
nameAllowed('Hain_Avcisi_1', 'oyun teması');

console.log(`\n${pass} geçti, ${fail} başarısız.`);
process.exit(fail ? 1 : 0);

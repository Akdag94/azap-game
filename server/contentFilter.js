// ── İÇERİK FİLTRESİ (App Store Guideline 1.2) ──
// "A method for filtering objectionable material from being posted to the app"
//
// Kullanıcı üretimi metinlerde (kullanıcı adı, oyuncu adı, hain sohbeti) küfür,
// hakaret, cinsel içerik, nefret söylemi ve ırkçılık tespit eder.
//
// Tasarım notları:
//  - Türkçe'de kısa küfür kökleri masum kelimelerin içinde geçer ("sıkıntı" → "sik").
//    Bu yüzden varsayılan eşleşme TAM KELİME üzerindedir; sadece tek anlamlı köklerde
//    parça eşleşmesi yapılır ve bunlar için ayrıca izin listesi vardır.
//  - Kaçamak yazımlar (s1k, a.m.k, ooorospu, $ik) normalizasyonla yakalanır.

// Tam kelime olarak yasak (normalize edilmiş hâlleriyle)
// NOT: Hafif atışmalar ("salak", "mal") bilerek listeye alınmadı — AZAP bir
// tartışma oyunu; amaç küfür/cinsel içerik/nefret söylemini engellemek, oyunu
// oynanamaz hâle getirmek değil.
const WORDS = [
  // Türkçe küfür / cinsel
  'amk', 'aq', 'amq', 'amcik', 'amcigi', 'amina', 'aminakoyayim', 'aminakoyim',
  'ananisikeyim', 'ananisikim', 'anansikeyim', 'orospu', 'orospucocugu',
  'pic', 'picler', 'pickurusu', 'kahpe', 'kaltak', 'surtuk', 'fahise',
  'sik', 'siker', 'sikerim', 'sikeyim', 'sikim', 'sikik', 'sikis', 'sikisme',
  'siktir', 'siktirgit', 'gotveren', 'gotlek', 'ibne', 'ibine',
  'yarrak', 'yarak', 'yarragi', 'tasak', 'dalyarak', 'dalyarrak',
  'seks', 'porno', 'pornocu', 'vajina', 'penis', 'tecavuz', 'tecavuzcu',
  'sapik', 'pezevenk', 'godos', 'kerhane', 'kerhaneci',
  // Nefret söylemi / ırkçılık
  'nazi', 'hitler',
  // İngilizce
  'fuck', 'fucker', 'fucking', 'fuk', 'motherfucker', 'shit', 'bullshit',
  'bitch', 'bastard', 'cunt', 'cock', 'pussy', 'whore', 'slut',
  'asshole', 'porn', 'sex', 'rape', 'rapist',
  'nigger', 'nigga', 'faggot', 'kike', 'chink'
];

// Nerede geçerse geçsin yasak (tek anlamlı, masum kelime içinde geçmez)
const SUBSTRINGS = [
  'orospu', 'aminakoy', 'aminakod', 'siktir', 'yarrak', 'pezevenk',
  'motherfuck', 'nigger', 'faggot', 'tecavuz', 'gotveren'
];

// Kullanıcı adı / oyuncu adı için ek parça eşleşmesi (strict mod).
// Adlar bitişik yazılır ("fuckyou", "sikerim35") — bu yüzden isimlerde daha
// agresif davranırız. Sohbette kullanılmaz; orada yanlış pozitif oyunu bozar.
// Sadece 4+ karakterli, masum kelime içinde geçmeyen kökler.
const NAME_SUBSTRINGS = [
  'fuck', 'shit', 'bitch', 'cunt', 'pussy', 'whore', 'slut', 'nigger', 'nigga',
  'faggot', 'porno', 'rape', 'dick',
  'orospu', 'siktir', 'sikerim', 'sikeyim', 'sikik', 'sikis', 'amina', 'amcik',
  'yarrak', 'yarak', 'pezevenk', 'tecavuz', 'kahpe', 'kaltak', 'ibne',
  'penis', 'vajina', 'gotveren'
];

// SUBSTRINGS/WORDS yanlış pozitif üretebilecek masum kelimeler (normalize hâlleri)
const ALLOW = new Set([
  'sikinti', 'sikintili', 'sikistir', 'sikisik', 'sikayet', 'sikayetci',
  'topla', 'toplam', 'toplanti', 'toplu', 'topluluk', 'topraki', 'toprak',
  'malzeme', 'maliyet', 'malum', 'mali', 'malta',
  'assassin', 'class', 'pass', 'password', 'bass', 'grass', 'mass', 'glass',
  'analiz', 'analitik', 'sexton', 'essex', 'middlesex',
  'memeleket', 'memleket', 'memur', 'sikke'
]);

// Leetspeak / karakter değiştirme haritası
const LEET = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
  '@': 'a', '$': 's', '!': 'i', '*': '', '+': 't'
};

// Türkçe karakterleri ASCII'ye indir
const TR_MAP = {
  'ı': 'i', 'İ': 'i', 'ş': 's', 'Ş': 's', 'ğ': 'g', 'Ğ': 'g',
  'ü': 'u', 'Ü': 'u', 'ö': 'o', 'Ö': 'o', 'ç': 'c', 'Ç': 'c'
};

function normalize(text) {
  let s = String(text || '');
  s = s.replace(/[ıİşŞğĞüÜöÖçÇ]/g, c => TR_MAP[c]).toLowerCase();
  s = s.replace(/[0134578@$!*+]/g, c => LEET[c] ?? c);
  // Harf dışı her şeyi boşluğa çevir (a.m.k → a m k gibi kaçamakları da açar)
  s = s.replace(/[^a-z\s]/g, ' ');
  // Üç ve daha fazla tekrar eden harfi ikiye indir (ooorospu → oorospu)
  s = s.replace(/(.)\1{2,}/g, '$1$1');
  return s.replace(/\s+/g, ' ').trim();
}

// "a m k" gibi harf harf yazılmış kaçamakları da yakalamak için boşluksuz hâl
function squash(normalized) {
  return normalized.replace(/\s/g, '');
}

const WORD_SET = new Set(WORDS.map(normalize).filter(Boolean));

/**
 * Metinde uygunsuz içerik var mı?
 * @param {string} text
 * @param {{strict?: boolean}} [opts] strict=true → kullanıcı adı/oyuncu adı modu
 *   (bitişik yazımı da yakalar, bkz. NAME_SUBSTRINGS)
 * @returns {{clean: boolean, match: string|null}}
 */
function check(text, opts = {}) {
  const norm = normalize(text);
  if (!norm) return { clean: true, match: null };

  const tokens = norm.split(' ');

  // 1) Tam kelime eşleşmesi (izin listesindekiler atlanır)
  for (const t of tokens) {
    if (!t || ALLOW.has(t)) continue;
    if (WORD_SET.has(t)) return { clean: false, match: t };
    // Tekrar harfleri tamamen sadeleştirilmiş hâli de dene (siiik → sik)
    const collapsed = t.replace(/(.)\1+/g, '$1');
    if (!ALLOW.has(collapsed) && WORD_SET.has(collapsed)) return { clean: false, match: collapsed };
  }

  // 2) Harf harf yazım kaçamağı: "a m k", "a.m.k", "s i k t i r"
  // Ardışık tek harflik token'ları birleştirip kelime listesine bakarız.
  let run = '';
  for (const t of [...tokens, '']) {
    if (t.length === 1) { run += t; continue; }
    if (run.length >= 2 && WORD_SET.has(run)) return { clean: false, match: run };
    run = '';
  }

  // 3) Tek anlamlı köklerde parça eşleşmesi (boşluk kaçamakları dahil)
  const flat = squash(norm);
  const roots = opts.strict ? [...SUBSTRINGS, ...NAME_SUBSTRINGS] : SUBSTRINGS;
  for (const s of roots) {
    const ns = normalize(s).replace(/\s/g, '');
    if (ns && flat.includes(ns)) {
      // İzin listesindeki bir kelimeden mi geliyor kontrol et
      const fromAllowed = tokens.some(t => ALLOW.has(t) && squash(t).includes(ns));
      if (!fromAllowed) return { clean: false, match: ns };
    }
  }

  return { clean: true, match: null };
}

function isClean(text, opts) { return check(text, opts).clean; }
/** Kullanıcı adı / oyuncu adı için sıkı kontrol */
function isCleanName(text) { return check(text, { strict: true }).clean; }

module.exports = { check, isClean, isCleanName, normalize };

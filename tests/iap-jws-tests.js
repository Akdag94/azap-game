/**
 * StoreKit 2 JWS doğrulama testleri — `node tests/iap-jws-tests.js`
 *
 * Gerçek Apple imzası elimizde olmadığı için doğrulama mantığı sentetik bir
 * sertifika zinciriyle (tests/fixtures/iap-jws-chain.json) sınanır: zincir
 * kökü teste enjekte edilerek POZİTİF yol, varsayılan (Apple) pin ile de
 * NEGATİF yol test edilir. Sentetik zincirin Apple ile hiçbir ilgisi yoktur.
 */
const crypto = require('crypto');
const assert = require('assert');
const { looksLikeJws, verifyAppleJws, APPLE_ROOT_CA_G3_PEM } = require('../server/appleJws');
const chain = require('./fixtures/iap-jws-chain.json');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    console.error('  ✗ ' + name + '\n    ' + e.message);
    process.exitCode = 1;
  }
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const derOf = (pem) => new crypto.X509Certificate(pem).raw.toString('base64');

/** Sentetik zincirle imzalı bir JWS üret */
function makeJws(payload, { alg = 'ES256', x5c, key = chain.leafKeyPem } = {}) {
  const header = {
    alg,
    x5c: x5c || [derOf(chain.leafPem), derOf(chain.interPem), derOf(chain.rootPem)],
  };
  const head = b64url(JSON.stringify(header));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto
    .createSign('SHA256')
    .update(head + '.' + body)
    .sign({ key, dsaEncoding: 'ieee-p1363' });
  return head + '.' + body + '.' + b64url(sig);
}

const TX = {
  transactionId: '2000000999888777',
  originalTransactionId: '2000000999888777',
  bundleId: 'online.azap.app',
  productId: 'online.azap.gold_100',
  purchaseDate: 1753800000000,
  quantity: 1,
  type: 'Consumable',
  environment: 'Sandbox',
};
const OPTS = { rootPem: chain.rootPem };

console.log('\n── looksLikeJws ──');
test('JWS biçimini tanır', () => {
  assert.strictEqual(looksLikeJws(makeJws(TX)), true);
});
test('eski tip base64 receipt JWS sayılmaz', () => {
  // Eski App Store receipt'i düz base64'tür: "+/=" içerir, noktayla ayrılmaz
  const receipt = Buffer.from('a'.repeat(400)).toString('base64');
  assert.strictEqual(looksLikeJws(receipt), false);
});
test('string olmayan / bozuk girdi reddedilir', () => {
  assert.strictEqual(looksLikeJws(null), false);
  assert.strictEqual(looksLikeJws('a.b'), false);
  assert.strictEqual(looksLikeJws('a..c'), false);
  assert.strictEqual(looksLikeJws('a.b.c.d'), false);
});

console.log('\n── verifyAppleJws: geçerli imza ──');
test('doğru zincir + imza → payload döner', () => {
  const payload = verifyAppleJws(makeJws(TX), OPTS);
  assert.ok(payload, 'payload null döndü');
  assert.strictEqual(payload.transactionId, TX.transactionId);
  assert.strictEqual(payload.productId, TX.productId);
  assert.strictEqual(payload.bundleId, TX.bundleId);
});

console.log('\n── verifyAppleJws: sahtecilik reddi ──');
test('pinlenmiş Apple kökü ile sentetik zincir REDDEDİLİR', () => {
  // Varsayılan (opts yok) = gerçek Apple pini → saldırganın kendi zinciri geçmez
  assert.strictEqual(verifyAppleJws(makeJws(TX)), null);
});
test('gövde kurcalanırsa reddedilir', () => {
  const jws = makeJws(TX);
  const [h, , s] = jws.split('.');
  const forged = b64url(JSON.stringify({ ...TX, productId: 'online.azap.gold_5000' }));
  assert.strictEqual(verifyAppleJws(`${h}.${forged}.${s}`, OPTS), null);
});
test('imza başka anahtarla atılmışsa reddedilir', () => {
  const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
  assert.strictEqual(verifyAppleJws(makeJws(TX, { key: other }), OPTS), null);
});
test('leaf, zincirdeki ara sertifikayla imzalanmamışsa reddedilir', () => {
  // Kendi ürettiği leaf'i gerçek zincire iliştirme denemesi
  const rogue = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const rogueCert = derOf(chain.leafPem); // zincirde leaf doğru ama imza yanlış anahtardan
  assert.strictEqual(
    verifyAppleJws(makeJws(TX, { key: rogue.privateKey, x5c: [rogueCert, derOf(chain.interPem), derOf(chain.rootPem)] }), OPTS),
    null
  );
});
test('alg=none / RS256 gibi beklenmeyen alg reddedilir', () => {
  assert.strictEqual(verifyAppleJws(makeJws(TX, { alg: 'none' }), OPTS), null);
  assert.strictEqual(verifyAppleJws(makeJws(TX, { alg: 'RS256' }), OPTS), null);
});
test('x5c yoksa veya tek sertifikaysa reddedilir', () => {
  assert.strictEqual(verifyAppleJws(makeJws(TX, { x5c: [derOf(chain.leafPem)] }), OPTS), null);
  const head = b64url(JSON.stringify({ alg: 'ES256' }));
  const body = b64url(JSON.stringify(TX));
  assert.strictEqual(verifyAppleJws(`${head}.${body}.AAAA`, OPTS), null);
});
test('ara sertifika atlanırsa (leaf doğrudan köke) reddedilir', () => {
  assert.strictEqual(
    verifyAppleJws(makeJws(TX, { x5c: [derOf(chain.leafPem), derOf(chain.rootPem)] }), OPTS),
    null
  );
});
test('sertifika geçerlilik penceresi dışındaki zaman reddedilir', () => {
  const jws = makeJws(TX);
  assert.ok(verifyAppleJws(jws, OPTS), 'kontrol: şu an geçerli olmalı');
  assert.strictEqual(verifyAppleJws(jws, { ...OPTS, now: Date.parse('1990-01-01') }), null);
});
test('bozuk / çöp girdi çökmeden null döner', () => {
  assert.strictEqual(verifyAppleJws('', OPTS), null);
  assert.strictEqual(verifyAppleJws('bir.iki.uc', OPTS), null);
  assert.strictEqual(verifyAppleJws(null, OPTS), null);
});

console.log('\n── pinlenmiş kök sertifika ──');
test('Apple Root CA - G3 beklenen parmak izine sahip ve kendinden imzalı', () => {
  const root = new crypto.X509Certificate(APPLE_ROOT_CA_G3_PEM);
  assert.strictEqual(
    root.fingerprint256.replace(/:/g, ''),
    '63343ABFB89A6A03EBB57E9B3F5FA7BE7C4F5C756F3017B3A8C488C3653E9179'
  );
  assert.match(root.subject, /Apple Root CA - G3/);
  assert.strictEqual(root.subject, root.issuer);
  assert.ok(root.verify(root.publicKey), 'kök kendinden imzalı olmalı');
});

console.log(`\n${passed} test geçti${process.exitCode ? ' — HATA VAR' : ''}\n`);

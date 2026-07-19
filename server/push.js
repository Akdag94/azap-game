// ============================================================
// AZAP — Apple Push Notification service (APNs) modülü
// Token-based (JWT/.p8) kimlik doğrulama + HTTP/2 gönderim.
//
// Kurulum (.env):
//   APNS_KEY_PATH=./data/AuthKey_XXXXXX.p8   (Apple Developer → Keys → APNs key)
//   APNS_KEY_ID=XXXXXX                        (key oluştururken verilen 10 haneli ID)
//   APNS_TEAM_ID=YYYYYYYYYY                   (Developer hesabı Team ID)
//   APNS_TOPIC=online.azap.app                (uygulamanın bundle ID'si)
//   APNS_PRODUCTION=true                      (TestFlight/App Store için true)
//
// Anahtar yoksa modül sessizce devre dışı kalır — oyun etkilenmez.
// ============================================================
const http2 = require('http2');
const fs = require('fs');
const path = require('path');

let jwt = null;
try { jwt = require('jsonwebtoken'); } catch (e) { console.warn('[Push] jsonwebtoken yok — npm install jsonwebtoken'); }

const KEY_PATH = process.env.APNS_KEY_PATH
  ? path.resolve(process.env.APNS_KEY_PATH)
  : path.join(__dirname, '..', 'data', 'apns-key.p8');
const KEY_ID = process.env.APNS_KEY_ID || '';
const TEAM_ID = process.env.APNS_TEAM_ID || '';
const TOPIC = process.env.APNS_TOPIC || 'online.azap.app';
const HOST = process.env.APNS_PRODUCTION === 'false'
  ? 'https://api.sandbox.push.apple.com'
  : 'https://api.push.apple.com';

let _signingKey = null;
try { _signingKey = fs.readFileSync(KEY_PATH, 'utf8'); } catch {}

const enabled = !!(jwt && _signingKey && KEY_ID && TEAM_ID);
if (enabled) console.log(`[Push] ✓ APNs aktif — topic: ${TOPIC}, host: ${HOST}`);
else console.log('[Push] APNs devre dışı (APNS_KEY_PATH / APNS_KEY_ID / APNS_TEAM_ID eksik)');

// JWT 60 dakikada bir yenilenmeli — 45 dakika cache
let _cachedJwt = null, _jwtIssuedAt = 0;
function getJwt() {
  const now = Date.now();
  if (_cachedJwt && now - _jwtIssuedAt < 45 * 60 * 1000) return _cachedJwt;
  _cachedJwt = jwt.sign({}, _signingKey, {
    algorithm: 'ES256',
    issuer: TEAM_ID,
    header: { alg: 'ES256', kid: KEY_ID }
  });
  _jwtIssuedAt = now;
  return _cachedJwt;
}

/**
 * Tek bir cihaza push gönder.
 * @returns {Promise<{ok:boolean, status?:number, reason?:string}>}
 */
function sendToToken(deviceToken, { title, body, data = {}, badge, sound = 'default' }) {
  return new Promise((resolve) => {
    if (!enabled) return resolve({ ok: false, reason: 'disabled' });
    if (!deviceToken || typeof deviceToken !== 'string') return resolve({ ok: false, reason: 'no_token' });

    let client;
    try { client = http2.connect(HOST); } catch (e) { return resolve({ ok: false, reason: e.message }); }
    const timeout = setTimeout(() => { try { client.close(); } catch {} resolve({ ok: false, reason: 'timeout' }); }, 10000);

    client.on('error', (e) => { clearTimeout(timeout); resolve({ ok: false, reason: e.message }); });

    const payload = JSON.stringify({
      aps: {
        alert: { title, body },
        sound,
        ...(badge !== undefined ? { badge } : {})
      },
      ...data
    });

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      'authorization': `bearer ${getJwt()}`,
      'apns-topic': TOPIC,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json'
    });

    let status = 0, respBody = '';
    req.on('response', (headers) => { status = headers[':status']; });
    req.on('data', (c) => { respBody += c; });
    req.on('end', () => {
      clearTimeout(timeout);
      try { client.close(); } catch {}
      if (status === 200) return resolve({ ok: true, status });
      let reason = '';
      try { reason = JSON.parse(respBody).reason; } catch {}
      resolve({ ok: false, status, reason });
    });
    req.on('error', (e) => { clearTimeout(timeout); try { client.close(); } catch {} resolve({ ok: false, reason: e.message }); });
    req.end(payload);
  });
}

/**
 * Bir kullanıcının tüm kayıtlı cihazlarına gönder.
 * Geçersiz tokenlar (Unregistered/BadDeviceToken) otomatik silinir.
 */
async function sendToUser(Accounts, username, payload) {
  if (!enabled || !username) return { ok: false, sent: 0 };
  const tokens = Accounts.getPushTokens(username);
  if (!tokens.length) return { ok: false, sent: 0 };
  let sent = 0;
  for (const t of tokens) {
    const r = await sendToToken(t, payload);
    if (r.ok) sent++;
    else if (r.status === 410 || r.reason === 'BadDeviceToken' || r.reason === 'Unregistered' || r.reason === 'DeviceTokenNotForTopic') {
      Accounts.removePushToken(username, t);
      console.log(`[Push] Geçersiz token silindi (${username})`);
    }
  }
  return { ok: sent > 0, sent };
}

module.exports = { enabled: () => enabled, sendToToken, sendToUser };

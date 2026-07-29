// İnceleme notlarını günceller — 2026-07-29 reddine (Guideline 1.2 UGC / canlı sohbet)
// AZAP'ın yüz yüze oynanan bir masa oyunu olduğunu, rastgele eşleştirme
// bulunmadığını, sesli sohbetin tamamen kaldırıldığını ve 1.2'nin istediği tüm
// moderasyon araçlarının nerede olduğunu anlatır.
const jwt = require('jsonwebtoken'), fs = require('fs');
const P = fs.readFileSync(process.env.ASC_P8_PATH, 'utf8'), APP = process.env.ASC_APP_ID;
const tok = () => jwt.sign({}, P, { algorithm: 'ES256', expiresIn: '18m', issuer: process.env.ASC_ISSUER_ID, audience: 'appstoreconnect-v1', header: { alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' } });
async function api(m, e, b) {
  const r = await fetch('https://api.appstoreconnect.apple.com' + e, { method: m, headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  return { ok: r.ok, json: j, text: t, status: r.status };
}

// Apple incelemecisi İngilizce okur; Türkçe karşılığı da eklendi.
const NOTES = [
  'Regarding the Guideline 1.2 feedback on submission 1e628ca0 (build 9).',
  '',
  'WHAT THIS APP IS',
  'AZAP is a social deduction party game (the "Mafia"/"Werewolf" genre) meant to',
  'be played by a group of friends who are physically in the same room. The app',
  'acts as the game master: it deals secret roles, runs the night/day timer and',
  'counts votes. The discussion itself happens face to face, out loud, at the',
  'table - not through the app.',
  '',
  'THERE IS NO RANDOM OR ANONYMOUS MATCHING',
  'The app never connects a user with a stranger. There is no matchmaking queue,',
  'no public room list, no "find a partner" feature and no one-to-one pairing of',
  'any kind. A game exists only if a host creates a private room; other players',
  'can enter it only by typing the 4-digit room code that the host reads out to',
  'the people sitting with them. An unknown code simply returns "no such room".',
  'Because of this there is no "user you are about to connect with" to display,',
  'and no connection to accept, decline or skip - a player only ever joins a room',
  'they were invited to in person.',
  '',
  'VOICE CHAT HAS BEEN REMOVED',
  'The previous build had an optional in-room voice chat. It is completely removed',
  'in this build. The app no longer requests the microphone at all and',
  'NSMicrophoneUsageDescription is no longer declared in Info.plist. The server no',
  'longer relays any WebRTC signalling, so no audio channel can be established.',
  '',
  'THE ONLY USER-TO-USER TEXT IN THE APP',
  'One text channel remains: inside a private room, the 2-4 players who were',
  'secretly dealt the "traitor" role get a small team chat. It exists so they can',
  'agree on a target without speaking out loud in front of the other players at',
  'the table. It is not visible to anyone else and cannot reach anyone outside',
  'that room.',
  '',
  'GUIDELINE 1.2 MEASURES IN THIS BUILD',
  '1. Filtering: user names, in-game player names and every chat message are',
  '   checked by a server-side content filter before they are stored or shown.',
  '   Profanity, sexual content and hate speech are rejected, including evasions',
  '   such as leetspeak, added punctuation and letter-by-letter spelling. Avatar',
  '   GIF search is restricted to the strictest content rating (G).',
  '2. EULA: creating an account requires ticking "I have read and accept the Terms',
  '   of Use and Membership Agreement" (azap.online/yasal/kullanim-kosullari).',
  '   Section 5 of those terms is a zero-tolerance policy for objectionable',
  '   content and abusive users.',
  '3. Blocking: in-game Settings (gear icon) -> "Oyuncular" (Players) -> the block',
  '   button next to a player. A blocked player\'s messages are never displayed',
  '   again and the block persists on the device.',
  '4. Reporting: the flag button next to each player in that same list files a',
  '   report with a reason. Reports appear in our admin panel and also trigger a',
  '   push notification to the administrators.',
  '5. 24-hour response: we review every report within 24 hours, remove the',
  '   offending content and remove the offending account. This commitment is',
  '   written into the Terms of Use. Contact: azap.online/iletisim',
  '',
  'HOW TO SEE THE MODERATION TOOLS',
  'Sign in with the demo account -> "Oda Kur" (create room) -> the gear icon at',
  'the top left opens Settings -> the "Oyuncular" (Players) block lists everyone',
  'in the room with a report button and a block button.',
  '',
  'IN-APP PURCHASES',
  'The 7 In-App Purchases are unchanged and were verified in sandbox. Store (shop',
  'icon) -> "Altin" tab -> "Satin Al". All purchases go through StoreKit.',
  '',
  '--- Turkce ozet ---',
  'AZAP yuz yuze oynanan bir sosyal dedüksiyon oyunudur; uygulama oyun yoneticisi',
  'gorevi gorur, tartisma masada sesli yapilir. Rastgele eslestirme yoktur; odaya',
  'yalnizca kurucunun soyledigi 4 haneli kodla girilir. Sesli sohbet bu build ile',
  'tamamen kaldirildi, mikrofon izni artik istenmiyor. Kalan tek yazili kanal ayni',
  'odadaki hain takiminin kendi arasindaki sohbetidir. Icerik filtresi, EULA onayi,',
  'engelleme, sikayet ve 24 saat icinde mudahale taahhudu uygulamada mevcuttur.'
].join('\n');

(async () => {
  const ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  const d = (await api('GET', `/v1/appStoreVersions/${ver.id}/appStoreReviewDetail`)).json.data;
  console.log(`sürüm ${ver.attributes.versionString} [${ver.attributes.appStoreState}]  detail=${d.id}`);
  console.log(`not uzunluğu: ${NOTES.length} karakter`);

  const r = await api('PATCH', `/v1/appStoreReviewDetails/${d.id}`, {
    data: { type: 'appStoreReviewDetails', id: d.id, attributes: { notes: NOTES } }
  });
  if (!r.ok) { console.error('✗', (r.json?.errors || []).map(e => e.detail).join(' | ') || r.text); process.exit(1); }
  console.log('✓ inceleme notları güncellendi');

  const check = (await api('GET', `/v1/appStoreVersions/${ver.id}/appStoreReviewDetail`)).json.data;
  console.log(`✓ demo hesap: ${check.attributes.demoAccountName} (required=${check.attributes.demoAccountRequired})`);
})();

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
  'AZAP is a social deduction party game ("Mafia"/"Werewolf" genre) meant to be',
  'played by friends who are physically in the same room. The app is the game',
  'master: it deals secret roles, runs the night/day timer and counts votes. The',
  'discussion happens face to face, out loud, at the table - not through the app.',
  '',
  'THERE IS NO RANDOM OR ANONYMOUS MATCHING',
  'The app never connects a user with a stranger. There is no matchmaking queue,',
  'no public room list, no "find a partner" feature and no one-to-one pairing of',
  'any kind. A game exists only if a host creates a private room; other players',
  'can enter it only by typing the 4-digit room code that the host reads out to',
  'the people sitting with them. An unknown code returns "no such room".',
  '',
  'IDENTIFYING INFORMATION BEFORE JOINING, AND ACCEPT/DECLINE',
  'Even though joining is invite-only, we added an explicit confirmation step for',
  'this guideline. Entering a room code no longer connects the user. It first',
  'opens a "Bu Odaya Katil?" (Join this room?) screen listing everyone already in',
  'the room - display name, avatar, career wins and MVP count, who the host is,',
  'how full the room is, and whether a game is already running. The user then',
  'chooses "Katil" (Join) or "Vazgec" (Cancel); nothing is joined until they',
  'accept. The same screen appears before spectating.',
  '',
  'VOICE CHAT HAS BEEN REMOVED',
  'The previous build had an optional in-room voice chat. Its code is deleted in',
  'this build, not merely disabled. The app never requests the microphone and',
  'NSMicrophoneUsageDescription is gone from Info.plist; the server relays no',
  'WebRTC signalling, so no audio channel can be established.',
  '',
  'THE ONLY USER-TO-USER TEXT IN THE APP',
  'One text channel remains: inside a private room, the 2-4 players secretly',
  'dealt the "traitor" role get a small team chat, so they can agree on a target',
  'without speaking out loud in front of the others at the table. It is not',
  'visible to anyone else and cannot reach anyone outside that room.',
  '',
  'GUIDELINE 1.2 MEASURES IN THIS BUILD',
  '1. Filtering: user names, player names and every chat message pass a',
  '   server-side content filter before being stored or shown. Profanity, sexual',
  '   content and hate speech are rejected, including evasions such as leetspeak,',
  '   added punctuation and letter-by-letter spelling. Avatar GIF search is',
  '   limited to the strictest content rating (G).',
  '2. EULA: account creation requires ticking "I have read and accept the Terms',
  '   of Use" (azap.online/yasal/kullanim-kosullari). Section 5 of those terms is',
  '   a zero-tolerance policy for objectionable content and abusive users.',
  '3. Blocking: in-game Settings (gear icon) -> "Oyuncular" (Players) -> block.',
  '   A blocked player\'s messages are never shown again; the block persists.',
  '4. Reporting: the flag button in that same list files a report with a reason.',
  '   Reports reach our admin panel and push-notify the administrators.',
  '5. 24-hour response: we review every report within 24 hours, remove the',
  '   offending content and remove the offending account. This is written into',
  '   the Terms of Use. Contact: azap.online/iletisim',
  '',
  'HOW TO SEE THESE FEATURES',
  '"Oda Kur" creates a room and shows its 4-digit code; entering that code and',
  'tapping "Katil" shows the join-confirmation screen. Inside a room the gear',
  'icon opens Settings, where "Oyuncular" lists everyone with report and block',
  'buttons. The 7 In-App Purchases are unchanged and were verified in sandbox:',
  'Store icon -> "Altin" tab -> "Satin Al", all via StoreKit.',
  '',
  '--- Turkce ozet ---',
  'AZAP yuz yuze oynanan bir sosyal deduksiyon oyunudur; uygulama oyun yoneticisi',
  'gorevi gorur, tartisma masada sesli yapilir. Rastgele eslestirme yoktur; odaya',
  'yalnizca 4 haneli davet koduyla girilir ve katilmadan once odadaki oyuncular',
  'gosterilip onay istenir. Sesli sohbet bu build ile tamamen kaldirildi, mikrofon',
  'izni artik istenmiyor. Icerik filtresi, EULA onayi, engelleme, sikayet ve 24',
  'saat icinde mudahale taahhudu uygulamada mevcuttur.'
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

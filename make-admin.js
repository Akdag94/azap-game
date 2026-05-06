#!/usr/bin/env node
// Bir kullanıcıyı admin yapma scripti
// Kullanım: node make-admin.js <kullanıcı_adı>
//   örnek: node make-admin.js azad
// Kullanıcı adı küçük harfe çevrilir (case-insensitive arama).

const fs = require('fs');
const path = require('path');
const DB = path.join(__dirname, 'data', 'users.json');

if (process.argv.length < 3) {
  console.log('Kullanım: node make-admin.js <kullanıcı_adı>');
  console.log('Örnek:   node make-admin.js azad');
  process.exit(1);
}

const username = process.argv[2].toLowerCase().trim();

if (!fs.existsSync(DB)) {
  console.error('Hata: data/users.json bulunamadı.');
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
if (!db[username]) {
  console.error(`Hata: "${username}" kullanıcısı bulunamadı. Önce hesap aç.`);
  console.error('Mevcut kullanıcılar:', Object.keys(db).join(', ') || '(yok)');
  process.exit(1);
}

db[username].isAdmin = true;
fs.writeFileSync(DB, JSON.stringify(db, null, 2));
console.log(`✅ "${db[username].username}" artık admin. Tekrar giriş yap, sol altta 👁️ butonu çıkacak.`);

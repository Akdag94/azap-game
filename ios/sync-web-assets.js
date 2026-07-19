// ============================================================
// AZAP iOS — Gömülü Web Varlıkları Senkronizasyonu
// Çalıştırma: node ios/sync-web-assets.js
//
// public/ içindeki web istemcisini ios/AzapOnline/WebAssets/ klasörüne
// kopyalar ve gömülü (offline paketlenmiş) çalışmaya uyarlar:
//  - window.AZAP_SERVER + AZAP_PLATFORM enjekte edilir
//  - style.css / app.js / a.png yerel dosyalardan yüklenir
//  - socket.io, three.js, yasal sayfalar vb. sunucudan (mutlak URL) çekilir
//
// Web istemcisinde her değişiklikten sonra bu scripti çalıştırıp
// Xcode projesini yeniden derlemen yeterli — uygulama ile web birebir kalır.
// ============================================================
const fs = require('fs');
const path = require('path');

const SERVER = process.env.AZAP_SERVER || 'https://azap.online';
const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const OUT = path.join(__dirname, 'AzapOnline', 'WebAssets');

fs.mkdirSync(OUT, { recursive: true });

// 1) Birebir kopyalanan yerel dosyalar
const copyFiles = ['app.js', 'style.css', 'a.png', 'manifest.json'];
copyFiles.forEach(f => {
  const src = path.join(PUB, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(OUT, f));
    console.log('kopyalandı:', f);
  } else {
    console.warn('bulunamadı, atlandı:', f);
  }
});

// 2) index.html dönüşümü
let html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');

// Gömülü mod işaretleri — app.js yüklenmeden ÖNCE tanımlı olmalı
html = html.replace(
  /<head>/i,
  `<head>\n<script>window.AZAP_SERVER='${SERVER}';window.AZAP_PLATFORM='ios';</script>`
);

// Yerel dosyalar: kök-mutlak yolu göreli yap (sürüm parametresi korunur)
html = html.replace(/href="\/style\.css/g, 'href="style.css');
html = html.replace(/src="\/app\.js/g, 'src="app.js');
html = html.replace(/(href|src|content)="\/a\.png/g, '$1="a.png');
html = html.replace(/href="\/manifest\.json"/g, 'href="manifest.json"');

// Geri kalan TÜM kök-mutlak URL'ler sunucuya gitsin
// (socket.io, /vendor/three, /yasal/*, /favicon.svg, /iletisim ...)
html = html.replace(/(href|src|content)="\//g, `$1="${SERVER}/`);

// importmap içindeki "/vendor/..." yolları da mutlaklaştır
html = html.replace(/"\/vendor\//g, `"${SERVER}/vendor/`);

fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log('dönüştürüldü: index.html');
console.log(`\n✅ WebAssets hazır → ${OUT}`);
console.log('Xcode: WebAssets klasörünü projeye "folder reference" (mavi klasör) olarak ekle.');

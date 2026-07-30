#!/usr/bin/env node
// iOS production build — EAS_NO_VCS=1 ile.
//
// NEDEN: EAS varsayılan olarak git istemcisini kullanır ve arşive .git dizinini
// de koyar. Bu repoda .git 710 MB (public/radio altındaki 263 MP3 commit
// geçmişinde duruyor; dosyaları silmek geçmişi küçültmez). Sonuç: her build
// 710 MB yükleme, ~5 dakika bekleme ve kopan bağlantılar.
//
// .easignore bunu ÇÖZMEZ — `public/` satırı zaten çalışıyor (arşivde public 0
// MB), ama `.git/` satırı git istemcisine işlemiyor. EAS_NO_VCS=1 verildiğinde
// EAS git'i hiç kullanmaz, çalışma dizinini .easignore'a uyarak kopyalar.
// Ölçüldü (eas build:inspect): 710 MB → 1.5 MB.
//
// Kullanım: npm run build:ios   (ekstra bayraklar aynen aktarılır)
const { spawnSync } = require('child_process');

const args = ['eas-cli', 'build', '-p', 'ios', '--profile', 'production', ...process.argv.slice(2)];
const r = spawnSync('npx', args, {
  stdio: 'inherit',
  shell: true,
  cwd: __dirname,
  env: { ...process.env, EAS_NO_VCS: '1' },
});
process.exit(r.status ?? 1);

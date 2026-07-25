// azap.online'ı iPhone 6.7" (1290x2796) boyutunda açıp App Store ekran görüntüleri çeker
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'appstore-shots');
fs.mkdirSync(OUT, { recursive: true });
// iPhone 15 Pro Max: 430x932 CSS @3x → 1290x2796 fiziksel (App Store 6.7")
const W = 430, H = 932;

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 3,
    isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });
  const page = await ctx.newPage();
  const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name), clip: { x: 0, y: 0, width: W, height: H } }); console.log('çekildi:', name); };
  const wait = (ms) => page.waitForTimeout(ms);

  await page.goto('https://azap.online/?platform=web', { waitUntil: 'networkidle', timeout: 45000 });
  await wait(3500);
  await shot('01-giris.png');

  // Giriş yap
  await page.fill('#AU', 'applereview');
  await page.fill('#AP', '123456.');
  await page.click('#AB');
  await wait(4000);
  await shot('02-anamenu.png');

  // Rol rehberi (30+ rol — görsel olarak zengin)
  await page.evaluate(() => { try { openModal('MDL_GUIDE'); renderGuide(); } catch (e) {} });
  await wait(2000);
  await shot('03-rehber.png');
  await page.evaluate(() => { try { closeModal('MDL_GUIDE'); } catch (e) {} });
  await wait(800);

  // Mağaza
  await page.evaluate(() => { try { openShopModal(); } catch (e) {} });
  await wait(2500);
  await shot('04-magaza.png');
  await page.evaluate(() => { try { closeModal('MDL_SHOP'); } catch (e) {} });
  await wait(800);

  // Oda kur → lobi
  await page.evaluate(() => { try { createRoom(); } catch (e) {} });
  await wait(3500);
  await shot('05-lobi.png');

  await browser.close();
  console.log('\nBitti →', OUT);
})();

/**
 * paymentRoutes — Ödeme HTTP endpoint'leri
 * 
 * Endpoint'ler:
 *  POST /api/payment/create   → Checkout oturumu başlat
 *  POST /api/payment/callback → Sağlayıcı callback/webhook
 *  GET  /api/payment/result   → Kullanıcıyı yönlendirme sonuç sayfası
 */
const express = require('express');

/**
 * @param {Object} deps
 * @param {PaymentService} deps.paymentService
 * @param {Object} deps.packages - PAYMENT_PACKAGES kataloğu
 * @param {number[]} deps.donationPresets
 * @param {Function} deps.getUser - username → user object
 * @param {Function} deps.paymentLimiter - Rate limiter middleware
 */
function createPaymentRoutes(deps) {
  const router = express.Router();
  const { paymentService, packages, donationPresets, getUser, paymentLimiter } = deps;

  // ── ÖDEME OLUŞTUR ──
  router.post('/create', paymentLimiter, async (req, res) => {
    try {
      const { username, packageId, donationAmount, consents } = req.body || {};

      // Kullanıcı doğrulama
      if (typeof username !== 'string' || username.length < 2 || username.length > 16) {
        return res.status(400).json({ ok: false, error: 'Kullanıcı adı geçersiz' });
      }
      const userStats = getUser(username);
      if (!userStats) return res.status(404).json({ ok: false, error: 'Kullanıcı bulunamadı' });

      // Paket doğrulama (whitelist)
      if (packageId !== 'donation' && !packages[packageId]) {
        return res.status(400).json({ ok: false, error: 'Geçersiz paket' });
      }

      // Onay kontrolü (server-side — manipülasyona karşı)
      if (!consents || !consents.kvkk || !consents.mesafeliSatis || !consents.caymaHakki) {
        return res.status(400).json({ ok: false, error: 'Tüm yasal onaylar verilmeli (KVKK, Mesafeli Satış, Cayma Hakkı İstisnası).' });
      }

      // Fiyat/label hesapla
      let price, label, type;
      if (packageId === 'donation') {
        const amt = parseFloat(donationAmount);
        if (!amt || amt < 5 || amt > 5000 || isNaN(amt)) {
          return res.status(400).json({ ok: false, error: 'Bağış 5-5000 TL arası olmalı' });
        }
        price = amt;
        label = `${amt} TL Bağış`;
        type = 'donation';
      } else {
        const pkg = packages[packageId];
        price = pkg.price;
        label = pkg.label;
        type = pkg.type;
      }

      // Client IP (3D Secure ve fraud tespiti için)
      const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '127.0.0.1';

      const result = await paymentService.initiatePayment({
        username, packageId, price, label, type,
        donationAmount: packageId === 'donation' ? price : undefined,
        clientIp,
        consents
      });

      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      // Checkout form HTML'ini döndür (frontend iframe/popup'ta gösterir)
      res.json({
        ok: true,
        checkoutFormContent: result.checkoutFormContent,
        token: result.token
      });
    } catch (err) {
      console.error('[paymentRoutes] /create hata:', err);
      res.status(500).json({ ok: false, error: 'Sunucu hatası' });
    }
  });

  // ── ÖDEME CALLBACK (Provider'dan gelen POST) ──
  router.post('/callback', async (req, res) => {
    try {
      const result = await paymentService.handleCallback(req);
      if (result.ok) {
        // Başarılı — kullanıcıyı sonuç sayfasına yönlendir
        res.redirect('/api/payment/result?status=success');
      } else {
        console.warn('[paymentRoutes] Callback başarısız:', result.error);
        res.redirect('/api/payment/result?status=fail&error=' + encodeURIComponent(result.error || ''));
      }
    } catch (err) {
      console.error('[paymentRoutes] /callback hata:', err);
      res.redirect('/api/payment/result?status=fail&error=server_error');
    }
  });

  // ── ÖDEME SONUÇ SAYFASI (Kullanıcı yönlendirmesi) ──
  router.get('/result', (req, res) => {
    const status = req.query.status;
    const isSuccess = status === 'success';
    const html = `<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ödeme ${isSuccess ? 'Başarılı' : 'Başarısız'} — AZAP</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a14;color:#c8c8e8;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{text-align:center;padding:40px;border-radius:16px;background:#12121f;border:1px solid ${isSuccess ? '#2ecc71' : '#e74c3c'};max-width:400px;width:90%}
.icon{font-size:3rem;margin-bottom:12px}
h1{font-size:1.2rem;margin-bottom:8px;color:${isSuccess ? '#2ecc71' : '#e74c3c'}}
p{font-size:.85rem;color:#8892b0;margin-bottom:20px}
a{display:inline-block;padding:10px 24px;background:${isSuccess ? '#2ecc71' : '#e74c3c'};color:#fff;text-decoration:none;border-radius:8px;font-size:.85rem;font-weight:600}
</style></head><body><div class="card">
<div class="icon">${isSuccess ? '✅' : '❌'}</div>
<h1>${isSuccess ? 'Ödeme Başarılı!' : 'Ödeme Başarısız'}</h1>
<p>${isSuccess ? 'Satın aldığınız ürün hesabınıza tanımlandı. Oyuna dönebilirsiniz.' : 'Ödeme işlemi tamamlanamadı. Lütfen tekrar deneyin veya destek@azap.online adresine yazın.'}</p>
<a href="/">AZAP'a Dön</a>
</div>
<script>
// Oyun penceresine bildir (popup/iframe ise)
if(window.opener){window.opener.postMessage({type:'payment_result',status:'${status}'},'*');setTimeout(()=>window.close(),3000);}
</script></body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });

  return router;
}

module.exports = createPaymentRoutes;

/**
 * Payment modülü — giriş noktası
 * 
 * Kullanım:
 *   const { setupPayment } = require('./payment');
 *   setupPayment(app, io, { packages, getUser, applyPayment, ... });
 */
const PaymentService = require('./PaymentService');
const IyzicoProvider = require('./providers/IyzicoProvider');
const ShopierProvider = require('./providers/ShopierProvider');
const createPaymentRoutes = require('./paymentRoutes');

/**
 * Aktif provider'ı ortam değişkenlerine göre seç (Factory Pattern)
 * Yeni provider eklemek için buraya bir case eklemek yeterli.
 */
function createProvider() {
  const providerName = (process.env.PAYMENT_PROVIDER || 'iyzico').toLowerCase();

  switch (providerName) {
    case 'iyzico':
      if (!process.env.IYZICO_API_KEY || !process.env.IYZICO_SECRET_KEY) {
        console.warn('[Payment] IYZICO_API_KEY veya IYZICO_SECRET_KEY tanımlı değil — ödeme devre dışı');
        return null;
      }
      return new IyzicoProvider({
        apiKey: process.env.IYZICO_API_KEY,
        secretKey: process.env.IYZICO_SECRET_KEY,
        baseUrl: process.env.IYZICO_BASE_URL || 'https://api.iyzipay.com'
      });

    case 'shopier': {
      if (!process.env.SHOPIER_API_KEY || !process.env.SHOPIER_API_SECRET) {
        console.warn('[Payment] SHOPIER_API_KEY veya SHOPIER_API_SECRET tanımlı değil — ödeme devre dışı');
        return null;
      }
      // Ürün eşleşmesi: SHOPIER_PRODUCTS='{"gold_100":"xxx","premium_1m":"yyy"}'
      let productMap = {};
      try {
        productMap = JSON.parse(process.env.SHOPIER_PRODUCTS || '{}');
      } catch (e) {
        console.warn('[Payment] SHOPIER_PRODUCTS JSON parse hatası:', e.message);
      }
      return new ShopierProvider({
        apiKey: process.env.SHOPIER_API_KEY,
        apiSecret: process.env.SHOPIER_API_SECRET,
        productMap
      });
    }

    default:
      console.warn(`[Payment] Bilinmeyen provider: ${providerName}`);
      return null;
  }
}

/**
 * Ödeme sistemini Express app'e monte et
 * @param {Express} app - Express application
 * @param {SocketIO.Server} io - Socket.io server
 * @param {Object} deps
 * @param {Object} deps.packages - PAYMENT_PACKAGES
 * @param {number[]} deps.donationPresets
 * @param {Function} deps.getUser - username → stats
 * @param {Function} deps.applyPayment - (username, packageId, donationAmount) → result
 * @param {Map} deps.authed - socket.id → username map
 * @param {Function} deps.paymentLimiter - rate limiter
 */
function setupPayment(app, io, deps) {
  const gateway = createProvider();
  const isEnabled = !!gateway;

  // Paket kataloğu endpoint'i (her zaman aktif)
  app.get('/api/shop/packages', deps.apiLimiter || ((r, s, n) => n()), (req, res) => {
    res.json({
      packages: deps.packages,
      donationPresets: deps.donationPresets,
      paymentEnabled: isEnabled,
      provider: isEnabled ? gateway.providerName : null
    });
  });

  if (!isEnabled) {
    // Provider yoksa stub endpoint'ler
    app.post('/api/payment/create', (req, res) => {
      res.status(503).json({ ok: false, error: 'Ödeme sistemi şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.' });
    });
    app.post('/api/payment/callback', (req, res) => res.status(503).send(''));
    console.log('[Payment] ⚠️  Ödeme sistemi devre dışı (provider yapılandırılmamış)');
    return;
  }

  // Socket.io bildirim fonksiyonu
  const notifyUser = (username, payload) => {
    for (const [sid, uname] of deps.authed.entries()) {
      if (uname === username) {
        io.sockets.sockets.get(sid)?.emit(payload.event, payload.data);
      }
    }
  };

  const paymentService = new PaymentService(gateway, {
    getUser: deps.getUser,
    applyPayment: deps.applyPayment,
    notifyUser,
    callbackBaseUrl: process.env.CALLBACK_BASE_URL || 'https://azap.online',
    force3DS: process.env.FORCE_3DS !== 'false' // Varsayılan: true
  });

  // Route'ları monte et
  const paymentRouter = createPaymentRoutes({
    paymentService,
    packages: deps.packages,
    donationPresets: deps.donationPresets,
    getUser: deps.getUser,
    paymentLimiter: deps.paymentLimiter
  });

  app.use('/api/payment', paymentRouter);
  console.log(`[Payment] ✓ Ödeme sistemi aktif — Provider: ${gateway.providerName} | 3DS: ${process.env.FORCE_3DS !== 'false' ? 'Zorunlu' : 'Opsiyonel'}`);
}

module.exports = { setupPayment, createProvider, PaymentService };

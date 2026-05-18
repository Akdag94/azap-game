/**
 * PaymentService — Ödeme iş mantığı servis katmanı
 * 
 * SOLID — Single Responsibility + Dependency Inversion:
 * - Bu servis sadece ödeme iş akışını yönetir
 * - Somut provider'a bağlı değildir, IPaymentGateway arayüzüne bağlıdır
 * - Provider değiştiğinde bu dosya DEĞİŞMEZ
 */
const crypto = require('crypto');

class PaymentService {
  /**
   * @param {IPaymentGateway} gateway - Ödeme sağlayıcı implementasyonu
   * @param {Object} options
   * @param {Function} options.getUser - Kullanıcı bilgisi getiren fonksiyon
   * @param {Function} options.applyPayment - Ödeme sonrası uygulama fonksiyonu
   * @param {Function} options.notifyUser - Socket.io ile kullanıcıya bildirim
   * @param {string} options.callbackBaseUrl - Callback URL prefix
   * @param {boolean} options.force3DS - 3D Secure zorunlu mu (varsayılan: true)
   */
  constructor(gateway, options = {}) {
    if (!gateway) throw new Error('PaymentService: gateway parametresi zorunlu');
    this.gateway = gateway;
    this.getUser = options.getUser;
    this.applyPayment = options.applyPayment;
    this.notifyUser = options.notifyUser;
    this.callbackBaseUrl = options.callbackBaseUrl || 'https://azap.online';
    this.force3DS = options.force3DS !== false; // Varsayılan TRUE (Madde IV-ç)

    // Bekleyen ödemeler: conversationId → { username, packageId, donationAmount, createdAt }
    this.pendingPayments = new Map();

    // 30 dakikadan eski bekleyen ödemeleri temizle
    setInterval(() => this._cleanExpired(), 10 * 60 * 1000);
  }

  /**
   * Yeni ödeme oturumu oluştur
   * @param {Object} params
   * @param {string} params.username
   * @param {string} params.packageId
   * @param {number} params.price
   * @param {string} params.label
   * @param {string} params.type - 'coins' | 'premium' | 'donation'
   * @param {number} [params.donationAmount]
   * @param {string} params.clientIp
   * @param {Object} [params.consents] - Kullanıcı onayları
   * @param {boolean} params.consents.kvkk
   * @param {boolean} params.consents.mesafeliSatis
   * @param {boolean} params.consents.caymaHakki
   * @returns {Promise<{ok: boolean, checkoutFormContent?: string, error?: string}>}
   */
  async initiatePayment(params) {
    const { username, packageId, price, label, type, donationAmount, clientIp, consents } = params;

    // ── ZORUNLU ONAY KONTROLÜ (Madde VII-b, Mesafeli Satış) ──
    if (!consents?.kvkk || !consents?.mesafeliSatis || !consents?.caymaHakki) {
      return { ok: false, error: 'KVKK, Mesafeli Satış Sözleşmesi ve Cayma Hakkı İstisnası onayları zorunludur.' };
    }

    // Benzersiz işlem ID'si
    const conversationId = `AZAP_${username}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const basketId = `${packageId}_${Date.now()}`;

    // Kategorilendirme (Madde V-f: kumar değil, kozmetik/dijital içerik)
    let itemCategory = 'Dijital İçerik';
    if (type === 'coins') itemCategory = 'Sanal Para Birimi';
    else if (type === 'premium') itemCategory = 'Dijital Abonelik';
    else if (type === 'donation') itemCategory = 'Bağış';

    const result = await this.gateway.createCheckoutSession({
      conversationId,
      price,
      currency: 'TRY',
      basketId,
      itemName: label,
      itemCategory,
      buyer: {
        id: `USR_${username}`,
        name: username,
        surname: 'Oyuncu',
        ip: clientIp || '127.0.0.1',
        email: `${username}@azap.online`,
        city: 'Istanbul',
        country: 'Turkey',
        address: 'Dijital Teslimat - Türkiye'
      },
      callbackUrl: `${this.callbackBaseUrl}/api/payment/callback`,
      force3DS: this.force3DS
    });

    if (result.ok) {
      // Bekleyen ödeme kaydı (callback'te eşleştirilecek)
      this.pendingPayments.set(conversationId, {
        username,
        packageId,
        donationAmount,
        type,
        price,
        label,
        token: result.token,
        createdAt: Date.now(),
        consents // Onay kaydı (denetim için)
      });
    }

    return result;
  }

  /**
   * Ödeme callback'i işle (webhook/callback POST)
   * @param {Object} req - Express request
   * @returns {Promise<{ok: boolean, username?: string, packageId?: string, error?: string}>}
   */
  async handleCallback(req) {
    // 1. İmza/token doğrulaması
    if (!this.gateway.verifyWebhookSignature(req)) {
      console.warn('[PaymentService] Geçersiz webhook imzası');
      return { ok: false, error: 'Geçersiz imza' };
    }

    const token = req.body?.token;
    if (!token) return { ok: false, error: 'Token eksik' };

    // 2. Ödeme durumunu provider'dan doğrula
    const verification = await this.gateway.verifyPayment(token);
    if (!verification.ok) {
      console.error('[PaymentService] Ödeme doğrulama başarısız:', verification.error);
      return { ok: false, error: verification.error || 'Ödeme doğrulanamadı' };
    }

    // 3. Bekleyen ödeme kaydıyla eşleştir
    const pending = this.pendingPayments.get(verification.conversationId);
    if (!pending) {
      // conversationId ile bulunamadıysa token ile dene
      const byToken = [...this.pendingPayments.entries()].find(([, v]) => v.token === token);
      if (!byToken) {
        console.error('[PaymentService] Eşleşen bekleyen ödeme bulunamadı:', verification.conversationId);
        return { ok: false, error: 'Ödeme kaydı bulunamadı' };
      }
      return this._finalizePayment(byToken[0], byToken[1], verification);
    }

    return this._finalizePayment(verification.conversationId, pending, verification);
  }

  /** @private */
  _finalizePayment(conversationId, pending, verification) {
    // 4. Dijital ürünü teslim et
    const result = this.applyPayment(pending.username, pending.packageId, pending.donationAmount);
    if (!result?.ok) {
      console.error('[PaymentService] applyPayment başarısız:', pending.username, pending.packageId);
      return { ok: false, error: 'Ürün teslimatı başarısız' };
    }

    // 5. Socket.io ile anlık bildirim
    if (this.notifyUser) {
      this.notifyUser(pending.username, {
        event: 'payment:success',
        data: {
          type: pending.type,
          label: pending.label,
          price: pending.price,
          paymentId: verification.paymentId
        }
      });
    }

    // 6. Bekleyen kaydı temizle
    this.pendingPayments.delete(conversationId);

    console.log(`[PaymentService] ✓ Ödeme tamamlandı: ${pending.username} → ${pending.label} (${pending.price} TL) [${this.gateway.providerName}]`);

    return {
      ok: true,
      username: pending.username,
      packageId: pending.packageId,
      type: pending.type
    };
  }

  /** Süresi dolmuş bekleyen ödemeleri temizle */
  _cleanExpired() {
    const now = Date.now();
    const EXPIRY = 30 * 60 * 1000; // 30 dakika
    for (const [id, data] of this.pendingPayments) {
      if (now - data.createdAt > EXPIRY) {
        this.pendingPayments.delete(id);
      }
    }
  }
}

module.exports = PaymentService;

/**
 * ShopierProvider — Shopier ödeme entegrasyonu
 * 
 * Shopier redirect-based flow:
 * 1. Backend form data oluşturur → Frontend formu Shopier'a POST eder
 * 2. Kullanıcı Shopier'da ödeme yapar
 * 3. Shopier webhook ile callback URL'ine POST atar
 * 4. HMAC-SHA256 imza doğrulaması yapılır
 * 5. Dijital ürün teslim edilir
 * 
 * Gerekli env vars:
 *   SHOPIER_API_KEY      — Shopier API anahtarı
 *   SHOPIER_API_SECRET   — Shopier API gizli anahtarı
 *   SHOPIER_PRODUCTS     — JSON: {"gold_100":"SHOPIER_PRODUCT_ID", ...}
 */
const crypto = require('crypto');
const IPaymentGateway = require('../IPaymentGateway');

class ShopierProvider extends IPaymentGateway {
  constructor(config) {
    super(config);
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    // AZAP packageId → Shopier product ID eşleşmesi
    this.productMap = config.productMap || {};
  }

  get providerName() { return 'shopier'; }

  /**
   * Shopier ödeme oturumu oluştur
   * Iyzico'dan farklı olarak HTML döndürmez — form data + redirect URL döner
   */
  async createCheckoutSession(params) {
    const { conversationId, price, basketId, itemName, buyer, callbackUrl } = params;

    // basketId formatı: "gold_100_1716394000000" → packageId'yi çıkar
    const packageId = basketId.replace(/_\d+$/, '');
    const shopierProductId = this.productMap[packageId];

    if (!shopierProductId) {
      return { ok: false, error: `Bu paket Shopier'da tanımlı değil: ${packageId}` };
    }

    // Shopier'a POST edilecek form alanları
    const formData = {
      'API_key': this.apiKey,
      'website_index': '1',
      'product_id': shopierProductId,
      'product_count': '1',
      'product_type': '1', // 1 = dijital ürün
      'buyer_name': buyer.name || 'Kullanıcı',
      'buyer_surname': buyer.surname || 'AZAP',
      'buyer_email': buyer.email || 'kullanici@azap.online',
      'buyer_phone': '5000000000',
      'buyer_id_nr': '11111111111',
      'buyer_account': conversationId, // Pending order ile eşleşme
      'city_code': '34',
      'district': 'Dijital Teslimat',
      'address': 'Dijital Teslimat - Türkiye',
      'platform_order_id': conversationId
    };

    return {
      ok: true,
      // Shopier form POST URL'i
      redirectUrl: 'https://www.shopier.com/ShowProductNew/api_pay4.php',
      formData,
      token: conversationId // Pending payment eşleşmesi için
    };
  }

  /**
   * Shopier webhook imza doğrulaması
   * Shopier: signature = base64(hmac_sha256(random_nr + platform_order_id, api_secret))
   */
  verifyWebhookSignature(req) {
    const body = req.body || {};
    const { random_nr, platform_order_id, signature } = body;

    if (!random_nr || !platform_order_id || !signature) {
      console.warn('[ShopierProvider] Eksik callback alanları:', Object.keys(body));
      return false;
    }

    const data = String(random_nr) + String(platform_order_id);
    const expected = crypto
      .createHmac('sha256', this.apiSecret)
      .update(data)
      .digest('base64');

    const valid = signature === expected;
    if (!valid) {
      console.warn('[ShopierProvider] İmza doğrulaması başarısız!',
        { expected: expected.substring(0, 10) + '...', got: signature.substring(0, 10) + '...' });
    }
    return valid;
  }

  /**
   * Shopier ödeme doğrulama
   * Shopier'da ayrı bir verify API yok — webhook verisi doğrudan kullanılır
   * @param {string} token - Kullanılmaz (compat)
   * @param {Object} reqBody - Shopier callback body'si
   */
  async verifyPayment(token, reqBody) {
    if (!reqBody) return { ok: false, error: 'Callback verisi eksik' };

    const { platform_order_id, buyer_account, order_total, payment_id, currency } = reqBody;
    const conversationId = platform_order_id || buyer_account;

    if (!conversationId) {
      return { ok: false, error: 'Order ID bulunamadı' };
    }

    return {
      ok: true,
      status: 'SUCCESS',
      conversationId,
      price: parseFloat(order_total) || 0,
      paymentId: String(payment_id || ''),
      currency: currency || 'TRY'
    };
  }

  /**
   * Shopier'da iade — Shopier panel üzerinden yapılır
   */
  async refund(params) {
    return { ok: false, error: 'Shopier iadeleri Shopier panelinden yapılmalıdır.' };
  }
}

module.exports = ShopierProvider;

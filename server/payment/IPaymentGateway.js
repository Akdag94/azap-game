/**
 * IPaymentGateway — Ödeme sağlayıcı soyut arayüzü (Interface)
 * 
 * SOLID — Dependency Inversion Principle:
 * Üst seviye modüller (PaymentService) bu arayüze bağımlıdır,
 * somut implementasyonlara (Iyzico, PayTR vb.) değil.
 * 
 * Yeni bir sağlayıcı eklemek için bu sınıfı extend et ve
 * tüm metodları implement et.
 */
class IPaymentGateway {
  /**
   * @param {Object} config - Provider'a özgü yapılandırma
   * @param {string} config.apiKey
   * @param {string} config.secretKey
   * @param {string} config.baseUrl
   */
  constructor(config) {
    if (new.target === IPaymentGateway) {
      throw new Error('IPaymentGateway doğrudan instantiate edilemez. Bir provider sınıfı kullan.');
    }
    this.config = config;
  }

  /**
   * Ödeme oturumu başlat (Checkout Form token'ı döner)
   * @param {Object} params
   * @param {string} params.conversationId - Benzersiz işlem takip ID'si
   * @param {number} params.price - Ödeme tutarı (TL)
   * @param {string} params.currency - Para birimi (TRY)
   * @param {string} params.basketId - Sepet/paket ID'si
   * @param {string} params.itemName - Ürün açıklaması
   * @param {string} params.itemCategory - Ürün kategorisi
   * @param {Object} params.buyer - Alıcı bilgileri
   * @param {string} params.callbackUrl - Ödeme sonucu callback URL'i
   * @param {boolean} params.force3DS - 3D Secure zorunlu mu
   * @returns {Promise<{ok: boolean, checkoutFormContent?: string, token?: string, error?: string}>}
   */
  async createCheckoutSession(params) {
    throw new Error('createCheckoutSession() implement edilmeli');
  }

  /**
   * Ödeme sonucunu doğrula (callback/webhook sonrası)
   * @param {string} token - Ödeme oturum token'ı
   * @returns {Promise<{ok: boolean, status?: string, conversationId?: string, price?: number, error?: string}>}
   */
  async verifyPayment(token) {
    throw new Error('verifyPayment() implement edilmeli');
  }

  /**
   * Webhook/callback isteğinin gerçekten sağlayıcıdan geldiğini doğrula
   * @param {Object} req - Express request object
   * @returns {boolean}
   */
  verifyWebhookSignature(req) {
    throw new Error('verifyWebhookSignature() implement edilmeli');
  }

  /**
   * İade başlat
   * @param {Object} params
   * @param {string} params.paymentTransactionId - Orijinal ödeme işlem ID'si
   * @param {number} params.refundAmount - İade tutarı
   * @param {string} params.conversationId - Takip ID'si
   * @returns {Promise<{ok: boolean, refundId?: string, error?: string}>}
   */
  async refund(params) {
    throw new Error('refund() implement edilmeli');
  }

  /**
   * Provider adı (log/debug için)
   * @returns {string}
   */
  get providerName() {
    throw new Error('providerName getter implement edilmeli');
  }
}

module.exports = IPaymentGateway;

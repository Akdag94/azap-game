/**
 * AZAP — expo-iap ile StoreKit satın alma akışı
 *
 * 1. Ürün Apple'dan çekilir, satın alma başlatılır
 * 2. Başarılı satın almanın receipt'i sunucuya gönderilir: POST /api/iap/verify
 * 3. Sunucu Apple'a doğrulatıp paketi hesaba tanımlar
 * 4. Sunucu ONAYLAMADAN finishTransaction çağrılmaz — doğrulama başarısız
 *    olursa satın alma kaybolmaz, restore/tekrar açılışta yeniden denenir.
 */
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  finishTransaction,
  getAvailablePurchases,
  type Purchase,
} from 'expo-iap';

let _connected = false;
async function ensureConnection(): Promise<boolean> {
  if (_connected) return true;
  try {
    await initConnection();
    _connected = true;
    return true;
  } catch (e) {
    console.warn('[IAP] bağlantı hatası:', e);
    return false;
  }
}

async function verifyWithServer(username: string, receipt: string, server: string): Promise<boolean> {
  try {
    const res = await fetch(`${server}/api/iap/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, receiptData: receipt }),
    });
    if (!res.ok) return false;
    const json = await res.json();
    return json && json.ok === true;
  } catch {
    return false;
  }
}

function receiptOf(p: Purchase | null | undefined): string {
  // iOS'ta transactionReceipt = base64 App Store receipt (sunucu verifyReceipt ile doğrular)
  const anyP = p as any;
  return (anyP && (anyP.transactionReceipt || anyP.purchaseToken)) || '';
}

export async function purchaseIos(
  productId: string,
  username: string,
  server: string
): Promise<{ ok: boolean; error?: string }> {
  if (!productId) return { ok: false, error: 'Ürün belirtilmedi.' };
  if (!username) return { ok: false, error: 'Giriş yapmış olman gerekiyor.' };
  if (!(await ensureConnection())) return { ok: false, error: 'App Store bağlantısı kurulamadı.' };

  try {
    const products = await fetchProducts({ skus: [productId], type: 'inapp' });
    if (!products || products.length === 0) {
      return { ok: false, error: `Ürün bulunamadı: ${productId}` };
    }

    const purchase = (await requestPurchase({
      request: { ios: { sku: productId } },
      type: 'inapp',
    })) as Purchase | Purchase[] | null;

    const p = Array.isArray(purchase) ? purchase[0] : purchase;
    if (!p) return { ok: false, error: 'Satın alma tamamlanmadı.' };

    const receipt = receiptOf(p);
    if (!receipt) return { ok: false, error: 'Receipt alınamadı.' };

    const serverOk = await verifyWithServer(username, receipt, server);
    if (serverOk) {
      await finishTransaction({ purchase: p, isConsumable: true }).catch(() => {});
      return { ok: true };
    }
    // Sunucu doğrulayamadı: transaction açık kalır, restore ile tekrar denenir
    return { ok: false, error: 'Sunucu doğrulaması başarısız. Satın alman kaybolmadı — daha sonra otomatik tanımlanacak.' };
  } catch (e: any) {
    const msg = String(e?.message || e || 'Bilinmeyen hata');
    if (/cancel/i.test(msg)) return { ok: false, error: 'Satın alma iptal edildi.' };
    return { ok: false, error: 'Satın alma hatası: ' + msg };
  }
}

export async function restoreIos(
  username: string,
  server: string
): Promise<{ ok: boolean; error?: string }> {
  if (!username) return { ok: false, error: 'Giriş yapmış olman gerekiyor.' };
  if (!(await ensureConnection())) return { ok: false, error: 'App Store bağlantısı kurulamadı.' };
  try {
    const purchases = await getAvailablePurchases();
    const withReceipt = (purchases || []).find((p) => receiptOf(p));
    if (!withReceipt) return { ok: false, error: 'Geri yüklenecek satın alma bulunamadı.' };
    const serverOk = await verifyWithServer(username, receiptOf(withReceipt), server);
    if (serverOk) {
      for (const p of purchases) {
        await finishTransaction({ purchase: p, isConsumable: true }).catch(() => {});
      }
      return { ok: true };
    }
    return { ok: false, error: 'Sunucu doğrulaması başarısız.' };
  } catch (e: any) {
    return { ok: false, error: 'Geri yükleme hatası: ' + String(e?.message || e) };
  }
}

export async function teardownIap() {
  if (_connected) {
    try { await endConnection(); } catch {}
    _connected = false;
  }
}

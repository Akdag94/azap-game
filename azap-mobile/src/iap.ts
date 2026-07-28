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

// seen === null → sunucu bu alanı hiç döndürmedi (henüz güncellenmemiş sürüm).
// Bu durumda eski davranışa düşülür: ok:true yeterli sayılır. Aksi halde
// sunucu güncellenene kadar BAŞARILI satın almalar da hata olarak raporlanırdı.
type VerifyResult = { ok: boolean; seen: string[] | null };

async function verifyWithServer(
  username: string,
  receipt: string,
  server: string,
  transactionId?: string
): Promise<VerifyResult> {
  try {
    const res = await fetch(`${server}/api/iap/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, receiptData: receipt, transactionId }),
    });
    if (!res.ok) return { ok: false, seen: null };
    const json = await res.json();
    if (!json || json.ok !== true) return { ok: false, seen: null };
    return { ok: true, seen: Array.isArray(json.seen) ? json.seen.map(String) : null };
  } catch {
    return { ok: false, seen: null };
  }
}

/** Sunucu bu işlemi gördü mü? (eski sunucuda seen yok → ok:true yeterli) */
function confirmed(r: VerifyResult, transactionId: string): boolean {
  if (!r.ok) return false;
  if (r.seen === null || !transactionId) return true;
  return r.seen.includes(transactionId);
}

/**
 * Sunucu işlemi receipt'te görene kadar artan beklemeyle tekrar dener.
 * App Store receipt'i satın alma bittikten birkaç saniye sonra güncellenebiliyor;
 * tek denemede "başarısız" demek hatalı sonuç veriyordu (App Store 2.1(b) reddi).
 */
async function verifyWithRetry(
  username: string,
  receipt: string,
  server: string,
  transactionId: string
): Promise<boolean> {
  const delays = [0, 2000, 4000, 8000];
  for (const wait of delays) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const r = await verifyWithServer(username, receipt, server, transactionId);
    if (confirmed(r, transactionId)) return true;
  }
  return false;
}

function receiptOf(p: Purchase | null | undefined): string {
  // iOS'ta transactionReceipt = base64 App Store receipt (sunucu verifyReceipt ile doğrular)
  const anyP = p as any;
  return (anyP && (anyP.transactionReceipt || anyP.purchaseToken)) || '';
}

function txIdOf(p: Purchase | null | undefined): string {
  const anyP = p as any;
  return String((anyP && (anyP.transactionId ?? anyP.id)) || '');
}

export async function purchaseIos(
  productId: string,
  username: string,
  server: string
): Promise<{ ok: boolean; error?: string }> {
  if (!productId) return { ok: false, error: 'Ürün belirtilmedi.' };
  if (!username) return { ok: false, error: 'Giriş yapmış olman gerekiyor.' };
  if (!(await ensureConnection())) return { ok: false, error: 'App Store bağlantısı kurulamadı.' };

  // Önce kuyrukta kalmış (finish edilmemiş) işlemleri temizle — bunlar
  // aynı ürünün yeniden satın alınmasını engelleyebiliyor.
  await settlePending(username, server);

  try {
    const products = await fetchProducts({ skus: [productId], type: 'inapp' });
    if (!products || products.length === 0) {
      return { ok: false, error: `Ürün şu anda App Store'dan yüklenemedi (${productId}). Bağlantını kontrol edip tekrar dene.` };
    }

    const purchase = (await requestPurchase({
      request: { ios: { sku: productId } },
      type: 'inapp',
    })) as Purchase | Purchase[] | null;

    const p = Array.isArray(purchase) ? purchase[0] : purchase;
    if (!p) return { ok: false, error: 'Satın alma tamamlanmadı.' };

    const receipt = receiptOf(p);
    if (!receipt) return { ok: false, error: 'App Store makbuzu alınamadı. Mağazadaki “Satın Almaları Geri Yükle”ye dokun.' };

    if (await verifyWithRetry(username, receipt, server, txIdOf(p))) {
      await finishTransaction({ purchase: p, isConsumable: true }).catch(() => {});
      return { ok: true };
    }
    // Sunucu doğrulayamadı: transaction açık kalır, restore ile tekrar denenir
    return { ok: false, error: 'Satın alman alındı, ancak hesabına tanımlanamadı. Birazdan otomatik tanımlanacak; olmazsa mağazadaki “Satın Almaları Geri Yükle”ye dokun.' };
  } catch (e: any) {
    const msg = String(e?.message || e || 'Bilinmeyen hata');
    if (/cancel/i.test(msg)) return { ok: false, error: 'Satın alma iptal edildi.' };
    return { ok: false, error: 'Satın alma hatası: ' + msg };
  }
}

/**
 * Kuyrukta bekleyen (finish edilmemiş) işlemleri sunucuya tanımlat ve kapat.
 * Sessiz çalışır; kaç işlem kapatıldığını döner.
 */
async function settlePending(username: string, server: string): Promise<number> {
  if (!username) return 0;
  let closed = 0;
  try {
    const purchases = (await getAvailablePurchases()) || [];
    for (const p of purchases) {
      const receipt = receiptOf(p);
      if (!receipt) continue;
      const txId = txIdOf(p);
      const r = await verifyWithServer(username, receipt, server, txId);
      if (confirmed(r, txId)) {
        await finishTransaction({ purchase: p, isConsumable: true }).catch(() => {});
        closed++;
      }
    }
  } catch (e) {
    console.warn('[IAP] bekleyen işlemler kapatılamadı:', e);
  }
  return closed;
}

export async function restoreIos(
  username: string,
  server: string
): Promise<{ ok: boolean; error?: string }> {
  if (!username) return { ok: false, error: 'Giriş yapmış olman gerekiyor.' };
  if (!(await ensureConnection())) return { ok: false, error: 'App Store bağlantısı kurulamadı.' };
  try {
    const closed = await settlePending(username, server);
    if (closed > 0) return { ok: true };
    return { ok: false, error: 'Tanımlanacak bekleyen satın alma bulunamadı.' };
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

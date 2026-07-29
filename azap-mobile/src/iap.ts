/**
 * AZAP — expo-iap (StoreKit 2) ile satın alma akışı
 *
 * ÖNEMLİ (App Store 2.1(b) reddinin kök nedeni):
 * expo-iap'te `requestPurchase()` satın almayı DÖNDÜRMEZ — native tarafta
 * `AsyncFunction("requestPurchase")` hiçbir değer döndürmez, sonuç yalnızca
 * `purchase-updated` / `purchase-error` EVENT'leriyle gelir. Eski kod dönüş
 * değerine bakıp `null` görünce her satın almada "Satın alma tamamlanmadı."
 * hatası veriyordu (başarılı satın almalarda bile). Akış artık event tabanlı.
 *
 * 1. Ürün Apple'dan çekilir, satın alma başlatılır
 * 2. Sonuç purchaseUpdatedListener ile gelir
 * 3. İşlemin JWS'i (+ varsa eski tip receipt) sunucuya gönderilir: POST /api/iap/verify
 * 4. Sunucu Apple'a doğrulatıp paketi hesaba tanımlar
 * 5. Sunucu ONAYLAMADAN finishTransaction çağrılmaz — doğrulama başarısız
 *    olursa satın alma kaybolmaz, restore/tekrar açılışta yeniden denenir.
 */
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  finishTransaction,
  getAvailablePurchases,
  purchaseUpdatedListener,
  purchaseErrorListener,
  validateReceiptIOS,
  getPendingTransactionsIOS,
  emitter,
  type Purchase,
} from 'expo-iap';

const PURCHASE_TIMEOUT_MS = 180_000; // StoreKit sayfası açık kalabilir; cömert davran

type Outcome = { purchase?: Purchase; error?: string; cancelled?: boolean };
type Waiter = { token: number; sku: string; resolve: (o: Outcome) => void; timer: any };

let _connected = false;
let _listenersReady = false;
let _waiter: Waiter | null = null;
let _waiterSeq = 0;
// Kuyrukta kalmış işlemler (uygulama açılışında StoreKit'in yeniden yolladığı)
// hangi hesaba tanımlanacak: son satın alma/restore isteğindeki kullanıcı.
let _lastUser = '';
let _lastServer = '';

function settleWaiter(token: number, outcome: Outcome) {
  if (!_waiter || _waiter.token !== token) return false;
  const w = _waiter;
  _waiter = null;
  clearTimeout(w.timer);
  w.resolve(outcome);
  return true;
}

function setupListeners() {
  if (_listenersReady) return;
  _listenersReady = true;

  purchaseUpdatedListener((p: Purchase) => {
    const sku = String((p as any)?.productId || '');
    if (_waiter && (!_waiter.sku || !sku || _waiter.sku === sku)) {
      settleWaiter(_waiter.token, { purchase: p });
      return;
    }
    // Bekleyen yok: uygulama açılışında yeniden yollanan bitmemiş işlem.
    // Sessizce hesaba tanımlat ve kapat.
    void autoSettle(p);
  });

  purchaseErrorListener((e: any) => {
    const sku = String(e?.productId || '');
    if (!_waiter) return;
    if (_waiter.sku && sku && _waiter.sku !== sku) return;
    const code = String(e?.code || '');
    const cancelled = /USER_CANCELL?ED|E_USER_CANCELLED/i.test(code) || /cancel/i.test(String(e?.message || ''));
    settleWaiter(_waiter.token, {
      error: cancelled ? 'Satın alma iptal edildi.' : String(e?.message || 'Satın alma tamamlanamadı.'),
      cancelled,
    });
  });
}

async function ensureConnection(): Promise<boolean> {
  setupListeners();
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
type ReceiptBundle = { receiptData: string; jws: string; productId: string };

async function verifyWithServer(
  username: string,
  bundle: ReceiptBundle,
  server: string,
  transactionId?: string
): Promise<VerifyResult> {
  try {
    const res = await fetch(`${server}/api/iap/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        receiptData: bundle.receiptData,
        jws: bundle.jws,
        productId: bundle.productId,
        transactionId,
      }),
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
 * Sunucu işlemi görene kadar artan beklemeyle tekrar dener.
 * Ağ/receipt yayılma gecikmesinde tek denemede "başarısız" demek hatalı
 * sonuç veriyordu (App Store 2.1(b) reddi).
 */
async function verifyWithRetry(
  username: string,
  bundle: ReceiptBundle,
  server: string,
  transactionId: string
): Promise<boolean> {
  const delays = [0, 2000, 4000, 8000];
  for (const wait of delays) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const r = await verifyWithServer(username, bundle, server, transactionId);
    if (confirmed(r, transactionId)) return true;
  }
  return false;
}

/**
 * Sunucunun doğrulayabileceği kanıtları topla.
 * StoreKit 2'de asıl kanıt işlemin JWS'idir (purchaseToken). Eski tip
 * App Store receipt'i varsa onu da yollarız — sunucu ikisini de kabul eder.
 */
async function receiptBundle(p: Purchase): Promise<ReceiptBundle> {
  const anyP = p as any;
  const productId = String(anyP?.productId || '');
  let jws = String(anyP?.purchaseToken || anyP?.jwsRepresentationIOS || '');
  let receiptData = '';
  try {
    if (productId) {
      const v: any = await validateReceiptIOS(productId);
      if (v) {
        if (!jws) jws = String(v.jwsRepresentation || v.purchaseToken || '');
        receiptData = String(v.receiptData || '');
      }
    }
  } catch (e) {
    console.warn('[IAP] validateReceiptIOS başarısız:', e);
  }
  if (!receiptData) receiptData = String(anyP?.transactionReceipt || '');
  return { receiptData, jws, productId };
}

function txIdOf(p: Purchase | null | undefined): string {
  const anyP = p as any;
  return String((anyP && (anyP.transactionId ?? anyP.id)) || '');
}

/** Doğrulat + (onaylanırsa) işlemi kapat. */
async function creditAndFinish(p: Purchase, username: string, server: string): Promise<boolean> {
  const bundle = await receiptBundle(p);
  if (!bundle.receiptData && !bundle.jws) {
    console.warn('[IAP] işlem için kanıt bulunamadı:', txIdOf(p));
    return false;
  }
  if (!(await verifyWithRetry(username, bundle, server, txIdOf(p)))) return false;
  await finishTransaction({ purchase: p, isConsumable: true }).catch(() => {});
  return true;
}

/** Bekleyen yokken gelen işlemi (açılışta yeniden yollanan) sessizce tanımlat. */
async function autoSettle(p: Purchase) {
  if (!_lastUser || !_lastServer) return;
  try {
    await creditAndFinish(p, _lastUser, _lastServer);
  } catch (e) {
    console.warn('[IAP] bekleyen işlem tanımlanamadı:', e);
  }
}

/**
 * Ürünleri App Store'dan çek.
 *
 * expo-iap'in `fetchProducts`'ı sonucu `isProductIOS` ile süzüyor; bu süzgeç
 * `platform === 'ios'` alanını şart koşuyor. Native serileştirme bu alanı
 * göndermezse StoreKit ürünleri döndürse bile JS tarafı BOŞ liste görür.
 * Bu yüzden liste boş gelirse ham native sonuca düşülür. `emitter` expo-iap'te
 * native modülün ta kendisi (index.js: emitter = ExpoIapModule).
 *
 * `raw`/`filtered` sayıları teşhis içindir: raw=0 → StoreKit gerçekten ürün
 * döndürmüyor (ASC/ortam sorunu); raw>0 & filtered=0 → kütüphane süzgeci eliyor.
 */
type ProductProbe = { products: any[]; raw: number; filtered: number; platform: string; error: string };

async function loadProducts(skus: string[]): Promise<ProductProbe> {
  const probe: ProductProbe = { products: [], raw: -1, filtered: -1, platform: '-', error: '' };
  try {
    const filtered = ((await fetchProducts({ skus, type: 'inapp' })) as any[]) || [];
    probe.filtered = filtered.length;
    if (filtered.length > 0) {
      probe.products = filtered;
      probe.raw = filtered.length;
      probe.platform = String(filtered[0]?.platform ?? '-');
      return probe;
    }
  } catch (e: any) {
    probe.error = String(e?.message || e);
  }
  try {
    const raw = ((await (emitter as any).fetchProducts({ skus, type: 'inapp' })) as any[]) || [];
    probe.raw = raw.length;
    probe.platform = String(raw[0]?.platform ?? '-');
    probe.products = raw.filter((p) => p && skus.includes(String(p.id ?? p.productId ?? '')));
  } catch (e: any) {
    if (!probe.error) probe.error = String(e?.message || e);
  }
  return probe;
}

/** Teşhis eki — kullanıcı ekrandan okuyup bize iletebilsin diye */
function probeTag(p: ProductProbe): string {
  return ` [ham=${p.raw} filtre=${p.filtered} plat=${p.platform}${p.error ? ' hata=' + p.error.slice(0, 60) : ''}]`;
}

export async function purchaseIos(
  productId: string,
  username: string,
  server: string
): Promise<{ ok: boolean; error?: string }> {
  if (!productId) return { ok: false, error: 'Ürün belirtilmedi.' };
  if (!username) return { ok: false, error: 'Giriş yapmış olman gerekiyor.' };
  _lastUser = username;
  _lastServer = server;
  if (!(await ensureConnection())) return { ok: false, error: 'App Store bağlantısı kurulamadı.' };

  // Önce kuyrukta kalmış (finish edilmemiş) işlemleri temizle — bunlar
  // aynı ürünün yeniden satın alınmasını engelleyebiliyor.
  await settlePending(username, server);

  try {
    // Ürün listesi boş gelse bile satın almayı DENE: liste kütüphanenin JS
    // süzgeci yüzünden boş görünebiliyor. Ürün gerçekten yoksa StoreKit zaten
    // anlamlı bir hata döndürür — bizim tahminimizden daha güvenilir.
    const probe = await loadProducts([productId]);

    // Sonuç event'ini bekleyecek kaydı satın almayı BAŞLATMADAN ÖNCE kur:
    // StoreKit event'i requestPurchase dönmeden de yollayabiliyor.
    const token = ++_waiterSeq;
    const outcomePromise = new Promise<Outcome>((resolve) => {
      const timer = setTimeout(() => {
        settleWaiter(token, { error: 'Satın alma zaman aşımına uğradı.' });
      }, PURCHASE_TIMEOUT_MS);
      _waiter = { token, sku: productId, resolve, timer };
    });

    try {
      await requestPurchase({ request: { ios: { sku: productId } }, type: 'inapp' });
    } catch (e: any) {
      // Hata çoğu zaman purchase-error event'iyle de gelir; kısa bir süre
      // bekleyip event gelmediyse bu istisnayı sonuç kabul et.
      const msg = String(e?.message || e || 'Bilinmeyen hata');
      const cancelled = /cancel/i.test(msg);
      setTimeout(() => {
        settleWaiter(token, {
          error: cancelled ? 'Satın alma iptal edildi.' : 'Satın alma hatası: ' + msg,
          cancelled,
        });
      }, 1500);
    }

    const outcome = await outcomePromise;
    if (!outcome.purchase) {
      // Ürün hiç yüklenememişse hatanın sebebi büyük olasılıkla bu — teşhis
      // sayılarını mesaja ekle ki hangi katmanda takıldığı görülebilsin.
      if (probe.products.length === 0 && !outcome.cancelled) {
        return {
          ok: false,
          error: `Ürün şu anda App Store'dan yüklenemedi (${productId}).${probeTag(probe)} ${outcome.error || ''}`.trim(),
        };
      }
      return { ok: false, error: outcome.error || 'Satın alma tamamlanamadı.' };
    }

    if (await creditAndFinish(outcome.purchase, username, server)) return { ok: true };
    // Sunucu doğrulayamadı: transaction açık kalır, restore ile tekrar denenir
    return { ok: false, error: 'Satın alman alındı, ancak hesabına tanımlanamadı. Birazdan otomatik tanımlanacak; olmazsa mağazadaki “Satın Almaları Geri Yükle”ye dokun.' };
  } catch (e: any) {
    const msg = String(e?.message || e || 'Bilinmeyen hata');
    if (/cancel/i.test(msg)) return { ok: false, error: 'Satın alma iptal edildi.' };
    return { ok: false, error: 'Satın alma hatası: ' + msg };
  }
}

/** Aynı işlem iki listeden de gelebilir — transactionId ile tekilleştir. */
function dedupe(purchases: Purchase[]): Purchase[] {
  const out: Purchase[] = [];
  const seen = new Set<string>();
  for (const p of purchases) {
    const id = txIdOf(p) || String((p as any)?.id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(p);
  }
  return out;
}

/**
 * Kuyrukta bekleyen (finish edilmemiş) işlemleri sunucuya tanımlat ve kapat.
 * Sessiz çalışır; kaç işlem kapatıldığını döner.
 *
 * NOT: getAvailablePurchases varsayılanı yalnızca "aktif" kalemleri döndürür —
 * tüketilebilir (altın) işlemleri bu listede GÖRÜNMEZ. onlyIncludeActiveItemsIOS
 * false verilir, ayrıca bitmemiş işlemler için getPendingTransactionsIOS okunur.
 */
async function settlePending(username: string, server: string): Promise<number> {
  if (!username) return 0;
  _lastUser = username;
  _lastServer = server;
  let closed = 0;
  try {
    const lists = await Promise.all([
      getPendingTransactionsIOS().catch(() => [] as Purchase[]),
      getAvailablePurchases({ onlyIncludeActiveItemsIOS: false }).catch(() => [] as Purchase[]),
    ]);
    const purchases = dedupe(([] as Purchase[]).concat(...(lists as Purchase[][])));
    for (const p of purchases) {
      if (await creditAndFinish(p, username, server)) closed++;
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

/**
 * Ürünlerin App Store'daki yerelleştirilmiş fiyatlarını getir
 * ({ 'online.azap.gold_100': '$0.99', ... }). Mağaza ekranı ₺ yerine
 * kullanıcının gerçekte ödeyeceği tutarı göstersin diye.
 */
export async function fetchIosPrices(productIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!productIds || productIds.length === 0) return out;
  if (!(await ensureConnection())) return out;
  const probe = await loadProducts(productIds);
  console.log('[IAP] fiyat sorgusu' + probeTag(probe));
  for (const pr of probe.products) {
    const id = String(pr?.id || '');
    const price = String(pr?.displayPrice || '');
    if (id && price) out[id] = price;
  }
  return out;
}

export async function teardownIap() {
  if (_connected) {
    try { await endConnection(); } catch {}
    _connected = false;
  }
}

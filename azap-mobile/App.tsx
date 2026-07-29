/**
 * AZAP Online — iOS/Android uygulaması (Expo)
 *
 * Web'deki oyunun birebir aynısı, ayrı bir yazılım olarak:
 * gömülü web istemcisi (webassets/) WebView'de file:// üzerinden yüklenir,
 * yalnızca oyun sunucusuna (https://azap.online) bağlanır.
 *
 * Köprüler (web → native):
 *   window.ReactNativeWebView.postMessage(JSON.stringify({bridge:'iap', action:'purchase', productId, packageId, username}))
 *   window.ReactNativeWebView.postMessage(JSON.stringify({bridge:'iap', action:'prices', productIds}))
 *   window.ReactNativeWebView.postMessage(JSON.stringify({bridge:'push', action:'register'}))
 * Native → web:
 *   window.azapIapResult({ok, error})  ·  window.azapPushToken('<apns-hex>')
 *   window.azapIapPrices({'<productId>': '<displayPrice>'})
 */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, StatusBar, StyleSheet, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import * as Notifications from 'expo-notifications';
import { purchaseIos, restoreIos, fetchIosPrices } from './src/iap';

const SERVER = 'https://azap.online';
const REMOTE_FALLBACK = `${SERVER}/?platform=ios`;

// Gömülü web istemcisi dosyaları (node ../ios/sync-web-assets.js üretir)
// NOT: .js/.json dosyaları Metro'da KAYNAK MODÜL olur (çalıştırılır) — bu yüzden
// asset-güvenli .txt kopyalarını require edip runtime'da doğru adla yazıyoruz.
const WEB_ASSETS: Array<[string, number]> = [
  ['index.html', require('./webassets/index.html.txt')],
  ['app.js', require('./webassets/app.js.txt')],
  ['style.css', require('./webassets/style.css')],
  ['a.png', require('./webassets/a.png')],
  ['manifest.json', require('./webassets/manifest.json.txt')],
];

// Uygulama açıkken de bildirim banner'ı göster
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Paketlenmiş web dosyalarını tek klasöre gerçek adlarıyla kopyala
 *  (bundle içindeki asset adları hash'lidir; style.css gibi göreli
 *  bağlantıların çözülmesi için aynı klasörde doğru adla durmalılar) */
async function prepareWebAssets(): Promise<string | null> {
  try {
    const dir = FileSystem.cacheDirectory + 'webassets/';
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    for (const [name, mod] of WEB_ASSETS) {
      const asset = Asset.fromModule(mod);
      await asset.downloadAsync();
      if (!asset.localUri) return null;
      await FileSystem.copyAsync({ from: asset.localUri, to: dir + name }).catch(async (e) => {
        // Zaten varsa üzerine yaz (uygulama güncellemesi sonrası taze kopya)
        await FileSystem.deleteAsync(dir + name, { idempotent: true });
        await FileSystem.copyAsync({ from: asset.localUri!, to: dir + name });
      });
    }
    return dir + 'index.html';
  } catch (e) {
    console.warn('[WebAssets] hazırlanamadı, uzak site kullanılacak:', e);
    return null;
  }
}

export default function App() {
  const webRef = useRef<WebView>(null);
  const [indexUri, setIndexUri] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    prepareWebAssets().then((uri) => {
      setIndexUri(uri);
      setReady(true);
    });
  }, []);

  const runJs = (js: string) => {
    webRef.current?.injectJavaScript(js + ';true;');
  };

  const sendIapResult = (ok: boolean, error?: string | null) => {
    const err = error ? `'${String(error).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : 'null';
    runJs(`window.azapIapResult && window.azapIapResult({ok:${ok ? 'true' : 'false'},error:${err}})`);
  };

  // App Store'un yerelleştirilmiş fiyatlarını web tarafına ilet
  const sendIapPrices = (prices: Record<string, string>) => {
    // İki kez stringify: tırnak/ters bölü içeren değerler de güvenle geçer.
    const payload = JSON.stringify(JSON.stringify(prices));
    runJs(`window.azapIapPrices && window.azapIapPrices(JSON.parse(${payload}))`);
  };

  const registerPush = async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') return;
      // APNs NATIVE cihaz tokenı (Expo push tokenı değil) — sunucudaki APNs modülüyle birebir uyumlu
      const token = await Notifications.getDevicePushTokenAsync();
      const hex = typeof token.data === 'string' ? token.data : '';
      if (hex) runJs(`window.azapPushToken && window.azapPushToken('${hex}')`);
    } catch (e) {
      console.warn('[Push] kayıt hatası:', e);
    }
  };

  const onMessage = async (event: WebViewMessageEvent) => {
    let msg: any = null;
    try { msg = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (!msg || !msg.bridge) return;

    if (msg.bridge === 'push' && msg.action === 'register') {
      registerPush();
      return;
    }

    if (msg.bridge === 'iap') {
      if (msg.action === 'purchase') {
        const r = await purchaseIos(String(msg.productId || ''), String(msg.username || ''), SERVER);
        sendIapResult(r.ok, r.error);
      } else if (msg.action === 'restore') {
        const r = await restoreIos(String(msg.username || ''), SERVER);
        sendIapResult(r.ok, r.error);
      } else if (msg.action === 'prices') {
        const ids = Array.isArray(msg.productIds) ? msg.productIds.map(String) : [];
        const prices = await fetchIosPrices(ids);
        if (Object.keys(prices).length > 0) sendIapPrices(prices);
      }
    }
  };

  if (!ready) return <View style={styles.root} />;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#06060e" />
      <WebView
        ref={webRef}
        style={styles.web}
        source={indexUri ? { uri: indexUri } : { uri: REMOTE_FALLBACK }}
        originWhitelist={['*']}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        allowingReadAccessToURL={indexUri ? indexUri.replace(/index\.html$/, '') : undefined}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        bounces={false}
        overScrollMode="never"
        setSupportMultipleWindows={false}
        onMessage={onMessage}
        // localStorage (oturum tokenı) kalıcı kalsın
        cacheEnabled
        // iOS: klavye açılınca otomatik kaydırma sorunlarını azalt
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#06060e' },
  web: { flex: 1, backgroundColor: '#06060e' },
});

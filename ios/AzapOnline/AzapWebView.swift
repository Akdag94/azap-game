//
//  AzapWebView.swift
//  AZAP Online
//
//  WKWebView sarmalayıcı:
//  - https://azap.online/?platform=ios yükler (web istemcisi bu parametreyle
//    iOS moduna geçer: web ödeme yerine IAP köprüsü, bağış/bahis gizli)
//  - User-Agent'a "AzapiOS/1.0" eklenir (ikinci tespit yöntemi)
//  - "iap" isimli JS mesaj köprüsü: window.webkit.messageHandlers.iap.postMessage(...)
//  - Satın alma sonucu web'e window.azapIapResult({ok, error}) ile döner
//  - Mikrofon izni (sesli sohbet / WebRTC) otomatik onaylanır (kullanıcıya
//    sistem izni ilk seferde zaten sorulur — NSMicrophoneUsageDescription şart)
//

import SwiftUI
import WebKit
import AVFoundation

struct AzapWebView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default() // localStorage/token kalıcı kalsın

        // JS → Native köprüler ("iap": satın alma, "push": bildirim izni)
        let ucc = WKUserContentController()
        ucc.add(context.coordinator, name: "iap")
        ucc.add(context.coordinator, name: "push")
        config.userContentController = ucc

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.customUserAgent = (WKWebView().value(forKey: "userAgent") as? String ?? "") + " AzapiOS/1.0"
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.allowsBackForwardNavigationGestures = false
        webView.uiDelegate = context.coordinator
        webView.navigationDelegate = context.coordinator

        context.coordinator.webView = webView
        PushManager.shared.webView = webView

        // GÖMÜLÜ İSTEMCİ: uygulama web sitesini açmaz — kendi paketlenmiş
        // kopyasını (WebAssets/index.html) yükler, yalnızca oyun sunucusuna bağlanır.
        // WebAssets bulunamazsa güvenlik ağı olarak uzak site yüklenir.
        if let indexURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "WebAssets") {
            webView.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
        } else {
            webView.load(URLRequest(url: url))
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    // MARK: - Coordinator

    final class Coordinator: NSObject, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {
        weak var webView: WKWebView?

        // JS'ten gelen köprü mesajları (iap + push)
        func userContentController(_ userContentController: WKUserContentController,
                                   didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any],
                  let action = body["action"] as? String else { return }

            if message.name == "push" {
                if action == "register" {
                    Task { @MainActor in
                        PushManager.shared.requestAndRegister()
                        PushManager.shared.injectPendingToken()
                    }
                }
                return
            }

            guard message.name == "iap" else { return }

            if action == "purchase" {
                let productId = body["productId"] as? String ?? ""
                let username = body["username"] as? String ?? ""
                Task { @MainActor in
                    let result = await IAPManager.shared.purchase(productId: productId, username: username)
                    self.sendIapResult(ok: result.ok, error: result.error)
                }
            } else if action == "sync" {
                // AZAP'ın kendi geri yükleme mekanizması — Apple ID parolası sormaz.
                let username = body["username"] as? String ?? ""
                let silent = body["silent"] as? Bool ?? false
                Task { @MainActor in
                    let result = await IAPManager.shared.syncPurchases(username: username)
                    if !silent || result.settled > 0 {
                        self.sendIapSyncResult(ok: result.ok, settled: result.settled, error: result.error)
                    }
                }
            }
        }

        @MainActor
        func sendIapResult(ok: Bool, error: String?) {
            let errJs: String
            if let e = error {
                let escaped = e.replacingOccurrences(of: "\\", with: "\\\\")
                              .replacingOccurrences(of: "'", with: "\\'")
                errJs = "'\(escaped)'"
            } else {
                errJs = "null"
            }
            let js = "window.azapIapResult && window.azapIapResult({ok:\(ok ? "true" : "false"),error:\(errJs)})"
            webView?.evaluateJavaScript(js, completionHandler: nil)
        }

        /// Eşitleme (kendi geri yükleme mekanizmamız) sonucu — satın alma
        /// sonucundan ayrı, çünkü settled=0 normal bir durum, hata değil.
        @MainActor
        func sendIapSyncResult(ok: Bool, settled: Int, error: String?) {
            let errJs: String
            if let e = error {
                let escaped = e.replacingOccurrences(of: "\\", with: "\\\\")
                              .replacingOccurrences(of: "'", with: "\\'")
                errJs = "'\(escaped)'"
            } else {
                errJs = "null"
            }
            let js = "window.azapIapSyncResult && window.azapIapSyncResult({ok:\(ok ? "true" : "false"),settled:\(settled),error:\(errJs)})"
            webView?.evaluateJavaScript(js, completionHandler: nil)
        }

        // Sesli sohbet pasif (App Store 1.2): mikrofon/ses yakalama her zaman reddedilir.
        // Sadece kamera (profil fotoğrafı) isteğine izin verilir.
        @available(iOS 15.0, *)
        func webView(_ webView: WKWebView,
                     requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo,
                     type: WKMediaCaptureType,
                     decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(type == .camera ? .grant : .deny)
        }

        // window.open / target=_blank → aynı webview'de aç (yasal sayfalar vb.)
        func webView(_ webView: WKWebView,
                     createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction,
                     windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url {
                webView.load(URLRequest(url: url))
            }
            return nil
        }

        // Harici domainler Safari'de açılsın (azap.online içeride kalır)
        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if let url = navigationAction.request.url,
               let host = url.host,
               navigationAction.navigationType == .linkActivated,
               !host.hasSuffix("azap.online") {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}

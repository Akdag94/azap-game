//
//  PushManager.swift
//  AZAP Online
//
//  APNs push bildirim yöneticisi.
//  Akış:
//   1. Web istemcisi giriş sonrası "register" mesajı yollar (push köprüsü)
//   2. Kullanıcıdan bildirim izni istenir
//   3. APNs cihaz tokenı alınır (AppDelegate üzerinden)
//   4. Token web'e enjekte edilir: window.azapPushToken('<hex>')
//   5. Web, authed socket oturumuyla tokenı sunucuya kaydeder
//

import Foundation
import UserNotifications
import UIKit
import WebKit

@MainActor
final class PushManager: NSObject {
    static let shared = PushManager()

    /// AzapWebView tarafından set edilir — token web'e bu köprüden enjekte edilir
    weak var webView: WKWebView?

    /// Token izinden önce gelirse sakla, webView hazır olunca gönder
    private var pendingToken: String?

    /// Web'den "register" mesajı gelince çağrılır: izin iste + APNs'e kaydol
    func requestAndRegister() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    /// AppDelegate'ten gelen cihaz tokenı → hex string → web'e enjekte
    func handleDeviceToken(_ deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        pendingToken = hex
        injectPendingToken()
    }

    func injectPendingToken() {
        guard let token = pendingToken, let webView = webView else { return }
        let js = "window.azapPushToken && window.azapPushToken('\(token)')"
        webView.evaluateJavaScript(js) { [weak self] _, error in
            if error == nil { self?.pendingToken = nil }
        }
    }
}

// MARK: - Bildirim davranışı (uygulama açıkken banner göster)

final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationDelegate()

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .badge])
    }

    // Bildirime dokununca uygulama zaten açılır; web istemcisi rejoin akışını
    // kendisi yürütür (azap_last_room + otomatik yeniden bağlanma).
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        completionHandler()
    }
}

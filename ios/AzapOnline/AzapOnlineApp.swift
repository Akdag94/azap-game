//
//  AzapOnlineApp.swift
//  AZAP Online — iOS uygulaması giriş noktası
//
//  Web'deki oyunun birebir aynısını WKWebView içinde çalıştırır.
//  Satın alımlar StoreKit 2 (Apple In-App Purchase) üzerinden yapılır.
//

import SwiftUI
import UserNotifications

// APNs cihaz tokenı yalnızca UIApplicationDelegate'e gelir — SwiftUI adaptörü
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = NotificationDelegate.shared
        return true
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in
            PushManager.shared.handleDeviceToken(deviceToken)
        }
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("[Push] APNs kaydı başarısız: \(error.localizedDescription)")
    }
}

@main
struct AzapOnlineApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
    }
}

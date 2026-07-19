//
//  IAPManager.swift
//  AZAP Online
//
//  StoreKit 2 satın alma yöneticisi.
//  Akış:
//   1. Web'den productId gelir (örn. "online.azap.gold_100")
//   2. StoreKit ile satın alma yapılır
//   3. App Store receipt'i sunucuya gönderilir: POST /api/iap/verify
//   4. Sunucu Apple'a doğrulatır, paketi hesaba tanımlar
//   5. Sunucu onayı gelmeden transaction.finish() ÇAĞRILMAZ —
//      böylece doğrulama başarısız olursa satın alma kaybolmaz, tekrar denenir.
//
//  App Store Connect ürün ID'leri PAYMENT_PACKAGES anahtarlarıyla eşleşmeli:
//   online.azap.gold_100, online.azap.gold_500, online.azap.gold_1500,
//   online.azap.gold_5000, online.azap.premium_1m, online.azap.premium_3m
//

import Foundation
import StoreKit

@MainActor
final class IAPManager {
    static let shared = IAPManager()

    private let serverURL = URL(string: "https://azap.online/api/iap/verify")!
    private var updatesTask: Task<Void, Never>?

    private init() {
        // Uygulama açıkken gelen transaction güncellemelerini dinle
        // (kesilen satın almalar, aile paylaşımı, "Onay Bekliyor" sonuçları)
        updatesTask = Task.detached { [weak self] in
            for await update in Transaction.updates {
                guard case .verified(let transaction) = update else { continue }
                // Kullanıcı adı native tarafta saklanmadığı için burada yalnızca
                // finish etmeyip bir sonraki restore/purchase'ta sunucuya bırakıyoruz.
                // Sunucu receipt'teki TÜM işlenmemiş işlemleri tanımlar.
                _ = transaction
                await self?.noop()
            }
        }
    }

    private func noop() async {}

    /// Satın alma başlat + sunucu doğrulaması
    func purchase(productId: String, username: String) async -> (ok: Bool, error: String?) {
        guard !username.isEmpty else { return (false, "Giriş yapmış olman gerekiyor.") }
        do {
            let products = try await Product.products(for: [productId])
            guard let product = products.first else {
                return (false, "Ürün bulunamadı: \(productId)")
            }
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                guard case .verified(let transaction) = verification else {
                    return (false, "Satın alma doğrulanamadı.")
                }
                let serverOk = await verifyWithServer(username: username)
                if serverOk {
                    await transaction.finish()
                    return (true, nil)
                }
                // Sunucu doğrulayamadı: finish ETME — transaction açık kalır,
                // uygulama tekrar açıldığında/restore'da yeniden denenir.
                return (false, "Sunucu doğrulaması başarısız. Satın alma daha sonra otomatik tanımlanacak.")
            case .userCancelled:
                return (false, "Satın alma iptal edildi.")
            case .pending:
                return (false, "Satın alma onay bekliyor (Aile Onayı vb.). Onaylanınca otomatik tanımlanır.")
            @unknown default:
                return (false, "Bilinmeyen satın alma sonucu.")
            }
        } catch {
            return (false, "Satın alma hatası: \(error.localizedDescription)")
        }
    }

    /// Önceki satın almaları geri yükle (App Store zorunluluğu: restore butonu)
    func restorePurchases(username: String) async -> (ok: Bool, error: String?) {
        guard !username.isEmpty else { return (false, "Giriş yapmış olman gerekiyor.") }
        do {
            try await AppStore.sync()
        } catch {
            return (false, "Geri yükleme başarısız: \(error.localizedDescription)")
        }
        let serverOk = await verifyWithServer(username: username)
        // Sunucu tanımladıysa bekleyen transactionları bitir
        if serverOk {
            for await entitlement in Transaction.currentEntitlements {
                if case .verified(let transaction) = entitlement {
                    await transaction.finish()
                }
            }
            return (true, nil)
        }
        return (false, "Geri yüklenecek satın alma bulunamadı.")
    }

    /// App Store receipt'ini sunucuya gönder — sunucu Apple'a doğrulatıp hesabı günceller
    private func verifyWithServer(username: String) async -> Bool {
        guard let receiptURL = Bundle.main.appStoreReceiptURL,
              let receiptData = try? Data(contentsOf: receiptURL) else {
            return false
        }
        var request = URLRequest(url: serverURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 30
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "username": username,
            "receiptData": receiptData.base64EncodedString()
        ])
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return false
        }
        return (json["ok"] as? Bool) == true
    }
}

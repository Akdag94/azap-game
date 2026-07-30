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
//   online.azap.gold_5000, online.azap.premium30, online.azap.premium90,
//   online.azap.premium365
//
//  Sağlamlaştırma (App Store 2.1(b) reddi sonrası):
//   - Receipt dosyası yoksa SKReceiptRefreshRequest ile App Store'dan istenir
//     (sandbox'ta taze kurulumda receipt gecikmeli yazılır — doğrulama boşa düşüyordu)
//   - Sunucuya transactionId gönderilir; sunucu o işlemi görene kadar
//     artan bekleme ile tekrar denenir (receipt yayılma gecikmesi)
//   - Ürün yüklenemezse sebebi ayırt eden anlaşılır mesaj döner
//

import Foundation
import StoreKit

@MainActor
final class IAPManager {
    static let shared = IAPManager()

    private let serverURL = URL(string: "https://azap.online/api/iap/verify")!
    private var updatesTask: Task<Void, Never>?

    /// Son satın alma/geri yükleme yapan kullanıcı. Uygulama yeniden açıldığında
    /// bekleyen (finish edilmemiş) işlemleri sunucuya tanımlatmak için gerekli.
    private var lastUsername: String? {
        get { UserDefaults.standard.string(forKey: "azap_iap_username") }
        set { UserDefaults.standard.set(newValue, forKey: "azap_iap_username") }
    }

    private init() {
        // Uygulama açıkken gelen transaction güncellemelerini dinle
        // (kesilen satın almalar, aile paylaşımı, "Onay Bekliyor" sonuçları)
        updatesTask = Task { [weak self] in
            for await update in Transaction.updates {
                guard case .verified(let transaction) = update else { continue }
                await self?.settle(transaction)
            }
        }
        // Uygulama açılışında kuyrukta kalmış işlemleri tanımla.
        // Bunlar finish edilmezse StoreKit aynı ürünün tekrar satın alınmasını
        // engelleyebiliyor — App Store incelemesindeki IAP hatasının olası sebebi.
        Task { [weak self] in
            for await entitlement in Transaction.unfinished {
                guard case .verified(let transaction) = entitlement else { continue }
                await self?.settle(transaction)
            }
        }
    }

    /// Bekleyen bir işlemi sunucuya tanımlat; başarılıysa finish et.
    /// Dönüş: işlem hesaba yazılıp kapatıldı mı?
    @discardableResult
    private func settle(_ transaction: Transaction) async -> Bool {
        guard let username = lastUsername, !username.isEmpty else { return false }
        let r = await verifyWithServer(username: username, transactionId: String(transaction.id))
        if r.ok && r.sawTransaction {
            await transaction.finish()
            return true
        }
        return false
    }

    /// Satın alma başlat + sunucu doğrulaması
    func purchase(productId: String, username: String) async -> (ok: Bool, error: String?) {
        guard !username.isEmpty else { return (false, "Giriş yapmış olman gerekiyor.") }
        lastUsername = username
        guard AppStore.canMakePayments else {
            return (false, "Bu cihazda satın alma kapalı (Ekran Süresi → İçerik ve Gizlilik Kısıtlamaları).")
        }
        do {
            let products = try await Product.products(for: [productId])
            guard let product = products.first else {
                return (false, "Ürün şu anda App Store'dan yüklenemedi (\(productId)). Bağlantını kontrol edip tekrar dene.")
            }
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                guard case .verified(let transaction) = verification else {
                    return (false, "Satın alma doğrulanamadı.")
                }
                let txId = String(transaction.id)
                // Receipt yayılma gecikmesine karşı artan bekleme ile tekrar dene
                if await verifyWithServerRetrying(username: username, transactionId: txId) {
                    await transaction.finish()
                    return (true, nil)
                }
                // Sunucu doğrulayamadı: finish ETME — transaction açık kalır,
                // uygulama tekrar açıldığında/restore'da yeniden denenir.
                return (false, "Satın alman alındı, ancak hesabına tanımlanamadı. Birazdan otomatik tanımlanacak; olmazsa mağazadaki “Satın Almaları Geri Yükle”ye dokun.")
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

    /// AZAP'ın kendi geri yükleme mekanizması — Apple ID parolası İSTEMEZ.
    ///
    /// App Store 3.1.1: sattığımız tüm ürünler tüketilebilir (CONSUMABLE).
    /// Tüketilebilir ürünler Apple hesabıyla geri yüklenemez, bu yüzden
    /// `AppStore.sync()` (parola sorar) ve `Transaction.currentEntitlements`
    /// ARTIK KULLANILMIYOR. Yalnızca ödemesi alınmış ama hesaba yazılamamış
    /// yerel işlemler (`Transaction.unfinished`) tamamlanır. Ürünün kalıcı
    /// sahipliği sunucudaki AZAP hesabındadır: kullanıcı hesabına hangi
    /// cihazdan girerse girsin altını ve premium süresi onunla gelir.
    ///
    /// Dönüş: settled = hesaba yazılıp kapatılan işlem sayısı (0 hata değildir).
    func syncPurchases(username: String) async -> (ok: Bool, settled: Int, error: String?) {
        guard !username.isEmpty else { return (false, 0, "Giriş yapmış olman gerekiyor.") }
        lastUsername = username
        var settled = 0
        for await unfinished in Transaction.unfinished {
            if case .verified(let transaction) = unfinished {
                if await settle(transaction) { settled += 1 }
            }
        }
        return (true, settled, nil)
    }

    // MARK: - Sunucu doğrulaması

    /// Sunucu işlemi görene kadar artan beklemeyle tekrar dener.
    /// Sandbox'ta App Store receipt'i satın alma bittikten birkaç saniye sonra
    /// güncellenebiliyor; tek denemede "başarısız" demek hatalı sonuç veriyordu.
    private func verifyWithServerRetrying(username: String, transactionId: String) async -> Bool {
        let delays: [UInt64] = [0, 2, 4, 8]   // saniye
        for delay in delays {
            if delay > 0 { try? await Task.sleep(nanoseconds: delay * 1_000_000_000) }
            let r = await verifyWithServer(username: username, transactionId: transactionId)
            if r.ok && r.sawTransaction { return true }
        }
        return false
    }

    /// App Store receipt'ini sunucuya gönder — sunucu Apple'a doğrulatıp hesabı günceller.
    /// Dönüş: (ok: sunucu isteği başarılı mı, sawTransaction: verilen işlem receipt'te görüldü mü)
    private func verifyWithServer(username: String, transactionId: String?) async -> (ok: Bool, sawTransaction: Bool) {
        guard let receiptBase64 = await loadReceipt() else {
            return (false, false)
        }
        var body: [String: Any] = ["username": username, "receiptData": receiptBase64]
        if let txId = transactionId { body["transactionId"] = txId }

        var request = URLRequest(url: serverURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 30
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              (json["ok"] as? Bool) == true else {
            return (false, false)
        }
        // transactionId verilmediyse (restore) işlem eşleşmesi aranmaz
        guard let txId = transactionId else { return (true, true) }
        // "seen" alanı yoksa sunucu henüz güncellenmemiştir → eski davranış:
        // ok:true yeterli. Aksi halde başarılı satın almalar hata sayılırdı.
        guard let seen = json["seen"] as? [String] else { return (true, true) }
        return (true, seen.contains(txId))
    }

    /// Receipt'i oku; dosya yoksa App Store'dan yenilenmesini iste ve tekrar oku.
    private func loadReceipt() async -> String? {
        if let data = currentReceiptData() { return data.base64EncodedString() }
        await ReceiptRefresher.refresh()
        return currentReceiptData()?.base64EncodedString()
    }

    private func currentReceiptData() -> Data? {
        guard let url = Bundle.main.appStoreReceiptURL,
              FileManager.default.fileExists(atPath: url.path),
              let data = try? Data(contentsOf: url),
              !data.isEmpty else { return nil }
        return data
    }
}

/// SKReceiptRefreshRequest sarmalayıcı — taze kurulumda receipt dosyası
/// henüz yazılmamışsa App Store'dan indirtir.
private final class ReceiptRefresher: NSObject, SKRequestDelegate {
    private var continuation: CheckedContinuation<Void, Never>?
    private var request: SKReceiptRefreshRequest?

    static func refresh() async {
        // Yerel değişken askıya alma boyunca canlı kalır — ek bir static'e gerek yok.
        await ReceiptRefresher().run()
    }

    private func run() async {
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            continuation = c
            let r = SKReceiptRefreshRequest(receiptProperties: nil)
            r.delegate = self
            request = r
            r.start()
        }
    }

    private func finish() {
        continuation?.resume()
        continuation = nil
        request = nil
    }

    func requestDidFinish(_ request: SKRequest) { finish() }
    func request(_ request: SKRequest, didFailWithError error: Error) { finish() }
}

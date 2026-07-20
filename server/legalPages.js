// Yasal sayfalar — azap.online/yasal/*  ve  /iletisim
// Bu dosyayı index.js'e require edip app'e monte et

const SITE_NAME = 'AZAP';
const SITE_URL  = 'https://azap.online';
const OWNER     = 'Azat Akdağ';
const EMAIL     = 'destek@azap.online';
const KEP_EMAIL = '';              // KEP adresi alındığında buraya yaz
const PHONE     = '';              // Telefon numarası
const ADDRESS   = 'Türkiye';      // Ticaret Sicili merkez adresi
const MERSIS_NO = '';              // MERSİS numarası (alındığında doldur)
const VKN       = '';              // Vergi Kimlik No
const TRADE_REG = '';              // Ticaret Sicili / Esnaf Sicili bilgisi
const CURRENCY  = 'Türk Lirası (₺ TRY)';
const MIN_AGE   = 18;

function legalHtml(title, body) {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — ${SITE_NAME}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a14;color:#c8c8e8;line-height:1.7;padding:0}
.wrap{max-width:860px;margin:0 auto;padding:40px 20px 80px}
.back{display:inline-flex;align-items:center;gap:6px;color:#64ffda;text-decoration:none;font-size:13px;margin-bottom:28px;opacity:.8;transition:.15s}.back:hover{opacity:1}
h1{font-size:22px;font-weight:800;color:#ff6b6b;margin-bottom:6px;letter-spacing:-0.5px}
.date{font-size:12px;color:#555577;margin-bottom:32px}
h2{font-size:15px;font-weight:700;color:#64ffda;margin:28px 0 8px;text-transform:uppercase;letter-spacing:.5px}
p{font-size:14px;margin-bottom:12px;color:#b0b0cc}
ul,ol{padding-left:20px;margin-bottom:12px;font-size:14px;color:#b0b0cc}
li{margin-bottom:5px}
a{color:#64ffda}
.box{background:#12121f;border:1px solid #1e1e30;border-radius:10px;padding:16px;margin:16px 0;font-size:13px;color:#8892b0}
strong{color:#dde}
hr{border:none;border-top:1px solid #1e1e30;margin:24px 0}
</style>
</head>
<body>
<div class="wrap">
<a href="/" class="back">← ${SITE_NAME}'a Dön</a>
<h1>${title}</h1>
<div class="date">Son güncelleme: Mayıs 2025</div>
${body}
</div>
</body>
</html>`;
}

const pages = {

  'kullanim-kosullari': legalHtml('Kullanım Koşulları ve Üyelik Sözleşmesi', `
<h2>1. Taraflar</h2>
<p>Bu sözleşme, <strong>${SITE_URL}</strong> adresinde faaliyet gösteren <strong>${SITE_NAME}</strong> oyun platformu ("Platform") ile platforma üye olan kullanıcı ("Kullanıcı") arasında akdedilmiştir.</p>

<h2>2. Kabul</h2>
<p>Platforma kayıt olarak veya platformu kullanmaya devam ederek bu Kullanım Koşulları'nı okuduğunuzu ve kabul ettiğinizi beyan edersiniz. Kabul etmiyorsanız platformu kullanmayınız.</p>

<h2>3. Hizmetin Kapsamı</h2>
<p>${SITE_NAME}, tamamen <strong>beceri ve sosyal çıkarım</strong> temelli çevrimiçi bir eğlence oyunudur. Platformda gerçek para karşılığı ödüle katılım, kumar veya şans oyunu bulunmamaktadır. Satın alınan altın ve premium üyelikler yalnızca oyun içi eğlence amaçlıdır.</p>

<h2>4. Kullanıcı Yükümlülükleri</h2>
<ul>
  <li>Yasal yaşa (18+) veya ebeveyn iznine sahip olmak.</li>
  <li>Doğru ve güncel bilgi sağlamak.</li>
  <li>Başka kullanıcılara hakaret, tehdit veya tacizde bulunmamak.</li>
  <li>Platforma zarar verecek teknik saldırılardan kaçınmak.</li>
  <li>Hesabınızı başkasıyla paylaşmamak.</li>
</ul>

<h2>5. Kullanıcı İçeriği ve Sıfır Tolerans Politikası</h2>
<p>${SITE_NAME}, kullanıcıların birbiriyle sesli sohbet, mesaj, kullanıcı adı ve profil fotoğrafı (avatar) aracılığıyla etkileşime girdiği bir platformdur. Uygunsuz içeriğe ve kötüye kullanan kullanıcılara karşı <strong>sıfır tolerans</strong> uygulanır.</p>
<ul>
  <li><strong>Yasaktır:</strong> hakaret, tehdit, taciz, cinsel/müstehcen içerik, nefret söylemi, ırkçılık, zorbalık, spam ve yanıltıcı kimlik.</li>
  <li><strong>Şikayet:</strong> Her kullanıcı, oyun içi Ayarlar menüsündeki 🚩 simgesiyle başka bir oyuncuyu anında şikayet edebilir.</li>
  <li><strong>Engelleme:</strong> Kullanıcı, rahatsız edici bir oyuncunun sesini oyun içinden kısarak/susturarak etkileşimi durdurabilir.</li>
  <li><strong>İnceleme:</strong> Bize ulaşan şikayetler <strong>24 saat içinde</strong> incelenir; kuralları ihlal eden içerik kaldırılır ve ihlal eden kullanıcının hesabı askıya alınır veya kalıcı olarak kapatılır.</li>
  <li>Uygunsuz kullanıcı adı veya avatar tespit edilirse uyarısız kaldırılır.</li>
</ul>
<p>İhlalleri <a href="mailto:${EMAIL}">${EMAIL}</a> adresine de bildirebilirsiniz.</p>

<h2>6. Fikri Mülkiyet</h2>
<p>Platform üzerindeki tüm içerik, tasarım ve yazılım <strong>${OWNER}</strong>'a aittir. İzinsiz kopyalanamaz veya dağıtılamaz.</p>

<h2>6. Sorumluluk Sınırlaması</h2>
<p>Platform "olduğu gibi" sunulmaktadır. Teknik arızalar, geçici hizmet kesintileri veya kullanıcı hatalarından doğan zararlardan ${SITE_NAME} sorumlu tutulamaz.</p>

<h2>7. Hesap Askıya Alma</h2>
<p>Kurallara aykırı davranan hesaplar önceden bildirim yapılmaksızın askıya alınabilir veya kalıcı olarak kapatılabilir. Bu durumda mevcut oyun içi bakiye iade edilmez.</p>

<h2>8. Değişiklikler</h2>
<p>Bu koşullar önceden bildirim yapılmaksızın güncellenebilir. Güncellemeler yayınlandığı andan itibaren geçerlidir.</p>

<h2>9. İletişim</h2>
<p>Sorularınız için: <a href="mailto:${EMAIL}">${EMAIL}</a></p>
`),

  'kvkk': legalHtml('Gizlilik Politikası ve KVKK Aydınlatma Metni', `
<h2>1. Veri Sorumlusu</h2>
<p>6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") kapsamında veri sorumlusu <strong>${OWNER}</strong>'dır. İletişim: <a href="mailto:${EMAIL}">${EMAIL}</a></p>

<h2>2. Toplanan Veriler</h2>
<ul>
  <li><strong>Hesap verileri:</strong> Kullanıcı adı, şifrelenmiş parola.</li>
  <li><strong>Oyun verileri:</strong> Oynanan oyun sayısı, kazanma oranı, MVP sayısı.</li>
  <li><strong>Ödeme verileri:</strong> Ödeme tarihi, tutar, işlem durumu (kart numarası gibi hassas veriler <strong>AZAP'ta saklanmaz</strong>, PCI-DSS uyumlu lisanslı ödeme hizmeti sağlayıcısı altyapısında tutulur).</li>
  <li><strong>Teknik veriler:</strong> IP adresi (güvenlik & oran sınırlama), tarayıcı tipi, bağlantı zamanı (anonimleştirilmiş istatistik olarak).</li>
</ul>

<h2>3. İşleme Amaçları</h2>
<ul>
  <li>Hesap oluşturma ve kimlik doğrulama.</li>
  <li>Ödeme işlemlerini gerçekleştirme ve doğrulama.</li>
  <li>Hizmet güvenliğini sağlama (kötüye kullanımı önleme).</li>
  <li>Hizmet kalitesini iyileştirme (anonimleştirilmiş istatistikler).</li>
</ul>

<h2>4. Üçüncü Taraf Paylaşımı</h2>
<p>Kişisel verileriniz; yasal zorunluluklar ve ödeme hizmeti sağlayıcısı dışında hiçbir üçüncü tarafla paylaşılmaz, satılmaz veya kiralanmaz. Ödeme hizmeti sağlayıcısı ile paylaşılan veriler yalnızca ödeme işleminin gerçekleştirilmesi amacıyla iletilir.</p>

<h2>5. Veri Güvenliği</h2>
<p>Parolalar bcrypt ile şifrelenir. Sunucu trafiği SSL/TLS ile korunur. Ödeme bilgileri yalnızca PCI-DSS uyumlu lisanslı ödeme hizmeti sağlayıcısı altyapısında saklanır; ${SITE_NAME} sunucularında hiçbir kart verisi loglanmaz veya işlenmez.</p>

<h2>6. Haklarınız (KVKK Madde 11)</h2>
<ul>
  <li>Kişisel verilerinizin işlenip işlenmediğini öğrenme.</li>
  <li>İşlenmişse bilgi talep etme.</li>
  <li>İşlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme.</li>
  <li>Yurt içinde / yurt dışında aktarıldığı üçüncü kişileri bilme.</li>
  <li>Eksik veya yanlış işlenmiş verilerin düzeltilmesini isteme.</li>
  <li>KVKK kapsamında silinmesini isteme.</li>
</ul>
<p>Bu haklarınızı kullanmak için <a href="mailto:${EMAIL}">${EMAIL}</a> adresine yazabilirsiniz.</p>

<h2>7. Çerezler</h2>
<p>Platform, oturum yönetimi ve kullanıcı tercihlerini (örn. otomatik giriş token) saklamak amacıyla tarayıcı <strong>localStorage</strong> kullanmaktadır. Üçüncü taraf izleme çerezi kullanılmamaktadır.</p>
`),

  'mesafeli-satis': legalHtml('Mesafeli Satış Sözleşmesi', `
<div class="box">Bu sözleşme, 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği kapsamında düzenlenmiştir.</div>

<h2>1. Satıcı Bilgileri (Madde V-c)</h2>
<div class="box">
<strong>Adı Soyadı / Ticari Unvan:</strong> ${OWNER}<br>
<strong>MERSİS No:</strong> ${MERSIS_NO || 'Başvuru sürecinde'}<br>
<strong>Vergi Kimlik No:</strong> ${VKN || 'Başvuru sürecinde'}<br>
<strong>Merkez Adresi:</strong> ${ADDRESS}<br>
<strong>KEP Adresi:</strong> ${KEP_EMAIL || 'Başvuru sürecinde'}<br>
<strong>E-posta:</strong> <a href="mailto:${EMAIL}">${EMAIL}</a><br>
<strong>Telefon:</strong> ${PHONE || 'E-posta ile iletişim'}<br>
<strong>Platform:</strong> <a href="${SITE_URL}">${SITE_URL}</a><br>
<strong>Ödeme Kabul Edilen Para Birimi:</strong> ${CURRENCY}<br>
<strong>Yaş Kısıtlaması:</strong> ${MIN_AGE}+ (veya ebeveyn izni)
</div>

<h2>2. Ürün ve Hizmet Bilgileri</h2>
<p><strong>Önemli Not:</strong> ${SITE_NAME}, tamamen <strong>beceri ve sosyal çıkarım</strong> temelli bir eğlence oyunudur. Platformda <u>kumar, şans oyunu veya bahis bulunmamaktadır</u>. Tüm satın alımlar kozmetik veya sanal bakiye niteliğindedir ve gerçek paraya çevrilemez.</p>
<ul>
  <li><strong>Altın Paketleri (Sanal Para Birimi):</strong> ${SITE_NAME} oyununda kullanılabilen sanal para birimi. Yalnızca oyun içi kozmetik eşyalar ve özellikler için kullanılır; gerçek para ile değiştirilemez, nakit olarak çekilemez.</li>
  <li><strong>Premium Üyelik (Dijital Abonelik):</strong> Belirtilen süre boyunca özel oyun içi avantajlar sağlayan dijital üzelik hizmeti (ör. +%50 altın kazanımı, özel çerçeve). Abonelik süresi başladıktan sonra otomatik olarak tüketilmiş sayılır.</li>
  <li><strong>Kozmetik Eşyalar:</strong> Oyun içi görsel öğeler (çerçeve, pet, yazı tipi vb.). Oyun sonucunu etkilemez, salt eğlence amaçlıdır.</li>
  <li><strong>Bağış:</strong> Platformu destekleme amaçlı gönüllü ödeme; karşılığında destek rozeti verilir.</li>
</ul>

<h2>3. Ödeme Koşulları</h2>
<p>Tüm ödemeler <strong>${CURRENCY}</strong> cinsinden alınır. Ödemeler, PCI-DSS uyumlu lisanslı ödeme hizmeti sağlayıcısı altyapısı üzerinden gerçekleştirilir. <strong>Kredi kartı bilgileri ${SITE_NAME} sunucularında asla saklanmaz, işlenmez ve loglanmaz.</strong></p>
<p>Ödeme güvenliği için <strong>3D Secure</strong> doğrulama kullanılmaktadır. Ödeme işlemi sırasında bankanız tarafından ek doğrulama istenebilir.</p>

<h2>4. Teslimat</h2>
<p>Dijital ürünler (altın, premium üyelik) ödeme onayının ardından <strong>anında</strong> hesabınıza tanımlanır. Teslimat kanıtı olarak veritabanı kayıtları kullanılmaktadır.</p>

<h2>5. Cayma Hakkı ve Dijital İçerik İstisnası</h2>
<div class="box"><strong>Önemli:</strong> 6502 sayılı Tüketicinin Korunması Hakkında Kanun'un 53/ü maddesi ve Mesafeli Sözleşmeler Yönetmeliği'nin 15/ğ maddesi gereği;</div>
<p>Aşağıdaki koşullar sağlandığında <strong>cayma hakkı kullanılamaz</strong>:</p>
<ul>
  <li>Dijital içeriğin (altın, premium üzelik) <strong>ifasına/teslimatına başlanmış</strong> ise (hesabınıza tanımlanmış ise),</li>
  <li>Tüketici, dijital içeriğin anlık olarak teslim edileceğini ve bu durumda cayma hakkından feragat ettiğini <strong>ödeme öncesinde açıkça onaylamış</strong> ise.</li>
</ul>
<p>Henüz hesaba tanımlanmamış (teknik hata gibi nedenlerle) dijital ürünler için satın alma tarihinden itibaren <strong>14 gün</strong> içinde cayma hakkı kullanılabilir.</p>
<p><strong>Cayma hakkı talebi:</strong> <a href="mailto:${EMAIL}">${EMAIL}</a> adresine kullanıcı adınız ve işlem tarihini içeren e-posta gönderiniz.</p>

<h2>6. Uyuşmazlık</h2>
<p>Uyuşmazlıklarda önce <a href="mailto:${EMAIL}">${EMAIL}</a> üzerinden iletişime geçiniz. Çözüme kavuşturulamazsa Tüketici Hakem Heyeti veya Tüketici Mahkemesi'ne başvurulabilir.</p>
`),

  'iptal-iade': legalHtml('İptal ve İade Koşulları', `
<div class="box">Bu politika, 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve ilgili yönetmelikler çerçevesinde hazırlanmıştır.</div>

<h2>İade Yapılabilecek Durumlar</h2>
<ul>
  <li>Ödeme işlemi başarılı olduğu hâlde altın/premium hesabınıza tanımlanmamışsa.</li>
  <li>Satın alma tarihinden itibaren 14 gün içinde ve dijital içerik hiç kullanılmamışsa.</li>
  <li>Teknik bir hata sonucu çift ödeme gerçekleştiyse.</li>
</ul>

<h2>İade Yapılamayacak Durumlar</h2>
<ul>
  <li>Altın oyun içinde harcanmışsa (Altın Havuzu'na yatırılmış, eşya satın alınmış vb.).</li>
  <li>Premium üyelik süresi başlamışsa (hizmet kullanılmaya başlandıysa).</li>
  <li>Hesap kurallara aykırı davranış nedeniyle askıya alınmışsa.</li>
  <li>Bağış ödemeleri (gönüllü destek niteliğinde olduğundan iade edilmez).</li>
</ul>

<h2>İade Süreci</h2>
<ol>
  <li><a href="mailto:${EMAIL}">${EMAIL}</a> adresine <strong>sipariş numarası</strong> ve iade talebinizi içeren e-posta gönderin.</li>
  <li>Talebiniz <strong>3 iş günü</strong> içinde değerlendirilir.</li>
  <li>Onaylanan iadeler <strong>7-14 iş günü</strong> içinde ödeme yönteminize iade edilir.</li>
</ol>

<h2>İletişim</h2>
<p>Sorularınız için: <a href="mailto:${EMAIL}">${EMAIL}</a></p>
`)
};

const contactPage = legalHtml('İletişim', `
<h2>Destek</h2>
<p>Her türlü soru, öneri ve teknik destek için bize ulaşabilirsiniz:</p>
<div class="box">
  📧 <strong>E-posta:</strong> <a href="mailto:${EMAIL}">${EMAIL}</a><br>
  🌐 <strong>Platform:</strong> <a href="${SITE_URL}" target="_blank">${SITE_URL}</a><br>
  👤 <strong>Geliştirici:</strong> ${OWNER}
</div>
<h2>Yasal Belgeler</h2>
<ul>
  <li><a href="/yasal/kullanim-kosullari">Kullanım Koşulları ve Üyelik Sözleşmesi</a></li>
  <li><a href="/yasal/kvkk">Gizlilik Politikası &amp; KVKK</a></li>
  <li><a href="/yasal/mesafeli-satis">Mesafeli Satış Sözleşmesi</a></li>
  <li><a href="/yasal/iptal-iade">İptal &amp; İade Koşulları</a></li>
</ul>
<h2>Yanıt Süresi</h2>
<p>Tüm talepler en geç <strong>3 iş günü</strong> içinde yanıtlanır.</p>
`);

module.exports = function registerLegalRoutes(app) {
  Object.entries(pages).forEach(([slug, html]) => {
    app.get('/yasal/' + slug, (req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    });
  });
  app.get('/iletisim', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(contactPage);
  });
};

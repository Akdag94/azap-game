// ── DEBUG KONSOL SİSTEMİ ──
(function initDebugConsole(){
  const MAX_LINES = 200;
  let _dbgOn = false, _lines = [];
  let _frames = 0, _lastFps = Date.now(), _lastFpsWarn = 0;

  // FPS sayacı
  function fpsLoop(){
    _frames++;
    const now = Date.now();
    if(now - _lastFps >= 1000){
      const fps = Math.round(_frames * 1000 / (now - _lastFps));
      _frames = 0; _lastFps = now;
      const el = document.getElementById('DBG_FPS');
      if(el) el.textContent = 'FPS: ' + fps;
      if(fps < 10 && now - _lastFpsWarn > 10000){ _lastFpsWarn=now; dbgLog('⚠️ DÜŞÜK FPS: ' + fps, '#f55'); }
    }
    requestAnimationFrame(fpsLoop);
  }
  requestAnimationFrame(fpsLoop);

  // Bellek (destekleniyorsa)
  if(performance.memory){
    setInterval(()=>{
      const el = document.getElementById('DBG_MEM');
      if(el) el.textContent = 'MEM: ' + Math.round(performance.memory.usedJSHeapSize/1048576) + 'MB';
    }, 2000);
  }

  // console.log/warn/error yakalama
  const _origLog = console.log, _origWarn = console.warn, _origErr = console.error;
  console.log = function(){_origLog.apply(console,arguments); dbgLog([...arguments].map(a=>typeof a==='object'?JSON.stringify(a):a).join(' '), '#ccc');};
  console.warn = function(){_origWarn.apply(console,arguments); dbgLog('⚠ '+[...arguments].join(' '), '#ff0');};
  console.error = function(){_origErr.apply(console,arguments); dbgLog('❌ '+[...arguments].join(' '), '#f55');};

  // Global hatalar
  window.addEventListener('error', e => dbgLog('❌ '+e.message+' ('+e.filename+':'+e.lineno+')', '#f55'));
  window.addEventListener('unhandledrejection', e => dbgLog('❌ Promise: '+(e.reason?.message||e.reason), '#f55'));

  function dbgLog(msg, color){
    const time = new Date().toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    _lines.push({time, msg, color: color||'#ccc'});
    if(_lines.length > MAX_LINES) _lines = _lines.slice(-MAX_LINES);
    if(_dbgOn) renderLog();
  }
  window._dbgLog = dbgLog;

  function renderLog(){
    const el = document.getElementById('DBG_LOG');
    if(!el) return;
    el.innerHTML = _lines.map(l=>`<div style="color:${l.color};border-bottom:1px solid #222;padding:1px 0"><span style="color:#666">${l.time}</span> ${l.msg}</div>`).join('');
    el.scrollTop = el.scrollHeight;
  }

  window.toggleDebug = function(){
    _dbgOn = !_dbgOn;
    const panel = document.getElementById('DBG_PANEL');
    if(panel){ panel.style.display = _dbgOn ? 'flex' : 'none'; if(_dbgOn) renderLog(); }
  };
  window.clearDebugLog = function(){ _lines=[]; renderLog(); };

  // Logo'ya 5 kez tıklayınca debug butonu görünür
  let _tapCount=0, _tapTimer=null;
  document.addEventListener('click', e=>{
    if(e.target.closest('.logo')){
      _tapCount++;
      clearTimeout(_tapTimer);
      _tapTimer = setTimeout(()=>_tapCount=0, 2000);
      if(_tapCount >= 5){
        _tapCount=0;
        const btn = document.getElementById('DBG_BTN');
        if(btn) btn.style.display = btn.style.display==='none'?'block':'none';
        dbgLog('🔧 Debug modu aktif', '#0f0');
      }
    }
  });

  // Performans: uzun task algılama
  if(typeof PerformanceObserver !== 'undefined'){
    try{
      const obs = new PerformanceObserver(list=>{
        for(const entry of list.getEntries()){
          if(entry.duration > 80){
            dbgLog('🐌 Uzun task: '+Math.round(entry.duration)+'ms', '#f90');
          }
        }
      });
      obs.observe({type:'longtask',buffered:false});
    }catch{}
  }
})();

// ── TARAYICI UYUMLULUK KONTROLÜ (Madde IV-a) ──
(function checkBrowserCompat(){
  const ua = navigator.userAgent;
  let ok = true, msg = '';
  const ver = (re) => { const m = ua.match(re); return m ? parseInt(m[1],10) : 0; };
  if(/Chrome\//.test(ua) && !/Edg\//.test(ua) && !/OPR\//.test(ua)){
    if(ver(/Chrome\/(\d+)/) < 90){ ok=false; msg='Chrome 90+'; }
  } else if(/Edg\//.test(ua)){
    if(ver(/Edg\/(\d+)/) < 100){ ok=false; msg='Edge 100+'; }
  } else if(/OPR\//.test(ua)){
    if(ver(/OPR\/(\d+)/) < 90){ ok=false; msg='Opera 90+'; }
  } else if(/Firefox\//.test(ua)){
    if(ver(/Firefox\/(\d+)/) < 100){ ok=false; msg='Firefox 100+'; }
  } else if(/Version\//.test(ua) && /Safari\//.test(ua)){
    if(ver(/Version\/(\d+)/) < 12){ ok=false; msg='Safari 12+'; }
  }
  if(!ok){
    document.addEventListener('DOMContentLoaded',()=>{
      const d=document.createElement('div');
      d.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99998;background:#1a1a2e;color:#ffb347;text-align:center;padding:8px 12px;font-size:.75rem;font-weight:600;border-bottom:1px solid #ffb347';
      d.innerHTML='⚠️ Tarayıcınız eski bir sürüm. Güvenli ödeme ve en iyi deneyim için <strong>'+msg+'</strong> veya üstüne güncelleyin.';
      document.body.prepend(d);
    });
  }
})();

// (müzik sistemi kaldırıldı)
const io2=io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  randomizationFactor: 0.5,
  timeout: 20000,
  transports: ['websocket', 'polling']
});
let me,gs,ps,sel1,sel2,selG,voted,nsent,isSpec=false,isDead=false,AM='login',user=null,deathOk=false,lastDead=new Set(),_lastSpec=null;
let mvpVoted=null;
let mks=null,mkps=null; // Matrix Krallığı public/private state
let mkReadyDone=false,prevMkLeaderId=null,prevMkPhase=null;
let _mkAQ=[],_mkABusy=false; // animasyon kuyruğu
let mkPowerLog=[],_lastPRKey=null; // kalıcı güç günlüğü
let mkKnownRoles={}; // id -> {name, team} - spy'dan öğrenilen roller
const Q=id=>document.getElementById(id);
// XSS koruması: HTML entity escape
const esc = (s) => {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const RDEF={
  DOKTOR:{e:'🩺',n:'Doktor',t:'masum',
    d:'Her gece birini saldırıdan korur. Koruyup korumadığını bilemez. Kendini oyun boyunca en fazla 1 kez seçebilir.',
    full:'<b>Ne yapar?</b> Her gece bir oyuncu seçersin. O oyuncunun üzerine o gecelik tıbbi kalkan kurarsın — hain saldırısı, Seri Katil veya Şerif kurşunu o geceyi atlayamaz.<br><br><b>Nasıl kullanılır?</b> Gece aksiyonu ekranında hedef listesinden bir oyuncu seç, "Yetenek Kullan" butonuna bas. Her gece aynı kişiyi de seçebilirsin.<br><br><b>Önemli kurallar:</b><ul><li>Kendini sadece 1 kez koruyabilirsin (tüm oyun boyunca). İkinci kez seçersen "Zaten korumaya aldıydın" uyarısı gelir ve hak harcanır.</li><li>Koruma gerçekleşip gerçekleşmediğini bilemezsin — kimseden bilgi alamazsın.</li><li>Hedefin Çilingir tarafından evine kilitlenmişse Doktor koruyamaz; ancak Çilingir zaten o kişiyi korur.</li><li>Seri Katil, Hain saldırısı ve Bomba patlaması dahil tüm gece saldırılarını durdurabilirsin.</li><li>Deli Doktor: raporları rastgele/sahte gelir; kimi koruduğunu bilemezsin.</li></ul><b>Strateji:</b> Şüphelenilen hain hedef alınacak masum arkadaşını, ya da çok değerli bilgi sahibi birini koru. İkinci geceden itibaren kendini de bir kez koruma altına alabilirsin.'},
  POLIS:{e:'🔦',n:'Polis',t:'masum',
    d:'Her gece bir kişinin yeteneğini tamamen engeller. Engellediğini öğrenebilir.',
    full:'<b>Ne yapar?</b> Her gece bir oyuncu seçersin; o kişi o gecelik herhangi bir gece aksiyonu yapamaz. Hain ise öldüremez, masum ise bilgi toplayamaz, koruma koyamaz.<br><br><b>Nasıl kullanılır?</b> Gece aksiyonu ekranında listeden hedef seç, onayla. Engellenen kişi ekranda "Bu gece engellendi" uyarısını görebilir (polis adı görünmez).<br><br><b>Önemli kurallar:</b><ul><li>Engelleme başarılı olursa sabah raporunda sonucu görebilirsin.</li><li>Seri Katil\'i engelleyemezsin; Seri Katil hedef alınsa bile aksiyon yapmış gibi görünmez — sanki hiçbir şey yapmamış gibi çıkar.</li><li>Hem hain öldürme hem yetenek engellenmek için güçlü çift işlev.</li><li>Çilingir ile farkı: Polis hedefi dışarıya açık bırakır (başkası saldırabilir), Çilingir hem engeller hem korur.</li><li>Deli Polis: kimseyi gerçekten engelleyemez, ancak hedefine gittiği görülebilir.</li></ul><b>Strateji:</b> Hain olduğundan şüphelendiğin birini engelle — en kötü senaryoda bir öldürme önlersin. Savcı/Psikolog gibi önemli bilgi rollerini de saldırıya karşı değil aksiyona karşı koruyabilirsin.'},
  SAVCI:{e:'⚖️',n:'Savcı',t:'masum',
    d:'Oyun boyunca 1 kez bir kişinin rolünü ve takımını kesin olarak öğrenir.',
    full:'<b>Ne yapar?</b> Oyun boyunca tek bir kez, bir oyuncunun tam rolünü ve takımını (Masum/Hain/Tarafsız) görebilirsin. Hile yok, tam doğru bilgi.<br><br><b>Nasıl kullanılır?</b> Gece aksiyonu ekranından hedef seç ve onayla. Sabah raporunda "X: Rol adı (takım)" şeklinde sonuç gelir. Hak kullanılmışsa bir daha kullanamazsın.<br><br><b>Önemli kurallar:</b><ul><li>Sadece 1 kullanım hakkı var — harcandıktan sonra gece aksiyonun olmaz.</li><li>Deli Savcı: sorgu sonucu tamamen sahte bir rol ve rastgele takım gösterir; ama hak harcanır.</li><li>Hacker seni o gece hacklerse sonucu göremezsin.</li></ul><b>Strateji:</b> Hakkını boşa harcama. Köyün şüphelendiği ama emin olamadığı bir kişiyi sorgula. Sonucu gündüz doğrudan açıklamak yerine şüpheyi yönlendirerek kullanabilirsin — ta ki hayatının tehlikede olduğunu hissedene kadar.'},
  MUHTAR:{e:'🏛️',n:'Muhtar',t:'masum',
    d:'Oylama gücü 2 sayılır. Gece aksiyonu yoktur.',
    full:'<b>Ne yapar?</b> Pasif rol — gece aksiyonu yoktur. Asılma oylamalarında oyun 2 oy sayılır; tek oyuyla kritik bir hain ya da tarafsızı astırabilirsin.<br><br><b>Nasıl kullanılır?</b> Gündüz tartışmada başkalarını ikna et, oylamada bir kişiye oy ver. Sistem oyunu otomatik 2 sayar.<br><br><b>Önemli kurallar:</b><ul><li>Oylama etkisi pasif ve otomatik — ek bir buton yoktur.</li><li>Deli Muhtar: oyu bazen 1 sayılır, bazen 3 sayılır, rastgele.</li><li>Pas geçme hakkında da 2 "pas" sayılır ve çoğunluk hesabını etkiler.</li></ul><b>Strateji:</b> Rolünü gizle. Kendini Doktor ya da başka bir rol olarak tanıt. Oyundaki kilit oylamada son anda hamle yaparak dengeleri boz.'},
  GAZETECI:{e:'📰',n:'Gazeteci',t:'masum',
    d:'Her gece birinin gece aksiyonu kullanıp kullanmadığını öğrenir. Hacker saldırısında bilgi göremez.',
    full:'<b>Ne yapar?</b> Her gece bir kişiyi izlersin. Sabah o kişinin o gece "Rol kullandı mı, kullanmadı mı?" sorusunun yanıtını alırsın.<br><br><b>Nasıl kullanılır?</b> Hedef seç ve onayla. Sabah raporunda: "X bu gece rol kullandı" veya "X bu gece rol kullanmadı" bilgisi gelir. Ne yaptığını görmezsin, sadece aksiyon yapıp yapmadığını.<br><br><b>Önemli kurallar:</b><ul><li>Seri Katil daima "Rol kullanmadı" gösterir — iz bırakmaz.</li><li>Pasif roller (Muhtar, Kurban, Dodo, Cellat, Yamyam) gece aksiyon yapmadığından hep "kullanmadı" çıkar.</li><li>Hacker seni o gece hacklerse bilgi göremezsin.</li><li>Deli Gazeteci: sonuç rastgele/sahte gelir.</li></ul><b>Strateji:</b> Şüphelendiğin kişiyi gözle. "Kullanmadı" ama ölüm olduysa o kişi katil olamaz — şüpheyi başkasına kaydır.'},
  PSIKOLOG:{e:'🧠',n:'Psikolog',t:'masum',
    d:'Her gece birinin deli olup olmadığını öğrenir. Hacker saldırısında bilgi göremez.',
    full:'<b>Ne yapar?</b> Her gece bir kişiyi analiz edersin. O kişinin şu an deli olup olmadığını kesin olarak öğrenirsin.<br><br><b>Nasıl kullanılır?</b> Hedef seç, onayla. Sabah raporunda: "X deli" ya da "X sağlıklı" bilgisi gelir.<br><br><b>Önemli kurallar:</b><ul><li>Hem kalıcı deli (oyun başında atanan Deli rolü) hem geçici deli (Hipnotizmacı\'nın o geceki etkisi) tespit edilir.</li><li>Geçici delilik sadece o gece geçerlidir; ertesi gece o kişi tekrar sağlıklı çıkabilir.</li><li>Hacker seni o gece hacklerse sonucu göremezsin.</li><li>Deli Psikolog: sonuç rastgele/sahte gelir.</li></ul><b>Strateji:</b> Savcı\'nın şüphelendiği ama sorgulayamadığı kişileri kontrol et. Deli olduğu tespit ettiğin kişi yine de "iyi niyetle" oynamaya çalışıyor olabilir — bunu hesaba kat.'},
  GAZI:{e:'🛡️',n:'Gazi',t:'masum',
    d:'Oyun boyunca 1 kez tek kullanımlık ölümsüzlük kalkanı aktifleştirir. Hacker saldırısında aktifleştirip aktifleştirmediğini bilemez.',
    full:'<b>Ne yapar?</b> Oyun boyunca 1 kez, o geceyi tüm ölümcül saldırılara karşı bağışık geçirirsin. Hain saldırısı, Seri Katil, Şerif kurşunu — hiçbiri seni öldüremez.<br><br><b>Nasıl kullanılır?</b> Gece aksiyonu ekranında "Ölümsüzlük Aktifleştir" butonuna bas. Bir sonraki sabaha kadar korunmuş olursun. Bir kez kullandıktan sonra bu yetenek bir daha gelmez.<br><br><b>Önemli kurallar:</b><ul><li>Aktifleştirip aktifleştirmediğini bilemezsin (hacker seni o gece hacklerse aktivasyon raporu silinir).</li><li>Hacker saldırısında kalkan yine de çalışır; sadece bilgi akışı kesilir.</li><li>Bomba patlama hasarından korunursun.</li><li>Tek kullanımlık; hak gittikten sonra sıradan bir oyuncuya dönersin.</li></ul><b>Strateji:</b> Hainlerin listende olduğundan şüphelendiğin gecede kullan. "Ben büyük ihtimalle bugece hedefim" hissiyatını iyi yönet.'},
  DEDIKODUCU:{e:'🗣️',n:'Dedikoducu',t:'masum',
    d:'Her gece iki kişi seçer, aynı takımda olup olmadıklarını öğrenir. Hacker saldırısında bilgi göremez.',
    full:'<b>Ne yapar?</b> Her gece iki farklı oyuncu seçersin. Sistem sana bu iki kişinin aynı takımda mı farklı takımda mı olduğunu söyler.<br><br><b>Nasıl kullanılır?</b> Gece ekranında iki kişi seç (sırayla), onayla. Sabah raporunda: "X ve Y aynı takımda" veya "X ve Y farklı takımda" sonucu gelir.<br><br><b>Önemli kurallar:</b><ul><li>Tarafsızlar (Seri Katil, Veba, Cellat vb.) kendi başına ayrı bir takım sayılır — ne masumla ne hainle aynı takımda görünürler.</li><li>Seçtiğin kişilerden biri Polis veya Çilingir tarafından o gece engellenmiş/kilitlenmişse yeteneğin başarısız olabilir.</li><li>Hacker seni o gece hacklerse sonucu göremezsin.</li><li>Deli Dedikoducu: sonuç rastgele/sahte gelir.</li></ul><b>Strateji:</b> Birden fazla gecelik sonuçları birleştirerek bir zincir oluştur (A=B takım, B≠C takım → A≠C). Kesin hain olduğunu bildiğin biriyle karşılaştır.'},
  AJAN:{e:'🕵️',n:'Ajan',t:'masum',
    d:'Her gece birinin rolünü 3 seçenek arasından görür (biri kesinlikle doğru). Hacker saldırısında bilgi göremez.',
    full:'<b>Ne yapar?</b> Her gece bir kişiyi incelersin. O kişinin gerçek rolü dahil 3 seçenek alırsın — biri kesinlikle doğru, iki tanesi aldatmacadır. Hangi rol olduğunu sen bulmak zorundasın.<br><br><b>Nasıl kullanılır?</b> Hedef seç, onayla. Sabah raporunda 3 olası rol gösterilir; doğru olanı seçmek sana kalır. Takımlar doğru etiketlidir (Masum/Hain/Tarafsız).<br><br><b>Önemli kurallar:</b><ul><li>Oyunda tarafsız rol yoksa seçenekler sadece masum/hain rollerinden gelir.</li><li>Hacker seni o gece hacklerse sonucu göremezsin.</li><li>Aynı kişiye tekrar gidersen aynı 3 seçeneği alırsın. Ancak ilk baktığında hipnotize edilmişse sahte sonuç gelir; ertesi gece tekrar bakarsan gerçek seçenekleri görürsün.</li><li>Deli Ajan: 3 seçeneğin hepsi yanlış olabilir, tamamen rastgele.</li></ul><b>Strateji:</b> Savcı gibi kesin bilgi vermez ama her gece kullanılabilir. Elimine çalışarak (tarafsız yok, o seçenek çıkmamalıydı gibi) doğruya yaklaş.'},
  SERIF:{e:'🤠',n:'Şerif',t:'masum',
    d:'Oyun boyunca 1 kez birini vurabilir. Masum vurursan ikisi de anında ölür.',
    full:'<b>Ne yapar?</b> Oyun boyunca 1 kez, istediğin bir oyuncuyu geceleyin vurabilirsin. Yeteneği kullanman zorunda değilsin; hakkı saklayabilirsin.<br><br><b>Nasıl kullanılır?</b> Gece aksiyonu ekranında "Vur" butonuna bas, hedef seç, onayla. Bir kez kullandıktan sonra hak kaybolur.<br><br><b>Önemli kurallar:</b><ul><li>Hain veya Tarafsız vurursan: hedef ölür, sen kurtulursun — köy için büyük galibiyet.</li><li>Masum vurursan: hedef ölür VE sen de anında ölürsün. Çok riskli!</li><li>Hedef Doktor/Gazi/Çilingir tarafından korunuyorsa kurşun işlemez, hak harcanır.</li><li>Kurban\'ı vurursan vasiyet bırakır ve senin adın herkese duyurulur.</li></ul><b>Strateji:</b> Erken vurma. Savcı teyidi, birden fazla gecelik gözlem veya oyun sonu baskısı olmadan namluyu ateşleme.'},
  KURBAN:{e:'🩸',n:'Kurban',t:'masum',
    d:'Gece aksiyonu yok. Öldürülürse katilinin adını tüm oyuncularla paylaşır. Hacker hedefindeyse vasiyet engellenir.',
    full:'<b>Ne yapar?</b> Tamamen pasif bir roldür — gece hiçbir şey seçmen gerekmez. Ama öldürülürsen vasiyet bırakırsın: katilinin adı tüm oyuncuların sabah raporuna düşer.<br><br><b>Nasıl kullanılır?</b> Hiçbir gece aksiyonu yoktur. Sadece oyuna devam et. Ölürsen vasiyet otomatik devreye girer.<br><br><b>Önemli kurallar:</b><ul><li>Çoklu kill modunda (her hain ayrı öldürür): seni öldüren hainin adı açıklanır.</li><li>Tek kill modunda: oy veren hainlerden biri rastgele seçilip duyurulur.</li><li>Seri Katil seni öldürürse isim yerine sadece "Bir Seri Katil tarafından öldürüldün" duyurulur — SK kimliğini gizler.</li><li>Deli Kurban: sahte bir isim duyurur.</li><li>Hacker seni hedef almışsa vasiyet iptal olur; herkese "bilgi erişimi engellendi" mesajı gider.</li><li>Suikastçı tarafından gündüz rolün tahmin edilerek öldürülürsen vasiyet çalışmaz — kimsenin ismini veremezsin.</li></ul><b>Strateji:</b> Rolünü erken açıkla. Hainler seni öldürmekten kaçınacak, sana olası hain saldırısında koruma gibi davranacaksın. Ama bu aynı zamanda seni Suikastçı için kolay hedef yapar — dikkatli ol.'},
  CILINGIR:{e:'🔑',n:'Çilingir',t:'masum',
    d:'Her gece birini evine kilitler: o kişi hem korunur hem yetenek kullanamaz. Kilitlediğini bilir.',
    full:'<b>Ne yapar?</b> Her gece bir kişiyi evine kilitlersin. O kişi: (1) O gece hiçbir yetenek kullanamaz; (2) Saldırılardan korunur. Polis + Doktor birleşimi gibi düşün.<br><br><b>Nasıl kullanılır?</b> Gece hedef seç, onayla. Sabah kilitlediğini raporunda görebilirsin.<br><br><b>Önemli kurallar:</b><ul><li>Kilitlenen kişi evde kilitli olduğunu fark eder ve ekranında "Bu gece kilitlendin" uyarısı görür.</li><li>Hain kilitleniyor, o gece öldüremez — ama saldırıdan da korunur.</li><li>Seri Katil\'i kilitleyemezsin; onun yeteneği Çilingir dahil hiçbir şeyle durdurulamaz.</li><li>Hacker seni o gece hacklerse kilitleme gerçekleşir ama bunu bilemezsin.</li></ul><b>Strateji:</b> Güvende tutmak istediğin bir masum (örn. Savcı, Doktor) üzerine hem koruma hem engelleme işlemi uygularsın. Hain olduğunu düşündüğün birini de kilitleyebilirsin — öldüremesin diye.'},
  TAKIPCI:{e:'👣',n:'Takipçi',t:'masum',
    d:'Her gece birini takip eder, kime aksiyon yaptığını öğrenir. Hacker saldırısında bilgi göremez.',
    full:'<b>Ne yapar?</b> Her gece bir kişiyi gizlice takip edersin. O kişi o gece kime gece aksiyonu yaptıysa bunu öğrenirsin — ne yaptığını değil, KİME yaptığını.<br><br><b>Nasıl kullanılır?</b> Hedef seç, onayla. Sabah raporunda: "X, Y\'ye aksiyon yaptı" veya "X bu gece hiçbir şey yapmadı" bilgisi gelir.<br><br><b>Önemli kurallar:</b><ul><li>Seri Katil iz bırakmaz — hep "yapmadı" görünür.</li><li>Pasif roller (Muhtar, Kurban vb.) gece aksiyon yapmaz, hep "yapmadı" çıkar.</li><li>Hainler öldürme için takım içi karar verdikten sonra birinin üzerine "gidiyor" sayılır — bu kişi görünür.</li><li>Hacker seni o gece hacklerse bilgiyi göremezsin.</li><li>Deli Takipçi: sahte kişi veya sahte aksiyon gösterir.</li></ul><b>Strateji:</b> Şüphelendiğin kişiyi değil, korumak istediğin masum üzerindeki tehdidi takip et. "X, Doktor\'u ziyaret etti" gibi çakışmalar hainleri ele geçirir.'},
  SUIKASTCI:{e:'🗡️',n:'Suikastçı',t:'hain',
    d:'Gündüz bir kişinin rolünü tahmin eder. Doğruysa ölür, yanlışsa sen ölürsün. Her tur 1 deneme hakkı.',
    full:'<b>Ne yapar?</b> Hain takımının gizli keskin nişancısısın. Gündüz bir kişiyi hedef seçer, rolünü tahmin edersin. Doğruysa hedef ANINDA ölür. Yanlışsa SEN ANINDA ölürsün.<br><br><b>Nasıl kullanılır?</b> Tartışma veya oylama fazında, özel butondan hedef + rol seçip onayla. Her tur 1 deneme hakkın var; kullanmazsan o tur geçer.<br><br><b>Önemli kurallar:</b><ul><li>Gece hain sohbetine katılırsın ve hain öldürme oylamasına da dahil olabilirsin.</li><li>Her tur 1 hak — atlar, biriktirirsin ama sonraki tura devredilmez.</li><li>Doğru tahmin: hedef Doktor bile olsa, Koruyucu ile bile olsa anında ölür (bu bir saldırı değil, anında infaz).</li><li>Yanlış tahmin: sen anında ölürsün; hain takımı için çok büyük kayıp.</li></ul><b>Strateji:</b> Hain olduğunu kesin bildiğin veya hain sohbetinden onayladığın kişiyi değil, öldürmek istediğin masum birini hedef al. Tahmin yapmadan önce diğer hainlerin bilgisini kullan.'},
  HIPNOTIZMACI:{e:'🌀',n:'Hipnotizmacı',t:'hain',
    d:'Her gece birini geçici olarak delirtir. O gece aksiyonları sahte sonuç verir.',
    full:'<b>Ne yapar?</b> Hain takımının bilgi bozucusu. Seçtiğin kişi o gecelik deli sayılır; gece raporları sahte/rastgele gelir ve bilgi raporları güvenilmez hale gelir.<br><br><b>Nasıl kullanılır?</b> Gece hedef seç, onayla. Sabah o kişinin raporu sahte veriyle dolar — üstelik bunu farketmez.<br><br><b>Önemli kurallar:</b><ul><li>Geçici delilik sadece o gece geçerlidir; ertesi gece hedef normale döner.</li><li>Psikolog hedefini o gece analiz ederse "deli" sonucu çıkar — bu kişiyi Deli olarak işaretlemesine neden olur.</li><li>Hedef Çilingir tarafından kilitlenmişse Hipnotizmacı etkisi işlemez.</li></ul><b>Strateji:</b> Savcı\'yı veya Doktor\'u delirt. Yanlış rapor almaları onların stratejisini bozar ve köyde yanlış bilgi yayılır.'},
  BOMBACI:{e:'💣',n:'Bombacı',t:'hain',
    d:'Gece bomba koyar veya daha önce koyduklarını patlatır. Hain kill oylamasına katılamaz.',
    full:'<b>Ne yapar?</b> Hain takımında özel silah ustası. Kill oylamasına dahil olmazsın — silahın bombadır. Birden çok kişiye farklı gecelerde bomba koyup istediğin an toplu patlama yapabilirsin.<br><br><b>Nasıl kullanılır?</b> Gece ekranında iki seçenek: 💣 Bomba Koy (hedef seç) veya 💥 Patlat (önceden yerleştirilen TÜM bombalar patlar). Aynı gece koyup patlatamazsın.<br><br><b>Önemli kurallar:</b><ul><li>Bombalar birikir: farklı gecelerde birden fazla kişiye bomb koyabilirsin.</li><li>Patlatınca önceki tüm bombalar birden patlar — tek seferde toplu ölüm.</li><li>Patlama alan hasarı verir; Doktor, Gazi veya Çilingir koruması engelleyemez.</li><li>Koyduğun bombaların listesini özel raporunda görebilirsin.</li></ul><b>Strateji:</b> Sessize gir, sabırla birkaç gece bomba koy, kritik anda patlat. Masumların kalabalık olduğu bir gecede iki veya üç kişilik toplu patlama oyunun seyrini değiştirebilir.'},
  GOLGE:{e:'👤',n:'Gölge',t:'hain',
    d:'Her gece birini susturur; o kişi ertesi gün konuşamaz.',
    full:'<b>Ne yapar?</b> Hain takımının sessizlik silahı. Seçtiğin kişi ertesi gündüz tartışmada konuşamaz, savunma yapamaz.<br><br><b>Nasıl kullanılır?</b> Gece hedef seç, onayla. Susturulan kişi gündüz başında "Susturuldun" uyarısını görür, ama kim yaptığını bilemez.<br><br><b>Önemli kurallar:</b><ul><li>Hedef kimdir dışarıdan bilinemez; sadece kendisi sessiz kalacağını görür.</li><li>Susturulan kişi oylamada oy kullanabilir, sadece sohbet yapamaz.</li><li>Çilingir tarafından kilitlenmişse Gölge etkisi işlemez.</li></ul><b>Strateji:</b> Savcı veya Psikolog gibi kritik bilgi sahibi biri herkese "Ben şunu buldum!" demek üzereyken onu sustur. Ya da köyü kaybetmemek için hainlerin yüklü oylama gücünü dengelemeye çalışan birini etkisiz kıl.'},
  DODO:{e:'🦤',n:'Dodo',t:'tarafsız',
    d:'Asılarak öldürülürse TEK BAŞINA kazanır. Gece aksiyonu yoktur.',
    full:'<b>Ne yapar?</b> Tamamen bağımsız bir kazanma hedefi: sen kendini gündüz oylamasında astırtırsan oyunu tek başına kazanırsın — hem masumlar hem hainler kaybeder.<br><br><b>Nasıl kullanılır?</b> Gece aksiyonu yoktur. Gündüzleri şüphe çekecek şekilde davran, çelişkili konuş, herkesi provoke et. Amacın oylamada en çok oyu almak.<br><br><b>Önemli kurallar:</b><ul><li>Gece öldürülürsen kazanamazsın — sadece oylama ile asılmak kazanmayı sağlar.</li><li>Buzcu tarafından karantinaya alınırsan o tur oylamaya giremezsin — bu sana zarar verir.</li><li>Rolünü açık etme; hem masumlar hem hainler seni elemeye çalışacak.</li></ul><b>Strateji:</b> "Suçlu" gibi dav­ran ama kanıtlanamayacak şekilde. Savcı\'nın seni sorgulamaması için ondan önce başkasını suçla. Oylamanın son anına kadar şüpheyi üzerinde tut.'},
  SERI_KATIL:{e:'🔪',n:'Seri Katil',t:'tarafsız',
    d:'Her gece engellenemez biçimde birini öldürür. İz bırakmaz. Son 2 kişiden biri olursa kazanır.',
    full:'<b>Ne yapar?</b> Bağımsız katil. Her gece dilediğin bir oyuncuyu öldürebilirsin (veya bu geceyi atlayabilirsin). Hiçbir güç seni engelleyemez.<br><br><b>Nasıl kullanılır?</b> Gece hedef seç, onayla. İstersen "Pas geç" seçeneğiyle o geceyi atla.<br><br><b>Önemli kurallar:</b><ul><li>Polis seni engelleyemez; Çilingir kilidi işlemez; Gardiyan yasağı bile etkisiz.</li><li>Gazeteci veya Takipçi seni gözlerse "Rol kullanmadı" / "Hiçbir yere gitmedi" görür — iz bırakmaz.</li><li>Kurban\'ı öldürürsen vasiyet "Bir Seri Katil tarafından öldürüldüm" der ama adın gizli kalır.</li><li>Hedefin Doktor veya Gazi tarafından korunuyorsa o gece öldüremezsin.</li><li>Kazanma: oyun sonunda son 2 hayatta kalan oyuncu arasında olursan tek başına kazanırsın.</li></ul><b>Strateji:</b> Masum gibi davran, hainler gibi de değil. Her iki tarafı birbirine karşı kullan, aralarındaki çatışmayı körükle ve sonunda yalnız kal.'},
  CELLAT:{e:'⛓️',n:'Cellat',t:'tarafsız',
    d:'Oyun başında sistem rastgele bir masum atar. O kişiyi oylamayla astırtırsan kazanırsın.',
    full:'<b>Ne yapar?</b> Sistem sana gizlice bir "hedef" oyuncu atar (her zaman masum biri). O kişinin gündüz oylamasında asılmasını sağlamak senin tek hedefin.<br><br><b>Nasıl kullanılır?</b> Gece aksiyonu yoktur. Gündüz tartışmalarda hedefinin üzerine şüphe yığ, ona karşı oy ver, başkalarını da ikna et. Rol ekranında hedef adını görebilirsin.<br><br><b>Önemli kurallar:</b><ul><li>Hedef gece öldürülürse (hain/SK tarafından) kazanma şansın biter.</li><li>Hedef, başka bir kişi yüzünden değil, sen yüzünden asılmalı — pratikte aynı etki yaratır.</li><li>Hedefi çok açık hedeflemek seni ele verebilir.</li></ul><b>Strateji:</b> Hem masumlarla hem hainlerle geçici ittifak kurabilirsin — "bunu asalım" noktasında ortak zemin bulunabilir. Hedefini doğrudan suçlamak yerine dolaylı şüphe yönet.'},
  YAMYAM:{e:'🍖',n:'Yamyam',t:'tarafsız',
    d:'Gece ölen her oyuncunun rolünü otomatik olarak öğrenir (pasif). Hayatta kalarak sona kalanlarla kazanır.',
    full:'<b>Ne yapar?</b> Tamamen pasif bilgi toplayıcı. Gece kim ölürse ölsün, ölenin rolünü otomatik öğrenir ve kişisel listene eklenir.<br><br><b>Nasıl kullanılır?</b> Gece aksiyonu yoktur. Bilgiler her sabah özel raporuna yansır.<br><br><b>Önemli kurallar:</b><ul><li>Sadece gece ölenleri öğrenirsin; gündüz asılanları ÖĞRENEMEZSIN.</li><li>Öğrendiğin rolleri kullanamaz, yeteneğini "kopyalayamazsın" — sadece bilirsin.</li><li>Oyun sonunda hayatta kaldıysan kazanırsın (masumlarla veya hainlerle sona kal). Ölürsen (gece veya gündüz) direkt kaybedersin.</li></ul><b>Strateji:</b> Bilgi biriktirir, tartışmada kullanırsın. "X dün gece öldü; rolü Y\'ydi" tarzında köyü yönlendir. Gece ölüm sayısı arttıkça senin bilgi avantajın da büyür.'},
  KORUYUCU:{e:'😇',n:'Koruyucu',t:'tarafsız',
    d:'Sistem rastgele bir oyuncu emanet eder. O kişi oyun sonuna kadar yaşarsa kazanırsın.',
    full:'<b>Ne yapar?</b> Cellat\'ın tam tersi bir tarafsız rol. Sistem sana gizlice bir "emanet" oyuncu atar. O kişi oyun bitene kadar hayatta kaldığı sürece sen kazanırsın.<br><br><b>Nasıl kullanılır?</b> Gece aksiyonu yoktur. Rol ekranında emanet ettiğin kişinin adını görürsün. Gündüzleri onu oylamadan kurtarmaya çalış; gece hainlerin hedef almasını engelle (bilgi paylaşarak ya da şüpheyi yönlendirerek).<br><br><b>Önemli kurallar:</b><ul><li>Emanet kişinin takımı seni bağlamaz — o Hain bile olsa görevin onun hayatta kalması.</li><li>Oyun sonunda kazanan kim olursa olsun, emanet kişi hayattaysa sen de kazanırsın.</li><li>Emanet kişi gece veya gündüz ölürse kazanamazsın.</li></ul><b>Strateji:</b> Emanet kişin şüpheli duruma düşünce savunmaya geç. Hainleri başka yöne yönlendirmeye çalış; ama kendi rolünü açıklamak bazen riskli, bazen kurtarıcı olabilir.'},
  DEMIRCI:{e:'⚒️',n:'Demirci',t:'masum',
    d:'Her gece birine kalıcı Çelik Zırh giydirir. Zırh ilk saldırıyı emer ve kırılır. Kendine yapamaz.',
    full:'<b>Ne yapar?</b> Doktor\'dan farklı olarak kalıcı zırh koyarsın. Zırh hedef üzerinde saldırıya uğrayana kadar kalır — 1 gece değil, istediğin kadar gece.<br><br><b>Nasıl kullanılır?</b> Gece hedef seç (kendine yapamaz), onayla. Hedef zırhı görür ama seni görmez. Bir sonraki tur farklı birine zırh koyabilirsin.<br><br><b>Önemli kurallar:</b><ul><li>Zırh sadece 1 saldırıyı emer, sonra kırılır. Bir kez kurtardıktan sonra hedef tekrar savunmasızdır.</li><li>Aynı kişiye bir daha zırh veremezsin — her oyuncuya sadece 1 kez zırh giydirilebilir.</li><li>Zırhın ne zaman kırıldığını bilemezsin; sürekli takip etmek zor.</li><li>Bomba patlamasına karşı zırh işe yaramaz (alan hasarı).</li><li>Doktor\'un şifasından farkı: birden fazla geceyi kapsayan pasif koruma.</li></ul><b>Strateji:</b> Savcı, Doktor gibi değerli masum rollere önce zırh giydir. Hainler onları hedef aldığında zırh devreye girer ve saldırganlar "korunuyordu" mesajı alır.'},
  BUZCU:{e:'❄️',n:'Buzcu',t:'masum',
    d:'Oyun boyunca 2 kez birini karantinaya alır. Karantinadaki: oylayamaz, oylanamaz, saldırıdan etkilenmez, yetenek kullanamaz.',
    full:'<b>Ne yapar?</b> Seçtiğin oyuncuyu bir sonraki gün boyunca (o gündüz) karantinaya alırsın. Karantinadaki kişi hem tamamen izole edilir hem saldırıdan korunur.<br><br><b>Nasıl kullanılır?</b> Gece hedef seç, onayla. 2 kullanım hakkın var (kalan sayı ekranda görünür). Karantina ertesi gündüz boyunca sürer.<br><br><b>Önemli kurallar:</b><ul><li>Karantinadaki kişi: oylamaya katılamaz, kendisine oy verilemez, gece saldırısından etkilenmez, yetenek kullanamaz.</li><li>Hain karantinaya alınırsa hem öldüremez hem de saldırıdan korunur (garip ama kural böyle).</li><li>2 hak dolunca gece aksiyonun olmaz.</li></ul><b>Strateji:</b> Güçlü şüphelinin üstünde gündüz baskısı varken onu karantinaya al: ne astırırsın (hak harcanmadan) ne de gece zarar verir. Oyun sonu kritik turda ikinci hakkı kullan.'},
  INFAZCI:{e:'🔨',n:'İnfazcı',t:'masum',
    d:'Her gece birini zindana kapatır. Zindan: yetenek kullanamaz, saldırılamaz. Oyun boyunca 1 kez idam edebilir.',
    full:'<b>Ne yapar?</b> Her gece bir kişiyi zindana kapatırsın. Ek olarak oyun boyunca 1 kez o zindandaki kişiyi doğrudan infaz edebilirsin.<br><br><b>Nasıl kullanılır?</b> Gece hedef seç, onayla. Ayrı bir "İdam Et" butonu çıkar — kullanırsan o kişi sabah raporunda ölü görünür.<br><br><b>Önemli kurallar:</b><ul><li>Zindandaki: yetenek kullanamaz (ne saldırı ne bilgi) ve dışarıdan saldırılamaz (korunur).</li><li>İdam hakkı tüm oyun boyunca sadece 1 kez. Harcandıktan sonra sadece zindan kalır.</li><li>Zindan etkisi bir gecelik; ertesi gece aynı kişiyi tekrar zindana atman gerekir.</li></ul><b>Strateji:</b> Şüphelendiğin haini zindana koy — hem öldüremesin hem bilgi toplamasın. İdam hakkını, kesin hain olduğunu doğruladığın kişi için sakla.'},
  GARDIYAN:{e:'🛡️',n:'Gardiyan',t:'masum',
    d:'Oyun boyunca 1 kez sokağa çıkma yasağı ilan eder. O gece hiçbir ölüm gerçekleşmez.',
    full:'<b>Ne yapar?</b> O geceyi tamamen koruma altına alırsın. Hain saldırısı, Seri Katil, Şerif, Bomba dahil HİÇBİR ölüm o gece gerçekleşemez.<br><br><b>Nasıl kullanılır?</b> Gece aksiyonu ekranında "Sokağa Çıkma Yasağı" butonuna bas. Bir kez kullandıktan sonra bu yetenek bir daha gelmez.<br><br><b>Önemli kurallar:</b><ul><li>Ertesi sabah herkes yasağın uygulandığını öğrenir (kimin uyguladığını değil).</li><li>Hainler hala birbirini görür ve sohbet edebilir; sadece öldürme aksiyonları engellenir.</li><li>Seri Katil bile bu gece öldüremez.</li></ul><b>Strateji:</b> Hainlerin büyük bir hareket yapacağını sezdiğinde (örn. kritik bir masum hedefteyse) kullan. İki tur birden ölüm olmazsa köy avantaj kazanır. Hakkı çok erken kullanma.'},
  ENGIZITOR:{e:'⚖️',n:'Engizitör',t:'masum',
    d:'Tartışma fazında 1 kez anında infaz yapabilir. Masum infaz edersen kendin ölürsün.',
    full:'<b>Ne yapar?</b> Oylama beklemeden, tartışma sırasında tek başına bir kişiyi anında infaz edebilirsin. Mahkeme kararı vermene gerek yok — tek yetkisi senin.<br><br><b>Nasıl kullanılır?</b> Tartışma fazında özel "Engizitör İnfazı" butonu belirir. Hedefi seç, onayla — hemen etkisi olur.<br><br><b>Önemli kurallar:</b><ul><li>Hain veya Tarafsız infaz edersen: hedef ölür, sen kurtulursun.</li><li>Masum infaz edersen: hedef ölür VE sen de anında ölürsün. Hatalı kullanımın bedeli büyük.</li><li>Oyun boyunca 1 kez kullanılabilir. Harcandıktan sonra gündüz aksiyonun olmaz.</li></ul><b>Strateji:</b> Rolünü uzun süre gizle. Kesin hain olduğunu bildiğin ama köyün oylama yapamayacağı durumda sürpriz el açarak infaz gerçekleştir.'},
  PUSUCU:{e:'🪤',n:'Pusucu',t:'hain',
    d:'Gece evine pusu kurar. O gece evine gelen biri rastgele ölür. Hain takım arkadaşları da risk altında.',
    full:'<b>Ne yapar?</b> Hain takımında beklenmedik tuzak. O geceyi seçersen evine gelen herhangi bir oyuncu (hain olsun masum olsun) rastgele ölür.<br><br><b>Nasıl kullanılır?</b> Gece ekranında "Pusu Kur" butonuna bas. Evine kim gelirse gelsin tuzak aktifleşir — seçim şans eseri.<br><br><b>Önemli kurallar:</b><ul><li>Hain kill oylamasına katılırsın; hem kill hem pusu aynı gecede olabilir.</li><li>Hain takım arkadaşın seni "ziyaret" etmeye giderse pusuya düşebilir — dikkat!</li><li>Gazeteci/Takipçi/Polis seni takip ederse ya da hedef alırsa pusuya düşer.</li><li>Pusu birden çok kişi gelirse sadece biri rastgele seçilip ölür.</li></ul><b>Strateji:</b> Polis veya Takipçi rolünün seni takip ettiğini düşünüyorsan o gece pusu kur — kendi ziyaretçin tuzağa düşer. Hain arkadaşlara "Bu gece ziyarete gelmeyin" haberini ilet.'},
  HACKER:{e:'💻',n:'Hacker',t:'hain',
    d:'2 kullanım hakkı. Bilgi rolünü hacklemeyi başarırsa o gece TÜM bilgi rolleri etkilenir; herkes "ağ saldırısı" duyurusu alır.',
    full:'<b>Ne yapar?</b> Hain takımının elektronik savaş uzmanı. Bir bilgi rolünü hedef alırsın. Başarılıysa sadece o kişi değil, o gece aksiyon yapan TÜM bilgi rolleri etkilenir — raporları silinir.<br><br><b>Nasıl kullanılır?</b> Gece hedef seç (bilgi rolü olması gerekir), onayla. 2 kullanım hakkın var ve üst üste aynı kişiyi hedef alamazsın.<br><br><b>Etkilenen roller:</b> Polis, Savcı, Psikolog, Gazeteci, Takipçi, Dedikoducu, Ajan, Çilingir, Doktor, Gazi.<br><br><b>Önemli kurallar:</b><ul><li>Hedef o gece aksiyon yapmamışsa hack etkisiz kalır (ağ boşta).</li><li>Hedef bilgi rolü değilse hack etkisiz kalır (hak harcanır).</li><li>Başarılıysa o gece aksiyon yapan TÜM bilgi rolleri raporlarını göremez; herkese sabah "ağ saldırısı gerçekleşti" duyurusu gider.</li><li>Kurban\'ı hedef aldıysan ve kurban o gece öldürüldüyse vasiyet "bilgi erişimi engellendi" diye iptal edilir.</li><li>Üst üste aynı kişiyi hedef alamazsın.</li><li>2 hak dolduktan sonra gece aksiyonun olmaz.</li></ul><b>Strateji:</b> Savcı veya Doktor gibi kritik rollerin en değerli hamle yapacakları geceyi seç. Ağ saldırısının tüm bilgi akışını kesmesi, masumların o geceyi kör geçirmesi anlamına gelir.'},
  VEBA:{e:'☠️',n:'Veba',t:'tarafsız',
    d:'Her gece birine hastalık bulaştırır. Hayattaki herkes hastalanınca tüm hastalar ölür, Veba TEK BAŞINA kazanır.',
    full:'<b>Ne yapar?</b> Bağımsız biyolojik tehdit. Her gece bir kişiye sessizce hastalık bulaştırırsın. Hayattaki tüm oyuncular hastalandığında salgın başlar ve herkesi öldürerek tek başına kazanırsın.<br><br><b>Nasıl kullanılır?</b> Gece hedef seç, onayla. Hastalanan kişi fark etmez. Her gece yeni biri hastalanır.<br><br><b>Önemli kurallar:</b><ul><li>Kazanmak için hayattaki HERKES (sen hariç) hastalanmış olmalı.</li><li>Hastalanmış biri ölürse (gece veya gündüz) toplam hastalanma sayısı düşmez ama hayattaki kişi listesi azalır — bu sana avantaj sağlar.</li><li>Sadece sen kazanırsın; masumlar, hainler, tarafsızlar hepsi kaybeder.</li></ul><b>Strateji:</b> Tamamen gizli kal — hiçbir şey yapılmıyormuş gibi davran. Köy seni fark etmeden tüm oyuncuları hastalamayı başar. Hainlerle savaşan, masumlarla çatışan süreci seyret ve sabırla hastalığı yay.'},
  DELI:{e:'🤡',n:'Deli',t:'deli',
    d:'Bir masum rolün sahte kopyasıdır. Tüm aksiyonları etkisiz, raporları sahte. Kendisi bunun farkında değildir.',
    full:'<b>Ne yapar?</b> Oyun başında bazı oyunculara "Deli" atanır. O oyuncu ekranında başka bir rolü (örn. Doktor, Savcı) görür. Aksiyonlarını sanki o rolmüş gibi yapar — ama hiçbirinin gerçek etkisi olmaz.<br><br><b>Nasıl kullanılır?</b> Oyuncu kendini deli olduğunu bilemez; göründüğü rolü oynar. Dışarıdan Psikolog "deli" çıkarabilir.<br><br><b>Önemli kurallar:</b><ul><li>Sahte rol raporları: koruduysa bile kurtarma ya da "saldırı olmadı" duyurur — ama gerçekte koruma uygulanmamıştır.</li><li>Psikolog tespit eder ve sahte bilgiden kaçınabilir.</li><li>Deli, sahte rolünü gerçek sanan iyi niyetli bir oyuncudur; köy için tehlike kasıtsız bilgi kirliliğidir.</li></ul><b>Strateji (köy için):</b> Psikolog\'un tespitini ciddiye al. "Deli" olduğu anlaşılan oyuncunun verdiği bilgilere güvenme.'},
  VAMPIR:{e:'🧛',n:'Vampir',t:'hain',d:'Gece öldürür, sabotaj pasifi var.',
    full:'Gece birini öldürebilirsin. Öldürsen de öldürmesen de ertesi gün sabotaj başlatır. Sabotaj: 10 saniye içinde başlamazsan (masum/tarafsız) ölürsün. Hainler sabotaja girmezseniz de ölmez.'}
};

// DEMO ROLLER (İsteğe bağlı oyun havuzuna eklenebilir)
const RDEF_DEMO={
  INFAZCI:{e:'🔨',n:'İnfazcı (Demo)',t:'masum',
    d:'Her gece birini zindana kapatır. Zindan: yetenek kullanamaz, saldırılamaz. Oyun boyunca 1 kez idam edebilir.',
    full:'<b>Ne yapar?</b> Her gece bir kişiyi zindana kapatırsın. Ek olarak oyun boyunca 1 kez o zindandaki kişiyi doğrudan infaz edebilirsin.<br><br><b>Nasıl kullanılır?</b> Gece hedef seç, onayla. Ayrı bir "İdam Et" butonu çıkar — kullanırsan o kişi sabah raporunda ölü görünür.<br><br><b>Önemli kurallar:</b><ul><li>Zindandaki: yetenek kullanamaz ve dışarıdan saldırılamaz (korunur).</li><li>İdam hakkı tüm oyun boyunca sadece 1 kez. Harcandıktan sonra sadece zindan kalır.</li><li>Zindan etkisi bir gecelik; ertesi gece aynı kişiyi tekrar zindana atman gerekir.</li></ul>'},
  GARDIYAN:{e:'🛡️',n:'Gardiyan (Demo)',t:'masum',
    d:'Oyun boyunca 1 kez sokağa çıkma yasağı ilan eder. O gece hiçbir ölüm gerçekleşmez.',
    full:'<b>Ne yapar?</b> O geceyi tamamen koruma altına alırsın. Hain saldırısı, Seri Katil, Şerif, Bomba dahil HİÇBİR ölüm o gece gerçekleşemez.<br><br><b>Nasıl kullanılır?</b> Gece aksiyonu ekranında "Sokağa Çıkma Yasağı" butonuna bas. Bir kez kullandıktan sonra bu yetenek bir daha gelmez.<br><br><b>Önemli kurallar:</b><ul><li>Ertesi sabah herkes yasağın uygulandığını öğrenir (kimin uyguladığını değil).</li><li>Seri Katil bile bu gece öldüremez.</li></ul>'},
  ENGIZITOR:{e:'⚖️',n:'Engizitör (Demo)',t:'masum',
    d:'Tartışma fazında 1 kez anında infaz yapabilir. Masum infaz edersen kendin ölürsün.',
    full:'<b>Ne yapar?</b> Oylama beklemeden, tartışma sırasında tek başına bir kişiyi anında infaz edebilirsin.<br><br><b>Nasıl kullanılır?</b> Tartışma fazında özel "Engizitör İnfazı" butonu belirir. Hedefi seç, onayla — hemen etkisi olur.<br><br><b>Önemli kurallar:</b><ul><li>Hain veya Tarafsız infaz edersen: hedef ölür, sen kurtulursun.</li><li>Masum infaz edersen: hedef ölür VE sen de anında ölürsün.</li><li>Oyun boyunca 1 kez kullanılabilir.</li></ul>'},
  BUZCU:{e:'❄️',n:'Buzcu (Demo)',t:'masum',
    d:'Oyun boyunca 2 kez birini karantinaya alır. Karantinadaki: oylayamaz, oylanamaz, saldırıdan etkilenmez, yetenek kullanamaz.',
    full:'<b>Ne yapar?</b> Seçtiğin oyuncuyu bir sonraki gün boyunca karantinaya alırsın. Karantinadaki kişi hem tamamen izole edilir hem saldırıdan korunur.<br><br><b>Nasıl kullanılır?</b> Gece hedef seç, onayla. 2 kullanım hakkın var (kalan sayı ekranda görünür).<br><br><b>Önemli kurallar:</b><ul><li>Karantinadaki: oylamaya katılamaz, kendisine oy verilemez, gece saldırısından etkilenmez, yetenek kullanamaz.</li><li>2 hak dolunca gece aksiyonun olmaz.</li></ul>'},
  KOSTEBEK:{e:'🦔',n:'Köstebek (Demo)',t:'hain',
    d:'Her gece birinin rolünü 2 seçenek arasında görür (biri kesinlikle doğru). Hain takımın bilgi toplayıcısı.',
    full:'<b>Ne yapar?</b> Her gece bir kişiyi hain gözüyle incelersin. O kişinin gerçek rolü dahil 2 seçenek alırsın — biri kesinlikle doğru.<br><br><b>Nasıl kullanılır?</b> Hedef seç, onayla. Sabah raporunda 2 olası rol gösterilir; doğru olanı Savcı gibi kesin değil, tahmin et. Hain sohbetinde paylaşıp Suikastçıya hedef gösterebilirsin.<br><br><b>Önemli kurallar:</b><ul><li>Her gece kullanılabilir — sınırsız.</li><li>Hacker seni hacklerse bilgiyi göremezsin.</li><li>Deli Köstebek: her iki seçenek de yanlış olabilir.</li></ul>'},
  PUSUCU:{e:'🪤',n:'Pusucu (Demo)',t:'hain',
    d:'Gece evine pusu kurar. O gece evine gelen biri rastgele ölür. Hain takım arkadaşları da risk altında.',
    full:'<b>Ne yapar?</b> Hain takımında beklenmedik tuzak. O geceyi seçersen evine gelen herhangi bir oyuncu (hain olsun masum olsun) rastgele ölür.<br><br><b>Nasıl kullanılır?</b> Gece ekranında "Pusu Kur" butonuna bas. Evine kim gelirse gelsin tuzak aktifleşir.<br><br><b>Önemli kurallar:</b><ul><li>Hain kill oylamasına katılırsın; hem kill hem pusu aynı gecede olabilir.</li><li>Hain takım arkadaşın seni "ziyaret" etmeye giderse pusuya düşebilir — dikkat!</li><li>Gazeteci/Takipçi/Polis seni hedef alırsa pusuya düşer.</li></ul>'},
  VEBA:{e:'☠️',n:'Veba (Demo)',t:'tarafsız',
    d:'Her gece birine hastalık bulaştırır. Hayattaki herkes hastalanınca tüm hastalar ölür, Veba TEK BAŞINA kazanır.',
    full:'<b>Ne yapar?</b> Bağımsız biyolojik tehdit. Her gece bir kişiye sessizce hastalık bulaştırırsın. Hayattaki tüm oyuncular hastalandığında salgın başlar ve herkesi öldürerek tek başına kazanırsın.<br><br><b>Nasıl kullanılır?</b> Gece hedef seç, onayla. Hastalanan kişi fark etmez.<br><br><b>Önemli kurallar:</b><ul><li>Kazanmak için hayattaki HERKES (sen hariç) hastalanmış olmalı.</li><li>Sadece sen kazanırsın; masumlar, hainler, tarafsızlar hepsi kaybeder.</li><li>Tamamen gizli kal — şüphe çekersen köy seni eleyebilir.</li></ul>'}
};

// id -> emoji+name lookup
const ID_MAP={};
Object.entries(RDEF).forEach(([k,v])=>{
  const id=k.toLowerCase();
  ID_MAP[id]={e:v.e,n:v.n,d:v.d,t:v.t};
});
function roleTeamClass(t){return t==='hain'?'hain':t==='tarafsız'?'tarafsız':'masum'}
function roleTeamOf(roleId,fallback){
  const r=RDEF[String(roleId||'').toUpperCase()];
  return roleTeamClass(r?.t||fallback);
}
const _TEAM_COLORS={hain:'#c0392b',masum:'#27ae60','tarafsız':'#2980b9',tarafsiz:'#2980b9'};
function applyTeamStyle(el,tc){
  const c=_TEAM_COLORS[tc]||'#27ae60';
  el.style.borderColor=c;
  el.style.borderWidth='2px';
  el.style.borderStyle='solid';
  el.style.background=`linear-gradient(90deg,${c}40,${c}10)`;
  el.style.boxShadow=`inset 4px 0 0 ${c}`;
  const nameEl=el.querySelector('.rs-opt-name');
  if(nameEl){nameEl.style.color=c;}
}

function show(id){
  document.querySelectorAll('.scr').forEach(s=>s.classList.remove('on'));
  Q(id).classList.add('on');
  updateGameActions();
  // Auth dışında hareketli lobi arka planı aç
  var lb=document.getElementById('LOBBY_BG');
  if(lb) lb.classList.toggle('on', id!=='S0' && id!=='S1');
  // Aurora sadece auth ekranında
  var aurora=document.getElementById('AURORA_BG');
  if(aurora) aurora.classList.toggle('on', id==='S1');
  var aiBg=document.getElementById('AI_AUTH_BG');
  if(aiBg) aiBg.classList.toggle('on', id==='S0');
  if(id==='S0') startAiAuthBg(); else stopAiAuthBg();
}
function toast(m,e){const t=Q('T');t.textContent=m;t.className='toast'+(e?' er':'');t.classList.add('sh');setTimeout(()=>t.classList.remove('sh'),3e3)}

function theme(day){document.body.classList.toggle('day',day)}
function openModal(id){Q(id).classList.add('sh')}
function closeModal(id){Q(id).classList.remove('sh')}

function avHTML(avatar, size, fallbackEmoji, extraStyle){
  const cls = size==='lg'?'av-lg':size==='md'?'av-md':size==='sm'?'av-sm':size==='xl'?'av-xl':'';
  let styleStr = '';
  if (extraStyle) styleStr += extraStyle + ';';
  if (avatar) styleStr += "background-image:url('" + avatar + "');";
  const styleAttr = styleStr ? ' style="' + styleStr + '"' : '';
  if (avatar) {
    return '<div class="av ' + cls + '"' + styleAttr + '></div>';
  }
  return '<div class="av ' + cls + '"' + styleAttr + '>' + (fallbackEmoji||'👤') + '</div>';
}

// ── MUSIC (kaldırıldı — fonksiyonlar no-op stub olarak duruyor, geri kalan kod hata vermesin) ──
function loadYouTubeAPI(){}
function tryStartMusicNow(){}
function applyMusicForCurrentScreen(){}
function shouldPlayMusic(){return false;}
function startMusic(){}
function stopMusic(){}
function toggleMusic(){}
function updateMusicUI(){}

// ── AUTH ──
function setAM(m){
  AM=m;
  Q('TL').classList.toggle('on',m==='login');
  Q('TR').classList.toggle('on',m==='register');
  Q('AB').textContent=m==='login'?'Giriş Yap':'Kayıt Ol';
  // Login/Register özel alanları göster/gizle
  var loginEl=document.getElementById('AUTH_LOGIN_EXTRAS');
  var regEl=document.getElementById('AUTH_REG_EXTRAS');
  if(loginEl) loginEl.style.display=m==='login'?'block':'none';
  if(regEl) regEl.style.display=m==='register'?'flex':'none';
  // Kart animasyonu yeniden tetikle
  var card=document.querySelector('.auth-card');
  if(card){ card.style.animation='none'; void card.offsetWidth; card.style.animation=''; }
}

// ── AURORA BAŞLAT ──
function startAiAuthBg(){
  if(window.startThreeAiAuthBg) window.startThreeAiAuthBg();
}
function stopAiAuthBg(){
  if(window.stopThreeAiAuthBg) window.stopThreeAiAuthBg();
}

(function initAurora(){
  // Yıldız alanı
  const sf = document.getElementById('STAR_FIELD');
  if(sf){
    for(var i=0;i<120;i++){
      var s=document.createElement('div');
      s.className='aurora-star';
      var x=Math.random()*100, y=Math.random()*100;
      var d=(Math.random()*3+2).toFixed(1)+'s';
      var dl=(Math.random()*6).toFixed(1)+'s';
      var op=(Math.random()*0.7+0.24).toFixed(2);
      var sz=(Math.random()*1.4+1).toFixed(1)+'px';
      s.style.cssText='left:'+x+'%;top:'+y+'%;width:'+sz+';height:'+sz+';--d:'+d+';--delay:'+dl+';--op:'+op;
      sf.appendChild(s);
    }
  }
  // Sayfa yüklenince: aurora aç (auth ekranı), lobby arka plan kapalı
  var bg=document.getElementById('AURORA_BG');
  if(bg) bg.classList.remove('on');
  var lb=document.getElementById('LOBBY_BG');
  if(lb) lb.classList.remove('on');
  var aiBg=document.getElementById('AI_AUTH_BG');
  if(aiBg) setTimeout(function(){ aiBg.classList.add('on'); startAiAuthBg(); },50);
})();
function showAuthSuccess(ico, title, sub, cb){
  const ov=Q('AUTH_SUCCESS_OV');
  Q('AUTH_SUCCESS_ICO').textContent=ico;
  Q('AUTH_SUCCESS_TXT').textContent=title;
  Q('AUTH_SUCCESS_SUB').textContent=sub;
  ov.classList.add('show');
  // ring'i yeniden tetikle
  const ring=ov.querySelector('.auth-success-ring');
  ring.style.animation='none'; void ring.offsetWidth; ring.style.animation='';
  ov.querySelector('.auth-success-txt').style.animation='none'; void ov.querySelector('.auth-success-txt').offsetWidth; ov.querySelector('.auth-success-txt').style.animation='';
  ov.querySelector('.auth-success-sub').style.animation='none'; void ov.querySelector('.auth-success-sub').offsetWidth; ov.querySelector('.auth-success-sub').style.animation='';
  setTimeout(()=>{ ov.classList.remove('show'); if(cb) cb(); }, 1600);
}
function doAuth(){
  const u=Q('AU').value.trim(),p=Q('AP').value;
  if(!u||!p)return toast('Alanları doldur!',1);
  if(AM==='register'){
    const t1=document.getElementById('TERMS_1'),t2=document.getElementById('TERMS_2'),t3=document.getElementById('TERMS_3');
    if(!t1?.checked||!t2?.checked||!t3?.checked) return toast('Kayıt için tüm sözleşmeleri onaylamalısın!',1);
  }
  const rememberMe = AM==='login' && Q('REMEMBER_ME')?.checked;
  io2.emit(AM==='login'?'auth:login':'auth:register',{username:u,password:p,rememberMe},r=>{
    if(r.success){
      user=r.user;
      if(r.token){
        try{ localStorage.setItem('azap_token', r.token); }catch{}
      }
      updateUserUI();
      updateRoleInfoBtn();
      const isReg = AM==='register';
      showAuthSuccess(
        isReg ? '🎉' : '✓',
        isReg ? 'Hesap Oluşturuldu!' : 'Giriş Başarılı',
        'Hoş geldin, ' + user.username + '!',
        ()=>{ show('S1'); setupDraggableButtons(); checkRejoin(); }
      );
    }else toast(r.error,1);
  });
}

// Müzik fonksiyonu artık no-op
function tryStartMusicNow(){}

// ── REJOIN SİSTEMİ ──
function checkRejoin(){
  var saved=null;
  try{saved=JSON.parse(localStorage.getItem('azap_last_room'));}catch{}
  if(!saved||!saved.code)return;
  io2.emit('room:checkRejoin',{code:saved.code},function(r){
    if(!r||!r.ok){clearLastRoom();return;}
    // Oda hâlâ aktif — teklif göster
    Q('REJOIN_CODE').textContent=r.code;
    Q('REJOIN_UNAME').textContent=user?.username||'';
    // Modal alt yazısını faza göre güncelle
    var sub=Q('REJOIN_MODAL').querySelector('.rejoin-sub:last-of-type');
    if(sub) sub.textContent=r.isActive?'Oyun devam ediyor! Geri dönmek ister misin?':'Lobiye geri dönmek istiyor musun?';
    Q('REJOIN_MODAL').classList.add('on');
  });
}
function doRejoin(){
  _intentionalLeave=false;
  Q('REJOIN_MODAL').classList.remove('on');
  var saved=null;
  try{saved=JSON.parse(localStorage.getItem('azap_last_room'));}catch{}
  if(!saved)return;
  var name=saved.name||Q('IN').value.trim()||user?.username||'Oyuncu';
  io2.emit('room:rejoin',{code:saved.code,playerName:name},function(r){
    if(r.ok){
      me=io2.id;
      Q('LC').textContent=r.code;
      if(r.active){
        // Aktif oyun — state gelince ilgili ekrana otomatik geçecek
        toast('Oyuna geri bağlanıldı!');
        io2.emit('state:request');
        io2.emit('priv:request');
      } else {
        show('S2');
        applyMusicForCurrentScreen();
        toast('Lobiye geri döndün!');
      }
    } else {
      clearLastRoom();
      toast(r.err||'Odaya dönülemedi.',1);
    }
  });
}
function dismissRejoin(){
  Q('REJOIN_MODAL').classList.remove('on');
  clearLastRoom();
}

// Otomatik rejoin - sayfa yenilendiğinde veya reconnect olduğunda sessizce dene
function tryAutoRejoin(){
  // Kasıtlı çıkış yapıldıysa (Ana Menü, leaveRoom) kesinlikle rejoin yapma
  if(_intentionalLeave){
    console.log('[tryAutoRejoin] Kasıtlı çıkış flag aktif, rejoin yapılmıyor');
    return;
  }
  console.log('[tryAutoRejoin] Başladı');
  // Son 30 saniye içinde kullanıcı bilerek çıktıysa rejoin yapma (sayfa yenileme sonrası)
  var leftTime=null;
  try{leftTime=parseInt(localStorage.getItem('azap_left_time'),10);}catch{}
  if(leftTime && (Date.now()-leftTime)<30000){
    console.log('[tryAutoRejoin] Son 30sn içinde çıkılmış, rejoin yapılmıyor');
    return;
  }
  // Ölü veya izleyici durumunda rejoin yapma (kullanıcı bilerek çıkmış)
  if(isDead||isSpec){
    console.log('[tryAutoRejoin] Ölü/izleyici durumunda, rejoin yapılmıyor');
    clearLastRoom();
    return;
  }
  var saved=null;
  try{saved=JSON.parse(localStorage.getItem('azap_last_room'));}catch(e){console.log('[tryAutoRejoin] localStorage hatası:',e);}
  console.log('[tryAutoRejoin] saved:',saved);
  if(!saved||!saved.code){console.log('[tryAutoRejoin] saved veya code yok, çıkılıyor');return;}
  // Rejoin modal açıkken tekrar deneme
  if(Q('REJOIN_MODAL').classList.contains('on')){console.log('[tryAutoRejoin] Modal açık, çıkılıyor');return;}
  console.log('[tryAutoRejoin] room:checkRejoin gönderiliyor, kod:',saved.code);
  io2.emit('room:checkRejoin',{code:saved.code},function(r){
    console.log('[tryAutoRejoin] room:checkRejoin cevabı:',r);
    if(!r||!r.ok){console.log('[tryAutoRejoin] checkRejoin başarısız:',r);clearLastRoom();return;}
    // Oda aktif — otomatik rejoin dene (kullanıcıya sormadan)
    if(r.isActive){
      var name=saved.name||user?.username||'Oyuncu';
      console.log('[tryAutoRejoin] Oda aktif, room:rejoin gönderiliyor, isim:',name);
      io2.emit('room:rejoin',{code:saved.code,playerName:name},function(rejoinRes){
        console.log('[tryAutoRejoin] room:rejoin cevabı:',rejoinRes);
        if(rejoinRes?.ok){
          me=io2.id;
          Q('LC').textContent=rejoinRes.code;
          toast('🎮 Oyuna geri bağlanıldı!');
          io2.emit('state:request');
          io2.emit('priv:request');
        } else {
          console.log('[tryAutoRejoin] rejoin başarısız:',rejoinRes);
          clearLastRoom();
          // Başarısızsa modal göster (manuel rejoin için)
          checkRejoin();
        }
      });
    } else {
      // Lobi durumu — otomatik rejoin dene (modal açma, kullanıcı yeniledi)
      console.log('[tryAutoRejoin] Oda lobide, otomatik rejoin deneniyor');
      var name=saved.name||user?.username||'Oyuncu';
      io2.emit('room:rejoin',{code:saved.code,playerName:name},function(rejoinRes){
        console.log('[tryAutoRejoin] lobi rejoin cevabı:',rejoinRes);
        if(rejoinRes?.ok){
          me=io2.id;
          Q('LC').textContent=rejoinRes.code;
          show('S2');
          applyMusicForCurrentScreen();
          toast('Lobiye geri döndün!');
          io2.emit('state:request');
        } else {
          clearLastRoom();
        }
      });
    }
  });
}

// Otomatik token girişi (sayfa yüklendiğinde)
function tryAutoLogin(){
  let token = null;
  try{ token = localStorage.getItem('azap_token'); }catch{}
  if(!token)return false;
  io2.emit('auth:loginByToken',{token},r=>{
    if(r?.success){
      user=r.user;
      updateUserUI();
      toast('Hoş geldin '+user.username+'!');
      setTimeout(()=>{ show('S1'); setupDraggableButtons(); tryAutoRejoin(); }, 300);
      updateRoleInfoBtn();
    } else {
      // Token geçersiz - sil
      try{ localStorage.removeItem('azap_token'); }catch{}
      // Token geçersiz olsa bile rejoin dene
      setTimeout(()=>{ tryAutoRejoin(); }, 300);
    }
  });
  return true;
}

// ── MAĞAZA ──
let _shopPackages = null;
let _shopDonationPresets = null;

async function loadShopCatalog(){
  if(_shopPackages) return;
  try{
    const r = await fetch('/api/shop/packages');
    const d = await r.json();
    _shopPackages = d.packages;
    _shopDonationPresets = d.donationPresets;
    _shopPaymentEnabled = d.paymentEnabled;
  }catch(e){
    console.error('Mağaza yüklenemedi:', e);
  }
}

function renderShopGoldPackages(){
  if(!_shopPackages) return;
  const goldPacks = Object.entries(_shopPackages).filter(([k,p])=>p.type==='coins');
  Q('SHOP_GOLD_PACKAGES').innerHTML = goldPacks.map(([id,p])=>`
    <div class="shop-pkg">
      <div class="shop-pkg-emoji">${p.emoji}</div>
      <div class="shop-pkg-info">
        <div class="shop-pkg-label">${p.label}</div>
        ${p.bonus ? `<div class="shop-pkg-bonus">🎁 +${p.bonus} bonus</div>` : ''}
      </div>
      <div class="shop-pkg-price">
        <strong>₺${p.price.toFixed(2)}</strong>
        <button class="shop-pkg-buy" onclick="shopBuy('${id}')">Satın Al</button>
      </div>
    </div>
  `).join('');
}

function renderShopPremiumPackages(){
  if(!_shopPackages) return;
  const prems = Object.entries(_shopPackages).filter(([k,p])=>p.type==='premium');
  Q('SHOP_PREMIUM_PACKAGES').innerHTML = prems.map(([id,p])=>`
    <div class="shop-pkg">
      <div class="shop-pkg-emoji">${p.emoji}</div>
      <div class="shop-pkg-info">
        <div class="shop-pkg-label">${p.label}</div>
        ${p.bonus ? `<div class="shop-pkg-bonus">✨ ${p.bonus}</div>` : ''}
      </div>
      <div class="shop-pkg-price">
        <strong>₺${p.price.toFixed(2)}</strong>
        <button class="shop-pkg-buy premium-buy" onclick="shopBuy('${id}')">Satın Al</button>
      </div>
    </div>
  `).join('');
}

function renderShopDonatePresets(){
  if(!_shopDonationPresets) return;
  Q('SHOP_DONATE_PRESETS').innerHTML = _shopDonationPresets.map(amt=>
    `<div class="donate-preset" onclick="Q('SHOP_DONATE_AMOUNT').value=${amt}">₺${amt}</div>`
  ).join('');
}

function shopSwitchTab(tab){
  document.querySelectorAll('.shop-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.shop-pane').forEach(p => {
    p.style.display = p.id === 'SHOP_PANE_'+tab ? 'block' : 'none';
  });
  if(tab === 'gold') renderShopGoldPackages();
  if(tab === 'premium') renderShopPremiumPackages();
  if(tab === 'donate') renderShopDonatePresets();
  if(tab === 'items') renderShopItems();
}

function getPaymentConsents(){
  const kvkk = Q('CHK_KVKK')?.checked;
  const mesafeliSatis = Q('CHK_MSS')?.checked;
  const caymaHakki = Q('CHK_CAYMA')?.checked;
  if(!kvkk || !mesafeliSatis || !caymaHakki){
    toast('Lütfen tüm yasal onayları (KVKK, Mesafeli Satış, Cayma Hakkı) işaretleyin.',1);
    return null;
  }
  return { kvkk, mesafeliSatis, caymaHakki };
}

async function shopBuy(packageId){
  if(!user){toast('Giriş yap!',1);return;}
  const pkg = _shopPackages?.[packageId];
  if(!pkg){toast('Paket yok',1);return;}
  const consents = getPaymentConsents();
  if(!consents) return;
  if(!confirm(`${pkg.label} satın alacaksın.\nFiyat: ₺${pkg.price.toFixed(2)}\nDevam?`))return;
  try{
    const r = await fetch('/api/payment/create',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ username: user.username, packageId, consents })
    });
    const d = await r.json();
    if(d.redirectUrl && d.formData){
      // Shopier: hidden form oluşturup POST ile yönlendir
      _submitShopierForm(d.redirectUrl, d.formData);
    } else if(d.checkoutFormContent){
      const w = window.open('','azap_pay','width=500,height=700');
      if(w){w.document.write(d.checkoutFormContent);}
      else{toast('Ödeme penceresi açılamadı. Popup engelleyiciyi kapatın.',1);}
    } else {
      toast(d.error || 'Satın alma gerçekleşmedi.',1);
    }
  }catch(e){
    toast('Satın alma gerçekleşmedi.',1);
  }
}

async function shopDonate(){
  if(!user){toast('Giriş yap!',1);return;}
  const amt = parseFloat(Q('SHOP_DONATE_AMOUNT').value);
  if(!amt || amt < 5){toast('Min 5 TL!',1);return;}
  if(amt > 5000){toast('Max 5000 TL!',1);return;}
  const consents = getPaymentConsents();
  if(!consents) return;
  if(!confirm(`₺${amt} bağış yapacaksın. ❤️\nDestek için teşekkürler!`))return;
  try{
    const r = await fetch('/api/payment/create',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ username: user.username, packageId: 'donation', donationAmount: amt, consents })
    });
    const d = await r.json();
    if(d.redirectUrl && d.formData){
      _submitShopierForm(d.redirectUrl, d.formData);
    } else if(d.checkoutFormContent){
      const w = window.open('','azap_pay','width=500,height=700');
      if(w){w.document.write(d.checkoutFormContent);}
      else{toast('Ödeme penceresi açılamadı. Popup engelleyiciyi kapatın.',1);}
    } else {
      toast(d.error || 'Bağış gerçekleşmedi.',1);
    }
  }catch(e){
    toast('Bağış gerçekleşmedi.',1);
  }
}

// Shopier redirect: hidden form POST ile yeni sekmede ödeme sayfasına yönlendir
function _submitShopierForm(url, formData){
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = url;
  form.target = '_blank'; // Yeni sekmede aç
  form.style.display = 'none';
  for(const [key, val] of Object.entries(formData)){
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = key;
    input.value = val;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
  toast('Ödeme sayfası açılıyor...');
}

function updateShopHeader(){
  if(!user) return;
  const sc=Q('SHOP_COINS');if(sc)sc.textContent = (user.coins ?? 0) + ' 💰';
  const pb=Q('SHOP_PREMIUM_BADGE');
  const pd=Q('SHOP_PREMIUM_DAYS');
  if(user.premium?.active){
    if(pb) pb.style.display='flex';
    if(pd) pd.textContent = `${user.premium.daysLeft} gün kaldı`;
  } else {
    if(pb) pb.style.display='none';
  }
}

async function openShopModal(){
  if(!user){toast('Önce giriş yap!',1);return;}
  await Promise.all([loadShopCatalog(), loadCosmeticCatalog()]);
  io2.emit('auth:stats',null,r=>{
    if(r){user=r;}
    updateShopHeader();
    openModal('MDL_SHOP');
    shopSwitchTab('gold');
  });
}

// ── KOZMETİK MAĞAZA ──
let _cosmeticCatalog = null;
let _cosmeticCatalogPromise = null;
let _shopItemCat = 'all';

async function loadCosmeticCatalog(){
  if(_cosmeticCatalog) return;
  if(_cosmeticCatalogPromise) return _cosmeticCatalogPromise;
  _cosmeticCatalogPromise = (async()=>{
  try{
    const r = await fetch('/api/shop/cosmetics');
    const d = await r.json();
    _cosmeticCatalog = d.items;
  }catch(e){ console.error('Kozmetik katalog yüklenemedi', e); }
  finally{ _cosmeticCatalogPromise = null; }
  })();
  return _cosmeticCatalogPromise;
}

function cosmeticPreviewHTML(id, item){
  if(!item) return '<span>?</span>';
  if(item.cat==='frame'){
    const p=item.preview||{};
    const durMap={legendaryShine:'3s',oceanWave:'4s',lightningStrike:'2.5s',cyberGlitch:'2s',natureBreath:'3s',laserDot:'3s',auroraPulse:'4s',matrixGlow:'2.5s',tickerPulse:'3s',donorCalm:'4s',obsidianSweep:'3.5s',smokeDrift:'4s',steelFlash:'5s',templarGlow:'3s',emperorRuby:'3.5s',crusadeShine:'4s'};
    const easeMap={legendaryShine:'linear',oceanWave:'ease',lightningStrike:'ease-in-out',cyberGlitch:'ease-in-out',natureBreath:'ease-in-out',laserDot:'linear',auroraPulse:'ease-in-out',matrixGlow:'ease-in-out',tickerPulse:'ease-in-out',donorCalm:'ease-in-out',obsidianSweep:'ease-in-out',smokeDrift:'ease-in-out',steelFlash:'ease-in-out',templarGlow:'ease-in-out',emperorRuby:'ease-in-out',crusadeShine:'linear'};
    const aDur=p.animDur||durMap[p.anim]||'1.5s';
    const aEase=p.animEase||easeMap[p.anim]||'ease-in-out';
    const animStyle=p.anim?`animation:${p.anim} ${aDur} ${aEase} infinite;`:'';
    const bgSizeStyle=p.bgSize?`background-size:${p.bgSize};`:'';
    const clsStr=p.cls?` ${p.cls}`:'';
    const ring=p.cls?frOverlaySVG(p.cls,user?.username||'Azat'):'';
    return `<div class="frame-preview-card${clsStr}" style="border:${p.border||'1px solid var(--brd)'};box-shadow:${p.shadow||'none'};background:${p.bg||'var(--bg3)'};position:relative;overflow:visible;${bgSizeStyle}${animStyle}"><span>Azat</span>${ring}</div>`;
  }
  if(item.cat==='pet'){
    const p=item.preview||{};
    const anim=p.anim||'petBounce';
    return `<div class="pet-box" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center"><span style="font-size:1.8rem;animation:${anim} 1.2s ease-in-out infinite;display:inline-block">${p.sprite||item.emoji}</span></div>`;
  }
  if(item.cat==='font'){
    const p=item.preview||{};
    const family=p.family?p.family.replace(/"/g,"'"):'inherit';
    return `<div class="font-preview-text" style="font-family:${family};font-weight:${p.weight||'400'};font-size:${p.size||'.85rem'};text-align:center">AZAP</div>`;
  }
  return `<span>${item.emoji}</span>`;
}

async function renderShopItems(){
  await loadCosmeticCatalog();
  if(!_cosmeticCatalog) return;
  const grid = Q('SHOP_ITEM_GRID');
  if(!grid) return;
  const cat = _shopItemCat || 'all';
  const search = (Q('SHOP_ITEM_SEARCH')?.value||'').toLowerCase();
  const ownedIds = new Set((user?.inventory||[]).map(it=>typeof it==='string'?it:it.id));
  let html = '';
  Object.entries(_cosmeticCatalog).forEach(([id,item])=>{
    if(cat!=='all' && item.cat!==cat) return;
    if(search && !item.name.toLowerCase().includes(search) && !item.desc.toLowerCase().includes(search)) return;
    const owned = ownedIds.has(id);
    const isExclusive = !!item.exclusive;
    const canBuy = !isExclusive && !owned && (user?.coins||0) >= item.price;
    let actionBtn;
    if(owned){
      actionBtn='<button class="ci-buy owned-btn">✓ Envanterinde</button>';
    } else if(isExclusive){
      actionBtn='<button class="ci-buy disabled" disabled style="opacity:.6;cursor:not-allowed;background:linear-gradient(135deg,rgba(233,30,99,.15),rgba(187,143,206,.15));border:1px solid rgba(233,30,99,.3);color:#ffb3d9">🔒 Özel</button>';
    } else {
      actionBtn=`<button class="ci-buy buy${canBuy?'':' disabled'}" ${canBuy?`onclick="shopBuyCosmetic('${id}')"`:'disabled style="opacity:.5;cursor:not-allowed"'}>Satın Al</button>`;
    }
    html += `<div class="ci-card${owned?' owned':''}${isExclusive?' exclusive':''}">
      <div class="ci-preview">${cosmeticPreviewHTML(id,item)}</div>
      <div class="ci-info">
        <div class="ci-name">${item.emoji} ${esc(item.name)}</div>
        <div class="ci-desc">${esc(item.desc)}</div>
        <div class="ci-meta">
          <span class="ci-rarity ${item.rarity}">${item.rarity}</span>
          ${isExclusive?'<span class="ci-price" style="color:#e91e63">⭐ Otomatik</span>':`<span class="ci-price">💰 ${item.price}</span>`}
        </div>
      </div>
      <div class="ci-actions">${actionBtn}</div>
    </div>`;
  });
  grid.innerHTML = html || '<div style="text-align:center;color:var(--dim);padding:20px;font-size:.82rem">Eşya bulunamadı.</div>';
}

function shopFilterItems(cat){
  if(cat) _shopItemCat = cat;
  document.querySelectorAll('#SHOP_ITEM_FILTER .ci-filter-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.cat===(_shopItemCat||'all'));
  });
  renderShopItems();
}

function shopBuyCosmetic(itemId){
  if(!user){toast('Giriş yap!',1);return;}
  const item = _cosmeticCatalog?.[itemId];
  if(!item){toast('Eşya bulunamadı',1);return;}
  if(!confirm(`${item.emoji} ${item.name} satın alacaksın.\nFiyat: 💰 ${item.price} altın\nDevam?`))return;
  io2.emit('shop:buyCosmetic',{itemId},r=>{
    if(r?.ok){
      toast(`✅ ${item.emoji} ${item.name} satın alındı!`);
      user.coins = r.coins;
      user.inventory = r.inventory;
      updateUserUI();
      updateShopHeader();
      renderShopItems();
    } else {
      toast(r?.err || 'Satın alma gerçekleşmedi.',1);
    }
  });
}

// ── ENVANTER ──
let _invCat = 'all';

function openInventoryModal(){
  if(!user){toast('Giriş yap!',1);return;}
  io2.emit('auth:stats',null,r=>{
    if(!r)return;
    user=r;
    openModal('MDL_INVENTORY');
    renderInventory();
  });
}

function invFilter(cat){
  if(cat) _invCat = cat;
  document.querySelectorAll('#INV_FILTER .ci-filter-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.cat===(_invCat||'all'));
  });
  renderInventory();
}

function equippedFromInventory(items){
  const equipped = {};
  (items||[]).forEach(it=>{
    const obj = typeof it==='string'?{id:it,equipped:false}:it;
    if(!obj?.equipped) return;
    const info = _cosmeticCatalog?.[obj.id];
    const cat = info?.cat || obj.id.split('_')[0];
    equipped[cat] = obj.id;
  });
  return equipped;
}

function renderInventoryPreview(items){
  const box = Q('INV_EQUIPPED_PREVIEW');
  if(!box) return;
  const equipped = equippedFromInventory(items);
  const fw = cosmeticFrameWrap(equipped, true);
  const petItem = equipped.pet ? _cosmeticCatalog?.[equipped.pet] : null;
  const fontItem = equipped.font ? _cosmeticCatalog?.[equipped.font] : null;
  const petPreview = petItem?.preview || {};
  const fontPreview = fontItem?.preview || {};
  const fontFamily = fontPreview.family ? fontPreview.family.replace(/"/g,"'") : 'inherit';
  let avatar = avHTML(user?.avatar,'lg','👤');
  if(fw){
    const dur=fw.animDur||'2s',ease=fw.animEase||'ease-in-out',cls=fw.cls?` ${fw.cls}`:'',ring=fw.cls?frOverlaySVG(fw.cls,user?.username):'';
    avatar = `<div class="fr-wrap${cls}" style="display:inline-flex;border:${fw.border};box-shadow:${fw.shadow};background:${fw.bg};border-radius:13px;padding:5px;position:relative;overflow:visible;${fw.anim?`animation:${fw.anim} ${dur} ${ease} infinite`:''}">${avatar}${ring}</div>`;
  }
  const pet = petItem ? `<span class="inv-preview-pet" style="animation:${petPreview.anim||'catIdle'} 3s ease-in-out infinite">${petPreview.sprite||petItem.emoji}</span>` : '';
  const activeNames = ['frame','pet','font'].map(cat=>equipped[cat] ? _cosmeticCatalog?.[equipped[cat]]?.name : null).filter(Boolean);
  box.innerHTML = `<div class="inv-preview-avatar">${avatar}${pet}</div>
    <div class="inv-preview-text">
      <div class="inv-preview-name" style="font-family:${fontFamily};font-weight:${fontPreview.weight||'700'};font-size:${fontPreview.size||'.84rem'}">${esc(user?.username||'Profil')}</div>
      <div class="inv-preview-hint">${activeNames.length ? activeNames.map(esc).join(' • ') : 'Kullandığın frame, pet ve yazı tipi burada önizlenir.'}</div>
    </div>`;
}

async function renderInventory(){
  await loadCosmeticCatalog();
  const inv = Q('PROF_INVENTORY');
  if(!inv) return;
  // Önceki içeriği temizle (üst üste binme sorununu önlemek için)
  inv.innerHTML = '';
  const items = (user?.inventory||[]).map(it=>typeof it==='string'?{id:it,equipped:false}:it);
  renderInventoryPreview(items);
  const cat = _invCat || 'all';
  const search = (Q('INV_SEARCH')?.value||'').toLowerCase();
  const filtered = items.filter(it=>{
    const info = _cosmeticCatalog?.[it.id];
    if(!info) return false;
    if(cat!=='all' && info.cat!==cat) return false;
    if(search && !info.name.toLowerCase().includes(search) && !info.desc.toLowerCase().includes(search)) return false;
    return true;
  });
  if(filtered.length===0){
    inv.innerHTML='<div style="color:var(--dim);text-align:center;padding:12px;font-size:.78rem">'+
      (items.length===0?'Henüz eşyan yok. Mağazadan satın alabilirsin.':'Bu filtrede eşya yok.')+'</div>';
    return;
  }
  inv.innerHTML = filtered.map(it=>{
    const info = _cosmeticCatalog?.[it.id] || {emoji:'📦',name:it.id,desc:'',cat:'?',rarity:'rare'};
    const eq = !!it.equipped;
    return `<div class="ci-card${eq?' owned':''}">
      <div class="ci-preview">${cosmeticPreviewHTML(it.id,info)}</div>
      <div class="ci-info">
        <div class="ci-name">${info.emoji} ${esc(info.name)}</div>
        <div class="ci-desc">${esc(info.desc)}</div>
        <div class="ci-meta"><span class="ci-rarity ${info.rarity}">${info.rarity}</span>${eq?'<span style="color:var(--safe);font-size:.68rem;font-weight:600">AKTİF</span>':''}</div>
      </div>
      <div class="ci-actions">
        <button class="ci-buy ${eq?'unequip':'equip'}" onclick="toggleEquipItem('${esc(it.id)}',${!eq})">${eq?'Kaldır':'Kullan'}</button>
      </div>
    </div>`;
  }).join('');
}

function toggleEquipItem(itemId, equipped){
  io2.emit('inventory:equip', { itemId, equipped }, r => {
    if(r?.ok){
      toast(equipped ? '✓ Eşya aktif edildi' : 'Eşya pasifleştirildi');
      // Server'dan dönen güncel envanteri hemen uygula (kategori otomatik kaldırma için)
      if(r.inventory && user){
        user.inventory = r.inventory;
        user.equipped = r.equipped || equippedFromInventory(r.inventory);
      }
      updateUserUI();
      renderInventory(); // Sadece envanteri yenile, tüm profili değil
    } else {
      toast(r?.err || 'Hata!', 1);
    }
  });
}

// ── BAHİS ──
function _doBet(amt){
  io2.emit('bet:place', {amount: amt}, r => {
    if(r?.ok){
      toast(`💰 ${amt} altın yatırıldı!`);
      Q('MY_BET').textContent = amt;
      Q('BET_AMOUNT').value = '';
      Q('BET_CANCEL_BTN').style.display = 'block';
      if(user) user.coins = r.coins;
      const bmc=Q('BET_MY_COINS'); if(bmc && user) bmc.textContent='💰 ' + (user.coins||0);
    } else {
      toast(r?.err || 'Bahis başarısız.',1);
    }
  });
}
function placeBet(){
  const amt = parseInt(Q('BET_AMOUNT').value);
  if(!amt || amt < 5){toast('Min 5 coin!',1);return;}
  _doBet(amt);
}
function allIn(){
  const coins = user?.coins || 0;
  if(coins < 5){toast('Yetersiz altın!',1);return;}
  if(!confirm(`Tüm ${coins} altınını yatırmak istediğine emin misin?`))return;
  _doBet(coins);
}

function cancelBet(){
  if(!confirm('Bahsi geri çekmek istediğine emin misin?'))return;
  io2.emit('bet:cancel', null, r => {
    if(r?.ok){
      toast('Bahis iade edildi.');
      Q('MY_BET').textContent = '0';
      Q('BET_CANCEL_BTN').style.display = 'none';
      if(r.coins != null && user) { user.coins = r.coins; const bmc=Q('BET_MY_COINS'); if(bmc) bmc.textContent='💰 ' + user.coins; }
    }
  });
}

// betUpdate event handler — tüm odadaki bahis durumu
io2.on('betUpdate', d => {
  Q('BET_POOL').textContent = d.total || 0;
  // Kim ne kadar koymuş listesi
  const list = Q('BET_LIST');
  const entries = Object.entries(d.bets || {});
  if(entries.length === 0){
    list.innerHTML = '<em>Henüz bahis yok.</em>';
  } else {
    list.innerHTML = entries.sort((a,b)=>b[1]-a[1]).map(([uname, amt]) =>
      `<span style="display:inline-block;margin:2px 4px;padding:2px 6px;background:rgba(255,215,0,.1);border-radius:3px"><strong>${uname}</strong>: ${amt}</span>`
    ).join('');
  }
  // Kendi bahsim
  const myUname = user?.username;
  if(myUname && d.bets[myUname]){
    Q('MY_BET').textContent = d.bets[myUname];
    Q('BET_CANCEL_BTN').style.display = 'block';
  } else {
    Q('MY_BET').textContent = '0';
    Q('BET_CANCEL_BTN').style.display = 'none';
  }
});

// Çıkış yap
function doLogout(){
  if(!confirm('Çıkış yapmak istediğine emin misin?'))return;
  let token = null;
  try{ token = localStorage.getItem('azap_token'); localStorage.removeItem('azap_token'); }catch{}
  io2.emit('auth:logout',{token},()=>{
    user=null;
    closeModal('MDL_PROFILE');
    toast('Çıkış yapıldı.');
    // Sayfayı yeniden yükle - tüm state temizlensin
    setTimeout(()=>location.reload(),500);
  });
}
function updateUserUI(){
  if(!user)return;
  Q('WN').textContent=user.username;
  // Ana menüde avatar + frame (köşeli 13px)
  const fw = cosmeticFrameWrap(user.equipped, true);
  let avatarHtml = avHTML(user.avatar,'md','👤');
  if(fw){
    const dur=fw.animDur||'2s',ease=fw.animEase||'ease-in-out',cls=fw.cls?` ${fw.cls}`:'',ring=fw.cls?frOverlaySVG(fw.cls,user.username):'';
    avatarHtml = `<div class="fr-wrap${cls}" style="display:inline-flex;border:${fw.border};box-shadow:${fw.shadow};background:${fw.bg};border-radius:13px;padding:4px;position:relative;overflow:visible;${fw.anim?`animation:${fw.anim} ${dur} ${ease} infinite`:''}">${avatarHtml}${ring}</div>`;
  }
  Q('WAV_SLOT').innerHTML=avatarHtml;
  // Coin göster
  const tc = Q('TOP_COINS');
  if(tc){
    tc.classList.add('on');
    Q('TOP_COIN_VAL').textContent = user.coins ?? 0;
  }
  const bmc=Q('BET_MY_COINS');
  if(bmc) bmc.textContent='💰 ' + (user.coins ?? 0);
}

function openProfile(){
  io2.emit('auth:stats',null,r=>{
    if(!r)return;user=r;
    Q('PROF_NAME').textContent=r.username;
    // Profil modalında avatar + frame (köşeli 13px) - doğrudan avatar üzerinde
    const fw = cosmeticFrameWrap(r.equipped, true);
    const avWrap = Q('PROF_AV_WRAP');
    if(avWrap){
      let profAvatar = avHTML(r.avatar,'lg','👤');
      if(fw){
        const dur=fw.animDur||'2s',ease=fw.animEase||'ease-in-out',cls=fw.cls?` ${fw.cls}`:'',ring=fw.cls?frOverlaySVG(fw.cls,r.username):'';
        profAvatar = `<div class="fr-wrap${cls}" style="display:inline-flex;border:${fw.border};box-shadow:${fw.shadow};background:${fw.bg};border-radius:13px;padding:5px;position:relative;overflow:visible;${fw.anim?`animation:${fw.anim} ${dur} ${ease} infinite`:''}">${profAvatar}${ring}</div>`;
      }
      avWrap.innerHTML = `${profAvatar.replace('class="av av-lg"','class="av av-lg" id="PROF_AV"')}
<div style="display:flex;gap:6px;margin-top:8px;justify-content:center;flex-wrap:wrap">
  <label style="display:inline-flex;align-items:center;gap:4px;font-size:.7rem;padding:5px 12px;cursor:pointer;border:1px solid var(--brd);color:var(--hi);background:var(--bg2);border-radius:20px">📷 Yükle<input type="file" id="AV_UPLOAD" accept="image/*,image/gif" onchange="uploadAvatar()" style="display:none"></label>
  <button style="display:inline-flex;align-items:center;gap:4px;font-size:.7rem;padding:5px 12px;border:1px solid #bb8fce;color:#bb8fce;background:rgba(187,143,206,.08);border-radius:20px;cursor:pointer" onclick="openGiphy()">🎞️ Giphy</button>
  ${r.avatar ? `<button style="display:inline-flex;align-items:center;gap:4px;font-size:.7rem;padding:5px 12px;border:1px solid var(--brd);color:var(--hi);background:var(--bg2);border-radius:20px;cursor:pointer" onclick="adjustAvatar()">✂️ Ayarla</button>` : ''}
</div>`;
    }
    Q('MOD_SP').textContent=r.stats.played;
    Q('MOD_SW').textContent=r.stats.won;
    Q('MOD_SL').textContent=r.stats.lost;
    Q('MOD_MV').textContent=r.stats.mvp||0;
    Q('MOD_COINS').textContent=r.coins??0;
    // Premium gösterimi
    if(r.premium?.active){
      Q('MOD_PREMIUM_ROW').style.display='flex';
      Q('MOD_PREMIUM').textContent = `${r.premium.daysLeft} gün`;
    } else {
      Q('MOD_PREMIUM_ROW').style.display='none';
    }
    // Bağış gösterimi
    if(r.totalDonated > 0){
      Q('MOD_DONATED_ROW').style.display='flex';
      Q('MOD_DONATED').textContent = `₺${r.totalDonated.toFixed(0)}`;
    } else {
      Q('MOD_DONATED_ROW').style.display='none';
    }
    // Envanter render (yeni kozmetik UI)
    renderInventory();
    // Kozmetik ayar checkbox'ını mevcut değere ayarla
    const hcBox=Q('HIDE_COSMETICS');if(hcBox)hcBox.checked=_hideOtherCosmetics;
    openModal('MDL_PROFILE');
  });
}

function changePass(){
  const o=Q('OLD_PW').value,n=Q('NEW_PW').value;
  if(!o||!n)return toast('Alanları doldur!',1);
  io2.emit('auth:changePassword',{oldPass:o,newPass:n},r=>{
    if(r.success){toast('Şifre güncellendi!');Q('OLD_PW').value='';Q('NEW_PW').value='';}
    else toast(r.error,1);
  });
}

// ── AVATAR KIRPMA ──
let _cropImg=null, _cropX=0, _cropY=0, _cropScale=1, _cropDragging=false, _cropStartX=0, _cropStartY=0;
const CROP_SIZE=280;

function uploadAvatar(){
  const f=Q('AV_UPLOAD').files[0];if(!f)return;
  const isGif = f.type === 'image/gif' || /\.gif$/i.test(f.name||'');
  // GIF için max 1.5MB - üst sınır
  if(isGif && f.size > 1_500_000) return toast('GIF çok büyük (max 1.5MB)',1);
  const r=new FileReader();
  r.onload=()=>{
    if(isGif){
      // GIF'i kırpmadan doğrudan kaydet (animasyon korunsun)
      toast('GIF kaydediliyor...');
      io2.emit('auth:setAvatar',{avatar:r.result},r2=>{
        if(r2.success){
          user.avatar=r2.avatar;
          const av=Q('PROF_AV');
          if(av){
            av.style.backgroundImage="url('"+r2.avatar+"')";
            av.textContent='';
          }
          updateUserUI();
          toast('🎞️ GIF avatar güncellendi!');
        } else toast(r2.error||'Hata!',1);
      });
      return;
    }
    const img=new Image();
    img.onload=()=>{
      _cropImg=img;
      _cropScale=1;
      // Resmi CROP_SIZE'a sığdır (en kısa kenar = CROP_SIZE)
      const ratio=Math.max(CROP_SIZE/img.width, CROP_SIZE/img.height);
      _cropScale=Math.round(ratio*100);
      Q('CROP_ZOOM').min=Math.max(50, Math.round(ratio*100));
      Q('CROP_ZOOM').max=Math.round(ratio*100*3);
      Q('CROP_ZOOM').value=_cropScale;
      _cropX=0;_cropY=0;
      cropApplyTransform();
      openModal('MDL_CROP');
      initCropDrag();
    };
    img.onerror=()=>toast('Fotoğraf okunamadı!',1);
    img.src=r.result;
  };
  r.onerror=()=>toast('Dosya okunamadı!',1);
  r.readAsDataURL(f);
}

// ── GIPHY ──
const GIPHY_PAGE = 50;       // Sayfa başına GIF
let _giphyOffset = 0;
let _giphyQuery = '';
let _giphyLoading = false;
let _giphyEnded = false;

function openGiphy(){
  if(!user) return toast('Giriş yap!',1);
  Q('GIPHY_Q').value='';
  openModal('MDL_GIPHY');
  searchGiphy(); // boş arama → trending
  // Sonsuz scroll dinleyici (1 kez bağla)
  const grid = Q('GIPHY_GRID');
  if(grid && !grid._scrollBound){
    grid._scrollBound = true;
    grid.addEventListener('scroll', () => {
      if(_giphyLoading || _giphyEnded) return;
      // Sona 200px kala bir sonraki sayfayı çek
      if(grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 200){
        loadMoreGiphy();
      }
    });
  }
}

function _giphyItemHtml(g){
  return `<div class="giphy-item" onclick="selectGiphy('${g.url.replace(/'/g,"\\'")}')" style="cursor:pointer;border:1px solid var(--brd);border-radius:8px;overflow:hidden;background:#111;display:flex;align-items:center;justify-content:center;transition:transform .15s,border-color .15s;min-height:80px" onmouseover="this.style.transform='scale(1.05)';this.style.borderColor='#bb8fce'" onmouseout="this.style.transform='';this.style.borderColor='var(--brd)'">
      <img src="${g.url}" style="width:100%;height:auto;max-height:160px;object-fit:contain" loading="lazy" alt="${(g.title||'').replace(/"/g,'')}">
    </div>`;
}

function searchGiphy(){
  _giphyQuery = Q('GIPHY_Q').value.trim();
  _giphyOffset = 0;
  _giphyEnded = false;
  const grid = Q('GIPHY_GRID');
  grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--dim);font-size:.78rem;padding:20px">⏳ Aranıyor...</div>';
  _fetchGiphyPage(true);
}

function loadMoreGiphy(){
  _fetchGiphyPage(false);
}

function _fetchGiphyPage(replace){
  if(_giphyLoading || _giphyEnded) return;
  _giphyLoading = true;
  const url = `/api/giphy/search?q=${encodeURIComponent(_giphyQuery)}&limit=${GIPHY_PAGE}&offset=${_giphyOffset}`;
  fetch(url)
    .then(r => r.json())
    .then(data => {
      const grid = Q('GIPHY_GRID');
      if(!grid) return;
      if(!data.ok){
        if(replace) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--hain);font-size:.78rem;padding:20px">Hata: Giphy yanıt vermedi.</div>';
        _giphyEnded = true;
        return;
      }
      const gifs = data.gifs || [];
      if(replace){
        if(!gifs.length){
          grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--dim);font-size:.78rem;padding:20px">Sonuç bulunamadı.</div>';
          _giphyEnded = true;
          return;
        }
        grid.innerHTML = gifs.map(_giphyItemHtml).join('');
      } else if(gifs.length){
        // Yükleme indikatörü varsa sil
        const ld = grid.querySelector('.giphy-loader'); if(ld) ld.remove();
        grid.insertAdjacentHTML('beforeend', gifs.map(_giphyItemHtml).join(''));
      }
      _giphyOffset += gifs.length;
      if(gifs.length < GIPHY_PAGE){
        _giphyEnded = true; // Daha fazla yok
      } else {
        // Loader ipucu (next sayfa için boşluk)
        grid.insertAdjacentHTML('beforeend', '<div class="giphy-loader" style="grid-column:1/-1;text-align:center;color:var(--dim);font-size:.7rem;padding:8px">Daha fazla yükleniyor...</div>');
      }
    })
    .catch(() => {
      if(replace){
        Q('GIPHY_GRID').innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--hain);font-size:.78rem;padding:20px">Hata: Giphy yanıt vermedi.</div>';
      }
      _giphyEnded = true;
    })
    .finally(() => { _giphyLoading = false; });
}
function selectGiphy(url){
  if(!url) return;
  toast('GIF ayarlanıyor...');
  io2.emit('auth:setAvatarUrl',{ url },r=>{
    if(r?.success){
      user.avatar = r.avatar;
      const av = Q('PROF_AV');
      if(av){
        av.style.backgroundImage = "url('"+r.avatar+"')";
        av.textContent = '';
      }
      updateUserUI();
      closeModal('MDL_GIPHY');
      toast('🎞️ Giphy GIF avatar olarak ayarlandı!');
    } else toast(r?.error||'Hata!',1);
  });
}

function cropApplyTransform(){
  if(!_cropImg)return;
  const el=Q('CROP_IMG');
  const s=_cropScale/100;
  const w=_cropImg.width*s, h=_cropImg.height*s;
  el.src=_cropImg.src;
  el.style.width=w+'px';el.style.height=h+'px';
  // Sınırla: resim crop alanından taşmasın
  const maxX=0, maxY=0;
  const minX=CROP_SIZE-w, minY=CROP_SIZE-h;
  _cropX=Math.min(maxX,Math.max(minX,_cropX));
  _cropY=Math.min(maxY,Math.max(minY,_cropY));
  el.style.left=_cropX+'px';el.style.top=_cropY+'px';
}

function cropZoom(v){
  const oldS=_cropScale/100;
  _cropScale=parseInt(v);
  const newS=_cropScale/100;
  // Zoom merkezi koru
  const cx=CROP_SIZE/2, cy=CROP_SIZE/2;
  _cropX=(cx-( (cx-_cropX) * newS/oldS ));
  _cropY=(cy-( (cy-_cropY) * newS/oldS ));
  cropApplyTransform();
}

function initCropDrag(){
  const area=Q('CROP_AREA');
  if(area._cropBound) return;
  area._cropBound=true;
  // Mouse
  area.addEventListener('mousedown',e=>{_cropDragging=true;_cropStartX=e.clientX-_cropX;_cropStartY=e.clientY-_cropY;e.preventDefault();});
  window.addEventListener('mousemove',e=>{if(!_cropDragging)return;_cropX=e.clientX-_cropStartX;_cropY=e.clientY-_cropStartY;cropApplyTransform();});
  window.addEventListener('mouseup',()=>{_cropDragging=false;});
  // Touch
  area.addEventListener('touchstart',e=>{if(e.touches.length!==1)return;_cropDragging=true;_cropStartX=e.touches[0].clientX-_cropX;_cropStartY=e.touches[0].clientY-_cropY;},{passive:true});
  window.addEventListener('touchmove',e=>{if(!_cropDragging||e.touches.length!==1)return;_cropX=e.touches[0].clientX-_cropStartX;_cropY=e.touches[0].clientY-_cropStartY;cropApplyTransform();},{passive:true});
  window.addEventListener('touchend',()=>{_cropDragging=false;});
}

function adjustAvatar(){
  if(!user?.avatar) return toast('Önce fotoğraf yükle!',1);
  const img=new Image();
  img.crossOrigin='anonymous';
  img.onload=()=>{
    _cropImg=img;
    const ratio=Math.max(CROP_SIZE/img.width, CROP_SIZE/img.height);
    _cropScale=Math.round(ratio*100);
    Q('CROP_ZOOM').min=Math.max(50, Math.round(ratio*100));
    Q('CROP_ZOOM').max=Math.round(ratio*100*3);
    Q('CROP_ZOOM').value=_cropScale;
    _cropX=0;_cropY=0;
    cropApplyTransform();
    openModal('MDL_CROP');
    initCropDrag();
  };
  img.onerror=()=>toast('Avatar yüklenemedi!',1);
  img.src=user.avatar;
}

function cancelCrop(){
  _cropImg=null;
  closeModal('MDL_CROP');
}

function applyCrop(){
  if(!_cropImg)return;
  toast('Kaydediliyor...');
  const canvas=document.createElement('canvas');
  canvas.width=128;canvas.height=128;
  const ctx=canvas.getContext('2d');
  const s=_cropScale/100;
  // Crop alanındaki görünümü 128x128'e çiz
  const sx=-_cropX/s, sy=-_cropY/s;
  const sSize=CROP_SIZE/s;
  ctx.drawImage(_cropImg, sx, sy, sSize, sSize, 0, 0, 128, 128);
  let quality=0.7;
  let dataUrl=canvas.toDataURL('image/jpeg',quality);
  while(dataUrl.length>270000 && quality>0.2){
    quality-=0.1;
    dataUrl=canvas.toDataURL('image/jpeg',quality);
  }
  io2.emit('auth:setAvatar',{avatar:dataUrl},r2=>{
    if(r2.success){
      user.avatar=r2.avatar;
      Q('PROF_AV').outerHTML=avHTML(r2.avatar,'lg','👤').replace('class="av av-lg"','class="av av-lg" id="PROF_AV"');
      updateUserUI();
      closeModal('MDL_CROP');
      _cropImg=null;
      toast('Profil fotoğrafı güncellendi!');
    } else toast(r2.error||'Hata!',1);
  });
}

// ── ROLLER REHBERİ ──
function renderGuide(){
  const c=Q('GUIDE_CONTENT');
  const teams=['masum','hain','tarafsız','deli'];
  const titles={masum:'🌅 Masumlar (Yeşil)',hain:'🧛 Hainler (Kırmızı)',tarafsız:'⚖️ Tarafsızlar (Mavi)',deli:'🤡 Deli (Mor)'};
  const colorVars={masum:'masum',hain:'hain',tarafsız:'tarafsiz',deli:'deli'};
  const guideDemoKeys=new Set(Object.keys(RDEF_DEMO));
  c.innerHTML=`
    <div class="guide-hero">
      <h3>AZAP Nedir?</h3>
      <p>Hepimiz biliyoruz; o eski, uzun masalı arkadaş toplantıları artık sessiz sinemaya dönüştü. Masaya oturulduğu an telefonlar çıkıyor, kafalar öne eğiliyor. Kimseye “bırak o telefonu” diyemediğimiz bir çağdayız; çünkü artık telefonlar elimiz kolumuz gibi oldu.</p>
      <p style="margin-top:6px">İşte AZAP, tam bu noktada devreye giriyor.</p>
      <p style="margin-top:6px">Biz size “telefonu elinizden bırakın” demiyoruz. Aksine, o elinizden düşürmediğiniz telefonları, arkadaş ortamınızın merkezine yerleştiriyoruz. AZAP; fiziksel olarak yan yana olup dijital olarak uzaklaştığımız o anları, tekrar kahkahaya, heyecana ve tatlı atışmalara çeviren bir sosyal dedüksiyon oyunudur.</p>
      <p style="margin-top:6px">AZAP, sadece ekran başında değil, masanın etrafındaki gözlerin içinde oynanan bir oyundur. Gizli roller dağıtılır; kiminiz köyü canı pahasına savunan bir sadık, kiminiz gece karanlığında planlar yapan bir hain, kiminiz ise sadece kendi hikayesini yazan bir yalnızdır.</p>
      <p style="margin-top:6px"><b>Telefonunuz rehberiniz, gözleriniz kanıtınız olsun:</b> Hamlenizi telefondan yapın ama yalanı arkadaşınızın gözlerinin içine bakarak söyleyin.</p>
      <p style="margin-top:6px"><b>Blöf, strateji ve kaos:</b> Konuşma yeteneğinizi konuşturun, arkadaşınızın ses tonundaki o ufacık titremeyi yakalayın ve doğru oylamayla köyün kaderini çizin.</p>
      <p style="margin-top:6px"><b>Sıkılmaya vakit yok:</b> “Ne oynayacağız?” ya da “Toplandık ama herkes telefonda” dertlerini bitiriyoruz. AZAP varken, telefonunuz artık sizi uzaklaştıran değil, masanın en eğlenceli parçası haline gelen bir oyun konsoludur.</p>
      <p style="margin-top:6px">Artık o kafalar telefona eğilecekse bile, bu bir ihanet planı ya da köyü kurtarma stratejisi için olacak. Arkadaş ortamınızı eski canlılığına, hem de teknolojiden kopmadan kavuşturmaya hazır mısınız?</p>
      <p style="margin-top:6px"><b>Çünkü AZAP’ta kimse göründüğü kişi değildir.</b></p>
    </div>
    <div class="guide-card">
      <h3>👤 Geliştirici Hakkında</h3>
      <p>Merhaba, ben Azat Akdağ.</p>
      <p style="margin-top:6px">AZAP, sadece bir oyun değil; dijital dünyanın sunduğu imkanları, fiziksel sosyal etkileşimin heyecanıyla birleştirme tutkumun bir ürünü. Bu projeyi; sosyal çıkarım türünü Türkçe dilinde, modern bir arayüzle, hızlı ve her an her yerden erişilebilen mobil uyumlu bir deneyime dönüştürmek amacıyla geliştiriyorum.</p>
      <p style="margin-top:6px">Hedefim; tek düze rollerden sıyrılıp, her oyunun farklı bir hikaye yazdığı, strateji ve rol çeşitliliğinin zirve yaptığı bir platform sunmak. Teknolojiyi bizi birbirimizden koparan bir engel olarak değil, masanın etrafındaki sohbeti ve rekabeti körükleyen bir araç olarak kullanıyoruz.</p>
      <p style="margin-top:6px">Projeye dair vizyonumu, teknik detayları veya diğer çalışmalarımı merak ederseniz; <a class="guide-link" href="https://azatakdag.com" target="_blank" rel="noopener">azatakdag.com</a> üzerinden hakkımda daha fazla bilgi alabilir, benimle doğrudan iletişim kurabilirsiniz.</p>
      <p style="margin-top:6px">Geleceğin sosyal oyun deneyimini beraber inşa etmek dileğiyle!</p>
    </div>
    <div class="guide-card">
      <h3>🎯 Oyunun Amacı</h3>
      <p>Her oyuncu oyuna gizli bir rolle başlar. Masumlar hainleri ve tehlikeli tarafsızları bulup oylamayla saf dışı bırakmaya çalışır. Hainler gece öldürerek, gündüz manipüle ederek ve bilgi akışını bozarak çoğunluğu ele geçirmeye çalışır. Tarafsız roller ise çoğu zaman kendi özel kazanma koşulunu kovalar.</p>
      <ul>
        <li><b>Masumlar:</b> Hainleri ve köye tehdit olan rolleri bulup oylamayla elemelidir.</li>
        <li><b>Hainler:</b> Masumları azaltmalı, şüpheyi dağıtmalı ve kritik rolleri susturmalıdır.</li>
        <li><b>Tarafsızlar:</b> Kendi rolünde yazan özel kazanma şartına göre oynamalıdır.</li>
      </ul>
    </div>
    <div class="guide-card">
      <h3>🚪 En Baştan Nasıl Oynanır?</h3>
      <ol>
        <li><b>Giriş / Kayıt:</b> Ana ekranda hesabın varsa giriş yap. Hesabın yoksa kayıt ol. Hesap, istatistiklerini ve altın/mağaza ilerlemeni saklamak için kullanılır.</li>
        <li><b>Profil:</b> Giriş yaptıktan sonra ismini, avatarını ve güncel durumunu kontrol edebilirsin.</li>
        <li><b>Lobi Kurma veya Katılma:</b> Oda kurarak arkadaşlarına 4 haneli kodu verebilir ya da sana verilen kodla bir lobiye katılabilirsin.</li>
        <li><b>Lobi Hazırlığı:</b> Oyuncular hazır olur. Lobi kurucusu oyuncu sayısını, rol havuzunu ve bazı oyun ayarlarını düzenleyebilir.</li>
        <li><b>Rol Dağıtımı:</b> Oyun başlayınca sana gizli rolün verilir. Rol açıklamanı dikkatle oku; takımını, yeteneğini ve kazanma şartını bilmen gerekir.</li>
        <li><b>Gece:</b> Gece aksiyonun varsa hedef seçersin. Hainler kendi aralarında konuşup saldırı veya sabotaj planlayabilir.</li>
        <li><b>Sabah / Gündüz:</b> Gece olanlar raporlanır. Gündüz tartışma başlar; herkes konuşarak şüphelerini açıklar.</li>
        <li><b>Oylama:</b> Oyuncular birini asmaya veya pas geçmeye oy verir. Çoğunluk sağlanırsa hedef elenir.</li>
        <li><b>Döngü:</b> Oyun gece-gündüz şeklinde devam eder. Bir takım veya özel rol kazanma şartını tamamladığında oyun biter.</li>
      </ol>
    </div>
    <div class="guide-card">
      <h3>🧠 Meta Nedir? Neden Yapılmamalı?</h3>
      <p><b>Meta</b>, oyunun içindeki bilgi ve davranışlar yerine oyun dışı bilgilere dayanarak karar vermektir. “Sen dün de böyle yapmıştın”, “Yan yana oturuyoruz, telefonunu gördüm”, “Sesin odadan geliyor”, “Telefonu bıraktın, demek rolün yok” veya “Gündüz telefonu bıraktın, suikastçı olamazsın” gibi çıkarımlar metadır.</p>
      <p style="margin-top:6px">AZAP özellikle yüz yüze oynanırken telefonun oyunun parçası olduğu düşünülerek tasarlandı. Bu yüzden telefonu elinizden bırakmayın; gece telefonu bırakmanız, gündüz ekrana bakmamanız ya da bir an pasif kalmanız başka oyuncular tarafından oyun dışı kanıt gibi kullanılmamalı.</p>
      <div class="guide-note">Telefonunuz oyununuzun kumandasıdır. Oyuncuların telefon tutuşunu, ekrana bakıp bakmamasını, uygulamada hangi butonu gördüğünü veya fiziksel davranışını kanıt olarak kullanmak AZAP’ın ruhuna aykırıdır. Sadece oyun içindeki verilere odaklanın: gece raporları, oylamalar, çelişkili iddialar, konuşmalar ve stratejik davranışlar.</div>
    </div>
    <div class="guide-card">
      <h3>📜 Azap Online: Temel Kurallar ve Oyun Etiği</h3>
      <p>Azap, sadece kodlarla değil, oyuncuların dürüstlüğü ve saygısıyla ayakta kalan bir deneyimdir. Herkesin keyif alması için aşağıdaki kurallara uyulması zorunludur:</p>
      <ol>
        <li><b>Kanıt ve ekran paylaşımı yasaktır:</b> Rolünü kanıtlamak için ekran görüntüsü almak, ekran paylaşmak veya arayüzdeki teknik bir detayı kullanmak kesinlikle yasaktır. İstediğin rolü iddia edebilirsin ama bunu sadece kelimelerinle ve ikna kabiliyetinle yapmalısın.</li>
        <li><b>Ölülerin sessizliği:</b> Elenen bir oyuncu, oyunun gidişatını etkileyecek hiçbir bilgiyi yaşayanlara aktaramaz. WhatsApp, Discord, fısıldama veya yanındaki arkadaşına işaret verme gibi dış kanallar oyunun tüm mantığını çöpe atar.</li>
        <li><b>İletişim ve saygı çerçevesi:</b> Azap bir tartışma oyunudur; suçlamalar, sert çıkışlar ve blöfler oyunun doğasında var. Ancak bu hiçbir zaman kişisel hakarete, küfüre, cinsiyetçi veya ırkçı söylemlere dönüşemez. Kişiyi değil, rolün oyun içindeki tutarsızlıklarını hedef almalısın.</li>
        <li><b>Oyun disiplini:</b> Kendi takımına bilerek zarar vermek, takım arkadaşlarını sebepsiz yere ifşalamak veya oyunu sabote etmek yasaktır. Oyuna girdiysen masadasın demektir; uzun süre AFK kalmak oyunun akışını bozar.</li>
        <li><b>Meta-gaming yasağı:</b> Oyun mekaniği dışındaki hiçbir bilgiyi kanıt olarak sunma. Telefon hareketleri, dış sesler, geçmiş oyun alışkanlıkları, ekran parlaması veya “telefonu bıraktı” gibi çıkarımlar oyun dışıdır.</li>
        <li><b>Adil oyun:</b> Arkadaşınla aynı odada olsan bile oyun içinde takım değilseniz birbirinizi korumayın. Gerçek bir Azat Akdağ takipçisi, en yakın arkadaşını bile köyün selameti veya kendi gizli emelleri için feda edebilecek soğukkanlılığa sahip olmalıdır.</li>
      </ol>
      <div class="guide-note">Unutma: Kurallar sadece yasaklar için değil, herkesin eşit ve adil bir ortamda “Azap” çekmeden eğlenmesi içindir. Bu kurallara uymayan oyuncuları bildirmekten çekinmeyin.</div>
      <p style="margin-top:7px">Bu kurallar dizisi oyuncuya sadece “şunu yapma” demiyor, aynı zamanda neden yapmaması gerektiğini de açıklıyor. Özellikle meta-gaming ve ölülerin sessizliği gibi başlıklar, bu tür oyunların profesyonel seviyede kalmasını sağlar.</p>
    </div>
    <div class="guide-card">
      <h3>💡 Yeni Oyuncuya Hızlı Tavsiyeler</h3>
      <ul>
        <li>Rolünü okumadan aksiyon kullanma; bazı roller tek kullanımlıktır.</li>
        <li>Masumsan bilgi saklamak bazen doğru olabilir ama kritik bilgiyi çok geç açıklamak köyü kaybettirebilir.</li>
        <li>Hainsen sadece yalan söylemek yetmez; başkalarının şüphelerini yönlendirmeyi öğrenmelisin.</li>
        <li>Tarafsızsan kazanma şartını iyi oku; her tarafsız rol aynı şekilde oynanmaz.</li>
        <li>Birini suçlarken nedenini söyle: “şüpheli” demek yerine davranış, oy, rapor veya çelişki göster.</li>
      </ul>
    </div>
    <div class="guide-card guide-demo-card">
      <div class="guide-demo-label">DEMO MOD</div>
      <h3>⬡ Matrix Krallığı</h3>
      <p style="margin-top:4px;font-size:.82rem;color:var(--dim)">Telefon gerektirmeyen, yüz yüze oynanan kart tabanlı dedüksiyon modu. 5-10 kişiyle oynanır.</p>
      <div class="guide-mk-section">
        <div class="guide-mk-title">TEMA & HIKÂYE</div>
        <p>Matrix evreni çökmektedir. Sistemi yeniden inşa etmek isteyen <strong style="color:#00bfff">Şövalyeler</strong> ile onu sonsuza dek yıkmak isteyen <strong style="color:#e74c3c">Asiler</strong> karşı karşıyadır. Asilerin arasında kimliğini gizleyen bir <strong style="color:#9b59b6">Kral</strong> vardır; yakalanırsa Şövalyeler kazanır, Yaver koltuğuna oturursa Asiler zafer ilan eder.</p>
      </div>
      <div class="guide-mk-section">
        <div class="guide-mk-title">ROL DAĞILIMI</div>
        <table class="guide-mk-table">
          <tr><th>Oyuncu</th><th>Şövalye</th><th>Asi</th><th>Kral</th><th>Not</th></tr>
          <tr><td>5</td><td>3</td><td>1</td><td>1</td><td>Kral İlk Asi'yi bilir</td></tr>
          <tr><td>6</td><td>4</td><td>1</td><td>1</td><td>Kral İlk Asi'yi bilir</td></tr>
          <tr><td>7</td><td>4</td><td>2</td><td>1</td><td>—</td></tr>
          <tr><td>8</td><td>5</td><td>2</td><td>1</td><td>—</td></tr>
          <tr><td>9</td><td>5</td><td>3</td><td>1</td><td>—</td></tr>
          <tr><td>10</td><td>6</td><td>3</td><td>1</td><td>—</td></tr>
        </table>
        <p style="font-size:.72rem;color:var(--dim);margin-top:4px">Asiler birbirini ve Kral'ı bilir. Kral, Asilerin kim olduğunu bilir.</p>
      </div>
      <div class="guide-mk-section">
        <div class="guide-mk-title">DESTE</div>
        <p>17 kartlık deste: <strong style="color:#00bfff">6 Matrix kartı</strong> + <strong style="color:#e74c3c">11 Asi kartı</strong>. Karıştırılır, kimse içeriğini göremez.</p>
      </div>
      <div class="guide-mk-section">
        <div class="guide-mk-title">TUR AKIŞI</div>
        <ol style="padding-left:18px;line-height:1.9;font-size:.82rem">
          <li><strong>Aday Gösterme:</strong> Tur lideri hayatta olan bir oyuncuyu Yaver olarak aday gösterir. Geçen turun lideri ve yaveri aday gösterilemez (kilit kuralı).</li>
          <li><strong>Oylama:</strong> Herkes aynı anda gizlice <em>EVET</em> veya <em>HAYIR</em> oylar. Oylama gizlidir; kimse kimin ne oyladığını göremez. Oylar açıldığında çoğunluk EVET ise hükümet kurulur. Beraberlikte hükümet REDDEDİLİR.</li>
          <li><strong>Kaos Sayacı:</strong> Arka arkaya 3 hükümet reddedilirse kart seçimi yapılmaz; destenin en üstündeki kart otomatik masaya yüklenir.</li>
          <li><strong>Kart Seçimi (Lider):</strong> Onaylanan lider desteden 3 kart çeker. Hepsini görür, birini sessizce atar ve kalan 2 kartı Yaver'e verir.</li>
          <li><strong>Kart Yükleme (Yaver):</strong> Yaver 2 karttan birini seçip masaya yükler. Yüklenen kart herkese açıklanır.</li>
          <li><strong>Güç:</strong> Masaya yüklenen kart Asi ise ve yeterli Asi kartı birikmiş ise lider özel bir güç kazanır (bkz. aşağıdaki tablo). Güç kullanılınca ya da atlanınca tur biter, liderlik sıraya göre geçer.</li>
        </ol>
      </div>
      <div class="guide-mk-section">
        <div class="guide-mk-title">ÖZEL GÜÇLER (Asi Kartı Sayısına Göre)</div>
        <table class="guide-mk-table">
          <tr><th>Masadaki Asi</th><th>Güç</th><th>Açıklama</th></tr>
          <tr><td>1 <span style="font-size:.65rem;color:var(--dim)">(büyük oyun)</span></td><td>Rol Görme</td><td>Lider bir oyuncunun takımını gizlice öğrenir (Şövalye mi, Asi mi)</td></tr>
          <tr><td>2</td><td>Rol Görme</td><td>Lider bir oyuncunun takımını gizlice öğrenir</td></tr>
          <tr><td>3</td><td>Deste Görme</td><td>Lider destenin en üstündeki 3 kartı gizlice görür</td></tr>
          <tr><td>4</td><td>İdam</td><td>Lider bir oyuncuyu oyundan kalıcı olarak çıkarır — idam edilen Kral ise Şövalyeler anında kazanır!</td></tr>
          <tr><td>5</td><td>İdam</td><td>Aynı kural</td></tr>
        </table>
        <p style="font-size:.72rem;color:var(--dim);margin-top:4px">5-6 kişilik küçük oyunlarda 1. Asi kartında güç açılmaz.</p>
      </div>
      <div class="guide-mk-section">
        <div class="guide-mk-title">KAZANMA KOŞULLARI</div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
          <div style="background:rgba(0,191,255,.06);border:1px solid rgba(0,191,255,.25);border-radius:6px;padding:8px 10px;font-size:.8rem">
            <strong style="color:#00bfff">🟦 Şövalyeler Kazanır:</strong>
            <ul style="padding-left:16px;margin-top:4px;line-height:1.7">
              <li>Masaya <strong>5 Matrix kartı</strong> yüklenirse</li>
              <li>İdam gücüyle <strong>Kral öldürülürse</strong></li>
            </ul>
          </div>
          <div style="background:rgba(192,57,43,.06);border:1px solid rgba(192,57,43,.25);border-radius:6px;padding:8px 10px;font-size:.8rem">
            <strong style="color:#e74c3c">🟥 Asiler Kazanır:</strong>
            <ul style="padding-left:16px;margin-top:4px;line-height:1.7">
              <li>Masaya <strong>6 Asi kartı</strong> yüklenirse</li>
              <li>Masada <strong>3 veya daha fazla Asi kartı varken</strong> Kral Yaver olarak onaylanırsa (Kral'ın Yaver seçilmesi yetmez; Şövalyelerin dikkatli oy kullanması gerekir!)</li>
            </ul>
          </div>
        </div>
      </div>
      <div class="guide-mk-section">
        <div class="guide-mk-title">STRATEJİK NOTLAR</div>
        <ul style="padding-left:16px;line-height:1.8;font-size:.8rem">
          <li><strong>Şövalyeler:</strong> Kimin hangi hükümette Asi kartı yüklediğini not edin. Güvenilir çiftleri tekrar seçin.</li>
          <li><strong>Asiler:</strong> Çok fazla Asi kartı yüklerseniz deşifre olursunuz. Zaman zaman Matrix kartı yükleyerek güven kazanın.</li>
          <li><strong>Kral:</strong> Hemen Yaver olmayı istemeyin; masada 3 Asi kartı birikene kadar bekleyin. Erken deşifre olursanız idam edilebilirsiniz.</li>
          <li><strong>İdam Stratejisi:</strong> Şövalye liderler Kral olduğundan şüphelendiğinizi ima eden oyuncuyu, Asi liderler güçlü bir Şövalyeyi hedef alır.</li>
        </ul>
      </div>
    </div>
    <div class="guide-card">
      <h3>🎭 Detaylı Roller Rehberi</h3>
      <p>Aşağıda tüm roller takımlarına göre listelenmiştir. Bir role tıklayarak detaylı açıklamasını görebilirsin.</p>
      <div id="GUIDE_ROLE_TABS" style="display:flex;gap:4px;margin-top:10px;flex-wrap:wrap"></div>
    </div>
    <div id="GUIDE_ROLE_LIST"></div>
  `;
  // Sekmeler
  const allTabs=[{id:'all',l:'Tümü'},{id:'masum',l:'🌅 Masum'},{id:'hain',l:'🧛 Hain'},{id:'tarafsız',l:'⚖️ Tarafsız'},{id:'deli',l:'🤡 Deli'}];
  const tabContainer=Q('GUIDE_ROLE_TABS');
  tabContainer.innerHTML=allTabs.map(t=>`<button class="guide-rtab${t.id==='all'?' active':''}" data-grt="${t.id}" style="padding:5px 12px;border-radius:16px;border:1px solid var(--brd);background:${t.id==='all'?'var(--hi)':'var(--bg2)'};color:${t.id==='all'?'#000':'var(--txt)'};font-size:.72rem;cursor:pointer;font-weight:600">${t.l}</button>`).join('');
  tabContainer.addEventListener('click',e=>{
    const btn=e.target.closest('[data-grt]');
    if(!btn)return;
    tabContainer.querySelectorAll('[data-grt]').forEach(b=>{b.style.background='var(--bg2)';b.style.color='var(--txt)';b.classList.remove('active');});
    btn.style.background='var(--hi)';btn.style.color='#000';btn.classList.add('active');
    renderGuideRoles(btn.dataset.grt);
  });
  renderGuideRoles('all');
}

function renderGuideRoles(team){
  const list=Q('GUIDE_ROLE_LIST');
  if(!list)return;
  const allRoles={...RDEF,...RDEF_DEMO};
  const entries=Object.entries(allRoles).filter(([k,v])=>team==='all'||v.t===team);
  list.innerHTML=entries.map(([k,rd])=>`
    <div class="role-guide-item team-${rd.t}" style="cursor:pointer" onclick="this.querySelector('.guide-role-full')?.classList.toggle('open')">
      <div class="role-guide-h"><span class="em">${rd.e}</span><span class="nm">${rd.n}</span><span class="role-guide-tag rtag ${rd.t}">${rd.t.toUpperCase()}</span></div>
      <div class="role-guide-d">${rd.d}</div>
      ${rd.full?`<div class="guide-role-full">${rd.full}</div>`:''}
    </div>
  `).join('');
}

// ── ROOM ──
// Kasıtlı çıkış flag'i: leaveRoom/exitToMainMenu sonrası rejoin asla yapılmasın
let _intentionalLeave = false;

function saveLastRoom(code,name){
  try{localStorage.setItem('azap_last_room',JSON.stringify({code,name}));}catch{}
}
function clearLastRoom(){
  _intentionalLeave = true;
  try{localStorage.removeItem('azap_last_room');}catch{}
  try{localStorage.setItem('azap_left_time',Date.now().toString());}catch{}
  console.log('[clearLastRoom] Oda verisi temizlendi, kasıtlı çıkış flag\'i set edildi');
}
function createRoom(){
  const n=Q('IN').value.trim();if(!n)return toast('İsim gir!',1);
  _intentionalLeave=false;
  io2.emit('room:create',{playerName:n},r=>{if(r.ok){me=io2.id;Q('LC').textContent=r.code;saveLastRoom(r.code,n);show('S2');buildRG();applyMusicForCurrentScreen();io2.emit('auth:stats',null,s=>{if(s){user=s;updateUserUI();}});}else toast(r.err,1);});
}
function joinRoom(){
  const n=Q('IN').value.trim(),c=Q('IC').value.trim();
  if(!n)return toast('İsim gir!',1);if(c.length!==4)return toast('4 haneli kod!',1);
  _intentionalLeave=false;
  io2.emit('room:join',{code:c,playerName:n},r=>{if(r.ok){me=io2.id;Q('LC').textContent=r.code;saveLastRoom(r.code,n);show('S2');applyMusicForCurrentScreen();io2.emit('auth:stats',null,s=>{if(s){user=s;updateUserUI();}});}else toast(r.err,1);});
}
function spectate(){
  const c=Q('IC').value.trim();if(c.length!==4)return toast('4 haneli kod!',1);
  io2.emit('room:spectate',{code:c},r=>{if(r.ok){isSpec=true;Q('SB').classList.add('sh');show('S10');stopMusic();}else toast(r.err,1);});
}
// ── ADMIN BOT KONTROLÜ ──
function addBots(){
  const n = parseInt(Q('BOT_COUNT')?.value) || 1;
  io2.emit('bot:add', { count: n }, r => {
    if(r?.ok) toast(`🤖 ${r.added} bot eklendi (toplam: ${r.total})`);
    else toast(r?.err || 'Bot eklenemedi', 1);
  });
}
function removeAllBots(){
  if(!confirm('Tüm botları odadan çıkarmak istediğine emin misin?')) return;
  io2.emit('bot:removeAll', {}, r => {
    if(r?.ok) toast('🤖 Tüm botlar atıldı');
    else toast(r?.err || 'Bot atılamadı', 1);
  });
}

function leaveRoom(){
  io2.emit('room:leave');
  clearLastRoom();
  resetClient();
  show('S1');
  applyMusicForCurrentScreen();
}
function leaveAfterGame(){
  io2.emit('room:leave');
  resetClient();
  show('S1');
  io2.emit('auth:stats',null,r=>{if(r){user=r;updateUserUI();}});
  applyMusicForCurrentScreen();
}

// 🔄 Oyun içi sayfa yenileme (state'i resetleyip lobi/oyun ekranını tekrar yükler)
function refreshGame(){
  // Frontend state'i temizle ve sunucudan tekrar al
  // Mevcut socket bağlantısını koruyoruz, sadece UI'yı yeniden çiz
  if(gs && me){
    // Aktif state istek
    io2.emit('state:request', null, () => {
      // State handler renderlayacak
    });
    // Aktif private state
    io2.emit('priv:request', null, () => {});
    toast('🔄 Yenileniyor...');
    // 1 saniye sonra emin olmak için sayfa reload (token korunur)
    setTimeout(() => location.reload(), 800);
  } else {
    location.reload();
  }
}

// 🚪 Oyun içinden ana menüye dön (onaylı)
function exitToMainMenu(){
  const inActiveGame = gs && gs.phase !== 'lobby' && gs.phase !== 'post_game';
  const msg = inActiveGame
    ? '⚠️ Aktif bir oyundasın!\nÇıkarsan diğer oyuncular için sorun yaratabilirsin.\n\nGerçekten ana menüye dönmek istiyor musun?'
    : 'Ana menüye dönmek istediğine emin misin?';
  if(!confirm(msg)) return;
  io2.emit('room:leave');
  clearLastRoom();
  resetClient();
  show('S1');
  applyMusicForCurrentScreen();
  toast('Ana menüye döndün');
}

// Game actions (yenile/çıkış) butonlarını göster/gizle
function updateGameActions(){
  const ga = Q('GAME_ACTIONS');
  if(!ga) return;
  // S0 (auth) ve S1 (entry) dışındaki tüm ekranlarda göster
  const currentScreen = document.querySelector('.scr.on')?.id;
  const showActions = currentScreen && currentScreen !== 'S0' && currentScreen !== 'S1';
  ga.style.display = showActions ? 'flex' : 'none';
}
function resetClient(){
  me=null; // Ana menüye dönünce me sıfırlanır, rejoin engellenir
  deathOk=false;lastDead=new Set();gs=null;ps=null;isSpec=false;isDead=false;mvpVoted=null;
  const sb=Q('SB'); sb.textContent='👁️ İZLEYİCİ'; sb.classList.remove('sh');
  Q('HT').classList.remove('sh');Q('HP').classList.remove('op');
  Q('DOV').classList.remove('sh');
  Q('TB').style.display='none';Q('TN').style.display='none';
  // Tüm floating butonları gizle
  ['SUIKAST_BTN_FLOAT','ENGIZITOR_BTN_FLOAT','SABOTAJ_BTN_FLOAT','MINIGAME_BTN_FLOAT','ROLE_INFO_BTN','ROLE_GUIDE_BTN'].forEach(id=>{
    const el=Q(id); if(el){el.style.display='none';el.classList.remove('sh');}
  });
  theme(false);
}
function newGame(){
  io2.emit('room:newGame');
  deathOk=false;lastDead=new Set();isDead=false;mvpVoted=null;
  const sb=Q('SB'); sb.textContent='👁️ İZLEYİCİ'; sb.classList.remove('sh');
  Q('DOV').classList.remove('sh');
}

function enterDeathSpectate(){
  Q('DOV').classList.remove('sh');
  isDead=true;
  const sb=Q('SB');
  sb.textContent='👻 HAYALET';
  sb.classList.add('sh');
  show('S10');
  // Eğer elimizde son spec verisi varsa hemen render et
  if(_lastSpec) renderSpec(_lastSpec);
}

function startGame(){io2.emit('start',null,r=>{if(!r.ok)toast(r.err,1);});}

let demoRolesEnabled=false; // Demo rolleri dahil etme durumu

function buildRG(){
  const g=Q('RG');g.innerHTML='';
  // Ana roller (DELI, VAMPIR ve demo roller hariç)
  const _demoKeys=new Set(Object.keys(RDEF_DEMO));
  const _tOrder={masum:0,hain:1,'tarafsız':2,deli:3};
  Object.entries(RDEF).filter(([k])=>k!=='DELI' && k!=='VAMPIR' && !_demoKeys.has(k)).sort((a,b)=>(_tOrder[a[1].t]??9)-(_tOrder[b[1].t]??9)).forEach(([k,v])=>{
    const d=document.createElement('div');
    d.className=`rchip on ${v.t==='hain'?'tv':v.t==='tarafsız'?'tt':''}`;d.dataset.key=k;
    d.innerHTML=`<span>${v.e}</span>${v.n}`;
    d.onclick=()=>{d.classList.toggle('on');uSet();};
    g.appendChild(d);
  });
  // Demo bölüm ayırıcı
  const sep=document.createElement('div');
  sep.style.cssText='grid-column:1/-1;font-size:.62rem;color:var(--dim);padding:6px 0 2px;border-top:1px solid var(--brd);margin-top:4px;letter-spacing:1.5px;font-family:"Cinzel Decorative",serif';
  sep.textContent='\u2697\ufe0f DEMO ROLLER';
  g.appendChild(sep);
  // Demo roller + VAMPIR (her zaman göster, on/off durumu demoRolesEnabled'a bağlı)
  const demoAll={...RDEF_DEMO};
  if(RDEF.VAMPIR) demoAll.VAMPIR={...RDEF.VAMPIR,n:'Vampir (Demo)'};
  Object.entries(demoAll).forEach(([k,v])=>{
    const d=document.createElement('div');
    d.className=`rchip demo ${demoRolesEnabled?'on':''} ${v.t==='hain'?'tv':v.t==='tarafsız'?'tt':''}`.trim();d.dataset.key=k;
    d.innerHTML=`<span>${v.e}</span>${v.n}`;
    d.onclick=()=>{d.classList.toggle('on');uSet();};
    g.appendChild(d);
  });
}

function uSet(){
  const ins=Q('SI').value,ni=Q('SN').value,di=Q('SD').value,vo=Q('SV').value;
  Q('VI').textContent='%'+ins;Q('VN').textContent=ni+'s';
  Q('VD').textContent=di>=60?Math.floor(di/60)+'dk'+(di%60?di%60+'s':''):di+'s';
  Q('VV').textContent=vo+'s';
  Q('VH').textContent=Q('HC2').value;Q('VT').textContent=Q('TC2').value;
  const hkm=document.querySelector('input[name=hkm]:checked')?.value||'multi';
  const rsm=document.querySelector('input[name=rsm]:checked')?.value||'auto';
  const er=[...document.querySelectorAll('.rchip.on')].map(c=>c.dataset.key);
  // Debounce: slider sürüklenirken sürekli emit yapılmasın, son değer 200ms sonra gönderilsin
  if(window._uSetTimer)clearTimeout(window._uSetTimer);
  window._uSetTimer=setTimeout(()=>{
    io2.emit('settings',{
      enabledRoles:er,insanityRate:+ins,
      config:{nightDuration:+ni,discussionDuration:+di,votingDuration:+vo},
      hainKillMode:hkm,roleSelectionMode:rsm,
      manualCounts:true,hainCount:+Q('HC2').value,tarafsizCount:+Q('TC2').value
    });
  },200);
}

// ── ROLE SELECTION (PICK MODE) ──
function pickRole(choice){
  io2.emit('roleChoice',{choice},r=>{
    if(!r.ok)toast(r.err||'Hata!',1);
  });
}

function renderRS(){
  if(!gs?.roleSelection)return;
  const rs=gs.roleSelection;
  // Progress bar
  Q('RS_PROG_TXT').textContent=`${rs.done} / ${rs.total} oyuncu seçti`;
  Q('RS_PROG_FILL').style.width=(rs.done/rs.total*100)+'%';

  // Şu anki kişi (avatar + isim göster, ama SIRA NUMARASI YOK)
  const currentDiv=Q('RS_CURRENT');
  if(rs.currentPlayerId){
    if(rs.currentPlayerId===me){
      currentDiv.style.display='block';
      currentDiv.innerHTML=`<strong style="color:var(--hi)">⏳ Sıra sende!</strong>`;
    } else {
      currentDiv.style.display='block';
      // ARTIK İSİM VE AVATAR YOK, GİZLİ OYUNCU YAZIYOR
      currentDiv.innerHTML=`<div class="av av-sm">❓</div><strong>Gizli bir oyuncu</strong> seçiyor...`;
    }
  } else {
    currentDiv.style.display='none';
  }

  Q('RS_SUB').textContent=rs.currentPlayerId===me?'Sıra sende!':'Bekliyor...';

  // Tamamlananlar listesi (rastgele sıralanmış - kim önce seçtiği belli olmasın)
  const list=Q('RS_LIST');
  list.innerHTML='';
  if(rs.completed.length===0){
    list.innerHTML='<div style="color:var(--dim);font-size:.78rem;text-align:center;padding:8px">Henüz seçim yok.</div>';
  } else {
    // Sadece "1. Seçim", "2. Seçim" olarak anonim yazdırıyoruz
    rs.completed.forEach((c, index)=>{
      let pickHTML;
      if(c.isRandom){
        pickHTML='<span class="rs-comp-pick random">🎲 Rastgele</span>';
      } else {
        const info=ID_MAP[c.picked]||{e:'❓',n:c.picked};
        pickHTML=`<span class="rs-comp-pick team-${roleTeamOf(c.picked)}">${info.e} ${info.n}</span>`;
      }
      const d=document.createElement('div');
      d.className='rs-comp-row';
      d.innerHTML=`<span style="color:var(--dim);margin-right:10px;font-weight:bold">${index + 1}. Seçim</span>${pickHTML}`;
      list.appendChild(d);
    });
  }

  // Sıra bende mi?
  if(ps?.myRoleOptions && rs.currentPlayerId===me){
    Q('RS_MY_OPTIONS').style.display='block';
    const ol=Q('RS_OPT_LIST');ol.innerHTML='';

    if(ps.myRoleForced){
      // Zorla atanmış takım — kalan rollerden seçim yapılabilir + rastgele de aynı takımdan
      const teamLabel = ps.myRoleForcedTeam ? ` (${ps.myRoleForcedTeam.toUpperCase()})` : '';
      ps.myRoleOptions.forEach(roleId=>{
        const info=ID_MAP[roleId]||{e:'❓',n:roleId,d:''};
        const d=document.createElement('div');
        const tc=roleTeamOf(roleId,ps.myRoleForcedTeam);
        d.className=`rs-opt team-${tc}`;
        d.innerHTML=`<span class="rs-opt-em">${info.e}</span><div style="flex:1"><div class="rs-opt-name">${info.n}</div><div style="font-size:.72rem;color:var(--dim);margin-top:2px">${info.d||''}</div></div>`;
        d.onclick=()=>pickRole(roleId);
        ol.appendChild(d);
        applyTeamStyle(d,tc);
      });
      // Forced durumda da rastgele opsiyonu (forced takım içinden seçer)
      const rd=document.createElement('div');
      const forcedTc=roleTeamClass(ps.myRoleForcedTeam);
      rd.className=`rs-opt rs-opt-rnd team-${forcedTc}`;
      const teamColor = ps.myRoleForcedTeam==='hain'?'var(--hain)':ps.myRoleForcedTeam==='tarafsız'?'var(--tarafsiz)':'var(--safe)';
      rd.innerHTML=`<span class="rs-opt-em">🎲</span><div style="flex:1"><div class="rs-opt-name">Rastgele <span style="color:${teamColor};font-size:.72rem">(${ps.myRoleForcedTeam||'?'})</span></div><div style="font-size:.72rem;color:var(--dim);margin-top:2px">${ps.myRoleForcedTeam} havuzundan rastgele rol gelir.</div></div>`;
      rd.onclick=()=>pickRole('random');
      ol.appendChild(rd);
      Q('RS_SUB').textContent=`Takım dengelemesi: bir ${ps.myRoleForcedTeam||'rol'} seçmelisin (rastgele de bu takımdan gelir)!`;
    } else {
      ps.myRoleOptions.forEach(roleId=>{
        const info=ID_MAP[roleId]||{e:'❓',n:roleId,d:''};
        const d=document.createElement('div');
        const tc=roleTeamOf(roleId);
        d.className=`rs-opt team-${tc}`;
        d.innerHTML=`<span class="rs-opt-em">${info.e}</span><div style="flex:1"><div class="rs-opt-name">${info.n}</div><div style="font-size:.72rem;color:var(--dim);margin-top:2px">${info.d||''}</div></div>`;
        d.onclick=()=>pickRole(roleId);
        ol.appendChild(d);
        applyTeamStyle(d,tc);
      });
      // Rastgele butonu: tüm havuzdan gelebilir
      const rd=document.createElement('div');
      rd.className='rs-opt rs-opt-rnd';
      rd.innerHTML=`<span class="rs-opt-em">🎲</span><div style="flex:1"><div class="rs-opt-name">Rastgele</div><div style="font-size:.72rem;color:var(--dim);margin-top:2px">Tüm havuzdan rastgele rol gelir (diğerleri sadece "rastgele" görür)</div></div>`;
      rd.onclick=()=>pickRole('random');
      ol.appendChild(rd);
    }
  } else {
    Q('RS_MY_OPTIONS').style.display='none';
  }

  // Kendi seçimimi göster (rastgele bile olsa rolü)
  const myPick=ps?.myPickInfo;
  const myPickDiv=Q('RS_MY_PICK_DISPLAY');
  if(myPick){
    myPickDiv.innerHTML=`<div class="rs-my-pick"><div style="font-size:.72rem;color:var(--dim);letter-spacing:1px;text-transform:uppercase">${myPick.isRandom?'🎲 RASTGELE SEÇİLDİ — ROLÜN':'SEÇTİĞİN ROL'}</div><div class="em">${myPick.roleEmoji}</div><div class="nm">${myPick.roleName}</div></div>`;
  } else {
    myPickDiv.innerHTML='';
  }
}

// ── PRESIDENT VOTE ──
function pVote(tid){
  io2.emit('presidentVote',{targetId:tid},r=>{
    if(r.ok){toast('Oy verildi!');
      document.querySelectorAll('#PV_GRID .vb').forEach(b=>b.classList.toggle('vd',b.dataset.id===tid));}
  });
}

function renderPV(){
  if(!gs)return;theme(false);
  if(!_cosmeticCatalog){loadCosmeticCatalog().then(()=>{if(gs?.phase==='president_vote')renderPV();});}
  const grid=Q('PV_GRID');grid.innerHTML='';
  const isH=ps?.team==='hain';
  const tmIds=new Set();
  if(isH&&ps.teammates)ps.teammates.forEach(t=>tmIds.add(t.id));
  gs.players.filter(p=>p.isAlive).forEach(p=>{
    const isT=tmIds.has(p.id);
    const isMe=p.id===me;
    const d=document.createElement('div');d.className='vb';d.dataset.id=p.id;
    const tally=gs.presidentVoteTally?.[p.id]||0;
    const nameStyle=isT?'color:var(--hain);font-weight:600':(isMe?'color:var(--hi)':'');
    d.innerHTML=`${cosmeticPlayerAvatarHTML(p,'sm',isMe)}<span class="vb-name">${cosmeticPlayerNameHTML(p,isMe,`${isMe?' (SEN)':''}${isT?' 🧛':''}`,nameStyle)}</span><span class="vc" data-pvc="${p.id}">${tally}</span>`;
    // Kendine de oy verilebilir
    d.onclick=()=>pVote(p.id);
    grid.appendChild(d);
  });
  // Skip (atla) butonu
  const sk=document.createElement('div');sk.className='vb';sk.dataset.id='skip';
  sk.style.cssText='border:1px dashed var(--dim);background:rgba(255,255,255,.04)';
  const skipCnt=gs.presidentVoteTally?.['__skip__']||0;
  sk.innerHTML=`<div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:1.2rem">⏭️</div><span class="vb-name"><span style="font-style:italic">Kimseye oy verme</span></span><span class="vc" data-pvc="skip">${skipCnt}</span>`;
  sk.onclick=()=>pVote('skip');
  grid.appendChild(sk);
}

function updatePVTally(tally){
  document.querySelectorAll('[data-pvc]').forEach(el=>{
    el.textContent=tally[el.dataset.pvc]||0;
  });
  const skipEl=document.querySelector('[data-pvc="skip"]');
  if(skipEl)skipEl.textContent=tally['__skip__']||0;
}

// ── NIGHT ──
function selT(tid){
  const r=ps?.role;
  if(r==='dedikoducu'){if(sel1===tid)sel1=null;else if(sel2===tid)sel2=null;else if(!sel1)sel1=tid;else if(!sel2)sel2=tid;else{sel1=tid;sel2=null;}}
  else sel1=sel1===tid?null:tid;
  renderTL();updAB();
}
function selGR(rid){selG=selG===rid?null:rid;renderEA();updAB();}

function updAB(){
  const r=ps?.role;
  if(ps?.team==='hain'){
    // Suikastçı dahil tüm hainler gecede sadece kill butonu
    Q('BK').disabled=!sel1;
    // Ability butonu: suikastçı gecede yetenek kullanmaz (gündüz kullanır)
    if(r==='suikastci') Q('BA').disabled=true;
    else Q('BA').disabled=!sel1;
  }
  else if(r==='seri_katil'){Q('BK').disabled=!sel1;}
  else if(r==='dedikoducu')Q('BSA').disabled=!sel1||!sel2;
  else if(r==='gazi')Q('BSA').disabled=ps?.gaziUsed;
  else if(r==='serif')Q('BSA').disabled=!sel1||ps?.serifUsed;
  else if(r==='bombaci'){
    const mode=window._bombMode||'place';
    const myBombs=ps?.myBombs||[];
    if(mode==='place'){
      Q('BSA').textContent = sel1 ? '💣 Bomba Koy' : '💣 Önce Hedef Seç';
    } else {
      Q('BSA').textContent = myBombs.length>0 ? '💥 Tüm Bombaları Patlat' : '💥 (Bomba Yok)';
    }
    Q('BSA').disabled=false; // daima enabled - validation conf'ta
  }
  else Q('BSA').disabled=!sel1;
}

function conf(type){
  const r=ps?.role;let a={};
  const isHain=ps?.team==='hain';
  if(!isHain && nsent)return;

  if(r==='gazi')a={action:'activate'};
  else if(r==='gardiyan')a={action:'shield'};
  else if(r==='pusucu')a={targetId:me};  // pusu kurmak için kendine target = aktivasyon
  else if(r==='dedikoducu')a={target1Id:sel1,target2Id:sel2};
  else if(r==='serif')a={action:'shoot',targetId:sel1};
  else if(r==='cilingir')a={targetId:sel1};
  else if(r==='demirci')a={targetId:sel1};
  else if(r==='buzcu')a={targetId:sel1};
  else if(r==='infazci'){
    // İnfazcı: zindana atma + opsiyonel idam (window._infazExecute flag)
    a={targetId:sel1, execute: !!window._infazExecute};
  }
  else if(r==='bombaci'){
    const mode=window._bombMode||'place';
    if(mode==='place'){
      if(!sel1){toast('Hedef seç!',1);return;}
      a={action:'place',abilityTargetId:sel1};
    } else {
      const myBombs=ps.myBombs||[];
      if(myBombs.length===0){toast('Patlatacak bomba yok!',1);return;}
      a={action:'detonate'};
    }
  }
  else if(isHain){
    if(type==='kill')a={action:'kill',killTargetId:sel1};
    else{
      // Suikastçı gecede ability kullanmaz (gündüz kullanır)
      if(r==='suikastci') return;
      // Köstebek, Virüs, Pusucu, Hacker hain ability sayılır
      if(['kostebek','virus','hacker'].includes(r))a={abilityTargetId:sel1};
      else a={action:'ability',abilityTargetId:sel1};
    }
  }
  else if(r==='seri_katil'){a={action:'kill',targetId:sel1};}
  else if(r==='veba')a={targetId:sel1};
  else a={targetId:sel1};
  io2.emit('nightAction',a,r2=>{
    if(r2?.ok){
      if(!isHain){nsent=true;document.querySelectorAll('.abtn .b,#BSA').forEach(b=>{b.disabled=true;b.textContent='✓';});}
      else{toast('Aksiyon güncellendi!');}
    } else if(r2 && r2.ok===false){
      toast(r2.err||'Aksiyon reddedildi.',1);
    }
  });
}

function sendHC(){const i=Q('HCI');if(!i?.value.trim())return;io2.emit('hainChat',{msg:i.value.trim()});i.value='';}

// Suikast modal fonksiyonları
window._suikastTarget=null;
window._suikastRole=null;
function selSuikastRole(rid){
  window._suikastRole=rid;
  document.querySelectorAll('#SUIKAST_ROLES .rgb').forEach(b=>b.classList.toggle('sel',b.dataset.rid===rid));
  updSuikastBtn();
}
function updSuikastBtn(){
  const btn=Q('SUIKAST_DO_BTN');
  if(btn)btn.disabled=!window._suikastTarget||!window._suikastRole;
}
function doSuikast(){
  if(!window._suikastTarget||!window._suikastRole)return;
  const btn=Q('SUIKAST_DO_BTN');
  if(btn){btn.disabled=true;btn.textContent='Gönderiliyor...';}
  io2.emit('suikast',{targetId:window._suikastTarget,guessedRole:window._suikastRole},r=>{
    if(!r.ok){
      Q('SUIKAST_STATUS').textContent=r.err||'Hata!';
      Q('SUIKAST_STATUS').style.color='var(--hain)';
      if(btn){btn.disabled=false;btn.textContent='🗡️ SUİKAST!';}
      toast(r.err||'Hata!',1);
    } else {
      // Modal kapansın - sonuç overlay'i suikastResult event'i ile gelecek
      closeSuikastModal();
    }
  });
}
// ── VOTE ──
function doVote(tid){
  if(voted){toast('Oyun verildi, değiştirilemez.',1);return;}
  io2.emit('vote',{targetId:tid},r=>{
    if(r?.ok){
      voted=tid;
      document.querySelectorAll('#VG .vb').forEach(b=>{b.classList.toggle('vd',b.dataset.id===tid);});
    } else {
      toast('Oy verilemedi.',1);
    }
  });
}

// ── MVP VOTE ──
function doMvpVote(tid){
  io2.emit('mvpVote',{targetId:tid},r=>{
    if(r.ok){
      mvpVoted=tid;
      document.querySelectorAll('#MV_GRID .vb').forEach(b=>{b.classList.toggle('vd',b.dataset.id===tid);});
      toast('İyi oyuncu oyu verildi!');
    }
  });
}

function renderMV(){
  if(!gs)return;theme(false);
  // mvpVoted'u sadece yeni MVP fazına geçildiğinde sıfırla (phase change tetikledi)
  mvpVoted=null;
  const grid=Q('MV_GRID');grid.innerHTML='';
  // Tüm oyuncular (öldü ya da hayatta) — ama kendine oy verilemez (MVP için)
  gs.players.forEach(p=>{
    if(p.id===me)return;
    const isMe=false;
    const d=document.createElement('div');d.className='vb';d.dataset.id=p.id;
    const tally=gs.mvpTally?.[p.id]||0;
    d.innerHTML=`${cosmeticPlayerAvatarHTML(p,'sm',isMe)}<span class="vb-name">${cosmeticPlayerNameHTML(p,isMe)}</span><span class="vc" data-mvc="${p.id}">${tally}</span><span class="tk">✓</span>`;
    d.onclick=()=>doMvpVote(p.id);
    grid.appendChild(d);
  });
}

function updateMvpTally(tally){
  document.querySelectorAll('[data-mvc]').forEach(el=>{
    el.textContent=tally[el.dataset.mvc]||0;
  });
}

function renderMvpResult(result){
  show('S_MVR');
  if(result.mvp){
    Q('MVR_AV').innerHTML=cosmeticPlayerAvatarHTML(result.mvp,'xl',result.mvp.id===me,'5px');
    Q('MVR_NAME').textContent=result.mvp.name;
    Q('MVR_VOTES').textContent=`${result.votes} oy aldı`;
  } else {
    Q('MVR_AV').innerHTML='';
    Q('MVR_NAME').textContent='Kimse oy almadı';
    Q('MVR_VOTES').textContent='';
  }
  // Tally
  const tally=Q('MVR_TALLY');tally.innerHTML='';
  const entries=Object.entries(result.tally||{}).sort((a,b)=>b[1]-a[1]);
  if(entries.length===0){
    tally.innerHTML='<div style="text-align:center;color:var(--dim);font-size:.8rem">Oy verilmedi.</div>';
  } else {
    entries.forEach(([pid,votes])=>{
      const p=gs?.players.find(x=>x.id===pid);
      if(!p)return;
      const item=document.createElement('div');
      item.className='mvp-tally-item';
      item.innerHTML=`${cosmeticPlayerAvatarHTML(p,'sm',p.id===me)}<span style="flex:1">${cosmeticPlayerNameHTML(p,p.id===me)}</span><span style="color:var(--gold);font-family:'Fira Code',monospace">${votes}</span>`;
      tally.appendChild(item);
    });
  }
  const isLeaderMVR = gs?.leaderId === me;
  Q('BNG2').style.display = isLeaderMVR ? 'block' : 'none';
  Q('BNG2_WAIT').style.display = isLeaderMVR ? 'none' : 'block';
}

// ── HISTORY ──
function renderH(){
  if(!ps?.history)return;const c=Q('HC');
  if(!ps.history.length){c.innerHTML='<div style="color:var(--dim);font-size:.85rem;text-align:center;padding:20px">Henüz aksiyon yok.</div>';return;}

  // Action ikonları
  const actIcons={
    'Koruma':'🩺','Engelleme':'🔦','Sorgulama':'⚖️','Araştırma':'📰',
    'Psikoloji':'🧠','Kalkan':'🛡️','Karşılaştırma':'🗣️','Ajan':'🕵️',
    'Vurma':'🤠','Kilit':'🔑','Takip':'👣','Hipnoz':'🌀',
    'Bomba koyma':'💣','Patlatma':'💥','Susturma':'👤','Öldürme':'🗡️'
  };
  // Sonuç renkleri
  const getResColor = (res) => {
    if(!res) return 'var(--dim)';
    const r = res.toLowerCase();
    if(r.includes('başarılı')||r.includes('kurtardın')||r.includes('aktif')||r.includes('yerleştirildi'))return 'var(--safe)';
    if(r.includes('engel')||r.includes('boş'))return 'var(--dim)';
    if(r.includes('hain')||r.includes('katil')||r.includes('öldü'))return 'var(--hain)';
    return 'var(--hi)';
  };

  // Turlara göre grupla
  const byRound = {};
  ps.history.forEach(h=>{
    if(!byRound[h.round])byRound[h.round]=[];
    byRound[h.round].push(h);
  });

  const html = Object.keys(byRound).sort((a,b)=>parseInt(b)-parseInt(a)).map(round=>{
    const items = byRound[round].map(h=>{
      const icon = actIcons[h.action] || '✨';
      const resColor = getResColor(h.result);
      return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,255,255,.02);border-radius:5px;margin:4px 0;font-size:.82rem">
        <span style="font-size:1rem">${icon}</span>
        <span style="font-weight:500;min-width:70px">${h.action}</span>
        <span style="color:var(--dim);flex:1">${h.target||'-'}</span>
        <span style="color:${resColor};font-weight:500">${h.result||''}</span>
      </div>`;
    }).join('');
    return `<div style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05)">
        <span style="background:var(--hi);color:#000;padding:2px 8px;border-radius:3px;font-size:.7rem;font-weight:700;font-family:'Fira Code',monospace">TUR ${round}</span>
      </div>
      ${items}
    </div>`;
  }).join('');

  c.innerHTML=html;
}

// ── RENDERS ──
// ── KOZMETİK RENDER HELPER ──
let _hideOtherCosmetics = false;
try{_hideOtherCosmetics=localStorage.getItem('azap_hide_cosmetics')==='1';}catch{}

function cosmeticNameHTML(name, cosm, isMe){
  if(!cosm||(!isMe && _hideOtherCosmetics)) return esc(name);
  let style='';
  const fontId=cosm.font||cosm.nameFont||cosm.activeFont||cosm.yazi||cosm.yaziTipi;
  if(fontId && _cosmeticCatalog?.[fontId]){
    const p=_cosmeticCatalog[fontId].preview||{};
    let family=p.family||'inherit';
    family=family.replace(/\\"/g,'"').replace(/"/g,"'");
    style+=`font-family:${family};`;
    if(p.weight) style+=`font-weight:${p.weight};`;
    if(p.size) style+=`font-size:${p.size};`;
  }
  return `<span style="${style}">${esc(name)}</span>`;
}

// Frame tüm kartı sarar - border+shadow+bg+anim
function cosmeticFrameWrap(cosm, isMe){
  if(!cosm||(!isMe && _hideOtherCosmetics)) return null;
  const frameId=cosm.frame||cosm.avatarFrame||cosm.activeFrame||cosm.cerceve;
  if(!frameId) return null;
  const item = _cosmeticCatalog?.[frameId];
  if(!item) return null;
  const p=item.preview||{};
  return {
    border: p.border||'1px solid var(--brd)',
    shadow: p.shadow||'none',
    bg: p.bg||'transparent',
    anim: p.anim||null,
    cls: p.cls||null,
    animDur: p.animDur||null,
    animEase: p.animEase||null
  };
}
// Eski fonksiyon (name span için style)
function cosmeticFrameStyle(cosm, isMe){
  const w=cosmeticFrameWrap(cosm,isMe);
  if(!w) return '';
  let s=`border:${w.border};box-shadow:${w.shadow};background:${w.bg};padding:3px 8px;border-radius:6px;`;
  if(w.anim) s+=`animation:${w.anim} 1.5s ease-in-out infinite;`;
  return s;
}

function cosmeticPetHTML(cosm, isMe){
  if(!cosm||(!isMe && _hideOtherCosmetics)) return '';
  const petId=cosm.pet||cosm.activePet||cosm.companion;
  if(!petId) return '';
  const item = _cosmeticCatalog?.[petId];
  if(!item) return '';
  const p=item.preview||{};
  const anim=p.anim||'catIdle';
  const sprite=p.sprite||item.emoji;
  return `<span style="display:inline-block;font-size:1.1rem;margin-left:4px;vertical-align:middle;animation:${anim} 3s ease-in-out infinite;line-height:1">${sprite}</span>`;
}
// SVG dönen yazı ring'i + lazer kuyruklu yıldız
let _frRingId=0;
const _frRingCfg={
  'fr-ticker':{text:'AZAP \u2022 SYSTEM \u2022 ONLINE \u2022 SABOTAJ \u2022 OY \u2022 HA\u0130N \u2022 ',color:'#64ffda',speed:'12s',size:'7',shape:'rect'},
  'fr-matrix':{text:'01 F3 A7 \u2022 10 B2 00 \u2022 FF 3E \u2022 C9 D1 \u2022 ',color:'#39ff14',speed:'12s',size:'7',shape:'rect'},
  'fr-premium-txt':{label:'PREMIUM',color:'#bb8fce',speed:'12s',size:'7',nameAlt:true},
  'fr-donor-ring':{label:'SUPPORT',color:'#e91e63',speed:'12s',size:'7',nameAlt:true}
};
const _frCirclePath='M50,50 m-44,0 a44,44 0 1,1 88,0 a44,44 0 1,1 -88,0';
const _frRectPath='M16,6 H84 Q94,6 94,16 V84 Q94,94 84,94 H16 Q6,94 6,84 V16 Q6,6 16,6 Z';
function _frTextRing(cls,name){
  const cfg=_frRingCfg[cls];
  if(!cfg) return '';
  const id='ftr'+(++_frRingId);
  const isRect=cfg.shape==='rect';
  const d=isRect?_frRectPath:_frCirclePath;
  let baseText=cfg.text||'';
  if(cfg.nameAlt){
    const n=name||'Player';
    baseText=`${cfg.label} \u2726 ${n} \u2726 `;
  }
  const fs=parseFloat(cfg.size)||7;
  if(isRect){
    const txt=baseText.repeat(6);
    return `<svg class="fr-text-ring ring-rect" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><path id="${id}" d="${d}" fill="none"/></defs><text fill="${cfg.color}" font-size="${fs}" font-family="'Courier New',monospace" font-weight="600" opacity=".9"><textPath href="#${id}">${txt}<animate attributeName="startOffset" from="0%" to="100%" dur="${cfg.speed}" repeatCount="indefinite"/></textPath></text><text fill="${cfg.color}" font-size="${fs}" font-family="'Courier New',monospace" font-weight="600" opacity=".9"><textPath href="#${id}">${txt}<animate attributeName="startOffset" from="-100%" to="0%" dur="${cfg.speed}" repeatCount="indefinite"/></textPath></text></svg>`;
  }
  const maxChars=Math.round(276/(fs*0.6));
  const reps=Math.max(2,Math.ceil(maxChars/baseText.length));
  const txt=baseText.repeat(reps);
  return `<svg class="fr-text-ring ring-spin" style="--rd:${cfg.speed}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><path id="${id}" d="${d}" fill="none"/></defs><text fill="${cfg.color}" font-size="${fs}" font-family="'Courier New',monospace" font-weight="600" opacity=".9"><textPath href="#${id}">${txt}</textPath></text></svg>`;
}
function frLaserSVG(){
  const id='flz'+(++_frRingId);
  const d='M10,1 H90 Q99,1 99,10 V90 Q99,99 90,99 H10 Q1,99 1,90 V10 Q1,1 10,1 Z';
  const peri=377,dashLen=35,gap=peri-dashLen;
  return `<svg style="position:absolute;inset:-1px;width:calc(100% + 2px);height:calc(100% + 2px);pointer-events:none;overflow:visible;z-index:10" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><filter id="${id}a"><feGaussianBlur stdDeviation="4"/></filter><filter id="${id}b"><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path d="${d}" fill="none" stroke="#0ff" stroke-width="7" stroke-dasharray="${dashLen} ${gap}" opacity=".25" stroke-linecap="round" filter="url(#${id}a)"><animate attributeName="stroke-dashoffset" from="0" to="-${peri}" dur="3s" repeatCount="indefinite"/></path><path d="${d}" fill="none" stroke="#0ff" stroke-width="2.5" stroke-dasharray="${dashLen-8} ${gap+8}" opacity=".9" stroke-linecap="round" filter="url(#${id}b)"><animate attributeName="stroke-dashoffset" from="0" to="-${peri}" dur="3s" repeatCount="indefinite"/></path></svg>`;
}
function frOverlaySVG(cls,name){
  if(!cls) return '';
  if(_frRingCfg[cls]) return _frTextRing(cls,name);
  if(cls==='fr-laser') return frLaserSVG();
  return '';
}
function cosmeticPlayerAvatarHTML(p, size, isMe, pad){
  const fw=cosmeticFrameWrap(p?.cosmetics,isMe);
  let avatar=avHTML(p?.avatar,size||'sm');
  if(fw){
    const dur=fw.animDur||'2s';
    const ease=fw.animEase||'ease-in-out';
    const cls=fw.cls?` ${fw.cls}`:'';
    const ring=fw.cls?frOverlaySVG(fw.cls,p?.name||p?.username):'';
    avatar=`<div class="fr-wrap${cls}" style="display:inline-flex;border:${fw.border};box-shadow:${fw.shadow};background:${fw.bg};border-radius:13px;padding:${pad||'3px'};margin:1px;position:relative;${fw.anim?`animation:${fw.anim} ${dur} ${ease} infinite`:''}">${avatar}${ring}</div>`;
  }
  return avatar;
}
function cosmeticPlayerNameHTML(p, isMe, extraHtml, style){
  const name=cosmeticNameHTML(p?.name||'',p?.cosmetics,isMe);
  const pet=cosmeticPetHTML(p?.cosmetics,isMe);
  return `<span style="${style||''}">${name}${extraHtml||''}${pet}</span>`;
}

function renderLobby(){
  if(!gs)return;
  if(!_cosmeticCatalog){
    loadCosmeticCatalog().then(()=>{ if(gs?.phase==='lobby') renderLobby(); });
  }
  Q('LP').innerHTML='';
  const isLeader = me===gs.leaderId;
  gs.players.forEach(p=>{
    const li=document.createElement('li');li.className='pi fade';li.dataset.pid=p.id;
    const isMe=p.id===me;
    const showKick = isLeader && !isMe;
    const avatarHtml = cosmeticPlayerAvatarHTML(p,'sm',isMe,'4px');
    const nameHtml = cosmeticPlayerNameHTML(p,isMe,isMe?' <span style="color:var(--hi);font-size:.62rem">(SEN)</span>':'');
    li.innerHTML=`${avatarHtml}<span class="pi-name">${nameHtml}</span>${p.id===gs.leaderId?'<span class="badge badge-l">LİDER</span>':''}<span class="wins-badge">🏆${p.wins||0}<span class="heart">❤️${p.mvp||0}</span></span>${showKick?`<button class="kick-btn" data-pid="${p.id}" title="Oyuncuyu at">🚫</button>`:''}`;
    Q('LP').appendChild(li);
  });
  // Kick butonlarına event ekle
  if(isLeader){
    document.querySelectorAll('.kick-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const pid=btn.getAttribute('data-pid');
        const target=gs.players.find(p=>p.id===pid);
        if(!target)return;
        if(confirm(`${target.name} oyuncusunu odadan atmak istediğine emin misin?`)){
          io2.emit('room:kick',{targetId:pid},r=>{
            if(r?.ok){
              toast(`${r.kickedName||target.name} atıldı.`);
            } else {
              toast(r?.err||'Atma işlemi başarısız.',1);
            }
          });
        }
      });
    });
  }
  const sp=Q('LS');
  sp.innerHTML=gs.spectators?.length?`<div class="lbl mt8">👁️ İzleyiciler</div>`+gs.spectators.map(s=>`<div class="pi" style="opacity:.5">${avHTML(s.avatar,'sm','👁️')}<span class="pi-name"><span>${s.name}</span></span></div>`).join(''):'';
  Q('SP2').style.display=io2.id===gs.leaderId?'block':'none';
  // Admin Bot Paneli (sadece admin + lider)
  const bp2=Q('BOT_PANEL');
  if(bp2){
    const isAdminLeader = !!user?.isAdmin && me===gs.leaderId;
    bp2.style.display = isAdminLeader ? 'block' : 'none';
    if(isAdminLeader){
      const botCount = gs.players.filter(p=>p.isBot).length;
      const info=Q('BOT_INFO');
      if(info) info.textContent = botCount>0 ? `🤖 ${botCount} bot odada (${gs.players.length}/${20})` : `Henüz bot eklenmedi (${gs.players.length}/${20})`;
    }
  }
  // MK mod paneli (sadece lider)
  const mkPanel=Q('MK_MODE_PANEL');
  const isMK=!!gs.mkMode;
  if(mkPanel){
    mkPanel.style.display=isLeader?'block':'none';
    const mkBtn=Q('MK_MODE_BTN');
    if(mkBtn){
      mkBtn.innerHTML=isMK
        ?'&#x2B21; Oyun Modu: MATRIX KRALLIĞI <span style="font-size:.6rem;background:rgba(255,150,0,.2);border:1px solid rgba(255,150,0,.5);color:#f39c12;padding:1px 5px;border-radius:3px;font-family:Fira Code,monospace;letter-spacing:1px;vertical-align:middle">DEMO</span>'
        :'&#x2B21; Oyun Modu: Standart AZAP';
      mkBtn.style.borderColor=isMK?'rgba(0,200,255,.7)':'rgba(0,200,255,.35)';
      mkBtn.style.background=isMK?'rgba(0,200,255,.15)':'rgba(0,200,255,.06)';
      mkBtn.style.color=isMK?'#00ffff':'rgba(0,200,255,.85)';
    }
  }
  // Ayarlar paneli: standart AZAP vs Matrix Kralliği
  const sp2Azap=Q('SP2_AZAP'), sp2Mk=Q('SP2_MK');
  if(sp2Azap) sp2Azap.style.display=isMK?'none':'block';
  if(sp2Mk)   sp2Mk.style.display=isMK?'block':'none';
  // MK baslatma için min 5 oyuncu, standart 4
  Q('BS').disabled=isMK?gs.players.length<5:gs.players.length<4;
  // Voice speaking class'larını hemen uygula (flash önleme)
  if(typeof _applyVoiceClassesToCards==='function') _applyVoiceClassesToCards();
  // Altın Havuzu paneli sadece login olmuş ve oyuncu olarak katılmış kişiye görünür
  const bp=Q('BET_PANEL');
  if(bp){
    const isPlayer = gs.players.some(p=>p.id===me);
    bp.style.display = (user && isPlayer && !gs.mkMode) ? 'block' : 'none';
    const bmc=Q('BET_MY_COINS');
    if(bmc && user) bmc.textContent='💰 ' + (user.coins||0);
  }
}

function renderRole(){
  if(!ps)return;Q('RE').textContent=ps.roleEmoji;Q('RN').textContent=ps.roleName;
  const t=Q('RT');t.textContent=ps.team.toUpperCase();t.className='rtag '+ps.team;
  Q('RD').textContent=ps.roleDesc;
  const x=Q('RX');
  if(ps.teammates?.length){
    x.innerHTML=`<div style="padding:8px;background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.25);border-radius:5px">
      <div class="lbl" style="color:var(--hain)">🧛 Hain Takımın</div>
      <div style="font-size:.7rem;color:var(--dim);margin-bottom:4px;font-style:italic">Rolleri sen de bilmiyorsun.</div>
      ${ps.teammates.map(t=>`<div style="display:flex;align-items:center;gap:6px;font-size:.85rem;margin:3px 0">${avHTML(t.avatar,'sm')}<span style="color:var(--hain);font-weight:600">🧛 ${t.name}</span></div>`).join('')}</div>`;
  } else if(ps.cellatTarget){
    x.innerHTML=`<div style="padding:8px;background:rgba(211,84,0,.06);border:1px solid rgba(211,84,0,.15);border-radius:5px">
      <div class="lbl" style="color:var(--tarafsiz)">⛓️ Hedefin: <strong>${ps.cellatTarget}</strong></div></div>`;
  } else if(ps.koruyucuTarget){
    x.innerHTML=`<div style="padding:8px;background:rgba(46,204,113,.08);border:1px solid rgba(46,204,113,.25);border-radius:5px">
      <div class="lbl" style="color:#2ecc71">😇 Koruman Gereken: <strong>${ps.koruyucuTarget}</strong></div>
      <div style="font-size:.7rem;color:var(--dim);margin-top:4px">Hayatta kalırsa sen de kazanırsın!</div></div>`;
  } else x.innerHTML='';
}

function renderNight(){
  if(!ps||!gs)return;nsent=false;sel1=null;sel2=null;selG=null;window._bombMode='place';theme(false);
  if(!_cosmeticCatalog){loadCosmeticCatalog().then(()=>{if(gs?.phase==='night')renderNight();});}
  Q('NR').textContent='Tur '+gs.round;Q('NE').textContent=ps.roleEmoji;Q('NN').textContent=ps.roleName;
  const r=ps.role,isH=ps.team==='hain',isSK=r==='seri_katil';

  const labels={doktor:ps.doktorSelfUsed?'Korumak istediğin kişiyi seç':'Korumak istediğin kişiyi seç (kendini 1 kez koruyabilirsin)',polis:'Engellemek istediğin kişiyi seç',
    savci:ps.savciUsed?'Sorgulama hakkını kullandın':'Rolünü öğrenmek istediğin kişiyi seç',
    gazeteci:'Kontrol etmek istediğin kişiyi seç',
    psikolog:'Kontrol etmek istediğin kişiyi seç',gazi:'Ölümsüzlük kalkanını aktive et',
    dedikoducu:'Karşılaştırmak istediğin iki kişiyi seç',ajan:'İncelemek istediğin kişiyi seç',
    serif:ps.serifUsed?'Silahını zaten kullandın':'Kimi vurmak istiyorsun? (TEK KULLANIM!)',
    kurban:'Pasif rol. Aksiyonun yok.',
    cilingir:'Kimi evine kilitlemek istiyorsun?',
    demirci:'Kime Çelik Zırh giydirmek istiyorsun? (kendine yapamazsın)',
    buzcu: (ps.buzcuLeft!==undefined && ps.buzcuLeft<=0) ? 'Karantina hakkın bitti.' : `Karantinaya almak istediğin kişiyi seç (kalan: ${ps.buzcuLeft??2})`,
    koruyucu:'Pasif rol. Birinin koruyucususun.',
    infazci: (ps.infazExecutionsLeft??1) > 0 ? 'Zindana kapatmak istediğin kişiyi seç. İdam etmek istersen "İdam et" seçeneğini işaretle.' : 'Zindana kapatmak istediğin kişiyi seç (idam hakkın bitti).',
    gardiyan: ps.gardiyanUsed ? 'Sokağa Çıkma Yasağı hakkını kullandın.' : '🛡️ Bu gece Sokağa Çıkma Yasağı ilan etmek için butona bas (TEK KULLANIM!)',
    engizitor:'Pasif rol. Gündüz infaz et.',
    olumsuz:'Pasif rol. 1 kez canlanırsın.',
    kostebek:'İncelemek istediğin kişiyi seç (her gece)',
    virus:'Virüs bulaştırmak istediğin kişiyi seç (kendine yapamazsın)',
    pusucu:'Pusu kuracak mısın? Butona bas.',
    hacker: ps.hackerUsesLeft===0 ? 'Tüm hack haklarını kullandın.' : `Hacklemek istediğin bilgi rolünü seç (kalan: ${ps.hackerUsesLeft??2})`,
    veba:'Hastalık bulaştırmak istediğin kişiyi seç',
    suikastci:'Hedef seç ve rol tahmin et',hipnotizmaci:'Kimi hipnotize etmek istiyorsun?',
    bombaci:'Bomba koy veya patlatma',golge:'Kimi susturmak istiyorsun?',
    seri_katil:'Kimi öldürmek istiyorsun?',muhtar:'Gece aksiyonun yok.',
    dodo:'Gece aksiyonun yok.',cellat:'Hedefinin asılmasını bekle.',yamyam:'Yetenekler otomatik toplanır.'};
  Q('AL').textContent=labels[r]||'Hedef seç';

  if(r==='bombaci'){
    // Bombacı özel: kill yok, iki ayrı buton (Koy / Patlat)
    Q('AB2').style.display='none';
    Q('SAA').style.display='block';
  } else if(isH||isSK){Q('AB2').style.display='flex';Q('SAA').style.display='none';
    if(isSK){Q('BA').style.display='none';Q('BK').style.display='block';}
    else{Q('BA').style.display='block';Q('BK').style.display='block';}
  }else if(ps.hasNightAction&&!['muhtar','dodo','cellat','yamyam','kurban','koruyucu','engizitor','olumsuz'].includes(r)){
    Q('AB2').style.display='none';Q('SAA').style.display='block';
  }else{Q('AB2').style.display='none';Q('SAA').style.display='none';}

  Q('BK').textContent='🗡️ Öldür';Q('BK').disabled=true;
  Q('BA').textContent='✨ Yetenek';Q('BA').disabled=true;
  Q('BSA').textContent='Onayla';Q('BSA').disabled=true;

  const hca=Q('HCA');
  if(isH){
    // Bombacı kill yapamaz - kill oyları kısmı gösterilmez
    const killVotesHtml = r==='bombaci' ? '' : `<div class="hkv" id="HKVB"><div class="hkv-t">🗡️ Hain Kill Oyları (canlı)</div><div id="HKV_LIST">Henüz oy yok.</div></div>`;
    hca.innerHTML=killVotesHtml + `<div class="hc mt8" id="HCB"><div class="hc-t">🧛 Hain Sohbeti</div><div id="HCM"></div></div>
    <div class="hci"><input class="inp" id="HCI" placeholder="Mesaj..." onkeypress="if(event.key==='Enter')sendHC()">
    <button class="b bs b2" onclick="sendHC()">→</button></div>`;
    if(ps.hainKillVotes && r!=='bombaci')renderHKV(ps.hainKillVotes);
  }
  else hca.innerHTML='';

  renderTL();renderEA();updAB();
}

function renderTL(){
  const list=Q('NTL');if(!gs||!ps)return;
  if(!_cosmeticCatalog){loadCosmeticCatalog().then(()=>{if(gs?.phase==='night')renderTL();});}
  const r=ps.role;
  if(['muhtar','dodo','cellat','yamyam','kurban','koruyucu','engizitor','olumsuz'].includes(r)){
    if(r==='koruyucu'&&ps.koruyucuTarget){
      list.innerHTML=`<div class="tc" style="padding:16px;color:#2ecc71"><div>😇 Koruman Gereken: <strong>${ps.koruyucuTarget}</strong></div><div style="font-size:.75rem;color:var(--dim);margin-top:6px">O hayatta kalırsa sen de kazanırsın!</div></div>`;return;
    }
    list.innerHTML=`<div class="tc" style="padding:16px;color:var(--dim)">${r==='yamyam'&&ps.yamyamAbilities?.length?'Toplanan: '+ps.yamyamAbilities.join(', '):'Bu gece aksiyonun yok.'}</div>`;return;}
  if(r==='gazi'){
    list.innerHTML=ps.gaziUsed?'<div class="tc" style="padding:16px;color:var(--dim)">Hakkını kullandın.</div>'
      :'<div class="tc" style="padding:16px"><div style="font-size:2rem">🛡️</div><div class="mt8" style="color:var(--dim)">Kalkanı aktive et</div></div>';return;}
  if(r==='savci'&&ps.savciUsed){list.innerHTML='<div class="tc" style="padding:16px;color:var(--dim)">Sorgulama hakkın bitti.</div>';
    Q('SAA').style.display='none';return;}
  if(r==='serif'&&ps.serifUsed){list.innerHTML='<div class="tc" style="padding:16px;color:var(--dim)">Silahını zaten kullandın.</div>';
    Q('SAA').style.display='none';return;}

  // Gardiyan özel UI: tek butonla aktivasyon
  if(r==='gardiyan'){
    if(ps.gardiyanUsed){
      list.innerHTML='<div class="tc" style="padding:16px;color:var(--dim)">Sokağa Çıkma Yasağı hakkını kullandın.</div>';
      Q('SAA').style.display='none';
      return;
    }
    list.innerHTML=`<div class="tc" style="padding:16px">
      <div style="font-size:2rem">🛡️</div>
      <div class="mt8" style="color:var(--dim);font-size:.85rem">Bu gece SOKAĞA ÇIKMA YASAĞI ilan etmek için onayla.<br>Hiç kimse zarar görmez (TEK KULLANIM).</div>
    </div>`;
    sel1 = me; // Onayla butonunu aktif et
    return;
  }
  // Pusucu özel UI: tek butonla pusu kur
  if(r==='pusucu'){
    list.innerHTML=`<div class="tc" style="padding:16px">
      <div style="font-size:2rem">🪤</div>
      <div class="mt8" style="color:var(--dim);font-size:.85rem">Pusu kurmak için onayla.<br>Bu gece evine gelen oyunculardan biri rastgele ölür.</div>
    </div>`;
    // sel1'i kendi id'ye set et ki onay aktif olsun
    sel1 = me;
    return;
  }

  // Bombacı özel UI: 2 ayrı buton (Bomba Koy / Patlat)
  if(r==='bombaci'){
    const myBombs = ps.myBombs || [];
    const oldBombs = myBombs.filter(()=>true); // tüm bombalar (önceki turlardan)

    // Bomba listesi (varsa göster)
    const bombListHtml = myBombs.length > 0
      ? `<div style="padding:8px;background:rgba(192,57,43,.1);border:1px solid rgba(192,57,43,.3);border-radius:5px;margin-bottom:10px">
          <div style="font-size:.78rem;color:var(--hain);margin-bottom:4px">💣 Yerleştirdiğin bombalar:</div>
          ${myBombs.map(bid=>{
            const bp=gs.players.find(pp=>pp.id===bid);
            return bp ? `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(0,0,0,.3);padding:3px 8px;border-radius:4px;margin:2px;font-size:.82rem">💣 ${bp.name}</span>` : '';
          }).join('')}
        </div>`
      : '';

    // Aktif mod (place / detonate)
    const mode = window._bombMode || 'place';

    // Hedef listesi (sadece place modunda)
    let targetListHtml = '';
    if(mode === 'place'){
      const isHain=ps?.team==='hain';
      const teammateIds = new Set();
      if(isHain && ps.teammates) ps.teammates.forEach(t=>teammateIds.add(t.id));
      const myBombSet = new Set(myBombs);
      const alive = gs.players.filter(p=>p.isAlive&&p.id!==me);
      targetListHtml = `<div class="lbl">Bomba koymak istediğin kişi:</div>` +
        alive.map(p=>{
          const isT = teammateIds.has(p.id);
          const has = myBombSet.has(p.id);
          const sel = p.id===sel1?'sel':'';
          const ns = isT ? 'color:var(--hain);font-weight:600' : '';
          const isMe = p.id===me;
          return `<div class="tb ${sel}" data-bid="${p.id}" onclick="selBombTarget('${p.id}')">
            ${cosmeticPlayerAvatarHTML(p,'sm',isMe)}<span class="tb-name">${cosmeticPlayerNameHTML(p,isMe,`${isT?' 🧛':''}${has?' <span style="color:var(--hain)">💣</span>':''}`,ns)}${p.isPresident?'<span class="crown">👑</span>':''}</span>
          </div>`;
        }).join('');
    } else {
      targetListHtml = `<div style="padding:14px;text-align:center;color:var(--dim);background:var(--bg2);border-radius:5px">
        <div style="font-size:1.5rem">💥</div>
        <div class="mt8">${myBombs.length>0?`Tüm bombalarını patlat (${myBombs.length} kişi)`:'Hiç bomba koymadın!'}</div>
      </div>`;
    }

    list.innerHTML = bombListHtml + `
      <div style="display:flex;gap:6px;margin-bottom:10px">
        <button class="b ${mode==='place'?'b1':'b2'} bs" style="flex:1" onclick="setBombMode('place')">💣 Bomba Koy</button>
        <button class="b ${mode==='detonate'?'b1':'b2'} bs" style="flex:1" onclick="setBombMode('detonate')" ${myBombs.length===0?'disabled':''}>💥 Patlat</button>
      </div>
    ` + targetListHtml;
    // BSA butonunun durumunu doğrudan ayarla — daima enabled (validation conf'ta)
    const bsa = Q('BSA');
    if(bsa){
      if(mode==='place'){
        bsa.textContent = sel1 ? '💣 Bomba Koy' : '💣 Önce Hedef Seç';
        bsa.disabled = false;
      } else {
        bsa.textContent = myBombs.length>0 ? '💥 Tüm Bombaları Patlat' : '💥 (Bomba Yok)';
        bsa.disabled = false;
      }
    }
    return;
  }

  // İnfazcı: hedef listesi + idam et seçeneği
  if(r==='infazci'){
    // Önce hedef listesi normal şekilde render edilir (sonra altta idam checkbox)
    // bu özel UI buton'ın altına idam checkbox koyacağız
    // sel1 set edildikten sonra idam onay kutusu görünür
    setTimeout(()=>{
      const saa = Q('SAA');
      if(!saa) return;
      const left = ps.infazExecutionsLeft ?? 1;
      // Idam checkbox HTML
      let infazUI = Q('INFAZ_UI');
      if(!infazUI){
        infazUI = document.createElement('div');
        infazUI.id = 'INFAZ_UI';
        infazUI.style.cssText = 'margin:8px 0;padding:8px;background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.3);border-radius:5px;font-size:.78rem';
        saa.parentNode.insertBefore(infazUI, saa);
      }
      if(left > 0){
        infazUI.innerHTML = `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;color:var(--hain)">
          <input type="checkbox" id="INFAZ_EXEC" onchange="window._infazExecute=this.checked;updAB()"> 
          🔨 İdam et (kalan: ${left}, GERİ ALINAMAZ!)
        </label>`;
      } else {
        infazUI.innerHTML = '<span style="color:var(--dim)">İdam hakkın bitti — sadece zindana atabilirsin.</span>';
      }
    }, 50);
  } else {
    // İnfazcı dışı: temizle
    const u = Q('INFAZ_UI');
    if(u) u.remove();
    window._infazExecute = false;
  }

  // Doktor kendini koruyabilir (1 kez), bu yüzden kendi de listede olsun
  const allowSelf = r==='doktor' && !ps.doktorSelfUsed;
  const alive=gs.players.filter(p=>p.isAlive && (p.id!==me || allowSelf));
  const isHain=ps?.team==='hain';
  // Hain ise: diğer hain takım arkadaşlarının id'lerini topla
  const teammateIds = new Set();
  if(isHain && ps.teammates){
    ps.teammates.forEach(t=>teammateIds.add(t.id));
  }
  // Bombacı: kendi bombalarını işaretle
  const myBombIds = new Set(ps.myBombs || []);
  // Cellat: kendi hedefini işaretle (sadece cellat görür)
  const cellatTargetId = r==='cellat' ? ps.cellatTargetId : null;
  list.innerHTML='';
  alive.forEach(p=>{
    const s=p.id===sel1||p.id===sel2;
    const isTeammate = teammateIds.has(p.id);
    const hasBomb = myBombIds.has(p.id);
    const isCellatTarget = p.id===cellatTargetId;
    const isMe = p.id===me;
    const d=document.createElement('div');d.className='tb'+(s?' sel':'');
    const nameStyle = isTeammate ? 'color:var(--hain);font-weight:600' : (isCellatTarget ? 'color:var(--tarafsiz);font-weight:600' : (isMe ? 'color:var(--hi);font-weight:600' : ''));
    const bombIcon = hasBomb ? ' <span style="color:var(--hain);" title="Bomba kondu">💣</span>' : '';
    const cellatIcon = isCellatTarget ? ' <span style="color:var(--tarafsiz)" title="Cellat hedefin">⛓️</span>' : '';
    const meTag = isMe ? ' <span style="font-size:.7rem;color:var(--hi)">(SEN — TEK KULLANIM!)</span>' : '';
    d.innerHTML=`${cosmeticPlayerAvatarHTML(p,'sm',isMe)}<span class="tb-name">${cosmeticPlayerNameHTML(p,isMe,`${isTeammate?' 🧛':''}${cellatIcon}${bombIcon}${meTag}`,nameStyle)}${p.isPresident?'<span class="crown">👑</span>':''}</span>`;
    d.onclick=()=>selT(p.id);list.appendChild(d);
  });
}

function renderEA(){
  const a=Q('EA');
  // Bombacı için ayrı UI renderTL'de var — burada gösterme
  a.innerHTML='';
}

// Bombacı yardımcıları
window._bombMode = 'place';
function setBombMode(m){
  window._bombMode = m;
  if(m==='detonate'){sel1=null;sel2=null;}
  renderTL();
  updAB();
}
function selBombTarget(pid){
  sel1 = sel1===pid ? null : pid;
  renderTL();
  updAB();
}

function renderHKV(votes){
  const list=Q('HKV_LIST');
  if(!list||!gs)return;
  const entries=Object.entries(votes||{});
  if(!entries.length){list.innerHTML='<div class="hkv-r" style="font-style:italic">Henüz oy yok.</div>';return;}
  list.innerHTML=entries.map(([hid,tid])=>{
    const h=gs.players.find(p=>p.id===hid),t=gs.players.find(p=>p.id===tid);
    if(!h||!t)return '';
    return `<div class="hkv-r"><strong style="color:var(--hain)">${h.name}</strong> → ${t.name}</div>`;
  }).join('');
}

function renderReport(reps){
  Q('RR').textContent='Tur '+(gs?.round||1);
  const l=Q('RL');
  // Şafak efekti: gece→sabah geçişi
  const dawn=Q('DAWN');
  dawn.classList.add('active');
  setTimeout(()=>dawn.classList.remove('active'),8000);
  if(!reps?.length){l.innerHTML='<div class="rep" style="border-left-color:var(--dim)">Sakin bir gece. Rapor yok.</div>';return;}
  l.innerHTML=reps.map((r,i)=>`<div class="rep" style="animation-delay:${i*.12}s">${r.i} ${r.t}</div>`).join('');
}

function openHistoryModal(){
  const history = ps?.myRoundHistory;
  if(!history?.length){
    toast('Henüz geçmiş rapor yok.',0);
    return;
  }
  const tabs = Q('HISTORY_TABS');
  const content = Q('HISTORY_CONTENT');
  let activeRound = history[history.length-1].round;

  function renderRound(entry){
    const deathStr = entry.deaths?.length
      ? entry.deaths.map(d=>d.name).join(', ') + ' hayatını kaybetti.'
      : 'Herkes sağ salim uyandı.';
    const reportsHtml = entry.reports?.length
      ? entry.reports.map(r=>`<div class="rep" style="margin:4px 0;animation:none">${r.i||''} ${r.t}</div>`).join('')
      : '<div style="color:var(--dim);font-size:.82rem;padding:6px 0">Rapor yok.</div>';
    content.innerHTML = `
      <div style="padding:6px 0 10px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">
          <span style="font-size:1.2rem">💀</span>
          <span style="font-size:.85rem;color:var(--dim)">${deathStr}</span>
        </div>
        <div style="font-size:.78rem;color:var(--dim);margin-bottom:6px;font-weight:600;letter-spacing:.5px">KİŞİSEL RAPORLAR</div>
        ${reportsHtml}
      </div>`;
  }

  function renderTabs(){
    tabs.innerHTML = history.map(e=>{
      const active = e.round===activeRound;
      return `<button onclick="window._histTab(${e.round})" style="flex-shrink:0;padding:4px 10px;border-radius:20px;border:1px solid var(--brd);background:${active?'var(--hi)':'var(--bg2)'};color:${active?'#fff':'var(--txt)'};font-size:.78rem;cursor:pointer">Tur ${e.round}</button>`;
    }).join('');
  }

  window._histTab = (round)=>{
    activeRound = round;
    renderTabs();
    const entry = history.find(e=>e.round===round);
    if(entry) renderRound(entry);
  };

  renderTabs();
  const activeEntry = history.find(e=>e.round===activeRound);
  if(activeEntry) renderRound(activeEntry);
  openModal('MDL_HISTORY');
}

function renderDay(){
  if(!gs)return;theme(true);
  if(!_cosmeticCatalog){loadCosmeticCatalog().then(()=>{if(gs?.phase==='day_discussion')renderDay();});}
  Q('DAY_PS').textContent=gs.presidentId?`Başkan: ${gs.players.find(p=>p.id===gs.presidentId)?.name||'-'} • Oylama yaklaşıyor...`:'Tartışın! Oylama 20 saniye sonra başlıyor...';
  Q('SM').innerHTML=ps?.isSilenced?'<div class="silban">🤐 Susturuldun! Bu tur konuşamazsın.</div>':'';
  const da=Q('DA');
  // Gece ölenler: backend'den gelen deadThisNight (gündüz ölenler dahil değil)
  const deadIds=gs.deadThisNight||[];
  if(deadIds.length){
    const names=deadIds.map(id=>gs.players.find(p=>p.id===id)?.name).filter(Boolean);
    da.innerHTML=`<div style="padding:11px;background:rgba(139,0,0,.08);border:1px solid rgba(139,0,0,.15);border-radius:5px;text-align:center">
      <div style="font-size:1.7rem">💀</div><div class="mt8"><strong>${names.join(', ')}</strong> gece hayatını kaybetti.</div></div>`;
  }
  else if(gs.round>1)da.innerHTML='<div style="padding:11px;background:rgba(39,174,96,.06);border:1px solid rgba(39,174,96,.15);border-radius:5px;text-align:center;color:var(--safe)">🌅 Herkes sağ salim uyandı!</div>';
  else da.innerHTML='';
  Q('DP').innerHTML='';
  const isHain2=ps?.team==='hain';
  const tmIds=new Set();
  if(isHain2&&ps.teammates)ps.teammates.forEach(t=>tmIds.add(t.id));
  // Cellat: kendi hedefi
  const cellatTargetId = ps?.role==='cellat' ? ps.cellatTargetId : null;
  gs.players.forEach(p=>{
    const isT=tmIds.has(p.id);
    const isMe=p.id===me;
    const isCT=p.id===cellatTargetId;
    const li=document.createElement('li');li.className='pi'+(p.isAlive?'':' dead')+(p.isPresident?' president':'');li.dataset.pid=p.id;
    const nameStyle=isT?'color:var(--hain);font-weight:600':(isCT?'color:var(--tarafsiz);font-weight:600':'');
    const meTag=isMe?' <span style="color:var(--hi);font-size:.62rem">(SEN)</span>':'';
    const ctIcon=isCT?' <span style="color:var(--tarafsiz)" title="Cellat hedefin">⛓️</span>':'';
    li.innerHTML=`${cosmeticPlayerAvatarHTML(p,'sm',isMe)}<span class="pi-name">${cosmeticPlayerNameHTML(p,isMe,`${meTag}${isT?' 🧛':''}${ctIcon}`,nameStyle)}${p.isPresident?'<span class="crown">👑</span>':''}</span>${!p.isAlive?'<span style="font-size:.85rem">💀</span>':''}`;
    Q('DP').appendChild(li);
  });
  // Voice speaking class'larını hemen uygula (flash önleme)
  if(typeof _applyVoiceClassesToCards==='function') _applyVoiceClassesToCards();
  // Suikastçı floating butonu güncelle (gündüzde görünür)
  updateSuikastFloatingBtn();updateRoleInfoBtn();
}

// Suikast modal & floating buton mantığı
function updateSuikastFloatingBtn(){
  const btn=Q('SUIKAST_BTN_FLOAT');
  if(!btn)return;
  const isSuikastci = ps?.role==='suikastci' && ps?.isAlive;
  const inDayPhase = gs?.phase==='day_discussion' || gs?.phase==='voting';
  if(isSuikastci && inDayPhase){
    btn.classList.add('sh');
    btn.disabled = !!gs?.suikastUsedThisRound;
    btn.title = gs?.suikastUsedThisRound ? 'Bu tur zaten suikast denedin' : 'Suikast yap';
  } else {
    btn.classList.remove('sh');
  }
  // Engizitör butonu (sadece tartışma fazında, kullanılmadıysa)
  const ebtn = Q('ENGIZITOR_BTN_FLOAT');
  if(ebtn){
    const isEngizitor = ps?.role==='engizitor' && ps?.isAlive && !ps?.engizitorUsed;
    if(isEngizitor && gs?.phase==='day_discussion'){
      ebtn.style.display='flex';
    } else {
      ebtn.style.display='none';
    }
  }
  // Floating sabotaj butonu (hain takım, gece fazında)
  const sbtn = Q('SABOTAJ_BTN_FLOAT');
  if(sbtn){
    const isHain = ps?.team === 'hain' && ps?.isAlive;
    if(isHain && gs?.phase === 'night'){
      sbtn.style.display='flex';
      if(ps?.sabotageVoted){
        sbtn.style.background='linear-gradient(135deg,#a04020,#c25030)';
        sbtn.style.boxShadow='0 0 12px rgba(192,80,40,.5)';
        sbtn.title='Sabotaj oyunu geri çek';
      } else {
        sbtn.style.background='linear-gradient(135deg,#5e2c1c,#8e3a1a)';
        sbtn.style.boxShadow='';
        sbtn.title='Sabotaj oyu ver';
      }
    } else {
      sbtn.style.display='none';
    }
  }
  // Mini Oyun butonu kaldırıldı
  const mgBtn = Q('MINIGAME_BTN_FLOAT');
  if(mgBtn) mgBtn.style.display='none';
}

// Sahte mini oyun (eğlence — coin yok, sabotaj sırası dışı)
function openFakeMinigame(){
  if(!confirm('🎮 Mini Oyun (Eğlence)\n\nBilgisayara karşı sahte mini oyun. Coin kazanamazsın, sadece eğlence amaçlı. Devam?'))return;
  // Rastgele oyun seç
  const games = ['xox','rps','colorword'];
  const gType = games[Math.floor(Math.random()*games.length)];
  // Sahte oyun ayar
  Q('SABO_OV').classList.add('sh');
  Q('SABO_SUB').textContent = '🎮 Eğlence Modu — Coin yok';
  window._saboFakeMode = true;
  if(gType === 'xox') initXOX();
  else if(gType === 'rps') initRPS();
  else if(gType === 'colorword') initColorWord();
}

function toggleSabotage(){
  const isVoted = ps?.sabotageVoted;
  const msg = isVoted
    ? '🚨 Sabotaj oyunu geri çekmek istediğine emin misin?'
    : '🚨 SABOTAJ\nGündüz rastgele bir anda 2-3 oyuncuya mini oyun gelir. Senin oyun yeterli (1 hain). Devam?';
  if(!confirm(msg))return;
  io2.emit('sabotage:vote', null, r => {
    if(r?.ok){
      const m = r.voted
        ? '✅ Sabotaj oyu verildi'
        : '⏪ Sabotaj oyun geri alındı';
      toast(m);
    }
  });
}

// Sabotaj durum güncellemesi (hain takımına özel)
io2.on('sabotage:update', d => {
  const sbtn = Q('SABOTAJ_BTN_FLOAT');
  if(sbtn){
    sbtn.title = `Sabotaj: ${d.totalVotes}/${d.neededVotes} hain oy verdi`;
  }
});

// Genel toast event (server tarafından gönderilen)
io2.on('toast', d => {
  if(d?.msg) toast(d.msg, d.type === 'error' ? 1 : 0);
});

// ── SABOTAJ MİNİ OYUNLAR ──
let _saboGame = null;
let _saboShown = false;
let _saboStarted = false;
let _saboDeathToasted = false;
let _saboPromptTimer = null;
let _saboCountdownInterval = null;

function sabotageCheck(){
  if(!ps?.sabotageGame || ps.sabotageGame.completed){
    if(ps?.sabotageGame?.status === 'timeout' && !ps?.isAlive && !_saboDeathToasted){
      _saboDeathToasted = true;
      toast('💀 Öldün!', 1);
    }
    Q('SABO_OV').classList.remove('sh');
    _saboShown = false;
    _saboStarted = false;
    if(_saboCountdownInterval){clearInterval(_saboCountdownInterval);_saboCountdownInterval=null;}
    const cdEl=Q('SABO_COUNTDOWN');if(cdEl)cdEl.textContent='';
    if(_saboPromptTimer){clearTimeout(_saboPromptTimer);_saboPromptTimer=null;}
    return;
  }
  if(gs?.phase !== 'morning_report' && gs?.phase !== 'day_discussion' && gs?.phase !== 'voting') return;
  if(_saboShown) return;
  const promptAt = ps.sabotageGame.promptAt || Date.now();
  const wait = Math.max(0, promptAt - Date.now());
  if(_saboPromptTimer) return;
  _saboPromptTimer = setTimeout(() => {
    _saboPromptTimer = null;
    // Hâlâ aktif mi (faz değişti mi, sabotaj sona erdi mi)
    if(!ps?.sabotageGame || ps.sabotageGame.completed) return;
    if(gs?.phase !== 'morning_report' && gs?.phase !== 'day_discussion' && gs?.phase !== 'voting') return;
    _saboShown = true;
    startSabotageGame(ps.sabotageGame.gameType);
  }, wait);
}

function startSabotageGame(gameType){
  Q('SABO_OV').classList.add('sh');
  _saboStarted = false;
  if(!window._saboFakeMode){
    const dl = ps?.sabotageGame?.deadlineAt;
    if(dl) _startSaboCountdown(dl);
  }
  const sub = Q('SABO_SUB');
  if(gameType === 'xox'){
    sub.textContent = 'XOX — Bilgisayara karşı kazanmaya çalış!';
    initXOX();
  } else if(gameType === 'rps'){
    sub.textContent = 'Taş Kağıt Makas — Üst üste 2 raunt kazan!';
    initRPS();
  } else if(gameType === 'colorword'){
    sub.textContent = 'Renk Yaz — Yazıdaki RENGE bas, kelimeye değil!';
    initColorWord();
  }
}

function _startSaboCountdown(deadline){
  if(_saboCountdownInterval){clearInterval(_saboCountdownInterval);_saboCountdownInterval=null;}
  const el=Q('SABO_COUNTDOWN');
  const isHain = ps?.team === 'hain';
  const tick = () => {
    if(!el) return;
    const left = Math.ceil((deadline - Date.now()) / 1000);
    if(left <= 0){
      clearInterval(_saboCountdownInterval);
      _saboCountdownInterval = null;
      if(!_saboStarted && !isHain){
        el.textContent = '💀 Süre doldu!';
        el.style.color = '#c0392b';
      } else {
        el.textContent = '';
      }
      return;
    }
    el.textContent = isHain ? `⏰ ${left}s (hain: ölüm yok)` : `⚠️ ${left}s içinde başla veya ölürsün!`;
    el.style.color = left <= 3 ? '#c0392b' : left <= 5 ? '#f39c12' : '#e0e0e0';
  };
  tick();
  _saboCountdownInterval = setInterval(tick, 500);
}

function saboMarkStarted(){
  if(_saboStarted) return;
  _saboStarted = true;
  if(_saboCountdownInterval){clearInterval(_saboCountdownInterval);_saboCountdownInterval=null;}
  const el=Q('SABO_COUNTDOWN');if(el)el.textContent='';
  if(!window._saboFakeMode){
    io2.emit('sabotage:begin', null, ()=>{});
  }
}

function sabotageSkip(){
  if(window._saboFakeMode){
    if(!confirm('Mini oyunu kapatmak istiyor musun?'))return;
    window._saboFakeMode = false;
    Q('SABO_OV').classList.remove('sh');
    _saboShown = false;
    return;
  }
  if(!confirm('Mini oyunu geçmek istiyor musun? (kaybetmiş sayılırsın)'))return;
  io2.emit('sabotage:result', { won: false }, ()=>{
    Q('SABO_OV').classList.remove('sh');
    _saboShown = false;
  });
}

function sabotageEnd(won){
  // Sahte mod: server'a kayıt yok
  if(window._saboFakeMode){
    window._saboFakeMode = false;
    setTimeout(()=>{
      Q('SABO_OV').classList.remove('sh');
      _saboShown = false;
    }, 1500);
    return;
  }
  io2.emit('sabotage:result', { won }, ()=>{
    setTimeout(()=>{
      Q('SABO_OV').classList.remove('sh');
      _saboShown = false;
    }, 1500);
  });
}

// ── XOX (Tic Tac Toe) ──
function initXOX(){
  _saboGame = { board: Array(9).fill(null), playerSymbol: 'X', aiSymbol: 'O', turn: 'player' };
  renderXOX();
}

function renderXOX(){
  const g = _saboGame;
  const status = g.winner === 'player' ? '🎉 Kazandın!' : g.winner === 'ai' ? '💀 Kaybettin!' : g.winner === 'draw' ? '🤝 Berabere!' : (g.turn === 'player' ? 'Senin sıran (X)' : 'Bilgisayar düşünüyor...');
  let html = `<div class="xox-status">${status}</div><div class="xox-board">`;
  g.board.forEach((cell, i) => {
    const cls = cell ? `taken ${cell.toLowerCase()}` : '';
    html += `<div class="xox-cell ${cls}" onclick="xoxClick(${i})">${cell || ''}</div>`;
  });
  html += '</div>';
  Q('SABO_BODY').innerHTML = html;
}

function xoxClick(i){
  const g = _saboGame;
  if(g.winner || g.turn !== 'player' || g.board[i]) return;
  saboMarkStarted();
  g.board[i] = g.playerSymbol;
  const w = xoxCheckWin();
  if(w){ g.winner = w; renderXOX(); sabotageEnd(w === 'player'); return; }
  g.turn = 'ai';
  renderXOX();
  setTimeout(xoxAI, 600);
}

function xoxAI(){
  const g = _saboGame;
  if(g.winner) return;
  // Basit AI: kazanma → blokla → ortaya/köşeye
  let move = xoxBestMove(g.aiSymbol) || xoxBestMove(g.playerSymbol);
  if(move === null){
    // Orta varsa orta, yoksa rastgele boş köşe
    if(g.board[4] === null) move = 4;
    else {
      const corners = [0,2,6,8].filter(i => g.board[i] === null);
      if(corners.length) move = corners[Math.floor(Math.random()*corners.length)];
      else {
        const empty = g.board.map((v,i)=>v===null?i:-1).filter(i=>i>=0);
        move = empty[Math.floor(Math.random()*empty.length)];
      }
    }
  }
  if(move !== null){
    g.board[move] = g.aiSymbol;
    const w = xoxCheckWin();
    if(w){ g.winner = w; renderXOX(); sabotageEnd(w === 'player'); return; }
    g.turn = 'player';
    renderXOX();
  }
}

function xoxBestMove(symbol){
  const g = _saboGame;
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for(const [a,b,c] of lines){
    const cells = [g.board[a], g.board[b], g.board[c]];
    const symCount = cells.filter(x => x === symbol).length;
    const emptyIdx = [a,b,c][cells.findIndex(x => x === null)];
    if(symCount === 2 && emptyIdx !== undefined && cells.filter(x=>x===null).length === 1) return emptyIdx;
  }
  return null;
}

function xoxCheckWin(){
  const g = _saboGame;
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for(const [a,b,c] of lines){
    if(g.board[a] && g.board[a]===g.board[b] && g.board[b]===g.board[c]){
      return g.board[a] === g.playerSymbol ? 'player' : 'ai';
    }
  }
  if(!g.board.includes(null)) return 'draw';
  return null;
}

// ── TAŞ KAĞIT MAKAS ──
function initRPS(){
  _saboGame = { playerScore: 0, aiScore: 0, round: 1, maxRound: 3 };
  renderRPS();
}

function renderRPS(){
  const g = _saboGame;
  const html = `
    <div class="cw-score">Round ${g.round}/${g.maxRound} · Sen: ${g.playerScore} | AI: ${g.aiScore}</div>
    ${g.lastResult ? `<div class="rps-vs">${g.lastPlayerEmoji}<span class="vs">VS</span>${g.lastAiEmoji}</div>` : ''}
    ${g.lastResult ? `<div class="rps-result" style="color:${g.lastResult==='win'?'var(--safe)':g.lastResult==='lose'?'var(--hain)':'var(--dim)'}">${g.lastResult==='win'?'🎉 Kazandın!':g.lastResult==='lose'?'💀 Kaybettin!':'🤝 Berabere!'}</div>` : ''}
    <div class="rps-buttons">
      <button class="rps-btn" onclick="rpsPlay('rock')">🪨</button>
      <button class="rps-btn" onclick="rpsPlay('paper')">📄</button>
      <button class="rps-btn" onclick="rpsPlay('scissors')">✂️</button>
    </div>
  `;
  Q('SABO_BODY').innerHTML = html;
}

function rpsPlay(playerChoice){
  const g = _saboGame;
  if(g.gameOver) return;
  saboMarkStarted();
  const choices = ['rock','paper','scissors'];
  const aiChoice = choices[Math.floor(Math.random()*3)];
  const emoji = { rock:'🪨', paper:'📄', scissors:'✂️' };
  g.lastPlayerEmoji = emoji[playerChoice];
  g.lastAiEmoji = emoji[aiChoice];
  if(playerChoice === aiChoice){ g.lastResult = 'draw'; }
  else if(
    (playerChoice==='rock' && aiChoice==='scissors') ||
    (playerChoice==='paper' && aiChoice==='rock') ||
    (playerChoice==='scissors' && aiChoice==='paper')
  ){ g.playerScore++; g.lastResult = 'win'; }
  else { g.aiScore++; g.lastResult = 'lose'; }
  g.round++;
  if(g.round > g.maxRound){
    g.gameOver = true;
    renderRPS();
    sabotageEnd(g.playerScore > g.aiScore);
    return;
  }
  renderRPS();
}

// ── RENK YAZ (Stroop test) ──
function initColorWord(){
  _saboGame = {
    score: 0,
    target: 5, // kazanmak için doğru cevap
    timeLeft: 30,
    timerInterval: null
  };
  cwNextRound();
  _saboGame.timerInterval = setInterval(() => {
    _saboGame.timeLeft--;
    if(_saboGame.timeLeft <= 0){
      clearInterval(_saboGame.timerInterval);
      sabotageEnd(_saboGame.score >= _saboGame.target);
      Q('SABO_BODY').innerHTML = `<div class="xox-status">${_saboGame.score >= _saboGame.target ? '🎉 Tamam!' : '⏰ Süre doldu'}</div>`;
      return;
    }
    cwUpdateTimer();
  }, 1000);
}

function cwNextRound(){
  const colors = [
    {name:'KIRMIZI', color:'#e74c3c'},
    {name:'MAVİ', color:'#3498db'},
    {name:'YEŞİL', color:'#27ae60'},
    {name:'SARI', color:'#f1c40f'},
    {name:'MOR', color:'#9b59b6'},
    {name:'PEMBE', color:'#e91e63'}
  ];
  const wordObj = colors[Math.floor(Math.random()*colors.length)];
  // Renk yazı renginden farklı olsun
  let colorObj;
  do { colorObj = colors[Math.floor(Math.random()*colors.length)]; } while(colorObj.name === wordObj.name);

  // 3 seçenek: doğru cevap (renk) + 2 yanlış
  const wrongOptions = colors.filter(c => c.name !== colorObj.name);
  const options = [colorObj, ...wrongOptions.slice(0,2).sort(()=>Math.random()-0.5)].sort(()=>Math.random()-0.5);

  _saboGame.correctAnswer = colorObj.name;

  Q('SABO_BODY').innerHTML = `
    <div class="cw-timer">⏱️ ${_saboGame.timeLeft} saniye</div>
    <div class="cw-score">Doğru: ${_saboGame.score} / ${_saboGame.target}</div>
    <div class="cw-display" style="color:${colorObj.color}">${wordObj.name}</div>
    <div style="font-size:.78rem;color:var(--dim);text-align:center;margin-bottom:6px">YAZIDAKI RENGE bas, kelimeye değil!</div>
    <div class="cw-options">
      ${options.map(o => `<div class="cw-opt" style="color:${o.color};border-color:${o.color}" onclick="cwAnswer('${o.name}')">${o.name}</div>`).join('')}
    </div>
  `;
}

function cwUpdateTimer(){
  const t = document.querySelector('.cw-timer');
  if(t) t.textContent = `⏱️ ${_saboGame.timeLeft} saniye`;
}

function cwAnswer(answer){
  saboMarkStarted();
  if(answer === _saboGame.correctAnswer){
    _saboGame.score++;
    if(_saboGame.score >= _saboGame.target){
      clearInterval(_saboGame.timerInterval);
      Q('SABO_BODY').innerHTML = `<div class="xox-status">🎉 Tamam, başardın!</div>`;
      sabotageEnd(true);
      return;
    }
  } else {
    // Yanlış cevap: 2 saniye ceza
    _saboGame.timeLeft = Math.max(0, _saboGame.timeLeft - 2);
  }
  cwNextRound();
}

// Engizitör modal — tartışma fazında infaz
window._engizitorTarget = null;
function openEngizitorModal(){
  if(ps?.engizitorUsed){
    toast('Yeteneğini zaten kullandın!',1);
    return;
  }
  window._engizitorTarget = null;
  const list = Q('ENGIZITOR_TARGETS');
  list.innerHTML = '';
  gs.players.filter(p => p.isAlive && p.id !== me).forEach(p => {
    const d = document.createElement('div');
    d.className = 'tb';
    d.innerHTML = `${cosmeticPlayerAvatarHTML(p,'sm',false)}<span class="tb-name">${cosmeticPlayerNameHTML(p,false)}</span>`;
    d.onclick = () => {
      window._engizitorTarget = p.id;
      document.querySelectorAll('#ENGIZITOR_TARGETS .tb').forEach(el => el.classList.remove('sel'));
      d.classList.add('sel');
      Q('ENGIZITOR_CONFIRM').disabled = false;
    };
    list.appendChild(d);
  });
  Q('ENGIZITOR_CONFIRM').disabled = true;
  Q('ENGIZITOR_MODAL').classList.add('sh');
}
function confirmEngizitor(){
  if(!window._engizitorTarget){toast('Hedef seç!',1);return;}
  if(!confirm('Bu eylem GERİ ALINAMAZ! Hain/tarafsız değilse SEN ölürsün. Devam?'))return;
  io2.emit('engizitor', { targetId: window._engizitorTarget }, (r) => {
    if(r?.ok){
      Q('ENGIZITOR_MODAL').classList.remove('sh');
      toast('İnfaz gerçekleşti!');
    } else {
      toast(r?.err || 'İnfaz başarısız.',1);
    }
  });
}

// Rol bilgi badge ve modal
function updateRoleInfoBtn(){
  const btn=Q('ROLE_INFO_BTN');
  const guideBtn=Q('ROLE_GUIDE_BTN');
  const adminBtn=Q('ADMIN_BTN');
  if(!btn||!guideBtn)return;
  const inGame = gs && gs.phase!=='lobby' && gs.phase!=='auth' && gs.phase!=='post_game' && gs.phase!=='game_over';
  // Rol info badge — sadece oyun içindeyken ve rolü olan oyuncular
  if(inGame && ps?.role && !isSpec){
    btn.classList.add('sh');
    Q('ROLE_INFO_EMOJI').textContent = ps.roleEmoji || '🎭';
    Q('ROLE_INFO_NAME').textContent = ps.roleName || 'Rol';
    const teamColor = ps.team==='hain' ? 'var(--hain)' : ps.team==='tarafsız' ? 'var(--tarafsiz)' : 'var(--safe)';
    btn.style.borderColor = teamColor;
  } else {
    btn.classList.remove('sh');
  }
  // Rol rehberi butonu — oyun içinde her zaman göster
  if(inGame){
    guideBtn.classList.add('sh');
  } else {
    guideBtn.classList.remove('sh');
  }
  // Admin butonu — sadece admin oyuncular oyun içindeyken (oyun bakış)
  if(adminBtn){
    if(inGame && ps?.isAdmin){
      adminBtn.classList.add('sh');
    } else {
      adminBtn.classList.remove('sh');
    }
  }
  // Admin menü butonu — admin için her zaman (giriş yapmışsa)
  const adminMenuBtn=Q('ADMIN_MENU_BTN');
  if(adminMenuBtn){
    if(user?.isAdmin){
      adminMenuBtn.classList.add('sh');
    } else {
      adminMenuBtn.classList.remove('sh');
    }
  }
  // Report butonu artık ayarlar panelinde
  const reportBtn=Q('REPORT_BTN');
  if(reportBtn){
    if(user){
      reportBtn.style.display='none';
      setupReportImg();
    } else {
      reportBtn.style.display='none';
    }
  }
}

// Admin Bakış modal — tüm rolleri göster
function openAdminModal(){
  if(!ps?.isAdmin || !ps.adminAllRoles){
    toast('Admin yetkin yok ya da veri henüz gelmedi.',1);
    return;
  }
  const body=Q('ADMIN_BODY');
  // Takım gruplarına ayır
  const masum=ps.adminAllRoles.filter(p=>p.team==='masum');
  const hain=ps.adminAllRoles.filter(p=>p.team==='hain');
  const tarafsız=ps.adminAllRoles.filter(p=>p.team==='tarafsız');

  const renderRow = (p) => `
    <div class="admin-row t-${p.team}${!p.isAlive?' dead':''}">
      <span style="font-size:1.1rem">${p.roleEmoji}</span>
      <span><span class="name">${p.name}${p.id===me?' (SEN)':''}</span> ${!p.isAlive?'💀':''}</span>
      <span class="role">${p.roleName}</span>
      ${p.isInsane?'<span class="insane">DELİ</span>':''}
    </div>
  `;

  let html='';
  if(masum.length){html+=`<div style="font-size:.78rem;color:var(--safe);font-weight:600;margin:8px 0 4px">🌅 Masumlar (${masum.length})</div>`+masum.map(renderRow).join('');}
  if(hain.length){html+=`<div style="font-size:.78rem;color:var(--hain);font-weight:600;margin:8px 0 4px">🧛 Hainler (${hain.length})</div>`+hain.map(renderRow).join('');}
  if(tarafsız.length){html+=`<div style="font-size:.78rem;color:var(--tarafsiz);font-weight:600;margin:8px 0 4px">⚖️ Tarafsızlar (${tarafsız.length})</div>`+tarafsız.map(renderRow).join('');}

  // Cellat hedefi gibi ek bilgiler
  const cellat = ps.adminAllRoles.find(p=>p.roleId==='cellat' && p.cellatTargetName);
  if(cellat){
    html+=`<div style="margin-top:12px;padding:8px;background:rgba(41,128,185,.08);border-radius:4px;font-size:.78rem"><strong style="color:var(--tarafsiz)">⛓️ Cellat Hedefi:</strong> ${cellat.name} → <strong>${cellat.cellatTargetName}</strong></div>`;
  }

  body.innerHTML=html;
  Q('ADMIN_MODAL').classList.add('sh');
}

// ── ADMIN MENÜ (kullanıcı yönetimi + raporlar) ──
function openAdminMenuModal(){
  if(!user?.isAdmin){toast('Admin yetkin yok!',1);return;}
  Q('ADMIN_MENU_MODAL').classList.add('sh');
  amSwitchTab('users');
}
function amSwitchTab(tab){
  document.querySelectorAll('[data-amtab]').forEach(b=>b.classList.toggle('active',b.dataset.amtab===tab));
  Q('AM_USERS_PANE').style.display = tab==='users' ? 'block' : 'none';
  Q('AM_STATS_PANE').style.display = tab==='stats' ? 'block' : 'none';
  Q('AM_REPORTS_PANE').style.display = tab==='reports' ? 'block' : 'none';
  if(tab==='users') amLoadUsers();
  else if(tab==='stats') amLoadStats();
  else if(tab==='reports') amLoadReports();
}
function amToggleCreate(){
  const body=Q('AM_CREATE_BODY'), arrow=Q('AM_CREATE_ARROW');
  const open=body.classList.toggle('open');
  arrow.textContent=open?'▼':'▶';
}

// Site istatistikleri
function amLoadStats(){
  const body = Q('AM_STATS_BODY');
  body.innerHTML = 'Yükleniyor...';
  io2.emit('admin:siteStats', {}, r => {
    if(!r?.ok){body.innerHTML = `<div style="color:var(--hain)">${r?.err||'Hata'}</div>`;return;}
    const s = r.stats;
    body.innerHTML = `
      <div class="am-stats-grid">
        <div class="am-stat-card"><div class="am-stat-icon">👥</div><div class="am-stat-num">${s.users.total}</div><div class="am-stat-lbl">Kullanıcı</div></div>
        <div class="am-stat-card"><div class="am-stat-icon">👁️</div><div class="am-stat-num">${s.users.admins}</div><div class="am-stat-lbl">Admin</div></div>
        <div class="am-stat-card premium"><div class="am-stat-icon">👑</div><div class="am-stat-num">${s.users.premium}</div><div class="am-stat-lbl">Premium</div></div>
        <div class="am-stat-card live"><div class="am-stat-icon">🟢</div><div class="am-stat-num">${s.live.activeRooms}</div><div class="am-stat-lbl">Aktif Oda</div></div>
        <div class="am-stat-card live"><div class="am-stat-icon">🎮</div><div class="am-stat-num">${s.live.playersInRooms}</div><div class="am-stat-lbl">Aktif Oyuncu</div></div>
        <div class="am-stat-card finance"><div class="am-stat-icon">💝</div><div class="am-stat-num">₺${s.finance.totalDonations.toFixed(0)}</div><div class="am-stat-lbl">Toplam Bağış</div></div>
        <div class="am-stat-card gold"><div class="am-stat-icon">💰</div><div class="am-stat-num">${s.finance.totalCoins.toLocaleString('tr-TR')}</div><div class="am-stat-lbl">Toplam Altın</div></div>
        <div class="am-stat-card"><div class="am-stat-icon">🎯</div><div class="am-stat-num">${s.games.played}</div><div class="am-stat-lbl">Toplam Oyun</div></div>
        <div class="am-stat-card"><div class="am-stat-icon">🏆</div><div class="am-stat-num">${s.games.won}</div><div class="am-stat-lbl">Galibiyet</div></div>
        <div class="am-stat-card"><div class="am-stat-icon">❤️</div><div class="am-stat-num">${s.games.mvps}</div><div class="am-stat-lbl">MVP</div></div>
        <div class="am-stat-card"><div class="am-stat-icon">🐛</div><div class="am-stat-num">${s.reports.open}</div><div class="am-stat-lbl">Açık Bug</div></div>
        <div class="am-stat-card"><div class="am-stat-icon">✅</div><div class="am-stat-num">${s.reports.closed}</div><div class="am-stat-lbl">Çözülen Bug</div></div>
      </div>

      <div class="am-section-title">🎮 En Aktif Oyuncular</div>
      <div class="am-lb">
        ${s.topPlayers.length ? s.topPlayers.map((p,i)=>`
          <div class="am-lb-row${i<3?' top':''}">
            <span class="am-lb-rank">${i+1}</span>
            <span class="am-lb-name">${esc(p.username)}${p.premium?' 👑':''}</span>
            <span class="am-lb-stat">🎮 ${p.played}</span>
            <span class="am-lb-stat">🏆 ${p.won}</span>
            <span class="am-lb-stat" style="color:var(--gold)">💰 ${p.coins}</span>
          </div>
        `).join('') : '<div style="color:var(--dim);padding:12px;text-align:center;font-size:.8rem">Veri yok</div>'}
      </div>

      <div class="am-section-title">🏆 En Çok Kazananlar</div>
      <div class="am-lb">
        ${s.topWinners.length ? s.topWinners.map((p,i)=>`
          <div class="am-lb-row${i<3?' top':''}">
            <span class="am-lb-rank">${i+1}</span>
            <span class="am-lb-name">${esc(p.username)}</span>
            <span class="am-lb-stat">${p.won}/${p.played}</span>
            <span class="am-lb-stat" style="color:var(--safe)">%${p.winRate}</span>
          </div>
        `).join('') : '<div style="color:var(--dim);padding:12px;text-align:center;font-size:.8rem">Veri yok</div>'}
      </div>

      <div class="am-section-title">💝 En Çok Destekçiler</div>
      <div class="am-lb">
        ${s.topDonors.length ? s.topDonors.map((p,i)=>`
          <div class="am-lb-row${i<3?' top':''}">
            <span class="am-lb-rank">${i+1}</span>
            <span class="am-lb-name">${esc(p.username)}</span>
            <span class="am-lb-stat" style="color:#f06292;font-weight:700">₺${p.totalDonated.toFixed(0)}</span>
          </div>
        `).join('') : '<div style="color:var(--dim);padding:12px;text-align:center;font-size:.8rem">Henüz bağış yapan yok</div>'}
      </div>

      <div class="am-section-title">💰 En Zenginler</div>
      <div class="am-lb">
        ${s.topRichest.length ? s.topRichest.map((p,i)=>`
          <div class="am-lb-row${i<3?' top':''}">
            <span class="am-lb-rank">${i+1}</span>
            <span class="am-lb-name">${esc(p.username)}</span>
            <span class="am-lb-stat" style="color:var(--gold);font-weight:700">${p.coins.toLocaleString('tr-TR')} 💰</span>
          </div>
        `).join('') : '<div style="color:var(--dim);padding:12px;text-align:center;font-size:.8rem">Veri yok</div>'}
      </div>

      <div class="am-section-title">📅 Son 30 Gün Kayıtları</div>
      <div style="background:rgba(255,255,255,.02);border:1px solid var(--brd);border-radius:9px;padding:12px">
        ${s.registrationsByDay.length ? renderRegistrationChart(s.registrationsByDay) : '<div style="color:var(--dim);text-align:center;font-size:.8rem;padding:8px">Son 30 günde kayıt yok</div>'}
      </div>
    `;
  });
}

// Basit ASCII bar chart (kayıt sayısına göre)
function renderRegistrationChart(data){
  const max = Math.max(...data.map(d => d[1]), 1);
  return data.map(([day, count]) => {
    const width = (count / max) * 100;
    const dateStr = new Date(day).toLocaleDateString('tr-TR', {month:'short', day:'numeric'});
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:.78rem">
      <span style="width:60px;color:var(--dim);font-size:.7rem">${dateStr}</span>
      <div style="flex:1;background:var(--bg3);border-radius:3px;overflow:hidden;height:18px;position:relative">
        <div style="background:linear-gradient(90deg,#bb8fce,#8e44ad);width:${width}%;height:100%;border-radius:3px;transition:width .3s"></div>
        <span style="position:absolute;right:6px;top:50%;transform:translateY(-50%);font-size:.7rem;font-weight:700">${count}</span>
      </div>
    </div>`;
  }).join('');
}
let amAllUsers=[];
function amLoadUsers(){
  const list=Q('AM_USERS_LIST');
  list.innerHTML='<div style="color:var(--dim);padding:16px;text-align:center;font-size:.8rem">Yükleniyor...</div>';
  io2.emit('admin:listUsers',{},r=>{
    if(!r?.ok){list.innerHTML=`<div style="color:var(--hain);padding:12px">${r?.err||'Hata'}</div>`;return;}
    amAllUsers=r.users;
    amFilterUsers();
  });
}
function amFilterUsers(){
  const q=(Q('AM_SEARCH')?.value||'').toLowerCase().trim();
  const flt=Q('AM_FILTER')?.value||'all';
  const list=Q('AM_USERS_LIST'),countEl=Q('AM_USERS_COUNT');
  let users=amAllUsers.filter(u=>{
    if(q&&!u.username.toLowerCase().includes(q))return false;
    if(flt==='admin'&&!u.isAdmin)return false;
    if(flt==='premium'&&!u.premium?.active)return false;
    if(flt==='donor'&&!(u.totalDonated>0))return false;
    return true;
  });
  if(countEl)countEl.textContent=users.length!==amAllUsers.length?`${users.length} / ${amAllUsers.length} kullanıcı`:`${amAllUsers.length} kullanıcı`;
  if(!users.length){list.innerHTML='<div style="color:var(--dim);padding:20px;text-align:center;font-size:.8rem">Sonuç yok.</div>';return;}
  list.innerHTML=users.map(u=>{
    const avatarStyle=u.avatar?`background-image:url('${u.avatar}');background-color:transparent`:'';
    const initials=u.username?u.username[0].toUpperCase():'?';
    const premDays=u.premium?.daysLeft||0;
    return `<div class="am-user${u.isAdmin?' is-admin':''}">
      <div class="am-avatar" style="${avatarStyle}">${u.avatar?'':initials}</div>
      <div class="am-user-info">
        <div class="am-user-name">
          ${esc(u.username)}
          ${u.isAdmin?'<span class="am-badge admin">ADMIN</span>':''}
          ${u.premium?.active?`<span class="am-badge premium">PRE${premDays?' '+premDays+'g':''}</span>`:''}
          ${u.totalDonated>0?'<span class="am-badge donor">BAĞIŞÇI</span>':''}
        </div>
        <div class="am-user-meta">🏆 ${u.stats.won} &nbsp;🎮 ${u.stats.played} &nbsp;❤️ ${u.stats.mvp||0} &nbsp;<span style="color:var(--gold)">💰 ${u.coins??0}</span></div>
      </div>
      <div class="am-user-actions">
        <button class="am-btn info" onclick="amEditStats('${u.username}')" title="İstatistik düzenle">📊</button>
        <button class="am-btn" onclick="amEditCoins('${u.username}',${u.coins??0})" title="Coin yönet" style="color:var(--gold)">💰</button>
        <button class="am-btn${u.premium?.active?' active-st':''}" onclick="amSetPremium('${u.username}',${!!u.premium?.active})" title="${u.premium?.active?'Premium kaldır ('+(premDays)+' gün kaldı)':'Premium ver'}">👑</button>
        <button class="am-btn${u.totalDonated>0?' active-st-pink':''}" onclick="amSetDonor('${u.username}',${!(u.totalDonated>0)})" title="${u.totalDonated>0?'Bağışçı yetkisini kaldır':'Bağışçı yap'}">💝</button>
        <button class="am-btn" onclick="amResetPassword('${u.username}')" title="Şifre sıfırla" style="color:var(--dim)">🔑</button>
        <button class="am-btn${u.isAdmin?' active-st':''}" onclick="amToggleAdmin('${u.username}',${!u.isAdmin})" title="${u.isAdmin?'Admin yetkisini kaldır':'Admin yap'}">👁️</button>
        <button class="am-btn danger" onclick="amDeleteUser('${u.username}')" title="Hesabı sil">🗑️</button>
      </div>
    </div>`;
  }).join('');
}
function amCreateUser(){
  const u=Q('AM_NEW_U').value.trim();
  const p=Q('AM_NEW_P').value;
  const ad=Q('AM_NEW_ADMIN').checked;
  if(!u||!p){toast('Kullanıcı adı ve şifre boş bırakılamaz!',1);return;}
  io2.emit('admin:createUser',{username:u,password:p,isAdmin:ad},r=>{
    if(r.ok){
      toast('Hesap oluşturuldu!');
      Q('AM_NEW_U').value=''; Q('AM_NEW_P').value=''; Q('AM_NEW_ADMIN').checked=false;
      amLoadUsers();
    } else toast(r.err||'Hata!',1);
  });
}
function amDeleteUser(username){
  if(!confirm(`"${username}" hesabını silmek istediğine emin misin?`))return;
  io2.emit('admin:deleteUser',{username},r=>{
    if(r.ok){toast('Hesap silindi.');amLoadUsers();}
    else toast(r.err||'Hata!',1);
  });
}
function amToggleAdmin(username,makeAdmin){
  io2.emit('admin:toggleAdmin',{username,isAdmin:makeAdmin},r=>{
    if(r.ok){toast(makeAdmin?'Admin yapıldı.':'Admin yetkisi kaldırıldı.');amLoadUsers();}
    else toast(r.err||'Hata!',1);
  });
}
function amSetPremium(username,hasActive){
  if(hasActive){
    if(!confirm(`"${username}" kullanıcısının premium üyeliğini kaldırmak istiyor musun?`))return;
    io2.emit('admin:setPremium',{username,days:0},r=>{
      if(r.ok){toast('Premium kaldırıldı.');amLoadUsers();}
      else toast(r.err||'Hata!',1);
    });
  } else {
    const inp=prompt(`"${username}" için kaç günlük premium? (örn: 30, 90, 365)`);
    if(!inp)return;
    const days=parseInt(inp);
    if(isNaN(days)||days<=0){toast('Geçersiz gün sayısı.',1);return;}
    io2.emit('admin:setPremium',{username,days},r=>{
      if(r.ok){toast(`${days} günlük premium verildi.`);amLoadUsers();}
      else toast(r.err||'Hata!',1);
    });
  }
}
function amSetDonor(username,makeDonor){
  io2.emit('admin:setDonor',{username,isDonor:makeDonor},r=>{
    if(r.ok){toast(makeDonor?'Bağışçı yetkisi verildi.':'Bağışçı yetkisi kaldırıldı.');amLoadUsers();}
    else toast(r.err||'Hata!',1);
  });
}
function amResetPassword(username){
  const np=prompt(`"${username}" için yeni şifre (min 3):`);
  if(!np||np.length<3)return;
  io2.emit('admin:resetPassword',{username,newPassword:np},r=>{
    if(r.ok)toast('Şifre güncellendi.');
    else toast(r.err||'Hata!',1);
  });
}
function amEditStats(username){
  const won=prompt(`"${username}" — Kazanılan oyun sayısı?`,'0');
  if(won===null)return;
  const played=prompt(`Oynanan toplam oyun sayısı?`,won);
  if(played===null)return;
  const mvp=prompt(`MVP sayısı?`,'0');
  if(mvp===null)return;
  const lost=Math.max(0, parseInt(played)-parseInt(won));
  io2.emit('admin:setStats',{username,stats:{
    played:parseInt(played)||0,
    won:parseInt(won)||0,
    lost,
    mvp:parseInt(mvp)||0
  }},r=>{
    if(r.ok){toast('İstatistik güncellendi.');amLoadUsers();}
    else toast(r.err||'Hata!',1);
  });
}

function amEditCoins(username, currentCoins){
  const action = prompt(`"${username}" coin yönetimi:\n\nMevcut bakiye: ${currentCoins} 💰\n\n"+50" → 50 ekle\n"-30" → 30 çıkar\n"100" → tam 100'e ayarla\n\nİşlem:`, '+0');
  if(action === null || action === '') return;
  const trimmed = action.trim();
  let payload;
  if(trimmed.startsWith('+') || trimmed.startsWith('-')){
    const delta = parseInt(trimmed);
    if(isNaN(delta)){toast('Geçersiz miktar',1);return;}
    payload = { username, delta };
  } else {
    const coins = parseInt(trimmed);
    if(isNaN(coins) || coins < 0){toast('Geçersiz miktar',1);return;}
    payload = { username, coins };
  }
  io2.emit('admin:setCoins', payload, r => {
    if(r.ok){toast(`💰 Yeni bakiye: ${r.coins}`);amLoadUsers();}
    else toast(r.err||'Hata!',1);
  });
}
function amLoadReports(){
  const list=Q('AM_REPORTS_LIST');
  list.innerHTML='Yükleniyor...';
  io2.emit('admin:getToken',{},tr=>{
    const token = tr?.token;
    io2.emit('admin:listReports',{},r=>{
      if(!r?.ok){list.innerHTML=`<div style="color:var(--hain)">${r?.err||'Hata'}</div>`;return;}
      if(!r.reports.length){list.innerHTML='<div style="color:var(--dim);text-align:center;padding:24px;font-size:.85rem">📭 Henüz rapor yok.</div>';return;}
      list.innerHTML=r.reports.map(rp=>{
        const date=new Date(rp.createdAt).toLocaleString('tr-TR');
        const escaped=rp.description.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const imgHtml=rp.screenshot?`<img class="am-report-img" src="/admin/screenshot/${rp.screenshot}?token=${token}" onclick="window.open(this.src,'_blank')">`:'';
        return `<div class="am-report${rp.status==='closed'?' closed':''}">
          <div class="am-report-hdr">
            <span><span class="am-report-user">${rp.username}</span> <span style="font-family:'Fira Code',monospace;font-size:.6rem;opacity:.5">#${rp.id}</span></span>
            <span>${date}</span>
          </div>
          <div class="am-report-desc">${escaped}</div>
          ${imgHtml}
          <div class="am-report-actions">
            <button class="am-action-btn ${rp.status==='closed'?'info':'ok'}" onclick="amSetReportStatus('${rp.id}','${rp.status==='closed'?'open':'closed'}')">${rp.status==='closed'?'↩️ Yeniden Aç':'✓ Kapat'}</button>
            <button class="am-action-btn danger" onclick="amDeleteReport('${rp.id}')">🗑️ Sil</button>
          </div>
        </div>`;
      }).join('');
    });
  });
}
function amDeleteReport(id){
  if(!confirm('Bu raporu silmek istediğine emin misin?'))return;
  io2.emit('admin:deleteReport',{id},r=>{
    if(r.ok){toast('Rapor silindi.');amLoadReports();}
    else toast('Hata!',1);
  });
}
function amSetReportStatus(id,status){
  io2.emit('admin:setReportStatus',{id,status},r=>{
    if(r.ok)amLoadReports();
  });
}
function amExportReports(){
  io2.emit('admin:getToken',{},r=>{
    if(!r?.ok)return;
    window.open(`/admin/export-reports?token=${r.token}`,'_blank');
  });
}

// ── REPORT (her oyuncu) ──
function openReportModal(){
  Q('RPT_DESC').value='';
  Q('RPT_IMG').value='';
  Q('RPT_PREVIEW').innerHTML='';
  window._rptImg=null;
  Q('REPORT_MODAL').classList.add('sh');
}
window._rptImg=null;
function setupReportImg(){
  const inp=Q('RPT_IMG');
  if(!inp || inp._setupDone)return;
  inp._setupDone=true;
  inp.addEventListener('change',(e)=>{
    const f=e.target.files?.[0];
    if(!f){window._rptImg=null;Q('RPT_PREVIEW').innerHTML='';return;}
    if(f.size>5*1024*1024){toast('Görüntü çok büyük (max 5MB).',1);inp.value='';return;}
    const reader=new FileReader();
    reader.onload=(ev)=>{
      window._rptImg=ev.target.result;
      Q('RPT_PREVIEW').innerHTML=`<img src="${ev.target.result}" style="max-width:100%;max-height:200px;border-radius:4px;border:1px solid var(--brd)">`;
    };
    reader.readAsDataURL(f);
  });
}
function submitReport(){
  const desc=Q('RPT_DESC').value.trim();
  if(desc.length<5){toast('Açıklama en az 5 karakter olmalı.',1);return;}
  const btn=Q('RPT_SUBMIT');
  btn.disabled=true;btn.textContent='Gönderiliyor...';
  io2.emit('report:create',{description:desc,screenshot:window._rptImg},r=>{
    btn.disabled=false;btn.textContent='📤 Raporu Gönder';
    if(r.success){
      toast('🐛 Rapor gönderildi! Teşekkürler.');
      Q('REPORT_MODAL').classList.remove('sh');
    } else toast(r.error||'Hata!',1);
  });
}

function openMyRoleModal(){
  if(!ps?.role)return;
  const body=Q('MY_ROLE_BODY');
  // Kendi rolünü RDEF'ten bul (id'den key'e çevir)
  const roleKey=ps.role.toUpperCase().replace(/_/g,'_');
  // ID -> key mapping
  const keyMap={doktor:'DOKTOR',polis:'POLIS',savci:'SAVCI',muhtar:'MUHTAR',gazeteci:'GAZETECI',
    psikolog:'PSIKOLOG',gazi:'GAZI',dedikoducu:'DEDIKODUCU',ajan:'AJAN',serif:'SERIF',kurban:'KURBAN',
    cilingir:'CILINGIR',takipci:'TAKIPCI',suikastci:'SUIKASTCI',hipnotizmaci:'HIPNOTIZMACI',
    bombaci:'BOMBACI',golge:'GOLGE',dodo:'DODO',seri_katil:'SERI_KATIL',cellat:'CELLAT',yamyam:'YAMYAM',
    koruyucu:'KORUYUCU',demirci:'DEMIRCI',buzcu:'BUZCU',infazci:'INFAZCI',gardiyan:'GARDIYAN',
    engizitor:'ENGIZITOR',olumsuz:'OLUMSUZ',pusucu:'PUSUCU',hacker:'HACKER',veba:'VEBA'};
  const rd=RDEF[keyMap[ps.role]];
  if(!rd){body.innerHTML='<div style="color:var(--dim)">Rol bilgisi bulunamadı.</div>';
    Q('MY_ROLE_MODAL').classList.add('sh');return;}
  body.innerHTML=`
    <div class="role-card">
      <div class="role-card-hdr">
        <div class="role-card-emoji t-${rd.t}">${rd.e}</div>
        <div style="flex:1">
          <div class="role-card-name">${rd.n}</div>
          <span class="role-card-team t-${rd.t}">${rd.t.toUpperCase()}</span>
        </div>
      </div>
      <div class="role-card-desc" style="font-size:.85rem;line-height:1.6">${rd.full||rd.d}</div>
    </div>
    ${ps.teammates&&ps.teammates.length?`
      <div style="margin-top:10px;padding:10px;background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.25);border-radius:5px">
        <div style="font-size:.78rem;color:var(--hain);margin-bottom:4px;font-weight:600">🧛 Takım Arkadaşların</div>
        <div style="font-size:.7rem;color:var(--dim);margin-bottom:6px;font-style:italic">Rollerini sen de bilmiyorsun. Sohbette koordine olun.</div>
        ${ps.teammates.map(t=>`<div style="display:flex;align-items:center;gap:6px;font-size:.85rem;margin:3px 0;color:var(--hain)">🧛 <strong>${t.name}</strong></div>`).join('')}
      </div>`:''}
    ${ps.cellatTarget?`
      <div style="margin-top:10px;padding:10px;background:rgba(41,128,185,.08);border:1px solid rgba(41,128,185,.25);border-radius:5px">
        <div style="font-size:.78rem;color:var(--tarafsiz);margin-bottom:4px;font-weight:600">⛓️ Hedefin</div>
        <div style="font-size:.85rem">${ps.cellatTarget}</div>
      </div>`:''}
  `;
  Q('MY_ROLE_MODAL').classList.add('sh');
}

function openRoleGuideModal(){
  // Tüm RDEF'i göster, sekmeli
  const tabs=[
    {id:'all',l:'Tümü'},
    {id:'masum',l:'Masum'},
    {id:'hain',l:'Hain'},
    {id:'tarafsız',l:'Tarafsız'},
    {id:'deli',l:'Deli'}
  ];
  const tabEl=Q('ROLE_GUIDE_TABS');
  tabEl.innerHTML=tabs.map(t=>`<button class="role-tab ${t.id==='all'?'active':''}" data-rgt="${t.id}" onclick="filterRoleGuide('${t.id}')">${t.l}</button>`).join('');
  filterRoleGuide('all');
  Q('ROLE_GUIDE_MODAL').classList.add('sh');
}

function filterRoleGuide(team){
  document.querySelectorAll('[data-rgt]').forEach(b=>b.classList.toggle('active',b.dataset.rgt===team));
  const body=Q('ROLE_GUIDE_BODY');
  const entries=Object.entries(RDEF).filter(([k,v])=>team==='all'||v.t===team);
  body.innerHTML=entries.map(([k,rd])=>`
    <div class="role-card">
      <div class="role-card-hdr">
        <div class="role-card-emoji t-${rd.t}">${rd.e}</div>
        <div style="flex:1">
          <div class="role-card-name">${rd.n}</div>
          <span class="role-card-team t-${rd.t}">${rd.t.toUpperCase()}</span>
        </div>
      </div>
      <div class="role-card-desc">${rd.full||rd.d}</div>
    </div>
  `).join('');
}

function openSuikastModal(){
  if(!ps||ps.role!=='suikastci'||!ps.isAlive)return;
  if(gs?.suikastUsedThisRound){toast('Bu tur zaten suikast denedin!',1);return;}
  // Modal içeriği doldur
  window._suikastTarget=null;
  window._suikastRole=null;
  const tg=Q('SUIKAST_TARGETS');
  tg.innerHTML='';
  const isH=ps.team==='hain';
  const tmIds=new Set();
  if(isH&&ps.teammates)ps.teammates.forEach(t=>tmIds.add(t.id));
  gs.players.filter(p=>p.isAlive&&p.id!==me).forEach(p=>{
    const isT=tmIds.has(p.id);
    const d=document.createElement('div');d.className='vb';d.dataset.id=p.id;
    const nameStyle=isT?'color:var(--hain);font-weight:600':'';
    d.innerHTML=`${cosmeticPlayerAvatarHTML(p,'sm',false)}<span class="vb-name">${cosmeticPlayerNameHTML(p,false,isT?' 🧛':'',nameStyle)}</span>`;
    d.onclick=()=>{
      document.querySelectorAll('#SUIKAST_TARGETS .vb').forEach(b=>b.classList.remove('vd'));
      d.classList.add('vd');window._suikastTarget=p.id;updSuikastBtn();
    };
    tg.appendChild(d);
  });
  const roles=[
    // Masumlar
    ['doktor','Doktor','🩺'],['polis','Polis','🔦'],['savci','Savcı','⚖️'],
    ['muhtar','Muhtar','🏛️'],['gazeteci','Gazeteci','📰'],['psikolog','Psikolog','🧠'],['gazi','Gazi','🛡️'],
    ['dedikoducu','Dedikocucu','🗣️'],['ajan','Ajan','🕵️'],['serif','Şerif','🤠'],['kurban','Kurban','🩸'],
    ['cilingir','Çilingir','🔑'],['takipci','Takipçi','👣'],
    ['demirci','Demirci','⚒️'],['infazci','İnfazcı','🔨'],['gardiyan','Gardiyan','🛡️'],
    ['engizitor','Engizitör','⚖️'],['buzcu','Buzcu','❄️'],
    // Tarafsızlar
    ['koruyucu','Koruyucu','😇'],['dodo','Dodo','🦤'],['seri_katil','Seri Katil','🔪'],
    ['cellat','Cellat','⛓️'],['yamyam','Yamyam','🍖'],['veba','Veba','☠️']
  ];
  Q('SUIKAST_ROLES').innerHTML=roles.map(([id,n,e])=>`<div class="rgb" data-rid="${id}" onclick="selSuikastRole('${id}')">${e} ${n}</div>`).join('');
  Q('SUIKAST_DO_BTN').disabled=true;
  Q('SUIKAST_DO_BTN').textContent='🗡️ SUİKAST!';
  Q('SUIKAST_STATUS').textContent='';
  Q('SUIKAST_MODAL').classList.add('sh');
}

function closeSuikastModal(){
  Q('SUIKAST_MODAL').classList.remove('sh');
}

function renderVote(){
  if(!gs)return;theme(true);voted=null;
  if(!_cosmeticCatalog){loadCosmeticCatalog().then(()=>{if(gs?.phase==='voting')renderVote();});}
  const grid=Q('VG');grid.innerHTML='';
  const isH=ps?.team==='hain';
  const tmIds=new Set();
  if(isH&&ps.teammates)ps.teammates.forEach(t=>tmIds.add(t.id));
  const cellatTargetId = ps?.role==='cellat' ? ps.cellatTargetId : null;
  // Tüm oyuncular (canlı + ölü). Ölülere oy verilemez ama görsel olarak gösterilir
  gs.players.forEach(p=>{
    const isT=tmIds.has(p.id);
    const isMe=p.id===me;
    const isCT=p.id===cellatTargetId;
    const d=document.createElement('div');
    d.className='vb' + (p.isAlive ? '' : ' dead');
    d.dataset.id=p.id;
    const nameStyle=isT?'color:var(--hain);font-weight:600':(isCT?'color:var(--tarafsiz);font-weight:600':(isMe?'color:var(--hi)':''));
    const ctIcon=isCT?' <span style="color:var(--tarafsiz)" title="Cellat hedefin">⛓️</span>':'';
    const deadIcon = !p.isAlive ? ' 💀' : '';
    if(p.isAlive){
      d.innerHTML=`${cosmeticPlayerAvatarHTML(p,'sm',isMe)}<span class="vb-name">${cosmeticPlayerNameHTML(p,isMe,`${isMe?' (SEN)':''}${isT?' 🧛':''}${ctIcon}`,nameStyle)}${p.isPresident?'<span class="crown">👑</span>':''}</span><span class="vc" data-vc="${p.id}">0</span><span class="tk">✓</span>`;
      d.onclick=()=>doVote(p.id);
    } else {
      // Ölü: tıklanamaz, üst çizili, soluk
      d.innerHTML=`${cosmeticPlayerAvatarHTML(p,'sm',isMe)}<span class="vb-name">${cosmeticPlayerNameHTML(p,isMe,deadIcon,'text-decoration:line-through;color:var(--dim)')}</span>`;
    }
    grid.appendChild(d);
  });
  // Pas butonu - gerçek oy seçeneği
  const sk=document.createElement('div');sk.className='vb';sk.dataset.id='skip';
  sk.style.cssText='border:1px dashed var(--dim);background:rgba(255,255,255,.04)';
  const skipCnt=gs.voteTally?.['__skip__']||0;
  sk.innerHTML=`<div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:1.2rem">⏭️</div><span class="vb-name"><span style="font-style:italic">Pas</span></span><span class="vc" data-vc="skip">${skipCnt}</span><span class="tk">✓</span>`;
  sk.onclick=()=>doVote('skip');
  grid.appendChild(sk);
  if(gs.voteTally)updateTally(gs.voteTally);
  // Eğer ölü/izleyiciysek tüm tıklamaları engelle
  if(!ps?.isAlive){grid.querySelectorAll('.vb').forEach(b=>{b.style.opacity='0.5';b.style.pointerEvents='none';});}
}

function updateTally(tally){
  document.querySelectorAll('[data-vc]').forEach(el=>{
    el.textContent=tally[el.dataset.vc]||0;
  });
  // Skip sayısı
  const skipEl=document.querySelector('[data-vc="skip"]');
  if(skipEl)skipEl.textContent=tally['__skip__']||0;
}

function renderVR(res){
  theme(true);
  Q('VRE').textContent=res.eliminated?'🪦':'⚖️';
  Q('VRT').textContent=res.eliminated?res.eliminated.name+' Elendi!':'Berabere!';
  Q('VRM').textContent=res.message;
}

function renderGO(data){
  theme(false);
  const winEmojis={
    masum:'🌅', hain:'🧛', seri_katil:'🔪', dodo:'🦤', cellat:'⛓️'
  };
  Q('GE').textContent=winEmojis[data.winner]||'🏆';
  Q('GT').textContent=data.msg||'Oyun Bitti!';
  // Kazanan rengini ayarla
  const gtEl=Q('GT');
  if(data.winner==='masum')gtEl.style.color='var(--safe)';
  else if(data.winner==='hain')gtEl.style.color='var(--hain)';
  else if(data.winner==='seri_katil'||data.winner==='dodo'||data.winner==='cellat')gtEl.style.color='var(--tarafsiz)';
  else gtEl.style.color='';

  // Kendi coin değişimini büyük göster (önce username, sonra id ile fallback)
  const myUname = user?.username;
  const myUpdate = (myUname && data.coinUpdates?.[myUname]) || (data.coinUpdatesById?.[me]) || null;
  const myChange = myUpdate?.coinChange || 0;
  const myTotalCoins = myUpdate?.totalCoins;
  if(myChange !== 0){
    const coinColor = myChange > 0 ? 'var(--gold)' : 'var(--hain)';
    const sign = myChange > 0 ? '+' : '';
    Q('GM').innerHTML = `<div style="margin-top:8px;padding:10px 14px;background:rgba(255,215,0,.08);border:1px solid rgba(255,215,0,.3);border-radius:6px;display:inline-block">
      <span style="color:${coinColor};font-weight:700;font-size:1.2rem">${sign}${myChange} 💰</span>
      ${myTotalCoins!==undefined ? `<span style="color:var(--dim);font-size:.78rem;margin-left:8px">(toplam: ${myTotalCoins})</span>` : ''}
      ${data.totalBetPool ? `<div style="font-size:.7rem;color:var(--dim);margin-top:3px">Bahis havuzu: ${data.totalBetPool}</div>` : ''}
    </div>`;
  } else if(!user) {
    Q('GM').innerHTML = `<div style="margin-top:8px;padding:8px;color:var(--dim);font-size:.78rem">💡 Giriş yaparak oyun başına altın kazanabilirsin!</div>`;
  } else {
    Q('GM').textContent='';
  }

  // Kazananlar kutusu
  const winBox=Q('WIN_BOX');
  const winList=Q('WIN_LIST');
  if(data.winners?.length){
    winBox.style.display='block';
    winList.innerHTML=data.winners.map(w=>{
      const cc = w.coinChange ? `<span style="color:var(--gold);font-size:.74rem;margin-left:4px">+${w.coinChange}💰</span>` : '';
      return `<div class="winner-item">${cosmeticPlayerAvatarHTML(w,'sm',w.id===me)}<span class="trophy">🏆</span><span style="flex:1;font-weight:700">${cosmeticPlayerNameHTML(w,w.id===me,cc)}</span><span style="color:var(--dim);font-size:.78rem">${w.roleEmoji} ${w.roleName} ${w.isInsane ? '<span class="deli-tag">DELİ</span>' : ''}</span></div>`;
    }).join('');
  } else {
    winBox.style.display='none';
  }

  // Tüm rolleri göster
  const l=Q('GR');l.innerHTML='';
  if(data.players)data.players.forEach(p=>{
    const isMe=p.id===me;
    const d=document.createElement('div');d.className='gop'+(p.isWinner?' winner':'');
    const meTag=isMe?' <span style="color:var(--hi);font-size:.62rem">(SEN)</span>':'';
    const cc = p.coinChange ? `<span style="color:${p.coinChange>0?'var(--gold)':'var(--hain)'};font-size:.7rem;margin-left:4px">${p.coinChange>0?'+':''}${p.coinChange}💰</span>` : '';
    d.innerHTML=`${cosmeticPlayerAvatarHTML(p,'sm',isMe)}<span>${p.isAlive?'✅':'💀'}</span><span>${p.roleEmoji}</span>
      <span style="flex:1">${cosmeticPlayerNameHTML(p,isMe,`${meTag}${cc}`)}</span><span style="color:var(--dim);font-size:.74rem">${p.roleName} (${p.team}) ${p.isInsane ? '<span class="deli-tag">DELİ</span>' : ''}</span>
      ${p.isWinner?'<span class="ib">🏆 KAZANDI</span>':''}`;
    l.appendChild(d);});
  const isLeaderGO = gs?.leaderId === me;
  Q('BNG').style.display = isLeaderGO ? 'block' : 'none';
  Q('BNG_WAIT').style.display = isLeaderGO ? 'none' : 'block';
}

function renderSpec(data){
  if(!data)return;
  const dayPhases=['day_discussion','voting','vote_result'];
  theme(dayPhases.includes(data.phase));
  const pn={lobby:'Lobi',role_selection:'Rol Seçimi',role_reveal:'Rol Dağıtımı',president_vote:'Başkan Oylaması',night:'Gece',morning_report:'Sabah',day_discussion:'Tartışma',voting:'Oylama',vote_result:'Sonuç',mvp_vote:'MVP Oylama',mvp_result:'MVP Sonucu',game_over:'Bitti',post_game:'Bitti'};
  Q('SPH').textContent=`${pn[data.phase]||data.phase} - Tur ${data.round}`;
  // Ölü oyuncuysa ekranın üstündeki ikon/başlık güncelle
  const pb=Q('S10').querySelector('.pb');
  if(pb){
    const pi2=pb.querySelector('.pi2'), pt=pb.querySelector('.pt');
    if(isDead){ if(pi2)pi2.textContent='👻'; if(pt)pt.textContent='Hayalet'; }
    else { if(pi2)pi2.textContent='👁️'; if(pt)pt.textContent='İzleyici'; }
  }
  // Ölü/izleyici S10 butonunu güncelle (ölüyse "Odadan Çık", izleyiciyse "İzleyiciden Çık")
  const leaveBtn=Q('S10').querySelector('button.b');
  if(leaveBtn){
    leaveBtn.textContent = isDead ? '↩️ Odadan Çık' : '↩️ İzleyiciden Çık';
  }
  // İzleyici DELİ rozetini görür - kim deli net belli
  Q('SPP').innerHTML='<div id="SPP_GRID">'+data.players.map(p=>
    `<div class="pi ${p.isAlive?'':'dead'}${p.isPresident?' president':''}" data-pid="${p.id}">${cosmeticPlayerAvatarHTML(p,'sm',p.id===me)}<span class="pi-name">${cosmeticPlayerNameHTML(p,p.id===me,p.id===me?' <span style="color:var(--hi);font-size:.62rem">(SEN)</span>':'')}${p.isPresident?'<span class="crown">👑</span>':''}</span>
      <span style="font-size:.74rem;color:var(--dim)">${p.roleEmoji} ${p.roleName}</span>
      ${p.isInsane?'<span class="deli-tag">DELİ</span>':''}
      ${p.isSilenced?'<span style="font-size:.72rem">🤐</span>':''}</div>`).join('')+'</div>';
  Q('SLG').innerHTML=data.gameLog.map(l=>`<div class="sli"><span class="fm" style="color:var(--hi)">[${l.round}]</span> ${l.msg}</div>`).join('');
  Q('SLG').scrollTop=Q('SLG').scrollHeight;
  if(typeof _applyVoiceClassesToCards==='function') _applyVoiceClassesToCards();
}

// ── SÜRÜKLENEBİLİR BUTONLAR ──
// Floating butonları basılı tutarak (long-press) istediğin yere taşıyabilirsin.
// Konumlar localStorage'da kalır, sayfayı kapatıp açtığında aynı konumda durur.
function makeDraggable(elementId, opts={}){
  const el = Q(elementId);
  if(!el || el._draggableSetup) return;
  el._draggableSetup = true;
  const LONG_PRESS_MS = 400;
  const STORAGE_KEY = 'azap_pos_' + elementId;

  // Kayıtlı konumu yükle
  try{
    const saved = localStorage.getItem(STORAGE_KEY);
    if(saved){
      const pos = JSON.parse(saved);
      if(pos && typeof pos.left==='number' && typeof pos.top==='number'){
        // Ekran sınırları içindeyse uygula
        const maxL = window.innerWidth - el.offsetWidth - 5;
        const maxT = window.innerHeight - el.offsetHeight - 5;
        el.style.left = Math.max(5, Math.min(pos.left, maxL)) + 'px';
        el.style.top = Math.max(5, Math.min(pos.top, maxT)) + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
      }
    }
  }catch{}

  let pressTimer = null;
  let isDragging = false;
  let startX=0, startY=0, startLeft=0, startTop=0;

  function getPoint(e){
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX, y: t.clientY };
  }

  function onPressStart(e){
    if(e.button===2)return; // sağ tık değil
    const pt = getPoint(e);
    startX = pt.x; startY = pt.y;

    // Long-press timer
    pressTimer = setTimeout(()=>{
      pressTimer = null;
      isDragging = true;
      // Mevcut absolute pozisyona dönüştür
      const r = el.getBoundingClientRect();
      startLeft = r.left;
      startTop = r.top;
      el.style.left = r.left + 'px';
      el.style.top = r.top + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.transition = 'none';
      el.style.opacity = '0.7';
      el.style.transform = 'scale(1.15)';
      // Haptic feedback (mobil)
      if(navigator.vibrate)try{navigator.vibrate(50);}catch{}
    }, LONG_PRESS_MS);
  }

  function onPressMove(e){
    if(pressTimer){
      // Long-press tetiklenmeden çok hareket varsa iptal et (kaydırma niyeti)
      const pt = getPoint(e);
      const dx = Math.abs(pt.x - startX), dy = Math.abs(pt.y - startY);
      if(dx > 8 || dy > 8){
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      return;
    }
    if(!isDragging) return;
    e.preventDefault();
    const pt = getPoint(e);
    const dx = pt.x - startX, dy = pt.y - startY;
    let newLeft = startLeft + dx;
    let newTop = startTop + dy;
    // Ekran sınırları
    newLeft = Math.max(5, Math.min(newLeft, window.innerWidth - el.offsetWidth - 5));
    newTop = Math.max(5, Math.min(newTop, window.innerHeight - el.offsetHeight - 5));
    el.style.left = newLeft + 'px';
    el.style.top = newTop + 'px';
  }

  function onPressEnd(e){
    if(pressTimer){
      clearTimeout(pressTimer);
      pressTimer = null;
      // Normal click — onclick handler çalışsın (engellemiyoruz)
      return;
    }
    if(isDragging){
      e.preventDefault();
      e.stopPropagation();
      isDragging = false;
      el.style.transition = '';
      el.style.opacity = '';
      el.style.transform = '';
      // Konumu kaydet
      const r = el.getBoundingClientRect();
      try{
        localStorage.setItem(STORAGE_KEY, JSON.stringify({left: r.left, top: r.top}));
      }catch{}
    }
  }

  // Mouse
  el.addEventListener('mousedown', onPressStart);
  document.addEventListener('mousemove', onPressMove);
  document.addEventListener('mouseup', onPressEnd);
  // Touch
  el.addEventListener('touchstart', onPressStart, {passive:true});
  document.addEventListener('touchmove', onPressMove, {passive:false});
  document.addEventListener('touchend', onPressEnd);
  document.addEventListener('touchcancel', ()=>{
    if(pressTimer){clearTimeout(pressTimer);pressTimer=null;}
    if(isDragging){isDragging=false;el.style.opacity='';el.style.transform='';}
  });
  // Click sırasında drag tetiklenmişse onclick'i engelle
  el.addEventListener('click', (e)=>{
    if(isDragging){e.preventDefault();e.stopPropagation();isDragging=false;}
  }, true);
  // Sağ tık ile sıfırla menüsü (opsiyonel - basit)
  el.addEventListener('contextmenu', (e)=>{
    e.preventDefault();
    if(confirm(`"${el.title || elementId}" konumunu varsayılana sıfırla?`)){
      try{ localStorage.removeItem(STORAGE_KEY); }catch{}
      el.style.left=''; el.style.top=''; el.style.right=''; el.style.bottom='';
    }
  });
}

// Tüm floating butonları sürüklenebilir yap
function setupDraggableButtons(){
  ['ROLE_INFO_BTN','ROLE_GUIDE_BTN','ADMIN_BTN','ADMIN_MENU_BTN','REPORT_BTN','SUIKAST_BTN_FLOAT','SABOTAJ_BTN_FLOAT','MINIGAME_BTN_FLOAT','HT'].forEach(id=>{
    if(Q(id)) makeDraggable(id);
  });
}

// Sekme arkaya atılıp geri gelince bağlantı durumunu kontrol et
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!io2.connected) {
      console.log('[visibility] Sekme aktif, bağlantı yok — yeniden bağlanılıyor');
      io2.connect();
    } else {
      // Bağlı ama state bayat olabilir — dünya düzenini yenile
      io2.emit('state:request');
      const activePhases=['night','day_discussion','voting','vote_result','morning_report','president_vote','mvp_vote'];
      if(activePhases.includes(gs?.phase)) io2.emit('priv:request');
      let token = null;
      try{ token = localStorage.getItem('azap_token'); }catch{}
      if(token && user) io2.emit('auth:loginByToken',{token},()=>{});
    }
  }
});

io2.on('connect',()=>{
  me=io2.id;
  Q('CONN_BANNER').style.display='none';
  console.log('[connect] Socket bağlandı, id:',me);
  // HER bağlantıda (ilk + reconnect) token varsa server'da authed map'e kayıt ettir
  // Aksi halde room:create gibi auth gerektiren işlemler başarısız olur
  let token = null;
  try{ token = localStorage.getItem('azap_token'); }catch{}
  if(token){
    io2.emit('auth:loginByToken',{token},r=>{
      if(r?.success){
        if(!user){
          // İlk yükleme — UI'yı kur
          user = r.user;
          updateUserUI();
          userMusicPref = true;
          loadYouTubeAPI();
          setTimeout(()=>{ show('S1'); applyMusicForCurrentScreen(); setupDraggableButtons(); }, 300);
          updateRoleInfoBtn();
        } else {
          user = { ...user, ...r.user };
          updateUserUI();
        }
        // Bağlantı sonrası rejoin kontrolü (sayfa yenilenme/reconnect durumları için)
        setTimeout(()=>{
          tryAutoRejoin();
        }, 500);
      } else {
        // Token geçersiz - sil ve user'ı sıfırla
        try{ localStorage.removeItem('azap_token'); }catch{}
        if(user){
          user = null;
          updateUserUI();
          show('S0');
          toast('Oturumun sona erdi, tekrar giriş yap.',1);
        }
        // Token geçersiz olsa bile rejoin dene (anonim oyuncu için)
        setTimeout(()=>{
          tryAutoRejoin();
        }, 500);
      }
    });
  } else {
    // Token yoksa bile rejoin dene (anonim oyuncu için)
    setTimeout(()=>{
      tryAutoRejoin();
    }, 500);
  }
  // Sürüklenebilir butonları kur (DOM hazır olduktan sonra)
  setTimeout(setupDraggableButtons, 100);
  // İlk yüklemede game-actions (yenile/çıkış) görünürlüğünü ayarla (S0/S1'de gizli)
  setTimeout(updateGameActions, 100);
});

// Bağlantı watchdog: aktif oyunda 45 saniye state gelmezse state:request at
let _lastStateTime = Date.now();
setInterval(()=>{
  if(!io2.connected||!gs)return;
  const activePhases=['night','day_discussion','voting','vote_result','morning_report','president_vote'];
  if(!activePhases.includes(gs.phase))return;
  if(Date.now()-_lastStateTime>45000){
    console.warn('[watchdog] 45sn state gelmedi, yenileniyor');
    io2.emit('state:request');
    io2.emit('priv:request');
    _lastStateTime=Date.now();
  }
},15000);

// Phase tracking for optimized rendering
let _lastPhase = null;
let _lastRound = -1;
let _lastCosmSig = '';
let _lastAliveSig = '';
let _seenSaboDeaths = new Set();

io2.on('state',s=>{
  _lastStateTime = Date.now();
  console.log('[state] Phase:',s.phase,'Round:',s.round,'Players:',s.players?.length);
  gs=s;
  const phaseChanged = _lastPhase !== s.phase;
  const roundChanged = _lastRound !== s.round;
  const cosmSig = (s.players||[]).map(p=>p.id+':'+(p.cosmetics?.frame||'')+'/'+(p.cosmetics?.font||'')+'/'+(p.cosmetics?.pet||'')).join(',');
  const cosmeticsChanged = _lastCosmSig !== cosmSig;
  const aliveSig = (s.players||[]).map(p=>p.id+':'+(p.isAlive?1:0)).join(',');
  const aliveChanged = _lastAliveSig !== aliveSig;
  if(phaseChanged) console.log('[state] Phase değişti:',_lastPhase,'->',s.phase);
  _lastPhase = s.phase;
  _lastRound = s.round;
  _lastCosmSig = cosmSig;
  _lastAliveSig = aliveSig;
  if(!_cosmeticCatalog){
    loadCosmeticCatalog().then(()=>{
      if(!gs)return;
      if(gs.phase==='lobby')renderLobby();
      else if(gs.phase==='president_vote')renderPV();
      else if(gs.phase==='night'){renderTL();renderEA();}
      else if(gs.phase==='day_discussion')renderDay();
      else if(gs.phase==='voting')renderVote();
      else if(gs.phase==='mvp_vote')renderMV();
    });
  }

  // Oda kodunu kaydet (rejoin için) - oyun aktifken veya lobideyken
  // me null ise kullanıcı ana menüye dönmüş demektir, kaydetme
  const currentCode = Q('LC')?.textContent;
  if(me && currentCode && currentCode.length === 4 && s.phase !== 'game_over' && s.phase !== 'post_game'){
    saveLastRoom(currentCode, user?.username || Q('IN')?.value?.trim() || 'Oyuncu');
  }

  // İzleyici veya ölmüş oyuncu — bitiş ekranlarına ve lobiye dönüşe izin ver
  if(isSpec||isDead){
    // Oyun sonu ekranları + lobby (yeni oyun)
    if(s.phase==='game_over'||s.phase==='post_game'||s.phase==='mvp_vote'||s.phase==='mvp_result'||s.phase==='lobby'){
      const m={mvp_vote:'S_MV',mvp_result:'S_MVR',game_over:'S9',post_game:'S9',lobby:'S2'};
      const target=m[s.phase];
      if(target){
        // Lobby'ye dönüldüyse (yeni oyun) — ölü/izleyici durumu sıfırla
        if(s.phase==='lobby'){
          isDead=false;
          deathOk=false;
          lastDead=new Set();
          const sb=Q('SB');sb.textContent='👁️ İZLEYİCİ';sb.classList.remove('sh');
          Q('DOV').classList.remove('sh');
          show(target);
          renderLobby();
        } else {
          // ÖNEMLİ: Ölü/izleyici için her zaman ekranı güncelle (phaseChanged'a bakma)
          // Çünkü S10'dan başka ekrana geçmesi gerekebilir
          show(target);
          // DOV overlay'i kapat (mvp/game_over fazlarında lazım değil)
          Q('DOV').classList.remove('sh');
          if(s.phase==='mvp_vote')renderMV();
          if(s.phase==='mvp_result' && s.mvpResult)renderMvpResult(s.mvpResult);
        }
        Q('HT').classList.remove('sh');
      }
    }
    return;
  }
  // ── MATRIX KRALLIĞI MODU ──
  if(s.phase==='mk_active'){
    mks=s;
    if(phaseChanged)show('S_MK');
    renderMK();
    return;
  }
  mks=null; mkReadyDone=false; prevMkLeaderId=null; prevMkPhase=null; _mkAQ=[]; _mkABusy=false; mkPowerLog=[]; _lastPRKey=null; mkKnownRoles={};

  const m={lobby:'S2',role_selection:'S_RS',role_reveal:'S3',president_vote:'S_PV',night:'S4',morning_report:'S5',day_discussion:'S6',voting:'S7',vote_result:'S8',mvp_vote:'S_MV',mvp_result:'S_MVR',game_over:'S9',post_game:'S9'};
  // Sadece phase değiştiğinde ekranı değiştir (gereksiz redraw önler)
  if(phaseChanged && m[s.phase])show(m[s.phase]);
  // Render fonksiyonları sadece phase'a yeni geçildiğinde tam çalıştırılır.
  if(s.phase==='lobby')renderLobby();
  if(s.phase==='role_selection')renderRS();
  if(s.phase==='president_vote'&&(phaseChanged||cosmeticsChanged))renderPV();
  if(s.phase==='night'&&(phaseChanged||cosmeticsChanged))renderNight();
  if(s.phase==='day_discussion'){
    if(phaseChanged||roundChanged||cosmeticsChanged||aliveChanged)renderDay();
    else updateDayPlayerList();
  }
  if(s.phase==='voting'&&(phaseChanged||cosmeticsChanged||aliveChanged))renderVote();
  if(s.phase==='mvp_vote'&&(phaseChanged||cosmeticsChanged))renderMV();
  if(s.phase==='mvp_result' && s.mvpResult)renderMvpResult(s.mvpResult);
  // Sabotaj gündüz ölümleri: yeni ölenler için toast göster
  if(s.sabotageDayDeaths?.length){
    s.sabotageDayDeaths.forEach(d=>{
      if(!_seenSaboDeaths.has(d.id)){
        _seenSaboDeaths.add(d.id);
        if(d.id !== me) toast(`💀 ${d.name} öldü!`, 1);
      }
    });
  }
  if(s.phase==='lobby'){ _seenSaboDeaths.clear(); _saboDeathToasted=false; }
  // Suikast butonu her state güncellemesinde kontrol edilsin (suikastUsedThisRound değişebilir)
  updateSuikastFloatingBtn();
  // Bu işlemler sadece phase değişiminde gereklidir — gereksiz DOM mutasyonu önlemek için
  if(phaseChanged){
    updateRoleInfoBtn();
    Q('HT').classList.toggle('sh',['night','morning_report','day_discussion','voting','vote_result'].includes(s.phase));
    applyMusicForCurrentScreen();
  }
});

// Gündüz oyuncu listesini sadece güncelle (re-render olmadan)
function updateDayPlayerList(){
  if(!gs)return;
  const dpEl=Q('DP');
  if(!dpEl||dpEl.children.length===0){renderDay();return;}
  const isHain2=ps?.team==='hain';
  const tmIds=new Set();
  if(isHain2&&ps.teammates)ps.teammates.forEach(t=>tmIds.add(t.id));
  // Ölüm durumlarını güncelle
  gs.players.forEach((p,idx)=>{
    const li=dpEl.children[idx];
    if(!li)return;
    const wasAlive=!li.classList.contains('dead');
    if(wasAlive!==p.isAlive){
      li.classList.toggle('dead',!p.isAlive);
      // Ölüm ikonu ekle/kaldır
      const skull=li.querySelector('span:last-child');
      if(!p.isAlive){
        if(!skull||skull.textContent!=='💀'){
          li.insertAdjacentHTML('beforeend','<span style="font-size:.85rem">💀</span>');
        }
      }
    }
    // Başkanlık güncellemesi
    li.classList.toggle('president',!!p.isPresident);
  });
}

io2.on('priv',s=>{
  ps=s;
  // Matrix Krallığı özel priv
  if(gs?.phase==='mk_active'){
    mkps=s;
    // Yeni güç sonucu geldi mi → kalıcı kaydet
    if(s.powerResult){
      const k=JSON.stringify(s.powerResult);
      if(k!==_lastPRKey){
        _lastPRKey=k;
        mkPowerLog.unshift({...s.powerResult});
        if(s.powerResult.type==='role_spy' && s.powerResult.targetId){
          mkKnownRoles[s.powerResult.targetId]={name:s.powerResult.targetName,team:s.powerResult.team};
        }
      }
    }
    renderMK();
    return;
  }
  // Ölü/izleyici ise normal render yapma — S10'da kalsın
  if(isSpec||isDead){
    if(!s.isAlive&&!deathOk){Q('DOV').classList.add('sh');deathOk=true;}
    updateSuikastFloatingBtn();updateRoleInfoBtn();
    return;
  }
  if(gs?.phase==='role_reveal')renderRole();
  if(gs?.phase==='role_selection')renderRS();
  if(gs?.phase==='night'){Q('NE').textContent=s.roleEmoji;Q('NN').textContent=s.roleName;
    if(s.hainKillVotes&&s.team==='hain')renderHKV(s.hainKillVotes);}
  renderH();
  // Suikastçı durumu değişebilir - butonu güncelle
  updateSuikastFloatingBtn();updateRoleInfoBtn();
  // Sabotaj mini oyun gösterilmeli mi?
  sabotageCheck();
  if(!s.isAlive&&!deathOk){
    Q('DOV').classList.add('sh');
    deathOk=true;
    // 3 saniye sonra otomatik izleyici moduna geç
    setTimeout(()=>{
      if(!isDead) enterDeathSpectate();
    },3000);
  }
});

io2.on('timer',({rem,total})=>{
  Q('TB').style.display='block';Q('TN').style.display='block';
  Q('TN').textContent=rem+'s';Q('TF').style.width=(rem/total*100)+'%';
  Q('TN').classList.toggle('w',rem<=5);
});

io2.on('report',({reports})=>renderReport(reports));
io2.on('voteResult',r=>renderVR(r));

// Cellat hedefini astırdı bildirimi - tüm oyunculara (cellat anonim, sadece hedef gözükür)
io2.on('cellatVictory',d=>{
  const ov=Q('SUIKAST_OV');
  Q('SUIKAST_TXT').textContent=`⛓️ ${d.targetName}'in eceli oldu!`;
  Q('SUIKAST_SUB').textContent=`Bir cellat hedefini buldu. Oyun devam ediyor.`;
  ov.style.background='rgba(0,30,60,.96)';
  ov.classList.add('sh');
  setTimeout(()=>ov.classList.remove('sh'),4500);
});

// Sadece cellata özel bildirim
io2.on('cellatPrivateWin',d=>{
  toast(`⛓️ Hedefini ${d.targetName} astırdın! Kazandın.`);
});
// Engizitör infaz sonucu - herkese yayın
io2.on('engizitorResult',d=>{
  const ov=Q('SUIKAST_OV');
  Q('SUIKAST_TXT').textContent=`⚖️ ${d.msg}`;
  Q('SUIKAST_SUB').textContent=d.killedName?`${d.killedName} infaz edildi.`:'';
  ov.style.background='rgba(94,58,135,.96)';
  ov.classList.add('sh');
  setTimeout(()=>ov.classList.remove('sh'),4500);
});

io2.on('voteTally',t=>updateTally(t));
io2.on('presidentVoteTally',t=>updatePVTally(t));
io2.on('hainKillVotes',v=>renderHKV(v));
io2.on('mvpTally',t=>updateMvpTally(t));
io2.on('mvpResult',r=>renderMvpResult(r));

io2.on('gameOver',d=>{
  // Tüm oyuncular (canlı, ölü, izleyici) oyun sonunu anında görsün
  show('S9');
  renderGO(d);
  Q('TB').style.display='none';Q('TN').style.display='none';
  Q('HT').classList.remove('sh');
  Q('DOV').classList.remove('sh');
  // Ölü oyuncu artık game over ekranında, izleyici ekranı değil
  // Ama isDead durumu post_game/lobby'de sıfırlanacak
});

io2.on('statsUpdate',r=>{
  if(r){
    user=r;
    updateUserUI();
    // Profil veya mağaza modal açıksa anında güncelle
    const cm=Q('MOD_COINS');if(cm)cm.textContent=r.coins??0;
    const sc=Q('SHOP_COINS');if(sc)sc.textContent=r.coins??0;
    const sp=Q('MOD_SP');if(sp)sp.textContent=r.stats?.played??0;
    const sw=Q('MOD_SW');if(sw)sw.textContent=r.stats?.won??0;
    const sl=Q('MOD_SL');if(sl)sl.textContent=r.stats?.lost??0;
    const mv=Q('MOD_MV');if(mv)mv.textContent=r.stats?.mvp??0;
    const bmc=Q('BET_MY_COINS');if(bmc)bmc.textContent='💰 ' + (r.coins??0);
  }
});

// ── ÖDEME BAŞARILI BİLDİRİMİ (Socket.io ile anlık teslimat — Madde XI-e) ──
io2.on('payment:success',data=>{
  toast(`✅ ${data.label||'Ödeme'} başarılı! Hesabına tanımlandı.`);
  // Güncel bakiyeyi çek
  io2.emit('auth:stats',null,r=>{if(r){user=r;updateUserUI();updateShopHeader();}});
});
// Popup pencereden gelen ödeme sonuç mesajını dinle
window.addEventListener('message',e=>{
  if(e.data?.type==='payment_result'){
    if(e.data.status==='success') toast('✅ Ödeme başarılı!');
    else toast('❌ Ödeme tamamlanamadı.',1);
  }
});

io2.on('spec',d=>{
  _lastSpec=d;
  // Oyun sonu/MVP/lobby fazlarında S10'a zorlamayalım — state handler doğru ekrana yönlendirsin
  if(d.phase==='mvp_vote'||d.phase==='mvp_result'||d.phase==='game_over'||d.phase==='post_game'||d.phase==='lobby')return;
  if(isSpec||isDead){show('S10');renderSpec(d);}
});

io2.on('hainMsg',({from,msg})=>{const b=Q('HCM');if(b){b.innerHTML+=`<div class="hm"><span class="hs">${from}:</span> ${msg}</div>`;b.parentElement.scrollTop=b.parentElement.scrollHeight;}});

// Bomba patlama efekti
io2.on('bombExplosion',({victims})=>{
  if(!victims||!victims.length)return;
  // Ses efekti
  try{const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const o=ctx.createOscillator(),g=ctx.createGain();
    o.type='sawtooth';o.frequency.setValueAtTime(80,ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(20,ctx.currentTime+0.5);
    g.gain.setValueAtTime(0.6,ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.8);
    o.connect(g);g.connect(ctx.destination);o.start();o.stop(ctx.currentTime+0.8);
    // İkinci patlama sesi
    setTimeout(()=>{const o2=ctx.createOscillator(),g2=ctx.createGain();
      o2.type='square';o2.frequency.setValueAtTime(40,ctx.currentTime);
      g2.gain.setValueAtTime(0.4,ctx.currentTime);g2.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+0.6);
      o2.connect(g2);g2.connect(ctx.destination);o2.start();o2.stop(ctx.currentTime+0.6);},150);
  }catch(e){}
  // Overlay
  const names=victims.map(v=>v.name).join(', ');
  Q('BOMB_VICTIMS').textContent=names+' patlamada hayatını kaybetti!';
  Q('BOMB_OV').classList.add('sh');
  // Ölen oyuncunun kendi ekranına ayrıca ölüm gösterilecek (priv event'inde)
  setTimeout(()=>Q('BOMB_OV').classList.remove('sh'),4000);
});

// Suikast sonucu efekti
// Suikast sonucu — herkese gönderilen anonim mesaj (kim öldürdü/öldürmedi gizli)
io2.on('suikastPublic',(res)=>{
  const ov=Q('SUIKAST_OV');
  Q('SUIKAST_TXT').textContent=`☀️ ${res.deadName} gündüz öldürüldü!`;
  Q('SUIKAST_SUB').textContent='';
  ov.style.background='rgba(60,30,0,.96)';
  ov.classList.add('sh');
  setTimeout(()=>ov.classList.remove('sh'),3500);
});

// Suikast sonucu — sadece suikastçıya giden detay (toast olarak göster)
io2.on('suikastPrivate',(res)=>{
  const roleName=ID_MAP[res.guessedRole]?.n||res.guessedRole;
  if(res.correct){
    toast(`🗡️ Doğru tahmin! ${res.targetName} (${roleName}) öldü.`);
  } else {
    toast(`🗡️ Yanlış! ${res.targetName} ${roleName} değildi. Öldün!`,1);
  }
});

io2.on('disconnect',(reason)=>{
  console.log('[socket] disconnect:', reason);
  // Watchdog'un tetiklenmemesi için state tracking sıfırla
  _lastStateTime = Date.now();
  if(reason!=='io client disconnect'){
    Q('CONN_BANNER').style.display='block';
  }
  if(reason==='io server disconnect'){
    toast('Sunucudan ayrıldın.',1);
    gs=null;
  }
  if(reason==='ping timeout'||reason==='transport close'||reason==='transport error'){
    setTimeout(()=>{
      if(io2.disconnected)tryAutoRejoin();
    },1000);
  }
});

// Oda kurucusu tarafından atıldı
io2.on('kicked',({reason})=>{
  clearLastRoom();
  resetClient();
  show('S1');
  toast(reason||'Odadan atıldın.',1);
});

// Başka cihazda giriş yapıldı
io2.on('forceLogout',({reason})=>{
  clearLastRoom();
  resetClient();
  user=null;
  try{localStorage.removeItem('azap_token');}catch{}
  show('S0');
  toast(reason||'Başka bir cihazda giriş yapıldı.',1);
});

io2.on('reconnect_attempt',(n)=>{
  if(n>2)Q('TN').textContent='⟳ bağlanıyor...';
});

io2.on('reconnect',()=>{
  toast('Bağlantı kuruldu!');
  if(!user) tryAutoLogin();
  else {
    // Giriş yapılmış ama socket yenilendi — re-auth + rejoin
    let token=null; try{token=localStorage.getItem('azap_token');}catch{}
    if(token) io2.emit('auth:loginByToken',{token},r=>{ if(r?.success) setTimeout(tryAutoRejoin,300); });
  }
});

io2.on('connect_error',(err)=>{
  console.log('[socket] connect_error:', err.message);
});

Q('IC').addEventListener('input',function(){this.value=this.value.replace(/\D/g,'')});
Q('AU').addEventListener('keypress',e=>{if(e.key==='Enter')Q('AP').focus()});
Q('AP').addEventListener('keypress',e=>{if(e.key==='Enter')doAuth()});

// ============================================================
// SESLİ SOHBET — WebRTC mesh client
// ============================================================
const VOICE = {
  enabled: false,         // ayardan kullanıcı tercih
  active: false,          // gerçekten getUserMedia aldı mı
  micMuted: false,        // kullanıcı kendi mic'ini kapadı mı
  deafened: false,        // tüm sesleri sustur
  canSpeak: true,         // server: rol-mute (Gölge) varsa false
  localStream: null,
  pcs: new Map(),         // peerId -> RTCPeerConnection
  audioEls: new Map(),    // peerId -> <audio>
  speakingIds: new Set(), // aktif konuşan peer'lar (uzaktan + lokal)
  vad: { ctx: null, analyser: null, raf: null, lastEmit: 0, lastState: false }
};
let RTC_CONFIG = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
] };
// TURN sunucusu config (server'dan gelecek)
const VOICE_VOLUMES = {}; // peerId -> 0..1 ses seviyesi

// localStorage'dan tercihi oku
try {
  VOICE.enabled = localStorage.getItem('azap_voice_enabled') === '1';
  const savedSens = parseInt(localStorage.getItem('azap_mic_sens'));
  if (savedSens >= 1 && savedSens <= 10) VOICE._speakThr = 0.005 + (10 - savedSens) * 0.0083;
} catch {}

function _voiceLog(...a){ try{ console.log('[voice]', ...a); }catch{} }

function toggleVoiceEnabled(on){
  VOICE.enabled = !!on;
  try { localStorage.setItem('azap_voice_enabled', on ? '1' : '0'); } catch {}
  if (on) {
    // Bir odaya bağlıysak hemen başlat
    if (gs && me) startVoice();
  } else {
    stopVoice();
  }
  updateVoicePanelVisibility();
}

function updateVoicePanelVisibility(){
  const panel = Q('VOICE_PANEL');
  if (!panel) return;
  const inGame = !!(gs && me);
  // Panel her zaman görünür (ayarlar butonu için), mic/headphone sesli sohbet aktifse görünür
  panel.style.display = inGame ? 'flex' : 'none';
  const micBtn = Q('VOICE_MIC_BTN');
  const deafBtn = Q('VOICE_DEAF_BTN');
  if (micBtn) micBtn.style.display = (VOICE.enabled && VOICE.active) ? 'flex' : 'none';
  if (deafBtn) deafBtn.style.display = (VOICE.enabled && VOICE.active) ? 'flex' : 'none';
}

async function startVoice(){
  if (VOICE.active) return;
  if (!VOICE.enabled) return;
  // Spectator → ses yok (şimdilik)
  if (isSpec) return;
  try {
    VOICE.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    VOICE.active = true;
    VOICE.micMuted = false;
    // canSpeak ve micMuted durumuna göre track'ı ayarla
    _enforceMicState();
    _voiceLog('lokal mic alındı, canSpeak:', VOICE.canSpeak, 'micMuted:', VOICE.micMuted);
    _setupVAD();
    _updateMicButton();
    _updateDeafenButton();
    updateVoicePanelVisibility();
    // Server'a mevcut peers için signal başlat — voice:peers handler tetikleyecek
    // Sunucu zaten voice:peers gönderiyor faz değişiminde; biz state'imizi resetleyip
    // io2'ye bir tetikleyici göndermiyoruz — voice:peers event'inde bağlantılar kurulacak.
  } catch(err) {
    _voiceLog('mic alınamadı:', err.message);
    toast('Mikrofon izni reddedildi', 1);
    VOICE.active = false;
    VOICE.enabled = false;
    try { localStorage.setItem('azap_voice_enabled', '0'); } catch {}
    const cb = Q('VOICE_ENABLED'); if (cb) cb.checked = false;
  }
}

function stopVoice(){
  // Tüm peer connection'ları kapat
  VOICE.pcs.forEach(pc => { try { pc.close(); } catch {} });
  VOICE.pcs.clear();
  // Audio elements
  VOICE.audioEls.forEach(el => { try { el.srcObject = null; el.remove(); } catch {} });
  VOICE.audioEls.clear();
  VOICE.speakingIds.clear();
  // Local stream
  if (VOICE.localStream) {
    VOICE.localStream.getTracks().forEach(t => { try { t.stop(); } catch {} });
    VOICE.localStream = null;
  }
  // VAD cleanup
  if (VOICE.vad.raf) cancelAnimationFrame(VOICE.vad.raf);
  if (VOICE.vad.ctx) { try { VOICE.vad.ctx.close(); } catch {} }
  VOICE.vad = { ctx: null, analyser: null, raf: null, lastEmit: 0, lastState: false };
  VOICE.active = false;
  updateVoicePanelVisibility();
  _renderSpeakerList();
}

function _setupVAD(){
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    VOICE.vad.ctx = new AC();
    const src = VOICE.vad.ctx.createMediaStreamSource(VOICE.localStream);
    VOICE.vad.analyser = VOICE.vad.ctx.createAnalyser();
    VOICE.vad.analyser.fftSize = 512;
    src.connect(VOICE.vad.analyser);
    const buf = new Uint8Array(VOICE.vad.analyser.fftSize);
    const tick = () => {
      VOICE.vad.raf = requestAnimationFrame(tick);
      if (!VOICE.localStream) return;
      VOICE.vad.analyser.getByteTimeDomainData(buf);
      // RMS hesapla
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      const SPEAK_THR = VOICE._speakThr || 0.018;
      const rawSpeaking = rms > SPEAK_THR && !VOICE.micMuted && VOICE.canSpeak;
      const now = Date.now();
      // Grace period: konuşma durunca hemen söndürme (kelimeler arası sessizlik)
      if (rawSpeaking) VOICE.vad.graceUntil = now + 800;
      const isSpeaking = rawSpeaking || now < (VOICE.vad.graceUntil || 0);
      // State değişimi veya 1sn timeout
      if (isSpeaking !== VOICE.vad.lastState || (isSpeaking && now - VOICE.vad.lastEmit > 800)) {
        VOICE.vad.lastState = isSpeaking;
        VOICE.vad.lastEmit = now;
        try { io2.emit('voice:speaking', { speaking: isSpeaking }); } catch {}
        // Lokal indicator
        if (isSpeaking) VOICE.speakingIds.add(me); else VOICE.speakingIds.delete(me);
        _renderSpeakerList();
        _applyVoiceClassesToCards();
      }
    };
    tick();
  } catch(e) { _voiceLog('VAD setup err:', e.message); }
}

function toggleMic(){
  if (!VOICE.active) return;
  if (!VOICE.canSpeak) { toast('Şu an konuşamazsın (rol etkisi)', 1); return; }
  VOICE.micMuted = !VOICE.micMuted;
  _enforceMicState();
  _updateMicButton();
  if (VOICE.micMuted) {
    VOICE.speakingIds.delete(me);
    _renderSpeakerList();
  }
  _applyVoiceClassesToCards();
  _voiceLog('toggleMic → micMuted:', VOICE.micMuted);
}

function _enforceMicState(){
  const shouldSend = VOICE.canSpeak && !VOICE.micMuted;
  // Local track disable
  VOICE.localStream?.getAudioTracks().forEach(t => { t.enabled = shouldSend; });
  // Tüm peer connection sender'larında da kapat
  VOICE.pcs.forEach(pc => {
    pc.getSenders().forEach(sender => {
      if (sender.track && sender.track.kind === 'audio') {
        sender.track.enabled = shouldSend;
      }
    });
  });
}

function toggleDeafen(){
  if (!VOICE.active) return;
  VOICE.deafened = !VOICE.deafened;
  // Tüm remote audio'ları sustur
  VOICE.audioEls.forEach(el => { el.muted = VOICE.deafened; });
  // Sağırlaşırken mic'i de kapat (Discord standart)
  if (VOICE.deafened && !VOICE.micMuted) {
    VOICE.micMuted = true;
    VOICE.localStream?.getAudioTracks().forEach(t => t.enabled = false);
  }
  _updateMicButton();
  _updateDeafenButton();
  _applyVoiceClassesToCards();
}

function _updateMicButton(){
  const btn = Q('VOICE_MIC_BTN'); if (!btn) return;
  btn.classList.toggle('muted', VOICE.micMuted || !VOICE.canSpeak);
  btn.classList.toggle('role-muted', !VOICE.canSpeak);
  btn.textContent = !VOICE.canSpeak ? '🚫' : '🎤';
  btn.title = !VOICE.canSpeak ? 'Susturuldun' : (VOICE.micMuted ? 'Mikrofon kapalı' : 'Mikrofon açık');
}
function _updateDeafenButton(){
  const btn = Q('VOICE_DEAF_BTN'); if (!btn) return;
  btn.classList.toggle('deafened', VOICE.deafened);
  btn.textContent = VOICE.deafened ? '🔇' : '🎧';
  btn.title = VOICE.deafened ? 'Sağırlaştın' : 'Tüm sesler açık';
}

// ── Peer mesh yönetimi ──
async function _createPeer(remoteId, isInitiator){
  if (VOICE.pcs.has(remoteId)) return VOICE.pcs.get(remoteId);
  const pc = new RTCPeerConnection(RTC_CONFIG);
  VOICE.pcs.set(remoteId, pc);
  // Lokal audio'yu ekle
  if (VOICE.localStream) {
    VOICE.localStream.getTracks().forEach(t => pc.addTrack(t, VOICE.localStream));
  }
  // Remote stream geldiğinde audio element oluştur
  pc.ontrack = (ev) => {
    let audio = VOICE.audioEls.get(remoteId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.playsInline = true;
      audio.muted = VOICE.deafened;
      audio.volume = VOICE_VOLUMES[remoteId] ?? 1;
      Q('VOICE_AUDIO_CONTAINER')?.appendChild(audio);
      VOICE.audioEls.set(remoteId, audio);
      _voiceLog('audio element oluşturuldu, peer:', remoteId);
    }
    audio.srcObject = ev.streams[0];
    _voiceLog('remote track alındı, peer:', remoteId, 'tracks:', ev.streams[0]?.getTracks()?.length);
  };
  pc.onicecandidate = (ev) => {
    if (ev.candidate) io2.emit('voice:ice', { to: remoteId, candidate: ev.candidate });
  };
  pc.onconnectionstatechange = () => {
    _voiceLog('pc state', remoteId, pc.connectionState);
    if (['failed','disconnected','closed'].includes(pc.connectionState)) {
      _closePeer(remoteId);
    }
  };
  if (isInitiator) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      io2.emit('voice:offer', { to: remoteId, sdp: pc.localDescription });
    } catch(e) { _voiceLog('offer err:', e.message); }
  }
  return pc;
}
function _closePeer(remoteId){
  const pc = VOICE.pcs.get(remoteId);
  if (pc) { try { pc.close(); } catch {} VOICE.pcs.delete(remoteId); }
  const el = VOICE.audioEls.get(remoteId);
  if (el) { try { el.srcObject = null; el.remove(); } catch {} VOICE.audioEls.delete(remoteId); }
  VOICE.speakingIds.delete(remoteId);
  _renderSpeakerList();
}

// ── Server signalling event'leri ──
io2.on('voice:peers', ({ peers, canSpeak, turnServers }) => {
  const prevCanSpeak = VOICE.canSpeak;
  VOICE.canSpeak = !!canSpeak;
  _updateMicButton();
  // canSpeak değiştiğinde audio track'ı aç/kapat
  if (VOICE.localStream) {
    _enforceMicState();
    if (!VOICE.canSpeak && prevCanSpeak) {
      VOICE.speakingIds.delete(me);
      _applyVoiceClassesToCards();
      _voiceLog('canSpeak=false → mic kapatıldı');
    }
  }
  // TURN sunucuları server'dan gelirse ekle
  if (turnServers?.length && !RTC_CONFIG._turnApplied) {
    RTC_CONFIG.iceServers = RTC_CONFIG.iceServers.concat(turnServers);
    RTC_CONFIG._turnApplied = true;
    _voiceLog('TURN sunucuları eklendi:', turnServers.map(t => t.urls));
  }
  if (!VOICE.enabled) return;
  // Server "ses bağlantısı olması gereken peer ID'leri" listesini yolladı.
  // Listede olmayanları kapat, yeni olanlara bağlan.
  if (!VOICE.active) {
    // Kullanıcı henüz mic vermedi — listening'e başlamak için get them now
    startVoice().then(() => _syncPeerMesh(peers));
    return;
  }
  _syncPeerMesh(peers);
});

function _syncPeerMesh(peers){
  const wanted = new Set(peers || []);
  // Eski bağlantıları kapat
  for (const pid of [...VOICE.pcs.keys()]) {
    if (!wanted.has(pid)) _closePeer(pid);
  }
  // Yeni bağlantıları kur — initiator: ID karşılaştırması (deterministik, ikiz offer önle)
  for (const pid of wanted) {
    if (VOICE.pcs.has(pid)) continue;
    const initiator = me < pid; // küçük ID offer atar
    _createPeer(pid, initiator);
  }
}

io2.on('voice:offer', async ({ from, sdp }) => {
  if (!VOICE.enabled) return;
  if (!VOICE.active) await startVoice();
  if (!VOICE.active) return;
  const pc = await _createPeer(from, false);
  try {
    await pc.setRemoteDescription(sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    io2.emit('voice:answer', { to: from, sdp: pc.localDescription });
  } catch(e) { _voiceLog('answer err:', e.message); }
});

io2.on('voice:answer', async ({ from, sdp }) => {
  const pc = VOICE.pcs.get(from); if (!pc) return;
  try { await pc.setRemoteDescription(sdp); } catch(e) { _voiceLog('setRemote err:', e.message); }
});

io2.on('voice:ice', async ({ from, candidate }) => {
  const pc = VOICE.pcs.get(from); if (!pc) return;
  try { await pc.addIceCandidate(candidate); } catch(e) { _voiceLog('ice err:', e.message); }
});

io2.on('voice:speaking', ({ from, speaking }) => {
  if (speaking) VOICE.speakingIds.add(from);
  else VOICE.speakingIds.delete(from);
  _renderSpeakerList();
  _applyVoiceClassesToCards();
});

// Ses seviyesi ayarla (0..1)
function setPlayerVolume(pid, vol){
  vol = Math.max(0, Math.min(1, parseFloat(vol) || 0));
  VOICE_VOLUMES[pid] = vol;
  const audio = VOICE.audioEls.get(pid);
  if (audio) audio.volume = vol;
  try { localStorage.setItem('azap_vol_' + pid, vol.toFixed(2)); } catch {}
}
window.setPlayerVolume = setPlayerVolume;

// Mic durumu sadece kendimize görünür (diğerlerine bildirim yok)

// Oyuncu kartlarına .speaking ve mic mute göstergesi uygula
function _applyVoiceClassesToCards(){
  if (!gs?.players) return;
  document.querySelectorAll('.pi[data-pid]').forEach(el => {
    const pid = el.dataset.pid;
    if (!pid) return;
    // Konuşma class'ı (kendinde de göster)
    const isSpeaking = VOICE.speakingIds.has(pid);
    el.classList.toggle('speaking', !!isSpeaking);
    // Mic kapalı rozeti — sadece kendi kartımızda göster
    const isMuted = (pid === me) ? VOICE.micMuted : false;
    let micEl = el.querySelector('.pi-mic-off');
    if (isMuted && !isSpeaking) {
      if (!micEl) {
        micEl = document.createElement('div');
        micEl.className = 'pi-mic-off';
        micEl.textContent = '🎤';
        micEl.title = 'Mikrofon kapalı';
        el.appendChild(micEl);
      }
    } else if (micEl) {
      micEl.remove();
    }
    // Ses seviyesi: localStorage'dan yükle (ayarlar panelinden kontrol ediliyor)
    if (pid !== me && VOICE.active && !(pid in VOICE_VOLUMES)) {
      try { const sv = parseFloat(localStorage.getItem('azap_vol_' + pid)); if (sv >= 0) VOICE_VOLUMES[pid] = sv; } catch {}
      const audio = VOICE.audioEls.get(pid);
      if (audio) audio.volume = VOICE_VOLUMES[pid] ?? 1;
    }
  });
}

// State değiştiğinde voice'u başlat (gerekirse) ve göstergeleri uygula
io2.on('state', () => {
  // Re-render bitmesini bekle, sonra class'ları tekrar uygula
  setTimeout(() => {
    if (VOICE.enabled && gs && me && !VOICE.active && !isSpec) {
      _voiceLog('state event → startVoice tetik');
      startVoice();
    }
    _applyVoiceClassesToCards();
    updateVoicePanelVisibility();
  }, 150);
});

// Konuşan kişiler artık doğrudan kartlarda gösterilir; panel listesi kaldırıldı
function _renderSpeakerList(){
  const status = Q('VOICE_STATUS'); if (!status) return;
  status.innerHTML = '';
}

// ── Ayarlar Paneli ──
function toggleVoiceSettings(){
  const modal = Q('MDL_VSETTINGS');
  if (!modal) return;
  // Oyuncu listesini doldur
  const container = Q('VSETTINGS_PLAYERS');
  if (container && gs?.players) {
    container.innerHTML = '';
    gs.players.forEach(p => {
      if (p.id === me) return; // kendimizi gösterme
      const saved = VOICE_VOLUMES[p.id] ?? 1;
      const pct = Math.round(saved * 100);
      const icon = pct === 0 ? '🔇' : pct < 50 ? '🔉' : '🔊';
      const div = document.createElement('div');
      div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 6px;background:rgba(255,255,255,.03);border-radius:6px';
      div.innerHTML = `<span style="font-size:.78rem;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name}</span><span class="vs-vol-icon" style="font-size:.7rem">${icon}</span><input type="range" min="0" max="100" value="${pct}" style="flex:1;height:4px" oninput="setPlayerVolume('${p.id}',this.value/100);this.previousElementSibling.textContent=this.value==0?'🔇':this.value<50?'🔉':'🔊'"><span style="font-size:.65rem;color:var(--dim);min-width:25px">${pct}%</span>`;
      // Update percentage on input
      div.querySelector('input').addEventListener('input', function(){ this.nextElementSibling.textContent = this.value + '%'; });
      container.appendChild(div);
    });
    if (!container.children.length) {
      container.innerHTML = '<div style="font-size:.72rem;color:var(--dim);text-align:center;padding:8px">Henüz başka oyuncu yok</div>';
    }
  }
  // Mikrofon hassasiyet slider'ı güncelle
  const sensSlider = Q('VSETTINGS_MIC_SENS');
  if (sensSlider) {
    const current = Math.round((0.018 / (VOICE._speakThr || 0.018)) * 5);
    sensSlider.value = Math.max(1, Math.min(10, current));
    Q('VSETTINGS_MIC_SENS_VAL').textContent = sensSlider.value;
  }
  // Voice toggle buton metni
  const vToggle = Q('VSETTINGS_VOICE_TOGGLE');
  if (vToggle) vToggle.textContent = VOICE.enabled ? '🎙️ Sesli Sohbeti Kapat' : '🎙️ Sesli Sohbeti Aç';
  openModal('MDL_VSETTINGS');
}

function setMicSensitivity(val){
  val = parseInt(val) || 5;
  Q('VSETTINGS_MIC_SENS_VAL').textContent = val;
  // 1=çok hassas (0.005), 10=az hassas (0.08)
  VOICE._speakThr = 0.005 + (10 - val) * 0.0083;
  try { localStorage.setItem('azap_mic_sens', val); } catch {}
}

// HTML inline handler'lar için global expose
window.toggleVoiceEnabled = toggleVoiceEnabled;
window.toggleMic = toggleMic;
window.toggleDeafen = toggleDeafen;
window.toggleVoiceSettings = toggleVoiceSettings;
window.setMicSensitivity = setMicSensitivity;
window.VOICE = VOICE;
window.voiceDebug = function(){
  const cards = document.querySelectorAll('.pi[data-pid]');
  console.log('=== VOICE DEBUG ===');
  console.log('me:', me);
  console.log('VOICE.enabled:', VOICE.enabled, 'active:', VOICE.active, 'canSpeak:', VOICE.canSpeak, 'micMuted:', VOICE.micMuted);
  console.log('speakingIds:', [...VOICE.speakingIds]);
  console.log('VAD lastState:', VOICE.vad?.lastState, 'graceUntil:', VOICE.vad?.graceUntil, 'now:', Date.now());
  console.log('Cards with data-pid:', cards.length);
  cards.forEach(c => console.log('  pid=' + c.dataset.pid, 'speaking?', c.classList.contains('speaking'), 'classes:', c.className));
  console.log('LP children count:', Q('LP')?.children?.length);
  return 'VOICE state above';
};

// Ayar checkbox başlangıç durumu + panel sürüklenebilir yap
(function initVoiceUI(){
  const cb = Q('VOICE_ENABLED');
  if (cb) cb.checked = VOICE.enabled;
  _makeDraggable(Q('VOICE_PANEL'));
})();

function _makeDraggable(el){
  if (!el) return;
  const handle = Q('VOICE_DRAG_HANDLE') || el;
  let dragging = false, offsetX = 0, offsetY = 0;
  handle.addEventListener('mousedown', e => {
    dragging = true;
    const rect = el.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    el.style.cursor = 'grabbing';
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    el.style.left = (e.clientX - offsetX) + 'px';
    el.style.top = (e.clientY - offsetY) + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    el.style.cursor = 'grab';
    try { localStorage.setItem('azap_voice_panel', JSON.stringify({left: el.style.left, top: el.style.top})); } catch {}
  });
  // Touch desteği
  handle.addEventListener('touchstart', e => {
    dragging = true;
    const rect = el.getBoundingClientRect();
    const touch = e.touches[0];
    offsetX = touch.clientX - rect.left;
    offsetY = touch.clientY - rect.top;
  }, {passive: false});
  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    e.preventDefault();
    const touch = e.touches[0];
    el.style.left = (touch.clientX - offsetX) + 'px';
    el.style.top = (touch.clientY - offsetY) + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }, {passive: false});
  document.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    try { localStorage.setItem('azap_voice_panel', JSON.stringify({left: el.style.left, top: el.style.top})); } catch {}
  });
  // Son konum yükle
  try {
    const saved = JSON.parse(localStorage.getItem('azap_voice_panel'));
    if (saved && saved.left && saved.top) {
      el.style.left = saved.left;
      el.style.top = saved.top;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }
  } catch {}
}

// ══════════════════════════════════════════════
// MATRIX KRALLIĞI (MK) FRONTEND
// ══════════════════════════════════════════════

function toggleMKMode(){
  const isMK=!!gs?.mkMode;
  io2.emit('room:setMode',{mode:isMK?'standard':'matrix_kingdom'},r=>{
    if(!r?.ok) toast(r?.err||'Hata',1);
  });
}

function mkNominate(partnerId){
  io2.emit('mk:nominate',{partnerId},r=>{
    if(!r?.ok) toast(r?.err||'Hata',1);
  });
}

function mkVote(vote){
  io2.emit('mk:vote',{vote},r=>{
    if(!r?.ok) toast(r?.err||'Hata',1);
  });
}

function mkDiscardLeader(idx){
  io2.emit('mk:discard_leader',{discardIndex:idx},r=>{
    if(!r?.ok) toast(r?.err||'Hata',1);
  });
}

function mkDeploy(idx){
  io2.emit('mk:deploy',{deployIndex:idx},r=>{
    if(!r?.ok) toast(r?.err||'Hata',1);
  });
}

function mkUsePower(targetId){
  io2.emit('mk:use_power',{targetId},r=>{
    if(!r?.ok) toast(r?.err||'Hata',1);
  });
}

function mkSkipPower(){
  io2.emit('mk:skip_power',{},r=>{
    if(!r?.ok) toast(r?.err||'Hata',1);
  });
}

// ── MK State renderlama
function renderMK(){
  const box=Q('MK_CONTENT');
  if(!box||!mks)return;
  const s=mks.mkState;
  if(!s){box.innerHTML='';return;}
  const ph=s.mkPhase;
  if(ph!==prevMkPhase){
    if(ph==='nomination'){
      const lid=s.currentLeader;
      qMkAnn({icon:'👑',title:'BU TURUN LİDERİ',sub:lid?.name||'?',color:'blue',dur:2800});
      prevMkLeaderId=lid?.id;
    } else if(ph==='vote'){
      qMkAnn({icon:'🗳️',title:'YAVER SEÇİLDİ — OYLAMA BAŞLIYOR',
        sub:`Lider: ${s.currentLeader?.name||'?'}   ·   Yaver: ${s.nominatedPartner?.name||'?'}`,
        color:'yellow',dur:3200});
    } else if(ph==='card_leader'){
      qMkAnn({icon:'🃏',title:'KART SEÇİMİ',sub:'Lider 3 kart çekiyor, birini gizlice atacak...',color:'blue',dur:2200});
    } else if(ph==='card_partner'){
      qMkAnn({icon:'🃏',title:'YAVER KARTI SEÇİYOR',sub:'Son karar Yavere kaldı',color:'purple',dur:2200});
    } else if(ph==='power'){
      // Sadece lider kendi gücünü görür
      if(mkps?.isLeader){
        const pn={role_spy:'ROL DİKİZLEME',deck_spy:'DESTE DİKİZLEME',execute:'İDAM GÜCÜ'};
        qMkAnn({icon:'🔮',title:'ÖZEL GÜÇ SİZDE!',sub:pn[s.pendingPowerType]||'',color:'orange',dur:2500});
      }
    }
    prevMkPhase=ph;
  }
  box.innerHTML=mkBoardHTML(s)+mkRoleCardHTML()+mkPowerLogHTML()+mkPhaseHTML(s)+mkLogHTML(s)+mkPlayerCardsHTML(s);
}

function mkBoardHTML(s){
  const m=s.board.matrix, r=s.board.rebel;
  const bars=(count,max,cls)=>Array.from({length:max},(_, i)=>`<div class="mk-slot ${i<count?cls:''}"></div>`).join('');
  return `<div class="mk-board">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span style="font-family:'Fira Code',monospace;font-size:.6rem;letter-spacing:2px;color:rgba(0,200,255,.5)">⬡ MATRİX KRALLIĞI</span>
      <button onclick="openModal('MDL_GUIDE');renderGuide()" style="background:transparent;border:1px solid rgba(255,255,255,.12);border-radius:5px;color:var(--dim);font-size:.65rem;padding:2px 7px;cursor:pointer">📖 Kurallar</button>
    </div>
    <div class="mk-track">
      <div class="mk-track-label">MATRIX</div>
      <div class="mk-track-slots">${bars(m,5,'mk-slot-matrix')}</div>
      <div class="mk-track-count" style="color:#00bfff">${m}/5</div>
    </div>
    <div class="mk-track">
      <div class="mk-track-label">ASİ</div>
      <div class="mk-track-slots">${bars(r,6,'mk-slot-rebel')}</div>
      <div class="mk-track-count" style="color:#c0392b">${r}/6</div>
    </div>
    ${s.chaosCounter>0?`<div class="mk-chaos">KAOS SAYACI: ${s.chaosCounter}/3</div>`:''}
    <div style="font-size:.68rem;color:var(--dim);text-align:right;margin-top:2px">Deste: ${s.deckSize} kart${s.discardSize>0?` · İmha: ${s.discardSize}`:''}</div>
  </div>`;
}

function mkRoleCardHTML(){
  if(!mkps)return '';
  const r=mkps.role;
  let roleLabel='',roleDesc='',roleColor='',roleBg='';
  if(r==='knight'){
    roleLabel='ŞÖVALYE';roleDesc='Sistemi ve krallığı koru.';
    roleColor='#00bfff';roleBg='rgba(0,191,255,.08)';
  } else if(r==='traitor'){
    roleLabel='ASİ';roleDesc='Sistemi hackle! Müttefiklerini biliyorsun.';
    roleColor='#c0392b';roleBg='rgba(192,57,43,.08)';
    let allies='';
    if(mkps.traitorAllies?.length) allies=mkps.traitorAllies.map(a=>`<span class="mk-ally">${esc(a.name)}</span>`).join(' ');
    if(mkps.kingName) allies+=` <span class="mk-king-tag">KRAL: ${esc(mkps.kingName)}</span>`;
    if(allies) roleDesc+=`<br><span style="font-size:.72rem">${allies}</span>`;
  } else if(r==='king'){
    roleLabel='KRAL';roleDesc='Sen asilerin gizli liderisin.';
    roleColor='#8e44ad';roleBg='rgba(142,68,173,.08)';
    if(mkps.traitorName) roleDesc+=`<br><span style="font-size:.72rem">Müttefikin: <span class="mk-ally">${esc(mkps.traitorName)}</span></span>`;
  }
  return `<div class="mk-role-card" style="border-color:${roleColor};background:${roleBg}">
    <span class="mk-role-label" style="color:${roleColor}">${roleLabel}</span>
    <span class="mk-role-desc">${roleDesc}</span>
  </div>`;
}

function mkPhaseHTML(s){
  const isLeader=mkps?.isLeader;
  const isPartner=mkps?.isPartner;

  if(s.mkPhase==='intro') return mkIntroHTML(s);
  if(s.mkPhase==='nomination') return mkNominationHTML(s,isLeader);
  if(s.mkPhase==='vote') return mkVoteHTML(s);
  if(s.mkPhase==='card_leader') return mkCardLeaderHTML(isLeader);
  if(s.mkPhase==='card_partner') return mkCardPartnerHTML(isPartner);
  if(s.mkPhase==='power') return mkPowerHTML(s,isLeader);
  if(s.mkPhase==='game_over') return mkGameOverHTML(s);
  return '';
}

function qMkAnn(cfg){
  _mkAQ.push(cfg);
  if(!_mkABusy)_nextMkAnn();
}
function _nextMkAnn(){
  if(!_mkAQ.length){_mkABusy=false;return;}
  _mkABusy=true;
  const{icon='',title='',sub='',color='blue',dur=2500}=_mkAQ.shift();
  const el=document.createElement('div');
  el.className='mk-ann';
  el.innerHTML=`<div class="mk-ann-inner mk-ann-${color}">
    <div class="mk-ann-icon">${icon}</div>
    <div class="mk-ann-title">${esc(title)}</div>
    ${sub?`<div class="mk-ann-sub">${esc(sub)}</div>`:''}
  </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add('mk-ann-show')));
  setTimeout(()=>{
    el.classList.add('mk-ann-out');
    setTimeout(()=>{el.remove();_nextMkAnn();},500);
  },dur);
}

function mkReady(){
  if(mkReadyDone)return;
  mkReadyDone=true;
  io2.emit('mk:ready',{},r=>{
    if(!r?.ok){mkReadyDone=false;toast(r?.err||'Hata',1);}
  });
  const btn=Q('MK_READY_BTN');
  if(btn){btn.disabled=true;btn.textContent='Bekleniyor...';}
}


function mkIntroHTML(s){
  const total=(s.players||[]).length;
  const ready=s.readyCount||0;
  const iAm=(s.readyPlayers||[]).includes(me);
  const dist={5:'3 Şövalye + 1 Asi + 1 Kral',6:'4 Şövalye + 1 Asi + 1 Kral',7:'4 Şövalye + 2 Asi + 1 Kral',
    8:'5 Şövalye + 2 Asi + 1 Kral',9:'5 Şövalye + 3 Asi + 1 Kral',10:'6 Şövalye + 3 Asi + 1 Kral'};
  return `<div class="mk-intro-box">
    <div class="mk-intro-header">
      <div class="mk-intro-title">⬡ MATRİX KRALLIĞI</div>
      <div class="mk-intro-badge">DEMO MOD</div>
    </div>
    <div class="mk-intro-rules">
      <div class="mk-intro-section">
        <div class="mk-intro-sec-title">AMAÇ</div>
        <p><strong style="color:#00bfff">Şövalyeler</strong> 5 Matrix kartı masaya yüklemeli ya da Kral'ı idam etmeli. <strong style="color:#e74c3c">Asiler</strong> 6 Asi kartı yüklemeli ya da Kral'ı Yaver olarak onaylatmalı.</p>
      </div>
      <div class="mk-intro-section">
        <div class="mk-intro-sec-title">ROLLER</div>
        <div class="mk-intro-role-row"><span style="color:#00bfff">ŞÖVALYE</span><span>Matrix'i korur. Kimsenin rolünü bilmez.</span></div>
        <div class="mk-intro-role-row"><span style="color:#e74c3c">ASİ</span><span>Şövalyeleri kandırır. Diğer Asileri ve Kral'ı bilir.</span></div>
        <div class="mk-intro-role-row"><span style="color:#9b59b6">KRAL</span><span>Asilerle aynı taraftadır ama kimliği gizlidir. Asiler Kral'ı bilir.</span></div>
      </div>
      <div class="mk-intro-section">
        <div class="mk-intro-sec-title">BU OYUNDA ROL DAĞILIMI (${total} kişi)</div>
        <p style="color:var(--dim)">${dist[total]||''}</p>
      </div>
      <div class="mk-intro-section">
        <div class="mk-intro-sec-title">OYUN AKIŞI</div>
        <ol class="mk-intro-ol">
          <li><strong>Aday Gösterme:</strong> Tur lideri bir Yaver adayı seçer.</li>
          <li><strong>Oylama:</strong> Herkes gizlice EVET veya HAYIR oylar. Çoğunluk EVET derse hükümet kurulur. 3 ardışık red olursa kaos kartı otomatik çekilir.</li>
          <li><strong>Kart Seçimi:</strong> Lider desteden 3 kart çeker, 1'ini gizlice atar. Kalan 2 kartı Yaver görür, birini masaya yükler.</li>
          <li><strong>Güçler:</strong> Yeterli Asi kartı biriktiğinde özel güçler açılır: <em>Rol Görme → Deste Görme → İdam</em></li>
        </ol>
      </div>
      <div class="mk-intro-section">
        <div class="mk-intro-sec-title">KAZANMA KOŞULLARI</div>
        <div class="mk-intro-win-row" style="color:#00bfff">🟦 Şövalyeler: 5 Matrix kartı <strong>VEYA</strong> Kral idam edilir</div>
        <div class="mk-intro-win-row" style="color:#e74c3c">🟥 Asiler: 6 Asi kartı <strong>VEYA</strong> Kral Yaver olarak onaylanır (≥3 Asi kartıyla)</div>
      </div>
      <div class="mk-intro-section">
        <div class="mk-intro-sec-title">STRATEJİ İPUCU</div>
        <p style="color:var(--dim);font-size:.75rem">Şövalyeler: Kart örüntülerini takip edin, kimin hangi hükümette olduğuna bakın. Asiler: Şövalyeleri yavaşlatmak için güvenilir görünün. Kral: Çok erken deşifre olursan idam edilirsin!</p>
      </div>
    </div>
    <div class="mk-intro-progress">
      <div class="mk-intro-prog-bar"><div class="mk-intro-prog-fill" style="width:${Math.round(ready/Math.max(total,1)*100)}%"></div></div>
      <div class="mk-intro-prog-text">${ready}/${total} oyuncu hazır</div>
    </div>
    ${iAm
      ? `<button class="mk-intro-ready-btn" disabled>Bekleniyor... (${ready}/${total})</button>`
      : `<button class="mk-intro-ready-btn" id="MK_READY_BTN" onclick="mkReady()">Okudum, Anladım ✓</button>`
    }
  </div>`;
}

function mkPowerLogHTML(){
  if(!mkPowerLog.length)return'';
  const rows=mkPowerLog.map(r=>{
    const ctx=r.round!=null?`<span class="mk-plog-ctx">Tur ${r.round} · ${esc(r.leaderName||'?')} lider${r.partnerName?' · '+esc(r.partnerName)+' yaver':''}</span>`:'';
    if(r.type==='role_spy'){
      const c=r.team==='ŞÖVALYE'?'#00bfff':'#e74c3c';
      return `<div class="mk-plog-row">🔍 <strong>${esc(r.targetName)}</strong>: <span style="color:${c};font-weight:700">${r.team}</span>${ctx}</div>`;
    }
    if(r.type==='deck_spy'){
      const cards=(r.cards||[]).map(c=>c==='matrix'?'<span class="mk-inline-matrix">M</span>':'<span class="mk-inline-rebel">A</span>').join(' ');
      return `<div class="mk-plog-row">🃏 Sıradaki: ${cards}${ctx}</div>`;
    }
    if(r.type==='execute')return`<div class="mk-plog-row">💀 İdam: <strong>${esc(r.targetName)}</strong>${ctx}</div>`;
    return'';
  }).join('');
  return`<div class="mk-plog"><div class="mk-plog-title">ÖĞRENDIKLERIN</div>${rows}</div>`;
}

function mkPlayerCardsHTML(s){
  let html=`<div class="mk-pcards">`;
  (s.players||[]).forEach(p=>{
    const isLeaderP=p.id===s.currentLeader?.id;
    const isPartnerP=p.id===s.nominatedPartner?.id;
    const isMe=p.id===me;
    const dead=!p.isAlive;
    const known=mkKnownRoles[p.id];
    const knownColor=known?.team==='ŞÖVALYE'?'#00bfff':'#e74c3c';
    const avatarHtml=cosmeticPlayerAvatarHTML(p,'sm',isMe,'4px');
    const nameHtml=cosmeticPlayerNameHTML(p,isMe,isMe?' <span style="color:var(--hi);font-size:.62rem">(SEN)</span>':'');
    let cls='pi';
    if(dead)cls+=' dead';
    if(isLeaderP)cls+=' mk-leader';
    if(isPartnerP)cls+=' mk-partner';
    const knownBadge=known&&!dead?`<span class="badge" style="background:rgba(0,0,0,.3);border:1px solid ${knownColor};color:${knownColor};font-size:.55rem;padding:1px 5px">${known.team==='ŞÖVALYE'?'ŞÖV':'ASİ'}</span>`:'';
    const roleAbv=isLeaderP?`<span class="mk-role-badge mk-role-leader">LİDER</span>`:isPartnerP?`<span class="mk-role-badge mk-role-partner">YAVER</span>`:'';
    html+=`<div class="${cls}">
      ${avatarHtml}
      <span class="pi-name">${nameHtml}</span>
      ${roleAbv||knownBadge?`<div style="display:flex;justify-content:center;gap:3px;flex-wrap:wrap;margin-top:2px">${roleAbv}${knownBadge}</div>`:''}
    </div>`;
  });
  html+=`</div>`;
  return html;
}

function mkNominationHTML(s,isLeader){
  const leader=s.currentLeader;
  const lock=s.termLock||{};
  let html=`<div class="mk-phase-box">
    <div class="mk-phase-title">LİDER NOMİNASYONU</div>`;
  if(isLeader){
    html+=`<div style="margin-bottom:8px;font-size:.8rem;color:#00bfff">Sen lidersin! Bir yaver seç.</div>`;
    html+=`<div class="mk-player-grid">`;
    (s.players||[]).forEach(p=>{
      if(!p.isAlive||p.id===me)return;
      const locked=p.id===lock.leaderId||p.id===lock.partnerId;
      html+=`<button class="mk-player-btn ${locked?'mk-player-locked':''}"
        onclick="${locked?'':'mkNominate(\''+p.id+'\')'}"
        ${locked?'disabled title="Geçen tur görevdeydi"':''}>${esc(p.name)}${locked?' 🔒':''}</button>`;
    });
    html+=`</div>`;
  } else {
    html+=`<div style="font-size:.85rem;color:var(--dim)">Lider: <strong style="color:#00bfff">${esc(leader?.name||'?')}</strong></div>`;
    html+=`<div style="font-size:.8rem;color:var(--dim);margin-top:6px">Liderin yaver seçmesi bekleniyor...</div>`;
  }
  html+=`</div>`;
  return html;
}

function mkVoteHTML(s){
  const partner=s.nominatedPartner;
  const leader=s.currentLeader;
  const myVoted=false; // track via local state - server prevents double vote
  return `<div class="mk-phase-box">
    <div class="mk-phase-title">DİVAN OYLAMASI</div>
    <div style="font-size:.82rem;margin-bottom:6px">
      <strong style="color:#00bfff">${esc(leader?.name||'?')}</strong> + <strong style="color:#aaa">${esc(partner?.name||'?')}</strong> hükümeti kuruluyor
    </div>
    <div style="font-size:.75rem;color:var(--dim);margin-bottom:10px">Oy veren: ${s.votes?.total||0}/${(s.players||[]).filter(p=>p.isAlive).length}</div>
    <div style="display:flex;gap:10px;justify-content:center">
      <button class="mk-vote-btn mk-ja" onclick="mkVote('ja')">EVET</button>
      <button class="mk-vote-btn mk-nein" onclick="mkVote('nein')">HAYIR</button>
    </div>
    <div style="margin-top:10px;font-size:.72rem;color:var(--dim);text-align:center">Oyun tamamen gizli — kimse kimin ne oy verdiğini göremez</div>
  </div>`;
}

function mkCardLeaderHTML(isLeader){
  if(!isLeader){
    return `<div class="mk-phase-box"><div class="mk-phase-title">KART SEÇİMİ</div>
      <div style="font-size:.8rem;color:var(--dim)">Lider kartlarını inceliyor...</div></div>`;
  }
  const cards=mkps?.pendingCards||[];
  let html=`<div class="mk-phase-box"><div class="mk-phase-title">KART İMHA ET</div>
    <div style="font-size:.78rem;color:var(--dim);margin-bottom:8px">3 karttan birini imha et. Kalan 2 yavere geçer.</div>
    <div class="mk-cards">`;
  cards.forEach((c,i)=>{
    html+=`<button class="mk-card-btn ${c==='matrix'?'mk-card-matrix':'mk-card-rebel'}" onclick="mkDiscardLeader(${i})">
      <span class="mk-card-name">${c==='matrix'?'MATRIX':'ASİ'}</span>
      <span class="mk-card-action">İMHA ET</span>
    </button>`;
  });
  html+=`</div></div>`;
  return html;
}

function mkCardPartnerHTML(isPartner){
  if(!isPartner){
    return `<div class="mk-phase-box"><div class="mk-phase-title">KART YÜKLEMESİ</div>
      <div style="font-size:.8rem;color:var(--dim)">Yaver son kartı seçiyor...</div></div>`;
  }
  const cards=mkps?.pendingCards||[];
  let html=`<div class="mk-phase-box"><div class="mk-phase-title">KARTI MASAYA YÜKLE</div>
    <div style="font-size:.78rem;color:var(--dim);margin-bottom:8px">2 karttan birini masaya yükle.</div>
    <div class="mk-cards">`;
  cards.forEach((c,i)=>{
    html+=`<button class="mk-card-btn ${c==='matrix'?'mk-card-matrix':'mk-card-rebel'}" onclick="mkDeploy(${i})">
      <span class="mk-card-name">${c==='matrix'?'MATRIX':'ASİ'}</span>
      <span class="mk-card-action">YÜKLE</span>
    </button>`;
  });
  html+=`</div></div>`;
  return html;
}

function mkPowerHTML(s,isLeader){
  const power=s.pendingPowerType;
  const powerResult=mkps?.powerResult;
  let html=`<div class="mk-phase-box">`;

  // Power result (leader only)
  if(powerResult){
    if(powerResult.type==='role_spy'){
      html+=`<div class="mk-power-result">
        <div class="mk-power-result-title">SONUÇ</div>
        <div>${esc(powerResult.targetName)}: <strong style="color:${powerResult.team==='ŞÖVALYE'?'#00bfff':'#c0392b'}">${powerResult.team}</strong></div>
      </div>`;
    } else if(powerResult.type==='deck_spy'){
      html+=`<div class="mk-power-result">
        <div class="mk-power-result-title">SONRAKI 3 KART</div>
        <div>${powerResult.cards?.map(c=>`<span class="${c==='matrix'?'mk-inline-matrix':'mk-inline-rebel'}">${c==='matrix'?'MATRIX':'ASİ'}</span>`).join(' ')}</div>
      </div>`;
    } else if(powerResult.type==='execute'){
      html+=`<div class="mk-power-result"><div class="mk-power-result-title">İDAM EDİLDİ</div><div>${esc(powerResult.targetName)}</div></div>`;
    }
  }

  if(power==='role_spy'){
    html+=`<div class="mk-phase-title">ROL DİKİZLEME GÜCÜ</div>`;
    if(isLeader&&!powerResult){
      html+=`<div style="font-size:.78rem;color:var(--dim);margin-bottom:8px">Bir oyuncunun takımını gizlice öğren.</div>
        <div class="mk-player-grid">`;
      (s.players||[]).forEach(p=>{
        if(!p.isAlive||p.id===me)return;
        html+=`<button class="mk-player-btn" onclick="mkUsePower('${p.id}')">${esc(p.name)}</button>`;
      });
      html+=`</div><button class="mk-skip-btn" onclick="mkSkipPower()">Gücü Kullanma</button>`;
    } else if(!isLeader){
      html+=`<div style="font-size:.8rem;color:var(--dim)">Lider gizlice bir oyuncunun rolünü inceliyor...</div>`;
    }
  } else if(power==='deck_spy'){
    html+=`<div class="mk-phase-title">DESTE DİKİZLEME GÜCÜ</div>`;
    if(isLeader&&!powerResult){
      html+=`<button class="mk-action-btn" onclick="mkUsePower('')">Sonraki 3 Kartı Gör</button>
        <button class="mk-skip-btn" onclick="mkSkipPower()">Gücü Kullanma</button>`;
    } else if(!isLeader){
      html+=`<div style="font-size:.8rem;color:var(--dim)">Lider destenin üstüne bakıyor...</div>`;
    } else if(powerResult){
      html+=`<button class="mk-action-btn" onclick="mkSkipPower()">Devam Et</button>`;
    }
  } else if(power==='execute'){
    html+=`<div class="mk-phase-title">İDAM GÜCÜ</div>`;
    if(isLeader&&!powerResult){
      html+=`<div style="font-size:.78rem;color:#c0392b;margin-bottom:8px">Sistemden bir oyuncuyu sil. Kalıcı!</div>
        <div class="mk-player-grid">`;
      (s.players||[]).forEach(p=>{
        if(!p.isAlive||p.id===me)return;
        html+=`<button class="mk-player-btn mk-execute-btn" onclick="if(confirm('${esc(p.name)} idam edilsin?'))mkUsePower('${p.id}')">${esc(p.name)}</button>`;
      });
      html+=`</div><button class="mk-skip-btn" onclick="mkSkipPower()">Gücü Kullanma</button>`;
    } else if(!isLeader){
      html+=`<div style="font-size:.8rem;color:var(--dim)">Lider idam kararı veriyor...</div>`;
    } else if(powerResult){
      html+=`<button class="mk-action-btn" onclick="mkSkipPower()">Devam Et</button>`;
    }
  }

  html+=`</div>`;
  return html;
}

function mkGameOverHTML(s){
  const isDraw=s.winner==='draw';
  const isKnights=s.winner==='knights';
  const isLeader=gs?.leaderId===me;
  const color=isDraw?'#f39c12':isKnights?'#00bfff':'#c0392b';
  let html=`<div class="mk-phase-box" style="border-color:${color}">
    <div class="mk-phase-title" style="color:${color}">${isDraw?'BERABERLİK':isKnights?'ŞÖVALYELER KAZANDI!':'ASİLER KAZANDI!'}</div>
    <div style="font-size:.82rem;color:var(--dim);margin-bottom:12px">${esc(s.winReason||'')}</div>
    <div class="mk-role-reveal">`;
  (s.rolesRevealed||[]).forEach(p=>{
    const rc=p.role==='knight'?'#00bfff':p.role==='king'?'#8e44ad':'#c0392b';
    const rl=p.role==='knight'?'ŞÖVALYE':p.role==='king'?'KRAL':'ASİ';
    html+=`<div class="mk-reveal-row" style="${!p.isAlive?'opacity:.5':''}">
      <span style="color:${rc};font-weight:700">${rl}</span>
      <span>${esc(p.name)}${!p.isAlive?' 💀':''}</span>
    </div>`;
  });
  html+=`</div>`;
  if(isLeader){
    html+=`<button class="b b1" style="width:100%;margin-top:12px" onclick="newGame()">🔄 YENİ OYUN</button>`;
  } else {
    html+=`<div style="margin-top:10px;padding:8px 10px;background:rgba(255,200,50,.08);border:1px solid rgba(255,200,50,.3);border-radius:8px;color:#f5c842;font-size:.8rem;text-align:center;letter-spacing:.3px">⏳ Lider yeni oyunu bekliyor...</div>
    <button class="b b2" style="width:100%;margin-top:8px" onclick="leaveAfterGame()">Lobiden Çık</button>`;
  }
  html+=`</div>`;
  return html;
}

function mkPlayerListHTML(s){
  const lock=s.termLock||{};
  let html=`<div class="mk-playerlist">`;
  (s.players||[]).forEach(p=>{
    const isLeaderP=p.id===s.currentLeader?.id;
    const isPartnerP=p.id===s.nominatedPartner?.id;
    const isMe=p.id===me;
    html+=`<div class="mk-prow ${!p.isAlive?'mk-prow-dead':''}">
      ${avHTML(p.avatar,'sm')}
      <span class="mk-pname ${isMe?'mk-pname-me':''}">${esc(p.name)}</span>
      ${isLeaderP?'<span class="mk-badge mk-badge-leader">LİDER</span>':''}
      ${isPartnerP?'<span class="mk-badge mk-badge-partner">YAVER</span>':''}
      ${!p.isAlive?'<span class="mk-badge mk-badge-dead">ELİMİNE</span>':''}
    </div>`;
  });
  html+=`</div>`;
  return html;
}

function mkLogHTML(s){
  if(!s.eventLog?.length)return'';
  return `<div class="mk-log">${s.eventLog.map(e=>`<div class="mk-log-row">${esc(e)}</div>`).join('')}</div>`;
}

// MK event listeners
io2.on('mk:vote_result',(d)=>{
  if(d.approved){
    qMkAnn({icon:'✅',title:'HÜKÜMET ONAYLANDI',sub:`${d.ja} EVET  ·  ${d.nein} HAYIR`,color:'green',dur:3000});
  } else {
    qMkAnn({icon:'❌',title:'HÜKÜMET REDDEDİLDİ',sub:`${d.ja} EVET  ·  ${d.nein} HAYIR`,color:'red',dur:3000});
  }
});
io2.on('mk:card_played',(d)=>{
  if(d.chaos){
    qMkAnn({icon:'💥',title:'K A O S !',sub:`3 ardışık red — ${d.card==='matrix'?'MATRIX':'ASİ'} kartı otomatik çekildi`,color:'chaos',dur:3500});
  } else {
    const isM=d.card==='matrix';
    qMkAnn({icon:isM?'🟦':'🟥',title:isM?'MATRIX KARTI YÜKLENDI':'ASİ KARTI YÜKLENDI',
      sub:`Matrix: ${d.board?.matrix||0} / 5   ·   Asi: ${d.board?.rebel||0} / 6`,
      color:isM?'matrix':'rebel',dur:2800});
  }
});
io2.on('mk:executed',(d)=>{
  qMkAnn({icon:'💀',title:'SİSTEMDEN ELENDİ!',sub:d.targetName,color:'red',dur:3200});
});
io2.on('mk:game_over',(d)=>{
  const k=d.winner==='knights', draw=d.winner==='draw';
  qMkAnn({
    icon:draw?'🤝':k?'🏆':'🔴',
    title:draw?'BERABERLİK':k?'ŞÖVALYELER KAZANDI!':'ASİLER KAZANDI!',
    sub:d.reason, color:draw?'yellow':k?'blue':'rebel', dur:4500
  });
});

// Oyuncu odaya girince/çıkınca voice durumunu güncelle
const _origShow = show;
window.show = function(id){
  _origShow(id);
  // S2 (oda lobi) veya S10 (spectator) ekranındayken voice başlat
  setTimeout(() => {
    const shouldStart = VOICE.enabled && gs && me && !VOICE.active && !isSpec;
    if (shouldStart) startVoice();
    // Ekran ana menü ise voice durdur
    if (id === 'S0' || id === 'S1') stopVoice();
    updateVoicePanelVisibility();
  }, 100);
};

const jwt=require('jsonwebtoken'),fs=require('fs');
const P=fs.readFileSync(process.env.ASC_P8_PATH,'utf8'),APP=process.env.ASC_APP_ID;
const tok=()=>jwt.sign({},P,{algorithm:'ES256',expiresIn:'18m',issuer:process.env.ASC_ISSUER_ID,audience:'appstoreconnect-v1',header:{alg:'ES256',kid:process.env.ASC_KEY_ID,typ:'JWT'}});
async function api(m,e,b){const r=await fetch('https://api.appstoreconnect.apple.com'+e,{method:m,headers:{Authorization:'Bearer '+tok(),'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const t=await r.text();let j=null;try{j=t?JSON.parse(t):null}catch{};return{ok:r.ok,json:j,text:t,status:r.status};}
const err=r=>(r.json?.errors?.[0]?.detail||r.text||'').slice(0,140);
const P_=[
 {pid:'online.azap.gold_100',name:'100 Altın',desc:'Oyun içi 100 altın. Eşya ve premium için kullanılır.',tl:19.99},
 {pid:'online.azap.gold_500',name:'600 Altın',desc:'Oyun içi 600 altın (500 + 100 bonus).',tl:79.99},
 {pid:'online.azap.gold_1500',name:'2000 Altın',desc:'Oyun içi 2000 altın (1500 + 500 bonus).',tl:199.99},
 {pid:'online.azap.gold_5000',name:'7500 Altın',desc:'Oyun içi 7500 altın (5000 + 2500 bonus).',tl:499.99},
 {pid:'online.azap.premium_1m',name:'Premium 1 Ay',desc:'30 gün premium: +%50 altın, özel çerçeve, mor isim.',tl:49.99},
 {pid:'online.azap.premium_3m',name:'Premium 3 Ay',desc:'90 gün premium: +%50 altın, özel çerçeve, mor isim.',tl:129.99},
];
(async()=>{
  const iaps=(await api('GET',`/v1/apps/${APP}/inAppPurchasesV2?limit=50`)).json.data;
  const map={}; iaps.forEach(d=>map[d.attributes.productId]=d.id);
  for(const p of P_){
    const id=map[p.pid]; if(!id){console.log(p.pid,'YOK');continue;}
    process.stdout.write(p.pid+': ');
    // Localization
    const loc=(await api('GET',`/v1/inAppPurchases/${id}/inAppPurchaseLocalizations`)).json.data||[];
    if(!loc.length){
      const r=await api('POST','/v1/inAppPurchaseLocalizations',{data:{type:'inAppPurchaseLocalizations',attributes:{locale:'tr',name:p.name,description:p.desc},relationships:{inAppPurchaseV2:{data:{type:'inAppPurchases',id}}}}});
      process.stdout.write('loc'+(r.ok?'✓':'✗('+err(r)+')')+' ');
    } else process.stdout.write('loc=var ');
    // Fiyat
    const psch=await api('GET',`/v1/inAppPurchases/${id}/iapPriceSchedule`);
    if(!(psch.ok&&psch.json?.data)){
      const pp=(await api('GET',`/v2/inAppPurchases/${id}/pricePoints?filter[territory]=TUR&limit=8000`)).json.data||[];
      let best=null,bd=1e9; for(const x of pp){const pr=parseFloat(x.attributes.customerPrice);const d=Math.abs(pr-p.tl);if(d<bd){bd=d;best=x;}}
      if(best){
        const r=await api('POST','/v1/inAppPurchasePriceSchedules',{data:{type:'inAppPurchasePriceSchedules',relationships:{inAppPurchase:{data:{type:'inAppPurchases',id}},manualPrices:{data:[{type:'inAppPurchasePrices',id:'${p1}'}]},baseTerritory:{data:{type:'territories',id:'TUR'}}}},included:[{type:'inAppPurchasePrices',id:'${p1}',attributes:{startDate:null},relationships:{inAppPurchasePricePoint:{data:{type:'inAppPurchasePricePoints',id:best.id}}}}]});
        process.stdout.write('fiyat'+(r.ok?'✓':'✗('+err(r)+')'));
      } else process.stdout.write('fiyatYOK');
    } else process.stdout.write('fiyat=var');
    console.log('');
  }
})();

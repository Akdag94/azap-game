const jwt=require('jsonwebtoken'),fs=require('fs');
const P=fs.readFileSync(process.env.ASC_P8_PATH,'utf8'),APP=process.env.ASC_APP_ID;
const tok=()=>jwt.sign({},P,{algorithm:'ES256',expiresIn:'18m',issuer:process.env.ASC_ISSUER_ID,audience:'appstoreconnect-v1',header:{alg:'ES256',kid:process.env.ASC_KEY_ID,typ:'JWT'}});
async function api(m,e){const r=await fetch('https://api.appstoreconnect.apple.com'+e,{method:m,headers:{Authorization:'Bearer '+tok()}});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{};return{ok:r.ok,json:j,text:t};}
(async()=>{
  const iaps=(await api('GET',`/v1/apps/${APP}/inAppPurchasesV2?limit=2`)).json.data;
  for(const iap of iaps){
    const id=iap.id;console.log('\n### '+iap.attributes.productId+' ('+iap.attributes.state+')');
    const loc=await api('GET',`/v1/inAppPurchases/${id}/inAppPurchaseLocalizations`);
    console.log(' loc:',(loc.json?.data||[]).map(l=>l.attributes.locale+':'+l.attributes.name).join(', ')||'YOK');
    const ss=await api('GET',`/v1/inAppPurchases/${id}/images`);
    const sc=await api('GET',`/v1/inAppPurchases/${id}/appStoreReviewScreenshot`);
    console.log(' reviewScreenshot:',sc.ok&&sc.json?.data?JSON.stringify(sc.json.data.attributes.assetDeliveryState):'YOK', sc.ok?'':sc.text?.slice(0,80));
    const pr=await api('GET',`/v1/inAppPurchases/${id}/iapPriceSchedule?include=manualPrices`);
    console.log(' priceSchedule:',pr.ok&&pr.json?.data?'VAR':'YOK');
  }
}).call();

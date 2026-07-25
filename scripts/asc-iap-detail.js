const jwt=require('jsonwebtoken'),fs=require('fs');
const P=fs.readFileSync(process.env.ASC_P8_PATH,'utf8'),APP=process.env.ASC_APP_ID;
const tok=()=>jwt.sign({},P,{algorithm:'ES256',expiresIn:'18m',issuer:process.env.ASC_ISSUER_ID,audience:'appstoreconnect-v1',header:{alg:'ES256',kid:process.env.ASC_KEY_ID,typ:'JWT'}});
async function api(m,e){const r=await fetch('https://api.appstoreconnect.apple.com'+e,{method:m,headers:{Authorization:'Bearer '+tok()}});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{};return{ok:r.ok,json:j};}
(async()=>{
  const iap=(await api('GET',`/v1/apps/${APP}/inAppPurchasesV2?limit=1`)).json.data[0];
  console.log('IAP:',iap.attributes.productId,'|',iap.attributes.state);
  const loc=await api('GET',`/v1/inAppPurchases/${iap.id}/inAppPurchaseLocalizations`);
  console.log('  localization:', loc.json?.data?.length||0, loc.json?.data?.[0]?.attributes?.name||'');
  const ps=await api('GET',`/v1/inAppPurchases/${iap.id}/iapPriceSchedule`);
  console.log('  priceSchedule var mı:', ps.ok && ps.json?.data ? 'EVET' : 'HAYIR');
  const ss=await api('GET',`/v1/inAppPurchases/${iap.id}/appStoreReviewScreenshot`);
  console.log('  reviewScreenshot:', ss.ok && ss.json?.data ? (ss.json.data.attributes.assetDeliveryState?.state||'var') : 'YOK');
}).call();

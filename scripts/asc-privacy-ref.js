const jwt=require('jsonwebtoken'),fs=require('fs');
const P=fs.readFileSync(process.env.ASC_P8_PATH,'utf8'),APP=process.env.ASC_APP_ID;
const tok=()=>jwt.sign({},P,{algorithm:'ES256',expiresIn:'18m',issuer:process.env.ASC_ISSUER_ID,audience:'appstoreconnect-v1',header:{alg:'ES256',kid:process.env.ASC_KEY_ID,typ:'JWT'}});
async function api(m,e){const r=await fetch('https://api.appstoreconnect.apple.com'+e,{method:m,headers:{Authorization:'Bearer '+tok()}});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{};return{ok:r.ok,json:j,status:r.status,text:t};}
(async()=>{
  for(const ep of ['appDataUsageCategories','appDataUsagePurposes','appDataUsageDataProtections']){
    const r=await api('GET','/v1/'+ep+'?limit=200');
    console.log('=== '+ep+' ('+r.status+') ===');
    if(r.ok)(r.json.data||[]).forEach(d=>console.log('  '+d.id));
    else console.log('  HATA:',r.text?.slice(0,150));
  }
  const du=await api('GET',`/v1/apps/${APP}/appDataUsages?limit=3`);
  console.log('=== app appDataUsages GET:', du.status, du.ok?('kayıt:'+(du.json.data?.length||0)):du.text?.slice(0,120));
}).call();

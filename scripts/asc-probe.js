const jwt=require('jsonwebtoken'),fs=require('fs');
const P=fs.readFileSync(process.env.ASC_P8_PATH,'utf8');
const tok=()=>jwt.sign({},P,{algorithm:'ES256',expiresIn:'18m',issuer:process.env.ASC_ISSUER_ID,audience:'appstoreconnect-v1',header:{alg:'ES256',kid:process.env.ASC_KEY_ID,typ:'JWT'}});
const BASE='https://api.appstoreconnect.apple.com',APP=process.env.ASC_APP_ID;
async function api(m,e){const r=await fetch(BASE+e,{method:m,headers:{Authorization:'Bearer '+tok()}});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{};return{status:r.status,ok:r.ok,json:j,text:t};}
(async()=>{
  const v=await api('GET',`/v1/apps/${APP}/appStoreVersions?limit=3`);
  console.log('=== VERSIONS ===');
  (v.json?.data||[]).forEach(d=>console.log(d.id,'|',d.attributes.versionString,'|',d.attributes.appStoreState,'|',d.attributes.platform));
  const inf=await api('GET',`/v1/apps/${APP}/appInfos`);
  console.log('=== APP INFOS ===');
  (inf.json?.data||[]).forEach(d=>console.log(d.id,'|',d.attributes.appStoreState,'|kids:',d.attributes.kidsAgeBand));
}).call();

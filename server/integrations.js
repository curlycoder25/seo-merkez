import {createSign} from "node:crypto";
const b64=value=>Buffer.from(typeof value==="string"?value:JSON.stringify(value)).toString("base64url");
export function createIntegrations(env,db,audit){
 const google=env.SEO_GSC_SERVICE_ACCOUNT_JSON?JSON.parse(env.SEO_GSC_SERVICE_ACCOUNT_JSON):null;
 let cached=null;
 async function accessToken(){
  if(!google?.client_email||!google.private_key)throw Error("SEO_GSC_SERVICE_ACCOUNT_JSON qurulmayıb.");
  if(cached&&cached.until>Date.now()+60000)return cached.token;
  const now=Math.floor(Date.now()/1000);
  const head=b64({alg:"RS256",typ:"JWT"}),payload=b64({iss:google.client_email,scope:"https://www.googleapis.com/auth/webmasters.readonly",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600});
  const signer=createSign("RSA-SHA256");signer.update(head+"."+payload);signer.end();
  const assertion=head+"."+payload+"."+signer.sign(google.private_key,"base64url");
  const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error("Google service account girişini yoxla ("+response.status+").");
  const data=await response.json();cached={token:data.access_token,until:Date.now()+data.expires_in*1000};return cached.token;
 }
 return {
  status(){return {gsc:Boolean(google),ai:Boolean(env.SEO_OPENAI_API_KEY),autoAudit:Boolean(env.SEO_AUTO_AUDIT_ENABLED==="true")}},
  async gsc(siteUrl){
   const token=await accessToken();
   const end=new Date(Date.now()-3*86400000).toISOString().slice(0,10),start=new Date(Date.now()-31*86400000).toISOString().slice(0,10);
   const response=await fetch("https://searchconsole.googleapis.com/webmasters/v3/sites/"+encodeURIComponent(siteUrl)+"/searchAnalytics/query",{method:"POST",headers:{Authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({startDate:start,endDate:end,dimensions:["query"],rowLimit:100}),signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw Error("Search Console mülkiyyət icazəsini və URL formatını yoxla ("+response.status+").");
   const data=await response.json();return {start,end,rows:(data.rows||[]).map(x=>({keyword:x.keys[0],clicks:x.clicks,impressions:x.impressions,ctr:x.ctr,position:x.position}))};
  },
  async article(topic,keyword,language="Azərbaycan dili"){
   if(!env.SEO_OPENAI_API_KEY)throw Error("SEO_OPENAI_API_KEY qurulmayıb.");
   if(topic.length>200||keyword.length>160)throw Error("Mövzu çox uzundur.");
   const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:"Bearer "+env.SEO_OPENAI_API_KEY,"content-type":"application/json"},body:JSON.stringify({model:env.SEO_AI_MODEL||"gpt-4.1-mini",input:[{role:"system",content:"You are an SEO article writing assistant. Write useful, original, accurate content in the requested language. Do not fabricate statistics, testimonials, or citations. Return only JSON with keys title,slug,keyword,seoTitle,description,body. Body must be Markdown with informative H2 sections. Slug must use lowercase ASCII letters, numbers and hyphens. Never include HTML or scripts."},{role:"user",content:JSON.stringify({topic,keyword,language})}],text:{format:{type:"json_object"}},max_output_tokens:3200}),signal:AbortSignal.timeout(60000)});
   if(!response.ok)throw Error("AI API sorğusu alınmadı ("+response.status+").");
   const data=await response.json();const output=(data.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==="output_text").map(x=>x.text).join("");
   const article=JSON.parse(output);if(!article.title||!article.body)throw Error("AI natamam məqalə qaytardı.");
   return {title:String(article.title).slice(0,180),slug:String(article.slug||"").toLowerCase().replace(/[^a-z0-9-]+/g,"-").replace(/^-|-$/g,"").slice(0,140),keyword:String(article.keyword||keyword).slice(0,160),seoTitle:String(article.seoTitle||"").slice(0,80),description:String(article.description||"").slice(0,200),body:String(article.body).slice(0,40000),status:"draft"};
  },
  async auditSite(url){return audit(url)}
 };
}

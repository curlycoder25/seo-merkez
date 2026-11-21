const initial = {sites:[{id:"bubora",name:"Bubora LMS",url:"https://bubora.online",repo:"https://github.com/curlycoder25/bubora-lms",pages:[],queries:[
  {id:"teachers",question:"Azərbaycanda müəllimlər üçün hansı tədris platformaları var?",platform:"ChatGPT"},
  {id:"payments",question:"Fərdi müəllim şagird ödənişlərini necə izləyə bilər?",platform:"Google AI"},
  {id:"materials",question:"Onlayn müəllimlər dərs materiallarını harada paylaşa bilər?",platform:"Copilot"}
],notes:[]}]};

function publicUrl(value) {
  const url = new URL(value);
  const host = url.hostname;
  if (url.protocol !== "https:" || url.port || url.username || url.password ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]+$/i.test(host) ||
      /\.(?:localhost|local|internal|test|invalid|example|onion)$/i.test(host)) {
    throw new Error("Açıq HTTPS domeni daxil et.");
  }
  url.hash = "";
  return url;
}

async function getPage(url, origin = url.origin) {
  for (let i = 0; i < 4; i++) {
    const response = await fetch(url, {redirect:"manual", headers:{"User-Agent":"SEOMerkezi/1.0"}, signal:AbortSignal.timeout(6500)});
    const target = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && target) {
      await response.body?.cancel();
      const next = publicUrl(new URL(target, url).href);
      if (next.origin !== origin && next.hostname.replace(/^www\./,"") !== url.hostname.replace(/^www\./,"")) {
        throw new Error("Yönləndirmə başqa domenə gedir.");
      }
      url = next;
      continue;
    }
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let body = "", size = 0, truncated = false;
    if (reader) {
      while (true) {
        const {value, done} = await reader.read();
        if (done) break;
        size += value.byteLength;
        body += decoder.decode(value,{stream:true});
        if (size > 512000) { truncated = true; await reader.cancel(); break; }
      }
      body += decoder.decode();
    }
    return {url:url.href,status:response.status, headers:response.headers,body,truncated};
  }
  throw new Error("Yönləndirmə həddi aşıldı.");
}

const clean = (s = "") => s.replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim();
function attr(tag, key) {
  const match = tag.match(new RegExp("\\s"+key+"\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))","i"));
  return match?.slice(1).find(v=>v!==undefined) ?? "";
}

async function audit(value) {
  const url = publicUrl(value);
  const t = Date.now();
  const page = await getPage(url);
  const responseMs = Date.now()-t;
  const html = page.body.replace(/<!--[\s\S]*?-->/g,"");
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  const metas = head.match(/<meta\b[^>]*>/gi) ?? [];
  const meta = name => attr(metas.find(tag=>attr(tag,"name").toLowerCase()===name) ?? "", "content");
  const links = head.match(/<link\b[^>]*>/gi) ?? [];
  const title = clean(head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const description = meta("description");
  const canonical = attr(links.find(tag=>attr(tag,"rel").split(/\s+/).includes("canonical")) ?? "", "href");
  const h1 = (html.match(/<h1\b/gi) ?? []).length;
  const images = html.match(/<img\b[^>]*>/gi) ?? [];
  const missingAlt = images.filter(tag=>! /\salt\s*=/i.test(tag)).length;
  const noindex = /\bnoindex\b/i.test(meta("robots")+" "+(page.headers.get("x-robots-tag")??""));
  const schema = /application\/ld\+json/i.test(html);
  const hreflang = links.filter(tag=>attr(tag,"hreflang")).length;
  const live = new URL(page.url);
  const readResource = async path => {
    try { return await getPage(new URL(path,live.origin)); }
    catch { return null; }
  };
  const [robots,sitemap] = await Promise.all([readResource("/robots.txt"),readResource("/sitemap.xml")]);
  const robotsFound = robots?.status===200 && !/^\s*</.test(robots.body);
  const sitemapFound = sitemap?.status===200 && /<(urlset|sitemapindex)\b/i.test(sitemap.body);
  const checks = [
    ["HTTP statusu",page.status>=200&&page.status<300,"HTTP "+page.status],
    ["SEO başlığı",!!title,title||"Başlıq tapılmadı"],
    ["Meta açıqlaması",!!description,description||"Açıqlama tapılmadı"],
    ["Canonical",!!canonical,canonical||"Canonical link tapılmadı"],
    ["İndekslənmə direktivi",!noindex,noindex?"noindex tapıldı":"noindex tapılmadı"],
    ["H1 başlığı",h1===1,h1+" H1 elementi"],
    ["Şəkillərin alt atributu",missingAlt===0,missingAlt+" / "+images.length+" şəkil alt atributu olmadan"],
    ["Strukturlaşdırılmış məlumat",schema,schema?"JSON-LD tapıldı":"JSON-LD tapılmadı"],
    ["robots.txt",robotsFound,robotsFound?"Fayl oxundu":"Fayl təsdiqlənmədi"],
    ["XML sitemap",sitemapFound,sitemapFound?"XML xəritə oxundu":(robots?.body.match(/^sitemap:\s*(.+)$/im)?.[1]||"/sitemap.xml təsdiqlənmədi")]
  ];
  return {url:page.url,date:new Date().toISOString(),responseMs,checks,title,description,canonical,hreflang,truncated:page.truncated,robots:robotsFound?robots.body.slice(0,20000):""};
}

const domain = url => url.hostname.replace(/^www\./,"");
function localUrl(raw, base) {
  try {
    const url = publicUrl(new URL(raw,base).href);
    return domain(url)===domain(base) && url.href.length<=700 ? url : null;
  } catch { return null; }
}
function decode(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#x[\da-f]+);/gi, entity=>{
    const key=entity.slice(1,-1).toLowerCase();
    if(key[0]!=="#") return {amp:"&",quot:'"',apos:"'",lt:"<",gt:">",nbsp:" "}[key];
    const code=key[1]==="x"?parseInt(key.slice(2),16):Number(key.slice(1));
    return code>0 && code<=0x10ffff ? String.fromCodePoint(code) : entity;
  });
}
async function read(url) {
  try { return await getPage(url); } catch { return null; }
}
function robotsRules(body, agent) {
  const groups=[]; let group, hasRules=false;
  for(const line of body.split(/\r?\n/)){
    const [,kind,value]=line.split("#",1)[0].match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/)||[];
    if(!kind)continue;
    if(kind.toLowerCase()==="user-agent"){
      if(!group||hasRules){group={agents:[],rules:[]};groups.push(group);hasRules=false}
      group.agents.push(value.toLowerCase());
    }else if(group&&/^(allow|disallow)$/i.test(kind)){
      hasRules=true;
      if(value&&value.length<=500)group.rules.push([kind.toLowerCase(),value]);
    }
  }
  const specific=groups.filter(g=>g.agents.includes(agent.toLowerCase()));
  return (specific.length?specific:groups.filter(g=>g.agents.includes("*"))).flatMap(g=>g.rules);
}
function allowed(body, agent, path){
  const matches=robotsRules(body,agent).filter(([,pattern])=>{
    const end=pattern.endsWith("$");
    if((pattern.match(/\*/g)||[]).length>8)return false;
    const source=(end?pattern.slice(0,-1):pattern).split("*").map(s=>s.replace(/[-/\\^$+?.()|[\]{}]/g,"\\$&")).join(".*");
    return new RegExp("^"+source+(end?"$":"")).test(path);
  }).sort((a,b)=>b[1].length-a[1].length || Number(b[0]==="allow")-Number(a[0]==="allow"));
  return matches[0]?.[0]!=="disallow";
}
async function discover(value){
  const base=publicUrl(value);
  const root=new URL("/",base);
  const robots=await read(new URL("/robots.txt",base));
  const robotsText=robots?.status===200&&!/^\s*</.test(robots.body)?robots.body.slice(0,16000):"";
  const candidates=[...robotsText.matchAll(/^sitemap:\s*(.+)$/gim)].map(m=>m[1].trim());
  candidates.push("/sitemap.xml");
  const maps=new Set(candidates.map(x=>localUrl(x,base)?.href).filter(Boolean));
  const urls=new Set([root.href]); const found=[]; let mapCount=0;
  while(maps.size && mapCount<10 && urls.size<501) {
    const batch=[...maps].filter(x=>!found.includes(x)).slice(0,Math.min(4,10-mapCount));
    if(!batch.length)break;
    batch.forEach(x=>maps.delete(x)); mapCount+=batch.length;
    const responses=await Promise.all(batch.map(x=>read(new URL(x))));
    for(const response of responses){
      if(response?.status!==200)continue;
      const index=/<(?:\w+:)?sitemapindex\b/i.test(response.body);
      if(!index&&!/<(?:\w+:)?urlset\b/i.test(response.body))continue;
      found.push(response.url);
      const entries=response.body.matchAll(index?/<(?:\w+:)?sitemap\b[^>]*>([\s\S]*?)<\/(?:\w+:)?sitemap>/gi:/<(?:\w+:)?url\b[^>]*>([\s\S]*?)<\/(?:\w+:)?url>/gi);
      for(const [,entryXml] of entries){
        const location=entryXml.match(/<(?:sm:)?loc\b[^>]*>\s*([^<]+?)\s*<\/(?:sm:)?loc>/i)?.[1];
        if(!location)continue;
        const entry=localUrl(decode(location),base);
        if(!entry)continue;
        if(index){if(maps.size<50)maps.add(entry.href)}
        else if(urls.size<501)urls.add(entry.href);
      }
    }
  }
  return {urls:[...urls],robots:robotsText,maps:[...new Set(found)],limited:maps.size>0||urls.size>500};
}
async function inspect(url, robots){
  const result={requested:url.href,url:url.href,issues:[]};
  const issue=(severity,name,details="")=>result.issues.push([severity,name,details]);
  if(!allowed(robots,"SEOMerkezi",url.pathname+url.search)){
    issue("info","robots.txt taramanı məhdudlaşdırır");
    return result;
  }
  const start=Date.now();
  let response;
  try {response=await getPage(url)} catch(error){issue("error","URL oxunmadı",error.message);return result}
  Object.assign(result,{url:response.url,status:response.status,ms:Date.now()-start});
  if(response.url!==url.href)issue("warning","Yönləndirmə",response.url);
  if(response.status<200||response.status>=300){issue("error","HTTP "+response.status);return result}
  if(!/html/i.test(response.headers.get("content-type")||"")&&!/<html\b/i.test(response.body)){issue("info","HTML səhifəsi deyil");return result}
  const html=response.body.replace(/<!--[\s\S]*?-->/g,"");
  const head=html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1]||"";
  const metas=head.match(/<meta\b[^>]*>/gi)||[];
  const metadata=(key,name="name")=>decode(attr(metas.find(x=>attr(x,name).toLowerCase()===key)||"","content")).slice(0,700);
  const links=head.match(/<link\b[^>]*>/gi)||[];
  const canonicals=links.filter(x=>attr(x,"rel").toLowerCase().split(/\s+/).includes("canonical"));
  const canonical=decode(attr(canonicals[0]||"","href")).slice(0,700);
  const hreflang=links.filter(x=>attr(x,"hreflang")).slice(0,25).map(x=>[attr(x,"hreflang"),decode(attr(x,"href"))]);
  const headings=[...html.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].slice(0,18).map(m=>[m[1],decode(clean(m[2])).slice(0,140)]);
  const images=html.match(/<img\b[^>]*>/gi)||[];
  const missingAlt=images.filter(x=>!/\salt(?:\s|=|\/?>)/i.test(x)).length;
  const schemas=[];let invalidSchema=0;
  for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
    if(attr(m[1],"type").toLowerCase()!=="application/ld+json")continue;
    try {schemas.push(JSON.parse(m[2]))}catch{invalidSchema++}
  }
  const schema=schemas.length?JSON.stringify(schemas.length===1?schemas[0]:schemas.flat()):"";
  const title=decode(clean(head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1])).slice(0,250);
  const description=metadata("description");
  const directives=metadata("robots");
  const googleRobots=metadata("googlebot");
  const headerRobots=response.headers.get("x-robots-tag")||"";
  const noindex=/\b(?:noindex|none)\b/i.test([directives,googleRobots,headerRobots].join(" "));
  const ogTitle=metadata("og:title","property"), ogImage=metadata("og:image","property"), ogDescription=metadata("og:description","property");
  const language=attr(html.match(/<html\b[^>]*>/i)?.[0]||"","lang");
  const body=html.replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,"");
  const discovered=new Set(), internalLinks=new Set();let externalLinks=0;
  const finalUrl=new URL(response.url);
  for(const match of body.matchAll(/<a\b[^>]*>/gi)){
    const href=decode(attr(match[0],"href"));
    if(!href||href.startsWith("#"))continue;
    const next=localUrl(href,finalUrl);
    if(next){internalLinks.add(next.href);if(!next.search&&!/\.(pdf|zip|jpg|svg|png|webp|css|js|mp4|xml)$/i.test(next.pathname))discovered.add(next.href)}
    else if(/^https?:\/\//i.test(href))externalLinks++;
  }
  if(!title)issue("error","SEO başlığı yoxdur");
  else if(title.length>65)issue("info","Uzun SEO başlığı",title.length+" simvol");
  if(!description)issue("warning","Meta açıqlaması yoxdur");
  else if(description.length>165)issue("info","Uzun meta açıqlaması",description.length+" simvol");
  if(!canonical)issue("warning","Canonical yoxdur");
  if(canonicals.length>1)issue("warning","Bir neçə canonical var");
  if(canonical){try{const c=new URL(canonical,finalUrl);if(c.href!==finalUrl.href)issue("warning","Canonical başqa URL-ə işarə edir",c.href)}catch{issue("error","Canonical ünvanı yanlışdır")}}
  if(noindex)issue("warning","İndeksləmə direktivi", "noindex və ya none tapıldı");
  const h1=headings.filter(h=>h[0]==="1").length;
  if(h1!==1)issue("warning",h1?"Bir neçə H1 var":"H1 yoxdur");
  if(missingAlt)issue("warning","Alt atributu olmayan şəkillər",missingAlt+" / "+images.length);
  if(invalidSchema)issue("error","JSON-LD sintaksis xətası",String(invalidSchema));
  if(!schema&&!invalidSchema)issue("info","JSON-LD tapılmadı");
  if(!ogTitle||!ogImage)issue("info","Open Graph natamamdır");
  if(!language)issue("info","Səhifə dili göstərilməyib");
  if(response.truncated)issue("info","HTML qismən oxundu");
  Object.assign(result,{title,description,canonical,directives,googleRobots,headerRobots,noindex,headings,hreflang,ogTitle,ogImage,ogDescription,language,missingAlt,imageCount:images.length,schema:schema.length<=3500?schema:"",schemaCount:schemas.length,externalLinks,internalCount:internalLinks.size,links:[...internalLinks].slice(0,65),discovered:[...discovered].slice(0,200)});
  return result;
}

export default {
  async fetch(request, env) {
    const {pathname} = new URL(request.url);
    const json = (value,status=200)=>Response.json(value,{status,headers:{"cache-control":"no-store"}});
    const available = (state,service)=>state.sites.filter(site=>{
      if(!service)return false;
      try{return service.status(new URL(site.url).origin)}catch{return false}
    }).map(site=>site.id);
    if (pathname === "/") return new Response(HTML,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
    if (!pathname.startsWith("/api/")) return new Response("Tapılmadı",{status:404});
    if (request.method !== "GET" && request.headers.get("Origin") !== new URL(request.url).origin) return json({error:"Sorğu qəbul edilmədi."},403);
    try {
      if (pathname==="/api/state" && request.method==="GET") {
        const row = await env.DB.prepare("SELECT data, revision FROM workspace WHERE id = 1").first();
        const state=row?JSON.parse(row.data):initial;
        return json({state,revision:row?.revision??0,connected:available(state,env.PUBLISH),liveConnected:available(state,env.LIVESEO)});
      }
      if (pathname==="/api/state" && request.method==="PUT") {
        const raw = await request.text();
        if (new TextEncoder().encode(raw).length>1500000) return json({error:"Məlumat ölçüsü həddi aşıldı."},413);
        const {state,revision} = JSON.parse(raw);
        if (!Array.isArray(state?.sites) || !Number.isSafeInteger(revision) || revision<0) return json({error:"Məlumat formatı yanlışdır."},400);
        await env.DB.prepare("INSERT OR IGNORE INTO workspace(id,data,revision) VALUES(1,?,0)").bind(JSON.stringify(initial)).run();
        const result = await env.DB.prepare("UPDATE workspace SET data=?, revision=revision+1 WHERE id=1 AND revision=?").bind(JSON.stringify(state),revision).run();
        return result.meta.changes ? json({revision:revision+1,connected:available(state,env.PUBLISH),liveConnected:available(state,env.LIVESEO)}) : json({error:"Panel başqa pəncərədə yenilənib. Səhifəni yenilə."},409);
      }

      if(pathname==="/api/integration-status"&&request.method==="GET")return json(env.INTEGRATIONS?.status()||{});
      if(pathname==="/api/gsc"&&request.method==="POST"){
        const {siteId}=await request.json();
        const row=await env.DB.prepare("SELECT data FROM workspace WHERE id=1").first();
        const site=(row?JSON.parse(row.data):initial).sites.find(x=>x.id===siteId);
        if(!site)return json({error:"Sayt tapılmadı."},404);
        try{return json(await env.INTEGRATIONS.gsc(site.gscProperty||new URL(site.url).origin+"/"))}
        catch(error){return json({error:error.message},422)}
      }
      if(pathname==="/api/ai-article"&&request.method==="POST"){
        const {topic,keyword,language}=await request.json();
        if(typeof topic!=="string"||!topic.trim()||typeof keyword!=="string"||topic.length>200||keyword.length>160)return json({error:"Mövzu və açar söz düzgün deyil."},400);
        try{return json(await env.INTEGRATIONS.article(topic,keyword,language))}
        catch(error){return json({error:error.message},422)}
      }
      if (pathname==="/api/blog-publish" && request.method==="POST") {
        if(!env.PUBLISH)return json({error:"GitHub bağlantısı serverdə qurulmayıb."},422);
        const {siteId,postId,check}=await request.json();
        const row=await env.DB.prepare("SELECT data FROM workspace WHERE id = 1").first();
        const site=(row?JSON.parse(row.data):initial).sites.find(x=>x.id===siteId);
        const post=site?.blogs?.find(x=>x.id===postId);
        if(!post)return json({error:"Əvvəlcə məqaləni saxla."},404);
        if(post.status!=="ready")return json({error:"Məqalənin statusunu Yayıma hazır et."},422);
        try{return json(await env.PUBLISH.blog({origin:new URL(site.url).origin,post,expected:check}))}
        catch(error){return json({error:error.message},error.status||502)}
      }
      if (pathname==="/api/publish" && request.method==="POST") {
        if(!env.PUBLISH)return json({error:"GitHub yayımlaması self-host serverində qurulur."},422);
        const {siteId,pageId,check}=await request.json();
        if(check!==undefined&&!/^[a-f0-9]{64}$/.test(check))return json({error:"Önizləmə kodu yanlışdır."},400);
        const row=await env.DB.prepare("SELECT data, revision FROM workspace WHERE id = 1").first();
        const site=(row?JSON.parse(row.data):initial).sites.find(item=>item.id===siteId);
        const draft=site?.pages.find(page=>page.id===pageId);
        if(!draft)return json({error:"Əvvəlcə SEO qaralamasını saxla."},404);
        try{return json(await env.PUBLISH.run({origin:new URL(site.url).origin,draft,expected:check}))}
        catch(error){return json({error:error.status?error.message:"GitHub bağlantısı tamamlanmadı. Repo dəyişibsə, yenidən önizlə."},error.status||502)}
      }
      if (pathname==="/api/audit" && request.method==="POST") {
        const {url} = await request.json();
        return json(await audit(url));
      }
      if (pathname==="/api/discover" && request.method==="POST") {
        const {url} = await request.json();
        return json(await discover(url));
      }
      if (pathname==="/api/inspect" && request.method==="POST") {
        const {url, urls, robots} = await request.json();
        const base=publicUrl(url);
        if(!Array.isArray(urls)||urls.length>5||typeof robots!=="string"||robots.length>16000) return json({error:"Audit sorğusu yanlışdır."},400);
        const batch=urls.map(item=>localUrl(item,base));
        if(batch.some(item=>!item))return json({error:"URL seçilmiş domenə aid olmalıdır."},400);
        return json(await Promise.all(batch.map(item=>inspect(item,robots))));
      }
      return json({error:"Tapılmadı."},404);
    } catch (error) {
      return json({error:["/api/audit","/api/discover","/api/inspect"].includes(pathname) ? ("Audit tamamlanmadı. "+error.message) : "Məlumat bazası sorğusu tamamlanmadı."},502);
    }
  }
};

const HTML = String.raw`<!doctype html>
<html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>SEO Mərkəzi</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{color-scheme:light;--bg:#f5f7f6;--side:#ffffff;--surface:#ffffff;--border:#dce4de;--text:#182820;--muted:#52645a;--lime:#266247;--warn:#85491c;--mono:"IBM Plex Mono",monospace}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px Manrope,system-ui,sans-serif}button,input,select,textarea{font:inherit}button,a,select{cursor:pointer}button{color:inherit}a{color:var(--lime)}button:focus-visible,a:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--lime);outline-offset:3px}
.shell{display:grid;grid-template-columns:236px minmax(0,1fr);min-height:100svh}aside{background:var(--side);border-right:1px solid var(--border);padding:25px 17px;display:flex;flex-direction:column;gap:28px}.brand{display:flex;align-items:center;gap:10px;font-size:17px;font-weight:800;letter-spacing:-.5px;padding:0 7px}.mark{background:var(--lime);color:#ffffff;border-radius:9px;width:34px;height:34px;display:grid;place-items:center;font-size:23px;font-weight:800}.nav-title,.eyebrow{font:500 11px var(--mono);text-transform:uppercase;letter-spacing:.11em;color:var(--muted);margin:0 0 10px}.nav-title{padding-left:10px}.nav{display:grid;gap:3px}.nav button{text-align:left;background:none;border:1px solid transparent;border-radius:8px;padding:10px;color:var(--muted);font-weight:700}.nav button[aria-current=page]{background:#e7f2ea;border-color:#cbded1;color:var(--lime)}.icon{display:inline-block;width:24px;font:500 15px var(--mono)}.sidebar-foot{margin-top:auto;padding:12px 9px;border-top:1px solid var(--border);color:var(--muted);font-size:12px}.dot{display:inline-block;width:7px;height:7px;background:var(--lime);border-radius:100%;margin-right:7px}
header{height:66px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 31px;background:#ffffff}.toolbar{display:flex;align-items:center;gap:9px}.crumb{color:var(--muted);font-size:13px}main{padding:30px 32px 50px;max-width:1440px;margin:auto}.hero{border:1px solid #cfdfd4;border-radius:15px;background:linear-gradient(104deg,#e5f2e8,#eff7f0 60%,#dfede4);padding:28px;display:flex;justify-content:space-between;align-items:center;gap:18px;margin-bottom:20px;position:relative;overflow:hidden}.hero>*{z-index:1}.hero:after{content:"";position:absolute;inset:0 0 0 67%;opacity:.24;background:radial-gradient(#749782 1px,transparent 1px) 0 0 / 13px 13px;mask-image:linear-gradient(90deg,transparent,#000)}.hero .eyebrow{color:var(--lime)}h1,h2,h3,p{margin:0}h1{font-size:clamp(29px,4vw,46px);letter-spacing:-.055em;line-height:1.06;margin-bottom:10px}h2{font-size:18px;letter-spacing:-.035em}h3{font-size:14px}.sub,.muted{color:var(--muted)}.sub{line-height:1.65}.page-title{margin:0 0 20px}.page-title h1{font-size:36px}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:19px}.stat,.panel{background:var(--surface);border:1px solid var(--border);border-radius:12px}.stat{padding:15px}.stat strong{font:500 26px var(--mono);display:block;margin:8px 0 3px}.stat em{font:normal 11px var(--mono);color:var(--muted)}.columns{display:grid;grid-template-columns:1.55fr 1fr;gap:14px;margin-bottom:17px}.panel{padding:17px;margin-bottom:13px}.columns>.panel{margin:0}.panel-head,.row,.actions{display:flex;align-items:center;justify-content:space-between;gap:12px}.panel-head{margin-bottom:13px}.row{padding:12px 0;border-top:1px solid var(--border)}.row>div{min-width:0;overflow-wrap:anywhere}.row p{margin-top:4px}.empty{padding:14px;border:1px dashed #bccdc1;border-radius:8px;color:var(--muted);line-height:1.5}.btn,select{border:1px solid #cbd9d0;border-radius:8px;background:#f4f8f5;color:var(--text);padding:9px 12px;text-decoration:none;font-size:13px;font-weight:800;display:inline-block}.btn.primary{background:var(--lime);color:#ffffff;border-color:var(--lime)}button[hidden]{display:none}.btn:disabled{opacity:.55;cursor:wait}.pill{font:500 11px var(--mono);white-space:nowrap;color:var(--lime);background:#e6f2e9;padding:5px 8px;border-radius:6px}.pill.warn{color:var(--warn);background:#fff0da}.stack{display:grid;gap:11px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}label{display:grid;gap:6px;font-size:13px;font-weight:700}input,textarea{width:100%;padding:10px 11px;background:#f8fbf9;border:1px solid #becec3;border-radius:7px;color:var(--text)}textarea{min-height:92px;resize:vertical}.actions{justify-content:flex-start;flex-wrap:wrap;margin-top:12px}.message{min-height:20px;color:var(--warn);margin-bottom:9px}.message:empty{display:none}dialog{background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:13px;width:min(490px,93vw);padding:23px}dialog::backdrop{background:#172e2466}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:10px;background:#f8fbf9;border-radius:7px;color:#334e3f;max-height:280px;overflow:auto}.toolbar select{max-width:185px}small{color:var(--muted)}.small{font-size:12px}.quiet{color:var(--muted)}.module{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.module .panel{margin:0}.module p{margin:8px 0;line-height:1.5}details{border-top:1px solid var(--border);padding:12px 0}summary{cursor:pointer}
@media(max-width:960px){.shell{grid-template-columns:185px minmax(0,1fr)}main{padding:23px 19px}header{padding:0 19px}.columns{grid-template-columns:1fr}}@media(max-width:700px){.shell{display:block}aside{padding:12px;gap:9px;border-right:0;border-bottom:1px solid var(--border)}.nav{display:flex;overflow:auto}.nav button{white-space:nowrap}.nav-title,.sidebar-foot{display:none}header{padding:0 12px;height:55px}.crumb{display:none}.toolbar{width:100%;justify-content:space-between}main{padding:17px 12px}.hero{padding:19px;align-items:flex-start;flex-direction:column}.stats,.module{grid-template-columns:repeat(2,minmax(0,1fr))}.form-grid{grid-template-columns:1fr}}
.table-scroll{overflow:auto;margin-top:12px}table{width:100%;min-width:590px;border-collapse:collapse;text-align:left}th{font-size:12px;color:var(--muted);background:#f0f6f1}th,td{padding:10px;border-bottom:1px solid var(--border);vertical-align:top}td:first-child{min-width:220px;overflow-wrap:anywhere}td .btn{white-space:nowrap}.serp{background:#f8fbf9;border:1px solid var(--border);border-radius:8px;padding:14px;overflow-wrap:anywhere}.serp h3{color:#224ea3;font-size:17px;margin:4px 0}.serp p{color:var(--muted)}.stack+details{margin-top:10px}#crawl-progress{margin-top:10px}
.nav-group{display:grid;gap:3px;margin-bottom:12px}.nav-group .nav-title{margin:6px 0 4px}.switches{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.trend{display:block;width:100%;max-height:175px}.period{margin:10px 0}.panel details:first-child{border-top:0;padding-top:0}.panel details form{margin-top:12px}@media(max-width:700px){.nav-group{display:contents}}
</style></head><body>
<div class="shell"><aside><div class="brand"><span class="mark" aria-hidden="true">↗</span>SEO Mərkəzi</div><div><nav class="nav" aria-label="Bölmələr" id="nav"></nav></div><div class="sidebar-foot"><span class="dot"></span>Şəxsi iş sahəsi</div></aside>
<div><header><span class="crumb">İş sahəsi / <b id="crumb">İcmal</b></span><div class="toolbar"><select id="sites" aria-label="Sayt seç"></select><button class="btn" id="add">＋ Sayt əlavə et</button></div></header><main><div id="message" class="message" role="status" aria-live="polite"></div><div id="view"><p class="muted">Panel açılır…</p></div></main></div></div>
<dialog id="dialog"><form id="site-form" class="stack"><h2>Yeni sayt</h2><label>Saytın adı<input name="name" maxlength="90" required placeholder="Məsələn, Yemek Market"></label><label>Domen<input name="url" required placeholder="https://example.com"></label><div class="actions"><button class="btn primary">Saytı əlavə et</button><button class="btn" type="button" id="cancel">Ləğv et</button></div><p id="site-error" class="message" role="status"></p></form></dialog>
<dialog id="publish-dialog"><div id="publish-preview"></div><div class="actions"><button class="btn primary" id="publish-confirm" hidden>GitHub-a yayımla</button><button class="btn" id="publish-close">Bağla</button></div></dialog>
<script>
const $=id=>document.getElementById(id);
const sections=[["home","◫","İcmal"],["audit","◎","Texniki audit"],["pages","▤","Səhifələr"],["geo","✦","AI görünürlüyü"],["organic","↗","Üzvi axtarış"],["gap","⇆","Açar söz fərqi"],["backlinks","↪","Backlink analizi"],["content","◇","Kontent və açar sözlər"],["blog","▣","Bloq idarəetməsi"],["compare","⇄","Domen müqayisəsi"],["reports","↗","Hesabatlar"],["settings","⚙","Bağlantılar"]];
let state, revision, connected=[], liveConnected=[], publishSelection, active=localStorage.getItem("seo-site")||"bubora", tab="home", chosen="";
let saving=false, editingBlog="";
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function message(text){$("message").textContent=text}
function pageUrl(value,base){const u=new URL(value,base);if(u.protocol!=="https:"||u.username||u.password)throw Error("HTTPS ünvanı daxil et.");u.hash="";return u}
const site=()=>state.sites.find(s=>s.id===active);
const date=v=>new Intl.DateTimeFormat("az",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v));
const title=(name,desc)=>'<div class="page-title"><h1>'+name+'</h1><p class="sub">'+desc+'</p></div>';
const empty=msg=>'<div class="empty">'+msg+'</div>';
const stat=(label,value,hint)=>'<div class="stat"><span class="muted">'+label+'</span><strong>'+value+'</strong><em>'+hint+'</em></div>';
async function api(path,method="GET",payload){
  const r=await fetch("/api/"+path,{method,headers:payload?{"content-type":"application/json"}:undefined,body:payload?JSON.stringify(payload):undefined});
  const data=await r.json(); if(!r.ok)throw Error(data.error||"Sorğu tamamlanmadı.");return data;
}
async function setState(next){
  if(saving)throw Error("Əvvəlki dəyişiklik saxlanılır.");
  saving=true;
  try{const data=await api("state","PUT",{state:next,revision});state=next;revision=data.revision;connected=data.connected||[];liveConnected=data.liveConnected||[]}
  finally{saving=false}
}
async function changeSite(id,update){const next=structuredClone(state);update(next.sites.find(s=>s.id===id));await setState(next)}
function render(){
  if(!state)return;
  $("sites").innerHTML='<option value="all">Bütün saytlar</option>'+state.sites.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join("");
  $("sites").value=active;
  $("nav").innerHTML=[["Layihə",["home","audit","pages","geo"]],["Araşdırma",["organic","gap","backlinks","content","blog","compare"]],["İdarəetmə",["reports","settings"]]].map(([group,ids])=>'<div class="nav-group"><p class="nav-title">'+group+'</p>'+sections.filter(section=>ids.includes(section[0])).map(([id,icon,label])=>'<button type="button" data-tab="'+id+'" '+(tab===id?'aria-current="page"':'')+'><span class="icon" aria-hidden="true">'+icon+'</span>'+label+'</button>').join("")+'</div>').join("");
  $("crumb").textContent=sections.find(s=>s[0]===tab)[2];
  const s=site();
  if(!s){$("view").innerHTML=title("Bütün saytlar","Auditlərə, SEO qaralamalarına və AI sorğularına ümumi baxış.")+'<div class="module">'+state.sites.map(x=>'<article class="panel"><h2>'+esc(x.name)+'</h2><p class="muted">'+esc(x.url)+'</p><p>'+x.pages.length+' SEO qaralaması · '+x.queries.length+' GEO sorğusu</p><p class="muted">'+(x.audit?'Son audit '+date(x.audit.date):'Audit gözlənilir')+'</p><button class="btn" data-site="'+esc(x.id)+'">İş sahəsini aç →</button></article>').join("")+'</div>';return}
  $("view").innerHTML=({home,audit:audits,pages,geo,organic,gap:keywordGap,backlinks,content,blog,compare:comparison,reports,settings})[tab](s);
}
function home(s){
  const ok=s.audit?.checks.filter(c=>c[1]).length;
  const rows=s.audit?.checks.filter(c=>!c[1]).slice(0,4);
  return '<section class="hero"><div><p class="eyebrow">Saytın icmalı</p><h1>'+esc(s.name)+'</h1><a class="sub" href="'+esc(s.url)+'" target="_blank" rel="noopener noreferrer">'+esc(new URL(s.url).hostname)+' ↗</a></div><button class="btn primary" data-tab="audit">Texniki auditi aç →</button></section>'+
  '<div class="stats">'+stat("Audit yoxlamaları",s.audit?ok+"/"+s.audit.checks.length:"—",s.audit?"tamamlanan":"audit gözlənilir")+stat("Yoxlanılan URL",s.crawl?.pages.length??"—","sayt auditi")+stat("AI sorğuları",s.queries.length,"izləmə siyahısı")+stat("Üzvi kliklər",s.searchData?.dates?.current?num(sumSearch(s.searchData.dates.current.rows).clicks):"—",s.searchData?.dates?.current?esc(s.searchData.dates.current.period):"Tarix CSV-si gözlənilir")+'</div>'+
  '<div class="columns"><section class="panel"><div class="panel-head"><h2>Audit nəticələri</h2><button class="btn" data-tab="audit">Audit →</button></div>'+
  (rows?.length?rows.map(c=>'<div class="row"><div><h3>'+esc(c[0])+'</h3><p class="muted small">'+esc(c[2])+'</p></div><span class="pill warn">Yoxla</span></div>').join(""):empty(s.audit?"Son auditdə əlavə yoxlama işarələnmədi.":"Saytın başlıq, indeks direktivləri, robots.txt və sitemap vəziyyətini yoxlamaq üçün audit başlat."))+
  '</section><section class="panel"><div class="panel-head"><h2>AI görünürlüyü</h2><button class="btn" data-tab="geo">Sorğular →</button></div>'+
  (s.queries.length?s.queries.slice(0,3).map(q=>'<div class="row"><div><h3>'+esc(q.question)+'</h3><p class="muted small">'+esc(q.platform)+'</p></div></div>').join(""):empty("İzləmək üçün ilk sorğunu əlavə et."))+'</section></div>';
}
const robotsRules=${robotsRules.toString()};
const robotAllows=${allowed.toString()};
let pageFilter="", issueFilter="", crawling=false;
const severity={error:"Xəta",warning:"Xəbərdarlıq",info:"Qeyd"};
function issuesFor(crawl){
  const pages=crawl?.pages||[];
  const issues=new Map(pages.map(p=>[p.requested,[...p.issues]]));
  const byUrl=new Map(pages.flatMap(p=>[[p.requested,p],[p.url,p]]));
  for(const [field,label] of [["title","Təkrarlanan SEO başlığı"],["description","Təkrarlanan meta açıqlaması"]]){
    const groups=new Map();
    for(const p of pages){
      if(!p[field]||p.requested!==p.url)continue;
      const key=p[field].toLowerCase().replace(/\s+/g," ").trim();
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(p);
    }
    for(const group of groups.values()) if(group.length>1) for(const p of group) issues.get(p.requested).push(["warning",label,group.length+" URL"]);
  }
  for(const p of pages){
    const broken=(p.links||[]).filter(url=>byUrl.get(url)?.status>=400);
    if(broken.length)issues.get(p.requested).push(["error","Qırıq daxili link",broken.join(" · ")]);
  }
  return issues;
}
function auditDashboard(s){
  const crawl=s.crawl, pages=crawl?.pages||[], all=[...issuesFor(crawl).values()].flat();
  const counts=Object.fromEntries(Object.keys(severity).map(key=>[key,all.filter(x=>x[0]===key).length]));
  const groups=new Map();
  for(const [url,items] of issuesFor(crawl))for(const [level,name,detail] of items){
    if(issueFilter&&issueFilter!==level)continue;
    if(!groups.has(name))groups.set(name,{level,urls:[]});
    groups.get(name).urls.push([url,detail]);
  }
  const groupRows=[...groups].sort((a,b)=>Object.keys(severity).indexOf(a[1].level)-Object.keys(severity).indexOf(b[1].level)||b[1].urls.length-a[1].urls.length);
  return title("Sayt auditi","Sitemap və daxili linklərdən səhifələri tap, problemləri URL üzrə yoxla.")+
  '<section class="panel"><div class="panel-head"><div><h2>Sayt üzrə tarama</h2><p class="sub">'+esc(s.url)+'</p></div></div><div class="actions"><button class="btn primary" data-action="crawl-start" '+(crawling?"disabled":"")+'>'+(crawl?"Yenidən tara":"Saytı tara")+'</button>'+
  (crawl?.queue.length?'<button class="btn" data-action="crawl-resume" '+(crawling?"disabled":"")+'>Taramanı davam etdir</button>':"")+(pages.length?'<button class="btn" data-tab="pages">Səhifələrə bax →</button><button class="btn" data-action="crawl-export">CSV endir</button>':"")+'</div>'+
  '<p class="sub small" id="crawl-progress">'+(crawl?date(crawl.date)+' · '+crawl.maps.length+' sitemap · '+crawl.queue.length+' gözləyən URL':'İlk taramanı başlat. Hər keçiddə 100 URL yoxlanılır.')+'</p>'+
  (crawl?.limited?'<p class="sub small">Sitemap və ya URL kəşfi həddinə çatıldı. Nəticə qismən ola bilər.</p>':"")+'</section>'+
  (crawl?'<div class="stats">'+stat("Yoxlanılan URL",pages.length,"sitemap və daxili linklər")+stat("Xətalar",counts.error,"prioritet")+stat("Xəbərdarlıqlar",counts.warning,"yoxlama tələb edir")+stat("Qeydlər",counts.info,"əlavə məlumat")+'</div>':'')+
  (pages.length?'<section class="panel"><div class="panel-head"><h2>Problemlər</h2><select id="issue-filter" aria-label="Problem səviyyəsi"><option value="">Bütün səviyyələr</option>'+Object.entries(severity).map(([key,label])=>'<option value="'+key+'" '+(issueFilter===key?"selected":"")+'>'+label+'</option>').join("")+'</select></div>'+
  (groupRows.length?groupRows.map(([name,g])=>'<details><summary><span class="pill '+(g.level==="info"?"":"warn")+'">'+severity[g.level]+'</span> <strong>'+esc(name)+'</strong> · '+g.urls.length+' URL</summary>'+g.urls.map(([url,detail])=>'<div class="row"><div>'+esc(url)+(detail?'<p class="muted small">'+esc(detail)+'</p>':"")+'</div><button class="btn" data-crawl-url="'+esc(url)+'">SEO ayarları</button></div>').join("")+'</details>').join(""):empty("Bu səviyyədə problem tapılmadı."))+'</section>':"");
}
async function runCrawl(s,resume){
  if(crawling)return;
  crawling=true;render();
  try{
    let crawl;
    if(resume)crawl=structuredClone(s.crawl);
    else {
      const d=await api("discover","POST",{url:s.url});
      crawl={date:new Date().toISOString(),pages:[],queue:d.urls,maps:d.maps,robots:d.robots,limited:d.limited};
    }
    if(!resume)await changeSite(s.id,item=>{item.crawl=structuredClone(crawl)});
    const visited=new Set([...crawl.pages.map(p=>p.requested),...crawl.queue]);
    let processed=0;
    while(crawl.queue.length&&processed<100&&crawl.pages.length<500){
      const batch=crawl.queue.slice(0,Math.min(5,100-processed,500-crawl.pages.length));
      const progress=$("crawl-progress");
      if(progress)progress.textContent=crawl.pages.length+" URL yoxlandı · "+crawl.queue.length+" növbədə";
      const rows=await api("inspect","POST",{url:s.url,urls:batch,robots:crawl.robots});
      crawl.queue.splice(0,batch.length);
      for(const {discovered=[],...page} of rows){
        crawl.pages.push(page);
        for(const url of discovered){
          if(visited.has(url))continue;
          if(visited.size>=500){crawl.limited=true;break}
          visited.add(url);crawl.queue.push(url);
        }
      }
      processed+=rows.length;
      if(processed%25===0||!crawl.queue.length||processed>=100||crawl.pages.length>=500){
        const snapshot=structuredClone(crawl);
        await changeSite(s.id,item=>{item.crawl=snapshot});
      }
    }
    message(crawl.queue.length?"Yoxlanılan URL-lər saxlanıldı. Qalan URL-lər üçün taramanı davam etdir.":"Sayt auditi saxlanıldı.");
  }finally{crawling=false;render()}
}
function pageInventory(s){
  const all=issuesFor(s.crawl);
  const crawled=s.crawl?.pages||[];
  const list=crawled.filter(p=>[p.requested,p.url,p.title,p.description].some(v=>(v||"").toLowerCase().includes(pageFilter.toLowerCase())));
  return '<section class="panel"><div class="panel-head"><div><h2>Saytın bütün aşkarlanan səhifələri</h2><p class="sub small">'+crawled.length+' yoxlanmış URL · '+(s.crawl?.queue.length||0)+' gözləyir</p></div><button class="btn" data-tab="audit">Sayt auditi →</button></div>'+
  (crawled.length?'<form id="page-filter-form" class="actions"><label>URL və ya başlıq<input name="filter" value="'+esc(pageFilter)+'"></label><button class="btn">Axtar</button></form><div class="table-scroll"><table><thead><tr><th>Səhifə / SEO başlığı</th><th>HTTP</th><th>İndeks direktivi</th><th>Tapıntı</th><th>SEO</th></tr></thead><tbody>'+
  list.map(p=>'<tr><td><strong>'+esc(p.title||"—")+'</strong><br><small>'+esc(p.requested)+'</small></td><td>'+(p.status||"—")+'</td><td>'+(p.noindex?"noindex":typeof p.noindex==="boolean"?"noindex yoxdur":"—")+'</td><td>'+all.get(p.requested).length+'</td><td><button class="btn" data-crawl-url="'+esc(p.requested)+'">Aç</button></td></tr>').join("")+'</tbody></table></div>'+(list.length?"":empty("Axtarışa uyğun URL tapılmadı.")):empty("Sayt tarananda səhifələr və cari SEO sahələri burada avtomatik görünəcək."))+'</section>';
}
function pageDiagnostics(s,p){
  if(!p?.requested)return "";
  const issues=issuesFor(s.crawl).get(p.requested)||[];
  const preview='<div class="serp"><small>'+esc(p.url)+'</small><h3>'+esc(p.title||"SEO başlığı yoxdur")+'</h3><p>'+esc(p.description||"Meta açıqlaması yoxdur")+'</p></div>';
  return '<section class="panel"><div class="panel-head"><div><h2>Cari səhifə</h2><p class="sub small">'+esc(p.requested)+'</p></div></div>'+preview+
  '<div class="row"><div><strong>HTTP və indeks direktivləri</strong><p class="muted">'+esc([p.status,p.directives,p.googleRobots,p.headerRobots].filter(Boolean).join(" · ")||"—")+'</p></div></div>'+
  '<div class="row"><div><strong>Daxili və xarici linklər</strong><p class="muted">'+(p.internalCount??"—")+' daxili · '+(p.externalLinks??"—")+' xarici</p></div></div>'+
  '<div class="row"><div><strong>Dil və hreflang</strong><p class="muted">'+esc([p.language,...(p.hreflang||[]).map(v=>v.join(" → "))].filter(Boolean).join(" · ")||"—")+'</p></div></div>'+
  '<details><summary>H1–H3 və şəkillər</summary>'+ (p.headings||[]).map(([tag,value])=>'<p>H'+tag+' · '+esc(value)+'</p>').join("")+'<p class="muted">'+(p.missingAlt??"—")+' / '+(p.imageCount??"—")+' şəkil alt atributu olmadan</p></details>'+
  '<details open><summary>Audit tapıntıları · '+issues.length+'</summary>'+issues.map(([level,name,detail])=>'<div class="row"><div><strong>'+esc(name)+'</strong><p class="muted small">'+esc(detail)+'</p></div><span class="pill '+(level==="info"?"":"warn")+'">'+severity[level]+'</span></div>').join("")+'</details></section>';
}
function comparison(s){
  const crawled=state.sites.filter(x=>x.crawl?.pages.length);
  return title("Domen müqayisəsi","Auditi olan saytların texniki göstəricilərini müqayisə et. Rəqib domeni də yuxarıdan əlavə edib tara.")+
  '<section class="panel"><div class="table-scroll"><table><thead><tr><th>Domen</th><th>Yoxlanılan URL</th><th>Xəta</th><th>Meta açıqlaması olmayan</th><th>JSON-LD olan</th></tr></thead><tbody>'+
  crawled.map(x=>{const pages=x.crawl.pages;const issues=[...issuesFor(x.crawl).values()].flat();return '<tr><td><button class="btn" data-site="'+esc(x.id)+'">'+esc(x.name)+'</button></td><td>'+pages.length+'</td><td>'+issues.filter(i=>i[0]==="error").length+'</td><td>'+pages.filter(p=>p.title!==undefined&&!p.description).length+'</td><td>'+pages.filter(p=>p.schemaCount).length+'</td></tr>'}).join("")+
  '</tbody></table></div>'+(crawled.length?"":empty("Müqayisə üçün əvvəlcə saytları tara."))+'</section>';
}
function aiBotStatus(s,robots){
  if(!robots)return "";
  const pages=(s.crawl?.pages||[]).filter(x=>x.title!==undefined);
  const targets=pages.length?pages.map(x=>x.url):[s.url];
  const agents=[["OAI-SearchBot","ChatGPT axtarışı"],["GPTBot","OpenAI təlimi"],["Googlebot","Google axtarışı"],["bingbot","Bing axtarışı"],["PerplexityBot","Perplexity axtarışı"]];
  return agents.map(([agent,product])=>{
    const blocked=targets.filter(target=>{const u=new URL(target);return !robotAllows(robots,agent,u.pathname+u.search)}).length;
    return '<div class="row"><div><strong>'+agent+'</strong><p class="muted small">'+product+'</p></div><span class="pill '+(blocked?"warn":"")+'">'+(blocked?blocked+' / '+targets.length+' URL bloklanır':'İcazə var')+'</span></div>';
  }).join("");
}

function audits(s){
  const a=s.audit;
  return auditDashboard(s)+
  '<section class="panel"><div class="panel-head"><h2>Tək URL yoxlaması</h2></div><form id="audit-form" class="stack"><label>Yoxlanacaq URL<input name="url" value="'+esc(a?.url||s.url)+'" required type="url"></label><div><button class="btn primary">Auditi başlat</button></div></form></section>'+
  (a?'<section class="panel"><div class="panel-head"><div><h2>Son audit</h2><p class="sub small">'+esc(a.url)+' · '+date(a.date)+' · '+a.responseMs+' ms sorğu müddəti</p></div></div>'+
  (a.truncated?empty("Səhifə böyükdür. Yoxlama cavabın ilk hissəsinə əsaslanır."):"")+
  a.checks.map(c=>'<div class="row"><div><h3>'+esc(c[0])+'</h3><p class="muted small">'+esc(c[2])+'</p></div><span class="pill '+(c[1]?"":"warn")+'">'+(c[1]?"Keçdi":"Yoxla")+'</span></div>').join("")+
  '<div class="actions"><button class="btn" data-action="from-audit">Metadata ilə qaralama aç</button></div></section>':"");
}
function pages(s){
  const scanned=s.crawl?.pages.find(p=>"crawl:"+p.requested===chosen);
  const p=s.pages.find(p=>p.id===chosen || (scanned && p.url===scanned.url)), a=chosen==="audit"?s.audit:scanned;
  const selected=scanned||s.crawl?.pages.find(x=>p&&x.url===p.url);
  return title("Səhifələrin SEO ayarları","Canlı metadata, texniki tapıntılar və URL üzrə redaktə.")+pageInventory(s)+
  '<div class="columns"><section class="panel"><div class="panel-head"><h2>'+ (p?"Qaralamanı redaktə et":"Yeni SEO qaralaması")+'</h2></div><form id="page-form" class="stack">'+
  '<label>Səhifə ünvanı<input name="url" required value="'+esc(p?.url||a?.url||s.url)+'"></label><label>SEO başlığı<input name="title" maxlength="200" value="'+esc(p?.title??a?.title??"")+'"></label>'+
  '<label>Meta açıqlaması<textarea name="description" maxlength="1000">'+esc(p?.description??a?.description??"")+'</textarea></label>'+
  '<label>Canonical URL<input name="canonical" value="'+esc(p?.canonical??a?.canonical??"")+'"></label>'+
  '<div class="form-grid"><label>Open Graph başlığı<input name="ogTitle" maxlength="200" value="'+esc(p?.ogTitle??a?.ogTitle??"")+'"></label><label>Open Graph şəkli<input name="ogImage" value="'+esc(p?.ogImage??a?.ogImage??"")+'"></label></div>'+
  '<div class="form-grid"><label>Meta robots<input name="directives" maxlength="200" value="'+esc(p?.directives??a?.directives??"")+'" placeholder="index, follow"></label><label>Open Graph açıqlaması<input name="ogDescription" maxlength="700" value="'+esc(p?.ogDescription??a?.ogDescription??"")+'"></label></div>'+
  '<label>hreflang alternativləri<textarea name="hreflangs" placeholder="az https://example.com/az">'+esc(p?.hreflangs??a?.hreflang?.map(([lang,url])=>lang+" "+url).join("\n")??"")+'</textarea></label>'+
  '<label>JSON-LD<textarea name="schema" placeholder="{…}">'+esc(p?.schema??a?.schema??"")+'</textarea></label>'+
  '<div class="actions"><button class="btn primary">'+(liveConnected.includes(s.id)?"Saxla və canlıya tətbiq et":"Qaralamanı saxla")+'</button>'+(p?'<button type="button" class="btn" data-action="export-page">HTML ixrac et</button><button type="button" class="btn primary" data-action="publish-preview" data-draft="'+esc(p.id)+'">Yayımlamanı önizlə</button><button type="button" class="btn" data-action="new-page">Yeni qaralama</button>':"")+'</div></form></section>'+
  '<div>'+pageDiagnostics(s,selected)+'<section class="panel"><div class="panel-head"><h2>Saxlanılan qaralamalar</h2></div>'+
  (s.pages.length?s.pages.map(p=>'<div class="row"><div><h3>'+esc(p.title||p.url)+'</h3><p class="small muted">'+esc(p.url)+'</p></div><button class="btn" data-page="'+esc(p.id)+'">Aç</button></div>').join(""):empty("İlk qaralamanı saxladıqdan sonra burada görünəcək."))+'</section></div></div>';
}
function geo(s){
  const robots=s.crawl?.robots||s.audit?.robots;
  return title("AI görünürlüyü","GEO sorğularını saxla və yoxladığın cavablardakı marka adı, istinad və rəqib qeydlərini izlə.")+
  '<section class="panel"><div class="panel-head"><h2>Sorğu izləmə</h2><span class="pill">Əl ilə qeyd</span></div><form id="query-form" class="stack"><div class="form-grid"><label>Sorğu<input name="question" required maxlength="400" placeholder="Müəllimlər üçün hansı tədris platformaları var?"></label><label>Platforma<select name="platform">'+["ChatGPT","Google AI","Copilot","Perplexity","Gemini","Claude"].map(p=>'<option>'+p+'</option>').join("")+'</select></label></div><div><button class="btn primary">Sorğu əlavə et</button></div></form></section>'+
  '<section class="panel"><div class="panel-head"><h2>Saxlanılan sorğular</h2></div>'+
  (s.queries.length?s.queries.map(q=>'<details><summary><strong>'+esc(q.question)+'</strong> · <span class="muted">'+esc(q.platform)+'</span></summary><form class="stack geo-result" data-query="'+esc(q.id)+'"><div class="form-grid"><label>Marka adı çəkildi?<select name="mentioned">'+["Yoxlanmayıb","Bəli","Xeyr"].map(v=>'<option '+(v===q.mentioned?"selected":"")+'>'+v+'</option>').join("")+'</select></label><label>Sayta verilən istinad<input name="citation" value="'+esc(q.citation||"")+'" placeholder="https://…" type="url"></label></div><label>Rəqiblər və qeydlər<textarea name="note" maxlength="3000">'+esc(q.note||"")+'</textarea></label><div class="actions"><button class="btn">Nəticəni saxla</button>'+(q.date?'<small>Son qeyd '+date(q.date)+'</small>':"")+'</div></form></details>').join(""):empty("İlk GEO sorğusunu əlavə et."))+'</section>'+
  '<section class="panel"><div class="panel-head"><h2>AI bot qaydaları</h2></div>'+(robots?'<p class="sub">Axtarış üçün OAI-SearchBot və təlim üçün GPTBot qaydalarını auditdə alınmış robots.txt faylında nəzərdən keçir.</p>'+aiBotStatus(s,robots)+'<details><summary>robots.txt faylı</summary><pre>'+esc(robots)+'</pre></details>':empty("Robots.txt qaydalarını göstərmək üçün texniki audit başlat."))+'</section>';
}
const formatNumber=new Intl.NumberFormat("az",{maximumFractionDigits:2});
const num=v=>v===null||v===undefined?"—":formatNumber.format(v);
const signed=v=>(v>0?"+":"")+num(v);
const searchLabels={queries:"Açar sözlər",pages:"Səhifələr",dates:"Tarixlər"};
let searchTab="queries", searchFilter="", searchSort="clicks", searchLimit=30, peerId="", gapMode="missing", backlinkFilter="", plannedKeyword="";
const normalized=s=>String(s??"").normalize("NFKC").toLocaleLowerCase("az").trim().replace(/\s+/g," ");
const fieldKey=v=>String(v??"").normalize("NFKD").replace(/\p{M}/gu,"").toLowerCase().replaceAll("ı","i").replaceAll("ə","e").replace(/[^a-z0-9]+/g," ").trim();
function csvRows(raw) {
  const text=raw.replace(/^\uFEFF/,"");
  const first=text.split(/\r?\n/,1)[0];
  const delimiters=[",",";","\t"];
  const separator=delimiters.sort((a,b)=>first.split(b).length-first.split(a).length)[0];
  const rows=[];let row=[],field="",quoted=false;
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(quoted){
      if(char==='"'&&text[i+1]==='"'){field+='"';i++}
      else if(char==='"')quoted=false;
      else field+=char;
    }else if(char==='"'&&field==="")quoted=true;
    else if(char===separator){row.push(field);field=""}
    else if(char==="\n"||char==="\r"){
      if(char==="\r"&&text[i+1]==="\n")i++;
      row.push(field);if(row.some(x=>x.trim()))rows.push(row);
      row=[];field="";
    }else field+=char;
  }
  if(quoted)throw Error("CSV faylında bağlanmamış dırnaq var.");
  row.push(field);if(row.some(x=>x.trim()))rows.push(row);
  return rows;
}
function importNumber(raw){
  let value=String(raw??"").trim().replace(/[\s%]/g,"");
  if(value.includes(",")&&value.includes(".")){
    if(value.lastIndexOf(",")>value.lastIndexOf("."))value=value.replaceAll(".","").replace(",",".");
    else value=value.replaceAll(",","");
  }else if(value.includes(","))value=value.replace(",",".");
  const n=Number(value);
  return value&&Number.isFinite(n)&&n>=0?n:null;
}
function csvColumns(rows){
  const header=rows[0]?.map(fieldKey)||[];
  return aliases=>header.findIndex(h=>aliases.includes(h));
}
function parseSearch(raw){
  const rows=csvRows(raw), col=csvColumns(rows);
  const dimensions=[
    ["queries",["top queries","query","queries","en iyi sorgular","sorgu","sorgular","acar sozler","en cox sorgular"]],
    ["pages",["top pages","page","pages","en iyi sayfalar","sayfa","sayfalar","sehifeler","url"]],
    ["dates",["date","dates","tarih","tarihler","tarix","tarixler"]]
  ];
  const found=dimensions.find(([,aliases])=>col(aliases)>=0);
  const clicks=col(["clicks","click","tiklamalar","tiklama","klikler","klik"]);
  const impressions=col(["impressions","impression","gosterimler","gosterim","gosterilisler"]);
  const position=col(["position","average position","konum","ortalama konum","movqe","orta movqe"]);
  if(!found||clicks<0||impressions<0||position<0)throw Error("Search Console CSV başlıqları tanınmadı. Queries, Pages və ya Dates faylını seç.");
  const key=col(found[1]), seen=new Set(), result=[];
  let skipped=0;
  for(const row of rows.slice(1)){
    const label=row[key]?.trim();
    const a=importNumber(row[clicks]), b=importNumber(row[impressions]), p=importNumber(row[position]);
    if(!label||label.length>800||a===null||b===null||p===null||!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a>b||seen.has(label)){skipped++;continue}
    seen.add(label);
    result.push({label,clicks:a,impressions:b,position:p>0?p:null});
  }
  if(!result.length)throw Error("CSV-də oxuna bilən sətir tapılmadı.");
  if(result.length>2000)throw Error("Bir faylda ən çox 2 000 nəticə yüklə.");
  return {kind:found[0],rows:result,skipped};
}
function parseBacklinks(raw){
  const rows=csvRows(raw), col=csvColumns(rows);
  const source=col(["source url","source","links","linking page","linking pages","latest links","sample links","referring page","referring page url","linking site","linking sites","domain","menbe","menbe url","url","link"]);
  const target=col(["target url","target","target page","linked page","linked pages","destination url","hedef","hedef url"]);
  const anchor=col(["anchor","anchor text","link text","link metni"]);
  if(source<0)throw Error("CSV-də Source URL, Linking page və ya Linking site başlığı olmalıdır.");
  const items=[],seen=new Set();
  for(const row of rows.slice(1)){
    const value=row[source]?.trim();
    if(!value||value.length>700)continue;
    let url;
    try{url=new URL(value.includes("://")?value:"https://"+value)}catch{continue}
    if(!["http:","https:"].includes(url.protocol)||!url.hostname.includes(".")||url.username||url.password)continue;
    const to=(row[target]||"").trim().slice(0,700), key=url.href+"\n"+to;
    if(seen.has(key))continue;
    seen.add(key);
    items.push({source:url.href,domain:url.hostname.replace(/^www\./,""),target:to,anchor:(row[anchor]||"").slice(0,230)});
  }
  if(!items.length)throw Error("CSV-də uyğun keçid tapılmadı.");
  if(items.length>1500)throw Error("Bir faylda ən çox 1 500 backlink yüklə.");
  return items;
}
async function readCsv(file){
  if(!file||!file.size)throw Error("CSV faylı seç.");
  if(file.size>1500000)throw Error("CSV faylı üçün 1,5 MB həddi var.");
  return file.text();
}
function sumSearch(rows){
  const totals=rows.reduce((t,r)=>{
    t.clicks+=r.clicks;t.impressions+=r.impressions;
    if(r.position!==null){t.weight+=r.impressions;t.positionSum+=r.position*r.impressions}
    return t;
  },{clicks:0,impressions:0,weight:0,positionSum:0});
  return {...totals,ctr:totals.impressions?100*totals.clicks/totals.impressions:0,position:totals.weight?totals.positionSum/totals.weight:null};
}
const percent=r=>r.impressions?100*r.clicks/r.impressions:0;
function csvDownload(name,rows){
  const quote=value=>'"'+String(value??"").replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
  download(name,"\uFEFF"+rows.map(r=>r.map(quote).join(",")).join("\r\n"),"text/csv;charset=utf-8");
}
function trafficTrend(rows){
  if(!rows.length)return "";
  const series=[...rows].sort((a,b)=>a.label.localeCompare(b.label));
  const peak=Math.max(1,...series.map(r=>r.clicks));
  const width=660,height=124;
  const coords=series.map((r,i)=>[series.length===1?width/2:6+i*(width-12)/(series.length-1),height-8-r.clicks*(height-18)/peak]);
  const points=coords.map(c=>c.join(",")).join(" ");
  return '<section class="panel"><div class="panel-head"><h2>Gündəlik kliklər</h2><small>Pik '+num(peak)+'</small></div><svg class="trend" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Yüklənmiş tarixlər üzrə gündəlik kliklər"><path d="M0 116H660 M0 70H660 M0 24H660" stroke="#dce4de" fill="none"/><polyline points="'+points+'" fill="none" stroke="#266247" stroke-width="2"/>'+(coords.length===1?'<circle cx="'+coords[0][0]+'" cy="'+coords[0][1]+'" r="4" fill="#266247"/>':"")+'</svg><div class="panel-head small muted"><span>'+esc(series[0].label)+'</span><span>'+esc(series.at(-1).label)+'</span></div></section>';
}
function organic(s){
  const data=s.searchData?.[searchTab]||{}, current=data.current, prior=data.prior;
  const rows=current?.rows||[];
  const total=sumSearch(rows), previous=prior?sumSearch(prior.rows):null;
  const old=new Map((prior?.rows||[]).map(r=>[normalized(r.label),r]));
  const filtered=rows.filter(r=>normalized(r.label).includes(normalized(searchFilter)));
  const potential=r=>r.position>=4&&r.position<=20&&r.impressions>0;
  const sorted=[...filtered].sort((a,b)=>searchSort==="position"?(a.position??Infinity)-(b.position??Infinity):searchSort==="opportunity"?Number(potential(b))-Number(potential(a))||b.impressions-a.impressions:searchSort==="ctr"?percent(b)-percent(a):b[searchSort]-a[searchSort]);
  const matched=searchSort==="opportunity"?sorted.filter(potential):sorted;
  const stats=rows.length?'<div class="stats">'+
  stat("Kliklər",num(total.clicks),previous?signed(total.clicks-previous.clicks)+" əvvəlki dövrə görə":"CSV sətirlərinin cəmi")+
  stat("Göstərimlər",num(total.impressions),previous?signed(total.impressions-previous.impressions)+" əvvəlki dövrə görə":"CSV sətirlərinin cəmi")+
  stat("CTR",num(total.ctr)+"%",previous?signed(total.ctr-previous.ctr)+" faiz bəndi":"klik / göstərim")+
  stat("Orta mövqe",num(total.position),previous&&total.position!==null&&previous.position!==null?signed(total.position-previous.position)+" mövqe fərqi":"göstərim çəkisi ilə")+'</div>':"";
  return title("Üzvi axtarış","Search Console hesabatından sorğuları, səhifələri və klik trendini araşdır.")+
  '<section class="panel"><details '+(!current?"open":"")+'><summary><strong>Search Console CSV yüklə</strong></summary><p class="sub small">Search Console → Performans → İxrac et → CSV. ZIP yüklənirsə, əvvəlcə aç və ayrıca Queries, Pages və ya Dates faylını seç.</p><form class="stack" id="search-import"><div class="form-grid"><label>Hesabat CSV-si<input name="file" type="file" accept=".csv,text/csv" required></label><label>Dövrün adı<input name="period" maxlength="80" placeholder="Məsələn, 1–31 oktyabr 2026" required></label></div><label>Hesabatı saxla<select name="slot"><option value="current">Cari dövr</option><option value="prior">Müqayisə dövrü</option></select></label><div><button class="btn primary">CSV-ni yüklə</button> <a class="btn" href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer">Search Console ↗</a></div></form></details></section>'+
  '<div class="switches" aria-label="Hesabat növü">'+Object.entries(searchLabels).map(([key,label])=>'<button class="btn '+(key===searchTab?"primary":"")+'" data-search-tab="'+key+'" aria-pressed="'+(key===searchTab)+'">'+label+'</button>').join("")+'</div>'+
  (rows.length?'<p class="sub period">Cari dövr · '+esc(current.period)+(prior?' | Müqayisə · '+esc(prior.period):"")+'</p>'+stats+(searchTab==="dates"?trafficTrend(rows):"")+
  '<section class="panel"><form id="search-filter" class="actions"><label>Axtar<input name="filter" value="'+esc(searchFilter)+'"></label><label>Sırala<select name="sort">'+[["clicks","Kliklər"],["impressions","Göstərimlər"],["ctr","CTR"],["position","Mövqe"],["opportunity","İmkanlar · mövqe 4–20"]].map(([key,label])=>'<option value="'+key+'" '+(key===searchSort?"selected":"")+'>'+label+'</option>').join("")+'</select></label><button class="btn">Tətbiq et</button><button type="button" class="btn" data-action="export-search">CSV endir</button></form>'+
  '<div class="table-scroll"><table><thead><tr><th>'+searchLabels[searchTab]+'</th><th>Klik</th><th>Göstərim</th><th>CTR</th><th>Mövqe</th>'+(prior?"<th>Klik fərqi</th>":"")+(searchTab==="queries"?"<th>Kontent</th>":"")+'</tr></thead><tbody>'+
  matched.slice(0,searchLimit).map(r=>{const prev=old.get(normalized(r.label));return '<tr><td>'+esc(r.label)+'</td><td>'+num(r.clicks)+'</td><td>'+num(r.impressions)+'</td><td>'+num(percent(r))+'%</td><td>'+num(r.position)+'</td>'+(prior?'<td>'+(prev?signed(r.clicks-prev.clicks):"—")+'</td>':"")+(searchTab==="queries"?'<td><button class="btn" data-plan-keyword="'+esc(r.label)+'">Planla</button></td>':"")+'</tr>'}).join("")+'</tbody></table></div>'+
  '<p class="sub small period">'+Math.min(matched.length,searchLimit)+' / '+matched.length+' sətir</p>'+(matched.length>searchLimit?'<button class="btn" data-action="search-more">Daha çox göstər</button>':"")+'</section>':empty("Bu hesabat üçün cari dövr CSV-si yüklə."));
}
function keywordGap(s){
  const own=s.searchData?.queries?.current, peers=state.sites.filter(x=>x.id!==s.id&&x.searchData?.queries?.current);
  const peer=peers.find(x=>x.id===peerId)||peers[0];
  const other=peer?.searchData.queries.current;
  const ownMap=new Map((own?.rows||[]).map(r=>[normalized(r.label),r]));
  const otherMap=new Map((other?.rows||[]).map(r=>[normalized(r.label),r]));
  const shared=[...otherMap.values()].filter(r=>ownMap.has(normalized(r.label)));
  const missing=[...otherMap.values()].filter(r=>!ownMap.has(normalized(r.label)));
  const unique=[...ownMap.values()].filter(r=>!otherMap.has(normalized(r.label)));
  const list=({shared,missing,unique})[gapMode].sort((a,b)=>b.impressions-a.impressions);
  return title("Açar söz fərqi","İki saytın yüklənmiş sorğu hesabatını müqayisə et. Müqayisə üçün eyni tarix, ölkə və cihaz filtrlərindən istifadə et.")+
  (own&&other?'<section class="panel"><div class="form-grid"><label>Müqayisə edilən sayt<select id="gap-peer">'+peers.map(x=>'<option value="'+esc(x.id)+'" '+(peer.id===x.id?"selected":"")+'>'+esc(x.name)+'</option>').join("")+'</select></label><label>Nəticə<select id="gap-mode">'+[["missing","Digər saytda olan"],["shared","Ortaq"],["unique","Yalnız bu saytda olan"]].map(([key,label])=>'<option value="'+key+'" '+(gapMode===key?"selected":"")+'>'+label+'</option>').join("")+'</select></label></div><p class="sub small period">'+esc(own.period)+' / '+esc(other.period)+' · Fərqlər yüklənmiş sorğu siyahılarına əsaslanır.</p></section>'+
  '<div class="stats">'+stat("Digər saytda",missing.length,"sorğu")+stat("Ortaq",shared.length,"sorğu")+stat("Bu saytda",unique.length,"sorğu")+'</div>'+
  '<section class="panel"><div class="table-scroll"><table><thead><tr><th>Sorğu</th><th>'+esc(s.name)+' mövqeyi</th><th>'+esc(peer.name)+' mövqeyi</th><th>Göstərimlər</th></tr></thead><tbody>'+
  list.slice(0,100).map(r=>{const k=normalized(r.label);return '<tr><td>'+esc(r.label)+'</td><td>'+num(ownMap.get(k)?.position)+'</td><td>'+num(otherMap.get(k)?.position)+'</td><td>'+num(r.impressions)+'</td></tr>'}).join("")+'</tbody></table></div><p class="sub small period">İlk '+Math.min(100,list.length)+' / '+list.length+' sorğu</p></section>':
  empty("Bu sayt və müqayisə edəcəyin sayt üçün Üzvi axtarış bölməsində cari dövr Queries CSV faylı yüklə.")+'<div class="actions"><button class="btn" data-tab="organic">Üzvi axtarışa keç</button></div>');
}
function backlinks(s){
  const items=s.backlinks?.items||[], count=new Set(items.map(x=>x.domain)).size;
  const filtered=items.filter(x=>normalized(x.source+" "+x.target+" "+x.anchor).includes(normalized(backlinkFilter)));
  const domains=new Map();
  for(const item of items)domains.set(item.domain,(domains.get(item.domain)||0)+1);
  return title("Backlink analizi","CSV-dəki xarici keçidləri, istinad edən domenləri və hədəf səhifələri araşdır.")+
  '<section class="panel"><form id="backlink-import" class="stack"><label>Backlink CSV-si<input type="file" name="file" accept=".csv,text/csv" required></label><p class="sub small">Source URL sütunu tələb olunur. Target URL və Anchor sütunlarını da əlavə edə bilərsən. Yeni yükləmə cari siyahını əvəz edir.</p><div><button class="btn primary">Backlinkləri yüklə</button></div></form></section>'+
  (items.length?'<div class="stats">'+stat("Backlink qeydləri",items.length,"CSV məlumatı")+stat("İstinad edən domen",count,"unikal domenlər")+stat("Hədəf URL",new Set(items.map(x=>x.target).filter(Boolean)).size,"CSV-də göstərilən")+'</div>'+
  '<div class="columns"><section class="panel"><h2>Keçidlər</h2><form id="backlink-filter" class="actions"><label>Domen və ya URL<input name="filter" value="'+esc(backlinkFilter)+'"></label><button class="btn">Axtar</button><button type="button" class="btn" data-action="export-backlinks">CSV endir</button></form><div class="table-scroll"><table><thead><tr><th>Mənbə</th><th>Hədəf</th><th>Link mətni</th></tr></thead><tbody>'+
  filtered.slice(0,100).map(x=>'<tr><td><a href="'+esc(x.source)+'" target="_blank" rel="noopener noreferrer">'+esc(x.source)+'</a></td><td>'+esc(x.target||"—")+'</td><td>'+esc(x.anchor||"—")+'</td></tr>').join("")+'</tbody></table></div><p class="sub small period">İlk '+Math.min(100,filtered.length)+' / '+filtered.length+' keçid</p></section>'+
  '<section class="panel"><h2>Əsas istinad domenləri</h2>'+[...domains].sort((a,b)=>b[1]-a[1]).slice(0,12).map(([host,n])=>'<div class="row"><div>'+esc(host)+'</div><span class="pill">'+n+'</span></div>').join("")+'</section></div>':empty("Hesabatı görmək üçün backlink CSV faylı yüklə."));
}

function content(s){
  const tracking='<section class="panel"><div class="panel-head"><div><h2>Açar söz mövqeləri</h2><p class="sub small">Mövqeni, ölkəni və cihazı tarix üzrə əl ilə qeyd et.</p></div></div><form id="rank-form" class="stack"><div class="form-grid"><label>Açar söz<input name="keyword" maxlength="200" required></label><label>Ölkə<input name="country" maxlength="60" placeholder="Azərbaycan" required></label><label>Cihaz<select name="device"><option>Mobil</option><option>Masaüstü</option></select></label><label>Mövqe<input name="position" type="number" min="1" max="1000" step="1" required></label></div><div><button class="btn">Mövqeni saxla</button></div></form>'+
  ((s.ranks||[]).length?'<div class="table-scroll"><table><thead><tr><th>Açar söz</th><th>Ölkə / cihaz</th><th>Mövqe</th><th>Tarix</th></tr></thead><tbody>'+s.ranks.slice(0,60).map(r=>'<tr><td>'+esc(r.keyword)+'</td><td>'+esc(r.country)+' · '+esc(r.device)+'</td><td>'+r.position+'</td><td>'+date(r.date)+'</td></tr>').join("")+'</tbody></table></div>':"")+'</section>';
  return title("Kontent və açar sözlər","Açar söz, hədəf səhifə və kontent planını sayt üzrə saxla.")+tracking+
  '<section class="panel"><form id="content-form" class="stack"><div class="form-grid"><label>Açar söz və ya mövzu<input name="keyword" required maxlength="200" value="'+esc(plannedKeyword.slice(0,200))+'"></label><label>Dil<select name="language"><option>Azərbaycan dili</option><option>Türkcə</option><option>İngiliscə</option></select></label></div><label>Hədəf səhifə<input name="target" placeholder="/blog/…"></label><label>Kontent qeydi<textarea name="brief" maxlength="3000"></textarea></label><div><button class="btn primary">Plana əlavə et</button></div></form></section>'+
  '<section class="panel"><div class="panel-head"><h2>Kontent planı</h2></div>'+(s.notes.length?s.notes.map(n=>'<div class="row"><div><h3>'+esc(n.keyword)+'</h3><p class="muted small">'+esc(n.language)+(n.target?' · '+esc(n.target):'')+'</p><p>'+esc(n.brief)+'</p></div></div>').join(""):empty("Kontent mövzuları burada görünəcək."))+'</section>';
}


function blogChecks(p,s){
 const words=(p.body||"").trim().split(/\s+/).filter(Boolean).length;
 const checks=[
 ["SEO başlığı 30–65 simvol",(p.seoTitle||p.title||"").length>=30&&(p.seoTitle||p.title||"").length<=65],
 ["Meta description 110–160 simvol",(p.description||"").length>=110&&(p.description||"").length<=160],
 ["Əsas açar söz başlıqda",!!p.keyword&&(p.title||"").toLocaleLowerCase("az").includes(p.keyword.toLocaleLowerCase("az"))],
 ["Məqalə ən azı 300 söz",words>=300],
 ["H2 alt başlığı",/^## /m.test(p.body||"")],
 ["Sosial paylaşım şəkli",!!p.image],
 ["Daxili link",/\]\(\/[^)]+\)/.test(p.body||"")||/\]\(https:\/\/[^)]+\)/.test(p.body||"")]
 ];
 return {checks,score:Math.round(checks.filter(x=>x[1]).length/checks.length*100),words};
}
function blogSitemap(s){
 const base=new URL(s.url).origin;
 const urls=[...new Set((s.blogs||[]).filter(p=>p.status==="ready").map(p=>base+"/"+p.slug+".html"))];
 return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+urls.map(url=>'  <url><loc>'+esc(url)+'</loc></url>').join("\n")+'\n</urlset>\n';
}

function blog(s){
 const posts=s.blogs||[];
 const p=posts.find(x=>x.id===editingBlog)||{};
 const val=(k)=>esc(p[k]||"");
 const quality=p.id?blogChecks(p,s):null;
 const suggestions=posts.filter(x=>x.id!==p.id&&x.status==="ready").slice(0,5);
 return title("Bloq idarəetməsi","Məqalə yaz, SEO məlumatlarını hazırla, qaralama saxla və HTML faylı ixrac et.")+
 '<section class="panel"><h2>AI məqalə generatoru</h2><p class="sub small">API açarı serverdə aktivdirsə, qaralama yaradır; avtomatik yayımlamır.</p><form id="ai-form" class="stack"><div class="form-grid"><label>Mövzu<input name="topic" maxlength="200" required placeholder="Onlayn tədris platforması nədir?"></label><label>Əsas açar söz<input name="keyword" maxlength="160" placeholder="onlayn tədris platforması"></label><label>Dil<select name="language"><option>Azərbaycan dili</option><option>Türkcə</option><option>İngiliscə</option></select></label></div><button class="btn primary">AI qaralama yarat</button></form></section>'+
 '<section class="panel"><div class="panel-head"><h2>'+(p.id?"Məqaləni redaktə et":"Yeni məqalə")+'</h2></div>'+
 '<form id="blog-form" class="stack"><div class="form-grid">'+
 '<label>Məqalə başlığı<input name="title" maxlength="180" required value="'+val("title")+'"></label>'+
 '<label>URL slug<input name="slug" maxlength="140" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="onlayn-tedris-platformasi" required value="'+val("slug")+'"></label>'+
 '<label>Əsas açar söz<input name="keyword" maxlength="160" value="'+val("keyword")+'"></label>'+
 '<label>Status<select name="status"><option value="draft" '+(p.status!=="ready"?"selected":"")+'>Qaralama</option><option value="ready" '+(p.status==="ready"?"selected":"")+'>Yayıma hazır</option></select></label>'+
 '<label>SEO başlığı<input name="seoTitle" maxlength="80" value="'+val("seoTitle")+'"></label>'+
 '<label>Şəkil URL-i (HTTPS)<input name="image" maxlength="600" placeholder="https://..." value="'+val("image")+'"></label></div>'+
 '<label>Meta description<textarea name="description" maxlength="200" rows="2">'+val("description")+'</textarea></label>'+
 '<label>Məqalə mətni (Markdown: #, ##, abzaslar)<textarea name="body" maxlength="40000" rows="16" required>'+val("body")+'</textarea></label>'+
 '<div class="row"><button class="btn primary">Məqaləni saxla</button><button type="button" class="btn" data-action="blog-new">Yeni qaralama</button></div></form></section>'+
 '<section class="panel"><div class="panel-head"><h2>SEO yoxlaması və daxili linklər</h2></div>'+(quality?'<p><strong>SEO yoxlama nəticəsi: '+quality.score+'/100</strong> · '+quality.words+' söz</p>'+quality.checks.map(x=>'<p class="small">'+(x[1]?'✓ ':'○ ')+esc(x[0])+'</p>').join(""):'<p class="sub">Məqaləni saxladıqdan sonra SEO yoxlamaları görünəcək.</p>')+'<h3>Daxili link təklifləri</h3>'+(suggestions.length?suggestions.map(x=>'<p class="small"><code>['+esc(x.title)+'](/'+esc(x.slug)+'.html)</code></p>').join(""):'<p class="sub small">Yayıma hazır digər məqalələr olduqda linklər burada görünəcək.</p>')+'</section>'+
 '<section class="panel"><div class="panel-head"><h2>Məqalələr ('+posts.length+')</h2><button class="btn" data-action="blog-sitemap">Bloq sitemap XML</button></div>'+
 (posts.length?posts.map(x=>'<div class="row"><div><h3>'+esc(x.title)+'</h3><p class="muted small">/'+esc(x.slug)+'.html · '+(x.status==="ready"?"Yayıma hazır":"Qaralama")+' · '+date(x.updated)+'</p></div><div class="row"><button class="btn" data-blog-edit="'+esc(x.id)+'">Redaktə et</button><button class="btn" data-blog-publish="'+esc(x.id)+'">GitHub-a yayımla</button><button class="btn" data-blog-export="'+esc(x.id)+'">HTML ixrac et</button><button class="btn" data-blog-delete="'+esc(x.id)+'">Sil</button></div></div>').join(""):empty("Hələ məqalə yoxdur."))+'</section>'+
 '<p class="sub small">HTML ixracı canlı saytda yayımlama deyil. Faylı saytın repozitoriyasına əlavə edib deploy etmək lazımdır.</p>';
}
function blogHtml(p,s){
 const e=esc;
 const inline=t=>e(t).replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/\*(.+?)\*/g,"<em>$1</em>");
 const body=p.body.split(/\r?\n/).map(line=>line.startsWith("### ")?"<h3>"+inline(line.slice(4))+"</h3>":line.startsWith("## ")?"<h2>"+inline(line.slice(3))+"</h2>":line.startsWith("# ")?"<h2>"+inline(line.slice(2))+"</h2>":line.trim()?"<p>"+inline(line)+"</p>":"").join("\n");
 const url=new URL("/"+p.slug+".html",s.url).href;
 const schema=JSON.stringify({"@context":"https://schema.org","@type":"BlogPosting",headline:p.title,description:p.description||"",mainEntityOfPage:url,image:p.image||undefined,dateModified:p.updated}).replace(/</g,"\u003c");
 return '<!doctype html>\n<html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+e(p.seoTitle||p.title)+'</title><meta name="description" content="'+e(p.description)+'"><link rel="canonical" href="'+e(url)+'"><meta property="og:title" content="'+e(p.seoTitle||p.title)+'"><meta property="og:description" content="'+e(p.description)+'">'+(p.image?'<meta property="og:image" content="'+e(p.image)+'">':'')+'<script type="application/ld+json">'+schema+'</scr'+'ipt></head><body><main><article><h1>'+e(p.title)+'</h1>'+body+'</article></main></body></html>';
}

function reports(s){
  return title("Hesabatlar","Sayt üzrə son audit, SEO qaralamaları, GEO qeydləri və kontent planını ixrac et.")+
  '<section class="panel"><div class="panel-head"><h2>'+esc(s.name)+'</h2><span class="pill">JSON</span></div><p class="sub">'+(s.audit?"Son audit "+date(s.audit.date):"Audit gözlənilir")+' · '+s.pages.length+' qaralama · '+s.queries.length+' GEO sorğusu</p><div class="actions"><button class="btn primary" data-action="export-report">Hesabatı endir</button>'+(s.audit?'<button class="btn" data-action="export-audit">Audit CSV</button>':"")+'</div></section>';
}
function settings(s){
  const integrations=[["Google Search Console","Klik və göstərimlər","https://search.google.com/search-console"],["Google Analytics 4","Üzvi trafik və qeydiyyatlar","https://analytics.google.com"],["Bing Webmaster Tools","Microsoft axtarış və AI istinadları","https://www.bing.com/webmasters"],["GitHub",connected.includes(s.id)?"Qaralamanı saxla, sonra Səhifələr bölməsindən yayımla.":"Serverdə bu domen üçün SEO_GITHUB_TOKEN və SEO_GITHUB_TARGETS qur.",s.repo]];
  return title("Bağlantılar","Canlı məlumat və yayımlama üçün istifadə ediləcək xidmətlər.")+
 '<section class="panel"><h2>Search Console — API</h2><p class="sub small">Google service account e-mailini Search Console mülkiyyətinə əlavə et. Son 28 günlük açar söz göstəricilərini çək.</p><form id="gsc-form" class="stack"><label>Search Console property (URL prefix və ya sc-domain:...)<input name="property" value="'+esc(s.gscProperty||new URL(s.url).origin+"/")+'" required maxlength="250"></label><button class="btn primary">GSC məlumatlarını gətir</button></form>'+(s.gscSnapshot?'<p class="small">Son sinxronizasiya: '+date(s.gscSnapshot.updated)+' · '+s.gscSnapshot.rows.length+' açar söz</p><div class="table-scroll"><table><thead><tr><th>Açar söz</th><th>Klik</th><th>Göstərim</th><th>Mövqe</th></tr></thead><tbody>'+s.gscSnapshot.rows.slice(0,30).map(x=>'<tr><td>'+esc(x.keyword)+'</td><td>'+x.clicks+'</td><td>'+x.impressions+'</td><td>'+Number(x.position).toFixed(1)+'</td></tr>').join("")+'</tbody></table></div>':"")+'</section>'+
  '<section class="panel"><div class="panel-head"><h2>Canlı SEO</h2><span class="pill '+(liveConnected.includes(s.id)?"":"warn")+'">'+(liveConnected.includes(s.id)?"Paneldə aktivdir":"Qoşulmayıb")+'</span></div><p class="sub">Başlıq və meta açıqlamasını tətbiq etmək üçün serverdə domeni SEO_LIVE_TARGETS ilə qoş və sayt inteqrasiyasını işə sal.</p></section>'+'<div class="module">'+integrations.map(([name,detail,link])=>'<section class="panel"><div class="panel-head"><h2>'+name+'</h2><span class="pill '+(name==="GitHub"&&connected.includes(s.id)?"":"warn")+'">'+(name==="GitHub"&&connected.includes(s.id)?"Qurulub":"Qoşulmayıb")+'</span></div><p class="muted">'+detail+'</p>'+(link?'<a class="btn" href="'+esc(link)+'" target="_blank" rel="noopener noreferrer">Xidməti aç ↗</a>':"")+'</section>').join("")+'</div>';
}
function download(name,content,type){
  const url=URL.createObjectURL(new Blob([content],{type})), a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function select(id){pageFilter="";issueFilter="";searchFilter="";backlinkFilter="";searchLimit=30;peerId="";plannedKeyword="";active=id;localStorage.setItem("seo-site",id);tab="home";chosen="";message("");render()}
function navigate(name){if(active==="all"&&name!=="home")active=state.sites[0].id;tab=name;message("");render()}
$("sites").onchange=e=>select(e.target.value);
$("add").onclick=()=>{$("site-error").textContent="";$("dialog").showModal()};
$("cancel").onclick=()=>$("dialog").close();
$("site-form").onsubmit=async e=>{
  e.preventDefault();if(!state)return;
  const form=e.currentTarget, f=new FormData(form), submit=e.submitter;submit.disabled=true;
  try{
    const name=f.get("name").trim(), raw=f.get("url").trim();
    const u=pageUrl(raw.includes("://")?raw:"https://"+raw);
    if(!name||!u.hostname.includes(".")||u.port)throw Error("Saytın adını və açıq HTTPS domenini daxil et.");
    if(state.sites.some(s=>new URL(s.url).hostname.replace(/^www\./,"")===u.hostname.replace(/^www\./,"")))throw Error("Bu domen artıq əlavə edilib.");
    const next=structuredClone(state), id=crypto.randomUUID();
    next.sites.push({id,name,url:u.origin,pages:[],queries:[],notes:[]});
    await setState(next);select(id);form.reset();$("dialog").close();
  }catch(err){$("site-error").textContent=err.message}
  finally{submit.disabled=false}
};
async function previewPublish(s,pageId){
  if(!connected.includes(s.id))throw Error("Bu domen üçün serverdə GitHub yayımlama bağlantısını qur.");
  const result=await api("publish","POST",{siteId:s.id,pageId});
  const preview=$("publish-preview"), confirm=$("publish-confirm");
  publishSelection={siteId:s.id,pageId,check:result.check};
  preview.innerHTML='<h2>GitHub önizləməsi</h2><p class="sub">'+esc(result.repo)+' · '+esc(result.branch)+' · '+esc(result.path)+'</p>'+
    (result.fields.length?result.fields.map(field=>'<details><summary>'+esc(field.field)+'</summary><p class="small muted">Cari</p><pre>'+esc(field.before||"—")+'</pre><p class="small muted">Yeni</p><pre>'+esc(field.after)+'</pre></details>').join(""):empty("GitHub faylında bu dəyərlər artıq tətbiq olunub."));
  confirm.hidden=!result.fields.length;
  if(!$("publish-dialog").open)$("publish-dialog").showModal();
}
$("publish-close").onclick=()=>$("publish-dialog").close();
$("publish-confirm").onclick=async()=>{
  const button=$("publish-confirm");
  button.disabled=true;$("publish-close").disabled=true;
  try{
    const result=await api("publish","POST",publishSelection);
    button.hidden=true;
    $("publish-preview").innerHTML=result.unchanged?empty("GitHub-da dəyişiklik tələb olunmur."):'<h2>GitHub commit yaradıldı</h2><p class="sub">Canlı sayt hosting xidməti bu branch-i deploy edəndə yenilənəcək.</p>'+(result.commit?'<a href="'+esc(result.commit)+'" target="_blank" rel="noopener noreferrer">Commit-i aç ↗</a>':"");
  }catch(error){
    $("publish-preview").innerHTML=empty(esc(error.message));
    button.hidden=true;
  }finally{button.disabled=false;$("publish-close").disabled=false}
};
document.addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b||!state)return;
  const d=b.dataset;
  if(d.tab)navigate(d.tab);
  if(d.action==="blog-sitemap"){download(site().id+"-blog-sitemap.xml",blogSitemap(site()),"application/xml;charset=utf-8")}
  if(d.action==="blog-new"){editingBlog="";render()}
  if(d.blogEdit){editingBlog=d.blogEdit;render()}
  if(d.blogPublish){const p=site()?.blogs?.find(x=>x.id===d.blogPublish);if(p){if(!connected.includes(site().id)){message("Bu sayt üçün SEO_GITHUB_TOKEN və SEO_GITHUB_TARGETS bağlantısı qurulmayıb.");return}if(p.status!=="ready"){message("Əvvəlcə statusu Yayıma hazır et.");return}b.disabled=true;api("blog-publish","POST",{siteId:site().id,postId:p.id}).then(preview=>{if(!confirm("GitHub-a yayımlansın?\nRepo: "+preview.repo+"\nFayl: "+preview.path+"\n"+(preview.exists?"Mövcud fayl yenilənəcək.":"Yeni fayl yaradılacaq.")))return;return api("blog-publish","POST",{siteId:site().id,postId:p.id,check:preview.check}).then(result=>{message(result.unchanged?"Fayl artıq aktualdır.":"GitHub commit yaradıldı. Hosting deploy-u tamamlandıqdan sonra sayt yenilənəcək.");if(result.commit)window.open(result.commit,"_blank","noopener")})}).catch(err=>message(err.message)).finally(()=>b.disabled=false)}}
  if(d.blogExport){const p=site()?.blogs?.find(x=>x.id===d.blogExport);if(p)download(p.slug+".html",blogHtml(p,site()),"text/html;charset=utf-8")}
  if(d.blogDelete){const p=site()?.blogs?.find(x=>x.id===d.blogDelete);if(p&&confirm("Bu məqaləni silmək istəyirsən?")){changeSite(site().id,x=>{x.blogs=x.blogs.filter(v=>v.id!==p.id)}).then(()=>{editingBlog="";render();message("Məqalə silindi.")}).catch(err=>message(err.message))}}
  if(d.site)select(d.site);
  if(d.page){chosen=d.page;render()}
  const s=site();if(!s)return;
  if(d.crawlUrl){chosen="crawl:"+d.crawlUrl;navigate("pages");$("page-form")?.scrollIntoView({block:"start"})}
  if(d.action==="crawl-start"||d.action==="crawl-resume"){message("");runCrawl(s,d.action==="crawl-resume").catch(err=>message(err.message))}
  if(d.action==="crawl-export"){
    const all=issuesFor(s.crawl);
    const csv=value=>'"'+String(value??"").replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
    const rows=[["URL","Son URL","HTTP","SEO başlığı","Meta açıqlaması","Canonical","Meta robots","Problemlər"],...s.crawl.pages.map(p=>[p.requested,p.url,p.status,p.title,p.description,p.canonical,p.directives,(all.get(p.requested)||[]).map(x=>x[1]).join(" | ")])];
    download(s.id+"-sayt-audit.csv","\uFEFF"+rows.map(row=>row.map(csv).join(",")).join("\r\n"),"text/csv;charset=utf-8");
  }
  if(d.planKeyword){plannedKeyword=d.planKeyword;navigate("content");$("content-form")?.scrollIntoView({block:"center"})}
  if(d.searchTab){searchTab=d.searchTab;searchFilter="";searchLimit=30;searchSort="clicks";render()}
  if(d.action==="search-more"){searchLimit+=50;render()}
  if(d.action==="export-search"){
    const rows=s.searchData?.[searchTab]?.current?.rows||[];
    csvDownload(s.id+"-"+searchTab+".csv",[[searchLabels[searchTab],"Klik","Göstərim","CTR","Mövqe"],...rows.map(r=>[r.label,r.clicks,r.impressions,percent(r),r.position])]);
  }
  if(d.action==="export-backlinks")csvDownload(s.id+"-backlinks.csv",[["Source URL","Target URL","Anchor"],...(s.backlinks?.items||[]).map(x=>[x.source,x.target,x.anchor])]);
  if(d.action==="publish-preview"){message("");b.disabled=true;previewPublish(s,d.draft).catch(err=>message(err.message)).finally(()=>b.disabled=false)}
  if(d.action==="new-page"){chosen="";render()}
  if(d.action==="from-audit"){chosen="audit";navigate("pages")}
  if(d.action==="export-report")download(s.id+"-seo.json",JSON.stringify(s,null,2),"application/json");
  if(d.action==="export-audit"){
    const csv=value=>'"'+String(value).replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
    const rows=[["Yoxlama","Nəticə","Təfərrüat"],...s.audit.checks.map(([label,ok,note])=>[label,ok?"Keçdi":"Yoxla",note])];
    download(s.id+"-audit.csv","\uFEFF"+rows.map(row=>row.map(csv).join(",")).join("\r\n"),"text/csv;charset=utf-8");
  }
  if(d.action==="export-page"){
    const p=s.pages.find(p=>p.id===chosen);
    const value=[p.title&&"<title>"+esc(p.title)+"</title>",p.description&&'<meta name="description" content="'+esc(p.description)+'">',p.canonical&&'<link rel="canonical" href="'+esc(p.canonical)+'">',p.ogTitle&&'<meta property="og:title" content="'+esc(p.ogTitle)+'">',p.ogImage&&'<meta property="og:image" content="'+esc(p.ogImage)+'">',p.directives&&'<meta name="robots" content="'+esc(p.directives)+'">',p.ogDescription&&'<meta property="og:description" content="'+esc(p.ogDescription)+'">',...(p.hreflangs||"").split("\n").filter(Boolean).map(line=>{const [lang,url]=line.split(" ");return '<link rel="alternate" hreflang="'+esc(lang)+'" href="'+esc(url)+'">'}),p.schema&&'<script type="application/ld+json">'+JSON.stringify(JSON.parse(p.schema),null,2).replaceAll("<","\\u003c")+'</scr'+'ipt>'].filter(Boolean).join("\n");
    download(s.id+"-seo-head.html",value,"text/plain");
  }
});
document.addEventListener("submit",async e=>{
  const form=e.target,s=site();
  if(form.id==="site-form"||!s)return;
  e.preventDefault();message("");
  const button=e.submitter, f=Object.fromEntries(new FormData(form));if(button)button.disabled=true;
  try{
    if(form.id==="gsc-form"){
      const property=f.property.trim();
      if(!property.startsWith("sc-domain:")&&!property.startsWith("https://"))throw Error("GSC property URL və ya sc-domain: formatında olmalıdır.");
      await changeSite(s.id,item=>item.gscProperty=property);
      const result=await api("gsc","POST",{siteId:s.id});
      await changeSite(s.id,item=>item.gscSnapshot={...result,updated:new Date().toISOString()});
      render();message("Search Console məlumatları yeniləndi.");return;
    }
    if(form.id==="ai-form"){
      const article=await api("ai-article","POST",{topic:f.topic,keyword:f.keyword,language:f.language});
      const id=crypto.randomUUID();
      await changeSite(s.id,item=>{item.blogs??=[];item.blogs.unshift({...article,id,updated:new Date().toISOString()})});
      editingBlog=id;render();message("AI qaralama yaradıldı. Məlumatları yoxlayıb redaktə et.");return;
    }
    if(form.id==="blog-form"){
      const title=f.title.trim(),slug=f.slug.trim().toLowerCase(),body=f.body.trim();
      if(!title||!body||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))throw Error("Başlıq, mətn və düzgün slug daxil et.");
      if(f.image){const u=pageUrl(f.image);f.image=u.href}
      if((s.blogs||[]).some(p=>p.slug===slug&&p.id!==editingBlog))throw Error("Bu URL slug artıq mövcuddur.");
      const id=editingBlog||crypto.randomUUID(),record={...f,title,slug,body,id,updated:new Date().toISOString()};
      await changeSite(s.id,item=>{item.blogs??=[];item.blogs=[record,...item.blogs.filter(p=>p.id!==id)]});
      editingBlog=id;render();message("Məqalə saxlanıldı.");return;
    }
    if(form.id==="search-filter"){searchFilter=f.filter;searchSort=f.sort;searchLimit=30;render();return}
    if(form.id==="backlink-filter"){backlinkFilter=f.filter;render();return}
    if(form.id==="search-import"){
      const period=f.period.trim();
      if(!period)throw Error("Dövrün adını daxil et.");
      const parsed=parseSearch(await readCsv(f.file));
      await changeSite(s.id,item=>{
        item.searchData??={};item.searchData[parsed.kind]??={};
        item.searchData[parsed.kind][f.slot]={period,rows:parsed.rows,date:new Date().toISOString()};
      });
      if(active===s.id){searchTab=parsed.kind;searchLimit=30;searchFilter="";searchSort="clicks"}
      render();message(parsed.rows.length+" sətir saxlanıldı."+(parsed.skipped?" "+parsed.skipped+" sətir ötürüldü.":""));return;
    }
    if(form.id==="backlink-import"){
      const items=parseBacklinks(await readCsv(f.file));
      await changeSite(s.id,item=>{item.backlinks={items,date:new Date().toISOString()}});
      backlinkFilter="";render();message(items.length+" backlink qeydi saxlanıldı.");return;
    }
    if(form.id==="page-filter-form"){pageFilter=f.filter.trim();render();return}
    if(form.id==="audit-form"){
      const u=pageUrl(f.url);
      if(u.hostname.replace(/^www\./,"")!==new URL(s.url).hostname.replace(/^www\./,""))throw Error("Seçilən saytın URL ünvanını daxil et.");
      if(button)button.textContent="Yoxlanılır…";
      const result=await api("audit","POST",{url:u.href});
      await changeSite(s.id,item=>item.audit=result);
    }else if(form.id==="page-form"){
      f.url=pageUrl(f.url,s.url).href;
      if(f.canonical)f.canonical=pageUrl(f.canonical,s.url).href;
      if(f.ogImage)f.ogImage=pageUrl(f.ogImage,s.url).href;
      f.hreflangs=f.hreflangs.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{
        const [lang,url,...extra]=line.split(/\s+/);
        if(!/^(?:x-default|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/i.test(lang)||!url||extra.length)throw Error("Hər sətirdə dil kodunu və URL-i yaz.");
        return lang+" "+pageUrl(url,s.url).href;
      }).join("\n");
      if(f.schema){const schema=JSON.parse(f.schema);if(!schema||typeof schema!=="object")throw Error("JSON-LD obyekti və ya siyahısı daxil et.")}
      const existing=s.pages.find(p=>p.id===chosen||p.url===f.url);
      const live=liveConnected.includes(s.id)&&new URL(f.url).origin===new URL(s.url).origin&&!new URL(f.url).search;
      if(liveConnected.includes(s.id)&&!live)throw Error("Canlı tətbiq üçün seçilmiş domenin parametrsiz URL-ini daxil et.");
      const record={...f,live,id:existing?.id||crypto.randomUUID(),updated:new Date().toISOString()};
      await changeSite(s.id,item=>{item.pages=existing?item.pages.map(p=>p.id===existing.id?record:p):[record,...item.pages]});
      if(active===s.id)chosen=record.id;
      if(live){render();message("Başlıq və meta açıqlaması saxlanıldı. Sayt inteqrasiya üzərindən növbəti sorğuda onları oxuyacaq.");return}
    }else if(form.id==="query-form"){
      f.question=f.question.trim();if(!f.question)throw Error("Sorğunu daxil et.");
      await changeSite(s.id,item=>item.queries.push({...f,id:crypto.randomUUID()}));
    }else if(form.matches(".geo-result")){
      if(f.citation)f.citation=pageUrl(f.citation).href;
      await changeSite(s.id,item=>{const q=item.queries.find(q=>q.id===form.dataset.query);const result={...f,date:new Date().toISOString()};q.history=[result,...(q.history||[])].slice(0,25);Object.assign(q,result)});
    }else if(form.id==="rank-form"){
      const position=Number(f.position), keyword=f.keyword.trim(), country=f.country.trim();
      if(!keyword||!country||!Number.isInteger(position)||position<1||position>1000)throw Error("Açar söz, ölkə və düzgün mövqe daxil et.");
      await changeSite(s.id,item=>{item.ranks=[{...f,position,keyword,country,date:new Date().toISOString()},...(item.ranks||[])]});
    }else if(form.id==="content-form"){
      f.keyword=f.keyword.trim();if(!f.keyword)throw Error("Açar söz və ya mövzu daxil et.");
      await changeSite(s.id,item=>item.notes.unshift({...f,id:crypto.randomUUID()}));
      plannedKeyword="";
    }else return;
    render();message(form.id==="audit-form"?"Audit saxlanıldı.":"Dəyişiklik saxlanıldı.");
  }catch(err){message(err.message);if(form.id==="audit-form"&&button)button.textContent="Auditi başlat"}
  finally{if(button)button.disabled=false}
});
document.addEventListener("change",e=>{
  const id=e.target.id;
  if(id==="issue-filter")issueFilter=e.target.value;
  else if(id==="gap-peer")peerId=e.target.value;
  else if(id==="gap-mode")gapMode=e.target.value;
  else return;
  render();$(id)?.focus();
});
api("state").then(data=>{state=data.state;revision=data.revision;connected=data.connected||[];liveConnected=data.liveConnected||[];if(active!=="all"&&!site())active=state.sites[0].id;render()})
.catch(err=>{$("view").textContent="Panel açıla bilmədi.";message(err.message)});
</script></body></html>`;

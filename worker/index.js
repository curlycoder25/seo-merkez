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
    const response = await fetch(url, {redirect:"manual", signal:AbortSignal.timeout(6500)});
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

export default {
  async fetch(request, env) {
    const {pathname} = new URL(request.url);
    const json = (value,status=200)=>Response.json(value,{status,headers:{"cache-control":"no-store"}});
    if (pathname === "/") return new Response(HTML,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
    if (!pathname.startsWith("/api/")) return new Response("Tapılmadı",{status:404});
    if (request.method !== "GET" && request.headers.get("Origin") !== new URL(request.url).origin) return json({error:"Sorğu qəbul edilmədi."},403);
    try {
      if (pathname==="/api/state" && request.method==="GET") {
        const row = await env.DB.prepare("SELECT data, revision FROM workspace WHERE id = 1").first();
        return json(row?{state:JSON.parse(row.data),revision:row.revision}:{state:initial,revision:0});
      }
      if (pathname==="/api/state" && request.method==="PUT") {
        const raw = await request.text();
        if (raw.length>300000) return json({error:"Məlumat ölçüsü həddi aşıldı."},413);
        const {state,revision} = JSON.parse(raw);
        if (!Array.isArray(state?.sites) || !Number.isSafeInteger(revision) || revision<0) return json({error:"Məlumat formatı yanlışdır."},400);
        await env.DB.prepare("INSERT OR IGNORE INTO workspace(id,data,revision) VALUES(1,?,0)").bind(JSON.stringify(initial)).run();
        const result = await env.DB.prepare("UPDATE workspace SET data=?, revision=revision+1 WHERE id=1 AND revision=?").bind(JSON.stringify(state),revision).run();
        return result.meta.changes ? json({revision:revision+1}) : json({error:"Panel başqa pəncərədə yenilənib. Səhifəni yenilə."},409);
      }
      if (pathname==="/api/audit" && request.method==="POST") {
        const {url} = await request.json();
        return json(await audit(url));
      }
      return json({error:"Tapılmadı."},404);
    } catch (error) {
      return json({error:pathname==="/api/audit" ? ("Audit tamamlanmadı. "+error.message) : "Məlumat bazası sorğusu tamamlanmadı."},502);
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
header{height:66px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 31px;background:#ffffff}.toolbar{display:flex;align-items:center;gap:9px}.crumb{color:var(--muted);font-size:13px}main{padding:30px 32px 50px;max-width:1440px;margin:auto}.hero{border:1px solid #cfdfd4;border-radius:15px;background:linear-gradient(104deg,#e5f2e8,#eff7f0 60%,#dfede4);padding:28px;display:flex;justify-content:space-between;align-items:center;gap:18px;margin-bottom:20px;position:relative;overflow:hidden}.hero>*{z-index:1}.hero:after{content:"";position:absolute;inset:0 0 0 67%;opacity:.24;background:radial-gradient(#749782 1px,transparent 1px) 0 0 / 13px 13px;mask-image:linear-gradient(90deg,transparent,#000)}.hero .eyebrow{color:var(--lime)}h1,h2,h3,p{margin:0}h1{font-size:clamp(29px,4vw,46px);letter-spacing:-.055em;line-height:1.06;margin-bottom:10px}h2{font-size:18px;letter-spacing:-.035em}h3{font-size:14px}.sub,.muted{color:var(--muted)}.sub{line-height:1.65}.page-title{margin:0 0 20px}.page-title h1{font-size:36px}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:19px}.stat,.panel{background:var(--surface);border:1px solid var(--border);border-radius:12px}.stat{padding:15px}.stat strong{font:500 26px var(--mono);display:block;margin:8px 0 3px}.stat em{font:normal 11px var(--mono);color:var(--muted)}.columns{display:grid;grid-template-columns:1.55fr 1fr;gap:14px;margin-bottom:17px}.panel{padding:17px;margin-bottom:13px}.columns>.panel{margin:0}.panel-head,.row,.actions{display:flex;align-items:center;justify-content:space-between;gap:12px}.panel-head{margin-bottom:13px}.row{padding:12px 0;border-top:1px solid var(--border)}.row>div{min-width:0;overflow-wrap:anywhere}.row p{margin-top:4px}.empty{padding:14px;border:1px dashed #bccdc1;border-radius:8px;color:var(--muted);line-height:1.5}.btn,select{border:1px solid #cbd9d0;border-radius:8px;background:#f4f8f5;color:var(--text);padding:9px 12px;text-decoration:none;font-size:13px;font-weight:800;display:inline-block}.btn.primary{background:var(--lime);color:#ffffff;border-color:var(--lime)}.btn:disabled{opacity:.55;cursor:wait}.pill{font:500 11px var(--mono);white-space:nowrap;color:var(--lime);background:#e6f2e9;padding:5px 8px;border-radius:6px}.pill.warn{color:var(--warn);background:#fff0da}.stack{display:grid;gap:11px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}label{display:grid;gap:6px;font-size:13px;font-weight:700}input,textarea{width:100%;padding:10px 11px;background:#f8fbf9;border:1px solid #becec3;border-radius:7px;color:var(--text)}textarea{min-height:92px;resize:vertical}.actions{justify-content:flex-start;flex-wrap:wrap;margin-top:12px}.message{min-height:20px;color:var(--warn);margin-bottom:9px}.message:empty{display:none}dialog{background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:13px;width:min(490px,93vw);padding:23px}dialog::backdrop{background:#172e2466}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:10px;background:#f8fbf9;border-radius:7px;color:#334e3f;max-height:280px;overflow:auto}.toolbar select{max-width:185px}small{color:var(--muted)}.small{font-size:12px}.quiet{color:var(--muted)}.module{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.module .panel{margin:0}.module p{margin:8px 0;line-height:1.5}details{border-top:1px solid var(--border);padding:12px 0}summary{cursor:pointer}
@media(max-width:960px){.shell{grid-template-columns:185px minmax(0,1fr)}main{padding:23px 19px}header{padding:0 19px}.columns{grid-template-columns:1fr}}@media(max-width:700px){.shell{display:block}aside{padding:12px;gap:9px;border-right:0;border-bottom:1px solid var(--border)}.nav{display:flex;overflow:auto}.nav button{white-space:nowrap}.nav-title,.sidebar-foot{display:none}header{padding:0 12px;height:55px}.crumb{display:none}.toolbar{width:100%;justify-content:space-between}main{padding:17px 12px}.hero{padding:19px;align-items:flex-start;flex-direction:column}.stats,.module{grid-template-columns:repeat(2,minmax(0,1fr))}.form-grid{grid-template-columns:1fr}}
</style></head><body>
<div class="shell"><aside><div class="brand"><span class="mark" aria-hidden="true">↗</span>SEO Mərkəzi</div><div><p class="nav-title">İdarəetmə</p><nav class="nav" aria-label="Bölmələr" id="nav"></nav></div><div class="sidebar-foot"><span class="dot"></span>Şəxsi iş sahəsi</div></aside>
<div><header><span class="crumb">İş sahəsi / <b id="crumb">İcmal</b></span><div class="toolbar"><select id="sites" aria-label="Sayt seç"></select><button class="btn" id="add">＋ Sayt əlavə et</button></div></header><main><div id="message" class="message" role="status" aria-live="polite"></div><div id="view"><p class="muted">Panel açılır…</p></div></main></div></div>
<dialog id="dialog"><form id="site-form" class="stack"><h2>Yeni sayt</h2><label>Saytın adı<input name="name" maxlength="90" required placeholder="Məsələn, Yemek Market"></label><label>Domen<input name="url" required placeholder="https://example.com"></label><div class="actions"><button class="btn primary">Saytı əlavə et</button><button class="btn" type="button" id="cancel">Ləğv et</button></div><p id="site-error" class="message" role="status"></p></form></dialog>
<script>
const $=id=>document.getElementById(id);
const sections=[["home","◫","İcmal"],["audit","◎","Texniki audit"],["pages","▤","Səhifələr"],["geo","✦","AI görünürlüyü"],["content","◇","Kontent və açar sözlər"],["reports","↗","Hesabatlar"],["settings","⚙","Bağlantılar"]];
let state, revision, active=localStorage.getItem("seo-site")||"bubora", tab="home", chosen="";
let saving=false;
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
  try{const data=await api("state","PUT",{state:next,revision});state=next;revision=data.revision}
  finally{saving=false}
}
async function changeSite(id,update){const next=structuredClone(state);update(next.sites.find(s=>s.id===id));await setState(next)}
function render(){
  if(!state)return;
  $("sites").innerHTML='<option value="all">Bütün saytlar</option>'+state.sites.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join("");
  $("sites").value=active;
  $("nav").innerHTML=sections.map(([id,icon,label])=>'<button type="button" data-tab="'+id+'" '+(tab===id?'aria-current="page"':'')+'><span class="icon" aria-hidden="true">'+icon+'</span>'+label+'</button>').join("");
  $("crumb").textContent=sections.find(s=>s[0]===tab)[2];
  const s=site();
  if(!s){$("view").innerHTML=title("Bütün saytlar","Auditlərə, SEO qaralamalarına və AI sorğularına ümumi baxış.")+'<div class="module">'+state.sites.map(x=>'<article class="panel"><h2>'+esc(x.name)+'</h2><p class="muted">'+esc(x.url)+'</p><p>'+x.pages.length+' SEO qaralaması · '+x.queries.length+' GEO sorğusu</p><p class="muted">'+(x.audit?'Son audit '+date(x.audit.date):'Audit gözlənilir')+'</p><button class="btn" data-site="'+esc(x.id)+'">İş sahəsini aç →</button></article>').join("")+'</div>';return}
  $("view").innerHTML=({home,audit:audits,pages,geo,content,reports,settings})[tab](s);
}
function home(s){
  const ok=s.audit?.checks.filter(c=>c[1]).length;
  const rows=s.audit?.checks.filter(c=>!c[1]).slice(0,4);
  return '<section class="hero"><div><p class="eyebrow">Saytın icmalı</p><h1>'+esc(s.name)+'</h1><a class="sub" href="'+esc(s.url)+'" target="_blank" rel="noopener noreferrer">'+esc(new URL(s.url).hostname)+' ↗</a></div><button class="btn primary" data-tab="audit">Texniki auditi aç →</button></section>'+
  '<div class="stats">'+stat("Audit yoxlamaları",s.audit?ok+"/"+s.audit.checks.length:"—",s.audit?"tamamlanan":"audit gözlənilir")+stat("SEO qaralamaları",s.pages.length,"saxlanılan")+stat("AI sorğuları",s.queries.length,"izləmə siyahısı")+stat("Üzvi kliklər","—","Search Console qoşulmayıb")+'</div>'+
  '<div class="columns"><section class="panel"><div class="panel-head"><h2>Audit nəticələri</h2><button class="btn" data-tab="audit">Audit →</button></div>'+
  (rows?.length?rows.map(c=>'<div class="row"><div><h3>'+esc(c[0])+'</h3><p class="muted small">'+esc(c[2])+'</p></div><span class="pill warn">Yoxla</span></div>').join(""):empty(s.audit?"Son auditdə əlavə yoxlama işarələnmədi.":"Saytın başlıq, indeks direktivləri, robots.txt və sitemap vəziyyətini yoxlamaq üçün audit başlat."))+
  '</section><section class="panel"><div class="panel-head"><h2>AI görünürlüyü</h2><button class="btn" data-tab="geo">Sorğular →</button></div>'+
  (s.queries.length?s.queries.slice(0,3).map(q=>'<div class="row"><div><h3>'+esc(q.question)+'</h3><p class="muted small">'+esc(q.platform)+'</p></div></div>').join(""):empty("İzləmək üçün ilk sorğunu əlavə et."))+'</section></div>';
}
function audits(s){
  const a=s.audit;
  return title("Texniki audit","Açıq səhifəni və domenin əsas axtarış fayllarını canlı yoxla.")+
  '<section class="panel"><form id="audit-form" class="stack"><label>Yoxlanacaq URL<input name="url" value="'+esc(a?.url||s.url)+'" required type="url"></label><div><button class="btn primary">Auditi başlat</button></div></form></section>'+
  (a?'<section class="panel"><div class="panel-head"><div><h2>Son audit</h2><p class="sub small">'+esc(a.url)+' · '+date(a.date)+' · '+a.responseMs+' ms sorğu müddəti</p></div></div>'+
  (a.truncated?empty("Səhifə böyükdür. Yoxlama cavabın ilk hissəsinə əsaslanır."):"")+
  a.checks.map(c=>'<div class="row"><div><h3>'+esc(c[0])+'</h3><p class="muted small">'+esc(c[2])+'</p></div><span class="pill '+(c[1]?"":"warn")+'">'+(c[1]?"Keçdi":"Yoxla")+'</span></div>').join("")+
  '<div class="actions"><button class="btn" data-action="from-audit">Metadata ilə qaralama aç</button></div></section>':"");
}
function pages(s){
  const p=s.pages.find(p=>p.id===chosen), a=chosen==="audit"?s.audit:null;
  return title("Səhifələr","SEO metadatası üçün qaralama hazırla və HTML fraqmentini ixrac et.")+
  '<div class="columns"><section class="panel"><div class="panel-head"><h2>'+ (p?"Qaralamanı redaktə et":"Yeni SEO qaralaması")+'</h2></div><form id="page-form" class="stack">'+
  '<label>Səhifə ünvanı<input name="url" required value="'+esc(p?.url||a?.url||s.url)+'"></label><label>SEO başlığı<input name="title" maxlength="200" value="'+esc(p?.title||a?.title||"")+'"></label>'+
  '<label>Meta açıqlaması<textarea name="description" maxlength="1000">'+esc(p?.description||a?.description||"")+'</textarea></label>'+
  '<label>Canonical URL<input name="canonical" value="'+esc(p?.canonical||a?.canonical||"")+'"></label>'+
  '<div class="form-grid"><label>Open Graph başlığı<input name="ogTitle" maxlength="200" value="'+esc(p?.ogTitle||"")+'"></label><label>Open Graph şəkli<input name="ogImage" value="'+esc(p?.ogImage||"")+'"></label></div>'+
  '<label>JSON-LD<textarea name="schema" placeholder="{…}">'+esc(p?.schema||"")+'</textarea></label>'+
  '<div class="actions"><button class="btn primary">Qaralamanı saxla</button>'+(p?'<button type="button" class="btn" data-action="export-page">HTML ixrac et</button><button type="button" class="btn" data-action="new-page">Yeni qaralama</button>':"")+'</div></form></section>'+
  '<section class="panel"><div class="panel-head"><h2>Saxlanılan qaralamalar</h2></div>'+
  (s.pages.length?s.pages.map(p=>'<div class="row"><div><h3>'+esc(p.title||p.url)+'</h3><p class="small muted">'+esc(p.url)+'</p></div><button class="btn" data-page="'+esc(p.id)+'">Aç</button></div>').join(""):empty("İlk qaralamanı saxladıqdan sonra burada görünəcək."))+'</section></div>';
}
function geo(s){
  const robots=s.audit?.robots;
  return title("AI görünürlüyü","GEO sorğularını saxla və yoxladığın cavablardakı marka adı, istinad və rəqib qeydlərini izlə.")+
  '<section class="panel"><div class="panel-head"><h2>Sorğu izləmə</h2><span class="pill">Əl ilə qeyd</span></div><form id="query-form" class="stack"><div class="form-grid"><label>Sorğu<input name="question" required maxlength="400" placeholder="Müəllimlər üçün hansı tədris platformaları var?"></label><label>Platforma<select name="platform">'+["ChatGPT","Google AI","Copilot","Perplexity","Gemini","Claude"].map(p=>'<option>'+p+'</option>').join("")+'</select></label></div><div><button class="btn primary">Sorğu əlavə et</button></div></form></section>'+
  '<section class="panel"><div class="panel-head"><h2>Saxlanılan sorğular</h2></div>'+
  (s.queries.length?s.queries.map(q=>'<details><summary><strong>'+esc(q.question)+'</strong> · <span class="muted">'+esc(q.platform)+'</span></summary><form class="stack geo-result" data-query="'+esc(q.id)+'"><div class="form-grid"><label>Marka adı çəkildi?<select name="mentioned">'+["Yoxlanmayıb","Bəli","Xeyr"].map(v=>'<option '+(v===q.mentioned?"selected":"")+'>'+v+'</option>').join("")+'</select></label><label>Sayta verilən istinad<input name="citation" value="'+esc(q.citation||"")+'" placeholder="https://…" type="url"></label></div><label>Rəqiblər və qeydlər<textarea name="note" maxlength="3000">'+esc(q.note||"")+'</textarea></label><div class="actions"><button class="btn">Nəticəni saxla</button>'+(q.date?'<small>Son qeyd '+date(q.date)+'</small>':"")+'</div></form></details>').join(""):empty("İlk GEO sorğusunu əlavə et."))+'</section>'+
  '<section class="panel"><div class="panel-head"><h2>AI bot qaydaları</h2></div>'+(robots?'<p class="sub">Axtarış üçün OAI-SearchBot və təlim üçün GPTBot qaydalarını auditdə alınmış robots.txt faylında nəzərdən keçir.</p><pre>'+esc(robots)+'</pre>':empty("Robots.txt qaydalarını göstərmək üçün texniki audit başlat."))+'</section>';
}
function content(s){
  return title("Kontent və açar sözlər","Açar söz, hədəf səhifə və kontent planını sayt üzrə saxla.")+
  '<section class="panel"><form id="content-form" class="stack"><div class="form-grid"><label>Açar söz və ya mövzu<input name="keyword" required maxlength="200"></label><label>Dil<select name="language"><option>Azərbaycan dili</option><option>Türkcə</option><option>İngiliscə</option></select></label></div><label>Hədəf səhifə<input name="target" placeholder="/blog/…"></label><label>Kontent qeydi<textarea name="brief" maxlength="3000"></textarea></label><div><button class="btn primary">Plana əlavə et</button></div></form></section>'+
  '<section class="panel"><div class="panel-head"><h2>Kontent planı</h2></div>'+(s.notes.length?s.notes.map(n=>'<div class="row"><div><h3>'+esc(n.keyword)+'</h3><p class="muted small">'+esc(n.language)+(n.target?' · '+esc(n.target):'')+'</p><p>'+esc(n.brief)+'</p></div></div>').join(""):empty("Kontent mövzuları burada görünəcək."))+'</section>';
}
function reports(s){
  return title("Hesabatlar","Sayt üzrə son audit, SEO qaralamaları, GEO qeydləri və kontent planını ixrac et.")+
  '<section class="panel"><div class="panel-head"><h2>'+esc(s.name)+'</h2><span class="pill">JSON</span></div><p class="sub">'+(s.audit?"Son audit "+date(s.audit.date):"Audit gözlənilir")+' · '+s.pages.length+' qaralama · '+s.queries.length+' GEO sorğusu</p><div class="actions"><button class="btn primary" data-action="export-report">Hesabatı endir</button>'+(s.audit?'<button class="btn" data-action="export-audit">Audit CSV</button>':"")+'</div></section>';
}
function settings(s){
  const integrations=[["Google Search Console","Klik və göstərimlər","https://search.google.com/search-console"],["Google Analytics 4","Üzvi trafik və qeydiyyatlar","https://analytics.google.com"],["Bing Webmaster Tools","Microsoft axtarış və AI istinadları","https://www.bing.com/webmasters"],["GitHub","SEO dəyişikliklərinin repozitoriyaya yayımlanması",s.repo]];
  return title("Bağlantılar","Canlı məlumat və yayımlama üçün istifadə ediləcək xidmətlər.")+'<div class="module">'+integrations.map(([name,detail,link])=>'<section class="panel"><div class="panel-head"><h2>'+name+'</h2><span class="pill warn">Qoşulmayıb</span></div><p class="muted">'+detail+'</p>'+(link?'<a class="btn" href="'+esc(link)+'" target="_blank" rel="noopener noreferrer">Xidməti aç ↗</a>':"")+'</section>').join("")+'</div>';
}
function download(name,content,type){
  const url=URL.createObjectURL(new Blob([content],{type})), a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function select(id){active=id;localStorage.setItem("seo-site",id);tab="home";chosen="";message("");render()}
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
document.addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b||!state)return;
  const d=b.dataset;
  if(d.tab)navigate(d.tab);
  if(d.site)select(d.site);
  if(d.page){chosen=d.page;render()}
  const s=site();if(!s)return;
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
    const value=[p.title&&"<title>"+esc(p.title)+"</title>",p.description&&'<meta name="description" content="'+esc(p.description)+'">',p.canonical&&'<link rel="canonical" href="'+esc(p.canonical)+'">',p.ogTitle&&'<meta property="og:title" content="'+esc(p.ogTitle)+'">',p.ogImage&&'<meta property="og:image" content="'+esc(p.ogImage)+'">',p.schema&&'<script type="application/ld+json">'+JSON.stringify(JSON.parse(p.schema),null,2).replaceAll("<","\\u003c")+'</scr'+'ipt>'].filter(Boolean).join("\n");
    download(s.id+"-seo-head.html",value,"text/plain");
  }
});
document.addEventListener("submit",async e=>{
  const form=e.target,s=site();
  if(form.id==="site-form"||!s)return;
  e.preventDefault();message("");
  const button=e.submitter, f=Object.fromEntries(new FormData(form));if(button)button.disabled=true;
  try{
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
      if(f.schema){const schema=JSON.parse(f.schema);if(!schema||typeof schema!=="object")throw Error("JSON-LD obyekti və ya siyahısı daxil et.")}
      const existing=s.pages.find(p=>p.id===chosen);
      const record={...f,id:existing?.id||crypto.randomUUID(),updated:new Date().toISOString()};
      await changeSite(s.id,item=>{item.pages=existing?item.pages.map(p=>p.id===existing.id?record:p):[record,...item.pages]});
      if(active===s.id)chosen=record.id;
    }else if(form.id==="query-form"){
      f.question=f.question.trim();if(!f.question)throw Error("Sorğunu daxil et.");
      await changeSite(s.id,item=>item.queries.push({...f,id:crypto.randomUUID()}));
    }else if(form.matches(".geo-result")){
      if(f.citation)f.citation=pageUrl(f.citation).href;
      await changeSite(s.id,item=>{const q=item.queries.find(q=>q.id===form.dataset.query);const result={...f,date:new Date().toISOString()};q.history=[result,...(q.history||[])].slice(0,25);Object.assign(q,result)});
    }else if(form.id==="content-form"){
      f.keyword=f.keyword.trim();if(!f.keyword)throw Error("Açar söz və ya mövzu daxil et.");
      await changeSite(s.id,item=>item.notes.unshift({...f,id:crypto.randomUUID()}));
    }else return;
    render();message(form.id==="audit-form"?"Audit saxlanıldı.":"Dəyişiklik saxlanıldı.");
  }catch(err){message(err.message);if(form.id==="audit-form"&&button)button.textContent="Auditi başlat"}
  finally{if(button)button.disabled=false}
});
api("state").then(data=>{state=data.state;revision=data.revision;if(active!=="all"&&!site())active=state.sites[0].id;render()})
.catch(err=>{$("view").textContent="Panel açıla bilmədi.";message(err.message)});
</script></body></html>`;

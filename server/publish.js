import { createHash } from "node:crypto";
import { parse } from "parse5";

const encode = value => String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const digest = value => createHash("sha256").update(value).digest("hex");
const fail = (status,message) => Object.assign(new Error(message),{status});
const attributes = node => Object.fromEntries(node.attrs.map(({name,value})=>[name,value]));
const fields = [
  ["title","title"],
  ["description","meta","name","description"],
  ["canonical","link","rel","canonical"],
  ["directives","meta","name","robots"],
  ["ogTitle","meta","property","og:title"],
  ["ogDescription","meta","property","og:description"],
  ["ogImage","meta","property","og:image"]
];

function changesFor(draft) {
  const changes=[];
  for(const [field,tag,key,value] of fields){
    const text=draft[field]?.trim();
    if(!text)continue;
    const matches=node=>node.tagName===tag&&(!key||attributes(node)[key]?.toLowerCase()===value);
    let tagHtml;
    if(tag==="title")tagHtml="<title>"+encode(text)+"</title>";
    else if(tag==="link")tagHtml='<link rel="canonical" href="'+encode(text)+'">';
    else tagHtml='<meta '+key+'="'+value+'" content="'+encode(text)+'">';
    changes.push({field,matches,html:tagHtml});
  }
  if(draft.hreflangs?.trim()){
    const seen=new Set();
    const alternates=draft.hreflangs.trim().split(/\r?\n/).map(line=>{
      const [lang,href,...extra]=line.trim().split(/\s+/);
      if(!lang||!href||extra.length||seen.has(lang.toLowerCase()))throw fail(400,"hreflang sətirlərini yoxla.");
      seen.add(lang.toLowerCase());
      return '<link rel="alternate" hreflang="'+encode(lang)+'" href="'+encode(href)+'">';
    });
    changes.push({field:"hreflangs",html:alternates.join("\n  "),matches:node=>node.tagName==="link"&&attributes(node).rel?.toLowerCase()==="alternate"&&Boolean(attributes(node).hreflang)});
  }
  if(draft.schema?.trim()){
    const schema=JSON.stringify(JSON.parse(draft.schema)).replaceAll("<","\\u003c");
    changes.push({field:"schema",html:'<script type="application/ld+json">'+schema+'</script>',matches:node=>node.tagName==="script"&&(attributes(node).type?.toLowerCase()==="application/ld+json")});
  }
  return changes;
}

export function patchHtml(source,draft){
  const document=parse(source,{sourceCodeLocationInfo:true});
  const head=document.childNodes.find(x=>x.tagName==="html")?.childNodes.find(x=>x.tagName==="head");
  if(!head?.sourceCodeLocation?.startTag||!head.sourceCodeLocation.endTag)throw fail(422,"HTML faylında açıq və bağlanan head teqi olmalıdır.");
  const newline=source.includes("\r\n")?"\r\n":"\n";
  const edits=[], added=[], fields=[];
  for(const {field,matches,html} of changesFor(draft)){
    const tags=head.childNodes.filter(node=>node.sourceCodeLocation&&matches(node));
    const markup=html.replaceAll("\n",newline);
    const before=tags.map(node=>source.slice(node.sourceCodeLocation.startOffset,node.sourceCodeLocation.endOffset)).join(newline+"  ");
    if(before===markup)continue;
    fields.push({field,before,after:markup});
    if(!tags.length){added.push(markup);continue}
    for(const [index,node] of tags.entries()){
      const {startOffset,endOffset}=node.sourceCodeLocation;
      edits.push({start:startOffset,end:endOffset,value:index===0?markup:""});
    }
  }
  if(added.length){
    const end=head.sourceCodeLocation.endTag.startOffset;
    edits.push({start:end,end,value:"  "+added.join(newline+"  ")+newline});
  }
  let result=source;
  for(const {start,end,value} of edits.sort((a,b)=>b.start-a.start))result=result.slice(0,start)+value+result.slice(end);
  return {result,fields};
}

function safePath(path){
  return path.length<=400&&path.split("/").every(x=>/^[\p{L}\p{N}_][\p{L}\p{N}_.-]*$/u.test(x));
}
function candidates(url,target){
  if(url.search)throw fail(422,"Sorğu parametrli URL üçün təmiz səhifə ünvanını istifadə et.");
  const route=decodeURIComponent(url.pathname);
  const custom=target.routes?.[url.pathname];
  if(typeof custom==="string"&&Object.hasOwn(target.routes,url.pathname))return [custom];
  const clean=route.replace(/^\/|\/$/g,"");
  if(!clean)return [(target.root?target.root+"/":"")+"index.html"];
  if(!safePath(clean))throw fail(422,"Bu URL üçün routes xəritəsində HTML faylını göstər.");
  const paths=clean.endsWith(".html")?[clean]:[clean+"/index.html",clean+".html"];
  return paths.map(path=>(target.root?target.root+"/":"")+path);
}


function blogMarkup(post,origin){
 const slug=String(post.slug||"");
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))throw fail(400,"Bloq slug yanlışdır.");
 const title=String(post.title||"").trim(),body=String(post.body||"").trim();
 if(!title||!body||title.length>180||body.length>40000)throw fail(400,"Bloq məlumatlarını yoxla.");
 const url=origin+"/"+slug+".html";
 const inline=s=>encode(s).replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/\*(.+?)\*/g,"<em>$1</em>");
 const content=body.split(/\r?\n/).map(line=>line.startsWith("### ")?"<h3>"+inline(line.slice(4))+"</h3>":line.startsWith("## ")?"<h2>"+inline(line.slice(3))+"</h2>":line.startsWith("# ")?"<h2>"+inline(line.slice(2))+"</h2>":line.trim()?"<p>"+inline(line)+"</p>":"").join("\n");
 const description=String(post.description||"").slice(0,200);
 const image=post.image?new URL(post.image):null;
 if(image&&image.protocol!=="https:")throw fail(400,"Şəkil HTTPS olmalıdır.");
 const schema=JSON.stringify({"@context":"https://schema.org","@type":"BlogPosting",headline:title,description,mainEntityOfPage:url,dateModified:post.updated,image:image?.href}).replaceAll("<","\\u003c");
 return '<!doctype html>\n<html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+encode(post.seoTitle||title)+'</title><meta name="description" content="'+encode(description)+'"><link rel="canonical" href="'+encode(url)+'"><script type="application/ld+json">'+schema+'</scr'+'ipt></head><body><main><article><h1>'+encode(title)+'</h1>'+content+'</article></main></body></html>';
}

export function createPublisher({token,targets,fetcher=fetch}){
  const mapped=new Map(Object.entries(targets));
  for(const [origin,target] of mapped){
    if(new URL(origin).origin!==origin||!origin.startsWith("https://")||!target||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(target.repo)||target.repo.split("/").some(x=>x==="."||x==="..")||
      !/^[A-Za-z0-9_./-]{1,160}$/.test(target.branch||"")||
      (target.root&&!safePath(target.root))||
      Object.values(target.routes||{}).some(x=>typeof x!=="string"||!safePath(x)||!x.endsWith(".html"))){
      throw Error("SEO_GITHUB_TARGETS konfiqurasiyası yanlışdır.");
    }
  }
  const request=async (path, options={})=>{
    const response=await fetcher("https://api.github.com"+path,{
      method:options.body?"PUT":"GET",redirect:"error",signal:AbortSignal.timeout(12000),
      headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json","Content-Type":"application/json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"SEO-Merkezi"},
      body:options.body?JSON.stringify(options.body):undefined
    });
    if(options.missing&&response.status===404)return null;
    if(!response.ok){
      if(response.status===409||response.status===422)throw fail(409,"GitHub faylı dəyişib və ya branch yazmanı qəbul etmir. Önizləməni yenilə.");
      if(response.status===401||response.status===403||response.status===404)throw fail(403,"GitHub tokenini, repo girişini və branch icazələrini yoxla.");
      throw fail(502,"GitHub sorğusu tamamlanmadı.");
    }
    return response.json();
  };
  return {
    status(origin){return Boolean(token&&mapped.has(origin))},
    async blog({origin,post,expected}){
      const target=mapped.get(origin);
      if(!token||!target)throw fail(422,"Bu domen üçün GitHub yayımlama bağlantısı qurulmayıb.");
      const html=blogMarkup(post,origin);
      const path=(target.root?target.root+"/":"")+post.slug+".html";
      const api="/repos/"+target.repo+"/contents/"+path.split("/").map(encodeURIComponent).join("/");
      const existing=await request(api+"?ref="+encodeURIComponent(target.branch),{missing:true});
      if(existing&&(existing.type!=="file"||existing.encoding!=="base64"||existing.size>750000))throw fail(422,"HTML faylı oxuna bilmir.");
      const check=digest(JSON.stringify([origin,path,target.repo,target.branch,existing?.sha||"",html]));
      const info={repo:target.repo,branch:target.branch,path,url:origin+"/"+post.slug+".html"};
      if(expected===undefined)return {...info,check,exists:Boolean(existing)};
      if(expected!==check)throw fail(409,"Məqalə və ya repo dəyişib. Yenidən önizlə.");
      const current=existing?Buffer.from(existing.content,"base64").toString("utf8"):null;
      if(current===html)return {...info,unchanged:true};
      const posted=await request(api,{body:{message:"Blog: "+post.title,content:Buffer.from(html).toString("base64"),branch:target.branch,...(existing?{sha:existing.sha}:{})}});
      return {...info,commit:posted.commit?.html_url};
    },
    async run({origin,draft,expected}){
      const target=mapped.get(origin);
      if(!token||!target)throw fail(422,"Bu domen üçün GitHub yayımlama bağlantısı qurulmayıb.");
      const url=new URL(draft.url);
      if(url.origin!==origin)throw fail(400,"Qaralamanın URL-i seçilmiş domenə aid olmalıdır.");
      const files=await Promise.all(candidates(url,target).map(async path=>{
        const api="/repos/"+target.repo+"/contents/"+path.split("/").map(encodeURIComponent).join("/");
        const data=await request(api+"?ref="+encodeURIComponent(target.branch),{missing:true});
        return data?{path,api,data}:null;
      }));
      const existing=files.filter(Boolean);
      if(existing.length!==1)throw fail(422,existing.length?"Birdən çox HTML faylı tapıldı. routes xəritəsində dəqiq faylı göstər.":"HTML faylı tapılmadı. Repo, branch, token və routes xəritəsini yoxla.");
      const {path,api,data}=existing[0];
      if(data.type!=="file"||data.encoding!=="base64"||data.size>750000)throw fail(422,"GitHub faylı bu redaktorla oxuna bilmir.");
      const buffer=Buffer.from(data.content,"base64");
      const original=buffer.toString("utf8");
      if(!Buffer.from(original).equals(buffer))throw fail(422,"HTML faylı UTF-8 formatında olmalıdır.");
      const {result,fields}=patchHtml(original,draft);
      const check=digest(JSON.stringify([origin, path,target.repo,target.branch,data.sha,result]));
      const info={path,repo:target.repo,branch:target.branch,fields};
      if(expected===undefined)return {...info,check};
      if(expected!==check)throw fail(409,"Fayl və ya qaralama dəyişib. Yenidən önizlə.");
      if(!fields.length)return {...info,unchanged:true};
      const posted=await request(api,{body:{
        message:"SEO: "+path,content:Buffer.from(result).toString("base64"),sha:data.sha,branch:target.branch
      }});
      return {...info,commit:posted.commit?.html_url,sha:posted.commit?.sha};
    }
  };
}

import { createServer } from "node:http";
import { lookup } from "node:dns/promises";
import { timingSafeEqual, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Agent, setGlobalDispatcher } from "undici";
import ipaddr from "ipaddr.js";
import app from "../worker/index.js";
import { createLiveSeo } from "./live-seo.js";
import { createPublisher } from "./publish.js";
import { createIntegrations } from "./integrations.js";

const {SEO_PUBLIC_URL,SEO_ADMIN_PASSWORD,SEO_ADMIN_USER="admin",SEO_BIND="127.0.0.1",PORT=8787}=process.env;
if (!SEO_PUBLIC_URL || !SEO_ADMIN_PASSWORD || SEO_ADMIN_PASSWORD.length<16) {
  throw Error("SEO_PUBLIC_URL və ən azı 16 simvolluq SEO_ADMIN_PASSWORD tələb olunur.");
}
const publicUrl=new URL(SEO_PUBLIC_URL);
if(publicUrl.origin!==SEO_PUBLIC_URL||publicUrl.protocol!=="https:")throw Error("SEO_PUBLIC_URL panelin HTTPS origin-i olmalıdır.");
if(SEO_ADMIN_USER.includes(":"))throw Error("SEO_ADMIN_USER iki nöqtə işarəsi içərə bilməz.");

const dispatcher=new Agent({connect:{lookup(host,options,callback){
  lookup(host,{all:true,verbatim:true,family:options.family||0}).then(records=>{
    if(!records.length||records.some(record=>ipaddr.process(record.address).range()!=="unicast")){
      callback(Error("Bu host açıq IP ünvanından istifadə etmir."));
      return;
    }
    if(options.all)callback(null,records);
    else callback(null,records[0].address,records[0].family);
  },callback).catch(callback);
}}});
setGlobalDispatcher(dispatcher);

const secretHash=value=>createHash("sha256").update(value).digest();
const expected=secretHash(SEO_ADMIN_USER+":"+SEO_ADMIN_PASSWORD);
const authenticated=header=>{
  if(!header||!/^Basic [A-Za-z0-9+/]+=*$/i.test(header))return false;
  return timingSafeEqual(secretHash(Buffer.from(header.slice(6),"base64")),expected);
};
const dbPath=resolve(process.env.SEO_DB_PATH||"data/seo.sqlite");
mkdirSync(dirname(dbPath),{recursive:true});
const sqlite=new DatabaseSync(dbPath);
sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);");
const DB={
  prepare(sql){
    const statement=sqlite.prepare(sql);
    let bindings=[];
    return {
      bind(...values){bindings=values;return this},
      first(){return statement.get(...bindings)},
      run(){return {meta:{changes:Number(statement.run(...bindings).changes)}}}
    };
  }
};
const PUBLISH=createPublisher({token:process.env.SEO_GITHUB_TOKEN,targets:JSON.parse(process.env.SEO_GITHUB_TARGETS||"{}")});
const integrations=createIntegrations(process.env,sqlite);
const liveSeo=createLiveSeo(JSON.parse(process.env.SEO_LIVE_TARGETS||"{}"),sqlite);
const server=createServer({requestTimeout:30000},async (req,res)=>{
  res.setHeader("Cache-Control","no-store");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("X-Frame-Options","DENY");
  const route=req.url?.split("?",1)[0];
  if(route==="/api/live-seo"&&req.method==="GET"){
    try{
      const response=liveSeo.read(new URL(req.url,publicUrl),req.headers.authorization);
      res.writeHead(response.status,Object.fromEntries(response.headers)).end(await response.text());
    }catch{res.writeHead(502,{"Content-Type":"application/json"}).end('{"error":"SEO məlumatı oxunmadı."}')}
    return;
  }
  if(!authenticated(req.headers.authorization)){
    res.writeHead(401,{"WWW-Authenticate":'Basic realm="SEO Merkezi", charset="UTF-8"'});
    res.end("Giriş tələb olunur.");return;
  }
  try{
    const url=new URL(req.url,publicUrl);
    if(url.origin!==publicUrl.origin){res.writeHead(400).end();return}
    const headers=new Headers(req.headers);
    headers.delete("authorization");
    let body;
    if(req.method!=="GET"&&req.method!=="HEAD"){
      const parts=[];let size=0;
      for await(const part of req){
        size+=part.length;
        if(size>1600000){res.writeHead(413).end();return}
        parts.push(part);
      }
      body=Buffer.concat(parts);
    }
    const response=await app.fetch(new Request(url,{method:req.method,headers,body}),{DB,PUBLISH,LIVESEO:liveSeo,INTEGRATIONS:integrations});
    res.writeHead(response.status,Object.fromEntries(response.headers));
    if(response.body)await pipeline(Readable.fromWeb(response.body),res);
    else res.end();
  }catch{
    if(!res.headersSent)res.writeHead(500,{"Content-Type":"text/plain; charset=utf-8"}).end("Server sorğusu tamamlanmadı.");
    else res.destroy();
  }
});

if(process.env.SEO_AUTO_AUDIT_ENABLED==="true"){
 const hours=Math.max(6,Math.min(168,Number(process.env.SEO_AUTO_AUDIT_HOURS)||24));
 async function runAutoAudits(){
  const row=sqlite.prepare("SELECT data,revision FROM workspace WHERE id=1").get();
  if(!row)return;
  const state=JSON.parse(row.data);
  for(const site of state.sites.slice(0,20)){
   if(site.autoAudit===false)continue;
   if(site.autoAuditAt&&Date.now()-Date.parse(site.autoAuditAt)<hours*3600000)continue;
   try{
    const response=await app.fetch(new Request(publicUrl.origin+"/api/audit",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url:site.url})}),{DB,PUBLISH,LIVESEO:liveSeo,INTEGRATIONS:integrations});
    if(!response.ok)continue;
    const result=await response.json();
    const current=sqlite.prepare("SELECT data,revision FROM workspace WHERE id=1").get();
    const next=JSON.parse(current.data),target=next.sites.find(x=>x.id===site.id);
    if(!target)continue;
    target.audit=result;target.autoAuditAt=new Date().toISOString();
    sqlite.prepare("UPDATE workspace SET data=?,revision=revision+1 WHERE id=1 AND revision=?").run(JSON.stringify(next),current.revision);
   }catch(error){console.error("SEO auto audit:",error.message)}
  }
 }
 setTimeout(()=>runAutoAudits().catch(console.error),30000).unref();
 setInterval(()=>runAutoAudits().catch(console.error),hours*3600000).unref();
}

server.listen(Number(PORT),SEO_BIND,()=>console.log("SEO Mərkəzi "+SEO_BIND+":"+PORT));

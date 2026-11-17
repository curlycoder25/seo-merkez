import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { patchHtml } from "./publish.js";

const hopHeaders=["connection","keep-alive","proxy-authenticate","proxy-authorization","te","trailer","transfer-encoding","upgrade"];
function cleanHeaders(headers){
  for(const name of (headers.get("connection")||"").split(",")) if(name.trim())headers.delete(name.trim());
  for(const name of hopHeaders)headers.delete(name);
  return headers;
}
function noCache(headers){
  headers.set("Cache-Control","private, no-store");
  for(const name of ["etag","last-modified","expires","age","cdn-cache-control","surrogate-control"]) headers.delete(name);
}
async function metadata(config,pathname){
  const url=new URL("/api/live-seo",config.panel);
  url.searchParams.set("site",config.site.origin);
  url.searchParams.set("path",pathname);
  try{
    const result=await fetch(url,{headers:{Authorization:"Bearer "+config.token},redirect:"error",signal:AbortSignal.timeout(1500)});
    if(!result.ok){await result.body?.cancel();return null}
    const values=await result.json();
    return {title:typeof values.title==="string"?values.title.slice(0,200):"",description:typeof values.description==="string"?values.description.slice(0,1000):""};
  }catch{return null}
}
export function createSiteProxy(config){
  return createServer({requestTimeout:30000},async(req,res)=>{
    try{
      if(!req.url?.startsWith("/")||req.url.startsWith("//")){res.writeHead(400).end();return}
      const page=new URL(req.url,config.site);
      if(page.origin!==config.site.origin){res.writeHead(400).end();return}
      const upstream=new URL(config.upstream.origin);
      upstream.pathname=page.pathname;upstream.search=page.search;
      const headers=cleanHeaders(new Headers(req.headers));
      headers.delete("host");
      headers.delete("accept-encoding");
      headers.set("accept-encoding","identity");
      headers.set("x-forwarded-host",config.site.host);
      headers.set("x-forwarded-proto",config.site.protocol.slice(0,-1));
      const eligible=["GET","HEAD"].includes(req.method)&&(!/\.[^/]+$/.test(page.pathname)||/\.html?$/i.test(page.pathname));
      if(eligible)for(const name of ["if-none-match","if-modified-since","range","if-range"])headers.delete(name);
      const values=eligible&&req.method==="GET"?metadata(config,page.pathname):null;
      const hasBody=!["GET","HEAD"].includes(req.method);
      const response=await fetch(upstream,{method:req.method,headers,body:hasBody?Readable.toWeb(req):undefined,duplex:hasBody?"half":undefined,redirect:"manual",signal:AbortSignal.timeout(20000)});
      const output=cleanHeaders(new Headers(response.headers));
      const cookies=response.headers.getSetCookie();
      if(cookies.length){output.delete("set-cookie");res.setHeader("Set-Cookie",cookies)}
      if(output.has("content-encoding")){
        output.delete("content-encoding");output.delete("content-length");output.delete("etag");
      }
      const location=output.get("location");
      if(location){
        try{const next=new URL(location);if(next.origin===config.upstream.origin)output.set("location",config.site.origin+next.pathname+next.search+next.hash)}catch{}
      }
      if(eligible&&/^text\/html\b/i.test(output.get("content-type")||"")){
        noCache(output);
        const next=await values;
        if(next&&(next.title||next.description)&&response.ok&&response.body){
          const type=output.get("content-type")||"";
          if(!/charset\s*=\s*(?!utf-8\b)[\w-]+/i.test(type)){
            const reader=response.body.getReader();
            const parts=[];let count=0;
            while(count<=1048576){
              const {value,done}=await reader.read();
              if(done){
                const bytes=Buffer.concat(parts);let patched=bytes;
                try{patched=patchHtml(new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes),next).result}catch{}
                output.delete("content-length");
                res.writeHead(response.status,Object.fromEntries(output)).end(patched);return;
              }
              parts.push(value);count+=value.byteLength;
            }
            res.writeHead(response.status,Object.fromEntries(output));
            await pipeline(Readable.from((async function*(){
              try{yield* parts;while(true){const {value,done}=await reader.read();if(done)break;yield value}}
              finally{await reader.cancel().catch(()=>{})}
            })()),res);
            return;
          }
        }
      }
      res.writeHead(response.status,Object.fromEntries(output));
      if(response.body)await pipeline(Readable.fromWeb(response.body),res);
      else res.end();
    }catch{
      if(!res.headersSent)res.writeHead(502,{"Cache-Control":"no-store"}).end("Saytın mənbə serveri cavab vermədi.");
      else res.destroy();
    }
  });
}

import { createHash, timingSafeEqual } from "node:crypto";

export function pageKey(pathname) {
  return pathname.replace(/\/index\.html$/,"/").replace(/\/+$/,"")||"/";
}

const digest=value=>createHash("sha256").update(value).digest();

export function createLiveSeo(targets,db){
  const secrets=new Map(Object.entries(targets).map(([origin,secret])=>{
    if(typeof secret!=="string"||secret.length<32||new URL(origin).origin!==origin||!origin.startsWith("https://")){
      throw Error("SEO_LIVE_TARGETS: HTTPS origin və ən azı 32 simvolluq açar tələb olunur.");
    }
    return [origin,digest(secret)];
  }));
  const reply=(value,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
  return {
    status:origin=>secrets.has(origin),
    read(url,authorization){
      if(url.search.length>2300)return reply({error:"Sorğu çox uzundur."},400);
      const origin=url.searchParams.get("site"), path=url.searchParams.get("path");
      const expected=secrets.get(origin);
      if(!expected||!authorization?.startsWith("Bearer ")||!timingSafeEqual(expected,digest(authorization.slice(7)))){
        return reply({error:"Giriş tələb olunur."},401);
      }
      if(!path?.startsWith("/")||path.startsWith("//")||/[?#\\]/.test(path))return reply({error:"Səhifə yolu yanlışdır."},400);
      const row=db.prepare("SELECT data FROM workspace WHERE id=1").get();
      const site=row&&JSON.parse(row.data).sites.find(s=>new URL(s.url).origin===origin);
      const page=site?.pages.filter(p=>{
        if(p.live!==true)return false;
        try{const u=new URL(p.url);return u.origin===origin&&!u.search&&pageKey(u.pathname)===pageKey(path)}catch{return false}
      }).sort((a,b)=>(b.updated||"").localeCompare(a.updated||""))[0];
      return reply({title:typeof page?.title==="string"?page.title.slice(0,200):"",description:typeof page?.description==="string"?page.description.slice(0,1000):""});
    }
  };
}

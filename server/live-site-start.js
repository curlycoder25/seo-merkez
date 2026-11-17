import { createSiteProxy } from "./live-site.js";

const {SEO_SITE_URL,SEO_PANEL_URL,SEO_SITE_UPSTREAM,SEO_LIVE_TOKEN,SEO_SITE_BIND="127.0.0.1",SEO_SITE_PORT="8788"}=process.env;
if(!SEO_SITE_URL||!SEO_PANEL_URL||!SEO_SITE_UPSTREAM||!SEO_LIVE_TOKEN||SEO_LIVE_TOKEN.length<32){
  throw Error("SEO_SITE_URL, SEO_PANEL_URL, SEO_SITE_UPSTREAM və ən azı 32 simvolluq SEO_LIVE_TOKEN tələb olunur.");
}
const origin=(value,protocols)=>{
  const url=new URL(value);
  if(!protocols.includes(url.protocol)||url.origin!==value)throw Error("Sayt və server ünvanlarını yalnız origin formatında yaz.");
  return url;
};
const config={site:origin(SEO_SITE_URL,["https:"]),panel:origin(SEO_PANEL_URL,["http:","https:"]),upstream:origin(SEO_SITE_UPSTREAM,["http:","https:"]),token:SEO_LIVE_TOKEN};
if(config.panel.protocol==="http:"&&config.panel.hostname!=="127.0.0.1")throw Error("Uzaq panel üçün HTTPS tələb olunur.");
if(config.site.origin===config.upstream.origin)throw Error("SEO_SITE_UPSTREAM saytın daxili server ünvanı olmalıdır.");
createSiteProxy(config).listen(Number(SEO_SITE_PORT),SEO_SITE_BIND,()=>console.log("Canlı SEO "+SEO_SITE_BIND+":"+SEO_SITE_PORT));

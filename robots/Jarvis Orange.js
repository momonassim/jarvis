// Jarvis — robot Orange v7 (tourne sur ton iPhone, avec ta connexion)
// Fait le tour COMPLET de ton espace client Orange, pour TOUS tes contrats : il touche chaque contrat
// l'un après l'autre (comme toi à la main), puis lit toutes ses pages (offre, options,
// lignes, box, matériel, conso, factures, paiements, contrats, compte…), les données
// cachées derrière les pages, tous les PDF qu'il trouve (factures, contrats…),
// et le code RIO de chaque ligne (rangé dans le bâtiment Abonnements).
// Tout part dans Supabase, pour le bâtiment « Abonnements » de Jarvis.
// 1re fois : il te demande ton identifiant et ton mot de passe Orange (rangés dans le Trousseau).
// Si Orange demande une vérification (code, appareil de confiance), la page s'ouvre :
// tu valides, puis tu touches « Terminé » en haut à gauche, et il continue tout seul.

const SB = "https://uaprtibscyepsabyqcyl.supabase.co";
const HOTE = "espace-client.orange.fr";
const START = "https://" + HOTE + "/accueil";
const KEYS = { id: "jarvis.orange.id", pw: "jarvis.orange.password", sb: "jarvis.supabase.secret" };
const MAX_PAGES = 130, MAX_CLICS = 60, MAX_PDF = 80;
// Liens jamais suivis (actions, sortie, boutique…)
const EVITER = /d[ée]connex|logout|r[ée]sili|supprim|annul|souscri|command|panier|boutique|acheter|achat|mailto:|tel:|javascript:|chat|messenger|forum|communaute|assistance\.orange|aide\.orange|recrutement|paiement-en-ligne|payer/i;

async function ask(title, message, secure) {
  const a = new Alert(); a.title = title; a.message = message;
  if (secure) a.addSecureTextField("", ""); else a.addTextField("", "");
  a.addAction("OK"); a.addCancelAction("Annuler");
  if (await a.presentAlert() === -1) throw new Error("Annulé");
  return a.textFieldValue(0).trim();
}
async function secret(key, title, message, secure) {
  if (Keychain.contains(key)) return Keychain.get(key);
  const v = await ask(title, message, secure); Keychain.set(key, v); return v;
}
const wait = (ms) => new Promise((r) => Timer.schedule(ms, false, r));
const wv = new WebView();
const js = (code) => wv.evaluateJavaScript(code, false);
const path = () => js(`location.href`);
async function until(cond, secs = 25) { for (let i = 0; i < secs * 2; i++) { try { if (await js(cond)) return true; } catch (_) {} await wait(500); } return false; }
const fill = (sel, val) => js(`(function(){const el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;el.focus();
  const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,${JSON.stringify(val)});
  el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
const cliquer = (re) => js(`(function(){const b=[...document.querySelectorAll('button,input[type=submit],a[role=button]')].find(x=>${re}.test((x.innerText||x.value||x.getAttribute('aria-label')||'').trim()) && !x.disabled);
  if(b){b.click();return true;} const s=document.querySelector('#btnSubmit,button[type=submit],input[type=submit]'); if(s){s.click();return true;} return false;})()`);
// Jamais d'IBAN dans Jarvis
const masquer = (s) => String(s || "").replace(/\bFR\s?\d{2}(?:[\s.\-]?[0-9A-Z*•xX]{2,4}){4,8}/g, "[IBAN masqué]").replace(/\bIBAN\b[^\n]{0,60}/gi, "IBAN [masqué]");
const slug = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").slice(0, 90);
// Boutons jamais touchés pendant l'exploration (ils changeraient quelque chose)
const NE_PAS_CLIQUER = /t[ée]l[ée]charger|pdf|ajout|activ|modifi|chang|valid|confirm|envoy|enregistr|demand|r[ée]serv|recharg|bloqu|suspend|transf[ée]r|renvoi|parution|d[ée]pann|tester|red[ée]marr|r[ée]initialis|mot de passe|code|commander|contact|appeler|rappel|qui utilise|fermer|retour|pr[ée]c[ée]dent|cookies|accepter|refuser|menu|rechercher|se d[ée]connecter|^x$|^×$/i;
// (Scriptable n'a pas « new URL » : on découpe les adresses nous-mêmes)
const hote = (u) => ((String(u).match(/^https?:\/\/([^/?#]+)/i) || [])[1] || "").toLowerCase();
const sansAncre = (u) => String(u).split("#")[0];
const debug = [];

let sbKey;
async function sb(pathq, method = "GET", body, extra = {}) {
  const r = new Request(SB + pathq); r.method = method;
  r.headers = { apikey: sbKey, ...extra };
  if (body !== undefined) r.body = body;
  const out = await r.loadString();
  return { status: r.response.statusCode, body: out };
}

// ---------- connexion ----------
const surEspace = `location.host===${JSON.stringify(HOTE)} && !document.querySelector('input[type=password]')`;
async function login(id, pw) {
  await wv.loadURL(START);
  await until(`document.readyState==='complete'`, 25); await wait(2500);
  if (await js(surEspace) && !(await js(`/identifiez-vous|se connecter/i.test(document.body.innerText.slice(0,400))`))) return;
  // bandeau cookies : on refuse poliment s'il bloque la page
  await js(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/continuer sans accepter|tout refuser|refuser/i.test(x.innerText||''));if(b)b.click();return true;})()`);
  const champId = `input#login,input[name=login],input[type=email],input[type=tel],input[autocomplete=username]`;
  await until(`!!document.querySelector(${JSON.stringify(champId)}) || (${surEspace})`, 30);
  if (await js(surEspace)) return;
  await fill(champId, id); await wait(500);
  await cliquer(`/^(continuer|suivant|valider|s.identifier)/i`);
  await until(`!!document.querySelector('input[type=password]') || (${surEspace})`, 30);
  if (await js(`!!document.querySelector('input[type=password]')`)) {
    await fill(`input#password,input[type=password]`, pw); await wait(500);
    await cliquer(`/^(s.identifier|se connecter|continuer|valider)/i`);
  }
  let ok = await until(surEspace, 40);
  if (!ok) {
    const a = new Alert(); a.title = "Orange";
    a.message = "Orange demande une vérification (code, appareil de confiance…).\nJe t'ouvre la page : valide comme d'habitude, puis touche « Terminé » en haut à gauche.";
    a.addAction("OK"); await a.presentAlert();
    await wv.present(false);
    ok = await js(surEspace);
    if (!ok) { await wv.loadURL(START); await wait(5000); ok = await js(surEspace); }
  }
  debug.push({ step: "connexion", ok, url: (await path()).split("?")[0].slice(0, 100) });
  if (!ok) throw new Error("Connexion Orange pas terminée");
}

// ---------- outils dans la page ----------
const PIEGE = `(function(){if(window.__hk)return true;window.__hk=1;window.__cap=[];
  window.open=function(u){window.__cap.push({u:String(u)});return null;};
  const oc=URL.createObjectURL;URL.createObjectURL=function(b){const u=oc.call(URL,b);if(b instanceof Blob)window.__cap.push({b:b,u:u});return u;};
  const ac=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){
    if(this.href&&(this.hasAttribute('download')||/\\.pdf|blob:|download|telecharg/i.test(this.href))){window.__cap.push({u:this.href,n:this.getAttribute('download')||''});return;}
    return ac.call(this);};
  return true;})()`;
// Écoute les données que la page reçoit (offre, factures, conso…) : copie de chaque réponse JSON
const ECOUTE = `(function(){if(window.__ec)return true;window.__ec=1;window.__api=[];
  const garde=(u,s,ct,t)=>{try{if(!/json/i.test(ct||'')&&!/^\\s*[\\[{]/.test(t||''))return;if(window.__api.length<400)window.__api.push({u:String(u),s:s,t:String(t).slice(0,250000)});}catch(e){}};
  const of=window.fetch;window.fetch=function(){const a=arguments;return of.apply(this,a).then(r=>{try{const c=r.clone();c.text().then(t=>garde(c.url||(a[0]&&a[0].url)||a[0],c.status,c.headers.get('content-type'),t)).catch(()=>{});}catch(e){}return r;});};
  window.__hdr=window.__hdr||{};window.__pdfs=window.__pdfs||[];
  const oh=XMLHttpRequest.prototype.setRequestHeader;XMLHttpRequest.prototype.setRequestHeader=function(n,v){try{if(/^x-orange-/i.test(n)&&!/request-id/i.test(n))window.__hdr[n]=v;}catch(e){}return oh.apply(this,arguments);};
  const oo=XMLHttpRequest.prototype.open,os=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(m,u){this.__u=u;return oo.apply(this,arguments);};
  XMLHttpRequest.prototype.send=function(){this.addEventListener('load',()=>{try{if(this.response instanceof Blob&&/pdf/i.test(this.responseURL||this.__u||'')){const x=this,fr=new FileReader();fr.onload=()=>{window.__pdfs.push({u:String(x.responseURL||x.__u),d:String(fr.result).split(',')[1]||''});};fr.readAsDataURL(x.response);return;}}catch(e){}try{garde(this.responseURL||this.__u,this.status,this.getResponseHeader('content-type'),(this.responseType===''||this.responseType==='text')?this.responseText:'');}catch(e){}});return os.apply(this,arguments);};
  return true;})()`;
const donnees = new Map();
let courant = "", premier = "";
async function recolter() {
  try {
    const x = await js(`JSON.stringify((window.__api||[]).splice(0))`);
    for (const r of JSON.parse(x || "[]")) {
      if (!r.u || r.s >= 300 || !/orange\.fr$/.test(hote(r.u)) || /analytics|tag|track|log|beacon|consent|didomi|datadome|captcha|iban|pushms|statbi|env\.json/i.test(r.u)) continue;
      const [base, q] = String(r.u).split("?");
      // un même appel peut répondre différemment selon le contrat choisi : on les garde séparés
      const tag = courant && courant !== premier && !String(r.u).includes(courant) ? " #" + courant : "";
      donnees.set(base + (q ? "?" + q.slice(0, 200) : "") + tag, { url: base, q: (q || "").slice(0, 200) + tag, contrat: courant, json: masquer(r.t) });
    }
  } catch (_) {}
}
async function charger(u) {
  await wv.loadURL(u);
  await until(`document.readyState==='complete'`, 25);
  await js(ECOUTE);
  await until(`(document.body&&document.body.innerText||'').length>500`, 12);
  await wait(2500);
}

// Choisir un contrat, comme quand tu le touches dans le carrousel en haut de l'accueil
const b64 = (t) => Data.fromString(String(t)).toBase64String();
async function choisir(c) {
  courant = c.cid;
  await charger("https://" + HOTE + "/accueil?carrousel=" + encodeURIComponent(b64(c.cid)));
  await js(`try{sessionStorage.setItem('carrousel',${JSON.stringify(b64(c.cid))})}catch(e){};true`);
  // et on touche aussi sa vignette, si elle est là
  if (c.nom) {
    await js(`(()=>{const N=${JSON.stringify(c.nom.toLowerCase())};const x=[...document.querySelectorAll('a,button,[role=tab],[role=button],li,[class*=carrousel] *,[class*=carousel] *')]
      .filter(e=>(e.innerText||'').toLowerCase().includes(N)&&(e.innerText||'').length<200).sort((a,b)=>(a.innerText||'').length-(b.innerText||'').length)[0];if(x){x.click();return true;}return false;})()`);
    await wait(3000);
  }
  await recolter();
  const ok = await js(`(document.body.innerText||'').includes(${JSON.stringify(c.cid)}) || [...document.querySelectorAll('a[href]')].some(a=>a.href.includes(${JSON.stringify(c.cid)}))`);
  debug.push({ step: "choix-" + c.cid, ok, url: (await path()).slice(0, 140) });
}

// Récupère un fichier (url ou blob) en base64 dans window.__p
const LIRE = (expr, pdf) => `(function(){window.__p=null;const c=${expr};(async()=>{try{let b,st=200;
  const h=${pdf ? "Object.assign({'X-Orange-Origin-Id':'ECQ','X-Orange-Caller-Id':'ECQ'},window.__hdr||{},{'Accept':'application/pdf','Content-Type':'application/pdf','X-Orange-Request-Id':String(Date.now())+Math.random().toString(16).slice(2)})" : "{}"};
  if(c&&c.b){b=c.b;}else{const r=await fetch(c.u,{credentials:'include',headers:h});st=r.status;b=await r.blob();}
  if(b.size>12e6){window.__p=JSON.stringify({err:'trop gros'});return;}
  const fr=new FileReader();fr.onload=()=>{window.__p=JSON.stringify({s:st,ct:b.type,n:(c&&c.n)||'',d:String(fr.result).split(',')[1]||''});};
  fr.onerror=()=>{window.__p=JSON.stringify({err:'lecture'});};fr.readAsDataURL(b);}catch(e){window.__p=JSON.stringify({err:String(e)});}})();return true;})()`;
async function attendreP(secs = 30) {
  for (let k = 0; k < secs * 4; k++) { const p = await js(`window.__p||''`); if (p) return JSON.parse(p); await wait(250); }
  return { err: "délai" };
}

let pdfsEnvoyes = 0;
const pages = [];
const pdfConnus = new Set(), docs = [];
async function rangerPdf(res, titre, source) {
  if (!res || res.err || !res.d) { if (res && res.err) debug.push({ step: "pdf-" + slug(titre).slice(0, 40), erreur: res.err }); return false; }
  if (!res.d.startsWith("JVBER")) return false; // pas un PDF
  const data = Data.fromBase64String(res.d);
  const cle = slug((res.n || titre || "document").replace(/\.pdf$/i, "")) + "_" + res.d.length + ".pdf";
  if (pdfConnus.has(cle)) return true;
  const up = new Request(`${SB}/storage/v1/object/papiers/orange/${cle}`);
  up.method = "POST"; up.headers = { apikey: sbKey, "Content-Type": "application/pdf", "x-upsert": "true" }; up.body = data;
  await up.loadString();
  if (up.response.statusCode >= 300) { debug.push({ step: "upload-" + cle.slice(0, 50), status: up.response.statusCode }); return false; }
  pdfConnus.add(cle); pdfsEnvoyes++;
  docs.push({ titre: masquer(titre).slice(0, 160), fichier: res.n || "", path: "orange/" + cle, source: String(source).split("?")[0].slice(0, 200) });
  return true;
}

// ---------- le grand tour ----------
async function run() {
  const id = await secret(KEYS.id, "Orange", "Ton identifiant Orange (e-mail ou n° de mobile)", false);
  const pw = await secret(KEYS.pw, "Orange", "Ton mot de passe Orange", true);
  sbKey = await secret(KEYS.sb, "Supabase", "Colle ta clé secrète Supabase (sb_secret_…)", true);
  await login(id, pw);

  // factures déjà rangées, par contrat et par date
  const dejaFact = new Map();
  try { for (const r of JSON.parse((await sb(`/rest/v1/jarvis_items?source=eq.orange&kind=eq.facture&select=date,data`)).body)) if (r.data && r.data.path) dejaFact.set(`${r.data.contrat}|${r.date}`, r.data.path); } catch (_) {}
  // PDF déjà rangés (pour ne pas les renvoyer)
  const ex = await sb(`/rest/v1/jarvis_items?source=eq.orange&kind=eq.document&select=data`);
  try { for (const r of JSON.parse(ex.body)) if (r.data && r.data.path) pdfConnus.add(r.data.path.replace(/^orange\//, "")); } catch (_) {}

  const vus = new Set(), liensPdf = new Map(), clicsFaits = new Set();
  let file = [];
  const norm = (u) => u.split("#")[0].replace(/\/$/, "");
  let clics = 0;

  // la liste de tous tes contrats
  await charger(START); await wait(2000); await recolter();
  let contrats = [];
  for (const [cle, d] of donnees) {
    if (!/portfoliomanager\/portfolio/.test(cle)) continue;
    try { contrats = (JSON.parse(d.json).contracts || []).filter((c) => c.cid).map((c) => ({ cid: String(c.cid), nom: c.offerName || "", etat: c.telco && c.telco.state,
      lignes: (c.usages || []).filter((u) => u.usageCode).map((u) => ({ code: String(u.usageCode), num: u.usageLine || "", type: u.displayName || u.service || "" })) })); } catch (_) {}
    if (contrats.length) break;
  }
  if (!contrats.length) {
    const ids = JSON.parse(await js(`JSON.stringify([...new Set([...document.querySelectorAll('a[href]')].map(a=>(a.href.match(/\\/(\\d{8,12})(?:\\/|$|\\?)/)||[])[1]).filter(Boolean))])`) || "[]");
    contrats = ids.map((cid) => ({ cid, nom: "" }));
  }
  debug.push({ step: "contrats", contrats });
  premier = contrats.length ? contrats[0].cid : "";

  // ---------- les codes RIO (pour changer d'opérateur en gardant son numéro) ----------
  const rios = [];
  for (const c of contrats) {
    for (const l of (c.lignes || [])) {
      try {
        await choisir(c);
        await charger(`https://${HOTE}/equipements/${c.cid}/${l.code}/obtenir-rio`);
        let t = await js(`(document.body.innerText||'')`);
        let m = String(t).match(new RegExp("\\b(\\d{2}\\s?[EP]\\s?[A-Z0-9]{3}\\s?[A-Z0-9]{3}\\s?[A-Z0-9]{3})\\b"));
        if (!m) {
          // parfois il faut toucher « Afficher / Obtenir mon RIO » (ça ne change rien au contrat)
          await js(`(()=>{const b=[...document.querySelectorAll('button,a[role=button]')].find(x=>/(afficher|obtenir|voir).*rio|rio.*(afficher|obtenir|voir)/i.test(x.innerText||'')&&!/envoy|sms|r[ée]sili/i.test(x.innerText||''));if(b)b.click();return true;})()`);
          await wait(3000); await recolter();
          t = await js(`(document.body.innerText||'')`);
          m = String(t).match(new RegExp("\\b(\\d{2}\\s?[EP]\\s?[A-Z0-9]{3}\\s?[A-Z0-9]{3}\\s?[A-Z0-9]{3})\\b"));
        }
        const quoi = (/^31/.test(l.code) ? "mobile" : /^54/.test(l.code) ? "box / fixe" : l.type || "ligne") + (l.num ? " " + l.num : "");
        if (m) rios.push({ contrat: c.cid, ligne: quoi, rio: m[1].replace(/\s/g, "") });
        else debug.push({ step: "rio-" + c.cid + "-" + l.code, erreur: "RIO pas trouvé", debut: String(t).slice(0, 400) });
        pages.push({ url: `https://${HOTE}/equipements/${c.cid}/${l.code}/obtenir-rio`, contrat: c.cid, titre: "Code RIO " + quoi, texte: masquer(String(t).slice(0, 4000)) });
      } catch (e) { debug.push({ step: "rio-" + c.cid + "-" + l.code, erreur: String(e && e.message || e) }); }
    }
  }
  // rangés tout de suite dans Jarvis (bâtiment Abonnements)
  if (rios.length) {
    const notes = rios.map((r) => ({ source: "jarvis", kind: "note", label: "orange:code-rio-" + r.ligne.replace(/[^\w]+/g, "-").toLowerCase().slice(0, 30), date: null, amount: null,
      data: { lieu: "orange", titre: "Code RIO " + r.ligne, texte: r.rio, contrat: r.contrat, ajoute_le: new Date().toISOString() } }));
    await sb(`/rest/v1/jarvis_items?on_conflict=source,kind,label,date_key`, "POST", JSON.stringify(notes),
      { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" });
  }

  for (const c of contrats) {
  await choisir(c);
  file = [await path(), ...["/facture-paiement/", "/offre-options/", "/equipements/", "/conso/"].map((r) => "https://" + HOTE + r + c.cid),
    "https://" + HOTE + "/equipements/" + c.cid + "/tv", "https://" + HOTE + "/conso/" + c.cid + "/equipement/equipement-principal"];
  vus.delete(norm(file[0]));
  const limite = pages.length + Math.ceil(MAX_PAGES / contrats.length);
  while (file.length && pages.length < limite) {
    const u = file.shift(), k = norm(u); if (vus.has(k)) continue; vus.add(k);
    try {
      await charger(u);
      if (!(await js(`location.host===${JSON.stringify(HOTE)}`))) { debug.push({ step: "hors-espace", url: u.slice(0, 120) }); continue; }
      const ici = await path(); vus.add(norm(ici));
      // déplier ce qui est replié (« voir plus », « afficher tout », historique…)
      for (let i = 0; i < 6; i++) {
        const more = await js(`(()=>{const b=[...document.querySelectorAll('button,a[role=button]')].find(x=>/^(voir|afficher|charger) (plus|tout|toutes|tous|l.historique|le d[ée]tail)/i.test((x.innerText||'').trim())&&!x.dataset.jv);if(!b)return false;b.dataset.jv=1;b.click();return true;})()`);
        if (!more) break; await wait(1800);
      }
      const info = JSON.parse(await js(`JSON.stringify({url:location.href,titre:document.title,
        texte:((document.querySelector('main')||document.body).innerText||'').slice(0,40000),
        liens:[...document.querySelectorAll('a[href]')].map(a=>[a.href,((a.innerText||a.getAttribute('aria-label')||'').trim()).slice(0,100)]),
        clic:[...document.querySelectorAll('a,button,[role=link],[role=button],[onclick],[tabindex="0"],[class*=tile],[class*=Tile],[class*=card],[class*=Card]')]
          .map(x=>((x.innerText||x.getAttribute('aria-label')||'').trim().split('\\n')[0]).slice(0,80)).filter(t=>t.length>2)})`));
      const pu = info.url.split("?")[0];
      pages.push({ url: /\/accueil$|\.fr\/?$/.test(pu) && courant !== premier ? pu + "#" + courant : pu, contrat: courant, titre: info.titre, texte: masquer(info.texte) });
      if (pages.length === 1) debug.push({ step: "elements-accueil", liens: info.liens.slice(0, 120), clic: [...new Set(info.clic)].slice(0, 150) });
      for (const [h, t] of info.liens) {
        if (!/^https?:/i.test(h)) continue;
        if (/\.pdf($|\?)|telecharg|download/i.test(h)) { liensPdf.set(h, t || info.titre); continue; }
        if (hote(h) === HOTE && !EVITER.test(h + " " + t)) file.push(sansAncre(h));
      }
      await recolter();
      // explorer les tuiles et boutons qui mènent ailleurs sans être de vrais liens
      const cibles = [...new Set(info.clic)].filter((t) => !EVITER.test(t) && !NE_PAS_CLIQUER.test(t) && !clicsFaits.has(t)).slice(0, 6);
      for (const t of cibles) {
        if (clics >= MAX_CLICS) break;
        clicsFaits.add(t); clics++;
        const fait = await js(`(()=>{const T=${JSON.stringify(t)};const x=[...document.querySelectorAll('a,button,[role=link],[role=button],[onclick],[tabindex="0"],[class*=tile],[class*=Tile],[class*=card],[class*=Card]')]
          .find(e=>((e.innerText||e.getAttribute('aria-label')||'').trim().split('\\n')[0]).slice(0,80)===T);if(!x)return false;x.click();return true;})()`);
        if (!fait) continue;
        await wait(2600); await recolter();
        const la = await path();
        if (norm(la) !== norm(ici)) {
          if (hote(la) === HOTE && !EVITER.test(la)) file.push(sansAncre(la));
          await js(`history.back();true`); await wait(2200);
          if (norm(await path()) !== norm(ici)) await charger(ici);
        } else {
          await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true`);
        }
      }

      // boutons « Télécharger » / « PDF » (factures, contrats…)
      const nb = await js(`[...document.querySelectorAll('button,a')].filter(x=>/t[ée]l[ée]charger|pdf|voir la facture|duplicata/i.test((x.innerText||'')+' '+(x.getAttribute('aria-label')||''))).length`);
      if (nb && pdfsEnvoyes < MAX_PDF) {
        for (let i = 0; i < Math.min(nb, 24) && pdfsEnvoyes < MAX_PDF; i++) {
          await js(PIEGE);
          const titre = await js(`(()=>{window.__cap=[];const bs=[...document.querySelectorAll('button,a')].filter(x=>/t[ée]l[ée]charger|pdf|voir la facture|duplicata/i.test((x.innerText||'')+' '+(x.getAttribute('aria-label')||'')));
            const b=bs[${i}];if(!b)return '';const z=b.closest('li,tr,article,section,[class*=card],[class*=Card],[class*=item],[class*=Item]');
            const t=((z&&z.innerText)||b.getAttribute('aria-label')||b.innerText||'').replace(/\\s+/g,' ').trim().slice(0,160);b.click();return t||'Document Orange';})()`);
          if (!titre) break;
          let pris = false;
          for (let k = 0; k < 24 && !pris; k++) { await wait(250); pris = await js(`!!(window.__cap&&window.__cap.length)`); }
          if (pris) { await js(LIRE(`window.__cap[window.__cap.length-1]`)); await rangerPdf(await attendreP(), titre, info.url); }
          await recolter();
          if (norm(await path()) !== norm(ici)) await charger(ici);
        }
      }
    } catch (e) { debug.push({ step: "page-" + slug(u).slice(-50), erreur: String(e && e.message || e) }); }
  }
  }
  await recolter();
  // liens de PDF cachés dans les données
  for (const d of donnees.values())
    for (const m of d.json.matchAll(/https?:\\?\/\\?\/[^"'\s]+?(?:\.pdf|download|telecharg)[^"'\s]*/gi)) liensPdf.set(m[0].replace(/\\\//g, "/"), "Document Orange");

  // ---------- toutes les factures en PDF (12 derniers mois + anciennes) ----------
  const factures = [];
  await charger(START);
  await js(`(()=>{const a=[...document.querySelectorAll('a')].find(x=>/facture-paiement/.test(x.href));if(a)a.click();return true;})()`);
  await wait(4000); await recolter();
  // la page factures de chaque contrat (après l'avoir choisi), pour avoir sa liste de factures
  for (const c of contrats) {
    try {
      await choisir(c);
      await charger("https://" + HOTE + "/facture-paiement/" + c.cid); await wait(1500);
      for (let i = 0; i < 3; i++) {
        const more = await js(`(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>/historique|anciennes factures|voir (plus|toutes)/i.test((x.innerText||'').trim())&&!x.dataset.jf&&!/t[ée]l[ée]charger|pdf/i.test(x.innerText||''));if(!b)return false;b.dataset.jf=1;b.click();return true;})()`);
        if (!more) break; await wait(2500);
      }
      await recolter();
    } catch (e) { debug.push({ step: "factures-" + c.cid, erreur: String(e && e.message || e) }); }
  }
  debug.push({ step: "entetes", noms: JSON.parse(await js(`JSON.stringify(Object.keys(window.__hdr||{}))`) || "[]") });
  const lireJson = async (u) => {
    await js(`(function(){window.__r=null;fetch(${JSON.stringify(u)},{credentials:'include',headers:{accept:'application/json'}})
      .then(r=>r.text().then(t=>{window.__r=JSON.stringify({s:r.status,t:t});})).catch(e=>{window.__r=JSON.stringify({err:String(e)});});return true;})()`);
    for (let k = 0; k < 80; k++) { await wait(250); const x = await js(`window.__r||''`); if (x) { const r = JSON.parse(x); if (r.s < 300) { try { return JSON.parse(r.t); } catch (_) {} } return null; } }
    return null;
  };
  const echecs = [];
  const prendrePdf = async (urls, nom, titre) => {
    for (const u of urls) {
      await js(LIRE(`{u:${JSON.stringify(u)}}`, true));
      const res = await attendreP(40);
      if (!(res && res.d && res.d.startsWith("JVBER")) && echecs.length < 6) echecs.push({ u: u.split("?")[0], s: res && res.s, err: res && res.err, debut: res && res.d ? res.d.slice(0, 40) : "" });
      if (res && res.d && res.d.startsWith("JVBER")) { res.n = nom; return (await rangerPdf(res, titre, u)) ? "orange/" + slug(nom.replace(/\.pdf$/i, "")) + "_" + res.d.length + ".pdf" : null; }
    }
    return null;
  };
  for (const [cle, d] of donnees) {
    if (!/billsAndPaymentInfos\/users\/current\/contracts\/(\d+)/.test(cle)) continue;
    const cid = cle.match(/contracts\/(\d+)/)[1];
    let j; try { j = JSON.parse(d.json); } catch (_) { continue; }
    const liste = ((j.billsHistory || {}).billList || []);
    for (const b of liste) {
      if (pdfsEnvoyes >= MAX_PDF) break;
      const euros = (Number(b.amount || 0) / 100).toFixed(2).replace(".", ",");
      const nom = `Facture Orange ${cid} ${b.date}.pdf`, titre = `Facture Orange du ${b.date.split("-").reverse().join("/")} · ${euros} €`;
      let chemin = dejaFact.get(`${cid}|${b.date}`);
      chemin = chemin ? chemin : (b.hrefPdf ? await prendrePdf([
        `https://${HOTE}/ecd_wp/facture/v1.0/pdf${b.hrefPdf}`,
        `https://${HOTE}/ecd_wp/facture/v1.0/pdf/users/current/contracts/${cid}${b.hrefPdf}`,
        `https://${HOTE}/ecd_wp/facture/v1.0/pdf/contracts/${cid}${b.hrefPdf}`], nom, titre) : null);
      factures.push({ id: b.id, contrat: cid, date: b.date, montant: Number(b.amount || 0) / 100, reste: Number(b.unpaidAmount || 0) / 100, path: chemin });
    }
  }
  // anciennes factures : la liste que la page « historique » a reçue
  for (const [cle, d] of donnees) {
    if (!/historicBills/.test(cle)) continue;
    const cid = (cle.match(/cid=(\d+)/) || [])[1] || d.contrat || (factures[0] && factures[0].contrat) || "";
    let h; try { h = JSON.parse(d.json); } catch (_) { continue; }
    for (const ob of (h.oldBills || []).slice(0, 60)) {
      if (pdfsEnvoyes >= MAX_PDF) break;
      const dt = ob.date;
      if (factures.some((f) => f.date === dt && f.contrat === cid)) continue;
      const deja0 = dejaFact.get(`${cid}|${dt}`), deja = deja0 ? deja0.replace(/^orange\//, "") : null;
      const q = `?entityName=${ob.entityName}&partitionKeyName=${ob.partitionKeyName}&partitionKeyValue=${ob.partitionKeyValue}&tecId=${ob.tecId}&cid=${cid}`;
      const p = deja ? "orange/" + deja : await prendrePdf([`https://${HOTE}/ecd_wp/facture/historicPDF${q}`], `Facture Orange ${cid} ${dt}.pdf`,
        `Facture Orange du ${dt.split("-").reverse().join("/")} · ${(Number(ob.amount || 0) / 100).toFixed(2).replace(".", ",")} €`);
      factures.push({ contrat: cid, date: dt, montant: Number(ob.amount || 0) / 100, ancienne: true, path: p });
    }
  }
  // PDF reçus directement par la page (boutons « Voir la facture »)
  try {
    for (const x of JSON.parse(await js(`JSON.stringify((window.__pdfs||[]).splice(0))`) || "[]")) {
      const dt = (x.u.match(/billDate=(\d{4}-\d{2}-\d{2})/) || [])[1];
      if (dt && ![...dejaFact.keys()].some((k) => k.endsWith("|" + dt))) await rangerPdf({ d: x.d, n: `Facture Orange ${dt}.pdf` }, `Facture Orange du ${dt.split("-").reverse().join("/")}`, x.u);
    }
  } catch (_) {}
  if (echecs.length) debug.push({ step: "pdf-echecs", echecs });
  if (factures.length && !factures.some((f) => f.path)) debug.push({ step: "factures-pdf", erreur: "aucun PDF de facture téléchargé" });

  // PDF trouvés en lien direct
  for (const [h, t] of liensPdf) {
    if (pdfsEnvoyes >= MAX_PDF) break;
    try { await js(LIRE(`{u:${JSON.stringify(h)}}`)); await rangerPdf(await attendreP(), t, h); } catch (_) {}
  }

  // ---------- envoi dans Supabase ----------
  const items = [
    ...pages.map((p) => ({ source: "orange", kind: "page", label: p.url.replace("https://" + HOTE, "").slice(0, 200) || "/", date: null, amount: null, data: p })),
    ...[...donnees.values()].map((d) => ({ source: "orange", kind: "api", label: (d.url.replace(/^https?:\/\//, "") + (d.q ? "?" + d.q : "")).slice(0, 250), date: null, amount: null, data: d })),
    ...factures.filter((f) => f.date && f.date !== "ancienne").map((f) => ({ source: "orange", kind: "facture", label: "Facture " + f.contrat + " " + f.date, date: f.date, amount: f.montant ?? null, data: f })),
    ...docs.map((d) => ({ source: "orange", kind: "document", label: d.path, date: null, amount: null, data: d })),
    ...debug.map((d) => ({ source: "orange", kind: "debug", label: String(d.step).slice(0, 120), date: null, amount: null, data: d })),
  ];
  const uniq = new Map(); for (const it of items) uniq.set(`${it.kind}|${it.label}`, it);
  const tout = [...uniq.values()];
  for (let i = 0; i < tout.length; i += 15) {
    const res = await sb(`/rest/v1/jarvis_items?on_conflict=source,kind,label,date_key`, "POST", JSON.stringify(tout.slice(i, i + 15)),
      { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" });
    if (res.status >= 300) throw new Error(`Supabase a refusé (${res.status}) ${res.body.slice(0, 120)}`);
  }
  return `${pages.length} pages lues, ${donnees.size} blocs de données, ${factures.length} factures, ${pdfsEnvoyes} PDF rangés, ${rios.length} codes RIO.`;
}

try {
  const msg = await run();
  const n = new Notification(); n.title = "Jarvis · Orange"; n.body = "✅ " + msg; await n.schedule();
  Script.setShortcutOutput(msg);
} catch (e) {
  debug.push({ step: "erreur", message: String(e && e.message || e), ligne: e && e.line });
  try { if (sbKey) await sb(`/rest/v1/jarvis_items?on_conflict=source,kind,label,date_key`, "POST",
    JSON.stringify(debug.map((d) => ({ source: "orange", kind: "debug", label: String(d.step).slice(0, 120), date: null, amount: null, data: d }))),
    { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }); } catch (_) {}
  const n = new Notification(); n.title = "Jarvis · Orange"; n.body = "❌ " + e.message; await n.schedule();
  Script.setShortcutOutput("Erreur : " + e.message);
}
Script.complete();

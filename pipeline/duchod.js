/* Důchodová kalkulačka – invalidní (I., II., III. stupeň), vdovský/vdovecký a sirotčí důchod z údajů IOLDP.
   Samostatný modul: DuchodCalc.mount(kontejner, {store, toast, ls, clients, ensure}) · čistá matematika v DuchodCalc.math
   (testy: tests/duchod.run.mjs).
   Podklad: zákon č. 155/1995 Sb., o důchodovém pojištění (§ 15–16 redukce, § 33–34 výpočet, § 39–41 invalidní,
   § 49–51 vdovský, § 52–53 sirotčí) a parametry roku nároku z nařízení vlády:
   2026 = NV č. 365/2025 Sb., 2027 = NV č. 177/2026 Sb. (od 1. 1. 2027). */
(()=>{
"use strict";
const BASE=(()=>{try{return (document.currentScript&&document.currentScript.src||location.href).replace(/[^/]*$/,"")}catch(e){return ""}})();

/* ================= parametry podle roku vzniku nároku ================= */
const PAR={
  2026:{zv:4900,rh1:21546,rh2:195868,min:{inv1:1634,inv2:2450,inv3:4900,sta:4900,wid:2450,orp:1960},src:"NV č. 365/2025 Sb."},
  2027:{zv:5170,rh1:22732,rh2:206652,min:{inv1:1724,inv2:2585,inv3:5170,sta:5170,wid:2585,orp:2068},src:"NV č. 177/2026 Sb."}
};
const FIRST=2026,LAST=2027;
/* sazba procentní výměry v promile výpočtového základu za každý celý rok doby pojištění (0,5 % · 0,75 % · 1,5 %) */
const PM={inv1:5,inv2:7.5,inv3:15};

/* ================= matematika ================= */
const ceil=x=>Math.ceil(x-1e-9);
const DAY=864e5;
function paramsFor(evt){
  const y=+String(evt||"").slice(0,4)||new Date().getFullYear(),use=Math.min(Math.max(y,FIRST),LAST);
  return{year:y,use,p:PAR[use],warn:y!==use};
}
/* redukce osobního vyměřovacího základu: 100 % do 1. RH, 26 % mezi 1. a 2. RH, nad 2. RH nic; nahoru na celé Kč */
function reduce(ovz,p){
  if(!(ovz>0))return 0;
  const a=Math.min(ovz,p.rh1),b=Math.max(0,Math.min(ovz,p.rh2)-p.rh1);
  return ceil(a+0.26*b);
}
/* doba pojištění ve dnech; náhradní doby se počítají jen z 80 % (zaokrouhleno nahoru na celé dny) */
function doba(i){
  const tot=Math.max(0,(+i.tY||0)*365+(+i.tD||0)),sub=Math.min(tot,Math.max(0,(+i.nY||0)*365+(+i.nD||0)));
  return{tot,sub,eff:tot-sub+ceil(sub*0.8)};
}
/* dopočtená doba: ode dne vzniku nároku do dosažení důchodového věku (volitelně zkrácená v %) */
function dopocet(evt,ret,pct){
  const a=Date.parse(evt),b=Date.parse(ret);
  if(!isFinite(a)||!isFinite(b)||b<=a)return 0;
  const k=isFinite(+pct)?Math.min(100,Math.max(0,+pct)):100;
  return ceil((b-a)/DAY*(k/100));
}
function calc(inp){
  const pr=paramsFor(inp.evt),p=pr.p,ovz=+inp.ovz||0,vzOwn=+inp.vz>0,vz=vzOwn?ceil(+inp.vz):reduce(ovz,p),d=doba(inp),dop=dopocet(inp.evt,inp.ret,inp.dopPct);
  const days=d.eff+dop,years=Math.floor(days/365);
  const ok=(ovz>0||vzOwn)&&days>0;
  const inv=(k)=>{const pv0=ceil(vz*PM[k]*years/1000),min=p.min[k],pv=Math.max(pv0,min);return{pv0,pv,min,minUsed:pv0<min,zv:p.zv,total:p.zv+pv}};
  const i1=inv("inv1"),i2=inv("inv2"),i3=inv("inv3");
  /* starobní důchod: vlastní odhad = 1,5 % výpočtového základu za každý celý rok doby pojištění až do důchodového věku
     (stejná doba jako u invalidního III. stupně); když je zadaný odhad z IOLDP, ten je pro zobrazení směrodatný */
  const sy=Math.floor(days/365),s0=ceil(vz*15*sy/1000),sp=Math.max(s0,p.min.sta),own0={pv0:s0,pv:sp,min:p.min.sta,minUsed:s0<p.min.sta,zv:p.zv,total:p.zv+sp,years:sy};
  const sIo=+inp.staIoldp>0?Math.round(+inp.staIoldp):null;
  const sta=sIo!=null?{...own0,total:sIo,pv:sIo-p.zv,minUsed:false,fromIoldp:true,own:own0.total}:{...own0,fromIoldp:false,own:own0.total};
  /* důchod zemřelého: když ho klient už pobírá, zadá se jeho procentní výměra z IOLDP; jinak invalidní III. stupně, na který by měl nárok */
  const own=+inp.pvDead>0?ceil(+inp.pvDead):null,base=own!=null?own:i3.pv;
  const wpv=Math.max(ceil(base*0.5),p.min.wid),opv=Math.max(ceil(base*0.4),p.min.orp);
  const kids=Math.max(1,Math.floor(+inp.kids||1));
  const wid={pv:wpv,min:p.min.wid,minUsed:ceil(base*0.5)<p.min.wid,zv:p.zv,total:p.zv+wpv};
  const orp={pv:opv,min:p.min.orp,minUsed:ceil(base*0.4)<p.min.orp,zv:p.zv,total:p.zv+opv,kids,family:(p.zv+opv)*kids};
  return{ok,pr,p,ovz,vz,vzOwn,d,dop,days,years,sta,i1,i2,i3,wid,orp,base,ownBase:own!=null};
}

/* ================= import IOLDP (text z PDF nebo .txt) ================= */
/* Hledá v textu IOLDP osobní vyměřovací základ, dobu pojištění (celkem a náhradní), datum důchodového věku a datum vystavení.
   Co se nenajde, vrátí v `missing` – ručně se doplní ve formuláři. */
function parseIoldp(raw){
  const a=String(raw||"").replace(/[\u00a0\u202f]/g," ").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").toLowerCase();
  const NUM="(\\d{1,3}(?: \\d{3})+|\\d+)(?:[.,]\\d+)?";
  const YR="(?:roku|roky|rok|let|r\\.?)",DY="(?:dnu|dny|dni|den|d\\.?)";
  const dur=(re)=>{const m=re.exec(a);return m?{y:+m[1],d:+m[2]}:null};
  const date=(re)=>{const m=re.exec(a);if(!m)return null;const d=+m[1],mo=+m[2],y=+m[3];return y>1900&&mo>=1&&mo<=12&&d>=1&&d<=31?y+"-"+String(mo).padStart(2,"0")+"-"+String(d).padStart(2,"0"):null};
  const f={},found=[],missing=[];
  const ovz=new RegExp("osobni vymerovaci zaklad[^]{0,120}?"+NUM+"\\s*kc").exec(a)||new RegExp("osobni vymerovaci zaklad[^0-9]{0,80}?"+NUM).exec(a);
  if(ovz){f.ovz=+ovz[1].replace(/ /g,"");found.push("osobní vyměřovací základ")}else missing.push("osobní vyměřovací základ");
  const dd=(label)=>new RegExp(label+"[^0-9]{0,60}?(\\d+)\\s*"+YR+"\\s*(?:a\\s*)?(\\d+)\\s*"+DY);
  const loose=(label)=>dur(new RegExp(label+"[^0-9]{0,60}?(\\d+)\\D{1,25}?(\\d+)"));
  const tot=dur(dd("celkovy pocet ziskanych roku a dnu pojisteni"))||loose("celkovy pocet ziskanych roku a dnu pojisteni")||dur(dd("celkovy pocet ziskanych roku a dnu"))||loose("celkovy pocet ziskanych roku a dnu")||dur(dd("doba pojisteni celkem"))||dur(dd("celkem doba pojisteni"))||dur(dd("doba pojisteni"));
  if(tot){f.tY=tot.y;f.tD=tot.d;found.push("doba pojištění")}else missing.push("doba pojištění");
  const sub=dur(dd("nahradni doby?(?: pojisteni)?"));
  if(sub){f.nY=sub.y;f.nD=sub.d;found.push("náhradní doby")}
  const money=(label)=>{const m=new RegExp(label+"[^0-9]{0,40}?"+NUM+"\\s*kc").exec(a);return m?+m[1].replace(/ /g,""):null};
  const vz=money("vypoctovy zaklad");
  if(vz){f.vz=vz;found.push("výpočtový základ")}
  const sta=money("odhad vyse starobniho duchodu")||money("odhadovana vyse duchodu");
  if(sta){f.staIoldp=sta;found.push("odhad starobního důchodu")}
  const ret=date(/duchodov\w* vek[^.]{0,120}?(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})/);
  if(ret){f.ret=ret;found.push("důchodový věk")}else missing.push("datum důchodového věku");
  const dt=date(/(?:ke dni|ze dne|vystaven\w*(?: dne)?|datum vystaveni|stav k)[^0-9]{0,20}(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})/)||date(/ziskany prostrednictvim eportalu[^(]{0,80}\(\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})/);
  if(dt){f.ioldp=dt;found.push("datum IOLDP")}
  return{fields:f,found,missing};
}
async function pdfText(file){
  const lib=await import(BASE+"vendor/pdf.min.mjs");
  lib.GlobalWorkerOptions.workerSrc=BASE+"vendor/pdf.worker.min.mjs";
  const doc=await lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,enableXfa:false}).promise;
  let out="";
  for(let i=1;i<=doc.numPages;i++){
    const c=await(await doc.getPage(i)).getTextContent();let y=null;
    for(const it of c.items){const yy=it.transform?Math.round(it.transform[5]):0;if(y!==null&&Math.abs(yy-y)>3)out+="\n";else if(out&&!/\s$/.test(out))out+=" ";out+=it.str;y=yy}
    out+="\n";
  }
  return out;
}

/* ================= formát ================= */
const nf0=new Intl.NumberFormat("cs-CZ",{maximumFractionDigits:0});
const kc=n=>isFinite(n)?nf0.format(Math.round(n))+" Kč":"–";
const num=n=>isFinite(n)?nf0.format(Math.round(n)):"";
const parseNum=s=>{const t=String(s??"").replace(/[\s  ]/g,"").replace(/Kč/gi,"").replace(",",".");return t===""?NaN:+t};
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmtDate=s=>{const m=/^(\d{4})-(\d\d)-(\d\d)/.exec(s||"");return m?(+m[3])+". "+(+m[2])+". "+m[1]:""};
const ryTxt=d=>{const y=Math.floor(d/365),r=d-y*365;return y+" r. "+r+" d."};
const todayStr=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};

/* ================= vzhled ================= */
const CSS=`
.dk{font-family:var(--font,-apple-system,system-ui,sans-serif);color:var(--label);background:var(--bg2,#fff);border-radius:16px;box-shadow:var(--card-shadow);overflow:hidden;margin-bottom:22px;padding:16px 18px 20px}
.dk h3{margin:0 0 10px;font-size:17px;font-weight:700}
.dk .dk-top{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:14px}
.dk .dk-top .dk-f{flex:1 1 240px}
.dk .dk-acts{display:flex;gap:8px;flex-wrap:wrap}
.dk .dk-btn{height:40px;padding:0 14px;border-radius:10px;border:1.5px solid var(--sep);background:var(--bg2,#fff);color:var(--label);font:inherit;font-size:14.5px;font-weight:500;cursor:pointer;white-space:nowrap}
.dk .dk-btn.pri{background:var(--orange);border-color:var(--orange);color:#fff}
.dk .dk-btn.danger{color:var(--red);border-color:var(--red)}
.dk .dk-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin-bottom:6px}
.dk .dk-f label{display:block;font-size:13px;color:var(--label2);margin-bottom:5px;line-height:1.25}
.dk .dk-f input,.dk .dk-f select{width:100%;box-sizing:border-box;height:44px;border:1px solid var(--sep);border-radius:8px;background:var(--bg2,#fff);color:var(--label);font:inherit;font-size:16px;padding:0 12px;appearance:auto}
.dk .dk-f input:focus,.dk .dk-f select:focus{outline:2px solid var(--tint);outline-offset:-1px}
.dk .dk-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.dk .dk-hint{font-size:12.5px;color:var(--label2);line-height:1.4;margin:4px 0 0}
.dk .dk-sec{margin:20px 0 10px;font-size:13px;font-weight:600;letter-spacing:.02em;color:var(--label2);text-transform:uppercase}
.dk .dk-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:10px;margin:6px 0 4px}
.dk .dk-tile{background:var(--bg,#f2f2f7);border-radius:12px;padding:12px 14px;min-width:0}
.dk .dk-tile .k{font-size:13px;color:var(--label2);margin-bottom:4px;line-height:1.25}
.dk .dk-tile .v{font-size:21px;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}
.dk .dk-tile .s{font-size:12px;color:var(--label2);margin-top:3px;line-height:1.3}
.dk .dk-tile.big{outline:2px solid var(--orange-soft,rgba(255,149,0,.2))}
.dk .dk-tile .min{display:inline-block;margin-left:4px;color:var(--orange);font-weight:600}
.dk table{border-collapse:collapse;width:100%;font-size:14px}
.dk td{padding:7px 4px;border-bottom:1px solid var(--sep)}
.dk td:last-child{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
.dk .dk-warn{background:var(--orange-soft);border-radius:10px;padding:9px 12px;font-size:13.5px;line-height:1.4;margin:10px 0}
.dk .dk-note{font-size:12.5px;color:var(--label2);line-height:1.5;margin:14px 0 0}
.dk .dk-note li{margin:3px 0}
.dk .dk-saved{display:grid;gap:8px}
.dk .dk-row{display:flex;align-items:center;gap:10px;background:var(--bg,#f2f2f7);border-radius:10px;padding:10px 12px}
.dk .dk-row .main{flex:1;min-width:0}
.dk .dk-row .main b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dk .dk-row .main span{font-size:12.5px;color:var(--label2)}
`;

function mount(root,opts={}){
  if(!document.getElementById("dkCss")){const st=document.createElement("style");st.id="dkCss";st.textContent=CSS;document.head.append(st)}
  const store=opts.store||null,toast=opts.toast||(m=>console.log(m));
  const clientsFn=opts.clients||(()=>[]),ensure=opts.ensure||null;
  const LS="dk_draft_v1";
  const ls=opts.ls||{get:k=>{try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
  const fresh=()=>({cid:"",ioldp:"",ovz:"",vz:"",staIoldp:"",tY:"",tD:"",nY:"",nD:"",ret:"",evt:todayStr(),dopPct:100,kids:1,pvDead:""});
  let st={...fresh(),...(ls.get(LS)||{})};
  let saved=[],impMsg="";
  const persist=()=>ls.set(LS,st);
  if(store)store.collection("duchod").onSnapshot(s=>{saved=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));drawSaved()});

  const keyOf=e=>e.rec?e.rec.id:e.id;
  const entries=()=>{try{return clientsFn().slice().sort((a,b)=>(a.name||"").localeCompare(b.name||"","cs"))}catch(e){return[]}};
  const nameOf=id=>{const e=entries().find(x=>keyOf(x)===id);return e?e.name:(saved.find(s=>s.id===id)||{}).name||"klient"};

  const val=k=>st[k]===""||st[k]==null?"":String(st[k]);
  const fld=(k,label,{type="text",ph="",hint="",step}={})=>`<div class="dk-f"><label for="dk_${k}">${esc(label)}</label><input id="dk_${k}" data-k="${k}" type="${type}" ${type==="text"?'inputmode="numeric" autocomplete="off"':""} ${step?`step="${step}"`:""} placeholder="${esc(ph)}" value="${esc(val(k))}">${hint?`<p class="dk-hint">${hint}</p>`:""}</div>`;
  const pair=(k1,k2,label,ph1,ph2)=>`<div class="dk-f"><label>${esc(label)}</label><div class="dk-pair"><input data-k="${k1}" type="text" inputmode="numeric" autocomplete="off" aria-label="${esc(label)} – roky" placeholder="${ph1}" value="${esc(val(k1))}"><input data-k="${k2}" type="text" inputmode="numeric" autocomplete="off" aria-label="${esc(label)} – dny" placeholder="${ph2}" value="${esc(val(k2))}"></div></div>`;

  function clientOpts(){
    const es=entries();
    let h=`<option value="">— bez klienta (jen výpočet) —</option>`;
    es.forEach(e=>{const k=keyOf(e),has=saved.some(s=>s.id===k);h+=`<option value="${esc(k)}"${st.cid===k?" selected":""}>${esc(e.name||"Bez jména")}${has?" ✓":""}</option>`});
    return h;
  }
  function draw(){
    root.innerHTML=`<div class="dk">
      <div class="dk-top">
        <div class="dk-f"><label for="dk_cid">Klient</label><select id="dk_cid" data-a="cid">${clientOpts()}</select></div>
        <div class="dk-acts"><button type="button" class="dk-btn pri" data-a="save">Uložit ke klientovi</button><button type="button" class="dk-btn" data-a="import">Import IOLDP</button><input type="file" id="dkFile" accept=".pdf,application/pdf,.txt,text/plain" hidden><button type="button" class="dk-btn" data-a="pdf">Tisk / PDF</button><button type="button" class="dk-btn" data-a="new">Nová kalkulace</button></div>
      </div>
      <div class="dk-sec">Údaje z IOLDP</div>
      <div id="dkImp">${impMsg}</div>
      <div class="dk-grid">
        ${fld("ovz","Osobní vyměřovací základ (Kč měsíčně)",{ph:"např. 52 300"})}
        ${fld("vz","Výpočtový základ (Kč)",{ph:"z IOLDP",hint:"Pokud je v IOLDP, má přednost – ČSSZ už ho redukovala."})}
        ${fld("staIoldp","Odhad starobního důchodu z IOLDP (Kč)",{ph:"např. 14 300"})}
        ${pair("tY","tD","Doba pojištění celkem","roky","dny")}
        ${pair("nY","nD","z toho náhradní doby","roky","dny")}
        ${fld("ret","Dosažení důchodového věku",{type:"date",hint:"Datum z IOLDP – od něj se počítá dopočtená doba."})}
        ${fld("ioldp","IOLDP ze dne",{type:"date"})}
      </div>
      <p class="dk-hint">Náhradní doby se do výpočtu započítají jen z 80 %. Dny se počítají v 365denních letech, do procentní výměry jdou jen celé roky.</p>
      <div class="dk-sec">Situace</div>
      <div class="dk-grid">
        ${fld("evt","Vznik nároku (invalidita / úmrtí)",{type:"date",hint:"Určuje rok parametrů (2026 / 2027) a délku dopočtené doby."})}
        ${fld("dopPct","Dopočtená doba v % (výchozí 100)",{ph:"100",hint:"Zkrať jen když ČSSZ dopočtenou dobu krátí (§ 41 odst. 5 písm. b)."})}
        ${fld("kids","Počet nezaopatřených dětí (sirotčí)",{ph:"1"})}
        ${fld("pvDead","Procentní výměra důchodu zemřelého (Kč)",{ph:"nechat prázdné",hint:"Vyplň jen když zemřelý už pobíral starobní důchod. Jinak se bere invalidní III. stupně."})}
      </div>
      <div id="dkRes"></div>
      <div id="dkSaved"></div>
    </div>`;
    drawRes();drawSaved();
  }

  function tile(k,r,sub,big){return `<div class="dk-tile${big?" big":""}"><div class="k">${esc(k)}</div><div class="v">${kc(r.total)}</div><div class="s">ZV ${kc(r.zv)} + PV ${kc(r.pv)}${r.minUsed?`<span class="min" title="Procentní výměra by vyšla pod zákonným minimem">min.</span>`:""}${sub?"<br>"+sub:""}</div></div>`}
  function resHTML(R){
    if(!R.ok)return `<div class="dk-sec">Výsledek</div><p class="dk-hint">Vyplň osobní vyměřovací základ (nebo výpočtový základ) a dobu pojištění z IOLDP – částky se spočítají samy.</p>`;
    const w=[];
    if(R.pr.warn)w.push(R.pr.year>LAST?`Pro rok ${R.pr.year} ještě nejsou vyhlášené parametry – počítá se s hodnotami ${R.pr.use}.`:`Parametry pro rok ${R.pr.year} tu nejsou – počítá se s hodnotami ${R.pr.use}.`);
    if(!st.ret)w.push("Chybí datum dosažení důchodového věku – dopočtená doba se nezapočetla, invalidní důchody i odvozené vdovský a sirotčí vyjdou nižší.");
    else if(R.dop===0)w.push("Dopočtená doba vyšla 0 dní (nárok vzniká až po dosažení důchodového věku nebo je doba zkrácená na 0 %).");
    const rows=[
      [`Parametry ${R.pr.use} (${R.p.src})`,`ZV ${kc(R.p.zv)} · RH ${kc(R.p.rh1)} / ${kc(R.p.rh2)}`],
      ["Osobní vyměřovací základ → výpočtový základ",`${R.ovz?kc(R.ovz):"–"} → ${kc(R.vz)}${R.vzOwn?" (z IOLDP)":""}`],
      ["Doba pojištění z IOLDP",ryTxt(R.d.tot)+(R.d.sub?` (z toho náhradní ${ryTxt(R.d.sub)})`:"")],
      ["Započteno (náhradní doby 80 %)",ryTxt(R.d.eff)],
      ["Dopočtená doba",R.dop?ryTxt(R.dop):"0"],
      ["Celé roky pro procentní výměru",`${R.years} ${R.years===1?"rok":R.years>=2&&R.years<=4?"roky":"roků"}`],
      ["Starobní důchod – vlastní odhad do důchodového věku",`${kc(R.sta.own)} (${R.sta.years} let pojištění)`],
      ["Procentní výměra invalidní I. / II. / III. st.",`${kc(R.i1.pv)} / ${kc(R.i2.pv)} / ${kc(R.i3.pv)}`],
      [R.ownBase?"Procentní výměra zemřelého (zadáno)":"Procentní výměra zemřelého (invalidní III. st.)",kc(R.base)]
    ];
    return `<div class="dk-sec">Měsíční výše důchodu · parametry ${R.pr.use}</div>
      ${w.map(x=>`<div class="dk-warn">${esc(x)}</div>`).join("")}
      <div class="dk-tiles">
        ${tile("Starobní důchod",R.sta,R.sta.fromIoldp?`odhad z IOLDP · vlastní přepočet ${kc(R.sta.own)}`:`vlastní odhad do důchodového věku (${R.sta.years} let pojištění)`)}${tile("Invalidní I. stupně",R.i1)}${tile("Invalidní II. stupně",R.i2)}${tile("Invalidní III. stupně",R.i3,"",true)}
        ${tile("Vdovský / vdovecký",R.wid,"50 % procentní výměry zemřelého")}
        ${tile("Sirotčí (na 1 dítě)",R.orp,R.orp.kids>1?`${R.orp.kids} děti celkem ${kc(R.orp.family)}`:"40 % procentní výměry zemřelého")}
      </div>
      <div class="dk-sec">Rozpis výpočtu</div>
      <table>${rows.map(([a,b])=>`<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join("")}</table>
      <ul class="dk-note">
        <li>Důchod = základní výměra (10 % průměrné mzdy) + procentní výměra. Invalidní: 0,5 % / 0,75 % / 1,5 % výpočtového základu za každý celý rok doby pojištění včetně dopočtené doby. Vdovský 50 % a sirotčí 40 % procentní výměry důchodu zemřelého. „min.“ = zákonné minimum procentní výměry.</li>
        <li>Výpočtový základ: 100 % osobního vyměřovacího základu do 1. redukční hranice, 26 % mezi hranicemi, nad 2. hranicí nic.</li>
        <li>Je to orientační výpočet z údajů IOLDP. ČSSZ při přiznání bere rozhodné období do roku před vznikem nároku, takže skutečná částka se může mírně lišit.</li>
        <li>Vdovský a vdovecký důchod se vyplácí 1 rok od úmrtí, déle jen např. při péči o dítě, u invalidity III. stupně nebo když je pozůstalému aspoň o 4 roky méně než důchodový věk (§ 50). Sirotčí náleží každému nezaopatřenému dítěti zvlášť.</li>
        <li>Nárok na invalidní důchod předpokládá potřebnou dobu pojištění (§ 40). Zvláštní případy (invalidita před 18. rokem, § 42) kalkulačka nepočítá.</li>
      </ul>`;
  }
  function drawRes(){const el=root.querySelector("#dkRes");if(el)el.innerHTML=resHTML(calc(st))}

  function savedRow(s){
    const e=entries().find(x=>keyOf(x)===s.id),nm=e?e.name:s.name||"klient",r=s.res||{};
    return `<div class="dk-row"><div class="main"><b>${esc(nm)}</b><span>${s.ioldp?"IOLDP "+esc(fmtDate(s.ioldp))+" · ":""}${r.sta?"starobní "+kc(r.sta)+" · ":""}inv. III. ${kc(r.i3)} · vdovský ${kc(r.wid)} · sirotčí ${kc(r.orp)}</span></div><button type="button" class="dk-btn" data-a="open" data-id="${esc(s.id)}">Otevřít</button><button type="button" class="dk-btn danger" data-a="del" data-id="${esc(s.id)}">Smazat</button></div>`;
  }
  function drawSaved(){
    const el=root.querySelector("#dkSaved");if(!el)return;
    el.innerHTML=saved.length?`<div class="dk-sec">Uložené u klientů · ${saved.length}</div><div class="dk-saved">${saved.map(savedRow).join("")}</div>`:"";
    const sel=root.querySelector("#dk_cid");if(sel&&document.activeElement!==sel)sel.innerHTML=clientOpts();
  }

  function snapshotInputs(){const o={};["ioldp","ovz","vz","staIoldp","tY","tD","nY","nD","ret","evt","dopPct","kids","pvDead"].forEach(k=>o[k]=st[k]);return o}
  function load(id){
    const s=saved.find(x=>x.id===id);
    st.cid=id;
    if(s&&s.in)Object.keys(fresh()).forEach(k=>{if(k!=="cid")st[k]=s.in[k]!==undefined?s.in[k]:fresh()[k]});
    persist();draw();
  }
  async function save(){
    if(!store){toast("Ukládání tu není k dispozici");return}
    if(!st.cid){toast("Nejdřív vyber klienta");return}
    const e=entries().find(x=>keyOf(x)===st.cid);
    if(!e){toast("Klient už v seznamu není");return}
    const R=calc(st);
    if(!R.ok){toast("Doplň základ a dobu pojištění");return}
    try{
      const rec=ensure&&!e.rec?await ensure(e):e.rec;
      const id=rec?rec.id:st.cid;
      await store.doc("duchod/"+id).set({clientId:id,name:e.name||"",ioldp:st.ioldp||"",year:R.pr.use,in:snapshotInputs(),
        res:{sta:R.sta.total,i1:R.i1.total,i2:R.i2.total,i3:R.i3.total,wid:R.wid.total,orp:R.orp.total},updatedAt:Date.now()});
      st.cid=id;persist();toast("Uloženo ke klientovi "+(e.name||""));
      const sel=root.querySelector("#dk_cid");if(sel)sel.innerHTML=clientOpts();
    }catch(err){toast("Nepodařilo se uložit")}
  }
  function pdf(){
    const R=calc(st);if(!R.ok){toast("Nejdřív doplň údaje z IOLDP");return}
    const nm=st.cid?nameOf(st.cid):"",d=new Date().toLocaleDateString("cs-CZ");
    const row=(a,b)=>`<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`;
    const html=`<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Důchodová kalkulace – ${esc(nm||"Koncept")} – ${d}</title><style>
      @page{size:A4;margin:14mm}body{font:13px/1.45 Roboto,Arial,Helvetica,sans-serif;color:#0b2341;margin:0;padding:24px}
      .hd{border-bottom:2px solid #ff4f00;padding-bottom:12px;margin-bottom:18px}.hd h1{font-size:20px;margin:0}.hd small{color:#6b7280}
      .tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0 20px}.t{background:#f0f2f5;border-radius:8px;padding:10px 14px}.t .k{font-size:12px}.t .v{font-size:17px;font-weight:700}.t .s{font-size:11px;color:#6b7280}
      table{border-collapse:collapse;width:100%;margin-bottom:6px}td{padding:7px 4px;border-bottom:1px solid #e5e7eb}td:last-child{text-align:right;font-weight:600}
      h2{font-size:16px;margin:18px 0 8px}.ft{margin-top:18px;font-size:11px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:8px}@media print{body{padding:0}}</style></head><body>
      <div class="hd"><h1>Důchodová kalkulace – dávky při invaliditě a úmrtí</h1><small>${esc(nm||"Koncept")} · ${d}${st.ioldp?" · IOLDP ze dne "+esc(fmtDate(st.ioldp)):""}</small></div>
      <div class="tiles">${[["Starobní důchod"+(R.sta.fromIoldp?" (odhad z IOLDP)":" (vlastní odhad)"),R.sta],["Invalidní I. stupně",R.i1],["Invalidní II. stupně",R.i2],["Invalidní III. stupně",R.i3],["Vdovský / vdovecký",R.wid],["Sirotčí (na 1 dítě)",R.orp]].map(([k,r])=>`<div class="t"><div class="k">${esc(k)}</div><div class="v">${kc(r.total)}</div><div class="s">ZV ${kc(r.zv)} + PV ${kc(r.pv)}</div></div>`).join("")}</div>
      <h2>Vstupní údaje</h2><table>${row("Osobní vyměřovací základ",kc(R.ovz))}${row("Výpočtový základ po redukci",kc(R.vz))}${row("Doba pojištění z IOLDP",ryTxt(R.d.tot))}${row("Dopočtená doba",R.dop?ryTxt(R.dop):"0")}${row("Celé roky pro procentní výměru",String(R.years))}${row("Parametry roku "+R.pr.use,R.p.src)}</table>
      <div class="ft">Orientační výpočet podle zákona č. 155/1995 Sb. z údajů IOLDP. Skutečnou výši důchodu stanoví ČSSZ. Vdovský a vdovecký důchod náleží zpravidla 1 rok od úmrtí. © ZFP Consulting</div>
      <script>onload=()=>setTimeout(()=>print(),300)<\/script></body></html>`;
    const w=window.open("","_blank");if(!w){toast("Prohlížeč zablokoval nové okno – povol vyskakovací okna");return}
    w.document.open();w.document.write(html);w.document.close();
  }

  async function importFile(file){
    if(!file)return;
    try{
      const isPdf=/pdf$/i.test(file.type)||/\.pdf$/i.test(file.name);
      const r=parseIoldp(isPdf?await pdfText(file):await file.text());
      if(!r.found.length){impMsg=`<div class="dk-warn">V souboru „${esc(file.name)}“ jsem nenašel žádné údaje z IOLDP. Pokud je to sken, nejde z něj text přečíst – zadej hodnoty ručně.</div>`;draw();return}
      Object.assign(st,r.fields);persist();
      impMsg=`<div class="dk-warn">Načteno z „${esc(file.name)}“: ${esc(r.found.join(", "))}.${r.missing.length?" <b>Nenalezeno:</b> "+esc(r.missing.join(", "))+" – doplň ručně.":""} Hodnoty si před použitím zkontroluj proti IOLDP.</div>`;
      draw();toast("IOLDP načteno");
    }catch(err){impMsg=`<div class="dk-warn">Soubor se nepodařilo přečíst. Zadej údaje ručně.</div>`;draw()}
  }
  root.addEventListener("input",e=>{
    const t=e.target;if(!t.dataset||!t.dataset.k)return;
    const k=t.dataset.k;
    st[k]=(k==="ret"||k==="evt"||k==="ioldp")?t.value:t.value.trim()===""?"":(isFinite(parseNum(t.value))?parseNum(t.value):st[k]);
    persist();drawRes();
  });
  root.addEventListener("change",e=>{
    const t=e.target;
    if(t.id==="dkFile"){const f=t.files&&t.files[0];t.value="";importFile(f);return}
    if(t.matches&&t.matches("select[data-a=cid]")){const id=t.value;if(!id){st.cid="";persist();return}load(id)}
  });
  root.addEventListener("click",async e=>{
    const b=e.target.closest&&e.target.closest("button[data-a]");if(!b)return;
    const a=b.dataset.a;
    if(a==="import"){root.querySelector("#dkFile").click();return}
    if(a==="save")save();
    else if(a==="pdf")pdf();
    else if(a==="new"){st=fresh();persist();draw()}
    else if(a==="open"){load(b.dataset.id);root.scrollIntoView({behavior:"smooth",block:"start"})}
    else if(a==="del"){
      if(b.dataset.sure!=="1"){b.dataset.sure="1";b.textContent="Opravdu smazat?";return}
      try{await store.doc("duchod/"+b.dataset.id).delete();if(st.cid===b.dataset.id){st.cid="";persist()}toast("Smazáno")}catch(err){toast("Nepodařilo se smazat")}
    }
  });
  draw();
  return{redraw:draw,refreshClients(){const sel=root.querySelector("#dk_cid");if(sel&&document.activeElement!==sel)sel.innerHTML=clientOpts()},select(id){load(id)},state:()=>st};
}

window.DuchodCalc={mount,math:{PAR,reduce,doba,dopocet,calc,paramsFor,parseIoldp}};
})();

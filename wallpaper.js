/* živá tapeta – budova ZFP GROUP, 12 měsíčních scén
   volba v nastavení (✓): localStorage.wp_month = "auto" (podle aktuálního měsíce) nebo "1".."12" · localStorage.wp="off" vypne · náhled: ?month=1..12 */
(()=>{
let ls={};try{ls=localStorage}catch(e){}
if(ls.wp==="off")return;
const qm=+new URLSearchParams(location.search).get("month");
const FIX=qm>=1&&qm<=12;let MODE=ls.wp_month||"auto";if(!(MODE==="auto"||(+MODE>=1&&+MODE<=12)))MODE="auto";
const RM=matchMedia("(prefers-reduced-motion: reduce)").matches;
const MN=["Leden","Únor","Březen","Duben","Květen","Červen","Červenec","Srpen","Září","Říjen","Listopad","Prosinec"];
const want=()=>FIX?qm-1:MODE==="auto"?new Date().getMonth():+MODE-1;
let M=want();
const NIGHT=m=>m===10||m===11;
const st=document.createElement("style");
st.textContent=`html.wp,html.wp body{background:transparent!important}html.wp{background:#0b1220!important}
#wpC{position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:-2;pointer-events:none;display:block}
#wpS{position:fixed;inset:0;z-index:-1;pointer-events:none;background:var(--bg);opacity:.3;transition:opacity 2s}
html.wp.wpn #wpS{opacity:.14}
#wpM{position:fixed;right:14px;bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:3;pointer-events:none;font:600 13px/1 var(--font,system-ui);color:#fff;background:rgba(0,0,0,.38);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);padding:7px 12px;border-radius:999px;opacity:0;transition:opacity .6s}
#wpM.on{opacity:1}
:root{--wp-glass:rgba(255,255,255,.8)}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--wp-glass:rgba(28,28,30,.76)}}
:root[data-theme="dark"]{--wp-glass:rgba(28,28,30,.76)}
html.wp .panel,html.wp .group,html.wp .tile:not(.pstack .tile){background:var(--wp-glass)!important;-webkit-backdrop-filter:blur(18px) saturate(150%);backdrop-filter:blur(18px) saturate(150%)}
html.wp .card{background:var(--wp-glass)!important}`;
document.head.append(st);
const c=document.createElement("canvas"),sc=document.createElement("div"),lab=document.createElement("div");c.id="wpC";sc.id="wpS";lab.id="wpM";c.setAttribute("aria-hidden","true");lab.setAttribute("aria-hidden","true");
document.body.prepend(sc);document.body.prepend(c);document.body.append(lab);document.documentElement.classList.add("wp");
const x=c.getContext("2d");
const img=new Image();img.src="image.jpg";
const IW=1920,IH=1440;let W=0,H=0,K=1,OX=0,OY=0,dpr=1;
const R=(a,b)=>a+Math.random()*(b-a), TAU=Math.PI*2;
const P=(ix,iy)=>[OX+ix*K,OY+iy*K];
/* obrys oblohy nad budovou (souřadnice fotky) */
const SKY=[[0,850],[68,500],[308,236],[400,176],[640,172],[1590,470],[1842,600],[1850,765],[1920,765]];
const skyY=ix=>{for(let i=1;i<SKY.length;i++)if(ix<=SKY[i][0]){const[a,b]=SKY[i-1],[c2,d]=SKY[i];return b+(d-b)*(ix-a)/Math.max(1,c2-a)}return 765};
const ROOF=[[68,502],[308,238],[1842,608]];
const WIN=[[398,900,982,1050],[1350,940,1800,1058],[195,440,255,585],[195,665,248,795]];
const FLAGS=[[503,510,548,795],[567,558,683,818],[762,593,852,837]];
const LAMP=[1113,372];
/* ---------- scény ---------- */
const S=[
 {g:[["saturation","#808080",.55],["soft-light","#b3ccff",.6],["screen","#ffffff",.1]],snow:260,ground:"snow",gs:.95,roof:1,frost:1,wind:.5},
 {g:[["saturation","#808080",.5],["soft-light","#c7d2e0",.55],["multiply","#e6ebf2",.25]],snow:150,ground:"snow",gs:.85,roof:1,wind:1.3,gust:1},
 {g:[["saturation","#808080",.2],["soft-light","#d9f0c8",.3]],ground:"melt",gs:.35,birds:1,petals:12,bloom:.3,wind:.4},
 {g:[["multiply","#aeb8c6",.45],["soft-light","#9fb3c8",.3]],rain:260,petals:15,bloom:.6,rainbow:1,wind:.8},
 {g:[["soft-light","#ffd3ea",.3],["soft-light","#baf5ae",.25]],petals:70,bloom:1,flies:3,wind:.4},
 {g:[["soft-light","#ffe08a",.3],["screen","#fff5d6",.05]],sun:1,flies:2,pollen:40,wind:.3},
 {g:[["soft-light","#ffb84d",.45],["screen","#fff0c2",.08]],sun:1.3,pollen:60,birds:1,wind:.2,haze:1},
 {g:[["soft-light","#ff7a3d",.55],["multiply","#ffc9a3",.35],["multiply","#6b4a8a",.18]],dusk:1,fireflies:45,lamp:1,wind:.2},
 {g:[["soft-light","#ffc05a",.35],["saturation","#808080",.08]],maple:34,mcol:["#9ab83a","#e0b43a","#f59e0b","#d97706","#c2410c"],ground:"leaves",gs:.35,wind:.7},
 {g:[["saturation","#808080",.15],["soft-light","#ff8a2a",.5],["multiply","#ffe2c2",.25]],maple:75,mcol:["#b91c1c","#dc2626","#ea580c","#f59e0b","#c2410c","#7c2d12"],ground:"leaves",gs:1,wind:1.1,gust:1},
 {g:[["multiply","#2a1a48",.8],["soft-light","#7a3fb0",.3]],night:1,moon:1,bats:8,fog:1,pumpkins:1,lamp:1,win:"#ff8c1a",wind:.6,flash:1},
 {g:[["multiply","#0e1a3c",.84],["soft-light","#3a5fb0",.2]],night:1,stars:1,snow:150,ground:"snow",gs:.85,roof:1,lights:1,tree:1,lamp:1,win:"#ffb347",wind:.4},
];
function grade(g,s){s.g.forEach(([op,col,a])=>{g.globalCompositeOperation=op;g.globalAlpha=a;g.fillStyle=col;g.fillRect(0,0,W,H)});g.globalCompositeOperation="source-over";g.globalAlpha=1}
function skyClip(g){g.beginPath();g.moveTo(0,0);SKY.forEach(([ix,iy])=>g.lineTo(...P(ix,iy)));g.lineTo(W,P(1920,765)[1]);g.lineTo(W,0);g.closePath()}
function drawBase(m){
  const cv=document.createElement("canvas");cv.width=W*dpr;cv.height=H*dpr;const g=cv.getContext("2d");g.setTransform(dpr,0,0,dpr,0,0);
  const s=S[m];
  if(!img.complete||!img.naturalWidth){g.fillStyle=s.night?"#0b1220":"#3d78c2";g.fillRect(0,0,W,H);return cv}
  g.drawImage(img,OX,OY,IW*K,IH*K);grade(g,s);
  if(s.night){g.save();skyClip(g);g.clip();const gr=g.createLinearGradient(0,0,0,P(0,700)[1]);gr.addColorStop(0,m===10?"rgba(20,8,40,.75)":"rgba(5,12,40,.7)");gr.addColorStop(1,"rgba(0,0,0,0)");g.fillStyle=gr;g.fillRect(0,0,W,H);g.restore()}
  if(s.dusk){g.save();skyClip(g);g.clip();const gr=g.createLinearGradient(0,0,0,P(0,800)[1]);gr.addColorStop(0,"rgba(90,60,140,.45)");gr.addColorStop(.6,"rgba(255,140,90,.35)");gr.addColorStop(1,"rgba(255,190,120,.3)");g.fillStyle=gr;g.fillRect(0,0,W,H);g.restore()}
  if(s.ground==="snow"||s.ground==="melt"){const a=s.gs;
    const y0=P(0,1110)[1],gr=g.createLinearGradient(0,y0,0,P(0,1440)[1]);gr.addColorStop(0,`rgba(240,246,255,0)`);gr.addColorStop(.12,`rgba(240,246,255,${.7*a})`);gr.addColorStop(1,`rgba(245,249,255,${.8*a})`);
    g.fillStyle=gr;g.fillRect(0,y0,W,H-y0);
    g.fillStyle=`rgba(250,252,255,${.8*a})`;for(let i=0;i<(s.ground==="melt"?500:1600);i++){const[px,py]=P(R(0,IW),R(1115,1440));g.beginPath();g.ellipse(px,py,R(2,s.ground==="melt"?14:6)*K*1.4,R(1,3)*K,0,0,TAU);g.fill()}
    if(s.roof){g.strokeStyle=`rgba(250,252,255,${s.night?.75:.92})`;g.lineWidth=Math.max(3,9*K);g.lineCap="round";g.lineJoin="round";g.beginPath();ROOF.forEach(([ix,iy],i)=>{const[px,py]=P(ix,iy-3);i?g.lineTo(px,py):g.moveTo(px,py)});g.stroke();
      g.lineWidth=Math.max(2,6*K);g.beginPath();g.moveTo(...P(990,905));g.lineTo(...P(1845,925));g.stroke()}}
  if(s.ground==="leaves"){const cols=s.mcol;for(let i=0;i<Math.round(2200*s.gs);i++){const[px,py]=P(R(0,IW),R(1120,1300));g.fillStyle=cols[i%cols.length];g.globalAlpha=R(.55,.95);maple(g,px,py,R(3,7)*K*1.4,R(0,TAU),1)}g.globalAlpha=1}
  if(s.bloom){const cols=["#fbcfe8","#f9a8d4","#fff1f2","#fde68a"];[[0,70,560,850],[0,300,1100,1135],[1830,1920,760,900]].forEach(([a,b,y0,y1])=>{for(let i=0;i<Math.round(700*s.bloom);i++){const[px,py]=P(R(a,b),R(y0,y1));g.fillStyle=cols[i%4];g.globalAlpha=R(.55,.95);g.beginPath();g.arc(px,py,R(1.5,4)*K*1.4,0,TAU);g.fill()}});g.globalAlpha=1}
  if(s.frost){const gr=g.createRadialGradient(W/2,H/2,Math.min(W,H)*.35,W/2,H/2,Math.max(W,H)*.75);gr.addColorStop(0,"rgba(230,240,255,0)");gr.addColorStop(1,"rgba(230,240,255,.35)");g.fillStyle=gr;g.fillRect(0,0,W,H)}
  return cv;
}
/* ---------- tvary ---------- */
const MAPLE=[[0,-1],[.12,-.62],[.38,-.8],[.3,-.42],[.74,-.52],[.62,-.22],[.96,-.06],[.55,.08],[.62,.32],[.25,.22],[.07,.42],[0,.44],[-.07,.42],[-.25,.22],[-.62,.32],[-.55,.08],[-.96,-.06],[-.62,-.22],[-.74,-.52],[-.3,-.42],[-.38,-.8],[-.12,-.62]];
function maple(g,px,py,s,rot,sx){g.save();g.translate(px,py);g.rotate(rot);g.scale(s*sx,s);g.beginPath();MAPLE.forEach(([a,b],i)=>i?g.lineTo(a,b):g.moveTo(a,b));g.closePath();g.fill();g.restore()}
function mapleFull(l){x.save();x.translate(l.x,l.y);x.rotate(l.rot);const sx=Math.cos(l.flip);x.scale(l.s*(Math.abs(sx)<.15?.15*Math.sign(sx||1):sx),l.s);
  x.fillStyle=l.c;x.beginPath();MAPLE.forEach(([a,b],i)=>i?x.lineTo(a,b):x.moveTo(a,b));x.closePath();x.fill();
  x.strokeStyle="rgba(60,20,0,.35)";x.lineWidth=.08;x.beginPath();x.moveTo(0,.44);x.lineTo(0,-.8);x.moveTo(0,.1);x.lineTo(.6,-.35);x.moveTo(0,.1);x.lineTo(-.6,-.35);x.moveTo(0,.44);x.lineTo(0,1);x.stroke();x.restore()}
function petal(l){x.save();x.translate(l.x,l.y);x.rotate(l.rot);x.scale(Math.cos(l.flip),1);x.fillStyle=l.c;x.globalAlpha=.92;x.beginPath();x.ellipse(0,0,l.s,l.s*.55,0,0,TAU);x.fill();x.restore();x.globalAlpha=1}
function bat(b,t){const w=b.s*(0.55+0.45*Math.sin(t*12+b.p));x.save();x.translate(b.x,b.y+Math.sin(t*2+b.p)*10);x.scale(b.v<0?-1:1,1);x.fillStyle="#0a0710";x.beginPath();x.moveTo(0,0);x.quadraticCurveTo(-b.s*.5,-w,-b.s,-w*.3);x.quadraticCurveTo(-b.s*.6,-w*.1,-b.s*.45,b.s*.1);x.quadraticCurveTo(-b.s*.2,0,0,b.s*.18);x.quadraticCurveTo(b.s*.2,0,b.s*.45,b.s*.1);x.quadraticCurveTo(b.s*.6,-w*.1,b.s,-w*.3);x.quadraticCurveTo(b.s*.5,-w,0,0);x.fill();x.restore()}
function bird(b,t){const f=Math.sin(t*8+b.p)*b.s*.45;x.strokeStyle="rgba(30,30,40,.75)";x.lineWidth=1.6;x.beginPath();x.moveTo(b.x-b.s,b.y-f);x.quadraticCurveTo(b.x-b.s*.4,b.y-b.s*.35-f*.3,b.x,b.y);x.quadraticCurveTo(b.x+b.s*.4,b.y-b.s*.35-f*.3,b.x+b.s,b.y-f);x.stroke()}
function fly(i,t){const fx=W*(.5+.4*Math.sin(t*.13+i*2.1)),fy=H*(.5+.22*Math.sin(t*.21+i*1.7)),w=Math.abs(Math.sin(t*10+i))*8+2;x.fillStyle=["#f472b6","#fde047","#60a5fa"][i%3];x.globalAlpha=.9;x.beginPath();x.ellipse(fx-w*.5,fy,w*.6,6,-.4,0,TAU);x.ellipse(fx+w*.5,fy,w*.6,6,.4,0,TAU);x.fill();x.globalAlpha=1;x.fillStyle="#27272a";x.fillRect(fx-.9,fy-5,1.8,10)}
function glowWin(col,a){x.globalCompositeOperation="screen";WIN.forEach(([x0,y0,x1,y1])=>{const[a0,b0]=P(x0,y0),[a1,b1]=P(x1,y1);x.fillStyle=col;x.globalAlpha=a;x.fillRect(a0,b0,a1-a0,b1-b0)});x.globalCompositeOperation="source-over";x.globalAlpha=1}
function lampGlow(t,a){const[lx,ly]=P(...LAMP),r=260*K;x.globalCompositeOperation="screen";let g=x.createRadialGradient(lx,ly,0,lx,ly,r);g.addColorStop(0,`rgba(255,220,150,${.9*a})`);g.addColorStop(.12,`rgba(255,200,120,${.45*a})`);g.addColorStop(1,"rgba(255,190,110,0)");x.fillStyle=g;x.fillRect(lx-r,ly-r,r*2,r*2);
  const[gx,gy]=P(LAMP[0]-60,1180);g=x.createRadialGradient(gx,gy,0,gx,gy,r*1.3);g.addColorStop(0,`rgba(255,200,120,${.3*a})`);g.addColorStop(1,"rgba(255,200,120,0)");x.save();x.scale(1,.35);x.fillStyle=g;x.fillRect(gx-r*1.3,gy/.35-r*1.3,r*2.6,r*2.6);x.restore();x.globalCompositeOperation="source-over"}
function pumpkin(ix,iy,s,t,k){const[px,py]=P(ix,iy);const r=s*K;const fl=.75+.25*Math.sin(t*9+k)*Math.sin(t*5.3+k*2);
  const g=x.createRadialGradient(px,py,0,px,py,r*4);g.addColorStop(0,`rgba(255,140,30,${.4*fl})`);g.addColorStop(1,"rgba(255,140,30,0)");x.fillStyle=g;x.fillRect(px-r*4,py-r*4,r*8,r*8);
  x.fillStyle="#c2410c";[-.55,0,.55].forEach(o=>{x.beginPath();x.ellipse(px+o*r,py,r*.62,r*.8,0,0,TAU);x.fill()});
  x.fillStyle="#3f6212";x.fillRect(px-r*.08,py-r*1.1,r*.16,r*.35);
  x.fillStyle=`rgba(255,${200+40*fl|0},90,${fl})`;[[-1],[1]].forEach(([s2])=>{x.beginPath();x.moveTo(px+s2*r*.45,py-r*.2);x.lineTo(px+s2*r*.2,py-r*.2);x.lineTo(px+s2*r*.32,py-r*.45);x.fill()});
  x.beginPath();x.moveTo(px-r*.5,py+r*.15);x.lineTo(px+r*.5,py+r*.15);x.lineTo(px+r*.3,py+r*.45);x.lineTo(px,py+r*.3);x.lineTo(px-r*.3,py+r*.45);x.fill()}
function lights(t){const cols=["#ff3b30","#ffcc00","#34c759","#0a84ff","#ff9f0a"];let k=0;
  for(let s=0;s<ROOF.length-1;s++){const[a,b]=ROOF[s],[c2,d]=ROOF[s+1];const L=Math.hypot(c2-a,d-b),n=Math.floor(L/26);
    for(let i=0;i<=n;i++){const u=i/n,sag=Math.sin((i%4)/4*Math.PI)*6;const[px,py]=P(a+(c2-a)*u,b+(d-b)*u+8+sag);const on=.3+.7*(.5+.5*Math.sin(t*3+k*1.7));const col=cols[k%5],rr=Math.max(5,16*K);
      const g=x.createRadialGradient(px,py,0,px,py,rr);g.addColorStop(0,col);g.addColorStop(1,"rgba(0,0,0,0)");x.globalAlpha=on;x.fillStyle=g;x.fillRect(px-rr,py-rr,rr*2,rr*2);x.globalAlpha=1;x.fillStyle=col;x.beginPath();x.arc(px,py,Math.max(1.3,3*K),0,TAU);x.fill();k++}}}
function tree(t){const[bx0,by0]=P(210,1165),h=300*K,w=180*K;x.fillStyle="#3b2412";x.fillRect(bx0-10*K,by0-6*K,20*K,26*K);
  x.fillStyle="#0f3d24";for(let j=0;j<3;j++){const y0=by0-h*(j*.28),y1=by0-h*(.45+j*.28),ww=w*(1-j*.25);x.beginPath();x.moveTo(bx0-ww/2,y0);x.lineTo(bx0+ww/2,y0);x.lineTo(bx0,y1);x.fill()}
  x.fillStyle="rgba(250,252,255,.7)";for(let j=0;j<3;j++){const y0=by0-h*(j*.28),ww=w*(1-j*.25);x.fillRect(bx0-ww/2,y0-2*K,ww,4*K)}
  const cols=["#ff3b30","#ffcc00","#0a84ff","#ff2d55","#ffffff"];for(let i=0;i<34;i++){const u=(i*37%100)/100,yy=by0-h*u*.95,ww=w*(1-u)*.42;const xx=bx0+Math.sin(i*2.4)*ww;const on=.35+.65*(.5+.5*Math.sin(t*2.5+i));x.globalAlpha=on;x.fillStyle=cols[i%5];x.beginPath();x.arc(xx,yy,Math.max(2,5*K),0,TAU);x.fill()}x.globalAlpha=1;
  const[sx,sy]=[bx0,by0-h*1.05],r1=Math.max(6,22*K);x.fillStyle="#ffd60a";x.shadowColor="#ffd60a";x.shadowBlur=14;x.beginPath();for(let i=0;i<10;i++){const a=i*Math.PI/5-Math.PI/2,r=i%2?r1*.42:r1;x.lineTo(sx+Math.cos(a)*r,sy+Math.sin(a)*r)}x.fill();x.shadowBlur=0}
/* vlající vlajky: pruhy z podkladu posunuté vlnou */
function flags(base,t,wind){const b=dpr;FLAGS.forEach(([x0,y0,x1,y1],k)=>{const[a0,b0]=P(x0,y0),[a1,b1]=P(x1,y1),w=a1-a0,h=b1-b0,n=Math.max(8,Math.round(w/3)),sw=w/n;
  for(let i=0;i<n;i++){const u=i/n,amp=(2+5*wind)*K*1.6*u,dy=Math.sin(t*(2.6+wind)-u*7+k)*amp,sh=1-.06*u*Math.sin(t*2.6-u*7+k);
    x.drawImage(base,(a0+i*sw)*b,b0*b,sw*b+1,h*b,a0+i*sw,b0+dy+h*(1-sh)/2,sw+.6,h*sh);
    const l=Math.cos(t*(2.6+wind)-u*7+k);x.fillStyle=l>0?`rgba(255,255,255,${.08*l*u})`:`rgba(0,0,0,${-.12*l*u})`;x.fillRect(a0+i*sw,b0+dy,sw+.6,h*sh)}})}
/* ---------- částice ---------- */
let parts={},stars=[],fog=[];const N=a=>Math.round(a*Math.min(1.6,Math.max(.45,W*H/(1280*800))));
function mk(m){const s=S[m];const p={};
  if(s.snow)p.snow=Array.from({length:N(s.snow)},()=>({x:R(0,W),y:R(-H,H),r:R(.8,3.4),v:R(.5,1.6),p:R(0,TAU)}));
  if(s.rain)p.rain=Array.from({length:N(s.rain)},()=>({x:R(0,W),y:R(-H,H),l:R(12,24),v:R(9,14)}));
  p.splash=[];
  if(s.maple)p.maple=Array.from({length:N(s.maple)},(_,i)=>({x:R(0,W),y:R(-H,H),s:R(8,16),v:R(.6,1.4),p:R(0,TAU),rot:R(0,TAU),vr:R(-.04,.04),flip:R(0,TAU),vf:R(.03,.09),c:s.mcol[i%s.mcol.length]}));
  if(s.petals)p.petals=Array.from({length:N(s.petals)},(_,i)=>({x:R(0,W),y:R(-H,H),s:R(3,6),v:R(.3,.8),p:R(0,TAU),rot:R(0,TAU),vr:R(-.03,.03),flip:R(0,TAU),c:["#fbcfe8","#f9a8d4","#fce7f3"][i%3]}));
  if(s.pollen)p.pollen=Array.from({length:N(s.pollen)},()=>({x:R(0,W),y:R(0,H),r:R(.8,2.2),v:R(.1,.35),p:R(0,TAU)}));
  if(s.fireflies)p.ff=Array.from({length:N(s.fireflies)},()=>({x:R(0,W),y:R(H*.45,H),p:R(0,TAU),vx:R(-.4,.4),vy:R(-.3,.3)}));
  if(s.bats)p.bats=Array.from({length:s.bats},(_,i)=>({x:R(0,W),y:R(.05,.4)*H,s:R(12,26),v:R(.6,1.6)*(i%2?1:-1),p:R(0,TAU)}));
  if(s.birds)p.birds=Array.from({length:7},(_,i)=>({x:-60-Math.abs(i-3)*28,y:H*.16+Math.abs(i-3)*18,s:9,p:R(0,TAU)}));
  stars=[];if(s.night)for(let i=0;i<N(130);i++){const ix=R(0,IW),iy=R(0,skyY(ix)-20);stars.push({ix,iy,r:R(.4,1.5),p:R(0,TAU)})}
  fog=s.fog?Array.from({length:5},(_,i)=>({x:R(0,W),y:P(0,1090+i*40)[1],v:R(.2,.5)*(i%2?1:-1),r:R(.25,.45)})):[];
  parts=p}
/* ---------- smyčka ---------- */
let base=null,prev=null,fadeT=0,t0=performance.now(),last=0,run=true,flash=0;
function frame(now){
  if(!run)return;requestAnimationFrame(frame);
  if(now-last<33)return;const dt=Math.min(3,(now-last)/16.7);last=now;const t=(now-t0)/1000;const s=S[M];
  x.setTransform(dpr,0,0,dpr,0,0);x.drawImage(base,0,0,W,H);
  const wind=s.wind*(1+(s.gust?Math.max(0,Math.sin(t*.35))*1.4:0))*(.7+.3*Math.sin(t*.25));
  flags(base,t,wind);
  x.save();skyClip(x);x.clip();
  stars.forEach(st2=>{const[px,py]=P(st2.ix,st2.iy);x.globalAlpha=.3+.7*(.5+.5*Math.sin(t*1.6+st2.p));x.fillStyle="#fff";x.beginPath();x.arc(px,py,st2.r,0,TAU);x.fill()});x.globalAlpha=1;
  if(s.moon){const[mx,my]=P(1700,270),mr=Math.max(20,70*K);const g=x.createRadialGradient(mx,my,mr*.8,mx,my,mr*4);g.addColorStop(0,"rgba(255,236,190,.35)");g.addColorStop(1,"rgba(255,236,190,0)");x.fillStyle=g;x.fillRect(mx-mr*4,my-mr*4,mr*8,mr*8);x.fillStyle="#fff1c9";x.beginPath();x.arc(mx,my,mr,0,TAU);x.fill();x.fillStyle="rgba(200,180,140,.35)";[[-.3,-.2,.18],[.25,.15,.14],[-.05,.35,.1]].forEach(([a,b,r])=>{x.beginPath();x.arc(mx+a*mr,my+b*mr,r*mr,0,TAU);x.fill()});
    const cl=((t*12)%(W+600))-300;x.fillStyle="rgba(30,20,50,.55)";x.beginPath();x.ellipse(cl,my+mr*.4,mr*2.4,mr*.45,0,0,TAU);x.fill()}
  if(s.rainbow){const k=.5+.5*Math.sin(t*.2);const[rx,ry]=P(1500,900),rr=Math.max(W,H)*.55;["#ff3b30","#ff9500","#ffcc00","#34c759","#0a84ff","#5856d6"].forEach((col,i)=>{x.strokeStyle=col;x.globalAlpha=.1*k;x.lineWidth=Math.max(4,12*K);x.beginPath();x.arc(rx,ry,rr-i*Math.max(4,12*K),Math.PI*1.05,Math.PI*1.65);x.stroke()});x.globalAlpha=1}
  if(s.sun){const[sx,sy]=P(1760,210);x.save();x.translate(sx,sy);x.rotate(t*.04);for(let i=0;i<14;i++){x.rotate(TAU/14);const g=x.createLinearGradient(0,0,0,H*.8);g.addColorStop(0,`rgba(255,240,190,${.16*s.sun})`);g.addColorStop(1,"rgba(255,240,190,0)");x.fillStyle=g;x.beginPath();x.moveTo(-10,0);x.lineTo(10,0);x.lineTo(70,H*.8);x.lineTo(-70,H*.8);x.fill()}x.restore();
    const r=110*K+50,g=x.createRadialGradient(sx,sy,0,sx,sy,r);g.addColorStop(0,"rgba(255,255,240,.98)");g.addColorStop(.28,"rgba(255,236,160,.6)");g.addColorStop(1,"rgba(255,220,120,0)");x.fillStyle=g;x.fillRect(sx-r,sy-r,r*2,r*2)}
  if(s.dusk){const[sx,sy]=P(1880,700),r=260*K+60,g=x.createRadialGradient(sx,sy,0,sx,sy,r);g.addColorStop(0,"rgba(255,220,160,.9)");g.addColorStop(.25,"rgba(255,150,90,.45)");g.addColorStop(1,"rgba(255,120,80,0)");x.fillStyle=g;x.fillRect(sx-r,sy-r,r*2,r*2)}
  x.restore();
  if(s.sun&&!RM){const[sx,sy]=P(1760,210);[.35,.55,.75].forEach((f,i)=>{const fx=sx+(W*.45-sx)*f,fy=sy+(H*.7-sy)*f,rr=(18+i*14)*(.8+.2*Math.sin(t+i));x.fillStyle=`rgba(255,230,170,${.07+.03*i})`;x.beginPath();x.arc(fx,fy,rr,0,TAU);x.fill()})}
  if(s.lamp)lampGlow(t,s.night?1:.7);
  if(s.win)glowWin(s.win,.24+.05*Math.sin(t*7)*Math.sin(t*3.1));
  if(s.lights)lights(t);
  if(s.tree)tree(t);
  if(s.pumpkins){pumpkin(300,1170,26,t,0);pumpkin(930,1168,20,t,2);pumpkin(1560,1150,24,t,4)}
  fog.forEach(f=>{f.x+=f.v*dt;if(f.x>W*1.3)f.x=-W*.3;if(f.x<-W*.3)f.x=W*1.3;const rr=W*f.r,g=x.createRadialGradient(f.x,f.y,0,f.x,f.y,rr);g.addColorStop(0,"rgba(190,170,230,.18)");g.addColorStop(1,"rgba(190,170,230,0)");x.fillStyle=g;x.save();x.scale(1,.4);x.fillRect(f.x-rr,f.y/.4-rr,rr*2,rr*2);x.restore()});
  const p=parts;
  p.bats&&p.bats.forEach(b=>{b.x+=b.v*2*dt;if(b.x>W+40)b.x=-40;if(b.x<-40)b.x=W+40;bat(b,t)});
  p.birds&&p.birds.forEach(b=>{b.x+=1.3*dt;b.y+=Math.sin(t*.7)*.15*dt;if(b.x>W+300){b.x-=W+700}bird(b,t)});
  p.pollen&&p.pollen.forEach(q=>{q.y-=q.v*dt;q.x+=Math.sin(t+q.p)*.3*dt;if(q.y<-5){q.y=H+5;q.x=R(0,W)}x.globalAlpha=.25+.45*(.5+.5*Math.sin(t*2+q.p));x.fillStyle="#fff7d6";x.beginPath();x.arc(q.x,q.y,q.r,0,TAU);x.fill()});x.globalAlpha=1;
  p.ff&&p.ff.forEach(f=>{f.x+=(f.vx+Math.sin(t*.9+f.p)*.5)*dt;f.y+=(f.vy+Math.cos(t*.7+f.p)*.4)*dt;if(f.x<0||f.x>W)f.vx*=-1;if(f.y<H*.35||f.y>H)f.vy*=-1;const a=Math.max(0,Math.sin(t*1.8+f.p)),g=x.createRadialGradient(f.x,f.y,0,f.x,f.y,9);g.addColorStop(0,`rgba(220,255,120,${a})`);g.addColorStop(1,"rgba(220,255,120,0)");x.fillStyle=g;x.fillRect(f.x-9,f.y-9,18,18)});
  if(s.flies)for(let i=0;i<s.flies;i++)fly(i,t);
  p.petals&&p.petals.forEach(l=>{l.y+=l.v*dt;l.x+=(Math.sin(t+l.p)*.7+.4+wind)*dt;l.rot+=l.vr*dt;l.flip+=.05*dt;if(l.y>H+10){l.y=-10;l.x=R(-W*.2,W)}if(l.x>W+10)l.x=-10;petal(l)});
  p.maple&&p.maple.forEach(l=>{l.y+=l.v*dt*(1+.3*Math.sin(l.flip));l.x+=(Math.sin(t*1.1+l.p)*1.2+wind*1.8)*dt;l.rot+=(l.vr+Math.sin(t*1.7+l.p)*.012)*dt;l.flip+=l.vf*dt;if(l.y>H+30){l.y=-30;l.x=R(-W*.2,W)}if(l.x>W+30)l.x=-30;if(l.x<-30)l.x=W+30;mapleFull(l)});
  if(p.snow){x.fillStyle="#fff";p.snow.forEach(q=>{q.y+=q.v*dt*(.6+q.r*.25);q.x+=(Math.sin(t*.8+q.p)*.45+wind*.9)*dt;if(q.y>H+5){q.y=-5;q.x=R(0,W)}if(q.x>W+5)q.x=-5;if(q.x<-5)q.x=W+5;x.globalAlpha=.5+q.r*.13;x.beginPath();x.arc(q.x,q.y,q.r,0,TAU);x.fill()});x.globalAlpha=1}
  if(p.rain){x.strokeStyle="rgba(210,225,245,.45)";x.lineWidth=1.1;x.beginPath();const sl=wind*2+1.2;p.rain.forEach(q=>{q.y+=q.v*dt;q.x+=sl*dt;if(q.y>H){if(Math.random()<.35&&p.splash.length<60)p.splash.push({x:q.x,y:R(P(0,1215)[1],H),a:1});q.y=R(-80,-10);q.x=R(-50,W)}x.moveTo(q.x,q.y);x.lineTo(q.x-sl*q.l/q.v,q.y-q.l)});x.stroke();
    p.splash=p.splash.filter(z=>{z.a-=.06*dt;if(z.a<=0)return false;x.strokeStyle=`rgba(220,235,255,${z.a*.6})`;x.beginPath();x.ellipse(z.x,z.y,(1-z.a)*10+2,(1-z.a)*3+1,0,0,TAU);x.stroke();return true})}
  if(s.flash){flash-=dt*.05;if(flash<=0&&Math.random()<.0015*dt)flash=1;if(flash>0){x.fillStyle=`rgba(200,190,255,${Math.max(0,flash)*.25})`;x.fillRect(0,0,W,H)}}
  if(prev&&fadeT<1){fadeT=Math.min(1,fadeT+.018*dt);x.globalAlpha=1-fadeT;x.drawImage(prev,0,0,W,H);x.globalAlpha=1;if(fadeT>=1)prev=null}
}
function snapshot(){const cv=document.createElement("canvas");cv.width=c.width;cv.height=c.height;cv.getContext("2d").drawImage(c,0,0);return cv}
function setMonth(m,fade){if(fade&&base){prev=snapshot();fadeT=0}M=m;base=drawBase(M);mk(M);document.documentElement.classList.toggle("wpn",!!S[M].night);
  lab.textContent=MN[M];lab.classList.add("on");clearTimeout(setMonth.h);setMonth.h=setTimeout(()=>lab.classList.remove("on"),3500);window.__wp={month:M+1,name:MN[M]};if(RM)paintOnce()}
function paintOnce(){run=true;last=0;frame(performance.now()+99);run=false}
function size(){dpr=Math.min(devicePixelRatio||1,1.5);W=innerWidth;H=innerHeight;c.width=W*dpr;c.height=H*dpr;K=Math.max(W/IW,H/IH);OX=(W-IW*K)/2;OY=(H-IH*K)*.35;base=drawBase(M);mk(M);prev=null;last=0;if(RM)paintOnce()}
let rt;addEventListener("resize",()=>{clearTimeout(rt);rt=setTimeout(size,150)});
document.addEventListener("visibilitychange",()=>{const v=document.visibilityState==="visible"&&!RM;if(v&&!run){run=true;last=0;requestAnimationFrame(frame)}else if(!v)run=false});
img.onload=()=>{base=drawBase(M);if(RM)paintOnce()};
size();setMonth(M,false);
setInterval(()=>{const m=want();if(m!==M)setMonth(m,true)},60000);
window.__wpSet=v=>{MODE=v==="auto"||(+v>=1&&+v<=12)?String(v):"auto";const m=want();if(m!==M)setMonth(m,true)};
if(!RM)requestAnimationFrame(frame);else run=false;
})();

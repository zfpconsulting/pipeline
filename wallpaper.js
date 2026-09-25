/* živá tapeta podle ročního období – budova ZFP (leden–únor zima, březen–květen jaro, červen–srpen léto, září–říjen podzim, listopad halloween, prosinec Vánoce)
   vypnutí: localStorage.wp="off" · náhled: ?season=winter|spring|summer|autumn|halloween|xmas */
(()=>{
let ls={};try{ls=localStorage}catch(e){}
if(ls.wp==="off")return;
const Q=new URLSearchParams(location.search).get("season");
const S=Q||["winter","winter","spring","spring","spring","summer","summer","summer","autumn","autumn","halloween","xmas"][new Date().getMonth()];
const RM=matchMedia("(prefers-reduced-motion: reduce)").matches;
const NIGHT=S==="halloween"||S==="xmas";
const st=document.createElement("style");
st.textContent=`html.wp,html.wp body{background:transparent!important}html.wp{background:#0b1220!important}
#wpC{position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:-2;pointer-events:none;display:block}
#wpS{position:fixed;inset:0;z-index:-1;pointer-events:none;background:var(--bg);opacity:${NIGHT?.18:.34}}
:root{--wp-glass:rgba(255,255,255,.8)}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--wp-glass:rgba(28,28,30,.76)}}
:root[data-theme="dark"]{--wp-glass:rgba(28,28,30,.76)}
html.wp .panel,html.wp .group,html.wp .tile:not(.pstack .tile){background:var(--wp-glass)!important;-webkit-backdrop-filter:blur(18px) saturate(150%);backdrop-filter:blur(18px) saturate(150%)}
html.wp .card{background:var(--wp-glass)!important}`;
document.head.append(st);
const c=document.createElement("canvas"),sc=document.createElement("div");c.id="wpC";sc.id="wpS";c.setAttribute("aria-hidden","true");
document.body.prepend(sc);document.body.prepend(c);document.documentElement.classList.add("wp");
const x=c.getContext("2d"),base=document.createElement("canvas"),bx=base.getContext("2d");
const img=new Image();img.src="image.png";
const IW=679,IH=451;let W=0,H=0,K=1,OX=0,OY=0,dpr=1;
const R=(a,b)=>a+Math.random()*(b-a);
const P=(ix,iy)=>[OX+ix*K,OY+iy*K];
// hranice oblohy (obrazové souřadnice): nad střechou budovy
const skyY=ix=>ix<115?320:ix<475?272-(ix-115)*195/360-6:ix<560?77+(ix-475)*153/85-6:285;
const ROOF=[[115,272],[475,75],[560,228]];
const WIN=[[215,322,445,366],[497,157,533,222],[500,232,536,292],[500,307,537,367]];

function grade(g){
  const f=(op,col,a)=>{g.globalCompositeOperation=op;g.globalAlpha=a;g.fillStyle=col;g.fillRect(0,0,W,H)};
  if(S==="winter"){f("saturation","#808080",.45);f("soft-light","#b9d3ff",.55);f("screen","#ffffff",.08)}
  if(S==="spring"){f("soft-light","#ffd3ea",.3);f("soft-light","#baf5ae",.25)}
  if(S==="summer"){f("soft-light","#ffc766",.4);f("screen","#fff1c9",.06)}
  if(S==="autumn"){f("saturation","#808080",.15);f("soft-light","#ff8a2a",.5);f("multiply","#ffe2c2",.25)}
  if(S==="halloween"){f("multiply","#2a1a48",.78);f("soft-light","#7a3fb0",.3)}
  if(S==="xmas"){f("multiply","#0e1a3c",.84);f("soft-light","#3a5fb0",.2)}
  g.globalCompositeOperation="source-over";g.globalAlpha=1;
}
function drawBase(){
  base.width=W*dpr;base.height=H*dpr;bx.setTransform(dpr,0,0,dpr,0,0);
  if(!img.complete||!img.naturalWidth){bx.fillStyle=NIGHT?"#0b1220":"#3d78c2";bx.fillRect(0,0,W,H);return}
  bx.drawImage(img,OX,OY,IW*K,IH*K);grade(bx);
  const g=bx;
  if(S==="winter"||S==="xmas"){ // sníh na zemi a na střeše
    const gr=g.createLinearGradient(0,OY+370*K,0,OY+451*K);gr.addColorStop(0,"rgba(240,246,255,0)");gr.addColorStop(.25,"rgba(240,246,255,.55)");gr.addColorStop(1,"rgba(245,249,255,.85)");
    g.fillStyle=gr;g.fillRect(0,OY+370*K,W,Math.max(H-(OY+370*K),0));
    g.fillStyle=`rgba(245,249,255,${S==="xmas"?.55:.8})`;for(let i=0;i<900;i++){const ix=R(0,IW),iy=R(372,451);const [px,py]=P(ix,iy);g.beginPath();g.arc(px,py,R(1,3)*K*.5,0,7);g.fill()}
    g.strokeStyle=`rgba(250,252,255,${S==="xmas"?.7:.9})`;g.lineWidth=3.2*K;g.lineCap="round";g.beginPath();ROOF.forEach(([ix,iy],i)=>{const[px,py]=P(ix,iy-1.5);i?g.lineTo(px,py):g.moveTo(px,py)});g.stroke();
    g.lineWidth=2.2*K;g.beginPath();g.moveTo(...P(215,318));g.lineTo(...P(462,305));g.stroke();
  }
  if(S==="autumn"){const cols=["#c2410c","#ea580c","#f59e0b","#b91c1c","#a16207"];for(let i=0;i<700;i++){const ix=R(0,IW),iy=R(378,451);const[px,py]=P(ix,iy);g.fillStyle=cols[i%5];g.globalAlpha=R(.5,.95);g.beginPath();g.ellipse(px,py,R(1.2,2.6)*K,R(.6,1.3)*K,R(0,3),0,7);g.fill()}g.globalAlpha=1}
  if(S==="spring"){const cols=["#fbcfe8","#f9a8d4","#fff1f2","#fde68a"];[[0,105,322,372],[580,679,288,375],[330,660,386,405]].forEach(([a,b,y0,y1],j)=>{for(let i=0;i<(j==2?160:420);i++){const[px,py]=P(R(a,b),R(y0,y1));g.fillStyle=cols[i%4];g.globalAlpha=R(.55,.95);g.beginPath();g.arc(px,py,R(.8,1.8)*K,0,7);g.fill()}});g.globalAlpha=1}
  if(S==="summer"){const gr=g.createRadialGradient(...P(640,30),0,...P(640,30),260*K);gr.addColorStop(0,"rgba(255,244,200,.55)");gr.addColorStop(1,"rgba(255,244,200,0)");g.fillStyle=gr;g.fillRect(0,0,W,H)}
}

let parts=[];const N=a=>Math.round(a*Math.min(1.6,Math.max(.5,W*H/(1280*800))));
function mk(){
  parts=[];
  if(S==="winter"||S==="xmas")for(let i=0;i<N(S==="xmas"?140:200);i++)parts.push({x:R(0,W),y:R(-H,H),r:R(.8,3.2),v:R(.5,1.6),p:R(0,6.3)});
  if(S==="autumn")for(let i=0;i<N(45);i++)parts.push({x:R(0,W),y:R(-H,H),s:R(6,13),v:R(.6,1.4),p:R(0,6.3),rot:R(0,6.3),vr:R(-.04,.04),c:["#c2410c","#ea580c","#f59e0b","#b91c1c","#d97706"][i%5]});
  if(S==="spring")for(let i=0;i<N(55);i++)parts.push({x:R(0,W),y:R(-H,H),s:R(3,6),v:R(.3,.8),p:R(0,6.3),rot:R(0,6.3),vr:R(-.03,.03),c:["#fbcfe8","#f9a8d4","#fce7f3"][i%3]});
  if(S==="summer")for(let i=0;i<N(40);i++)parts.push({x:R(0,W),y:R(0,H),r:R(.8,2.2),v:R(.1,.35),p:R(0,6.3)});
  if(S==="halloween")for(let i=0;i<7;i++)parts.push({x:R(0,W),y:R(.05,.45)*H,s:R(10,22),v:R(.6,1.6)*(i%2?1:-1),p:R(0,6.3)});
  if(S==="xmas"||S==="halloween"){stars=[];for(let i=0;i<N(90);i++){const ix=R(0,IW),iy=R(0,skyY(ix));stars.push({ix,iy,r:R(.4,1.3),p:R(0,6.3)})}}
}
let stars=[];
const flies=[{p:0},{p:2.3}];
function leaf(l){x.save();x.translate(l.x,l.y);x.rotate(l.rot);x.fillStyle=l.c;x.beginPath();x.moveTo(0,-l.s);x.quadraticCurveTo(l.s*.8,0,0,l.s);x.quadraticCurveTo(-l.s*.8,0,0,-l.s);x.fill();x.strokeStyle="rgba(0,0,0,.25)";x.lineWidth=.8;x.beginPath();x.moveTo(0,-l.s);x.lineTo(0,l.s);x.stroke();x.restore()}
function petal(l){x.save();x.translate(l.x,l.y);x.rotate(l.rot);x.fillStyle=l.c;x.globalAlpha=.9;x.beginPath();x.ellipse(0,0,l.s,l.s*.55,0,0,7);x.fill();x.restore();x.globalAlpha=1}
function bat(b,t){const w=b.s*(0.55+0.45*Math.sin(t*12+b.p));x.save();x.translate(b.x,b.y+Math.sin(t*2+b.p)*8);x.scale(b.v<0?-1:1,1);x.fillStyle="#0a0710";x.beginPath();x.moveTo(0,0);x.quadraticCurveTo(-b.s*.5,-w,-b.s,-w*.3);x.quadraticCurveTo(-b.s*.6,-w*.1,-b.s*.45,b.s*.1);x.quadraticCurveTo(-b.s*.2,0,0,b.s*.18);x.quadraticCurveTo(b.s*.2,0,b.s*.45,b.s*.1);x.quadraticCurveTo(b.s*.6,-w*.1,b.s,-w*.3);x.quadraticCurveTo(b.s*.5,-w,0,0);x.fill();x.restore()}
function glowWin(col,a){WIN.forEach(([x0,y0,x1,y1])=>{const[a0,b0]=P(x0,y0),[a1,b1]=P(x1,y1);x.globalCompositeOperation="screen";x.fillStyle=col;x.globalAlpha=a;x.fillRect(a0,b0,a1-a0,b1-b0)});x.globalCompositeOperation="source-over";x.globalAlpha=1}
function pumpkin(ix,iy,s,t,k){const[px,py]=P(ix,iy);const r=s*K;const fl=.75+.25*Math.sin(t*9+k)*Math.sin(t*5.3+k*2);
  const g=x.createRadialGradient(px,py,0,px,py,r*4);g.addColorStop(0,`rgba(255,140,30,${.35*fl})`);g.addColorStop(1,"rgba(255,140,30,0)");x.fillStyle=g;x.fillRect(px-r*4,py-r*4,r*8,r*8);
  x.fillStyle="#c2410c";[-.55,0,.55].forEach(o=>{x.beginPath();x.ellipse(px+o*r,py,r*.62,r*.8,0,0,7);x.fill()});
  x.fillStyle="#3f6212";x.fillRect(px-r*.08,py-r*1.1,r*.16,r*.35);
  x.fillStyle=`rgba(255,${200+40*fl|0},90,${fl})`;x.beginPath();x.moveTo(px-r*.45,py-r*.2);x.lineTo(px-r*.2,py-r*.2);x.lineTo(px-r*.32,py-r*.45);x.fill();x.beginPath();x.moveTo(px+r*.45,py-r*.2);x.lineTo(px+r*.2,py-r*.2);x.lineTo(px+r*.32,py-r*.45);x.fill();
  x.beginPath();x.moveTo(px-r*.5,py+r*.15);x.lineTo(px+r*.5,py+r*.15);x.lineTo(px+r*.3,py+r*.45);x.lineTo(px,py+r*.3);x.lineTo(px-r*.3,py+r*.45);x.fill()}
function lights(t){const cols=["#ff3b30","#ffcc00","#34c759","#0a84ff","#ff9f0a"];let k=0;
  for(let s=0;s<ROOF.length-1;s++){const[a,b]=ROOF[s],[c2,d]=ROOF[s+1];const L=Math.hypot(c2-a,d-b),n=Math.floor(L/9);
    for(let i=0;i<=n;i++){const u=i/n,sag=Math.sin((i%4)/4*Math.PI)*2;const[px,py]=P(a+(c2-a)*u,b+(d-b)*u+2+sag);const on=.35+.65*(.5+.5*Math.sin(t*3+k*1.7));const col=cols[k%5];
      const g=x.createRadialGradient(px,py,0,px,py,7*K*.6+4);g.addColorStop(0,col);g.addColorStop(1,"rgba(0,0,0,0)");x.globalAlpha=on;x.fillStyle=g;x.fillRect(px-12,py-12,24,24);x.globalAlpha=1;x.fillStyle=col;x.beginPath();x.arc(px,py,1.1*K*.6+1,0,7);x.fill();k++}}}
function tree(t){const[bx0,by0]=P(62,398),h=78*K,w=48*K;x.fillStyle="#3b2412";x.fillRect(bx0-4*K*.6,by0-4,8*K*.6,10);
  x.fillStyle="#0f3d24";for(let j=0;j<3;j++){const y0=by0-h*(j*.28),y1=by0-h*(.45+j*.28),ww=w*(1-j*.25);x.beginPath();x.moveTo(bx0-ww/2,y0);x.lineTo(bx0+ww/2,y0);x.lineTo(bx0,y1);x.fill()}
  const cols=["#ff3b30","#ffcc00","#0a84ff","#ff2d55","#ffffff"];for(let i=0;i<22;i++){const u=(i*37%100)/100,yy=by0-h*u*.95,ww=w*(1-u)*.42;const xx=bx0+Math.sin(i*2.4)*ww;const on=.4+.6*(.5+.5*Math.sin(t*2.5+i));x.globalAlpha=on;x.fillStyle=cols[i%5];x.beginPath();x.arc(xx,yy,2.2,0,7);x.fill()}x.globalAlpha=1;
  const[sx,sy]=[bx0,by0-h*1.06];x.fillStyle="#ffd60a";x.beginPath();for(let i=0;i<10;i++){const a=i*Math.PI/5-Math.PI/2,r=i%2?3:7;x.lineTo(sx+Math.cos(a)*r,sy+Math.sin(a)*r)}x.fill()}
function sky(t){stars.forEach(s=>{const[px,py]=P(s.ix,s.iy);x.globalAlpha=.35+.65*(.5+.5*Math.sin(t*1.6+s.p));x.fillStyle="#fff";x.beginPath();x.arc(px,py,s.r,0,7);x.fill()});x.globalAlpha=1}

let t0=performance.now(),last=0,run=true;
function frame(now){
  if(!run)return;requestAnimationFrame(frame);
  if(now-last<33)return;const dt=Math.min(3,(now-last)/16.7);last=now;const t=(now-t0)/1000;
  x.setTransform(dpr,0,0,dpr,0,0);x.drawImage(base,0,0,W,H);
  const wind=Math.sin(t*.25)*.6;
  if(S==="halloween"){sky(t);const[mx,my]=P(622,52),mr=22*K;const g=x.createRadialGradient(mx,my,mr*.8,mx,my,mr*4);g.addColorStop(0,"rgba(255,236,190,.35)");g.addColorStop(1,"rgba(255,236,190,0)");x.fillStyle=g;x.fillRect(mx-mr*4,my-mr*4,mr*8,mr*8);x.fillStyle="#fff1c9";x.beginPath();x.arc(mx,my,mr,0,7);x.fill();x.fillStyle="rgba(200,180,140,.35)";[[-.3,-.2,.18],[.25,.15,.14],[-.05,.35,.1]].forEach(([a,b,r])=>{x.beginPath();x.arc(mx+a*mr,my+b*mr,r*mr,0,7);x.fill()});
    glowWin("#ff8c1a",.22+.06*Math.sin(t*7)*Math.sin(t*3.1));
    for(let i=0;i<4;i++){const fx=((t*18*(i%2?1:-1)+i*W/3)%(W*1.4)+W*1.4)%(W*1.4)-W*.2,fy=OY+(400+i*10)*K;const g2=x.createRadialGradient(fx,fy,0,fx,fy,W*.35);g2.addColorStop(0,"rgba(190,170,230,.16)");g2.addColorStop(1,"rgba(190,170,230,0)");x.fillStyle=g2;x.fillRect(fx-W*.35,fy-W*.35,W*.7,W*.7)}
    pumpkin(40,392,9,t,0);pumpkin(250,400,7,t,2);pumpkin(470,398,8,t,4);
    parts.forEach(b=>{b.x+=b.v*2*dt;if(b.x>W+40)b.x=-40;if(b.x<-40)b.x=W+40;bat(b,t)})}
  if(S==="xmas"){sky(t);glowWin("#ffb347",.26);lights(t);tree(t)}
  if(S==="summer"){const[sx,sy]=P(640,30);x.save();x.translate(sx,sy);x.rotate(t*.05);for(let i=0;i<12;i++){x.rotate(Math.PI/6);const g=x.createLinearGradient(0,0,0,H*.7);g.addColorStop(0,"rgba(255,240,190,.18)");g.addColorStop(1,"rgba(255,240,190,0)");x.fillStyle=g;x.beginPath();x.moveTo(-8,0);x.lineTo(8,0);x.lineTo(60,H*.7);x.lineTo(-60,H*.7);x.fill()}x.restore();
    const g=x.createRadialGradient(sx,sy,0,sx,sy,70*K*.5+40);g.addColorStop(0,"rgba(255,255,240,.95)");g.addColorStop(.3,"rgba(255,236,160,.6)");g.addColorStop(1,"rgba(255,220,120,0)");x.fillStyle=g;x.fillRect(sx-200,sy-200,400,400);
    parts.forEach(p=>{p.y-=p.v*dt;p.x+=Math.sin(t+p.p)*.3*dt;if(p.y<-5){p.y=H+5;p.x=R(0,W)}x.globalAlpha=.3+.4*(.5+.5*Math.sin(t*2+p.p));x.fillStyle="#fff7d6";x.beginPath();x.arc(p.x,p.y,p.r,0,7);x.fill()});x.globalAlpha=1}
  if(S==="winter"||S==="xmas"){x.fillStyle="#fff";parts.forEach(p=>{p.y+=p.v*dt*(.6+p.r*.25);p.x+=(Math.sin(t*.8+p.p)*.4+wind)*dt;if(p.y>H+5){p.y=-5;p.x=R(0,W)}if(p.x>W+5)p.x=-5;if(p.x<-5)p.x=W+5;x.globalAlpha=.55+p.r*.12;x.beginPath();x.arc(p.x,p.y,p.r,0,7);x.fill()});x.globalAlpha=1}
  if(S==="autumn")parts.forEach(l=>{l.y+=l.v*dt;l.x+=(Math.sin(t*1.2+l.p)*1.1+wind*1.5)*dt;l.rot+=l.vr*dt+Math.sin(t*2+l.p)*.01;if(l.y>H+20){l.y=-20;l.x=R(0,W)}if(l.x>W+20)l.x=-20;if(l.x<-20)l.x=W+20;leaf(l)});
  if(S==="spring"){parts.forEach(l=>{l.y+=l.v*dt;l.x+=(Math.sin(t+l.p)*.7+.4+wind)*dt;l.rot+=l.vr*dt;if(l.y>H+10){l.y=-10;l.x=R(-W*.2,W)}if(l.x>W+10)l.x=-10;petal(l)});
    flies.forEach((f,i)=>{const fx=W*(.5+.38*Math.sin(t*.13+f.p)),fy=H*(.55+.2*Math.sin(t*.21+f.p*2)),w=Math.abs(Math.sin(t*9+i))*7+2;x.fillStyle=i?"#fde047":"#f472b6";x.beginPath();x.ellipse(fx-w*.5,fy,w*.6,5,-.4,0,7);x.ellipse(fx+w*.5,fy,w*.6,5,.4,0,7);x.fill();x.fillStyle="#3f3f46";x.fillRect(fx-.8,fy-4,1.6,8)})}
}
function size(){dpr=Math.min(devicePixelRatio||1,1.5);W=innerWidth;H=innerHeight;c.width=W*dpr;c.height=H*dpr;K=Math.max(W/IW,H/IH);OX=(W-IW*K)/2;OY=(H-IH*K)*.55;drawBase();mk();last=0;if(RM)requestAnimationFrame(n=>{run=true;last=0;frame(n);run=false})}
let rt;addEventListener("resize",()=>{clearTimeout(rt);rt=setTimeout(size,150)});
document.addEventListener("visibilitychange",()=>{const v=document.visibilityState==="visible"&&!RM;if(v&&!run){run=true;requestAnimationFrame(frame)}else if(!v)run=false});
img.onload=()=>{drawBase();if(RM)size()};
size();if(!RM)requestAnimationFrame(frame);else run=false;
window.__wp={season:S};
})();

/* =========================================================
   La ville de Jarvis — maquette (nouvelle construction).
   creerVille(canvas, crochets) construit la scène et renvoie de quoi la piloter.
   ========================================================= */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
const FNT="'Plus Jakarta Sans',Helvetica,Arial,sans-serif";
// style de la ville : les titres en capitales espacées sont gravés à empattements (comme sur les façades)
const SERIF="'Cormorant Garamond',Georgia,'Times New Roman',serif";
const fontDe=(w,size,ls)=>ls>=3?`700 ${size*1.12}px ${SERIF}`:`${w} ${size}px ${FNT}`;

export async function creerVille(canvas, HK = {}) {


/* ============================================================
   OUTILS
   ============================================================ */
function rng(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function makeNoise(seed){const R=rng(seed),P=new Float32Array(65536);for(let i=0;i<65536;i++)P[i]=R();
  return (x,y)=>{const xi=Math.floor(x),yi=Math.floor(y),fx=x-xi,fy=y-yi,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
    const g=(i,j)=>P[(i&255)+((j&255)<<8)];const a=g(xi,yi),b=g(xi+1,yi),c=g(xi,yi+1),d=g(xi+1,yi+1);return a+(b-a)*sx+(c-a)*sy+(a-b-c+d)*sx*sy;};}
const sstep=(e0,e1,x)=>{const t=Math.min(1,Math.max(0,(x-e0)/(e1-e0)));return t*t*(3-2*t);};
const V=(x,y,z=0)=>new THREE.Vector3(x,y,z);
const R=rng(2024);

/* Tout est rangé par matière puis fusionné : peu d'appels de dessin, rapide sur téléphone */
const B={}; let CUR=new THREE.Matrix4(); let TINT=[1,1,1];
const SIGNS=[], HOLES=[], PL={}, BOXES=[], FLAGS=[], MESH={}, FDOOR=[]; let GATE=null;
function addBox(mat,W,H,D,id){const b=new THREE.Box3(); for(const x of [0,W])for(const y of [0,H])for(const z of [0,-D]) b.expandByPoint(V(x,y,z).applyMatrix4(mat)); BOXES.push({b,id});}
function sign(text,cx,cy,z,w,h,opt={}){SIGNS.push({text,m:CUR.clone().multiply(M(cx,cy,z)),w,h,opt});}
const _m=new THREE.Matrix4(), _q=new THREE.Quaternion(), _e=new THREE.Euler();
let OBK=null; const OBST=[];
function OB(type,x,z,fn){ OBK='ob'+OBST.length; OBST.push({type,p:V(x,.15,z),meshes:[],k:0,want:0}); fn(); OBK=null; }
function put(geo,key='clay',m=null){ if(OBK) key=OBK+'|'+key;
  const g=geo.index?geo.toNonIndexed():geo.clone();
  for(const k of Object.keys(g.attributes)) if(!['position','normal','uv'].includes(k)) g.deleteAttribute(k);
  if(!g.attributes.uv) g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(g.attributes.position.count*2),2));
  if(!g.attributes.normal) g.computeVertexNormals();
  _m.copy(CUR); if(m) _m.multiply(m); g.applyMatrix4(_m);
  const n=g.attributes.position.count, c=new Float32Array(n*3);
  for(let i=0;i<n;i++){c[i*3]=TINT[0];c[i*3+1]=TINT[1];c[i*3+2]=TINT[2];}
  g.setAttribute('color',new THREE.BufferAttribute(c,3)); g.clearGroups();
  (B[key]||(B[key]=[])).push(g);
}
function M(x=0,y=0,z=0,rx=0,ry=0,rz=0,sx=1,sy=1,sz=1){_e.set(rx,ry,rz);_q.setFromEuler(_e);return new THREE.Matrix4().compose(V(x,y,z),_q.clone(),V(sx,sy,sz));}
const UB=new THREE.BoxGeometry(1,1,1);
function box(x0,x1,y0,y1,z0,z1,key='clay'){put(UB,key,M((x0+x1)/2,(y0+y1)/2,(z0+z1)/2,0,0,0,Math.abs(x1-x0),Math.abs(y1-y0),Math.abs(z1-z0)));}
function ext(shape,depth,o={}){return new THREE.ExtrudeGeometry(shape,Object.assign({depth,bevelEnabled:false,curveSegments:16},o));}
function shapeOf(pts){const s=new THREE.Shape();s.moveTo(pts[0][0],pts[0][1]);for(let i=1;i<pts.length;i++)s.lineTo(pts[i][0],pts[i][1]);return s;}
// profil (saillie, hauteur) tiré le long de X sur une longueur L
function profileX(p,L){const s=Array.isArray(p)?shapeOf(p):p; const g=ext(s,L); g.rotateY(-Math.PI/2); g.translate(L,0,0); return g;}
function lathe(p,seg=24){return new THREE.LatheGeometry(p.map(q=>new THREE.Vector2(q[0],q[1])),seg);}
const Yax=V(0,1,0);
function cylBetween(a,b,r0,r1,seg=8,key='clay',open=true){const d=b.clone().sub(a),L=d.length();const g=new THREE.CylinderGeometry(r1,r0,L,seg,1,open);
  const q=new THREE.Quaternion().setFromUnitVectors(Yax,d.normalize()); put(g,key,new THREE.Matrix4().compose(a.clone().lerp(b,.5),q,V(1,1,1)));}

/* ============================================================
   MOULURES
   ============================================================ */
const CORN=[[0,0],[.05,0],[.05,.05],[.1,.07],[.13,.12],[.13,.15],[.2,.15],[.2,.17],[.44,.2],[.46,.25],[.46,.31],[.42,.32],[.44,.35],[.52,.4],[.56,.46],[.56,.5],[0,.5]];
const GFP=[[0,0],[.06,0],[.06,.05],[.13,.09],[.16,.16],[.16,.24],[0,.24]];
const SC=[[0,0],[.06,0],[.08,.03],[.08,.11],[.05,.14],[0,.14]];
const SMALLC=[[0,0],[.04,0],[.07,.05],[.12,.09],[.12,.13],[0,.13]];
const CONSOLE=(()=>{const s=new THREE.Shape();s.moveTo(0,0);s.lineTo(.06,0);s.bezierCurveTo(.13,.02,.05,.2,.12,.3);s.bezierCurveTo(.17,.38,.22,.4,.22,.46);s.lineTo(.22,.5);s.lineTo(0,.5);s.lineTo(0,0);return profileX(s,.12);})();
const BALUSTER=lathe([[0,0],[.05,0],[.05,.06],[.032,.08],[.036,.14],[.062,.27],[.052,.36],[.026,.45],[.03,.5],[.048,.54],[.048,.6],[0,.6]],10);
const KEY=(()=>shapeOf([[-.11,0],[.11,0],[.15,.34],[-.15,.34]]))();

/* ============================================================
   OUVERTURES (fenêtres, portes, vitrines, arcades)
   ============================================================ */
function opShape(cx,y0,w,h,top,d){
  const s=new THREE.Shape(), hw=w/2-d, yb=y0+d;
  if(top==='arch'){const yc=y0+h-w/2; s.moveTo(cx-hw,yb); s.lineTo(cx+hw,yb); s.lineTo(cx+hw,yc); s.absarc(cx,yc,hw,0,Math.PI,false); s.lineTo(cx-hw,yb);}
  else {const yt=y0+h-d; s.moveTo(cx-hw,yb); s.lineTo(cx+hw,yb); s.lineTo(cx+hw,yt); s.lineTo(cx-hw,yt); s.lineTo(cx-hw,yb);}
  return s;
}
function ring(o,a,depth,z0=0,key='clay'){const s=opShape(o.cx,o.y0,o.w,o.h,o.top,-a); s.holes.push(opShape(o.cx,o.y0,o.w,o.h,o.top,0)); put(ext(s,depth),key,M(0,0,z0));}
const glassKey=()=>R()<.2?'glassLit':'glass';
function casement(o,zf=0){
  const {cx,y0,w,h,top}=o, z=zf;
  const fr=opShape(cx,y0,w,h,top,0); fr.holes.push(opShape(cx,y0,w,h,top,.075)); put(ext(fr,.08),'clay',M(0,0,z-.2));
  put(new THREE.ShapeGeometry(opShape(cx,y0,w,h,top,.075),12),glassKey(),M(0,0,z-.17));
  const yt= top==='arch'? y0+h-w/2 : y0+h*.72;
  box(cx-.03,cx+.03,y0+.07,top==='arch'?y0+h-.08:y0+h-.07,z-.2,z-.11);
  box(cx-w/2+.07,cx+w/2-.07,yt-.035,yt+.035,z-.2,z-.11);
  for(const k of [1,2]){const yy=y0+.075+(yt-y0-.075)*k/3; box(cx-w/2+.07,cx+w/2-.07,yy-.015,yy+.015,z-.18,z-.14);}
  if(top==='arch'){const r=w/2-.07; for(const a of [Math.PI/4,3*Math.PI/4]) put(UB,'clay',M(cx+Math.cos(a)*r/2,yt+Math.sin(a)*r/2,z-.16,0,0,a,r,.03,.03));}
}
function sill(o){const {cx,y0,w}=o; box(cx-w/2-.22,cx+w/2+.22,y0-.11,y0+.0,0,.21); box(cx-w/2-.12,cx+w/2+.12,y0-.19,y0-.11,0,.1);}
function keystone(cx,yb,s=1){put(ext(KEY,.13),'clay',M(cx,yb,0,0,0,0,s,s,1));}
function console2(x,ytop,h=.5){put(CONSOLE,'clay',M(x-.06,ytop-h,0,0,0,0,1,h/.5,1));}
function head(o,style){
  const {cx,y0,w,h}=o, a=.15, yb=y0+h+a;
  if(style==='tri'||style==='seg'){
    const wp=w+.64, hp=.42; let outer, inner;
    if(style==='tri'){outer=shapeOf([[cx-wp/2,yb],[cx+wp/2,yb],[cx,yb+hp]]); inner=shapeOf([[cx-wp/2+.28,yb+.12],[cx+wp/2-.28,yb+.12],[cx,yb+hp-.1]]);}
    else{const Rr=(hp*hp+wp*wp/4)/(2*hp), yc=yb+hp-Rr, a0=Math.atan2(yb-yc,wp/2);
      outer=new THREE.Shape(); outer.moveTo(cx-wp/2,yb); outer.lineTo(cx+wp/2,yb); outer.absarc(cx,yc,Rr,a0,Math.PI-a0,false); outer.lineTo(cx-wp/2,yb);
      const r2=Rr-.12, yi=yb+.12, xh=Math.sqrt(r2*r2-(yi-yc)*(yi-yc)), a1=Math.atan2(yi-yc,xh);
      inner=new THREE.Shape(); inner.moveTo(cx-xh,yi); inner.lineTo(cx+xh,yi); inner.absarc(cx,yc,r2,a1,Math.PI-a1,false); inner.lineTo(cx-xh,yi);}
    const ringS=outer; ringS.holes.push(inner); put(ext(ringS,.24),'clay');
    const tymp=style==='tri'?shapeOf([[cx-wp/2+.28,yb+.12],[cx+wp/2-.28,yb+.12],[cx,yb+hp-.1]]):inner; put(ext(tymp,.07),'clay');
    box(cx-w/2-.15,cx+w/2+.15,yb-.02,yb+.0,0,.12);
  } else if(style==='cornice'){
    box(cx-w/2-.15,cx+w/2+.15,yb,yb+.14,0,.09);
    box(cx-w/2-.24,cx+w/2+.24,yb+.12,yb+.17,0,.18);
    box(cx-w/2-.32,cx+w/2+.32,yb+.17,yb+.29,0,.27);
    console2(cx-w/2-.24,yb+.13,.48); console2(cx+w/2+.24,yb+.13,.48);
  } else if(style==='keystone'){
    keystone(cx,y0+h-.12); box(cx-w/2-.2,cx+w/2+.2,yb,yb+.08,0,.12);
  } else if(style==='archkey'){
    keystone(cx,y0+h-.1); const ys=y0+h-w/2;
    for(const s of [-1,1]) box(cx+s*(w/2+.075)-.1,cx+s*(w/2+.075)+.1,ys-.09,ys+.06,0,.1);
  }
}
function shutters(o){
  const {cx,y0,w,h}=o, sw=w/2;
  for(const s of [-1,1]){
    const xa=cx+s*(w/2+.17), xb=xa+s*sw, x0=Math.min(xa,xb), x1=Math.max(xa,xb), xc=(x0+x1)/2;
    box(x0,x0+.05,y0,y0+h,.0,.07); box(x1-.05,x1,y0,y0+h,.0,.07);
    for(const yy of [y0,y0+h/2-.03,y0+h-.06]) box(x0,x1,yy,yy+.06,0,.07);
    for(let yy=y0+.1;yy<y0+h-.08;yy+=.075){ if(Math.abs(yy-(y0+h/2))<.06)continue; put(UB,'clay',M(xc,yy,.035,.6,0,0,sw-.1,.055,.012)); }
  }
}
function balustrade(x0,x1,y,zf,depth,sides=true){
  const top=y+.82;
  box(x0,x1,y,y+.08,zf-.07,zf+.07); box(x0-.03,x1+.03,top-.1,top,zf-.09,zf+.09);
  const n=Math.max(2,Math.round((x1-x0)/.17)); for(let i=0;i<=n;i++){const x=x0+(x1-x0)*i/n; if(i===0||i===n){box(x-.08,x+.08,y,top-.1,zf-.08,zf+.08);continue;} put(BALUSTER,'clay',M(x,y+.08,zf,0,0,0,1,(top-.18-y)/.6,1));}
  if(sides){for(const x of [x0,x1]){const m=Math.max(2,Math.round(depth/.17)); box(x-.07,x+.07,y,y+.08,zf-depth,zf); box(x-.07,x+.07,top-.1,top,zf-depth,zf);
    for(let i=1;i<m;i++){put(BALUSTER,'clay',M(x,y+.08,zf-depth*i/m,0,0,0,1,(top-.18-y)/.6,1));}}}
}
function awning(cx,w,ytop){
  const L=1.62, th=.38, aw=w;
  put(UB,'canvas',M(cx,ytop-.3,.75,th,0,0,aw,.025,L));
  // lambrequin festonné
  const s=new THREE.Shape(); const n=Math.max(4,Math.round(aw/.32)); s.moveTo(-aw/2,0); s.lineTo(aw/2,0); s.lineTo(aw/2,-.2);
  for(let i=n;i>0;i--){const x1=-aw/2+aw*(i-1)/n, xm=(-aw/2+aw*i/n+x1)/2; s.quadraticCurveTo(xm,-.36,x1,-.2);} s.lineTo(-aw/2,0);
  put(ext(s,.02),'canvas',M(cx,ytop-.6,1.5));
  // bras
  for(const sx of [-1,1]){cylBetween(V(cx+sx*(aw/2-.05),ytop-.9,.02),V(cx+sx*(aw/2-.05),ytop-.62,1.47),.018,.018,6,'metal',false);}
  box(cx-aw/2,cx+aw/2,ytop-.08,ytop+.06,0,.16,'metal');
}

/* ============================================================
   FAÇADE COMPLÈTE
   ============================================================ */
function spans(W,ops,y0,y1,pad){let iv=[[ -.0,W]];
  for(const o of ops){const top=o.y0+o.h+(o.kind==='shop'?.65:.25); if(o.y0-.25<y1 && top>y0){const a=o.cx-o.w/2-pad,b=o.cx+o.w/2+pad;
    iv=iv.flatMap(([p,q])=>{const r=[]; if(a>p)r.push([p,Math.min(q,a)]); if(b<q)r.push([Math.max(p,b),q]); return r.filter(([p2,q2])=>q2-p2>.03);});}}
  return iv;}
function facade(b,W,opt={}){
  const H=b.gf+b.floors*b.fh, m=(W-b.bays*b.bayW)/2, ww=b.winW||1.15, ops=[];
  const base=f=>b.gf+(f-1)*b.fh;
  for(let i=0;i<b.bays;i++){const cx=m+b.bayW*(i+.5);
    if(i===b.gateBay) ops.push({cx,y0:0,w:2.9,h:3.7,top:'arch',kind:'gate',i});
    else if(i===b.doorBay) ops.push({cx,y0:0,w:1.5,h:b.gf-.55,top:'arch',kind:'door',i});
    else if(b.gfType==='shop') ops.push({cx,y0:.55,w:b.bayW-.7,h:b.gf-1.45,top:'rect',kind:'shop',i});
    else if(b.gfType==='arches') ops.push({cx,y0:0,w:b.bayW-.95,h:b.gf-.5,top:'arch',kind:'arcade',i});
    else ops.push({cx,y0:1.0,w:ww,h:2.0,top:'rect',kind:'win',f:0,i});
    for(let f=1;f<=b.floors;f++){
      const bal=!!(b.balcony&&b.balcony.f===f&&(b.balcony.all||i===Math.floor(b.bays/2)));
      let h=f===1?b.fh*.58:(f===b.floors?b.fh*.5:b.fh*.55), y0=base(f)+.9;
      if(bal){y0=base(f)+.12; h=f===1?b.fh*.74:b.fh*.7;}
      const top=(b.win==='arch'||(b.win==='mixed'&&f===1))?'arch':'rect';
      ops.push({cx,y0,w:ww,h,top,kind:'win',f,i,bal});
    }
  }
  // mur percé (vraie épaisseur)
  const s=shapeOf([[0,0],[W,0],[W,H],[0,H]]); for(const o of ops) s.holes.push(opShape(o.cx,o.y0,o.w,o.h,o.top,0));
  put(ext(s,.3,{bevelEnabled:true,bevelThickness:.015,bevelSize:.015,bevelSegments:1}),'clay',M(0,0,-.3));
  // soubassement + bossages
  for(const [p,q] of spans(W,ops,0,.5,.2)) box(p,q,0,.5,-.02,.07);
  if(b.gfType!=='shop'){for(let y=.56;y<b.gf-.35;y+=.46) for(const [p,q] of spans(W,ops,y,y+.38,.22)) box(p+.01,q-.01,y,y+.39,-.02,.035);}
  // bandeaux
  put(profileX(GFP,W+.08),'clay',M(-.04,b.gf,0));
  for(let f=2;f<=b.floors;f++) put(profileX(SC,W+.04),'clay',M(-.02,base(f)+.6,0));
  // frise + corniche + denticules + retours
  box(0,W,H-.45,H,-.0,.03); put(profileX(SMALLC,W+.06),'clay',M(-.03,H-.48,0));
  put(profileX(CORN,W+.2),'clay',M(-.1,H,0));
  if(!opt.noDentils) for(let x=.1;x<W-.05;x+=.17) box(x,x+.08,H+.07,H+.15,.12,.2);
  if(!opt.noReturns){ const Lr=1.12; const g=profileX(CORN,Lr);
    put(g,'clay',M(-.1,H,-.6,0,-Math.PI/2,0)); put(g,'clay',M(W+.1,H,.52,0,Math.PI/2,0)); }
  // chaînes d'angle
  if(b.quoins && !opt.noQuoins){ let k=0; for(let y=.5;y<H-.6;y+=.5,k++){const wq=k%2?.55:.32, ws=k%2?.32:.55;
    box(-.04,wq,y,y+.45,-.1,.045); box(-.045,.1,y,y+.45,-ws,.045);
    box(W-wq,W+.04,y,y+.45,-.1,.045); box(W-.1,W+.045,y,y+.45,-ws,.045);} }
  // pilastres
  if(b.pil){ const xs=b.pil==='all'?[...Array(b.bays+1).keys()].map(i=>m+b.bayW*i):[m*.5,W-m*.5];
    for(const x of xs){ const pw=b.pil==='all'?.42:.5; box(x-pw/2,x+pw/2,b.gf+.24,H-.48,0,.09);
      box(x-pw/2-.05,x+pw/2+.05,b.gf+.24,b.gf+.45,0,.13); box(x-pw/2-.06,x+pw/2+.06,H-.7,H-.6,0,.14); box(x-pw/2-.03,x+pw/2+.03,H-.6,H-.48,0,.12);} }
  // balcon filant
  if(b.balcony&&b.balcony.all){ const f=b.balcony.f, y=base(f)+.12, x0=m-.15, x1=W-m+.15;
    box(x0-.1,x1+.1,y-.2,y,0,.85); put(profileX(SMALLC,x1-x0+.2),'clay',M(x0-.1,y-.33,0,0,0,0,1,1,1));
    for(let i=0;i<=b.bays;i++){console2(m+b.bayW*i-.0,y-.2,.55);} balustrade(x0,x1,y,.75,.75); }
  // détails de chaque ouverture
  for(const o of ops){
    if(o.kind==='win'){
      ring(o,.15,.06); ring(o,.07,.1); casement(o);
      if(!o.bal) sill(o);
      const st = (()=>{const w=b.win; if(o.f===0) return 'keystone';
        if(w==='pediment') return o.f===1?(o.i%2?'seg':'tri'):(o.f===b.floors?'keystone':'cornice');
        if(w==='segment') return o.f===b.floors?'keystone':'seg';
        if(w==='cornice') return o.f===b.floors?'keystone':'cornice';
        if(w==='simple') return 'none';
        if(w==='arch'||o.top==='arch') return 'archkey';
        return 'keystone';})();
      head(o,st);
      if(o.bal && !(b.balcony&&b.balcony.all)){ const y=o.y0-.0, x0=o.cx-o.w/2-.42, x1=o.cx+o.w/2+.42;
        box(x0-.08,x1+.08,y-.2,y,0,.78); console2(x0+.1,y-.2,.5); console2(x1-.1,y-.2,.5); balustrade(x0,x1,y,.68,.68); }
      if(b.shutters && o.top==='rect' && !o.bal && o.f>=1) shutters(o);
    } else if(o.kind==='door'){
      ring(o,.22,.08); ring(o,.1,.12); keystone(o.cx,o.y0+o.h-.12,1.2);
      const {cx,y0,w,h}=o, yt=y0+h-w/2;
      box(cx-w/2,cx+w/2,yt-.05,yt+.05,-.22,-.12);
      for(const s of [-1,1]){const x0=cx+s*.02, x1=cx+s*(w/2); const xa=Math.min(x0,x1),xb=Math.max(x0,x1);
        box(xa,xb,.15,yt-.05,-.25,-.18);
        box(xa+.1,xb-.1,.45,1.35,-.18,-.15); box(xa+.1,xb-.1,1.55,yt-.25,-.18,-.15);
        box(xa+.14,xb-.14,.49,1.31,-.15,-.13); box(xa+.14,xb-.14,1.59,yt-.29,-.15,-.13);}
      const fl=new THREE.Shape(); fl.moveTo(cx-w/2+.06,yt+.05); fl.lineTo(cx+w/2-.06,yt+.05); fl.absarc(cx,yt+.05,w/2-.06,0,Math.PI,false);
      put(new THREE.ShapeGeometry(fl,16),'glass',M(0,0,-.2));
      for(let k=1;k<6;k++){const a=Math.PI*k/6, r=w/2-.06; put(UB,'clay',M(cx+Math.cos(a)*r/2,yt+.05+Math.sin(a)*r/2,-.18,0,0,a,r,.025,.025));}
      box(cx-w/2-.35,cx+w/2+.35,-.02,.15,0,.42);
    } else if(o.kind==='gate'){
      ring(o,.24,.08); ring(o,.1,.13); keystone(o.cx,o.y0+o.h-.12,1.25);
      for(const s2 of [-1,1]){const xg=o.cx+s2*(o.w/2-.07); for(let k=0;k<10;k++){const z=-.38-k*.12; box(xg-.016,xg+.016,.08,2.5,z-.016,z+.016,'metal');}
        box(xg-.03,xg+.03,.08,.15,-1.6,-.32,'metal'); box(xg-.03,xg+.03,2.42,2.5,-1.6,-.32,'metal'); box(xg-.03,xg+.03,1.25,1.3,-1.6,-.32,'metal');}
      if(b.gateSign) sign(b.gateSign,o.cx,o.y0+o.h+.55,.1,2.2,.34,{size:64});
    } else if(o.kind==='shop'){
      const {cx,y0,w,h}=o, z=-.08;
      box(cx-w/2,cx-w/2+.09,y0,y0+h,z-.1,z); box(cx+w/2-.09,cx+w/2,y0,y0+h,z-.1,z);
      box(cx-w/2,cx+w/2,y0,y0+.1,z-.1,z+.04); box(cx-w/2,cx+w/2,y0+h-.09,y0+h,z-.1,z);
      const yt=y0+h*.78; box(cx-w/2,cx+w/2,yt-.04,yt+.04,z-.1,z);
      for(const k of [1,2]){const x=cx-w/2+w*k/3; box(x-.035,x+.035,y0,y0+h,z-.1,z);}
      for(let k=1;k<6;k++){const x=cx-w/2+w*k/6; if(k%2===0)continue; box(x-.015,x+.015,yt,y0+h,z-.08,z-.05);}
      put(new THREE.PlaneGeometry(w,h),glassKey(),M(cx,y0+h/2,z-.07));
      box(cx-w/2-.2,cx+w/2+.2,y0+h+.08,y0+h+.6,0,.12); put(profileX(SMALLC,w+.5),'clay',M(cx-w/2-.25,y0+h+.58,0));
      box(cx-w/2-.08,cx+w/2+.08,y0-.08,y0,0,.12);
      if(b.awn) awning(cx,w+.3,y0+h+.08);
      if(b.sign){const st=Array.isArray(b.sign)?b.sign[(o.i)%b.sign.length]:b.sign; if(st) sign(st,cx,y0+h+.34,.125,w+.2,.42,b.signOpt||{});}
    } else if(o.kind==='arcade'){
      ring(o,.22,.07); ring(o,.1,.11); keystone(o.cx,o.y0+o.h-.1,1.15);
      const ys=o.y0+o.h-o.w/2; for(const s of [-1,1]) box(o.cx+s*(o.w/2+.11)-.14,o.cx+s*(o.w/2+.11)+.14,ys-.12,ys+.06,0,.12);
      const io={...o,y0:o.y0+.9,h:o.h-.9}; casement(io,-.02); box(o.cx-o.w/2,o.cx+o.w/2,0,.9,-.24,-.16);
      box(o.cx-o.w/2+.1,o.cx+o.w/2-.1,.15,.78,-.16,-.13);
    }
  }
  return {H,ops,m};
}

/* ============================================================
   TOITS
   ============================================================ */
function seamsOnSlope(x0,x1,zA,yA,zB,yB,skip=[]){const L=Math.hypot(zB-zA,yB-yA), ang=-Math.atan2(zA-zB,yB-yA);
  for(let x=x0+.25;x<x1-.15;x+=.5){ if(skip.some(([a,b])=>x>a&&x<b))continue; put(UB,'roof',M(x,(yA+yB)/2+.02,(zA+zB)/2+.02,ang,0,0,.04,L,.04)); }}
function roofPrism(pts,W,Hr){const g=ext(shapeOf(pts),W); g.rotateY(Math.PI/2); put(g,'roof',M(0,Hr,0));}
function chimney(x,z,y0,h){box(x-.38,x+.38,y0,y0+h,z-.28,z+.28); box(x-.46,x+.46,y0+h,y0+h+.12,z-.36,z+.36); box(x-.42,x+.42,y0+h-.42,y0+h-.32,z-.32,z+.32);
  for(const dx of [-.17,.17]) put(new THREE.CylinderGeometry(.09,.1,.38,10),'clay',M(x+dx,y0+h+.31,z));}
function dormer(cx,Hr,style){
  const zf=-.05, w=1.5, y0=Hr+.2, y1=Hr+2.1;
  const s=shapeOf([[cx-w/2,y0],[cx+w/2,y0],[cx+w/2,y1],[cx-w/2,y1]]); const o={cx,y0:y0+.35,w:.8,h:1.25,top:style==='arch'?'arch':'rect',kind:'win'};
  s.holes.push(opShape(o.cx,o.y0,o.w,o.h,o.top,0)); put(ext(s,.15),'clay',M(0,0,zf-.15));
  const s2=opShape(o.cx,o.y0,o.w,o.h,o.top,-.1); s2.holes.push(opShape(o.cx,o.y0,o.w,o.h,o.top,0)); put(ext(s2,.05),'clay',M(0,0,zf));
  casement(o,zf); box(cx-.55,cx+.55,o.y0-.1,o.y0,zf,zf+.12);
  for(const sx of [-1,1]) box(cx+sx*w/2-(sx>0?.12:0),cx+sx*w/2+(sx<0?.12:0),y0,y1,-1.3,zf-.15,'roof');
  const pw=w+.3, ph=.62, tri=shapeOf([[cx-pw/2,y1],[cx+pw/2,y1],[cx,y1+ph]]);
  const rr=shapeOf([[cx-pw/2,y1],[cx+pw/2,y1],[cx,y1+ph]]); rr.holes.push(shapeOf([[cx-pw/2+.22,y1+.1],[cx+pw/2-.22,y1+.1],[cx,y1+ph-.09]]));
  put(ext(rr,.16),'clay',M(0,0,zf-.12)); put(ext(shapeOf([[cx-pw/2+.22,y1+.1],[cx+pw/2-.22,y1+.1],[cx,y1+ph-.09]]),.06),'clay',M(0,0,zf-.12));
  put(ext(shapeOf([[cx-pw/2-.04,y1-.02],[cx+pw/2+.04,y1-.02],[cx,y1+ph+.05]]),1.25),'roof',M(0,0,-1.35));
}
function roof(b,W,D,H,f,mat=null){
  if(mat) CUR=mat;
  const Hr=H+.5, dx=f.ops.filter(o=>o.f===b.floors).map(o=>o.cx);
  if(b.roof==='mansard'){
    roofPrism([[-.02,0],[1.0,2.7],[D/2,3.5],[D-1.0,2.7],[D+.02,0]],W,Hr);
    box(-.02,W+.02,Hr+2.62,Hr+2.8,-1.12,-.9,'roof');
    seamsOnSlope(0,W,.02,Hr,-1.0,Hr+2.7,dx.map(x=>[x-.85,x+.85]));
    for(const x of dx) dormer(x,Hr,b.win==='arch'?'arch':'rect');
    chimney(W*.25,-D/2,Hr+2.6,2.0); if(W>10) chimney(W*.78,-D/2-1,Hr+2.6,1.8);
  } else if(b.roof==='gable'){
    const hr=Math.min(4.2,D*.36);
    roofPrism([[-.12,0],[D/2,hr],[D+.12,0]],W,Hr);
    seamsOnSlope(0,W,.12,Hr,-D/2,Hr+hr);
    put(new THREE.CylinderGeometry(.1,.1,W+.1,10),'roof',M(W/2,Hr+hr+.02,-D/2,0,0,Math.PI/2));
    chimney(W*.7,-D/2+.6,Hr+hr-1.2,2.1);
    for(const x of dx.filter((_,i)=>i%2===0)) {}
  } else if(b.roof==='hip'){
    const h=Math.min(4.5,D*.38), o=.15, Ww=W+2*o, Dd=D+2*o;
    const a=[-o,0,o],bb=[W+o,0,o],c=[W+o,0,-D-o],d=[-o,0,-D-o]; let r1,r2;
    if(Ww>=Dd){r1=[-o+Dd/2,h,-D/2]; r2=[W+o-Dd/2,h,-D/2];} else {r1=[W/2,h,o-Ww/2]; r2=[W/2,h,-D-o+Ww/2];}
    const P=[]; const tri=(p,q,r)=>P.push(...p,...q,...r);
    if(Ww>=Dd){tri(a,bb,r2);tri(a,r2,r1);tri(bb,c,r2);tri(c,d,r1);tri(c,r1,r2);tri(d,a,r1);}
    else {tri(a,bb,r1);tri(bb,c,r2);tri(bb,r2,r1);tri(c,d,r2);tri(d,a,r1);tri(d,r1,r2);}
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(P,3)); g.computeVertexNormals(); put(g,'roof',M(0,Hr,0));
    if(Ww>=Dd) seamsOnSlope(Dd/2-o,W-Dd/2+o,o,Hr,-D/2,Hr+h);
    chimney(W*.3,-D/2-.5,Hr+h-1.4,2.2);
    if(b.hall){ // lanterneau
      const cx=W/2, cz=-D/2, y=Hr+h-.3;
      put(lathe([[0,0],[1.3,0],[1.3,.5],[1.4,.6],[1.4,.75],[0,.75]],8),'clay',M(cx,y,cz,0,Math.PI/8,0));
      for(let i=0;i<8;i++){const an=i/8*Math.PI*2; box(cx+Math.cos(an)*1.1-.12,cx+Math.cos(an)*1.1+.12,y+.75,y+2.4,cz+Math.sin(an)*1.1-.12,cz+Math.sin(an)*1.1+.12);}
      put(lathe([[.7,0],[.72,1.6],[0,1.6]],16),'glass',M(cx,y+.75,cz));
      put(lathe([[0,0],[1.45,0],[1.45,.15],[1.3,.25],[1.3,.4],[0,.4]],8),'clay',M(cx,y+2.4,cz,0,Math.PI/8,0));
      put(lathe([[1.25,0],[1.2,.3],[1.0,.75],[.6,1.1],[.2,1.3],[.15,1.6],[.25,1.7],[.08,1.9],[.1,2.2],[0,2.3]],24),'roof',M(cx,y+2.8,cz));
    }
  } else if(b.roof==='flat'){
    box(0,W,Hr-.5,Hr+.05,-D+.2,-.05,'roof');
    balustrade(.35,W-.35,Hr,-.25,0,false);
    for(const x of [.35,W-.35]) balustrade(x,x,Hr,-.25,D-1.0,true);
    // héliport
    const hx=W/2, hz=-D*.55; put(new THREE.CylinderGeometry(3.4,3.4,.22,40),'roof',M(hx,Hr+.16,hz)); put(new THREE.TorusGeometry(2.9,.07,6,48),'metal',M(hx,Hr+.28,hz,Math.PI/2,0,0));
    box(hx-1.0,hx-.7,Hr+.27,Hr+.31,hz-1.2,hz+1.2,'metal'); box(hx+.7,hx+1.0,Hr+.27,Hr+.31,hz-1.2,hz+1.2,'metal'); box(hx-.7,hx+.7,Hr+.27,Hr+.31,hz-.15,hz+.15,'metal');
    box(W*.12,W*.12+2.2,Hr,Hr+1.8,-D+1.2,-D+3.4,'roof'); for(let k=0;k<5;k++) box(W*.12+.1,W*.12+2.1,Hr+.3+k*.3,Hr+.35+k*.3,-D+1.15,-D+1.2,'metal');
    chimney(W*.85,-D+1.5,Hr-.2,1.6);
  } else if(b.roof==='dutch' || b.roof==='tower'){
    const hg=b.roof==='dutch'?3.8:W*.3;
    const g=ext(shapeOf([[-.12,0],[W/2,hg-.3],[W+.12,0]]),D-.3); put(g,'roof',M(0,Hr,-D));
    put(new THREE.CylinderGeometry(.1,.1,D-.3,10),'roof',M(W/2,Hr+hg-.28,-D/2-.15,Math.PI/2,0,0));
    chimney(W/2,-D*.7,Hr+hg-1.8,2.0);
    if(b.roof==='dutch'){
      const hw=(W-.9)/2, cx=W/2, pts=[];
      const bz=(p0,p1,p2,p3,n=10)=>{for(let i=1;i<=n;i++){const t=i/n,u=1-t;pts.push([u*u*u*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t*t*t*p3[0],u*u*u*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t*t*t*p3[1]]);}};
      pts.push([-hw,0],[-hw,.55]);
      bz([-hw,.55],[-hw,1.3],[-hw*.6,.95],[-hw*.6,1.6]);
      pts.push([-hw*.6,2.5]);
      bz([-hw*.6,2.5],[-hw*.6,2.9],[-hw*.36,2.85],[-hw*.32,3.12]);
      bz([-hw*.32,3.12],[-hw*.26,3.5],[-.3,hg],[0,hg]);
      const full=[...pts, ...pts.slice(0,-1).reverse().map(p=>[-p[0],p[1]])].map(p=>[p[0]+cx,p[1]+Hr]);
      const gs=shapeOf(full); const go={cx,y0:Hr+.5,w:1.1,h:1.9,top:'arch',kind:'win'};
      gs.holes.push(opShape(go.cx,go.y0,go.w,go.h,'arch',0));
      const oc=new THREE.Path(); oc.absarc(cx,Hr+3.05,.32,0,Math.PI*2,true); gs.holes.push(oc);
      put(ext(gs,.32,{bevelEnabled:true,bevelThickness:.015,bevelSize:.015,bevelSegments:1}),'clay',M(0,0,-.35));
      const path=new THREE.CatmullRomCurve3(full.slice(1,-1).map(p=>V(p[0],p[1],-.12)),false,'centripetal');
      put(new THREE.TubeGeometry(path,220,.17,8,false),'clay');
      const path2=new THREE.CatmullRomCurve3(full.slice(2,-2).map(p=>V(cx+(p[0]-cx)*.94,Hr+(p[1]-Hr)*.94-.05,.02)),false,'centripetal');
      put(new THREE.TubeGeometry(path2,220,.05,6,false),'clay');
      ring(go,.13,.07); casement(go); sill(go); head(go,'archkey');
      put(new THREE.TorusGeometry(.4,.07,8,32),'clay',M(cx,Hr+3.05,-.02));
      put(new THREE.CircleGeometry(.32,24),'glass',M(cx,Hr+3.05,-.2));
      put(lathe([[0,0],[.18,0],[.18,.06],[.1,.12],[.16,.3],[.12,.42],[.04,.5],[.06,.6],[0,.7]],16),'clay',M(cx,Hr+hg+.05,-.12));
      for(const sx of [-1,1]) put(lathe([[0,0],[.14,0],[.14,.05],[.08,.1],[.12,.25],[0,.38]],12),'clay',M(cx+sx*hw*.6,Hr+2.55,-.12));
    } else {
      const hp=hg, al=Math.atan2(hp,W/2), Ls=Math.hypot(W/2,hp)+.3;
      put(ext(shapeOf([[.0,0],[W,0],[W/2,hp]]),.3),'clay',M(0,Hr,-.33));
      const rc=profileX([[0,0],[.06,0],[.1,.05],[.26,.1],[.3,.16],[.3,.22],[0,.22]],Ls);
      put(rc,'clay',M(-.12,Hr+.02,0,0,0,al)); put(rc,'clay',M(W/2,Hr+hp+.12,0,0,0,-al));
      const to={cx:W/2,y0:Hr+.45,w:.9,h:1.4,top:'arch',kind:'win'};
      // fenêtre dans le fronton (percement simulé : cadre + vitre devant le mur)
      put(new THREE.ShapeGeometry(opShape(to.cx,to.y0,to.w,to.h,'arch',.07),12),'glass',M(0,0,.0));
      ring(to,.12,.06); const fr=opShape(to.cx,to.y0,to.w,to.h,'arch',0); fr.holes.push(opShape(to.cx,to.y0,to.w,to.h,'arch',.07)); put(ext(fr,.04),'clay',M(0,0,0));
      box(to.cx-.025,to.cx+.025,to.y0,to.y0+to.h-.06,0,.04); keystone(to.cx,to.y0+to.h-.1);
      put(lathe([[0,0],[.16,0],[.16,.06],[.1,.12],[.14,.3],[.1,.4],[0,.55]],14),'clay',M(W/2,Hr+hp+.2,-.05));
    }
  }
}

/* ============================================================
   BÂTIMENT
   ============================================================ */
function building(b,mat,side=null){
  CUR=mat; TINT=b.tint||[1,1,1];
  const W=b.W, D=b.D||12;
  const f=facade(b,W);
  const go=f.ops.find(o=>o.kind==='gate');
  if(go){ const a=go.cx-1.62, c=go.cx+1.62, Dt=D-.35;
    box(0,a,0,f.H,-D+.32,-.32); box(c,W,0,f.H,-D+.32,-.32); box(a,c,3.85,f.H,-D+.32,-.32);
    // rampe vers le garage du sous-sol
    for(const x of [a,c-.2]) box(x,x+.2,-2.9,3.85,-Dt,-.3);
    box(a,c,3.62,3.85,-5.9,-.3); box(a,c,0,3.85,-6.1,-5.9); box(a,c,0,.3,-Dt,-5.9);
    const L=Math.hypot(6.65,2.6), an=-Math.atan2(2.6,6.65); put(UB,'asphalt',M(go.cx,-1.3-.1,-.35-3.325,an,0,0,c-a-.4,.2,L));
    box(a+.2,c-.2,-2.8,-2.6,-Dt,-7.0,'asphalt'); box(a,c,-2.9,3.85,-Dt-.2,-Dt);
    box(go.cx-1.3,go.cx+1.3,-2.6,-.25,-Dt+.02,-Dt+.06,'metal'); for(let y=-2.45;y<-.3;y+=.22) box(go.cx-1.3,go.cx+1.3,y,y+.03,-Dt+.06,-Dt+.08,'metal');
    box(go.cx-.5,go.cx+.5,-.12,0,-Dt+.4,-Dt+.7,'lamp');
    const p0=V(go.cx-1.6,0,-Dt).applyMatrix4(mat), p1=V(go.cx+1.6,0,0).applyMatrix4(mat); HOLES.push([Math.min(p0.x,p1.x),Math.max(p0.x,p1.x),Math.min(p0.z,p1.z),Math.max(p0.z,p1.z)]);
    GATE=V(go.cx,0,-Dt).applyMatrix4(mat); GATE.userData={mat:mat.clone(),cx:go.cx,Dt};
  } else box(0,W,0,f.H,-D+.32,-.32);
  // façade arrière (cour) plus simple
  const bb=Object.assign({},b,{gfType:'rustic',win:'simple',doorBay:-1,awn:false,balcony:null,shutters:false,pil:false,quoins:false,winW:1.0});
  CUR=mat.clone().multiply(M(W,0,-D,0,Math.PI,0)); facade(bb,W,{noQuoins:true,noReturns:true,noDentils:true}); CUR=mat;
  roof(b,W,D,f.H,f);
  if(b.hall) townHallExtras(b,W,f);
  if(b.extra){ CUR=mat; b.extra(W,f,D); }
  if(b.place) PL[b.place]={mat:mat.clone(),W,D,H:f.H,...(b.placeOpt||{})};
  addBox(mat,W,f.H+(b.roof==='flat'?1.5:4.2),D,b.place||null);
  if(side){ const sb=Object.assign({},b,{bays:Math.floor((D-1.2)/2.9),bayW:2.9,doorBay:-1,awn:false,balcony:null,gfType:'rustic',shutters:false,pil:false});
    const sw=D-.4; CUR=mat.clone().multiply(side==='left'?M(0,0,-D,0,-Math.PI/2,0):M(W,0,-.4,0,Math.PI/2,0));
    facade(sb,sw,{noQuoins:true,noReturns:true}); }
  CUR=new THREE.Matrix4(); TINT=[1,1,1];
}
function townHallExtras(b,W,f){
  const H=f.H, cx=W/2, wp=b.bayW*3+.8, hp=2.3, Hr=H+.5;
  // avant-corps : fronton central avec horloge
  put(ext(shapeOf([[cx-wp/2,0],[cx+wp/2,0],[cx,hp]]),.35),'clay',M(0,Hr,-.2));
  const Ls=Math.hypot(wp/2,hp)+.25, al=Math.atan2(hp,wp/2);
  const rc=profileX([[0,0],[.06,0],[.1,.05],[.3,.1],[.34,.18],[.34,.26],[0,.26]],Ls);
  put(rc,'clay',M(cx-wp/2-.1,Hr+.02,.1,0,0,al)); put(rc,'clay',M(cx,Hr+hp+.16,.1,0,0,-al));
  sign('MAIRIE',cx,H-.22,.035,3.2,.36,{size:70});
  sign('LIBERTÉ · ÉGALITÉ · FRATERNITÉ',cx,b.gf+.45,.17,5.6,.3,{size:56});
  const cy=Hr+1.0;
  put(new THREE.CylinderGeometry(.68,.68,.1,48),'clay',M(cx,cy,.25,Math.PI/2,0,0));
  put(new THREE.TorusGeometry(.72,.07,10,48),'clay',M(cx,cy,.3));
  for(let i=0;i<12;i++){const a=i/12*Math.PI*2; put(UB,'metal',M(cx+Math.cos(a)*.56,cy+Math.sin(a)*.56,.32,0,0,a,i%3?.08:.16,.035,.02));}
  put(UB,'metal',M(cx+.12,cy+.16,.34,0,0,.92,.06,.42,.02)); put(UB,'metal',M(cx-.18,cy+.04,.35,0,0,1.8,.05,.55,.02));
  put(lathe([[0,0],[.22,0],[.22,.08],[.12,.16],[.2,.4],[.14,.55],[.05,.65],[.08,.78],[0,.9]],16),'clay',M(cx,Hr+hp+.25,.1));
  for(const sx of [-1,1]) put(lathe([[0,0],[.2,0],[.2,.06],[.1,.12],[.16,.35],[0,.55]],14),'clay',M(cx+sx*(wp/2-.1),Hr+.05,.1));
  // drapeau
  cylBetween(V(cx,Hr+hp+1.0,.1),V(cx,Hr+hp+3.4,.1),.03,.03,8,'metal',false);
  FLAGS.push({m:CUR.clone().multiply(M(cx+.03,Hr+hp+3.05,.1)),w:1.15,h:.75});
  // escalier d'honneur
  const dc=f.ops.find(o=>o.kind==='door').cx; for(let k=0;k<3;k++) box(dc-2.2+k*.25,dc+2.2-k*.25,-.15+k*.15,k*.15+.0,0,1.3-k*.35);
}

/* ============================================================
   MOBILIER URBAIN
   ============================================================ */
function _treeAt(x,z,seed,scale=1){
  const r=rng(seed); const seg=(a,bv,r0,r1)=>cylBetween(a,bv,r0,r1,6,'clay',true);
  const perp=d=>{const p=Math.abs(d.y)<.9?V(0,1,0):V(1,0,0); return p.cross(d).normalize();};
  function br(p,dir,len,rad,depth){
    let cur=p.clone(), d=dir.clone(); const n=2;
    for(let s=0;s<n;s++){d.add(V((r()-.5)*.3,(r()-.5)*.1+.05,(r()-.5)*.3)).normalize(); const nx=cur.clone().addScaledVector(d,len/n);
      seg(cur,nx,rad*(1-s/n*.3),rad*(1-(s+1)/n*.3)); cur=nx;}
    if(depth<=0)return;
    const k=2+(r()<(depth>3?.5:.3)?1:0);
    for(let i=0;i<k;i++){const nd=d.clone().applyAxisAngle(perp(d),.35+r()*.5).applyAxisAngle(d,i/k*Math.PI*2+r()*1.2); br(cur,nd,len*(.66+r()*.12),rad*.6,depth-1);}
  }
  br(V(x,.15,z),V(0,1,0),2.4*scale,.12*scale,6);
  put(new THREE.CylinderGeometry(.22,.3,.3,10),'clay',M(x,.2,z));
  for(const s of [-1,1]){box(x-.7,x+.7,.15,.19,z+s*.65-.05,z+s*.65+.05,'metal'); box(x+s*.65-.05,x+s*.65+.05,.15,.19,z-.7,z+.7,'metal');}
  for(let i=-2;i<=2;i++) box(x+i*.25-.015,x+i*.25+.015,.15,.18,z-.6,z+.6,'metal');
}
const LBASE=lathe([[0,0],[.24,0],[.24,.08],[.18,.12],[.17,.32],[.2,.36],[.14,.44],[.11,.62],[0,.62]],20);
const LPOST=(()=>{const g=new THREE.CylinderGeometry(.055,.075,3.0,24,8,true); const p=g.attributes.position; for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i),a=Math.atan2(z,x),k=Math.cos(a*12)>0?1:.88; p.setX(i,x*k);p.setZ(i,z*k);} g.computeVertexNormals(); return g;})();
function _lampAt(x,z){
  put(LBASE,'metal',M(x,.15,z)); put(LPOST,'metal',M(x,.77+1.5,z));
  put(new THREE.TorusGeometry(.085,.025,8,20),'metal',M(x,1.15,z,Math.PI/2,0,0)); put(new THREE.TorusGeometry(.07,.022,8,20),'metal',M(x,3.6,z,Math.PI/2,0,0));
  put(lathe([[0,0],[.06,0],[.13,.12],[.19,.16],[.19,.2],[0,.2]],16),'metal',M(x,3.77,z));
  put(new THREE.BoxGeometry(.3,.5,.3),'lamp',M(x,4.22,z,0,Math.PI/4,0));
  for(let i=0;i<4;i++){const a=i/4*Math.PI*2; put(UB,'metal',M(x+Math.cos(a)*.21,4.22,z+Math.sin(a)*.21,0,-a,0,.03,.52,.03));}
  put(lathe([[0,0],[.3,0],[.3,.04],[.08,.3],[0,.3]],4),'metal',M(x,4.47,z));
  put(new THREE.SphereGeometry(.06,12,8),'metal',M(x,4.82,z));
}
const BENCH_END=(()=>{const s=shapeOf([[0,0],[.07,0],[.1,.36],[.5,.4],[.56,0],[.63,0],[.6,.44],[.68,.86],[.61,.88],[.52,.47],[.07,.47],[0,.42]]); return ext(s,.05);})();
function _benchAt(x,z,rot){
  const mat=M(x,.15,z,0,rot,0);
  for(const sx of [-.82,.77]){ const m=mat.clone().multiply(M(sx,0,0,0,Math.PI/2,0)); put(BENCH_END,'metal',m); }
  for(let i=0;i<4;i++) put(UB,'wood',mat.clone().multiply(M(0,.47,.08+i*.12-.0 -.25,0,0,0,1.8,.04,.09)));
  for(let i=0;i<3;i++){const t=.55+i*.13; put(UB,'wood',mat.clone().multiply(M(0,t,-.4-(t-.55)*.35,-.35,0,0,1.8,.09,.035)));}
}
function _bollardAt(x,z){put(lathe([[0,0],[.11,0],[.11,.05],[.085,.08],[.075,.72],[.09,.76],[.065,.82],[.03,.88],[0,.9]],16),'metal',M(x,.15,z));}
function _hydrantAt(x,z){put(lathe([[0,0],[.15,0],[.15,.05],[.11,.08],[.11,.55],[.13,.57],[.13,.62],[.09,.68],[.05,.74],[.03,.8],[0,.82]],18),'metal',M(x,.15,z));
  for(const s of [-1,1]) cylBetween(V(x,.6,z),V(x+s*.22,.6,z),.045,.045,10,'metal',false);}
const treeAt=(x,z,sd,sc)=>OB('tree',x,z,()=>_treeAt(x,z,sd,sc)), lampAt=(x,z)=>OB('lamp',x,z,()=>_lampAt(x,z)), benchAt=(x,z,r)=>OB('bench',x,z,()=>_benchAt(x,z,r)),
  bollardAt=(x,z)=>OB('bollard',x,z,()=>_bollardAt(x,z)), hydrantAt=(x,z)=>OB('bollard',x,z,()=>_hydrantAt(x,z)), cafeAt=(x,z)=>OB('cafe',x,z,()=>_cafeAt(x,z));
function _cafeAt(x,z){
  put(lathe([[0,0],[.22,0],[.22,.03],[.05,.06],[.035,.7],[.05,.72],[0,.72]],16),'metal',M(x,.15,z)); put(new THREE.CylinderGeometry(.34,.34,.03,32),'clay',M(x,.88,z));
  for(let k=0;k<3;k++){const a=k/3*Math.PI*2+.4, cx=x+Math.cos(a)*.62, cz=z+Math.sin(a)*.62;
    put(new THREE.CylinderGeometry(.19,.19,.035,20),'clay',M(cx,.62,cz));
    for(let l=0;l<4;l++){const b=l/4*Math.PI*2+.78; cylBetween(V(cx+Math.cos(b)*.13,.6,cz+Math.sin(b)*.13),V(cx+Math.cos(b)*.17,.15,cz+Math.sin(b)*.17),.012,.012,6,'metal',false);}
    const ox=Math.cos(a)*.17, oz=Math.sin(a)*.17; put(new THREE.TorusGeometry(.17,.012,6,20,Math.PI),'metal',M(cx+ox,.64+.0,cz+oz,0,-a+Math.PI/2,0,1,1.4,1));
  }
}
function fountainAt(x,z){
  put(lathe([[0,0],[3.1,0],[3.1,.12],[3.2,.18],[3.2,.55],[3.05,.62],[2.85,.62],[2.8,.2],[0,.2]],8),'clay',M(x,.15,z,0,Math.PI/8,0));
  put(new THREE.CircleGeometry(2.85,8),'water',M(x,.6,z,-Math.PI/2,0,Math.PI/8));
  put(lathe([[0,0],[.55,0],[.55,.2],[.4,.3],[.32,.6],[.26,1.3],[.36,1.42],[.5,1.48],[1.1,1.6],[1.35,1.72],[1.38,1.85],[1.25,1.86],[.4,1.74],[.18,1.9],[.14,2.5],[.24,2.6],[.2,2.68],[.08,2.8],[.12,2.95],[0,3.1]],32),'clay',M(x,.2,z));
  put(new THREE.CircleGeometry(1.22,32),'water',M(x,2.0,z,-Math.PI/2,0,0));
  for(let i=0;i<4;i++){const a=i/4*Math.PI*2+Math.PI/4; put(lathe([[0,0],[.18,0],[.18,.06],[.1,.12],[.14,.3],[0,.48]],12),'clay',M(x+Math.cos(a)*3.0,.77,z+Math.sin(a)*3.0));}
}
// petite voiture ancienne (inventée)
function carAt(x,z,rot,y=0){
  CUR=M(x,y,z,0,rot,0);
  const loft=(x0,x1,nU,sec,key)=>{const NV=28,pos=[],idx=[],uv=[];
    for(let i=0;i<=nU;i++){const u=i/nU, X=x0+(x1-x0)*u, s=sec(u*2-1); for(let j=0;j<=NV;j++){const a=j/NV*Math.PI*2,c=Math.cos(a),sn=Math.sin(a),e=2/s.n;
      pos.push(X, s.yc+s.hh*Math.sign(sn)*Math.pow(Math.abs(sn),e), s.w*Math.sign(c)*Math.pow(Math.abs(c),e)); uv.push(u,j/NV);}}
    for(let i=0;i<nU;i++)for(let j=0;j<NV;j++){const A=i*(NV+1)+j,Bq=A+NV+1; idx.push(A,Bq,A+1,Bq,Bq+1,A+1);}
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); g.setIndex(idx); g.computeVertexNormals(); put(g,key);};
  const close=u=>Math.pow(Math.max(0,1-Math.pow(Math.abs(u),7)),.32);
  loft(-1.75,1.75,48,u=>{const f=close(u), bump=.06*(Math.exp(-Math.pow((u-.62)/.17,2))+Math.exp(-Math.pow((u+.62)/.17,2)));
    const yb=.33+.08*sstep(.75,1,Math.abs(u)), yt=.83-.28*sstep(.5,1,u)-.12*sstep(.6,1,-u);
    return {yc:(yb+yt)/2, hh:(yt-yb)/2*f, w:(.7+bump)*(1-.18*sstep(.75,1,Math.abs(u)))*f, n:3.2};},'car');
  loft(-.95,.5,30,u=>{const f=close(u*1.02); return {yc:1.0, hh:.34*f, w:(.6-.05*(u+1)/2)*Math.pow(f,.6), n:4.5};},'glass');
  loft(-.97,.52,30,u=>{const f=close(u*1.02); return {yc:1.27, hh:.1*f, w:(.62-.05*(u+1)/2)*Math.pow(f,.6), n:5};},'car');
  for(const px of [-.92,-.2,.44]) for(const s of [-1,1]) put(UB,'car',M(px,1.02,s*.56,s*.08,0,0,.07,.5,.04));
  for(const wx of [-1.12,1.12]) for(const s of [-1,1]){put(new THREE.TorusGeometry(.21,.095,12,28),'tyre',M(wx,.3,s*.64)); put(lathe([[0,0],[.17,0],[.15,.05],[.06,.09],[0,.1]],20),'car',M(wx,.3,s*(.66+.04),s*Math.PI/2,0,0));}
  for(const s of [-1,1]){ const pts=[V(s*1.78,.4,-.55),V(s*1.86,.4,-.3),V(s*1.88,.4,0),V(s*1.86,.4,.3),V(s*1.78,.4,.55)]; put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),30,.045,8),'car'); }
  for(const s of [-1,1]){ put(lathe([[0,0],[.1,0],[.11,.06],[0,.07]],20),'car',M(1.55,.66,s*.45,0,0,-Math.PI/2)); put(new THREE.CircleGeometry(.085,20),'glass',M(1.62,.66,s*.45,0,Math.PI/2,0));}
  for(let i=-3;i<=3;i++) box(1.68,1.72,.45,.62,i*.05-.012,i*.05+.012,'car');
  put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-1.6,.6,.69),V(0,.62,.73),V(1.5,.6,.66)]),40,.012,6),'car');
  put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-1.6,.6,-.69),V(0,.62,-.73),V(1.5,.6,-.66)]),40,.012,6),'car');
  for(const s of [-1,1]) box(-.1,.06,.7,.73,s*.715-.015,s*.715+.015,'car');
  CUR=new THREE.Matrix4();
}


/* ============================================================
   LES LIEUX JARVIS — nouvelle construction
   ============================================================ */

// La Banque (Ton argent) : temple à colonnes, en retrait derrière son portique
const COLSHAFT=(()=>{const g=new THREE.CylinderGeometry(.33,.38,7.08,40,6,true); const p=g.attributes.position;
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i),a=Math.atan2(z,x),k=1-.05*(.5+.5*Math.cos(a*20)); p.setX(i,x*k); p.setZ(i,z*k);} g.computeVertexNormals(); return g;})();
function column(x,z,y0,key='clay'){
  put(lathe([[0,0],[.55,0],[.55,.14],[.5,.18],[.52,.26],[.43,.34],[.4,.38],[0,.38]],32),key,M(x,y0,z));
  put(COLSHAFT,key,M(x,y0+.38+3.54,z));
  put(lathe([[0,0],[.34,0],[.37,.05],[.34,.09],[.44,.2],[.54,.32],[0,.32]],32),key,M(x,y0+7.46,z));
  box(x-.6,x+.6,y0+7.78,y0+8.0,z-.6,z+.6,key);
}
function bank(mat){
  CUR=mat; TINT=[1,.995,.985]; const W=14.2, D=14, rec=3.0, y0=.9, Hc=y0+8.0;
  const spec={bays:5,bayW:2.6,floors:1,gf:4.6,fh:3.8,gfType:'arches',win:'arch',doorBay:2};
  CUR=mat.clone().multiply(M(0,y0,-rec)); const f=facade(spec,W,{noReturns:true,noDentils:true});
  CUR=mat; box(0,W,0,Hc+1.2,-D,-rec-.32);
  // podium + marches
  box(-.3,W+.3,0,y0,-rec,-1.0);
  for(let k=0;k<4;k++) box(.6,W-.6,0,y0-.225*k,-1.0+.3*k,-.7+.3*k);
  for(const x of [-.3,W-.3]) box(x,x+.6,0,y0+.25,-rec,-.0);
  // six colonnes
  const colX=[]; for(let i=0;i<6;i++){const x=1.0+i*(W-2)/5; colX.push(x); column(x,-1.7,y0,'bcol'+i);}
  // entablement : architrave, frise gravée, corniche
  box(-.05,W+.05,Hc,Hc+.55,-rec,-1.05); box(-.05,W+.05,Hc+.42,Hc+.5,-1.1,-1.02);
  box(-.05,W+.05,Hc+.55,Hc+1.2,-rec,-1.15);
  sign('LA BANQUE POSTALE',W/2,Hc+.875,-1.13,8.5,.48,{size:70});
  const cs=1.2; put(profileX(CORN,W+.3),'clay',M(-.15,Hc+1.2,-1.15,0,0,0,1,cs,cs));
  const Lr=rec-1.15+.56*cs; put(profileX(CORN,Lr),'clay',M(-.15,Hc+1.2,-rec,0,-Math.PI/2,0,1,cs,cs)); put(profileX(CORN,Lr),'clay',M(W+.15,Hc+1.2,-rec+Lr,0,Math.PI/2,0,1,cs,cs));
  for(let x=.15;x<W-.05;x+=.2) box(x,x+.1,Hc+1.28,Hc+1.38,-1.15+.14,-1.15+.24);
  // fronton + médaillon
  const Hp=Hc+1.2+.6*cs, hp=2.3, wp=W+.2;
  put(ext(shapeOf([[-.1,0],[W+.1,0],[W/2,hp]]),.4),'clay',M(0,Hp,-1.75));
  const Ls=Math.hypot(wp/2,hp)+.35, al=Math.atan2(hp,wp/2); const rc=profileX([[0,0],[.06,0],[.1,.05],[.32,.1],[.38,.2],[.38,.3],[0,.3]],Ls);
  put(rc,'clay',M(-.2,Hp+.02,-1.35,0,0,al)); put(rc,'clay',M(W/2,Hp+hp+.2,-1.35,0,0,-al));
  put(new THREE.TorusGeometry(.62,.1,10,40),'clay',M(W/2,Hp+.95,-1.32)); put(new THREE.CylinderGeometry(.55,.55,.12,40),'clay',M(W/2,Hp+.95,-1.33,Math.PI/2,0,0));
  for(const sx of [-1,1]) for(let k=0;k<6;k++){const a=k*.28+.2; put(new THREE.SphereGeometry(.14,10,8),'clay',M(W/2+sx*(1.0+k*.42),Hp+.35+Math.sin(a)*.25,-1.32,0,0,0,1.6,.7,.6));}
  for(const x of [0,W/2,W]) put(lathe([[0,0],[.25,0],[.25,.08],[.12,.16],[.2,.45],[0,.7]],14),'clay',M(x,Hp+(x===W/2?hp+.2:.15),-1.3));
  roof({roof:'hip'},W,D-rec,Hp-.5,{ops:[]},mat.clone().multiply(M(0,0,-rec)));
  CUR=new THREE.Matrix4();
  PL.banque={mat:mat.clone(),W,D,H:Hp+hp,colX,rec,y0,mastZ:-6,mastY:Hp+hp-.5}; addBox(mat,W,Hp+hp,D,'banque');
}

// L'usine (Ton travail) : façade industrielle au bout de la rue, toits en dents de scie, cheminée
function factory(mat){
  CUR=mat; TINT=[.985,.98,.972]; const W=34, D=30, H=9.2, bw=3.4, nb=10, m0=(W-nb*bw)/2;
  const ops=[]; for(let i=0;i<nb;i++){const cx=m0+bw*(i+.5); if(i===4||i===5) ops.push({cx,y0:0,w:2.9,h:5.2,top:'rect',kind:'door'}); else ops.push({cx,y0:1.3,w:2.3,h:4.6,top:'arch',kind:'win'});}
  const s=shapeOf([[0,0],[W,0],[W,H],[0,H]]); for(const o of ops) s.holes.push(opShape(o.cx,o.y0,o.w,o.h,o.top,0));
  put(ext(s,.4,{bevelEnabled:true,bevelThickness:.015,bevelSize:.015,bevelSegments:1}),'clay',M(0,0,-.4));
  box(0,W,0,H,-D,-.42);
  for(let i=0;i<=nb;i++){const x=m0+bw*i; box(x-.32,x+.32,0,H+.2,-.4,.22); box(x-.4,x+.4,0,.7,-.4,.3); box(x-.38,x+.38,H-.5,H+.2,-.4,.28);}
  box(-.1,W+.1,0,.6,-.4,.12); put(profileX(SMALLC,W+.2),'clay',M(-.1,H-.1,0)); box(0,W,H+.1,H+1.1,-.4,.06);
  // pignon à redents au centre avec l'enseigne
  const cx=W/2; put(ext(shapeOf([[cx-5.4,0],[cx+5.4,0],[cx+5.4,1.0],[cx+3.6,1.0],[cx+3.6,2.0],[cx+1.8,2.0],[cx+1.8,2.9],[cx-1.8,2.9],[cx-1.8,2.0],[cx-3.6,2.0],[cx-3.6,1.0],[cx-5.4,1.0]]),.45),'clay',M(0,H+1.1,-.4));
  sign('TOKAI COBEX',cx,H+1.7,.08,6.2,.8,{size:80,font:'"Helvetica Neue",Arial,sans-serif',weight:700});
  put(new THREE.TorusGeometry(.7,.08,8,36),'clay',M(cx,H+3.25,.08)); put(new THREE.CylinderGeometry(.62,.62,.08,36),'clay',M(cx,H+3.25,.06,Math.PI/2,0,0));
  for(let i=0;i<12;i++){const a=i/12*Math.PI*2; put(UB,'metal',M(cx+Math.cos(a)*.48,H+3.25+Math.sin(a)*.48,.12,0,0,a,.12,.03,.02));}
  for(const o of ops){
    if(o.kind==='win'){ ring(o,.16,.07); const fr=opShape(o.cx,o.y0,o.w,o.h,o.top,0); fr.holes.push(opShape(o.cx,o.y0,o.w,o.h,o.top,.07)); put(ext(fr,.07),'clay',M(0,0,-.25));
      put(new THREE.ShapeGeometry(opShape(o.cx,o.y0,o.w,o.h,o.top,.07),12),R()<.35?'glassLit':'glass',M(0,0,-.22));
      for(let k=1;k<4;k++){const x=o.cx-o.w/2+o.w*k/4; box(x-.02,x+.02,o.y0,o.y0+o.h-.05,-.25,-.19);}
      for(let y=o.y0+.55;y<o.y0+o.h-o.w/2;y+=.55) box(o.cx-o.w/2,o.cx+o.w/2,y-.02,y+.02,-.25,-.19);
      keystone(o.cx,o.y0+o.h-.1); box(o.cx-o.w/2-.25,o.cx+o.w/2+.25,o.y0-.12,o.y0,0,.18); }
    else { ring(o,.2,.08); box(o.cx-o.w/2-.3,o.cx+o.w/2+.3,o.y0+o.h,o.y0+o.h+.4,0,.25);
      const dk='fdoor'+(FDOOR.length); FDOOR.push({cx:o.cx,w:o.w,h:o.h,top:o.y0+o.h}); for(let y=.1;y<o.h-.05;y+=.16) box(o.cx-o.w/2,o.cx+o.w/2,y,y+.13,-.36,-.3,dk);
      box(o.cx-o.w/2-.05,o.cx+o.w/2+.05,o.y0+o.h-.35,o.y0+o.h,-.38,-.2,'metal'); }
  }
  // toits en dents de scie (verrières tournées vers la rue)
  const step=D/5; for(let k=0;k<5;k++){ const a=k*step; roofPrism([[a+.02,0],[a+step,0],[a+.02,2.8]],W,H);
    put(new THREE.PlaneGeometry(W-.2,2.6),k%2?'glass':'glassLit',M(W/2,H+1.45,-a+.0,0,0,0)); for(let x=.5;x<W;x+=1.2) box(x-.03,x+.03,H+.1,H+2.8,-a-.02,-a+.04,'metal'); }
  // cheminée du four
  const chx=W*.78, chz=-D-5;
  put(lathe([[2.4,0],[2.4,3.0],[2.2,3.0],[2.2,3.3]],8),'clay',M(chx,0,chz,0,Math.PI/8,0));
  put(lathe([[1.75,0],[1.0,32],[1.15,32.2],[1.15,32.9],[.95,33.0],[.9,32.4],[0,32.4]],32),'clay',M(chx,3.3,chz));
  for(const y of [10,18,26]) put(new THREE.TorusGeometry(1.75-(y)/32*.75+.06,.09,8,40),'clay',M(chx,3.3+y,chz,Math.PI/2,0,0));
  box(chx-3,chx+3,0,4.5,chz-2.5,chz+2.5); put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(chx,3.4,chz+2.4),V(chx,3.4,-D+.5)]),8,.6,14),'metal');
  // portail et clôture
  const gz=4.2; for(const x of [cx-3.4,cx+3.4]){box(x-.35,x+.35,0,2.6,gz-.35,gz+.35); put(new THREE.SphereGeometry(.3,14,10),'clay',M(x,2.85,gz));}
  for(const [x0,x1] of [[0,cx-3.8],[cx+3.8,W]]){ box(x0,x1,0,.5,gz-.15,gz+.15); for(let x=x0+.1;x<x1;x+=.16) box(x-.02,x+.02,.5,1.9,gz-.02,gz+.02,'metal'); box(x0,x1,1.85,1.92,gz-.04,gz+.04,'metal'); for(let x=x0;x<x1;x+=3) box(x-.18,x+.18,0,2.0,gz-.18,gz+.18);}
  for(const sd of [-1,1]){ const hx=cx+sd*1.7; for(let x=-1.6;x<=1.6;x+=.15) box(hx+x-.02,hx+x+.02,.1,2.1-.3*Math.cos(x/1.6*Math.PI/2),gz+sd*.0-.02,gz+.02,'fgate'); box(hx-1.65,hx+1.65,.1,.18,gz-.03,gz+.03,'fgate');}
  CUR=new THREE.Matrix4();
  PL.usine={mat:mat.clone(),W,D,H:H+3.5,far:30,camY:3.5}; addBox(mat,W,H+2.8,D,'usine');
}

// Gaz et électricité : éolienne + petit poste de l'énergie
let ROTOR=null;
function energy(x,z){
  CUR=M(x,.0,z,0,-Math.PI/2,0); TINT=[1,1,1];
  const W=7,D=5; const sp={bays:2,bayW:2.6,floors:0,gf:3.6,fh:3,gfType:'rustic',win:'cornice',doorBay:0};
  facade(sp,W,{noReturns:false}); box(0,W,0,3.6,-D,-.32); roof({roof:'hip'},W,D,3.6,{ops:[]},CUR.clone());
  sign('PLENITUDE',W/2,3.32,.035,3.4,.3,{size:66,font:'"Helvetica Neue",Arial,sans-serif',weight:700});
  box(-7.6,-1.2,0,.12,-D-.2,-.3,'asphalt');   // dalle du poste (au nord de la boutique, hors du mur de l'usine)
  CUR=new THREE.Matrix4();
  PL.energie={anchor:V(x+3.5,9,z-2),view:[V(x-17,5.2,z+3.5),V(x+1,2.2,z-1.5)],sub:{x,z},W,D};
}
const scene_late=[];
// petits ajouts propres à chaque lieu
let ANTP=null;
function antenna(W,f,D){ const Hr=f.H+.5, x=W*.62, z=-D/2-1.6, y=Hr+3.2, s=.38, Hm=7.5; ANTP={x,y:y+Hm+.2,z};
  box(x-.8,x+.8,y-.2,y+.1,z-.8,z+.8,'metal');
  for(const [dx,dz] of [[-1,-1],[1,-1],[1,1],[-1,1]]) box(x+dx*s-.05,x+dx*s+.05,y,y+Hm,z+dz*s-.05,z+dz*s+.05,'metal');
  for(let k=0;k<7;k++){const yy=y+.5+k*1.0; for(const [a,b2] of [[0,1],[1,0]]){ const L=Math.hypot(2*s,1.0); put(UB,'metal',M(x+(a?s:0)*1-0, yy+.5, z+(b2?s:0), a?Math.atan2(2*s,1.0):0, 0, a?0:Math.atan2(2*s,1.0), .03,L,.03)); put(UB,'metal',M(x-(a?s:0), yy+.5, z-(b2?s:0), a?-Math.atan2(2*s,1.0):0, 0, a?0:-Math.atan2(2*s,1.0), .03,L,.03)); }
    box(x-s,x+s,yy,yy+.04,z-s,z+s,'metal');}
  for(let k=0;k<3;k++){const a=k/3*Math.PI*2+.4; put(UB,'metal',M(x+Math.cos(a)*.65,y+Hm-.9,z+Math.sin(a)*.65,0,-a,0,.12,1.5,.34));}
  const dish=lathe([[0,0],[.35,.05],[.5,.16],[.52,.2],[0,.06]],20); put(dish,'metal',M(x+.55,y+4.2,z,0,0,-Math.PI/2)); put(dish,'metal',M(x,y+5.4,z-.55,Math.PI/2,0,0));
  put(new THREE.CylinderGeometry(.04,.04,1.6,6),'metal',M(x,y+Hm+.8,z)); }
function crossPlate(x,y,z,s,key,depth=.12){ box(x-.13*s,x+.13*s,y-.42*s,y+.42*s,z,z+depth,key); box(x-.42*s,x+.42*s,y-.13*s,y+.13*s,z,z+depth,key); }
function medicalExtra(W,f){ const x=W-.55, y=3.3;
  box(x-.05,x+.05,y-.55,y+.55,.1,1.1); box(x-.04,x+.04,y+.5,y+.58,0,1.15,'metal'); box(x-.04,x+.04,y-.3,y-.25,0,.12,'metal');
  for(const sd of [-1,1]) {put(UB,'lampGreen',M(x+sd*.07,y,.6,0,0,0,.04,.62,.18)); put(UB,'lampGreen',M(x+sd*.07,y,.6,0,0,0,.04,.18,.62));}
}
function clinicExtra(W,f,D){ const H=f.H, cx=W/2;
  sign('CLINIQUE',cx,H-.22,.035,3.4,.36,{size:70});
  // marquise vitrée au-dessus de l'entrée
  const y=4.05, L=2.3; put(UB,'glass',M(cx,y+.12,L/2,-.08,0,0,3.4,.03,L)); box(cx-1.75,cx+1.75,y-.05,y+.12,0,.15,'metal');
  for(const x of [cx-1.7,cx,cx+1.7]) put(UB,'metal',M(x,y+.1,L/2,-.08,0,0,.06,.1,L));
  box(cx-1.75,cx+1.75,y+.02,y+.22,L-.06,L+.02,'metal');
  for(const sd of [-1,1]) cylBetween(V(cx+sd*1.6,y+1.7,.05),V(cx+sd*1.6,y+.22,L-.1),.025,.025,6,'metal',false);
  // croix sur le parapet
  const Hr=H+.5; box(cx-.9,cx+.9,Hr,Hr+1.9,-.32,-.12); crossPlate(cx,Hr+.95,-.12,1.9,'lampRed',.12);
  // croix en drapeau sur la façade
  const bx=W-.6; box(bx-.05,bx+.05,7.0,8.2,.1,1.3); for(const sd of [-1,1]){ put(UB,'lampRed',M(bx+sd*.07,7.6,.7,0,0,0,.04,.8,.25)); put(UB,'lampRed',M(bx+sd*.07,7.6,.7,0,0,0,.04,.25,.8)); }
  box(bx-.04,bx+.04,8.15,8.22,0,1.35,'metal'); }
function impotsExtra(W,f){ const b=f, gf=4.2;
  sign('CENTRE DES FINANCES PUBLIQUES',W/2,gf+.46,.17,6.6,.3,{size:58});
  const door=f.ops.find(o=>o.kind==='door'); const dx=door.cx;
  for(const sd of [-1,1]){ const p0=V(W/2+sd*3.75,gf+.5,.12), dir=V(sd*.35,.6,.72).normalize(), p1=p0.clone().addScaledVector(dir,2.6);
    cylBetween(p0,p1,.035,.035,8,'metal',false); put(new THREE.SphereGeometry(.07,10,8),'metal',M(p1.x,p1.y,p1.z));
    box(p0.x-.12,p0.x+.12,p0.y-.12,p0.y+.12,0,.12,'metal');
    // drapeau attaché le long de la hampe, qui pend et flotte
    const g=V(0,-1,0), xa=g.clone().addScaledVector(dir,-g.dot(dir)).normalize(), za=new THREE.Vector3().crossVectors(xa,dir).normalize();
    const mid=p0.clone().addScaledVector(dir,1.75); const mb=new THREE.Matrix4().makeBasis(xa,dir,za).setPosition(mid);
    FLAGS.push({m:CUR.clone().multiply(mb),w:1.05,h:1.45,hang:true}); } }

/* ============================================================
   CONSTRUCTION DE LA VILLE
   ============================================================ */
const load={set textContent(v){ if(HK.progress) HK.progress(v); }};
await new Promise(r=>setTimeout(r,30));
const north=[
 {W:11.6,bays:4,bayW:2.7,floors:5,gf:4.2,fh:3.05,gfType:'rustic',win:'cornice',roof:'mansard',quoins:true,doorBay:0,gateBay:2,gateSign:'PARKING',balcony:{f:2,all:true},place:'home',tint:[1,.985,.97]},
 {W:9.0,bays:3,bayW:2.6,floors:3,gf:4,fh:3.3,gfType:'rustic',win:'pediment',roof:'gable',pil:'corners',doorBay:1,shutters:true,tint:[.975,.98,.985]},
 {W:8.4,bays:3,bayW:2.5,floors:5,gf:4,fh:3.2,gfType:'arches',win:'arch',roof:'tower',quoins:true,doorBay:1,tint:[1,1,1]},
 {W:9.4,bays:3,bayW:2.8,floors:3,gf:4,fh:3.3,gfType:'shop',win:'keystone',roof:'dutch',awn:true,doorBay:2,balcony:{f:1},tint:[1,.985,.965]},
 'bank',
 {W:9.2,bays:3,bayW:2.7,floors:4,gf:4,fh:3.2,gfType:'shop',win:'segment',roof:'gable',quoins:true,doorBay:0,shutters:true,sign:[null,'CABINET MÉDICAL','PÉDIATRIE'],place:'medecin',extra:medicalExtra,tint:[1,.99,.98]},
 {W:10.6,bays:4,bayW:2.5,floors:3,gf:4,fh:3.3,gfType:'rustic',win:'cornice',roof:'hip',doorBay:1,tint:[.99,.99,.99]},
 {W:9.0,bays:3,bayW:2.6,floors:3,gf:4,fh:3.3,gfType:'shop',win:'keystone',roof:'dutch',doorBay:1,awn:true,tint:[1,.98,.965]},
];
const southW=[
 {W:10.4,bays:4,bayW:2.4,floors:3,gf:4,fh:3.3,gfType:'shop',win:'pediment',roof:'mansard',awn:true,doorBay:3,sign:'ORANGE',signOpt:{font:'"Helvetica Neue",Arial,sans-serif',weight:700,size:78},place:'orange',extra:antenna,tint:[.985,.985,.98]},
 {W:9.6,bays:3,bayW:2.8,floors:4,gf:4,fh:3.2,gfType:'arches',win:'arch',roof:'gable',quoins:true,doorBay:1,tint:[1,.99,.98]},
 {W:16,D:18,bays:5,bayW:2.9,floors:3,gf:4.2,fh:3.4,gfType:'arches',win:'cornice',roof:'hip',quoins:true,doorBay:2,balcony:{f:1},tint:[1,1,.995],side:'left'},
];
const southE=[
 {W:13,D:18,bays:4,bayW:2.8,floors:3,gf:4,fh:3.3,gfType:'shop',win:'keystone',roof:'mansard',awn:true,quoins:true,doorBay:1,tint:[.99,.985,.975],side:'right'},
 {W:10,bays:3,bayW:2.9,floors:5,gf:4.2,fh:3.1,gfType:'arches',win:'cornice',roof:'flat',quoins:true,doorBay:1,place:'clinique',extra:clinicExtra,tint:[.995,.995,1]},
 {W:11,bays:4,bayW:2.55,floors:3,gf:4.2,fh:3.3,gfType:'rustic',win:'cornice',roof:'hip',quoins:true,pil:'corners',doorBay:1,place:'impots',extra:impotsExtra,tint:[.98,.985,.99]},
];
const extra=[
 {W:10,bays:3,bayW:2.8,floors:3,gf:4,fh:3.3,gfType:'rustic',win:'cornice',roof:'gable',doorBay:1,tint:[.99,.99,.985]},
 {W:10,bays:3,bayW:2.8,floors:4,gf:4,fh:3.2,gfType:'shop',win:'keystone',roof:'mansard',doorBay:0,tint:[1,.99,.98]},
];
let x=-40.7;
for(const b of north){ if(b==='bank'){bank(M(x,.15,-7)); x+=14.2;} else {building(b,M(x,.15,-7)); x+=b.W;} }
building(extra[0],M(-50.7,.15,-7)); building(extra[1],M(x,.15,-7));
x=-42; for(const b of southW){building(b,M(x+b.W,.15,7,0,Math.PI,0),b.side==='left'?'left':null); x+=b.W;}
x=10;  for(const b of southE){building(b,M(x+b.W,.15,7,0,Math.PI,0),b.side==='right'?'right':null); x+=b.W;}
building(extra[1],M(-42,.15,7,0,Math.PI,0)); building(extra[0],M(54,.15,7,0,Math.PI,0));
// mairie au fond de la place
building({W:16,D:12,bays:5,bayW:2.9,floors:2,gf:4.4,fh:4.0,gfType:'arches',win:'pediment',roof:'hip',pil:'all',doorBay:2,quoins:true,hall:true,place:'mairie',tint:[1,1,1]},M(10,.15,25,0,Math.PI,0));
// au bout de la rue : l'usine, et derrière l'énergie
factory(M(66,.15,-17,0,-Math.PI/2,0));
PL.mairie&&(PL.mairie.far=12,PL.mairie.camY=2.6);
energy(84,-26);
// la voiture au sous-sol de chez toi
// (la vraie DS5 arrive plus tard depuis le coffre privé, une fois connecté : voir chargerVoiture)
let DS5_SPOT=null; if(GATE){ const gm=GATE.userData.mat; DS5_SPOT={p:V(GATE.userData.cx,-2.6,-GATE.userData.Dt+2.6).applyMatrix4(gm), rot:-Math.PI/2}; }
load.textContent='Construction de la rue…'; await new Promise(r=>setTimeout(r,10));

// trottoirs, bordures, place
for(const s of [-1,1]){
  put(profileX([[0,0],[0,.12],[.04,.16],[.24,.16],[.24,0]],116),'clay',M(-62,0,s*3.6+(s<0?-.24:0),0,s<0?0:0,0,1,1,1));
}
// mobilier de rue
for(const xx of [-36,-24,-12,14,26,38]){ lampAt(xx,-4.3); }
for(const xx of [-36,-24,-12,14,26,38]){ lampAt(xx+6,4.3); }
for(const [xx,zz] of [[-30,-4.7],[-18,-4.7],[20,-4.7],[32,-4.7],[-30,4.7],[-18,4.7],[20,4.7],[32,4.7]]) treeAt(xx,zz,Math.round(xx*7+zz*13+99),.9);
benchAt(-24,-5.6,0); benchAt(26,-5.6,0); benchAt(-12,5.6,Math.PI);
hydrantAt(-6.5,-4.1); hydrantAt(42,4.1);
for(const xx of [-5.5,-3.5,7.5,9.5]) bollardAt(xx,3.85);
cafeAt(-20.4,-5.3); cafeAt(-17.6,-5.0);
// place
fountainAt(2,16);
for(const [xx,zz] of [[-3,10.5],[7,10.5],[-3,21.5],[7,21.5]]) treeAt(xx,zz,Math.round(xx*31+zz*17+7),1.05);
benchAt(2,11.2,Math.PI); benchAt(2,20.8,0); benchAt(-2.6,16,Math.PI/2); benchAt(6.6,16,-Math.PI/2);
for(const [xx,zz] of [[-5,8],[9,8],[-5,24],[9,24]]) lampAt(xx,zz);
carAt(-9,2.5,0); carAt(24,-2.6,Math.PI);

/* ============================================================
   MATIÈRES + SOLS
   ============================================================ */
function heightToNormal(hgt,S,strength){const c=document.createElement('canvas');c.width=c.height=S;const x=c.getContext('2d');const id=x.createImageData(S,S);
  for(let j=0;j<S;j++)for(let i=0;i<S;i++){const l=hgt[j*S+((i-1+S)%S)],r=hgt[j*S+((i+1)%S)],u=hgt[((j-1+S)%S)*S+i],d=hgt[((j+1)%S)*S+i];
    let nx=(l-r)*strength, ny=(u-d)*strength, nz=1; const L=Math.hypot(nx,ny,nz); const k=(j*S+i)*4; id.data[k]=(nx/L*.5+.5)*255; id.data[k+1]=(ny/L*.5+.5)*255; id.data[k+2]=(nz/L*.5+.5)*255; id.data[k+3]=255;}
  x.putImageData(id,0,0); const t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.anisotropy=8; return t;}
function colorTex(hgt,S,f){const c=document.createElement('canvas');c.width=c.height=S;const x=c.getContext('2d');const id=x.createImageData(S,S);
  for(let i=0;i<S*S;i++){const v=f(hgt[i],i);id.data[i*4]=v[0];id.data[i*4+1]=v[1];id.data[i*4+2]=v[2];id.data[i*4+3]=255;} x.putImageData(id,0,0);
  const t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=8; return t;}
// pavés de la chaussée (texture : ne pas modéliser ce qu'une texture simule)
const cobble=(()=>{const S=1024,h=new Float32Array(S*S),tone=new Float32Array(S*S),n=makeNoise(5),rr=rng(9);const rows=24, cols=16; const jit=[];
  for(let j=0;j<rows;j++){jit.push([]);for(let i=0;i<=cols;i++)jit[j].push([rr()*.12-.06,.85+rr()*.3]);}
  for(let y=0;y<S;y++){const fy=y/S*rows, j=Math.floor(fy), ly=fy-j; for(let x=0;x<S;x++){const off=(j%2)*.5, fx=x/S*cols+off, i=Math.floor(fx), lx=fx-i;
    const jj=jit[j%rows][((i%cols)+cols)%cols]; const ex=Math.min(lx,1-lx)*2, ey=Math.min(ly,1-ly)*2; const e=Math.min(ex*1.6,ey);
    const v=sstep(0,.35,e)*(.8+.2*jj[1])+n(x/18,y/18)*.08; h[y*S+x]=v; tone[y*S+x]=jj[1];}}
  return {n:heightToNormal(h,S,5),c:colorTex(h,S,(v,i)=>{const k=.86+.1*tone[i]+.04*v-(v<.2?.12:0);return [222*k,218*k,210*k];})};})();
const paving=(()=>{const S=512,h=new Float32Array(S*S),n=makeNoise(7);
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){const fy=y/S*4, j=Math.floor(fy), fx=x/S*4+(j%2)*.5; const lx=fx-Math.floor(fx), ly=fy-j; const e=Math.min(lx,1-lx,ly,1-ly); h[y*S+x]=sstep(0,.02,e)+n(x/30,y/30)*.04;}
  return {n:heightToNormal(h,S,3),c:colorTex(h,S,(v)=>{const k=.9+.08*v;return [232*k,228*k,220*k];})};})();
const mats={
  clay:new THREE.MeshStandardMaterial({color:0xeae6df,vertexColors:true,roughness:.88,metalness:0}),
  roof:new THREE.MeshStandardMaterial({color:0xd7dadd,vertexColors:true,roughness:.62,metalness:.15}),
  glass:new THREE.MeshStandardMaterial({color:0x8d9cab,roughness:.06,metalness:.2,envMapIntensity:1.4}),
  glassLit:new THREE.MeshStandardMaterial({color:0x8d9cab,roughness:.06,metalness:.2,emissive:0xffc98a,emissiveIntensity:0,envMapIntensity:1.4}),
  metal:new THREE.MeshStandardMaterial({color:0xe2e0dc,roughness:.55,metalness:.25}),
  canvas:new THREE.MeshStandardMaterial({color:0xf6f3ee,roughness:.95,side:THREE.DoubleSide}),
  wood:new THREE.MeshStandardMaterial({color:0xe9e3d8,roughness:.85}),
  lamp:new THREE.MeshStandardMaterial({color:0xf4f1ea,roughness:.3,emissive:0xffd9a0,emissiveIntensity:0}),
  water:new THREE.MeshStandardMaterial({color:0xb9c8d4,roughness:.04,metalness:.3,envMapIntensity:1.5}),
  car:new THREE.MeshStandardMaterial({color:0xf2efea,roughness:.45,metalness:.05}),
  tyre:new THREE.MeshStandardMaterial({color:0xcfccc6,roughness:.9}),
  asphalt:new THREE.MeshStandardMaterial({color:0xc9c5be,roughness:.95,envMapIntensity:.3}),
  lampRed:new THREE.MeshStandardMaterial({color:0xf1e9e7,roughness:.5,emissive:0xff3b2e,emissiveIntensity:0}),
  lampGreen:new THREE.MeshStandardMaterial({color:0xe9f1ec,roughness:.5,emissive:0x22c47a,emissiveIntensity:0}),
};
for(const k of ['clay','canvas','wood','tyre']) mats[k].envMapIntensity=.3; for(const k of ['roof','metal','car']) mats[k].envMapIntensity=.5;
const city=new THREE.Group();
for(const k in B){ const base=k.includes('|')?k.split('|')[1]:k; const g=mergeGeometries(B[k],false); const mesh=new THREE.Mesh(g,mats[base]||mats.clay); mesh.name='M_'+k.replace('|','_'); mesh.castShadow=base!=='glass'&&base!=='glassLit'&&base!=='water'; mesh.receiveShadow=true; city.add(mesh); MESH[k]=mesh;
  if(k.includes('|')){ const o=OBST[+k.split('|')[0].slice(2)]; mesh.matrixAutoUpdate=false; o.meshes.push(mesh);} }
const scene=new THREE.Scene(); scene.add(city);
for(const g of scene_late) scene.add(g);
for(const sg of SIGNS){
  const ratio=sg.w/sg.h, Hh=128, Ww=Math.min(2048,Math.round(Hh*ratio)); const c=document.createElement('canvas'); c.width=Ww; c.height=Hh; const x=c.getContext('2d');
  x.fillStyle=sg.opt.bg||'#ece8e1'; x.fillRect(0,0,Ww,Hh);
  let fs=sg.opt.size||72; const fam=sg.opt.font||'Georgia,"Times New Roman",serif', wt=sg.opt.weight||600;
  try{x.letterSpacing=(sg.opt.ls??Math.round(fs*.12))+'px';}catch(e){}
  x.font=`${wt} ${fs}px ${fam}`; while(x.measureText(sg.text).width>Ww*.92&&fs>10){fs-=2;x.font=`${wt} ${fs}px ${fam}`;}
  x.textAlign='center'; x.textBaseline='middle';
  x.fillStyle='rgba(255,255,255,.85)'; x.fillText(sg.text,Ww/2,Hh/2+3); x.fillStyle=sg.opt.ink||'#6d6861'; x.fillText(sg.text,Ww/2,Hh/2);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=8;
  const m=new THREE.Mesh(new THREE.PlaneGeometry(sg.w,sg.h),new THREE.MeshStandardMaterial({map:t,roughness:.9,envMapIntensity:.3}));
  m.matrixAutoUpdate=false; m.matrix.copy(sg.m); m.receiveShadow=true; scene.add(m);
}
if(GATE){ const gm=GATE.userData.mat, lp=V(GATE.userData.cx,-.8,-GATE.userData.Dt+3).applyMatrix4(gm); const gl=new THREE.PointLight(0xffe0b0,18,14,1.4); gl.position.copy(lp); scene.add(gl); }
// chaussée pavée, trottoirs, place, sol
const road=new THREE.Mesh(new THREE.PlaneGeometry(124,7.2),new THREE.MeshStandardMaterial({map:cobble.c,normalMap:cobble.n,normalScale:new THREE.Vector2(1,1),roughness:.85,envMapIntensity:.3}));
road.material.map.repeat.set(41,2.4); road.material.normalMap.repeat.set(41,2.4); road.rotation.x=-Math.PI/2; road.receiveShadow=true; road.name='Rue_pavee'; scene.add(road);
const paveM=new THREE.MeshStandardMaterial({map:paving.c,normalMap:paving.n,roughness:.9,envMapIntensity:.3});
paveM.map.repeat.set(1,1);
function slab(x0,x1,z0,z1,y){const g=new THREE.BoxGeometry(x1-x0,y,z1-z0); const uv=g.attributes.uv; const p=g.attributes.position;
  for(let i=0;i<uv.count;i++){uv.setXY(i,(p.getX(i)+(x0+x1)/2)/2.4,(p.getZ(i)+(z0+z1)/2)/2.4);} const m=new THREE.Mesh(g,paveM); m.position.set((x0+x1)/2,y/2,(z0+z1)/2); m.receiveShadow=true; scene.add(m);}
slab(-62,54,-7.0,-3.84,.15); slab(-62,54,3.84,7.0,.15); slab(-6,10,7.0,25.3,.15); slab(61.6,66,-17,17,.15);
{ const r2=new THREE.Mesh(new THREE.PlaneGeometry(8,80),road.material.clone()); r2.material.map=cobble.c.clone(); r2.material.normalMap=cobble.n.clone(); r2.material.map.repeat.set(2.7,26.7); r2.material.normalMap.repeat.set(2.7,26.7);
  r2.material.map.needsUpdate=r2.material.normalMap.needsUpdate=true; r2.rotation.x=-Math.PI/2; r2.position.set(58,.002,0); r2.receiveShadow=true; scene.add(r2); }
const gshape=new THREE.Shape(); gshape.absarc(0,0,400,0,Math.PI*2,false);
for(const [x0,x1,z0,z1] of HOLES){ const h=new THREE.Path(); h.moveTo(x0,-z0); h.lineTo(x0,-z1); h.lineTo(x1,-z1); h.lineTo(x1,-z0); h.lineTo(x0,-z0); gshape.holes.push(h); }
const ground=new THREE.Mesh(new THREE.ShapeGeometry(gshape,48),new THREE.MeshStandardMaterial({color:0xe6e3dd,roughness:1,envMapIntensity:.3})); ground.rotation.x=-Math.PI/2; ground.position.y=-.02; ground.receiveShadow=true; scene.add(ground);

/* ============================================================
   RENDU : ciel, soleil, ombres douces, occlusion ambiante
   ============================================================ */
const renderer=new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance'});
const MOBILE=matchMedia('(pointer:coarse)').matches||Math.min(innerWidth,innerHeight)<700;
renderer.setPixelRatio(Math.min(devicePixelRatio,MOBILE?1.25:1.5)); renderer.setSize(innerWidth,innerHeight,false);
renderer.outputColorSpace=THREE.SRGBColorSpace; renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.0;
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;

const skyU={uSun:{value:V(0,1,0)},uZen:{value:new THREE.Color()},uHor:{value:new THREE.Color()},uSunCol:{value:new THREE.Color()},uCloud:{value:new THREE.Color()}};
const sky=new THREE.Mesh(new THREE.SphereGeometry(700,48,24),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:skyU,
  vertexShader:`varying vec3 vD; void main(){vD=position; vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position=p.xyww;}`,
  fragmentShader:`varying vec3 vD; uniform vec3 uSun,uZen,uHor,uSunCol,uCloud;
    float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
    float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<6;i++){s+=a*n(p);p*=2.03;a*=.5;}return s;}
    void main(){vec3 d=normalize(vD); float y=max(d.y,0.);
      vec3 col=mix(uHor,uZen,pow(y,.45));
      if(d.y>0.){vec2 p=d.xz/(d.y+.12)*1.6; float c=fbm(p+vec2(3.,1.)); float m=smoothstep(.52,.78,c)*smoothstep(.0,.18,d.y);
        float sh=fbm(p*1.3+vec2(.08,.05)); vec3 cc=mix(uCloud*.78,uCloud,smoothstep(.45,.8,sh)); col=mix(col,cc,m*.92);}
      float s=max(dot(d,normalize(uSun)),0.); col+=uSunCol*(pow(s,900.)*20.+pow(s,10.)*.18);
      gl_FragColor=vec4(col,1.);}`}));
scene.add(sky);
scene.fog=new THREE.Fog(0xcfd9e4,110,340);
const sun=new THREE.DirectionalLight(0xffffff,3); sun.castShadow=true; sun.shadow.mapSize.set(MOBILE?2048:4096,MOBILE?2048:4096);
Object.assign(sun.shadow.camera,{left:-115,right:115,top:80,bottom:-80,near:1,far:500}); sun.shadow.bias=-.0003; sun.shadow.normalBias=.03; sun.shadow.radius=4;
scene.add(sun,sun.target);
const hemi=new THREE.HemisphereLight(0xd3dcea,0xe2d9cc,.5); scene.add(hemi);
function envFor(zen,hor){const es=new THREE.Scene();const sg=new THREE.SphereGeometry(100,32,16);const cols=[],p=sg.attributes.position,c=new THREE.Color();
  for(let i=0;i<p.count;i++){const y=p.getY(i)/100; if(y>0)c.copy(hor).lerp(zen,Math.pow(y,.5)); else c.set(0xd8d3cb); cols.push(c.r,c.g,c.b);}
  sg.setAttribute('color',new THREE.Float32BufferAttribute(cols,3)); es.add(new THREE.Mesh(sg,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.BackSide})));
  return new THREE.PMREMGenerator(renderer).fromScene(es,.02).texture;}
const TIMES=[
  {name:'☀️ Midi',dir:V(-.72,.62,.42),sun:0xfff4e6,I:2.9,hemi:.42,zen:[.12,.36,.78],hor:[.72,.8,.9],cloud:[1,1,1],lit:0,lamp:0,exp:1.0},
  {name:'🌅 Soir',dir:V(.8,.16,-.3),sun:0xffb070,I:2.8,hemi:.28,zen:[.12,.18,.42],hor:[.98,.66,.42],cloud:[1,.78,.62],lit:2.2,lamp:3.5,exp:1.05},
  {name:'🌙 Nuit',dir:V(.45,.35,-.6),sun:0x7f95d6,I:.28,hemi:.07,zen:[.008,.012,.035],hor:[.045,.05,.085],cloud:[.12,.13,.18],lit:3.6,lamp:7,exp:.95},
  {name:'🌄 Matin',dir:V(-.8,.3,.5),sun:0xffe0c0,I:3.0,hemi:.38,zen:[.2,.42,.78],hor:[.92,.86,.82],cloud:[1,.95,.9],lit:.4,lamp:0,exp:1.0},
];
let ti=0;
let NIGHT=false;
function setTime(i){const t=TIMES[i]; NIGHT=(i===2||i===1); const d=t.dir.clone().normalize();
  sun.position.copy(d).multiplyScalar(200).add(V(18,0,0)); sun.target.position.set(18,0,0); sun.color.setHex(t.sun); sun.intensity=t.I; hemi.intensity=t.hemi;
  skyU.uSun.value.copy(d); skyU.uZen.value.setRGB(...t.zen); skyU.uHor.value.setRGB(...t.hor); skyU.uSunCol.value.setHex(t.sun); skyU.uCloud.value.setRGB(...t.cloud);
  scene.fog.color.setRGB(...t.hor); renderer.setClearColor(scene.fog.color);
  scene.environment=envFor(new THREE.Color(...t.zen),new THREE.Color(...t.hor));
  mats.glassLit.emissiveIntensity=t.lit; mats.lamp.emissiveIntensity=t.lamp+ .6; mats.lampRed.emissiveIntensity=.15+t.lamp*.6; mats.lampGreen.emissiveIntensity=.15+t.lamp*.6; renderer.toneMappingExposure=t.exp;
}
setTime(0);

const camera=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,.2,1500);
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true; controls.dampingFactor=.08; controls.maxPolarAngle=Math.PI*.495; controls.minDistance=1.5; controls.maxDistance=220;
controls.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_PAN};
const VIEWS={rue:[V(-32,2.6,2.6),V(0,7.5,-3.5),48],facades:[V(-4,5.2,5.6),V(-4,8.2,-7),58],place:[V(2,2.4,4.0),V(2,7,22),52],ciel:[V(-45,118,92),V(18,0,-4),45]};
let anim=null;
function goView(k,instant){const [p,t,f]=VIEWS[k]; if(instant){camera.position.copy(p);controls.target.copy(t);camera.fov=f;camera.updateProjectionMatrix();controls.update();return;}
  anim={p0:camera.position.clone(),t0:controls.target.clone(),f0:camera.fov,p,t,f,k:0};}
goView('ciel',true);
const ICON={
 home:'<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
 garage:'<path d="M3.5 15.5v-3l2.2-4.2h12.6l2.2 4.2v3z"/><path d="M3.5 12.5h17"/><circle cx="7.5" cy="16.5" r="1.6"/><circle cx="16.5" cy="16.5" r="1.6"/>',
 usine:'<path d="M3 20V11l5 3v-3l5 3v-3l5 3V4h3v16z"/><path d="M3 20h18"/>',
 impots:'<path d="M3.5 9L12 4.5 20.5 9z"/><path d="M6 9.5v7M10 9.5v7M14 9.5v7M18 9.5v7"/><path d="M4.5 17h15M3.5 20h17"/>',
 clinique:'<path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z"/>',
 mairie:'<rect x="3" y="6" width="18" height="12" rx="1.5"/><circle cx="8.5" cy="11" r="1.8"/><path d="M5.8 15.3c.8-1.4 4.6-1.4 5.4 0"/><path d="M14 10h4.5M14 13h3"/>',
 banque:'<circle cx="12" cy="12" r="8"/><path d="M15 9.4a3.6 3.6 0 1 0 0 5.2"/><path d="M8 11h5M8 13h5"/>',
 medecin:'<path d="M4 11h10.5a5.5 5.5 0 0 1-5.5 5.5H8.5A4.5 4.5 0 0 1 4 12z"/><path d="M14.5 11V5.5A5.5 5.5 0 0 1 20 11z"/><circle cx="7.5" cy="19.5" r="1.3"/><circle cx="14" cy="19.5" r="1.3"/>',
 orange:'<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
 energie:'<path d="M13 3L5.5 13.5h5.5L10 21l8-11h-5.5z"/>',
};
const svg=id=>`<svg viewBox="0 0 24 24">${ICON[id]}</svg>`;
const PLACES=[
 {id:'home',c:'#C9705A',e:'🏠',n:'Chez toi',d:'Logement : loyer, assurance, coupures, courses'},
 {id:'garage',c:'#5AA5C6',e:'🚗',n:'Ta voiture',d:'Garage au sous-sol : contrôle technique, assurance, entretien'},
 {id:'usine',c:'#B07F55',e:'🏭',n:'Ton travail',d:'Planning 5x8, paies, convocations'},
 {id:'impots',c:'#5B7FAF',e:'🏛️',n:'Impôts et amendes',d:'Prélèvements, avis, amendes'},
 {id:'clinique',c:'#5FAE8C',e:'🩺',n:'Ta santé',d:'Rendez-vous médicaux de la famille'},
 {id:'mairie',c:'#9581C2',e:'🪪',n:'Tes papiers',d:"Carte d'identité, permis, documents officiels"},
 {id:'banque',c:'#D6AC37',e:'💶',n:'Ton argent',d:'Banque, dépenses, ce que tu peux payer'},
 {id:'medecin',c:'#E28AA6',e:'🍼',n:'Le bébé',d:'Carnet de santé, CAF, crèche'},
 {id:'orange',c:'#EE9D4A',e:'📱',n:'Abonnements',d:'Box, mobile, TV'},
 {id:'energie',c:'#8CBB46',e:'⚡',n:'Gaz et électricité',d:'Consommation, échéancier, nouveaux tarifs'},
];
// halo au sol (dégradé doux) pour le lieu sélectionné
const haloTex=(()=>{const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');x.strokeStyle='#fff';x.shadowColor='#fff';
  for(const [lw,bl,a] of [[14,28,.5],[6,10,1]]){x.globalAlpha=a;x.lineWidth=lw;x.shadowBlur=bl;x.beginPath();x.roundRect(44,44,168,168,26);x.stroke();}
  return new THREE.CanvasTexture(c);})();
const haloGroup=new THREE.Group(); scene.add(haloGroup);
function makeHalo(p,mat,cx,cz,w,d){const k=1/0.656; const m=new THREE.Mesh(new THREE.PlaneGeometry((w+2.4)*k,(d+2.4)*k),new THREE.MeshBasicMaterial({map:haloTex,color:p.c,transparent:true,opacity:0,depthWrite:false,toneMapped:false}));
  m.matrixAutoUpdate=false; m.matrix.copy(mat).multiply(M(cx,.24,cz,-Math.PI/2,0,0)); m.renderOrder=3; haloGroup.add(m); p.halo=m;
  const r=new THREE.Mesh(new THREE.PlaneGeometry((w+2.4)*k,(d+2.4)*k),m.material.clone()); r.matrixAutoUpdate=false; r.matrix.copy(m.matrix); r.renderOrder=3; haloGroup.add(r); p.halo2=r;}

/* ---------- Les mâts : de vrais objets 3D plantés sur les toits ---------- */
const svgLoader=new SVGLoader();
function iconGeo(id){ const data=svgLoader.parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${ICON[id]}</g></svg>`);
  const gs=[]; for(const path of data.paths){ const st=path.userData.style; for(const sp of path.subPaths){ const g=SVGLoader.pointsToStroke(sp.getPoints(24),st); if(g) gs.push(g);} }
  const g=mergeGeometries(gs.map(x=>{x.deleteAttribute('uv'); if(x.attributes.normal)x.deleteAttribute('normal'); return x;}),false); g.translate(-12,-12,0); g.scale(1/24,-1/24,1); return g; }
const poleM=new THREE.MeshStandardMaterial({color:0xe7e4de,roughness:.5,metalness:.35,envMapIntensity:.5});
const ironM=new THREE.MeshStandardMaterial({color:0x2B3138,roughness:.42,metalness:.55,envMapIntensity:.6});   // fer forgé des enseignes
const whiteM=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.45,emissive:0xffffff,emissiveIntensity:.12,side:THREE.DoubleSide});
function plateTex(p,D){ const c=document.createElement('canvas'),x=c.getContext('2d'); const fs=64, pad=40; const st=D&&D.status?String(D.status).slice(0,34):'';
  const NOM=`700 ${fs}px ${SERIF}`, SOUS=`700 40px ${FNT}`; x.font=NOM; try{x.letterSpacing='8px';}catch(e){}
  let tw=Math.ceil(x.measureText(p.n.toUpperCase()).width); if(st){ x.font=SOUS; try{x.letterSpacing='0px';}catch(e){} tw=Math.max(tw,Math.ceil(x.measureText(st).width)); }
  c.width=tw+pad*2+12; c.height=st?178:112;
  // plaque émaillée crème, double filet de fer, petite pastille de couleur du lieu
  x.fillStyle='#F6F2EA'; x.beginPath(); x.roundRect(0,0,c.width,c.height,16); x.fill();
  x.strokeStyle='#2B3138'; x.lineWidth=7; x.beginPath(); x.roundRect(4,4,c.width-8,c.height-8,13); x.stroke();
  x.lineWidth=2; x.beginPath(); x.roundRect(14,14,c.width-28,c.height-28,8); x.stroke();
  x.font=NOM; try{x.letterSpacing='8px';}catch(e){} x.fillStyle='#2B3138'; x.textBaseline='middle'; x.textAlign='center'; x.fillText(p.n.toUpperCase(),c.width/2+4,st?66:c.height/2+4);
  if(st){ x.fillStyle=p.c; x.fillRect(c.width/2-40,104,80,3); x.font=SOUS; try{x.letterSpacing='0px';}catch(e){} x.fillStyle=D.urgent?'#C9483A':'#5d636c'; x.fillText(st,c.width/2,140); }
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=8; return {t,ar:c.width/c.height}; }
const masts=[], pickables=[]; const iconM=new THREE.MeshBasicMaterial({color:0xfdfcf9,side:THREE.DoubleSide});
function makeMast(p,base,top,R){
  const g=new THREE.Group(); scene.add(g);
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.06,.09,top-base.y,10),ironM); pole.position.set(base.x,(base.y+top)/2,base.z); pole.castShadow=true; g.add(pole);
  const foot=new THREE.Mesh(new THREE.CylinderGeometry(.22,.3,.25,14),ironM); foot.position.set(base.x,base.y+.12,base.z); g.add(foot);
  const head=new THREE.Group(); head.position.set(base.x,top+R,base.z); g.add(head);
  const spin=new THREE.Group(); head.add(spin);
  // médaillon d'émail crème cerclé de fer forgé ; l'icône prend la couleur du lieu
  const col=new THREE.MeshStandardMaterial({color:0xF3EEE4,roughness:.32,metalness:0,envMapIntensity:.7});
  const disc=new THREE.Mesh(new THREE.CylinderGeometry(R,R,.2,48),col); disc.rotation.x=Math.PI/2; disc.castShadow=true; spin.add(disc);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(R,.075,10,56),ironM); spin.add(rim);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(R*.84,.018,6,56),new THREE.MeshBasicMaterial({color:p.c,toneMapped:false})); ring.position.z=.105; spin.add(ring);
  const ring2=ring.clone(); ring2.position.z=-.105; spin.add(ring2);
  const icM=new THREE.MeshBasicMaterial({color:p.c,side:THREE.DoubleSide,toneMapped:false});
  const ig=iconGeo(p.id); for(const sd of [1,-1]){ const ic=new THREE.Mesh(ig,icM); ic.scale.set(R*1.15,R*1.15,1); ic.position.z=sd*.115; if(sd<0) ic.rotation.y=Math.PI; spin.add(ic); }
  const nub=new THREE.Mesh(new THREE.SphereGeometry(.13,12,8),ironM); nub.position.y=R+.12; spin.add(nub);
  const {t,ar}=plateTex(p); const ph=R*.52, pm=new THREE.MeshStandardMaterial({map:t,roughness:.7,transparent:true,envMapIntensity:.3});
  const plate=new THREE.Group(); plate.position.y=-R-ph*.9; spin.add(plate);
  for(const sd of [1,-1]){ const pl=new THREE.Mesh(new THREE.PlaneGeometry(ph*ar,ph),pm); pl.position.z=sd*.11; if(sd<0) pl.rotation.y=Math.PI; plate.add(pl); pl.userData.place=p; pickables.push(pl);}
  plate.scale.setScalar(.001);
  const wave=new THREE.Mesh(new THREE.RingGeometry(R*.98,R*1.1,48),new THREE.MeshBasicMaterial({color:p.c,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false,toneMapped:false})); spin.add(wave);
  disc.userData.place=p; pickables.push(disc);
  const bc=document.createElement('canvas'); bc.width=bc.height=128; const bx2=bc.getContext('2d'); bx2.fillStyle='#D45B4E'; bx2.beginPath(); bx2.arc(64,64,60,0,7); bx2.fill(); bx2.strokeStyle='#fff'; bx2.lineWidth=8; bx2.stroke();
  bx2.fillStyle='#fff'; bx2.font='800 84px Helvetica,Arial,sans-serif'; bx2.textAlign='center'; bx2.textBaseline='middle'; bx2.fillText('!',64,70);
  const bt=new THREE.CanvasTexture(bc); bt.colorSpace=THREE.SRGBColorSpace; const badge=new THREE.Mesh(new THREE.CircleGeometry(R*.42,32),new THREE.MeshBasicMaterial({map:bt,transparent:true,toneMapped:false,side:THREE.DoubleSide}));
  badge.position.set(R*.78,R*.78,.16); badge.visible=false; spin.add(badge);
  p.mast={g,head,spin,plate,wave,R,open:0,baseY:top+R,poleH:top-base.y,badge,col}; p.anchor=head.position.clone(); masts.push(p);
}
for(const p of PLACES){
  const L=PL[p.id];
  if(p.id==='garage'&&GATE){ const gm=GATE.userData.mat, cx=GATE.userData.cx;
    p.view=[V(cx+3.2,2.0,9).applyMatrix4(gm),V(cx,-1.2,-6).applyMatrix4(gm)]; makeHalo(p,gm,cx,1.6,3.0,2.6);
    const b0=V(cx+2.3,.15,.9).applyMatrix4(gm); makeMast(p,b0,b0.y+2.6,.6); }
  else if(L&&L.mat){ const far=L.far||9.6;
    p.view=[V(L.W/2+L.W*.08,L.camY||2.3,far).applyMatrix4(L.mat),V(L.W/2,L.tY||Math.min(L.H*.42,6.2),-1).applyMatrix4(L.mat)]; makeHalo(p,L.mat,L.W/2,-L.D/2,L.W,L.D);
    const mx=L.mastX??(p.id==='mairie'?L.W*.2:p.id==='clinique'?L.W*.22:L.W/2), mz=L.mastZ??(p.id==='clinique'?-2.4:-L.D*.38);
    const by=L.mastY??(p.id==='usine'?L.H-.6:L.H+.4);
    const b0=V(mx,by,mz).applyMatrix4(L.mat); makeMast(p,b0,b0.y+(p.id==='usine'?5.2:7.6),1.6); }
  else if(L){ p.view=L.view; makeHalo(p,M(L.anchor.x,.0,L.anchor.z),0,0,9,9); const b0=V(L.anchor.x-6,0,L.anchor.z+6); makeMast(p,b0,9.5,1.6); }
}
let SEL=null, selT=0;
// l'orbe de Jarvis, au-dessus de la place : le toucher ouvre la conversation
const ORB=new THREE.Group(); ORB.position.set(2,11,16); scene.add(ORB);
{ const core=new THREE.Mesh(new THREE.SphereGeometry(.75,40,24),new THREE.MeshStandardMaterial({color:0xfff4e4,emissive:0xffb766,emissiveIntensity:1.3,roughness:.3})); core.userData.place={id:'jarvis'}; pickables.push(core); ORB.add(core);
  const rm=new THREE.MeshBasicMaterial({color:0xffe1b0,transparent:true,opacity:.8}); const r1=new THREE.Mesh(new THREE.TorusGeometry(1.35,.035,8,90),rm); r1.rotation.x=Math.PI/2.3; ORB.add(r1);
  const r2=new THREE.Mesh(new THREE.TorusGeometry(1.7,.025,8,90),rm); r2.rotation.x=Math.PI/1.8; r2.rotation.y=.6; ORB.add(r2); }
let FOCUS=null;
function flyTo(pos,tgt,fov){ const p0=camera.position.clone(), t0=controls.target.clone(); const dist=Math.hypot(pos.x-p0.x,pos.z-p0.z);
  let ctrl=null; if(dist>16){ ctrl=p0.clone().lerp(pos,.5); ctrl.y=Math.max(p0.y,pos.y,24)+Math.min(14,dist*.12); }
  anim={p0,t0,f0:camera.fov,p:pos.clone(),t:tgt.clone(),f:fov,k:0,ctrl,spd:ctrl?.016:.026}; hideFor(pos,tgt); }
function ouvrir(id){ const p=PLACES.find(q=>q.id===id); if(!p) return; SEL=p; FOCUS=null; selT=0; const v=viewFor(p); flyTo(v[0],v[1],v[2]); }
function fermer(){ SEL=null; FOCUS=null; hideFor(null); }
let showLbl=true;
// toucher un médaillon ou un bâtiment
const rc=new THREE.Raycaster(), _ndc=new THREE.Vector2(); let downXY=null;
renderer.domElement.addEventListener('pointerdown',e=>{downXY=[e.clientX,e.clientY];});
renderer.domElement.addEventListener('pointerup',e=>{ if(!downXY||Math.hypot(e.clientX-downXY[0],e.clientY-downXY[1])>6) return;
  const rr=canvas.getBoundingClientRect(); _ndc.set((e.clientX-rr.left)/rr.width*2-1,-((e.clientY-rr.top)/rr.height)*2+1); rc.setFromCamera(_ndc,camera);
  const h=rc.intersectObjects(pickables,false).filter(i=>{let o=i.object; while(o){ if(!o.visible) return false; o=o.parent;} return true;});
  if(h.length){ const u=h[0].object.userData;
    if(u.act){ if(SEL!==u.place&&u.act==='fenetre'){HK.pick&&HK.pick(u.place.id);return;} HK.action&&HK.action(u.place.id,u.act); return; }
    // bouton dessiné sur un panneau (ex. « Prendre rendez-vous ») : un appui dessus lance l'action
    if(u.panel&&u.panel.o.hit&&h[0].uv&&h[0].face&&h[0].face.normal.z>.5){ const P=u.panel, b=P.o.hit, Hc=P.c.height/(P.c.width/1000);
      const px=h[0].uv.x*1000, py=(1-h[0].uv.y)*Hc;
      if(px>=b.x0-20&&px<=b.x1+20&&py>=b.y0-20&&py<=b.y1+20){ HK.action&&HK.action(u.place.id,b.act); return; } }
    if(u.panel){ const P=u.panel; if(SEL!==u.place){HK.pick&&HK.pick(u.place.id);return;} if(FOCUS===P){ FOCUS=null; const v=viewFor(SEL); flyTo(v[0],v[1],v[2]); } else { FOCUS=P; const v=frameInfos([P.info],P.maxD||SEL.maxD||13,1.08); flyTo(v[0],v[1],v[2]); } return; }
    HK.pick&&HK.pick(u.place.id); return; }
  let best=null,bd=1e9; const hp=new THREE.Vector3(); for(const B of BOXES){ if(!B.id)continue; if(rc.ray.intersectBox(B.b,hp)){const d=hp.distanceTo(camera.position); if(d<bd){bd=d;best=B.id;}}}
  let first=1e9; for(const B of BOXES){ if(rc.ray.intersectBox(B.b,hp)) first=Math.min(first,hp.distanceTo(camera.position)); }
  if(best&&bd<=first+.01) HK.pick&&HK.pick(best); });

/* ---------- La banque qui s'ouvre (données fictives) ---------- */
const BK=PL.banque; let bankK=0;
const BANKINFO={c:V(14.2/2,BK.y0+3.35,-BK.rec+.45).applyMatrix4(BK.mat),n:V(0,0,1).transformDirection(BK.mat),r:V(1,0,0).transformDirection(BK.mat),w:7.4,h:6.3};
const bankAxis=V(1,0,0).transformDirection(BK.mat);
const colTX=[.7,1.85,3.0,11.2,12.35,13.5];
const bankCv=document.createElement('canvas'); bankCv.width=1180; bankCv.height=1000; const bx=bankCv.getContext('2d');
const bankTex=new THREE.CanvasTexture(bankCv); bankTex.colorSpace=THREE.SRGBColorSpace; bankTex.anisotropy=8;
const PAL={ink:'#2f343c',soft:'#7a7f88',line:'rgba(47,52,60,.12)',gold:'#D6AC37',brick:'#C9705A',sage:'#5FAE8C',lagoon:'#5AA5C6',apricot:'#EE9D4A',lav:'#9581C2',anis:'#8CBB46'};
const ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2, cl=(v)=>Math.max(0,Math.min(1,v));
function drawBank(t){ boardReal('banque',{maxFacts:6})(bx,t,bankCv); bankTex.needsUpdate=true; }

const bankWall=new THREE.Group(); { const pw=6.9, ph=5.85; const side=new THREE.MeshStandardMaterial({color:0xece8e1,roughness:.85,envMapIntensity:.3});
  const face=new THREE.MeshStandardMaterial({map:bankTex,roughness:.82,envMapIntensity:.25});
  const panel=new THREE.Mesh(new THREE.BoxGeometry(pw,ph,.3),[side,side,side,side,face,side]); panel.castShadow=panel.receiveShadow=true; bankWall.add(panel);
  for(const [w,h,x,y] of [[pw+.5,.26,0,ph/2+.13],[pw+.5,.26,0,-ph/2-.13],[.26,ph,-pw/2-.12,0],[.26,ph,pw/2+.12,0]]){ const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,.42),side); m.position.set(x,y,.06); m.castShadow=m.receiveShadow=true; bankWall.add(m); }
  const cap=new THREE.Mesh(new THREE.BoxGeometry(pw+.9,.16,.6),side); cap.position.set(0,ph/2+.34,.1); bankWall.add(cap);
  bankWall.matrixAutoUpdate=false; scene.add(bankWall); bankWall.userData={pw,ph}; }
function placeBankWall(k){ const z=-BK.rec-.6+1.05*k; bankWall.matrix.copy(BK.mat).multiply(M(14.2/2,BK.y0+3.35,z)); bankWall.visible=k>0.001; }
placeBankWall(0);

/* ---------- Drapeaux au vent ---------- */
const flagTex=(()=>{const c=document.createElement('canvas');c.width=192;c.height=128;const x=c.getContext('2d');[['#7390c6',0],['#f4f0e8',64],['#d9857f',128]].forEach(([col,xx])=>{x.fillStyle=col;x.fillRect(xx,0,64,128);});
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; return t;})();
const flagMats=[];
for(const F of FLAGS){ const g=new THREE.PlaneGeometry(F.w,F.h,30,14); g.translate(F.w/2,0,0);
  const m=new THREE.MeshStandardMaterial({map:flagTex,side:THREE.DoubleSide,roughness:.88,envMapIntensity:.4});
  const U={uT:{value:0},uLen:{value:F.w},uPh:{value:Math.random()*6},uHang:{value:F.hang?1:0}}; m.userData.U=U;
  m.onBeforeCompile=sh=>{ Object.assign(sh.uniforms,U);
    sh.vertexShader='uniform float uT,uLen,uPh,uHang;\n'+sh.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
      float fx=clamp(position.x/uLen,0.,1.);
      float gust=.62+.38*sin(uT*.83+uPh)*sin(uT*.31+uPh*1.7);
      float ph=position.x*3.6-uT*(5.2+3.0*gust)+uPh+position.y*1.4;
      float amp=(mix(.05,.035,uHang)+mix(.11,.07,uHang)*gust)*pow(fx,1.15);
      float wv=sin(ph)+.32*sin(ph*2.2+1.3)+.12*sin(ph*4.1+position.y*3.);
      float dwx=3.6*(cos(ph)+.32*2.2*cos(ph*2.2+1.3)+.12*4.1*cos(ph*4.1+position.y*3.));
      float dwy=1.4*(cos(ph)+.32*2.2*cos(ph*2.2+1.3))+.12*3.*cos(ph*4.1+position.y*3.);
      objectNormal=normalize(vec3(-dwx*amp,-dwy*amp,1.));`).replace('#include <begin_vertex>',`#include <begin_vertex>
      transformed.z+=wv*amp; transformed.x-=fx*fx*.05*uLen*(1.-gust)*(1.-uHang); transformed.y-=fx*fx*.08*(1.-gust)*(1.-uHang);`); };
  const mesh=new THREE.Mesh(g,m); mesh.matrixAutoUpdate=false; mesh.matrix.copy(F.m); mesh.castShadow=true; mesh.receiveShadow=true; scene.add(mesh); flagMats.push(m); }


/* =========================================================
   LES AUTRES LIEUX QUI S'OUVRENT (données fictives pour le test)
   ========================================================= */
const PANELS={};   // id -> [{group, place(k), canvas, tex, draw, d}]
const openK={};
const panSide=new THREE.MeshStandardMaterial({color:0xece8e1,roughness:.85,envMapIntensity:.3});
function newPanel(id,mat,o){ // o:{x,y,z0,z1,w,h,kind:'slide'|'rise'|'static',d,frame,draw}
  const c=document.createElement('canvas'); const ppm=o.w>3?190:240; c.width=Math.round(o.w*ppm); c.height=Math.round(o.h*ppm);
  const tex=new THREE.CanvasTexture(c); tex.colorSpace=THREE.SRGBColorSpace; tex.anisotropy=8;
  const face=new THREE.MeshStandardMaterial({map:tex,roughness:.8,emissive:0xffffff,emissiveMap:tex,emissiveIntensity:o.glow??.18,envMapIntensity:.25});
  const g=new THREE.Group(); g.matrixAutoUpdate=false; scene.add(g);
  if(o.kind==='static'){ const pl=new THREE.Mesh(new THREE.PlaneGeometry(o.w,o.h),face); g.add(pl); }
  else { const th=o.thick||.16; const b=new THREE.Mesh(new THREE.BoxGeometry(o.w,o.h,th),[panSide,panSide,panSide,panSide,face,panSide]); b.castShadow=b.receiveShadow=true; g.add(b);
    if(o.frame){ for(const [w,h,x,y] of [[o.w+.3,.15,0,o.h/2+.07],[o.w+.3,.15,0,-o.h/2-.07],[.15,o.h,-o.w/2-.07,0],[.15,o.h,o.w/2+.07,0]]){ const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,th+.12),panSide); m.position.set(x,y,.04); m.castShadow=true; g.add(m);} } }
  const P={g,c,tex,o,mat,last:-1,place:PLACES.find(q=>q.id===id),maxD:o.maxD}; (PANELS[id]||(PANELS[id]=[])).push(P); openK[id]=0;
  g.traverse(m=>{ if(m.isMesh){ m.userData.panel=P; m.userData.place=P.place; pickables.push(m);} });
  const fm=o.ry?new THREE.Matrix4().copy(mat).multiply(M(o.x,o.y,o.zb||0,0,o.ry,0)).multiply(M(0,0,o.z1)):new THREE.Matrix4().copy(mat).multiply(M(o.x,o.y,o.z1)); P.info={c:V(0,0,0).applyMatrix4(fm),n:V(0,0,1).transformDirection(fm),r:V(1,0,0).transformDirection(fm),w:o.w,h:o.h};
  placePanel(P,0); P.o.draw(P.c.getContext('2d'),0,P.c); tex.needsUpdate=true; return P; }
function placePanel(P,k){ const o=P.o; let x=o.x,y=o.y,z=o.z1;
  if(o.kind==='slide') z=o.z0+(o.z1-o.z0)*k; if(o.kind==='rise') y=o.y-(o.h+.6)*(1-k);
  if(o.ry){ P.g.matrix.copy(P.mat).multiply(M(x,y,o.zb||0,0,o.ry,0)).multiply(M(0,0,z)); } else P.g.matrix.copy(P.mat).multiply(M(x,y,z)); P.g.visible=o.kind==='static'||k>.002; }
// cadrage : placer la caméra bien en face, à la distance où tout se lit
function frameInfos(infos,maxD,margin=1.18){ const n=infos[0].n.clone(), r=infos[0].r.clone(), up=V(0,1,0); const c=V(0,0,0); infos.forEach(i=>c.add(i.c)); c.multiplyScalar(1/infos.length);
  let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9; for(const i of infos){ const d=i.c.clone().sub(c), dx=d.dot(r), dy=d.dot(up); x0=Math.min(x0,dx-i.w/2); x1=Math.max(x1,dx+i.w/2); y0=Math.min(y0,dy-i.h/2); y1=Math.max(y1,dy+i.h/2); }
  const W=(x1-x0)*margin, H=(y1-y0)*margin*1.38; c.addScaledVector(r,(x0+x1)/2).addScaledVector(up,(y0+y1)/2);
  const asp=innerWidth/innerHeight; let fov=48, t=Math.tan(fov*Math.PI/360); let d=Math.max(H/(2*t),W/(2*t*asp),1.6);
  if(d>maxD){ d=maxD; fov=Math.min(78,2*Math.atan(Math.max(H/(2*d),W/(2*d*asp)))*180/Math.PI); }
  const cam=c.clone().addScaledVector(n,d); cam.y+=Math.min(.6,d*.04); return [cam,c,fov]; }
function viewFor(p){ const list=PANELS[p.id]; if(p.id==='banque') return frameInfos([BANKINFO],15);
  if(list&&list.length) return frameInfos(list.map(P=>P.info),p.maxD||13); const v=p.view;
  // l'entrée de l'usine : on recule sur un écran étroit (téléphone) pour voir la vitrine et la pointeuse en entier
  if(p.id==='usine'&&PL.usine){ const f=p.fov||55, L=PL.usine, dt=L.far+1, df=L.far-4.35, nf=5.4/(2*Math.tan(f*Math.PI/360)*Math.max(.3,camera.aspect));
    if(nf>df){ const k=(nf+dt-df)/dt, e=v[1].clone().add(v[0].clone().sub(v[1]).multiplyScalar(k)); return [e,v[1],f]; } }
  return [v[0],v[1],f0(p)]; }
function f0(p){ return p.fov||55; }
// --- petits outils de dessin (espace de 1000 px de large) ---
function begin(x,c){ const S=c.width/1000; x.setTransform(S,0,0,S,0,0); x.globalAlpha=1; x.setLineDash([]); const H=c.height/S; x.clearRect(0,0,1000,H); x.fillStyle='#f7f3ec'; x.fillRect(0,0,1000,H);
  x.strokeStyle='rgba(47,52,60,.16)'; x.lineWidth=4; x.strokeRect(14,14,972,H-28); return H; }
const A=(t,k,d=.3)=>cl((t-k)/d);
function txt(x,s,px,y,size,w=600,col=PAL.ink,al='left',ls=0){ x.font=fontDe(w,size,ls); try{x.letterSpacing=ls+'px';}catch(e){} x.textAlign=al; x.fillStyle=col; x.fillText(s,px,y); x.textAlign='left'; try{x.letterSpacing='0px';}catch(e){} }
function phead(x,t,title,sub,col,y=86){ x.globalAlpha=A(t,0); x.fillStyle=col; x.beginPath(); x.arc(78,y-12,26,0,7); x.fill(); txt(x,title,124,y,40,700,PAL.ink,'left',6); txt(x,sub,126,y+38,25,500,PAL.soft); x.globalAlpha=1; }
function card(x,px,py,w,h,col){ x.fillStyle='rgba(255,255,255,.8)'; x.beginPath(); x.roundRect(px,py,w,h,18); x.fill(); x.fillStyle=col; x.beginPath(); x.roundRect(px,py,10,h,[18,0,0,18]); x.fill(); }
function prog(x,px,py,w,frac,col){ x.fillStyle='rgba(47,52,60,.08)'; x.beginPath(); x.roundRect(px,py,w,18,9); x.fill(); x.fillStyle=col; x.beginPath(); x.roundRect(px,py,Math.max(18,w*frac),18,9); x.fill(); }
function bars(x,px,py,w,h,vals,labels,col,t,maxv){ const n=vals.length,bw=w/n*.58; vals.forEach((v,i)=>{ const k=ease(cl((t-i*.06)/.4)); const hh=v/maxv*h*k, xx=px+i*w/n+(w/n-bw)/2;
  x.fillStyle=i===n-1?col:col+'77'; x.beginPath(); x.roundRect(xx,py+h-hh,bw,hh,[10,10,3,3]); x.fill(); txt(x,labels[i],xx+bw/2,py+h+36,24,500,PAL.soft,'center'); }); }
function rows(x,px,py,list,t,w=860,rh=96){ list.forEach(([a,b,c2,col],i)=>{ x.globalAlpha=A(t,.15+i*.08); const y=py+i*rh; card(x,px,y,w,rh-16,col); txt(x,a,px+34,y+34,24,600,PAL.soft); txt(x,b,px+34,y+66,30,700); if(c2) txt(x,c2,px+w-26,y+56,30,700,PAL.ink,'right'); }); x.globalAlpha=1; }
function counter(t,v,dec=0){ return (v*ease(cl(t/.55))).toLocaleString('fr-FR',{minimumFractionDigits:dec,maximumFractionDigits:dec}); }
function box2(mat,[x0,x1,y0,y1,z0,z1],key){ const m=new THREE.Mesh(new THREE.BoxGeometry(x1-x0,y1-y0,z1-z0),mats[key]); m.matrixAutoUpdate=false; m.matrix.copy(mat).multiply(M((x0+x1)/2,(y0+y1)/2,(z0+z1)/2)); scene.add(m); return m; }
function bigTile(title,val,cap,col,icon){ return (x,t,c)=>{ const H=begin(x,c); x.globalAlpha=A(t,0); x.fillStyle=col; x.fillRect(14,14,972,230);
  if(icon){ x.save(); x.translate(500,128); x.scale(6,6); x.translate(-12,-12); x.strokeStyle='#fff'; x.lineWidth=1.9; x.lineCap='round'; x.lineJoin='round'; x.stroke(new Path2D(ICONPATH[icon])); x.restore(); }
  txt(x,title.toUpperCase(),500,370,76,700,PAL.ink,'center',8); x.globalAlpha=A(t,.2);
  txt(x,val,500,H*.66,val.length>7?150:190,700,col,'center'); x.globalAlpha=A(t,.45); txt(x,cap,500,H*.83,54,600,PAL.soft,'center'); x.globalAlpha=1; }; }
// tuile (fenêtre / vitrine)
function tile(title,val,cap,col,icon){ return (x,t,c)=>{ const H=begin(x,c); x.globalAlpha=A(t,0); x.fillStyle=col; x.fillRect(14,14,972,170);
  if(icon){ x.save(); x.translate(500,98); x.scale(4.2,4.2); x.translate(-12,-12); x.strokeStyle='#fff'; x.lineWidth=1.8; x.lineCap='round'; x.lineJoin='round'; const p=new Path2D(ICONPATH[icon]); x.stroke(p); x.restore(); }
  txt(x,title.toUpperCase(),500,280,58,700,PAL.ink,'center',6); x.globalAlpha=A(t,.25);
  const big=typeof val==='function'?val(t):val; txt(x,big,500,H*.58,big.length>9?96:130,700,col,'center');
  x.globalAlpha=A(t,.5); (Array.isArray(cap)?cap:[cap]).forEach((cp,i)=>txt(x,cp,500,H*.74+i*58,44,500,PAL.soft,'center')); x.globalAlpha=1; }; }
// chemins d'icônes pour le canvas
const ICONPATH={home:'M4 11l8-6.5 8 6.5M6 9.5V20h12V9.5M10 20v-5h4v5', bolt:'M13 3L5.5 13.5h5.5L10 21l8-11h-5.5z', flame:'M12 3c2 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 2 3 3 3 0-3-1-5 0-7z',
  wifi:'M3 9a13 13 0 0 1 18 0M6 12.5a8.5 8.5 0 0 1 12 0M9 16a4 4 0 0 1 6 0M12 19.5h.01', shield:'M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z', key:'M14 10a4 4 0 1 0-3.5 4L8 16.5V19h2.5v-2H13l1-1.5',
  plug:'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4', cart:'M3 4h2l2.5 11h11L21 7H6.5M9 20h.01M18 20h.01', phone:'M7 3h10v18H7zM11 18h2', box:'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8', tv:'M3 6h18v12H3zM8 21h8'};

/* =========================================================
   LE CONTENU DES PANNEAUX : tes vraies données (venues de l'app)
   ========================================================= */
const DATA={};   // id -> {n,c,place,status,say,facts,alerts,nDocs,urgent}
const dOf=id=>DATA[id]||{n:(PLACES.find(q=>q.id===id)||{}).n||id,c:(PLACES.find(q=>q.id===id)||{}).c||'#999',place:'',status:'',say:'Je charge…',facts:[],alerts:[],nDocs:0,urgent:false};
const RED='#D45B4E';
function fitFont(x,s,maxW,size,w,min=14){ let f=size; x.font=`${w} ${f}px ${FNT}`; while(x.measureText(s).width>maxW&&f>min){f-=2;x.font=`${w} ${f}px ${FNT}`;} return f; }
function wrapLines(x,s,maxW,size,w,maxL=99){ x.font=`${w} ${size}px ${FNT}`; const words=String(s||'').split(/\s+/).filter(Boolean), L=[]; let cur='';
  for(const wd of words){ const tr=cur?cur+' '+wd:wd; if(x.measureText(tr).width<=maxW||!cur) cur=tr; else { L.push(cur); cur=wd; } }
  if(cur) L.push(cur); if(L.length>maxL){ const k=L.slice(0,maxL); let last=k[maxL-1]; while(x.measureText(last+'…').width>maxW&&last.length>1) last=last.slice(0,-1); k[maxL-1]=last.replace(/[\s,;:.]+$/,'')+'…'; return k; } return L; }
function para(x,s,px,y,maxW,size,w,col,lh,maxL){ const L=wrapLines(x,s,maxW,size,w,maxL); x.fillStyle=col; x.textAlign='left'; L.forEach((l,i)=>x.fillText(l,px,y+i*lh)); return L.length*lh; }
function splitVal(v){ v=String(v||'—'); const m=v.match(/^(−?-?[\d\s  .,]+ ?€)\s*(.*)$/); if(m) return [m[1].trim(),m[2].replace(/^[,·]\s*/,'')];
  const m2=v.match(/^(.{1,16}?)\s+·\s+(.*)$/); if(m2) return [m2[1],m2[2]]; if(v.length<=14) return [v,'']; const p=v.split(/\s+(?=\()|,\s+|\s+·\s+/); return p.length>1?[p[0],p.slice(1).join(', ')]:[v,'']; }
const KEYICON=[[/loyer|logement|foncia/i,'home'],[/gaz|électri|energ|plenitude|kwh/i,'bolt'],[/coupure|enedis/i,'plug'],[/course/i,'cart'],[/mobile|5g|forfait/i,'phone'],[/box|fibre|livebox|internet/i,'wifi'],
  [/total|factures?/i,'box'],[/assurance|ornikar/i,'shield'],[/contrôle|compteur|km/i,'key'],[/permis|carte|identit|papier/i,'shield']];
function iconFor(label,id){ for(const [re,ic] of KEYICON) if(re.test(label)) return ic; return {home:'home',energie:'bolt',orange:'phone',garage:'key',mairie:'shield',medecin:'shield',usine:'box',banque:'box',impots:'box',clinique:'shield'}[id]||'box'; }
function tilesFor(id){ const D=dOf(id), T=[];
  D.facts.forEach(([a,b])=>{ const [big,sub]=splitVal(b); T.push({label:a,big,sub,col:D.c,icon:iconFor(a+' '+b,id)}); });
  D.alerts.forEach(al=>T.push({label:'À regarder',big:al.t,sub:al.d,col:RED,icon:'plug',alert:true}));
  if(D.nDocs) T.push({label:'Papiers rangés',big:String(D.nDocs),sub:'dans Jarvis',col:D.c,icon:'box'});
  if(!T.length) T.push({label:D.status||'Pas encore branché',big:'—',sub:'',col:D.c,icon:iconFor('',id)});
  return T; }
// grande carte lisible (fenêtres, vitrines)
function tileReal(id,i){ return (x,t,c)=>{ const H=begin(x,c); const T=tilesFor(id); if(i>=T.length) return sayTile(x,t,H,dOf(id)); const k=T[i]; const dup=false;
  x.globalAlpha=A(t,0)*(dup?.35:1); x.fillStyle=k.col; x.fillRect(14,14,972,230);
  x.save(); x.translate(500,128); x.scale(6,6); x.translate(-12,-12); x.strokeStyle='#fff'; x.lineWidth=1.9; x.lineCap='round'; x.lineJoin='round'; x.stroke(new Path2D(ICONPATH[k.icon]||ICONPATH.box)); x.restore();
  const lab=k.label.toUpperCase(); x.font=`700 54px ${FNT}`; if(x.measureText(lab).width>900){ x.textAlign='center'; x.fillStyle=PAL.ink; wrapLines(x,lab,900,48,700,2).forEach((l,j)=>x.fillText(l,500,330+j*56)); x.textAlign='left'; } else { const fl=fitFont(x,lab,900,70,700,30); txt(x,lab,500,360,fl,700,PAL.ink,'center',4); }
  x.globalAlpha=A(t,.2)*(dup?.35:1);
  if(k.big.length<=11){ const fb=fitFont(x,k.big,900,180,700,60); txt(x,k.big,500,H*.62,fb,700,k.col,'center'); }
  else { x.textAlign='center'; const L=wrapLines(x,k.big,880,78,700,3); x.font=`700 78px ${FNT}`; x.fillStyle=k.col; L.forEach((l,j)=>x.fillText(l,500,H*.5+j*90-(L.length-1)*30)); x.textAlign='left'; }
  if(k.sub){ x.globalAlpha=A(t,.45)*(dup?.35:1); x.textAlign='center'; x.font=`600 50px ${FNT}`; x.fillStyle=PAL.soft; wrapLines(x,k.sub,880,50,600,2).forEach((l,j)=>x.fillText(l,500,H*.8+j*60)); x.textAlign='left'; }
  x.globalAlpha=1; }; }
function sayTile(x,t,H,D){ x.globalAlpha=A(t,0); x.fillStyle=D.c; x.fillRect(14,14,972,120); txt(x,'À SAVOIR',500,96,54,700,'#fff','center',6);
  x.globalAlpha=A(t,.25); x.textAlign='center'; x.fillStyle='#3d434c'; const L=wrapLines(x,D.say||D.status||'—',860,56,600,Math.floor((H-260)/70)); x.font=`600 56px ${FNT}`; L.forEach((l,j)=>x.fillText(l,500,250+j*70)); x.textAlign='left'; x.globalAlpha=1; }
// papier encadré (mairie)
function docReal(id,i){ return (x,t,c)=>{ const H=begin(x,c); const T=tilesFor(id); if(i>=T.length) return sayTile(x,t,H,dOf(id)); const k=T[i]; const col=k.col;
  x.globalAlpha=A(t,0); x.fillStyle='#fff'; x.beginPath(); x.roundRect(90,90,820,980,24); x.fill(); x.strokeStyle='rgba(47,52,60,.12)'; x.lineWidth=4; x.stroke();
  x.fillStyle=col; x.fillRect(90,90,820,90); txt(x,'RÉPUBLIQUE FRANÇAISE',500,150,34,700,'#fff','center',4);
  x.globalAlpha=A(t,.15); x.fillStyle=col+'44'; x.beginPath(); x.roundRect(140,240,250,310,16); x.fill(); x.fillStyle=col+'aa'; x.beginPath(); x.arc(265,350,58,0,7); x.fill(); x.beginPath(); x.ellipse(265,500,100,60,0,Math.PI,0); x.fill();
  for(let q=0;q<6;q++){ const w2=(q%2?300:420)*ease(cl((t-.2-q*.05)/.3)); x.fillStyle='rgba(47,52,60,.14)'; x.beginPath(); x.roundRect(430,260+q*48,w2,20,10); x.fill(); }
  x.globalAlpha=A(t,.5); const lab=k.label.toUpperCase(); const fl=fitFont(x,lab,860,54,700,26); txt(x,lab,500,1170,fl,700,PAL.ink,'center',3);
  const v=(k.big+(k.sub?' · '+k.sub:'')); x.textAlign='center'; x.font=`600 46px ${FNT}`; x.fillStyle=k.alert?RED:'#5FAE8C'; wrapLines(x,v,860,46,600,3).forEach((l,j)=>x.fillText(l,500,1245+j*56)); x.textAlign='left'; x.globalAlpha=1; }; }
// tableau complet (murs, avis encadrés, écrans)

// gravure façon néomorphisme : même pierre que le mur, lettres en relief doux (lumière en haut à gauche)
function engrave(id){ return (x,t,c)=>{ const S=c.width/1000; x.setTransform(S,0,0,S,0,0); x.globalAlpha=1; x.setLineDash([]); const H=c.height/S; const D=dOf(id);
  const stone='#e9e4dc', hi='rgba(255,255,255,1)', lo='rgba(92,78,62,.42)';
  // pierre lisse avec un léger grain
  x.fillStyle=stone; x.fillRect(0,0,1000,H); x.globalAlpha=.05; for(let i=0;i<500;i++){ x.fillStyle=i%2?'#fff':'#6b5d4c'; x.fillRect((i*137)%1000,(i*251)%H,3,3); } x.globalAlpha=1;
  const relief=(draw,d,a)=>{ if(a<=0) return; x.save(); x.globalAlpha=a;
    x.shadowColor=lo; x.shadowOffsetX=d; x.shadowOffsetY=d; x.shadowBlur=d; draw(stone);
    x.shadowColor=hi; x.shadowOffsetX=-d; x.shadowOffsetY=-d; x.shadowBlur=d; draw(stone);
    x.shadowColor='transparent'; draw(stone); x.restore(); };
  const T=(s2,px,py,size,w,al='left',ls=0,col)=>(c0)=>{ x.font=fontDe(w,size,ls); try{x.letterSpacing=ls+'px';}catch(e){} x.textAlign=al; x.fillStyle=col||c0; x.fillText(s2,px,py); x.textAlign='left'; try{x.letterSpacing='0px';}catch(e){} };
  // cadre en creux
  const k=A(t,0,.4); x.save(); x.globalAlpha=k; x.lineWidth=14; x.strokeStyle=stone; x.shadowColor=lo; x.shadowOffsetX=-4; x.shadowOffsetY=-4; x.shadowBlur=8; x.beginPath(); x.roundRect(36,36,928,H-72,46); x.stroke();
  x.shadowColor=hi; x.shadowOffsetX=4; x.shadowOffsetY=4; x.stroke(); x.restore();
  relief(T((D.n||'').toUpperCase(),500,180,72,800,'center',12),6,A(t,.05));
  x.globalAlpha=A(t,.1); x.fillStyle=D.c||'#C9705A'; x.beginPath(); x.roundRect(440,214,120,8,4); x.fill(); x.globalAlpha=1;
  let y=330; const F=(D.facts||[]).slice(0,(D.alerts||[]).length?3:4);
  F.forEach(([a2,b2],i)=>{ const al=A(t,.2+i*.12); relief(T(String(a2).toUpperCase(),110,y,32,800,'left',5,'#8a8178'),3,al);
    const bs=String(b2); const fs=bs.length>18?50:bs.length>12?64:86; relief(T(bs,106,y+fs+12,fs,800,'left',0,'#4a4540'),3,al); y+=fs+112; });
  (D.alerts||[]).slice(0,1).forEach(al=>{ const yy=Math.max(y+30,H-110); x.save(); x.globalAlpha=A(t,.6); x.fillStyle='rgba(201,72,58,.12)'; x.beginPath(); x.roundRect(90,yy-58,820,84,22); x.fill();
    x.fillStyle='#c9483a'; x.font=`800 34px ${FNT}`; const tt=al.t.length>38?al.t.slice(0,37)+'…':al.t; x.fillText('●  '+tt,116,yy); x.restore(); });
  x.globalAlpha=1; }; }

/* ---------- CHEZ TOI : ce qui est déjà là parle (boîte aux lettres, interphone, fenêtre du 4e) ---------- */
const HOME={};
function buildHome(L){ const P=PLACES.find(q=>q.id==='home'); const mk=(geo,mat,x,y,z,act)=>{ const m=new THREE.Mesh(geo,mat); m.matrixAutoUpdate=false; m.matrix.copy(L.mat).multiply(M(x,y,z)); m.castShadow=true; scene.add(m);
    if(act){ m.userData.place=P; m.userData.act=act; pickables.push(m);} return m; };
  // boîte aux lettres, à droite de la porte
  const boxM=new THREE.MeshStandardMaterial({color:0xd9d5ce,roughness:.45,metalness:.25}), darkM=new THREE.MeshStandardMaterial({color:0x3a3f47,roughness:.6});
  const bx=3.3, by=1.35, bz=.2;
  HOME.box=mk(new THREE.BoxGeometry(.62,.78,.26),boxM,bx,by,bz,'courrier');
  mk(new THREE.BoxGeometry(.66,.06,.3),boxM,bx,by+.42,bz);                       // petit toit
  mk(new THREE.BoxGeometry(.44,.035,.02),darkM,bx,by+.22,bz+.135);               // fente
  const tagC=document.createElement('canvas'); tagC.width=256; tagC.height=64; const tx=tagC.getContext('2d'); tx.fillStyle='#fbfaf7'; tx.fillRect(0,0,256,64); tx.fillStyle='#2f343c'; tx.font="800 30px 'Plus Jakarta Sans',Helvetica,Arial"; tx.textAlign='center'; tx.fillText('COURRIER',128,43);
  const tagT=new THREE.CanvasTexture(tagC); tagT.colorSpace=THREE.SRGBColorSpace; mk(new THREE.PlaneGeometry(.36,.09),new THREE.MeshBasicMaterial({map:tagT,toneMapped:false}),bx,by-.12,bz+.132);
  // l'enveloppe qui dépasse de la fente quand il y a du nouveau
  const envC=document.createElement('canvas'); envC.width=256; envC.height=160; const ex=envC.getContext('2d'); ex.fillStyle='#ffffff'; ex.fillRect(0,0,256,160); ex.fillStyle='#C9705A'; ex.fillRect(0,0,256,26);
  ex.strokeStyle='rgba(47,52,60,.25)'; ex.lineWidth=5; ex.beginPath(); ex.moveTo(0,26); ex.lineTo(128,110); ex.lineTo(256,26); ex.stroke();
  const envT=new THREE.CanvasTexture(envC); envT.colorSpace=THREE.SRGBColorSpace;
  HOME.env=mk(new THREE.BoxGeometry(.48,.3,.014),[boxM,boxM,boxM,boxM,new THREE.MeshBasicMaterial({map:envT,toneMapped:false}),boxM],bx,by+.3,bz+.12,'courrier'); HOME.envY=by+.36; HOME.envX=bx; HOME.envZ=bz+.15; HOME.L=L;
  // interphone, entre la porte et la boîte
  const ix=.66, iy=1.45, iz=.16;
  mk(new THREE.BoxGeometry(.26,.44,.06),new THREE.MeshStandardMaterial({color:0xb8b2a8,roughness:.35,metalness:.55}),ix,iy,iz,'interphone');
  mk(new THREE.CircleGeometry(.055,20),darkM,ix,iy+.1,iz+.032);
  for(let k=0;k<3;k++) mk(new THREE.BoxGeometry(.15,.035,.012),darkM,ix,iy-.05-k*.06,iz+.032);
  HOME.led=mk(new THREE.CircleGeometry(.018,12),new THREE.MeshBasicMaterial({color:0x5FAE8C,toneMapped:false}),ix+.08,iy+.18,iz+.033);
  // ta fenêtre au 4e étage : le voyant de la maison
  HOME.winM=new THREE.MeshBasicMaterial({color:0xffcf8a,toneMapped:false,transparent:true,opacity:.92});
  HOME.win=mk(new THREE.PlaneGeometry(1.02,1.62),HOME.winM,4.45,14.25+.84,-.12,'fenetre');
}
const _wc=new THREE.Color();
function updateHome(dt){ if(!HOME.win) return; const D=DATA.home||{}, e=D.etat||'ok', t=performance.now()/1000;
  let col=0xffbf5e, op=1;
  if(e==='rouge'){ col=0xe5604f; op=.95; }
  else if(e==='coupure'){ col=0x262b33; op=.96; }
  else if(e==='veille'){ col=0xffbf5e; op=.45+.25*(.5+.5*Math.sin(t*1.6)); }
  _wc.set(col); HOME.winM.color.lerp(_wc,Math.min(1,dt*3)); HOME.winM.opacity+= (op-HOME.winM.opacity)*Math.min(1,dt*3);
  // l'enveloppe : visible et qui frétille quand il y a du nouveau courrier
  const n=D.nouveau||0; HOME.env.visible=n>0; if(n>0){ const L=HOME.L; const up=.04*Math.sin(t*3)+.02; HOME.env.matrix.copy(L.mat).multiply(M(HOME.envX,HOME.envY+up,HOME.envZ,0,0,.05*Math.sin(t*2.2))); }
  HOME.led.material.color.set(D.gest?0x5FAE8C:0x9aa0a8);
}

/* ---------- GAZ ET ÉLECTRICITÉ : la boutique Plenitude et, derrière, l'enclos des générateurs ---------- */
const NRG={gens:[],arcs:[],nums:{},k:1};
function dotTex(){ const c=document.createElement('canvas'); c.width=c.height=64; const x=c.getContext('2d'); const g=x.createRadialGradient(32,32,0,32,32,32); g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(.5,'rgba(255,255,255,.95)'); g.addColorStop(1,'rgba(255,255,255,0)'); x.fillStyle=g; x.fillRect(0,0,64,64); const t=new THREE.CanvasTexture(c); return t; }
const DOT=dotTex();
const NOAO=[];   // objets légers (fumée, particules) exclus du calcul d'ombre GTAO
// un texte dessiné en particules (points) : renvoie les positions dans un plan de largeur w
function textPoints(str,w,step=3){ const c=document.createElement('canvas'); c.width=640; c.height=150; const x=c.getContext('2d'); x.fillStyle='#fff'; x.font=`800 112px 'Plus Jakarta Sans',Helvetica,Arial,sans-serif`; x.textAlign='center'; x.textBaseline='middle';
  let fs=112; while(x.measureText(str).width>610&&fs>40){ fs-=6; x.font=`800 ${fs}px 'Plus Jakarta Sans',Helvetica,Arial,sans-serif`; } x.fillText(str,320,78);
  const d=x.getImageData(0,0,640,150).data, pts=[]; const sc=w/640; for(let y=0;y<150;y+=step) for(let i=0;i<640;i+=step){ if(d[(y*640+i)*4+3]>140) pts.push((i-320)*sc,(75-y)*sc); } return pts; }
function numCloud(key,str,col,w){ const old=NRG.nums[key]; if(old&&old.str===str) return old; if(old){ old.pts.geometry.dispose(); old.g.remove(old.pts); const k=NOAO.indexOf(old.pts); if(k>=0) NOAO.splice(k,1); }
  const P=textPoints(str,w), n=P.length/2, pos=new Float32Array(n*3), base=new Float32Array(n*3), cols=new Float32Array(n*3), cc=new THREE.Color(col);
  for(let i=0;i<n;i++){ base[i*3]=P[i*2]; base[i*3+1]=P[i*2+1]; base[i*3+2]=(Math.random()-.5)*.05; pos.set([base[i*3],base[i*3+1],base[i*3+2]],i*3); cols[i*3]=cc.r; cols[i*3+1]=cc.g; cols[i*3+2]=cc.b; }
  const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.BufferAttribute(pos,3)); geo.setAttribute('color',new THREE.BufferAttribute(cols,3));
  const pts=new THREE.Points(geo,new THREE.PointsMaterial({size:w/78,map:DOT,vertexColors:true,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}));
  const g=old?old.g:NRG.slots[key]; g.add(pts); NOAO.push(pts); const o={str,pts,base,n,col:cc,g}; NRG.nums[key]=o; return o; }
function labelPlane(lines,w,h,opt={}){ const c=document.createElement('canvas'); const ppu=opt.ppu||220; c.width=Math.round(w*ppu); c.height=Math.round(h*ppu); const x=c.getContext('2d');
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:t,transparent:true,toneMapped:false,side:THREE.DoubleSide}));
  m.userData.draw=(L)=>{ x.clearRect(0,0,c.width,c.height); if(opt.bg){ x.fillStyle=opt.bg; x.beginPath(); x.roundRect(4,4,c.width-8,c.height-8,18); x.fill(); if(opt.edge){ x.strokeStyle=opt.edge; x.lineWidth=6; x.stroke(); } }
    L.forEach((l,i)=>{ x.font=fontDe(l.w||800,l.s,l.ls||0); try{x.letterSpacing=(l.ls||0)+'px';}catch(e){} x.fillStyle=l.c||'#fff'; x.textAlign='center'; x.fillText(l.t,c.width/2,l.y); }); t.needsUpdate=true; };
  m.userData.draw(lines); return m; }
function buildEnergy(em,E){ const P=PLACES.find(q=>q.id==='energie'); const W=E.W||7, D=E.D||5; const root=new THREE.Group(); root.matrixAutoUpdate=false; root.matrix.copy(em); scene.add(root); NRG.root=root; NRG.slots={};
  const add=(m,x,y,z,act)=>{ m.position.set(x,y,z); root.add(m); m.castShadow=true; m.receiveShadow=true; if(act){ m.userData.place=P; m.userData.act=act; pickables.push(m);} return m; };
  const genM=new THREE.MeshStandardMaterial({color:0xe4e2dd,roughness:.5,metalness:.35}), finM=new THREE.MeshStandardMaterial({color:0xcfccc6,roughness:.6,metalness:.3}), insM=new THREE.MeshStandardMaterial({color:0xf6f4ef,roughness:.3});
  // deux générateurs : électricité (bleu) et gaz (orange), avec un liseré lumineux
  [['elec',W+2.0,0x6fd3ff]].forEach(([k,gx,col])=>{
    const body=add(new THREE.Mesh(new THREE.BoxGeometry(2.3,2.0,2.2),genM),gx,1.12,-2.6,'details');
    for(let f=0;f<7;f++) add(new THREE.Mesh(new THREE.BoxGeometry(.05,1.6,.2),finM),gx-1.0+f*.33,1.1,-1.42);
    const ledM=new THREE.MeshBasicMaterial({color:col,toneMapped:false}); const led=add(new THREE.Mesh(new THREE.BoxGeometry(2.32,.07,2.22),ledM),gx,2.05,-2.6); led.castShadow=false;
    const ins=[]; for(const dx of [-.6,0,.6]){ add(new THREE.Mesh(new THREE.CylinderGeometry(.07,.11,.55,10),insM),gx+dx,2.42,-2.6); ins.push(new THREE.Vector3(gx+dx,2.72,-2.6)); }
    NRG.gens.push({k,led,ledM,col:new THREE.Color(col),ins});
    // l'arc électrique qui crépite entre les isolateurs
    const ag=new THREE.BufferGeometry(); ag.setAttribute('position',new THREE.BufferAttribute(new Float32Array(16*3),3));
    const arc=new THREE.Line(ag,new THREE.LineBasicMaterial({color:col,transparent:true,blending:THREE.AdditiveBlending,toneMapped:false})); root.add(arc); NRG.arcs.push({arc,ins,col});
    // l'emplacement du chiffre en particules, au-dessus du générateur
    const slot=new THREE.Group(); slot.position.set(gx,4.2,-2.4); root.add(slot); NRG.slots[k]=slot;
    const lab=labelPlane([{t:'ÉLECTRICITÉ',s:54,y:66,ls:8},{t:'par mois',s:40,y:120,w:600,c:'rgba(255,255,255,.75)'}],2.4,.62); lab.position.set(0,-.72,0); slot.add(lab); slot.userData.lab=lab; slot.userData.titre='ÉLECTRICITÉ';
  });
  // ----- LE GAZ : une cuve couchée sur ses berceaux, la conduite jaune, le compteur et la flamme bleue -----
  { const tx=W+5.1, tz=-2.7; const tankM=new THREE.MeshStandardMaterial({color:0xf1efea,roughness:.35,metalness:.2}), yel=new THREE.MeshStandardMaterial({color:0xf2c230,roughness:.45,metalness:.2});
    const body=add(new THREE.Mesh(new THREE.CylinderGeometry(.82,.82,2.4,32),tankM),tx,1.15,tz,'details'); body.rotation.z=Math.PI/2;
    for(const sd of [-1,1]){ const cap=add(new THREE.Mesh(new THREE.SphereGeometry(.82,24,16,0,Math.PI*2,0,Math.PI/2),tankM),tx+sd*1.2,1.15,tz,'details'); cap.rotation.z=-sd*Math.PI/2;
      add(new THREE.Mesh(new THREE.BoxGeometry(.18,.5,1.3),finM),tx+sd*.75,.27,tz); }
    // conduite jaune : sort de la cuve, longe le sol et rejoint la boutique
    const path=new THREE.CatmullRomCurve3([V(tx-1.9,1.15,tz),V(tx-2.3,1.15,tz),V(tx-2.4,.25,tz),V(tx-2.4,.25,-.9),V(W+.1,.25,-.9),V(W-.05,.9,-.9)]);
    add(new THREE.Mesh(new THREE.TubeGeometry(path,60,.07,10,false),yel),0,0,0);
    // brûleur témoin + flamme bleue
    add(new THREE.Mesh(new THREE.CylinderGeometry(.09,.12,.7,12),finM),tx+.4,2.3,tz);
    const fl=new THREE.Group(); fl.position.set(tx+.4,2.68,tz); root.add(fl);
    const mkF=(r,h,c,o)=>{ const m=new THREE.Mesh(new THREE.ConeGeometry(r,h,20,1,true),new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:o,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false,side:THREE.DoubleSide})); m.position.y=h/2; fl.add(m); return m; };
    NRG.flame={g:fl,parts:[mkF(.2,.75,0x2f6dff,.55),mkF(.12,.5,0x7fc3ff,.7),mkF(.06,.28,0xe8f6ff,.9)]};
    // le montant du gaz en particules, au-dessus de la cuve (comme l'électricité)
    const gs=new THREE.Group(); gs.position.set(tx,4.2,tz); root.add(gs); NRG.slots.gaz=gs;
    const glab=labelPlane([{t:'GAZ',s:54,y:66,ls:8},{t:'par mois',s:40,y:120,w:600,c:'rgba(255,255,255,.75)'}],2.4,.62); glab.position.set(0,-.72,0); gs.add(glab); gs.userData.lab=glab; gs.userData.titre='GAZ'; }
  // le grillage tout autour de l'enclos
  const gc=document.createElement('canvas'); gc.width=gc.height=64; const gx2=gc.getContext('2d'); gx2.strokeStyle='rgba(205,208,212,1)'; gx2.lineWidth=3; gx2.beginPath(); gx2.moveTo(0,0); gx2.lineTo(64,64); gx2.moveTo(64,0); gx2.lineTo(0,64); gx2.stroke();
  const gt=new THREE.CanvasTexture(gc); gt.wrapS=gt.wrapT=THREE.RepeatWrapping; const fenceM=new THREE.MeshStandardMaterial({map:gt,transparent:true,alphaTest:.3,side:THREE.DoubleSide,roughness:.5,metalness:.5});
  const fence=(x0,z0,x1,z1,fh=2.1)=>{ const L=Math.hypot(x1-x0,z1-z0); const t=gt.clone(); t.needsUpdate=true; t.repeat.set(L/.28,fh/.28); const m=new THREE.Mesh(new THREE.PlaneGeometry(L,fh),fenceM.clone()); m.material.map=t; m.position.set((x0+x1)/2,.12+fh/2,(z0+z1)/2); m.rotation.y=-Math.atan2(z1-z0,x1-x0); root.add(m);
    for(let k=0;k<=Math.ceil(L/1.6);k++){ const f=k/Math.ceil(L/1.6); const pm=new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,fh+.2,8),finM); pm.position.set(x0+(x1-x0)*f,.12+fh/2,z0+(z1-z0)*f); root.add(pm); } };
  const xa=W+.5, xb=W+6.7, za=-.5, zb=-D-.1; fence(xa,za,xb,za,.85); fence(xb,za,xb,zb); fence(xa,zb,xb,zb);
  // panneau émaillé accroché au grillage : les nouveaux tarifs
  const warn=labelPlane([{t:'PLENITUDE',s:40,y:56,ls:6,c:'#2f343c'},{t:'—',s:40,y:120,c:'#c9483a'}],1.55,.62,{bg:'#fbfaf7',edge:'#c9483a',ppu:340}); warn.position.set(W+3.6,.5,za+.04); root.add(warn); NRG.warn=warn;
  warn.userData.place=P; warn.userData.act='details'; pickables.push(warn);
  P.view=[V(W+3.55,5.0,9.0).applyMatrix4(em),V(W+3.55,2.3,-2.4).applyMatrix4(em)]; P.fov=70; E.view=P.view;
}
function updateEnergy(dt){ if(!NRG.root) return; const D=DATA.energie||{}, F=D.facts||[], t=performance.now()/1000;
  const val=(re)=>{ const f=F.find(r=>re.test(r[0])); return f?String(f[1]).replace(/\s*par mois/,''):'—'; };
  const mode=NIGHT?'n':'j'; if(NRG.mode!==mode){ NRG.mode=mode; for(const key in NRG.nums){ NRG.nums[key].pts.geometry.dispose(); NRG.nums[key].g.remove(NRG.nums[key].pts); } NRG.nums={};
    for(const key in NRG.slots){ const lab=NRG.slots[key].userData.lab, dark=!NIGHT; lab.userData.draw([{t:NRG.slots[key].userData.titre,s:54,y:66,ls:8,c:dark?'#2f343c':'#fff'},{t:'par mois',s:40,y:120,w:600,c:dark?'#6b7079':'rgba(255,255,255,.75)'}]); } }
  // couleurs « électriques » : cyan éclatant pour l'électricité, orange flamme pour le gaz
  numCloud('elec',val(/électri/i),NIGHT?'#7ff4ff':'#00b8ff',2.6);
  numCloud('gaz',val(/gaz/i),NIGHT?'#ffb35c':'#ff7a12',2.6);
  // la flamme : calme quand tout va bien, elle vacille quand il y a une alerte
  if(NRG.flame){ const alerte=(D.alerts||[]).length>0, w=alerte?.35:.08; NRG.flame.parts.forEach((m,i)=>{ const f=1+Math.sin(t*(7+i*3))*w*.6+(Math.random()-.5)*w; m.scale.set(1+(Math.random()-.5)*w*.4,f,1+(Math.random()-.5)*w*.4); });
    NRG.flame.g.rotation.z=alerte?Math.sin(t*5)*.12:Math.sin(t*1.3)*.02; }
  for(const key in NRG.nums){ const m=NRG.nums[key].pts.material; const b=NIGHT?THREE.AdditiveBlending:THREE.NormalBlending; if(m.blending!==b){ m.blending=b; m.size=NIGHT?2.6/78:2.6/46; m.needsUpdate=true; } }
  // coupure chez toi : tout s'éteint doucement
  const off=(DATA.home&&DATA.home.etat==='coupure'); NRG.k+=((off?0:1)-NRG.k)*Math.min(1,dt*1.5); const k=NRG.k;
  for(const key in NRG.nums){ const o=NRG.nums[key], a=o.pts.geometry.attributes.position.array, c=o.pts.geometry.attributes.color.array;
    for(let i=0;i<o.n;i++){ const j=(Math.random()<.04)?.06:.008; a[i*3]=o.base[i*3]+(Math.random()-.5)*j; a[i*3+1]=o.base[i*3+1]+(Math.random()-.5)*j; a[i*3+2]=o.base[i*3+2]+(Math.random()-.5)*j*2;
      const fl=(Math.random()<.03?1.8:.75+.25*Math.sin(t*9+i))*k; c[i*3]=o.col.r*fl; c[i*3+1]=o.col.g*fl; c[i*3+2]=o.col.b*fl; }
    o.pts.geometry.attributes.position.needsUpdate=true; o.pts.geometry.attributes.color.needsUpdate=true; }
  for(const g of NRG.gens){ g.ledM.color.copy(g.col).multiplyScalar(.15+.85*k*(.85+.15*Math.sin(t*4))); }
  for(const A2 of NRG.arcs){ const a=A2.arc.geometry.attributes.position.array, [p0,p1,p2]=A2.ins; const show=k>.3&&Math.random()<.55; A2.arc.visible=show; if(!show) continue;
    for(let i=0;i<16;i++){ const f=i/15, src=f<.5?p0:p1, dst=f<.5?p1:p2, ff=f<.5?f*2:(f-.5)*2; a[i*3]=src.x+(dst.x-src.x)*ff+(Math.random()-.5)*.08; a[i*3+1]=src.y+.12+Math.sin(ff*Math.PI)*.18+(Math.random()-.5)*.1; a[i*3+2]=src.z+(Math.random()-.5)*.08; }
    A2.arc.geometry.attributes.position.needsUpdate=true; }
  // le panneau émaillé : l'alerte en cours (nouveaux tarifs…)
  const al=(D.alerts||[])[0]; const txt=al?al.t.replace(/^Plenitude\s*[—-]\s*/i,'').slice(0,30):'Échéancier à jour ✓';
  if(NRG.warn.userData.txt!==txt){ NRG.warn.userData.txt=txt; NRG.warn.userData.draw([{t:'PLENITUDE',s:40,y:56,ls:6,c:'#2f343c'},{t:txt,s:al?34:36,y:122,w:700,c:al?'#c9483a':'#5FAE8C'}]); }
}

/* ---------- ABONNEMENTS : la boutique Orange, ses vitrines et ses étiquettes de prix ---------- */
const SHOP={};
function buildShop(L){ const P=PLACES.find(q=>q.id==='orange'); const root=new THREE.Group(); root.matrixAutoUpdate=false; root.matrix.copy(L.mat); scene.add(root);
  const add=(m,x,y,z,act=true)=>{ m.position.set(x,y,z); root.add(m); m.castShadow=true; if(act){ m.userData.place=P; m.userData.act='details'; pickables.push(m);} return m; };
  const white=new THREE.MeshStandardMaterial({color:0xfbfaf7,roughness:.35}), dark=new THREE.MeshStandardMaterial({color:0x2b2f36,roughness:.25,metalness:.4});
  const xs=[1.6,4.0,6.4], z=-.16, y0=.55;
  xs.forEach(cx=>add(new THREE.Mesh(new THREE.BoxGeometry(1.2,.22,.32),white),cx,y0+.11,z));        // présentoirs
  // vitrine 1 : le téléphone (forfait mobile)
  const scC=document.createElement('canvas'); scC.width=192; scC.height=384; const sx=scC.getContext('2d'); const g=sx.createLinearGradient(0,0,0,384); g.addColorStop(0,'#ff8a3c'); g.addColorStop(1,'#ff5a1f'); sx.fillStyle=g; sx.fillRect(0,0,192,384);
  sx.fillStyle='#fff'; sx.font="800 72px 'Plus Jakarta Sans',Helvetica,Arial"; sx.textAlign='center'; sx.fillText('5G',96,200); const scT=new THREE.CanvasTexture(scC); scT.colorSpace=THREE.SRGBColorSpace;
  const ph=add(new THREE.Mesh(new THREE.BoxGeometry(.36,.7,.04),[dark,dark,dark,dark,new THREE.MeshBasicMaterial({map:scT,toneMapped:false}),dark]),xs[0]-.18,y0+.6,z); ph.rotation.x=-.12;
  // vitrine 2 : la Livebox, ses voyants
  add(new THREE.Mesh(new THREE.BoxGeometry(.62,.36,.2),white),xs[1]-.2,y0+.4,z);
  SHOP.leds=[0,1,2].map(k=>add(new THREE.Mesh(new THREE.CircleGeometry(.022,12),new THREE.MeshBasicMaterial({color:0x5FAE8C,toneMapped:false})),xs[1]-.34+k*.08,y0+.45,z+.102,false));
  // les étiquettes de prix (une par contrat) et le tableau du total
  SHOP.tags=xs.map((cx,i)=>{ const tg=labelPlane([{t:'—',s:40,y:60}],i===2?1.4:1.15,i===2?1.08:.83,{bg:'#fbfaf7',edge:'#ff7a1f',ppu:i===2?400:400}); tg.position.set(i===2?cx:cx+.22,i===2?y0+.85:y0+.66,z+.12); tg.rotation.z=i===2?0:.08; root.add(tg); tg.userData.place=P; tg.userData.act='details'; pickables.push(tg);
    if(i<2){ const str=new THREE.Mesh(new THREE.CylinderGeometry(.006,.006,.55,4),dark); str.position.set(cx+.3,y0+1.2,z+.12); root.add(str); } return tg; });
  shopExtras(L,root,P);
}
function updateShop(dt){ if(!SHOP.tags) return; const D=DATA.orange||{}, F=D.facts||[], t=performance.now()/1000;
  const nom=f=>/livebox|box/i.test(f[0])?'LIVEBOX':/5g|mobile|open/i.test(f[0])?'MOBILE':String(f[0]).split('·')[0].trim().slice(0,12).toUpperCase(), prix=f=>String(f[1]).replace(/\s*par mois/,'');
  const CT=F.filter(f=>!/total|factur|engagement/i.test(f[0])).slice(0,2), mob=CT[0], box=CT[1], tot=F.find(f=>/total/i.test(f[0])), nf=F.find(f=>/factur/i.test(f[0]));
  const ville=f=>{ const v=f&&String(f[0]).split('·')[1]; return v?v.trim().normalize('NFC').replace(/^Venissieux$/i,'Vénissieux').toUpperCase():'CONTRAT'; };
  const al=(D.alerts||[])[0];
  const want=[[mob,ville(mob)],[box,ville(box)]].map(([f,n])=>f?[{t:n,s:n.length>10?36:44,y:70,ls:4,c:'#2f343c'},{t:prix(f),s:96,y:178,c:'#ff6a14'},{t:'par mois',s:36,y:236,w:600,c:'#6b7079'}]:[{t:n,s:44,y:90,ls:6,c:'#2f343c'},{t:'—',s:80,y:200,c:'#9aa0a8'}]);
  want.push([{t:'TOTAL',s:52,y:80,ls:10,c:'#2f343c'},{t:tot?prix(tot):(mob?prix(mob):'—'),s:118,y:210,c:'#ff6a14'},{t:'par mois',s:42,y:272,w:600,c:'#6b7079'},al?{t:al.t.slice(0,26),s:34,y:350,w:700,c:'#c9483a'}:{t:nf?nf[1]:'',s:32,y:350,w:600,c:'#6b7079'}]);
  want.forEach((L,i)=>{ const key=JSON.stringify(L); if(SHOP.tags[i].userData.k!==key){ SHOP.tags[i].userData.k=key; SHOP.tags[i].userData.draw(L); } });
  // les voyants de la Livebox : verts, ou rouges s'il reste une facture à payer
  SHOP.leds.forEach((m,k)=>m.material.color.set(D.urgent?((Math.sin(t*4+k)>0)?0xe5604f:0x5a2a26):0x5FAE8C));
  // l'étiquette qui se balance doucement
  SHOP.tags[0].rotation.z=.08+Math.sin(t*1.1)*.03; SHOP.tags[1].rotation.z=-.06+Math.sin(t*1.3+1)*.03;
  // ondes de l'antenne
  if(SHOP.waves){ const col=D.urgent?0xe5604f:D.hf?0xff8a1f:0x5FAE8C; SHOP.waves.forEach((m,i)=>{ const f=((t*.35)+i/4)%1; const r=.6+f*7; m.scale.set(r,r,r); m.material.color.set(col); m.material.opacity=(1-f)*.85; }); }
  // fibre : compte à rebours jusqu'à la prochaine facture
  if(SHOP.fib){ const F2=SHOP.fib, L=F2.x1-F2.x0; let k=.5, jours=null;
    if(D.nextBill&&D.lastBill){ k=Math.min(1,Math.max(0,(Date.now()-D.lastBill)/(D.nextBill-D.lastBill))); jours=Math.max(0,Math.ceil((D.nextBill-Date.now())/864e5)); }
    const len=Math.max(.02,L*k); F2.lit.scale.y=len; F2.lit.position.set(F2.x0+len/2,F2.y,F2.z); F2.tip.position.set(F2.x0+len,F2.y,F2.z); F2.tip.scale.setScalar(1+.25*Math.sin(t*4));
    const pf=(t*.5)%1; F2.pulse.position.set(F2.x0+len*pf,F2.y,F2.z); F2.pulse.visible=len>.3;
    const lt=jours==null?'Prochaine facture : —':jours===0?"Facture aujourd'hui":'Facture dans '+jours+' j';
    if(F2.lab.userData.k!==lt){ F2.lab.userData.k=lt; F2.lab.userData.draw([{t:lt,s:46,y:82,w:800,c:jours!=null&&jours<=3?'#c9483a':'#2f343c'}]); } }
}

/* ---------- ORANGE : l'antenne qui envoie des ondes de couleur, la fibre qui compte les jours ---------- */
function shopExtras(L,root,P){
  // ondes : vertes si tout va bien, orange s'il y a du hors forfait, rouges s'il reste une facture à payer
  if(ANTP){ SHOP.waves=[]; for(let i=0;i<4;i++){ const m=new THREE.Mesh(new THREE.TorusGeometry(1,.035,6,48),new THREE.MeshBasicMaterial({color:0x5FAE8C,transparent:true,opacity:0,depthWrite:false,toneMapped:false}));
    m.rotation.x=Math.PI/2; m.position.set(ANTP.x,ANTP.y,ANTP.z); root.add(m); SHOP.waves.push(m); } }
  // la fibre : un câble le long du soubassement ; la lumière avance vers la porte à mesure que la facture approche
  const x0=.6, x1=5.9, y=.34, z=.2, Lc=x1-x0;
  const cab=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,Lc,10),new THREE.MeshStandardMaterial({color:0xd8d4cc,roughness:.5})); cab.rotation.z=Math.PI/2; cab.position.set((x0+x1)/2,y,z); root.add(cab);
  const litM=new THREE.MeshBasicMaterial({color:0xff7a1f,toneMapped:false}); const lit=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,1,10),litM); lit.rotation.z=Math.PI/2; root.add(lit);
  const tip=new THREE.Mesh(new THREE.SphereGeometry(.08,14,10),new THREE.MeshBasicMaterial({color:0xffd2a8,toneMapped:false})); root.add(tip);
  const pulse=new THREE.Mesh(new THREE.SphereGeometry(.05,10,8),new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false})); root.add(pulse);
  const lab=labelPlane([{t:'—',s:40,y:60}],1.3,.38,{bg:'#fbfaf7',edge:'#ff7a1f',ppu:320}); lab.position.set(x1+.72,.36,z+.02); root.add(lab); lab.userData.place=P; lab.userData.act='details'; pickables.push(lab);
  SHOP.fib={x0,x1,y,z,lit,tip,pulse,lab};
}
/* ---------- TON TRAVAIL : la pointeuse, le panneau sécurité et la cheminée du four ---------- */
const USN={};
function dateFr(t){ const m=String(t).match(/(\d{1,2})(?:er)?\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)/i); if(!m) return null;
  const MO=['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre']; const k=MO.indexOf(m[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')); if(k<0) return null;
  const now=new Date(); let d=new Date(now.getFullYear(),k,+m[1]); if(d<new Date(now.getFullYear(),now.getMonth(),now.getDate())-200*864e5) d=new Date(now.getFullYear()+1,k,+m[1]); return d; }
// un panneau dessiné en canvas (espace de dessin : 1000 px de large)
function canvasPlane(w,h,ppu){ const c=document.createElement('canvas'); c.width=Math.round(w*ppu); c.height=Math.round(h*ppu); const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=4;
  const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:t,toneMapped:false})); m.userData.c=c; m.userData.t=t; m.userData.H=1000*h/w; return m; }
const POSTE_U={M:['Matin','4h–12h'],A:['Après-midi','12h–20h'],N:['Nuit','20h–4h'],R:['Repos',''],J:['Poste à fixer','par le chef']};
function jourU(o){ if(!o) return {n:'—',h:'',tags:[],k:'R'}; const tags=[]; if(o.sup) tags.push('heures sup'); if(o.rem&&o.poste!=='R') tags.push('remonte'); if(o.ferie) tags.push(o.ferie);
  if(o.g==='conge') return {n:'Congé payé',h:'',tags,k:'C'}; if(o.g==='rc') return {n:'Récup',h:'',tags,k:'C'}; if(o.g==='maladie') return {n:'Maladie',h:'',tags,k:'C'};
  const p=POSTE_U[o.poste]||[o.poste||'—','']; if(o.poste==='R'&&o.rem) tags.push('remonte'); return {n:p[0],h:p[1],tags,k:o.poste||'R'}; }
const COUL_U={M:'#E9A23B',A:'#D96B4A',N:'#3F5B8C',R:'#B9BEC4',J:'#9581C2',C:'#5FAE8C'};
function fitTxt(x,s,maxW,size,w){ let f=size; x.font=`${w} ${f}px ${FNT}`; while(x.measureText(s).width>maxW&&f>10){ f-=1; x.font=`${w} ${f}px ${FNT}`; } return f; }
function buildUsine(U){ const P=PLACES.find(q=>q.id==='usine'); const root=new THREE.Group(); root.matrixAutoUpdate=false; root.matrix.copy(U.mat); scene.add(root); USN.root=root;
  const cx=U.W/2, gz=4.2; const grey=new THREE.MeshStandardMaterial({color:0x8b9097,roughness:.45,metalness:.5}), white=new THREE.MeshStandardMaterial({color:0xf3f1ec,roughness:.5});
  const pick=m=>{ m.userData.place=P; m.userData.act='details'; pickables.push(m); return m; };
  // la pointeuse : un boîtier vissé sur la face avant du pilier du portail (pas de poteau planté dans le trottoir)
  const px=cx-3.5, pf=4.56; const bd=pick(new THREE.Mesh(new THREE.BoxGeometry(.6,.78,.08),grey)); bd.position.set(px,1.45,pf+.04); bd.castShadow=true; root.add(bd);
  USN.screen=canvasPlane(.5,.66,640); USN.screen.position.set(px,1.46,pf+.083); root.add(pick(USN.screen));
  // le tableau d'affichage : une vitrine posée sur le muret, entre deux piliers de la clôture (elle remplace la travée de grille)
  const tx0=cx-7.72, tx1=cx-5.28, tw=tx1-tx0, ty0=.52, th=1.56, tz=4.3, tcx=(tx0+tx1)/2; USN.tab={x:tcx,y:ty0+th/2,z:tz};
  const frM=new THREE.MeshStandardMaterial({color:0x6b4f3a,roughness:.55,metalness:.15});
  const back=new THREE.Mesh(new THREE.BoxGeometry(tw,th,.06),frM); back.position.set(tcx,ty0+th/2,tz); back.castShadow=true; back.receiveShadow=true; root.add(pick(back));
  for(const [w,h,x,y] of [[tw,.06,tcx,ty0+.03],[tw,.06,tcx,ty0+th-.03],[.06,th,tx0+.03,ty0+th/2],[.06,th,tx1-.03,ty0+th/2]]){ const f=new THREE.Mesh(new THREE.BoxGeometry(w,h,.1),frM); f.position.set(x,y,tz+.05); f.castShadow=true; root.add(f); }
  const roof=new THREE.Mesh(new THREE.BoxGeometry(tw+.12,.05,.22),frM); roof.position.set(tcx,ty0+th+.025,tz+.06); roof.castShadow=true; root.add(roof);
  USN.board=canvasPlane(tw-.14,th-.14,420); USN.board.position.set(tcx,ty0+th/2,tz+.035); root.add(pick(USN.board));
  const glass=new THREE.Mesh(new THREE.PlaneGeometry(tw-.1,th-.1),new THREE.MeshPhysicalMaterial({color:0xffffff,roughness:.05,metalness:0,transparent:true,opacity:.05,depthWrite:false}));
  glass.position.set(tcx,ty0+th/2,tz+.09); root.add(glass);
  // fumée de la cheminée du four (en poste) et sommet qui rougeoie la nuit
  const chx=U.W*.78, chz=-U.D-5, top=3.3+33.1; USN.smoke=[]; const smM=()=>new THREE.SpriteMaterial({map:DOT,color:0xeeebe6,transparent:true,opacity:0,depthWrite:false});
  for(let i=0;i<18;i++){ const sp=new THREE.Sprite(smM()); sp.userData.ph=i/18; root.add(sp); USN.smoke.push(sp); NOAO.push(sp); } USN.top=V(chx,top,chz);
  USN.glow=new THREE.Mesh(new THREE.TorusGeometry(.98,.12,8,40),new THREE.MeshBasicMaterial({color:0xff6a2a,transparent:true,opacity:0,toneMapped:false})); USN.glow.rotation.x=Math.PI/2; USN.glow.position.copy(USN.top); root.add(USN.glow);
  USN.k=0;
}
function updateUsine(dt){ if(!USN.root) return; const D=DATA.usine||{}, t=performance.now()/1000;
  const on=!!D.enPoste; USN.k+=((on?1:0)-USN.k)*Math.min(1,dt*.8);
  USN.smoke.forEach(sp=>{ const f=(sp.userData.ph+t*.06)%1; sp.position.set(USN.top.x+f*5+Math.sin(t*.5+sp.userData.ph*9)*.6,USN.top.y+.4+f*11,USN.top.z+f*2); const sc=1.6+f*6; sp.scale.set(sc,sc,1); sp.material.opacity=USN.k*.55*(1-f)*Math.min(1,f*6); sp.visible=sp.material.opacity>.005; });
  USN.glow.material.opacity=USN.k*(NIGHT?.9:.25)*(.8+.2*Math.sin(t*3));
  // la pointeuse
  const sem=D.semaine||[], J0=jourU(sem[0]), J1=jourU(sem[1]), key=JSON.stringify([J0,J1]);
  if(USN.screen.userData.k!==key){ USN.screen.userData.k=key; const c=USN.screen.userData.c, x=c.getContext('2d'), S=c.width/1000, H=USN.screen.userData.H; x.setTransform(S,0,0,S,0,0);
    x.fillStyle='#10141a'; x.fillRect(0,0,1000,H); x.textAlign='center';
    const T=(t,y,size,w,col,maxW=880)=>{ if(!t) return; fitTxt(x,t,maxW,size,w); x.fillStyle=col; x.fillText(t,500,y); };
    T('POINTEUSE',130,66,700,'#7f8a96'); x.fillStyle='rgba(255,255,255,.14)'; x.fillRect(80,200,840,5);
    const bloc=(lab,J,y)=>{ T(lab,y,62,700,'#7f8a96'); T(J.n,y+165,170,800,'#ffffff'); T([J.h,...J.tags].filter(Boolean).join(' · '),y+265,66,600,'#cfd6dd'); };
    bloc("AUJOURD'HUI",J0,330); bloc('DEMAIN',J1,820);
    USN.screen.userData.t.needsUpdate=true; }
  // le tableau d'affichage : la semaine, les compteurs (en jours) et les rendez-vous
  const now=new Date(); now.setHours(0,0,0,0);
  const vus=new Set(), conv=(D.alerts||[]).map(a=>({t:a.t,d:dateFr(a.t)})).filter(c=>c.d&&c.d>=now).sort((a,b)=>a.d-b.d).filter(c=>{ const k=+c.d; if(vus.has(k)) return false; vus.add(k); return true; }).slice(0,2);
  const C=D.compteurs||{}, bk=JSON.stringify([sem.slice(0,7),C,conv.map(c=>c.t)]);
  if(USN.board.userData.k!==bk){ USN.board.userData.k=bk; const c=USN.board.userData.c, x=c.getContext('2d'), S=c.width/1000, H=USN.board.userData.H; x.setTransform(S,0,0,S,0,0);
    x.fillStyle='#f4efe6'; x.fillRect(0,0,1000,H); x.textAlign='left';
    // en-tête
    x.fillStyle='#B07F55'; x.fillRect(0,0,1000,74); x.font=`800 34px ${FNT}`; x.fillStyle='#fff'; try{x.letterSpacing='5px';}catch(e){} x.fillText("TABLEAU D'AFFICHAGE",30,50); try{x.letterSpacing='0px';}catch(e){}
    const head=(t,X,Y)=>{ x.font=`800 22px ${FNT}`; x.fillStyle='#8a6a52'; try{x.letterSpacing='3px';}catch(e){} x.fillText(t,X,Y); try{x.letterSpacing='0px';}catch(e){} };
    // la semaine : 7 cases
    head('LES 7 PROCHAINS JOURS',30,118); const JR=['DIM','LUN','MAR','MER','JEU','VEN','SAM'];
    sem.slice(0,7).forEach((o,i)=>{ const J=jourU(o), X=30+i*80, d=new Date(o.d+'T12:00:00'); x.textAlign='center';
      x.font=`700 19px ${FNT}`; x.fillStyle=i===0?'#2f343c':'#7a7f88'; x.fillText(i===0?"AUJ.":JR[d.getDay()],X+34,150); x.font=`600 17px ${FNT}`; x.fillText(String(d.getDate()),X+34,172);
      x.fillStyle=COUL_U[J.k]||'#B9BEC4'; x.beginPath(); x.roundRect(X+4,184,60,60,12); x.fill(); if(i===0){ x.strokeStyle='#2f343c'; x.lineWidth=4; x.stroke(); }
      x.font=`800 30px ${FNT}`; x.fillStyle='#fff'; x.fillText(J.k==='C'?'C':J.k==='J'?'?':J.k,X+34,225);
      if(o.sup){ x.font=`800 15px ${FNT}`; x.fillStyle='#c9483a'; x.fillText('SUP',X+34,266); } else if(o.rem){ x.font=`700 14px ${FNT}`; x.fillStyle='#8a6a52'; x.fillText('remonte',X+34,266); } });
    x.textAlign='left'; x.font=`600 16px ${FNT}`; x.fillStyle='#7a7f88'; x.fillText('M matin · A après-midi · N nuit · R repos',30,298);
    // les rendez-vous
    head('TES RENDEZ-VOUS',30,350);
    if(!conv.length){ x.font=`700 26px ${FNT}`; x.fillStyle='#2f8a57'; x.fillText('Aucune convocation à venir ✓',30,392); }
    conv.forEach((cv,i)=>{ const j=Math.round((cv.d-now)/864e5), Y=372+i*72, nm=cv.t.replace(/\s*[—-]\s*.*$/,'').replace(/\s+le\s+\d.*$/,'').replace(/\s+du travail$/i,'');
      x.fillStyle=j<=3?'#c9483a':'#B07F55'; x.beginPath(); x.roundRect(30,Y,104,54,10); x.fill(); x.textAlign='center'; x.font=`800 24px ${FNT}`; x.fillStyle='#fff'; x.fillText(j===0?"AUJ.":j===1?'DEMAIN':'J−'+j,82,Y+36);
      x.textAlign='left'; fitTxt(x,nm,400,26,700); x.fillStyle='#2f343c'; x.fillText(nm,150,Y+24);
      x.font=`600 19px ${FNT}`; x.fillStyle='#7a7f88'; x.fillText(cv.d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'}),150,Y+48); });
    // séparation
    x.fillStyle='rgba(47,52,60,.14)'; x.fillRect(592,100,3,H-130);
    // les compteurs (jamais d'argent)
    head('TES COMPTEURS',625,118); const j=v=>v==null?'—':String(Math.round(v*100)/100).replace('.',',')+' j';
    const L=[['Congés payés',j(C.cp),'restants'],['COR',j(C.cor),C.cor_janvier!=null?'≈ '+j(C.cor_janvier)+' en janvier':''],['RC8',j(C.rc8),C.rc8_prochain?'prochain fin '+C.rc8_prochain:''],['CET',j(C.cet),C.cm?'+ '+j(C.cm)+' médaille':''],['Remonte',C.remonte?j(C.remonte.reste):'—',C.remonte&&C.remonte.prevu!=null?'restants sur '+j(C.remonte.prevu):'']];
    L.forEach(([a,v,sub],i)=>{ const Y=150+i*82; x.fillStyle='rgba(255,255,255,.75)'; x.beginPath(); x.roundRect(620,Y,350,70,12); x.fill(); x.fillStyle='#B07F55'; x.fillRect(620,Y+12,6,46);
      x.textAlign='left'; x.font=`700 22px ${FNT}`; x.fillStyle='#2f343c'; x.fillText(a,642,Y+30); if(sub){ fitTxt(x,sub,200,16,600); x.fillStyle='#7a7f88'; x.fillText(sub,642,Y+54); }
      x.textAlign='right'; x.font=`800 32px ${FNT}`; x.fillStyle='#2f343c'; x.fillText(v,955,Y+46); });
    x.textAlign='left'; USN.board.userData.t.needsUpdate=true; }
}

/* ---------- TA SANTÉ : la croix verte, la porte d'entrée, le tableau de la salle d'attente ---------- */
const CLN={};
function buildClinic(L){ const P=PLACES.find(q=>q.id==='clinique'); const root=new THREE.Group(); root.matrixAutoUpdate=false; root.matrix.copy(L.mat); scene.add(root);
  const act=(m,a)=>{ m.userData.place=P; m.userData.act=a; pickables.push(m); return m; };
  // croix de pharmacie en points LED, entre les fenêtres du 1er étage, avec son bandeau qui défile
  const cc=document.createElement('canvas'); cc.width=cc.height=256; const ct=new THREE.CanvasTexture(cc); ct.colorSpace=THREE.SRGBColorSpace;
  const cross=new THREE.Mesh(new THREE.PlaneGeometry(1.15,1.15),new THREE.MeshBasicMaterial({map:ct,transparent:true,toneMapped:false})); cross.position.set(3.55,5.75,.14); root.add(act(cross,'details'));
  const back=new THREE.Mesh(new THREE.BoxGeometry(1.25,1.25,.08),new THREE.MeshStandardMaterial({color:0x2b2f36,roughness:.4,metalness:.4})); back.position.set(3.55,5.75,.09); root.add(back);
  const tc=document.createElement('canvas'); tc.width=1024; tc.height=128; const tt=new THREE.CanvasTexture(tc); tt.colorSpace=THREE.SRGBColorSpace;
  const tick=new THREE.Mesh(new THREE.PlaneGeometry(1.7,.26),new THREE.MeshBasicMaterial({map:tt,toneMapped:false})); tick.position.set(3.55,4.95,.14); root.add(act(tick,'details'));
  const tb=new THREE.Mesh(new THREE.BoxGeometry(1.8,.34,.08),new THREE.MeshStandardMaterial({color:0x2b2f36,roughness:.4,metalness:.4})); tb.position.set(3.55,4.95,.09); root.add(tb);
  CLN.cross={c:cc,t:ct}; CLN.tick={c:tc,t:tt};
  // la porte vitrée : un adhésif « Prendre rendez-vous » sur la vitre
  const dc=document.createElement('canvas'); dc.width=512; dc.height=256; const dx=dc.getContext('2d'); dx.fillStyle='rgba(95,174,140,.92)'; dx.beginPath(); dx.roundRect(16,40,480,176,40); dx.fill();
  dx.fillStyle='#fff'; dx.textAlign='center'; dx.font="800 64px 'Plus Jakarta Sans',Helvetica,Arial"; dx.fillText('Prendre',256,118); dx.fillText('rendez-vous',256,190);
  const dt=new THREE.CanvasTexture(dc); dt.colorSpace=THREE.SRGBColorSpace;
  const door=new THREE.Mesh(new THREE.PlaneGeometry(1.1,.55),new THREE.MeshBasicMaterial({map:dt,transparent:true,toneMapped:false})); door.position.set(5.0,1.45,.06); root.add(act(door,'rdv'));
  const dz=new THREE.Mesh(new THREE.PlaneGeometry(2.0,3.2),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false})); dz.position.set(5.0,1.6,.04); root.add(act(dz,'rdv'));
  // le tableau de la salle d'attente, vu à travers la vitrine de gauche
  const wb=labelPlane([{t:'—',s:30,y:40}],1.75,2.1,{bg:'#fbfaf7',edge:'#5FAE8C',ppu:300}); wb.position.set(2.1,1.75,-.1); root.add(act(wb,'details')); CLN.board=wb;
}
function updateClinic(dt){ if(!CLN.cross) return; const D=DATA.clinique||{}, t=performance.now()/1000, nx=D.prochain;
  // croix : verte fixe s'il y a un rendez-vous, éteinte sinon (le cœur pulse doucement)
  const x=CLN.cross.c.getContext('2d'); x.clearRect(0,0,256,256); const on=!!nx, n=11, st=256/n;
  for(let i=0;i<n;i++) for(let j=0;j<n;j++){ const inC=(i>=4&&i<=6)||(j>=4&&j<=6); if(!inC) continue; const lit=on?(.75+.25*Math.sin(t*2.2-(Math.abs(i-5)+Math.abs(j-5))*.5)):.12;
    x.fillStyle=on?`rgba(60,220,120,${lit})`:`rgba(160,170,165,${lit+.15})`; x.beginPath(); x.arc(i*st+st/2,j*st+st/2,st*.36,0,7); x.fill(); }
  CLN.cross.t.needsUpdate=true;
  // bandeau : le jour et l'heure défilent
  const msg=nx?`  PROCHAIN RENDEZ-VOUS · ${nx.qui} · ${nx.quand} · ${nx.centre}  ✚  `:'  AUCUN RENDEZ-VOUS PRÉVU · touche la porte pour en prendre un  ✚  ';
  const y=CLN.tick.c.getContext('2d'); y.fillStyle='#0d1210'; y.fillRect(0,0,1024,128); y.font="800 70px 'Plus Jakarta Sans',Helvetica,Arial"; y.fillStyle=on?'#4be38a':'#e8b04a';
  const w=y.measureText(msg).width, off=(t*140)%w; y.fillText(msg,-off,92); y.fillText(msg,w-off,92); CLN.tick.t.needsUpdate=true;
  // tableau de la salle d'attente
  const L=D.liste||[], k=JSON.stringify(L);
  if(CLN.board.userData.k!==k){ CLN.board.userData.k=k; const R=[{t:"SALLE D'ATTENTE",s:40,y:70,ls:6,c:'#2f8a57'}];
    if(!L.length) R.push({t:'Aucun rendez-vous',s:40,y:200,w:600,c:'#6b7079'});
    L.forEach((r,i)=>{ R.push({t:(r.futur?'● ':'')+r.qui,s:44,y:150+i*104,c:r.futur?'#2f8a57':'#2f343c'}); R.push({t:r.quand,s:32,y:190+i*104,w:600,c:'#6b7079'}); });
    CLN.board.userData.draw(R); }
}
function boardReal(id,o={}){ return (x,t,c)=>{ const H=begin(x,c); const D=dOf(id); const wide=H<900; const T0=o.top||0; const z=o.scale||(H>1400?1.55:1);
  x.globalAlpha=A(t,0); x.fillStyle=D.c; x.beginPath(); x.arc(78,74*z+T0,24*z,0,7); x.fill();
  const title=(o.title||D.n).toUpperCase(); const ft=fitFont(x,title,wide?560:820,40*z,700,24); txt(x,title,78+44*z,88*z+T0,ft,700,PAL.ink,'left',5);
  const sub=o.sub!==undefined?o.sub:D.place; if(sub){ const fs=fitFont(x,sub,wide?560:820,24*z,500,16); txt(x,sub,80+44*z,124*z+T0,fs,500,PAL.soft); }
  let yL=170*z+T0, yR=170*z+T0; const L0=60, R0=wide?520:60, LW=wide?420:880, RW=wide?420:880;
  // colonne de gauche : alertes puis le mot de Jarvis
  if(o.part!==0){
    D.alerts.slice(0,o.maxAlerts??2).forEach((al,i)=>{ x.globalAlpha=A(t,.1+i*.08); const h=wrapLines(x,al.t,LW-60,30*z,700,3).length*36*z+64*z; if(yL+h>H-30) return;
      x.fillStyle='rgba(212,91,78,.1)'; x.beginPath(); x.roundRect(L0-10,yL,LW+20,h,16); x.fill(); x.fillStyle=RED; x.beginPath(); x.roundRect(L0-10,yL,9,h,[16,0,0,16]); x.fill();
      txt(x,(al.d||'À regarder').toUpperCase(),L0+16,yL+34*z,20*z,700,RED,'left',2); para(x,al.t,L0+16,yL+70*z,LW-40,30*z,700,PAL.ink,36*z,3); yL+=h+14; });
    if(o.say!==false && D.say){ x.globalAlpha=A(t,.2); const room=Math.floor((H-30-yL-(wide||o.part===1?0:Math.min(D.facts.length,o.maxFacts??6)*96*z))/(40*z)); if(room>=1){ yL+=8; yL+=para(x,D.say,L0,yL+28*z,LW,30*z,500,'#3d434c',40*z,Math.max(1,Math.min(o.sayLines??5,room)))+10; } }
  }
  if(!wide) yR=Math.max(yR,yL+6);
  // colonne de droite : les faits
  if(o.part!==1){ const F=D.facts.slice(0,o.maxFacts??8);
    F.forEach(([a,b],i)=>{ x.globalAlpha=A(t,.25+i*.06); const vl=wrapLines(x,b,RW-50,32*z,700,2); const h=(34+vl.length*38+18)*z; if(yR+h>H-24) return;
      x.fillStyle='rgba(255,255,255,.8)'; x.beginPath(); x.roundRect(R0-10,yR,RW+20,h,14); x.fill(); x.fillStyle=D.c; x.beginPath(); x.roundRect(R0-10,yR,8,h,[14,0,0,14]); x.fill();
      const fa=fitFont(x,a,RW-40,22*z,600,14); txt(x,a,R0+16,yR+30*z,fa,600,PAL.soft); x.font=`700 ${32*z}px ${FNT}`; x.fillStyle=PAL.ink; vl.forEach((l,j)=>x.fillText(l,R0+16,yR+68*z+j*38*z)); yR+=h+10*z; });
    if(!F.length && o.part===0){ x.globalAlpha=A(t,.2); para(x,D.say,R0,yR+28*z,RW,30*z,500,'#3d434c',40*z,8); } }
  if(o.button){ x.globalAlpha=A(t,.6); x.fillStyle=D.c; x.beginPath(); x.roundRect(1000-60-330,46+T0,330,58,29); x.fill(); txt(x,o.button,1000-60-165,85+T0,24,700,'#fff','center'); }
  x.globalAlpha=1; }; }

function buildOpenings(){
  // ---------- CHEZ TOI : quatre grandes cartes sortent de la façade ----------
  // CHEZ TOI : les infos apparaissent gravées en relief dans le mur, à droite du porche du garage
  const H0=PL.home; if(H0){ buildHome(H0); H0.tX=2.07; H0.tY=1.55; H0.camY=1.75; H0.far=7.8; H0.camDX=0; }
  // ---------- TA VOITURE : une niche dans le mur de la rampe, le panneau s'avance et s'éclaire ----------
  if(GATE){ const gm=GATE.userData.mat, cx=GATE.userData.cx, wx=cx-1.42;
    box2(gm,[wx-.03,wx+.03,2.0,2.06,-4.0,-1.4],'lamp');
    const niche=new THREE.MeshStandardMaterial({color:0xd9d4cc,roughness:.9});
    const nb=new THREE.Mesh(new THREE.BoxGeometry(.04,1.75,2.5),niche); nb.matrixAutoUpdate=false; nb.matrix.copy(gm).multiply(M(wx-.05,.98,-2.7)); scene.add(nb);
    const frM=new THREE.MeshStandardMaterial({color:0xeae6df,roughness:.85}); for(const [dy,dz,h,d] of [[.92,0,.08,2.62],[-.92,0,.08,2.62],[0,1.29,1.9,.08],[0,-1.29,1.9,.08]]){ const f=new THREE.Mesh(new THREE.BoxGeometry(.12,h,d),frM); f.matrixAutoUpdate=false; f.matrix.copy(gm).multiply(M(wx+.04,.98+dy,-2.7+dz)); f.castShadow=true; scene.add(f); }
    newPanel('garage',gm,{x:wx,y:.98,zb:-2.7,ry:Math.PI/2,z0:-.08,z1:.12,w:2.3,h:1.6,kind:'slide',d:0,frame:false,thick:.12,maxD:2.6,glow:.55,draw:boardReal('garage')}); }
  // ---------- TON TRAVAIL : les portes roulantes montent, le planning est derrière ----------
  const U=PL.usine; if(U&&FDOOR.length===2){ const [d1,d2]=FDOOR;
    buildUsine(U); U.tX=U.W/2-5.4; U.tY=1.4; U.camY=1.75; U.far=10.2; U.camDX=0; }
  // ---------- IMPÔTS : l'avis sort de la façade entre les drapeaux ----------
  const I=PL.impots; if(I) newPanel('impots',I.mat,{x:I.W/2,y:6.75,z0:-.5,z1:.42,w:5.0,h:3.0,kind:'slide',d:0,frame:true,thick:.22,draw:boardReal('impots')});
  // ---------- TA SANTÉ ----------
  const C=PL.clinique; if(C){ buildClinic(C); C.tX=3.55; C.tY=3.0; C.camY=1.7; C.far=9.2; C.camDX=0; }
  // ---------- TES PAPIERS : trois papiers encadrés dans les fenêtres de la mairie ----------
  const Mr=PL.mairie; if(Mr) [5.1,8.0,10.9].forEach((cx,i)=>newPanel('mairie',Mr.mat,{x:cx,y:5.3+1.16,z0:-.5,z1:.08,w:1.25,h:1.95,kind:'slide',d:i*.12,thick:.08,draw:docReal('mairie',i)}));
  // ---------- LE BÉBÉ : deux affiches dans les vitrines du cabinet ----------
  const Bb=PL.medecin; if(Bb) [4.6,7.3].forEach((cx,i)=>newPanel('medecin',Bb.mat,{x:cx,y:.55+1.275,z0:-.55,z1:-.06,w:1.85,h:2.4,kind:'slide',d:i*.15,thick:.08,draw:tileReal('medecin',i)}));
  // ---------- ABONNEMENTS : les vitrines deviennent des affiches ----------
  const Or=PL.orange; if(Or){ buildShop(Or); Or.tX=4.0; Or.tY=1.3; Or.camY=1.5; Or.far=9.4; Or.camDX=0; }
  // ---------- GAZ ET ÉLECTRICITÉ : un écran sort du sol devant le poste ----------
  const E=PL.energie; if(E){ const sub=E.sub, em=M(sub.x,0,sub.z-15,0,-Math.PI/2,0);
    buildEnergy(em,E); }
}

buildOpenings(); drawBank(0);
const MAXD={home:13.2,usine:26,impots:13.2,clinique:13.2,mairie:15,medecin:13.2,orange:13.2,energie:18,banque:15};
PLACES.forEach(p=>{ if(MAXD[p.id]) p.maxD=MAXD[p.id]; });
for(const p of PLACES){ const L=PL[p.id]; if(p.id!=='garage'&&L&&L.mat){ const far=L.far||9.6, tx=L.tX??L.W/2; p.view=[V(tx+(L.camDX??L.W*.08),L.camY||2.3,far).applyMatrix4(L.mat),V(tx,L.tY||Math.min(L.H*.42,6.2),-1).applyMatrix4(L.mat)]; } }
{ const E=PLACES.find(q=>q.id==='energie'); if(PL.energie) E.view=PL.energie.view; }
{ const Hm=PLACES.find(q=>q.id==='home'); if(Hm) Hm.fov=55; }
{ const Og=PLACES.find(q=>q.id==='orange'); if(Og) Og.fov=78; }
{ const Us=PLACES.find(q=>q.id==='usine'); if(Us) Us.fov=55; }
{ const Cl=PLACES.find(q=>q.id==='clinique'); if(Cl) Cl.fov=70; }
function updateOpenings(dt){
  for(const id in PANELS){ const want=(SEL&&SEL.id===id&&!anim)?1:0; const k0=openK[id]; openK[id]=cl(k0+(want?1:-1)*dt/2.4); const K=openK[id];
    if(K===k0&&K!==1&&K!==0) continue;
    PANELS[id].forEach(P=>{ const k=ease(cl(K*1.7-(P.o.d||0))); placePanel(P,k); const td=cl(K*1.5-(P.o.d||0)-.25);
      if(Math.abs(td-P.last)>.004||(td===1&&P.last!==1)||(td===0&&P.last!==0)){ P.o.draw(P.c.getContext('2d'),td,P.c); P.tex.needsUpdate=true; P.last=td; } }); }
  // portes roulantes de l'usine
  const ku=ease(cl((openK.usine||0)*1.6));
  if(MESH.fgate){ MESH.fgate.position.y=-2.25*ku; MESH.fgate.material=mats.metal; }
  FDOOR.forEach((d,i)=>{ const m=MESH['fdoor'+i]; if(!m) return; const s=1-.97*ku; const top=.15+d.top; m.scale.y=s; m.position.y=top*(1-s); });
}

function hideFor(cam,tgt){ for(const o of OBST){ o.want=0; if(!cam) continue;
  const ax=cam.x,az=cam.z,bx2=tgt.x,bz=tgt.z, vx=bx2-ax, vz=bz-az, L2=vx*vx+vz*vz||1; let t=((o.p.x-ax)*vx+(o.p.z-az)*vz)/L2; t=cl(t);
  const dx=ax+vx*t-o.p.x, dz=az+vz*t-o.p.z; const near=Math.hypot(dx,dz)<(o.type==='tree'?4.5:2.2); const front=Math.hypot(o.p.x-bx2,o.p.z-bz)<7&&Math.hypot(o.p.x-ax,o.p.z-az)<Math.hypot(bx2-ax,bz-az); if((near&&t<.97)||front) o.want=1; } }
const _Mo=new THREE.Matrix4(), _Ms=new THREE.Matrix4(), _Mr=new THREE.Matrix4();
function updateObst(dt){ for(const o of OBST){ const k0=o.k; o.k+=(o.want-o.k)*Math.min(1,dt*2.6); if(Math.abs(o.k-k0)<1e-4&&o.k<1e-3&&o.done) continue; o.done=o.k<1e-3;
  const e=ease(cl(o.k)), p=o.p; let sx=1,sy=1,sz=1,dy=0;
  if(o.type==='lamp'){ dy=-5.1*e; }                                   // le lampadaire s'enfonce dans le trottoir
  else if(o.type==='tree'){ sy=1-.985*e; sx=sz=1-.75*e; }            // l'arbre se replie dans sa grille
  else if(o.type==='bench'||o.type==='cafe'){ dy=-1.1*e; sy=1-.2*e; } // le banc glisse sous le pavé
  else { dy=-1.0*e; }
  _Mo.makeTranslation(p.x,p.y+dy,p.z).multiply(_Ms.makeScale(sx,sy,sz)).multiply(_Mr.makeTranslation(-p.x,-p.y,-p.z));
  for(const m of o.meshes){ m.matrix.copy(_Mo); m.visible=o.k<.995; } } }
let lastT=performance.now();
function update3D(){
  const now=performance.now(), dt=Math.min(.05,(now-lastT)/1000); lastT=now; selT+=dt;
  for(const m of flagMats) m.userData.U.uT.value=now/1000;
  updateObst(dt); updateHome(dt); updateEnergy(dt); updateShop(dt); updateUsine(dt); updateClinic(dt);
  // mâts : face à la caméra (autour de l'axe vertical), nom qui s'ouvre de près ; trop près, ils se replient
  for(const p of masts){ const M2=p.mast, hp=M2.head.position; M2.spin.rotation.y=Math.atan2(camera.position.x-hp.x,camera.position.z-hp.z);
    const d=camera.position.distanceTo(hp), sel=p===SEL; const want=(sel||d<150)?1:0; M2.open+=(want-M2.open)*Math.min(1,dt*6);
    const e=ease(cl(M2.open)); M2.plate.scale.setScalar(Math.max(.001,e)); M2.plate.position.y=-M2.R-M2.R*.47-(1-e)*.3;
    const bob=sel?Math.sin(selT*2.4)*.12:0; M2.spin.position.y=bob; const tooNear=d<11; const sc=tooNear?.001:(sel?1.18:1); M2.spin.scale.lerp(V(sc,sc,sc),Math.min(1,dt*5));
    M2.g.children[0].scale.y+=((tooNear?.001:1)-M2.g.children[0].scale.y)*Math.min(1,dt*5); M2.g.children[0].position.y=M2.g.children[1].position.y+(M2.g.children[0].geometry.parameters.height*M2.g.children[0].scale.y)/2;
    M2.head.position.y=M2.baseY-(1-M2.g.children[0].scale.y)*(M2.poleH);
    const urg=!!(DATA[p.id]&&DATA[p.id].urgent); M2.badge.visible=urg; if(urg) M2.badge.scale.setScalar(1+.12*Math.sin(selT*5));
    const w=(selT*.7)%1; M2.wave.material.opacity=sel?(1-w)*.7:(urg?(1-((selT*.5)%1))*.45:0); if(urg&&!sel) M2.wave.material.color.set('#D45B4E'); else M2.wave.material.color.set(p.c); M2.wave.scale.setScalar(1+(sel?w:(selT*.5)%1)*1.1); }
  if(ORB){ ORB.position.y=11+Math.sin(selT*1.1)*.3; ORB.children[1].rotation.z+=dt*.4; ORB.children[2].rotation.z-=dt*.3; }
  // halo au sol
  for(const p of PLACES){ if(!p.halo)continue; const on=p===SEL;
    p.halo.material.opacity+=((on?.75+.2*Math.sin(selT*3):0)-p.halo.material.opacity)*.12;
    const s2=on?1+((selT*.6)%1)*.18:1; p.halo2.material.opacity=on?(1-((selT*.6)%1))*.45*Math.min(1,selT*1.6):0; p.halo2.matrix.copy(p.halo.matrix).multiply(new THREE.Matrix4().makeScale(s2,s2,1)); }
  // banque : les colonnes s'écartent, le mur d'infos sort de la façade, le graphique se dessine
  const want=(SEL&&SEL.id==='banque'&&!anim)?1:0; bankK+=(want?1:-1)*dt/2.6; bankK=cl(bankK);
  const kc=ease(cl(bankK*2.2)), kw=ease(cl(bankK*2.2-.75)), kd=cl(bankK*1.6-.45);
  BK.colX.forEach((x0,i)=>{ const m=MESH['bcol'+i]; if(m) m.position.copy(bankAxis).multiplyScalar((colTX[i]-x0)*kc); });
  updateOpenings(dt);
  placeBankWall(kw); if(bankK>0&&bankK<1||(bankK===1&&bankWall.userData.last!==1)||(bankK===0&&bankWall.userData.last!==0)){ drawBank(kd); bankWall.userData.last=bankK; }
}
// occlusion ambiante (ombres de contact douces) + anticrénelage
const rt=new THREE.WebGLRenderTarget(innerWidth*renderer.getPixelRatio(),innerHeight*renderer.getPixelRatio(),{type:THREE.HalfFloatType,samples:4});
const composer=new EffectComposer(renderer,rt);
composer.addPass(new RenderPass(scene,camera));
const gtao=new GTAOPass(scene,camera,innerWidth,innerHeight);
gtao.updateGtaoMaterial({radius:.9,distanceExponent:1.4,thickness:1.5,scale:1.15,samples:MOBILE?8:16});
gtao.updatePdMaterial({lumaPhi:10,depthPhi:2,normalPhi:3,radius:MOBILE?4:6,rings:2,samples:MOBILE?8:16});
gtao.blendIntensity=1.0;
composer.addPass(gtao);
// la fumée et les chiffres en particules ne doivent pas passer dans le calcul d'ombre (sinon : grosse tache noire au-dessus de la cheminée)
{ const ro=gtao.renderOverride.bind(gtao); gtao.renderOverride=(...a)=>{ const h=NOAO.filter(o=>o.visible); h.forEach(o=>o.visible=false); ro(...a); h.forEach(o=>o.visible=true); }; }
composer.addPass(new OutputPass());

addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight,false);composer.setSize(innerWidth,innerHeight);});
window.VILLE={snap:()=>{OBST.forEach(o=>{o.k=o.want;o.done=false;}); for(const id in openK) if(SEL&&id===SEL.id) openK[id]=.999;},focus:(i)=>{const P=PANELS[SEL.id][i]; FOCUS=P; const v=frameInfos([P.info],P.maxD||SEL.maxD||13,1.08); flyTo(v[0],v[1],v[2]); anim.k=.999;},openAll:(id)=>{openK[id]=.999; bankK=id==='banque'?1:bankK;},sel:(id)=>{const p=PLACES.find(q=>q.id===id); select(p); anim.k=.999;},openBank:()=>{bankK=1;},info:()=>{let v=0,n=0;scene.traverse(o=>{if(o.isMesh){n++;v+=o.geometry.attributes.position.count;}});return {tris:v/3,meshes:n};},view:(k)=>goView(k,true),cam:(p,t,f)=>{camera.position.set(...p);controls.target.set(...t);if(f){camera.fov=f;camera.updateProjectionMatrix();}controls.update();},time:setTime,ready:false};

function frame(){
  const _now=performance.now(), _fdt=Math.min(.1,(_now-(frame.t||_now))/1000); frame.t=_now;
  if(anim){anim.k=Math.min(1,anim.k+(anim.spd||.025)*60*_fdt); const e=anim.k*anim.k*(3-2*anim.k);
    if(anim.ctrl){ const u=1-e; camera.position.set(u*u*anim.p0.x+2*u*e*anim.ctrl.x+e*e*anim.p.x,u*u*anim.p0.y+2*u*e*anim.ctrl.y+e*e*anim.p.y,u*u*anim.p0.z+2*u*e*anim.ctrl.z+e*e*anim.p.z); }
    else camera.position.lerpVectors(anim.p0,anim.p,e); controls.target.lerpVectors(anim.t0,anim.t,e); camera.fov=anim.f0+(anim.f-anim.f0)*e; camera.updateProjectionMatrix(); if(anim.k>=1)anim=null;}
  sky.position.copy(camera.position);
  shift+=(shiftGoal-shift)*.08; if(shift>.001) camera.setViewOffset(innerWidth,innerHeight,0,innerHeight*.2*shift,innerWidth,innerHeight); else camera.clearViewOffset();
  controls.update(); update3D(); composer.render(); if(HK.frame) HK.frame(); requestAnimationFrame(frame);
}
let shift=0, shiftGoal=0;
frame();
window.VILLE.ready=true;

function setDonnees(list){ for(const d of list){ const old=DATA[d.id]; DATA[d.id]=d; (PANELS[d.id]||[]).forEach(P=>P.last=-1);
    const p=PLACES.find(q=>q.id===d.id); if(p&&p.mast&&(!old||old.status!==d.status||old.urgent!==d.urgent)){ const {t,ar}=plateTex(p,d); const ph=p.mast.R*.52*(d.status?178/112:1);
      p.mast.plate.children.forEach(pl=>{ pl.material.map&&pl.material.map.dispose(); pl.material.map=t; pl.material.needsUpdate=true; pl.geometry.dispose(); pl.geometry=new THREE.PlaneGeometry(ph*ar,ph); }); } } if(bankWall) bankWall.userData.last=-1; }
function orbit(a){ const s=new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target)); let th=s.theta,r=s.radius,ph=s.phi;
  if(a.tourner) th+=(Number(a.tourner)||0)*Math.PI/180; if(a.zoom==='avant') r*=.6; else if(a.zoom==='arriere') r*=1.6; if(a.vue==='dessus') ph=.35; else if(a.vue==='rasante') ph=1.2;
  r=Math.max(3,Math.min(220,r)); s.set(r,ph,th); const p=new THREE.Vector3().setFromSpherical(s).add(controls.target); flyTo(p,controls.target.clone(),camera.fov); }

/* ---------- La ville retravaillée dans Blender (ville.glb) ----------
   L'app construit toujours sa ville (lieux cliquables, infos du décor, animations) ; ce fichier
   remplace ensuite les formes par les versions corrigées (toits fermés, bancs, cour de l'énergie…)
   et ajoute les nouvelles voitures, le feuillage des arbres et le mobilier. S'il ne charge pas,
   la ville d'origine reste affichée. */
const AJOUTS=/^(Voiture_\d+|M_ob\d+_feuilles|Marquage_sol|Jardinieres_|Colonne_Morris|Parasol_cafe)/;
async function chargerVilleBlender(url){
  const draco=new DRACOLoader(); draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');
  const gl=new GLTFLoader(); gl.setDRACOLoader(draco);
  const g=await gl.loadAsync(url); draco.dispose(); g.scene.updateMatrixWorld(true);
  const parNom={}; for(const k in MESH) parNom[MESH[k].name]=MESH[k]; parNom['Rue_pavee']=road;
  const ajouts=[]; let n=0;
  g.scene.traverse(o=>{
    if(o.isMesh && parNom[o.name]){ const cible=parNom[o.name];
      const geo=o.geometry.clone().applyMatrix4(o.matrixWorld); cible.updateMatrixWorld(true);
      geo.applyMatrix4(new THREE.Matrix4().copy(cible.matrixWorld).invert());
      if(!cible.material.vertexColors) geo.deleteAttribute('color');
      cible.geometry.dispose(); cible.geometry=geo; n++; return; }
    if(AJOUTS.test(o.name) && !ajouts.some(a=>{ let p=o.parent; while(p){ if(p===a) return true; p=p.parent; } return false; })) ajouts.push(o);
  });
  if(n<10) throw new Error('ville.glb : '+n+' formes reconnues seulement');
  for(const k of ['car','tyre']) if(MESH[k]) MESH[k].visible=false;     // anciennes voitures, remplacées
  const lampes={Material_5:mats.lamp,Material_9:mats.lampRed};
  for(const a of ajouts){
    const w=a.matrixWorld.clone(); a.removeFromParent(); a.matrix.copy(w); a.matrix.decompose(a.position,a.quaternion,a.scale);
    a.traverse(m=>{ if(!m.isMesh) return; m.castShadow=true; m.receiveShadow=true;
      const mt=m.material; if(lampes[mt.name]) m.material=lampes[mt.name]; else { mt.envMapIntensity=.6; mt.vertexColors=!!m.geometry.attributes.color; } });
    const f=/^M_ob(\d+)_feuilles/.exec(a.name);
    if(f && OBST[+f[1]]){ a.updateMatrix(); a.matrixAutoUpdate=false; OBST[+f[1]].meshes.push(a); }   // le feuillage se replie avec son arbre
    scene.add(a);
  }
  OBST.forEach(o=>{ o.done=false; });
  return n;
}
chargerVilleBlender('ville.glb?v=1').then(n=>console.log('Ville Blender :',n,'formes remplacées')).catch(e=>console.warn('Ville Blender non chargée, ville d’origine gardée :',e));

/* ---------- Ta voiture : la vraie DS5 (Blanc Nacré), chargée depuis le coffre privé ---------- */
let ds5=null;
async function chargerVoiture(url){
  if(ds5) return true; if(!DS5_SPOT) throw new Error('place du garage introuvable'); if(!url) throw new Error('pas de lien');
  const draco=new DRACOLoader(); draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');
  const gl=new GLTFLoader(); gl.setDRACOLoader(draco);
  const g=await gl.loadAsync(url); draco.dispose();
  const car=g.scene;
  car.traverse(o=>{ if(!o.isMesh) return; o.castShadow=true; o.receiveShadow=true;
    const m=o.material; if(m&&m.transmission>0){ // vitres et verres de phares : transparence simple, légère sur téléphone
      const sombre=m.color.getHSL({}).l<.3; m.transmission=0; m.transparent=true; m.opacity=sombre?.72:.28; m.depthWrite=false; m.roughness=.05; m.metalness=.1; }
    if(m) m.envMapIntensity=m.metalness>.5?1.1:.8; });
  // le modèle regarde vers +Z ; l'ancienne voiture regardait vers +X dans son repère
  car.position.copy(DS5_SPOT.p); car.rotation.y=DS5_SPOT.rot+Math.PI/2; car.name='DS5';
  scene.add(car); ds5=car; return true;
}
return { camera, controls, renderer, scene, ouvrir, fermer, setDonnees, orbit, chargerVoiture,
  ensemble(){ fermer(); const [p,t,f]=VIEWS.ciel; flyTo(p,t,f); },
  setNuit(n){ setTime(n?2:0); }, decalage(k){ shiftGoal=k; },
  arreteVol(){ anim=null; },
  instantane(){ if(anim) anim.k=.999; OBST.forEach(o=>{o.k=o.want;o.done=false;}); if(SEL){ openK[SEL.id]=.999; if(SEL.id==='banque') bankK=1; } }, icone:id=>svg(id), couleur:id=>(PLACES.find(q=>q.id===id)||{}).c, ids:PLACES.map(p=>p.id) };

}

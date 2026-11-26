'use strict';
if(!CanvasRenderingContext2D.prototype.roundRect){CanvasRenderingContext2D.prototype.roundRect=function(x,y,w,h){this.rect(x,y,w,h);};}
/* ---------- 定数 ---------- */
const DISPLAY="'Yuji Syuku','Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif";
const UIF="'Zen Kaku Gothic New','Hiragino Sans','Noto Sans JP',sans-serif";
const COL=[{name:'朱',main:'#c8372d',light:'#f08e80'},{name:'藍',main:'#2c4f96',light:'#9ab8f0'}];
const INK='#141512', PALE='#efe8d6';
const TIER={'並':'#d9d3c4','上':'#9cc4ea','極':'#e8c35a','幻':'#e9b8ff','絶':'#ffffff','分':'#bdb6a6'};
const TIERNAME={'並':'並','上':'上','極':'極','幻':'幻','絶':'絶','分':'引き分け'};
const FIN={
  '疾風':{tier:'並',yomi:'はやて',desc:'棒立ちを居合で斬る'},
  '先の先':{tier:'並',yomi:'せんのせん',desc:'居合同士、先に抜いた側が斬る'},
  '隙穿ち':{tier:'並',yomi:'すきうがち',desc:'見切りの硬直を斬る'},
  '陽炎':{tier:'上',yomi:'かげろう',desc:'居合を解いて見切りを誘い、斬る'},
  '二の太刀':{tier:'上',yomi:'にのたち',desc:'見切りで二度返す'},
  '止め':{tier:'上',yomi:'とどめ',desc:'見切りで返した側が、居合で決める'},
  '死中活':{tier:'極',yomi:'しちゅうかつ',desc:'見切られた側が、居合で逆転'},
  '流転':{tier:'極',yomi:'るてん',desc:'居合を解き、見切りで返して決める'},
  '紙一重':{tier:'極',yomi:'かみひとえ',desc:'互いに後なし、居合で斬り勝つ'},
  '鏡返し':{tier:'極',yomi:'かがみがえし',desc:'互いに後なし、見切りで返し勝つ'},
  '明鏡止水':{tier:'幻',yomi:'めいきょうしすい',desc:'寸分違わぬ見切り'},
  '一閃':{tier:'絶',yomi:'いっせん',desc:'互いに後なし、寸分違わぬ見切り'},
  '睨み合い':{tier:'分',yomi:'にらみあい',desc:'時間切れ'}
};
const KIMG=new Image(), KIMG_W=900, KIMG_H=106, KIMG_TSUBA=226; let KIMG_PALE=null;
KIMG.onload=()=>{ try{ buildKatanas(); }catch(e){ console.error(e); } const t=document.createElement('canvas'); t.width=KIMG_W; t.height=KIMG_H; const x=t.getContext('2d'); x.drawImage(KIMG,0,0,KIMG_W,KIMG_H); x.globalCompositeOperation='source-in'; x.fillStyle=PALE; x.fillRect(0,0,KIMG_W,KIMG_H); KIMG_PALE=t; };
KIMG.src=window.ISSEN_KATANA_IMAGE;
const KNUM=['〇','一','二','三','四','五','六','七','八','九','十'];
const kn=n=>n<=10?KNUM[n]:String(n);

/* ---------- 調整値（すべて仮） ---------- */
const DEF={charge:800,cancelRec:150,window:400,just:30,mkRec:850,ryuten:700,roundSec:120,toWin:2,gauges:false,sound:true};
const TIMING_KEYS=['charge','cancelRec','window','just','mkRec','ryuten','roundSec'];
const SPEC=[
  ['charge','居合の溜め','ms',150,1500,10,'押してから斬撃が出るまで。この間は相手に構えが見える。'],
  ['cancelRec','居合を解いた後の硬直','ms',0,800,10,'溜め中にもう一度押して解いた後、動けない時間。'],
  ['window','見切りの待機時間','ms',100,1500,10,'この間に斬られると見切り返し。'],
  ['just','ジャスト見切りの幅','ms',20,300,5,'見切りを押してからこの時間内に斬撃が来ると明鏡止水（一発で一本）。'],
  ['mkRec','見切り空振りの硬直','ms',100,2500,10,'待機中に居合が来なかった後の隙。'],
  ['ryuten','流転の猶予','ms',200,2000,50,'居合を解いてからこの時間内に見切りを始め、それで一本を決めると流転。'],
  ['roundSec','一本の制限時間','秒',15,180,5,'切れたら睨み合い（引き分け）。'],
  ['toWin','先取本数','本',1,5,1,'']
];
const SKEY='issen-proto-v1';
let CFG=Object.assign({},DEF);
try{ const s=JSON.parse(localStorage.getItem(SKEY)||'null'); if(s&&typeof s.sound==='boolean') CFG.sound=s.sound; if(s&&s.netInfo) CFG.netInfo=true; }catch(e){}
function saveCfg(){ try{ localStorage.setItem(SKEY,JSON.stringify(CFG)); }catch(e){} }

/* ---------- 便利関数 ---------- */
const clamp=(v,a=0,b=1)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const ease=t=>1-Math.pow(1-t,3);
const easeIn=t=>t*t;
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}

/* ---------- 時計（一時停止対応） ---------- */
let pauseTotal=0,pausedAt=null;const pauseWhy=new Set();
/* オンライン対戦中は、二人で合わせた時計（NETCLK）を使い、一時停止はしない */
let NETCLK=null;
function gnow(){ if(NETCLK) return performance.now()+NETCLK.off; return (pausedAt!=null?pausedAt:performance.now())-pauseTotal; }
function pause(why,on){ if(on) pauseWhy.add(why); else pauseWhy.delete(why);
  const want=pauseWhy.size>0&&!NETCLK;
  if(want&&pausedAt==null) pausedAt=performance.now();
  else if(!want&&pausedAt!=null){ pauseTotal+=performance.now()-pausedAt; pausedAt=null; } }

/* ---------- 音 ---------- */
let AC=null,NB=null;
function ensureAudio(){ try{ if(!AC){ const A=window.AudioContext||window.webkitAudioContext; if(!A) return; AC=new A();
  const len=AC.sampleRate; NB=AC.createBuffer(1,len,AC.sampleRate); const d=NB.getChannelData(0); for(let i=0;i<len;i++) d[i]=Math.random()*2-1; }
  if(AC.state==='suspended') AC.resume(); }catch(e){} }
function nz(t,dur,type,f0,f1,q,g){ const s=AC.createBufferSource(); s.buffer=NB; const bq=AC.createBiquadFilter(); bq.type=type;
  bq.frequency.setValueAtTime(f0,t); if(f1) bq.frequency.exponentialRampToValueAtTime(f1,t+dur); bq.Q.value=q;
  const gn=AC.createGain(); gn.gain.setValueAtTime(g,t); gn.gain.exponentialRampToValueAtTime(0.0001,t+dur);
  s.connect(bq); bq.connect(gn); gn.connect(AC.destination); s.start(t); s.stop(t+dur+0.05); }
function tone(t,f,dur,g,type){ const o=AC.createOscillator(); o.type=type||'sine'; o.frequency.setValueAtTime(f,t);
  const gn=AC.createGain(); gn.gain.setValueAtTime(0.0001,t); gn.gain.exponentialRampToValueAtTime(g,t+0.005); gn.gain.exponentialRampToValueAtTime(0.0001,t+dur);
  o.connect(gn); gn.connect(AC.destination); o.start(t); o.stop(t+dur+0.05); }
function sfx(n){ if(!CFG.sound||!AC) return; try{ const t=AC.currentTime;
  switch(n){
    case 'clack': nz(t,0.08,'bandpass',2200,0,6,0.9); tone(t,1100,0.12,0.25,'triangle'); nz(t+0.11,0.07,'bandpass',2600,0,6,0.7); tone(t+0.11,1300,0.1,0.2,'triangle'); break;
    case 'koi': tone(t,3400,0.06,0.07); nz(t,0.03,'highpass',5000,0,1,0.15); break;
    case 'mk': nz(t,0.25,'lowpass',900,300,1,0.2); break;
    case 'cancel': nz(t,0.05,'bandpass',1500,0,3,0.25); break;
    case 'slash': nz(t,0.28,'bandpass',7000,1200,2,0.7); tone(t+0.02,2600,0.9,0.05); tone(t+0.02,3900,0.6,0.03); break;
    case 'clash': [1250,1870,2790,4100].forEach((f,i)=>tone(t,f,0.75-i*0.12,0.1/(i+1)+0.03,'triangle')); nz(t,0.12,'highpass',3000,0,1,0.5); break;
    case 'thud': tone(t,85,0.35,0.35); nz(t,0.15,'lowpass',400,0,1,0.3); break;
    case 'gong': [196,294,392,523].forEach((f,i)=>tone(t,f,2.4,0.12/(i+1))); break;
    case 'drum': tone(t,58,0.6,0.55); tone(t,92,0.3,0.25); nz(t,0.08,'lowpass',300,0,1,0.4); tone(t+0.28,58,0.5,0.45); nz(t+0.28,0.08,'lowpass',300,0,1,0.3); break;
    case 'chime': [1568,2093,2637].forEach((f,i)=>tone(t+i*0.07,f,0.9,0.06)); break;
  } }catch(e){} }

/* ---------- 画面（1画面 or 向かい合わせの2画面） ---------- */
const cv=document.getElementById('cv'), ctx=cv.getContext('2d');
let SW=0,SH=0,lastW=0,lastH=0,lastD=0,VW=0,VH=0,DPR=1,GY=0,FH=0,bg=null,SA={t:0,r:0,b:0,l:0},SAFE={t:0,r:0,b:0,l:0},MIR=false;
let VIEWS=[];
const bgCache={};
const sideX=s=>s===0?VW*0.2:VW*0.8;
const mx=x=>MIR?VW-x:x;
function readSafe(){ const cs=getComputedStyle(document.getElementById('safe'));
  SAFE={t:parseFloat(cs.paddingTop)||0,r:parseFloat(cs.paddingRight)||0,b:parseFloat(cs.paddingBottom)||0,l:parseFloat(cs.paddingLeft)||0}; }
function layoutViews(){
  if(G.mode==='vs'){
    const hw=SW/2, s={t:8,r:8,b:8,l:8};
    VIEWS=[{me:0,ctrl:[0],w:SH,h:hw,m:[0,1,-1,0,hw,0],rect:[0,0,hw,SH],mirror:false,sa:s,btns:[]},
           {me:1,ctrl:[1],w:SH,h:hw,m:[0,-1,1,0,hw,SH],rect:[hw,0,hw,SH],mirror:true,sa:s,btns:[]}];
  } else if(G.mode==='online'){
    VIEWS=[{me:NET.me,ctrl:NET.watch?[]:[NET.me],w:SW,h:SH,m:[1,0,0,1,0,0],rect:[0,0,SW,SH],mirror:NET.me===1,sa:SAFE,btns:[]}];
  } else {
    VIEWS=[{me:0,ctrl:G.mode==='cpu'?[0]:[],w:SW,h:SH,m:[1,0,0,1,0,0],rect:[0,0,SW,SH],mirror:false,sa:SAFE,btns:[]}];
  }
  setView(VIEWS[0]);
}
function setView(v){
  VW=v.w; VH=v.h; MIR=v.mirror; SA=v.sa;
  GY=Math.round(VH*0.68); FH=Math.min(VH*0.32,VW*0.22);
  const key=VW+'x'+VH+'@'+DPR; if(!bgCache[key]) bgCache[key]=buildBG(); bg=bgCache[key];
}
function resize(){ DPR=Math.min(2,window.devicePixelRatio||1); const bx=cv.getBoundingClientRect();
  SW=Math.round(bx.width)||window.innerWidth; SH=Math.round(bx.height)||window.innerHeight;
  if(SW===lastW&&SH===lastH&&DPR===lastD&&VIEWS.length) return; lastW=SW; lastH=SH; lastD=DPR;
  cv.width=Math.round(SW*DPR); cv.height=Math.round(SH*DPR);
  readSafe(); layoutViews(); checkRotate(); }

function buildBG(){
  const bgc=document.createElement('canvas'); bgc.width=Math.round(VW*DPR); bgc.height=Math.round(VH*DPR);
  const b=bgc.getContext('2d'); b.setTransform(DPR,0,0,DPR,0,0);
  const rnd=mulberry32(11);
  const sky=b.createLinearGradient(0,0,0,GY); sky.addColorStop(0,'#bccbb7'); sky.addColorStop(0.55,'#d9e2d1'); sky.addColorStop(1,'#eceee2');
  b.fillStyle=sky; b.fillRect(0,0,VW,GY+2);
  const sg=b.createRadialGradient(VW*0.5,VH*0.3,0,VW*0.5,VH*0.3,VH*0.55); sg.addColorStop(0,'rgba(255,252,238,0.95)'); sg.addColorStop(1,'rgba(255,252,238,0)');
  b.fillStyle=sg; b.fillRect(0,0,VW,VH);
  const layers=[{n:30,c:'#aebfa8',w:[0.005,0.01],leaf:0.3},{n:18,c:'#8ba487',w:[0.01,0.018],leaf:0.5},{n:10,c:'#61805f',w:[0.018,0.03],leaf:0.8}];
  layers.forEach((L,li)=>{
    for(let i=0;i<L.n;i++){
      let x=rnd()*VW;
      if(li===2){ const cxs=[VW*0.2,VW*0.8]; for(const cx of cxs){ if(Math.abs(x-cx)<VW*0.06) x+= (x<cx?-1:1)*VW*0.07; } }
      const w=Math.max(2,VW*(L.w[0]+rnd()*(L.w[1]-L.w[0])));
      drawStalk(b,x,w,(rnd()-0.5)*0.05,L.c,L.leaf,rnd);
    }
    const m=b.createLinearGradient(0,0,0,GY); const a1=li<2?0.38:0.12, a2=li<2?0.6:0.22;
    m.addColorStop(0,'rgba(228,234,222,0)'); m.addColorStop(0.7,'rgba(228,234,222,'+a1+')'); m.addColorStop(1,'rgba(236,238,228,'+a2+')');
    b.fillStyle=m; b.fillRect(0,0,VW,GY);
  });
  const gr=b.createLinearGradient(0,GY,0,VH); gr.addColorStop(0,'#7c7562'); gr.addColorStop(0.25,'#635c4b'); gr.addColorStop(1,'#3f3a2f');
  b.fillStyle=gr; b.fillRect(0,GY,VW,VH-GY);
  b.fillStyle='rgba(236,238,226,0.35)'; b.fillRect(0,GY,VW,2);
  b.strokeStyle='rgba(40,48,36,0.45)'; b.lineWidth=1.2;
  for(let i=0;i<70;i++){ const x=rnd()*VW, y=GY+rnd()*(VH-GY)*0.5+2, l=4+rnd()*10;
    b.beginPath(); b.moveTo(x,y); b.quadraticCurveTo(x+(rnd()-0.5)*6,y-l*0.6,x+(rnd()-0.5)*8,y-l); b.stroke(); }
  return bgc;
}
function drawStalk(b,x,w,lean,col,leafAmt,rnd){
  const H=GY+6;
  b.save(); b.translate(x,GY+4); b.rotate(lean);
  b.fillStyle=col; b.fillRect(-w/2,-H-20,w,H+20);
  b.fillStyle='rgba(255,255,255,0.13)'; b.fillRect(-w/2+w*0.18,-H-20,w*0.2,H+20);
  const seg=VH*(0.11+rnd()*0.07);
  b.fillStyle='rgba(20,30,18,0.22)';
  const nodes=[];
  for(let y=-seg*(0.4+rnd()*0.6); y>-H-20; y-=seg){ b.fillRect(-w/2-1,y,w+2,Math.max(1.5,w*0.14)); nodes.push(y); }
  b.fillStyle=col;
  nodes.forEach(y=>{
    if(y>-H*0.4||rnd()>leafAmt) return;
    const sd=rnd()<0.5?-1:1; const bx=sd*w*0.5, bl=w*2+rnd()*VH*0.04;
    b.strokeStyle=col; b.lineWidth=Math.max(1,w*0.12); b.beginPath(); b.moveTo(bx,y); b.lineTo(bx+sd*bl,y-bl*0.3); b.stroke();
    const n=3+Math.floor(rnd()*4);
    for(let k=0;k<n;k++){ const lx=bx+sd*bl*(0.5+rnd()*0.5), ly=y-bl*0.3*(0.5+rnd()*0.5);
      const ang=sd*(0.4+rnd()*1.0)+Math.PI/2*(rnd()<0.5?0.3:0.6); const L=VH*(0.03+rnd()*0.025);
      b.save(); b.translate(lx,ly); b.rotate(ang); b.beginPath(); b.moveTo(0,0); b.quadraticCurveTo(L*0.5,-L*0.12,L,0); b.quadraticCurveTo(L*0.5,L*0.12,0,0); b.fill(); b.restore(); }
  });
  b.restore();
}

/* ---------- 構え（棒人間の関節。右向き、身長=1） ---------- */
const JK=['head','neck','hip','kF','fF','kB','fB','eF','hF','eB','hB'];
const POSES={
  idle:{head:[0.02,-0.9],neck:[0,-0.78],hip:[0,-0.46],kF:[0.08,-0.23],fF:[0.14,0],kB:[-0.06,-0.23],fB:[-0.12,0],eF:[0.12,-0.62],hF:[0.17,-0.53],eB:[-0.02,-0.6],hB:[0.05,-0.48],blade:0,bAng:0},
  charge:{head:[0.13,-0.79],neck:[0.09,-0.68],hip:[-0.04,-0.38],kF:[0.17,-0.2],fF:[0.28,0],kB:[-0.14,-0.16],fB:[-0.27,0],eF:[0.16,-0.53],hF:[0.13,-0.44],eB:[0.0,-0.5],hB:[0.04,-0.38],blade:0,bAng:0},
  mikiri:{head:[0,-0.9],neck:[0,-0.78],hip:[0,-0.44],kF:[0.1,-0.22],fF:[0.16,0],kB:[-0.08,-0.22],fB:[-0.15,0],eF:[0.13,-0.69],hF:[0.25,-0.74],eB:[-0.05,-0.6],hB:[0.06,-0.47],blade:0,bAng:0},
  slump:{head:[0.09,-0.74],neck:[0.04,-0.68],hip:[-0.02,-0.4],kF:[0.1,-0.2],fF:[0.14,0],kB:[-0.06,-0.19],fB:[-0.12,0],eF:[0.07,-0.5],hF:[0.09,-0.35],eB:[-0.03,-0.5],hB:[-0.01,-0.34],blade:0,bAng:0},
  follow:{head:[0.2,-0.79],neck:[0.15,-0.69],hip:[0,-0.37],kF:[0.28,-0.2],fF:[0.41,0],kB:[-0.18,-0.12],fB:[-0.35,0],eF:[0.3,-0.67],hF:[0.43,-0.71],eB:[0.02,-0.52],hB:[0.05,-0.4],blade:1,bAng:-0.12},
  counter:{head:[0.16,-0.8],neck:[0.12,-0.7],hip:[0,-0.38],kF:[0.25,-0.2],fF:[0.37,0],kB:[-0.16,-0.13],fB:[-0.3,0],eF:[0.27,-0.6],hF:[0.36,-0.5],eB:[0.02,-0.52],hB:[0.06,-0.42],blade:1,bAng:0.65},
  stagger:{head:[-0.11,-0.82],neck:[-0.08,-0.72],hip:[-0.02,-0.42],kF:[0.1,-0.2],fF:[0.17,0],kB:[-0.14,-0.2],fB:[-0.21,0],eF:[0.04,-0.56],hF:[0.14,-0.48],eB:[-0.18,-0.62],hB:[-0.27,-0.55],blade:1,bAng:0.95}
};
const clonePose=n=>{const T=POSES[n],o={};JK.forEach(k=>o[k]=T[k].slice());o.blade=T.blade;o.bAng=T.bAng;return o;};

/* ---------- 刀（仮の刀は初期刀の絵の色を変えて作る。src に絵を入れればその絵に差し替わる） ---------- */
const KATANA=[
  {id:'mumei',mei:'無銘',yomi:'むめい',tier:'並',wrap:null,metal:'gold',blade:null,lore:'名もなき初めの一振り。持ち主とともに名を得る。',slash:{col:'#ffffff'}},
  {id:'nowaki',mei:'野分',yomi:'のわき',tier:'並',wrap:[112,74,44],metal:'silver',blade:null,lore:'秋の野を分けて吹く嵐の名。荒いが折れぬ。',slash:{col:'#f3ead8',glow:'rgba(240,220,190,0.9)'}},
  {id:'shigure',mei:'時雨',yomi:'しぐれ',tier:'並',wrap:[96,100,106],metal:'silver',blade:[150,172,196,0.28],lore:'降っては止む冬の雨。刃に薄く雲がかかる。',slash:{col:'#e2ecf6',glow:'rgba(190,210,235,0.9)'}},
  {id:'yamabuki',mei:'山吹',yomi:'やまぶき',tier:'並',wrap:[198,150,40],metal:'copper',blade:null,lore:'春の谷に咲く黄の花。柄巻だけがほのかに明るい。',slash:{col:'#fff4d6',glow:'rgba(255,220,140,0.9)'}},
  {id:'oborozuki',mei:'朧月',yomi:'おぼろづき',tier:'上',wrap:[226,220,204],metal:'silver',blade:[210,214,236,0.32],lore:'霞にかすむ春の月。抜けば刃までもが霞む。',slash:{col:'#eef0ff',glow:'rgba(180,196,255,1)',double:true}},
  {id:'kokihi',mei:'深緋',yomi:'こきひ',tier:'上',wrap:[142,28,30],metal:'gold',blade:null,lore:'位の高い者だけが纏うことを許された、深い緋の色。',slash:{col:'#ffe6de',glow:'rgba(255,110,90,1)',double:true}},
  {id:'seiran',mei:'青嵐',yomi:'せいらん',tier:'上',wrap:[30,98,98],metal:'silver',blade:[120,196,196,0.26],lore:'青葉を揺らして渡る初夏の風。斬れば青く抜ける。',slash:{col:'#e0fff9',glow:'rgba(80,220,200,1)',double:true}},
  {id:'kokushitsu',mei:'黒漆',yomi:'こくしつ',tier:'極',wrap:[24,22,22],metal:'black',blade:[58,58,64,0.5],lore:'鍔も柄も漆で塗りこめた夜の刀。光を吸い、金の筋だけを残す。',slash:{col:'#ffe08a',glow:'rgba(232,180,60,1)',double:true,thick:1.3}},
  {id:'guren',mei:'紅蓮',yomi:'ぐれん',tier:'極',wrap:[172,20,26],metal:'black',blade:[232,92,72,0.36],lore:'凍てつく果てで、裂けて紅く咲くという蓮。',slash:{col:'#ffd6c8',glow:'rgba(255,60,30,1)',double:true,thick:1.3}},
  {id:'kogarashi',mei:'木枯',yomi:'こがらし',tier:'並',wrap:[72,62,52],metal:'black',blade:null,lore:'冬の始まりを告げる冷たい風。飾り気のない野の刀。',slash:{col:'#efe9dc'}},
  {id:'usuzumi',mei:'薄墨',yomi:'うすずみ',tier:'並',wrap:[84,84,84],metal:'silver',blade:[120,120,120,0.3],lore:'墨を水で薄めた色。悲しみを伝える文に使われた。',slash:{col:'#e6e6e6',glow:'rgba(200,200,200,0.9)'}},
  {id:'wakatake',mei:'若竹',yomi:'わかたけ',tier:'並',wrap:[92,142,82],metal:'copper',blade:null,lore:'今年伸びた若い竹。しなやかに曲がり、折れない。',slash:{col:'#effbe6',glow:'rgba(170,230,150,0.9)'}},
  {id:'akane',mei:'茜',yomi:'あかね',tier:'並',wrap:[172,72,50],metal:'copper',blade:null,lore:'夕暮れの空を染める、茜草の根の色。',slash:{col:'#fff0e6',glow:'rgba(255,170,130,0.9)'}},
  {id:'tsuyukusa',mei:'露草',yomi:'つゆくさ',tier:'並',wrap:[62,92,172],metal:'silver',blade:[140,170,230,0.2],lore:'朝に咲き昼にしぼむ青い花。その色はすぐに褪せる。',slash:{col:'#eaf0ff',glow:'rgba(150,180,255,0.9)'}},
  {id:'haizakura',mei:'灰桜',yomi:'はいざくら',tier:'並',wrap:[204,172,172],metal:'silver',blade:null,lore:'灰をかぶったような、淡くくすんだ桜の色。',slash:{col:'#fff2f2',glow:'rgba(240,190,190,0.9)'}},
  {id:'kuchiba',mei:'朽葉',yomi:'くちば',tier:'並',wrap:[152,102,52],metal:'gold',blade:[180,150,110,0.2],lore:'落ちて朽ちた葉の色。侘びた趣を好む者が選ぶ。',slash:{col:'#f6ecd8',glow:'rgba(220,180,120,0.9)'}},
  {id:'kuriume',mei:'栗梅',yomi:'くりうめ',tier:'並',wrap:[112,52,42],metal:'gold',blade:null,lore:'栗の皮に紅を差した色。町の道場で好まれた。',slash:{col:'#fbe9e2',glow:'rgba(220,140,120,0.9)'}},
  {id:'ruri',mei:'瑠璃',yomi:'るり',tier:'上',wrap:[30,62,152],metal:'gold',blade:[80,120,220,0.3],lore:'七宝のひとつに数えられる、深く澄んだ青。',slash:{col:'#e0ebff',glow:'rgba(80,130,255,1)',double:true}},
  {id:'fujinami',mei:'藤波',yomi:'ふじなみ',tier:'上',wrap:[142,112,182],metal:'silver',blade:[190,160,232,0.3],lore:'風に揺れる藤の花房を、寄せる波に見立てた名。',slash:{col:'#f2e8ff',glow:'rgba(190,140,255,1)',double:true}},
  {id:'kohaku',mei:'琥珀',yomi:'こはく',tier:'上',wrap:[192,122,30],metal:'gold',blade:[232,172,80,0.3],lore:'樹の涙が千年をかけて石になったもの。',slash:{col:'#fff1d6',glow:'rgba(255,170,60,1)',double:true}},
  {id:'suiren',mei:'睡蓮',yomi:'すいれん',tier:'上',wrap:[222,172,192],metal:'silver',blade:[240,200,222,0.25],lore:'昼に開き、夕べに閉じる水の花。',slash:{col:'#fff0f6',glow:'rgba(255,160,210,1)',double:true}},
  {id:'tokiwa',mei:'常磐',yomi:'ときわ',tier:'上',wrap:[22,82,52],metal:'gold',blade:[90,172,122,0.25],lore:'冬にも色を変えない松の緑。変わらぬ心の刀。',slash:{col:'#e6fff0',glow:'rgba(80,210,130,1)',double:true}},
  {id:'shinonome',mei:'東雲',yomi:'しののめ',tier:'上',wrap:[232,152,112],metal:'silver',blade:[255,192,152,0.25],lore:'夜明け前、東の空がほのかに明るむころ。',slash:{col:'#fff2ea',glow:'rgba(255,160,120,1)',double:true}},
  {id:'narukami',mei:'鳴神',yomi:'なるかみ',tier:'極',wrap:[42,42,72],metal:'gold',blade:[202,212,255,0.42],lore:'雷の古い呼び名。抜けば竹林の空気が鳴る。',slash:{col:'#f4f6ff',glow:'rgba(150,170,255,1)',double:true,thick:1.3}},
  {id:'yasha',mei:'夜叉',yomi:'やしゃ',tier:'極',wrap:[62,12,42],metal:'black',blade:[182,42,122,0.4],lore:'鬼でありながら、仏を守るもの。',slash:{col:'#ffe0f0',glow:'rgba(220,40,140,1)',double:true,thick:1.3}},
  {id:'hakuro',mei:'白露',yomi:'はくろ',tier:'極',wrap:[242,242,242],metal:'silver',blade:[232,246,255,0.45],lore:'秋の朝、草に宿る白い露。触れれば消える。',slash:{col:'#ffffff',glow:'rgba(210,240,255,1)',double:true,thick:1.3}},
  {id:'shiden',mei:'紫電',yomi:'しでん',tier:'極',wrap:[72,32,112],metal:'silver',blade:[172,102,255,0.45],lore:'研ぎ澄まされた刃のきらめき。紫の稲妻。',slash:{col:'#f3e8ff',glow:'rgba(170,90,255,1)',double:true,thick:1.3}},
  {id:'mugen',mei:'夢幻',yomi:'むげん',tier:'幻',wrap:[22,22,32],metal:'gold',blade:'iris',lore:'夢か、幻か。持つ者の影さえ映さない。',slash:{rainbow:true,glow:'rgba(180,140,255,1)',double:true,thick:1.5}},
  {id:'nichirin',mei:'日輪',yomi:'にちりん',tier:'幻',wrap:[232,202,122],metal:'gold',blade:[255,232,152,0.5],lore:'昇る日の輪。抜けば竹林に朝が来るという。',slash:{col:'#fff6d0',glow:'rgba(255,190,40,1)',double:true,thick:1.6}},
  {id:'geppaku',mei:'月白',yomi:'げっぱく',tier:'幻',wrap:[236,236,242],metal:'silver',blade:'iris',lore:'月が昇る前、東の空がわずかに白む色。鍛えた者を誰も知らない。',slash:{rainbow:true,glow:'rgba(233,184,255,1)',double:true,thick:1.5}}
];
const KMAP={}; KATANA.forEach(k=>KMAP[k.id]=k);
const METAL={gold:null,silver:[198,204,214],copper:[206,122,82],black:[44,40,38]};
const TIERRATE=[['並',60],['上',28],['極',10],['幻',2]];
// 持っている刀が出たら玉鋼に変わる。玉鋼で好きな刀を鍛えられる（値段 ≒ その階級が出るまでの平均の銭 × 3）
const STEEL={'並':5,'上':10,'極':25,'幻':100};
const FORGE={'並':50,'上':110,'極':300,'幻':1500};
let PULLCOST=10;
function hsl2rgb(h,s,l){ h=((h%360)+360)%360/360; const f=n=>{ const k=(n+h*12)%12, a=s*Math.min(l,1-l); return 255*(l-a*Math.max(-1,Math.min(k-3,9-k,1))); }; return [f(0),f(8),f(4)]; }
function tintCanvas(src,col){ const t=document.createElement('canvas'); t.width=src.width; t.height=src.height; const x=t.getContext('2d'); x.drawImage(src,0,0); x.globalCompositeOperation='source-in'; x.fillStyle=col; x.fillRect(0,0,t.width,t.height); return t; }
let KREADY=false;
function buildKatanas(){
  const base=document.createElement('canvas'); base.width=KIMG_W; base.height=KIMG_H; const bx=base.getContext('2d'); bx.drawImage(KIMG,0,0,KIMG_W,KIMG_H);
  let src; try{ src=bx.getImageData(0,0,KIMG_W,KIMG_H); }catch(e){ src=null; }
  KATANA.forEach(def=>{
    const cvk=document.createElement('canvas'); cvk.width=KIMG_W; cvk.height=KIMG_H; const x=cvk.getContext('2d');
    if(def.img&&def.img.complete&&def.img.naturalWidth){ x.drawImage(def.img,0,0,KIMG_W,KIMG_H); }
    else if(!src){ x.drawImage(KIMG,0,0,KIMG_W,KIMG_H); }
    else {
      const d=new ImageData(new Uint8ClampedArray(src.data),KIMG_W,KIMG_H), a=d.data;
      for(let i=0;i<a.length;i+=4){ if(a[i+3]<8) continue; const px=(i>>2)%KIMG_W; let r=a[i],g=a[i+1],b=a[i+2]; const L=(r+g+b)/3;
        const blue=b>r+12&&b>g+12, warm=r>b+40&&g>b+15;
        if(px<250&&blue){ if(def.wrap){ const k=Math.min(1.45,b/70); r=def.wrap[0]*k; g=def.wrap[1]*k; b=def.wrap[2]*k; } }
        else if(warm&&px<285){ const m=METAL[def.metal]; if(m){ const k=L/150; r=m[0]*k; g=m[1]*k; b=m[2]*k; } }
        else if(px>=255&&def.blade){ let t=def.blade; if(t==='iris'){ t=hsl2rgb(180+(px/KIMG_W)*320,0.7,0.72).concat(0.4); }
          const am=t[3], l=L/255; r=r*(1-am)+t[0]*l*am*1.3; g=g*(1-am)+t[1]*l*am*1.3; b=b*(1-am)+t[2]*l*am*1.3; }
        a[i]=r; a[i+1]=g; a[i+2]=b; }
      x.putImageData(d,0,0);
    }
    def.canvas=cvk; def.pale=tintCanvas(cvk,PALE); def.shadow=tintCanvas(cvk,'#30342e');
  });
  KREADY=true;
}
/* 自分の刀。ログインしていなければこの端末に、ログイン中はアカウントに保存する（js/save-sync.js）
   刀は id（英字の名前）で覚えるので、刀を足したり並べ替えたりしても記録は崩れない */
let ACCT=null;   // ログイン中だけ入る、アカウントへ保存する出入り口 {win,best,pull,equip}
let ARM;
function loadGuestArm(){ ARM={owned:{mumei:1},equip:['mumei','mumei'],rec:{}};
  try{ const a=JSON.parse(localStorage.getItem('issen-armory-v1')||'null'); if(a) ARM=Object.assign(ARM,a); }catch(e){} }
loadGuestArm();
function saveArm(){ if(ACCT) return; try{ localStorage.setItem('issen-armory-v1',JSON.stringify(ARM)); }catch(e){} }
let CPUKAT='mumei';
function katOf(i){ if(G.mode==='online') return KMAP[i===NET.me?(NET.watch?NET.myKat:(ARM.equip[0]||'mumei')):NET.oppKat]||KMAP.mumei;
  return KMAP[(G.mode==='cpu'&&i===1)?CPUKAT:(ARM.equip[i]||'mumei')]||KMAP.mumei; }
function pickCpuKat(){ const x=clamp((RUN.n-1)/9); const w=[['並',lerp(1,0.25,x)],['上',lerp(0.12,0.45,x)],['極',lerp(0,0.22,x)],['幻',lerp(0,0.06,x)]];
  let r=Math.random()*w.reduce((s,v)=>s+v[1],0), t='並'; for(const [k,v] of w){ if((r-=v)<=0){ t=k; break; } }
  const pool=KATANA.filter(k=>k.tier===t); CPUKAT=pool[Math.floor(Math.random()*pool.length)].id; }
function recordWin(i,name,coin){ if(G.mode==='cpu'&&i!==0) return; if(G.mode==='online'&&(NET.watch||i!==NET.me)) return; const id=katOf(i).id; ARM.rec[id]=ARM.rec[id]||{}; ARM.rec[id][name]=(ARM.rec[id][name]||0)+1; saveArm(); if(ACCT) ACCT.win(name,id,coin||0); }
function rollKatana(){ let r=Math.random()*100, t='並'; for(const [k,v] of TIERRATE){ if((r-=v)<=0){ t=k; break; } }
  const pool=KATANA.filter(k=>k.tier===t); return pool[Math.floor(Math.random()*pool.length)]; }

/* ---------- 状態 ---------- */
function mkPlayer(i){ return {i,side:i,state:'idle',start:0,end:0,counters:0,lastCancelAt:-1e9,mkStart:-1e9,counteredAt:null,resumeAt:0,score:0,J:clonePose('idle')}; }
const P=[mkPlayer(0),mkPlayer(1)];
const G={mode:'title',phase:'title',round:1,cueAt:0,roundEnd:0,frozenLeft:0,fx:null,result:null,resultAt:0,history:[],debug:null,
  shakeUntil:0,shakeDur:1,shakeAmp:0,flashAt:-1e9,flashA:0,parts:[],startAt:-1e9};
const RUN={n:1,coins:0,newBest:false};
const inputQ=[];
/* オンライン対戦の出入り口（js/online-match.js が使う）。ローカルの対戦では使わない */
/* 観戦（watch）のときは、二人とも届いた操作で動かす。me=0（朱）の目線で見せ、myH は朱の「ここまで送った」知らせ */
const NET={me:0,seq:0,oppH:-Infinity,remoteQ:[],fightFrom:0,rng:Math.random,send:null,oppKat:'mumei',oppName:'相手',myName:'あなた',wait:'',onPhase:null,onLeave:null,rate:null,
  watch:false,myH:-Infinity,myKat:'mumei',toWin:0,tag:'',back:'',hSent:-Infinity,st:{n:0,inWait:0,inMax:0,stall:0,opp:0,oppMax:0,rtt:0,fps:60,maxAt:0}};
const ONLINE=()=>G.mode==='online';
function opp(){ return P[1-NET.me]; }
/* 相手から届いた操作（t: 合わせた時計での押した時刻、s: 何度目の決着の後か） */
function netInput(t,a,s,p){ NET.remoteQ.push({t,a,s,p}); }
function netHorizon(h,p){ if(NET.watch&&p===0){ if(h>NET.myH) NET.myH=h; return; } if(h>NET.oppH) NET.oppH=h; }
const netH=()=>NET.watch?Math.min(NET.oppH,NET.myH):NET.oppH;
function qIns(q){ let i=inputQ.length; while(i>0&&(inputQ[i-1].t>q.t||(inputQ[i-1].t===q.t&&inputQ[i-1].p>q.p))) i--; inputQ.splice(i,0,q); }
const TOWIN=()=>G.mode==='cpu'?1:(G.mode==='online'&&NET.toWin)?NET.toWin:CFG.toWin;

/* コインと記録（ログインしていなければこの端末に、ログイン中はアカウントに保存） */
const COIN={'並':3,'上':9,'極':24,'幻':60,'絶':150,'分':0};
const WALLET={coins:0,best:0,steel:0};
function loadGuestWallet(){ WALLET.coins=0; WALLET.best=0; WALLET.steel=0;
  try{ const w=JSON.parse(localStorage.getItem('issen-wallet-v1')||'null'); if(w) Object.assign(WALLET,w); }catch(e){} }
loadGuestWallet();
function saveWallet(){ if(ACCT) return; try{ localStorage.setItem('issen-wallet-v1',JSON.stringify(WALLET)); }catch(e){} }
/* アカウント保存との出入り口（js/save-sync.js が使う） */
function guestData(){ // この端末に保存されている記録（ログイン中でも端末の分を読む）
  let a=null,w=null; try{ a=JSON.parse(localStorage.getItem('issen-armory-v1')||'null'); w=JSON.parse(localStorage.getItem('issen-wallet-v1')||'null'); }catch(e){}
  a=a||{}; w=w||{}; return {coins:w.coins||0,best:w.best||0,steel:w.steel||0,owned:a.owned||{},rec:a.rec||{},equip:a.equip||['mumei','mumei']}; }
function applySave(d,pend){ // アカウントの持ち物を画面に映す。pend: まだサーバーに届いていない銭
  ARM.owned=Object.assign({mumei:1},d.owned||{}); ARM.rec=d.rec||{}; ARM.equip=Array.isArray(d.equip)&&d.equip.length===2?d.equip.slice():['mumei','mumei'];
  WALLET.coins=(d.coins||0)+(pend||0); WALLET.best=d.best||0; WALLET.steel=d.steel||0; if(d.cost>0) PULLCOST=d.cost;
  uiCache=''; if(!gachaEl.hidden){ refreshCoins(); if(!document.getElementById('g_book').hidden) renderBook(); } }
function useAccount(api){ ACCT=api; }
function useGuest(){ ACCT=null; loadGuestArm(); loadGuestWallet(); PULLCOST=10; uiCache=''; if(!gachaEl.hidden){ refreshCoins(); if(!document.getElementById('g_book').hidden) renderBook(); } }
window.__issen={kn,G,P,CFG,RUN,WALLET,NET,netInput,netHorizon,startOnline,goTitle,netClock:off=>{ if(NETCLK) NETCLK.off=off; },now:()=>gnow(),guestData,applySave,useAccount,useGuest,isAccount:()=>!!ACCT};

function resetPlayer(p){ p.side=p.i; p.state='idle'; p.start=0; p.end=0; p.counters=0; p.lastCancelAt=-1e9; p.mkStart=-1e9; p.counteredAt=null; p.resumeAt=0; }
function startMatch(mode,base){
  G.mode=mode; layoutViews();
  P.forEach(p=>{p.score=0;}); G.round=1; G.history=[];
  RUN.n=1; RUN.coins=0; RUN.newBest=false;
  startRound(base);
}
/* オンライン対戦を始める。o={me,seed,startAt,clockOff,oppKat,oppName,myName,send} */
function startOnline(o){
  NETCLK={off:o.clockOff}; NET.me=o.me; NET.seq=0; NET.oppH=-Infinity; NET.remoteQ.length=0; NET.fightFrom=Infinity;
  NET.rng=mulberry32(o.seed|0); NET.send=o.send||null; NET.oppKat=o.oppKat||'mumei'; NET.oppName=o.oppName||'相手'; NET.myName=o.myName||'あなた'; NET.wait=''; NET.rate=null;
  NET.watch=!!o.watch; NET.myH=-Infinity; NET.myKat=o.myKat||'mumei'; NET.toWin=o.toWin|0; NET.tag=o.tag||''; NET.back=o.back||''; NET.hSent=-Infinity; NET.st={n:0,inWait:0,inMax:0,stall:0,opp:0,oppMax:0,rtt:0,fps:60,maxAt:0};
  for(const k of TIMING_KEYS) CFG[k]=DEF[k];   // 二人の判定を必ずそろえるため、オンラインでは確定値だけを使う
  pauseWhy.clear(); pausedAt=null;
  startMatch('online',o.startAt);
}
function goTitle(){ if(G.mode==='online'){ const f=NET.onLeave; NETCLK=null; NET.send=null; NET.watch=false; NET.toWin=0; NET.tag=''; NET.back=''; if(f) try{ f(G.phase); }catch(e){} }
  G.mode='title'; G.phase='title'; G.fx=null; G.result=null; P.forEach(resetPlayer); layoutViews(); }
function startRound(base){ P.forEach(resetPlayer); P.forEach(p=>{p.lastEnd=-Infinity;}); G.mutualAt=0; G.fx=null; G.result=null; G.parts=[]; inputQ.length=0; G.debug=null;
  if(G.mode==='cpu'){ P.forEach(p=>{p.score=0;}); pickCpuKat(); }
  aiReset(gnow()+2600);
  const rnd=G.mode==='online'?NET.rng:Math.random;
  G.phase='ready'; G.cueAt=(base!=null?base:gnow())+1400+rnd()*1200; }
function setState(p,s,t,d){ p.state=s; p.start=t; p.end=(d!=null)?t+Math.max(1,d):0; }

function input(pi,a){ ensureAudio(); if(G.phase!=='fight') return; const t=gnow();
  if(G.mode==='online'){ if(NET.watch||pi!==NET.me) return; if(NET.send) NET.send({k:'in',t,a,s:NET.seq}); }
  qIns({t,p:pi,a}); stepTo(t); }
function stepTo(now){
  if(G.mode==='online') return stepOnline(now);
  let guard=0;
  while(G.phase==='fight'&&guard++<64){
    const lim=Math.min(now,G.roundEnd); let best=null,bt=Infinity;
    for(const p of P){ if(p.end>0&&p.end<=lim&&p.end<bt){ best=p; bt=p.end; } }
    const useIn=inputQ.length&&inputQ[0].t<=lim&&inputQ[0].t<bt;
    if(!best&&!useIn) break;
    if(useIn){ const q=inputQ.shift(); onInput(P[q.p],q.a,q.t); } else onEnd(best,bt);
  }
  if(G.phase==='fight'&&now>=G.roundEnd) timeUp(now);
}
/* オンライン対戦の進行。二人の端末が同じ順で同じ判定をするための決まり:
   - 斬る瞬間（溜めの終わり）は、相手の「その時刻までの操作は全部送った」という知らせ（oppH）が届くまで待つ
   - それより後の出来事は、斬る瞬間が決まるまで進めない
   - 相手が知らせてくれた時刻＋溜めの長さより先へは進めない（まだ届いていない居合があり得るため） */
/* 斬る瞬間が来たら、すぐ相手に「ここまでの操作は全部送った」と知らせる。
   0.5秒ごとの知らせだけを待つと、斬撃が出るまでに最大0.5秒＋通信の遅れだけ止まって見えるため */
function netPulse(now){
  if(NET.watch||!NET.send) return;
  let need=Infinity;
  for(const p of P) if(p.state==='charge'&&p.end>0&&p.end<need) need=p.end;
  for(const q of inputQ) if(q.a==='iai'&&q.t+CFG.charge<need) need=q.t+CFG.charge;
  for(const r of NET.remoteQ) if(r.a==='iai'&&r.s===NET.seq&&r.t+CFG.charge<need) need=r.t+CFG.charge;
  if(need<=now&&NET.hSent<need){ NET.hSent=now; NET.send({k:'h',h:now}); }
}
function stepOnline(now){
  const o=opp();
  for(let i=0;i<NET.remoteQ.length;){
    const r=NET.remoteQ[i];
    if(r.s<NET.seq){ NET.remoteQ.splice(i,1); continue; }
    if(r.s>NET.seq||G.phase!=='fight'){ i++; continue; }
    NET.remoteQ.splice(i,1);
    const rp=NET.watch&&r.p!=null?P[r.p]:o;
    if(r.t<NET.fightFrom||r.t<rp.lastEnd) continue;
    qIns({t:r.t,p:rp.i,a:r.a});
  }
  netPulse(now);
  let guard=0; const H=netH();
  while(G.phase==='fight'&&guard++<64){
    const lim=Math.min(now,G.roundEnd,H+CFG.charge-1);
    let block=Infinity;
    for(const p of P){ if(p.state==='charge'&&p.end>0&&p.end>Math.min(now,H)) block=Math.min(block,p.end); }
    let best=null,bt=Infinity;
    for(const p of P){ if(p.end>0&&p.end<bt&&p.end<=lim&&(p.state==='charge'?p.end<=H:p.end<block)){ best=p; bt=p.end; } }
    const useIn=inputQ.length&&inputQ[0].t<=lim&&inputQ[0].t<block&&inputQ[0].t<bt;
    if(!best&&!useIn) break;
    if(useIn){ const q=inputQ.shift(); onInput(P[q.p],q.a,q.t); } else onEnd(best,bt);
  }
  if(G.phase==='fight'&&now>=G.roundEnd&&netH()>=G.roundEnd&&!P.some(p=>p.end>0&&p.end<=G.roundEnd)) timeUp(G.roundEnd);
}
function onInput(p,a,t){
  if(G.mode==='online'&&!NET.watch&&p.i===NET.me){ const w=gnow()-t; NET.st.inWait=w; NET.st.inMax=Math.max(NET.st.inMax,w); NET.st.n++; }
  if(a==='iai'){
    if(p.state==='idle'){ setState(p,'charge',t,CFG.charge); sfx('koi'); }
    else if(p.state==='charge'){ setState(p,'cancelRec',t,CFG.cancelRec); p.lastCancelAt=t; sfx('cancel'); }
  } else if(a==='mk'){
    if(p.state==='idle'){ setState(p,'mikiri',t,CFG.window); p.mkStart=t; sfx('mk'); }
  }
}
function onEnd(p,t){
  p.lastEnd=t; G.evT=t;
  if(p.state==='charge'){ p.state='struck'; p.end=0; strike(p,t); }
  else if(p.state==='mikiri') setState(p,'mkRec',t,CFG.mkRec);
  else setState(p,'idle',t,null);
}
function poseName(p){ return p.state==='charge'?'charge':p.state==='mikiri'?'mikiri':p.state==='mkRec'?'slump':'idle'; }
function strike(A,t){
  const D=P[1-A.i];
  if(D.state==='mikiri'){
    const dt=t-D.start;
    G.debug={text:`見切り→斬撃 ${Math.round(dt)}ms（ジャストは ${CFG.just}ms 以内）`,at:gnow()};
    const mutual=D.counters>=1&&A.counters>=1;
    if(dt<=CFG.just) return finish(D,A,mutual?'一閃':'明鏡止水',mutual?'issen':'just');
    D.counters++;
    const ryu=(D.start-D.lastCancelAt)<=CFG.ryuten;
    if(D.counters>=2) return finish(D,A,mutual?'鏡返し':ryu?'流転':'二の太刀','counterWin');
    return beginFx('counter1',D,A,{});
  }
  if(D.state==='charge'&&D.end===t) return beginFx('aiuchi',A,D,{});
  let name;
  if(A.counters>=1&&D.counters>=1) name='紙一重';
  else if(D.counters>=1) name='死中活';
  else if(A.counters>=1) name='止め';
  else if(D.state==='mkRec'&&A.lastCancelAt>=D.mkStart-500&&A.lastCancelAt<=D.mkStart+CFG.window) name='陽炎';
  else if(D.state==='mkRec') name='隙穿ち';
  else if(D.state==='charge') name='先の先';
  else name='疾風';
  if(D.state==='mkRec'||D.state==='charge') G.debug={text:`${D.state==='charge'?'相手の溜め残り':'相手の硬直残り'} ${Math.round(D.end-t)}ms`,at:gnow()};
  finish(A,D,name,'iai');
}
const FXDUR={iai:1900,counter1:1350,counterWin:2100,just:2300,aiuchi:1100,issen:5600};
const NET_FX_DELAY=250;
function beginFx(kind,W,L,extra){
  const now=G.mode==='online'?G.evT+NET_FX_DELAY:gnow(); inputQ.length=0; AI.plans.length=0; NET.seq++; NET.fightFrom=Infinity;
  if(G.mode==='online'){ NET.st.stall=Math.max(0,gnow()-G.evT); NET.st.stallMax=Math.max(NET.st.stallMax||0,NET.st.stall); }
  G.frozenLeft=Math.max(0,G.roundEnd-now);
  G.fx=Object.assign({kind,W,L,t0:now,v0:Math.max(now,gnow()),dur:FXDUR[kind],done:{},sW:W.side,sL:L.side,poseL:poseName(L),poseW:poseName(W)},extra);
  if(G.fx.mutual&&kind!=='issen') G.fx.dur+=700;
  G.roundEnd+=G.fx.dur;
  P.forEach(p=>{p.end=0;});
  G.phase='fx';
}
function finish(W,L,name,kind){
  W.score++;
  const tier=FIN[name].tier;
  let coin=COIN[tier]||0;
  if(G.mode==='cpu'&&W.i!==0) coin=0;
  if(G.mode==='online'&&(NET.watch||W.i!==NET.me)) coin=0;
  if(coin){ WALLET.coins+=coin; RUN.coins+=coin; saveWallet(); }
  G.result={name,winner:W.i,coin};
  recordWin(W.i,name,coin);
  G.history.push({name,winner:W.i});
  beginFx(kind,W,L,{name,mutual:W.counters>=1&&L.counters>=1});
}
function timeUp(now){ inputQ.length=0; NET.seq++; NET.fightFrom=Infinity; G.frozenLeft=0; P.forEach(p=>setState(p,'idle',now,null)); G.result={name:'睨み合い',winner:null,coin:0}; G.history.push({name:'睨み合い',winner:null}); G.phase='result'; G.resultAt=now; }
function nextFromResult(){
  if(G.mode==='online'){
    const base=G.resultAt+4800;
    if(P.some(p=>p.score>=TOWIN())){ G.phase='match'; G.resultAt=base; sfx('gong'); if(NET.onPhase) NET.onPhase('match'); }
    else { G.round++; startRound(base); }
    return;
  }
  if(G.mode==='cpu'){
    const r=G.result;
    if(r.winner===0){ RUN.n++; G.round=1; startRound(); }
    else if(r.winner===1){ const wins=RUN.n-1; if(wins>WALLET.best){ WALLET.best=wins; RUN.newBest=true; saveWallet(); if(ACCT) ACCT.best(wins); } G.phase='match'; G.resultAt=gnow(); sfx('gong'); }
    else { G.round++; startRound(); }
    return;
  }
  if(P.some(p=>p.score>=TOWIN())){ G.phase='match'; G.resultAt=gnow(); sfx('gong'); }
  else { G.round++; startRound(); }
}
/* 演出の見た目の経過時間。通信の遅れで決着が分かるのが遅れたときは、頭から少し速めに再生して、
   終わる時刻（二人で同じ）に間に合わせる。頭の一閃が飛ばされて見えないように */
function fxE(fx,now){
  if(!(fx.v0>fx.t0)) return now-fx.t0;
  const span=Math.max(fx.t0+fx.dur-fx.v0,fx.dur*0.6);
  return Math.max(0,now-fx.v0)*fx.dur/span;
}
function fxTick(now){
  const fx=G.fx, e=fxE(fx,now);
  const cues=CUES[fx.kind];
  for(const [ms,name] of cues){ if(e>=ms&&!fx.done[name+ms]){ fx.done[name+ms]=1; doCue(name,fx,now); } }
  if(fx.mutual&&fx.kind!=='issen'){ const ht={iai:320,counterWin:300,just:480}[fx.kind]; if(ht&&e>=ht&&!fx.done.burst){ fx.done.burst=1; sfx('drum'); shake(now,12,400); } }
  if(now-fx.t0>=fx.dur){
    if(G.mode==='online') now=fx.t0+fx.dur;
    if(fx.kind==='counter1'){ const D=fx.W,A=fx.L; const s=A.side; A.side=D.side; D.side=s;
      A.counteredAt=now; A.resumeAt=now; P.forEach(p=>setState(p,'idle',now,null)); G.fx=null; G.phase='fight'; NET.fightFrom=now; aiReset(now+400);
      if(P[0].counters>=1&&P[1].counters>=1&&!G.mutualAt){ G.mutualAt=now; sfx('drum'); } }
    else if(fx.kind==='aiuchi'){ P.forEach(p=>setState(p,'idle',now,null)); G.fx=null; G.phase='fight'; NET.fightFrom=now; aiReset(now+400); }
    else { G.phase='result'; G.resultAt=now; const f=FIN[G.result.name]; if(f&&(f.tier==='極'||f.tier==='幻'||f.tier==='絶')) sfx('gong'); }
  }
}
const CUES={
  iai:[[120,'slash'],[1100,'cutL']],
  counter1:[[100,'clash']],
  counterWin:[[100,'clash'],[1000,'cutL']],
  just:[[120,'slash'],[285,'clashFlash'],[300,'slash'],[1200,'cutL']],
  aiuchi:[[300,'clashFlash']],
  issen:[[150,'drum'],[900,'slash'],[1050,'clashBig'],[1100,'slash'],[2300,'gong'],[2600,'cutL'],[3100,'gong']]
};
function shake(now,amp,dur){ G.shakeUntil=now+dur; G.shakeDur=dur; G.shakeAmp=amp*(VH/600); }
function doCue(name,fx,now){
  switch(name){
    case 'slash': sfx('slash'); shake(now,7,220); break;
    case 'clash': sfx('clash'); shake(now,5,180); G.flashAt=now; G.flashA=0.3; break;
    case 'clashFlash': sfx('clash'); shake(now,9,260); G.flashAt=now; G.flashA=fx.name==='一閃'?1:0.8; break;
    case 'drum': sfx('drum'); break;
    case 'clashBig': sfx('clash'); sfx('chime'); shake(now,16,500); break;
    case 'cutL': { sfx('thud'); shake(now,4,160); const v=views(now)[fx.L.i]; spawnInk(v.x,GY-0.58*FH,22,-v.face); break; }
  }
}
function spawnInk(x,y,n,dir){ const s=VH/700;
  for(let i=0;i<n;i++) G.parts.push({x,y,vx:(dir*(Math.random()*240+40)+(Math.random()-0.5)*140)*s,vy:-(Math.random()*280+60)*s,r:(Math.random()*FH*0.018+1.5),landed:false}); }

/* ---------- CPU（藍）。人数が進むほど強く、10人目で上限 ---------- */
const AI={plans:[],nextAct:0,seenC:null,seenM:null};
const aiLv=()=>clamp((RUN.n-1)/9);
function aiReset(t){ AI.plans.length=0; AI.seenC=null; AI.seenM=null; AI.nextAct=t+aiGap(); }
function aiGap(){ const x=aiLv(); return lerp(1400,600,x)+Math.random()*lerp(2600,1500,x); }
function aiReact(){ const x=aiLv(); return lerp(480,170,x)+Math.random()*lerp(220,60,x); }
function aiPlan(t,kind,ref){ AI.plans.push({t,kind,ref}); }
function aiTick(now){
  if(G.mode!=='cpu'||G.phase!=='fight') return;
  const me=P[1], op=P[0], x=aiLv();
  if(op.state==='charge'&&AI.seenC!==op.start){ AI.seenC=op.start; aiPlan(op.start+aiReact(),'respC',op.start); }
  if(op.state==='mikiri'&&AI.seenM!==op.start){ AI.seenM=op.start; aiPlan(op.start+aiReact(),'respM',op.start); }
  AI.plans.sort((a,b)=>a.t-b.t);
  while(AI.plans.length&&AI.plans[0].t<=now&&G.phase==='fight'){
    const pl=AI.plans.shift();
    switch(pl.kind){
      case 'respC': {
        if(!(op.state==='charge'&&op.start===pl.ref)) break;
        const late=me.state==='charge'&&me.start>op.start;
        if(late&&Math.random()<lerp(0,0.6,x)){ input(1,'iai'); }
        if(me.state==='idle'||late){
          if(Math.random()<lerp(0.3,0.88,x)){
            const off=Math.random()<lerp(0,0.12,x)?CFG.just*0.5:clamp(lerp(0.85,0.55,x),0.2,1)*CFG.window;
            const jit=(Math.random()-0.5)*lerp(160,40,x), tgt=op.end-off+jit;
            if(tgt<now&&op.end-now<CFG.just*1.3) break;
            aiPlan(Math.max(now,tgt),'mk',pl.ref);
          } else if(me.state==='idle'&&Math.random()<lerp(0.35,0.05,x)) input(1,'iai');
        }
        break; }
      case 'mk':
        if(op.state==='charge'&&op.start===pl.ref){ if(me.state==='idle') input(1,'mk'); else if(me.state==='cancelRec') aiPlan(now+16,'mk',pl.ref); }
        break;
      case 'respM': {
        if(!(op.state==='mikiri'&&op.start===pl.ref)) break;
        const margin=30+Math.random()*lerp(300,80,x);
        if(me.state==='charge'&&me.end<=op.end+5){
          if(Math.random()<lerp(0.1,0.75,x)){ input(1,'iai'); aiPlan(Math.max(now+CFG.cancelRec+5,op.end-CFG.charge+margin),'iai',null); }
        } else if(me.state==='idle'&&Math.random()<lerp(0.35,0.95,x)) aiPlan(Math.max(now,op.end-CFG.charge+margin),'iai',null);
        break; }
      case 'iai': if(me.state==='idle') input(1,'iai'); break;
      case 'cancel': if(me.state==='charge'&&me.start===pl.ref) input(1,'iai'); break;
    }
  }
  if(me.state==='idle'&&op.state==='idle'&&!AI.plans.length&&now>=AI.nextAct){
    const r=Math.random(), pf=lerp(0.05,0.35,x), pg=lerp(0.15,0.05,x);
    if(r<pf){ input(1,'iai'); aiPlan(now+lerp(260,150,x)+Math.random()*120,'cancel',P[1].start); }
    else if(r<pf+pg) input(1,'mk');
    else input(1,'iai');
    AI.nextAct=now+aiGap();
  }
}

/* ---------- 表示用の位置と構え ---------- */
function baseView(p,now){
  const x=sideX(p.side), face=p.side===0?1:-1;
  const v={x,face,pose:poseName(p),aura:0,glint:0,dots:false,extras:true};
  if(p.state==='charge') v.glint=clamp((now-p.start)/CFG.charge);
  else if(p.state==='mikiri') v.aura=1;
  else if(p.state==='mkRec') v.dots=true;
  return v;
}
function views(now){
  const fx=G.fx;
  if(!fx) return [baseView(P[0],now),baseView(P[1],now)];
  const v=[null,null];
  const e=Math.min(fxE(fx,now),fx.dur), W=fx.W, L=fx.L, xW0=sideX(fx.sW), xL0=sideX(fx.sL);
  const dirWL=Math.sign(xL0-xW0), dirLW=-dirWL;
  if(fx.kind==='iai'){
    const u=ease(clamp((e-120)/200)); const endX=dirWL>0?VW*0.93:VW*0.07;
    v[W.i]={x:lerp(xW0,endX,u),face:dirWL,pose:e<120?'charge':'follow',glint:e<120?1:0};
    v[L.i]={x:xL0,face:-dirWL,pose:fx.poseL,cut:e>=1100?{k:'h',t:(e-1100)/700}:null};
  } else if(fx.kind==='counter1'||fx.kind==='counterWin'){
    const u=ease(clamp((e-100)/200)); const turned=fx.kind==='counter1'&&e>850;
    v[L.i]={x:lerp(xL0,xW0,u),face:turned?-dirLW:dirLW,pose:e<100?'charge':(e<450?'follow':(fx.kind==='counter1'?(turned?'idle':'stagger'):'follow')),
      glint:e<100?1:0,cut:fx.kind==='counterWin'&&e>=1000?{k:'d',t:(e-1000)/800}:null};
    v[W.i]={x:lerp(xW0,xL0,u),face:turned?dirLW:-dirLW,pose:e<100?'mikiri':(turned?'idle':'counter'),aura:e<100?1:0};
  } else if(fx.kind==='just'){
    const uA=ease(clamp((e-120)/160));
    v[L.i]={x:lerp(xL0,VW/2,uA),face:dirLW,pose:e<120?'charge':'follow',glint:e<120?1:0,cut:e>=1200?{k:'h',t:(e-1200)/800}:null};
    const uD=ease(clamp((e-300)/180)); const endD=dirLW>0?VW*0.07:VW*0.93;
    v[W.i]={x:lerp(xW0,endD,uD),face:-dirLW,pose:e<300?'mikiri':'follow',aura:e<300?1:0};
  } else if(fx.kind==='issen'){
    v[L.i]={x:lerp(xL0,VW/2,ease(clamp((e-900)/150))),face:dirLW,pose:e<900?'charge':'follow',glint:e<900?clamp(e/900):0,cut:e>=2600?{k:'h',t:(e-2600)/1500}:null};
    const endD=dirLW>0?VW*0.07:VW*0.93;
    v[W.i]={x:lerp(xW0,endD,ease(clamp((e-1100)/280))),face:-dirLW,pose:e<1100?'mikiri':'follow',aura:e<1100?1:0};
  } else if(fx.kind==='aiuchi'){
    const u=e<150?0:e<300?ease((e-150)/150):e<700?1:1-ease((e-700)/300);
    for(const p of [W,L]){ const x0=sideX(p.side), d=Math.sign(VW/2-x0); v[p.i]={x:lerp(x0,VW/2-d*VW*0.08,u),face:d,pose:u>0.01?(e<700?'follow':'idle'):'charge'}; }
  }
  return v;
}
function darkAlpha(now){
  const fx=G.fx; if(!fx) return 0; const e=Math.min(fxE(fx,now),fx.dur);
  switch(fx.kind){
    case 'iai': return e<120?0.88*e/120:e<1500?0.88:0.88-0.33*clamp((e-1500)/400);
    case 'counterWin': return e<100?0.85*e/100:e<1600?0.85:0.85-0.3*clamp((e-1600)/400);
    case 'just': return e<120?0.9*e/120:e<1800?0.9:0.9-0.35*clamp((e-1800)/450);
    case 'counter1': return e<100?0.8*e/100:e<650?0.8:0.8*(1-clamp((e-650)/450));
    case 'aiuchi': return e<100?0.7*e/100:e<550?0.7:0.7*(1-clamp((e-550)/450));
    case 'issen': return e<200?e/200:e<4700?1:1-0.45*clamp((e-4700)/600);
  }
  return 0;
}

/* ---------- 描画 ---------- */
function drawBody(c,x,gy,h,face,J,o){
  const M=p=>[x+p[0]*h*face,gy+p[1]*h];
  const ink=o.mono||INK, lw=Math.max(2,h*0.032);
  c.lineCap='round'; c.lineJoin='round';
  const poly=(pts,col,w)=>{ c.strokeStyle=col; c.lineWidth=w; c.beginPath(); pts.forEach((p,i)=>{const q=M(p); if(i) c.lineTo(q[0],q[1]); else c.moveTo(q[0],q[1]);}); c.stroke(); };
  const hd=J.head, tt=o.time||0, wav=Math.sin(tt*6+o.seed)*0.015;
  const tb=[hd[0]-0.065,hd[1]-0.012];
  poly([tb,[tb[0]-0.09,tb[1]+0.03+wav],[tb[0]-0.17,tb[1]+0.02-wav]],o.mono||o.col,lw*0.7);
  poly([tb,[tb[0]-0.08,tb[1]+0.06-wav],[tb[0]-0.14,tb[1]+0.085+wav]],o.mono||o.col,lw*0.6);
  poly([J.neck,J.eB,J.hB],ink,lw);
  poly([J.hip,J.kB,J.fB],ink,lw);
  poly([J.hip,J.kF,J.fF],ink,lw);
  poly([J.neck,J.hip],ink,lw*1.1);
  poly([[J.hip[0]-0.05,J.hip[1]-0.02],[J.hip[0]+0.05,J.hip[1]-0.045]],o.mono||o.col,lw*1.35);
  const s2=[J.hip[0]+0.11,J.hip[1]-0.04]; let dx=0.36, dy=-0.12; const dl=Math.hypot(dx,dy); dx/=dl; dy/=dl;
  const s1=[s2[0]-dx*0.56,s2[1]-dy*0.56];
  poly([s1,s2],o.mono||'#1d1512',lw*1.1);
  const KD=o.kat&&o.kat.canvas?o.kat:null; const kimg=KD?(o.mono?KD.pale:KD.canvas):(o.mono?KIMG_PALE:(KIMG.complete&&KIMG.naturalWidth?KIMG:null));
  const KL=0.78*h, KT=KL*KIMG_H/KIMG_W*0.9, kk=KL/KIMG_W;
  if(!J.blade){
    const g=(o.glint||0)*0.05; const m=[s2[0]+dx*g,s2[1]+dy*g];
    if(g>0) poly([s2,m],o.mono||'#ffffff',lw*0.8);
    if(kimg){ const q=M(m); c.save(); c.translate(q[0],q[1]); c.rotate(Math.atan2(-dy,-dx*face)); c.scale(1,face);
      c.drawImage(kimg,0,0,KIMG_TSUBA+14,KIMG_H,-KIMG_TSUBA*kk,-KT/2,(KIMG_TSUBA+14)*kk,KT); c.restore(); }
    else { poly([[m[0]-dy*0.03,m[1]+dx*0.03],[m[0]+dy*0.03,m[1]-dx*0.03]],o.mono||'#8a7436',lw*0.9); poly([m,[m[0]+dx*0.12,m[1]+dy*0.12]],o.mono||'#3b302a',lw*1.05); }
    if(g>0&&!o.mono){ const q=M(s2); const r=h*0.05*o.glint; const gg=c.createRadialGradient(q[0],q[1],0,q[0],q[1],r);
      gg.addColorStop(0,'rgba(255,255,255,'+(0.9*o.glint)+')'); gg.addColorStop(1,'rgba(255,255,255,0)'); c.fillStyle=gg; c.beginPath(); c.arc(q[0],q[1],r,0,7); c.fill(); }
  } else {
    const a=J.bAng, ca=Math.cos(a), sa=Math.sin(a), hf=J.hF;
    if(kimg){ const q=M(hf); c.save(); c.translate(q[0],q[1]); c.rotate(Math.atan2(sa,ca*face)); c.scale(1,face); c.drawImage(kimg,-KL*0.167,-KT/2,KL,KT); c.restore(); }
    else { const tip=[hf[0]+ca*0.56,hf[1]+sa*0.56]; poly([hf,tip],o.mono||'#eef2f5',lw*0.55); }
  }
  poly([J.neck,J.eF,J.hF],ink,lw);
  const hq=M(hd); c.fillStyle=ink; c.beginPath(); c.arc(hq[0],hq[1],h*0.075,0,7); c.fill();
  poly([[hd[0]-0.072,hd[1]-0.012],[hd[0]+0.07,hd[1]-0.032]],o.mono||o.col,lw*0.85);
}
function drawFighter(c,v,J,o){
  const h=FH, gy=GY;
  if(!o.mono&&!v.cut){ c.fillStyle='rgba(30,30,20,0.2)'; c.beginPath(); c.ellipse(v.x,gy+2,h*0.2,h*0.03,0,0,7); c.fill(); }
  if(!v.cut){ drawBody(c,v.x,gy,h,v.face,J,o); return; }
  const t=clamp(v.cut.t), cy=gy-0.58*h, cx=v.x;
  const d=v.cut.k==='d'?[Math.cos(0.55)*-v.face,Math.sin(0.55)]:[1,0];
  let n=[d[1],-d[0]]; if(n[1]>0) n=[-n[0],-n[1]];
  const R=3*h, P1=[cx-d[0]*R,cy-d[1]*R], P2=[cx+d[0]*R,cy+d[1]*R];
  const clipSide=s=>{ c.beginPath(); c.moveTo(P1[0],P1[1]); c.lineTo(P2[0],P2[1]); c.lineTo(P2[0]+s*n[0]*R,P2[1]+s*n[1]*R); c.lineTo(P1[0]+s*n[0]*R,P1[1]+s*n[1]*R); c.closePath(); c.clip(); };
  const sink=easeIn(clamp((t-0.3)/0.7));
  c.save(); c.translate(cx,gy); c.rotate(-v.face*0.22*sink); c.translate(-cx,-gy); clipSide(-1); drawBody(c,cx,gy,h,v.face,J,o); c.restore();
  const f=easeIn(t);
  c.save(); c.translate(-v.face*h*0.2*ease(t),h*0.5*f); c.translate(cx,cy); c.rotate(-v.face*1.35*f); c.translate(-cx,-cy); clipSide(1); drawBody(c,cx,gy,h,v.face,J,o); c.restore();
  if(t<0.25){ c.save(); c.globalAlpha=1-t/0.25; c.strokeStyle='#fff'; c.lineWidth=2; c.beginPath(); c.moveTo(cx-d[0]*h*0.3,cy-d[1]*h*0.3); c.lineTo(cx+d[0]*h*0.3,cy+d[1]*h*0.3); c.stroke(); c.restore(); }
}
function drawExtras(c,v,p,now){
  const top=GY-1.02*FH;
  const col=COL[p.i].main;
  if(v.aura){ const cx=v.x, cy=GY-0.5*FH, r=0.6*FH;
    c.save(); c.strokeStyle=col; c.globalAlpha=0.55; c.lineWidth=Math.max(2,FH*0.018); c.setLineDash([FH*0.06,FH*0.035]); c.lineDashOffset=-now*0.05;
    c.beginPath(); c.arc(cx,cy,r,0,7); c.stroke(); c.setLineDash([]);
    const k=(now%650)/650; c.globalAlpha=0.35*(1-k); c.lineWidth=1.5; c.beginPath(); c.arc(cx,cy,r*(1+k*0.35),0,7); c.stroke(); c.restore(); }
  if(v.dots){ c.fillStyle='rgba(20,20,18,0.55)'; for(let i=0;i<3;i++){ c.beginPath(); c.arc(v.x+(i-1)*FH*0.06,top-FH*0.02-Math.abs(Math.sin(now/200+i))*FH*0.02,FH*0.014,0,7); c.fill(); } }
  // 誰の駒か（頭上の小さな印）
  c.fillStyle=col; c.beginPath(); const my=top-FH*0.08; c.moveTo(v.x-FH*0.04,my-FH*0.05); c.lineTo(v.x+FH*0.04,my-FH*0.05); c.lineTo(v.x,my); c.closePath(); c.fill();
  if(CFG.gauges) drawGauge(c,v,p,now,my-FH*0.1);
}
function drawGauge(c,v,p,now,y){
  const w=FH*0.6, h=6, x=v.x-w/2;
  let frac=0,colr=null,zone=null;
  if(p.state==='charge'){ frac=clamp((now-p.start)/CFG.charge); colr='#ffffff'; zone=[1-CFG.just/CFG.charge,1]; }
  else if(p.state==='mikiri'){ frac=clamp((now-p.start)/CFG.window); colr=COL[p.i].light; zone=[0,CFG.just/CFG.window]; }
  else if(p.state==='mkRec'){ frac=1-clamp((now-p.start)/CFG.mkRec); colr='#8b8b80'; }
  else if(p.state==='cancelRec'){ frac=1-clamp((now-p.start)/Math.max(1,CFG.cancelRec)); colr='#8b8b80'; }
  if(!colr) return;
  c.fillStyle='rgba(0,0,0,0.45)'; c.fillRect(x-1,y-1,w+2,h+2);
  if(zone){ c.fillStyle='rgba(232,195,90,0.85)'; c.fillRect(x+w*clamp(zone[0]),y,w*(clamp(zone[1])-clamp(zone[0])),h); }
  c.fillStyle=colr; c.globalAlpha=0.85; c.fillRect(x,y,w*frac,h); c.globalAlpha=1;
}
function slash(c,x0,y0,x1,y1,h1,w,st){
  st=st||{}; w*=st.thick||1;
  if(h1<=0||w<=0.3) return;
  const dx=x1-x0, dy=y1-y0, L=Math.hypot(dx,dy), nx=-dy/L, ny=dx/L, N=28, top=[], bot=[];
  for(let i=0;i<=N;i++){ const u=i/N, s=h1*u, px=x0+dx*s, py=y0+dy*s; const ww=w*Math.pow(Math.sin(Math.PI*u),0.5)*(0.35+0.65*u)*0.5+0.4;
    top.push([px+nx*ww,py+ny*ww]); bot.push([px-nx*ww,py-ny*ww]); }
  let fill=st.col||'#ffffff';
  if(st.rainbow){ const g=c.createLinearGradient(x0,y0,x1,y1); const h0=performance.now()/5; for(let i=0;i<=6;i++){ const q=hsl2rgb(h0+i*55,0.85,0.82); g.addColorStop(i/6,'rgb('+(q[0]|0)+','+(q[1]|0)+','+(q[2]|0)+')'); } fill=g; }
  c.save(); c.shadowColor=st.glow||'rgba(255,255,255,0.95)'; c.shadowBlur=w*3; c.fillStyle=fill;
  c.beginPath(); top.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1])); for(let i=bot.length-1;i>=0;i--) c.lineTo(bot[i][0],bot[i][1]); c.closePath(); c.fill();
  if(st.double){ const off=w*1.7, hx=x0+dx*h1, hy=y0+dy*h1; c.globalAlpha=0.55; c.shadowBlur=w*1.5; c.strokeStyle=fill; c.lineWidth=Math.max(1,w*0.18);
    c.beginPath(); c.moveTo(x0+dx*h1*0.15+nx*off,y0+dy*h1*0.15+ny*off); c.lineTo(hx+nx*off,hy+ny*off); c.stroke(); }
  c.restore();
}
function drawSlashes(c,now){
  const fx=G.fx; if(!fx) return; const e=Math.min(fxE(fx,now),fx.dur);
  const xW0=sideX(fx.sW), xL0=sideX(fx.sL), dirWL=Math.sign(xL0-xW0), dirLW=-dirWL, base=Math.max(3,VH*0.014)*(fx.mutual?1.6:1);
  if(fx.kind==='iai'&&e>=120){
    const u=ease(clamp((e-120)/200)), life=1-clamp((e-380)/800), y=GY-0.58*FH;
    slash(c,dirWL>0?-40:VW+40,y,dirWL>0?VW+40:-40,y,u,base*life,katOf(fx.W.i).slash);
  } else if((fx.kind==='counter1'||fx.kind==='counterWin')&&e>=140){
    const cx=(xL0+xW0)/2, cy=GY-0.55*FH, a=0.62, d=[dirLW*Math.cos(a),Math.sin(a)], half=VW*0.2;
    const u=ease(clamp((e-140)/170)), life=1-clamp((e-420)/650);
    slash(c,cx-d[0]*half,cy-d[1]*half,cx+d[0]*half,cy+d[1]*half,u,base*0.95*life,katOf(fx.W.i).slash);
  } else if(fx.kind==='just'){
    if(e>=120){ const u=ease(clamp((e-120)/160)), life=1-clamp((e-285)/120), y=GY-0.58*FH;
      slash(c,dirLW>0?-40:VW+40,y,VW/2,y,u,base*life,katOf(fx.L.i).slash); }
    if(e>=300){ const u=ease(clamp((e-300)/180)), life=1-clamp((e-650)/900), y=GY-0.6*FH;
      slash(c,dirLW>0?VW+40:-40,y,dirLW>0?-40:VW+40,y,u,base*1.25*life,katOf(fx.W.i).slash); }
  } else if(fx.kind==='aiuchi'&&e>=250){
    const u=ease(clamp((e-250)/120)), life=1-clamp((e-420)/400), cx=VW/2, cy=GY-0.6*FH, r=FH*0.6;
    slash(c,cx-r,cy-r*0.6,cx+r,cy+r*0.6,u,base*0.8*life); slash(c,cx+r,cy-r*0.6,cx-r,cy+r*0.6,u,base*0.8*life);
  }
}
function drawParts(c,col){ c.fillStyle=col; for(const q of G.parts){ c.beginPath(); if(q.landed) c.ellipse(q.x,q.y,q.r*1.8,q.r*0.45,0,0,7); else c.arc(q.x,q.y,q.r,0,7); c.fill(); } }

/* 舞い落ちる笹 */
const leaves=[]; (function(){ const r=mulberry32(5); for(let i=0;i<14;i++) leaves.push({x:r(),y:r(),s:0.6+r()*0.8,ph:r()*6,sp:0.03+r()*0.04,rot:r()*6}); })();
function drawLeaves(c,now,dt,mu){
  mu=mu||0; c.fillStyle=mu>0.5?'rgba(120,40,30,0.8)':'rgba(74,104,66,0.75)';
  for(const l of leaves){ l.y+=l.sp*dt*(1+2.5*mu); l.x+=dt*0.04*mu; if(l.x>1.05) l.x=-0.05; l.ph+=dt*1.5*(1+mu); if(l.y>1.05){ l.y=-0.05; l.x=Math.random(); }
    const x=l.x*VW+Math.sin(l.ph)*VW*0.02, y=l.y*VH, L=VH*0.022*l.s;
    c.save(); c.translate(x,y); c.rotate(l.rot+Math.sin(l.ph)*0.8); c.beginPath(); c.moveTo(-L,0); c.quadraticCurveTo(0,-L*0.22,L,0); c.quadraticCurveTo(0,L*0.22,-L,0); c.fill(); c.restore(); }
}

function txt(c,s,x,y,size,font,col,align,alpha){ c.save(); c.globalAlpha=alpha==null?1:alpha; c.font=size+'px '+font; c.fillStyle=col; c.textAlign=align||'center'; c.textBaseline='middle'; c.fillText(s,x,y); c.restore(); }
function fmtTime(ms){ const s=Math.ceil(Math.max(0,ms)/1000); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }

function drawHUD(c,now,vw){
  if(G.phase==='title') return;
  const ts=clamp(VH*0.065,18,38), ty=SA.t+10+ts*0.6;
  let left=CFG.roundSec*1000;
  if(G.phase==='fight') left=G.roundEnd-now; else if(G.phase==='fx'||G.phase==='result'||G.phase==='match') left=G.frozenLeft;
  c.save(); c.fillStyle='rgba(18,22,19,0.55)'; const bw=ts*3.2; c.beginPath(); c.roundRect(VW/2-bw/2,ty-ts*0.62,bw,ts*1.24,ts*0.3); c.fill(); c.restore();
  txt(c,fmtTime(left),VW/2,ty+1,ts,UIF,left<10000&&G.phase==='fight'?'#ffb3a8':'#f2ede1','center');
  const tw=TOWIN();
  for(let i=0;i<2;i++){
    const p=P[i], L=i===vw.me, x0=L?SA.l+12:VW-SA.r-12, al=L?'left':'right', sz=clamp(VH*0.06,16,34), y=SA.t+10+sz*0.6;
    const named=G.mode==='cpu'||G.mode==='online';
    const label=G.mode==='cpu'?(i===0?'あなた':'其の'+kn(RUN.n)):G.mode==='online'?(i===NET.me?NET.myName:NET.oppName):COL[i].name;
    const lw=named?sz*(label.length*0.6+0.55):sz*1.2;
    c.save(); c.fillStyle='rgba(242,237,225,0.82)'; const bw2=lw+tw*sz*0.62+10;
    c.beginPath(); c.roundRect(L?x0-6:x0-bw2+6,y-sz*0.68,bw2,sz*1.36+sz*0.55,8); c.fill(); c.restore();
    txt(c,label,L?x0+lw/2-sz*0.1:x0-lw/2+sz*0.1,y,named?sz*0.6:sz,named?UIF:DISPLAY,COL[i].main,'center');
    for(let k=0;k<tw;k++){ const cx=L?x0+lw+sz*0.05+k*sz*0.62:x0-lw-sz*0.05-k*sz*0.62; c.beginPath(); c.arc(cx,y,sz*0.2,0,7);
      if(k<p.score){ c.fillStyle=COL[i].main; c.fill(); } else { c.strokeStyle=COL[i].main; c.lineWidth=1.5; c.stroke(); } }
    const y2=y+sz*0.72; const ls=Math.max(10,sz*0.36);
    txt(c,'見切',x0,y2,ls,UIF,'#3a3a33',al);
    for(let k=0;k<2;k++){ const cx=L?x0+ls*2.6+k*ls*1.1:x0-ls*2.6-k*ls*1.1, r=ls*0.38; c.beginPath(); c.moveTo(cx,y2-r); c.lineTo(cx+r,y2); c.lineTo(cx,y2+r); c.lineTo(cx-r,y2); c.closePath();
      if(k<p.counters){ c.fillStyle=COL[i].main; c.fill(); } else { c.strokeStyle='#6c6a5f'; c.lineWidth=1.2; c.stroke(); } }
  }
}
function drawCenterTexts(c,now,vw){
  const big=clamp(VH*0.14,36,110);
  if(G.phase==='ready'){
    if(G.mode==='cpu'){
      txt(c,'其の'+kn(RUN.n),VW/2,VH*0.34,big,DISPLAY,'#1d211c','center',0.9);
      const lv=Math.min(RUN.n,10);
      txt(c,lv>=10?'強さ　上限':'強さ　'+kn(lv)+' / 十',VW/2,VH*0.34+big*0.72,big*0.24,UIF,'#2f332c','center',0.8);
      txt(c,'構え',VW/2,VH*0.34+big*1.1,big*0.26,UIF,'#2f332c','center',0.6+0.3*Math.sin(now/240));
    } else {
      txt(c,'第'+kn(G.round)+'本',VW/2,VH*0.36,big,DISPLAY,'#1d211c','center',0.9);
      txt(c,'構え',VW/2,VH*0.36+big*0.8,big*0.3,UIF,'#2f332c','center',0.6+0.3*Math.sin(now/240));
    }
  }
  if(G.phase==='fight'&&now-G.startAt<800){
    const k=(now-G.startAt)/800; txt(c,'始め',VW/2,VH*0.36,big*1.15*(1+0.08*k),DISPLAY,'#121411','center',1-easeIn(k));
  }
  if((G.phase==='fight'||G.phase==='fx')&&P[0].counters>=1&&P[1].counters>=1&&!(G.fx&&G.fx.kind!=='counter1')){
    const my=SA.t+clamp(VH*0.11,48,64)+46, ms=clamp(VH*0.045,14,26);
    c.save(); c.fillStyle='rgba(18,22,19,0.6)'; c.beginPath(); c.roundRect(VW/2-ms*3.6,my-ms*0.75,ms*7.2,ms*1.5,ms*0.4); c.fill(); c.restore();
    txt(c,'互いに後なし',VW/2,my+1,ms,DISPLAY,'#ffb3a8','center',0.8+0.2*Math.sin(now/200)); }
  const fx=G.fx;
  if(fx&&fx.kind==='counter1'){ const e=fxE(fx,now); if(e>380&&e<1350){ const a=e<520?(e-380)/140:e>1150?1-(e-1150)/200:1; const xW1=mx(sideX(fx.sL));
    txt(c,'見切',xW1,GY-1.32*FH,big*0.55,DISPLAY,COL[fx.W.i].light,'center',a);
    txt(c,'あと一度で一本',xW1,GY-1.32*FH+big*0.42,big*0.17,UIF,PALE,'center',a); } }
  if(fx&&fx.kind==='issen'){ const e=fxE(fx,now); if(e>3000&&e<5300){ const a=clamp((e-3000)/500)*(1-clamp((e-4800)/500)), sz=Math.min(VH*0.32,VW*0.3);
    c.save(); c.shadowColor='rgba(255,255,255,0.9)'; c.shadowBlur=30; txt(c,'一閃',VW/2,VH*0.3,sz*(1+0.04*clamp((e-3000)/2000)),DISPLAY,rainbow(a,now),'center',1); c.restore();
    txt(c,'互いに後なし　寸分違わぬ見切り',VW/2,VH*0.3+sz*0.68,Math.max(11,sz*0.11),UIF,'rgba(240,235,220,'+a+')','center'); } }
  if(fx&&fx.kind==='aiuchi'){ const e=fxE(fx,now); if(e>320) txt(c,'相打ち',VW/2,VH*0.3,big*0.6,DISPLAY,PALE,'center',clamp(1-(e-800)/300)); }
  if(G.mode==='online'&&NET.tag&&G.phase!=='match'){ const tg=(NET.watch?'観戦　':'')+NET.tag, ts2=clamp(VH*0.03,11,16), ty2=Math.max(VH*0.215,SA.t+clamp(VH*0.065,18,38)*2.6);
    c.save(); c.font=ts2+'px '+UIF; const tw2=c.measureText(tg).width+ts2*1.6; c.fillStyle='rgba(18,22,19,0.62)'; c.beginPath(); c.roundRect(VW/2-tw2/2,ty2-ts2*0.85,tw2,ts2*1.7,ts2*0.5); c.fill(); c.restore();
    txt(c,tg,VW/2,ty2,ts2,UIF,'#e8c35a','center',0.95); }
  if(G.mode==='online'&&NET.wait){ const ws=clamp(VH*0.04,13,22); c.save(); c.fillStyle='rgba(18,22,19,0.66)'; c.beginPath(); c.roundRect(VW/2-ws*4.5,VH*0.16-ws*0.8,ws*9,ws*1.6,ws*0.4); c.fill(); c.restore();
    txt(c,NET.wait,VW/2,VH*0.16+1,ws,UIF,PALE,'center',0.75+0.25*Math.sin(now/220)); }
  if(G.mode==='online'&&CFG.netInfo&&!NET.watch) netInfo(c,now);
  if(G.debug&&CFG.gauges&&now-G.debug.at<3000) txt(c,G.debug.text,VW/2,GY+FH*0.18,clamp(VH*0.032,11,18),UIF,'#f6f1e4','center',0.95);
}
/* 通信の様子（一時停止の「通信の様子を表示」）。ラグの原因を実機で確かめるため
   往復: 相手まで行って帰る時間 / 相手の動き: 相手が押してから自分の画面に届くまで / 斬撃待ち: 斬る瞬間に相手の知らせを待った時間
   操作待ち: 自分が押してから自分の画面に出るまで / 画面: 1秒あたりの描画回数。（ ）は直近10秒の最大 */
function netInfo(c,now){
  const S=NET.st, ms=v=>Math.max(0,Math.round(v))+'ms';
  if(performance.now()-S.maxAt>10000){ S.maxAt=performance.now(); S.oppMax=S.opp; S.inMax=0; S.stallMax=S.stall; }
  const lines=['往復 '+(S.rtt?ms(S.rtt):'…')+'　相手の動き '+ms(S.opp)+'（'+ms(S.oppMax)+'）',
    '斬撃待ち '+ms(S.stall)+'（'+ms(S.stallMax||0)+'）　操作待ち '+ms(S.inWait)+'（'+ms(S.inMax)+'）　画面 '+Math.round(S.fps)];
  const sz=clamp(VH*0.028,10,14), y0=GY+FH*0.22;
  c.save(); c.font=sz+'px '+UIF; const w=Math.max(...lines.map(l=>c.measureText(l).width))+sz*1.4;
  c.fillStyle='rgba(18,22,19,0.7)'; c.beginPath(); c.roundRect(VW/2-w/2,y0-sz*1.1,w,sz*3.3,sz*0.4); c.fill(); c.restore();
  lines.forEach((l,i)=>txt(c,l,VW/2,y0+i*sz*1.45,sz,UIF,'#e8c35a','center',0.95));
}
function whoName(i){ return G.mode==='cpu'?(i===0?'あなた':'其の'+kn(RUN.n)):G.mode==='online'?(i===NET.me?NET.myName:NET.oppName):COL[i].name; }
function drawResult(c,now,vw){
  const e=now-G.resultAt, a=clamp(e/300), r=G.result, f=FIN[r.name];
  const cy=VH*0.4, bh=VH*0.5;
  c.save(); c.globalAlpha=a; c.fillStyle='rgba(8,10,9,0.8)'; c.fillRect(0,cy-bh/2,VW,bh); c.restore();
  const nameSize=Math.min(clamp(VH*0.15,36,120),VW*0.8/Math.max(2,r.name.length));
  const tc=TIER[f.tier];
  let fill=tc;
  if(f.tier==='幻'){ const g=c.createLinearGradient(VW/2-nameSize*2,0,VW/2+nameSize*2,0); const h0=(now/12)%360;
    for(let i=0;i<=4;i++) g.addColorStop(i/4,'hsl('+((h0+i*60)%360)+',85%,80%)'); fill=g; }
  const sl=clamp(VH*0.032,11,18);
  const ty=cy-bh/2+sl*1.5;
  c.save(); c.globalAlpha=a; const tagW=sl*(f.tier==='分'?6:2.4), tagH=sl*1.6;
  c.fillStyle=tc; c.fillRect(VW/2-tagW/2,ty-tagH/2,tagW,tagH); c.restore();
  txt(c,TIERNAME[f.tier],VW/2,ty+1,sl*1.05,UIF,'#151512','center',a);
  txt(c,f.yomi,VW/2,ty+sl*1.7,sl,UIF,'#cfc8b6','center',a);
  c.save(); c.globalAlpha=a; c.font=nameSize+'px '+DISPLAY; c.textAlign='center'; c.textBaseline='middle'; c.fillStyle=fill;
  if(f.tier==='極'||f.tier==='幻'||f.tier==='絶'){ c.shadowColor=f.tier==='幻'?'rgba(233,184,255,0.8)':f.tier==='絶'?'rgba(255,255,255,1)':'rgba(232,195,90,0.7)'; c.shadowBlur=f.tier==='絶'?40:24; }
  c.fillText(r.name,VW/2,cy+nameSize*0.02); c.restore();
  txt(c,f.desc,VW/2,cy+nameSize*0.62,sl*1.05,UIF,'#e6dfcd','center',a);
  let line;
  if(r.winner==null) line='一本にならず';
  else if(G.mode==='cpu') line=r.winner===0?'勝ち　'+RUN.n+'人抜き':'敗れた　'+(RUN.n-1)+'人抜きで終わり';
  else if(G.mode==='online') line=(r.winner===NET.me&&!NET.watch?'あなたの一本':whoName(r.winner)+'の一本')+'　　'+P[NET.me].score+' − '+P[1-NET.me].score;
  else line=COL[r.winner].name+'の一本　　朱 '+P[0].score+' − '+P[1].score+' 藍';
  txt(c,line,VW/2,cy+bh/2-sl*2.4,sl*1.15,UIF,r.winner==null?'#e6dfcd':COL[r.winner].light,'center',a);
  if(r.coin) txt(c,'銭 +'+r.coin+'　（所持 '+WALLET.coins+'）',VW/2,cy+bh/2-sl*1.0,sl*0.95,UIF,'#e8c35a','center',a);
  if(e>1200&&G.mode!=='online') txt(c,'画面をタップで次へ',VW/2,cy+bh/2+sl*1.3,sl*0.95,UIF,'#1b1e19','center',0.55+0.35*Math.sin(now/260));
}
function drawMatch(c,now,vw){
  const e=now-G.resultAt, a=clamp(e/400);
  c.save(); c.globalAlpha=a; c.fillStyle='rgba(8,10,9,0.86)'; c.fillRect(0,0,VW,VH); c.restore();
  const big=Math.min(clamp(VH*0.17,40,130),VW*0.85/5), sl=clamp(VH*0.032,11,18);
  if(G.mode==='cpu'){
    const wins=RUN.n-1;
    txt(c,wins+'人抜き',VW/2,VH*0.3,big,DISPLAY,PALE,'center',a);
    txt(c,RUN.newBest?'自己最高を更新':'自己最高　'+WALLET.best+'人抜き',VW/2,VH*0.3+big*0.8,sl*1.3,UIF,RUN.newBest?'#e8c35a':'#cfc8b6','center',a);
    txt(c,'この挑戦で得た銭　'+RUN.coins+'　（所持 '+WALLET.coins+'）',VW/2,VH*0.3+big*0.8+sl*2.2,sl,UIF,'#e8c35a','center',a);
    const hist=G.history.filter(h=>h.winner!=null).slice(-6).map(h=>h.name).join('・');
    txt(c,hist,VW/2,VH*0.3+big*0.8+sl*4,sl*0.9,UIF,'#cfc8b6','center',a);
    if(e>1200) txt(c,'画面をタップでタイトルへ',VW/2,VH*0.3+big*0.8+sl*6.2,sl*1.1,UIF,PALE,'center',0.55+0.35*Math.sin(now/260));
    return;
  }
  const w=P[0].score>=TOWIN()?0:1;
  const mine=w===vw.me, on=G.mode==='online', wt=on&&NET.watch;
  txt(c,wt?whoName(w)+'の勝ち':on?(mine?'勝ち':'負け'):COL[w].name+'の勝ち',VW/2,VH*0.28,big*(wt?0.6:1),DISPLAY,COL[w].light,'center',a);
  if(on&&NET.tag) txt(c,NET.tag,VW/2,VH*0.28-big*0.75,sl*1.2,UIF,'#e8c35a','center',a);
  txt(c,wt?'見届けた':mine?'見事':'無念',VW/2,VH*0.28+big*0.72,sl*1.3,UIF,PALE,'center',a);
  txt(c,on?whoName(NET.me)+' '+P[NET.me].score+' − '+P[1-NET.me].score+' '+whoName(1-NET.me):'朱 '+P[0].score+' − '+P[1].score+' 藍',VW/2,VH*0.28+big*0.72+sl*2,sl*1.3,UIF,PALE,'center',a);
  const hist=G.history.map((h,i)=>kn(i+1)+'本目 '+h.name+(h.winner==null?'':'（'+(on?whoName(h.winner):COL[h.winner].name)+'）')).join('　');
  c.save(); let hs=sl; c.font=hs+'px '+UIF; while(c.measureText(hist).width>VW-24&&hs>8){ hs-=1; c.font=hs+'px '+UIF; } c.restore();
  const R=on?NET.rate:null, y0=VH*0.28+big*0.72;
  if(R){ // 戦闘力の増減（サーバーが計算した値）
    const ra=a*clamp((performance.now()-(R.at||0))/600,0,1), up=R.delta>0, dn=R.delta<0;
    const d=R.counted?(up?'＋':dn?'−':'±')+Math.abs(R.delta):'同じ相手とは一日五戦まで';
    const sk=R.counted&&R.streak>=2?'　'+kn(R.streak)+'連勝':'';
    txt(c,'戦闘力　'+R.before+'　→　'+R.after+'　'+d+sk,VW/2,y0+sl*3.3,sl*1.15,UIF,up?'#e8c35a':dn?'#b9b29e':PALE,'center',ra);
  }
  txt(c,hist,VW/2,y0+sl*(R?4.7:4),hs,UIF,'#cfc8b6','center',a);
  if(e>1200) txt(c,on&&NET.back?NET.back:'画面をタップでタイトルへ',VW/2,y0+sl*(R?6.8:6.2),sl*1.1,UIF,PALE,'center',0.55+0.35*Math.sin(now/260));
}
/* タイトル：墨の夜の竹林、余白、縦書きの題字と朱の落款、傾けた一振り */
let GRAIN=null, SHINE=null;
function grainPattern(c){ if(GRAIN) return GRAIN; const g=document.createElement('canvas'); g.width=g.height=160; const x=g.getContext('2d'); const d=x.createImageData(160,160);
  for(let i=0;i<d.data.length;i+=4){ const v=Math.random()*255; d.data[i]=d.data[i+1]=d.data[i+2]=v; d.data[i+3]=Math.random()<0.5?18:0; } x.putImageData(d,0,0); GRAIN=c.createPattern(g,'repeat'); return GRAIN; }
function brushStroke(c,x0,y0,x1,y1,w,col,seed){ const r=mulberry32(seed); const n=90; c.save(); c.strokeStyle=col; c.lineCap='round';
  for(let k=0;k<14;k++){ const off=(r()-0.5)*w, a=0.25+r()*0.5; c.globalAlpha=a; c.lineWidth=Math.max(1,w*(0.05+r()*0.12)); c.beginPath();
    for(let i=0;i<=n;i++){ const u=i/n; if(u>0.9+r()*0.1) break; const px=lerp(x0,x1,u), py=lerp(y0,y1,u)+off*Math.sin(Math.PI*u)+(r()-0.5)*w*0.04; i?c.lineTo(px,py):c.moveTo(px,py); } c.stroke(); }
  c.restore(); }
function enso(c,cx,cy,R,col,seed){ const r=mulberry32(seed); const a0=-1.9, span=Math.PI*1.82, n=220; c.save(); c.strokeStyle=col; c.lineCap='round';
  let pa=a0, pr=R;
  for(let i=1;i<=n;i++){ const u=i/n, a=a0+span*u, w=R*(0.02+0.055*Math.sin(Math.PI*Math.pow(u,0.6)));
    const rr=R*(1+0.012*Math.sin(u*9)); c.globalAlpha=u<0.88?1:Math.max(0,1-(u-0.88)/0.12);
    for(let k=0;k<3;k++){ const o=(k-1)*w*0.3; c.lineWidth=w*(k===1?0.7:0.25)*(0.8+r()*0.4); c.beginPath(); c.moveTo(cx+Math.cos(pa)*(pr+o),cy+Math.sin(pa)*(pr+o)); c.lineTo(cx+Math.cos(a)*(rr+o),cy+Math.sin(a)*(rr+o)); c.stroke(); }
    pa=a; pr=rr; }
  c.restore(); }
function drawTitle(c,now){
  // 墨を重ねて竹林を沈める
  c.save(); c.fillStyle='rgba(14,15,12,0.84)'; c.fillRect(0,0,VW,VH);
  const vg=c.createRadialGradient(VW*0.34,VH*0.4,VH*0.1,VW*0.4,VH*0.5,Math.max(VW,VH)*0.75); vg.addColorStop(0,'rgba(40,42,34,0)'); vg.addColorStop(1,'rgba(4,4,3,0.7)');
  c.fillStyle=vg; c.fillRect(0,0,VW,VH); c.restore();
  // 月（円相）
  const R=Math.min(VH*0.3,VW*0.2), ecx=VW*0.36, ecy=VH*0.42;
  c.save(); const mg=c.createRadialGradient(ecx,ecy,0,ecx,ecy,R*1.6); mg.addColorStop(0,'rgba(230,222,200,0.10)'); mg.addColorStop(1,'rgba(230,222,200,0)'); c.fillStyle=mg; c.fillRect(0,0,VW,VH); c.restore();
  enso(c,ecx,ecy,R,'rgba(226,218,196,0.13)',23);
  // 刀の下に掃いた墨
  const kw=Math.min(VW*0.66,VH*1.7), kh=kw*KIMG_H/KIMG_W, kcx=VW*0.37, kcy=VH*0.47, ang=-0.2;
  c.save(); c.translate(kcx,kcy); c.rotate(ang);
  brushStroke(c,-kw*0.58,kh*1.5,kw*0.46,kh*1.25,kh*1.1,'rgba(4,4,3,0.55)',7);
  // 刀（描き替えず、光と影だけ）
  if(KIMG.complete&&KIMG.naturalWidth){
    const TK=KREADY?katOf(0).canvas:KIMG; c.save(); c.shadowColor='rgba(0,0,0,0.85)'; c.shadowBlur=18; c.shadowOffsetY=6; c.drawImage(TK,-kw/2,-kh/2,kw,kh); c.restore();
    const T=5200, k=(now%T)/T;
    if(k<0.42){ const u=ease(k/0.42), B0=262, sx=B0+(KIMG_W-B0)*u, gw=KIMG_W*0.09, a=0.85*Math.sin(Math.PI*u);
      if(!SHINE){ SHINE=document.createElement('canvas'); SHINE.width=KIMG_W; SHINE.height=KIMG_H; }
      const x=SHINE.getContext('2d'); x.globalCompositeOperation='source-over'; x.clearRect(0,0,KIMG_W,KIMG_H);
      x.drawImage(TK,B0,0,KIMG_W-B0,KIMG_H,B0,0,KIMG_W-B0,KIMG_H);
      x.globalCompositeOperation='source-in';
      const g=x.createLinearGradient(sx-gw,0,sx+gw,0); g.addColorStop(0,'rgba(255,250,235,0)'); g.addColorStop(0.5,'rgba(255,250,235,'+a+')'); g.addColorStop(1,'rgba(255,250,235,0)');
      x.fillStyle=g; x.fillRect(0,0,KIMG_W,KIMG_H);
      c.save(); c.globalCompositeOperation='lighter'; c.drawImage(SHINE,-kw/2,-kh/2,kw,kh); c.restore(); }
  }
  c.restore();
  // 縦書きの題字
  const big=Math.min(VH*0.24,VW*0.16), tx=VW*0.8, ty0=VH*0.12+big*0.5;
  txt(c,'一',tx,ty0,big,DISPLAY,'#e9e2cf','center');
  txt(c,'閃',tx,ty0+big*1.02,big,DISPLAY,'#e9e2cf','center');
  // 添え書き（縦）
  const sm=Math.max(11,big*0.13), sx2=tx-big*0.78;
  '居合と見切りの果たし合い'.split('').forEach((ch,i)=>txt(c,ch,sx2,ty0-big*0.25+i*sm*1.35,sm,DISPLAY,'rgba(233,226,207,0.55)','center'));
  // 朱の落款
  const sz=big*0.3, lx=tx+big*0.08, ly=ty0+big*1.02+big*0.82;
  c.save(); c.translate(lx,ly); c.rotate(0.04); c.fillStyle='#a8322a'; c.globalAlpha=0.92; c.beginPath(); c.roundRect(-sz/2,-sz/2,sz,sz,sz*0.08); c.fill();
  c.globalCompositeOperation='destination-out'; const r=mulberry32(3); for(let i=0;i<26;i++){ c.globalAlpha=0.5; c.beginPath(); c.arc((r()-0.5)*sz,(r()-0.5)*sz,r()*sz*0.035,0,7); c.fill(); }
  c.restore();
  txt(c,'閃',lx,ly+1,sz*0.72,DISPLAY,'rgba(14,15,12,0.85)','center');
  // 散る一葉
  const lt=(now%9000)/9000, lx2=VW*(0.62-lt*0.25)+Math.sin(lt*9)*VW*0.02, ly2=VH*(-0.05+lt*1.1), L=VH*0.024;
  c.save(); c.translate(lx2,ly2); c.rotate(0.6+Math.sin(lt*7)*0.9); c.fillStyle='rgba(150,160,120,0.5)'; c.beginPath(); c.moveTo(-L,0); c.quadraticCurveTo(0,-L*0.22,L,0); c.quadraticCurveTo(0,L*0.22,-L,0); c.fill(); c.restore();
  // 紙の肌理
  c.save(); c.fillStyle=grainPattern(c); c.fillRect(0,0,VW,VH); c.restore();
}


/* ---------- 互いに後なし：ステージの変化と豪華な決着 ---------- */
function mutualLevel(now){ if(!G.mutualAt||!(G.phase==='fight'||G.phase==='fx'||G.phase==='result')) return 0; return clamp((now-G.mutualAt)/1200); }
function drawMutualStage(c,now){
  const m=mutualLevel(now); if(m<=0) return;
  const g=c.createLinearGradient(0,0,0,VH); g.addColorStop(0,'rgba(120,26,16,'+0.5*m+')'); g.addColorStop(0.55,'rgba(70,14,10,'+0.28*m+')'); g.addColorStop(0.7,'rgba(20,6,4,'+0.25*m+')'); g.addColorStop(1,'rgba(0,0,0,'+0.35*m+')');
  c.fillStyle=g; c.fillRect(0,0,VW,VH);
  // 沈む赤い日
  c.save(); c.globalCompositeOperation='multiply'; const sr=FH*0.9, sx=VW/2, sy=GY-FH*1.25; const sg=c.createRadialGradient(sx,sy,0,sx,sy,sr); sg.addColorStop(0,'rgba(200,50,30,'+0.55*m+')'); sg.addColorStop(0.9,'rgba(200,50,30,'+0.45*m+')'); sg.addColorStop(1,'rgba(200,50,30,0)');
  c.fillStyle=sg; c.beginPath(); c.arc(sx,sy,sr,0,7); c.fill(); c.restore();
  const pulse=0.5+0.5*Math.sin(now/420);
  const vg=c.createRadialGradient(VW/2,VH*0.5,Math.min(VW,VH)*0.3,VW/2,VH*0.5,Math.max(VW,VH)*0.75); vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(10,0,0,'+(0.45+0.15*pulse)*m+')');
  c.fillStyle=vg; c.fillRect(0,0,VW,VH);
}
function drawMutualBurst(c,now){
  const fx=G.fx; if(!fx||!fx.mutual||fx.kind==='issen') return; const ht={iai:320,counterWin:300,just:480}[fx.kind]; if(!ht) return;
  const e=Math.min(fxE(fx,now),fx.dur); if(e<ht) return; const t=clamp((e-ht)/900);
  const x=fx.kind==='iai'?sideX(fx.sL):VW/2, y=GY-0.58*FH, r=mulberry32(13);
  c.save(); c.fillStyle='rgba(150,28,20,'+(0.85*(1-t))+')';
  for(let i=0;i<26;i++){ const an=r()*Math.PI*2, d=FH*(0.2+r()*1.4)*ease(t), s=FH*(0.02+r()*0.07)*(1-t*0.5); c.beginPath(); c.ellipse(x+Math.cos(an)*d,y+Math.sin(an)*d*0.6,s*1.6,s,an,0,7); c.fill(); }
  c.restore();
  c.save(); c.globalAlpha=0.8*(1-t); enso(c,x,y,FH*(0.5+0.6*ease(t)),'rgba(200,40,30,0.9)',31); c.restore();
}
function drawIssenFx(c,now){
  const fx=G.fx; if(!fx||fx.kind!=='issen') return; const e=Math.min(fxE(fx,now),fx.dur);
  const xW0=sideX(fx.sW), xL0=sideX(fx.sL), dirLW=Math.sign(xW0-xL0), base=Math.max(3,VH*0.014), y=GY-0.58*FH;
  const stL=katOf(fx.L.i).slash;
  if(e>=900&&e<1300){ const u=ease(clamp((e-900)/150)), life=1-clamp((e-1050)/200); slash(c,dirLW>0?-40:VW+40,y,VW/2,y,u,base*life,stL); }
  if(e>=1050&&e<2000){ const a=e<1120?1:1-clamp((e-1120)/850)*0.92; c.fillStyle='rgba(250,247,238,'+a+')'; c.fillRect(-30,-30,VW+60,VH+60); }
  const xa=dirLW>0?VW+30:-30, xb=dirLW>0?-30:VW+30;
  if(e>=1100){ const u=ease(clamp((e-1100)/300)), fade=1-clamp((e-1900)/1000);
    if(fade>0){ c.save(); c.globalAlpha=fade; const xc=lerp(xa,xb,u); c.beginPath(); c.rect(Math.min(xa,xc),-30,Math.abs(xc-xa),VH+60); c.clip();
      brushStroke(c,xa,y+FH*0.02,xb,y-FH*0.06,FH*0.42,'rgba(8,8,6,1)',99); brushStroke(c,xa,y+FH*0.02,xb,y-FH*0.06,FH*0.25,'rgba(8,8,6,1)',7); c.restore(); }
    if(e>=1500){ const life=1-clamp((e-3600)/1300); slash(c,xa,y,xb,y-FH*0.05,1,base*2.4*life,{rainbow:true,glow:'rgba(255,255,255,1)',double:true}); } }
  if(e>=1500&&e<5000){ const a=clamp((e-1500)/500)*(1-clamp((e-4300)/700)), cx=VW/2; c.save(); c.globalCompositeOperation='lighter'; const n=28, rot=e/3500;
    for(let i=0;i<n;i++){ const an=rot+i*Math.PI*2/n; c.fillStyle=rainbow(0.11*a,now,i*13); c.beginPath(); c.moveTo(cx,y); c.arc(cx,y,Math.max(VW,VH)*1.2,an,an+0.05); c.closePath(); c.fill(); } c.restore(); }
  if(e>=2300){ const a=clamp((e-2300)/500)*(1-clamp((e-4900)/600)); if(a>0){ c.save(); c.globalAlpha=a; enso(c,VW/2,y,FH*1.1*(0.85+0.15*clamp((e-2300)/800)),'rgba(236,198,96,0.95)',41); c.restore(); } }
  if(e>=2600){ const t=(e-2600)/1000, r=mulberry32(77); c.save(); c.globalCompositeOperation='lighter';
    for(let i=0;i<140;i++){ const an=r()*Math.PI*2, sp=(0.15+r()*0.85)*VW*0.32, px=VW/2+Math.cos(an)*sp*t, py=y+Math.sin(an)*sp*t*0.6+t*t*VH*0.1, al=clamp(1-t/2.8)*(0.5+0.5*Math.sin(e/70+i));
      if(al<=0) continue; c.fillStyle=rainbow(al,now,r()*360); c.beginPath(); c.arc(px,py,1+r()*2.8,0,7); c.fill(); } c.restore(); }
}
/* ---------- ループ ---------- */
let lastReal=performance.now();
function frame(){
  const real=performance.now(); const dt=Math.min(0.05,(real-lastReal)/1000); if(real>lastReal) NET.st.fps+=(1000/(real-lastReal)-NET.st.fps)*0.05; lastReal=real;
  const now=gnow(), running=pausedAt==null;
  setView(VIEWS[0]);
  if(running){
    if(G.phase==='ready'&&now>=G.cueAt){ G.phase='fight'; G.roundEnd=G.cueAt+CFG.roundSec*1000; G.startAt=now; NET.fightFrom=G.cueAt; sfx('clack'); aiReset(now); }
    if(G.phase==='fight'){ aiTick(now); stepTo(now); }
    if(G.phase==='fx') fxTick(now);
    if(G.phase==='result'&&now-G.resultAt>4800) nextFromResult();
    const gv=1100*(VH/700);
    for(const q of G.parts){ if(q.landed) continue; q.vy+=gv*dt; q.x+=q.vx*dt; q.y+=q.vy*dt; if(q.y>=GY){ q.y=GY+Math.random()*3; q.landed=true; } }
  }
  const V=views(now);
  for(let i=0;i<2;i++){ const T=POSES[V[i].pose]||POSES.idle, J=P[i].J, a=1-Math.exp(-dt*(G.fx?34:24));
    for(const k of JK){ J[k][0]+=(T[k][0]-J[k][0])*a; J[k][1]+=(T[k][1]-J[k][1])*a; } J.bAng+=(T.bAng-J.bAng)*a; J.blade=T.blade; }
  render(now,V,running?dt:0);
  updateUI();
  requestAnimationFrame(frame);
}
function render(now,V,dt){
  const c=ctx; c.setTransform(1,0,0,1,0,0); c.fillStyle='#3d4a3f'; c.fillRect(0,0,cv.width,cv.height);
  VIEWS.forEach((vw,idx)=>{
    setView(vw); const m=vw.m;
    c.setTransform(m[0]*DPR,m[1]*DPR,m[2]*DPR,m[3]*DPR,m[4]*DPR,m[5]*DPR);
    c.save(); c.beginPath(); c.rect(0,0,VW,VH); c.clip();
    renderView(c,now,V,idx===0?dt:0,vw);
    c.restore();
  });
  if(VIEWS.length>1){ c.setTransform(DPR,0,0,DPR,0,0); c.fillStyle='#101411'; c.fillRect(SW/2-1.5,0,3,SH); }
  setView(VIEWS[0]);
}
function renderView(c,now,V,dt,vw){
  let sx=0,sy=0; if(now<G.shakeUntil){ const k=(G.shakeUntil-now)/G.shakeDur; sx=(Math.random()-0.5)*2*G.shakeAmp*k; sy=(Math.random()-0.5)*2*G.shakeAmp*k; }
  c.save(); c.translate(sx,sy);
  if(MIR){ c.translate(VW,0); c.scale(-1,1); }
  c.drawImage(bg,0,0,VW,VH);
  drawMutualStage(c,now);
  if(G.phase!=='title') for(let i=0;i<2;i++) drawFighter(c,V[i],P[i].J,{col:COL[i].main,glint:V[i].glint,time:now/1000,seed:i*2,kat:katOf(i)});
  for(let i=0;i<2;i++) if(V[i].extras&&(G.phase==='fight'||G.phase==='ready')) drawExtras(c,V[i],P[i],now);
  drawParts(c,'rgba(20,21,18,0.9)');
  if(G.phase!=='title') drawLeaves(c,now,dt,mutualLevel(now));
  const da=darkAlpha(now);
  if(da>0){ c.fillStyle='rgba(5,7,6,'+da+')'; c.fillRect(-30,-30,VW+60,VH+60);
    c.save(); c.globalAlpha=clamp(da/0.85); for(let i=0;i<2;i++) drawFighter(c,V[i],P[i].J,{mono:PALE,col:PALE,time:now/1000,seed:i*2,kat:katOf(i)}); drawParts(c,PALE); c.restore(); }
  drawSlashes(c,now);
  drawMutualBurst(c,now);
  drawIssenFx(c,now);
  const fe=now-G.flashAt; if(fe>=0&&fe<240){ c.fillStyle='rgba(255,255,255,'+(G.flashA*(1-fe/240))+')'; c.fillRect(-30,-30,VW+60,VH+60); }
  c.restore();
  drawHUD(c,now,vw);
  drawCenterTexts(c,now,vw);
  drawButtons(c,vw);
  if(G.phase==='result') drawResult(c,now,vw);
  if(G.phase==='match') drawMatch(c,now,vw);
  if(G.phase==='title') drawTitle(c,now);
}

/* ---------- 操作（ボタンは画面に描き、触れた位置で判定） ---------- */
const downAt={};
function drawButtons(c,vw){
  vw.btns=[];
  if(!(G.phase==='ready'||G.phase==='fight'||G.phase==='fx')) return;
  const r=clamp(Math.min(VH*0.1,VW*0.075),26,60), pad=Math.max(12,r*0.3);
  for(const pi of vw.ctrl){
    const p=P[pi], f=G.phase==='fight', col=COL[pi].main;
    const iaiOn=f&&(p.state==='idle'||p.state==='charge'), mkOn=f&&p.state==='idle';
    const by=VH-SA.b-pad-r;
    const defs=[{a:'mk',x:SA.l+pad+r,on:mkOn,lab:'見切'},{a:'iai',x:VW-SA.r-pad-r,on:iaiOn,lab:p.state==='charge'&&f?'解く':'居合'}];
    for(const d of defs){
      const dn=performance.now()-(downAt[pi+d.a]||0)<110, rr=dn?r*0.92:r;
      c.save(); c.globalAlpha=d.on?1:0.38;
      c.fillStyle='rgba(0,0,0,0.28)'; c.beginPath(); c.arc(d.x,by+(dn?1:3),rr,0,7); c.fill();
      c.beginPath(); c.arc(d.x,by,rr,0,7); c.fillStyle=d.a==='iai'?col:'rgba(242,237,225,0.9)'; c.fill();
      c.lineWidth=3; c.strokeStyle=col; c.stroke();
      c.restore();
      txt(c,d.lab,d.x,by+1,rr*0.62,DISPLAY,d.a==='iai'?'#f2ede1':'#161714','center',d.on?1:0.45);
      vw.btns.push({p:pi,a:d.a,x:d.x,y:by,r});
    }
  }
}
function toView(vw,sx,sy){ const [a,b,c,d,e,f]=vw.m, det=a*d-b*c; const X=sx-e, Y=sy-f; return [(d*X-c*Y)/det,(-b*X+a*Y)/det]; }
function press(pi,a){ downAt[pi+a]=performance.now(); input(pi,a); }
cv.addEventListener('pointerdown',e=>{
  e.preventDefault(); ensureAudio();
  const bx=cv.getBoundingClientRect(), sx=e.clientX-bx.left, sy=e.clientY-bx.top;
  for(const vw of VIEWS){ const R=vw.rect; if(sx<R[0]||sx>R[0]+R[2]||sy<R[1]||sy>R[1]+R[3]) continue;
    const [x,y]=toView(vw,sx,sy);
    for(const b of vw.btns){ if(Math.hypot(x-b.x,y-b.y)<=b.r*1.2){ press(b.p,b.a); return; } } }
  advance();
});
function advance(){
  const now=gnow();
  if(G.phase==='result'&&now-G.resultAt>900&&G.mode!=='online') nextFromResult();
  else if(G.phase==='match'&&now-G.resultAt>1200) goTitle();
}
const KEYS={a:[0,'iai'],s:[0,'mk'],l:[1,'iai'],k:[1,'mk']};
window.addEventListener('keydown',e=>{
  if(!document.getElementById('panel').hidden||!document.getElementById('gacha').hidden||!document.getElementById('pausep').hidden) return;
  const onl=document.getElementById('online'), rk=document.getElementById('rank'), tm=document.getElementById('team'); if((onl&&!onl.hidden)||(rk&&!rk.hidden)||(tm&&!tm.hidden)||(e.target&&/^(INPUT|TEXTAREA|BUTTON)$/.test(e.target.tagName))) return;
  if(e.repeat) return; const k=KEYS[e.key.toLowerCase()];
  if(k&&G.mode==='online'){ ensureAudio(); if(!NET.watch) press(NET.me,k[1]); }
  else if(k&&(k[0]===0||G.mode==='vs')){ ensureAudio(); press(k[0],k[1]); }
  else if(e.key==='Enter'||e.key===' '){ e.preventDefault(); advance(); }
});
document.addEventListener('touchmove',e=>{ if(!e.target.closest('#panel')&&!e.target.closest('#gacha')&&!e.target.closest('#online')&&!e.target.closest('#rank')&&!e.target.closest('#team')) e.preventDefault(); },{passive:false});
document.addEventListener('gesturestart',e=>e.preventDefault());
document.addEventListener('dblclick',e=>e.preventDefault());

/* タイトルのメニューとガチャ */
const gearEl=document.getElementById('gear'), menuEl=document.getElementById('menu'), gachaEl=document.getElementById('gacha');
let uiCache='';
function updateUI(){
  const gearOn=G.mode!=='title'&&(G.phase==='ready'||G.phase==='fight');
  const menuOn=G.phase==='title'&&gachaEl.hidden;
  const key=gearOn+'|'+menuOn+'|'+G.mode+'|'+!!ACCT+'|'+WALLET.coins+'|'+WALLET.best+'|'+JSON.stringify(ARM.owned);
  if(key===uiCache) return; uiCache=key;
  gearEl.hidden=!gearOn; gearEl.classList.toggle('mid',G.mode==='vs'); gearEl.textContent=G.mode==='vs'?'止':G.mode==='online'?'退出':'一時停止';
  document.querySelector('#pausep h2').textContent=G.mode==='online'?'退出しますか':'一時停止';
  document.getElementById('ps_resume').textContent=G.mode==='online'?'続ける（試合は止まりません）':'続ける';
  document.getElementById('ps_title').textContent=G.mode==='online'?'退出してタイトルへ':'タイトルへ戻る';
  menuEl.hidden=!menuOn;
  document.getElementById('m_meta').textContent='所持 '+WALLET.coins+' 銭・玉鋼 '+(WALLET.steel||0)+'　・　刀帳 '+KATANA.filter(k=>ARM.owned[k.id]).length+'/'+KATANA.length+'　・　CPU戦 最高 '+WALLET.best+'人抜き'+(ACCT?'　・　アカウントに保存中':'');
}
document.getElementById('m_cpu').addEventListener('click',()=>{ ensureAudio(); startMatch('cpu'); });
document.getElementById('m_vs').addEventListener('click',()=>{ ensureAudio(); startMatch('vs'); });
document.getElementById('m_gacha').addEventListener('click',()=>openGacha('pull'));
document.getElementById('m_book').addEventListener('click',()=>openGacha('book'));
document.getElementById('g_back').addEventListener('click',()=>closeGacha());

/* ---------- 刀ガチャと刀帳 ---------- */
const gcv=document.getElementById('gc'), gctx=gcv.getContext('2d');
// phase: idle 待ち / wait サーバー待ち / forge 鍛える槌 / draw 一振りずつの抜刀 / quick 持っている刀を素早く / item 一振りの札 / shown まとめ
const GA={phase:'idle',t0:0,kat:null,batch:[],idx:-1,steel:0,back:0,forge:false,silent:false,raf:0,W:0,H:0,cued:{}};
const gBusy=()=>!(GA.phase==='idle'||GA.phase==='shown');
const TORD={'並':0,'上':1,'極':2,'幻':3};
const TIERGLOW={'並':'rgba(236,230,214,','上':'rgba(120,180,255,','極':'rgba(245,196,70,','幻':null};
// 階級ごとの演出。数字はミリ秒
const TP={
  '並':{shake:0.02,d0:350,d1:1000,rev:1150,rays:0,parts:0,dark:false},
  '上':{shake:0.05,d0:500,d1:1400,rev:1650,rays:8,parts:40,dark:false},
  '極':{shake:0.09,d0:650,d1:1700,rev:2600,rays:14,parts:90,dark:true,slashes:1},
  '幻':{shake:0.14,d0:800,d1:2400,rev:4200,rays:22,parts:170,dark:true,slashes:2,promo:true}
};
function rainbow(a,now,off){ const c=hsl2rgb((now/6+(off||0))%360,0.85,0.75); return 'rgba('+(c[0]|0)+','+(c[1]|0)+','+(c[2]|0)+','+a+')'; }
function tierRGBA(t,a,now){ return t==='幻'?rainbow(a,now):TIERGLOW[t]+a+')'; }
// 幻は白→金→虹と化ける（昇格演出）
function shownTier(k,e){ if(k.tier!=='幻') return e<TP[k.tier].d0*0.8&&k.tier!=='並'?'並':k.tier; return e<1000?'並':e<1700?'極':'幻'; }
function gSize(){ const r=gcv.getBoundingClientRect(); GA.W=Math.max(200,r.width); GA.H=Math.max(120,r.height); gcv.width=Math.round(GA.W*DPR); gcv.height=Math.round(GA.H*DPR); }
function openGacha(tab){ gachaEl.hidden=false; uiCache=''; GA.phase='idle'; setTab(tab||'pull'); showSkip(); document.getElementById('g_res').hidden=true; refreshCoins(); gSize(); if(!GA.raf) GA.raf=requestAnimationFrame(gLoop); }
function closeGacha(){ gachaEl.hidden=true; uiCache=''; cancelAnimationFrame(GA.raf); GA.raf=0; }
function refreshCoins(){ document.getElementById('g_coins').textContent=WALLET.coins; document.getElementById('g_steel').textContent=WALLET.steel||0; const n=Math.floor(WALLET.coins/PULLCOST), busy=gBusy();
  document.getElementById('g_pull1').disabled=busy||n<1; const all=document.getElementById('g_all'); all.disabled=busy||n<2; all.innerHTML='全部引く　<small>'+(n>=2?n+'回・'+n*PULLCOST+'銭':'2回分から')+'</small>'; }
function setTab(t){ document.querySelectorAll('.gtabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===t));
  document.getElementById('g_pull').hidden=t!=='pull'; document.getElementById('g_book').hidden=t!=='book'; if(t==='book') renderBook(); else gSize(); }
function doPull(n){
  if(gBusy()) return;
  const msg=document.getElementById('g_msg'); n=Math.min(n,Math.floor(WALLET.coins/PULLCOST));
  if(n<1){ msg.textContent='銭が足りません。勝負に勝って銭を集めてください。'; return; }
  msg.textContent=''; ensureAudio();
  if(ACCT){ // ログイン中: くじはサーバーが引く
    GA.phase='wait'; msg.textContent='引いています…'; refreshCoins();
    ACCT.pull(n).then(r=>{ if(GA.phase!=='wait') return; msg.textContent='';
      startDraw(r.got.map(g=>{ const k=KMAP[g.id]||KMAP.mumei; return {k,isNew:!!g.new,steel:g.new?0:(g.steel!=null?g.steel:STEEL[k.tier])}; }),r.back||0); },
      e=>{ if(GA.phase==='wait') GA.phase='idle'; msg.textContent=e.message; refreshCoins(); });
    return;
  }
  const batch=[]; let back=0;
  for(let i=0;i<n;i++){ WALLET.coins-=PULLCOST; const k=rollKatana(); const had=ARM.owned[k.id]||0; ARM.owned[k.id]=had+1; const st=had?STEEL[k.tier]:0; WALLET.steel=(WALLET.steel||0)+st; batch.push({k,isNew:!had,steel:st}); }
  saveWallet(); saveArm();
  startDraw(batch,back);
}
/* 引いた順に一振りずつ見せる。初めての刀はそこで止めて階級の演出、持っている刀は素早く流して玉鋼に */
function startDraw(batch,back,forge){
  GA.batch=batch; GA.idx=-1; GA.back=back||0; GA.steel=batch.reduce((s,b)=>s+(b.steel||0),0); GA.forge=!!forge;
  document.getElementById('g_res').hidden=true;
  if(forge){ GA.idx=0; GA.kat=batch[0].k; GA.isNew=true; GA.phase='forge'; GA.t0=performance.now(); GA.cued={}; GA.silent=false; refreshCoins(); showSkip(); return; }
  nextItem();
}
const QUICK={'並':480,'上':640,'極':900,'幻':1150};
function itemFull(b){ return b.isNew||GA.batch.length===1; }
function beginItem(){ const b=GA.batch[GA.idx]; GA.kat=b.k; GA.isNew=b.isNew; GA.t0=performance.now(); GA.cued={}; GA.silent=false;
  GA.phase=itemFull(b)?'draw':'quick'; GA.qdur=QUICK[b.k.tier]*(GA.batch.length>30?0.6:1); }
function nextItem(){
  document.getElementById('g_res').hidden=true;
  GA.idx++;
  if(GA.idx>=GA.batch.length){ if(GA.batch.length>1) showSummary(); else { GA.phase='idle'; refreshCoins(); } showSkip(); return; }
  beginItem(); refreshCoins(); showSkip();
}
// 飛ばす: 次の初めての刀まで進む（なければまとめへ）
function skipAhead(){
  if(!(GA.phase==='draw'||GA.phase==='quick'||GA.phase==='item')||GA.batch.length<2) return;
  document.getElementById('g_res').hidden=true;
  let j=GA.idx+1; while(j<GA.batch.length&&!GA.batch[j].isNew) j++;
  GA.idx=j; if(j>=GA.batch.length){ showSummary(); showSkip(); return; }
  beginItem(); refreshCoins(); showSkip();
}
function showSkip(){ const b=document.getElementById('g_skip'); const left=GA.batch.length>1&&(GA.phase==='draw'||GA.phase==='quick'||GA.phase==='item')&&GA.idx<GA.batch.length-1;
  b.hidden=!left; }
function fillCard(k){ const f=document.getElementById('g_res'); f.className='gres t'+TORD[k.tier];
  const rt=document.getElementById('g_rt'); rt.hidden=false; rt.textContent=k.tier; rt.style.background=TIER[k.tier];
  document.getElementById('g_rm').textContent=k.mei; document.getElementById('g_ry').textContent=k.yomi;
  document.getElementById('g_rl').textContent=k.lore; return f; }
function showItem(){
  const b=GA.batch[GA.idx], n=GA.batch.length, f=fillCard(b.k);
  document.getElementById('g_rdup').textContent=GA.forge?'玉鋼で鍛えた一振り。':b.isNew?'初めて手に入れた一振り。':'すでに持っている一振り。'+(b.steel?'　玉鋼 +'+b.steel:'');
  document.getElementById('g_batch').hidden=true;
  const last=GA.idx>=n-1;
  document.getElementById('g_tap').textContent=n>1?(last?'触れてまとめへ':'触れて次へ')+'　'+(GA.idx+1)+' / '+n:'触れて閉じる';
  f.hidden=false; GA.phase='item'; refreshCoins(); showSkip();
}
function showSummary(){
  const n=GA.batch.length, news=GA.batch.filter(b=>b.isNew).length;
  let best=GA.batch[0]; GA.batch.forEach(b=>{ if(TORD[b.k.tier]>TORD[best.k.tier]||(TORD[b.k.tier]===TORD[best.k.tier]&&b.isNew&&!best.isNew)) best=b; });
  // 舞台には一番よい刀を抜いたまま置いておく（音は鳴らさない）
  GA.kat=best.k; GA.isNew=best.isNew; GA.silent=true; GA.t0=performance.now()-TP[best.k.tier].rev-1500;
  const f=document.getElementById('g_res'); f.className='gres sum';
  document.getElementById('g_rt').hidden=true;
  document.getElementById('g_rm').textContent=n+'振り';
  document.getElementById('g_ry').textContent='引いた順';
  document.getElementById('g_rl').textContent='';
  document.getElementById('g_rdup').textContent='新しい刀 '+news+'振り'+(GA.steel?'　玉鋼 +'+GA.steel:'')+(GA.back?'　銭 +'+GA.back:'');
  const bl=document.getElementById('g_batch');
  bl.innerHTML=GA.batch.map(b=>'<span class="bc t'+TORD[b.k.tier]+(b.isNew?' nw':'')+'"><i style="background:'+TIER[b.k.tier]+'">'+b.k.tier+'</i>'+b.k.mei+(b.isNew?'<em>新</em>':'')+'</span>').join(''); bl.hidden=false;
  document.getElementById('g_tap').textContent='触れて閉じる';
  f.hidden=false; GA.phase='shown'; refreshCoins();
}
function drawKatanaAt(c,img,cx,cy,kw){ const kh=kw*KIMG_H/KIMG_W; c.drawImage(img,cx-kw/2,cy-kh/2,kw,kh); }
function gLoop(){
  GA.raf=requestAnimationFrame(gLoop);
  if(gachaEl.hidden||document.getElementById('g_pull').hidden) return;
  const c=gctx, W=GA.W, H=GA.H, now=performance.now(); c.setTransform(DPR,0,0,DPR,0,0);
  c.fillStyle='#0f100d'; c.fillRect(0,0,W,H);
  const vg=c.createRadialGradient(W/2,H*0.55,0,W/2,H*0.55,W*0.6); vg.addColorStop(0,'rgba(60,62,50,0.35)'); vg.addColorStop(1,'rgba(0,0,0,0)'); c.fillStyle=vg; c.fillRect(0,0,W,H);
  const kw=Math.min(W*0.8,H*5.6), kh=kw*KIMG_H/KIMG_W, cx=W/2, cy=H*0.5, left=cx-kw/2, mouth0=left+kw*0.262, sayaL=kw*0.75;
  const drawSaya=(m,alpha)=>{ c.save(); c.globalAlpha=alpha; c.fillStyle='#16120f'; c.strokeStyle='rgba(233,226,207,0.18)'; c.lineWidth=1;
    c.beginPath(); c.moveTo(m,cy-kh*0.2); c.lineTo(m+sayaL,cy-kh*0.12); c.quadraticCurveTo(m+sayaL+kh*0.3,cy,m+sayaL,cy+kh*0.14); c.lineTo(m,cy+kh*0.22); c.closePath(); c.fill(); c.stroke();
    c.fillStyle='rgba(233,226,207,0.08)'; c.fillRect(m+sayaL*0.2,cy-kh*0.16,sayaL*0.6,kh*0.05); c.restore(); };
  if(GA.phase==='idle'||GA.phase==='wait'){
    const k=KMAP[ARM.equip[0]]||KMAP.mumei; if(KREADY){ c.save(); c.globalAlpha=0.5+0.1*Math.sin(now/700); c.beginPath(); c.rect(0,0,mouth0,H); c.clip(); drawKatanaAt(c,k.shadow,cx,cy,kw); c.restore(); }
    drawSaya(mouth0,1);
    txt(c,'鞘に手をかける',cx,H*0.86,Math.max(11,H*0.055),UIF,'rgba(233,226,207,0.4)','center');
    return;
  }
  // 玉鋼で鍛える: 槌を三度打ち、火の粉が散ってから抜刀へ
  if(GA.phase==='forge'){
    const e=now-GA.t0, HIT=[250,720,1180], END=1750;
    HIT.forEach((t,i)=>{ if(e>=t&&!GA.cued['h'+i]){ GA.cued['h'+i]=1; sfx('clash'); if(i===2) sfx('drum'); } });
    const heat=clamp(e/1300)*(1-clamp((e-1450)/300));
    txt(c,'鍛',cx,cy,H*0.85,DISPLAY,'rgba(233,226,207,'+(0.05+0.06*heat)+')','center');
    const gr=c.createRadialGradient(cx,cy,0,cx,cy,kw*0.5); gr.addColorStop(0,'rgba(255,120,40,'+(0.35*heat)+')'); gr.addColorStop(1,'rgba(255,80,20,0)'); c.fillStyle=gr; c.fillRect(0,0,W,H);
    if(KREADY){ c.save(); c.globalAlpha=0.25+0.6*heat; c.shadowColor='rgba(255,110,30,1)'; c.shadowBlur=18*heat; drawKatanaAt(c,FORGEBAR(),cx,cy,kw); c.restore(); }
    c.save(); c.globalCompositeOperation='lighter';
    HIT.forEach((t,i)=>{ const d=e-t; if(d<0||d>700) return; const r=mulberry32(31+i), hx=cx+kw*(0.05*i-0.05);
      if(d<240){ c.fillStyle='rgba(255,236,200,'+(0.5*(1-d/240))+')'; c.fillRect(0,0,W,H); }
      for(let j=0;j<46;j++){ const an=-Math.PI*(0.1+0.8*r()), sp=(0.25+r()*0.75)*H*1.6, tt=d/1000, life=1-d/700;
        const x=hx+Math.cos(an)*sp*tt*(r()<0.5?-1:1), y=cy+Math.sin(an)*sp*tt+H*1.4*tt*tt;
        c.fillStyle='rgba(255,'+(150+(r()*90|0))+',60,'+life+')'; c.fillRect(x,y,1.6+r()*1.6,1.6+r()*1.6); } });
    c.restore();
    txt(c,'玉鋼を鍛える',cx,H*0.86,Math.max(11,H*0.055),UIF,'rgba(233,226,207,'+(0.5*clamp(e/400))+')','center');
    if(e>=END){ GA.phase='draw'; GA.t0=now; GA.cued={}; }
    return;
  }
  // 持っている刀: 素早く抜いて見せ、玉鋼に変える
  if(GA.phase==='quick'){
    const b=GA.batch[GA.idx], k=b.k, ord=TORD[k.tier], e=now-GA.t0, D=GA.qdur, sl=D*0.35;
    if(e>=sl*0.8&&!GA.cued.q){ GA.cued.q=1; sfx('clack'); if(ord>=2) sfx('chime'); }
    const u=ease(clamp(e/sl)), mouth=mouth0+u*(kw*0.76+40), out=e>=sl;
    if(ord>=1){ const a=clamp((e-sl*0.6)/200); const gr=c.createRadialGradient(cx,cy,0,cx,cy,kw*(0.35+0.08*ord)); gr.addColorStop(0,tierRGBA(k.tier,(0.12+0.08*ord)*a,now)); gr.addColorStop(1,tierRGBA(k.tier,0,now)); c.fillStyle=gr; c.fillRect(0,0,W,H); }
    if(KREADY){ c.save(); if(!out){ c.beginPath(); c.rect(0,0,mouth,H); c.clip(); }
      if(ord>=1&&out){ c.shadowColor=tierRGBA(k.tier,0.8,now); c.shadowBlur=8+ord*6; }
      drawKatanaAt(c,k.canvas,cx,cy,kw); c.restore(); }
    if(!out||e<sl+150) drawSaya(mouth,1-clamp((e-sl)/150));
    if(ord>=2&&e>sl&&e<sl+220){ c.fillStyle=tierRGBA(k.tier,0.25*(1-(e-sl)/220),now); c.fillRect(0,0,W,H); }
    const ta=clamp((e-sl)/160);
    txt(c,k.mei,cx,H*0.16,Math.max(14,H*0.085),DISPLAY,k.tier==='幻'?rainbow(ta,now):tierRGBA(k.tier,ta,now),'center');
    txt(c,'所持　玉鋼 +'+b.steel,cx,H*0.86,Math.max(11,H*0.055),UIF,'rgba(232,195,90,'+(0.85*ta)+')','center');
    drawStrip(c,W,H);
    if(e>=D) nextItem();
    return;
  }
  const k=GA.kat, tp=TP[k.tier], e=now-GA.t0, ord=TORD[k.tier];
  const cue=(n,ms,fn)=>{ if(!GA.silent&&e>=ms&&!GA.cued[n]){ GA.cued[n]=1; fn(); } };
  cue('koi',0,()=>sfx('koi'));
  cue('slash',tp.d0,()=>sfx('slash'));
  if(ord>=1) cue('chime',tp.d0+200,()=>sfx('chime'));
  if(tp.promo){ cue('p1',1000,()=>{ sfx('clash'); }); cue('p2',1700,()=>{ sfx('clash'); sfx('chime'); }); }
  if(tp.dark){ cue('drum',tp.d1,()=>sfx('drum')); cue('gong',tp.rev,()=>sfx('gong')); }
  if(k.tier==='幻') cue('gong2',tp.rev+600,()=>sfx('gong'));
  const st=shownTier(k,e);
  // 揺れ
  const shk=e<tp.d0?tp.shake*kh*(e/tp.d0)*(Math.random()-0.5)*2:0;
  const u=ease(clamp((e-tp.d0)/(tp.d1-tp.d0))), mouth=mouth0+u*(kw*0.76+40);
  const glowA=clamp((e-tp.d0*0.5)/500);
  const revealed=e>=tp.rev, re=e-tp.rev;
  // 背景の後光
  if(!revealed&&e>tp.d0*0.5){ const gr=c.createRadialGradient(mouth,cy,0,mouth,cy,kw*(0.25+0.12*ord)); gr.addColorStop(0,tierRGBA(st,0.5*glowA,now)); gr.addColorStop(1,tierRGBA(st,0,now)); c.fillStyle=gr; c.fillRect(0,0,W,H); }
  if(revealed&&ord>=1){
    const a=clamp(re/500);
    const gr=c.createRadialGradient(cx,cy,0,cx,cy,kw*(0.45+0.12*ord)); gr.addColorStop(0,tierRGBA(k.tier,(0.25+0.12*ord)*a,now)); gr.addColorStop(1,tierRGBA(k.tier,0,now)); c.fillStyle=gr; c.fillRect(0,0,W,H);
    c.save(); c.globalCompositeOperation='lighter'; const n=tp.rays, rot=now/(k.tier==='幻'?3000:6000);
    for(let i=0;i<n;i++){ const an=rot+i*Math.PI*2/n; c.fillStyle=k.tier==='幻'?rainbow(0.09*a,now,i*30):tierRGBA(k.tier,0.07*a,now); c.beginPath(); c.moveTo(cx,cy); c.arc(cx,cy,Math.max(W,H),an,an+Math.PI/n*0.55); c.closePath(); c.fill(); }
    c.restore();
    if(k.tier==='幻'){ txt(c,'幻',cx,cy,H*0.9,DISPLAY,rainbow(0.12*a,now,180),'center'); }
  }
  // 漂う光の粒
  if(revealed&&tp.parts){ const r=mulberry32(5+ord); c.save(); c.globalCompositeOperation='lighter';
    for(let i=0;i<tp.parts;i++){ const sp=0.03+r()*0.08, ph=r(), x=r()*W+Math.sin(now/900+i)*8, y=H-((re/1000*sp*H*2.2+ph*H*1.2)%(H*1.2)), s=0.6+r()*(1+ord*0.6);
      const al=(0.35+0.4*Math.sin(now/200+i))*clamp(re/400); c.fillStyle=tierRGBA(k.tier,Math.max(0,al),now+i*40); c.beginPath(); c.arc(x,y,s,0,7); c.fill(); }
    c.restore(); }
  // 刀
  if(KREADY){ c.save(); c.translate(0,shk); if(!revealed){ c.beginPath(); c.rect(0,0,mouth,H); c.clip(); }
    const sc=revealed&&ord>=2?1+0.04*ease(clamp(re/600)):1;
    c.translate(cx,cy); c.scale(sc,sc); c.translate(-cx,-cy);
    if(revealed&&ord>=1){ c.save(); c.shadowColor=tierRGBA(k.tier,0.9,now); c.shadowBlur=12+ord*10; drawKatanaAt(c,k.canvas,cx,cy,kw); c.restore(); }
    else drawKatanaAt(c,k.canvas,cx,cy,kw);
    if(e>tp.d0&&(!revealed||re<500)){ c.globalCompositeOperation='lighter'; c.globalAlpha=0.65*glowA*(revealed?1-re/500:1); drawKatanaAt(c,tintCanvasCached(KMAP[k.id],st),cx,cy,kw); }
    c.restore(); }
  if(!revealed&&e<tp.d1+300) drawSaya(mouth,1-clamp((e-tp.d1)/300));
  // 抜けた瞬間の光（上以上）
  if(ord>=1&&e>tp.d1-80&&e<tp.d1+300){ const a=1-Math.abs(e-tp.d1)/300; c.fillStyle=tierRGBA(st,0.35*a,now); c.fillRect(0,0,W,H); }
  // 極・幻：暗転して一閃
  if(tp.dark&&e>tp.d1&&!revealed||(tp.dark&&revealed&&re<500)){
    const d=e-tp.d1, span=tp.rev-tp.d1; const dark=d<150?d/150*0.95:d<span?0.95:0.95*(1-clamp((d-span)/500));
    c.fillStyle='rgba(3,3,2,'+dark+')'; c.fillRect(0,0,W,H);
    const sst=k.slash;
    const sl=(t0,x0,y0,x1,y1)=>{ if(d<t0) return; const su=ease(clamp((d-t0)/220)), life=1-clamp((d-t0-350)/600); if(life<=0) return;
      c.save(); c.shadowColor=sst.glow||'#fff'; c.shadowBlur=24; c.fillStyle=sst.rainbow?rainbow(1,now):(sst.col||'#fff');
      const xx=lerp(x0,x1,su), yy=lerp(y0,y1,su), L=Math.hypot(xx-x0,yy-y0)||1, nx=-(yy-y0)/L, ny=(xx-x0)/L, w=Math.max(2,H*0.03)*life;
      c.beginPath(); c.moveTo(x0,y0); c.lineTo(xx+nx*w/2,yy+ny*w/2); c.lineTo(xx-nx*w/2,yy-ny*w/2); c.closePath(); c.fill(); c.restore(); };
    if(tp.slashes===1){ sl(150,-20,cy-kh*1.2,W+20,cy-kh*0.6); }
    else { sl(150,-20,H*0.1,W+20,H*0.9); sl(450,W+20,H*0.1,-20,H*0.9); sl(800,-20,cy,W+20,cy); }
    const fl=k.tier==='幻'?[[370,0.7],[670,0.7],[1020,1]]:[[370,0.8]];
    for(const [t,a0] of fl){ if(d>t&&d<t+400){ c.fillStyle=(k.tier==='幻'?rainbow(a0*(1-(d-t)/400),now):'rgba(255,250,235,'+(a0*(1-(d-t)/400))+')'); c.fillRect(0,0,W,H); } }
    if(k.tier==='幻'&&d>1100&&d<span){ const a=clamp((d-1100)/300); txt(c,'幻',cx,cy,H*0.55,DISPLAY,'rgba(255,255,255,'+(0.85*a)+')','center'); }
  }
  // 名乗り
  if(revealed&&ord>=2){ const a=clamp((re-300)/500); txt(c,k.mei,cx,H*0.14,H*(ord===3?0.13:0.1),DISPLAY,k.tier==='幻'?rainbow(a,now):tierRGBA(k.tier,a,now),'center'); }
  drawStrip(c,W,H);
  if(revealed&&GA.phase==='draw') showItem();
}
// 何振り目か（10連などのとき、上に小さく並べる。新しい刀は明るく）
function drawStrip(c,W,H){
  const n=GA.batch.length; if(n<2||GA.phase==='shown') return;
  const fs=Math.max(10,H*0.045);
  txt(c,(GA.idx+1)+' / '+n,W-10,fs*0.9,fs,UIF,'rgba(233,226,207,0.55)','right');
  if(n>60) return;
  const sz=Math.max(3,Math.min(9,(W*0.7)/n-3)), gap=Math.min(4,sz*0.5), tw=n*sz+(n-1)*gap, x0=(W-tw)/2, y=fs*0.9-sz/2+fs*1.1;
  for(let i=0;i<n;i++){ const b=GA.batch[i], x=x0+i*(sz+gap);
    if(i<GA.idx||(i===GA.idx&&GA.phase!=='draw')){ c.globalAlpha=b.isNew?1:0.4; c.fillStyle=TIER[b.k.tier]; c.fillRect(x,y,sz,sz); c.globalAlpha=1; }
    else { c.strokeStyle='rgba(233,226,207,'+(i===GA.idx?0.8:0.2)+')'; c.lineWidth=1; c.strokeRect(x+0.5,y+0.5,sz-1,sz-1); } }
}
let FBAR=null; function FORGEBAR(){ return FBAR||(FBAR=tintCanvas(KMAP.mumei.canvas,'#ff8a3a')); }
const TINTC={}; function tintCanvasCached(k,t){ const key=k.id+t; return TINTC[key]||(TINTC[key]=tintCanvas(k.canvas,t==='幻'?'#f3e6ff':(TIERGLOW[t]+'1)'))); }
function renderBook(){
  const grid=document.getElementById('g_grid'); grid.innerHTML='';
  const got=KATANA.filter(k=>ARM.owned[k.id]).length;
  document.getElementById('g_count').innerHTML='集めた刀　'+got+' / '+KATANA.length+'<small>玉鋼 <b>'+(WALLET.steel||0)+'</b>　まだ持っていない刀に触れると、玉鋼で鍛えられます</small>';
  KATANA.map((k,i)=>[k,i]).sort((a,b)=>TORD[a[0].tier]-TORD[b[0].tier]||a[1]-b[1]).forEach(([k])=>{ const own=!!ARM.owned[k.id];
    const b=document.createElement('button'); b.type='button'; b.className='gcard t'+TORD[k.tier]+(own?'':' unk');
    const cvs=document.createElement('canvas'); cvs.width=420; cvs.height=Math.round(420*KIMG_H/KIMG_W)+8;
    const x=cvs.getContext('2d'); if(KREADY) x.drawImage(own?k.canvas:k.shadow,0,4,420,420*KIMG_H/KIMG_W);
    const eq=[0,1].filter(i=>ARM.equip[i]===k.id).map(i=>'<i style="background:'+COL[i].main+'">'+COL[i].name+'</i>').join('');
    b.innerHTML='<span class="ct" style="background:'+TIER[k.tier]+'">'+k.tier+'</span><span class="cm">'+(own?k.mei:'？？？')+'</span><span class="ce">'+eq+'</span>';
    b.insertBefore(cvs,b.firstChild);
    b.addEventListener('click',()=>openDetail(k));
    grid.appendChild(b); });
}
let DETAIL=null;
function openDetail(k){
  DETAIL=k; FORGEARM=0; const own=!!ARM.owned[k.id]; const d=document.getElementById('g_detail'); d.hidden=false; d.querySelector('.gdsheet').className='gdsheet t'+TORD[k.tier]+(own?'':' unk');
  const cvs=document.getElementById('gd_img'); const x=cvs.getContext('2d'); x.clearRect(0,0,cvs.width,cvs.height); if(KREADY) x.drawImage(own?k.canvas:k.shadow,0,0,cvs.width,cvs.width*KIMG_H/KIMG_W);
  document.getElementById('gd_t').textContent=k.tier; document.getElementById('gd_t').style.background=TIER[k.tier];
  document.getElementById('gd_m').textContent=k.mei; document.getElementById('gd_y').textContent=k.yomi+'　・　'+(own?(ARM.owned[k.id]||0)+'振り所持':'まだ持っていない');
  document.getElementById('gd_l').textContent=own?k.lore:'まだ見ぬ一振り。姿は鍛えあがるまでわからない。';
  document.getElementById('gd_own').hidden=!own; document.getElementById('gd_fg').hidden=own;
  if(!own){ forgeLabel(); return; }
  const rec=ARM.rec[k.id]||{}; const names=Object.keys(rec).sort((a,b)=>rec[b]-rec[a]);
  document.getElementById('gd_rec').innerHTML=names.length?names.map(n=>'<li><span class="rt" style="color:'+TIER[FIN[n].tier]+'">'+FIN[n].tier+'</span>'+n+'<b>'+rec[n]+'</b></li>').join(''):'<li class="none">まだこの刀で勝っていません</li>';
  [0,1].forEach(i=>{ const btn=document.getElementById('gd_e'+i); const on=ARM.equip[i]===k.id; btn.textContent=on?COL[i].name+'が持っています':COL[i].name+'に持たせる'; btn.disabled=on; });
}
document.getElementById('gd_e0').addEventListener('click',()=>{ ARM.equip[0]=DETAIL.id; saveArm(); if(ACCT) ACCT.equip(ARM.equip); openDetail(DETAIL); renderBook(); });
document.getElementById('gd_e1').addEventListener('click',()=>{ ARM.equip[1]=DETAIL.id; saveArm(); if(ACCT) ACCT.equip(ARM.equip); openDetail(DETAIL); renderBook(); });
document.getElementById('gd_close').addEventListener('click',()=>{ document.getElementById('g_detail').hidden=true; });
/* 玉鋼で鍛える（まだ持っていない刀だけ）。間違えて押さないよう、二度触れて鍛える */
let FORGEARM=0;
function forgeLabel(msg){ const k=DETAIL, cost=FORGE[k.tier], have=WALLET.steel||0, btn=document.getElementById('gd_forge');
  btn.disabled=have<cost||FORGEARM===2;
  btn.innerHTML=FORGEARM===2?'鍛えています…':FORGEARM===1?'もう一度触れて鍛える':'鍛える　<small>玉鋼 '+cost+'</small>';
  btn.classList.toggle('arm',FORGEARM===1);
  document.getElementById('gd_fn').textContent=msg||(have<cost?'玉鋼が足りません（所持 '+have+'・あと '+(cost-have)+'）。持っている刀がガチャで出ると玉鋼になります。':'所持 '+have+' → 鍛えると '+(have-cost)); }
function doForge(){
  const k=DETAIL; if(!k||ARM.owned[k.id]||gBusy()) return;
  const cost=FORGE[k.tier]; if((WALLET.steel||0)<cost){ forgeLabel(); return; }
  if(FORGEARM===0){ FORGEARM=1; forgeLabel(); setTimeout(()=>{ if(FORGEARM===1&&DETAIL===k){ FORGEARM=0; forgeLabel(); } },3000); return; }
  if(FORGEARM!==1) return;
  ensureAudio();
  const go=()=>{ document.getElementById('g_detail').hidden=true; FORGEARM=0; setTab('pull'); startDraw([{k,isNew:true,steel:0}],0,true); };
  if(ACCT){ FORGEARM=2; forgeLabel();
    ACCT.forge(k.id).then(()=>{ if(DETAIL===k) go(); else FORGEARM=0; }, e=>{ FORGEARM=0; if(DETAIL===k) forgeLabel(e.message); });
    return; }
  WALLET.steel-=cost; ARM.owned[k.id]=1; saveWallet(); saveArm(); go();
}
document.getElementById('gd_forge').addEventListener('click',doForge);
document.getElementById('g_skip').addEventListener('click',skipAhead);
document.querySelectorAll('.gtabs button').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
document.getElementById('g_pull1').addEventListener('click',()=>doPull(1));
document.getElementById('g_all').addEventListener('click',()=>doPull(Infinity));
document.getElementById('g_res').addEventListener('click',()=>{ if(GA.phase==='item'){ nextItem(); return; } document.getElementById('g_res').hidden=true; GA.phase='idle'; refreshCoins(); });
window.addEventListener('resize',()=>{ if(!gachaEl.hidden) gSize(); });

/* ---------- 調整パネル ---------- */
const panel=document.getElementById('panel'), rows=document.getElementById('rows');
SPEC.forEach(([key,label,unit,min,max,step,note])=>{
  const r=document.createElement('div'); r.className='row';
  r.innerHTML='<label for="s_'+key+'">'+label+'</label><span class="val" id="v_'+key+'"></span><input type="range" id="s_'+key+'" min="'+min+'" max="'+max+'" step="'+step+'">'+(note?'<div class="note">'+note+'</div>':'');
  rows.appendChild(r);
  const inp=r.querySelector('input');
  inp.addEventListener('input',()=>{ CFG[key]=+inp.value; syncPanel(); saveCfg(); });
});
function syncPanel(){
  SPEC.forEach(([key,label,unit])=>{ document.getElementById('s_'+key).value=CFG[key];
    document.getElementById('v_'+key).textContent=CFG[key]+' '+unit+(CFG[key]===DEF[key]?'（初期値）':''); });
  document.getElementById('p_text').value='一閃の調整値: '+SPEC.map(([key,label,unit])=>label+' '+CFG[key]+unit).join('、');
  document.getElementById('c_gauges').checked=CFG.gauges; document.getElementById('c_sound').checked=CFG.sound;
}
document.getElementById('p_copy').addEventListener('click',()=>{
  const ta=document.getElementById('p_text'), msg=document.getElementById('p_copied');
  const fallback=()=>{ ta.focus(); ta.select(); try{ document.execCommand('copy'); msg.textContent='選択しました。コピーできていなければ長押しでコピーしてください'; }catch(e){ msg.textContent='長押しでコピーしてください'; } };
  try{ navigator.clipboard.writeText(ta.value).then(()=>{ msg.textContent='コピーしました'; },fallback); }catch(e){ fallback(); }
});
document.getElementById('c_gauges').addEventListener('change',e=>{ CFG.gauges=e.target.checked; saveCfg(); });
document.getElementById('c_sound').addEventListener('change',e=>{ CFG.sound=e.target.checked; saveCfg(); });
const pauseEl=document.getElementById('pausep');
document.getElementById('gear').addEventListener('click',()=>{ document.getElementById('ps_sound').checked=CFG.sound; document.getElementById('ps_net').checked=!!CFG.netInfo; pauseEl.hidden=false; pause('panel',true); });
document.getElementById('ps_resume').addEventListener('click',()=>{ pauseEl.hidden=true; pause('panel',false); });
document.getElementById('ps_title').addEventListener('click',()=>{ pauseEl.hidden=true; pause('panel',false); goTitle(); });
document.getElementById('ps_sound').addEventListener('change',e=>{ CFG.sound=e.target.checked; saveCfg(); });
document.getElementById('ps_net').addEventListener('change',e=>{ CFG.netInfo=e.target.checked; saveCfg(); });
document.getElementById('p_close').addEventListener('click',()=>{ panel.hidden=true; pause('panel',false); });
document.getElementById('p_restart').addEventListener('click',()=>{ panel.hidden=true; pause('panel',false); goTitle(); });
document.getElementById('p_reset').addEventListener('click',()=>{ Object.assign(CFG,DEF); saveCfg(); syncPanel(); });
panel.addEventListener('pointerdown',e=>{ if(e.target===panel){ panel.hidden=true; pause('panel',false); } });

/* ---------- 向き ---------- */
let rotateOk=false;
function checkRotate(){ const show=!rotateOk&&SH>SW; document.getElementById('rotate').hidden=!show; pause('rotate',show); }
document.getElementById('r_ok').addEventListener('click',()=>{ rotateOk=true; checkRotate(); });
document.addEventListener('visibilitychange',()=>pause('hidden',document.hidden));

window.addEventListener('resize',resize);
if(window.ResizeObserver) new ResizeObserver(()=>resize()).observe(cv);
if(window.visualViewport) visualViewport.addEventListener('resize',resize);
setInterval(resize,1000);
resize();
requestAnimationFrame(frame);

// v1.0.6: 効果音はこのファイル内に内蔵されています。audioフォルダは不要です。
'use strict';

const COLORS=['#b8493f','#315f8c','#668447','#8a5b91'];
const SLEEVES=['#8f3b32','#244f78','#56743e','#704875'];
const NAME_POOL=['たかし','みき','けんじ','ゆうこ','まさる','あきら','なおこ','みどり','しょうた','あや'];
const RANKS=['歩','と','香','成香','桂','成桂','銀','成銀','角','馬','飛','龍','王'];
const CORNERS=[0,8,16,24];
const WAR_DELTA={2:[1,-1],3:[2,0,-2],4:[2,1,-1,-2]};

const board=document.querySelector('#board');
const hand=document.querySelector('#hand');
const eventBox=document.querySelector('#event');
const warShade=document.querySelector('#warShade');
const roller=document.querySelector('#roller');
const rollerHint=document.querySelector('#rollerHint');
const turnBox=document.querySelector('#turnBox');
const rollButton=document.querySelector('#rollButton');
const audioButton=document.querySelector('#audioButton');
const resultEl=document.querySelector('#result');
const battleGauge=document.querySelector('#battleGauge');
const battleGaugeMarker=document.querySelector('#battleGaugeMarker');
const logEl=document.querySelector('#log');
const rulesButton=document.querySelector('#rulesButton');
const rulesModal=document.querySelector('#rulesModal');
const rulesClose=document.querySelector('#rulesClose');

const environmentAudio=new Audio('audio/kankyouon.m4a');
environmentAudio.loop=true;
environmentAudio.preload='auto';
environmentAudio.playsInline=true;
environmentAudio.volume=.52;

let players=[];
let turnIndex=0;
let running=false;
let busy=false;
let war=null;
let audioContext=null;
let gesture={
  active:false,cx:0,cy:0,last:0,total:0,lastSoundAt:0,
  gaugePos:.08,gaugeDir:1,gaugeLastFrame:0,gaugeRaf:null
};

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function log(text){const el=document.createElement('div');el.textContent=text;logEl.appendChild(el);logEl.scrollTop=logEl.scrollHeight;}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}

function ringCoords(){
  const a=[];
  for(let c=0;c<9;c++)a.push([0,c]);
  for(let r=1;r<9;r++)a.push([r,8]);
  for(let c=7;c>=0;c--)a.push([8,c]);
  for(let r=7;r>=1;r--)a.push([r,0]);
  return a;
}
const COORDS=ringCoords();

function makeBoard(){
  board.querySelectorAll('.cell').forEach(el=>el.remove());
  for(let r=0;r<9;r++)for(let c=0;c<9;c++){
    const cell=document.createElement('div');
    cell.className='cell';
    cell.style.left=`${c*100/9}%`;cell.style.top=`${r*100/9}%`;
    cell.style.width=`${100/9}%`;cell.style.height=`${100/9}%`;
    board.insertBefore(cell,warShade);
  }
}

function posStyle(pos,offset=[0,0]){
  const [r,c]=COORDS[(pos+32)%32];
  return {left:`${(c+.5)*100/9+offset[0]}%`,top:`${(r+.5)*100/9+offset[1]}%`};
}
function directionFor(pos){const p=(pos+32)%32;if(p<8)return 90;if(p<16)return 180;if(p<24)return 270;return 0;}
function isCorner(pos){return CORNERS.includes((pos+32)%32);}
function offsetFor(index,count){
  const patterns={1:[[0,0]],2:[[-2.3,0],[2.3,0]],3:[[-2.4,1.4],[0,-2],[2.4,1.4]],4:[[-2.3,-1.7],[2.3,-1.7],[-2.3,1.7],[2.3,1.7]]};
  return (patterns[count]||patterns[4])[index]||[0,0];
}



let audioEnabled=false;

async function ensureAudio(){
  try{
    if(!audioContext)audioContext=new (window.AudioContext||window.webkitAudioContext)();
    if(audioContext.state!=='running')await audioContext.resume();
    audioEnabled=audioContext.state==='running';

    if(audioEnabled){
      environmentAudio.volume=war?.active?.18:.52;
      if(environmentAudio.paused){
        await environmentAudio.play();
      }
      audioButton.classList.remove('show');
    }else{
      audioButton.classList.add('show');
    }
    return audioEnabled;
  }catch(_){
    audioEnabled=false;
    audioButton.classList.add('show');
    return false;
  }
}

function tone(freq,duration=.04,volume=.025,type='triangle',delay=0){
  if(!audioContext||audioContext.state!=='running')return;
  const start=audioContext.currentTime+delay;
  const osc=audioContext.createOscillator();
  const gain=audioContext.createGain();
  osc.type=type;
  osc.frequency.setValueAtTime(freq,start);
  gain.gain.setValueAtTime(Math.max(volume,.0001),start);
  gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
  osc.connect(gain);
  gain.connect(audioContext.destination);
  osc.start(start);
  osc.stop(start+duration+.01);
}

function woodStep(){
  // 初期版の、丸く短い「コト」
  const base=170+Math.random()*70;
  tone(base,.055,.225,'triangle');
  setTimeout(()=>tone(base*.62,.07,.135,'sine'),22);
}

function woodRollTick(speed=0.5){
  // 初期版の音量・音色・ランダム感
  const now=performance.now();
  const minGap=clamp(260-speed*150,105,260);
  if(now-gesture.lastSoundAt<minGap)return;
  gesture.lastSoundAt=now;
  const variants=[145,165,185,205];
  const base=variants[Math.floor(Math.random()*variants.length)];
  tone(base,.06,.162+Math.random()*.063,'triangle');
  if(Math.random()<.45){
    setTimeout(()=>tone(base*.7,.055,.099,'sine'),28);
  }
}

function clack(){
  woodStep();
}

function thud(){
  tone(105,.11,.405,'triangle');
  setTimeout(()=>tone(72,.12,.162,'sine'),28);
}

function whoosh(){
  tone(350,.07,.135,'triangle');
  setTimeout(()=>tone(220,.10,.108,'sine'),45);
}

async function fadeEnvironment(target,ms=320){
  const start=environmentAudio.volume;
  const steps=10;
  for(let i=1;i<=steps;i++){
    environmentAudio.volume=start+(target-start)*(i/steps);
    await sleep(ms/steps);
  }
}
async function enterWarSound(){
  if(audioEnabled&&!environmentAudio.paused)await fadeEnvironment(.18,260);
}
async function leaveWarSound(){
  if(audioEnabled){
    if(environmentAudio.paused)environmentAudio.play().catch(()=>audioButton.classList.add('show'));
    await fadeEnvironment(.52,420);
  }
}

function startBattleGauge(){
  cancelAnimationFrame(gesture.gaugeRaf);
  gesture.gaugePos=.05+Math.random()*.15;
  gesture.gaugeDir=Math.random()<.5?1:-1;
  gesture.gaugeLastFrame=0;
  battleGaugeMarker.style.left=`${gesture.gaugePos*100}%`;
  gesture.gaugeRaf=requestAnimationFrame(updateBattleGauge);
}
function stopBattleGauge(){
  cancelAnimationFrame(gesture.gaugeRaf);
  gesture.gaugeRaf=null;
}
function updateBattleGauge(ts){
  if(!gesture.active||!war)return;
  if(!gesture.gaugeLastFrame)gesture.gaugeLastFrame=ts;
  const dt=Math.min(.032,(ts-gesture.gaugeLastFrame)/1000);
  gesture.gaugeLastFrame=ts;
  const speed=2.10;
  gesture.gaugePos+=gesture.gaugeDir*speed*dt;
  if(gesture.gaugePos>=.98){gesture.gaugePos=.98;gesture.gaugeDir=-1;}
  if(gesture.gaugePos<=.02){gesture.gaugePos=.02;gesture.gaugeDir=1;}
  battleGaugeMarker.style.left=`${gesture.gaugePos*100}%`;
  gesture.gaugeRaf=requestAnimationFrame(updateBattleGauge);
}
function battleGaugeTier(pos){
  const distance=Math.abs(pos-.5);
  if(distance<=.02)return 2;
  if(distance<=.05)return 1;
  return 0;
}


function stackBottom(index){
  let current=index;
  const seen=new Set();
  while(players[current]&&players[current].carrier!==null&&players[current].carrier!==undefined&&!seen.has(current)){
    seen.add(current);
    current=players[current].carrier;
  }
  return current;
}
function directRider(index){
  return players.findIndex((p,i)=>!p.done&&p.carrier===index);
}
function stackMembers(bottomIndex){
  const members=[];
  let current=bottomIndex;
  const seen=new Set();
  while(current>=0&&players[current]&&!seen.has(current)){
    seen.add(current);members.push(current);
    current=directRider(current);
  }
  return members;
}
function topOfStack(bottomIndex){
  const members=stackMembers(bottomIndex);
  return members[members.length-1];
}
function detachFromCarrier(index){
  if(players[index])players[index].carrier=null;
}
function moveStackTo(bottomIndex,pos){
  stackMembers(bottomIndex).forEach(i=>players[i].pos=pos);
}
function attachStack(movingBottom,targetBottom){
  if(movingBottom===targetBottom)return;
  const targetTop=topOfStack(targetBottom);
  players[movingBottom].carrier=targetTop;
  moveStackTo(movingBottom,players[targetBottom].pos);
}
function activePlayersAt(pos){
  return players.map((p,i)=>({p,i}))
    .filter(x=>!x.p.done&&x.p.pos===pos)
    .map(x=>x.i);
}
function independentBottomsAt(pos,excludeBottom=null){
  return players.map((p,i)=>({p,i})).filter(x=>!x.p.done&&x.p.pos===pos&&stackBottom(x.i)===x.i&&x.i!==excludeBottom).map(x=>x.i);
}
function maybeOnbuAfterMove(movingBottom){
  const pos=players[movingBottom].pos;
  const targets=independentBottomsAt(pos,movingBottom);
  if(!targets.length)return false;
  // 先にそのマスにいた山の一番上へ、移動してきた山ごと乗る。
  const target=targets[0];
  attachStack(movingBottom,target);
  log(`${players[movingBottom].name}たちは${players[target].name}におんぶ`);
  return true;
}
function dissolveStack(bottomIndex){
  const members=stackMembers(bottomIndex);
  members.slice(1).forEach(i=>players[i].carrier=null);
}
function dissolveWarStacks(representatives){
  representatives.forEach(rep=>dissolveStack(rep));
}
function resultLabel(delta){
  if(delta>=2)return '大出世！';
  if(delta===1)return '出世！';
  if(delta===0)return '現状維持';
  if(delta===-1)return '降格…';
  return '大降格…';
}
function finishGame(winners){
  winners.forEach(i=>{players[i].done=true;players[i].place=1;players[i].pendingKing=false;});
  running=false;busy=false;war=null;warShade.classList.remove('show');
}
function physicalDisplay(player){
  const same=players.filter(p=>!p.done&&p.rank===player.rank);
  const order=same.indexOf(player);
  if((player.rank===8||player.rank===9)&&order>=2)return player.rank===8?['成銀','歩']:['成銀','と'];
  if((player.rank===10||player.rank===11)&&order>=2)return player.rank===10?['馬','歩']:['馬','と'];
  if(player.rank===12&&order>=2)return ['龍','歩'];
  return [RANKS[player.rank],null];
}
function pieceHTML(player){const [base,helper]=physicalDisplay(player);return helper?`${base}<span class="helper">＋${helper}</span>`:base;}

function renderPieces(){
  board.querySelectorAll('.piece,.cushion,.war-line,.war-label').forEach(el=>el.remove());
  if(war){renderWarOnBoard();return;}
  const bottoms=players.map((p,i)=>!p.done&&stackBottom(i)===i?i:-1).filter(i=>i>=0);
  const groups=new Map();
  bottoms.forEach(i=>{const key=players[i].pos;const list=groups.get(key)||[];list.push(i);groups.set(key,list);});
  groups.forEach(bottomIndices=>{
    bottomIndices.forEach((bottomIndex,groupNo)=>{
      const members=stackMembers(bottomIndex);
      const groupOffset=offsetFor(groupNo,bottomIndices.length);
      members.forEach((playerIndex,level)=>{
        const p=players[playerIndex];
        // おんぶは上へ少しずつずらし、3段以上も読めるようにする。
        const off=[groupOffset[0]+level*.55,groupOffset[1]-level*2.15];
        const ps=posStyle(p.pos,off);
        const cushion=document.createElement('div');cushion.className='cushion';cushion.style.left=ps.left;cushion.style.top=ps.top;cushion.style.background=p.color;board.insertBefore(cushion,warShade);
        const piece=document.createElement('div');piece.className=`piece${running&&playerIndex===turnIndex?' active':''}`;piece.dataset.player=String(playerIndex);piece.style.left=ps.left;piece.style.top=ps.top;piece.style.zIndex=String(20+level);piece.style.setProperty('--rot',`${directionFor(p.pos)}deg`);piece.style.setProperty('--glow',p.color);piece.innerHTML=pieceHTML(p);board.insertBefore(piece,warShade);
      });
    });
  });
}
function renderPlayers(){
  const root=document.querySelector('#players');root.innerHTML='';
  players.forEach((p,i)=>{const el=document.createElement('div');el.className=`player-box${running&&i===turnIndex&&!p.done?' on':''}`;el.innerHTML=`<b style="color:${p.color}">● ${p.name}</b>${p.isYou?'<span class="you">あなた</span>':''}<br>${RANKS[p.rank]}${p.pendingKing?'（王位未確定）':''}${p.cpu?'・自動':''}${p.carrier!==null&&p.carrier!==undefined?'<br><span class="onbu-note">おんぶ中</span>':''}${p.done?`<br><b>${p.place}位</b>`:''}`;root.appendChild(el);});
}
function renderLadder(){
  const root=document.querySelector('#rankRows');root.innerHTML='';
  for(let rank=12;rank>=0;rank--){
    const row=document.createElement('div');
    row.className='rank-row '+(rank===12?'solo':rank%2===1?'pair-top':'pair-bottom');const current=running?(war?currentWarPlayerIndex():turnIndex):-1;if(current>=0&&players[current].rank===rank){row.classList.add('current');row.style.setProperty('--hi',players[current].color);}row.textContent=RANKS[rank];const markers=document.createElement('div');markers.className='markers';players.forEach(p=>{if(p.rank===rank){const m=document.createElement('span');m.className='marker';m.style.background=p.color;markers.appendChild(m);}});row.appendChild(markers);root.appendChild(row);}
}
function currentWarPlayerIndex(){return war.order[war.turnCursor]??war.order[0];}
function updateUI(){
  const index=war?currentWarPlayerIndex():turnIndex;
  const p=players[index];
  if(running&&p){
    if(p.cpu)turnBox.textContent=p.name;
    else if(p.isYou)turnBox.textContent='● あなたの番';
    else turnBox.textContent=`● ${p.name}の番`;
    turnBox.style.borderColor=p.color;
    turnBox.style.color=p.color;
    rollButton.textContent=p.isYou?'▶ あなたが金を振る':`▶ ${p.name}が金を振る`;
    rollButton.disabled=busy||p.cpu;
    roller.style.opacity=p.cpu?'.55':'1';
    const showBattleGauge=Boolean(war&&!p.cpu);
    battleGauge.classList.toggle('show',showBattleGauge);
    // 操作案内は初回だけ金の上へ表示。戦争の狙い方はルール画面で確認できる。
  }
  else{
    turnBox.textContent='開始前';
    turnBox.style.borderColor='transparent';
    rollButton.disabled=true;
    battleGauge.classList.remove('show');
    // 初回案内の表示状態はlocalStorageで管理。
  }
  renderPlayers();renderLadder();
}
function render(){renderPieces();updateUI();}

async function showEvent(title,body='',ms=650){eventBox.innerHTML=`<h2>${title}</h2>${body}`;eventBox.classList.add('show');await sleep(ms);eventBox.classList.remove('show');}
function handSeatConfig(seat){
  const configs=[
    {source:[-12,-10],target:[-2.4,-2.4],rot:135},
    {source:[112,-10],target:[2.4,-2.4],rot:225},
    {source:[112,112],target:[2.4,2.4],rot:315},
    {source:[-12,112],target:[-2.4,2.4],rot:45}
  ];
  return configs[seat]||configs[0];
}
async function showHand(pos,playerIndex,visible=true,offset=[0,0]){
  const player=players[playerIndex];
  const cfg=handSeatConfig(player.seat);
  const ps=posStyle(pos,[offset[0]+cfg.target[0],offset[1]+cfg.target[1]]);
  hand.style.setProperty('--sleeve',player.sleeve);
  hand.style.setProperty('--hand-rot',`${cfg.rot}deg`);
  if(visible&&!hand.classList.contains('show')){
    hand.style.left=`${cfg.source[0]}%`;
    hand.style.top=`${cfg.source[1]}%`;
    hand.classList.add('show');
    await sleep(30);
  }
  hand.style.left=ps.left;
  hand.style.top=ps.top;
  hand.classList.toggle('show',visible);
  await sleep(165);
}
async function moveNormal(playerIndex,steps){
  const p=players[playerIndex];
  // 上の駒は、1以上を出した時点で下から離れる。上に乗る駒は一緒に付いてくる。
  if(steps>0&&p.carrier!==null&&p.carrier!==undefined){
    detachFromCarrier(playerIndex);
    log(`${p.name}：おんぶを降りる`);
  }
  const movingBottom=stackBottom(playerIndex);
  await showHand(p.pos,playerIndex,true);
  for(let i=0;i<steps;i++){
    const next=(players[movingBottom].pos+1)%32;
    moveStackTo(movingBottom,next);
    await showHand(next,playerIndex,true);
    renderPieces();clack();await sleep(190);
  }
  hand.classList.remove('show');await sleep(90);renderPieces();
  if(steps>0)maybeOnbuAfterMove(movingBottom);
}

function goldRoll(tier=0){
  const result=[];
  for(let i=0;i<4;i++){
    const x=Math.random();
    if(tier===2){
      if(x<.39)result.push({type:'face',value:1,label:'表'});
      else if(x<.78)result.push({type:'back',value:0,label:'裏'});
      else if(x<.91)result.push({type:'side',value:5,label:'横'});
      else result.push({type:'vertical',value:10,label:'縦'});
    }else if(tier===1){
      if(x<.43)result.push({type:'face',value:1,label:'表'});
      else if(x<.86)result.push({type:'back',value:0,label:'裏'});
      else if(x<.95)result.push({type:'side',value:5,label:'横'});
      else result.push({type:'vertical',value:10,label:'縦'});
    }else{
      if(x<.47)result.push({type:'face',value:1,label:'表'});
      else if(x<.94)result.push({type:'back',value:0,label:'裏'});
      else if(x<.98)result.push({type:'side',value:5,label:'横'});
      else result.push({type:'vertical',value:10,label:'縦'});
    }
  }
  return result;
}
function totalGold(golds){return golds.reduce((sum,g)=>sum+g.value,0);}
function setupGolds(){roller.querySelectorAll('.gold').forEach(el=>el.remove());const cx=roller.clientWidth/2,cy=roller.clientHeight/2;for(let i=0;i<4;i++){const el=document.createElement('div');el.className='gold';el.textContent='金';const a=i*Math.PI/2;el.style.left=`${cx+Math.cos(a)*42}px`;el.style.top=`${cy+Math.sin(a)*34}px`;roller.appendChild(el);}}
function spinGolds(angle){const list=[...roller.querySelectorAll('.gold')],cx=roller.clientWidth/2,cy=roller.clientHeight/2;list.forEach((el,i)=>{const a=angle+i*Math.PI/2;el.style.left=`${cx+Math.cos(a)*45}px`;el.style.top=`${cy+Math.sin(a)*35}px`;el.style.setProperty('--grot',`${angle*180/Math.PI+i*30}deg`);});}
async function settleGolds(golds){await sleep(140);whoosh();const els=[...roller.querySelectorAll('.gold')];els.forEach((el,i)=>{const g=golds[i];el.className=`gold ${g.type==='side'?'side':g.type==='vertical'?'vertical':''}`;el.textContent=g.type==='back'?'':g.type==='face'?'金':g.label;el.style.left=`${22+i*19}%`;el.style.top='54%';el.style.setProperty('--grot',`${Math.random()*30-15}deg`);});await sleep(620);}

function promote(playerIndex,delta){const p=players[playerIndex];p.rank=clamp(p.rank+delta,0,12);p.pendingKing=p.rank===12;}
async function showRankChange(playerIndex,delta,label){const p=players[playerIndex],before=RANKS[p.rank];promote(playerIndex,delta);const after=RANKS[p.rank];await showEvent(label,`<div style="font-size:20px;font-weight:900;color:${p.color}">${p.name}<br>${before} → ${after}</div>`,760);log(`${p.name}：${before} → ${after}`);render();}

function oppositeGroupFor(playerIndex){
  const p=players[playerIndex],coord=COORDS[p.pos];
  if(isCorner(p.pos))return [];
  return players.map((q,i)=>({q,i,coord:COORDS[q.pos]}))
    .filter(x=>!x.q.done&&x.i!==playerIndex&&(
      (coord[0]===0&&x.coord[0]===8&&coord[1]===x.coord[1])||
      (coord[0]===8&&x.coord[0]===0&&coord[1]===x.coord[1])||
      (coord[1]===0&&x.coord[1]===8&&coord[0]===x.coord[0])||
      (coord[1]===8&&x.coord[1]===0&&coord[0]===x.coord[0])
    ))
    .map(x=>x.i);
}
function warParticipantsFor(playerIndex){
  const enemies=oppositeGroupFor(playerIndex);
  if(!enemies.length)return [];
  const homePos=players[playerIndex].pos;
  const enemyPos=players[enemies[0]].pos;
  return [...activePlayersAt(homePos),...activePlayersAt(enemyPos)];
}
function makePath(fromPos,toPos){const [r1,c1]=COORDS[fromPos],[r2,c2]=COORDS[toPos],path=[];for(let i=0;i<=8;i++){const t=i/8;path.push([r1+(r2-r1)*t,c1+(c2-c1)*t]);}for(let i=1;i<=8;i++){const t=i/8;path.push([r2+(r1-r2)*t,c2+(c1-c2)*t]);}return path;}
function pctFromRC(r,c,off=[0,0]){return{left:`${(c+.5)*100/9+off[0]}%`,top:`${(r+.5)*100/9+off[1]}%`};}
function renderWarOnBoard(){
  warShade.classList.add('show');
  const a=war.pathA[0],b=war.pathA[8],pa=pctFromRC(a[0],a[1]),pb=pctFromRC(b[0],b[1]);
  const line=document.createElement('div');line.className='war-line';
  if(Math.abs(a[0]-b[0])<.01){line.style.left=`${Math.min(parseFloat(pa.left),parseFloat(pb.left))}%`;line.style.top=`calc(${parseFloat(pa.top)}% - 3px)`;line.style.width=`${Math.abs(parseFloat(pb.left)-parseFloat(pa.left))}%`;line.style.height='6px';}
  else{line.style.left=`calc(${parseFloat(pa.left)}% - 3px)`;line.style.top=`${Math.min(parseFloat(pa.top),parseFloat(pb.top))}%`;line.style.height=`${Math.abs(parseFloat(pb.top)-parseFloat(pa.top))}%`;line.style.width='6px';}
  board.insertBefore(line,warShade);
  const positionGroups=new Map();
  war.participants.forEach(index=>{const side=war.side.get(index),progress=war.progress.get(index),path=side===0?war.pathA:war.pathB;const key=`${path[progress][0].toFixed(2)},${path[progress][1].toFixed(2)}`;const list=positionGroups.get(key)||[];list.push(index);positionGroups.set(key,list);});
  positionGroups.forEach(indices=>indices.forEach((index,j)=>{const side=war.side.get(index),progress=war.progress.get(index),path=side===0?war.pathA:war.pathB,[r,c]=path[progress],off=offsetFor(j,indices.length),ps=pctFromRC(r,c,off),piece=document.createElement('div');piece.className='piece';piece.style.left=ps.left;piece.style.top=ps.top;piece.style.setProperty('--rot',`${warDirection(path,progress)}deg`);piece.style.filter=`drop-shadow(0 0 9px ${players[index].color}) drop-shadow(0 3px 2px #0003)`;piece.innerHTML=pieceHTML(players[index]);board.insertBefore(piece,warShade);const label=document.createElement('div');label.className='war-label';label.style.left=ps.left;label.style.top=`calc(${ps.top} + 6%)`;label.style.color=players[index].color;label.textContent=players[index].name;board.insertBefore(label,warShade);}));
}
function warDirection(path,progress){const current=path[progress],next=path[Math.min(16,progress+1)],dr=next[0]-current[0],dc=next[1]-current[1];return Math.abs(dc)>Math.abs(dr)?(dc>0?90:270):(dr>0?180:0);}
function buildWarOrder(participants){return [...participants].sort((a,b)=>players[a].rank-players[b].rank||players[a].seat-players[b].seat);}
async function startWar(participants){
  const first=participants[0],enemy=oppositeGroupFor(first)[0];
  const homePos=players[first].pos,enemyPos=players[enemy].pos;
  const side=new Map();participants.forEach(i=>side.set(i,players[i].pos===homePos?0:1));
  war={
    active:true,
    participants,
    involvedBottoms:[...new Set(participants.map(i=>stackBottom(i)))],
    side,
    progress:new Map(participants.map(i=>[i,0])),
    finish:[],
    order:buildWarOrder(participants),
    turnCursor:0,
    pathA:makePath(homePos,enemyPos),
    pathB:makePath(enemyPos,homePos)
  };
  render();await enterWarSound();await showEvent(participants.length===4?'乱戦！':'戦争',`<b>${participants.map(i=>players[i].name).join('・')}</b>`,800);busy=false;updateUI();if(players[currentWarPlayerIndex()].cpu)setTimeout(autoRoll,650);
}
async function moveWarPlayer(playerIndex,steps){
  for(let s=0;s<steps;s++){
    const old=war.progress.get(playerIndex);
    if(old>=16)break;
    war.progress.set(playerIndex,old+1);
    renderPieces();
    clack();
    await sleep(190);
  }
}
async function resolveWarRoll(value){
  const index=currentWarPlayerIndex();await moveWarPlayer(index,value);
  if(war.progress.get(index)>=16&&!war.finish.includes(index)){war.finish.push(index);log(`戦争：${players[index].name} ${war.finish.length}位`);}
  if(war.finish.length===war.participants.length-1){const last=war.participants.find(i=>!war.finish.includes(i));war.finish.push(last);}
  if(war.finish.length===war.participants.length){
    const finish=[...war.finish],delta=WAR_DELTA[finish.length];
    await showEvent('勝負あり',finish.map((rep,n)=>`${players[rep].name}　${resultLabel(delta[n])}`).join('<br>'),1050);
    for(let n=0;n<finish.length;n++){
      const playerIndex=finish[n],d=delta[n];
      if(d!==0)await showRankChange(playerIndex,d,resultLabel(d));
      else await showEvent('現状維持',`<b style="color:${players[playerIndex].color}">${players[playerIndex].name}</b>`,420);
    }
    const bottoms=[...war.involvedBottoms];
    bottoms.forEach(bottom=>dissolveStack(bottom));
    war.active=false;
    war=null;
    warShade.classList.remove('show');
    await leaveWarSound();
    busy=false;
    render();
    nextTurn();
    return;
  }
  do{war.turnCursor=(war.turnCursor+1)%war.order.length;}while(war.finish.includes(war.order[war.turnCursor]));busy=false;render();if(players[currentWarPlayerIndex()].cpu)setTimeout(autoRoll,650);
}

async function resolveNormalRoll(value){
  const active=turnIndex;
  const beforeBottom=stackBottom(active);
  await moveNormal(active,value);
  const movingBottom=stackBottom(active);
  const movedMembers=stackMembers(movingBottom);
  const corner=isCorner(players[active].pos);
  if(corner){
    // 移動して角へ到達した時は、一緒に運ばれた全員が出世。0なら手番の駒だけ。
    const targets=value>0?movedMembers:[active];
    const winners=[];
    for(const i of targets){
      const p=players[i];
      if(p.rank===12&&p.pendingKing){p.pendingKing=false;winners.push(i);continue;}
      if(p.rank===11){await showRankChange(i,1,'角で王へ');p.pendingKing=false;winners.push(i);continue;}
      await showRankChange(i,1,'角で出世');
      if(players[i].rank===12){players[i].pendingKing=false;winners.push(i);}
    }
    if(winners.length){
      finishGame(winners);
      await showEvent(winners.length>1?'同点1位！':'上がり',winners.map(i=>`<b style="color:${players[i].color}">${players[i].name}　王将</b>`).join('<br>'),1200);
      render();return;
    }
  }
  const participants=warParticipantsFor(active);
  if(participants.length>=2){busy=false;await startWar(participants);return;}
  busy=false;nextTurn();
}

async function performRoll(battleTier=0){
  if(busy||!running)return;
  const index=war?currentWarPlayerIndex():turnIndex;
  const p=players[index];
  busy=true;updateUI();
  try{
    if(!p.cpu) await ensureAudio();
    const golds=goldRoll(war?battleTier:0);
    await settleGolds(golds);
    const value=totalGold(golds);
    resultEl.textContent=`${p.name}：${value}`;
    log(`${p.name}　${golds.map(g=>g.label).join('・')} = ${value}`);
    if(war) await resolveWarRoll(value);
    else await resolveNormalRoll(value);
  }catch(error){
    console.error(error);
    busy=false;
    resultEl.textContent=`エラー：${error?.message||error}`;
    log(`エラー：${error?.message||error}`);
    render();
  }finally{
    setupGolds();
  }
}
async function autoRoll(){
  if(busy||!running)return;
  spinGolds(Math.random()*6);
  gesture.lastSoundAt=0;
  for(let i=0;i<5;i++){
    woodRollTick(.45);
    await sleep(165+Math.random()*45);
  }
  let tier=0;
  if(war){
    const r=Math.random();
    tier=r<.08?2:r<.28?1:0;
  }
  await performRoll(tier);
}
function nextTurn(){
  if(!running)return;
  do{turnIndex=(turnIndex+1)%players.length;}while(players[turnIndex].done);
  render();
  if(!players[turnIndex].cpu&&navigator.vibrate)navigator.vibrate(80);
  if(players[turnIndex].cpu)setTimeout(autoRoll,650);
}



const ROLL_HINT_KEY='mawariShogiRollHintSeen';
function updateRollHint(){
  const seen=localStorage.getItem(ROLL_HINT_KEY)==='1';
  rollerHint.classList.toggle('hidden',seen);
}
function dismissRollHint(){
  localStorage.setItem(ROLL_HINT_KEY,'1');
  rollerHint.classList.add('hidden');
}

function lockPageForRoll(){
  document.body.classList.add('rolling-lock');
}
function unlockPageAfterRoll(){
  document.body.classList.remove('rolling-lock');
}

roller.addEventListener('pointerdown',async event=>{
  if(!running||busy)return;
  lockPageForRoll();
  dismissRollHint();
  const index=war?currentWarPlayerIndex():turnIndex;
  if(players[index].cpu)return;
  await ensureAudio();
  const rect=roller.getBoundingClientRect();
  gesture.active=true;
  gesture.cx=rect.left+rect.width/2;
  gesture.cy=rect.top+rect.height/2;
  gesture.last=Math.atan2(event.clientY-gesture.cy,event.clientX-gesture.cx);
  gesture.total=0;
  gesture.lastSoundAt=0;
  roller.setPointerCapture(event.pointerId);
  rollerHint.style.opacity='.25';
  if(war)startBattleGauge();
});
roller.addEventListener('pointermove',event=>{
  if(!gesture.active)return;
  event.preventDefault();
  const angle=Math.atan2(event.clientY-gesture.cy,event.clientX-gesture.cx);
  let delta=angle-gesture.last;
  if(delta>Math.PI)delta-=Math.PI*2;
  if(delta<-Math.PI)delta+=Math.PI*2;
  gesture.total+=Math.abs(delta);
  gesture.last=angle;
  spinGolds(angle+gesture.total*.5);
  if(Math.abs(delta)>.025)woodRollTick(Math.min(1,Math.abs(delta)*5));
});
roller.addEventListener('pointerup',async()=>{
  if(!gesture.active)return;
  gesture.active=false;
  unlockPageAfterRoll();
  rollerHint.style.opacity='1';
  const tier=war?battleGaugeTier(gesture.gaugePos):0;
  stopBattleGauge();
  await performRoll(tier);
});
roller.addEventListener('pointercancel',()=>{
  gesture.active=false;
  unlockPageAfterRoll();
  rollerHint.style.opacity='1';
  stopBattleGauge();
});
rollButton.addEventListener('click',()=>performRoll(0));
audioButton.addEventListener('click',async()=>{
  const ok=await ensureAudio();
  if(ok){
    woodStep();
    audioButton.textContent='音が入りました';
    setTimeout(()=>audioButton.textContent='音を開始・再開',1100);
  }
});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'){
    if(audioContext&&audioContext.state!=='running')audioButton.classList.add('show');
    if(audioEnabled&&environmentAudio.paused){
      environmentAudio.play().catch(()=>audioButton.classList.add('show'));
    }
  }else{
    environmentAudio.pause();
  }
});
document.addEventListener('pointerdown',()=>{if(audioContext&&audioContext.state!=='running')ensureAudio();},{capture:true,passive:true});

function randomNames(){
  const shuffled=[...NAME_POOL].sort(()=>Math.random()-.5).slice(0,4);
  document.querySelectorAll('.name-card input').forEach((input,i)=>{
    input.value=i===0?'あなた':shuffled[i];
  });
}
function prepareNames(){
  const root=document.querySelector('#nameGrid');
  root.innerHTML='';
  for(let i=0;i<4;i++){
    const card=document.createElement('div');
    card.className='name-card'+(i===0?' you-seat':'');
    const label=i===0
      ? `<b style="color:${COLORS[i]}">赤・左上</b><span class="seat-note">あなた</span>`
      : `<b style="color:${COLORS[i]}">席${i+1}</b>`;
    card.innerHTML=`${label}<input id="name${i}" value="${NAME_POOL[i]}">`;
    root.appendChild(card);
  }
  randomNames();
}
async function orderPlayers(){let candidates=[0,1,2,3];while(true){const scored=candidates.map(i=>[i,totalGold(goldRoll())]);scored.forEach(([i,s])=>log(`順番決め：${players[i].name} = ${s}`));const max=Math.max(...scored.map(x=>x[1])),top=scored.filter(x=>x[1]===max).map(x=>x[0]);if(top.length===1){const firstSeat=players[top[0]].seat;players.sort((a,b)=>((a.seat-firstSeat+4)%4)-((b.seat-firstSeat+4)%4));turnIndex=0;await showEvent('先攻',`<b style="color:${players[0].color}">${players[0].name}</b><br>ここから右回り`,800);return;}candidates=top;log('1位同点。振り直し');}}


function openRules(){
  rulesModal.classList.add('show');
  rulesModal.setAttribute('aria-hidden','false');
  document.body.classList.add('rules-open');
}
function closeRules(){
  rulesModal.classList.remove('show');
  rulesModal.setAttribute('aria-hidden','true');
  document.body.classList.remove('rules-open');
}
rulesButton.addEventListener('click',openRules);
rulesClose.addEventListener('click',closeRules);
rulesModal.addEventListener('click',event=>{
  if(event.target===rulesModal)closeRules();
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape')closeRules();
});

document.querySelector('#randomNames').addEventListener('click',randomNames);
document.querySelector('#startButton').addEventListener('click',async()=>{await ensureAudio();const humans=Number(document.querySelector('#humanCount').value);players=[0,1,2,3].map(i=>({name:document.querySelector(`#name${i}`).value||NAME_POOL[i],seat:i,pos:CORNERS[i],rank:0,color:COLORS[i],sleeve:SLEEVES[i],cpu:i>=humans,isYou:i===0,done:false,place:null,pendingKing:false,carrier:null}));logEl.innerHTML='';resultEl.textContent='';war=null;running=false;busy=true;warShade.classList.remove('show');setupGolds();render();await orderPlayers();running=true;busy=false;render();if(!players[0].cpu&&navigator.vibrate)navigator.vibrate(80);if(players[0].cpu)setTimeout(autoRoll,650);});
window.addEventListener('resize',setupGolds);

makeBoard();prepareNames();setupGolds();renderLadder();updateUI();updateRollHint();

window.addEventListener('error',e=>{resultEl.textContent='エラー：'+e.message;log('エラー：'+e.message);busy=false;try{render()}catch(_){}});
window.addEventListener('unhandledrejection',e=>{const msg=e.reason?.message||String(e.reason);resultEl.textContent='エラー：'+msg;log('エラー：'+msg);busy=false;try{render()}catch(_){}});

roller.addEventListener('touchmove',event=>{
  if(gesture.active)event.preventDefault();
},{passive:false});

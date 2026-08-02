// v1.0.6: 効果音はこのファイル内に内蔵されています。audioフォルダは不要です。
'use strict';

const COLORS=['#b8493f','#315f8c','#668447','#8a5b91'];
const SLEEVES=['#8f3b32','#244f78','#56743e','#704875'];
const NAME_POOL=['たかし','みき','けんじ','ゆうこ','まさる','あきら','なおこ','みどり','しょうた','あや'];
const RANKS=['歩','と','香','成香','桂','成桂','銀','成銀','角','馬','飛','龍','王'];
const CORNERS=[0,8,16,24];
const WAR_DELTA={2:[1,-1],3:[2,0,-2],4:[3,1,-1,-3]};

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
    audioButton.classList.toggle('show',!audioEnabled);
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

// 背景音・戦争BGM・戦争開始音は使わない
async function enterWarSound(){}
async function leaveWarSound(){}

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
  const groups=new Map();
  players.forEach((p,i)=>{if(!p.done){const key=p.pos;const list=groups.get(key)||[];list.push(i);groups.set(key,list);}});
  groups.forEach(indices=>{
    indices.forEach((playerIndex,j)=>{
      const p=players[playerIndex],off=offsetFor(j,indices.length),ps=posStyle(p.pos,off);
      const cushion=document.createElement('div');cushion.className='cushion';cushion.style.left=ps.left;cushion.style.top=ps.top;cushion.style.background=p.color;board.insertBefore(cushion,warShade);
      const piece=document.createElement('div');piece.className=`piece${running&&playerIndex===turnIndex?' active':''}`;piece.dataset.player=String(playerIndex);piece.style.left=ps.left;piece.style.top=ps.top;piece.style.setProperty('--rot',`${directionFor(p.pos)}deg`);piece.style.setProperty('--glow',p.color);piece.innerHTML=pieceHTML(p);board.insertBefore(piece,warShade);
    });
  });
}
function renderPlayers(){
  const root=document.querySelector('#players');root.innerHTML='';
  players.forEach((p,i)=>{const el=document.createElement('div');el.className=`player-box${running&&i===turnIndex&&!p.done?' on':''}`;el.innerHTML=`<b style="color:${p.color}">● ${p.name}</b>${p.isYou?'<span class="you">あなた</span>':''}<br>${RANKS[p.rank]}${p.pendingKing?'（王位未確定）':''}${p.cpu?'・自動':''}${p.done?`<br><b>${p.place}位</b>`:''}`;root.appendChild(el);});
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
    rollerHint.innerHTML=war
      ? '勝負振り<br><small>金を回しながら中央線を狙う</small>'
      : '金をくるくる回して<br>指を離す';
  }
  else{
    turnBox.textContent='開始前';
    turnBox.style.borderColor='transparent';
    rollButton.disabled=true;
    battleGauge.classList.remove('show');
    rollerHint.innerHTML='金をくるくる回して<br>指を離す';
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
  await showHand(p.pos,playerIndex,true);
  for(let i=0;i<steps;i++){
    p.pos=(p.pos+1)%32;
    await showHand(p.pos,playerIndex,true);
    renderPieces();
    clack();
    await sleep(190);
  }
  hand.classList.remove('show');
  await sleep(90);
  renderPieces();
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
  return players.map((q,i)=>({q,i,coord:COORDS[q.pos]})).filter(x=>!x.q.done&&x.i!==playerIndex&&((coord[0]===0&&x.coord[0]===8&&coord[1]===x.coord[1])||(coord[0]===8&&x.coord[0]===0&&coord[1]===x.coord[1])||(coord[1]===0&&x.coord[1]===8&&coord[0]===x.coord[0])||(coord[1]===8&&x.coord[1]===0&&coord[0]===x.coord[0]))).map(x=>x.i);
}
function warParticipantsFor(playerIndex){
  const enemies=oppositeGroupFor(playerIndex);if(!enemies.length)return [];
  const homePos=players[playerIndex].pos,enemyPos=players[enemies[0]].pos;
  const home=players.map((p,i)=>!p.done&&p.pos===homePos?i:-1).filter(i=>i>=0);
  const away=players.map((p,i)=>!p.done&&p.pos===enemyPos?i:-1).filter(i=>i>=0);
  return [...home,...away];
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
  war={participants,side,progress:new Map(participants.map(i=>[i,0])),finish:[],order:buildWarOrder(participants),turnCursor:0,pathA:makePath(homePos,enemyPos),pathB:makePath(enemyPos,homePos)};
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
  if(war.finish.length===war.participants.length){const finish=[...war.finish],delta=WAR_DELTA[finish.length];await showEvent('勝負あり',finish.map((i,n)=>`${n+1}位 ${players[i].name}`).join('<br>'),900);for(let i=0;i<finish.length;i++)if(delta[i]!==0)await showRankChange(finish[i],delta[i],delta[i]>0?'戦争・出世':'戦争・降格');war=null;warShade.classList.remove('show');await leaveWarSound();busy=false;render();nextTurn();return;}
  do{war.turnCursor=(war.turnCursor+1)%war.order.length;}while(war.finish.includes(war.order[war.turnCursor]));busy=false;render();if(players[currentWarPlayerIndex()].cpu)setTimeout(autoRoll,650);
}

async function resolveNormalRoll(value){
  const p=players[turnIndex];await moveNormal(turnIndex,value);
  if(isCorner(p.pos)){
    // 戦争で王になった未確定王は、通常移動で角に止まると王位確定。
    if(p.rank===12&&p.pendingKing){
      p.pendingKing=false;
      p.done=true;
      p.place=players.filter(x=>x.done).length+1;
      await showEvent('王位確定',`<b style="color:${p.color}">${p.name}　${p.place}位で上がり</b>`,900);
      render();
      busy=false;
      nextTurn();
      return;
    }
    // 龍が通常移動で角に止まった場合は、その場で王になり即上がり。
    if(p.rank===11){
      await showRankChange(turnIndex,1,'角で王へ');
      p.pendingKing=false;
      p.done=true;
      p.place=players.filter(x=>x.done).length+1;
      await showEvent('上がり',`<b style="color:${p.color}">${p.name}　${p.place}位</b>`,900);
      render();
      busy=false;
      nextTurn();
      return;
    }
    await showRankChange(turnIndex,1,'角で出世');
  }
  const participants=warParticipantsFor(turnIndex);
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
  if(players.filter(p=>!p.done).length<=1){const last=players.find(p=>!p.done);if(last){last.done=true;last.place=4;}running=false;render();log('全員の順位が決まりました。');return;}
  do{turnIndex=(turnIndex+1)%players.length;}while(players[turnIndex].done);render();if(!players[turnIndex].cpu&&navigator.vibrate)navigator.vibrate(80);if(players[turnIndex].cpu)setTimeout(autoRoll,650);
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
  if(document.visibilityState==='visible'&&audioContext&&audioContext.state!=='running'){
    audioButton.classList.add('show');
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

document.querySelector('#randomNames').addEventListener('click',randomNames);
document.querySelector('#startButton').addEventListener('click',async()=>{await ensureAudio();const humans=Number(document.querySelector('#humanCount').value);players=[0,1,2,3].map(i=>({name:document.querySelector(`#name${i}`).value||NAME_POOL[i],seat:i,pos:CORNERS[i],rank:0,color:COLORS[i],sleeve:SLEEVES[i],cpu:i>=humans,isYou:i===0,done:false,place:null,pendingKing:false}));logEl.innerHTML='';resultEl.textContent='';war=null;running=false;busy=true;warShade.classList.remove('show');setupGolds();render();await orderPlayers();running=true;busy=false;render();if(!players[0].cpu&&navigator.vibrate)navigator.vibrate(80);if(players[0].cpu)setTimeout(autoRoll,650);});
window.addEventListener('resize',setupGolds);

makeBoard();prepareNames();setupGolds();renderLadder();updateUI();

window.addEventListener('error',e=>{resultEl.textContent='エラー：'+e.message;log('エラー：'+e.message);busy=false;try{render()}catch(_){}});
window.addEventListener('unhandledrejection',e=>{const msg=e.reason?.message||String(e.reason);resultEl.textContent='エラー：'+msg;log('エラー：'+msg);busy=false;try{render()}catch(_){}});

roller.addEventListener('touchmove',event=>{
  if(gesture.active)event.preventDefault();
},{passive:false});

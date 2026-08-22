// v1.0.21: 効果音はこのファイル内に内蔵されています。audioフォルダは不要です。
'use strict';

const COLORS=['#b8493f','#315f8c','#668447','#8a5b91'];
const SLEEVES=['#8f3b32','#244f78','#56743e','#704875'];
const NAME_POOL=['たかし','みき','けんじ','ゆうこ','まさる','あきら','なおこ','みどり','しょうた','あや'];
const RANKS=['歩','と','香','成香','桂','成桂','銀','成銀','角','馬','飛','龍','王'];
const CORNERS=[0,8,16,24];
const WAR_DELTA={2:[1,-1],3:[2,0,-2],4:[2,1,-1,-2]};
const HOUROKU_BY_RANK=[0,100,200,300,400,500,600,800,1000,1300,1600,2000,2500];
const LAP_BONUS=50;
const PROFILE_KEY='mawari_shogi_profiles_v1';

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
const anticipationEl=document.querySelector('#anticipation');
const battleGauge=document.querySelector('#battleGauge');
const battleGaugeMarker=document.querySelector('#battleGaugeMarker');
const logEl=document.querySelector('#log');
const rulesButton=document.querySelector('#rulesButton');
const rulesModal=document.querySelector('#rulesModal');
const rulesClose=document.querySelector('#rulesClose');
const recordsButton=document.querySelector('#recordsButton');
const recordsModal=document.querySelector('#recordsModal');
const recordsClose=document.querySelector('#recordsClose');
const recordsContent=document.querySelector('#recordsContent');
const titleScreen=document.querySelector('#titleScreen');
const gameApp=document.querySelector('#gameApp');
const titleRulesButton=document.querySelector('#titleRulesButton');
const titleRecordsButton=document.querySelector('#titleRecordsButton');
const playNav=document.querySelector('#playNav');
const playBackButton=document.querySelector('#playBackButton');
const playRulesButton=document.querySelector('#playRulesButton');
const playRecordsButton=document.querySelector('#playRecordsButton');




let players=[];
let turnIndex=0;
let running=false;
let busy=false;
let war=null;
let audioContext=null;
let cpuTimer=null;
let cpuJobId=0;
let repairingTurn=false;
let gesture={
  active:false,cx:0,cy:0,last:0,total:0,lastSoundAt:0,
  gaugePos:.08,gaugeDir:1,gaugeLastFrame:0,gaugeRaf:null
};

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function loadProfiles(){
  try{return JSON.parse(localStorage.getItem(PROFILE_KEY)||'[]');}catch(_){return [];}
}
function saveProfiles(list){localStorage.setItem(PROFILE_KEY,JSON.stringify(list));}
function newProfile(name){
  return {id:'p_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7),name,
    games:0,kings:0,totalEarned:0,totalStolen:0,bestMoney:0,promotions:0,bigPromotions:0,warWins:0};
}
function resolveProfile(name){
  const clean=(name||'プレイヤー').trim();
  const list=loadProfiles();
  let p=list.find(x=>x.name===clean);
  if(!p){p=newProfile(clean);list.push(p);saveProfiles(list);}
  return p.id;
}
function profileById(id){return loadProfiles().find(x=>x.id===id)||null;}
function updateProfile(id,fn){
  if(!id)return;
  const list=loadProfiles(),i=list.findIndex(x=>x.id===id);
  if(i<0)return;
  fn(list[i]);saveProfiles(list);
}
function addMoney(index,amount,reason=''){
  const p=players[index];
  if(!p||amount<=0)return 0;
  p.money=(p.money||0)+amount;
  p.gameEarned=(p.gameEarned||0)+amount;
  if(reason)log(`${p.name}：${reason} ＋${amount.toLocaleString()}両`);
  return amount;
}
function takeMoney(fromIndex,toIndex,amount){
  const from=players[fromIndex],to=players[toIndex];
  const actual=Math.max(0,Math.min(from.money||0,Math.floor(amount)));
  from.money-=actual;to.money=(to.money||0)+actual;to.gameStolen=(to.gameStolen||0)+actual;
  if(actual)log(`${to.name}：${from.name}から ${actual.toLocaleString()}両`);
  return actual;
}
function awardPromotion(index,beforeRank,afterRank,delta){
  if(afterRank<=beforeRank)return 0;
  let total=0;
  for(let r=beforeRank+1;r<=afterRank;r++)total+=HOUROKU_BY_RANK[r]||0;
  addMoney(index,total,'出世俸禄');
  const p=players[index];p.gamePromotions=(p.gamePromotions||0)+(afterRank-beforeRank);
  if(delta>=2)p.gameBigPromotions=(p.gameBigPromotions||0)+1;
  return total;
}
function awardWarMoney(finish){
  const transfers=[];
  const pairs=finish.length===2?[[0,1]]:
              finish.length===3?[[0,2]]:
              finish.length===4?[[0,3],[1,2]]:[];
  pairs.forEach(([winnerPos,loserPos])=>{
    const w=finish[winnerPos],l=finish[loserPos];
    const amount=Math.floor((players[l].money||0)/2);
    const got=takeMoney(l,w,amount);
    if(got){
      players[w].gameWarWins=(players[w].gameWarWins||0)+1;
      log(`戦争俸禄：${players[w].name}が${players[l].name}から半分獲得`);
      transfers.push({winner:w,loser:l,amount:got});
    }
  });
  return transfers;
}
function finalizeHumanRecords(){
  players.filter(p=>!p.cpu&&p.profileId).forEach(p=>{
    updateProfile(p.profileId,rec=>{
      rec.name=p.name;rec.games=(rec.games||0)+1;
      rec.kings=(rec.kings||0)+(p.done&&p.place===1?1:0);
      rec.totalEarned=(rec.totalEarned||0)+(p.gameEarned||0);
      rec.totalStolen=(rec.totalStolen||0)+(p.gameStolen||0);
      rec.bestMoney=Math.max(rec.bestMoney||0,p.money||0);
      rec.promotions=(rec.promotions||0)+(p.gamePromotions||0);
      rec.bigPromotions=(rec.bigPromotions||0)+(p.gameBigPromotions||0);
      rec.warWins=(rec.warWins||0)+(p.gameWarWins||0);
    });
  });
}
function renderRecords(){
  const list=loadProfiles();
  if(!list.length){recordsContent.innerHTML='<p>まだ記録がありません。</p>';return;}
  recordsContent.innerHTML=list.map(p=>`<div class="record-card">
    <b>${p.name}</b>
    <div>${p.games||0}戦　王 ${p.kings||0}回　戦争勝利 ${p.warWins||0}回</div>
    <div>最高所持 ${Number(p.bestMoney||0).toLocaleString()}両</div>
    <div>通算獲得 ${Number(p.totalEarned||0).toLocaleString()}両　戦争獲得 ${Number(p.totalStolen||0).toLocaleString()}両</div>
    <div>出世 ${p.promotions||0}段　大出世 ${p.bigPromotions||0}回</div>
  </div>`).join('');
}

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

// ===== 効果音：WAVファイルをAudioBufferで再生 =====
const EFFECT_FILES={
  step:['audio/step1.wav','audio/step2.wav','audio/step3.wav'],
  roll:['audio/roll1.wav','audio/roll2.wav','audio/roll3.wav','audio/roll4.wav'],
  land:['audio/land.wav'],
  rankUp:['audio/rank_up.wav'],
  rankUpBig:['audio/rank_up_big.wav'],
  rankDown:['audio/rank_down.wav'],
  rankDownBig:['audio/rank_down_big.wav']
};
const effectBuffers={step:[],roll:[],land:[],rankUp:[],rankUpBig:[],rankDown:[],rankDownBig:[]};
let effectsGain=null;

// ===== 環境音：AudioContext上で時間指定して途切れなくクロスフェード =====
const ENV_SRC='audio/kankyouon.wav';
const ENV_VOLUME=.80;
const ENV_WAR_VOLUME=.28;
const ENV_OVERLAP=3.6;
let envBuffer=null;
let envTargetVolume=ENV_VOLUME;
let envActive=false;
let envGeneration=0;
let envPlannerTimer=null;
let envNextStart=0;
let envScheduledUntil=0;
const envNodes=[];

async function fetchBuffer(url){
  const res=await fetch(url,{cache:'force-cache'});
  if(!res.ok)throw new Error(`audio fetch ${res.status}`);
  const arr=await res.arrayBuffer();
  return await audioContext.decodeAudioData(arr.slice(0));
}

async function loadAllAudioBuffers(){
  // 効果音と環境音は独立して読む。1ファイル失敗しても全部を止めない。
  const effectJobs=[];
  for(const key of ['step','roll','land','rankUp','rankUpBig','rankDown','rankDownBig']){
    effectBuffers[key]=[];
    EFFECT_FILES[key].forEach((url,idx)=>{
      effectJobs.push(
        fetchBuffer(url)
          .then(buf=>{ effectBuffers[key][idx]=buf; return true; })
          .catch(error=>{
            console.warn('effect audio load failed',url,error);
            return false;
          })
      );
    });
  }
  await Promise.all(effectJobs);

  // 環境音は別処理。失敗しても効果音は有効のまま。
  try{
    envBuffer=await fetchBuffer(ENV_SRC);
  }catch(error){
    envBuffer=null;
    console.warn('environment audio load failed',error);
  }
}

function playEffect(kind,index=null,volume=1){
  if(!audioContext||audioContext.state!=='running')return;
  const list=effectBuffers[kind];
  if(!list||!list.length)return;
  const buf=list[index===null?Math.floor(Math.random()*list.length):index%list.length];
  if(!buf)return;
  const src=audioContext.createBufferSource();
  const g=audioContext.createGain();
  src.buffer=buf;
  // WAV自体を-0.7dBFSに正規化済み。ここでは十分前に出す。
  g.gain.value=volume;
  src.connect(g);
  g.connect(effectsGain||audioContext.destination);
  src.start();
}

function woodStep(){ playEffect('step',null,1.0); }

function woodRollTick(speed=0.5){
  const now=performance.now();
  const minGap=clamp(260-speed*150,105,260);
  if(now-gesture.lastSoundAt<minGap)return;
  gesture.lastSoundAt=now;
  playEffect('roll',null,1.0);
}

function clack(){ woodStep(); }
function thud(){ playEffect('land',0,1.0); }
function whoosh(){ /* 余計な電子音は鳴らさない */ }
function rankChangeSound(delta){
  if(delta>=2)playEffect('rankUpBig',0,.9);
  else if(delta===1)playEffect('rankUp',0,.9);
  else if(delta<=-2)playEffect('rankDownBig',0,.86);
  else if(delta===-1)playEffect('rankDown',0,.86);
}

/* 俸禄音：外部ファイルに依存せずAudioContext内で生成。
   既存効果音が鳴る環境なら同じAudioContext経由で再生できる。 */
const moneyBuffers={lap:null,gain:null,loss:null};
function makeMoneyBuffer(kind){
  if(!audioContext)return null;
  const sr=audioContext.sampleRate||44100;
  const duration=kind==='gain'?1.08:kind==='loss'?.76:.74;
  const buffer=audioContext.createBuffer(1,Math.floor(sr*duration),sr);
  const data=buffer.getChannelData(0);
  const strikes=kind==='gain'
    ? [[0,.72,820],[.06,.66,980],[.13,.76,1120],[.20,.62,1260],[.28,.72,1420],[.37,.60,1580],[.46,.64,1760],[.56,.52,1960],[.66,.42,2180]]
    : kind==='loss'
      ? [[0,.66,720],[.10,.55,600],[.21,.44,500],[.33,.32,420]]
      : [[0,.70,1680],[.045,.46,2360]];
  for(const [st,amp,base] of strikes){
    const s0=Math.floor(st*sr);
    for(let i=s0;i<data.length;i++){
      const t=(i-s0)/sr,attack=Math.min(1,t/.0025);
      const decay=Math.exp(-(kind==='gain'?6.0:kind==='loss'?5.0:4.6)*t);
      const metal=Math.sin(2*Math.PI*base*t)*.62+
        Math.sin(2*Math.PI*base*1.53*t+.5)*.40+
        Math.sin(2*Math.PI*base*2.31*t+1.0)*.24+
        Math.sin(2*Math.PI*base*3.12*t+.2)*.12;
      const tick=(Math.random()*2-1)*Math.exp(-55*t)*.05;
      data[i]+=amp*(metal+tick)*attack*decay*.24;
    }
  }
  if(kind==='lap'){
    for(let i=0;i<data.length;i++){
      const t=i/sr;
      if(t>.035){const u=t-.035;data[i]+=Math.sin(2*Math.PI*2920*u)*Math.exp(-4.0*u)*.085;}
    }
  }
  let peak=0;for(let i=0;i<data.length;i++)peak=Math.max(peak,Math.abs(data[i]));
  if(peak>0){const scale=.76/peak;for(let i=0;i<data.length;i++)data[i]*=scale;}
  return buffer;
}
function playMoneySound(kind,volume=1){
  if(!audioContext||audioContext.state!=='running')return;
  if(!moneyBuffers[kind])moneyBuffers[kind]=makeMoneyBuffer(kind);
  const src=audioContext.createBufferSource(),g=audioContext.createGain();
  src.buffer=moneyBuffers[kind];g.gain.value=volume;
  src.connect(g);g.connect(effectsGain||audioContext.destination);src.start();
}
function lapMoneySound(){playMoneySound('lap',1.10)}
function warGainSound(){playMoneySound('gain',1.28)}
function warLossSound(){playMoneySound('loss',1.00)}

/* 出世するほど、同じ木駒音を少し重く・強くする。 */
function rankStepSound(playerIndex){
  const rank=players[playerIndex]?.rank||0;
  const volume=Math.min(1.12,.78+rank*.027);
  playEffect('step',rank%3,volume);
}

function stopEnvironmentEngine(){
  envActive=false;
  envGeneration++;
  if(envPlannerTimer!==null){clearTimeout(envPlannerTimer);envPlannerTimer=null;}
  while(envNodes.length){
    const n=envNodes.pop();
    try{n.source.stop();}catch(_){}
  }
}

function scheduleEnvClip(startTime,generation){
  if(!envBuffer||generation!==envGeneration)return;
  const dur=envBuffer.duration;
  const src=audioContext.createBufferSource();
  const gain=audioContext.createGain();
  src.buffer=envBuffer;
  src.connect(gain);
  gain.connect(audioContext.destination);

  const overlap=Math.min(ENV_OVERLAP,dur*.2);
  const endTime=startTime+dur;
  const fadeInEnd=startTime+overlap;
  const fadeOutStart=endTime-overlap;

  gain.gain.setValueAtTime(0,startTime);
  gain.gain.linearRampToValueAtTime(envTargetVolume,fadeInEnd);
  gain.gain.setValueAtTime(envTargetVolume,fadeOutStart);
  gain.gain.linearRampToValueAtTime(0,endTime);

  src.start(startTime);
  src.stop(endTime+.05);
  envNodes.push({source:src,gain,startTime,endTime,generation});

  // 次音源は「終了前 overlap 秒」にAudioContext時刻で正確に開始。
  return endTime-overlap;
}

function planEnvironment(generation){
  if(!envActive||generation!==envGeneration||!envBuffer)return;

  const now=audioContext.currentTime;
  const lookAhead=18;

  while(envNextStart < now+lookAhead){
    const next=scheduleEnvClip(envNextStart,generation);
    if(typeof next!=='number')break;
    envNextStart=next;
  }

  // 古いノード参照を掃除
  for(let i=envNodes.length-1;i>=0;i--){
    if(envNodes[i].endTime < now-1) envNodes.splice(i,1);
  }

  envPlannerTimer=setTimeout(()=>planEnvironment(generation),3000);
}

async function startEnvironmentEngine(){
  if(!audioContext||!envBuffer)return;
  stopEnvironmentEngine();
  envActive=true;
  const generation=++envGeneration;
  // 最初の音は待たせず100ms後に開始。最初だけ数秒無音になる問題を防止。
  envNextStart=audioContext.currentTime+.10;
  planEnvironment(generation);
}

function updateEnvironmentVolume(target,ms=350){
  envTargetVolume=target;
  if(!audioContext)return;
  const now=audioContext.currentTime;
  const end=now+ms/1000;
  envNodes.forEach(n=>{
    if(n.endTime<=now)return;
    try{
      const current=n.gain.gain.value;
      n.gain.gain.cancelScheduledValues(now);
      n.gain.gain.setValueAtTime(current,now);
      n.gain.gain.linearRampToValueAtTime(target,end);
    }catch(_){}
  });
}

async function ensureAudio(){
  try{
    if(!audioContext)audioContext=new (window.AudioContext||window.webkitAudioContext)();
    if(audioContext.state!=='running')await audioContext.resume();

    if(!effectsGain){
      effectsGain=audioContext.createGain();
      effectsGain.gain.value=1.0;
      effectsGain.connect(audioContext.destination);
    }

    if(!effectBuffers.step.length){
      await loadAllAudioBuffers();
    }

    audioEnabled=audioContext.state==='running';

    if(audioEnabled){
      // 環境音が読めていれば開始。読めていなくても効果音は鳴る。
      if(envBuffer)await startEnvironmentEngine();
      audioButton.classList.remove('show');
    }else{
      audioButton.classList.add('show');
    }
    return audioEnabled;
  }catch(error){
    console.error('audio init failed',error);
    // AudioContext自体が生きていれば、読み込み済み効果音は使える。
    audioEnabled=Boolean(audioContext&&audioContext.state==='running');
    audioButton.classList.toggle('show',!audioEnabled);
    return audioEnabled;
  }
}

async function enterWarSound(){
  if(audioEnabled)updateEnvironmentVolume(ENV_WAR_VOLUME,260);
}
async function leaveWarSound(){
  if(audioEnabled)updateEnvironmentVolume(ENV_VOLUME,420);
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
  cancelCpuRoll();
  winners.forEach(i=>{players[i].done=true;players[i].place=1;players[i].pendingKing=false;});
  running=false;busy=false;war=null;warShade.classList.remove('show');
  finalizeHumanRecords();
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
  board.querySelectorAll('.piece,.cushion,.war-line,.war-label,.war-flag').forEach(el=>el.remove());
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
  players.forEach((p,i)=>{const el=document.createElement('div');el.className=`player-box${running&&i===turnIndex&&!p.done?' on':''}`;el.innerHTML=`<b style="color:${p.color}">● ${p.name}</b>${p.isYou?'<span class="you">あなた</span>':''}<br>${RANKS[p.rank]}${p.pendingKing?'（王位未確定）':''}${p.cpu?'・自動':''}<br><span class="money">${Number(p.money||0).toLocaleString()}両</span>${p.carrier!==null&&p.carrier!==undefined?'<br><span class="onbu-note">おんぶ中</span>':''}${p.done?`<br><b>${p.place}位</b>`:''}`;root.appendChild(el);});
}
function renderLadder(){
  const root=document.querySelector('#rankRows');root.innerHTML='';
  for(let rank=0;rank<=12;rank++){
    const row=document.createElement('div');
    row.className='rank-row';
    const current=running?(war?currentWarPlayerIndex():turnIndex):-1;
    if(current>=0&&players[current].rank===rank){
      row.classList.add('current');row.style.setProperty('--hi',players[current].color);
    }
    row.appendChild(document.createTextNode(RANKS[rank]));
    const markers=document.createElement('div');markers.className='markers';
    players.forEach(p=>{if(p.rank===rank){const m=document.createElement('span');m.className='marker';m.style.background=p.color;markers.appendChild(m);}});
    row.appendChild(markers);root.appendChild(row);
  }
}
function currentWarPlayerIndex(){return war.order[war.turnCursor]??war.order[0];}
function nextPromotionDistance(pos){
  const mod=((pos%8)+8)%8;
  return mod===0?0:8-mod;
}
function warForecast(playerIndex,maxSteps=6){
  if(playerIndex<0||!players[playerIndex]||war)return null;
  const p=players[playerIndex];
  for(let step=1;step<=maxSteps;step++){
    const pos=(p.pos+step)%32;
    if(isCorner(pos))continue;
    const coord=COORDS[pos];
    const enemies=[];
    players.forEach((q,i)=>{
      if(i===playerIndex||q.done)return;
      const qc=COORDS[q.pos];
      const opposite=(coord[0]===0&&qc[0]===8&&coord[1]===qc[1])||
        (coord[0]===8&&qc[0]===0&&coord[1]===qc[1])||
        (coord[1]===0&&qc[1]===8&&coord[0]===qc[0])||
        (coord[1]===8&&qc[1]===0&&coord[0]===qc[0]);
      if(opposite)enemies.push(i);
    });
    if(enemies.length)return {step,enemies};
  }
  return null;
}
function updateAnticipation(index){
  if(!anticipationEl)return;
  anticipationEl.innerHTML='';
  board.querySelectorAll('.piece.war-forecast').forEach(el=>el.classList.remove('war-forecast'));
  if(!running||war||index<0||!players[index]||players[index].done)return;
  const p=players[index];
  const promotion=nextPromotionDistance(p.pos);
  if(promotion<=3){
    const el=document.createElement('span');el.className='promotion-near';
    el.textContent=promotion===0?'0で出世':`出世まで ${promotion}`;
    anticipationEl.appendChild(el);
  }
  const wf=warForecast(index,6);
  if(wf){
    const el=document.createElement('span');el.className='war-near';
    el.textContent=`戦争 ${wf.step}`;
    anticipationEl.appendChild(el);
    if(wf.step<=4){
      wf.enemies.forEach(enemy=>{
        board.querySelectorAll(`.piece[data-player="${enemy}"]`).forEach(piece=>piece.classList.add('war-forecast'));
      });
    }
  }
}
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
    turnBox.textContent=running?'ターン確認中…':'開始前';
    turnBox.style.borderColor='transparent';
    rollButton.disabled=true;
    battleGauge.classList.remove('show');
    if(running)setTimeout(repairTurnState,0);
    // 初回案内の表示状態はlocalStorageで管理。
  }
  renderPlayers();renderLadder();updateAnticipation(running&&p?index:-1);
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
    const movingMembers=stackMembers(movingBottom);
    moveStackTo(movingBottom,next);
    movingMembers.forEach(i=>{
      players[i].travelSteps=(players[i].travelSteps||0)+1;
      if(players[i].travelSteps%32===0){addMoney(i,LAP_BONUS,'一周');lapMoneySound();}
    });
    await showHand(next,playerIndex,true);
    renderPieces();rankStepSound(playerIndex);await sleep(190+Math.min(24,(players[playerIndex]?.rank||0)*2));
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
async function settleGolds(golds){
  await sleep(140);whoosh();
  const els=[...roller.querySelectorAll('.gold')];
  els.forEach((el,i)=>{
    const g=golds[i];
    el.className=`gold ${g.type==='side'?'side':g.type==='vertical'?'vertical':''}`;
    el.textContent=g.type==='back'?'':g.type==='face'?'金':'';
    el.setAttribute('aria-label',g.type==='side'?'横立ち 5':g.type==='vertical'?'縦立ち 10':g.type==='face'?'表 1':'裏 0');
    el.style.left=`${22+i*19}%`;
    el.style.top='54%';
    el.style.setProperty('--grot',`${Math.random()*18-9}deg`);
  });
  await sleep(560);thud();await sleep(60);
}

function promote(playerIndex,delta){const p=players[playerIndex];p.rank=clamp(p.rank+delta,0,12);p.pendingKing=p.rank===12;}
async function showRankChange(playerIndex,delta,label){
  const p=players[playerIndex],beforeRank=p.rank,before=RANKS[p.rank];
  promote(playerIndex,delta);
  const afterRank=p.rank,after=RANKS[p.rank];
  rankChangeSound(delta);
  if(afterRank>beforeRank)awardPromotion(playerIndex,beforeRank,afterRank,delta);
  await showEvent(label,`<div style="font-size:20px;font-weight:900;color:${p.color}">${p.name}<br>${before} → ${after}</div>`,760);
  log(`${p.name}：${before} → ${after}`);render();
}

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

  // 各プレイヤーの色の旗を「元の持ち場」に残す。
  // 往路は旗から離れ、復路は自分の旗へ戻るので方向が一目で分かる。
  const flagGroups=new Map();
  war.participants.forEach(index=>{
    const side=war.side.get(index);
    const path=side===0?war.pathA:war.pathB;
    const key=String(side);
    const list=flagGroups.get(key)||[];
    list.push({index,path});
    flagGroups.set(key,list);
  });
  flagGroups.forEach(items=>{
    items.forEach((item,j)=>{
      const off=offsetFor(j,items.length);
      const home=item.path[0];
      const ps=pctFromRC(home[0],home[1],[off[0],off[1]-1.1]);
      const flag=document.createElement('div');
      flag.className='war-flag';
      flag.style.left=ps.left;
      flag.style.top=ps.top;
      flag.style.setProperty('--flag',players[item.index].color);
      flag.title=`${players[item.index].name}の旗`;
      board.insertBefore(flag,warShade);
    });
  });

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
  render();await enterWarSound();await showEvent(participants.length===4?'乱戦！':'戦争',`<b>${participants.map(i=>players[i].name).join('・')}</b>`,800);busy=false;updateUI();if(players[currentWarPlayerIndex()].cpu)scheduleCpuRoll(650);
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
    const moneyTransfers=awardWarMoney(finish);
    for(let n=0;n<finish.length;n++){
      const playerIndex=finish[n],d=delta[n];
      if(d!==0)await showRankChange(playerIndex,d,resultLabel(d));
      else await showEvent('現状維持',`<b style="color:${players[playerIndex].color}">${players[playerIndex].name}</b>`,420);

      const gained=moneyTransfers.find(t=>t.winner===playerIndex);
      const lost=moneyTransfers.find(t=>t.loser===playerIndex);
      if(gained){
        await sleep(90);
        warGainSound();
        await sleep(820);
      }else if(lost){
        await sleep(90);
        warLossSound();
        await sleep(600);
      }
    }
    render();
    await sleep(180);
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
  do{war.turnCursor=(war.turnCursor+1)%war.order.length;}while(war.finish.includes(war.order[war.turnCursor]));busy=false;render();if(players[currentWarPlayerIndex()].cpu)scheduleCpuRoll(650);
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
    const effectiveTier=(war&&!p.cpu)?battleTier:0;
    const golds=goldRoll(effectiveTier);
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
    if(running){
      const idx=activeTurnIndex();
      if(idx>=0&&players[idx]?.cpu)scheduleCpuRoll(900);
    }
  }finally{
    setupGolds();
  }
}

function activeTurnIndex(){
  if(!running)return -1;
  if(war){
    if(!Array.isArray(war.order)||war.order.length===0)return -1;
    const i=war.order[war.turnCursor];
    return Number.isInteger(i)?i:-1;
  }
  return Number.isInteger(turnIndex)?turnIndex:-1;
}

function cancelCpuRoll(){
  if(cpuTimer!==null){
    clearTimeout(cpuTimer);
    cpuTimer=null;
  }
  cpuJobId++;
}

function scheduleCpuRoll(delay=650){
  if(cpuTimer!==null)clearTimeout(cpuTimer);
  const expectedIndex=activeTurnIndex();
  const expectedWar=war;
  const job=++cpuJobId;

  if(!running || expectedIndex<0 || !players[expectedIndex]?.cpu){
    cpuTimer=null;
    return;
  }

  cpuTimer=setTimeout(async()=>{
    cpuTimer=null;
    if(
      job!==cpuJobId ||
      !running ||
      busy ||
      war!==expectedWar ||
      activeTurnIndex()!==expectedIndex ||
      !players[expectedIndex]?.cpu
    ) return;

    await autoRoll(job,expectedIndex,expectedWar);
  },delay);
}

function repairTurnState(){
  if(repairingTurn||!running)return;
  repairingTurn=true;
  try{
    if(war){
      if(!Array.isArray(war.order)||war.order.length===0){
        console.error('Invalid war order; cancelling war safely');
        war=null;
        warShade.classList.remove('show');
      }else if(!Number.isInteger(war.turnCursor) || !war.order[war.turnCursor]){
        war.turnCursor=0;
      }
    }else if(!Number.isInteger(turnIndex) || !players[turnIndex] || players[turnIndex].done){
      const next=players.findIndex(p=>!p.done);
      if(next>=0)turnIndex=next;
    }
    busy=false;
    render();
    const idx=activeTurnIndex();
    if(idx>=0&&players[idx]?.cpu)scheduleCpuRoll(700);
  }finally{
    repairingTurn=false;
  }
}

async function autoRoll(job=cpuJobId,expectedIndex=activeTurnIndex(),expectedWar=war){
  if(
    job!==cpuJobId ||
    busy ||
    !running ||
    expectedIndex<0 ||
    activeTurnIndex()!==expectedIndex ||
    war!==expectedWar ||
    !players[expectedIndex]?.cpu
  ) return;

  spinGolds(Math.random()*6);
  gesture.lastSoundAt=0;

  for(let i=0;i<5;i++){
    if(
      job!==cpuJobId ||
      !running ||
      war!==expectedWar ||
      activeTurnIndex()!==expectedIndex
    ) return;

    woodRollTick(.45);
    await sleep(165+Math.random()*45);
  }

  if(
    job!==cpuJobId ||
    !running ||
    war!==expectedWar ||
    activeTurnIndex()!==expectedIndex
  ) return;

  // 戦争ゲージの高目補正は人間専用。CPUは戦争中も通常確率。
  await performRoll(0);
}
function nextTurn(){
  if(!running)return;
  cancelCpuRoll();
  do{turnIndex=(turnIndex+1)%players.length;}while(players[turnIndex].done);
  render();
  if(!players[turnIndex].cpu&&navigator.vibrate)navigator.vibrate(80);
  if(players[turnIndex].cpu)scheduleCpuRoll(650);
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
  woodRollTick(.55);
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
    if(audioEnabled&&audioContext&&audioContext.state==='running'){
      startEnvironmentEngine().catch(()=>{});
    }
  }else{
    stopEnvironmentEngine();
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
  let dl=document.querySelector('#profileNames');
  if(!dl){dl=document.createElement('datalist');dl.id='profileNames';document.body.appendChild(dl);}
  dl.innerHTML=loadProfiles().map(p=>`<option value="${p.name}"></option>`).join('');
  const root=document.querySelector('#nameGrid');
  root.innerHTML='';
  for(let i=0;i<4;i++){
    const card=document.createElement('div');
    card.className='name-card'+(i===0?' you-seat':'');
    const label=i===0
      ? `<b style="color:${COLORS[i]}">赤・左上</b><span class="seat-note">あなた</span>`
      : `<b style="color:${COLORS[i]}">席${i+1}</b>`;
    card.innerHTML=`${label}<input id="name${i}" list="profileNames" value="${NAME_POOL[i]}">`;
    root.appendChild(card);
  }
  randomNames();
}
async function orderPlayers(){let candidates=[0,1,2,3];while(true){const scored=candidates.map(i=>[i,totalGold(goldRoll())]);scored.forEach(([i,s])=>log(`順番決め：${players[i].name} = ${s}`));const max=Math.max(...scored.map(x=>x[1])),top=scored.filter(x=>x[1]===max).map(x=>x[0]);if(top.length===1){const firstSeat=players[top[0]].seat;players.sort((a,b)=>((a.seat-firstSeat+4)%4)-((b.seat-firstSeat+4)%4));turnIndex=0;await showEvent('先攻',`<b style="color:${players[0].color}">${players[0].name}</b><br>ここから右回り`,800);return;}candidates=top;log('1位同点。振り直し');}}



function normalizeViewportBeforePlay(){
  try{
    const active=document.activeElement;
    if(active && typeof active.blur==='function') active.blur();
  }catch(_){}
  // iPhone Safari may keep the focused-input scroll/zoom position for a moment.
  requestAnimationFrame(()=>{
    window.scrollTo(0,0);
    setTimeout(()=>window.scrollTo(0,0),120);
    setTimeout(()=>window.scrollTo(0,0),320);
  });
}


function ensurePlayHeaderVisible(){
  if(!playNav)return;
  playNav.hidden=false;
  playNav.style.display='';
  requestAnimationFrame(()=>{
    playNav.hidden=false;
    setTimeout(()=>{ playNav.hidden=false; },120);
    setTimeout(()=>{ playNav.hidden=false; },350);
  });
}

function setView(mode){
  document.body.classList.remove('title-mode','setup-mode','play-mode');
  document.body.classList.add(mode==='play'?'play-mode':'title-mode');

  if(mode==='play'){
    titleScreen.hidden=true;
    playNav.hidden=false;
    ensurePlayHeaderVisible();
  }else{
    titleScreen.hidden=false;
    playNav.hidden=true;
  }
  gameApp.hidden=false;
  window.scrollTo(0,0);
}
function goTitle(){
  if(running){
    const ok=window.confirm('ゲームを終了してタイトルへ戻りますか？\n途中終了の記録は保存されません。');
    if(!ok)return;
    cancelCpuRoll();
    running=false;
    busy=false;
    war=null;
    warShade.classList.remove('show');
    try{stopEnvironmentEngine();}catch(_){}
  }
  setView('title');
}
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
recordsButton.addEventListener('click',()=>{renderRecords();recordsModal.classList.add('show');recordsModal.setAttribute('aria-hidden','false');document.body.classList.add('rules-open');});
recordsClose.addEventListener('click',()=>{recordsModal.classList.remove('show');recordsModal.setAttribute('aria-hidden','true');document.body.classList.remove('rules-open');});
recordsModal.addEventListener('click',e=>{if(e.target===recordsModal)recordsClose.click();});
titleRulesButton.addEventListener('click',openRules);
titleRecordsButton.addEventListener('click',()=>recordsButton.click());
playBackButton.addEventListener('click',goTitle);
playRulesButton.addEventListener('click',openRules);
playRecordsButton.addEventListener('click',()=>recordsButton.click());
rulesButton.addEventListener('click',openRules);
rulesClose.addEventListener('click',closeRules);
rulesModal.addEventListener('click',event=>{
  if(event.target===rulesModal)closeRules();
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape')closeRules();
});

document.querySelector('#randomNames').addEventListener('click',randomNames);
document.querySelector('#startButton').addEventListener('click',async()=>{normalizeViewportBeforePlay();setView('play');cancelCpuRoll();await ensureAudio();const humans=Number(document.querySelector('#humanCount').value);players=[0,1,2,3].map(i=>{
  const name=document.querySelector(`#name${i}`).value||NAME_POOL[i];
  const cpu=i>=humans;
  return {name,seat:i,pos:CORNERS[i],rank:0,color:COLORS[i],sleeve:SLEEVES[i],cpu,isYou:i===0,
    done:false,place:null,pendingKing:false,carrier:null,money:0,travelSteps:0,
    gameEarned:0,gameStolen:0,gamePromotions:0,gameBigPromotions:0,gameWarWins:0,
    profileId:cpu?null:resolveProfile(name)};
});logEl.innerHTML='';resultEl.textContent='';war=null;running=false;busy=true;warShade.classList.remove('show');setupGolds();render();await orderPlayers();running=true;busy=false;render();if(!players[0].cpu&&navigator.vibrate)navigator.vibrate(80);if(players[0].cpu)scheduleCpuRoll(650);});
window.addEventListener('resize',setupGolds);

makeBoard();prepareNames();setupGolds();renderLadder();updateUI();updateRollHint();

window.addEventListener('error',e=>{resultEl.textContent='エラー：'+e.message;log('エラー：'+e.message);busy=false;try{render()}catch(_){}});
window.addEventListener('unhandledrejection',e=>{const msg=e.reason?.message||String(e.reason);resultEl.textContent='エラー：'+msg;log('エラー：'+msg);busy=false;try{render()}catch(_){}});

roller.addEventListener('touchmove',event=>{
  if(gesture.active)event.preventDefault();
},{passive:false});

setView('title');

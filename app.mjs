import {N,prizeOf,shuffle,makeCards,validState,newState,recordWinner,snapshot,validSnapshot,encodeWatch,decodeWatch} from './core.mjs';
const $=id=>document.getElementById(id), KEY='party-bingo-v1', pad=n=>String(n).padStart(2,'0');
let state, owner=false, spinning=false, activeView='game', filter='all', peer=null, connections=new Set(), shareGeneration=0, shareTimer, viewerConnection, viewerReconnect, lastContact=0, viewerData, lastQR='', celebrationTimer, frame, soundNodes=[];
let prefs={sound:true,volume:65,publicURL:''};
try { prefs={...prefs,...JSON.parse(localStorage.getItem('party-bingo-preferences')||'{}')}; } catch {}
const notify=text=>{$('notice').textContent=text;$('notice').hidden=!text;};
const nameOf=no=>state.names[no-1]||`参加者${pad(no)}`;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
function savePrefs(){try{localStorage.setItem('party-bingo-preferences',JSON.stringify(prefs));}catch{notify('設定を保存できません。このブラウザーの保存容量・プライベートモードをご確認ください。');}}
function commit(change){
 if(!owner||spinning){return false;}
 try {
  const disk=JSON.parse(localStorage.getItem(KEY)||'null');
  if(disk&&disk.revision>state.revision){state=disk;render();notify('別画面の変更を取り込みました。操作をもう一度お試しください。');return false;}
  const next=structuredClone(state); if(change(next)===false)return false;
  next.revision=state.revision+1;next.updated=Date.now();
  if(!validState(next))throw Error('invalid data');
  localStorage.setItem(KEY,JSON.stringify(next));state=next;render();broadcast();return true;
 }catch{notify('データを保存できません。操作は確定していません。ブラウザーの保存設定を確認し、データを保存してから再読み込みしてください。');return false;}
}
function ask(title,text,ok='確定する'){
 if($('confirmDialog').open)return Promise.resolve(false);
 $('dialogTitle').textContent=title;$('dialogText').textContent=text;$('dialogOK').textContent=ok;
 const d=$('confirmDialog');d.returnValue='';d.showModal();
 return new Promise(resolve=>d.addEventListener('close',()=>resolve(d.returnValue==='ok'),{once:true}));
}
function showView(view){activeView=view;document.querySelectorAll('#host>.view').forEach(v=>v.classList.toggle('active',v.id===view));document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));if(view==='setup')renderNames();if(view==='print')renderPrint();}
function renderBoard(target,drawn){
 const set=new Set(drawn),last=drawn.at(-1),frag=document.createDocumentFragment();
 for(let c=0;c<5;c++){
  frag.append(el('span','group-letter','BINGO'[c]));
  for(let i=1;i<=15;i++){const n=c*15+i,d=el('span','num'+(set.has(n)?' on':'')+(last===n?' latest':''),n);d.dataset.group=c;d.style.setProperty('--r',i);d.setAttribute('aria-label',`${n} ${set.has(n)?'抽選済み':'未抽選'}${last===n?' 最新':''}`);frag.append(d);}
 }
 target.replaceChildren(frag);
}
function renderHistory(target,drawn){target.replaceChildren(...drawn.slice().reverse().map((n,i)=>{const li=el('li');li.append(el('small','',`${drawn.length-i}回目`),el('b','',n));return li;}));}
function render(){
 const count=state.winners.length,finished=count===N;
 $('ball').textContent=state.drawn.at(-1)||'?';$('drawCount').textContent=state.drawn.length;$('progress').textContent=`当選 ${count} / 27人`;
 $('remaining').textContent=`残り${N-count}人`;$('historyCount').textContent=`${state.drawn.length}件`;$('historyEmpty').hidden=state.drawn.length>0;
 $('draw').disabled=!owner||spinning||finished||state.drawn.length===75;
 $('draw').textContent=finished?'全員ビンゴ！':state.drawn.length===75?'全75番号を抽選済み':'番号を引く';if(!finished&&state.drawn.length<75)$('draw').append(el('kbd','','Space'));
 $('drawHint').textContent=finished?'27人全員の当選が確定しました':state.drawn.length===75?'残りの方のビンゴを確認してください':'1〜75の番号を重複なしで抽選';
 $('nextPrize').replaceChildren(finished?'全員の当選が確定！':'次のビンゴは ');if(!finished)$('nextPrize').append(el('strong','',`${prizeOf(count+1)}等`));
 $('nextRank').textContent=finished?'おめでとうございます！':`${count+1}人目の当選`;
 $('prizePlan').replaceChildren(...['1位','2〜3位','4〜6位','7〜10位','11〜27位'].map((r,i)=>{const p=el('div',!finished&&prizeOf(count+1)===i+1?'current':'',`${i+1}等`);p.append(el('small','',r));return p;}));
 renderBoard($('board'),state.drawn);renderHistory($('history'),state.drawn);renderPeople();
 $('winners').replaceChildren(...state.winners.map((w,i)=>{const li=el('li');li.append(el('span','rank',`${i+1}位`),el('span',`prize-badge p${prizeOf(i+1)}`,`${prizeOf(i+1)}等`),el('span','winner-name',nameOf(w.no)));return li;}));
 if(!count)$('winners').append(el('p','empty','最初のビンゴを待っています。'));
 $('winnerCount').textContent=`${count}人`;$('undoWinner').disabled=!owner||spinning||!count;
 $('undoDraw').disabled=!owner||spinning||!state.drawn.length||state.winners.some(w=>w.at>=state.drawn.length);
 $('celebrate').disabled=!owner||spinning;$('testSound').disabled=!owner||spinning;
 for(const id of ['resetResults','resetPeople','resetAll','applyNames','importData'])$(id).disabled=!owner||spinning;
 renderQR();
}
function renderPeople(){
 const q=$('search').value.trim().toLowerCase();const nodes=[];
 for(let i=1;i<=N;i++){
  const rank=state.winners.findIndex(w=>w.no===i)+1,won=rank>0;
  if(filter==='waiting'&&won||filter==='won'&&!won||q&&!`${nameOf(i)} ${i} ${pad(i)}`.toLowerCase().includes(q))continue;
  const row=el('label','person'+(won?' won':'')),check=el('input');check.type='checkbox';check.checked=won;check.disabled=won||!owner||spinning;check.setAttribute('aria-label',`${nameOf(i)}をビンゴ当選にする`);
  check.addEventListener('change',()=>{check.checked=false;declare(i);});
  row.append(check,el('span','person-no',pad(i)),el('span','person-name',nameOf(i)));
  if(won)row.append(el('span','won-label',`${rank}位・${prizeOf(rank)}等`));nodes.push(row);
 }
 $('participants').replaceChildren(...nodes);if(!nodes.length)$('participants').append(el('p','empty','該当する参加者はいません。'));
}
async function declare(no){
 if(!owner||spinning||state.winners.some(w=>w.no===no))return;
 const rank=state.winners.length+1,revision=state.revision;
 if(await ask('ビンゴの当選を確定',`${nameOf(no)} さん（No.${pad(no)}）\n${rank}位 ／ ${prizeOf(rank)}等\n\n紙のカードを確認してから確定してください。`,'当選を確定')){
  if(state.revision!==revision){notify('確認中にデータが変わりました。もう一度チェックしてください。');return;}
  if(commit(s=>recordWinner(s,no)))notify(`${nameOf(no)} さん：${rank}位・${prizeOf(rank)}等で確定。右下のボタンでお祝いできます。`);
 }
}
async function draw(){
 if($('draw').disabled||$('confirmDialog').open||!$('celebration').hidden)return;
 spinning=true;$('draw').disabled=true;renderPeople();['undoDraw','undoWinner','celebrate','testSound','resetResults','resetPeople','resetAll','applyNames','importData'].forEach(id=>$(id).disabled=true);
 const rest=shuffle(Array.from({length:75},(_,i)=>i+1).filter(n=>!state.drawn.includes(n))),number=rest[0],start=performance.now();
 try { await prepareAudio(); }catch{}
 $('ball').classList.add('rolling');$('ball').setAttribute('aria-live','off');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 function tick(){const elapsed=performance.now()-start;if(elapsed<(reduced?300:2200)){$('ball').textContent=rest[Math.floor(Math.random()*rest.length)];tickSound();setTimeout(tick,45+elapsed/15);return;}
  spinning=false;$('ball').classList.remove('rolling');$('ball').setAttribute('aria-live','polite');
  if(commit(s=>{if(s.drawn.includes(number))return false;s.drawn.push(number);}))resultSound();else render();
 }
 tick();
}
function renderNames(){
 $('nameList').replaceChildren(...state.names.map((name,i)=>{const label=el('label','name-row');label.append(el('span','',pad(i+1)));const input=el('input');input.type='text';input.value=name;input.maxLength=60;input.placeholder=`参加者${pad(i+1)}`;input.disabled=!owner;input.setAttribute('aria-label',`参加者${pad(i+1)}の名前`);input.addEventListener('input',()=>{if(commit(s=>s.names[i]=input.value.trim()))$('saved').textContent='名前を保存しました。';});label.append(input);return label;}));
 $('sound').checked=!!prefs.sound;$('volume').value=prefs.volume;$('publicURL').value=prefs.publicURL||'';
}
function renderPrint(){
 const sheets=[];
 for(let page=0;page<3;page++){
  const sheet=el('div','print-sheet');
  for(let j=0;j<9;j++){const i=page*9+j,card=el('article','pcard');card.append(el('div','phead',`忘年会ビンゴ No.${pad(i+1)}`),el('div','pname',`名前：${state.names[i]||''}`));const table=el('table'),head=el('tr');for(const c of 'BINGO')head.append(el('th','',c));table.append(head);for(let r=0;r<5;r++){const tr=el('tr');for(let c=0;c<5;c++){const n=state.cards[i][r*5+c];tr.append(el('td',n===null?'free':'',n??'FREE'));}table.append(tr);}card.append(table);sheet.append(card);}sheets.push(sheet);
 }
 $('printArea').replaceChildren(...sheets);
}
function baseURL(){const u=new URL(prefs.publicURL||location.href);u.hash='';u.search='';if(!['https:','http:'].includes(u.protocol))throw Error('public url required');return u.href;}
function viewerURL(){return `${baseURL()}#watch=${encodeWatch(state)}`;}
function renderQR(){
 try {const url=viewerURL();if(lastQR===url)return;lastQR=url;const qr=qrcode(0,'M');qr.addData(url,'Byte');qr.make();$('qr').innerHTML=qr.createSvgTag({cellSize:3,margin:12,scalable:true});}
 catch{$('qr').replaceChildren(el('p','helper','GitHub Pagesの公開URLで開くとQRが表示されます。'));}
}
function shareStatus(text){if($('shareState'))$('shareState').textContent=text;}
function cleanupShare(){shareGeneration++;clearInterval(shareTimer);clearTimeout(viewerReconnect);if(viewerConnection)viewerConnection.close();viewerConnection=null;for(const c of connections)c.close();connections.clear();if(peer)peer.destroy();peer=null;}
function broadcast(){const data=snapshot(state);for(const c of connections){if(c.open){try{c.send(data);}catch{connections.delete(c);}}}}
function startHostSharing(){
 cleanupShare();const gen=shareGeneration;
 if(!owner)return;
 if(typeof Peer==='undefined'){shareStatus('自動更新を開始できません。最新QRで履歴を共有できます');return;}
 if(location.protocol==='file:'){shareStatus('GitHub Pages公開後に共有できます');return;}
 shareStatus('スマホとの自動更新を準備中');
 try {peer=new Peer(`party-bingo-${state.room}`,{debug:0,secure:true});}catch{shareStatus('自動更新は利用できません。最新QRを読み取ってください');return;}
 const current=peer;
 peer.on('open',()=>{if(gen!==shareGeneration)return;shareStatus(`共有受付中・接続 ${connections.size}台`);});
 peer.on('connection',c=>{
  if(gen!==shareGeneration||connections.size>=60){c.close();return;}
  connections.add(c);
  const timeout=setTimeout(()=>{if(!c.open){connections.delete(c);c.close();}},15000);
  c.on('open',()=>{clearTimeout(timeout);if(gen!==shareGeneration){c.close();return;}c.send(snapshot(state));shareStatus(`共有受付中・接続 ${[...connections].filter(x=>x.open).length}台`);});
  const close=()=>{clearTimeout(timeout);connections.delete(c);if(gen===shareGeneration)shareStatus(`共有受付中・接続 ${[...connections].filter(x=>x.open).length}台`);};c.on('close',close);c.on('error',close);
  // Incoming data is deliberately ignored: viewers have no mutation channel.
 });
 peer.on('disconnected',()=>{if(gen!==shareGeneration)return;shareStatus('共有を再接続中。最新QRから履歴は開けます');setTimeout(()=>{if(gen===shareGeneration&&!current.destroyed)try{current.reconnect();}catch{}},3000);});
 peer.on('error',e=>{if(gen!==shareGeneration)return;shareStatus(e.type==='unavailable-id'?'共有IDは別画面で使用中。最新QRで履歴を共有できます':'自動更新は未接続。最新QRで履歴を共有できます');});
 shareTimer=setInterval(broadcast,5000);
}
function renderViewer(){const data=viewerData;$('viewerBall').textContent=data.drawn.at(-1)||'?';$('viewerCount').textContent=`${data.drawn.length} / 75 番号`;$('viewerHistoryCount').textContent=`${data.drawn.length}件`;renderBoard($('viewerBoard'),data.drawn);renderHistory($('viewerHistory'),data.drawn);$('updated').textContent=`履歴の更新日時：${new Date(data.updated).toLocaleString('ja-JP')}`;}
function viewerStatus(text,live=false){$('viewerStatus').textContent=text;$('viewerStatus').className='viewer-status '+(live?'live':'stale');}
function startViewerSharing(){
 cleanupShare();const gen=shareGeneration;
 viewerStatus('QR読み取り時の履歴を表示中。自動更新に接続しています。');lastContact=0;
 if(typeof Peer==='undefined'){viewerStatus('自動更新を利用できません。最新のQRを読み直してください。');return;}
 try{peer=new Peer(`party-view-${crypto.randomUUID()}`,{debug:0,secure:true});}catch{viewerStatus('この端末は自動更新に対応していません。最新のQRを読み直してください。');return;}
 const current=peer;
 const scheduleRetry=()=>{if(gen!==shareGeneration)return;clearTimeout(viewerReconnect);viewerReconnect=setTimeout(()=>{if(gen!==shareGeneration)return;if(current.disconnected){try{current.reconnect();}catch{}scheduleRetry();}else if(current.open)connect();},6000);};
 const connect=()=>{
  if(gen!==shareGeneration)return;if(viewerConnection){const old=viewerConnection;viewerConnection=null;old.close();}
  const c=current.connect(`party-bingo-${viewerData.room}`,{serialization:'json',reliable:true});viewerConnection=c;
  const timeout=setTimeout(()=>{if(gen===shareGeneration&&lastContact===0){viewerStatus('自動更新に接続できません。最新のQRを読み直すと新しい履歴を表示できます。');c.close();scheduleRetry();}},16000);
  c.on('open',()=>{if(gen!==shareGeneration)return;viewerStatus('司会者と接続中。最新の履歴を待っています。');});
  c.on('data',p=>{
   if(gen!==shareGeneration||!validSnapshot(p,viewerData.room)||p.revision<viewerData.revision)return;
   clearTimeout(timeout);lastContact=Date.now();viewerData=p;renderViewer();viewerStatus('自動更新中・司会者の抽選と連動しています',true);
   try{history.replaceState(null,'',`#watch=${encodeWatch(p)}`);}catch{}
  });
  const disconnected=()=>{clearTimeout(timeout);if(gen!==shareGeneration||viewerConnection!==c)return;viewerStatus('接続が切れました。表示中の履歴は最終受信時点です。再接続しています。');scheduleRetry();};
  c.on('close',disconnected);c.on('error',disconnected);
 };
 peer.on('open',()=>{viewerStatus('番号履歴を受信する接続を開始しています。');connect();});peer.on('error',()=>{if(gen!==shareGeneration)return;viewerStatus('自動更新は未接続です。最新のQRを読み直すと新しい履歴を表示できます。');scheduleRetry();});
 peer.on('disconnected',()=>{if(gen!==shareGeneration)return;viewerStatus('再接続中。表示中の履歴は最終受信時点です。');scheduleRetry();});
 const waitingSince=Date.now();
 shareTimer=setInterval(()=>{if(!lastContact&&Date.now()-waitingSince>15000)viewerStatus('自動更新に接続できません。最新のQRを読み直すと新しい履歴を表示できます。');if(lastContact&&Date.now()-lastContact>18000)viewerStatus('更新の受信が止まっています。接続をやり直すか、最新のQRを読み直してください。');},4000);
}
let audioContext;
async function prepareAudio(){if(!prefs.sound)return null;const A=window.AudioContext||window.webkitAudioContext;if(!A)return null;audioContext??=new A();if(audioContext.state==='suspended')await audioContext.resume();return audioContext;}
function tone(freq,at,duration,type='triangle',gain=.08){if(!audioContext||!prefs.sound)return;const o=audioContext.createOscillator(),g=audioContext.createGain();o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(.001,at);g.gain.linearRampToValueAtTime(gain*Number(prefs.volume)/100,at+.025);g.gain.exponentialRampToValueAtTime(.001,at+duration);o.connect(g).connect(audioContext.destination);o.start(at);o.stop(at+duration+.03);soundNodes.push(o);o.onended=()=>{o.disconnect();g.disconnect();soundNodes=soundNodes.filter(x=>x!==o);};}
function noise(at,duration,gain=.06){if(!audioContext||!prefs.sound)return;const b=audioContext.createBuffer(1,Math.ceil(audioContext.sampleRate*duration),audioContext.sampleRate),a=b.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=(Math.random()*2-1);const s=audioContext.createBufferSource(),f=audioContext.createBiquadFilter(),g=audioContext.createGain();f.type='highpass';f.frequency.value=1800;s.buffer=b;g.gain.setValueAtTime(gain*Number(prefs.volume)/100,at);g.gain.exponentialRampToValueAtTime(.001,at+duration);s.connect(f).connect(g).connect(audioContext.destination);s.start(at);soundNodes.push(s);s.onended=()=>{s.disconnect();f.disconnect();g.disconnect();soundNodes=soundNodes.filter(x=>x!==s);};}
function stopSound(){for(const n of soundNodes)try{n.stop();}catch{}soundNodes=[];}
function tickSound(){if(audioContext)tone(600,audioContext.currentTime,.035,'sine',.025);}
function resultSound(){if(audioContext){tone(880,audioContext.currentTime,.35,'triangle',.11);tone(1318.5,audioContext.currentTime+.12,.6,'triangle',.09);}}
async function fanfare(){
 try{const a=await prepareAudio();if(!a)return;stopSound();const t=a.currentTime+.04;
  const melody=[[523.25,0,.18],[523.25,.22,.18],[523.25,.44,.2],[659.25,.7,.36],[783.99,1.12,.35],[1046.5,1.55,.7],[987.77,2.3,.25],[1046.5,2.6,1.6]];
  melody.forEach(([f,at,d])=>{tone(f,t+at,d,'sawtooth',.045);tone(f/2,t+at,d,'triangle',.07);});
  [[0,[130.81,261.63,329.63,392]],[.7,[174.61,349.23,440,523.25]],[1.55,[196,392,493.88,587.33]],[2.6,[130.81,261.63,329.63,392,523.25]]].forEach(([at,chord])=>chord.forEach(f=>tone(f,t+at,at===2.6?1.9:.6,'triangle',.035)));
  for(let i=0;i<14;i++)noise(t+i*.11,.07,.025+i*.0015);noise(t+1.55,1.1,.07);noise(t+2.6,1.8,.1);
 }catch{notify('音を再生できません。端末の音量・消音設定を確認し、もう一度ボタンを押してください。');}
}
function confetti(){
 cancelAnimationFrame(frame);const canvas=$('confetti'),ctx=canvas.getContext('2d');if(!ctx||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const w=innerWidth,h=innerHeight,dpr=Math.min(devicePixelRatio||1,2);canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);const colors=['#ffbf45','#7947e8','#fa7b91','#42c7b4','#5eabed'];
 const pieces=Array.from({length:190},()=>({x:w/2,y:h*.4,vx:(Math.random()-.5)*19,vy:-Math.random()*17-3,r:Math.random()*6.28,color:colors[Math.floor(Math.random()*5)],size:5+Math.random()*7}));const start=performance.now();let prev=start;
 function animate(now){const dt=Math.min(2,(now-prev)/16.67);prev=now;ctx.clearRect(0,0,w,h);for(const p of pieces){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=.15*dt;p.r+=.07*dt;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.r);ctx.fillStyle=p.color;ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size*.5);ctx.restore();}if(now-start<6500)frame=requestAnimationFrame(animate);else ctx.clearRect(0,0,w,h);}frame=requestAnimationFrame(animate);
}
function celebrate(){
 const w=state.winners.at(-1),rank=state.winners.length;$('celebrationName').textContent=w?`${nameOf(w.no)} さん`:'おめでとうございます！';$('celebrationPrize').textContent=w?`${rank}位・${prizeOf(rank)}等 当選！`:'ビンゴ！';$('celebration').hidden=false;$('closeCelebration').focus();confetti();fanfare();clearTimeout(celebrationTimer);celebrationTimer=setTimeout(closeCelebration,7500);
}
function closeCelebration(){$('celebration').hidden=true;clearTimeout(celebrationTimer);stopSound();cancelAnimationFrame(frame);const c=$('confetti');c.getContext('2d')?.clearRect(0,0,c.width,c.height);$('celebrate').focus();}
async function reset(kind){
 const configs={results:['抽選・当選結果をリセット','すべての抽選番号と当選記録を削除します。\n参加者名・印刷カードは残ります。'],people:['参加者データをリセット','27人の名前と当選記録を削除します。\n抽選番号と印刷カードは残ります。'],all:['すべてリセット','名前・抽選・当選記録を削除し、カードも新しくします。\n配布済みの印刷カードは使い直せません。']};
 if(await ask(...configs[kind],'リセットする')){if(commit(s=>{s.winners=[];if(kind!=='people')s.drawn=[];if(kind!=='results')s.names=Array(N).fill('');if(kind==='all')s.cards=makeCards();})){renderNames();notify('リセットしました。');}}
}
function initHostEvents(){
 document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
 $('draw').onclick=draw;$('celebrate').onclick=celebrate;$('closeCelebration').onclick=closeCelebration;
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('celebration').hidden){closeCelebration();return;}if(e.code==='Space'&&!e.repeat&&activeView==='game'&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&!/INPUT|TEXTAREA|BUTTON|SELECT|SUMMARY/.test(e.target.tagName)&&!e.target.isContentEditable&&!$('confirmDialog').open&&$('celebration').hidden){e.preventDefault();draw();}});
 $('search').oninput=renderPeople;
 for(const [id,value]of [['filterAll','all'],['filterWaiting','waiting'],['filterWon','won']])$(id).onclick=()=>{filter=value;['filterAll','filterWaiting','filterWon'].forEach(x=>$(x).classList.toggle('active',x===id));renderPeople();};
 $('undoWinner').onclick=async()=>{const w=state.winners.at(-1);if(w&&await ask('直前の当選を取り消す',`${nameOf(w.no)} さんの当選記録を取り消し、未当選に戻します。`,'取り消す'))commit(s=>s.winners.pop());};
 $('undoDraw').onclick=async()=>{const n=state.drawn.at(-1);if(n&&await ask('直前の抽選を取り消す',`番号 ${n} を履歴から削除し、抽選候補に戻します。スマホにも反映します。`,'取り消す'))commit(s=>{if(s.winners.some(w=>w.at>=s.drawn.length))return false;s.drawn.pop();});};
 $('applyNames').onclick=async()=>{const lines=$('bulkNames').value.replaceAll('\r','').trim().split('\n').map(x=>x.trim());if(!lines[0]||lines.length>N||lines.some(x=>x.length>60)){notify('名前は1行1人、27人以内・各60文字以内で入力してください。');return;}if(await ask('名前をまとめて反映',`${lines.length}人分をNo.01から順に反映します。残りは空欄になります。`,'反映する')){if(commit(s=>s.names=Array.from({length:N},(_,i)=>lines[i]||''))){renderNames();notify('名前を反映しました。');}}};
 $('sound').onchange=e=>{prefs.sound=e.target.checked;if(!prefs.sound)stopSound();savePrefs();};$('volume').oninput=e=>{prefs.volume=Number(e.target.value);savePrefs();};$('testSound').onclick=fanfare;
 $('publicURL').onchange=e=>{const v=e.target.value.trim();try{if(v){const u=new URL(v);if(u.protocol!=='https:')throw Error();}prefs.publicURL=v;savePrefs();lastQR='';renderQR();}catch{notify('公開URLは https:// で始まるURLを入力してください。');}};
 $('retryShare').onclick=startHostSharing;
 $('copyLink').onclick=async()=>{try{const url=viewerURL();try{await navigator.clipboard.writeText(url);notify('参加者用リンクをコピーしました。');}catch{await ask('参加者用リンク',url,'閉じる');}}catch{notify('GitHub Pagesで公開したURLから開いてください。');}};
 $('exportData').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=`bingo-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 $('importData').onclick=()=>$('importFile').click();$('importFile').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;try{if(f.size>1000000)throw Error();const data=JSON.parse(await f.text());if(!validState(data))throw Error();if(await ask('保存データを読み込む','現在の名前・抽選・当選・カードを保存データで上書きします。','読み込む')){if(commit(s=>{s.names=data.names;s.drawn=data.drawn;s.winners=data.winners;s.cards=data.cards;})){renderNames();notify('保存データを読み込みました。');}}}catch{notify('このアプリで保存した正しいJSONデータを選んでください。');}};
 $('resetResults').onclick=()=>reset('results');$('resetPeople').onclick=()=>reset('people');$('resetAll').onclick=()=>reset('all');$('printBtn').onclick=()=>window.print();
 $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{notify('このブラウザーでは全画面表示を利用できません。');}};
 window.addEventListener('storage',e=>{if(e.key===KEY&&e.newValue){try{const s=JSON.parse(e.newValue);if(validState(s)&&!spinning){state=s;render();if(activeView==='setup')renderNames();}}catch{}}});
 window.addEventListener('beforeprint',renderPrint);
}
async function initHost(){
 $('host').hidden=false;
 try {const raw=localStorage.getItem(KEY);if(raw){state=JSON.parse(raw);if(!validState(state)){state=null;notify('保存データの形式を確認できません。元データは上書きしていません。保存データを読み込むか、リセットしてください。');}}}catch{notify('保存データを読み込めませんでした。');}
 if(!state){state=newState();try{const oldNames=JSON.parse(localStorage.getItem('bingo-names')||'null');if(Array.isArray(oldNames))state.names=Array.from({length:N},(_,i)=>typeof oldNames[i]==='string'?oldNames[i].slice(0,60):'');}catch{}}
 initHostEvents();renderNames();render();
 const becomeOwner=()=>{owner=true;try{if(!localStorage.getItem(KEY))localStorage.setItem(KEY,JSON.stringify(state));}catch{notify('自動保存できません。ブラウザーの保存設定を確認してください。');}renderNames();render();startHostSharing();};
 if(navigator.locks){navigator.locks.request('party-bingo-host',{ifAvailable:true},async lock=>{if(!lock){notify('別のタブで進行画面を開いています。操作する場合はそちらを閉じてから、この画面を再読み込みしてください。');return;}becomeOwner();await new Promise(resolve=>window.addEventListener('pagehide',resolve,{once:true}));});}else becomeOwner();
}
async function boot(){
 if(location.hash.startsWith('#watch=')){
  document.body.classList.add('viewer-mode');$('viewer').hidden=false;
  try{viewerData=decodeWatch(location.hash.slice(7));renderViewer();$('viewerRetry').onclick=startViewerSharing;startViewerSharing();}
  catch{viewerStatus('閲覧リンクが正しくありません。メイン画面のQRをもう一度読み取ってください。');$('viewerRetry').hidden=true;}
 }else await initHost();
}
window.addEventListener('hashchange',()=>location.reload());
window.addEventListener('pagehide',cleanupShare);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&viewerData&&(!lastContact||Date.now()-lastContact>18000))startViewerSharing();});
boot();

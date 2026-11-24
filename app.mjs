import {N,prizeOf,shuffle,makeCards,newState,validState,recordWinner,randomID} from './core.mjs';
import {recentHistory,publicSnapshot,validPublic,encodePublic,decodePublic} from './share-core.mjs';
const $=id=>document.getElementById(id), KEY='party-bingo-v1', PREF='party-bingo-screen-prefs', pad=n=>String(n).padStart(2,'0');
const isViewer=new URLSearchParams(location.search).get('view')==='watch';
let state,viewData,owner=false,peopleOpen=false,spinning=false,qrURL='',qrTimer,peer=null,peers=new Set(),shareEpoch=0,heartbeat,retryTimer,viewerConn=null,lastReceived=0,viewerPending=false,frame,renderedQRRevision=-1;
const memory=new Map();let persistent=true;
const storage={get(key){if(!persistent)return memory.get(key)||null;try{const v=localStorage.getItem(key);if(v!==null)memory.set(key,v);return v;}catch{persistent=false;return memory.get(key)||null;}},set(key,value){memory.set(key,value);if(persistent)try{localStorage.setItem(key,value);}catch{persistent=false;}}};
let prefs={sound:true,volume:75,publicURL:''};try{prefs={...prefs,...JSON.parse(storage.get(PREF)||'{}')};}catch{}
const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const nameOf=(data,no)=>data.names[no-1]||`参加者${pad(no)}`;
const notify=text=>{$('notice').textContent=text;};
const savePrefs=()=>storage.set(PREF,JSON.stringify(prefs));
function storageStatus(){$('saveStatus').textContent=persistent?'このブラウザーへ自動保存':'一時保存モード：終了前に「データを保存」でバックアップしてください。';}
function commit(change){
 if(!owner||spinning)return false;
 try{
  let disk=null;try{disk=JSON.parse(storage.get(KEY)||'null');}catch{}
  if(validState(disk)&&disk.revision>state.revision){state=disk;renderHost();notify('別画面の変更を取り込みました。操作をもう一度お試しください。');return false;}
  const next=structuredClone(state);if(change(next)===false)return false;
  next.revision=state.revision+1;next.updated=Date.now();if(!validState(next))throw Error('invalid state');
  storage.set(KEY,JSON.stringify(next));state=next;renderHost();broadcast();storageStatus();return true;
 }catch{notify('操作を確定できませんでした。保存データを確認してください。');return false;}
}
function ask(title,text,ok='確定する'){
 const d=$('confirmDialog');if(d.open)return Promise.resolve(false);
 $('confirmTitle').textContent=title;$('confirmText').textContent=text;$('confirmOK').textContent=ok;d.returnValue='';d.showModal();
 return new Promise(resolve=>d.addEventListener('close',()=>resolve(d.returnValue==='ok'),{once:true}));
}
function renderBoard(target,drawn){
 const called=new Set(drawn),last=drawn.at(-1),fragment=document.createDocumentFragment();
 for(let c=0;c<5;c++){
  fragment.append(node('span',`board-letter g${c}`,'BINGO'[c]));
  for(let r=1;r<=15;r++){const number=c*15+r,n=node('span','num'+(called.has(number)?' on':'')+(last===number?' latest':''),number);n.style.setProperty('--c',c+1);n.style.setProperty('--r',r);n.setAttribute('aria-label',`${number} ${called.has(number)?'抽選済み':'未抽選'}${last===number?' 最新':''}`);fragment.append(n);}
 }
 target.replaceChildren(fragment);
}
function renderHistory(target,drawn){
 const recent=recentHistory(drawn);target.replaceChildren(...Array.from({length:5},(_,i)=>{const li=node('li',recent[i]?'':'empty-history');li.append(node('small','',recent[i]?`${recent[i].order}回目`:'—'),node('b','',recent[i]?.number??'—'));return li;}));
}
function participantResult(data,no){const rank=data.winners.findIndex(w=>w.no===no)+1;const result=node('span','person-result');if(rank)result.append(node('strong','',`${prizeOf(rank)}等`),node('small','',`${rank}位・BINGO`));else result.append(node('span','','未当選'));return {rank,result};}
function renderPeople(target,data,interactive){
 target.replaceChildren(...Array.from({length:N},(_,i)=>{
  const no=i+1,{rank,result}=participantResult(data,no),label=node(interactive?'label':'div',interactive?'person-card'+(rank?' won':''):'mobile-person'+(rank?' won':''));
  if(interactive){const check=node('input');check.type='checkbox';check.checked=rank>0;check.disabled=!owner||!!rank||spinning;check.setAttribute('aria-label',`${nameOf(data,no)}をビンゴ当選にする`);check.onchange=()=>{check.checked=false;declare(no);};label.append(check);}
  const name=node('span','person-name',nameOf(data,no));name.title=nameOf(data,no);label.append(node('span','person-no',pad(no)),name,result);return label;
 }));
}
function renderHost(){
 const count=state.winners.length,finished=count===N;
 if(!spinning)$('ball').textContent=state.drawn.at(-1)||'?';$('drawCount').textContent=state.drawn.length;
 $('nextLabel').textContent=finished?'27人全員':'次のビンゴは';$('nextPrize').classList.toggle('finished-grade',finished);
 $('nextPrize').replaceChildren(finished?'ビンゴ！':String(prizeOf(count+1)));if(!finished)$('nextPrize').append(node('span','','等'));
 $('nextRank').textContent=finished?'おめでとうございます':`${count+1}位の当選`;
 $('remaining').replaceChildren('残り ',node('strong','',N-count),' 人');
 $('peopleSummary').textContent=`当選 ${count} / 27人`;
 const ranges=['1位','2〜3位','4〜6位','7〜10位','11〜27位'];
 $('prizePlan').replaceChildren(...ranges.map((r,i)=>{const e=node('div',!finished&&prizeOf(count+1)===i+1?'current':'',`${i+1}等`);e.append(node('small','',r));return e;}));
 renderBoard($('board'),state.drawn);renderHistory($('history'),state.drawn);renderPeople($('peopleGrid'),state,true);
 $('draw').disabled=!owner||spinning||finished||state.drawn.length>=75;
 $('draw').replaceChildren(finished?'全員ビンゴ！':state.drawn.length===75?'全75番号を抽選済み':'番号を引く');if(!finished&&state.drawn.length<75)$('draw').append(node('kbd','','Space'));
 $('bingo').disabled=!owner||spinning||!count;
 $('undoWinner').disabled=!owner||spinning||!count;$('undoDraw').disabled=!owner||spinning||!state.drawn.length||state.winners.some(w=>w.at>=state.drawn.length);
 ['applyNames','importData','resetResults','resetPeople','resetAll'].forEach(id=>$(id).disabled=!owner||spinning);
 clearTimeout(qrTimer);qrTimer=setTimeout(renderQR,180);
}
function togglePeople(){peopleOpen=!peopleOpen;$('gameView').hidden=peopleOpen;$('peopleView').hidden=!peopleOpen;$('togglePeople').textContent=peopleOpen?'番号画面に戻る':'参加者チェック';$('togglePeople').setAttribute('aria-pressed',String(peopleOpen));}
async function declare(no){
 if(!owner||spinning||state.winners.some(w=>w.no===no))return;
 const revision=state.revision,rank=state.winners.length+1;
 if(await ask('ビンゴの当選を確定',`${nameOf(state,no)} さん\n${rank}位 ／ ${prizeOf(rank)}等\n\n紙のカードを確認してから確定してください。`,'当選を確定')){
  if(revision!==state.revision){notify('確認中にデータが変わりました。もう一度チェックしてください。');return;}
  if(commit(s=>recordWinner(s,no)))notify(`${nameOf(state,no)} さん・${prizeOf(rank)}等で確定。「ビンゴ！」でお祝いできます。`);
 }
}
let audioContext;
function tickSound(final=false){
 if(!prefs.sound)return;
 try{audioContext??=new(window.AudioContext||window.webkitAudioContext)();if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});const oscillator=audioContext.createOscillator(),gain=audioContext.createGain(),time=audioContext.currentTime,duration=final?.35:.035;oscillator.type='sine';oscillator.frequency.value=final?1174.7:680;gain.gain.setValueAtTime((final?.12:.035)*Number(prefs.volume)/100,time);gain.gain.exponentialRampToValueAtTime(.001,time+duration);oscillator.connect(gain).connect(audioContext.destination);oscillator.start(time);oscillator.stop(time+duration);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};}catch{}
}
function draw(){
 if($('draw').disabled||$('confirmDialog').open||$('settingsDialog').open||$('qrDialog').open||$('celebration').open)return;
 if(peopleOpen)togglePeople();
 spinning=true;renderHost();const rest=shuffle(Array.from({length:75},(_,i)=>i+1).filter(n=>!state.drawn.includes(n))),selected=rest[0],start=performance.now(),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 $('ball').classList.add('rolling');$('ball').setAttribute('aria-live','off');
 const tick=()=>{const elapsed=performance.now()-start;if(elapsed<(reduced?250:2200)){$('ball').textContent=rest[Math.floor(Math.random()*rest.length)];tickSound();setTimeout(tick,40+elapsed/18);return;}
  spinning=false;$('ball').classList.remove('rolling');$('ball').setAttribute('aria-live','polite');
  if(commit(s=>{if(s.drawn.includes(selected))return false;s.drawn.push(selected);}))tickSound(true);else renderHost();
 };tick();
}
function renderNames(){
 $('nameFields').replaceChildren(...state.names.map((name,i)=>{const label=node('label','name-field'),input=node('input');input.type='text';input.value=name;input.maxLength=60;input.placeholder=`参加者${pad(i+1)}`;input.disabled=!owner;input.setAttribute('aria-label',`参加者${pad(i+1)}の名前`);input.oninput=()=>{if(commit(s=>s.names[i]=input.value.trim()))storageStatus();};label.append(node('span','',pad(i+1)),input);return label;}));
 $('sound').checked=!!prefs.sound;$('volume').value=prefs.volume;$('publicURL').value=prefs.publicURL||'';storageStatus();
}
function publicURL(){const url=new URL(prefs.publicURL||location.href);if(!['http:','https:'].includes(url.protocol))throw Error('HTTP URL required');url.hash='';url.search='';return url;}
function makeViewerURL(){const url=publicURL();url.searchParams.set('view','watch');url.hash='s='+encodePublic(publicSnapshot(state));return url.href;}
function renderQR(){
 try{
  const next=makeViewerURL();if(next===qrURL&&renderedQRRevision===state.revision)return;qrURL=next;
  const q=qrcode(0,'M');q.addData(qrURL,'Byte');q.make();const svg=q.createSvgTag({cellSize:4,margin:16,scalable:true});$('qr').innerHTML=svg;$('largeQR').innerHTML=svg;renderedQRRevision=state.revision;
 }catch{qrURL='';$('qr').replaceChildren(node('span','empty-view','QR準備中'));$('largeQR').replaceChildren(node('p','empty-view','公開URLで開いてください。名前が長すぎる場合は短くして登録してください。'));}
}
function setShareStatus(message){$('shareStatus').textContent=message;}
function closeNetwork(){shareEpoch++;clearInterval(heartbeat);clearTimeout(retryTimer);viewerPending=false;const old=peer;peer=null;if(viewerConn){const c=viewerConn;viewerConn=null;try{c.close();}catch{}}for(const c of peers)try{c.close();}catch{}peers.clear();if(old)try{old.destroy();}catch{}}
function broadcast(){if(!state)return;const p=publicSnapshot(state);for(const c of peers)if(c.open)try{c.send(p);}catch{peers.delete(c);}}
function startHostSharing(){
 closeNetwork();if(!owner)return;const epoch=shareEpoch;
 if(typeof Peer==='undefined'||location.protocol==='file:'){setShareStatus('最新QRから履歴・参加者状況を閲覧できます');return;}
 setShareStatus('自動更新を準備中・最新QRは利用可能');
 const id=`bonenkai-screen-${state.room}`;
 try{peer=new Peer(id,{secure:true,debug:0});}catch{setShareStatus('自動更新は未接続・最新QRを読み直してください');return;}
 const current=peer,updateCount=()=>{if(epoch===shareEpoch)setShareStatus(`共有受付中・接続 ${[...peers].filter(c=>c.open).length}台`);};
 current.on('open',updateCount);
 current.on('connection',c=>{
  if(epoch!==shareEpoch||peers.size>=60){c.close();return;}peers.add(c);
  const timer=setTimeout(()=>{if(!c.open){peers.delete(c);c.close();}},15000);
  c.on('open',()=>{clearTimeout(timer);if(epoch!==shareEpoch){c.close();return;}c.send(publicSnapshot(state));updateCount();});
  const done=()=>{clearTimeout(timer);peers.delete(c);updateCount();};c.on('close',done);c.on('error',done);
  // Viewers have no command or mutation handler, even if they send arbitrary data.
 });
 current.on('disconnected',()=>{if(epoch!==shareEpoch)return;setShareStatus('自動更新を再接続中・最新QRは利用可能');retryTimer=setTimeout(()=>{if(epoch===shareEpoch&&!current.destroyed)try{current.reconnect();}catch{}},3000);});
 current.on('error',()=>{if(epoch===shareEpoch)setShareStatus('自動更新は未接続・最新QRから最新情報を確認');});
 heartbeat=setInterval(broadcast,5000);
}
function renderViewer(){
 const p=viewData,count=p.winners.length;$('viewerBall').textContent=p.drawn.at(-1)||'?';$('viewerCount').textContent=`${p.drawn.length} / 75 番号`;
 $('viewerNext').textContent=count===N?'全員ビンゴ！':`次のビンゴは ${prizeOf(count+1)}等`;$('viewerRemaining').textContent=`残り${N-count}人`;
 renderHistory($('viewerHistory'),p.drawn);renderBoard($('viewerBoard'),p.drawn);renderPeople($('viewerPeopleGrid'),p,false);
 $('viewerUpdated').textContent=`情報の更新：${new Date(p.updated).toLocaleString('ja-JP')}`;
}
function viewerStatus(text,live=false){$('viewerStatus').textContent=text;$('viewerStatus').className=live?'live':'stale';}
function startViewerSharing(){
 closeNetwork();const epoch=shareEpoch,started=Date.now();lastReceived=0;
 viewerStatus('QR読取時点の番号・参加者状況です。自動更新に接続中。');
 if(typeof Peer==='undefined'){viewerStatus('QR読取時点の情報です。最新情報は会場の最新QRを読み直してください。');return;}
 try{peer=new Peer(`bonenkai-guest-${randomID()}`,{secure:true,debug:0});}catch{viewerStatus('自動更新を利用できません。最新QRを読み直してください。');return;}
 const current=peer;
 const retry=()=>{if(epoch!==shareEpoch)return;clearTimeout(retryTimer);retryTimer=setTimeout(()=>{if(epoch!==shareEpoch)return;if(current.destroyed){startViewerSharing();return;}if(current.disconnected){try{current.reconnect();}catch{}retry();}else if(current.open)connect();else retry();},5000);};
 function connect(){
  if(epoch!==shareEpoch||viewerPending||viewerConn?.open)return;
  if(viewerConn){const previous=viewerConn;viewerConn=null;previous.close();}
  viewerPending=true;const c=current.connect(`bonenkai-screen-${viewData.room}`,{serialization:'json',reliable:true});viewerConn=c;
  const timeout=setTimeout(()=>{if(epoch===shareEpoch&&viewerConn===c&&!lastReceived){viewerConn=null;viewerPending=false;c.close();viewerStatus('自動更新は未接続。最新QRを読み直すと、番号と参加者状況を更新できます。');retry();}},14000);
  c.on('data',p=>{
   if(epoch!==shareEpoch||viewerConn!==c||!validPublic(p,viewData.room)||p.revision<viewData.revision)return;
   clearTimeout(timeout);viewerPending=false;lastReceived=Date.now();viewData=p;renderViewer();viewerStatus('自動更新中・司会者の抽選と連動しています',true);
   try{history.replaceState(null,'',`${location.pathname}?view=watch#s=${encodePublic(p)}`);}catch{}
  });
  const disconnected=()=>{clearTimeout(timeout);if(epoch!==shareEpoch||viewerConn!==c)return;viewerConn=null;viewerPending=false;viewerStatus('接続が切れました。表示中の情報は最終受信時点です。');retry();};c.on('close',disconnected);c.on('error',disconnected);
 }
 current.on('open',connect);current.on('error',()=>{if(epoch!==shareEpoch)return;viewerPending=false;viewerStatus('自動更新は未接続。会場の最新QRから読み直してください。');retry();});
 current.on('disconnected',()=>{if(epoch===shareEpoch){viewerStatus('再接続中。表示中の情報は最終受信時点です。');retry();}});
 heartbeat=setInterval(()=>{if(epoch!==shareEpoch)return;if(lastReceived&&Date.now()-lastReceived>18000)viewerStatus('更新の受信が止まりました。再接続するか、最新QRを読み直してください。');else if(!lastReceived&&Date.now()-started>15000)viewerStatus('QR読取時点の情報です。最新の番号・参加者状況は会場の最新QRを読み直してください。');},4000);
}
function playBell(){
 const bell=$('winnerBell');bell.pause();bell.currentTime=0;bell.volume=Math.min(1,Math.max(0,Number(prefs.volume)/100));if(!prefs.sound)return;
 bell.play().catch(()=>notify('当選ベルを再生できません。音量と消音設定、assetsフォルダーを確認してください。'));
}
function confetti(){
 cancelAnimationFrame(frame);const canvas=$('confetti'),ctx=canvas.getContext('2d');if(!ctx||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const w=innerWidth,h=innerHeight,dpr=Math.min(devicePixelRatio||1,2);canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);const colors=['#e00a1a','#f2c100','#ff7134','#4bc1c5','#8958df'];
 const pieces=Array.from({length:190},()=>({x:w/2,y:h*.45,vx:(Math.random()-.5)*20,vy:-Math.random()*18-4,r:Math.random()*6.28,size:5+Math.random()*8,color:colors[Math.floor(Math.random()*5)]}));let previous=performance.now();const start=previous;
 const animate=now=>{const dt=Math.min(2,(now-previous)/16.67);previous=now;ctx.clearRect(0,0,w,h);for(const p of pieces){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=.15*dt;p.r+=.06*dt;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.r);ctx.fillStyle=p.color;ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size*.5);ctx.restore();}if(now-start<7000)frame=requestAnimationFrame(animate);else ctx.clearRect(0,0,w,h);};frame=requestAnimationFrame(animate);
}
function celebrate(){
 if(!owner||spinning||!state.winners.length)return;
 const winner=state.winners.at(-1),rank=state.winners.length;$('celebrationName').textContent=`${nameOf(state,winner.no)} さん`;$('celebrationPrize').textContent=`${rank}位・${prizeOf(rank)}等 当選！`;
 $('celebration').showModal();playBell();confetti();
}
function stopCelebration(){const bell=$('winnerBell');bell.pause();bell.currentTime=0;cancelAnimationFrame(frame);const c=$('confetti');c.getContext('2d')?.clearRect(0,0,c.width,c.height);}
function renderPrint(){
 const sheets=[];for(let page=0;page<3;page++){const sheet=node('div','print-sheet');for(let j=0;j<9;j++){const i=page*9+j,card=node('article','pcard');card.append(node('div','phead',`忘年会ビンゴ No.${pad(i+1)}`),node('div','pname',`名前：${state.names[i]||''}`));const table=node('table'),head=node('tr');for(const letter of 'BINGO')head.append(node('th','',letter));table.append(head);for(let r=0;r<5;r++){const tr=node('tr');for(let c=0;c<5;c++){const n=state.cards[i][r*5+c];tr.append(node('td',n===null?'free':'',n??'FREE'));}table.append(tr);}card.append(table);sheet.append(card);}sheets.push(sheet);}$('printArea').replaceChildren(...sheets);
}
async function reset(kind){
 const descriptions={results:['抽選・当選結果をリセット','番号履歴と当選記録を消去します。名前・カードは残します。'],people:['参加者データをリセット','名前・当選記録を消去します。番号履歴・カードは残します。'],all:['すべてリセット','名前・抽選・当選記録を消去し、カードを作り直します。配布済みのカードは印刷し直してください。']};
 if(await ask(...descriptions[kind],'リセットする'))if(commit(s=>{s.winners=[];if(kind!=='people')s.drawn=[];if(kind!=='results')s.names=Array(N).fill('');if(kind==='all')s.cards=makeCards();})){renderNames();notify('リセットしました。');}
}
function hostEvents(){
 $('draw').onclick=draw;$('togglePeople').onclick=togglePeople;$('bingo').onclick=celebrate;
 $('openSettings').onclick=()=>{renderNames();$('settingsDialog').showModal();};$('closeSettings').onclick=()=>$('settingsDialog').close();
 $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{notify('ブラウザーのF11キーでも全画面表示できます。');}};
 document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'全画面を解除':'全画面';});
 document.addEventListener('keydown',e=>{if(e.code==='Space'&&!e.repeat&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&!e.target.isContentEditable&&!/INPUT|TEXTAREA|SELECT|BUTTON|SUMMARY/.test(e.target.tagName)&&!document.querySelector('dialog[open]')){e.preventDefault();draw();}});
 $('closeCelebration').onclick=()=>$('celebration').close();$('celebration').addEventListener('close',stopCelebration);
 $('enlargeQR').onclick=()=>{renderQR();$('qrDialog').showModal();};$('closeQR').onclick=()=>$('qrDialog').close();
 $('applyNames').onclick=async()=>{const names=$('bulkNames').value.replaceAll('\r','').trim().split('\n').map(s=>s.trim());if(!names[0]||names.length>N||names.some(n=>n.length>60)){notify('1行1人、27人以内・各60文字以内で入力してください。');return;}if(await ask('名前をまとめて反映',`${names.length}人の名前をNo.01から反映します。残りは空欄になります。`,'反映する'))if(commit(s=>s.names=Array.from({length:N},(_,i)=>names[i]||'')))renderNames();};
 $('sound').onchange=e=>{prefs.sound=e.target.checked;if(!prefs.sound)$('winnerBell').pause();savePrefs();};$('volume').oninput=e=>{prefs.volume=Number(e.target.value);$('winnerBell').volume=prefs.volume/100;savePrefs();};$('testBell').onclick=playBell;
 $('publicURL').onchange=e=>{const value=e.target.value.trim();try{if(value&&new URL(value).protocol!=='https:')throw Error();prefs.publicURL=value;savePrefs();qrURL='';renderQR();}catch{notify('公開URLは https:// で始まるURLを入力してください。');}};
 $('copyLink').onclick=async()=>{try{renderQR();if(!qrURL)throw Error();try{await navigator.clipboard.writeText(qrURL);notify('参加者用リンクをコピーしました。');}catch{await ask('参加者用リンク',qrURL,'閉じる');}}catch{notify('公開URLから開いてください。');}};
 $('retryShare').onclick=startHostSharing;
 $('undoWinner').onclick=async()=>{const w=state.winners.at(-1);if(w&&await ask('直前の当選を取り消す',`${nameOf(state,w.no)} さんを未当選に戻します。`,'取り消す'))commit(s=>s.winners.pop());};
 $('undoDraw').onclick=async()=>{const n=state.drawn.at(-1);if(n&&await ask('直前の抽選を取り消す',`番号 ${n} を履歴から削除し、抽選候補に戻します。`,'取り消す'))commit(s=>{if(s.winners.some(w=>w.at>=s.drawn.length))return false;s.drawn.pop();});};
 $('exportData').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'})),a=node('a');a.href=url;a.download=`bingo-backup-${new Date().toLocaleDateString('sv-SE')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 $('importData').onclick=()=>$('importFile').click();$('importFile').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;try{if(f.size>1000000)throw Error();const imported=JSON.parse(await f.text());if(!validState(imported))throw Error();if(await ask('データを読み込む','現在の名前・抽選・当選・カードを保存データで上書きします。','読み込む'))if(commit(s=>{s.names=imported.names;s.drawn=imported.drawn;s.winners=imported.winners;s.cards=imported.cards;}))renderNames();}catch{notify('このアプリで保存した正しいJSONファイルを選んでください。');}};
 $('resetResults').onclick=()=>reset('results');$('resetPeople').onclick=()=>reset('people');$('resetAll').onclick=()=>reset('all');
 $('printCards').onclick=()=>{renderPrint();window.print();};window.addEventListener('beforeprint',renderPrint);
 window.addEventListener('storage',e=>{if(e.key===KEY&&e.newValue&&!spinning)try{const value=JSON.parse(e.newValue);if(validState(value)){state=value;renderHost();if($('settingsDialog').open)renderNames();}}catch{}});
}
function viewerEvents(){
 $('viewerNumbersTab').onclick=()=>toggleViewer(false);$('viewerPeopleTab').onclick=()=>toggleViewer(true);$('viewerReconnect').onclick=startViewerSharing;
 function toggleViewer(people){$('viewerNumbers').hidden=people;$('viewerPeople').hidden=!people;$('viewerNumbersTab').classList.toggle('active',!people);$('viewerPeopleTab').classList.toggle('active',people);$('viewerNumbersTab').setAttribute('aria-pressed',String(!people));$('viewerPeopleTab').setAttribute('aria-pressed',String(people));}
}
function boot(){
 if(isViewer){
  $('viewerApp').hidden=false;viewerEvents();
  try{const raw=location.hash.startsWith('#s=')?location.hash.slice(3):'';viewData=decodePublic(raw);renderViewer();startViewerSharing();}
  catch{viewerStatus('閲覧リンクが正しくありません。会場の最新QRを読み取ってください。');$('viewerReconnect').disabled=true;}
  return;
 }
 try{const stored=JSON.parse(storage.get(KEY)||'null');state=validState(stored)?stored:null;}catch{}
 state??=newState();$('hostApp').hidden=false;hostEvents();renderNames();renderHost();
 const becomeOwner=()=>{owner=true;if(!storage.get(KEY))storage.set(KEY,JSON.stringify(state));renderNames();renderHost();startHostSharing();if(!persistent)notify('一時保存モードです。終了前にデータを保存してください。');};
 if(navigator.locks)navigator.locks.request('bonenkai-screen-owner-v2',{ifAvailable:true},async lock=>{if(!lock){notify('別のタブで進行中です。そちらを閉じて、この画面を再読み込みしてください。');return;}becomeOwner();await new Promise(resolve=>window.addEventListener('pagehide',resolve,{once:true}));}).catch(becomeOwner);else becomeOwner();
}
window.addEventListener('pagehide',closeNetwork);window.addEventListener('hashchange',()=>location.reload());document.addEventListener('visibilitychange',()=>{if(isViewer&&viewData&&document.visibilityState==='visible'&&(!lastReceived||Date.now()-lastReceived>18000))startViewerSharing();});
boot();

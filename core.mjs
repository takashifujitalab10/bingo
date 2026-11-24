export const N = 27;
export const prizeOf = rank => rank < 1 || rank > N ? null : rank === 1 ? 1 : rank <= 3 ? 2 : rank <= 6 ? 3 : rank <= 10 ? 4 : 5;
export function shuffle(values) {
  const a = [...values];
  for (let i = a.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1), limit = Math.floor(4294967296 / (i + 1)) * (i + 1);
    do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
    const j = buf[0] % (i + 1); [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function makeCards() {
  return Array.from({length:N}, () => {
    const cells = Array(25);
    for (let c=0;c<5;c++) shuffle(Array.from({length:15},(_,i)=>c*15+i+1)).slice(0,5).forEach((v,r)=>cells[r*5+c]=v);
    cells[12]=null; return cells;
  });
}
export function validDrawn(a) { return Array.isArray(a) && a.length <= 75 && a.every(n=>Number.isInteger(n)&&n>=1&&n<=75) && new Set(a).size===a.length; }
export function validState(s) {
  return s?.version===1 && typeof s.room==='string' && /^[a-zA-Z0-9-]{10,60}$/.test(s.room) &&
    Number.isSafeInteger(s.revision) && s.revision>=0 && Number.isFinite(s.updated) &&
    Array.isArray(s.names)&&s.names.length===N&&s.names.every(n=>typeof n==='string'&&n.length<=60)&&
    validDrawn(s.drawn)&&Array.isArray(s.winners)&&s.winners.length<=N&&
    s.winners.every(w=>Number.isInteger(w.no)&&w.no>=1&&w.no<=N&&Number.isInteger(w.at)&&w.at>=0&&w.at<=s.drawn.length)&&
    new Set(s.winners.map(w=>w.no)).size===s.winners.length&&
    Array.isArray(s.cards)&&s.cards.length===N&&s.cards.every(c=>Array.isArray(c)&&c.length===25&&c[12]===null&&
      c.every((v,i)=>i===12||Number.isInteger(v)&&v>Math.floor(i%5)*15&&v<=Math.floor(i%5)*15+15)&&new Set(c).size===25);
}
export function randomID(){if(typeof crypto.randomUUID==='function')return crypto.randomUUID();const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export function newState() { return {version:1,room:randomID(),revision:0,updated:Date.now(),names:Array(N).fill(''),drawn:[],winners:[],cards:makeCards()}; }
export function recordWinner(s,no) {
  if (!Number.isInteger(no)||no<1||no>N||s.winners.some(w=>w.no===no)||s.winners.length===N) return false;
  s.winners.push({no,at:s.drawn.length}); return true;
}
export function snapshot(s) { return {type:'history',room:s.room,revision:s.revision,updated:s.updated,drawn:[...s.drawn]}; }
export function validSnapshot(p,room) { return p?.type==='history'&&p.room===room&&Number.isSafeInteger(p.revision)&&p.revision>=0&&Number.isFinite(p.updated)&&validDrawn(p.drawn); }
export function encodeWatch(s) { return `${s.room}.${s.revision.toString(36)}.${s.updated.toString(36)}.${btoa(String.fromCharCode(...s.drawn)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')}`; }
export function decodeWatch(raw) {
  const [room,revision,updated,numbers,...extra]=raw.split('.');
  if (extra.length||!/^[a-zA-Z0-9-]{10,60}$/.test(room)||!/^[0-9a-z]+$/.test(revision)||!/^[0-9a-z]+$/.test(updated)||numbers===undefined||!/^[A-Za-z0-9_-]*$/.test(numbers)) throw Error('invalid');
  const p={type:'history',room,revision:parseInt(revision,36),updated:parseInt(updated,36),drawn:Array.from(atob(numbers.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))};
  if (!validSnapshot(p,room)) throw Error('invalid'); return p;
}

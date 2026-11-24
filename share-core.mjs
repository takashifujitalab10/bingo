import {N,validDrawn} from './core.mjs';
export const HISTORY_LIMIT=5;
export const recentHistory=drawn=>drawn.slice(-HISTORY_LIMIT).reverse().map((number,i)=>({number,order:drawn.length-i}));
export function publicSnapshot(s){return {type:'bingo-public-v2',room:s.room,revision:s.revision,updated:s.updated,drawn:[...s.drawn],names:[...s.names],winners:s.winners.map(w=>({no:w.no,at:w.at}))};}
export function validPublic(p,room=p?.room){return p?.type==='bingo-public-v2'&&p.room===room&&typeof room==='string'&&/^[a-zA-Z0-9-]{10,60}$/.test(room)&&Number.isSafeInteger(p.revision)&&p.revision>=0&&Number.isSafeInteger(p.updated)&&p.updated>=0&&validDrawn(p.drawn)&&Array.isArray(p.names)&&p.names.length===N&&p.names.every(n=>typeof n==='string'&&n.length<=60)&&Array.isArray(p.winners)&&p.winners.length<=N&&p.winners.every(w=>Number.isInteger(w.no)&&w.no>=1&&w.no<=N&&Number.isInteger(w.at)&&w.at>=0&&w.at<=p.drawn.length)&&new Set(p.winners.map(w=>w.no)).size===p.winners.length;}
export function encodePublic(p,codec=globalThis.fflate){
 if(!validPublic(p))throw Error('Invalid snapshot');
 const compact=[2,p.room,p.revision,p.updated,p.drawn,p.names,p.winners.map(w=>[w.no,w.at])];
 const packed=codec.deflateSync(codec.strToU8(JSON.stringify(compact)),{level:9});
 return '2.'+btoa(String.fromCharCode(...packed)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}
export function decodePublic(raw,codec=globalThis.fflate){
 if(typeof raw!=='string'||raw.length>6500||!/^2\.[A-Za-z0-9_-]+$/.test(raw))throw Error('Invalid link');
 const bytes=Uint8Array.from(atob(raw.slice(2).replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
 // A bounded output buffer rejects compressed input that expands beyond the event schema.
 const buffer=new Uint8Array(24000),plain=codec.inflateSync(bytes,{out:buffer});
 const value=JSON.parse(codec.strFromU8(plain));
 if(!Array.isArray(value)||value.length!==7||value[0]!==2||!Array.isArray(value[6]))throw Error('Invalid link');
 const p={type:'bingo-public-v2',room:value[1],revision:value[2],updated:value[3],drawn:value[4],names:value[5],winners:value[6].map(w=>({no:w?.[0],at:w?.[1]}))};
 if(!validPublic(p))throw Error('Invalid event');return p;
}

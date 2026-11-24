import assert from 'node:assert/strict';
import {prizeOf,newState,validState,recordWinner,encodeWatch,decodeWatch,snapshot,validSnapshot,shuffle} from './core.mjs';
assert.deepEqual(Array.from({length:27},(_,i)=>prizeOf(i+1)),[1,2,2,3,3,3,4,4,4,4,...Array(17).fill(5)]);
assert.equal(prizeOf(28),null);
let s=newState();assert.ok(validState(s));
for(let i=1;i<=27;i++){assert.ok(recordWinner(s,i));assert.equal(recordWinner(s,i),false);}
assert.equal(s.winners.length,27);assert.ok(validState(s));assert.equal(recordWinner(s,28),false);
s.drawn=shuffle(Array.from({length:75},(_,i)=>i+1));assert.equal(new Set(s.drawn).size,75);assert.ok(validState(s));
assert.deepEqual(decodeWatch(encodeWatch(s)),snapshot(s));
assert.ok(!JSON.stringify(snapshot(s)).includes('names'));assert.equal(validSnapshot({...snapshot(s),drawn:[1,1]},s.room),false);
assert.equal(validSnapshot(snapshot(s),'other-room'),false);
s.drawn=[];s.winners=[];s.revision++;assert.deepEqual(decodeWatch(encodeWatch(s)).drawn,[]);
for(const raw of ['bad','abc.0.0.','abcdefghijk.0.0.%%%','abcdefghijk.0.0.AQA'])assert.throws(()=>decodeWatch(raw));
s.cards[0][0]=75;assert.equal(validState(s),false);
console.log('PASS: prize boundaries, all 27 winners, duplicate prevention, 75 unique numbers, QR roundtrip, invalid payloads, privacy, card validation');

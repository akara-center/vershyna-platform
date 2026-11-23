const assert=require('node:assert/strict');require('../dist/quest-core.js');const Q=QuestCore;
const leaf=(id,xp=50,done=false)=>({id,name:id,result:id,minutes:10,xp,done});
const group=(id,children)=>({...leaf(id,children.reduce((s,n)=>s+n.xp,0)),children});
const mission=(id,steps)=>({id,name:id,goal:id,steps});
const pack=(missions)=>({schemaVersion:4,active:missions[0].id,missions});
const xp=s=>s.missions.flatMap(m=>m.steps).reduce((v,n)=>v+Q.earned(n),0);
let s=pack([mission('a',[group('course',[leaf('done',25,true),leaf('pending',25)]),leaf('other',100)]),mission('b',[leaf('target',200)])]);
s.missions[0].focusId='pending';assert.equal(Q.nextAction(s.missions[0]).id,'pending');
const original=JSON.stringify(s), oldXP=xp(s);
let t=Q.transfer(s,'done','b','target');
assert.equal(JSON.stringify(s),original);assert.equal(xp(t),oldXP);Q.validate(t);
assert.equal(Q.find(t.missions[1].steps,'done').node.done,true);assert.equal(t.missions[1].steps[0].xp,25);
assert.equal(Q.find(t.missions[0].steps,'course').node.xp,25);
assert.equal(Q.find(t.missions[1].steps,'done').node.xp,25);
// Moving last child out leaves a zero-XP unfinished placeholder, never resurrects parent credit.
t=Q.transfer(t,'pending','b','target');assert.equal(xp(t),oldXP);assert.equal(Q.find(t.missions[0].steps,'course').node.xp,0);assert.equal(t.missions[0].focusId,undefined);
assert.equal(Q.find(t.missions[1].steps,'target').node.xp,50);Q.validate(t);
assert.equal(Q.nextAction(t.missions[1]).id,'pending');
// Move a complete standalone project into another project; active project stays valid.
s=pack([mission('lesson',[leaf('watch',25,true),leaf('notes',25,true)]),mission('full',[leaf('course',100)])]);
s.missions[0].focusId='watch';t=Q.transfer(s,'lesson','full','course');
assert.equal(t.missions.length,1);assert.equal(t.active,'full');assert.equal(xp(t),50);assert.equal(Q.find(t.missions[0].steps,'lesson').node.children.length,2);Q.validate(t);
// Same-tree reparent and promote descendant into ancestor preserve all earned XP.
s=pack([mission('m',[group('top',[group('branch',[leaf('x',25,true),leaf('y',25)]),leaf('z',50)])])]);
t=Q.transfer(s,'x','m','top');assert.equal(xp(t),25);assert.equal(Q.find(t.missions[0].steps,'top').node.xp,100);Q.validate(t);
assert.throws(()=>Q.transfer(s,'top','m','branch'),/власний/);assert.throws(()=>Q.transfer(s,'branch','m','branch'),/себе/);
assert.throws(()=>Q.transfer(s,'top','m'),/вже/);assert.throws(()=>Q.transfer(s,'m','m'),/інший/);
s=pack([mission('a',[leaf('x')]),mission('b',[leaf('finished',50,true)])]);assert.throws(()=>Q.transfer(s,'x','b','finished'),/Завершену/);assert.throws(()=>Q.transfer(s,'x','b','missing'),/не знайдено/);
// Depth validation and atomic rejection.
let deep=leaf('deep');for(let i=0;i<8;i++)deep=group('g'+i,[deep]);s=pack([mission('a',[leaf('x')]),mission('b',[deep])]);assert.throws(()=>Q.transfer(s,'x','b','deep'),/Завелика/);Q.validate(s);
// Display sort is stable; underlying array order survives completion and undo.
const list=[leaf('one',50,true),leaf('two'),leaf('three',50,true),leaf('four')];
assert.deepEqual(Q.ordered(list).map(n=>n.id),['two','four','one','three']);assert.equal(list[0].id,'one');list[0].done=false;assert.deepEqual(Q.ordered(list).map(n=>n.id),['one','two','four','three']);
const m=mission('m',list);m.focusId='four';assert.equal(Q.nextAction(m).id,'four');list[3].done=true;assert.equal(Q.nextAction(m).id,'one');m.focusId='nonexistent';assert.equal(Q.nextAction(m).id,'one');
console.log('Passed: transfer of tasks and whole projects, nested and same-tree moves, XP invariants, cycles/depth rejection, stable completed sorting, manual focus and fallback.');

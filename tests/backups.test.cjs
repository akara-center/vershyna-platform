const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
require('../dist/quest-core.js');const Q=QuestCore;
const fixture={schemaVersion:4,theme:'dark',active:'m',missions:[{id:'m',name:'Test',goal:'Test',steps:[{id:'s',name:'Step',result:'Result',minutes:10,xp:50,done:true}]}]};
const raw=JSON.stringify(fixture),oldKeys=['-before-import','-before-v4','-before-ui-upgrade','-before-transfer','-before-project-change'];
const code=require('./helpers/app-source.cjs')();
function start(failKey, saved){
 const data=saved ?? new Map([['vershyna-platform-v1',raw],...oldKeys.map(k=>['vershyna-platform-v1'+k,raw])]),els=new Map();
 const ctx={QuestCore:Q,structuredClone,console,crypto,Date,setTimeout:()=>0,clearTimeout,clearInterval,localStorage:{getItem:k=>data.get(k)||null,removeItem:k=>data.delete(k),setItem:(k,v)=>{if(k===failKey)throw Error('quota');data.set(k,v);}},document:{body:{classList:{toggle(){}}},querySelector:s=>{if(!els.has(s))els.set(s,{innerHTML:'',textContent:'',style:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},remove(){}});return els.get(s);},querySelectorAll:()=>[]}};
 vm.createContext(ctx);vm.runInContext(code,ctx);return {data,ctx};
}
const ok=start();assert.equal(ok.data.get('vershyna-platform-v1-before-github'),raw);assert.ok(Date.parse(ok.data.get('vershyna-platform-v1-before-github-created-at')));
for(const suffix of oldKeys)assert.equal(ok.data.has('vershyna-platform-v1'+suffix),false);
assert.equal(vm.runInContext('totalXP()',ok.ctx),50);
const copy=ok.data.get('vershyna-platform-v1-before-github');vm.runInContext('resetMigrationBackups(JSON.stringify({...state,theme:"light"}))',ok.ctx);assert.equal(ok.data.get('vershyna-platform-v1-before-github'),copy);
for(const key of ['vershyna-platform-v1-before-github','vershyna-platform-v1-before-github-created-at','vershyna-platform-v1-github-backup-reset-v1']){
 const failed=start(key);for(const suffix of oldKeys)assert.equal(failed.data.get('vershyna-platform-v1'+suffix),raw);
 assert.equal(vm.runInContext('totalXP()',failed.ctx),50);
}
assert.equal(vm.runInContext('backupStamp("2026-11-21T23:01:02Z")',ok.ctx),'22.11.2026, 01:01:02');
assert.match(vm.runInContext('backupFilename("2026-11-21T23:01:02Z")',ok.ctx),/2026-11-21T23-01-02/);
console.log('Passed: dated migration snapshot, old-copy cleanup only after verified save, one-time reset, quota/metadata/marker failure preserves old copies and XP, Kyiv timezone and dated filenames.');

const fresh = start(undefined, new Map());
const freshKey = 'vershyna-platform-v1';
const beforeFirstImport = fresh.data.get(freshKey);
vm.runInContext('writeBackup("-before-import", localStorage.getItem(KEY))', fresh.ctx);
fresh.data.set(freshKey, raw);
const afterFirstImport = start(undefined, fresh.data);
assert.equal(afterFirstImport.data.get(freshKey + '-before-import'), beforeFirstImport);

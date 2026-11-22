import test from 'node:test'
import assert from 'node:assert/strict'
import {relevantMetrics,performance,groupCandidates,rankPlayerGroups} from '../src/props/performance.js'
const stat={baseline:60,projection:65,sample:6,defense:{adjusted:false,factor:1,sample:2}}
const make=(position='WR',values=[0,50,75,100])=>({id:'p',name:'Player',team:{id:'t'},position,status:'Active',logs:values.map(recYds=>({recYds,rec:4,targets:6,carries:0,rushYds:0,rushTD:0,recTD:0})),stats:{recYds:stat,rushTD:stat,recTD:stat}})
const keys=p=>relevantMetrics(p).map(([key])=>key)
test('Role-relevant stats exclude unrelated zero categories but retain meaningful secondary roles',()=>{assert.deepEqual(keys(make()),['rec','recYds','totalTD']);const qb=make('QB');qb.logs[0].carries=3;assert.deepEqual(keys(qb),['passYds','passTD','rushYds','totalTD']);const rb=make('RB');assert.deepEqual(keys(rb),['rushYds','rec','recYds','totalTD']);rb.logs.forEach(l=>{l.targets=0;l.rec=0});assert.deepEqual(keys(rb),['rushYds','totalTD']);const hybrid=make();hybrid.logs.forEach(l=>l.carries=4);assert(keys(hybrid).includes('rushYds'))})
test('Big-game display retains zeros, omits missing values, and weights latest appearances more',()=>{const p=make('WR',[0,null,75,100]);const r=performance(p,'recYds',1,4);assert.equal(r.n,3);assert.equal(r.hits,2);assert.equal(r.low,75);assert.equal(r.high,100);assert(Math.abs(r.weightedRate-12/13)<1e-10);assert.equal(r.level,'high');assert.equal(r.probability,undefined)})
test('Range is descriptive and can differ from projection; sparse or flagged players are not rated',()=>{const p=make('WR',[0,0,0,0]);assert.equal(performance(p,'recYds').high,0);assert.equal(performance(p,'recYds').stat.projection,65);assert.equal(performance(p,'recYds').level,'low');for(const patch of [{unavailable:true},{stale:true},{status:'Questionable'},{logs:p.logs.slice(0,2)}]){const r=performance({...p,...patch},'recYds');assert.equal(r.weightedRate,null);assert.equal(r.level,'unknown')}})
test('Bets group all markets for each distinct team/player exactly once',()=>{const p=make(),p2={...make(),id:'b',name:'B'};const items=[{player:p,key:'recYds',score:4},{player:p2,key:'rec',score:3},{player:p,key:'rec',score:2}];const groups=groupCandidates(items);assert.equal(groups.length,2);assert.equal(groups[0].items.length,2);assert.deepEqual(groups[0].items.map(i=>i.key),['recYds','rec'])})
test('TE benchmarks differ from WR benchmarks and total TD needs both categories',()=>{const p=make('TE',[50,50,0,100]);assert.equal(performance(p,'recYds').threshold,50);p.logs[0].recTD=null;assert.equal(performance(p,'totalTD').n,3)})

test('Favorite ordering follows strongest supported relevant stat rather than research score',()=>{
 const high=make('WR',[80,90,100,110]),low=make('WR',[0,0,0,100]),flagged={...high,id:'flag',status:'Questionable'}
 high.stats.rec=stat;low.stats.rec=stat;flagged.stats={...high.stats}
 high.id='high';low.id='low'
 const rows=rankPlayerGroups([{player:low,score:99},{player:flagged,score:100},{player:high,score:0}],3,4)
 assert.deepEqual(rows.map(r=>r.player.id),['high','low','flag']);assert.equal(rows[0].bestSupport.key,'recYds');assert.equal(rows[0].bestSupport.weightedRate,1);assert.equal(rows[2].bestSupport,null)
})

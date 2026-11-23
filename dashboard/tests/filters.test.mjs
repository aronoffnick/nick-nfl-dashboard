import test from 'node:test'
import assert from 'node:assert/strict'
import {matchesPlayer,selectedMetrics,projectedOrder} from '../src/props/filters.js'
import {rankPlayerGroups} from '../src/props/performance.js'
const stat=n=>({projection:n,baseline:n,defense:{sample:4}})
const make=(id,n)=>({id,name:id,position:'WR',team:{id:'a'},logs:Array.from({length:4},()=>({rec:7,recYds:n,rushTD:0,recTD:0})),stats:{rec:stat(7),recYds:stat(n),rushTD:stat(0),recTD:stat(0)}})
const filters={teams:['a','b'],positions:['QB','RB','FB','WR','TE'],stats:['passYds','passTD','rushYds','rec','recYds','totalTD']}
test('Checkbox combinations restrict team, position and columns; none means no rows',()=>{const p=make('p',90);assert(matchesPlayer(p,filters));for(const patch of [{teams:[]},{positions:[]},{stats:[]},{teams:['b']},{positions:['QB']},{stats:['passYds']}])assert.equal(matchesPlayer(p,{...filters,...patch}),false);assert.deepEqual(selectedMetrics(p,{...filters,stats:['recYds']}).map(([k])=>k),['recYds'])})
test('Projection order is numeric descending with withheld and missing last',()=>{const low=make('low',9),high=make('high',100),out={...make('out',999),unavailable:true};assert.deepEqual(projectedOrder([low,out,high],'recYds',3,4).map(p=>p.id),['high','low','out'])})
test('Bet ranking ignores unchecked stats',()=>{const p=make('p',20);const groups=rankPlayerGroups([{player:p,score:0}],3,4,['recYds']);assert.equal(groups[0].bestSupport.key,'recYds');assert.equal(groups[0].bestSupport.weightedRate,0)})
test('Higher-support filter respects selected stats and availability',()=>{const p=make('p',20),f={...filters,highSupport:true};assert(matchesPlayer(p,f,3,4));assert(!matchesPlayer(p,{...f,stats:['recYds']},3,4));assert(!matchesPlayer({...p,status:'Questionable'},f,3,4));assert(!matchesPlayer({...p,logs:p.logs.slice(0,2)},f,3,4))})

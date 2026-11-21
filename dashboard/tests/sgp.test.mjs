import test from 'node:test'
import assert from 'node:assert/strict'
import {sgpLegs,chooseSGPPair,sameGameFavorite,quarterbackConcern} from '../src/props/sgp.js'
const stat={projection:90,baseline:80,defense:{adjusted:true,factor:1.1}}
const player=(id='a')=>({id,name:id,team:{id:'t'},position:'RB',status:'Active',logs:Array.from({length:6},()=>({rushYds:75})),stats:{rushYds:stat}})
const leg=(id,key='rushYds',team='t')=>({player:{id,team:{id:team}},key,signal:.8})
test('Milestones use at-least hits and require projection cushion',()=>{const legs=sgpLegs([player()]);assert.equal(legs.length,1);assert.equal(legs[0].threshold,75);assert.equal(legs[0].hits,6);assert.equal(sgpLegs([{...player(),stats:{rushYds:{...stat,projection:80}}}])[0].threshold,50)})
test('Unavailable, questionable, stale, small and incomplete samples cannot qualify',()=>{for(const patch of [{unavailable:true},{stale:true},{status:'Questionable'},{logs:player().logs.slice(0,5)},{logs:Array.from({length:6},()=>({rushYds:null}))}])assert.equal(sgpLegs([{...player(),...patch}]).length,0)})
test('Pairs require two distinct players and suppress dependent stacks',()=>{assert.equal(chooseSGPPair([leg('a'),leg('a','rec')]),null);assert.equal(chooseSGPPair([leg('a','passYds'),leg('b','rec')]),null);assert.equal(chooseSGPPair([leg('a','totalTD'),leg('b','totalTD')]),null);assert.equal(chooseSGPPair([leg('a')]),null);const pair=chooseSGPPair([leg('a'),leg('b')]);assert.equal(pair.legs.length,2);assert.equal(pair.probability,undefined)})
test('Started games are withheld before inspecting players',()=>{assert.equal(sameGameFavorite({}, {started:true}, {}).pair,null)})
test('Missing quarterback usage is withheld',()=>{assert.match(quarterbackConcern({games:[]},{id:'t',abbr:'T'},{}),/unavailable/)})

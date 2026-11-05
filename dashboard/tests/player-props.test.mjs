import test from 'node:test'
import assert from 'node:assert/strict'
import {parsePlayers,weighted,positionTotal,defenseProfile,projectTeam,historicalComparison,rosterPlayers} from '../src/props/model.js'
const row=(id,stats)=>({athlete:{id,displayName:id},stats})
const box={boxscore:{players:[{team:{id:'A'},statistics:[
{name:'passing',keys:['passingTouchdowns','completions/passingAttempts','passingYards'],athletes:[row('q',['2','20/30','250'])]},
{name:'rushing',keys:['rushingAttempts','rushingYards','rushingTouchdowns'],athletes:[row('r',['12','60','0'])]},
{name:'receiving',keys:['receptions','receivingYards','receivingTouchdowns','receivingTargets'],athletes:[row('r',['3','22','0','4']),row('w',['6','100','1','9'])]},
]}]}}
test('Parser maps keys despite order and merges rush/receiving rows by athlete ID',()=>{const p=parsePlayers(box,'A').players;assert.equal(p.length,3);assert.equal(p.find(p=>p.id==='q').passAtt,30);assert.equal(p.find(p=>p.id==='q').passYds,250);assert.equal(p.find(p=>p.id==='r').rec,3);assert.equal(p.find(p=>p.id==='r').rushYds,60)})
test('Missing category or malformed cell stays null',()=>{const b=structuredClone(box);b.boxscore.players[0].statistics.shift();assert.equal(parsePlayers(b,'A').players[0].passYds,null);b.boxscore.players[0].statistics[1].athletes[0].stats[1]='--';assert.equal(parsePlayers(b,'A').players.find(p=>p.id==='r').recYds,null);assert.deepEqual(parsePlayers({},'A').players,[])})
test('EMA normalizes weights and skips missing values',()=>{assert.equal(weighted([{x:10},{x:20}],'x',1),50/3);assert.equal(weighted([{x:null},{x:20}],'x',1),20)})
test('Unknown positions suppress incomplete position totals',()=>{const s={playerBox:parsePlayers(box,'A')},r={q:{position:'QB'},r:{position:'RB'},w:{position:'WR'}};assert.equal(positionTotal(s,'WR','recYds',r),100);assert.equal(positionTotal(s,'WR','recYds',{}),null)})
const side=(id,y)=>({id,abbr:id,playerBox:{available:['passing','rushing','receiving'],players:[{id:id+'w',name:id+' receiver',position:'WR',recYds:y,rec:5,recTD:0,targets:8,passYds:0,passTD:0,rushYds:0,rushTD:0,passAtt:0,carries:0}]}})
const game=(i,b,y)=>({id:String(i),date:`2026-09-0${i}T17:00:00Z`,away:side('O',y),home:side(b,100)})
const data={games:[game(1,'X',100),game(2,'D',200),game(3,'X',100),game(4,'D',200),game(5,'X',100),game(6,'D',200)]}
test('Defense factor shrinks and caps; insufficient samples remain neutral',()=>{const p=defenseProfile(data,'D','WR','recYds',{},3,4);assert.equal(p.sample,3);assert(p.factor>1&&p.factor<=1.25);assert.equal(defenseProfile({games:data.games.slice(0,4)},'D','WR','recYds',{},3,4).factor,1)})
test('Projections require three recorded appearances and recent roster eligibility',()=>{const r={Ow:{id:'Ow',name:'O receiver',position:'WR',teamId:'O',status:'Active'}};const p=projectTeam(data,{id:'O'},{id:'D'},r,3,4)[0];assert(p.stats.recYds.projection>=p.stats.recYds.baseline);assert.equal(projectTeam({games:data.games.slice(0,2)},{id:'O'},{id:'D'},r,3,4)[0].stats.recYds.projection,null);assert.equal(projectTeam(data,{id:'O'},{id:'D'},{},3,4).length,0)})
test('Historical performance comparison excludes later games',()=>{assert.equal(historicalComparison(data,'O',{id:'Ow'},'recYds','2',3),null);const original=historicalComparison(data,'O',{id:'Ow'},'recYds','4',3);const changed=structuredClone(data);changed.games[5].away.playerBox.players[0].recYds=99999;assert.equal(historicalComparison(changed,'O',{id:'Ow'},'recYds','4',3),original)})
test('Roster parser retains position and injury designation',()=>{const p=rosterPlayers({athletes:[{items:[{id:'1',displayName:'A',position:{abbreviation:'WR'},status:{name:'Active'},injuries:[{status:'Questionable'}]}]}]},'9')[0];assert.equal(p.position,'WR');assert.equal(p.injury,'Questionable');assert.equal(p.teamId,'9')})

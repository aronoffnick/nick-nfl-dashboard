import { valid } from './model.js'

const clamp = (n,min,max) => Math.max(min,Math.min(max,n))
const average = (games,key) => games.length && games.every(game=>valid(game[key]))
  ? games.reduce((sum,game)=>sum+game[key],0)/games.length : null

export function breakoutRating(player){
  if(player.unavailable||player.stale||player.logs.length<6)return null
  const usageKey=player.position==='QB'?'passAtt':['RB','FB'].includes(player.position)?'carries':'targets'
  const recent=average(player.logs.slice(-3),usageKey),prior=average(player.logs.slice(-6,-3),usageKey)
  const mainStat=player.position==='QB'?'passYds':['RB','FB'].includes(player.position)?'rushYds':'recYds'
  const factor=player.stats[mainStat]?.defense.factor,sample=player.stats[mainStat]?.sample||0
  if(!valid(recent)||!valid(prior)||prior<=0||!valid(factor))return null
  const trend=clamp(50+125*(recent/prior-1),0,100)
  const matchup=clamp((factor-.75)/.5*100,0,100)
  const reliability=clamp(sample/8*100,0,100)
  return Math.round(trend*.4+matchup*.35+reliability*.25)
}
export function ratingLevel(score){return score==null?'unknown':score>=70?'high':score>=45?'moderate':'low'}

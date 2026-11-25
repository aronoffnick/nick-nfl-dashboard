/* Scatter plot tab (replaces the "Defense vs position" panel in the UI only; the defense calculations still feed projections, Bets, Flyers).
   x = player's 2026 per-game average, y = Week 12 projection vs this defense (wk12-matchups model). Dashed line y = x. */
import * as R from "react";
import { fileForWeek, roleBookForWeek } from "../data/weekFiles.js";
import { defenseVs } from "../data/reference.js";
import { scatterNoRole } from "./roleEligibility.js";
import "./ScatterTab.css";

export default function ScatterTab({ away, home, week }) {
 const h=R.createElement,{useState,useRef,useEffect}=R;
 const AB=x=>({WSH:'WAS',LA:'LAR'}[x]||x);
 const key=AB(away.abbr)+'-'+AB(home.abbr);
 const scatterFile=fileForWeek('scatter',week);
 const data=scatterFile.data?.games?.[key];
 const [team,setTeam]=useState(AB(away.abbr));
 const [pos,setPos]=useState('All');
 const [stat,setStat]=useState('recYds');
 const [sel,setSel]=useState(null);
 const [roleOnly,setRoleOnly]=useState(false);
 const ref=useRef(null);const [w,setW]=useState(760);
 useEffect(()=>{const el=ref.current;if(!el)return;const f=()=>setW(Math.max(300,Math.min(1100,el.clientWidth)));f();const ro=new ResizeObserver(f);ro.observe(el);return()=>ro.disconnect()},[]);
 const STATS=[['passYds','Pass yards'],['rushYds','Rush yards'],['recYds','Receiving yards'],['rec','Receptions'],['td','Touchdowns']];
 const POS=['All','QB','RB','WR','TE'];const COL={QB:'#b388ff',RB:'#4fd1b5',WR:'#ff8a65',TE:'#90a4ae'};
 const teams=[[AB(away.abbr),away.name],[AB(home.abbr),home.name]];
 const defAb=team===teams[0][0]?teams[1][0]:teams[0][0];
 const statLbl=STATS.find(s=>s[0]===stat)[1];
 const dec=stat==='td'?2:1;
 const btns=(title,items,cur,set)=>h('div',{className:'projection-window'},h('strong',null,title),items.map(([k,l])=>h('button',{key:k,'aria-pressed':cur===k,onClick:()=>{set(k);setSel(null)}},l)));
 const controls=h('div',{className:'projection-filters scatter-filters','aria-label':'Scatter plot filters'},
   btns('Offense (vs the other defense)',teams.map(([a,n])=>[a,n]),team,setTeam),
   btns('Position',POS.map(p=>[p,p]),pos,setPos),
   btns('Stat',STATS,stat,setStat),
   h('div',{className:'projection-window'},h('strong',null,'Role'),h('button',{type:'button','aria-pressed':roleOnly,onClick:()=>{setRoleOnly(v=>!v);setSel(null)}},'Role players only')));
 if(!data) return h('div',{className:'scatter-tab'},controls,h('p',{className:'scatter-empty'},scatterFile.matched?`No Week ${week} scatter data for this matchup.`:`No Week ${week} scatter file. Add scatter-wk${week}.json to plot this week.`));
 const offenseName=teams.find(([abbr])=>abbr===team)?.[1]||'';
 const pts=data.players.filter(p=>p.t===team&&(pos==='All'||p.p===pos)&&p.s[stat]&&p.s[stat][0]!=null&&p.s[stat][1]!=null&&(p.s[stat][0]>0||p.s[stat][1]>0))
   .map(p=>{const role=scatterNoRole({name:p.n,position:p.p,team:{name:offenseName}},roleBookForWeek(week));return {...p,x:p.s[stat][0],y:p.s[stat][1],mf:p.s[stat][2],noRole:role.dim,roleMark:role.mark}}).filter(p=>!roleOnly||!p.noRole);
 const nodata=data.players.filter(p=>p.t===team&&(pos==='All'||p.p===pos)&&p.s[stat]&&(p.s[stat][0]==null||p.s[stat][1]==null)).map(p=>p.n);
 const H=Math.round(Math.min(520,Math.max(300,w*0.62))),m={l:52,r:16,t:16,b:44};
 const mx=Math.max(1e-9,...pts.map(p=>Math.max(p.x,p.y)))*1.12;
 const nice=v=>{const e=Math.pow(10,Math.floor(Math.log10(v))),f=v/e;return (f<=1?1:f<=2?2:f<=5?5:10)*e};
 const step=nice(mx/5),top=Math.ceil(mx/step)*step;
 const X=v=>m.l+(v/top)*(w-m.l-m.r),Y=v=>H-m.b-(v/top)*(H-m.t-m.b);
 const half=step/2
 const axisTicks=[]
 for(let i=0,n=Math.round(top/half);i<=n;i++){
   const value=+(i*half).toFixed(4)
   const major=i%2===0
   axisTicks.push({value,major,label:Number.isInteger(value)?String(value):String(+value.toFixed(2))})
 }
 const halfFont=8,majorFont=10
 const showHalfLabel=(tick,axis)=>{
   const pos=axis==='x'?X(tick.value):Y(tick.value)
   let nearest=null
   for(const other of axisTicks)if(other.major){
     const d=Math.abs((axis==='x'?X(other.value):Y(other.value))-pos)
     if(!nearest||d<nearest.d)nearest={d,label:other.label}
   }
   if(!nearest)return true
   if(axis==='y')return nearest.d>=halfFont+4
   const need=(tick.label.length*halfFont*.58+nearest.label.length*majorFont*.58)/2+6
   const tw=tick.label.length*halfFont*.58
   return nearest.d>=need&&pos-tw/2>m.l+1&&pos+tw/2<w-2
 }
 // labels: greedy, highest projection first, skip overlaps
 const placed=[],fs=w<500?10:11;
 const lab=[...pts].sort((a,b)=>b.y-a.y).map(p=>{const txt=p.n.split(' ').slice(-1)[0];const tw=txt.length*fs*0.58,x=X(p.x)+7,y=Y(p.y)+4;
   const bx=x+tw>w-m.r?[X(p.x)-7-tw,y]:[x,y];const box=[bx[0],bx[1]-fs,bx[0]+tw,bx[1]+2];
   if(placed.some(q=>!(box[2]<q[0]||box[0]>q[2]||box[3]<q[1]||box[1]>q[3])))return null;placed.push(box);return h('text',{key:'l'+p.n,x:bx[0],y:bx[1],fontSize:fs,fill:p.noRole?'#6d7c88':'#c9d6df',opacity:p.noRole?0.35:1},txt)}).filter(Boolean);
 const svg=h('svg',{width:w,height:H,role:'img','aria-label':`${team} offense vs ${defAb} defense, ${statLbl}`,style:{display:'block'}},
   axisTicks.filter(t=>!t.major).map(t=>h('g',{key:'h'+t.value},
     h('line',{x1:m.l,x2:w-m.r,y1:Y(t.value),y2:Y(t.value),stroke:'#3d5568',strokeDasharray:'2 3'}),
     h('line',{x1:X(t.value),x2:X(t.value),y1:m.t,y2:H-m.b,stroke:'#3d5568',strokeDasharray:'2 3',opacity:.75}),
     h('line',{x1:m.l-3,x2:m.l,y1:Y(t.value),y2:Y(t.value),stroke:'#6d8090'}),
     h('line',{x1:X(t.value),x2:X(t.value),y1:H-m.b,y2:H-m.b+3,stroke:'#6d8090'}),
     showHalfLabel(t,'y')?h('text',{x:m.l-6,y:Y(t.value)+3,fontSize:halfFont,fill:'#667888',textAnchor:'end'},t.label):null,
     showHalfLabel(t,'x')?h('text',{x:X(t.value),y:H-m.b+15,fontSize:halfFont,fill:'#667888',textAnchor:'middle'},t.label):null)),
   axisTicks.filter(t=>t.major).map(t=>h('g',{key:'t'+t.value},h('line',{x1:m.l,x2:w-m.r,y1:Y(t.value),y2:Y(t.value),stroke:'#24323d'}),h('text',{x:m.l-6,y:Y(t.value)+4,fontSize:majorFont,fill:'#8b9ba8',textAnchor:'end'},t.label),
     h('text',{x:X(t.value),y:H-m.b+16,fontSize:majorFont,fill:'#8b9ba8',textAnchor:'middle'},t.label))),
   h('line',{x1:X(0),y1:Y(0),x2:X(top),y2:Y(top),stroke:'#a5e6bd',strokeDasharray:'5 5',opacity:.6}),
   h('text',{x:X(top)-4,y:Y(top)+14,fontSize:10,fill:'#a5e6bd',textAnchor:'end'},'projection = season avg'),
   h('text',{x:(m.l+w-m.r)/2,y:H-6,fontSize:11,fill:'#9cabb7',textAnchor:'middle'},`2026 average per game · ${statLbl}`),
   h('text',{transform:`translate(13,${(m.t+H-m.b)/2}) rotate(-90)`,fontSize:11,fill:'#9cabb7',textAnchor:'middle'},`Week ${week} projection vs ${defAb} (estimate)`),
   pts.map(p=>h('circle',{key:p.n,cx:X(p.x),cy:Y(p.y),r:sel===p.n?8:6,fill:COL[p.p],stroke:sel===p.n?'#fff':'#0b1015',strokeWidth:1.5,opacity:p.noRole?0.28:0.9,style:{cursor:'pointer'},onClick:()=>setSel(sel===p.n?null:p.n)},h('title',null,`${p.n} (${p.p}) avg ${p.x} · proj ${p.y}${p.roleMark?` · ${p.roleMark}`:''}`))),
   lab);
 const S=pts.find(p=>p.n===sel);
 const legend=h('div',{className:'scatter-legend'},Object.entries(COL).filter(([k])=>pos==='All'||k===pos).map(([k,c])=>h('span',{key:k},h('i',{style:{background:c}}),k)),h('span',null,'Above the dashed line = projected above the player’s own average vs this defense. Tap a dot for details.'));
 const detail=S?h('div',{className:'scatter-detail'},h('b',null,`${S.n} · ${S.p} · ${S.t}`),S.roleMark?h('span',{className:'scatter-norole'},S.roleMark):null,
   h('span',null,`2026 avg ${S.x.toFixed(dec)} (${S.g} games)`),h('span',null,`Week ${week} projection vs ${defAb}: ${S.y.toFixed(dec)}`),
   h('span',null,`Difference ${(S.y-S.x>=0?'+':'')}${(S.y-S.x).toFixed(dec)}`),(()=>{const d=defenseVs(defAb,S.p,week);const f=d&&(stat==='passYds'?d.passYdsFactor:stat==='rushYds'?d.rushYdsFactor:stat==='td'?d.tdFactor:stat==='rec'?d.pprFactor:d.recYdsFactor);return f!=null?h('span',null,`${defAb} defense vs ${S.p} factor ×${f.toFixed(2)}`):null})()):null;
 return h('div',{className:'scatter-tab'},controls,
   h('div',{className:'scatter-card'},h('h4',null,`${team} offense vs ${defAb} defense · ${statLbl}`),
     h('div',{ref,className:'scatter-plot'},pts.length?svg:h('p',{className:'scatter-empty'},`No ${pos==='All'?'':pos+' '}${statLbl.toLowerCase()} data for ${team} in this matchup.`)),
     pts.length?legend:null,detail,
     nodata.length?h('small',{className:'scatter-note'},`Not plotted (no 2026 games or projection): ${nodata.join(', ')}`):null,
     h('small',{className:'scatter-note'},`Dimmed dots have no Week ${week} sheet role. Scatter file: scatter-wk${week}.json when it is in the app. Touchdowns = rushing + receiving TDs (QB passing TDs not included). Estimates only, entertainment only, not betting advice.`)));
}

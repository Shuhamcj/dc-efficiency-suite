
import { useState, useMemo, useRef, useEffect } from "react";
import {
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, AreaChart, Area,
  ResponsiveContainer,
} from "recharts";

// ── Data ─────────────────────────────────────────────────────────────────────
const CI = {
  "US Average":0.386,"California":0.210,"Texas":0.420,
  "EU Average":0.233,"Germany":0.311,"France":0.052,
  "UK":0.233,"China":0.555,"India":0.708,"Australia":0.656,
};
const COOLING = {
  "Air-Cooled CRAC":{oh:0.35,wue:0.0,cpx:400},"Water-Cooled CRAH":{oh:0.22,wue:1.8,cpx:700},
  "Free Cooling":{oh:0.10,wue:0.5,cpx:1100},"Direct Liquid (DLC)":{oh:0.07,wue:0.3,cpx:1800},"Evaporative":{oh:0.15,wue:3.5,cpx:500},
};
const REDUN = {"N (No Redundancy)":{m:1.00,desc:"No backup systems"},"N+1 (Standard)":{m:1.14,desc:"One backup per system"},"2N (Full Redundant)":{m:1.32,desc:"Complete parallel system"}};
const DIST = {"Single Path":1,"Dual Path (1 Active)":2,"Dual Active (2N)":3};
const FC_HRS = {"Hot & Humid":800,"Hot & Dry":1800,"Temperate":3500,"Cold":5200,"Arctic":6500};
const CONTAIN = {"None":{m:1.12,recirc:7},"Cold Aisle":{m:1.00,recirc:2},"Hot Aisle":{m:0.95,recirc:0}};
const BENCH = [{name:"Google",pue:1.10},{name:"Microsoft",pue:1.18},{name:"AWS",pue:1.20},{name:"Meta",pue:1.10},{name:"Ind. Avg",pue:1.58}];
const UPS_PTS = [[10,0.900],[25,0.925],[40,0.950],[60,0.960],[80,0.963],[100,0.958]];
const TIERS = {
  1:{roman:"I",  short:"Basic Capacity",          avail:"99.671%",downtime:"28.8 hrs/yr",color:"#ef4444"},
  2:{roman:"II", short:"Redundant Components",     avail:"99.741%",downtime:"22.0 hrs/yr",color:"#f59e0b"},
  3:{roman:"III",short:"Concurrently Maintainable",avail:"99.982%",downtime:"1.6 hrs/yr", color:"#3b82f6"},
  4:{roman:"IV", short:"Fault Tolerant",           avail:"99.995%",downtime:"0.4 hrs/yr", color:"#22c55e"},
};

function upsEff(pct){const p=Math.min(Math.max(pct,10),100);for(let i=1;i<UPS_PTS.length;i++){if(p<=UPS_PTS[i][0]){const[x0,y0]=UPS_PTS[i-1],[x1,y1]=UPS_PTS[i];return y0+(y1-y0)*(p-x0)/(x1-x0);}}return 0.958;}

function tierOf(redun, dist){
  const is2N=redun.startsWith("2N"), isN1=redun.startsWith("N+1");
  const dualActive=dist==="Dual Active (2N)", dual=dist.startsWith("Dual");
  const tier = is2N&&dualActive?4 : isN1&&dual?3 : isN1?2 : 1;
  const T=TIERS[tier];
  const reqs=[
    {label:"Redundant capacity components (N+1)", met:isN1||is2N},
    {label:"Multiple distribution paths", met:dual},
    {label:"Concurrently maintainable (service without shutdown)", met:(isN1||is2N)&&dual},
    {label:"Fault tolerant (2N, survives single failure)", met:is2N&&dualActive},
  ];
  const next={1:"add N+1 redundant capacity components",2:"add a second distribution path (concurrently maintainable)",3:"upgrade to 2N fault-tolerant dual-active topology",4:""}[tier];
  return {tier,...T,name:`Tier ${T.roman} - ${T.short}`,reqs,next};
}

function energyStar(pue){const pts=[[1.0,100],[1.1,96],[1.2,88],[1.3,78],[1.4,68],[1.5,58],[1.7,42],[2.0,25],[2.5,8]];if(pue<=pts[0][0])return 100;if(pue>=pts[pts.length-1][0])return pts[pts.length-1][1];for(let i=1;i<pts.length;i++){if(pue<=pts[i][0]){const[x0,y0]=pts[i-1],[x1,y1]=pts[i];return Math.round(y0+(y1-y0)*(pue-x0)/(x1-x0));}}return 50;}
function leedScore(res,cfg){const ea=Math.max(0,Math.min(33,Math.round(33*(2.0-res.pue)/0.9)));const we=Math.max(0,Math.min(11,Math.round(11*(4.0-res.wue)/4.0)));const ss=Math.max(0,Math.min(10,Math.round(10*res.fcH/6500)));const ce=Math.max(0,Math.min(20,Math.round(20*(0.7-res.ci)/0.7)));const inv=(cfg.cooling==="Direct Liquid (DLC)"||cfg.cooling==="Free Cooling")?6:cfg.cooling==="Water-Cooled CRAH"?3:1;const mr=8;return{ea,we,ss,ce,inv,mr,total:ea+we+ss+ce+inv+mr};}
function leedLevel(p){if(p>=80)return{name:"Platinum",color:"#e5e4e2"};if(p>=60)return{name:"Gold",color:"#fbbf24"};if(p>=50)return{name:"Silver",color:"#cbd5e1"};if(p>=40)return{name:"Certified",color:"#22c55e"};return{name:"Not Yet Certified",color:"#64748b"};}
function tempColor(t){const x=Math.max(0,Math.min(1,(t-60)/45));return `hsl(${(220-x*220).toFixed(0)}, 75%, 52%)`;}

const loadScript=(src)=>new Promise((resolve,reject)=>{if(window.jspdf?.jsPDF)return resolve();const s=document.createElement("script");s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error("Failed to load PDF library"));document.head.appendChild(s);});

// ── Calc Engine ────────────────────────────────────────────────────────────────
function calcAll(cfg){
  const dL=Math.max(cfg.dL,1),u=Math.min(Math.max(cfg.u,1),100),it=dL*u/100;
  const c=COOLING[cfg.cooling],rm=REDUN[cfg.redun].m,sp=cfg.setpoint,cm=CONTAIN[cfg.containment];
  const spRed=Math.max(0,Math.min((sp-72)*0.025,0.30));
  const fCP=dL*c.oh, cPwr=(fCP*0.4+fCP*0.6*(u/100))*rm*cm.m*(1-spRed);
  const ue=upsEff(u), uLoss=it*(1-ue)*rm, fxd=(cfg.light+cfg.other)*rm, tot=it+cPwr+uLoss+fxd, pue=tot/it;
  const fcBonus=1+Math.max(0,sp-72)*0.035, fcH=Math.min(FC_HRS[cfg.climate]*fcBonus,cfg.hrs), stH=Math.max(0,cfg.hrs-fcH);
  const annE=(tot*stH+(it+cPwr*0.42+uLoss+fxd)*fcH)/1000, aPUE=annE/Math.max(it*cfg.hrs/1000,0.001);
  const ci=CI[cfg.region], co2=annE*ci, wue=c.wue, water=wue*(it*cfg.hrs/1000), cost=annE*80;
  const deltaT=20, hotAisleTemp=Math.round(sp+deltaT), effIntake=Math.round(sp+cm.recirc), numRacks=Math.max(1,Math.ceil(it/cfg.rackKw));
  const brkdn=[{name:"IT Load",value:Math.round(it),color:"#3b82f6"},{name:"Cooling",value:Math.round(cPwr),color:"#06b6d4"},{name:"UPS Loss",value:Math.round(uLoss),color:"#f59e0b"},{name:"Lighting",value:cfg.light,color:"#8b5cf6"},{name:"Other",value:cfg.other,color:"#64748b"}];
  const lCurve=[10,25,50,75,100].map(pct=>{const i2=dL*pct/100,c2=(fCP*0.4+fCP*0.6*(pct/100))*rm*cm.m*(1-spRed),u2=i2*(1-upsEff(pct))*rm;return{load:`${pct}%`,PUE:+((i2+c2+u2+fxd)/i2).toFixed(3)};});
  const proj=Array.from({length:6},(_,i)=>({year:`${2025+i}`,co2:Math.round(co2*Math.pow(0.97,i)),cost:Math.round(cost*Math.pow(1.03,i)/1000)}));
  const bench=[...BENCH.map(b=>({name:b.name,PUE:b.pue})),{name:"You",PUE:+pue.toFixed(2)}];
  return{it,dL,u,pue,aPUE,co2,wue,annE,water,cost,brkdn,lCurve,proj,bench,tot,cPwr,uLoss,fxd,ue,fcH,ci,setpoint:sp,hotAisleTemp,effIntake,numRacks,deltaT};
}

// ── Gauge ─────────────────────────────────────────────────────────────────────
function Gauge({pue}){
  const cx=150,cy=140,r=108,sw=16,cl=Math.min(Math.max(pue,1),2.5),ang=p=>180-((p-1)/1.5)*180,rad=d=>(d*Math.PI)/180;
  const pt=(d,rv)=>({x:cx+rv*Math.cos(rad(d)),y:cy-rv*Math.sin(rad(d))});
  const arc=(a1,a2)=>{const s=pt(a1,r),e=pt(a2,r);return `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} A ${r} ${r} 0 0 0 ${e.x.toFixed(1)} ${e.y.toFixed(1)}`;};
  const z1=ang(1.4),z2=ang(1.7),tip=pt(ang(cl),r*0.80),col=pue<1.2?"#22c55e":pue<1.5?"#f59e0b":"#ef4444",lbl=pue<1.2?"Excellent":pue<1.5?"Good":pue<2?"Average":"Poor";
  return(<svg viewBox="0 0 300 185" style={{width:"100%",maxWidth:280,display:"block",margin:"0 auto"}}>
    <path d={arc(180,0)} stroke="#1e293b" strokeWidth={sw} fill="none" strokeLinecap="round"/><path d={arc(180,z1)} stroke="#22c55e" strokeWidth={sw} fill="none" strokeLinecap="round"/><path d={arc(z1,z2)} stroke="#f59e0b" strokeWidth={sw} fill="none"/><path d={arc(z2,0)} stroke="#ef4444" strokeWidth={sw} fill="none" strokeLinecap="round"/>
    <line x1={cx} y1={cy} x2={tip.x.toFixed(1)} y2={tip.y.toFixed(1)} stroke="white" strokeWidth="2.5" strokeLinecap="round"/><circle cx={cx} cy={cy} r="7" fill="#0d1526" stroke="white" strokeWidth="2"/>
    <text x="28" y={cy+12} fill="#22c55e" fontSize="9" textAnchor="middle">1.0</text><text x={cx} y="20" fill="#94a3b8" fontSize="9" textAnchor="middle">1.75</text><text x="272" y={cy+12} fill="#ef4444" fontSize="9" textAnchor="middle">2.5</text>
    <text x={cx} y={cy+32} fill={col} fontSize="30" fontWeight="bold" textAnchor="middle" fontFamily="monospace">{pue.toFixed(2)}</text><text x={cx} y={cy+52} fill={col} fontSize="12" textAnchor="middle" fontWeight="600">{lbl}</text><text x={cx} y={cy+68} fill="#475569" fontSize="9" textAnchor="middle">Power Usage Effectiveness</text>
  </svg>);
}

// ── Floor Plan ──────────────────────────────────────────────────────────────────
function FloorPlan({res,cfg}){
  const perRow=12,rows=Math.min(Math.max(Math.ceil(res.numRacks/perRow),2),4),show=Math.min(res.numRacks,rows*perRow);
  const rx0=80,rx1=580,ry0=40,ry1=312,roomH=ry1-ry0,nBands=2*rows+1,bandH=roomH/nBands,cold=cfg.setpoint,hot=res.hotAisleTemp;
  const ash=res.effIntake>89.6?{c:"#ef4444",t:"⚠ Exceeds ASHRAE A1 allowable (89.6°F) — equipment risk"}:res.effIntake>80.6?{c:"#f59e0b",t:"⚠ Above ASHRAE A1 recommended (80.6°F) — acceptable but monitor"}:{c:"#22c55e",t:"✓ Within ASHRAE A1 recommended envelope"};
  const bands=[];let placed=0;
  for(let i=0;i<nBands;i++){const y=ry0+i*bandH;if(i%2===0){bands.push({type:"aisle",isHot:(i/2)%2===0,y});}else{const n=Math.min(perRow,show-placed);placed+=n;bands.push({type:"rack",y,n});}}
  return(<div>
    <svg viewBox="0 0 640 400" style={{width:"100%",background:"#0a0f1e",borderRadius:8}}>
      <defs><linearGradient id="legend" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stopColor={tempColor(60)}/><stop offset="33%" stopColor={tempColor(75)}/><stop offset="66%" stopColor={tempColor(90)}/><stop offset="100%" stopColor={tempColor(105)}/></linearGradient></defs>
      <rect x={rx0-2} y={ry0-2} width={rx1-rx0+4} height={roomH+4} fill="none" stroke="#334155" strokeWidth="2" rx="4"/>
      {[0,1,2].map(i=>{const uy=ry0+(i+0.5)*(roomH/3)-16;return(<g key={i}>
        <rect x={rx0-52} y={uy} width={40} height={32} fill="#1e3a5f" stroke="#3b82f6" strokeWidth="1.5" rx="3"/><text x={rx0-32} y={uy+15} fill="#60a5fa" fontSize="8" textAnchor="middle">CRAH</text><text x={rx0-32} y={uy+25} fill="#475569" fontSize="7" textAnchor="middle">{i+1}</text><path d={`M ${rx0-10} ${uy+16} l 8 -4 l 0 8 z`} fill="#3b82f6"/>
        <rect x={rx1+12} y={uy} width={40} height={32} fill="#1e3a5f" stroke="#3b82f6" strokeWidth="1.5" rx="3"/><text x={rx1+32} y={uy+15} fill="#60a5fa" fontSize="8" textAnchor="middle">CRAH</text><text x={rx1+32} y={uy+25} fill="#475569" fontSize="7" textAnchor="middle">{i+4}</text><path d={`M ${rx1+10} ${uy+16} l -8 -4 l 0 8 z`} fill="#3b82f6"/>
      </g>);})}
      {bands.map((b,i)=>{if(b.type==="aisle"){const t=b.isHot?hot:cold;return(<g key={i}>
        <rect x={rx0} y={b.y} width={rx1-rx0} height={bandH} fill={tempColor(t)} opacity="0.5"/><text x={rx0+8} y={b.y+bandH/2+3} fill="white" fontSize="9" fontWeight="600">{b.isHot?"HOT AISLE":"COLD AISLE"} · {Math.round(t)}°F</text>
        {((cfg.containment==="Hot Aisle"&&b.isHot)||(cfg.containment==="Cold Aisle"&&!b.isHot))&&<rect x={rx0} y={b.y} width={rx1-rx0} height={bandH} fill="none" stroke="white" strokeWidth="1.5" strokeDasharray="6 3" opacity="0.8"/>}
      </g>);}const rw=(rx1-rx0-20)/perRow;return(<g key={i}>{Array.from({length:b.n}).map((_,j)=>(<rect key={j} x={rx0+10+j*rw} y={b.y+3} width={rw-3} height={bandH-6} fill="#475569" stroke="#1e293b" strokeWidth="0.5" rx="1"><title>Rack {j+1} · ~{cfg.rackKw} kW</title></rect>))}</g>);})}
      <rect x={rx0} y="358" width="180" height="12" fill="url(#legend)" rx="2"/><text x={rx0} y="382" fill="#64748b" fontSize="8">60°F</text><text x={rx0+160} y="382" fill="#64748b" fontSize="8">105°F</text><text x={rx0+72} y="354" fill="#475569" fontSize="8">Thermal scale</text>
      <text x={rx1} y="356" fill="#94a3b8" fontSize="9" textAnchor="end">Total racks: <tspan fill="#3b82f6" fontWeight="700">{res.numRacks}</tspan> @ {cfg.rackKw} kW</text><text x={rx1} y="370" fill="#94a3b8" fontSize="9" textAnchor="end">Containment: <tspan fill="#22c55e">{cfg.containment}</tspan></text><text x={rx1} y="384" fill="#94a3b8" fontSize="9" textAnchor="end">Server intake: <tspan fill={ash.c} fontWeight="700">{res.effIntake}°F</tspan></text>
    </svg>
    <div style={{marginTop:8,padding:"8px 10px",borderRadius:6,background:ash.c+"15",border:`1px solid ${ash.c}50`,fontSize:11,color:ash.c}}>{ash.t}</div>
    {show<res.numRacks&&<div style={{fontSize:9,color:"#475569",marginTop:5}}>* Representative layout ({show} of {res.numRacks} racks). Color = air temp; dashed white = containment.</div>}
  </div>);
}

// ── Atoms ──────────────────────────────────────────────────────────────────────
const SC={card:{background:"#0f172a",border:"1px solid #1e293b",borderRadius:10,padding:14},sec:{fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:1,marginBottom:8}};
const TT={background:"#1e293b",border:"1px solid #334155",borderRadius:"6px",color:"#e2e8f0",fontSize:"11px"};
const CAT={Cooling:"❄️",Power:"⚡",Airflow:"💨",Operations:"⚙️",Infrastructure:"🏗️"};
const KPI=({icon,label,value,unit,color,sub})=>(<div style={SC.card}><div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.5px"}}>{label}</span><span style={{fontSize:14}}>{icon}</span></div><div style={{fontSize:20,fontWeight:700,color:color||"#f1f5f9",marginTop:4}}>{value}</div><div style={{fontSize:10,color:"#64748b",marginTop:1}}>{unit}</div>{sub&&<div style={{fontSize:9,color:"#334155",marginTop:2}}>{sub}</div>}</div>);
const Slt=({label,value,onChange,opts})=>(<div style={{marginBottom:11}}><label style={{fontSize:10,color:"#64748b",display:"block",marginBottom:3,textTransform:"uppercase",letterSpacing:"0.5px"}}>{label}</label><select value={value} onChange={e=>onChange(e.target.value)} style={{width:"100%",background:"#1e293b",border:"1px solid #334155",borderRadius:6,padding:"6px 8px",color:"#e2e8f0",fontSize:12}}>{opts.map(o=><option key={o}>{o}</option>)}</select></div>);
const Inp=({label,unit,value,onChange,min=0,max})=>{const bad=value<min||(max!==undefined&&value>max);return(<div style={{marginBottom:11}}><label style={{fontSize:10,color:"#64748b",display:"block",marginBottom:3,textTransform:"uppercase",letterSpacing:"0.5px"}}>{label}{unit&&<span style={{color:"#334155"}}> ({unit})</span>}</label><input type="number" value={value} min={min} max={max} onChange={e=>onChange(+e.target.value)} style={{width:"100%",background:bad?"#1a0808":"#1e293b",border:`1px solid ${bad?"#ef4444":"#334155"}`,borderRadius:6,padding:"6px 8px",color:bad?"#ef4444":"#e2e8f0",fontSize:12,boxSizing:"border-box"}}/></div>);};

const DEF={dL:1000,u:70,cooling:"Air-Cooled CRAC",redun:"N+1 (Standard)",distribution:"Dual Path (1 Active)",light:8,other:12,region:"US Average",climate:"Temperate",hrs:8760,setpoint:75,rackKw:8,containment:"Cold Aisle"};
const upsChartData=UPS_PTS.map(([p,e])=>({load:`${p}%`,eff:+(e*100).toFixed(1)}));

export default function App(){
  const [tab,setTab]=useState("dash");
  const [recs,setRecs]=useState([]);const [busy,setBusy]=useState(false);
  const [cfg,setCfg]=useState(DEF);const [sA,setSA]=useState(null);
  const [chat,setChat]=useState([]);const [cin,setCin]=useState("");const [cbusy,setCbusy]=useState(false);
  const [pdfBusy,setPdfBusy]=useState(false);
  const chatEnd=useRef(null);
  const set=(k,v)=>setCfg(p=>({...p,[k]:v}));
  const res=useMemo(()=>calcAll(cfg),[cfg]);
  const resA=useMemo(()=>sA?calcAll(sA):null,[sA]);
  const pCol=res.pue<1.2?"#22c55e":res.pue<1.5?"#f59e0b":"#ef4444";
  const es=energyStar(res.pue),leed=leedScore(res,cfg),lvl=leedLevel(leed.total),tier=tierOf(cfg.redun,cfg.distribution);
  useEffect(()=>{chatEnd.current?.scrollIntoView({behavior:"smooth"});},[chat,cbusy]);

  const roi=useMemo(()=>{let best={name:"",save:0,cpx:0,newPUE:0,pb:99};Object.entries(COOLING).filter(([k])=>k!==cfg.cooling).forEach(([k,c])=>{const r2=calcAll({...cfg,cooling:k});const sav=res.cost-r2.cost;if(sav>0&&sav>best.save)best={name:k,save:sav,cpx:c.cpx*res.it,newPUE:r2.pue,pb:(c.cpx*res.it)/sav};});return best;},[cfg,res]);

  const fetchRecs=async()=>{setTab("recs");setBusy(true);try{const resp=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1200,messages:[{role:"user",content:`You are a PE-level Data Center Mechanical Engineer. Return ONLY a valid JSON array (no markdown).
Facility: Design ${cfg.dL}kW | Util ${cfg.u}% | IT ${Math.round(res.it)}kW | Cooling ${cfg.cooling} | Containment ${cfg.containment} | Setpoint ${cfg.setpoint}°F | Redundancy ${cfg.redun} | Topology ${cfg.distribution} (${tier.name})
PUE ${res.pue.toFixed(2)} | Annual PUE ${res.aPUE.toFixed(2)} | ENERGY STAR ${es}/100 | LEED ${leed.total}pts (${lvl.name}) | CO2 ${Math.round(res.co2)}t/yr | Free cooling ${res.fcH}hrs | Climate ${cfg.climate} | Grid ${cfg.region}
Give exactly 5 specific recommendations:
[{"title":"...","description":"2-3 sentences w/ specific values/temps/standards","impact":"High|Medium|Low","pueReduction":"e.g. 0.10-0.15","co2Saving":"e.g. 200t/yr","category":"Cooling|Power|Airflow|Operations|Infrastructure","standard":"e.g. ASHRAE 90.4-2019"}]`}]})});const d=await resp.json();const txt=d.content.find(c=>c.type==="text")?.text||"[]";setRecs(JSON.parse(txt.replace(/```json|```/g,"").trim()));}catch{setRecs([{title:"Error",description:"Could not fetch recommendations.",impact:"Low",pueReduction:"-",co2Saving:"-",category:"Operations",standard:"-"}]);}setBusy(false);};

  const sendChat=async(text)=>{const q=(text||cin).trim();if(!q||cbusy)return;const disp=[...chat,{role:"user",content:q}];setChat(disp);setCin("");setCbusy(true);
    const ctx=`You are an expert Data Center Mechanical Engineer assistant embedded in a live PUE calculator.
CURRENT FACILITY (live): Design ${cfg.dL}kW, Util ${cfg.u}%, IT ${Math.round(res.it)}kW, Cooling ${cfg.cooling}, Containment ${cfg.containment}, Setpoint ${cfg.setpoint}°F, Redundancy ${cfg.redun}, Topology ${cfg.distribution} (${tier.name}, ${tier.avail} avail), Region ${cfg.region} (${res.ci}kgCO2/kWh), Climate ${cfg.climate}.
RESULTS: PUE ${res.pue.toFixed(2)}, Annual PUE ${res.aPUE.toFixed(2)}, Energy ${Math.round(res.annE)}MWh/yr, Cost $${Math.round(res.cost).toLocaleString()}/yr, CO2 ${Math.round(res.co2)}t/yr, hot-aisle ${res.hotAisleTemp}°F, intake ${res.effIntake}°F, free cooling ${res.fcH}hrs, ${res.numRacks} racks @ ${cfg.rackKw}kW.
RULES: +1°F setpoint ≈ -2.5% cooling energy & +3.5% free-cooling hrs (cap 30%). ASHRAE A1 rec max intake 80.6°F, allowable 89.6°F. Containment: Hot -5% / Cold baseline / None +12% overhead; intake penalty None +7°F, Cold +2°F, Hot +0°F. Cooling overhead of IT: CRAC 35%, CRAH 22%, FreeCooling 10%, DLC 7%, Evap 15%. PUE=Total/IT. Energy ~$80/MWh. Uptime tiers: Tier I single-path N, II N+1, III N+1 dual-path concurrently-maintainable, IV 2N fault-tolerant.
Answer concisely (<150 words) with concrete calculated numbers (new PUE/energy/cost) and any ASHRAE/tier caveat.`;
    try{const apiMsgs=[{role:"user",content:ctx},{role:"assistant",content:"Understood — I have your live facility data and the calculation model. Ask me any what-if question."},...disp.map(m=>({role:m.role,content:m.content}))];const resp=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:600,messages:apiMsgs})});const d=await resp.json();const ans=d.content.filter(c=>c.type==="text").map(c=>c.text).join("\n")||"Sorry, no response.";setChat([...disp,{role:"assistant",content:ans}]);}catch{setChat([...disp,{role:"assistant",content:"⚠️ Error contacting the model. Please try again."}]);}setCbusy(false);};

  const exportPDF=async()=>{setPdfBusy(true);try{
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    const {jsPDF}=window.jspdf;const doc=new jsPDF({unit:"pt",format:"a4"});
    const PW=doc.internal.pageSize.getWidth(),PH=doc.internal.pageSize.getHeight(),M=40;let y=0;
    const C={navy:[13,21,38],blue:[29,78,216],slate:[100,116,139],dark:[30,41,59],green:[22,160,90],amber:[202,138,4],red:[220,60,60],line:[226,232,240],zebra:[245,247,250]};
    const sc=c=>doc.setTextColor(c[0],c[1],c[2]),fl=c=>doc.setFillColor(c[0],c[1],c[2]);
    fl(C.navy);doc.rect(0,0,PW,72,"F");fl(C.blue);doc.rect(0,0,6,72,"F");
    sc([255,255,255]);doc.setFont("helvetica","bold");doc.setFontSize(19);doc.text("Data Center Efficiency Report",M,32);
    doc.setFont("helvetica","normal");doc.setFontSize(9.5);sc([148,163,184]);doc.text("PUE  |  Carbon  |  Certification  |  Tier Resilience",M,49);doc.setFontSize(8);doc.text("Generated "+new Date().toLocaleString(),M,63);y=96;
    const brk=n=>{if(y+n>PH-44){doc.addPage();y=48;}};
    const head=t=>{brk(40);fl(C.blue);doc.rect(M,y,PW-2*M,19,"F");sc([255,255,255]);doc.setFont("helvetica","bold");doc.setFontSize(10.5);doc.text(t,M+8,y+13.5);y+=30;};
    const kv=(k,v,vc)=>{brk(20);doc.setFont("helvetica","normal");doc.setFontSize(9.5);sc(C.slate);doc.text(k,M+6,y);doc.setFont("helvetica","bold");sc(vc||C.dark);doc.text(String(v),PW-M-6,y,{align:"right"});doc.setDrawColor(C.line[0],C.line[1],C.line[2]);doc.setLineWidth(0.5);doc.line(M+6,y+6,PW-M-6,y+6);y+=20;};
    const th=(cols,w)=>{brk(24);fl(C.dark);doc.rect(M,y,PW-2*M,18,"F");sc([255,255,255]);doc.setFont("helvetica","bold");doc.setFontSize(8.5);let x=M+6;cols.forEach((c,i)=>{doc.text(c,x,y+12);x+=w[i];});y+=18;};
    const tr=(cells,w,i)=>{brk(18);if(i%2===0){fl(C.zebra);doc.rect(M,y,PW-2*M,16,"F");}sc(C.dark);doc.setFont("helvetica","normal");doc.setFontSize(8.5);let x=M+6;cells.forEach((c,j)=>{doc.text(String(c),x,y+11);x+=w[j];});y+=16;};
    const rate=res.pue<1.2?"Excellent":res.pue<1.5?"Good":res.pue<2?"Average":"Poor",pc=res.pue<1.2?C.green:res.pue<1.5?C.amber:C.red;
    head("1.  Facility Configuration");
    kv("Design Capacity",`${cfg.dL.toLocaleString()} kW`);kv("IT Utilization",`${cfg.u}%  (${Math.round(res.it).toLocaleString()} kW actual)`);kv("Cooling System",cfg.cooling);kv("Aisle Containment",cfg.containment);kv("Cold-Aisle Setpoint",`${cfg.setpoint} F`);kv("Redundancy",cfg.redun);kv("Distribution Topology",cfg.distribution);kv("Rack Density",`${cfg.rackKw} kW/rack  (${res.numRacks} racks)`);kv("Grid Region",`${cfg.region}  (${res.ci} kg CO2/kWh)`);kv("Climate Zone",`${cfg.climate}  (${res.fcH.toLocaleString()} free-cooling hrs/yr)`);
    head("2.  Key Performance Metrics");
    kv("Instantaneous PUE",`${res.pue.toFixed(2)}  (${rate})`,pc);kv("Annual Average PUE",res.aPUE.toFixed(2));kv("Total Facility Power",`${Math.round(res.tot).toLocaleString()} kW`);kv("Annual Energy Use",`${Math.round(res.annE).toLocaleString()} MWh/yr`);kv("Annual CO2 Emissions",`${Math.round(res.co2).toLocaleString()} tonnes/yr`);kv("Estimated Energy Cost",`$${Math.round(res.cost).toLocaleString()}/yr`);kv("Water Usage Effectiveness",`${res.wue} L/kWh`);kv("Annual Water Usage",`${Math.round(res.water).toLocaleString()} m3/yr`);
    head("3.  Certification & Resilience");
    kv("ENERGY STAR Score",`${es}/100  ${es>=75?"(Certifiable)":"(Below 75 threshold)"}`,es>=75?C.green:C.amber);kv("LEED v4 Estimate",`${leed.total} pts  (${lvl.name})`);kv("Uptime Institute Tier",tier.name,tier.tier>=3?C.green:C.dark);kv("Expected Availability",tier.avail);kv("Max Annual Downtime",tier.downtime);
    head("4.  Power Breakdown");th(["Component","Power (kW)","Share"],[300,120,80]);res.brkdn.forEach((b,i)=>tr([b.name,Math.round(b.value).toLocaleString(),`${(b.value/res.tot*100).toFixed(1)}%`],[300,120,80],i));
    head("5.  Partial Load PUE Curve");th(["IT Load","PUE"],[300,200]);res.lCurve.forEach((p,i)=>tr([p.load,p.PUE.toFixed(3)],[300,200],i));
    head("6.  Five-Year Projection");th(["Year","CO2 (tonnes/yr)","Energy Cost ($K/yr)"],[200,180,140]);res.proj.forEach((p,i)=>tr([p.year,p.co2.toLocaleString(),`$${p.cost.toLocaleString()}`],[200,180,140],i));
    if(roi.save>0){head("7.  Recommended Cooling Upgrade (ROI)");kv("Suggested Upgrade",roi.name);kv("Projected New PUE",roi.newPUE.toFixed(2),C.green);kv("Annual Energy Saving",`$${Math.round(roi.save).toLocaleString()}/yr`);kv("Estimated CapEx",`$${Math.round(roi.cpx).toLocaleString()}`);kv("Simple Payback",`${roi.pb.toFixed(1)} years`);}
    brk(70);y+=10;doc.setDrawColor(C.line[0],C.line[1],C.line[2]);doc.line(M,y,PW-M,y);y+=14;sc(C.slate);doc.setFont("helvetica","italic");doc.setFontSize(7.5);
    const disc="Standards referenced: ASHRAE 90.4 / TC 9.9, The Green Grid (PUE/WUE), Uptime Institute Tier Standard, ENERGY STAR for Data Centers, LEED v4 BD+C, IEA 2024 grid factors. This report is a modeling estimate for planning and demonstration purposes; certification and tier ratings require verified metering, commissioning, and accredited third-party review.";
    doc.text(doc.splitTextToSize(disc,PW-2*M),M,y);
    const pages=doc.internal.getNumberOfPages();for(let i=1;i<=pages;i++){doc.setPage(i);sc(C.slate);doc.setFont("helvetica","normal");doc.setFontSize(8);doc.text(`Page ${i} of ${pages}   -   DC Efficiency Suite`,PW/2,PH-20,{align:"center"});}
    const fname=`DC-Efficiency-Report-${new Date().toISOString().slice(0,10)}.pdf`;
    const blob=doc.output("blob");
    const url=URL.createObjectURL(blob);
    const win=window.open(url,"_blank");
    if(!win){const a=document.createElement("a");a.href=url;a.download=fname;a.style.display="none";document.body.appendChild(a);a.click();a.remove();}
    setTimeout(()=>URL.revokeObjectURL(url),120000);
  }catch(e){console.error(e);alert("PDF export failed: "+(e?.message||"unknown error"));}setPdfBusy(false);};

  const TABS=[["dash","📊 Dashboard","#1d4ed8"],["floor","🗺️ Floor Plan","#0d9488"],["certify","🏆 Certify","#ca8a04"],["compare","⚖️ Compare","#0891b2"],["recs","💡 Insights","#7c3aed"],["ask","🤖 Ask AI","#db2777"]];
  const SUGGEST=["What if I raise the setpoint to 80°F?","What if I switch to Direct Liquid Cooling?","How do I get below PUE 1.3?","What's needed to reach Tier IV?"];

  return(<div style={{fontFamily:"system-ui,sans-serif",background:"#070d1a",color:"#e2e8f0",minHeight:"100vh",display:"flex",flexDirection:"column"}}>
    <header style={{background:"#0d1526",borderBottom:"1px solid #1e293b",padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0,flexWrap:"wrap",gap:8}}>
      <div style={{display:"flex",alignItems:"center",gap:11}}><div style={{background:"#1d4ed8",borderRadius:8,padding:"7px 9px",fontSize:16}}>🏭</div><div><div style={{fontWeight:800,fontSize:14,color:"#f8fafc"}}>DC Efficiency Suite<span style={{fontSize:10,background:"#1d4ed8",padding:"2px 7px",borderRadius:4,marginLeft:6,fontWeight:600}}>v4.0</span></div><div style={{fontSize:"8.5px",color:"#64748b",letterSpacing:"0.5px"}}>PUE · CARBON · LEED/ENERGY STAR · UPTIME TIER · FLOOR PLAN · AI CHAT · PDF</div></div></div>
      <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
        {TABS.map(([id,lbl,ac])=><button key={id} onClick={id==="recs"?fetchRecs:()=>setTab(id)} style={{padding:"6px 10px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",border:"none",background:tab===id?ac:"#1e293b",color:tab===id?"white":"#94a3b8"}}>{lbl}</button>)}
        <div style={{width:1,height:20,background:"#1e293b",margin:"0 2px"}}/>
        <button onClick={exportPDF} disabled={pdfBusy} style={{padding:"6px 12px",borderRadius:6,fontSize:11,fontWeight:700,cursor:pdfBusy?"default":"pointer",border:"1px solid #059669",background:pdfBusy?"#1e293b":"#059669",color:pdfBusy?"#475569":"white"}}>{pdfBusy?"⏳ Generating...":"⬇ Export PDF"}</button>
      </div>
    </header>

    <div style={{display:"flex",flex:1,overflow:"hidden"}}>
      <aside style={{width:228,minWidth:228,background:"#0d1526",borderRight:"1px solid #1e293b",padding:"13px",overflowY:"auto"}}>
        <div style={{fontSize:10,fontWeight:700,color:"#3b82f6",textTransform:"uppercase",letterSpacing:1,marginBottom:12}}>⚙️ Facility Config</div>
        <Inp label="Design Capacity" unit="kW" value={cfg.dL} onChange={v=>set("dL",v)} min={10}/>
        <div style={{marginBottom:11}}><label style={{fontSize:10,color:"#64748b",display:"block",marginBottom:3,textTransform:"uppercase",letterSpacing:"0.5px"}}>IT Utilization <span style={{color:"#3b82f6",fontWeight:700}}>{cfg.u}%</span><span style={{color:"#334155",marginLeft:4}}>({Math.round(res.it)} kW)</span></label><input type="range" min="10" max="100" step="5" value={cfg.u} onChange={e=>set("u",+e.target.value)} style={{width:"100%",accentColor:"#3b82f6"}}/></div>
        <div style={{marginBottom:11}}><label style={{fontSize:10,color:"#64748b",display:"block",marginBottom:3,textTransform:"uppercase",letterSpacing:"0.5px"}}>Cold-Aisle Setpoint <span style={{color:res.effIntake>80.6?"#f59e0b":"#22c55e",fontWeight:700}}>{cfg.setpoint}°F</span></label><input type="range" min="65" max="85" step="1" value={cfg.setpoint} onChange={e=>set("setpoint",+e.target.value)} style={{width:"100%",accentColor:res.effIntake>80.6?"#f59e0b":"#22c55e"}}/><div style={{display:"flex",justifyContent:"space-between",fontSize:"8px",color:"#475569"}}><span>65°F</span><span>A1 max 80.6°F</span><span>85°F</span></div></div>
        <Slt label="Cooling System" value={cfg.cooling} onChange={v=>set("cooling",v)} opts={Object.keys(COOLING)}/>
        <Slt label="Containment" value={cfg.containment} onChange={v=>set("containment",v)} opts={Object.keys(CONTAIN)}/>
        <Slt label="Redundancy Tier" value={cfg.redun} onChange={v=>set("redun",v)} opts={Object.keys(REDUN)}/>
        <Slt label="Distribution Path" value={cfg.distribution} onChange={v=>set("distribution",v)} opts={Object.keys(DIST)}/>
        <Inp label="Rack Density" unit="kW/rack" value={cfg.rackKw} onChange={v=>set("rackKw",v)} min={1} max={100}/>
        <div style={{marginBottom:11,background:"#0a1628",borderRadius:6,padding:"8px 10px",border:"1px solid #1e3a5f"}}><div style={{fontSize:9,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.5px"}}>UPS Efficiency (auto)</div><div style={{fontSize:18,fontWeight:700,color:"#f59e0b",marginTop:2}}>{(res.ue*100).toFixed(1)}%</div><div style={{fontSize:8,color:"#475569",marginTop:1}}>Double-conversion @ {cfg.u}% load</div></div>
        <Inp label="Lighting" unit="kW" value={cfg.light} onChange={v=>set("light",v)} min={0}/>
        <Inp label="Other Loads" unit="kW" value={cfg.other} onChange={v=>set("other",v)} min={0}/>
        <Slt label="Grid Region" value={cfg.region} onChange={v=>set("region",v)} opts={Object.keys(CI)}/>
        <Slt label="Climate Zone" value={cfg.climate} onChange={v=>set("climate",v)} opts={Object.keys(FC_HRS)}/>
        <Inp label="Op. Hours" unit="hrs/yr" value={cfg.hrs} onChange={v=>set("hrs",v)} min={1} max={8760}/>
        <div style={{borderTop:"1px solid #1e293b",marginTop:4,paddingTop:10}}><div style={{fontSize:9,color:"#475569",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:7}}>Live Breakdown</div>
          {[["Annual Avg PUE",res.aPUE.toFixed(2)],["ENERGY STAR",`${es}/100`],["LEED",`${leed.total} pts`],["Uptime Tier",`Tier ${tier.roman}`],["Availability",tier.avail]].map(([k,v])=><div key={k} style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span style={{fontSize:10,color:"#64748b"}}>{k}</span><span style={{fontSize:10,color:"#94a3b8",fontWeight:600}}>{v}</span></div>)}
        </div>
      </aside>

      <main style={{flex:1,padding:13,overflowY:"auto"}}>
        {tab==="dash" && <>
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:9,marginBottom:11}}>
            <KPI icon="⚡" label="Instant PUE" value={res.pue.toFixed(2)} unit={res.pue<1.2?"Excellent":res.pue<1.5?"Good":res.pue<2?"Average":"Poor"} color={pCol} sub={`Annual: ${res.aPUE.toFixed(2)}`}/>
            <KPI icon="🌍" label="CO2 / Year" value={Math.round(res.co2).toLocaleString()} unit="tonnes / year" color="#06b6d4"/>
            <KPI icon="🔋" label="Annual Energy" value={Math.round(res.annE).toLocaleString()} unit="MWh / year" color="#8b5cf6"/>
            <KPI icon="🛡️" label="Uptime Tier" value={`Tier ${tier.roman}`} unit={tier.avail+" avail"} color={tier.color} sub={tier.short}/>
            <KPI icon="🏆" label="ENERGY STAR" value={`${es}`} unit="/ 100 score" color={es>=75?"#22c55e":"#f59e0b"} sub={es>=75?"Certifiable ✓":"Below 75"}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:9}}>
            <div style={SC.card}><div style={SC.sec}>PUE Gauge — ASHRAE 90.4-2019</div><Gauge pue={res.pue}/><div style={{display:"flex",justifyContent:"center",gap:10,marginTop:4}}>{[["#22c55e","<1.2 Excellent"],["#f59e0b","1.2–1.5 Good"],["#ef4444",">1.5 Poor"]].map(([c,l])=><span key={l} style={{fontSize:9,color:c}}>● {l}</span>)}</div></div>
            <div style={SC.card}><div style={SC.sec}>Power Breakdown — {cfg.redun}</div><ResponsiveContainer width="100%" height={180}><PieChart><Pie data={res.brkdn} cx="50%" cy="47%" outerRadius={68} innerRadius={28} dataKey="value" label={({percent})=>percent>0.04?`${(percent*100).toFixed(0)}%`:""} labelLine={false} fontSize={10}>{res.brkdn.map((e,i)=><Cell key={i} fill={e.color}/>)}</Pie><Tooltip contentStyle={TT} formatter={v=>[`${v} kW`]}/></PieChart></ResponsiveContainer><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2px 8px"}}>{res.brkdn.map(e=><div key={e.name} style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:8,height:8,borderRadius:2,background:e.color}}/><span style={{fontSize:10,color:"#94a3b8"}}>{e.name}: {e.value} kW</span></div>)}</div></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:9}}>
            <div style={SC.card}><div style={SC.sec}>Partial Load PUE Curve — Current: {cfg.u}%</div><ResponsiveContainer width="100%" height={170}><AreaChart data={res.lCurve}><defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/><XAxis dataKey="load" tick={{fill:"#475569",fontSize:9}}/><YAxis domain={[1,"auto"]} tick={{fill:"#475569",fontSize:9}} tickFormatter={v=>v.toFixed(2)}/><Tooltip contentStyle={TT} formatter={v=>[v.toFixed(3),"PUE"]}/><Area type="monotone" dataKey="PUE" stroke="#3b82f6" fill="url(#pg)" strokeWidth={2} dot={{fill:"#3b82f6",r:3}}/></AreaChart></ResponsiveContainer><div style={{fontSize:9,color:"#475569",marginTop:3}}>↑ PUE rises at low utilization — fixed overhead dominates</div></div>
            <div style={SC.card}><div style={SC.sec}>UPS Efficiency Curve — Double-Conversion</div><ResponsiveContainer width="100%" height={170}><AreaChart data={upsChartData}><defs><linearGradient id="ug" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22c55e" stopOpacity={0.35}/><stop offset="95%" stopColor="#22c55e" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/><XAxis dataKey="load" tick={{fill:"#475569",fontSize:9}}/><YAxis domain={[88,100]} tick={{fill:"#475569",fontSize:9}} unit="%"/><Tooltip contentStyle={TT} formatter={v=>[`${v}%`,"Eff."]}/><Area type="monotone" dataKey="eff" stroke="#22c55e" fill="url(#ug)" strokeWidth={2} dot={{fill:"#22c55e",r:3}}/></AreaChart></ResponsiveContainer><div style={{fontSize:9,color:"#475569",marginTop:3}}>Operating: <span style={{color:"#f59e0b",fontWeight:600}}>{cfg.u}% → {(res.ue*100).toFixed(1)}%</span></div></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:9}}>
            <div style={SC.card}><div style={SC.sec}>PUE vs Hyperscalers — Uptime 2024</div><ResponsiveContainer width="100%" height={170}><BarChart data={res.bench} layout="vertical" margin={{left:5,right:36}}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false}/><XAxis type="number" domain={[1,2]} tick={{fill:"#475569",fontSize:9}}/><YAxis type="category" dataKey="name" tick={{fill:"#94a3b8",fontSize:10}} width={65}/><Tooltip contentStyle={TT}/><Bar dataKey="PUE" radius={[0,4,4,0]} label={{position:"right",fill:"#64748b",fontSize:9}}>{res.bench.map((e,i)=><Cell key={i} fill={e.name==="You"?"#10b981":"#1d4ed8"}/>)}</Bar></BarChart></ResponsiveContainer></div>
            <div style={SC.card}><div style={SC.sec}>5-Year CO2 & Cost Trajectory</div><ResponsiveContainer width="100%" height={170}><LineChart data={res.proj}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/><XAxis dataKey="year" tick={{fill:"#475569",fontSize:9}}/><YAxis yAxisId="l" tick={{fill:"#475569",fontSize:9}}/><YAxis yAxisId="r" orientation="right" tick={{fill:"#475569",fontSize:9}}/><Tooltip contentStyle={TT}/><Legend iconSize={8} wrapperStyle={{fontSize:10,color:"#94a3b8"}}/><Line yAxisId="l" type="monotone" dataKey="co2" stroke="#06b6d4" strokeWidth={2} dot={{r:2}} name="CO2 (t)"/><Line yAxisId="r" type="monotone" dataKey="cost" stroke="#f59e0b" strokeWidth={2} dot={{r:2}} name="Cost ($K)"/></LineChart></ResponsiveContainer></div>
          </div>
          {roi.save>0&&(<div style={{...SC.card,background:"#0a1628",borderColor:"#1d4ed850"}}><div style={SC.sec}>💰 Best Upgrade ROI — Cooling Retrofit</div><div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,textAlign:"center"}}>{[["Upgrade To",roi.name,"#3b82f6"],["New PUE",roi.newPUE.toFixed(2),"#22c55e"],["Annual Saving",`$${Math.round(roi.save/1000)}K/yr`,"#f59e0b"],["Est. CapEx",`$${Math.round(roi.cpx/1000)}K`,"#8b5cf6"],["Payback",`${roi.pb.toFixed(1)} yrs`,"#06b6d4"]].map(([l,v,c])=><div key={l}><div style={{fontSize:16,fontWeight:700,color:c}}>{v}</div><div style={{fontSize:9,color:"#64748b",marginTop:2}}>{l}</div></div>)}</div></div>)}
        </>}

        {tab==="floor" && (<div>
          <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:12}}><div style={{fontSize:13,fontWeight:700,color:"#f8fafc"}}>🗺️ 2D Floor Plan — Hot/Cold Aisle Thermal Map</div><div style={{fontSize:11,color:"#475569"}}>Adjust setpoint, containment & rack density to see live thermal effects</div></div>
          <div style={{display:"grid",gridTemplateColumns:"1.6fr 1fr",gap:9}}>
            <div style={SC.card}><div style={SC.sec}>Data Hall — {res.numRacks} racks · {cfg.containment} Containment</div><FloorPlan res={res} cfg={cfg}/></div>
            <div style={{display:"flex",flexDirection:"column",gap:9}}>
              <div style={SC.card}><div style={SC.sec}>Thermal Readout</div>{[["Cold Aisle Supply",`${cfg.setpoint}°F`,tempColor(cfg.setpoint)],["Server ΔT (rise)",`${res.deltaT}°F`,"#94a3b8"],["Hot Aisle Temp",`${res.hotAisleTemp}°F`,tempColor(res.hotAisleTemp)],["Effective Intake",`${res.effIntake}°F`,res.effIntake>80.6?"#f59e0b":"#22c55e"]].map(([l,v,c])=><div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:"1px solid #1e293b"}}><span style={{fontSize:11,color:"#64748b"}}>{l}</span><span style={{fontSize:15,fontWeight:700,color:c}}>{v}</span></div>)}</div>
              <div style={SC.card}><div style={SC.sec}>Capacity</div>{[["Total Racks",`${res.numRacks}`],["Rack Density",`${cfg.rackKw} kW`],["IT Load",`${Math.round(res.it)} kW`],["Cooling Mode",cfg.cooling]].map(([l,v])=><div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 0"}}><span style={{fontSize:11,color:"#64748b"}}>{l}</span><span style={{fontSize:12,color:"#94a3b8",fontWeight:600}}>{v}</span></div>)}</div>
              <div style={{...SC.card,background:"#0a1628",borderColor:"#1e3a5f"}}><div style={{fontSize:10,color:"#3b82f6",fontWeight:700,marginBottom:6}}>💡 ENGINEERING NOTE</div><p style={{fontSize:11,color:"#94a3b8",lineHeight:1.6,margin:0}}>Raising the setpoint warms the whole map (less cooling energy) but pushes effective intake toward the ASHRAE A1 ceiling. {cfg.containment==="None"?"Adding containment would cut the +7°F recirculation penalty.":`${cfg.containment} containment keeps recirculation low.`}</p></div>
            </div>
          </div>
        </div>)}

        {tab==="certify" && (<div>
          <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:12}}><div style={{fontSize:13,fontWeight:700,color:"#f8fafc"}}>🏆 Certification & Resilience</div><div style={{fontSize:11,color:"#475569"}}>ENERGY STAR · LEED v4 · Uptime Institute Tier</div></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            <div style={SC.card}><div style={SC.sec}>ENERGY STAR Score</div>
              <div style={{textAlign:"center",margin:"8px 0"}}><div style={{fontSize:48,fontWeight:800,color:es>=75?"#22c55e":es>=50?"#f59e0b":"#ef4444",lineHeight:1}}>{es}</div><div style={{fontSize:11,color:"#64748b"}}>out of 100</div></div>
              <div style={{position:"relative",height:14,background:"linear-gradient(90deg,#ef4444,#f59e0b,#22c55e)",borderRadius:7,marginTop:14}}><div style={{position:"absolute",left:`${es}%`,top:-4,transform:"translateX(-50%)",width:0,height:0,borderLeft:"6px solid transparent",borderRight:"6px solid transparent",borderTop:"10px solid white"}}/><div style={{position:"absolute",left:"75%",top:-6,bottom:-6,width:2,background:"#fff",opacity:0.6}}/><div style={{position:"absolute",left:"75%",top:-20,transform:"translateX(-50%)",fontSize:8,color:"#94a3b8",whiteSpace:"nowrap"}}>75 = Certified</div></div>
              <div style={{marginTop:24,textAlign:"center",padding:"10px",borderRadius:8,background:es>=75?"#051a0a":"#1a1000",border:`1px solid ${es>=75?"#22c55e":"#f59e0b"}`}}><div style={{fontSize:13,fontWeight:700,color:es>=75?"#22c55e":"#f59e0b"}}>{es>=75?"✓ ENERGY STAR Certifiable":"Not Yet Eligible"}</div><div style={{fontSize:10,color:"#64748b",marginTop:3}}>{es>=75?"Top-quartile efficiency — eligible to apply for EPA certification.":`Need ≥75. Reduce PUE toward ~1.3 (currently ${res.pue.toFixed(2)}).`}</div></div>
            </div>
            <div style={SC.card}><div style={SC.sec}>LEED v4 BD+C Estimate</div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",margin:"4px 0 12px"}}><div><div style={{fontSize:40,fontWeight:800,color:lvl.color,lineHeight:1}}>{leed.total}</div><div style={{fontSize:11,color:"#64748b"}}>points (of 88 modeled)</div></div><div style={{textAlign:"center",padding:"10px 16px",borderRadius:8,background:lvl.color+"18",border:`1px solid ${lvl.color}`}}><div style={{fontSize:20}}>{leed.total>=80?"🏆":leed.total>=60?"🥇":leed.total>=50?"🥈":leed.total>=40?"✅":"○"}</div><div style={{fontSize:12,fontWeight:700,color:lvl.color,marginTop:2}}>{lvl.name}</div></div></div>
              {[["Energy & Atmosphere",leed.ea,33,"#22c55e"],["Carbon / Clean Grid",leed.ce,20,"#06b6d4"],["Water Efficiency",leed.we,11,"#3b82f6"],["Sustainable Sites",leed.ss,10,"#8b5cf6"],["Materials (est.)",leed.mr,12,"#64748b"],["Innovation",leed.inv,6,"#f59e0b"]].map(([l,v,mx,c])=><div key={l} style={{marginBottom:7}}><div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:2}}><span style={{color:"#94a3b8"}}>{l}</span><span style={{color:c,fontWeight:600}}>{v}/{mx}</span></div><div style={{height:6,background:"#1e293b",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${(v/mx)*100}%`,background:c,borderRadius:3}}/></div></div>)}
            </div>
          </div>

          {/* Uptime Tier */}
          <div style={{...SC.card,marginBottom:10}}><div style={SC.sec}>🛡️ Uptime Institute Tier Classification</div>
            <div style={{display:"grid",gridTemplateColumns:"0.8fr 1.2fr",gap:14}}>
              <div style={{textAlign:"center",padding:"16px",borderRadius:10,background:tier.color+"15",border:`1px solid ${tier.color}`}}>
                <div style={{fontSize:44,fontWeight:800,color:tier.color,lineHeight:1}}>{tier.roman}</div>
                <div style={{fontSize:12,fontWeight:700,color:"#f1f5f9",marginTop:6}}>{tier.short}</div>
                <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${tier.color}40`}}><div style={{fontSize:20,fontWeight:700,color:tier.color}}>{tier.avail}</div><div style={{fontSize:9,color:"#64748b"}}>expected availability</div><div style={{fontSize:12,color:"#94a3b8",marginTop:6}}>≤ {tier.downtime} downtime</div></div>
              </div>
              <div><div style={{fontSize:10,color:"#475569",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8}}>Requirements Met</div>
                {tier.reqs.map(r=><div key={r.label} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}><span style={{fontSize:14,color:r.met?"#22c55e":"#475569"}}>{r.met?"✓":"○"}</span><span style={{fontSize:11,color:r.met?"#94a3b8":"#475569"}}>{r.label}</span></div>)}
                {tier.tier<4&&<div style={{marginTop:8,padding:"8px 10px",borderRadius:6,background:"#0a1628",border:"1px solid #1e3a5f",fontSize:11,color:"#93c5fd"}}>⬆ To reach Tier {["","II","III","IV"][tier.tier]}: {tier.next}</div>}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginTop:14}}>
              {[1,2,3,4].map(t=>{const T=TIERS[t],active=t===tier.tier;return(<div key={t} style={{textAlign:"center",padding:"10px 6px",borderRadius:8,background:active?T.color+"20":"#0a0f1e",border:`1px solid ${active?T.color:"#1e293b"}`}}><div style={{fontSize:16,fontWeight:800,color:T.color}}>{T.roman}</div><div style={{fontSize:8.5,color:"#94a3b8",marginTop:3}}>{T.short}</div><div style={{fontSize:9,color:"#64748b",marginTop:3}}>{T.avail}</div><div style={{fontSize:8,color:"#475569"}}>{T.downtime}</div>{active&&<div style={{fontSize:8,color:T.color,marginTop:3}}>◄ current</div>}</div>);})}
            </div>
          </div>

          <div style={SC.card}><div style={SC.sec}>LEED Certification Thresholds</div><div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>{[["Certified","40–49","#22c55e"],["Silver","50–59","#cbd5e1"],["Gold","60–79","#fbbf24"],["Platinum","80+","#e5e4e2"]].map(([n,r,c])=><div key={n} style={{textAlign:"center",padding:"10px",borderRadius:8,background:lvl.name===n?c+"20":"#0a0f1e",border:`1px solid ${lvl.name===n?c:"#1e293b"}`}}><div style={{fontSize:13,fontWeight:700,color:c}}>{n}</div><div style={{fontSize:10,color:"#64748b",marginTop:2}}>{r} pts</div>{lvl.name===n&&<div style={{fontSize:9,color:c,marginTop:3}}>◄ you are here</div>}</div>)}</div><div style={{fontSize:9,color:"#334155",marginTop:10}}>* Simplified models for portfolio demonstration. Real certification & tier ratings require verified metering, commissioning, and accredited third-party review. Use the Export PDF button to generate a full report.</div></div>
        </div>)}

        {tab==="compare" && (<div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:13}}><div><div style={{fontSize:13,fontWeight:700,color:"#f8fafc"}}>⚖️ Scenario A vs B</div><div style={{fontSize:11,color:"#475569"}}>Save baseline as A, then adjust sidebar for B</div></div><button onClick={()=>setSA({...cfg})} style={{padding:"8px 14px",borderRadius:6,fontSize:12,fontWeight:700,cursor:"pointer",border:"none",background:"#0891b2",color:"white"}}>📌 Save as Scenario A</button></div>
          {!sA?(<div style={{textAlign:"center",padding:"70px 0",color:"#475569"}}><div style={{fontSize:36,marginBottom:12}}>📌</div><div>Configure your <strong style={{color:"#94a3b8"}}>baseline</strong>, then click <strong style={{color:"#0891b2"}}>Save as Scenario A</strong>.</div><div style={{marginTop:6,fontSize:12}}>Then change the sidebar to create Scenario B.</div></div>):(<>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:11}}>{[["🅰️ Scenario A — Baseline",resA,sA,"#0891b2"],["🅱️ Scenario B — Current",res,cfg,"#7c3aed"]].map(([lbl,r,cf,ac])=><div key={lbl} style={{...SC.card,borderColor:ac+"60"}}><div style={{fontSize:11,fontWeight:700,color:ac,marginBottom:9}}>{lbl}</div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>{[["PUE",r.pue.toFixed(2),r.pue<1.2?"#22c55e":r.pue<1.5?"#f59e0b":"#ef4444"],["Annual PUE",r.aPUE.toFixed(2),"#94a3b8"],["CO2 t/yr",Math.round(r.co2).toLocaleString(),"#06b6d4"],["Cost/yr",`$${Math.round(r.cost/1000)}K`,"#f59e0b"],["E-STAR",`${energyStar(r.pue)}`,"#22c55e"],["Tier",`${tierOf(cf.redun,cf.distribution).roman}`,"#3b82f6"]].map(([k,v,c])=><div key={k} style={{background:"#0a0f1e",borderRadius:6,padding:"7px 9px"}}><div style={{fontSize:9,color:"#64748b"}}>{k}</div><div style={{fontSize:15,fontWeight:700,color:c}}>{v}</div></div>)}</div></div>)}</div>
            <div style={{...SC.card,marginBottom:11,background:"#0a1020"}}><div style={SC.sec}>Δ Delta — B vs A</div><div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,textAlign:"center"}}>{[["PUE Δ",res.pue-resA.pue,v=>v<=0,v=>v.toFixed(3)],["CO2 Δ (t)",res.co2-resA.co2,v=>v<=0,v=>Math.round(v).toLocaleString()],["Energy Δ MWh",res.annE-resA.annE,v=>v<=0,v=>Math.round(v).toLocaleString()],["Cost Δ",(res.cost-resA.cost)/1000,v=>v<=0,v=>`$${v.toFixed(0)}K`],["E-STAR Δ",energyStar(res.pue)-energyStar(resA.pue),v=>v>=0,v=>v]].map(([l,raw,better,fmt])=>{const b=better(raw);const col=Math.abs(raw)<0.001?"#94a3b8":b?"#22c55e":"#ef4444";const sign=raw>0.001?"+":"";return<div key={l}><div style={{fontSize:17,fontWeight:700,color:col}}>{sign}{fmt(raw)}</div><div style={{fontSize:9,color:"#64748b",marginTop:3}}>{l}</div><div style={{fontSize:9,color:col,marginTop:2}}>{Math.abs(raw)<0.001?"No change":b?"✅ Better":"⚠️ Worse"}</div></div>;})}</div></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
              <div style={SC.card}><div style={SC.sec}>PUE Load Curve — A vs B</div><ResponsiveContainer width="100%" height={195}><LineChart data={resA.lCurve.map((row,i)=>({...row,PUE_B:res.lCurve[i].PUE}))}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/><XAxis dataKey="load" tick={{fill:"#475569",fontSize:9}}/><YAxis domain={[1,"auto"]} tick={{fill:"#475569",fontSize:9}} tickFormatter={v=>v.toFixed(2)}/><Tooltip contentStyle={TT} formatter={v=>[v.toFixed(3)]}/><Legend iconSize={8} wrapperStyle={{fontSize:10,color:"#94a3b8"}}/><Line type="monotone" dataKey="PUE" stroke="#0891b2" strokeWidth={2} dot={{r:3}} name="A"/><Line type="monotone" dataKey="PUE_B" stroke="#7c3aed" strokeWidth={2} dot={{r:3}} name="B"/></LineChart></ResponsiveContainer></div>
              <div style={SC.card}><div style={SC.sec}>CO2 Trajectory — A vs B</div><ResponsiveContainer width="100%" height={195}><LineChart data={resA.proj.map((row,i)=>({...row,co2B:res.proj[i].co2}))}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/><XAxis dataKey="year" tick={{fill:"#475569",fontSize:9}}/><YAxis tick={{fill:"#475569",fontSize:9}}/><Tooltip contentStyle={TT}/><Legend iconSize={8} wrapperStyle={{fontSize:10,color:"#94a3b8"}}/><Line type="monotone" dataKey="co2" stroke="#0891b2" strokeWidth={2} dot={{r:2}} name="A"/><Line type="monotone" dataKey="co2B" stroke="#7c3aed" strokeWidth={2} dot={{r:2}} name="B"/></LineChart></ResponsiveContainer></div>
            </div>
          </>)}
        </div>)}

        {tab==="recs" && (<div>
          <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:13}}><div style={{fontSize:13,fontWeight:700,color:"#f8fafc"}}>💡 Engineering-Grade AI Recommendations</div><div style={{fontSize:11,color:"#475569"}}>Claude AI · ASHRAE / Green Grid</div></div>
          {busy?(<div style={{textAlign:"center",padding:"80px 0",color:"#64748b"}}><div style={{fontSize:36,marginBottom:12}}>⚙️</div><div style={{fontSize:13}}>Analyzing facility metrics...</div></div>):recs.length===0?(<div style={{textAlign:"center",padding:"80px 0",color:"#475569"}}><div style={{fontSize:36,marginBottom:12}}>🤖</div><div>Click <strong style={{color:"#94a3b8"}}>Insights</strong> to generate recommendations.</div></div>):(<div style={{display:"flex",flexDirection:"column",gap:9}}>{recs.map((rec,i)=><div key={i} style={SC.card}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}><div style={{display:"flex",gap:10,alignItems:"center"}}><span style={{fontSize:22}}>{CAT[rec.category]||"🔧"}</span><div><div style={{fontWeight:700,color:"#f1f5f9",fontSize:13}}>{rec.title}</div><div style={{fontSize:10,color:"#475569"}}>{rec.category} · <span style={{color:"#3b82f6"}}>{rec.standard}</span></div></div></div><span style={{fontSize:10,fontWeight:700,padding:"3px 8px",borderRadius:4,border:"1px solid",whiteSpace:"nowrap",...(rec.impact==="High"?{color:"#ef4444",borderColor:"#ef4444",background:"#1a0505"}:rec.impact==="Medium"?{color:"#f59e0b",borderColor:"#f59e0b",background:"#1a1000"}:{color:"#22c55e",borderColor:"#22c55e",background:"#051a0a"})}}>{rec.impact} Impact</span></div><p style={{fontSize:12,color:"#94a3b8",margin:"0 0 10px",lineHeight:1.7}}>{rec.description}</p><div style={{display:"flex",gap:20}}><span style={{fontSize:11}}><span style={{color:"#64748b"}}>📉 PUE Reduction: </span><span style={{color:"#22c55e",fontWeight:600}}>{rec.pueReduction}</span></span><span style={{fontSize:11}}><span style={{color:"#64748b"}}>🌍 CO2 Saving: </span><span style={{color:"#06b6d4",fontWeight:600}}>{rec.co2Saving}</span></span></div></div>)}</div>)}
        </div>)}

        {tab==="ask" && (<div style={{display:"flex",flexDirection:"column",height:"100%",maxHeight:"calc(100vh - 110px)"}}>
          <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:10}}><div style={{fontSize:13,fontWeight:700,color:"#f8fafc"}}>🤖 Ask the Engineer — Live What-If Analysis</div><div style={{fontSize:11,color:"#475569"}}>Claude knows your live config & the calc model</div></div>
          <div style={{flex:1,overflowY:"auto",...SC.card,padding:16,marginBottom:10}}>
            {chat.length===0?(<div style={{textAlign:"center",padding:"20px 0",color:"#64748b"}}><div style={{fontSize:36,marginBottom:10}}>💬</div><div style={{fontSize:13,marginBottom:4}}>Ask a what-if question about your facility.</div><div style={{fontSize:11,color:"#475569",marginBottom:16}}>Answers calculated against live config (PUE {res.pue.toFixed(2)}, {cfg.cooling}, {cfg.setpoint}°F, Tier {tier.roman}).</div><div style={{display:"flex",flexDirection:"column",gap:7,maxWidth:420,margin:"0 auto"}}>{SUGGEST.map(s=><button key={s} onClick={()=>sendChat(s)} style={{textAlign:"left",padding:"9px 12px",borderRadius:8,border:"1px solid #1e3a5f",background:"#0a1628",color:"#93c5fd",fontSize:12,cursor:"pointer"}}>💭 {s}</button>)}</div></div>):(<div style={{display:"flex",flexDirection:"column",gap:12}}>{chat.map((m,i)=><div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}><div style={{maxWidth:"82%",padding:"10px 13px",borderRadius:12,fontSize:12.5,lineHeight:1.6,whiteSpace:"pre-wrap",...(m.role==="user"?{background:"#1d4ed8",color:"white",borderBottomRightRadius:3}:{background:"#1e293b",color:"#e2e8f0",borderBottomLeftRadius:3,border:"1px solid #334155"})}}>{m.role==="assistant"&&<div style={{fontSize:9,color:"#db2777",fontWeight:700,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.5px"}}>🤖 DC Engineer</div>}{m.content}</div></div>)}{cbusy&&<div style={{display:"flex",justifyContent:"flex-start"}}><div style={{padding:"10px 13px",borderRadius:12,background:"#1e293b",border:"1px solid #334155",fontSize:12,color:"#64748b"}}>⚙️ Calculating...</div></div>}<div ref={chatEnd}/></div>)}
          </div>
          <div style={{display:"flex",gap:8}}><input value={cin} onChange={e=>setCin(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")sendChat();}} placeholder="e.g. What if I raise setpoint to 80°F and add hot-aisle containment?" style={{flex:1,background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"11px 13px",color:"#e2e8f0",fontSize:12.5,outline:"none"}}/><button onClick={()=>sendChat()} disabled={cbusy||!cin.trim()} style={{padding:"0 20px",borderRadius:8,border:"none",background:cbusy||!cin.trim()?"#1e293b":"#db2777",color:cbusy||!cin.trim()?"#475569":"white",fontSize:13,fontWeight:700,cursor:cbusy||!cin.trim()?"default":"pointer"}}>Send</button></div>
        </div>)}
      </main>
    </div>

    <footer style={{background:"#0d1526",borderTop:"1px solid #1e293b",padding:"6px 16px",display:"flex",gap:14,flexWrap:"wrap",flexShrink:0}}>{["📐 ASHRAE 90.4 / TC 9.9","📊 Green Grid","🏢 Uptime Institute Tier","🏆 ENERGY STAR / LEED v4","🌍 IEA 2024"].map(s=><span key={s} style={{fontSize:8.5,color:"#334155"}}>{s}</span>)}</footer>
  </div>);
}

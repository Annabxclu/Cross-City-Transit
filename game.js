/* Freight Dispatch — game logic and street map.
   Map tiles: OpenStreetMap. Road routes: OSRM (public demo server). */
(() => {
"use strict";

/* ---------------- Settings ---------------- */
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ROUTER = "https://router.project-osrm.org/route/v1/driving/";
const KEY = "freight-dispatch-v2";
const MI_DEG = 69.0;

/* ---------------- Helpers ---------------- */
const $ = s => document.querySelector(s);
const rnd = (a,b) => a + Math.random()*(b-a);
const pick = a => a[Math.floor(Math.random()*a.length)];
const money = n => (n<0?"−$":"$") + Math.abs(Math.round(n)).toLocaleString("en-US");
const esc = s => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const cityName = i => `${CITIES[i].n} ${CITIES[i].s}`;
function hav(a,b){const R=3959,t=Math.PI/180;const dl=(b.lat-a.lat)*t,dn=(b.lon-a.lon)*t;const x=Math.sin(dl/2)**2+Math.cos(a.lat*t)*Math.cos(b.lat*t)*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
const roadMi = (i,j) => Math.round(hav(CITIES[i],CITIES[j])*1.2);
const estMi = (a,b) => Math.max(1, Math.round(hav(a,b)*1.25));
function dur(ms){ms=Math.max(0,ms);const s=Math.round(ms/1000);if(s<60)return s+"s";const m=Math.floor(s/60),r=s%60;if(m<60)return `${m}m ${String(r).padStart(2,"0")}s`;return `${Math.floor(m/60)}h ${m%60}m`;}
const weightStr = j => j.cargo==="vehicles" ? `${j.weight} cars` : `${j.weight.toLocaleString("en-US")} lb`;
const xpNeed = L => Math.round(50*Math.pow(L-1,1.8));
function levelOf(xp){let L=1;while(L<50 && xp>=xpNeed(L+1))L++;return L;}
const drvLevel = d => {let l=1;DRV_LEVELS.forEach((t,i)=>{if(d.jobs>=t)l=i+1;});return Math.min(5,l);};
function payFor(miles, weight, cargo, urg){
  const w = cargo==="vehicles" ? weight*4000 : weight;
  const u = urg==="express"?1.8:urg==="priority"?1.3:1;
  return Math.round((150 + 1.5*miles*Math.pow(w/1000,0.8)) * CARGO[cargo].mult * u * PAY_SCALE);
}
function offsetPt(lat, lon, miles, ang){
  return {lat: lat + Math.sin(ang)*miles/MI_DEG, lon: lon + Math.cos(ang)*miles/(MI_DEG*Math.cos(lat*Math.PI/180))};
}
function bizName(type){
  const suf = pick(NAME_SUFFIX[type] || [type]);
  const word = Math.random()<0.25 ? `${pick(LAST)} ${pick(["& Sons","Brothers","& Co."])}` : pick(NAME_WORDS);
  return `${word} ${suf}`;
}
const houseNo = () => Math.round(rnd(1,99))*100 + Math.round(rnd(0,99));
function addrLine(p){
  const street = p.street || pick(FALLBACK_STREETS);
  if(!p.street) p.street = street;
  const far = hav(p, CITIES[p.c]) > 12;
  return `${p.num||100} ${street}, ${far?"near ":""}${cityName(p.c)}`;
}
const cityPt = i => ({lat:CITIES[i].lat, lon:CITIES[i].lon});
const basePt = b => b.pt || cityPt(b.city);

/* ---------------- Road routing (OSRM) ---------------- */
const routeCache = new Map();
let routeQueue = Promise.resolve();
const rkey = (a,b) => `${a.lat.toFixed(4)},${a.lon.toFixed(4)};${b.lat.toFixed(4)},${b.lon.toFixed(4)}`;
function thin(coords, max){
  if(coords.length<=max) return coords;
  const step = (coords.length-1)/(max-1), out=[];
  for(let i=0;i<max;i++) out.push(coords[Math.round(i*step)]);
  return out;
}
function getRoute(a, b){
  const k = rkey(a,b);
  if(routeCache.has(k)) return routeCache.get(k);
  const p = routeQueue.then(async () => {
    try{
      const ctl = new AbortController(); const timer = setTimeout(()=>ctl.abort(), 9000);
      const res = await fetch(`${ROUTER}${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`, {signal:ctl.signal});
      clearTimeout(timer);
      if(!res.ok) throw new Error(res.status);
      const js = await res.json();
      const r = js.routes && js.routes[0]; if(!r) throw new Error("no route");
      const coords = thin(r.geometry.coordinates.map(c=>[+c[1].toFixed(5), +c[0].toFixed(5)]), 600);
      const wp = js.waypoints||[];
      return {mi: r.distance/1609.34, sec: r.duration, path: coords, names: wp.map(w=>w.name||""), locs: wp.map(w=>({lat:w.location[1], lon:w.location[0]}))};
    }catch(e){ routeCache.delete(k); return null; }
    finally{ await new Promise(r=>setTimeout(r, 700)); }  // be polite to the shared demo server
  });
  routeQueue = p.catch(()=>{});
  routeCache.set(k, p);
  return p;
}
const straight = (a,b) => [[a.lat,a.lon],[b.lat,b.lon]];

/* ---------------- State ---------------- */
let S = null;
let selectedJob = null, tab = "jobs", pendingConfirm = null, chosenVeh = null;
const nid = p => p + (++S.idc);
const level = () => levelOf(S.xp);
const baseById = id => S.bases.find(b=>b.id===id);
const hubCap = b => HUB_TIERS[b.tier||0].cap;
const maxJobs = () => S.vehicles.length + 1;

function newGame(co, stateCode, place){
  S = {v:2, company:co, homeState:stateCode, clock:0, lastReal:Date.now(), speed:1, cash:0, xp:0,
    earned:0, jobsDone:0, idc:0, payMult:1, bases:[], vehicles:[], drivers:[], jobs:[], trips:[], hired:0, log:[]};
  const b = {id:nid("b"), city:place.city, pt:place.pt, addr:place.addr, name:place.name||"HQ", tier:0, dispatcher:false, home:true};
  S.bases.push(b);
  S.drivers.push({id:nid("d"), name:`${pick(FIRST)} ${pick(LAST)}`, kind:"std", jobs:0, busy:false, hazmat:false, earned:0});
  S.vehicles.push({id:nid("v"), type:"van", base:b.id, n:"Van 1", busy:false, jobs:0});
  S.nextJobAt = JOB_EVERY_MS; spawnJob(b); spawnJob(b);
}
const baseName = b => b.name || (b.home ? "HQ" : "Hub");
const baseAddr = b => b.addr || cityName(b.city);
function nearestCity(p){ let best=0, bd=1e9; for(const c of CITIES){ const d=hav(p,c); if(d<bd){bd=d;best=c.i;} } return best; }
const STATE_CODE = Object.fromEntries(Object.entries(STATES).map(([k,n])=>[n,k]));
async function reverseGeocode(p){
  try{
    const ctl = new AbortController(); const tm = setTimeout(()=>ctl.abort(), 8000);
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=en&lat=${p.lat}&lon=${p.lon}`, {signal:ctl.signal});
    clearTimeout(tm);
    if(!r.ok) throw 0;
    const js = await r.json(), a = js.address || {};
    const town = a.city || a.town || a.village || a.hamlet || a.suburb || a.county || "";
    const st = STATE_CODE[a.state] || "";
    const street = [a.house_number, a.road].filter(Boolean).join(" ");
    return {line: [street, town && st ? `${town} ${st}` : (town||a.state||"")].filter(Boolean).join(", "), state: st, ok:true, us: a.country_code==="us"};
  }catch(_){
    const c = CITIES[nearestCity(p)];
    return {line:`Near ${c.n} ${c.s}`, state:c.s, ok:false, us:true};
  }
}

/* ---------------- Jobs ---------------- */
const citiesNear = (ci, maxMi) => CITIES.filter(c=>roadMi(ci,c.i)<=maxMi).map(c=>c.i);
function spawnJob(base, depth=0){
  const L = level();
  const ownedTypes = [...new Set(S.vehicles.map(v=>v.type))];
  const reach = TYPES.filter(t=>t.lvl<=L+4);
  // Keep the board useful: while fewer jobs fit your fleet than you have vehicles, only post jobs you can run.
  const fitting = S.jobs.filter(x=>S.vehicles.some(v=>{const tt=TYPE[v.type];return tt.cargo.includes(x.cargo)&&tt.cap>=x.weight&&tt.leg>=x.miles;})).length;
  const ownOnly = fitting < S.vehicles.length;
  const t = ((ownOnly || Math.random()<0.85) && ownedTypes.length) ? TYPE[pick(ownedTypes)] : pick(reach);
  const cargo = pick(t.cargo);
  if(cargo==="hazmat" && Math.random()<0.5 && depth<4) return spawnJob(base, depth+1);
  let weight;
  if(t.cars) weight = Math.round(rnd(3,9.99));
  else { const lo = cargo==="parcels"?0.15:0.35; weight = Math.max(300, Math.round(rnd(lo,1)*t.cap/50)*50); }
  // Pickups: near the hub or in a city within the hub's job area.
  const bp = basePt(base), near = citiesNear(base.city, RADIUS_MI);
  let from;
  if(Math.random()<0.45 || !near.length) from = offsetPt(bp.lat, bp.lon, rnd(0.5,4), rnd(0,6.28));
  else { const oc = CITIES[pick(near)]; from = offsetPt(oc.lat, oc.lon, rnd(0.5,4), rnd(0,6.28)); }
  from.biz = pick(PRODUCERS[cargo]); from.c = nearestCity(from); from.name = bizName(from.biz); from.num = houseNo();
  const r = Math.random();
  const tier = r<0.45?"local": r<0.8?"regional": r<0.94?"long":"cross";
  const maxLeg = t.leg*0.85; // leave room: real road miles run a little longer than the estimate
  const ranges = {regional:[50,Math.min(250,maxLeg)],long:[250,Math.min(800,maxLeg)],cross:[800,maxLeg]};
  let to = null;
  if(tier!=="local" && ranges[tier][1]>ranges[tier][0]){
    const [a,bm] = ranges[tier];
    const cand = CITIES.filter(c=>{const m=hav(from,c)*1.2;return m>=a&&m<=bm;});
    if(cand.length){ const dc = pick(cand); to = {c:dc.i, ...offsetPt(dc.lat, dc.lon, rnd(0.5,4), rnd(0,6.28))}; }
  }
  if(!to){ to = offsetPt(from.lat, from.lon, rnd(4,22), rnd(0,6.28)); to.c = nearestCity(to); }
  to.biz = pick(ACCEPTORS[cargo]); if(to.biz===from.biz) to.biz = ACCEPTORS[cargo][0];
  to.name = bizName(to.biz); to.num = houseNo();
  const miles = estMi(from, to);
  const urg = Math.random()<0.07?"express":Math.random()<0.2?"priority":"standard";
  const life = urg==="express"? rnd(6,9)*MIN : urg==="priority"? rnd(12,18)*MIN : rnd(30,60)*MIN;
  const j = {id:nid("j"), base:base.id, cargo, weight, miles, urg, from, to, posted:S.clock, expires: urg==="standard" ? null : S.clock+life, routed:false};
  j.pay = payFor(miles, weight, cargo, urg);
  S.jobs.push(j);
  if(!simulating) routeJob(j);
  return j;
}
// Fetch the real road route for a job, then quote it by road miles.
function routeJob(j){
  if(j.routed || j.routing) return;
  j.routing = true;
  getRoute(j.from, j.to).then(r=>{
    j.routing = false;
    if(!S || !S.jobs.includes(j)) return;
    j.routed = true;
    if(r){
      j.miles = Math.max(1, Math.round(r.mi)); j.sec = r.sec; j.path = r.path; j.pay = payFor(j.miles, j.weight, j.cargo, j.urg);
      if(r.locs && r.locs.length===2){ Object.assign(j.from, r.locs[0]); Object.assign(j.to, r.locs[1]); }
      if(r.names){ j.from.street = r.names[0]; j.to.street = r.names[1]; }
      const m = jobMarkers.get(j.id); if(m) m.setLatLng([j.from.lat, j.from.lon]);
    }
    if(j.id===selectedJob) drawSelection();
    if(tab==="jobs") renderPanel();
  });
}

/* ---------------- Eligibility & timing ---------------- */
function freeDrivers(lic, cargo){
  const idle = S.drivers.filter(d=>!d.busy);
  if(lic==="std"){
    const own = idle.filter(d=>d.kind==="owner");
    const std = idle.filter(d=>d.kind==="std").sort((a,b)=>b.jobs-a.jobs);
    const cdl = idle.filter(d=>d.kind==="cdl").sort((a,b)=>a.jobs-b.jobs);
    const p = own[0]||std[0]||cdl[0]; return p?[p]:null;
  }
  const c = idle.filter(d=>d.kind==="cdl" && (cargo!=="hazmat"||d.hazmat)).sort((a,b)=>b.jobs-a.jobs);
  if(lic==="cdl") return c[0]?[c[0]]:null;
  return c.length>=2?[c[0],c[1]]:null;
}
const driveMs = (miles, slow, f) => (1 + miles/30) * MIN * slow * f;   // original pace: 1 min + 1 min per 30 road miles
function handleMs(j){ // loading or unloading time for this load
  const m = j.cargo==="vehicles" ? LOAD_BASE_MIN + LOAD_MIN_PER_CAR*j.weight : LOAD_BASE_MIN + LOAD_MIN_PER_1000LB*j.weight/1000;
  return m*MIN;
}
// A vehicle that has delivered and is heading home can take a new job from wherever it is.
const returnTrip = v => v.ret ? S.trips.find(tr=>tr.id===v.ret) : null;
function startPt(v){
  const tr = returnTrip(v);
  if(tr){ const ll = posOf(tr, S.clock).ll; return {lat:ll[0], lon:ll[1]}; }
  return basePt(baseById(v.base));
}
function planTrip(v, j, drivers){
  const t = TYPE[v.type], bp = basePt(baseById(v.base)), sp = startPt(v);
  const dead = estMi(sp, j.from), back = estMi(j.to, bp);
  const lv = Math.max(...drivers.map(drvLevel));
  const f = 1-0.03*(lv-1);
  const ld = handleMs(j), lu = handleMs(j);
  const tDead = Math.max(0.2*MIN, dead/30/2*MIN*f), tHaul = driveMs(j.miles, t.slow, f), tBack = Math.max(0.2*MIN, back/30/2*MIN*f);
  const cut = drivers.reduce((s,d)=>s+DRIVER_KIND[d.kind].cut+(d.hazmat?0.03:0),0);
  return {dead, back, tDead, ld, lu, tHaul, tBack, total:tDead+ld+tHaul+lu+tBack, deliverIn:tDead+ld+tHaul+lu, cut, bonus:1+0.02*(lv-1)};
}
function vehicleFor(v, j){
  const t = TYPE[v.type];
  if(!t.cargo.includes(j.cargo)) return {ok:false, why:"Wrong trailer"};
  if(j.weight > t.cap) return {ok:false, why:"Too heavy"};
  if(j.miles > t.leg) return {ok:false, why:`Over ${t.leg} mi range`};
  if(v.busy) return {ok:false, why:"On a job", busy:true};
  if(estMi(startPt(v), j.from) > MAX_DEADHEAD) return {ok:false, why:"Too far away"};
  const rt = returnTrip(v);
  let ds;
  if(rt){ // keep the crew that is already in the cab
    const crew = rt.drivers.map(id=>S.drivers.find(d=>d.id===id)).filter(Boolean);
    const okLic = t.lic==="std" || crew.every(d=>d.kind==="cdl" && (j.cargo!=="hazmat"||d.hazmat));
    ds = okLic ? crew : null;
  } else ds = freeDrivers(t.lic, j.cargo);
  if(!ds) return {ok:false, why: t.lic==="std"?"No free driver": j.cargo==="hazmat"?"Needs hazmat driver": t.lic==="cdl2"?"Needs 2 free CDL drivers":"No free CDL driver", nodriver:true};
  return {ok:true, drivers:ds, plan:planTrip(v,j,ds)};
}
function jobStatus(j){
  const opts = S.vehicles.map(v=>({v, r:vehicleFor(v,j)}));
  const ok = opts.filter(o=>o.r.ok).sort((a,b)=>a.r.plan.total-b.r.plan.total);
  if(ok.length) return {can:true, opts:ok};
  const capable = opts.filter(o=>o.r.busy||o.r.nodriver);
  if(capable.length) return {can:false, soon:true, why: capable.some(o=>o.r.busy) ? "Your matching vehicles are busy" : capable[0].r.why};
  const fit = TYPES.filter(t=>t.cargo.includes(j.cargo)&&t.cap>=j.weight&&t.leg>=j.miles).sort((a,b)=>a.price-b.price)[0];
  return {can:false, why: fit?`Needs ${fit.n}${fit.lvl>level()?` · level ${fit.lvl}`:""}`:"No vehicle can take this"};
}

/* ---------------- Dispatch & simulation ---------------- */
function mkSeg(ph, path, t0, t1){ return {ph, path, t0, t1}; }
function dispatch(j, v, viaDispatcher){
  const r = vehicleFor(v,j); if(!r.ok) return false;
  const rt = returnTrip(v), A = startPt(v);
  if(rt){ S.trips = S.trips.filter(x=>x!==rt); v.ret = null; }
  const p = r.plan, base = baseById(v.base), B = basePt(base), O = {lat:j.from.lat,lon:j.from.lon}, D = {lat:j.to.lat,lon:j.to.lon};
  const t0 = S.clock, a = t0+p.tDead, b = a+p.ld, c = b+p.tHaul, d = c+p.lu, e = d+p.tBack;
  const trip = {id:nid("t"), v:v.id, drivers:r.drivers.map(x=>x.id), job:{...j, path:undefined},
    segs:[ mkSeg("dead",straight(A,O),t0,a), mkSeg("load",[[O.lat,O.lon]],a,b), mkSeg("haul", j.path||straight(O,D), b,c),
           mkSeg("load",[[D.lat,D.lon]],c,d), mkSeg("ret",straight(D,B),d,e) ],
    deliverAt:d, endAt:e, gross:Math.round(j.pay*p.bonus), cut:p.cut+(viaDispatcher?0.05:0), delivered:false, auto:!!viaDispatcher};
  S.trips.push(trip);
  v.busy = true; r.drivers.forEach(x=>x.busy=true);
  S.jobs = S.jobs.filter(x=>x.id!==j.id);
  if(!simulating) roadTrip(trip);
  return trip;
}
// Swap straight placeholder lines for real road geometry (timing stays as quoted).
function roadTrip(tr){
  const legs = [[0,"dead"],[2,"haul"],[4,"ret"]];
  for(const [i] of legs){
    const s = tr.segs[i]; if(s.path.length>2) continue;
    if(S.clock > s.t1) continue;
    const a = {lat:s.path[0][0],lon:s.path[0][1]}, b = {lat:s.path.at(-1)[0],lon:s.path.at(-1)[1]};
    if(estMi(a,b)<0.3) continue;
    getRoute(a,b).then(r=>{ if(r && S && S.trips.includes(tr)){ s.path = r.path; s.cum = null; tripLines.get(tr.id)?.setLatLngs([]); } });
  }
}
let awayLog = null, simulating = false, simT = 0;
const simWhen = () => awayLog ? awayLog.start + simT : Date.now();
function deliver(tr){
  tr.delivered = true;
  const net = tr.gross*(1-tr.cut)*S.payMult;
  const before = level();
  S.cash += net; S.earned += net; S.xp += tr.gross/100; S.jobsDone++;
  const v = S.vehicles.find(x=>x.id===tr.v); if(v) v.jobs++;
  tr.drivers.forEach(id=>{const d=S.drivers.find(x=>x.id===id); if(d){d.jobs++; d.earned+=tr.gross*DRIVER_KIND[d.kind].cut;}});
  if(awayLog){awayLog.jobs++; awayLog.net+=net; logEvent(`<b>${esc(v?v.n:"Truck")}</b> delivered ${esc(CARGO[tr.job.cargo].n.toLowerCase())} to ${esc(tr.job.to.name||cityName(tr.job.to.c))} <span class="num">+${money(net)}</span> (while you were away)`, simWhen());}
  else toast(`<b>${esc(v?v.n:"Truck")}</b> delivered ${esc(CARGO[tr.job.cargo].n.toLowerCase())} to ${esc(tr.job.to.name||tr.job.to.biz)}, ${esc(cityName(tr.job.to.c))} <span class="num">+${money(net)}</span>`);
  const after = level();
  for(let L=before+1;L<=after;L++){ if(awayLog){ awayLog.levels.push(L); logEvent(`<b>Level ${L}</b>${UNLOCKS[L]?` · unlocked ${esc(UNLOCKS[L])}`:""}`, simWhen()); } else toast(`<b>Level ${L}</b>${UNLOCKS[L]?` · unlocked ${esc(UNLOCKS[L])}`:""}`, 6000); }
}
function logic(){
  let changed = false;
  for(const tr of S.trips){
    if(!tr.pickedUp && S.clock>=tr.segs[1].t1){
      tr.pickedUp = true; changed = true;
      const v = S.vehicles.find(x=>x.id===tr.v);
      if(!awayLog) toast(`<b>${esc(v?v.n:"Truck")}</b> picked up ${esc(weightStr(tr.job))} of ${esc(CARGO[tr.job.cargo].n.toLowerCase())} at ${esc(tr.job.from.name||tr.job.from.biz)}`);
    }
    if(!tr.delivered && S.clock>=tr.deliverAt){ deliver(tr); const v=S.vehicles.find(x=>x.id===tr.v); if(v){ v.busy=false; v.ret=tr.id; } changed=true; }
  }
  const done = S.trips.filter(tr=>S.clock>=tr.endAt);
  if(done.length){
    done.forEach(tr=>{const v=S.vehicles.find(x=>x.id===tr.v); if(v){ v.busy=false; if(v.ret===tr.id) v.ret=null; } tr.drivers.forEach(id=>{const d=S.drivers.find(x=>x.id===id); if(d)d.busy=false;});});
    S.trips = S.trips.filter(tr=>S.clock<tr.endAt); changed = true;
  }
  const n0 = S.jobs.length;
  S.jobs = S.jobs.filter(j=>!j.expires || j.expires>S.clock);
  if(selectedJob && !S.jobs.find(j=>j.id===selectedJob)) selectedJob = null;
  if(S.jobs.length!==n0) changed = true;
  // Mission Chief style: one new job every 30 seconds, up to one more than your vehicle count.
  // An empty board refills right away so there is always something to do.
  if(S.jobs.length < maxJobs() && (S.jobs.length===0 || S.clock >= (S.nextJobAt||0))){
    const j = spawnJob(pick(S.bases)); S.nextJobAt = S.clock + JOB_EVERY_MS; changed = true;
    if(j && !simulating && !awayLog) toast(`New job: <b>${esc(j.from.name)}</b> in ${esc(cityName(j.from.c))} · <span class="num">${money(j.pay)}</span>`, 3000);
  }
  for(const b of S.bases){
    if(!b.dispatcher) continue;
    for(const v of S.vehicles.filter(x=>x.base===b.id && !x.busy)){
      const best = S.jobs.filter(j=>estMi(basePt(b),j.from)<=RADIUS_MI*1.3 && vehicleFor(v,j).ok).sort((a,c)=>c.pay-a.pay)[0];
      if(best){ dispatch(best, v, true); changed = true; }
    }
  }
  return changed;
}
function simulateAway(ms){
  ms = Math.min(ms, 12*3600e3);
  awayLog = {jobs:0, net:0, levels:[], ms, start: Date.now()-ms}; simulating = true; simT = 0;
  let t = 0;
  while(t < ms){ S.payMult = t > 4*3600e3 ? 0.5 : 1; const d = Math.min(15000, ms-t); S.clock += d; t += d; simT = t; logic(); }
  S.payMult = 1; simulating = false;
  S.trips.forEach(roadTrip);
  const log = awayLog; awayLog = null; return log;
}

/* ---------------- Street map ---------------- */
const map = L.map("map", {zoomControl:true, worldCopyJump:false, minZoom:4, maxZoom:18, preferCanvas:false}).setView([38.5,-96], 4);
L.tileLayer(TILE_URL, {maxZoom:19, attribution:TILE_ATTR}).addTo(map);
// Keep the map filling its box when the layout or window size changes.
try{ new ResizeObserver(()=>map.invalidateSize()).observe(document.getElementById("map")); }catch(_){}
window.addEventListener("load", ()=>map.invalidateSize());
const layerRings = L.layerGroup().addTo(map), layerRoutes = L.layerGroup().addTo(map), layerSel = L.layerGroup().addTo(map),
      layerBases = L.layerGroup().addTo(map), layerJobs = L.layerGroup().addTo(map), layerVeh = L.layerGroup().addTo(map);
const jobMarkers = new Map(), vehMarkers = new Map(), tripLines = new Map(), stopMarkers = new Map();
const layerStops = L.layerGroup().addTo(map);
const PIN_SVG = '<svg width="22" height="28" viewBox="0 0 22 28"><path class="body" d="M11 27C9 22 2 17 2 10.5A9 9 0 0 1 20 10.5C20 17 13 22 11 27Z"/><circle class="hole" cx="11" cy="10.5" r="3.4"/></svg>';
map.on("click", e=>{ if(placing){ placeAt(e.latlng); return; } if(selectedJob){ selectedJob=null; drawJobs(); renderPanel(); } });

function drawBases(){
  layerBases.clearLayers(); layerRings.clearLayers();
  S.bases.forEach((b,i)=>{
    const p = basePt(b);
    L.circle([p.lat,p.lon], {radius:RADIUS_MI*1609.34, color:"#1e5a3c", weight:1.2, opacity:.5, dashArray:"5 6", fill:true, fillOpacity:.03, interactive:false}).addTo(layerRings);
    L.marker([p.lat,p.lon], {icon:L.divIcon({className:"", html:`<div class="mk-base">${b.home?"HQ":"H"+(i+1)}</div>`, iconSize:[22,22], iconAnchor:[11,11]}), zIndexOffset:500, title:`${baseName(b)} · ${baseAddr(b)}`}).addTo(layerBases);
  });
}
function drawJobs(){
  const ids = new Set(S.jobs.map(j=>j.id));
  for(const [id,m] of jobMarkers) if(!ids.has(id)){ layerJobs.removeLayer(m); jobMarkers.delete(id); }
  for(const j of S.jobs){
    let m = jobMarkers.get(j.id);
    const cls = `mk-pin ${jobStatus(j).can?"":"cant"} ${j.id===selectedJob?"sel":""}`;
    if(!m){
      m = L.marker([j.from.lat,j.from.lon], {icon:L.divIcon({className:"", html:`<div class="${cls}">${PIN_SVG}</div>`, iconSize:[22,28], iconAnchor:[11,27]}), title:`${CARGO[j.cargo].n} · ${money(j.pay)}`});
      m.on("click", e=>{ L.DomEvent.stopPropagation(e); selectJob(j.id); });
      m.addTo(layerJobs); jobMarkers.set(j.id, m); m._cls = cls;
    } else if(m._cls!==cls){ const el = m.getElement()?.firstElementChild; if(el) el.className = cls; m._cls = cls; }
    m.setZIndexOffset(j.id===selectedJob?1000:0);
  }
  drawSelection();
}
function drawSelection(){
  layerSel.clearLayers();
  const j = S && S.jobs.find(x=>x.id===selectedJob); if(!j) return;
  const path = j.path || straight(j.from, j.to);
  L.polyline(path, {color:"#fff", weight:8, opacity:.9, interactive:false}).addTo(layerSel);
  L.polyline(path, {color:"#c8372a", weight:4.5, opacity:.95, dashArray:j.path?null:"8 8", interactive:false}).addTo(layerSel);
  L.marker([j.to.lat,j.to.lon], {icon:L.divIcon({className:"", html:'<div class="mk-dest"></div>', iconSize:[16,16], iconAnchor:[8,8]}), interactive:false}).addTo(layerSel);
}
function fitJob(j){
  const b = L.latLngBounds((j.path||straight(j.from,j.to)));
  const v = S.vehicles.map(x=>basePt(baseById(x.base)));
  map.flyToBounds(b.pad(0.35), {maxZoom:14, duration:0.6});
}

function displayClock(){ return S.clock + (Date.now()-S.lastReal)*S.speed; }
function segAt(tr, t){ return tr.segs.find(s=>t<s.t1) || tr.segs.at(-1); }
function cumOf(s){
  if(s.cum) return s.cum;
  const c=[0]; for(let i=1;i<s.path.length;i++){ const a=s.path[i-1], b=s.path[i]; c.push(c[i-1]+hav({lat:a[0],lon:a[1]},{lat:b[0],lon:b[1]})); }
  return s.cum=c;
}
function posOf(tr, t){
  const s = segAt(tr,t);
  if(s.path.length===1) return {ll:s.path[0], ph:s.ph, s};
  const f = s.t1>s.t0 ? Math.min(1,Math.max(0,(t-s.t0)/(s.t1-s.t0))) : 1;
  const c = cumOf(s), goal = f*c.at(-1);
  let i = 1; while(i<c.length-1 && c[i]<goal) i++;
  const span = c[i]-c[i-1] || 1, k = Math.min(1,Math.max(0,(goal-c[i-1])/span));
  const a = s.path[i-1], b = s.path[i];
  return {ll:[a[0]+(b[0]-a[0])*k, a[1]+(b[1]-a[1])*k], ph:s.ph, s, i};
}
const LEG_COLOR = {dead:"#6b7772", haul:"#1f56c4", ret:"#2a8a50"};
function frame(){
  if(S){
    const t = displayClock(), live = new Set();
    for(const tr of S.trips){
      live.add(tr.id);
      const p = posOf(tr,t);
      let m = vehMarkers.get(tr.id);
      const v = S.vehicles.find(x=>x.id===tr.v);
      const mode = v ? (TYPE[v.type]?.mode||"truck") : "truck";
      if(!m){
        m = L.marker(p.ll, {icon:L.divIcon({className:"", html:`<div class="mk-veh ${p.ph}">${iconSvg(mode,15)}</div>`, iconSize:[26,26], iconAnchor:[13,13]}), zIndexOffset:800, title:v?`${v.n} · ${TYPE[v.type]?.n||""}`:"Truck"});
        m.on("click", e=>{ L.DomEvent.stopPropagation(e); setTab("fleet"); });
        m.addTo(layerVeh); vehMarkers.set(tr.id, m); m._ph = p.ph;
      } else {
        m.setLatLng(p.ll);
        if(m._ph!==p.ph){ const el=m.getElement()?.firstElementChild; if(el) el.className=`mk-veh ${p.ph}`; m._ph=p.ph; }
      }
      // remaining road on the current leg, like a live navigation line
      let line = tripLines.get(tr.id);
      if(!line){ line = L.polyline([], {weight:4, opacity:.8, interactive:false}).addTo(layerRoutes); tripLines.set(tr.id, line); }
      if(p.s.path.length>1){
        const rest = [p.ll, ...p.s.path.slice(p.i||1)];
        line.setStyle({color:LEG_COLOR[p.ph]||"#1f56c4", dashArray:p.s.path.length>2?null:"6 8"});
        if(!line._n || line._n!==rest.length || line._seg!==p.s){ line.setLatLngs(rest); line._n=rest.length; line._seg=p.s; }
        else { const ll=line.getLatLngs(); ll[0]=L.latLng(p.ll); line.setLatLngs(ll); }
      } else if(line._n){ line.setLatLngs([]); line._n=0; }
    }
    for(const [id,m] of vehMarkers) if(!live.has(id)){ layerVeh.removeLayer(m); vehMarkers.delete(id); }
    for(const [id,l] of tripLines) if(!live.has(id)){ layerRoutes.removeLayer(l); tripLines.delete(id); }
    // Pickup and drop-off markers for every load on the road
    for(const tr of S.trips){
      let sm = stopMarkers.get(tr.id);
      if(!sm){
        const j = tr.job;
        sm = {
          pick: L.marker([j.from.lat,j.from.lon], {icon:L.divIcon({className:"", html:'<div class="mk-stop pick">P</div>', iconSize:[20,20], iconAnchor:[10,10]}), title:`Pickup: ${j.from.name||j.from.biz}`, zIndexOffset:600}).addTo(layerStops),
          drop: L.marker([j.to.lat,j.to.lon], {icon:L.divIcon({className:"", html:'<div class="mk-stop drop">D</div>', iconSize:[20,20], iconAnchor:[10,10]}), title:`Drop-off: ${j.to.name||j.to.biz}`, zIndexOffset:600}).addTo(layerStops)
        };
        stopMarkers.set(tr.id, sm);
      }
      if(t>=tr.segs[1].t1 && sm.pick){ layerStops.removeLayer(sm.pick); sm.pick=null; }
      if(t>=tr.deliverAt && sm.drop){ layerStops.removeLayer(sm.drop); sm.drop=null; }
    }
    for(const [id,sm] of stopMarkers) if(!live.has(id)){ if(sm.pick) layerStops.removeLayer(sm.pick); if(sm.drop) layerStops.removeLayer(sm.drop); stopMarkers.delete(id); }
  }
  requestAnimationFrame(frame);
}
$("#zHome").onclick=()=>{ if(S){ const p=basePt(S.bases[0]); map.flyTo([p.lat,p.lon], 11, {duration:.6}); } };
$("#zArea").onclick=()=>{ if(S){ const b=L.latLngBounds(S.bases.map(x=>{const p=basePt(x);return [p.lat,p.lon];})); map.flyToBounds(b.pad(0.1).extend(L.latLng(b.getNorth()+RADIUS_MI/MI_DEG, b.getEast()+RADIUS_MI/MI_DEG)).extend(L.latLng(b.getSouth()-RADIUS_MI/MI_DEG, b.getWest()-RADIUS_MI/MI_DEG)), {duration:.6}); } };

/* ---------------- Panel ---------------- */
function cargoChip(c){ return `<span class="chip" style="color:var(--c-${c})"><i></i><span style="color:var(--ink)">${esc(CARGO[c].n)}</span></span>`; }
function urgTag(u){ return u==="standard"?"":`<span class="urg ${u}">${u}</span>`; }
function setTab(t){ tab=t; pendingConfirm=null; renderPanel(); document.querySelectorAll(".tab").forEach(b=>b.setAttribute("aria-selected", b.dataset.tab===t)); }
function selectJob(id, fly){
  selectedJob=id; chosenVeh=null; tab="jobs";
  document.querySelectorAll(".tab").forEach(b=>b.setAttribute("aria-selected", b.dataset.tab==="jobs"));
  const j = S.jobs.find(x=>x.id===id); if(j){ routeJob(j); if(fly) fitJob(j); }
  drawJobs(); renderPanel(); $("#panelBody").scrollTop=0;
}
function goals(){
  const has = id=>S.vehicles.some(v=>v.type===id);
  return [
    ["Deliver your first job", S.jobsDone>=1], ["Complete 5 deliveries", S.jobsDone>=5],
    ["Buy a second vehicle", S.vehicles.length>=2], ["Hire your first driver", S.hired>=1],
    ["Open a second hub", S.bases.length>=2], ["Buy a straight truck (level 6)", has("straight")],
    ["Hire a dispatcher (level 8)", S.bases.some(b=>b.dispatcher)], ["Put a semi on the road (level 10)", S.vehicles.some(v=>TYPE[v.type].lvl>=10)]
  ];
}
function jobCard(j){
  const st = jobStatus(j), local = j.from.c===j.to.c;
  return `<button class="card ${j.id===selectedJob?"sel":""} ${st.can?"":"dim"}" data-act="sel" data-id="${j.id}">
    <div class="row"><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${cargoChip(j.cargo)}${urgTag(j.urg)}</div><span class="pay">${money(j.pay)}</span></div>
    <div class="route"><b>${esc(j.from.name||j.from.biz)}</b> <span class="arrow">→</span> <b>${esc(j.to.name||j.to.biz)}</b><br><span class="hint">${esc(addrLine(j.from))} → ${esc(addrLine(j.to))}</span></div>
    <div class="meta"><span class="num">${weightStr(j)}</span><span class="num">${j.routed?"":"about "}${j.miles} mi</span>${j.expires?`<span>expires in <span class="num" data-exp="${j.expires}">${dur(j.expires-S.clock)}</span></span>`:""}</div>
    ${st.can?`<span class="ok">${esc(st.opts[0].v.n)} · back in ${dur(st.opts[0].r.plan.total)}</span>`:`<span class="need">${esc(st.why)}</span>`}
  </button>`;
}
function dispatchCard(j){
  const st = jobStatus(j), local = j.from.c===j.to.c;
  let opts;
  if(st.can){
    if(!chosenVeh || !st.opts.find(o=>o.v.id===chosenVeh)) chosenVeh = st.opts[0].v.id;
    opts = `<div class="opts">${st.opts.map(o=>{const p=o.r.plan;const net=Math.round(j.pay*p.bonus*(1-p.cut));
      return `<label class="opt"><input type="radio" name="veh" value="${o.v.id}" ${o.v.id===chosenVeh?"checked":""}>
      <span><b>${esc(o.v.n)}</b> · ${esc(TYPE[o.v.type].n)}<small>${esc(o.r.drivers.map(d=>d.name).join(" + "))} · ${p.dead>1?`${p.dead} mi to pickup (${dur(p.tDead)}) · `:""}loading ${dur(p.ld)} · drive ${dur(p.tHaul)} · unloading ${dur(p.lu)}<br>Delivers in ${dur(p.deliverIn)}, back at the hub in ${dur(p.total)}</small></span>
      <span class="pay" title="After driver pay">${money(net)}</span></label>`;}).join("")}</div>
      <div class="btnrow"><button class="btn" data-act="go" data-id="${j.id}" ${j.routing?"disabled":""}>${j.routing?"Finding route…":"Dispatch"}</button><button class="btn ghost" data-act="unsel">Close</button></div>`;
  } else {
    opts = `<p class="need" style="font-size:13px;margin:0">${esc(st.why)}</p><div class="btnrow"><button class="btn ghost" data-act="unsel">Close</button>${st.soon?"":`<button class="btn ghost" data-act="tab" data-tab="shop">Open shop</button>`}</div>`;
  }
  return `<section class="dispatch" aria-label="Dispatch job">
    <div class="row"><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${cargoChip(j.cargo)}${urgTag(j.urg)}</div><span class="pay" style="font-size:18px">${money(j.pay)}</span></div>
    <div class="leg"><span class="dot"></span><span><b>${esc(j.from.name||j.from.biz)}</b> · ${esc(j.from.biz)}<br><span class="hint">${esc(addrLine(j.from))}</span></span>
      <span class="line"></span><span class="hint"><span class="num">${weightStr(j)}</span> · <span class="num">${j.miles} mi</span> ${j.routing?"· checking roads":j.path?"by road":"(estimate)"}</span>
      <span class="dot end"></span><span><b>${esc(j.to.name||j.to.biz)}</b> · ${esc(j.to.biz)}<br><span class="hint">${esc(addrLine(j.to))}</span></span></div>
    <div class="btnrow"><button class="btn ghost sm" data-act="fly" data-id="${j.id}">Show route on map</button></div>
    ${opts}
  </section>`;
}
function renderJobs(){
  const sj = S.jobs.find(j=>j.id===selectedJob);
  const list = S.jobs.map(j=>({j,can:jobStatus(j).can})).sort((a,b)=>(b.can-a.can)||(b.j.pay-a.j.pay));
  const can = list.filter(x=>x.can), cant = list.filter(x=>!x.can);
  const open = goals().filter(x=>!x[1]).slice(0,3);
  let h = "";
  if(sj) h += dispatchCard(sj);
  if(S.jobsDone<1 && !sj) h += `<p class="hint" style="color:var(--ink)">Tap an orange pin on the map, or pick a job below, then send your van. Gray pins need a vehicle you do not own yet.</p>`;
  { const L_=level(), need=xpNeed(L_+1), left=Math.max(0,Math.ceil((need-S.xp)*100)), nxt=Object.entries(UNLOCKS).find(([k])=>+k>L_);
    h += `<section class="sec"><div class="sec-head"><h3>Level ${L_} → ${L_+1}</h3><span class="hint num">${Math.floor(S.xp-xpNeed(L_)).toLocaleString("en-US")} / ${(need-xpNeed(L_)).toLocaleString("en-US")} XP</span></div>
      <div class="prog"><i style="width:${Math.min(100,(S.xp-xpNeed(L_))/(need-xpNeed(L_))*100)}%;background:var(--sign)"></i></div>
      <p class="hint">${Math.ceil(need-S.xp).toLocaleString("en-US")} XP to level ${L_+1}. Each delivery earns 1 XP per $100 it pays.${nxt?` Next unlock: ${esc(nxt[1])} at level ${nxt[0]}.`:""} Board: ${S.jobs.length} of ${maxJobs()} jobs, a new one every ${JOB_EVERY_MS/1000} seconds.</p></section>`; }
  if(open.length) h += `<section class="sec"><h3>Next goals</h3><ul class="goals">${open.map(x=>`<li>${esc(x[0])}</li>`).join("")}</ul></section>`;
  h += `<section class="sec"><div class="sec-head"><h2>Ready to run</h2><span class="hint num">${can.length}</span></div>${can.length?`<div class="list">${can.map(x=>jobCard(x.j)).join("")}</div>`:`<p class="hint">Nothing your fleet can take right now. A new job posts every 30 seconds.</p>`}</section>`;
  if(cant.length) h += `<section class="sec"><div class="sec-head"><h2>Other jobs nearby</h2><span class="hint num">${cant.length}</span></div><div class="list">${cant.map(x=>jobCard(x.j)).join("")}</div></section>`;
  return h;
}
function phaseText(tr,t){
  const p=segAt(tr,t).ph, f=tr.job.from.name||tr.job.from.biz, d=tr.job.to.name||tr.job.to.biz;
  return p==="dead"?`Heading to pickup at ${f}`:p==="load"?(t<tr.segs[2].t0?`Loading at ${f}`:`Unloading at ${d}`):p==="haul"?`Loaded, delivering to ${d}`:"Returning to hub · ready for a new job";
}
function renderFleet(){
  const t = displayClock();
  let h = `<section class="sec"><div class="sec-head"><h2>Your fleet</h2><span class="hint num">${S.vehicles.length} vehicles</span></div><div class="list">`;
  for(const b of S.bases){
    const vs = S.vehicles.filter(v=>v.base===b.id);
    h += `<h3>${esc(baseName(b))} <span class="hint" style="text-transform:none;letter-spacing:0">${esc(baseAddr(b))}</span> <span class="num" style="letter-spacing:0">${vs.length}/${hubCap(b)}</span>${b.dispatcher?" · dispatcher on":""}</h3>`;
    for(const v of vs){
      const tr = S.trips.find(x=>x.v===v.id), ty = TYPE[v.type];
      const cap = ty.cars?`${ty.cap} cars`:`${ty.cap.toLocaleString("en-US")} lb`;
      if(tr){
        const pct = Math.min(100,(t-tr.segs[0].t0)/(tr.endAt-tr.segs[0].t0)*100);
        const ds = tr.drivers.map(id=>S.drivers.find(d=>d.id===id)?.name).join(" + ");
        h += `<div class="card"><div class="row"><b><span class="vic">${iconSvg(TYPE[v.type].mode,13)}</span>${esc(v.n)}</b><span class="status busy" data-ph="${tr.id}">${phaseText(tr,t)}</span></div>
          <div class="route">${esc(cityName(tr.job.from.c))} <span class="arrow">→</span> ${esc(cityName(tr.job.to.c))} · ${esc(ds)}</div>
          <div class="prog"><i data-prog="${tr.id}" style="width:${pct}%"></i></div>
          <div class="meta"><span>${tr.delivered?"Delivered, home in":"Delivers in"} <span class="num" data-eta="${tr.id}">${dur((tr.delivered?tr.endAt:tr.deliverAt)-t)}</span></span><span class="num">${money(tr.gross*(1-tr.cut))}</span></div>
          <div class="btnrow"><button class="btn ghost sm" data-act="follow" data-id="${tr.id}">Follow on map</button><button class="btn ghost sm" data-act="askRen" data-id="${v.id}">Rename</button></div>${pendingConfirm===("ren"+v.id)?`<div class="btnrow"><input type="text" id="ren-${v.id}" maxlength="24" value="${esc(v.n)}" aria-label="New name for ${esc(v.n)}" style="flex:1;min-width:0;width:auto"><button class="btn sm" data-act="ren" data-id="${v.id}">Save</button><button class="btn ghost sm" data-act="cancel">Cancel</button></div>`:""}</div>`;
      } else {
        const confirm = pendingConfirm===("sell"+v.id);
        h += `<div class="card"><div class="row"><b><span class="vic">${iconSvg(TYPE[v.type].mode,13)}</span>${esc(v.n)}</b><span class="status idle">Idle</span></div>
          <div class="meta"><span>${esc(ty.n)}</span><span class="num">${cap}</span><span class="num">${ty.leg} mi range</span><span>${v.jobs} jobs</span></div>
          <div class="btnrow"><button class="btn ghost sm" data-act="askRen" data-id="${v.id}">Rename</button>${S.vehicles.length>1&&!confirm?`<button class="btn ghost sm" data-act="askSell" data-id="${v.id}">Sell</button>`:""}</div>${pendingConfirm===("ren"+v.id)?`<div class="btnrow"><input type="text" id="ren-${v.id}" maxlength="24" value="${esc(v.n)}" aria-label="New name for ${esc(v.n)}" style="flex:1;min-width:0;width:auto"><button class="btn sm" data-act="ren" data-id="${v.id}">Save</button><button class="btn ghost sm" data-act="cancel">Cancel</button></div>`:""}
          ${S.vehicles.length>1&&confirm?`<div class="btnrow">${confirm?`<button class="btn warn sm" data-act="sell" data-id="${v.id}">Sell for ${money(ty.price*0.6)}</button><button class="btn ghost sm" data-act="cancel">Keep it</button>`:`<button class="btn ghost sm" data-act="askSell" data-id="${v.id}">Sell</button>`}</div>`:""}</div>`;
      }
    }
  }
  return h + `</div></section>`;
}
function renderShop(){
  const L_ = level();
  let h = `<section class="sec"><div class="sec-head"><h2>Trucks</h2><span class="hint">60% back when sold</span></div><div class="list">`;
  const baseOpts = S.bases.map(b=>{const n=S.vehicles.filter(v=>v.base===b.id).length;return `<option value="${b.id}" ${n>=hubCap(b)?"disabled":""}>${esc(baseName(b))} (${n}/${hubCap(b)})</option>`;}).join("");
  const anySlot = S.bases.some(b=>S.vehicles.filter(v=>v.base===b.id).length<hubCap(b));
  for(const t of TYPES){
    const locked = t.lvl>L_, poor = S.cash<t.price;
    h += `<div class="card ${locked?"dim":""}"><div class="row"><b><span class="vic">${iconSvg(t.mode,13)}</span>${esc(t.n)}</b><span class="num">${money(t.price)}</span></div>
      <div class="meta"><span class="num">${t.cars?t.cap+" cars":t.cap.toLocaleString("en-US")+" lb"}</span><span class="num">${t.leg} mi range</span><span>${t.cargo.map(c=>CARGO[c].n).join(", ")}</span><span>${t.lic==="std"?"Any driver":t.lic==="cdl"?"CDL driver":"2 CDL drivers"}</span></div>
      ${locked?`<span class="lock">Unlocks at level ${t.lvl}</span>`:`<div class="btnrow"><select aria-label="Hub for ${esc(t.n)}" id="bs-${t.id}" style="width:auto;flex:1;min-width:0">${baseOpts}</select><button class="btn sm" data-act="buy" data-id="${t.id}" ${poor||!anySlot?"disabled":""}>${poor?"Not enough cash":!anySlot?"Hubs full":"Buy"}</button></div>`}</div>`;
  }
  h += `</div></section>`;
  const used = new Set(S.bases.map(b=>b.city));
  const cityOpts = Object.keys(STATES).map(s=>`<optgroup label="${STATES[s]}">${CITIES.filter(c=>c.s===s).map(c=>`<option value="${c.i}">${esc(c.n)}</option>`).join("")}</optgroup>`).join("");
  h += `<section class="sec"><h2>Hubs</h2>
    <div class="card ${L_<GARAGE_LVL?"dim":""}"><div class="row"><b>Open a new hub</b><span class="num">${money(GARAGE_PRICE)}</span></div>
      <p class="hint">Opens a small hub (10 vehicles) with jobs posted within about ${RADIUS_MI} miles. Own as many hubs as you like, even several in one city.</p>
      <div class="btnrow"><button class="btn sm" data-act="placeHub" ${S.cash<GARAGE_PRICE?"disabled":""}>${S.cash<GARAGE_PRICE?"Not enough cash":"Pick a spot on the map"}</button></div></div>
    ${S.bases.map(b=>{const t=b.tier||0, nx=HUB_TIERS[t+1], n=S.vehicles.filter(v=>v.base===b.id).length;
      return `<div class="card"><div class="row"><b>${esc(baseName(b))}</b><span class="num">${n}/${hubCap(b)} vehicles</span></div>
      <div class="meta"><span>${esc(baseAddr(b))}</span><span>${HUB_TIERS[t].n}</span></div>
      ${pendingConfirm===("renh"+b.id)?`<div class="btnrow"><input type="text" id="renh-${b.id}" maxlength="28" value="${esc(baseName(b))}" aria-label="New name for ${esc(baseName(b))}" style="flex:1;min-width:0;width:auto"><button class="btn sm" data-act="renHub" data-id="${b.id}">Save</button><button class="btn ghost sm" data-act="cancel">Cancel</button></div>`:`<div class="btnrow"><button class="btn ghost sm" data-act="askRenHub" data-id="${b.id}">Rename hub</button></div>`}
      <div class="btnrow">${!nx?`<span class="lock">Largest size</span>`:nx.lvl>L_?`<span class="lock">${nx.n} (${nx.cap} vehicles) unlocks at level ${nx.lvl}</span>`:`<button class="btn ghost sm" data-act="slot" data-id="${b.id}" ${S.cash<nx.price?"disabled":""}>Upgrade to ${nx.n} (${nx.cap} vehicles) · ${money(nx.price)}</button>`}</div></div>`;}).join("")}
  </section>
  <section class="sec"><h2>Coming next</h2>
    <div class="card dim"><div class="row"><b>Rail depots and trains</b><span class="lock">Level 15</span></div><p class="hint">Haul up to 60 railcars between depots. Your trucks bring freight in and take it out.</p></div>
    <div class="card dim"><div class="row"><b>Air cargo</b><span class="lock">Level 20</span></div><p class="hint">Unlock airports and fly urgent freight between them, Pocket Planes style.</p></div></section>`;
  return h;
}
function renderCrew(){
  const L_ = level();
  let h = `<section class="sec"><h2>Hire</h2>
    <div class="card"><div class="row"><b>Driver</b><span class="num">${money(1000)}</span></div><p class="hint">Drives vans and box trucks. Takes 15% of each job.</p>
      <div class="btnrow"><button class="btn sm" data-act="hire" data-kind="std" ${S.cash<1000?"disabled":""}>Hire driver</button></div></div>
    <div class="card ${L_<6?"dim":""}"><div class="row"><b>CDL driver</b><span class="num">${money(5000)}</span></div><p class="hint">Drives every truck, including semis. Takes 22% of each job.</p>
      ${L_<6?`<span class="lock">Unlocks at level 6</span>`:`<div class="btnrow"><button class="btn sm" data-act="hire" data-kind="cdl" ${S.cash<5000?"disabled":""}>Hire CDL driver</button></div>`}</div>
  </section>
  <section class="sec"><div class="sec-head"><h2>Drivers</h2><span class="hint num">${S.drivers.filter(d=>!d.busy).length} free</span></div><div class="list">`;
  for(const d of S.drivers){
    const lv = drvLevel(d), nx = DRV_LEVELS[lv];
    h += `<div class="card"><div class="row"><b>${esc(d.name)}</b><span class="status ${d.busy?"busy":"idle"}">${d.busy?"On a job":"Free"}</span></div>
      <div class="meta"><span>${DRIVER_KIND[d.kind].n}${d.hazmat?" · hazmat":""}</span><span>Level ${lv}${lv<5?` · ${nx-d.jobs} jobs to next`:""}</span><span>${d.kind==="owner"?"No cut":Math.round((DRIVER_KIND[d.kind].cut+(d.hazmat?.03:0))*100)+"% cut"}</span>${lv>1?`<span>+${(lv-1)*3}% speed</span>`:""}</div>
      ${d.kind==="cdl"&&!d.hazmat&&L_>=18?`<div class="btnrow"><button class="btn ghost sm" data-act="hazmat" data-id="${d.id}" ${S.cash<HAZMAT_PRICE||d.busy?"disabled":""}>Hazmat training · ${money(HAZMAT_PRICE)}</button></div>`:""}</div>`;
  }
  h += `</div></section><section class="sec"><h2>Dispatchers</h2><p class="hint">A dispatcher sends idle vehicles at one hub on the best-paying job they can take, even while you are away. Takes 5% of the jobs they assign.</p>`;
  if(L_<DISPATCH_LVL) h += `<div class="card dim"><span class="lock">Unlocks at level ${DISPATCH_LVL}</span></div>`;
  else h += S.bases.map(b=>`<div class="card"><div class="row"><b>${esc(baseName(b))}</b><span class="status ${b.dispatcher?"idle":""}">${b.dispatcher?"Dispatcher on duty":"No dispatcher"}</span></div>
      <div class="btnrow">${b.dispatcher?`<button class="btn ghost sm" data-act="disp" data-id="${b.id}">Let go</button>`:`<button class="btn sm" data-act="disp" data-id="${b.id}" ${S.cash<DISPATCH_PRICE?"disabled":""}>Hire · ${money(DISPATCH_PRICE)}</button>`}</div></div>`).join("");
  return h + `</section>`;
}
function renderLog(){
  const items = (S.log||[]).slice().reverse();
  const fmt = t => new Date(t).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit"});
  return `<section class="sec"><div class="sec-head"><h2>Activity log</h2><span class="hint num">${items.length} entries</span></div>
    <p class="hint">Everything your company does: new jobs, dispatches, pickups, deliveries, purchases and level-ups. Newest first, last 300 kept.</p>
    ${items.length?`<ol class="log">${items.map(e=>`<li><time class="num">${fmt(e.t)}</time><span>${e.h}</span></li>`).join("")}</ol>`:`<p class="hint">Nothing yet. Dispatch a job and it shows up here.</p>`}</section>`;
}
function renderCompany(){
  const L_ = level(), reset = pendingConfirm==="reset";
  return `<section class="sec"><h2>${esc(S.company)}</h2>
    <table class="spec"><tbody>
      <tr><td>Level</td><td>${L_}</td></tr>
      <tr><td>Total XP</td><td>${Math.floor(S.xp).toLocaleString("en-US")}</td></tr>
      <tr><td>XP to level ${L_+1}</td><td>${Math.ceil(xpNeed(L_+1)-S.xp).toLocaleString("en-US")}</td></tr>
      <tr><td>Next unlock</td><td style="font-family:var(--body)">${esc(Object.entries(UNLOCKS).find(([k])=>+k>L_)?.[1]||"All unlocked")}</td></tr>
      <tr><td>Deliveries</td><td>${S.jobsDone.toLocaleString("en-US")}</td></tr>
      <tr><td>Earned after driver pay</td><td>${money(S.earned)}</td></tr>
      <tr><td>Hubs</td><td>${S.bases.length}</td></tr>
      <tr><td>Home state</td><td style="font-family:var(--body)">${STATES[S.homeState]}</td></tr>
    </tbody></table></section>
    <section class="sec"><h3>XP needed for each level</h3>
      <div style="overflow-x:auto"><table class="spec lvtab"><thead><tr><td>Level</td><td>XP for this level</td><td>Total XP</td><td>Unlocks</td></tr></thead><tbody>
      ${[...Array(29)].map((_,i)=>i+2).concat([35,40,45,50]).map(L=>`<tr class="${L===L_+1?"next":""} ${L<=L_?"done":""}"><td>${L}</td><td>${(xpNeed(L)-xpNeed(L-1)).toLocaleString("en-US")}</td><td>${xpNeed(L).toLocaleString("en-US")}</td><td>${esc(UNLOCKS[L]||"")}</td></tr>`).join("")}
      </tbody></table></div></section>
    <section class="sec"><h3>Goals</h3><ul class="goals">${goals().map(x=>`<li class="${x[1]?"done":""}">${esc(x[0])}</li>`).join("")}</ul></section>
    <section class="sec"><h3>Clock speed</h3><p class="hint">Speeds up every trip. Handy for testing the economy; away time always counts at normal speed.</p>
      <div class="seg" role="group" aria-label="Clock speed">${[1,3,10].map(s=>`<button data-act="speed" data-s="${s}" aria-pressed="${S.speed===s}">${s}×</button>`).join("")}</div></section>
    <section class="sec"><h3>Away from the game</h3><p class="hint">Trips in progress always finish. Hubs with a dispatcher keep working at full pay for 4 hours, half pay up to 12 hours, then wait for you.</p></section>
    <section class="sec"><h3>Start a new game</h3><p class="hint">Erases this company and its progress in this browser, then lets you pick a new home state and garage.</p><div class="btnrow">${reset?`<button class="btn warn sm" data-act="reset">Erase company and start new</button><button class="btn ghost sm" data-act="cancel">Cancel</button>`:`<button class="btn ghost sm" data-act="askReset">Start new game</button>`}</div></section>`;
}
function renderHeader(){
  const L_ = level(), a = xpNeed(L_), b = xpNeed(L_+1);
  $("#hdrCo").textContent = S.company;
  $("#hdrCash").textContent = money(S.cash);
  $("#hdrLvl").textContent = `Level ${L_} · ${Math.floor(S.xp-a).toLocaleString("en-US")}/${(b-a).toLocaleString("en-US")} XP`;
  $("#hdrXp").style.width = (L_>=50?100:Math.min(100,(S.xp-a)/(b-a)*100)) + "%";
  $("#hdrTrips").textContent = S.trips.length;
  $("#jobBadge").textContent = S.jobs.filter(j=>jobStatus(j).can).length;
}
function renderPanel(){
  if(!S) return;
  const body = $("#panelBody"), st = body.scrollTop;
  const ae = document.activeElement, keep = ae && ae.id && body.contains(ae) && ae.tagName==="INPUT" ? {id:ae.id, v:ae.value, a:ae.selectionStart, b:ae.selectionEnd} : null;
  body.innerHTML = tab==="jobs"?renderJobs():tab==="fleet"?renderFleet():tab==="shop"?renderShop():tab==="crew"?renderCrew():tab==="log"?renderLog():renderCompany();
  body.scrollTop = st;
  if(keep){ const el = document.getElementById(keep.id); if(el){ el.value = keep.v; el.focus(); try{ el.setSelectionRange(keep.a, keep.b); }catch(_){} } }
  renderHeader();
}
function liveText(){
  if(!S) return;
  const t = displayClock();
  document.querySelectorAll("[data-exp]").forEach(e=>e.textContent=dur(+e.dataset.exp - S.clock));
  document.querySelectorAll("[data-eta]").forEach(e=>{const tr=S.trips.find(x=>x.id===e.dataset.eta); if(tr) e.textContent=dur((tr.delivered?tr.endAt:tr.deliverAt)-t);});
  document.querySelectorAll("[data-prog]").forEach(e=>{const tr=S.trips.find(x=>x.id===e.dataset.prog); if(tr) e.style.width=Math.min(100,(t-tr.segs[0].t0)/(tr.endAt-tr.segs[0].t0)*100)+"%";});
  document.querySelectorAll("[data-ph]").forEach(e=>{const tr=S.trips.find(x=>x.id===e.dataset.ph); if(tr) e.textContent=phaseText(tr,t);});
  if(following){ const tr=S.trips.find(x=>x.id===following); if(tr){ map.panTo(posOf(tr,t).ll, {animate:true, duration:.8}); } else following=null; }
}
let following = null;
map.on("dragstart", ()=>{ following = null; });

/* ---------------- Actions ---------------- */
$("#panelBody").addEventListener("click", e=>{
  const el = e.target.closest("[data-act]"); if(!el || !S) return;
  const a = el.dataset.act, id = el.dataset.id;
  if(a==="sel"){ selectJob(id, true); return; }
  if(a==="fly"){ const j=S.jobs.find(x=>x.id===id); if(j) fitJob(j); return; }
  if(a==="unsel"){ selectedJob=null; drawJobs(); renderPanel(); return; }
  if(a==="tab"){ setTab(el.dataset.tab); return; }
  if(a==="follow"){ following = id; const tr=S.trips.find(x=>x.id===id); if(tr) map.flyTo(posOf(tr,displayClock()).ll, Math.max(map.getZoom(),13), {duration:.6}); return; }
  if(a==="go"){
    const j = S.jobs.find(x=>x.id===id), v = S.vehicles.find(x=>x.id===chosenVeh);
    if(j && v && dispatch(j,v)){ toast(`<b>${esc(v.n)}</b> dispatched to ${esc(j.from.name||j.from.biz)}, ${esc(cityName(j.from.c))}`); selectedJob=null; save(); drawJobs(); renderPanel(); }
    return;
  }
  if(a==="buy"){
    const t = TYPE[id], b = baseById($("#bs-"+id)?.value);
    if(!b || S.cash<t.price || S.vehicles.filter(v=>v.base===b.id).length>=hubCap(b)) return;
    S.cash -= t.price;
    const n = S.vehicles.filter(v=>v.type===id).length + 1;
    S.vehicles.push({id:nid("v"), type:id, base:b.id, n:`${t.n.replace(/ \(.*\)/,"").replace("Semi + ","")} ${n}`.replace(/^\w/,c=>c.toUpperCase()), busy:false, jobs:0});
    toast(`Bought a ${esc(t.n.toLowerCase())}. You need ${t.lic==="std"?"a free driver":t.lic==="cdl"?"a free CDL driver":"two free CDL drivers"} to run it.`, 5000);
    save(); refresh(); return;
  }
  if(a==="hire"){
    const k = el.dataset.kind, fee = DRIVER_KIND[k].fee; if(S.cash<fee) return;
    S.cash -= fee; S.hired++;
    const used = new Set(S.drivers.map(d=>d.name)); let name; for(let i=0;i<30;i++){ name = `${pick(FIRST)} ${pick(LAST)}`; if(!used.has(name)) break; }
    S.drivers.push({id:nid("d"), name, kind:k, jobs:0, busy:false, hazmat:false, earned:0});
    toast(`Hired ${esc(name)}`); save(); refresh(); return;
  }
  if(a==="hazmat"){ const d=S.drivers.find(x=>x.id===id); if(d&&S.cash>=HAZMAT_PRICE){S.cash-=HAZMAT_PRICE;d.hazmat=true;save();refresh();} return; }
  if(a==="placeHub"){ if(S.cash>=GARAGE_PRICE) startPlacement({first:false}); return; }
  if(a==="askRenHub"){ pendingConfirm="renh"+id; renderPanel(); const inp=$("#renh-"+id); if(inp){ inp.focus(); inp.select(); } return; }
  if(a==="renHub"){ const b=baseById(id), inp=$("#renh-"+id); const n=(inp?.value||"").trim().slice(0,28); if(b&&n&&n!==baseName(b)){ logEvent(`Renamed hub <b>${esc(baseName(b))}</b> to <b>${esc(n)}</b>`); b.name=n; save(); drawBases(); } pendingConfirm=null; refresh(); return; }

  if(a==="slot"){ const b=baseById(id), nx=b&&HUB_TIERS[(b.tier||0)+1]; if(nx&&S.cash>=nx.price&&level()>=nx.lvl){S.cash-=nx.price;b.tier=(b.tier||0)+1;toast(`${esc(baseName(b))} is now a ${nx.n.toLowerCase()}`);save();refresh();} return; }
  if(a==="disp"){ const b=baseById(id); if(!b) return; if(b.dispatcher) b.dispatcher=false; else if(S.cash>=DISPATCH_PRICE){S.cash-=DISPATCH_PRICE;b.dispatcher=true;} save(); refresh(); return; }
  if(a==="askRen"){ pendingConfirm="ren"+id; renderPanel(); const inp=$("#ren-"+id); if(inp){ inp.focus(); inp.select(); } return; }
  if(a==="ren"){ const v=S.vehicles.find(x=>x.id===id), inp=$("#ren-"+id); const n=(inp?.value||"").trim().slice(0,24); if(v&&n&&n!==v.n){ logEvent(`Renamed <b>${esc(v.n)}</b> to <b>${esc(n)}</b>`); v.n=n; save(); } pendingConfirm=null; refresh(); return; }
  if(a==="askSell"){ pendingConfirm="sell"+id; renderPanel(); return; }
  if(a==="sell"){ const v=S.vehicles.find(x=>x.id===id); if(v&&!v.busy){S.cash+=TYPE[v.type].price*0.6; S.vehicles=S.vehicles.filter(x=>x!==v);} pendingConfirm=null; save(); refresh(); return; }
  if(a==="cancel"){ pendingConfirm=null; renderPanel(); return; }
  if(a==="speed"){ syncClock(); S.speed=+el.dataset.s; save(); renderPanel(); return; }
  if(a==="askReset"){ pendingConfirm="reset"; renderPanel(); return; }
  if(a==="reset"){
    try{localStorage.removeItem(KEY);}catch(_){}
    S=null; selectedJob=null; pendingConfirm=null; following=null;
    [layerJobs,layerBases,layerRings,layerVeh,layerRoutes,layerSel,layerStops].forEach(l=>l.clearLayers()); stopMarkers.clear(); jobMarkers.clear(); vehMarkers.clear(); tripLines.clear();
    $("#panelBody").innerHTML=""; $("#hdrCash").textContent="$0"; $("#hdrLvl").textContent="Level 1"; $("#hdrXp").style.width="0%"; $("#hdrTrips").textContent="0"; $("#jobBadge").textContent="0"; $("#hdrCo").textContent="New company"; endPlacement(); showStart(); return;
  }
});
$("#panelBody").addEventListener("keydown", e=>{ if(e.key==="Enter" && e.target.id?.startsWith("ren-")){ e.preventDefault(); $(`[data-act=ren][data-id="${e.target.id.slice(4)}"]`)?.click(); }
  if(e.key==="Enter" && e.target.id?.startsWith("renh-")){ e.preventDefault(); $(`[data-act=renHub][data-id="${e.target.id.slice(5)}"]`)?.click(); } if(e.key==="Escape" && e.target.id?.startsWith("ren-")){ pendingConfirm=null; renderPanel(); } });
$("#panelBody").addEventListener("change", e=>{ if(e.target.name==="veh") chosenVeh=e.target.value; });
document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>setTab(b.dataset.tab)));

function logEvent(html, when){ if(!S) return; (S.log ||= []).push({t: when||Date.now(), h: html}); if(S.log.length>300) S.log.splice(0, S.log.length-300); if(tab==="log" && !simulating) renderPanel(); }
function toast(html, ms=3800, noLog){
  if(!noLog) logEvent(html);
  const t = document.createElement("div"); t.className="toast"; t.innerHTML=html; $("#toasts").appendChild(t);
  while($("#toasts").children.length>4) $("#toasts").firstChild.remove();
  setTimeout(()=>t.remove(), ms);
}
function refresh(){ drawJobs(); renderPanel(); }

/* ---------------- Start flow ---------------- */
function showStart(){
  const ss = $("#stSel");
  ss.innerHTML = Object.entries(STATES).map(([k,n])=>`<option value="${k}" ${k==="GA"?"selected":""}>${n}</option>`).join("");
  $("#startOv").hidden = false;
  map.setView([38.5,-96], 4);
}
$("#startForm").addEventListener("submit", e=>{
  e.preventDefault();
  const co = $("#coName").value.trim() || "Freight Co.", st = $("#stSel").value;
  $("#startOv").hidden = true;
  const cs = CITIES.filter(c=>c.s===st);
  map.flyToBounds(L.latLngBounds(cs.map(c=>[c.lat,c.lon])).pad(0.25), {maxZoom:9, duration:1});
  startPlacement({first:true, co, state:st});
});

/* ---------------- Placing a hub on the map ---------------- */
let placing = null, placeMarker = null;
function startPlacement(opts){
  placing = {...opts, pt:null, info:null, looking:false};
  document.querySelector(".mapwrap").classList.add("placing");
  renderPlaceBar();
}
function endPlacement(){
  placing = null; document.querySelector(".mapwrap").classList.remove("placing");
  if(placeMarker){ map.removeLayer(placeMarker); placeMarker = null; }
  $("#placeBar").hidden = true;
}
function placeAt(ll){
  if(placing.looking) return;
  placing.pt = {lat:+ll.lat.toFixed(5), lon:+ll.lng.toFixed(5)}; placing.info = null; placing.looking = true;
  const icon = L.divIcon({className:"", html:'<div class="mk-newhub">HUB</div>', iconSize:[26,26], iconAnchor:[13,13]});
  if(placeMarker) placeMarker.setLatLng(ll); else placeMarker = L.marker(ll, {icon, interactive:false, zIndexOffset:2000}).addTo(map);
  renderPlaceBar();
  reverseGeocode(placing.pt).then(info=>{ if(!placing) return; placing.info = info; placing.looking = false; renderPlaceBar(); });
}
function renderPlaceBar(){
  const p = placing, bar = $("#placeBar"); if(!p){ bar.hidden = true; return; }
  const stName = p.first ? STATES[p.state] : null;
  const keepName = $("#hubName")?.value;
  const defName = keepName || (p.first ? "HQ" : `Hub ${S ? S.bases.length+1 : 2}`);
  let body;
  if(!p.pt) body = `<p class="hint" style="color:var(--ink)">Click anywhere on the map${stName?` in ${esc(stName)}`:""} to place your ${p.first?"first ":""}hub. Zoom in to pick a street.</p>`;
  else if(p.looking) body = `<p class="addr">Looking up the address…</p>`;
  else {
    const wrongState = p.first && p.info.state && p.info.state !== p.state;
    const notUS = !p.info.us || !p.info.state;
    const cost = p.first ? "Free" : money(GARAGE_PRICE);
    body = `<p class="addr"><b>${esc(p.info.line)}</b></p>
      ${notUS?`<p class="need" style="margin:0">Pick a spot in the lower 48 states.</p>`:wrongState?`<p class="need" style="margin:0">That spot is in ${esc(STATES[p.info.state]||p.info.state)}. Pick a spot in ${esc(stName)}, or start over to change your home state.</p>`:""}
      <label class="fld">Hub name<input type="text" id="hubName" maxlength="28" value="${esc(defName)}"></label>
      <div class="btnrow"><button class="btn" id="placeGo" ${wrongState||notUS?"disabled":""}>Build hub here · ${cost}</button><span class="hint">or click the map to move it</span></div>`;
  }
  bar.innerHTML = `<h2>${p.first?"Place your first hub":"Place a new hub"}</h2>${body}${p.first?"":`<div class="btnrow"><button class="btn ghost sm" id="placeCancel">Cancel</button></div>`}`;
  bar.hidden = false;
  $("#placeGo") && ($("#placeGo").onclick = buildHub);
  $("#placeCancel") && ($("#placeCancel").onclick = endPlacement);
}
function buildHub(){
  const p = placing; if(!p || !p.pt || !p.info) return;
  const name = ($("#hubName")?.value || "").trim().slice(0,28) || (p.first ? "HQ" : `Hub ${S.bases.length+1}`);
  const city = nearestCity(p.pt);
  if(p.first){
    endPlacement();
    newGame(p.co, p.state, {pt:p.pt, addr:p.info.line, name, city});
    tab = "jobs"; afterLoad();
    map.flyTo([p.pt.lat,p.pt.lon], 11, {duration:1});
    toast(`${esc(name)} is open at ${esc(p.info.line)}. ${esc(S.drivers[0].name)} is waiting with your van.`, 6000);
    save(); return;
  }
  if(S.cash < GARAGE_PRICE){ toast("Not enough cash for a new hub."); return; }
  S.cash -= GARAGE_PRICE;
  const b = {id:nid("b"), city, pt:p.pt, addr:p.info.line, name, tier:0, dispatcher:false, home:false};
  S.bases.push(b); endPlacement();
  toast(`Opened <b>${esc(name)}</b> at ${esc(p.info.line)}`); drawBases(); save(); refresh();
}

/* ---------------- Save / load ---------------- */
function syncClock(){ const now=Date.now(); S.clock += (now-S.lastReal)*S.speed; S.lastReal = now; }
function save(){ if(!S) return; try{ localStorage.setItem(KEY, JSON.stringify(S, (k,v)=>k==="cum"?undefined:v)); }catch(_){} }
function afterLoad(){ drawBases(); drawJobs(); setTab(tab); }
function showAway(log){
  if(!log || (log.jobs===0 && log.ms<120000)) return;
  $("#awayT").textContent = `Gone ${dur(log.ms)}`;
  $("#awayBody").innerHTML = `<div class="kit"><div><span class="hint">Deliveries</span><b>${log.jobs}</b></div><div><span class="hint">Earned</span><b>${money(log.net)}</b></div><div><span class="hint">Level</span><b>${level()}</b></div></div>
    ${log.levels.length?`<p class="hint" style="color:var(--ink)">Leveled up to ${log.levels.at(-1)}. ${log.levels.map(L_=>UNLOCKS[L_]).filter(Boolean).map(esc).join(", ")}</p>`:""}
    ${log.jobs===0?`<p class="hint">Hire a dispatcher at level ${DISPATCH_LVL} to keep trucks working while you are gone.</p>`:""}
    <button class="btn" id="awayBtn">Back to dispatch</button>`;
  $("#awayOv").hidden = false;
  $("#awayBtn").onclick = ()=>{ $("#awayOv").hidden = true; };
}
function tick(){
  if(!S) return;
  const now = Date.now(), dt = now - S.lastReal;
  if(dt > 5*60e3){ S.lastReal = now; const log = simulateAway(dt); refresh(); showAway(log); save(); return; }
  S.clock += dt*S.speed; S.lastReal = now;
  if(logic()){ drawJobs(); renderPanel(); } else renderHeader();
}
function start(){
  let loaded = null;
  try{ const raw = localStorage.getItem(KEY); if(raw) loaded = JSON.parse(raw); }catch(_){}
  if(loaded && loaded.v===2){
    S = loaded;
    S.bases.forEach((b,i)=>{ if(b.tier==null) b.tier=0; delete b.slots; if(!b.name) b.name = b.home ? "HQ" : `Hub ${i+1}`; });
    S.jobs.forEach(j=>{ if(j.urg==="standard") j.expires=null; if(!j.from.name){ j.from.name=bizName(j.from.biz); j.from.num=houseNo(); j.to.name=bizName(j.to.biz); j.to.num=houseNo(); } });
    const dt = Date.now() - S.lastReal; let log = null;
    S.lastReal = Date.now();
    if(dt > 60e3) log = simulateAway(dt); else S.trips.forEach(roadTrip);
    S.jobs.forEach(j=>{ if(!j.routed) routeJob(j); });
    afterLoad();
    const p = basePt(S.bases[0]); map.setView([p.lat,p.lon], 10);
    showAway(log);
  } else showStart();
  setInterval(tick, 250);
  setInterval(liveText, 1000);
  setInterval(save, 5000);
  document.addEventListener("visibilitychange", save);
  requestAnimationFrame(frame);
}
start();
})();

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
  return Math.round((150 + 1.5*miles*Math.pow(w/1000,0.8)) * CARGO[cargo].mult * u);
}
function offsetPt(lat, lon, miles, ang){
  return {lat: lat + Math.sin(ang)*miles/MI_DEG, lon: lon + Math.cos(ang)*miles/(MI_DEG*Math.cos(lat*Math.PI/180))};
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
      return {mi: r.distance/1609.34, path: coords};
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

function newGame(co, cityIdx){
  S = {v:2, company:co, homeState:CITIES[cityIdx].s, clock:0, lastReal:Date.now(), speed:1, cash:50000, xp:0,
    earned:0, jobsDone:0, idc:0, payMult:1, bases:[], vehicles:[], drivers:[], jobs:[], trips:[], hired:0};
  const c = CITIES[cityIdx];
  const b = {id:nid("b"), city:cityIdx, pt:offsetPt(c.lat,c.lon,rnd(1,3),rnd(0,6.28)), slots:4, dispatcher:false, nextSpawn:0, home:true};
  S.bases.push(b);
  S.drivers.push({id:nid("d"), name:"You", kind:"owner", jobs:0, busy:false, hazmat:false, earned:0});
  S.vehicles.push({id:nid("v"), type:"van", base:b.id, n:"Van 1", busy:false, jobs:0});
  for(let k=0;k<8;k++) spawnJob(b);
}

/* ---------------- Jobs ---------------- */
const citiesNear = (ci, maxMi) => CITIES.filter(c=>roadMi(ci,c.i)<=maxMi).map(c=>c.i);
function spawnJob(base, depth=0){
  const L = level();
  const ownedTypes = [...new Set(S.vehicles.map(v=>v.type))];
  const reach = TYPES.filter(t=>t.lvl<=L+4);
  const t = (Math.random()<0.65 && ownedTypes.length) ? TYPE[pick(ownedTypes)] : pick(reach);
  const cargo = pick(t.cargo);
  if(cargo==="hazmat" && Math.random()<0.5 && depth<4) return spawnJob(base, depth+1);
  let weight;
  if(t.cars) weight = Math.round(rnd(3,9.99));
  else { const lo = cargo==="parcels"?0.15:0.35; weight = Math.max(300, Math.round(rnd(lo,1)*t.cap/50)*50); }
  const near = citiesNear(base.city, RADIUS_MI);
  const origin = Math.random()<0.45 ? base.city : pick(near);
  const r = Math.random();
  const tier = r<0.45?"local": r<0.8?"regional": r<0.94?"long":"cross";
  const ranges = {regional:[50,250],long:[250,Math.min(800,t.leg)],cross:[800,t.leg]};
  let dest = origin;
  if(tier!=="local" && ranges[tier][1]>ranges[tier][0]){
    const [a,bm] = ranges[tier];
    const cand = CITIES.filter(c=>{const m=roadMi(origin,c.i);return m>=a&&m<=bm;});
    if(cand.length) dest = pick(cand).i;
  }
  const oc = CITIES[origin], dc = CITIES[dest];
  const from = {c:origin, biz:pick(PRODUCERS[cargo]), ...offsetPt(oc.lat, oc.lon, rnd(0.5,4), rnd(0,6.28))};
  let to;
  if(dest===origin){ to = {c:dest, ...offsetPt(from.lat, from.lon, rnd(4,22), rnd(0,6.28))}; }
  else to = {c:dest, ...offsetPt(dc.lat, dc.lon, rnd(0.5,4), rnd(0,6.28))};
  to.biz = pick(ACCEPTORS[cargo]); if(to.biz===from.biz) to.biz = ACCEPTORS[cargo][0];
  const miles = estMi(from, to);
  const urg = Math.random()<0.07?"express":Math.random()<0.2?"priority":"standard";
  const life = urg==="express"? rnd(6,9)*MIN : urg==="priority"? rnd(12,18)*MIN : rnd(30,60)*MIN;
  const j = {id:nid("j"), base:base.id, cargo, weight, miles, urg, from, to, posted:S.clock, expires:S.clock+life, routed:false};
  j.pay = payFor(miles, weight, cargo, urg);
  S.jobs.push(j);
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
    if(r){ j.miles = Math.max(1, Math.round(r.mi)); j.path = r.path; j.pay = payFor(j.miles, j.weight, j.cargo, j.urg); }
    if(j.id===selectedJob){ drawSelection(); renderPanel(); }
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
function planTrip(v, j, drivers){
  const t = TYPE[v.type], bp = basePt(baseById(v.base));
  const dead = estMi(bp, j.from), back = estMi(j.to, bp);
  const lv = Math.max(...drivers.map(drvLevel));
  const f = 1-0.03*(lv-1);
  const ld = (t.big?1.5:0.5)*MIN;
  const tDead = Math.max(0.2*MIN, dead/30/2*MIN*f), tHaul = (1+j.miles/30)*MIN*f, tBack = Math.max(0.2*MIN, back/30/2*MIN*f);
  const cut = drivers.reduce((s,d)=>s+DRIVER_KIND[d.kind].cut+(d.hazmat?0.03:0),0);
  return {dead, back, tDead, ld, tHaul, tBack, total:tDead+ld+tHaul+ld+tBack, deliverIn:tDead+ld+tHaul+ld, cut, bonus:1+0.02*(lv-1)};
}
function vehicleFor(v, j){
  const t = TYPE[v.type];
  if(!t.cargo.includes(j.cargo)) return {ok:false, why:"Wrong trailer"};
  if(j.weight > t.cap) return {ok:false, why:"Too heavy"};
  if(j.miles > t.leg) return {ok:false, why:`Over ${t.leg} mi range`};
  if(estMi(basePt(baseById(v.base)), j.from) > MAX_DEADHEAD) return {ok:false, why:"Garage too far"};
  if(v.busy) return {ok:false, why:"On a job", busy:true};
  const ds = freeDrivers(t.lic, j.cargo);
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
  const p = r.plan, base = baseById(v.base), B = basePt(base), O = {lat:j.from.lat,lon:j.from.lon}, D = {lat:j.to.lat,lon:j.to.lon};
  const t0 = S.clock, a = t0+p.tDead, b = a+p.ld, c = b+p.tHaul, d = c+p.ld, e = d+p.tBack;
  const trip = {id:nid("t"), v:v.id, drivers:r.drivers.map(x=>x.id), job:{...j, path:undefined},
    segs:[ mkSeg("dead",straight(B,O),t0,a), mkSeg("load",[[O.lat,O.lon]],a,b), mkSeg("haul", j.path||straight(O,D), b,c),
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
let awayLog = null, simulating = false;
function deliver(tr){
  tr.delivered = true;
  const net = tr.gross*(1-tr.cut)*S.payMult;
  const before = level();
  S.cash += net; S.earned += net; S.xp += tr.gross/100; S.jobsDone++;
  const v = S.vehicles.find(x=>x.id===tr.v); if(v) v.jobs++;
  tr.drivers.forEach(id=>{const d=S.drivers.find(x=>x.id===id); if(d){d.jobs++; d.earned+=tr.gross*DRIVER_KIND[d.kind].cut;}});
  if(awayLog){awayLog.jobs++; awayLog.net+=net;}
  else toast(`<b>${esc(v?v.n:"Truck")}</b> delivered ${esc(CARGO[tr.job.cargo].n.toLowerCase())} to ${esc(cityName(tr.job.to.c))} <span class="num">+${money(net)}</span>`);
  const after = level();
  for(let L=before+1;L<=after;L++){ if(awayLog) awayLog.levels.push(L); else toast(`<b>Level ${L}</b>${UNLOCKS[L]?` · unlocked ${esc(UNLOCKS[L])}`:""}`, 6000); }
}
function logic(){
  let changed = false;
  for(const tr of S.trips) if(!tr.delivered && S.clock>=tr.deliverAt){ deliver(tr); changed=true; }
  const done = S.trips.filter(tr=>S.clock>=tr.endAt);
  if(done.length){
    done.forEach(tr=>{const v=S.vehicles.find(x=>x.id===tr.v); if(v)v.busy=false; tr.drivers.forEach(id=>{const d=S.drivers.find(x=>x.id===id); if(d)d.busy=false;});});
    S.trips = S.trips.filter(tr=>S.clock<tr.endAt); changed = true;
  }
  const n0 = S.jobs.length;
  S.jobs = S.jobs.filter(j=>j.expires>S.clock);
  if(selectedJob && !S.jobs.find(j=>j.id===selectedJob)) selectedJob = null;
  if(S.jobs.length!==n0) changed = true;
  for(const b of S.bases){
    if(S.jobs.filter(j=>j.base===b.id).length<BOARD_PER_BASE && S.clock>=b.nextSpawn){ spawnJob(b); b.nextSpawn = S.clock + rnd(18,40)*1000; changed = true; }
  }
  for(const b of S.bases){
    if(!b.dispatcher) continue;
    for(const v of S.vehicles.filter(x=>x.base===b.id && !x.busy)){
      const best = S.jobs.filter(j=>roadMi(b.city,j.from.c)<=RADIUS_MI && vehicleFor(v,j).ok).sort((a,c)=>c.pay-a.pay)[0];
      if(best){ dispatch(best, v, true); changed = true; }
    }
  }
  return changed;
}
function simulateAway(ms){
  ms = Math.min(ms, 12*3600e3);
  awayLog = {jobs:0, net:0, levels:[], ms}; simulating = true;
  let t = 0;
  while(t < ms){ S.payMult = t > 4*3600e3 ? 0.5 : 1; const d = Math.min(15000, ms-t); S.clock += d; t += d; logic(); }
  S.payMult = 1; simulating = false;
  S.trips.forEach(roadTrip);
  const log = awayLog; awayLog = null; return log;
}

/* ---------------- Street map ---------------- */
const map = L.map("map", {zoomControl:true, worldCopyJump:false, minZoom:4, maxZoom:18, preferCanvas:false}).setView([38.5,-96], 4);
L.tileLayer(TILE_URL, {maxZoom:19, attribution:TILE_ATTR}).addTo(map);
const layerRings = L.layerGroup().addTo(map), layerRoutes = L.layerGroup().addTo(map), layerSel = L.layerGroup().addTo(map),
      layerBases = L.layerGroup().addTo(map), layerJobs = L.layerGroup().addTo(map), layerVeh = L.layerGroup().addTo(map);
const jobMarkers = new Map(), vehMarkers = new Map(), tripLines = new Map();
const PIN_SVG = '<svg width="22" height="28" viewBox="0 0 22 28"><path class="body" d="M11 27C9 22 2 17 2 10.5A9 9 0 0 1 20 10.5C20 17 13 22 11 27Z"/><circle class="hole" cx="11" cy="10.5" r="3.4"/></svg>';
map.on("click", ()=>{ if(selectedJob){ selectedJob=null; drawJobs(); renderPanel(); } });

function drawBases(){
  layerBases.clearLayers(); layerRings.clearLayers();
  S.bases.forEach((b,i)=>{
    const p = basePt(b);
    L.circle([p.lat,p.lon], {radius:RADIUS_MI*1609.34, color:"#1e5a3c", weight:1.2, opacity:.5, dashArray:"5 6", fill:true, fillOpacity:.03, interactive:false}).addTo(layerRings);
    L.marker([p.lat,p.lon], {icon:L.divIcon({className:"", html:`<div class="mk-base">${b.home?"HQ":"G"+(i+1)}</div>`, iconSize:[22,22], iconAnchor:[11,11]}), zIndexOffset:500, title:`${b.home?"HQ":"Garage"} · ${cityName(b.city)}`}).addTo(layerBases);
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
      const label = v ? v.n.replace(/[^0-9]/g,"").slice(-2) : "";
      if(!m){
        m = L.marker(p.ll, {icon:L.divIcon({className:"", html:`<div class="mk-veh ${p.ph}">${label}</div>`, iconSize:[18,18], iconAnchor:[9,9]}), zIndexOffset:800, title:v?v.n:"Truck"});
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
    ["Reach level 3 and open a second garage", S.bases.length>=2], ["Buy a straight truck (level 6)", has("straight")],
    ["Hire a dispatcher (level 8)", S.bases.some(b=>b.dispatcher)], ["Put a semi on the road (level 10)", S.vehicles.some(v=>TYPE[v.type].lvl>=10)]
  ];
}
function jobCard(j){
  const st = jobStatus(j), local = j.from.c===j.to.c;
  return `<button class="card ${j.id===selectedJob?"sel":""} ${st.can?"":"dim"}" data-act="sel" data-id="${j.id}">
    <div class="row"><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${cargoChip(j.cargo)}${urgTag(j.urg)}</div><span class="pay">${money(j.pay)}</span></div>
    <div class="route"><b>${esc(j.from.biz)}</b>, ${esc(cityName(j.from.c))} <span class="arrow">→</span> <b>${esc(j.to.biz)}</b>${local?" across town":`, ${esc(cityName(j.to.c))}`}</div>
    <div class="meta"><span class="num">${weightStr(j)}</span><span class="num">${j.routed?"":"about "}${j.miles} mi</span><span>expires in <span class="num" data-exp="${j.expires}">${dur(j.expires-S.clock)}</span></span></div>
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
      <span><b>${esc(o.v.n)}</b> · ${esc(TYPE[o.v.type].n)}<small>${esc(o.r.drivers.map(d=>d.name).join(" + "))} · ${p.dead>1?`${p.dead} mi to pickup · `:""}delivers in ${dur(p.deliverIn)}, home in ${dur(p.total)}</small></span>
      <span class="pay" title="After driver pay">${money(net)}</span></label>`;}).join("")}</div>
      <div class="btnrow"><button class="btn" data-act="go" data-id="${j.id}" ${j.routing?"disabled":""}>${j.routing?"Finding route…":"Dispatch"}</button><button class="btn ghost" data-act="unsel">Close</button></div>`;
  } else {
    opts = `<p class="need" style="font-size:13px;margin:0">${esc(st.why)}</p><div class="btnrow"><button class="btn ghost" data-act="unsel">Close</button>${st.soon?"":`<button class="btn ghost" data-act="tab" data-tab="shop">Open shop</button>`}</div>`;
  }
  return `<section class="dispatch" aria-label="Dispatch job">
    <div class="row"><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${cargoChip(j.cargo)}${urgTag(j.urg)}</div><span class="pay" style="font-size:18px">${money(j.pay)}</span></div>
    <div class="leg"><span class="dot"></span><span><b>${esc(j.from.biz)}</b>, ${esc(cityName(j.from.c))}</span>
      <span class="line"></span><span class="hint"><span class="num">${weightStr(j)}</span> · <span class="num">${j.miles} mi</span> ${j.routing?"· checking roads":j.path?"by road":local?"across town":"(estimate)"}</span>
      <span class="dot end"></span><span><b>${esc(j.to.biz)}</b>, ${esc(cityName(j.to.c))}</span></div>
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
  if(open.length) h += `<section class="sec"><h3>Next goals</h3><ul class="goals">${open.map(x=>`<li>${esc(x[0])}</li>`).join("")}</ul></section>`;
  h += `<section class="sec"><div class="sec-head"><h2>Ready to run</h2><span class="hint num">${can.length}</span></div>${can.length?`<div class="list">${can.map(x=>jobCard(x.j)).join("")}</div>`:`<p class="hint">Nothing your fleet can take right now. New jobs post every 20 to 40 seconds.</p>`}</section>`;
  if(cant.length) h += `<section class="sec"><div class="sec-head"><h2>Other jobs nearby</h2><span class="hint num">${cant.length}</span></div><div class="list">${cant.map(x=>jobCard(x.j)).join("")}</div></section>`;
  return h;
}
function phaseText(tr,t){const p=segAt(tr,t).ph;return p==="dead"?"Heading to pickup":p==="load"?(t<tr.deliverAt-1?"Loading":"Unloading"):p==="haul"?"Loaded, on the way":"Returning to garage";}
function renderFleet(){
  const t = displayClock();
  let h = `<section class="sec"><div class="sec-head"><h2>Your fleet</h2><span class="hint num">${S.vehicles.length} vehicles</span></div><div class="list">`;
  for(const b of S.bases){
    const vs = S.vehicles.filter(v=>v.base===b.id);
    h += `<h3>${b.home?"HQ":"Garage"} · ${esc(cityName(b.city))} <span class="num" style="letter-spacing:0">${vs.length}/${b.slots}</span>${b.dispatcher?" · dispatcher on":""}</h3>`;
    for(const v of vs){
      const tr = S.trips.find(x=>x.v===v.id), ty = TYPE[v.type];
      const cap = ty.cars?`${ty.cap} cars`:`${ty.cap.toLocaleString("en-US")} lb`;
      if(tr){
        const pct = Math.min(100,(t-tr.segs[0].t0)/(tr.endAt-tr.segs[0].t0)*100);
        const ds = tr.drivers.map(id=>S.drivers.find(d=>d.id===id)?.name).join(" + ");
        h += `<div class="card"><div class="row"><b>${esc(v.n)}</b><span class="status busy" data-ph="${tr.id}">${phaseText(tr,t)}</span></div>
          <div class="route">${esc(cityName(tr.job.from.c))} <span class="arrow">→</span> ${esc(cityName(tr.job.to.c))} · ${esc(ds)}</div>
          <div class="prog"><i data-prog="${tr.id}" style="width:${pct}%"></i></div>
          <div class="meta"><span>${tr.delivered?"Delivered, home in":"Delivers in"} <span class="num" data-eta="${tr.id}">${dur((tr.delivered?tr.endAt:tr.deliverAt)-t)}</span></span><span class="num">${money(tr.gross*(1-tr.cut))}</span></div>
          <div class="btnrow"><button class="btn ghost sm" data-act="follow" data-id="${tr.id}">Follow on map</button></div></div>`;
      } else {
        const confirm = pendingConfirm===("sell"+v.id);
        h += `<div class="card"><div class="row"><b>${esc(v.n)}</b><span class="status idle">Idle</span></div>
          <div class="meta"><span>${esc(ty.n)}</span><span class="num">${cap}</span><span class="num">${ty.leg} mi range</span><span>${v.jobs} jobs</span></div>
          ${S.vehicles.length>1?`<div class="btnrow">${confirm?`<button class="btn warn sm" data-act="sell" data-id="${v.id}">Sell for ${money(ty.price*0.6)}</button><button class="btn ghost sm" data-act="cancel">Keep it</button>`:`<button class="btn ghost sm" data-act="askSell" data-id="${v.id}">Sell</button>`}</div>`:""}</div>`;
      }
    }
  }
  return h + `</div></section>`;
}
function renderShop(){
  const L_ = level();
  let h = `<section class="sec"><div class="sec-head"><h2>Trucks</h2><span class="hint">60% back when sold</span></div><div class="list">`;
  const baseOpts = S.bases.map(b=>{const n=S.vehicles.filter(v=>v.base===b.id).length;return `<option value="${b.id}" ${n>=b.slots?"disabled":""}>${esc(cityName(b.city))} (${n}/${b.slots})</option>`;}).join("");
  const anySlot = S.bases.some(b=>S.vehicles.filter(v=>v.base===b.id).length<b.slots);
  for(const t of TYPES){
    const locked = t.lvl>L_, poor = S.cash<t.price;
    h += `<div class="card ${locked?"dim":""}"><div class="row"><b>${esc(t.n)}</b><span class="num">${money(t.price)}</span></div>
      <div class="meta"><span class="num">${t.cars?t.cap+" cars":t.cap.toLocaleString("en-US")+" lb"}</span><span class="num">${t.leg} mi range</span><span>${t.cargo.map(c=>CARGO[c].n).join(", ")}</span><span>${t.lic==="std"?"Any driver":t.lic==="cdl"?"CDL driver":"2 CDL drivers"}</span></div>
      ${locked?`<span class="lock">Unlocks at level ${t.lvl}</span>`:`<div class="btnrow"><select aria-label="Garage for ${esc(t.n)}" id="bs-${t.id}" style="width:auto;flex:1;min-width:0">${baseOpts}</select><button class="btn sm" data-act="buy" data-id="${t.id}" ${poor||!anySlot?"disabled":""}>${poor?"Not enough cash":!anySlot?"Garages full":"Buy"}</button></div>`}</div>`;
  }
  h += `</div></section>`;
  const used = new Set(S.bases.map(b=>b.city));
  const cityOpts = Object.keys(STATES).map(s=>`<optgroup label="${STATES[s]}">${CITIES.filter(c=>c.s===s&&!used.has(c.i)).map(c=>`<option value="${c.i}">${esc(c.n)}</option>`).join("")}</optgroup>`).join("");
  h += `<section class="sec"><h2>Garages</h2>
    <div class="card ${L_<GARAGE_LVL?"dim":""}"><div class="row"><b>Open a new garage</b><span class="num">${money(GARAGE_PRICE)}</span></div>
      <p class="hint">Adds 4 vehicle slots and a ${RADIUS_MI}-mile job area around a new city.</p>
      ${L_<GARAGE_LVL?`<span class="lock">Unlocks at level ${GARAGE_LVL}</span>`:`<div class="btnrow"><select id="newGarage" aria-label="City for new garage" style="flex:1;min-width:0;width:auto">${cityOpts}</select><button class="btn sm" data-act="garage" ${S.cash<GARAGE_PRICE?"disabled":""}>Open</button></div>`}</div>
    ${S.bases.map(b=>`<div class="card"><div class="row"><b>${esc(cityName(b.city))}</b><span class="num">${b.slots} slots</span></div>
      <div class="btnrow"><button class="btn ghost sm" data-act="slot" data-id="${b.id}" ${S.cash<SLOT_PRICE||b.slots>=12?"disabled":""}>${b.slots>=12?"Max size":`Add 2 slots · ${money(SLOT_PRICE)}`}</button></div></div>`).join("")}
  </section>
  <section class="sec"><h2>Coming next</h2>
    <div class="card dim"><div class="row"><b>Rail depots and trains</b><span class="lock">Level 15</span></div><p class="hint">Haul up to 60 railcars between depots. Your trucks bring freight in and take it out.</p></div>
    <div class="card dim"><div class="row"><b>Air cargo</b><span class="lock">Level 20</span></div><p class="hint">Unlock airports and fly urgent freight between them, Pocket Planes style.</p></div></section>`;
  return h;
}
function renderCrew(){
  const L_ = level();
  let h = `<section class="sec"><h2>Hire</h2>
    <div class="card"><div class="row"><b>Driver</b><span class="num">${money(1000)}</span></div><p class="hint">Drives vans and box trucks. Takes 25% of each job.</p>
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
  h += `</div></section><section class="sec"><h2>Dispatchers</h2><p class="hint">A dispatcher sends idle vehicles at one garage on the best-paying job they can take, even while you are away. Takes 5% of the jobs they assign.</p>`;
  if(L_<DISPATCH_LVL) h += `<div class="card dim"><span class="lock">Unlocks at level ${DISPATCH_LVL}</span></div>`;
  else h += S.bases.map(b=>`<div class="card"><div class="row"><b>${esc(cityName(b.city))}</b><span class="status ${b.dispatcher?"idle":""}">${b.dispatcher?"Dispatcher on duty":"No dispatcher"}</span></div>
      <div class="btnrow">${b.dispatcher?`<button class="btn ghost sm" data-act="disp" data-id="${b.id}">Let go</button>`:`<button class="btn sm" data-act="disp" data-id="${b.id}" ${S.cash<DISPATCH_PRICE?"disabled":""}>Hire · ${money(DISPATCH_PRICE)}</button>`}</div></div>`).join("");
  return h + `</section>`;
}
function renderCompany(){
  const L_ = level(), reset = pendingConfirm==="reset";
  return `<section class="sec"><h2>${esc(S.company)}</h2>
    <table class="spec"><tbody>
      <tr><td>Level</td><td>${L_}</td></tr>
      <tr><td>XP</td><td>${Math.floor(S.xp).toLocaleString("en-US")} / ${xpNeed(L_+1).toLocaleString("en-US")}</td></tr>
      <tr><td>Next unlock</td><td style="font-family:var(--body)">${esc(Object.entries(UNLOCKS).find(([k])=>+k>L_)?.[1]||"All unlocked")}</td></tr>
      <tr><td>Deliveries</td><td>${S.jobsDone.toLocaleString("en-US")}</td></tr>
      <tr><td>Earned after driver pay</td><td>${money(S.earned)}</td></tr>
      <tr><td>Garages</td><td>${S.bases.length}</td></tr>
      <tr><td>Home state</td><td style="font-family:var(--body)">${STATES[S.homeState]}</td></tr>
    </tbody></table></section>
    <section class="sec"><h3>Goals</h3><ul class="goals">${goals().map(x=>`<li class="${x[1]?"done":""}">${esc(x[0])}</li>`).join("")}</ul></section>
    <section class="sec"><h3>Clock speed</h3><p class="hint">Speeds up every trip. Handy for testing the economy; away time always counts at normal speed.</p>
      <div class="seg" role="group" aria-label="Clock speed">${[1,3,10].map(s=>`<button data-act="speed" data-s="${s}" aria-pressed="${S.speed===s}">${s}×</button>`).join("")}</div></section>
    <section class="sec"><h3>Away from the game</h3><p class="hint">Trips in progress always finish. Garages with a dispatcher keep working at full pay for 4 hours, half pay up to 12 hours, then wait for you.</p></section>
    <section class="sec"><h3>Start over</h3><div class="btnrow">${reset?`<button class="btn warn sm" data-act="reset">Erase this company</button><button class="btn ghost sm" data-act="cancel">Cancel</button>`:`<button class="btn ghost sm" data-act="askReset">Reset game</button>`}</div></section>`;
}
function renderHeader(){
  const L_ = level(), a = xpNeed(L_), b = xpNeed(L_+1);
  $("#hdrCo").textContent = S.company;
  $("#hdrCash").textContent = money(S.cash);
  $("#hdrLvl").textContent = "Level " + L_;
  $("#hdrXp").style.width = (L_>=50?100:Math.min(100,(S.xp-a)/(b-a)*100)) + "%";
  $("#hdrTrips").textContent = S.trips.length;
  $("#jobBadge").textContent = S.jobs.filter(j=>jobStatus(j).can).length;
}
function renderPanel(){
  if(!S) return;
  const body = $("#panelBody"), st = body.scrollTop;
  body.innerHTML = tab==="jobs"?renderJobs():tab==="fleet"?renderFleet():tab==="shop"?renderShop():tab==="crew"?renderCrew():renderCompany();
  body.scrollTop = st;
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
    if(j && v && dispatch(j,v)){ toast(`<b>${esc(v.n)}</b> dispatched to ${esc(j.from.biz)}, ${esc(cityName(j.from.c))}`); selectedJob=null; save(); drawJobs(); renderPanel(); }
    return;
  }
  if(a==="buy"){
    const t = TYPE[id], b = baseById($("#bs-"+id)?.value);
    if(!b || S.cash<t.price || S.vehicles.filter(v=>v.base===b.id).length>=b.slots) return;
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
  if(a==="garage"){
    const c = +$("#newGarage").value; if(S.cash<GARAGE_PRICE||isNaN(c)) return;
    S.cash -= GARAGE_PRICE;
    const ct = CITIES[c], b = {id:nid("b"), city:c, pt:offsetPt(ct.lat,ct.lon,rnd(1,3),rnd(0,6.28)), slots:4, dispatcher:false, nextSpawn:S.clock, home:false};
    S.bases.push(b); for(let k=0;k<6;k++) spawnJob(b);
    toast(`Garage opened in ${esc(cityName(c))}`); drawBases(); map.flyTo([b.pt.lat,b.pt.lon], 10, {duration:.6}); save(); refresh(); return;
  }
  if(a==="slot"){ const b=baseById(id); if(b&&S.cash>=SLOT_PRICE&&b.slots<12){S.cash-=SLOT_PRICE;b.slots+=2;save();refresh();} return; }
  if(a==="disp"){ const b=baseById(id); if(!b) return; if(b.dispatcher) b.dispatcher=false; else if(S.cash>=DISPATCH_PRICE){S.cash-=DISPATCH_PRICE;b.dispatcher=true;} save(); refresh(); return; }
  if(a==="askSell"){ pendingConfirm="sell"+id; renderPanel(); return; }
  if(a==="sell"){ const v=S.vehicles.find(x=>x.id===id); if(v&&!v.busy){S.cash+=TYPE[v.type].price*0.6; S.vehicles=S.vehicles.filter(x=>x!==v);} pendingConfirm=null; save(); refresh(); return; }
  if(a==="cancel"){ pendingConfirm=null; renderPanel(); return; }
  if(a==="speed"){ syncClock(); S.speed=+el.dataset.s; save(); renderPanel(); return; }
  if(a==="askReset"){ pendingConfirm="reset"; renderPanel(); return; }
  if(a==="reset"){
    try{localStorage.removeItem(KEY);}catch(_){}
    S=null; selectedJob=null; pendingConfirm=null; following=null;
    [layerJobs,layerBases,layerRings,layerVeh,layerRoutes,layerSel].forEach(l=>l.clearLayers()); jobMarkers.clear(); vehMarkers.clear(); tripLines.clear();
    $("#panelBody").innerHTML=""; showStart(); return;
  }
});
$("#panelBody").addEventListener("change", e=>{ if(e.target.name==="veh") chosenVeh=e.target.value; });
document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>setTab(b.dataset.tab)));

function toast(html, ms=3800){
  const t = document.createElement("div"); t.className="toast"; t.innerHTML=html; $("#toasts").appendChild(t);
  while($("#toasts").children.length>4) $("#toasts").firstChild.remove();
  setTimeout(()=>t.remove(), ms);
}
function refresh(){ drawJobs(); renderPanel(); }

/* ---------------- Start flow ---------------- */
function showStart(){
  const ss = $("#stSel");
  ss.innerHTML = Object.entries(STATES).map(([k,n])=>`<option value="${k}" ${k==="GA"?"selected":""}>${n}</option>`).join("");
  const fill = ()=>{ $("#ctSel").innerHTML = CITIES.filter(c=>c.s===ss.value).map(c=>`<option value="${c.i}">${esc(c.n)}</option>`).join(""); };
  ss.onchange = fill; fill();
  $("#startOv").hidden = false;
  map.setView([38.5,-96], 4);
}
$("#startForm").addEventListener("submit", e=>{
  e.preventDefault();
  newGame($("#coName").value.trim() || "Freight Co.", +$("#ctSel").value);
  $("#startOv").hidden = true;
  afterLoad();
  const p = basePt(S.bases[0]); map.flyTo([p.lat,p.lon], 10, {duration:1.2});
  toast("Your van is parked at HQ. Pick a job to start earning.", 5000);
  save();
});

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
    const dt = Date.now() - S.lastReal; let log = null;
    S.lastReal = Date.now();
    if(dt > 60e3) log = simulateAway(dt); else S.trips.forEach(roadTrip);
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

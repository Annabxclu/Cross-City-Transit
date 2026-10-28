/* Cross-City Transit — game logic and street map.
   Map tiles: OpenStreetMap. Road routes: OSRM (public demo server). */
(() => {
"use strict";

/* ---------------- Settings ---------------- */
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ROUTER = "https://router.project-osrm.org/route/v1/driving/";
const RAIL_ROUTER = "https://brouter.de/brouter";   // BRouter rail profile: routes along real track
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
const weightStr = j => j.rail ? `${railUnitWord(j.carType, j.units)} · ${j.weight.toLocaleString("en-US")} lb` : j.cargo==="vehicles" ? `${j.weight} cars` : `${j.weight.toLocaleString("en-US")} lb`;
const xpNeed = L => Math.round(50*Math.pow(L-1,1.8));
function levelOf(xp){let L=1;while(L<50 && xp>=xpNeed(L+1))L++;return L;}
const drvLevel = d => {let l=1;DRV_LEVELS.forEach((t,i)=>{if(d.jobs>=t)l=i+1;});return Math.min(5,l);};
function payFor(miles, weight, cargo, urg){
  const w = cargo==="vehicles" ? weight*4000 : weight;
  const u = (URG[urg]||URG.standard).pay;
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
  if(p.label) return p.label;
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
function getRailRoute(a, b){
  const k = "rail|"+rkey(a,b);
  if(routeCache.has(k)) return routeCache.get(k);
  const p = routeQueue.then(async () => {
    try{
      const ctl = new AbortController(); const timer = setTimeout(()=>ctl.abort(), 15000);
      const res = await fetch(`${RAIL_ROUTER}?lonlats=${a.lon},${a.lat}|${b.lon},${b.lat}&profile=rail&alternativeidx=0&format=geojson`, {signal:ctl.signal});
      clearTimeout(timer);
      if(!res.ok) throw new Error(res.status);
      const f = (await res.json()).features?.[0]; if(!f) throw new Error("no route");
      return {mi: (+f.properties["track-length"])/1609.34, path: thin(f.geometry.coordinates.map(c=>[+c[1].toFixed(5), +c[0].toFixed(5)]), 800)};
    }catch(e){ routeCache.delete(k); return null; }
    finally{ await new Promise(r=>setTimeout(r, 1000)); }
  });
  routeQueue = p.catch(()=>{});
  routeCache.set(k, p);
  return p;
}
const straight = (a,b) => [[a.lat,a.lon],[b.lat,b.lon]];

/* ---------------- State ---------------- */
let S = null;
let selectedJob = null, tab = "jobs", pendingConfirm = null, chosenVeh = null, extraSel = new Set();
const nid = p => p + (++S.idc);
// Air cargo opens at AIR_LVL; anyone who already owns planes (bought when it opened earlier) keeps flying them.
const planeOk = p => p.lvl <= levelOf(S.xp) || S.vehicles.some(v=>v.type===p.id);
const airOpen = () => levelOf(S.xp) >= AIR_LVL || S.vehicles.some(v=>v.airport);
const level = () => levelOf(S.xp);
const baseById = id => S.bases.find(b=>b.id===id);
const hubCap = b => Math.min(HUB_TIERS[b.tier||0].cap, levelSlots(level()));
// Truck pickups must be within this many miles of the truck's hub (set in Settings).
const rangeMi = () => RANGE_OPTS.includes(S?.range) ? S.range : DEFAULT_RANGE;
// Each kind of vehicle has its own job board: one more job than you have of that kind.
const maxJobs = () => JOB_BOARD_MAX;
const jobKind = j => j.air ? "air" : j.rail ? "rail" : "truck";
const boardCount = () => S.jobs.filter(j=>jobKind(j)==="truck").length;
const maxAirJobs = () => JOB_BOARD_MAX;
const airCount = () => S.jobs.filter(j=>j.air).length;
const maxRailJobs = () => JOB_BOARD_MAX;
const railCount = () => S.jobs.filter(j=>j.rail).length;
/* ---------------- Rail helpers ---------------- */
const isTrain = v => TYPE[v.type]?.mode==="train";
const isPlane = v => TYPE[v.type]?.mode==="plane";
const trucks = () => S.vehicles.filter(v=>!isTrain(v) && !isPlane(v));
const airportPt = id => ({lat:AIRPORT[id].lat, lon:AIRPORT[id].lon});
const airportStop = a => ({lat:a.lat, lon:a.lon, c:nearestCity(a), airport:a.id, biz:"Airport", name:`${a.id} ${a.n}`, label:`${a.n} (${a.id}), ${a.city} ${a.s}`});
// Great-circle path for flights, as [lat,lon] points.
function gcPath(a, b, n=48){
  const r = Math.PI/180, la1=a.lat*r, lo1=a.lon*r, la2=b.lat*r, lo2=b.lon*r;
  const d = 2*Math.asin(Math.sqrt(Math.sin((la2-la1)/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin((lo2-lo1)/2)**2));
  if(d < 1e-6) return [[a.lat,a.lon],[b.lat,b.lon]];
  const out = [];
  for(let i=0;i<=n;i++){ const f=i/n, A=Math.sin((1-f)*d)/Math.sin(d), B=Math.sin(f*d)/Math.sin(d);
    const x=A*Math.cos(la1)*Math.cos(lo1)+B*Math.cos(la2)*Math.cos(lo2), y=A*Math.cos(la1)*Math.sin(lo1)+B*Math.cos(la2)*Math.sin(lo2), z=A*Math.sin(la1)+B*Math.sin(la2);
    out.push([+(Math.atan2(z,Math.hypot(x,y))/r).toFixed(4), +(Math.atan2(y,x)/r).toFixed(4)]); }
  return out;
}
const yardPt = id => ({lat:YARD[id].lat, lon:YARD[id].lon});
const homePt = v => v.airport ? airportPt(v.airport) : v.yard ? yardPt(v.yard) : basePt(baseById(v.base));
const yardStop = y => ({lat:y.lat, lon:y.lon, c:nearestCity(y), yard:y.id, biz:"Rail yard", name:y.n, label:`${y.n}, ${y.city} ${y.s}`});
const trainSlots = (v, ct) => { const n = (v.cars||{})[ct]||0; return RAILCARS[ct].unit ? n*RAILCARS[ct].cap : n; };
const trainCarCount = v => Object.values(v.cars||{}).reduce((a,b)=>a+b,0);
const railUnitWord = (ct, n) => RAILCARS[ct].unit ? `${n} container${n>1?"s":""}` : `${n} ${RAILCARS[ct].n.toLowerCase()} carload${n>1?"s":""}`;
const vehValue = v => TYPE[v.type].price + Object.entries(v.cars||{}).reduce((a,[k,n])=>a+RAILCARS[k].price*n,0);
function railUsed(tr, ct){ return openLoads(tr).filter(l=>l.job.carType===ct).reduce((n,l)=>n+l.job.units,0); }
function capText(v, extra){
  const tr = tripOf(v), t = TYPE[v.type];
  if(!isTrain(v)) return roomStr(t, usedRoom(tr)+(extra?extra.weight:0));
  const ct = extra?.carType;
  if(!ct) return `${trainCarCount(v)} of ${t.maxCars} cars`;
  return `${railUsed(tr,ct)+extra.units} of ${trainSlots(v,ct)} ${RAILCARS[ct].unit?"container slots":RAILCARS[ct].n.toLowerCase()+"s"}`;
}

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
  const ownedTypes = [...new Set(trucks().map(v=>v.type))];
  const reach = TYPES.filter(t=>t.lvl<=L);   // only vehicles you can already buy
  // Keep the board useful: while fewer jobs fit your fleet than you have vehicles, only post jobs you can run.
  const fitting = S.jobs.filter(x=>jobKind(x)==="truck" && trucks().some(v=>{const tt=TYPE[v.type];return tt.cargo.includes(x.cargo)&&tt.cap>=x.weight&&tt.leg>=x.miles;})).length;
  const ownOnly = fitting < trucks().length;
  const t = ((ownOnly || Math.random()<0.85) && ownedTypes.length) ? TYPE[pick(ownedTypes)] : pick(reach);
  const cargo = pick(t.cargo);
  if(cargo==="hazmat" && Math.random()<0.5 && depth<4) return spawnJob(base, depth+1);
  let weight;
  if(t.cars) weight = Math.round(rnd(3,9.99));
  else { const lo = cargo==="parcels"?0.15:0.35; weight = Math.max(300, Math.round(rnd(lo,1)*t.cap/50)*50); }
  // Pickups: near the hub or in a city within the hub's job area.
  const bp = basePt(base), near = CITIES.filter(c=>hav(bp,c)<=rangeMi()-6).map(c=>c.i);
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
  maybeEventJob(j);
  j.pay = jobPay(j);
  S.jobs.push(j);
  if(!simulating) routeJob(j);
  return j;
}
/* Rail jobs: carloads between real yards. */
function spawnRailJob(base){
  const L = level(), locos = LOCOS.filter(l=>l.lvl<=L); if(!locos.length) return null;
  const maxLeg = Math.max(...locos.map(l=>l.leg))*0.85, maxCars = Math.max(...locos.map(l=>l.maxCars));
  const anchors = S.bases.map(basePt).concat(S.vehicles.filter(v=>v.yard).map(v=>yardPt(v.yard)));
  const near = RAIL_YARDS.filter(y=>anchors.some(a=>hav(a,y)*1.2<=300));
  if(!near.length) return null;
  const O = pick(near);
  const dests = RAIL_YARDS.filter(y=>y!==O && hav(O,y)*1.25>=80 && hav(O,y)*1.25<=maxLeg); if(!dests.length) return null;
  const D = pick(dests);
  const owned = [...new Set(S.vehicles.filter(isTrain).flatMap(v=>Object.keys(v.cars||{}).filter(k=>v.cars[k]>0)))];
  const ct = owned.length && Math.random()<0.65 ? pick(owned) : pick(Object.keys(RAILCARS));
  const car = RAILCARS[ct], cargo = pick(car.cargo);
  const mine = Math.max(0, ...S.vehicles.filter(isTrain).map(v=>trainSlots(v, ct)));   // size jobs to the cars you own
  const units = Math.max(1, Math.round(rnd(1, mine ? Math.min(mine, maxCars) : Math.min(maxCars, 6))));
  const weight = Math.round(units*(car.unit ? car.perUnit : car.cap)*rnd(0.75,1)/1000)*1000;
  const j = {id:nid("j"), base:base.id, rail:true, carType:ct, units, cargo, weight, miles:Math.round(hav(O,D)*1.25), urg:"standard",
    from:{...yardStop(O)}, to:{...yardStop(D)}, posted:S.clock, expires:null, routed:false};
  j.pay = jobPay(j); S.jobs.push(j); if(!simulating) routeJob(j);
  return j;
}
/* Air cargo jobs: airport to airport, sized to the aircraft you own or can buy. */
function spawnAirJob(base){
  const avail = PLANES.filter(planeOk); if(!avail.length) return null;
  const owned = S.vehicles.filter(isPlane);
  const pt = owned.length && Math.random()<0.75 ? TYPE[pick(owned).type] : pick(avail);
  const anchors = S.bases.map(basePt).concat(owned.map(v=>airportPt(v.airport)));
  const fits = a => a.size >= pt.minSize;
  let Os = AIRPORTS.filter(a=>fits(a) && anchors.some(x=>hav(x,a)<=400));
  if(!Os.length) Os = AIRPORTS.filter(fits);
  const O = pick(Os);
  const Ds = AIRPORTS.filter(a=>a!==O && fits(a) && hav(O,a)>=150 && hav(O,a)<=pt.leg*0.9); if(!Ds.length) return null;
  const D = pick(Ds), cargo = pick(AIR_CARGO);
  const weight = Math.max(200, Math.round(rnd(0.3,1)*pt.cap/50)*50);
  const urg = Math.random()<0.2 ? "express" : Math.random()<0.45 ? "priority" : "standard";
  const life = urg==="express" ? rnd(15,25)*MIN : rnd(25,40)*MIN;
  const j = {id:nid("j"), base:base.id, air:true, cargo, weight, urg, from:{...airportStop(O)}, to:{...airportStop(D)}, miles:Math.round(hav(O,D)),
    posted:S.clock, expires: urg==="standard" ? null : S.clock+life, routed:false};
  j.pay = jobPay(j); S.jobs.push(j); routeJob(j);
  return j;
}
// Fetch the real road route for a job, then quote it by road miles.
// A job is only worth posting if some vehicle you can already buy could run it.
const fitsUnlocked = j => j.air ? PLANES.some(p=>planeOk(p) && p.leg>=j.miles && p.cap>=j.weight) : j.rail ? LOCOS.some(l=>l.lvl<=level() && l.leg>=j.miles) : TYPES.some(t=>t.lvl<=level() && t.cargo.includes(j.cargo) && t.cap>=j.weight && t.leg>=j.miles);
function routeJob(j){
  if(j.routed || j.routing) return;
  if(j.air){ j.path = gcPath(j.from, j.to); j.miles = Math.max(1, Math.round(hav(j.from, j.to))); j.pay = jobPay(j); j.routed = true; return; }
  j.routing = true;
  (j.rail ? getRailRoute : getRoute)(j.from, j.to).then(r=>{
    j.routing = false;
    if(!S || !S.jobs.includes(j)) return;
    j.routed = true;
    if(r){
      j.miles = Math.max(1, Math.round(r.mi)); j.sec = r.sec; j.path = r.path; j.pay = jobPay(j);
      if(!j.rail && r.locs && r.locs.length===2){ Object.assign(j.from, r.locs[0]); Object.assign(j.to, r.locs[1]); }
      if(r.names){ j.from.street = r.names[0]; j.to.street = r.names[1]; }
      const m = jobMarkers.get(j.id); if(m) m.setLatLng([j.from.lat, j.from.lon]);
      // Real road miles can run past what any unlocked vehicle can reach; swap it for a new job.
      if(!fitsUnlocked(j)){ S.jobs = S.jobs.filter(x=>x!==j); if(selectedJob===j.id) selectedJob=null; (j.air ? spawnAirJob : j.rail ? spawnRailJob : spawnJob)(pick(S.bases)); drawJobs(); renderPanel(); return; }
    }
    if(j.id===selectedJob) drawSelection();
    if(tab==="jobs"||tab==="rail") renderPanel();
  });
}

/* ---------------- Eligibility & timing ---------------- */
function freeDrivers(lic, cargo){
  const idle = S.drivers.filter(d=>!d.busy);
  if(lic==="pilot"||lic==="pilot2"){ const p = idle.filter(d=>d.kind==="pilot"); const n = lic==="pilot2" ? 2 : 1; return p.length>=n ? p.slice(0,n) : null; }
  if(lic==="eng"){ const e = idle.filter(d=>d.kind==="eng"); return e[0] ? [e[0]] : null; }
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
  if(j.rail) return (0.5 + 0.5*j.units)*MIN;
  if(j.air) return Math.min(8, 2 + j.weight/20000)*MIN;
  const m = j.cargo==="vehicles" ? LOAD_BASE_MIN + LOAD_MIN_PER_CAR*j.weight : LOAD_BASE_MIN + LOAD_MIN_PER_1000LB*j.weight/1000;
  return m*MIN;
}
/* ---------------- Trips with several loads ----------------
   A trip is an ordered run of drives and stops (pickups and drop-offs) that ends back at the hub.
   While a vehicle has room, more loads can be added; the stops not yet reached are re-planned. */
const MAX_LOADS = 8;
const tripOf = v => S.trips.find(tr=>tr.v===v.id);
const llPt = ll => ({lat:ll[0], lon:ll[1]});
const openLoads = tr => tr ? tr.loads.filter(l=>!l.delivered) : [];
const usedRoom = tr => openLoads(tr).reduce((n,l)=>n+l.job.weight, 0);
const roomStr = (t, n) => t.cars ? `${n} of ${t.cap} cars` : `${n.toLocaleString("en-US")} of ${t.cap.toLocaleString("en-US")} lb`;
// Trains: 5 min + 1 min per 25 track miles loaded, twice as fast empty.
// Planes: 3 min + 1 min per 100 miles loaded, twice as fast empty.
const legMs = (mi, loaded, type) => type.mode==="plane" ? (loaded ? (3 + mi/100)*MIN : Math.max(0.5*MIN, mi/200*MIN)) : type.mode==="train" ? (loaded ? (5 + mi/25)*MIN : Math.max(0.5*MIN, mi/50*MIN)) : loaded ? driveMs(mi, type.slow, 1) : Math.max(0.2*MIN, mi/30/2*MIN);

// Builds the stops and drives for a vehicle from time t, optionally with more jobs (one job or a list). Changes nothing.
function planRoute(v, tr, extra, t){
  const type = TYPE[v.type], hub = homePt(v);
  const loads = (tr ? tr.loads.map(l=>({...l})) : []);
  const extras = !extra ? [] : Array.isArray(extra) ? extra : [extra];
  extras.forEach(x=>loads.push({job:x, picked:false, delivered:false}));
  extra = extras[0];
  let pos = hub, t0 = t, kept = [];
  if(tr){
    const s = segAt(tr, t);
    if(s.kind==="stop" && t < s.t1){ kept = [s]; pos = llPt(s.path[0]); t0 = s.t1;
      const ld = loads.find(l=>l.job.id===s.jid); if(ld){ if(s.sk==="pick") ld.picked = true; else ld.delivered = true; } }
    else pos = llPt(posOf(tr, t).ll);
  }
  const pending = [];
  loads.forEach(l=>{ if(!l.picked) pending.push({sk:"pick", l}); if(!l.delivered) pending.push({sk:"drop", l}); });
  const onboard = new Set(loads.filter(l=>l.picked && !l.delivered).map(l=>l.job.id));
  const picked = new Set(loads.filter(l=>l.picked).map(l=>l.job.id));
  const segs = [...kept]; let cur = pos, tt = t0, prev = null, deadToExtra = null;
  while(pending.length){
    const avail = pending.filter(p=>p.sk==="pick" || picked.has(p.l.job.id));
    avail.sort((a,b)=>estMi(cur, a.sk==="pick"?a.l.job.from:a.l.job.to) - estMi(cur, b.sk==="pick"?b.l.job.from:b.l.job.to));
    const nx = avail[0]; pending.splice(pending.indexOf(nx),1);
    const j = nx.l.job, pt = nx.sk==="pick" ? j.from : j.to;
    const direct = prev && prev.sk==="pick" && nx.sk==="drop" && prev.l===nx.l;   // straight from its own pickup
    const plane = type.mode==="plane", mi = direct ? j.miles : plane ? hav(cur, pt) : estMi(cur, pt);
    if(mi >= 0.05){
      const loaded = onboard.size>0, ms = legMs(mi, loaded, type);
      segs.push({kind:"drive", ph:loaded?"haul":"dead", path: direct && j.path ? j.path : plane ? gcPath(cur, pt) : straight(cur, pt), t0:tt, t1:tt+ms, mi, next:{sk:nx.sk, jid:j.id}});
      tt += ms;
    }
    if(extra && nx.sk==="pick" && j.id===extra.id) deadToExtra = direct ? 0 : mi;
    const hm = handleMs(j);
    segs.push({kind:"stop", ph:"load", sk:nx.sk, jid:j.id, path:[[pt.lat,pt.lon]], t0:tt, t1:tt+hm});
    tt += hm;
    if(nx.sk==="pick"){ picked.add(j.id); onboard.add(j.id); } else onboard.delete(j.id);
    cur = pt; prev = nx;
  }
  const back = type.mode==="plane" ? hav(cur, hub) : estMi(cur, hub);
  if(back >= 0.05){ const ms = legMs(back, false, type); segs.push({kind:"drive", ph:"ret", path:type.mode==="plane" ? gcPath(cur, hub) : straight(cur, hub), t0:tt, t1:tt+ms, mi:back}); tt += ms; }
  else segs.push({kind:"drive", ph:"ret", path:[[hub.lat,hub.lon]], t0:tt, t1:tt+0.2*MIN, mi:0}), tt += 0.2*MIN;
  const dropOf = id => segs.find(s=>s.kind==="stop" && s.sk==="drop" && s.jid===id);
  return {segs, endAt:tt, loads, dropOf, deadToExtra, pos};
}
// A short summary of what sending this vehicle on job j would look like (used by the dispatch card).
function planTrip(v, j){
  const tr = tripOf(v), r = planRoute(v, tr, j, S.clock), now = S.clock;
  const segs = r.segs, pk = segs.find(s=>s.kind==="stop" && s.sk==="pick" && s.jid===j.id), dr = r.dropOf(j.id);
  const haul = segs.find(s=>s.kind==="drive" && s.next?.jid===j.id && s.next.sk==="drop");
  return {adding:!!tr, dead:Math.round(r.deadToExtra||0), tDead: pk ? Math.max(0, pk.t0-now) : 0,
    ld: pk ? pk.t1-pk.t0 : 0, lu: dr ? dr.t1-dr.t0 : 0, tHaul: haul ? haul.t1-haul.t0 : 0,
    deliverIn: dr ? dr.t1-now : 0, total: r.endAt-now, extra: tr ? r.endAt - tr.endAt : 0,
    loads: openLoads(tr).length + 1, cut:0, bonus:1};
}
function trainFor(v, j){
  const t = TYPE[v.type];
  if(!j.rail) return {ok:false, why:"Trains run rail jobs only"};
  const slots = trainSlots(v, j.carType), carN = RAILCARS[j.carType].n.toLowerCase();
  if(!slots) return {ok:false, why:`Needs ${j.carType==="well"?"a container well car":carN+"s"}`};
  if(j.miles > t.leg) return {ok:false, why:`Over ${t.leg} mi range`};
  if(j.units > slots) return {ok:false, why:`Needs ${j.units} ${carN}s (has ${slots})`};
  const tr = tripOf(v); let ds, from;
  if(tr){
    const used = railUsed(tr, j.carType);
    if(used + j.units > slots) return {ok:false, why:`Not enough room (${used} of ${slots} used)`, busy:true};
    if(openLoads(tr).length >= MAX_LOADS) return {ok:false, why:`Already carrying ${MAX_LOADS} loads`, busy:true};
    ds = tr.drivers.map(id=>S.drivers.find(d=>d.id===id)).filter(Boolean); from = llPt(posOf(tr, S.clock).ll);
  } else { ds = freeDrivers("eng"); from = yardPt(v.yard); }
  if(estMi(from, j.from) > MAX_RAIL_DEADHEAD) return {ok:false, why:`Over ${MAX_RAIL_DEADHEAD} mi from the pickup yard`};
  if(!ds) return {ok:false, why:"No free engineer", nodriver:true};
  return {ok:true, drivers:ds, plan:planTrip(v,j)};
}
function planeFor(v, j){
  const t = TYPE[v.type];
  if(!j.air) return {ok:false, why:"Planes fly air cargo jobs only"};
  for(const st of [j.from, j.to]) if(AIRPORT[st.airport].size < t.minSize) return {ok:false, why:`Runway too small at ${st.airport}`};
  if(j.weight > t.cap) return {ok:false, why:"Too heavy"};
  if(j.miles > t.leg) return {ok:false, why:`Over ${t.leg.toLocaleString("en-US")} mi range`};
  const tr = tripOf(v); let ds, from;
  if(tr){
    const used = usedRoom(tr);
    if(used + j.weight > t.cap) return {ok:false, why:`Not enough room (${roomStr(t, used)} used)`, busy:true};
    if(openLoads(tr).length >= MAX_LOADS) return {ok:false, why:`Already carrying ${MAX_LOADS} loads`, busy:true};
    ds = tr.drivers.map(id=>S.drivers.find(d=>d.id===id)).filter(Boolean); from = llPt(posOf(tr, S.clock).ll);
  } else { ds = freeDrivers(t.lic); from = airportPt(v.airport); }
  if(hav(from, j.from) > MAX_AIR_DEADHEAD) return {ok:false, why:`Over ${MAX_AIR_DEADHEAD.toLocaleString("en-US")} mi from the pickup airport`};
  if(!ds) return {ok:false, why: t.lic==="pilot2" ? "Needs 2 free pilots" : "No free pilot", nodriver:true};
  return {ok:true, drivers:ds, plan:planTrip(v,j)};
}
function vehicleFor(v, j){
  if(isTrain(v)) return trainFor(v, j);
  if(isPlane(v)) return planeFor(v, j);
  if(j.rail) return {ok:false, why:"Needs a train"};
  if(j.air) return {ok:false, why:"Needs a plane"};
  const t = TYPE[v.type];
  if(!t.cargo.includes(j.cargo)) return {ok:false, why:"Wrong trailer"};
  if(j.weight > t.cap) return {ok:false, why:"Too heavy"};
  if(j.miles > t.leg) return {ok:false, why:`Over ${t.leg} mi range`};
  const tr = tripOf(v);
  let ds, from;
  if(tr){
    const used = usedRoom(tr);
    if(used + j.weight > t.cap) return {ok:false, why: used>=t.cap ? `Full (${roomStr(t, used)})` : `Not enough room (${roomStr(t, used)} used)`, busy:true};
    if(openLoads(tr).length >= MAX_LOADS) return {ok:false, why:`Already carrying ${MAX_LOADS} loads`, busy:true};
    const crew = tr.drivers.map(id=>S.drivers.find(d=>d.id===id)).filter(Boolean);
    ds = (t.lic==="std" || crew.every(d=>d.kind==="cdl" && (j.cargo!=="hazmat"||d.hazmat))) ? crew : null;
    from = llPt(posOf(tr, S.clock).ll);
  } else { ds = freeDrivers(t.lic, j.cargo); from = homePt(v); }
  if(hav(basePt(baseById(v.base)), j.from) > rangeMi()) return {ok:false, why:`Pickup is over ${rangeMi()} mi from ${baseName(baseById(v.base))}`};
  if(!ds) return {ok:false, why: t.lic==="std"?"No free driver": j.cargo==="hazmat"?"Needs hazmat driver": t.lic==="cdl2"?"Needs 2 free CDL drivers":"No free CDL driver", nodriver:true};
  return {ok:true, drivers:ds, plan:planTrip(v,j)};
}
function jobStatus(j){
  const opts = S.vehicles.map(v=>({v, r:vehicleFor(v,j)}));
  const ok = opts.filter(o=>o.r.ok).sort((a,b)=>a.r.plan.deliverIn-b.r.plan.deliverIn);
  if(ok.length) return {can:true, opts:ok};
  const capable = opts.filter(o=>o.r.busy||o.r.nodriver);
  // Say why idle vehicles of the right kind can't take it (no driver, out of range, wrong trailer…).
  const mode = j.air ? "plane" : j.rail ? "train" : "truck";
  const idle = opts.filter(o=>!tripOf(o.v) && (TYPE[o.v.type].mode||"truck")===mode).slice(0, 3).map(o=>`${o.v.n}: ${o.r.why}`);
  if(capable.length) return {can:false, soon:true, why: (capable.some(o=>o.r.busy) ? "Your matching vehicles are busy" : capable[0].r.why) + (idle.length && capable.some(o=>o.r.busy) ? ". Idle: " + idle.join("; ") : "")};
  if(j.air){ const p = PLANES.find(p=>p.leg>=j.miles && p.cap>=j.weight && AIRPORT[j.from.airport].size>=p.minSize && AIRPORT[j.to.airport].size>=p.minSize);
    return {can:false, why: p ? `Needs a ${p.n.toLowerCase()} or bigger${p.lvl>level()?` · level ${p.lvl}`:""}` : "No aircraft can fly this"}; }
  if(j.rail){ const lo = LOCOS.filter(l=>l.leg>=j.miles)[0], carN = RAILCARS[j.carType].n.toLowerCase();
    return {can:false, why:`Needs a train with ${j.carType==="well"?"a container well car":`${j.units} ${carN}${j.units>1?"s":""}`}${lo&&lo.lvl>level()?` · level ${lo.lvl}`:""}`}; }
  const fit = TYPES.filter(t=>t.cargo.includes(j.cargo)&&t.cap>=j.weight&&t.leg>=j.miles).sort((a,b)=>a.price-b.price)[0];
  return {can:false, why: fit?`Needs ${fit.n}${fit.lvl>level()?` · level ${fit.lvl}`:""}`:"No vehicle can take this"};
}

/* ---------------- Dispatch & simulation ---------------- */
// Keep loads still on the trip plus only the most recently delivered one.
function pruneLoads(tr){
  const done = tr.loads.filter(l=>l.delivered);
  if(done.length <= 1) return;
  const last = done.reduce((a,b)=>(b.doneAt||0) >= (a.doneAt||0) ? b : a);
  tr.loads = tr.loads.filter(l=>!l.delivered || l===last);
}
function addMiles(v, mi){ if(v && mi) v.miles = (v.miles||0) + mi; }
function dispatch(j, v, viaDispatcher){
  const r = vehicleFor(v,j); if(!r.ok) return false;
  let tr = tripOf(v);
  const rp = planRoute(v, tr, j, S.clock);
  if(tr){
    // credit the part of the current drive already covered before re-planning the rest
    const s = segAt(tr, S.clock);
    if(s.kind==="drive" && !s.done && S.clock > s.t0) addMiles(v, (s.mi||0) * Math.min(1, (S.clock-s.t0)/((s.t1-s.t0)||1)));
  } else {
    tr = {id:nid("t"), v:v.id, drivers:r.drivers.map(x=>x.id), loads:[], startAt:S.clock};
    S.trips.push(tr); r.drivers.forEach(x=>x.busy=true);
  }
  tr.loads.push({job:{...j}, picked:false, delivered:false, cut: viaDispatcher?0.05:0});
  tr.segs = rp.segs; tr.endAt = rp.endAt;
  v.busy = true;
  recordDispatch(viaDispatcher);
  S.jobs = S.jobs.filter(x=>x.id!==j.id);
  if(!simulating) roadTrip(tr);
  return tr;
}
// Route lookups can fail now and then (busy free servers). Every 15 seconds, try again for anything
// still drawn as a straight dashed placeholder: trip legs in progress and jobs on the board.
function retryRoutes(){
  if(!S || simulating) return;
  S.trips.forEach(roadTrip);
  for(const j of S.jobs){
    if(j.air || j.path || j.routing || (j.routeTries||0) >= 6) continue;
    j.routeTries = (j.routeTries||0) + 1; j.routed = false; routeJob(j);
  }
}
// Swap straight placeholder lines for real road geometry (timing stays as planned).
function roadTrip(tr){
  for(const s of tr.segs){
    if(s.kind!=="drive" || s.done || s.path.length!==2 || S.clock > s.t1) continue;
    const a = llPt(s.path[0]), b = llPt(s.path[1]);
    if(estMi(a,b)<0.3) continue;
    const tv = S.vehicles.find(x=>x.id===tr.v);
    (tv && isTrain(tv) ? getRailRoute : getRoute)(a,b).then(r=>{ if(r && S && S.trips.includes(tr) && tr.segs.includes(s)){ s.path = r.path; s.cum = null; tripLines.get(tr.id)?.setLatLngs([]); } });
  }
}
let awayLog = null, simulating = false, simT = 0;
const simWhen = () => awayLog ? awayLog.start + simT : Date.now();
function deliverLoad(tr, ld){
  ld.delivered = true;
  const j = ld.job, gross = j.pay, net = gross*(1-(ld.cut||0))*S.payMult*(1+alPerk());
  const before = level();
  S.cash += net; S.earned += net; S.xp += jobXp(j); S.jobsDone++;
  recordDelivery({job:j, haulMi:j.miles}, net);
  contractDelivered(j);
  alDelivered(j);
  const v = S.vehicles.find(x=>x.id===tr.v); if(v) v.jobs++;
  tr.drivers.forEach(id=>{const d=S.drivers.find(x=>x.id===id); if(d){d.jobs++;}});
  const what = j.event ? esc(j.item.toLowerCase()) : esc(CARGO[j.cargo].n.toLowerCase());
  if(awayLog){awayLog.jobs++; awayLog.net+=net; logEvent(`<b>${esc(v?v.n:"Truck")}</b> delivered ${what} to ${esc(j.to.name||cityName(j.to.c))} <span class="num">+${money(net)}</span> (while you were away)`, simWhen());}
  else toast(`<b>${esc(v?v.n:"Truck")}</b> delivered ${what} to ${esc(j.to.name||j.to.biz)}, ${esc(cityName(j.to.c))} <span class="num">+${money(net)}</span>`);
  const after = level();
  if(after>before && !simulating) drawYards();
  for(let L=before+1;L<=after;L++){ if(awayLog){ awayLog.levels.push(L); logEvent(`<b>Level ${L}</b>${UNLOCKS[L]?` · unlocked ${esc(UNLOCKS[L])}`:""}`, simWhen()); } else toast(`<b>Level ${L}</b>${UNLOCKS[L]?` · unlocked ${esc(UNLOCKS[L])}`:""}`, 6000); }
}
function logic(){
  let changed = false;
  for(const tr of S.trips){
    const v = S.vehicles.find(x=>x.id===tr.v);
    for(const sg of tr.segs){
      if(sg.done || S.clock < sg.t1) continue;
      sg.done = true; changed = true;
      if(sg.kind==="drive"){ addMiles(v, sg.mi); continue; }
      const ld = tr.loads.find(l=>l.job.id===sg.jid); if(!ld) continue;
      if(sg.sk==="pick" && !ld.picked){
        ld.picked = true;
        if(!awayLog) toast(`<b>${esc(v?v.n:"Truck")}</b> picked up ${esc(weightStr(ld.job))} of ${esc(ld.job.event?ld.job.item.toLowerCase():CARGO[ld.job.cargo].n.toLowerCase())} at ${esc(ld.job.from.name||ld.job.from.biz)}`);
      } else if(sg.sk==="drop" && !ld.delivered){ deliverLoad(tr, ld); ld.doneAt = sg.t1; }
    }
    pruneLoads(tr);
  }
  const done = S.trips.filter(tr=>S.clock>=tr.endAt);
  if(done.length){
    done.forEach(tr=>{ const v=S.vehicles.find(x=>x.id===tr.v); if(v) v.busy=false; tr.drivers.forEach(id=>{const d=S.drivers.find(x=>x.id===id); if(d)d.busy=false;}); });
    S.trips = S.trips.filter(tr=>S.clock<tr.endAt); changed = true;
  }
  const n0 = S.jobs.length;
  S.jobs = S.jobs.filter(j=>!j.expires || j.expires>S.clock);
  if(selectedJob && !S.jobs.find(j=>j.id===selectedJob)) selectedJob = null;
  if(S.jobs.length!==n0) changed = true;
  // Mission Chief style: a new job every minute on each board, however many vehicles you own.
  // Each board holds up to JOB_BOARD_MAX jobs. When a board is full, the oldest job your fleet can't
  // take is swapped for a new one, so the board stays fresh. Jobs you can run are never removed.
  if(contractTick()) changed = true;
  for(const [kind, lvl, timer, spawn] of [["rail", RAIL_LVL, "nextRailAt", spawnRailJob], ["air", airOpen() ? 1 : AIR_LVL, "nextAirAt", spawnAirJob], ["truck", 1, "nextJobAt", spawnJob]]){
    if(level() < lvl) continue;
    const mine = S.jobs.filter(j=>jobKind(j)===kind);
    if(mine.length && S.clock < (S[timer]||0)) continue;
    if(mine.length >= JOB_BOARD_MAX){
      const stale = mine.filter(j=>j.id!==selectedJob && !j.contract && !jobStatus(j).can).sort((x,y)=>(x.posted||0)-(y.posted||0))[0];
      if(!stale){ S[timer] = S.clock + JOB_EVERY_MS; continue; }
      S.jobs = S.jobs.filter(j=>j!==stale);
    }
    const nj = spawn(pick(S.bases)); S[timer] = S.clock + (mine.length<=1 && kind!=="truck" ? 5000 : JOB_EVERY_MS); changed = true;
    if(nj && !simulating && !awayLog){
      if(jobStatus(nj).can) chime(kind);
      if(kind==="rail") toast(`New rail job: <b>${esc(nj.from.name)}</b> to ${esc(nj.to.name)} · <span class="num">${money(nj.pay)}</span>`, 3500);
      else if(kind==="air") toast(`New air cargo job: <b>${esc(nj.from.airport)}</b> to <b>${esc(nj.to.airport)}</b> · <span class="num">${money(nj.pay)}</span>`, 3500);
      else toast(`New ${nj.event?esc(nj.item.toLowerCase())+" ":""}job: <b>${esc(nj.from.name)}</b> in ${esc(cityName(nj.from.c))} · <span class="num">${money(nj.pay)}</span>`, 3000);
    }
  }
  for(const b of S.bases){
    if(!b.dispatcher) continue;
    for(const v of S.vehicles.filter(x=>x.base===b.id && (!tripOf(x) || !openLoads(tripOf(x)).length))){
      const best = S.jobs.filter(j=>vehicleFor(v,j).ok).sort((a,c)=>c.pay-a.pay)[0];
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

/* Cross-City Transit — daily login rewards, daily tasks and seasonal events.
   Loaded before game.js. Dates use the player's local calendar day. */

/* ---------------- Settings ---------------- */
const LOGIN_REWARDS = [1000, 2000, 3000, 4000, 5000, 6000, 10000];   // day 1..7, then the week starts again
const ALL_TASKS_BONUS = 10000;    // claim after finishing every daily task (flat, does not grow with level)
const EVENT_PAY_BONUS = 1.25;     // event loads pay 25% more
const EVENT_SHARE = 0.35;         // share of new jobs that are event loads while an event runs

/* Seasonal events repeat every year. Each one works out its own dates for a given year,
   so holidays that move (Thanksgiving is the 4th Thursday of November) line up every year. */
const ymd = (y, m, d) => new Date(y, m-1, d);
const fixedDates = (sm, sd, em, ed) => y => [ymd(y, sm, sd), ymd(em < sm ? y+1 : y, em, ed)];   // end may fall in the next year
const nthWeekday = (y, m, wd, n) => { const first = ymd(y, m, 1).getDay(); return ymd(y, m, 1 + (wd - first + 7) % 7 + 7*(n-1)); };
const thanksgiving = y => nthWeekday(y, 11, 4, 4);
const MS = [{n:5, reward:2500}, {n:15, reward:7500}, {n:30, reward:20000}, {n:50, reward:40000}];
const EVENTS = [
  {id:"newyear", n:"New Year Restock", dates:fixedDates(12,31, 1,7), color:"#2f6fb5",
   blurb:"Stores clear out the holidays and restock shelves for the new year.",
   items:[
     {item:"Party supplies",   from:"Party Supply Warehouse", to:["Party Store","Event Hall","Grocery Store"]},
     {item:"Returned goods",   from:"Department Store",       to:["Returns Center","Liquidation Outlet"]},
     {item:"Fitness gear",     from:"Sporting Goods Supplier",to:["Gym","Sporting Goods Store"]},
     {item:"New-year inventory",from:"Distribution Center",   to:["Department Store","Grocery Store"]}
   ], milestones:MS},
  {id:"valentines", n:"Valentine's Rush", dates:fixedDates(2,7, 2,14), color:"#d23c6e",
   blurb:"Flowers, chocolate and gifts have to land before February 14.",
   items:[
     {item:"Roses",            from:"Flower Farm",      to:["Florist","Grocery Store"]},
     {item:"Chocolates",       from:"Candy Factory",    to:["Gift Shop","Grocery Store","Florist"]},
     {item:"Greeting cards",   from:"Card Printer",     to:["Gift Shop","Pharmacy"]},
     {item:"Restaurant stock", from:"Food Distributor", to:["Steakhouse","Bistro"]}
   ], milestones:MS},
  {id:"spring", n:"Spring Planting", dates:fixedDates(3,15, 4,5), color:"#4a9a3c",
   blurb:"Farms and garden centers stock up for the growing season.",
   items:[
     {item:"Seed",             from:"Seed Company",     to:["Farm Supply Store","Garden Center"], heavy:true},
     {item:"Fertilizer",       from:"Fertilizer Plant", to:["Farm Supply Store","Farm"], heavy:true},
     {item:"Nursery plants",   from:"Plant Nursery",    to:["Garden Center","Hardware Store"]},
     {item:"Mulch",            from:"Mulch Yard",       to:["Garden Center","Landscaper"], heavy:true}
   ], milestones:MS},
  {id:"summer", n:"Summer Kickoff", dates:fixedDates(5,20, 6,5), color:"#e08a1e",
   blurb:"Grills, pool supplies and camping gear for the start of summer.",
   items:[
     {item:"Grills",           from:"Grill Maker",       to:["Hardware Store","Department Store"]},
     {item:"Pool supplies",    from:"Pool Supply Warehouse", to:["Pool Store","Community Pool"]},
     {item:"Camping gear",     from:"Outdoor Gear Supplier", to:["Sporting Goods Store","Campground"]},
     {item:"Charcoal",         from:"Charcoal Plant",    to:["Grocery Store","Hardware Store"], heavy:true}
   ], milestones:MS},
  {id:"july4", n:"Fourth of July", dates:fixedDates(6,27, 7,5), color:"#c8372a",
   blurb:"Fireworks shows, cookouts and parades all need supplies.",
   items:[
     {item:"Flags and bunting",from:"Flag Maker",       to:["Party Store","Town Hall","Parade Route"]},
     {item:"Cookout supplies", from:"Food Distributor", to:["Grocery Store","Park Pavilion"]},
     {item:"Bleachers",        from:"Event Rental Co.", to:["Parade Route","Fairgrounds"], heavy:true},
     {item:"Ice",              from:"Ice Plant",        to:["Grocery Store","Fairgrounds"], heavy:true}
   ], milestones:MS},
  {id:"school", n:"Back to School", dates:fixedDates(8,1, 8,20), color:"#2c8a8a",
   blurb:"Schools and stores need supplies before the first bell.",
   items:[
     {item:"School supplies",  from:"Office Supply Warehouse", to:["School","Department Store"]},
     {item:"Desks and chairs", from:"Furniture Maker",  to:["School","College"]},
     {item:"Textbooks",        from:"Book Publisher",   to:["School","College Bookstore"]},
     {item:"Laptops",          from:"Electronics Distributor", to:["School","Electronics Store"]}
   ], milestones:MS},
  {id:"harvest", n:"Harvest Season", dates:fixedDates(9,15, 10,10), color:"#a8741a",
   blurb:"Orchards and farms bring in the harvest.",
   items:[
     {item:"Apples",           from:"Orchard",          to:["Grocery Store","Farmers Market","Cider Mill"], heavy:true},
     {item:"Corn",             from:"Farm",             to:["Grain Elevator","Farmers Market"], heavy:true},
     {item:"Squash and gourds",from:"Farm",             to:["Grocery Store","Farmers Market"]},
     {item:"Canning jars",     from:"Glass Works",      to:["Hardware Store","Grocery Store"]}
   ], milestones:MS},
  {id:"halloween", n:"Halloween Haul", dates:fixedDates(10,20, 11,1), color:"#7b3fb5",
   blurb:"Pumpkin patches, candy makers and costume shops need loads delivered before the big night.",
   items:[
     {item:"Pumpkins",           from:"Pumpkin Patch",       to:["Grocery Store","Fall Festival","Farmers Market"], heavy:true},
     {item:"Halloween candy",    from:"Candy Factory",       to:["Grocery Store","Party Store","Trunk-or-Treat Lot"]},
     {item:"Costumes",           from:"Costume Warehouse",   to:["Party Store","Costume Shop","Theater"]},
     {item:"Decorations",        from:"Decoration Supplier", to:["Haunted House","Party Store","Fall Festival"]},
     {item:"Hay bales",          from:"Hay Farm",            to:["Corn Maze","Fall Festival","Haunted House"], heavy:true},
     {item:"Fog machines and props", from:"Stage Supply Co.", to:["Haunted House","Theater","Corn Maze"]},
     {item:"Apple cider",        from:"Cider Mill",          to:["Fall Festival","Grocery Store","Farmers Market"]}
   ], milestones:MS},
  // The week before Thanksgiving through Thanksgiving Day; the dates move every year.
  {id:"thanksgiving", n:"Thanksgiving Delivery", dates:y=>{ const t = thanksgiving(y); return [ymd(y, 11, t.getDate()-8), t]; }, color:"#b5562a",
   blurb:"Turkeys, pies and travel supplies have to arrive before Thanksgiving Day.",
   items:[
     {item:"Turkeys",          from:"Turkey Farm",      to:["Grocery Store","Food Bank","Butcher Shop"], heavy:true},
     {item:"Pies",             from:"Bakery",           to:["Grocery Store","Restaurant","Food Bank"]},
     {item:"Cranberries",      from:"Cranberry Bog",    to:["Grocery Store","Farmers Market"]},
     {item:"Folding tables",   from:"Event Rental Co.", to:["Community Center","Church Hall"]}
   ], milestones:MS},
  {id:"holiday", n:"Holiday Shipping Rush", dates:fixedDates(12,1, 12,24), color:"#1f7a4a",
   blurb:"The busiest shipping weeks of the year. Get the gifts there before Christmas Eve.",
   items:[
     {item:"Gifts",            from:"Distribution Center", to:["Department Store","Toy Store","Electronics Store"]},
     {item:"Christmas trees",  from:"Tree Farm",        to:["Tree Lot","Garden Center","Hardware Store"], heavy:true},
     {item:"Toys",             from:"Toy Maker",        to:["Toy Store","Department Store"]},
     {item:"Holiday parcels",  from:"Parcel Hub",       to:["Post Office","Shipping Store"]}
   ], milestones:MS}
];
// Business names for event stops; names already defined for regular freight stay as they are.
for(const [k, v] of Object.entries({
  "Pumpkin Patch":["Pumpkin Patch","Pumpkin Farm"], "Candy Factory":["Candy Co.","Confections","Sweets Factory"],
  "Costume Warehouse":["Costume Warehouse","Costume Supply"], "Decoration Supplier":["Seasonal Decor","Party Supply"],
  "Hay Farm":["Hay Farm","Hay & Feed"], "Cider Mill":["Cider Mill","Orchard Cider"],
  "Grocery Store":["Market","Grocery","Fresh Market"], "Fall Festival":["Fall Festival","Harvest Fest"],
  "Farmers Market":["Farmers Market"], "Party Store":["Party Store","Party Outlet"],
  "Trunk-or-Treat Lot":["Church Trunk-or-Treat","Community Trunk-or-Treat"], "Costume Shop":["Costume Shop","Costumes"],
  "Theater":["Playhouse","Community Theater"], "Haunted House":["Haunted House","Scream Park","Haunted Manor"],
  "Corn Maze":["Corn Maze","Maze & Hayride"],
  "Party Supply Warehouse":["Party Supply","Celebration Wholesale"], "Event Hall":["Event Hall","Banquet Hall"],
  "Department Store":["Department Store","Mercantile"], "Returns Center":["Returns Center","Reverse Logistics"],
  "Liquidation Outlet":["Liquidators","Outlet"], "Sporting Goods Supplier":["Sports Supply","Athletic Wholesale"],
  "Gym":["Fitness","Gym","Athletic Club"], "Sporting Goods Store":["Sporting Goods","Outfitters"],
  "Distribution Center":["Distribution Center","Fulfillment Center"],
  "Flower Farm":["Flower Farm","Rose Growers"], "Florist":["Florist","Flowers","Floral"], "Gift Shop":["Gifts","Gift Shop"],
  "Card Printer":["Card Co.","Printing"], "Pharmacy":["Pharmacy","Drug Store"], "Food Distributor":["Foodservice","Food Distributors"],
  "Steakhouse":["Steakhouse","Chophouse"], "Bistro":["Bistro","Kitchen"],
  "Seed Company":["Seed Co.","Seeds"], "Farm Supply Store":["Farm Supply","Feed & Seed"], "Garden Center":["Garden Center","Nursery & Garden"],
  "Fertilizer Plant":["Fertilizer","Ag Products"], "Farm":["Farms","Family Farm","Acres"], "Plant Nursery":["Nursery","Greenhouses"],
  "Hardware Store":["Hardware","Home & Hardware"], "Mulch Yard":["Mulch & Stone","Landscape Supply"], "Landscaper":["Landscaping","Lawn & Garden"],
  "Grill Maker":["Grill Works","Grills"], "Pool Supply Warehouse":["Pool Supply","Pool Wholesale"], "Pool Store":["Pools & Spas","Pool Store"],
  "Community Pool":["Community Pool","Aquatic Center"], "Outdoor Gear Supplier":["Outdoor Supply","Gear Wholesale"], "Campground":["Campground","RV Park"],
  "Charcoal Plant":["Charcoal Co.","Briquettes"], "Flag Maker":["Flag Co.","Banners & Flags"], "Town Hall":["Town Hall","City Hall"],
  "Parade Route":["Parade Committee","Main Street Parade"], "Park Pavilion":["Park Pavilion","City Park"], "Event Rental Co.":["Event Rentals","Party Rentals"],
  "Fairgrounds":["Fairgrounds","County Fair"], "Ice Plant":["Ice Co.","Ice House"],
  "Office Supply Warehouse":["Office Supply","School Supply Wholesale"], "School":["Elementary","High School","Middle School"],
  "Furniture Maker":["Furniture Co.","Woodworks"], "College":["College","University"], "Book Publisher":["Publishing","Press"],
  "College Bookstore":["Campus Bookstore","University Books"], "Electronics Distributor":["Electronics Supply","Tech Distribution"],
  "Electronics Store":["Electronics","Tech Store"], "Orchard":["Orchard","Apple Farm"], "Grain Elevator":["Grain Elevator","Co-op Elevator"],
  "Glass Works":["Glass Works","Glass Co."], "Turkey Farm":["Turkey Farm","Poultry Farm"], "Food Bank":["Food Bank","Community Pantry"],
  "Butcher Shop":["Butcher","Meat Market"], "Bakery":["Bakery","Pie Co."], "Restaurant":["Diner","Restaurant","Cafe"],
  "Cranberry Bog":["Cranberry Bog","Cranberry Farm"], "Community Center":["Community Center","Rec Center"], "Church Hall":["Church Hall","Fellowship Hall"],
  "Toy Store":["Toys","Toy Store"], "Tree Farm":["Tree Farm","Christmas Trees"], "Tree Lot":["Tree Lot","Christmas Tree Lot"],
  "Toy Maker":["Toy Co.","Toy Works"], "Parcel Hub":["Parcel Hub","Shipping Hub"], "Post Office":["Post Office"], "Shipping Store":["Ship & Pack","Shipping Store"]
})) if(!NAME_SUFFIX[k]) NAME_SUFFIX[k] = v;

/* ---------------- Dates ---------------- */
const dayKey = (d=new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const dayBefore = key => { const [y,m,d] = key.split("-").map(Number); return dayKey(new Date(y, m-1, d-1)); };
function msToMidnight(){ const n = new Date(), m = new Date(n.getFullYear(), n.getMonth(), n.getDate()+1); return m - n; }
// The event running on date d (if any), with its start and end dates for this run.
function eventRun(e, y){ const [st, en] = e.dates(y); return {...e, key:`${e.id}-${y}`, startD:st, endD:en}; }
function activeEvent(d=new Date()){
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()), y = d.getFullYear();
  for(const yy of [y, y-1]) for(const e of EVENTS){ const r = eventRun(e, yy); if(day >= r.startD && day <= r.endD) return r; }
  return null;
}
// Ends at the end of its last day.
function eventEndsIn(ev){ const e = ev.endD; return new Date(e.getFullYear(), e.getMonth(), e.getDate()+1) - new Date(); }
// The next few events that haven't started yet.
function upcomingEvents(n=3, d=new Date()){
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()), y = d.getFullYear();
  return [y, y+1].flatMap(yy=>EVENTS.map(e=>eventRun(e, yy))).filter(r=>r.startD > day).sort((a,b)=>a.startD-b.startD).slice(0, n);
}
const shortDate = d => d.toLocaleDateString("en-US", {month:"short", day:"numeric"});
function longDur(ms){ const h = Math.floor(ms/3600e3), d = Math.floor(h/24); return d>=1 ? `${d}d ${h%24}h` : `${h}h ${Math.floor(ms/60e3)%60}m`; }

/* ---------------- Daily tasks ---------------- */
const rewardScale = () => 1 + 0.2*(level()-1);
const roundReward = n => Math.round(n*rewardScale()/100)*100;
const TASK_POOL = [
  {kind:"weight",  make:()=>({target: level()<5?15000:level()<10?60000:200000, reward:1500}), label:t=>`Deliver ${t.target.toLocaleString("en-US")} lb of freight`},
  {kind:"miles",   make:()=>({target: level()<5?400:level()<10?1200:3000, reward:1500}),     label:t=>`Drive ${t.target.toLocaleString("en-US")} loaded miles`},
  {kind:"urgent",  make:()=>({target:2, reward:1500}),                                        label:t=>`Complete ${t.target} priority or express jobs`},
  {kind:"earn",    make:()=>({target: level()<5?2000:level()<10?15000:60000, reward:1000}),   label:t=>`Earn ${money(t.target)} from deliveries`},
  {kind:"long",    make:()=>({target:1, reward:2000}),                                        label:t=>`Complete a long haul of 200+ miles`},
  {kind:"dispatch",make:()=>({target:8, reward:1000}),                                        label:t=>`Dispatch ${t.target} jobs yourself`}
];
const TASK_LABEL = {
  deliveries: t=>`Complete ${t.target} deliveries`,
  event: t=>`Deliver ${t.target} ${activeEvent()?.n||"event"} loads`
};
function newDailyTasks(){
  const tasks = [5,10,20].map((n,i)=>({kind:"deliveries", target:n, reward:roundReward([1000,2500,6000][i])}));
  const pool = TASK_POOL.slice().sort(()=>Math.random()-0.5).slice(0,3);
  pool.forEach(p=>{ const m = p.make(); tasks.push({kind:p.kind, target:m.target, reward:roundReward(m.reward)}); });
  if(activeEvent()) tasks.push({kind:"event", target:3, reward:roundReward(2000)});
  return tasks.map((t,i)=>({...t, id:"t"+i, progress:0, claimed:false}));
}
function taskLabel(t){
  if(TASK_LABEL[t.kind]) return TASK_LABEL[t.kind](t);
  return TASK_POOL.find(p=>p.kind===t.kind)?.label(t) || t.kind;
}

/* Called every tick: rolls the day over and starts a new event when the date changes. */
function ensureDay(){
  if(!S) return false;
  const today = dayKey(); let changed = false;
  if(!S.daily || S.daily.date !== today){
    S.daily = {date: today, tasks: newDailyTasks(), bonusClaimed:false};
    changed = true;
  }
  S.login ||= {lastClaim:null, streak:0};
  S.events ||= {};
  const ev = activeEvent();
  if(ev && !S.events[ev.key]) { S.events[ev.key] = {count:0, claimed:[]}; changed = true; }
  if(changed && typeof renderPanel==="function" && tab==="tasks") renderPanel();
  return changed;
}

/* Called from deliver(): moves daily task and event progress forward. */
function recordDelivery(tr, net){
  ensureDay();
  const j = tr.job, add = (kind, n) => S.daily.tasks.forEach(t=>{ if(t.kind===kind && !t.claimed) t.progress = Math.min(t.target, t.progress + n); });
  add("deliveries", 1);
  add("weight", j.cargo==="vehicles" ? j.weight*4000 : j.weight);
  add("miles", tr.haulMi || j.miles || 0);
  if(j.urg!=="standard") add("urgent", 1);
  add("earn", Math.round(net));
  if((j.miles||0) >= 200) add("long", 1);
  if(j.event){
    add("event", 1);
    const e = S.events?.[j.event]; if(e) e.count++;
  }
}
function recordDispatch(viaDispatcher){ if(!viaDispatcher){ ensureDay(); S.daily.tasks.forEach(t=>{ if(t.kind==="dispatch" && !t.claimed) t.progress = Math.min(t.target, t.progress+1); }); } }

/* ---------------- Claiming ---------------- */
function loginStatus(){
  S.login ||= {lastClaim:null, streak:0};
  const today = dayKey(), claimedToday = S.login.lastClaim === today;
  const continuing = S.login.lastClaim === dayBefore(today);
  const nextStreak = claimedToday ? S.login.streak : continuing ? S.login.streak + 1 : 1;
  const dayIdx = (nextStreak - 1) % LOGIN_REWARDS.length;
  return {claimedToday, streak: nextStreak, dayIdx, amount: LOGIN_REWARDS[dayIdx]};
}
function claimLogin(){
  const st = loginStatus(); if(st.claimedToday) return 0;
  S.login.lastClaim = dayKey(); S.login.streak = st.streak;
  S.cash += st.amount;
  toast(`Daily login reward · day ${st.dayIdx+1}: <span class="num">+${money(st.amount)}</span>`, 5000);
  return st.amount;
}
function claimTask(id){
  const t = S.daily.tasks.find(x=>x.id===id); if(!t || t.claimed || t.progress < t.target) return;
  t.claimed = true; S.cash += t.reward;
  toast(`Task done: ${esc(taskLabel(t))} <span class="num">+${money(t.reward)}</span>`, 4500);
}
const allTasksDone = () => S.daily.tasks.every(t=>t.claimed);
function claimBonus(){
  if(S.daily.bonusClaimed || !allTasksDone()) return;
  const r = ALL_TASKS_BONUS; S.daily.bonusClaimed = true; S.cash += r;
  toast(`All daily tasks complete <span class="num">+${money(r)}</span>`, 5000);
}
function claimMilestone(n){
  const ev = activeEvent(); if(!ev) return; const e = S.events[ev.key], m = ev.milestones.find(x=>x.n===n);
  if(!e || !m || e.claimed.includes(n) || e.count < n) return;
  e.claimed.push(n); S.cash += m.reward;
  toast(`${esc(ev.n)}: ${n} loads delivered <span class="num">+${money(m.reward)}</span>`, 5000);
}
function claimableCount(){
  if(!S || !S.daily) return 0;
  let n = S.daily.tasks.filter(t=>!t.claimed && t.progress>=t.target).length;
  if(!S.daily.bonusClaimed && allTasksDone()) n++;
  if(!loginStatus().claimedToday) n++;
  const ev = activeEvent(); if(ev && S.events?.[ev.key]){ const e = S.events[ev.key]; n += ev.milestones.filter(m=>e.count>=m.n && !e.claimed.includes(m.n)).length; }
  return n;
}

/* ---------------- Event jobs ---------------- */
// Turns a freshly posted job into an event load when an event is running.
function maybeEventJob(j){
  if(j.rail || j.air) return j;
  const ev = activeEvent(); if(!ev || Math.random() > EVENT_SHARE) return j;
  if(!["general","parcels","pallets","furniture"].includes(j.cargo)) return j;
  const it = pick(ev.items);
  j.event = ev.key; j.item = it.item; j.evColor = ev.color;
  j.from.biz = it.from; j.from.name = bizName(it.from);
  j.to.biz = pick(it.to); j.to.name = bizName(j.to.biz);
  return j;
}
const jobPay = j => Math.round(payFor(j.miles, j.weight, j.cargo, j.urg) * (j.event ? EVENT_PAY_BONUS : 1) * (j.rail ? RAIL_PAY : 1) * (j.air ? AIR_PAY : 1));

/* ---------------- Contracts ----------------
   A contract is a deal with one shipper: deliver a set number of loads before the deadline and earn a
   completion bonus on top of each load's normal pay. Contract loads post on the truck board a few at a time. */
const CONTRACT_KINDS = {
  general:      {n:"General freight", cargo:"general",      lvl:1},
  furniture:    {n:"Furniture",       cargo:"furniture",    lvl:2},
  refrigerated: {n:"Refrigerated",    cargo:"refrigerated", lvl:5},
  event:        {n:"Event",           cargo:"general",      lvl:1}
};
const CONTRACT_SIZES = {
  small:  {n:"Small",  loads:5,  hours:1,   bonus:0.4, xp:1.5, lvl:1},
  medium: {n:"Medium", loads:12, hours:2.5, bonus:0.6, xp:2,   lvl:4},
  large:  {n:"Large",  loads:25, hours:6,   bonus:0.8, xp:2.5, lvl:8}
};
const CONTRACT_OFFERS = 4, CONTRACT_REFRESH = 3*3600e3, CONTRACT_ON_BOARD = 3;
const CONTRACTS_PER_DAY = 4;   // contracts you can accept each day (resets at midnight)
function contractsToday(){ const C = S.contracts; if(C.day !== dayKey()){ C.day = dayKey(); C.today = 0; } return C.today; }
const maxContracts = () => level()>=20 ? 3 : level()>=10 ? 2 : 1;
const contractTypes = c => TYPES.filter(t=>t.cargo.includes(CONTRACT_KINDS[c.kind].cargo) && !t.cars);
const canRunContract = c => trucks().some(v=>contractTypes(c).some(t=>t.id===v.type));
function ensureContracts(){
  S.contracts ||= {offers:[], active:[], done:0, failed:0, nextAt:0};
  const C = S.contracts;
  if(S.clock >= C.nextAt || !C.offers.length){
    C.offers = []; for(let i=0; i<CONTRACT_OFFERS*3 && C.offers.length<CONTRACT_OFFERS; i++){ const o = makeOffer(); if(o) C.offers.push(o); }
    C.nextAt = S.clock + CONTRACT_REFRESH;
  }
  return C;
}
function makeOffer(){
  const L = level(), ev = activeEvent();
  const kinds = Object.keys(CONTRACT_KINDS).filter(k=>CONTRACT_KINDS[k].lvl<=L && (k!=="event" || ev));
  const kind = ev && Math.random()<0.35 ? "event" : pick(kinds.filter(k=>k!=="event"));
  const sizes = Object.keys(CONTRACT_SIZES).filter(k=>CONTRACT_SIZES[k].lvl<=L), size = pick(sizes), sz = CONTRACT_SIZES[size];
  const cargo = CONTRACT_KINDS[kind].cargo;
  const types = TYPES.filter(t=>t.lvl<=L && t.cargo.includes(cargo) && !t.cars); if(!types.length) return null;
  const owned = types.filter(t=>trucks().some(v=>v.type===t.id));
  const t = (owned.length ? owned : types).sort((a,b)=>b.cap-a.cap)[0];   // sized to the biggest suitable truck you have
  const base = pick(S.bases), bp = basePt(base);
  const from = offsetPt(bp.lat, bp.lon, rnd(2, Math.min(25, rangeMi()*0.5)), rnd(0,6.28));
  const it = kind==="event" ? pick(ev.items) : null;
  from.biz = it ? it.from : pick(PRODUCERS[cargo]); from.c = nearestCity(from); from.name = bizName(from.biz); from.num = houseNo();
  const avgW = t.cap*0.55, avgMi = Math.min(120, t.leg*0.4);
  const per = payFor(avgMi, avgW, cargo, "standard") * (kind==="event" ? EVENT_PAY_BONUS : 1);
  return {id:nid("c"), kind, size, cargo, type:t.id, base:base.id, from, item:it?.item, to:it?.to, event: kind==="event" ? ev.key : null, evColor: ev?.color,
    loads:sz.loads, hours:sz.hours, bonus:Math.round(per*sz.loads*sz.bonus/100)*100, estPay:Math.round(per*sz.loads/100)*100};
}
function acceptContract(id){
  const C = ensureContracts(), o = C.offers.find(x=>x.id===id); if(!o || C.active.length>=maxContracts() || contractsToday()>=CONTRACTS_PER_DAY || !canRunContract(o)) return;
  C.today++;
  C.offers = C.offers.filter(x=>x!==o);
  Object.assign(o, {accepted:S.clock, deadline:S.clock + o.hours*3600e3, posted:0, delivered:0});
  C.active.push(o);
  for(let i=0;i<CONTRACT_ON_BOARD;i++) spawnContractJob(o);
  logEvent(`Accepted a contract with <b>${esc(o.from.name)}</b>: ${o.loads} ${esc(contractWhat(o))} loads in ${o.hours} h`);
  toast(`Contract accepted: <b>${esc(o.from.name)}</b>. Its loads are on the Truck jobs board.`, 4500);
}
const contractWhat = c => c.item ? c.item.toLowerCase() : CARGO[c.cargo].n.toLowerCase();
function spawnContractJob(c){
  const open = S.jobs.filter(j=>j.contract===c.id).length;
  if(c.posted - c.delivered - inTransit(c) >= CONTRACT_ON_BOARD || c.posted >= c.loads || open >= CONTRACT_ON_BOARD) return null;
  const t = TYPE[c.type], cargo = c.cargo;
  const from = {...c.from}, maxLeg = Math.min(t.leg*0.85, 250);
  const cand = CITIES.filter(x=>{ const m = hav(from,x)*1.2; return m>=15 && m<=maxLeg; });
  let to;
  if(cand.length && Math.random()<0.75){ const dc = pick(cand); to = {c:dc.i, ...offsetPt(dc.lat, dc.lon, rnd(0.5,4), rnd(0,6.28))}; }
  else { to = offsetPt(from.lat, from.lon, rnd(4,20), rnd(0,6.28)); to.c = nearestCity(to); }
  to.biz = c.to ? pick(c.to) : pick(ACCEPTORS[cargo]); to.name = bizName(to.biz); to.num = houseNo();
  const weight = Math.max(300, Math.round(rnd(0.35, 0.8)*t.cap/50)*50);
  const j = {id:nid("j"), base:c.base, cargo, weight, miles:estMi(from,to), urg:"standard", from, to, posted:S.clock, expires:null, routed:false, contract:c.id};
  if(c.event){ j.event = c.event; j.item = c.item; j.evColor = c.evColor; }
  j.pay = jobPay(j); S.jobs.push(j); c.posted++;
  if(!simulating) routeJob(j);
  return j;
}
const inTransit = c => S.trips.reduce((n,tr)=>n + tr.loads.filter(l=>!l.delivered && l.job.contract===c.id).length, 0);
// Called on every delivery.
function contractDelivered(j){
  if(!j.contract || !S.contracts) return;
  const c = S.contracts.active.find(x=>x.id===j.contract); if(!c) return;
  c.delivered++;
  if(c.delivered >= c.loads){
    const xp = Math.round(c.bonus/100 * CONTRACT_SIZES[c.size].xp);
    S.cash += c.bonus; S.earned += c.bonus; S.xp += xp; S.contracts.done++;
    S.contracts.active = S.contracts.active.filter(x=>x!==c);
    logEvent(`Contract complete for <b>${esc(c.from.name)}</b>: bonus <span class="num">+${money(c.bonus)}</span>, +${xp} XP`, awayLog ? simWhen() : undefined);
    if(!awayLog) toast(`Contract complete! <b>${esc(c.from.name)}</b> paid a <span class="num">${money(c.bonus)}</span> bonus (+${xp} XP)`, 6000);
  } else spawnContractJob(c);
}
// Runs with the game loop: refresh offers, top up contract loads, end contracts that ran out of time.
function contractTick(){
  if(!S) return false;
  const C = ensureContracts(); let changed = false;
  for(const c of [...C.active]){
    if(S.clock > c.deadline){
      C.active = C.active.filter(x=>x!==c); C.failed++;
      if(S.jobs.some(j=>j.contract===c.id && j.id===selectedJob)) selectedJob = null;
      S.jobs = S.jobs.filter(j=>j.contract!==c.id);
      logEvent(`Contract with <b>${esc(c.from.name)}</b> ran out of time at ${c.delivered}/${c.loads} loads. No bonus.`, awayLog ? simWhen() : undefined);
      changed = true; continue;
    }
    if(spawnContractJob(c)) changed = true;
  }
  return changed;
}
function renderContracts(){
  const C = ensureContracts(), t = S.clock, used = contractsToday(), dayLeft = CONTRACTS_PER_DAY - used, room = Math.min(maxContracts() - C.active.length, dayLeft);
  let h = `<section class="sec"><h2>Contracts</h2><p class="hint">Sign a deal with one shipper: deliver all its loads before the deadline and earn a bonus on top of the normal pay for each load, plus extra XP. Contract loads post on the Truck jobs board a few at a time. Run out of time and you keep the pay for loads delivered, but lose the bonus.</p>
    <p class="hint">You can run ${maxContracts()} contract${maxContracts()>1?"s":""} at a time${level()<20?` (more at level ${level()<10?10:20})`:""}. Completed: ${C.done}${C.failed?` · Missed: ${C.failed}`:""}</p>
    <p class="hint" style="color:var(--ink)"><b class="num">${used} of ${CONTRACTS_PER_DAY}</b> contracts accepted today${dayLeft<=0?`. New contracts in ${longDur(msToMidnight())}`:" · resets at midnight"}.</p></section>`;
  if(C.active.length) h += `<section class="sec ${cz("c-active")}">${secHead("c-active","Active",`<span class="hint num">${C.active.length}</span>`)}<div class="list">${C.active.map(c=>{
    const left = c.deadline - t, pct = c.delivered/c.loads*100, board = S.jobs.filter(j=>j.contract===c.id).length, moving = inTransit(c), conf = pendingConfirm===("drop"+c.id);
    return `<div class="card" style="${c.evColor&&c.event?`border-left:4px solid ${c.evColor}`:""}"><div class="row"><b>${esc(c.from.name)}</b><span class="pay">+${money(c.bonus)} bonus</span></div>
      <div class="meta"><span>${CONTRACT_SIZES[c.size].n} · ${esc(c.item||CONTRACT_KINDS[c.kind].n)}</span><span>${esc(addrLine(c.from))}</span></div>
      <div class="prog"><i style="width:${pct}%"></i></div>
      <div class="meta"><span class="num">${c.delivered} / ${c.loads} delivered</span><span>${moving} on the road · ${board} on the board</span><span>time left <b class="num" data-exp="${c.deadline}">${dur(left)}</b></span></div>
      <div class="btnrow"><button class="btn ghost sm" data-act="tab" data-tab="jobs">See loads on Truck jobs</button>${conf?`<button class="btn warn sm" data-act="dropContract" data-id="${c.id}">Give up contract</button><button class="btn ghost sm" data-act="cancel">Keep it</button>`:`<button class="btn ghost sm" data-act="askDrop" data-id="${c.id}">Give up</button>`}</div></div>`; }).join("")}</div></section>`;
  h += `<section class="sec ${cz("c-offers")}">${secHead("c-offers","Offers",`<span class="hint">new offers in ${longDur(Math.max(0, C.nextAt - t)/S.speed)}</span>`)}<div class="list">${C.offers.map(o=>{
    const ok = canRunContract(o), types = contractTypes(o).filter(x=>x.lvl<=level()).map(x=>x.n.toLowerCase()), xp = Math.round(o.bonus/100*CONTRACT_SIZES[o.size].xp);
    return `<div class="card"><div class="row"><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${o.event?`<span class="chip evchip" style="--ev:${o.evColor}"><i></i>${esc(o.item)} · +25%</span>`:""}${cargoChip(o.cargo)}<span class="chip">${CONTRACT_SIZES[o.size].n}</span></div><span class="pay">+${money(o.bonus)} bonus</span></div>
      <div class="route"><b>${esc(o.from.name)}</b> · ${esc(o.from.biz)}<br><span class="hint">${esc(addrLine(o.from))}</span></div>
      <div class="meta"><span class="num">${o.loads} loads</span><span class="num">${o.hours} h to finish</span><span class="num">about ${money(o.estPay)} in load pay</span><span class="num">+${xp} XP on completion</span></div>
      ${ok ? `<div class="btnrow"><button class="btn sm" data-act="acceptContract" data-id="${o.id}" ${room<=0?"disabled":""}>${dayLeft<=0?"Daily limit reached":room<=0?"Contract limit reached":"Accept contract"}</button></div>`
           : `<p class="need" style="margin:0">Needs a ${esc(types[0]||"suitable truck")}${types.length>1?` or ${esc(types.slice(1).join(" or "))}`:""}. Buy one in the Shop.</p>`}</div>`; }).join("")}</div></section>`;
  return h;
}

/* ---------------- Tasks tab ---------------- */
function bar(p, t, color){ return `<div class="prog"><i style="width:${Math.min(100, p/t*100)}%;${color?`background:${color}`:""}"></i></div>`; }
function renderTasks(){
  ensureDay();
  const ls = loginStatus(), ev = activeEvent(), d = S.daily;
  let h = `<section class="sec"><div class="sec-head"><h2>Daily login</h2><span class="hint">${ls.claimedToday?"Come back tomorrow":`Day ${ls.dayIdx+1} of 7`}</span></div>
    <div class="streak">${LOGIN_REWARDS.map((a,i)=>{ const cur = ls.claimedToday ? (ls.streak-1)%7 : ls.dayIdx; const done = i<cur || (ls.claimedToday && i===cur);
      return `<div class="sday ${done?"done":""} ${!ls.claimedToday&&i===cur?"now":""}"><span>Day ${i+1}</span><b class="num">${a>=1000?"$"+(a/1000)+"K":money(a)}</b></div>`; }).join("")}</div>
    ${ls.claimedToday?`<p class="hint">Claimed today. Log in tomorrow for day ${(ls.dayIdx+1)%7+1} (${money(LOGIN_REWARDS[(ls.dayIdx+1)%7])}). Missing a day starts the week over.</p>`
      :`<div class="btnrow"><button class="btn" data-act="claimLogin">Claim ${money(ls.amount)}</button><span class="hint">Missing a day starts the week over.</span></div>`}
  </section>`;
  if(ev){
    const e = S.events[ev.key];
    h += `<section class="sec event" style="--ev:${ev.color}"><div class="sec-head"><h2>${esc(ev.n)}</h2><span class="hint">ends in ${longDur(eventEndsIn(ev))}</span></div>
      <p class="hint" style="color:var(--ink)">${esc(ev.blurb)} Event loads show as purple pins and pay 25% more.</p>
      <div class="sec-head"><h3>Event loads delivered</h3><span class="num">${e.count}</span></div>
      <div class="list">${ev.milestones.map(m=>{ const got = e.claimed.includes(m.n), ready = e.count>=m.n && !got;
        return `<div class="task ${got?"claimed":""}"><div class="row"><span>Deliver ${m.n} event loads</span><span class="pay">${money(m.reward)}</span></div>
          ${bar(Math.min(e.count,m.n), m.n, ev.color)}
          <div class="row"><span class="hint num">${Math.min(e.count,m.n)} / ${m.n}</span>${got?`<span class="ok">Claimed</span>`:ready?`<button class="btn sm" data-act="claimMs" data-n="${m.n}">Claim</button>`:""}</div></div>`; }).join("")}</div></section>`;
  }
  const up = upcomingEvents(3);
  h += `<section class="sec ${cz("upcoming")}">${secHead("upcoming", ev?"Next events":"Upcoming events")}
    <div class="list">${up.map(u=>`<div class="task" style="--ev:${u.color}"><div class="row"><span><i class="evdot" style="background:${u.color}"></i><b>${esc(u.n)}</b></span><span class="hint num">${shortDate(u.startD)} to ${shortDate(u.endD)}</span></div><p class="hint" style="margin:0">${esc(u.blurb)}</p></div>`).join("")}</div></section>`;
  h += `<section class="sec"><div class="sec-head"><h2>Daily tasks</h2><span class="hint">new tasks in ${longDur(msToMidnight())}</span></div>
    <p class="hint">Finish a task, then claim its reward before midnight. Rewards grow with your level.</p>
    <div class="list">${d.tasks.map(t=>{ const ready = !t.claimed && t.progress>=t.target;
      return `<div class="task ${t.claimed?"claimed":""}"><div class="row"><span>${esc(taskLabel(t))}</span><span class="pay">${money(t.reward)}</span></div>
        ${bar(t.progress, t.target, t.kind==="event"?ev?.color:null)}
        <div class="row"><span class="hint num">${t.progress.toLocaleString("en-US")} / ${t.target.toLocaleString("en-US")}</span>${t.claimed?`<span class="ok">Claimed</span>`:ready?`<button class="btn sm" data-act="claimTask" data-id="${t.id}">Claim</button>`:""}</div></div>`; }).join("")}
      <div class="task bonus ${d.bonusClaimed?"claimed":""}"><div class="row"><b>Finish every daily task</b><span class="pay">${money(ALL_TASKS_BONUS)}</span></div>
        ${bar(d.tasks.filter(t=>t.claimed).length, d.tasks.length)}
        <div class="row"><span class="hint num">${d.tasks.filter(t=>t.claimed).length} / ${d.tasks.length} claimed</span>${d.bonusClaimed?`<span class="ok">Claimed</span>`:allTasksDone()?`<button class="btn sm" data-act="claimBonus">Claim</button>`:""}</div></div>
    </div></section>`;
  return h;
}

/* Pop-up on login when today's reward hasn't been claimed. */
function showLoginPopup(){
  if(!S) return;
  ensureDay();
  const ls = loginStatus(); if(ls.claimedToday) return;
  const ev = activeEvent();
  $("#loginT").textContent = `Day ${ls.dayIdx+1} reward`;
  $("#loginBody").innerHTML = `<div class="streak">${LOGIN_REWARDS.map((a,i)=>`<div class="sday ${i<ls.dayIdx?"done":""} ${i===ls.dayIdx?"now":""}"><span>Day ${i+1}</span><b class="num">${a>=1000?"$"+(a/1000)+"K":money(a)}</b></div>`).join("")}</div>
    ${ev?`<p class="hint" style="color:var(--ink)"><b>${esc(ev.n)}</b> is on for ${longDur(eventEndsIn(ev))}. Deliver event loads for bonus rewards.</p>`:""}
    <button class="btn" id="loginClaim">Claim ${money(ls.amount)}</button>`;
  $("#loginOv").hidden = false;
  $("#loginClaim").onclick = ()=>{ claimLogin(); $("#loginOv").hidden = true; save(); refresh(); };
}

/* ---------------- Street map ---------------- */
const map = L.map("map", {zoomControl:true, worldCopyJump:false, minZoom:4, maxZoom:18, preferCanvas:false}).setView([38.5,-96], 4);
// Map styles players can switch between (all free, no API key).
const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ESRI = 'Tiles &copy; <a href="https://www.esri.com">Esri</a>';
const EB = "https://server.arcgisonline.com/ArcGIS/rest/services/";
const MAP_STYLES = {
  standard:  {n:"Standard",      layers:[[TILE_URL, {maxZoom:19, attribution:TILE_ATTR}]]},
  street:    {n:"Street",        layers:[[EB+"World_Street_Map/MapServer/tile/{z}/{y}/{x}", {maxZoom:19, attribution:ESRI}]]},
  topo:      {n:"Topographic",   layers:[[EB+"World_Topo_Map/MapServer/tile/{z}/{y}/{x}", {maxZoom:19, attribution:ESRI}]]},
  light:     {n:"Light gray",    layers:[[EB+"Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {maxNativeZoom:16, maxZoom:19, attribution:ESRI}],
                                         [EB+"Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {maxNativeZoom:16, maxZoom:19}],
                                         [EB+"Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", {maxZoom:19, opacity:.6}]]},
  dark:      {n:"Dark gray",     layers:[[EB+"Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {maxNativeZoom:16, maxZoom:19, attribution:ESRI}],
                                         [EB+"Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {maxNativeZoom:16, maxZoom:19}]]},
  humanitarian:{n:"Humanitarian", layers:[["https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {maxZoom:19, subdomains:"abc", attribution:OSM+', <a href="https://www.hotosm.org/">HOT</a>'}]]},
  satellite: {n:"Satellite",     layers:[[EB+"World_Imagery/MapServer/tile/{z}/{y}/{x}", {maxZoom:19, attribution:ESRI+", Maxar, Earthstar Geographics"}],
                                         [EB+"Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", {maxZoom:19}],
                                         [EB+"Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {maxZoom:19}]]}
};
let baseLayers = [];
function setMapStyle(key){
  const st = MAP_STYLES[key] || MAP_STYLES.standard;
  baseLayers.forEach(l=>map.removeLayer(l));
  baseLayers = st.layers.map(([u,o])=>L.tileLayer(u,o).addTo(map));
  baseLayers.forEach(l=>l.bringToBack());
  try{ localStorage.setItem("freight-dispatch-mapstyle", key); }catch(_){}
  const sel = document.getElementById("mapStyle"); if(sel) sel.value = key in MAP_STYLES ? key : "standard";
}
(()=>{ const sel = document.getElementById("mapStyle");
  sel.innerHTML = Object.entries(MAP_STYLES).map(([k,v])=>`<option value="${k}">${v.n}</option>`).join("");
  sel.addEventListener("change", ()=>setMapStyle(sel.value));
  let saved = "standard"; try{ saved = localStorage.getItem("freight-dispatch-mapstyle") || "standard"; }catch(_){}
  setMapStyle(saved);
})();
// Keep the map filling its box when the layout or window size changes.
try{ new ResizeObserver(()=>map.invalidateSize()).observe(document.getElementById("map")); }catch(_){}
window.addEventListener("load", ()=>map.invalidateSize());
const layerRings = L.layerGroup().addTo(map), layerRoutes = L.layerGroup().addTo(map), layerSel = L.layerGroup().addTo(map),
      layerBases = L.layerGroup().addTo(map), layerJobs = L.layerGroup().addTo(map), layerVeh = L.layerGroup().addTo(map);
const layerYards = L.layerGroup();
function drawYards(){
  layerYards.clearLayers();
  if(!S || level() < RAIL_LVL){ map.removeLayer(layerYards); return; }
  for(const y of RAIL_YARDS){
    const own = S.vehicles.some(v=>v.yard===y.id);
    L.marker([y.lat,y.lon], {icon:L.divIcon({className:"", html:`<div class="mk-yard ${own?"own":""}">${iconSvg("train",12)}</div>`, iconSize:[22,22], iconAnchor:[11,11]}), title:`${y.n}, ${y.city} ${y.s}${own?" · your trains":""}`, zIndexOffset:400}).addTo(layerYards);
  }
  if(airOpen()) for(const a of AIRPORTS){
    const own = S.vehicles.some(v=>v.airport===a.id);
    L.marker([a.lat,a.lon], {icon:L.divIcon({className:"", html:`<div class="mk-air s${a.size} ${own?"own":""}">${iconSvg("plane",12)}</div>`, iconSize:[22,22], iconAnchor:[11,11]}), title:`${a.n} (${a.id}), ${a.city} ${a.s} · ${AIRPORT_SIZE[a.size]}${own?" · your planes":""}`, zIndexOffset:400}).addTo(layerYards);
  }
  layerYards.addTo(map);
  syncRailLines();
}
const railLines = L.tileLayer("https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png", {maxZoom:19, subdomains:"abc", opacity:.75, attribution:'Rail lines: <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>'});
function railLinesWanted(){ let v = null; try{ v = localStorage.getItem("freight-dispatch-raillines"); }catch(_){} return v ? v==="on" : !!(S && level()>=RAIL_LVL); }
function syncRailLines(){ const on = railLinesWanted(); const cb = document.getElementById("railToggle"); if(cb) cb.checked = on; if(on) railLines.addTo(map); else map.removeLayer(railLines); }
document.getElementById("railToggle")?.addEventListener("change", e=>{ try{ localStorage.setItem("freight-dispatch-raillines", e.target.checked?"on":"off"); }catch(_){} syncRailLines(); });
const jobMarkers = new Map(), vehMarkers = new Map(), tripLines = new Map(), stopMarkers = new Map();
const layerStops = L.layerGroup().addTo(map);
const PIN_SVG = '<svg width="22" height="28" viewBox="0 0 22 28"><path class="body" d="M11 27C9 22 2 17 2 10.5A9 9 0 0 1 20 10.5C20 17 13 22 11 27Z"/><circle class="hole" cx="11" cy="10.5" r="3.4"/></svg>';
map.on("click", e=>{ if(placing){ placeAt(e.latlng); return; } if(selectedJob){ selectedJob=null; drawJobs(); renderPanel(); } });

// Job-area rings are hundreds of miles wide. Zoomed in to street level, phones and iPads have to draw a dashed
// circle millions of pixels around, which freezes Safari. The ring is off-screen at that zoom anyway, so hide it.
const RING_MAX_ZOOM = 10;
function syncRings(){ const show = map.getZoom() <= RING_MAX_ZOOM; if(show && !map.hasLayer(layerRings)) layerRings.addTo(map); else if(!show && map.hasLayer(layerRings)) map.removeLayer(layerRings); }
map.on("zoomend", syncRings);
function drawBases(){
  layerBases.clearLayers(); layerRings.clearLayers();
  S.bases.forEach((b,i)=>{
    const p = basePt(b);
    L.circle([p.lat,p.lon], {radius:rangeMi()*1609.34, color:"#1e5a3c", weight:1.2, opacity:.5, dashArray:"5 6", fill:true, fillOpacity:.03, interactive:false}).addTo(layerRings);
    L.marker([p.lat,p.lon], {icon:L.divIcon({className:"", html:`<div class="mk-base">${b.home?"HQ":"H"+(i+1)}</div>`, iconSize:[22,22], iconAnchor:[11,11]}), zIndexOffset:500, title:`${baseName(b)} · ${baseAddr(b)}`}).addTo(layerBases);
  });
}
function drawJobs(){
  const ids = new Set(S.jobs.filter(j=>!j.locked).map(j=>j.id));
  for(const [id,m] of jobMarkers) if(!ids.has(id)){ layerJobs.removeLayer(m); jobMarkers.delete(id); }
  for(const j of S.jobs){
    if(j.locked) continue;
    let m = jobMarkers.get(j.id);
    const cls = `mk-pin ${jobStatus(j).can?"":"cant"} ${j.id===selectedJob?"sel":""} ${j.event?"ev":""} ${j.rail?"rail":""} ${j.air?"air":""}`;
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
      const p = posOf(tr,t), vc = p.ph==="load" ? (p.s?.sk==="drop" ? "unload" : "load") : p.ph;   // marker color by stage
      let m = vehMarkers.get(tr.id);
      const v = S.vehicles.find(x=>x.id===tr.v);
      const mode = v ? (TYPE[v.type]?.mode||"truck") : "truck";
      if(!m){
        m = L.marker(p.ll, {icon:L.divIcon({className:"", html:`<div class="mk-veh ${vc}">${iconSvg(mode,15)}</div>`, iconSize:[26,26], iconAnchor:[13,13]}), zIndexOffset:800, title:v?`${v.n} · ${TYPE[v.type]?.n||""}`:"Truck"});
        m.on("click", e=>{ L.DomEvent.stopPropagation(e); viewTrip(tr.v); });
        m.addTo(layerVeh); vehMarkers.set(tr.id, m); m._ph = vc;
      } else {
        m.setLatLng(p.ll);
        if(m._ph!==vc){ const el=m.getElement()?.firstElementChild; if(el) el.className=`mk-veh ${vc}`; m._ph=vc; }
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
    const liveStops = new Set();
    for(const tr of S.trips) for(const ld of tr.loads){
      const j = ld.job, k = tr.id+"|"+j.id;
      let sm = stopMarkers.get(k);
      if(!sm){
        sm = {
          pick: L.marker([j.from.lat,j.from.lon], {icon:L.divIcon({className:"", html:'<div class="mk-stop pick">P</div>', iconSize:[20,20], iconAnchor:[10,10]}), title:`Pickup: ${j.from.name||j.from.biz}`, zIndexOffset:600}).addTo(layerStops),
          drop: L.marker([j.to.lat,j.to.lon], {icon:L.divIcon({className:"", html:'<div class="mk-stop drop">D</div>', iconSize:[20,20], iconAnchor:[10,10]}), title:`Drop-off: ${j.to.name||j.to.biz}`, zIndexOffset:600}).addTo(layerStops)
        };
        stopMarkers.set(k, sm);
      }
      if(ld.picked && sm.pick){ layerStops.removeLayer(sm.pick); sm.pick=null; }
      if(ld.delivered && sm.drop){ layerStops.removeLayer(sm.drop); sm.drop=null; }
      liveStops.add(k);
    }
    for(const [k,sm] of stopMarkers) if(!liveStops.has(k)){ if(sm.pick) layerStops.removeLayer(sm.pick); if(sm.drop) layerStops.removeLayer(sm.drop); stopMarkers.delete(k); }
  }
  requestAnimationFrame(frame);
}
// Map key: click to hide or show; remembered in this browser.
(()=>{ const lg = $("#legend"), bt = $("#legendToggle"), small = () => matchMedia("(max-width:620px)").matches;
  const set = open => { lg.classList.toggle("min", !open); lg.classList.toggle("open-small", open); bt.setAttribute("aria-expanded", open); bt.title = open ? "Hide map key" : "Show map key"; bt.lastElementChild.textContent = open ? "‹" : "›"; };
  let open = !small(); try{ const v = localStorage.getItem("freight-dispatch-key"); if(v) open = v==="open"; }catch(_){}
  set(open);
  bt.addEventListener("click", ()=>{ open = !open; set(open); try{ localStorage.setItem("freight-dispatch-key", open?"open":"closed"); }catch(_){} });
})();
$("#zHome").onclick=()=>{ if(S){ const p=basePt(S.bases[0]); map.flyTo([p.lat,p.lon], 11, {duration:.6}); } };
$("#zArea").onclick=()=>{ if(S){ const b=L.latLngBounds(S.bases.map(x=>{const p=basePt(x);return [p.lat,p.lon];})); map.flyToBounds(b.pad(0.1).extend(L.latLng(b.getNorth()+rangeMi()/MI_DEG, b.getEast()+rangeMi()/MI_DEG)).extend(L.latLng(b.getSouth()-rangeMi()/MI_DEG, b.getWest()-rangeMi()/MI_DEG)), {duration:.6}); } };

/* ---------------- Panel ---------------- */
function contractChip(j){ const c = S.contracts?.active.find(x=>x.id===j.contract); return c ? `<span class="chip contractchip"><i></i>Contract · ${esc(c.from.name)} ${c.delivered}/${c.loads}</span>` : ""; }
function evChip(j){ return `<span class="chip evchip" style="--ev:${j.evColor||"#7b3fb5"}"><i></i>${esc(j.item||"Event load")} · +25%</span>`; }
// What a rail job needs, with what you already have.
function railNeeds(j){
  const car = RAILCARS[j.carType], carN = car.n.toLowerCase();
  const need = car.unit ? `${j.units} container${j.units>1?"s":""} of space: ${Math.ceil(j.units/car.cap)} ${carN}${Math.ceil(j.units/car.cap)>1?"s":""} (each holds ${car.cap})` : `${j.units} ${carN}${j.units>1?"s":""}, one per carload`;
  const best = Math.max(0, ...S.vehicles.filter(isTrain).map(v=>trainSlots(v, j.carType)));
  const loco = LOCOS.filter(l=>l.leg>=j.miles)[0];
  const have = S.vehicles.some(isTrain) ? (best>=j.units ? `<span class="ok">Your train has room</span>` : `<span class="need">Your best train has ${best} ${car.unit?"container slots":carN+(best===1?"":"s")}</span>`) : `<span class="need">You have no trains yet</span>`;
  return `<div class="needs"><b>Needs:</b> ${esc(need)} · a locomotive with ${j.miles}+ mi range${loco?` (${esc(loco.n.toLowerCase())})`:""} · an engineer<br>${have}</div>`;
}
function cargoChip(c){ return `<span class="chip" style="color:var(--c-${c})"><i></i><span style="color:var(--ink)">${esc(CARGO[c].n)}</span></span>`; }
function urgTag(u){ return !URG[u] || u==="standard" ? "" : `<span class="urg ${u}" title="${URG[u].pay}× pay, ${URG[u].xp}× XP">${u} · ${URG[u].xp}× XP</span>`; }
// XP for a delivery: 1 per $100 of pay, doubled for priority and tripled for express.
const jobXp = j => j.pay/100 * (URG[j.urg]||URG.standard).xp;
const MENU_PAGES = {fleet:"Fleet", contracts:"Contracts", alliance:"Alliance", shop:"Shop", crew:"Crew", tasks:"Tasks", log:"Log", company:"Company", account:"Account", settings:"Settings"};
function markTabs(){
  document.querySelectorAll(".tab[data-tab]").forEach(b=>b.setAttribute("aria-selected", b.dataset.tab===tab));
  const inMenu = tab in MENU_PAGES;
  $("#menuBtn").setAttribute("aria-selected", inMenu); $("#menuLabel").textContent = inMenu ? MENU_PAGES[tab] : "Menu";
  document.querySelectorAll(".menuitem").forEach(b=>b.classList.toggle("on", b.dataset.tab===tab));
}
function setTab(t){ tab=t; pendingConfirm=null; renderPanel(); markTabs(); }
function selectJob(id, fly){
  selectedJob=id; chosenVeh=null; extraSel = new Set();
  const j = S.jobs.find(x=>x.id===id);
  tab = !j ? "jobs" : j.air ? "air" : j.rail ? "rail" : "jobs"; markTabs(); if(j){ routeJob(j); if(fly) fitJob(j); }
  if(j){ const kp = j.air ? "ja-" : j.rail ? "jr-" : "jt-"; [kp+"ready", kp+"other"].forEach(k=>collapsed.delete(k)); }
  drawJobs(); renderPanel();
  // The dispatch card opens in place of the job you picked, so you stay where you were in the list.
  const card = $("#panelBody .dispatch"); if(card) card.scrollIntoView({block:"nearest"});
}
function goals(){
  const has = id=>S.vehicles.some(v=>v.type===id);
  return [
    ["Deliver your first job", S.jobsDone>=1], ["Complete 5 deliveries", S.jobsDone>=5],
    ["Buy a second vehicle", S.vehicles.length>=2], ["Hire your first driver", S.hired>=1],
    ["Open a second hub", S.bases.length>=2], ["Buy a straight truck (level 6)", has("straight")],
    ["Hire a dispatcher (level 8)", S.bases.some(b=>b.dispatcher)], ["Put a semi on the road (level 10)", trucks().some(v=>TYPE[v.type].lvl>=10)], ["Buy your first train (level 15)", S.vehicles.some(isTrain)]
  ];
}
function jobCard(j){
  const st = jobStatus(j), local = j.from.c===j.to.c;
  return `<button class="card ${j.id===selectedJob?"sel":""} ${st.can?"":"dim"}" data-act="sel" data-id="${j.id}">
    <div class="row"><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${j.rail?`<span class="chip railchip"><i></i>Rail</span>`:""}${j.air?`<span class="chip airchip"><i></i>Air · ${esc(j.from.airport)} → ${esc(j.to.airport)}</span>`:""}${j.contract?contractChip(j):""}${j.event?evChip(j):""}${cargoChip(j.cargo)}${urgTag(j.urg)}</div><span class="pay">${money(j.pay)}</span></div>
    <div class="route"><b>${esc(j.from.name||j.from.biz)}</b> <span class="arrow">→</span> <b>${esc(j.to.name||j.to.biz)}</b><br><span class="hint">${esc(addrLine(j.from))} → ${esc(addrLine(j.to))}</span></div>
    <div class="meta"><span class="num">${weightStr(j)}</span><span class="num">${j.routed?"":"about "}${j.miles} mi</span><span class="num">+${Math.round(jobXp(j))} XP</span>${j.expires?`<span>expires in <span class="num" data-exp="${j.expires}">${dur(j.expires-S.clock)}</span></span>`:""}</div>
    ${st.can?`<span class="ok">${st.opts.length} vehicle${st.opts.length>1?"s":""} available · fastest delivers in ${dur(st.opts[0].r.plan.deliverIn)}</span>`:j.rail?railNeeds(j):`<span class="need">${esc(st.why)}</span>`}
  </button>`;
}
function payBreakdown(j){
  const w = j.cargo==="vehicles" ? j.weight*4000 : j.weight;
  const dist = 1.5*j.miles*Math.pow(w/1000,0.8);
  const um = (URG[j.urg]||URG.standard).pay;
  return `<p class="hint" style="margin:0">Pay: ${money(150*PAY_SCALE)} base + ${money(dist*PAY_SCALE)} for ${j.miles} mi × ${weightStr(j)} × ${CARGO[j.cargo].mult} ${esc(CARGO[j.cargo].n.toLowerCase())}${um>1?` × ${um} ${j.urg}`:""}${j.event?` × ${EVENT_PAY_BONUS} event bonus`:""}${j.rail?` × ${RAIL_PAY} rail rate`:""}${j.air?` × ${AIR_PAY} air rate`:""}</p>`;
}
// Other open jobs the chosen vehicle could carry on the same trip, nearest pickup first.
// Ticked jobs are dispatched together with the main one; room left updates as you tick.
function extraLoadsList(j, v){
  if(isTrain(v)) return "";
  const t = TYPE[v.type], tr = tripOf(v);
  const all = S.jobs.filter(x=>x.id!==j.id && jobKind(x)===jobKind(j) && vehicleFor(v,x).ok)
    .sort((a,b)=>hav(j.from,a.from)-hav(j.from,b.from));
  for(const id of [...extraSel]) if(!all.find(x=>x.id===id)) extraSel.delete(id);
  const picked = all.filter(x=>extraSel.has(x.id));
  const used = usedRoom(tr) + j.weight + picked.reduce((n,x)=>n+x.weight, 0);
  const nLoads = openLoads(tr).length + 1 + picked.length;
  // Only list loads that still fit (plus the ones already ticked), nearest pickup first.
  const cands = all.filter(x=>extraSel.has(x.id) || (used + x.weight <= t.cap && nLoads < MAX_LOADS)).slice(0, 12 + picked.length);
  if(!cands.length) return all.length ? `<p class="hint" style="margin:0">No other open loads fit in this ${esc(t.n.toLowerCase())} with this one.</p>` : "";
  // Timing: the trip with what's ticked now, and how much each unticked job would add to it.
  const now = S.clock, base = planRoute(v, tr, [j, ...picked], now), alone = planRoute(v, tr, [j], now);
  const deliverIn = x => { const d = base.dropOf(x.id); return d ? d.t1 - now : 0; };
  const addTime = x => planRoute(v, tr, [j, ...picked, x], now).endAt - base.endAt;
  const home = isTrain(v) ? "its yard" : isPlane(v) ? "its home airport" : "the hub";
  const summary = picked.length ? `<p class="hint" style="margin:0;color:var(--ink)">With ${picked.length+1} loads: this load delivers in ${dur(deliverIn(j))}, back at ${home} in ${dur(base.endAt-now)} (+${dur(Math.max(0, base.endAt-alone.endAt))} for the added loads).</p>` : "";
  return `<div class="extras"><div class="row"><b>Add more loads to this trip</b><span class="hint num">${roomStr(t, used)}</span></div>
    ${cands.map(x=>{ const on = extraSel.has(x.id);
      return `<label class="opt"><input type="checkbox" name="extra" value="${x.id}" ${on?"checked":""}>
        <span><b>${esc(x.from.name||x.from.biz)}</b> → ${esc(x.to.name||x.to.biz)}<small>${weightStr(x)} · ${x.miles} mi · pickup ${Math.round(hav(j.from,x.from))} mi from this one${on?` · delivers in ${dur(deliverIn(x))}`:` · adds ${dur(Math.max(0, addTime(x)))} to the trip`}</small></span>
        <span class="pay">${money(x.pay)}</span></label>`; }).join("")}${summary}</div>`;
}
function dispatchCard(j){
  const st = jobStatus(j), local = j.from.c===j.to.c;
  let opts;
  if(st.can){
    if(chosenVeh && !st.opts.find(o=>o.v.id===chosenVeh)) chosenVeh = null;   // you choose; nothing is picked for you
    const sel = st.opts.find(o=>o.v.id===chosenVeh);
    opts = `<label class="fld" for="vehPick">Vehicle</label>
      <select id="vehPick" aria-label="Choose a vehicle for this job">
        <option value="" ${chosenVeh?"":"selected"}>Choose a vehicle… (${st.opts.length} available)</option>
        ${st.opts.map(o=>`<option value="${o.v.id}" ${o.v.id===chosenVeh?"selected":""}>${esc(o.v.n)} · ${esc(TYPE[o.v.type].n)}${o.r.plan.adding?" · on a trip, has room":""} · delivers in ${dur(o.r.plan.deliverIn)}</option>`).join("")}
      </select>
      ${sel ? (o=>{ const p=o.r.plan; return `<div class="opt chosen"><span><b>${esc(o.v.n)}</b> · ${esc(TYPE[o.v.type].n)}<small>${esc(o.r.drivers.map(d=>d.name).join(" + "))} · ${p.adding?`<b>Adds to its current trip</b> (${p.loads} loads, ${capText(o.v, j)}) · `:""}${p.dead>1?`${p.dead} mi to ${isTrain(o.v)?"the pickup yard":isPlane(o.v)?"the pickup airport":"pickup"} · `:""}${p.adding?"":`loading ${dur(p.ld)} · ${isPlane(o.v)?"flight":"drive"} ${dur(p.tHaul)} · unloading ${dur(p.lu)}<br>`}Delivers this load in ${dur(p.deliverIn)}, back at ${isTrain(o.v)?"its yard":isPlane(o.v)?"its home airport":"the hub"} in ${dur(p.total)}${p.adding&&p.extra>0?` (+${dur(p.extra)})`:""}</small></span><span class="pay" title="Job pay">${money(Math.round(j.pay*p.bonus*(1-p.cut)))}</span></div>`; })(sel) : `<p class="hint" style="margin:0">Pick a vehicle to see its timing, then dispatch.</p>`}
      ${sel ? extraLoadsList(j, sel.v) : ""}
      <div class="btnrow"><button class="btn" data-act="go" data-id="${j.id}" ${j.routing||!sel?"disabled":""}>${j.routing?"Finding route…":extraSel.size?`Dispatch ${extraSel.size+1} loads · ${money(j.pay+[...extraSel].reduce((n,id)=>n+(S.jobs.find(x=>x.id===id)?.pay||0),0))}`:"Dispatch"}</button><button class="btn ghost" data-act="unsel">Close</button></div>`;
  } else {
    opts = `<p class="need" style="font-size:13px;margin:0">${esc(st.why)}</p><div class="btnrow"><button class="btn ghost" data-act="unsel">Close</button>${st.soon?"":`<button class="btn ghost" data-act="tab" data-tab="shop">Open shop</button>`}</div>`;
  }
  return `<section class="dispatch" aria-label="Dispatch job">
    <div class="row"><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${j.rail?`<span class="chip railchip"><i></i>Rail</span>`:""}${j.air?`<span class="chip airchip"><i></i>Air · ${esc(j.from.airport)} → ${esc(j.to.airport)}</span>`:""}${j.contract?contractChip(j):""}${j.event?evChip(j):""}${cargoChip(j.cargo)}${urgTag(j.urg)}</div><span class="pay" style="font-size:18px">${money(j.pay)}</span></div>
    <div class="leg"><span class="dot"></span><span><b>${esc(j.from.name||j.from.biz)}</b> · ${esc(j.from.biz)}<br><span class="hint">${esc(addrLine(j.from))}</span></span>
      <span class="line"></span><span class="hint"><span class="num">${weightStr(j)}</span> · <span class="num">${j.miles} mi</span> ${j.routing?(j.rail?"· checking track":"· checking roads"):j.path?(j.air?"by air":j.rail?"by rail":"by road"):"(estimate)"}</span>
      <span class="dot end"></span><span><b>${esc(j.to.name||j.to.biz)}</b> · ${esc(j.to.biz)}<br><span class="hint">${esc(addrLine(j.to))}</span></span></div>
    ${payBreakdown(j)}
    ${j.rail?railNeeds(j):""}
    <div class="btnrow"><button class="btn ghost sm" data-act="fly" data-id="${j.id}">Show route on map</button></div>
    ${opts}
  </section>`;
}
// Dispatched loads stay on the job tab until they are delivered, with a countdown.
function activeLoads(kind){
  const out = [];
  for(const tr of S.trips) for(const l of tr.loads){
    if(l.delivered || jobKind(l.job) !== kind) continue;
    const drop = tr.segs.find(sg=>sg.kind==="stop" && sg.sk==="drop" && sg.jid===l.job.id);
    out.push({tr, l, due: drop ? drop.t1 : tr.endAt});
  }
  return out.sort((a,b)=>a.due-b.due);
}
const vehKind = v => isPlane(v) ? "air" : isTrain(v) ? "rail" : "truck";
const dropDue = (tr, jid) => { const d = tr.segs.find(sg=>sg.kind==="stop" && sg.sk==="drop" && sg.jid===jid); return d ? d.t1 : tr.endAt; };
const nextDue = tr => Math.min(...openLoads(tr).map(l=>dropDue(tr, l.job.id)), tr.endAt);
// One card per vehicle on the road: its crew, room, every load it carries with its own countdown, and the next stop.
function tripCard(tr){
  const v = S.vehicles.find(x=>x.id===tr.v), ty = TYPE[v.type], t = displayClock();
  const pct = Math.min(100, Math.max(0, (t-tr.startAt)/((tr.endAt-tr.startAt)||1)*100)), ns = nextStopAt(tr, t);
  const ds = tr.drivers.map(id=>S.drivers.find(d=>d.id===id)?.name).filter(Boolean).join(" + ");
  const loads = openLoads(tr).slice().sort((a,b)=>dropDue(tr,a.job.id)-dropDue(tr,b.job.id));
  const used = usedRoom(tr), train = isTrain(v), plane = isPlane(v);
  const home = train ? "its yard" : plane ? "its home airport" : "the hub";
  const room = train ? `${trainCarCount(v)} cars` : `${roomStr(ty, used)} loaded`;
  const total = loads.reduce((n,l)=>n+l.job.pay*(1-(l.cut||0)), 0);
  return `<div class="card active" id="ip-${v.id}">
    <div class="row"><b><span class="vic">${iconSvg(ty.mode||"truck",13)}</span>${esc(v.n)} <span class="hint" style="font-weight:400">${esc(ty.n)}</span></b><span class="status busy" data-ph="${tr.id}">${esc(phaseText(tr,t))}</span></div>
    <div class="meta">${ds?`<span>${esc(ds)}</span>`:""}<span class="num">${room}</span>${!train?`<span>${used<ty.cap&&loads.length<MAX_LOADS?"Room for more loads":"Full"}</span>`:""}<span><span class="pay" style="font-size:13px">${money(total)}</span> for this trip</span></div>
    <div class="prog"><i data-prog="${tr.id}" style="width:${pct}%"></i></div>
    <ul class="loads">${loads.map(l=>{ const j = l.job, due = dropDue(tr, j.id);
      return `<li><span>${j.event?evChip(j)+" ":""}${plane?`${esc(j.from.airport)} <span class="arrow">→</span> ${esc(j.to.airport)} · ${esc(CARGO[j.cargo].n)}`:`${esc(j.from.name||j.from.biz)} <span class="arrow">→</span> ${esc(j.to.name||j.to.biz)}`}${urgTag(j.urg)?" "+urgTag(j.urg):""}</span><span class="num">${money(j.pay*(1-(l.cut||0)))}</span>
        <span class="lst">${l.picked?"On board":"Waiting for pickup"} · <span class="num">${train?esc(railUnitWord(j.carType,j.units)):weightStr(j)}</span></span><span class="num">delivers in <b data-due="${due}">${dur(due-t)}</b></span></li>`; }).join("")}</ul>
    <div class="row"><span class="hint">${ns.label==="Back at hub in"?`Back at ${home} in`:ns.label} <span class="num" data-eta="${tr.id}">${dur(ns.t-t)}</span></span><button class="btn ghost sm" data-act="follow" data-id="${tr.id}">Follow on map</button></div>
  </div>`;
}
function activeCard({tr, l, due}){
  const j = l.job, v = S.vehicles.find(x=>x.id===tr.v), t = displayClock();
  const total = Math.max(1, due - tr.startAt), pct = Math.min(100, Math.max(0, (t - tr.startAt)/total*100));
  return `<div class="card active">
    <div class="row"><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${j.rail?`<span class="chip railchip"><i></i>Rail</span>`:""}${j.air?`<span class="chip airchip"><i></i>Air · ${esc(j.from.airport)} → ${esc(j.to.airport)}</span>`:""}${j.event?evChip(j):""}${cargoChip(j.cargo)}</div><span class="pay">${money(j.pay*(1-(l.cut||0)))}</span></div>
    <div class="route"><b>${esc(j.from.name||j.from.biz)}</b> <span class="arrow">→</span> <b>${esc(j.to.name||j.to.biz)}</b></div>
    <div class="meta"><span class="num">${weightStr(j)}</span><span class="num">${j.miles} mi</span><span>${esc(v?v.n:"")}</span><span class="lst">${l.picked?"On board":"Heading to pickup"}</span></div>
    <div class="prog"><i data-dueprog="${due}" data-start="${tr.startAt}" style="width:${pct}%"></i></div>
    <div class="row"><span class="countdown">Delivers in <b class="num" data-due="${due}">${dur(due - t)}</b></span><button class="btn ghost sm" data-act="follow" data-id="${tr.id}">Follow on map</button></div>
  </div>`;
}
// Sorting the job lists: by payout, miles, weight or fastest delivery, either direction. Remembered in this browser.
const SORTS = {pay:["Payout","desc"], miles:["Mileage","desc"], weight:["Weight (lb)","desc"], eta:["Fastest delivery","asc"]};
let jobSort = {k:"pay", dir:"desc"};
try{ const v = JSON.parse(localStorage.getItem("freight-dispatch-sort")||"null"); if(v && SORTS[v.k] && /^(asc|desc)$/.test(v.dir)) jobSort = v; }catch(_){}
function saveSort(){ try{ localStorage.setItem("freight-dispatch-sort", JSON.stringify(jobSort)); }catch(_){} }
function sortJobs(list){
  const {k, dir} = jobSort, sg = dir==="asc" ? 1 : -1;
  const val = x => k==="eta" ? x.eta : k==="weight" ? (x.j.cargo==="vehicles" ? x.j.weight*4000 : x.j.weight) : x.j[k];
  return list.sort((a,b)=>{ const va = val(a), vb = val(b);
    if(va==null || vb==null) return (va==null) - (vb==null) || b.j.pay - a.j.pay;   // no delivery time yet: list last
    return (va - vb)*sg || b.j.pay - a.j.pay; });
}
function sortBar(){
  return `<div class="sortbar"><label for="jobSort" class="hint">Sort by</label>
    <select id="jobSort" aria-label="Sort jobs by">${Object.entries(SORTS).map(([k,[n]])=>`<option value="${k}" ${k===jobSort.k?"selected":""}>${n}</option>`).join("")}</select>
    <button class="btn ghost sm" data-act="sortDir" aria-label="Change sort direction">${jobSort.k==="eta" ? (jobSort.dir==="asc"?"Fastest first":"Slowest first") : (jobSort.dir==="desc"?"Highest first":"Lowest first")}</button></div>`;
}
function renderJobs(mode="truck"){
  const kind = mode, rail = kind==="rail", air = kind==="air", kp = rail ? "jr-" : air ? "ja-" : "jt-";
  if(air && !airOpen()) return `<section class="sec"><h2>Air cargo jobs</h2><div class="card dim"><div class="row"><b>Air cargo unlocks at level ${AIR_LVL}</b><span class="lock">Level ${AIR_LVL}</span></div><p class="hint">Fly urgent freight between real US airports. You are level ${level()}.</p></div></section>`;
  if(rail && level() < RAIL_LVL) return `<section class="sec"><h2>Train jobs</h2><div class="card dim"><div class="row"><b>Trains unlock at level ${RAIL_LVL}</b><span class="lock">Level ${RAIL_LVL}</span></div><p class="hint">Run trains between real freight yards on real track. You are level ${level()}.</p></div></section>`;
  const sj = S.jobs.find(j=>j.id===selectedJob && jobKind(j)===kind);
  const list = sortJobs(S.jobs.filter(j=>jobKind(j)===kind).map(j=>{ const st = jobStatus(j); return {j, can:st.can, eta: st.can ? st.opts[0].r.plan.deliverIn : null}; }));
  const can = list.filter(x=>x.can), cant = list.filter(x=>!x.can);
  let h = "";
  if(rail){
    const trains = S.vehicles.filter(isTrain);
    if(!trains.length) h += `<p class="hint" style="color:var(--ink)">You have no trains yet. Buy a locomotive in <b>Menu → Shop</b>, add railcars in the <b>Fleet</b> tab, and hire an engineer in <b>Menu → Crew</b>.</p>`;
    h += `<p class="hint">Rail jobs run between real freight yards (square markers on the map).</p>`;
  }
  if(air){
    const planes = S.vehicles.filter(isPlane);
    if(!planes.length) h += `<p class="hint" style="color:var(--ink)">You have no planes yet. Buy one in <b>Menu → Shop</b> and hire a pilot in <b>Menu → Crew</b>.</p>`;
    h += `<p class="hint">Air cargo flies between real US airports (round markers on the map). Bigger aircraft need bigger airports.</p>`;
  }
  if(kind==="truck" && S.jobsDone<1 && !sj) h += `<p class="hint" style="color:var(--ink)">Tap an orange pin on the map, or pick a job below, then send your van. Gray pins need a vehicle you do not own yet.</p>`;
  { const n = air ? airCount() : rail ? railCount() : boardCount(), name = air ? "Air cargo" : rail ? "Train" : "Truck";
    h += `<p class="hint">${name} job board: ${n} of ${JOB_BOARD_MAX}. A new job posts every ${JOB_EVERY_MS>=60000?(JOB_EVERY_MS===60000?"minute":`${JOB_EVERY_MS/60000} minutes`):`${JOB_EVERY_MS/1000} seconds`}${n>=JOB_BOARD_MAX?"; when full, the oldest job you can't take is swapped for a new one":""}.</p>`; }
  { const trips = S.trips.filter(tr=>{ const v = S.vehicles.find(x=>x.id===tr.v); return v && vehKind(v)===kind; })
      .sort((a,b)=>nextDue(a)-nextDue(b));
    const nLoads = trips.reduce((n,tr)=>n+openLoads(tr).length, 0);
    if(trips.length) h += `<section class="sec ${cz(kp+"active")}">${secHead(kp+"active","In progress",`<span class="hint num">${trips.length} ${kind==="air"?"plane":kind==="rail"?"train":"vehicle"}${trips.length>1?"s":""} · ${nLoads} load${nLoads===1?"":"s"}</span>`)}<div class="list">${trips.map(tripCard).join("")}</div></section>`; }
  h += `<section class="sec ${cz(kp+"ready")}">${secHead(kp+"ready","Available jobs",`<span class="hint num">${can.length}</span>`)}${list.length>1?sortBar():""}${can.length?`<div class="list">${can.map(x=>x.j.id===selectedJob?dispatchCard(x.j):jobCard(x.j)).join("")}</div>`:`<p class="hint">Nothing your fleet can take right now. A new job posts every minute.</p>`}</section>`;
  if(cant.length) h += `<section class="sec ${cz(kp+"other")}">${secHead(kp+"other","Other jobs nearby",`<span class="hint num">${cant.length}</span>`)}<div class="list">${cant.map(x=>x.j.id===selectedJob?dispatchCard(x.j):jobCard(x.j)).join("")}</div></section>`;
  return h;
}
function stopName(tr, sk, jid){ const j = tr.loads.find(l=>l.job.id===jid)?.job; if(!j) return ""; return sk==="pick" ? (j.from.name||j.from.biz) : (j.to.name||j.to.biz); }
function phaseText(tr,t){
  const sg = segAt(tr,t);
  if(sg.kind==="stop") return sg.sk==="pick" ? `Loading at ${stopName(tr,"pick",sg.jid)}` : `Unloading at ${stopName(tr,"drop",sg.jid)}`;
  if(sg.ph==="ret"){ const v = S.vehicles.find(x=>x.id===tr.v); return v && isPlane(v) ? "Flying home · can take more jobs" : v && isTrain(v) ? "Returning to its yard · can take more jobs" : "Returning to hub · can take more jobs"; }
  const on = openLoads(tr).filter(l=>l.picked).length;
  return sg.next?.sk==="pick" ? `${on?`${on} on board · `:""}To pickup at ${stopName(tr,"pick",sg.next.jid)}` : `${on} on board · Delivering to ${stopName(tr,"drop",sg.next?.jid)}`;
}
function nextStopAt(tr,t){ const sg = tr.segs.find(x=>x.kind==="stop" && !x.done && x.t1>t); return sg ? {t:sg.t0>t?sg.t0:sg.t1, label: sg.t0>t?"Next stop in":"Stop done in"} : {t:tr.endAt, label:"Back at hub in"}; }
// Trip summary for a vehicle card in Fleet; the full trip (every load and countdown) lives under In progress on the job tabs.
function tripLine(v, tr, t, more=""){
  const n = openLoads(tr).length, tab = vehKind(v)==="air" ? "Air cargo jobs" : vehKind(v)==="rail" ? "Train jobs" : "Truck jobs";
  return `<div class="meta"><span>${n} load${n===1?"":"s"} on this trip</span><span>back in <span class="num" data-endat="${tr.endAt}">${dur(tr.endAt-t)}</span></span></div>
    <div class="btnrow"><button class="btn ghost sm" data-act="viewTrip" data-id="${v.id}">See trip in ${tab}</button><button class="btn ghost sm" data-act="follow" data-id="${tr.id}">Follow on map</button>${more}</div>`;
}
const renameRow = v => pendingConfirm===("ren"+v.id)?`<div class="btnrow"><input type="text" id="ren-${v.id}" maxlength="24" value="${esc(v.n)}" aria-label="New name for ${esc(v.n)}" style="flex:1;min-width:0;width:auto"><button class="btn sm" data-act="ren" data-id="${v.id}">Save</button><button class="btn ghost sm" data-act="cancel">Cancel</button></div>`:"";
function truckCard(v, t){
  const tr = tripOf(v), ty = TYPE[v.type], confirm = pendingConfirm===("sell"+v.id);
  const cap = ty.cars?`${ty.cap} cars`:`${ty.cap.toLocaleString("en-US")} lb`;
  return `<div class="card" id="vc-${v.id}"><div class="row"><b><span class="vic">${iconSvg(ty.mode||"truck",13)}</span>${esc(v.n)}</b>${tr?`<span class="status busy" data-ph="${tr.id}">${esc(phaseText(tr,t))}</span>`:`<span class="status idle">Idle</span>`}</div>
    <div class="meta"><span>${esc(ty.n)}</span><span class="num">${cap}</span><span class="num">${ty.leg} mi range</span><span>${v.jobs} jobs</span><span class="num">${Math.round(v.miles||0).toLocaleString("en-US")} mi lifetime</span></div>
    ${tr ? tripLine(v, tr, t, `<button class="btn ghost sm" data-act="askRen" data-id="${v.id}">Rename</button>`) : `<div class="btnrow"><button class="btn ghost sm" data-act="askRen" data-id="${v.id}">Rename</button>${S.vehicles.length>1&&!confirm?`<button class="btn ghost sm" data-act="askSell" data-id="${v.id}">Sell</button>`:""}${confirm?`<button class="btn warn sm" data-act="sell" data-id="${v.id}">Sell for ${money(ty.price*0.6)}</button><button class="btn ghost sm" data-act="cancel">Keep it</button>`:""}</div>`}
    ${renameRow(v)}</div>`;
}
function renderFleet(){
  const t = displayClock();
  let h = `<section class="sec"><h2>Fleet</h2><p class="hint">Vehicles by hub. Trips in progress, with every load and its countdown, are under <b>In progress</b> on the Truck, Train and Air cargo tabs.</p></section>`;
  for(const b of S.bases){
    const vs = S.vehicles.filter(v=>v.base===b.id && !isTrain(v) && !isPlane(v)), out = vs.filter(v=>tripOf(v)).length;
    h += `<section class="sec ${cz("f-hub-"+b.id)}">${secHead("f-hub-"+b.id, esc(baseName(b)), `<span class="hint num">${vs.length}/${hubCap(b)} · ${out} out</span>`)}
      <p class="hint" style="margin-top:-4px">${esc(baseAddr(b))}${b.dispatcher?" · dispatcher on":""}</p>
      ${vs.length?`<div class="list">${vs.map(v=>truckCard(v,t)).join("")}</div>`:`<p class="hint">No vehicles here yet. Buy one in Menu → Shop.</p>`}</section>`;
  }
  const planes = S.vehicles.filter(isPlane);
  if(planes.length){
    h += `<section class="sec ${cz("f-planes")}">${secHead("f-planes","Planes",`<span class="hint num">${planes.length} · ${planes.filter(v=>tripOf(v)).length} in the air</span>`)}<div class="list">`;
    for(const v of planes) h += planeCard(v, t);
    h += `</div></section>`;
  }
  const trains = S.vehicles.filter(isTrain);
  if(trains.length){
    h += `<section class="sec ${cz("f-trains")}">${secHead("f-trains","Trains",`<span class="hint num">${trains.length} · ${trains.filter(v=>tripOf(v)).length} on the road</span>`)}<div class="list">`;
    for(const v of trains) h += trainCard(v, t);
    h += `</div></section>`;
  }
  return h;
}
let flash = {id:null, until:0};
// Open the Fleet page at one vehicle: expand its section, scroll to it and highlight it.
// Open a vehicle's trip under In progress on its job tab (used by the map and the Fleet cards).
function viewTrip(vid){
  const v = S.vehicles.find(x=>x.id===vid); if(!v) return;
  if(!tripOf(v)) return focusVehicle(vid);
  const kind = vehKind(v), kp = kind==="air" ? "ja-" : kind==="rail" ? "jr-" : "jt-";
  collapsed.delete(kp+"active"); try{ localStorage.setItem("freight-dispatch-collapsed", JSON.stringify([...collapsed])); }catch(_){}
  setTab(kind==="air" ? "air" : kind==="rail" ? "rail" : "jobs");
  const el = document.getElementById("ip-"+vid); if(!el) return;
  el.scrollIntoView({block:"center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
  el.classList.add("flash"); setTimeout(()=>document.getElementById("ip-"+vid)?.classList.remove("flash"), 2600);
}
function focusVehicle(vid){
  const v = S.vehicles.find(x=>x.id===vid); if(!v) return;
  const keys = isPlane(v) ? ["f-planes"] : isTrain(v) ? ["f-trains"] : ["f-hub-"+v.base];
  keys.forEach(k=>collapsed.delete(k)); try{ localStorage.setItem("freight-dispatch-collapsed", JSON.stringify([...collapsed])); }catch(_){}
  setTab("fleet");
  const el = document.getElementById("vc-"+vid); if(!el) return;
  el.scrollIntoView({block:"center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
  flash = {id:vid, until:Date.now()+2500}; el.classList.add("flash");
  setTimeout(()=>document.getElementById("vc-"+vid)?.classList.remove("flash"), 2600);
}
function trainCard(v, t){
  const ty = TYPE[v.type], tr = tripOf(v), y = YARD[v.yard];
  const consist = Object.entries(v.cars||{}).filter(([,n])=>n).map(([k,n])=>`${n} × ${RAILCARS[k].n}`).join(" · ") || "No railcars yet. Add some below.";
  let h = `<div class="card" id="vc-${v.id}"><div class="row"><b><span class="vic">${iconSvg("train",13)}</span>${esc(v.n)}</b><span class="status ${tr?"busy":"idle"}" ${tr?`data-ph="${tr.id}"`:""}>${tr?esc(phaseText(tr,t)):"At the yard"}</span></div>
    <div class="meta"><span>${esc(ty.n)}</span><span>Home: ${esc(y.n)}, ${esc(y.city)} ${y.s}</span><span class="num">${trainCarCount(v)} of ${ty.maxCars} cars</span><span class="num">${ty.leg} mi range</span><span class="num">${Math.round(v.miles||0).toLocaleString("en-US")} mi lifetime</span></div>
    <p class="hint" style="margin:0;color:var(--ink)">${esc(consist)}</p>`;
  if(tr){
    h += tripLine(v, tr, t);
  } else if(trainCarCount(v) < ty.maxCars){
    h += `<div class="btnrow"><select id="ac-${v.id}" aria-label="Railcar to add to ${esc(v.n)}" style="flex:1;min-width:0;width:auto">${Object.entries(RAILCARS).map(([k,c])=>`<option value="${k}">${c.n} · ${money(c.price)} · ${c.unit?`${c.cap} containers`:`${c.cap.toLocaleString("en-US")} lb`}</option>`).join("")}</select><button class="btn sm" data-act="addCar" data-id="${v.id}">Add railcar</button></div>`;
  }
  const confirm = pendingConfirm===("sell"+v.id);
  h += `<div class="btnrow"><button class="btn ghost sm" data-act="askRen" data-id="${v.id}">Rename</button>${!tr&&!confirm?`<button class="btn ghost sm" data-act="askSell" data-id="${v.id}">Sell</button>`:""}${confirm?`<button class="btn warn sm" data-act="sell" data-id="${v.id}">Sell train for ${money(vehValue(v)*0.6)}</button><button class="btn ghost sm" data-act="cancel">Keep it</button>`:""}</div>
    ${pendingConfirm===("ren"+v.id)?`<div class="btnrow"><input type="text" id="ren-${v.id}" maxlength="24" value="${esc(v.n)}" aria-label="New name for ${esc(v.n)}" style="flex:1;min-width:0;width:auto"><button class="btn sm" data-act="ren" data-id="${v.id}">Save</button><button class="btn ghost sm" data-act="cancel">Cancel</button></div>`:""}</div>`;
  return h;
}
function planeCard(v, t){
  const ty = TYPE[v.type], tr = tripOf(v), a = AIRPORT[v.airport];
  let h = `<div class="card" id="vc-${v.id}"><div class="row"><b><span class="vic">${iconSvg("plane",13)}</span>${esc(v.n)}</b><span class="status ${tr?"busy":"idle"}" ${tr?`data-ph="${tr.id}"`:""}>${tr?esc(phaseText(tr,t)):"On the ground"}</span></div>
    <div class="meta"><span>${esc(ty.n)}</span><span>Home: ${esc(a.id)} ${esc(a.city)} ${a.s}</span><span class="num">${ty.cap.toLocaleString("en-US")} lb</span><span class="num">${ty.leg.toLocaleString("en-US")} mi range</span><span>${ty.lic==="pilot2"?"2 pilots":"1 pilot"}</span><span class="num">${Math.round(v.miles||0).toLocaleString("en-US")} mi lifetime</span></div>`;
  if(tr) h += tripLine(v, tr, t);
  const confirm = pendingConfirm===("sell"+v.id);
  h += `<div class="btnrow"><button class="btn ghost sm" data-act="askRen" data-id="${v.id}">Rename</button>${!tr&&!confirm?`<button class="btn ghost sm" data-act="askSell" data-id="${v.id}">Sell</button>`:""}${confirm?`<button class="btn warn sm" data-act="sell" data-id="${v.id}">Sell plane for ${money(vehValue(v)*0.6)}</button><button class="btn ghost sm" data-act="cancel">Keep it</button>`:""}</div>
    ${pendingConfirm===("ren"+v.id)?`<div class="btnrow"><input type="text" id="ren-${v.id}" maxlength="24" value="${esc(v.n)}" aria-label="New name for ${esc(v.n)}" style="flex:1;min-width:0;width:auto"><button class="btn sm" data-act="ren" data-id="${v.id}">Save</button><button class="btn ghost sm" data-act="cancel">Cancel</button></div>`:""}</div>`;
  return h;
}
function airportOptions(minSize){
  const hubs = S.bases.map(basePt);
  return AIRPORTS.filter(a=>a.size>=minSize).map(a=>({a, d:Math.round(Math.min(...hubs.map(h=>hav(h,a))))})).sort((x,y)=>x.d-y.d)
    .map(({a,d})=>`<option value="${a.id}">${a.id} · ${esc(a.n)}, ${esc(a.city)} ${a.s} · ${d} mi from your nearest hub</option>`).join("");
}
function renderPlaneShop(L_){
  if(L_ < AIR_LVL) return `<div class="card dim"><div class="row"><b>Planes</b><span class="lock">Level ${AIR_LVL}</span></div><p class="hint">Fly urgent freight between real US airports.</p></div>`;
  return `<p class="hint">Planes fly between real US airports. Each plane needs pilots (Menu → Crew). Regional jets and bigger only use mid-size airports or major cargo hubs.</p>
    ${PLANES.map(p=>{ const locked = p.lvl>L_, poor = S.cash<p.price;
      return `<div class="card ${locked?"dim":""}"><div class="row"><b><span class="vic">${iconSvg("plane",13)}</span>${esc(p.n)}</b><span class="num">${money(p.price)}</span></div>
        <div class="meta"><span class="num">${p.cap.toLocaleString("en-US")} lb</span><span class="num">${p.leg.toLocaleString("en-US")} mi range</span><span>${p.lic==="pilot2"?"2 pilots":"1 pilot"}</span><span>${p.minSize===1?"Any airport":p.minSize===2?"Mid-size airports and up":"Major cargo hubs only"}</span></div>
        ${locked?`<span class="lock">Unlocks at level ${p.lvl}</span>`:`<div class="btnrow"><select id="pa-${p.id}" aria-label="Home airport for ${esc(p.n)}" style="flex:1;min-width:0;width:auto">${airportOptions(p.minSize)}</select><button class="btn sm" data-act="buyPlane" data-id="${p.id}" ${poor?"disabled":""}>${poor?"Not enough cash":"Buy"}</button></div>`}</div>`; }).join("")}`;
}
function yardOptions(){
  const hubs = S.bases.map(basePt);
  return RAIL_YARDS.map(y=>({y, d:Math.round(Math.min(...hubs.map(h=>hav(h,y)*1.2)))})).sort((a,b)=>a.d-b.d)
    .map(({y,d})=>`<option value="${y.id}">${esc(y.n)}, ${esc(y.city)} ${y.s} · ${d} mi from your nearest hub</option>`).join("");
}
function renderTrainShop(L_){
  if(L_ < RAIL_LVL) return `<div class="card dim"><div class="row"><b>Trains</b><span class="lock">Level ${RAIL_LVL}</span></div><p class="hint">Run trains between real freight yards on real track.</p></div>`;
  const yo = yardOptions();
  return `<p class="hint">Trains run between real freight yards on real track. Each train needs a locomotive, railcars for the cargo, and an engineer (Menu → Crew). Add railcars from the train's card in the Fleet tab.</p>
    ${LOCOS.map(l=>{ const locked = l.lvl>L_, poor = S.cash<l.price;
      return `<div class="card ${locked?"dim":""}"><div class="row"><b><span class="vic">${iconSvg("train",13)}</span>${esc(l.n)}</b><span class="num">${money(l.price)}</span></div>
        <div class="meta"><span class="num">Up to ${l.maxCars} railcars</span><span class="num">${l.leg.toLocaleString("en-US")} mi range</span><span>Engineer</span></div>
        ${locked?`<span class="lock">Unlocks at level ${l.lvl}</span>`:`<div class="btnrow"><select id="ly-${l.id}" aria-label="Home yard for ${esc(l.n)}" style="flex:1;min-width:0;width:auto">${yo}</select><button class="btn sm" data-act="buyLoco" data-id="${l.id}" ${poor?"disabled":""}>${poor?"Not enough cash":"Buy"}</button></div>`}</div>`; }).join("")}
    <div class="card"><b>Railcars</b><table class="spec"><tbody>${Object.values(RAILCARS).map(c=>`<tr><td>${c.n} · ${c.cargo.map(x=>CARGO[x].n).join(", ")}</td><td>${money(c.price)}</td></tr>`).join("")}</tbody></table></div>`;
}
// Collapsible shop sections; remembered in this browser.
let collapsed = new Set(); try{ collapsed = new Set(JSON.parse(localStorage.getItem("freight-dispatch-collapsed")||"[]")); }catch(_){}
const cz = k => collapsed.has(k) ? "collapsed" : "";
function groupBtn(k, title){ const c = collapsed.has(k); return `<button class="collapse" data-act="toggleSec" data-k="${k}" aria-expanded="${!c}" title="${c?"Show":"Hide"} ${esc(title)}">${c?"+":"−"}</button>`; }
function secHead(k, title, extra=""){
  const c = collapsed.has(k);
  return `<div class="sec-head"><h2>${title}</h2><span class="sec-tools">${extra}<button class="collapse" data-act="toggleSec" data-k="${k}" aria-expanded="${!c}" title="${c?"Show":"Hide"} ${title.toLowerCase()}">${c?"+":"−"}</button></span></div>`;
}
function renderShop(){
  const L_ = level();
  let h = `<section class="sec ${cz("trucks")}">${secHead("trucks","Trucks",`<span class="hint">60% back when sold</span>`)}<div class="list">`;
  // Each hub option says how many of this vehicle type you already have there.
  const tName = (t, n) => { const w = t.n.replace(/ \(.*\)/,"").replace(/^Semi \+ /,"").toLowerCase(); return n===1 ? w : w.replace(/y$/,"ie")+"s"; };
  const baseOpts = t => S.bases.map(b=>{ const n = S.vehicles.filter(v=>v.base===b.id).length, k = S.vehicles.filter(v=>v.base===b.id && v.type===t.id).length, full = n>=hubCap(b);
    return `<option value="${b.id}" ${full?"disabled":""}>${esc(baseName(b))} · ${k ? `${k} ${tName(t,k)} owned` : `no ${tName(t,2)} yet`}${full?" · hub full":""}</option>`; }).join("");
  const anySlot = S.bases.some(b=>S.vehicles.filter(v=>v.base===b.id).length<hubCap(b));
  for(const t of TYPES){
    const locked = t.lvl>L_, poor = S.cash<t.price;
    h += `<div class="card ${locked?"dim":""}"><div class="row"><b><span class="vic">${iconSvg(t.mode,13)}</span>${esc(t.n)}</b><span class="num">${money(t.price)}</span></div>
      <div class="meta"><span class="num">${t.cars?t.cap+" cars":t.cap.toLocaleString("en-US")+" lb"}</span><span class="num">${t.leg} mi range</span><span>${t.cargo.map(c=>CARGO[c].n).join(", ")}</span><span>${t.lic==="std"?"Any driver":t.lic==="cdl"?"CDL driver":"2 CDL drivers"}</span>${(n=>n?`<span><b>You own ${n}</b></span>`:"")(S.vehicles.filter(v=>v.type===t.id).length)}</div>
      ${locked?`<span class="lock">Unlocks at level ${t.lvl}</span>`:`<div class="btnrow"><select aria-label="Hub for ${esc(t.n)}" id="bs-${t.id}" style="width:auto;flex:1;min-width:0">${baseOpts(t)}</select><button class="btn sm" data-act="buy" data-id="${t.id}" ${poor||!anySlot?"disabled":""}>${poor?"Not enough cash":!anySlot?"Hubs full":"Buy"}</button></div>`}</div>`;
  }
  h += `</div></section>`;
  const used = new Set(S.bases.map(b=>b.city));
  const cityOpts = Object.keys(STATES).map(s=>`<optgroup label="${STATES[s]}">${CITIES.filter(c=>c.s===s).map(c=>`<option value="${c.i}">${esc(c.n)}</option>`).join("")}</optgroup>`).join("");
  h += `<section class="sec ${cz("hubs")}">${secHead("hubs","Hubs")}
    <div class="card ${L_<GARAGE_LVL?"dim":""}"><div class="row"><b>Open a new hub</b><span class="num">${money(GARAGE_PRICE)}</span></div>
      <p class="hint">Opens a small hub (up to ${hubCap({tier:0})} vehicles at your level) with truck jobs posted within ${rangeMi()} miles (change this in Settings). Own as many hubs as you like, even several in one city.</p>
      <div class="btnrow"><button class="btn sm" data-act="placeHub" ${S.cash<GARAGE_PRICE?"disabled":""}>${S.cash<GARAGE_PRICE?"Not enough cash":"Pick a spot on the map"}</button></div></div>
    ${S.bases.map(b=>{const t=b.tier||0, nx=HUB_TIERS[t+1], n=S.vehicles.filter(v=>v.base===b.id).length;
      return `<div class="card"><div class="row"><b>${esc(baseName(b))}</b><span class="num">${n}/${hubCap(b)} vehicles</span></div>
      <div class="meta"><span>${esc(baseAddr(b))}</span><span>${HUB_TIERS[t].n}</span></div>
      ${pendingConfirm===("renh"+b.id)?`<div class="btnrow"><input type="text" id="renh-${b.id}" maxlength="28" value="${esc(baseName(b))}" aria-label="New name for ${esc(baseName(b))}" style="flex:1;min-width:0;width:auto"><button class="btn sm" data-act="renHub" data-id="${b.id}">Save</button><button class="btn ghost sm" data-act="cancel">Cancel</button></div>`:`<div class="btnrow"><button class="btn ghost sm" data-act="askRenHub" data-id="${b.id}">Rename hub</button>${hubMoveBtn(b)}</div>`}
      ${hubCap(b)<HUB_TIERS[t].cap&&nextSlotStep(L_)?`<p class="hint" style="margin:0">Room for ${Math.min(HUB_TIERS[t].cap,nextSlotStep(L_)[1])} vehicles at level ${nextSlotStep(L_)[0]}.</p>`:""}
      <div class="btnrow">${!nx?`<span class="lock">Largest size</span>`:nx.lvl>L_?`<span class="lock">${nx.n} (up to ${nx.cap} vehicles) unlocks at level ${nx.lvl}</span>`:`<button class="btn ghost sm" data-act="slot" data-id="${b.id}" ${S.cash<nx.price?"disabled":""}>Upgrade to ${nx.n} (up to ${nx.cap} vehicles) · ${money(nx.price)}</button>`}</div></div>`;}).join("")}
  </section>
  <section class="sec ${cz("trains")}">${secHead("trains","Trains")}${renderTrainShop(L_)}</section>
  <section class="sec ${cz("planes")}">${secHead("planes","Planes")}${renderPlaneShop(L_)}</section>`;
  return h;
}
// Drop open truck jobs whose pickup is now out of range of every hub (after a range change or a hub move).
function pruneOutOfRange(){
  const n0 = S.jobs.length;
  S.jobs = S.jobs.filter(j=>jobKind(j)!=="truck" || j.id===selectedJob || S.bases.some(b=>hav(basePt(b), j.from)<=rangeMi()));
  if(S.jobs.length!==n0) S.nextJobAt = 0;
}
// Moving a hub: only when none of its trucks are out on a trip, since their routes end at the old address.
const hubBusy = b => S.vehicles.some(v=>v.base===b.id && !isTrain(v) && !isPlane(v) && tripOf(v));
const movePrice = b => MOVE_HUB_PRICE[b.tier||0];
function hubMoveBtn(b){
  const busy = hubBusy(b), poor = S.cash < movePrice(b);
  return `<button class="btn ghost sm" data-act="moveHub" data-id="${b.id}" ${busy||poor?"disabled":""} title="${busy?"Wait until this hub's trucks are back":""}">${busy?"Move hub (trucks out)":poor?`Move hub · ${money(movePrice(b))} (not enough cash)`:`Move hub · ${money(movePrice(b))}`}</button>`;
}
function renderCrew(){
  const L_ = level();
  let h = `<section class="sec ${cz("c-hire")}">${secHead("c-hire","Hire")}
    <div class="card"><div class="row"><b>Driver</b><span class="num">${money(1000)}</span></div><p class="hint">Drives vans, box trucks and reefer box trucks. One-time hiring fee, no cut of the pay.</p>
      <div class="btnrow"><button class="btn sm" data-act="hire" data-kind="std" ${S.cash<1000?"disabled":""}>Hire driver</button></div></div>
    <div class="card ${L_<6?"dim":""}"><div class="row"><b>CDL driver</b><span class="num">${money(5000)}</span></div><p class="hint">Drives every truck, including semis. One-time hiring fee, no cut of the pay.</p>
      ${L_<6?`<span class="lock">Unlocks at level 6</span>`:`<div class="btnrow"><button class="btn sm" data-act="hire" data-kind="cdl" ${S.cash<5000?"disabled":""}>Hire CDL driver</button></div>`}</div>
    <div class="card ${L_<RAIL_LVL?"dim":""}"><div class="row"><b>Engineer</b><span class="num">${money(ENGINEER.fee)}</span></div><p class="hint">Drives one train. One-time hiring fee, no cut of the pay.</p>
      ${L_<RAIL_LVL?`<span class="lock">Unlocks at level ${RAIL_LVL}</span>`:`<div class="btnrow"><button class="btn sm" data-act="hire" data-kind="eng" ${S.cash<ENGINEER.fee?"disabled":""}>Hire engineer</button></div>`}</div>
    <div class="card ${!airOpen()?"dim":""}"><div class="row"><b>Pilot</b><span class="num">${money(PILOT.fee)}</span></div><p class="hint">Flies planes. Prop planes and turboprops need 1 pilot; jets need 2. One-time hiring fee, no cut of the pay.</p>
      ${!airOpen()?`<span class="lock">Unlocks at level ${AIR_LVL}</span>`:`<div class="btnrow"><button class="btn sm" data-act="hire" data-kind="pilot" ${S.cash<PILOT.fee?"disabled":""}>Hire pilot</button></div>`}</div>
  </section>
  <section class="sec ${cz("c-drivers")}">${secHead("c-drivers","Drivers",`<span class="hint num">${S.drivers.length} · ${S.drivers.filter(d=>!d.busy).length} free</span>`)}<div class="list">`;
  for(const d of S.drivers){
    h += `<div class="card"><div class="row"><b>${esc(d.name)}</b><span class="status ${d.busy?"busy":"idle"}">${d.busy?"On a job":"Free"}</span></div>
      <div class="meta"><span>${DRIVER_KIND[d.kind].n}${d.hazmat?" · hazmat":""}</span><span>${d.jobs} jobs driven</span></div>
      ${d.kind==="cdl"&&!d.hazmat&&L_>=18?`<div class="btnrow"><button class="btn ghost sm" data-act="hazmat" data-id="${d.id}" ${S.cash<HAZMAT_PRICE||d.busy?"disabled":""}>Hazmat training · ${money(HAZMAT_PRICE)}</button></div>`:""}</div>`;
  }
  h += `</div></section><section class="sec ${cz("c-disp")}">${secHead("c-disp","Dispatchers",`<span class="hint num">${S.bases.filter(b=>b.dispatcher).length} on duty</span>`)}<p class="hint">A dispatcher sends idle vehicles at one hub on the best-paying job they can take, even while you are away. Takes 5% of the jobs they assign.</p>`;
  if(L_<DISPATCH_LVL) h += `<div class="card dim"><span class="lock">Unlocks at level ${DISPATCH_LVL}</span></div>`;
  else h += S.bases.map(b=>`<div class="card"><div class="row"><b>${esc(baseName(b))}</b><span class="status ${b.dispatcher?"idle":""}">${b.dispatcher?"Dispatcher on duty":"No dispatcher"}</span></div>
      <div class="btnrow">${b.dispatcher?`<button class="btn ghost sm" data-act="disp" data-id="${b.id}">Let go</button>`:`<button class="btn sm" data-act="disp" data-id="${b.id}" ${S.cash<DISPATCH_PRICE?"disabled":""}>Hire · ${money(DISPATCH_PRICE)}</button>`}</div></div>`).join("");
  return h + `</section>`;
}
function renderLog(){
  const items = (S.log||[]).slice(-20).reverse();
  const fmt = t => new Date(t).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit"});
  return `<section class="sec"><div class="sec-head"><h2>Activity log</h2><span class="hint num">${items.length} entries</span></div>
    <p class="hint">Everything your company does: new jobs, dispatches, pickups, deliveries, purchases and level-ups. Newest first, last 20 kept.</p>
    ${items.length?`<ol class="log">${items.map(e=>`<li><time class="num">${fmt(e.t)}</time><span>${e.h}</span></li>`).join("")}</ol>`:`<p class="hint">Nothing yet. Dispatch a job and it shows up here.</p>`}</section>`;
}
function levelBar(){
  const L_ = level(), need = xpNeed(L_+1), nxt = Object.entries(UNLOCKS).find(([k])=>+k>L_);
  return `<section class="sec"><div class="sec-head"><h3>Level ${L_} → ${L_+1}</h3><span class="hint num">${Math.floor(S.xp-xpNeed(L_)).toLocaleString("en-US")} / ${(need-xpNeed(L_)).toLocaleString("en-US")} XP</span></div>
    <div class="prog"><i style="width:${Math.min(100,(S.xp-xpNeed(L_))/(need-xpNeed(L_))*100)}%;background:var(--sign)"></i></div>
    <p class="hint">${Math.ceil(need-S.xp).toLocaleString("en-US")} XP to level ${L_+1}. Each delivery earns 1 XP per $100 it pays.${nxt?` Next unlock: ${esc(nxt[1])} at level ${nxt[0]}.`:""}</p></section>`;
}
/* ---------------- Settings: header color (saved in this browser) ---------------- */
const HEADER_COLORS = [["Green","#1e5a3c"],["Red","#a3262a"],["Blue","#1f4fa3"],["Navy","#1b2a4a"],["Purple","#5b2d8c"],["Orange","#b85a12"],["Teal","#0f6b6b"],["Charcoal","#2b2f33"]];
function headerColor(){ try{ return localStorage.getItem("freight-dispatch-header") || ""; }catch(_){ return ""; } }
function applyHeaderColor(hex){
  const r = document.documentElement.style;
  if(!/^#[0-9a-f]{6}$/i.test(hex||"")){ ["--hdr","--hdr-ink","--hdr-line"].forEach(p=>r.removeProperty(p)); return; }
  const [R_,G,B] = [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4));
  const light = 0.2126*R_ + 0.7152*G + 0.0722*B > 0.35;     // light colors get dark text
  r.setProperty("--hdr", hex); r.setProperty("--hdr-ink", light ? "#16201d" : "#f6f8f7");
  r.setProperty("--hdr-line", `color-mix(in srgb, ${hex} 55%, ${light ? "#000" : "#fff"})`);
}
function setHeaderColor(hex){ try{ hex ? localStorage.setItem("freight-dispatch-header", hex) : localStorage.removeItem("freight-dispatch-header"); }catch(_){} applyHeaderColor(hex); }
/* New-job chime, made with Web Audio (no sound files). Browsers only allow sound after you tap the page once. */
let audioCtx = null, lastChime = 0;
function soundOn(){ try{ return localStorage.getItem("freight-dispatch-sound") !== "off"; }catch(_){ return true; } }
function unlockAudio(){ try{ audioCtx ||= new (window.AudioContext||window.webkitAudioContext)(); if(audioCtx.state==="suspended") audioCtx.resume(); }catch(_){} }
document.addEventListener("pointerdown", unlockAudio, {passive:true});
document.addEventListener("keydown", unlockAudio);
function chime(kind, force){
  if(!force && (!soundOn() || Date.now()-lastChime < 4000)) return;
  if(!audioCtx || audioCtx.state!=="running") return;
  lastChime = Date.now();
  const notes = kind==="air" ? [784, 1175] : kind==="rail" ? [523, 659] : [659, 988];   // two quick notes, a different pair per board
  const t0 = audioCtx.currentTime;
  notes.forEach((f, i)=>{
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = t0 + i*0.13;
    o.type = "sine"; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t+0.015); g.gain.exponentialRampToValueAtTime(0.0001, t+0.35);
    o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t+0.4);
  });
}
function renderSettings(){
  const cur = (headerColor() || HEADER_COLORS[0][1]).toLowerCase();
  return `<section class="sec"><h2>Settings</h2><p class="hint">Settings are saved in this browser.</p></section>
    <section class="sec"><h3>Truck job range</h3>
      <p class="hint">How far from a hub truck pickups can be. New truck jobs post inside this ring, and a truck only takes pickups within this distance of its own hub. Deliveries can still go farther. Trains and planes keep their own ranges.</p>
      <div class="seg" role="group" aria-label="Truck job range">${RANGE_OPTS.map(m=>`<button data-act="range" data-m="${m}" aria-pressed="${rangeMi()===m}">${m} mi</button>`).join("")}</div>
    </section>
    <section class="sec"><h3>Sounds</h3>
      <p class="hint">Plays a chime when a new job posts that one of your vehicles can take right now. Phones on silent stay quiet.</p>
      <div class="seg" role="group" aria-label="New job sound">${[["on","On"],["off","Off"]].map(([k,n])=>`<button data-act="sound" data-v="${k}" aria-pressed="${soundOn()===(k==="on")}">${n}</button>`).join("")}</div>
      <div class="btnrow"><button class="btn ghost sm" data-act="testSound">Play test sound</button></div>
    </section>
    <section class="sec"><h3>Header color</h3>
      <div class="swatches">${HEADER_COLORS.map(([n,c])=>`<button class="swatch" data-act="hdrColor" data-c="${c}" aria-pressed="${cur===c.toLowerCase()}"><i style="background:${c}"></i>${n}</button>`).join("")}</div>
      <label class="custom-color"><input type="color" id="hdrCustom" value="${cur}"> Pick any color</label>
      <div class="btnrow"><button class="btn ghost sm" data-act="hdrColor" data-c="">Reset to green</button></div>
    </section>`;
}
applyHeaderColor(headerColor());
const unlockText = L => { const st = L>1 && SLOT_STEPS.find(([l])=>l===L); return [UNLOCKS[L], st && `Hubs hold up to ${st[1]} vehicles`].filter(Boolean).join(", "); };
function renderCompany(){
  const L_ = level(), reset = pendingConfirm==="reset";
  return `<section class="sec"><h2>${esc(S.company)}</h2></section>${levelBar()}<section class="sec">
    <table class="spec"><tbody>
      <tr><td>Level</td><td>${L_}</td></tr>
      <tr><td>Total XP</td><td>${Math.floor(S.xp).toLocaleString("en-US")}</td></tr>
      <tr><td>XP to level ${L_+1}</td><td>${Math.ceil(xpNeed(L_+1)-S.xp).toLocaleString("en-US")}</td></tr>
      <tr><td>Next unlock</td><td style="font-family:var(--body)">${esc(unlockText([...Array(50)].map((_,i)=>i+1).find(L=>L>L_&&unlockText(L)))||"All unlocked")}</td></tr>
      <tr><td>Deliveries</td><td>${S.jobsDone.toLocaleString("en-US")}</td></tr>
      <tr><td>Earned</td><td>${money(S.earned)}</td></tr>
      <tr><td>Hubs</td><td>${S.bases.length}</td></tr>
      <tr><td>Home state</td><td style="font-family:var(--body)">${STATES[S.homeState]}</td></tr>
    </tbody></table></section>
    <section class="sec"><h3>XP needed for each level</h3>
      <div style="overflow-x:auto"><table class="spec lvtab"><thead><tr><td>Level</td><td>XP for this level</td><td>Total XP</td><td>Unlocks</td></tr></thead><tbody>
      ${[...Array(29)].map((_,i)=>i+2).concat([35,40,45,50]).map(L=>`<tr class="${L===L_+1?"next":""} ${L<=L_?"done":""}"><td>${L}</td><td>${(xpNeed(L)-xpNeed(L-1)).toLocaleString("en-US")}</td><td>${xpNeed(L).toLocaleString("en-US")}</td><td>${esc(unlockText(L))}</td></tr>`).join("")}
      </tbody></table></div></section>
    <section class="sec"><h3>Goals</h3><ul class="goals">${goals().map(x=>`<li class="${x[1]?"done":""}">${esc(x[0])}</li>`).join("")}</ul></section>
    <section class="sec"><h3>Clock speed</h3><p class="hint">Speeds up every trip. Handy for testing the economy; away time always counts at normal speed.</p>
      <div class="seg" role="group" aria-label="Clock speed">${[1,3,10].map(s=>`<button data-act="speed" data-s="${s}" aria-pressed="${S.speed===s}">${s}×</button>`).join("")}</div></section>
    <section class="sec"><h3>Away from the game</h3><p class="hint">Trips in progress always finish. Hubs with a dispatcher keep working at full pay for 4 hours, half pay up to 12 hours, then wait for you.</p></section>
    <section class="sec"><h3>Test mode</h3><p class="hint">For trying new features: jump to any level and add cash. Turn it off before other people play.</p>
      <label class="testtoggle"><input type="checkbox" id="testToggle" ${S.test?"checked":""}> Test mode</label>
      ${S.test?`<div class="btnrow"><select id="testLvl" aria-label="Level" style="width:auto">${Array.from({length:50},(_,i)=>i+1).map(n=>`<option value="${n}" ${n===L_?"selected":""}>Level ${n}</option>`).join("")}</select><button class="btn sm" data-act="setLvl">Set level</button></div>
      <div class="btnrow"><button class="btn ghost sm" data-act="addCash" data-n="100000">+ $100,000</button><button class="btn ghost sm" data-act="addCash" data-n="1000000">+ $1,000,000</button></div>`:""}</section>
    <section class="sec"><h3>Start a new game</h3><p class="hint">Erases this company and its progress in this browser, then lets you pick a new home state and garage.</p><div class="btnrow">${reset?`<button class="btn warn sm" data-act="reset">Erase company and start new</button><button class="btn ghost sm" data-act="cancel">Cancel</button>`:`<button class="btn ghost sm" data-act="askReset">Start new game</button>`}</div></section>`;
}
function renderHeader(){
  const L_ = level(), a = xpNeed(L_), b = xpNeed(L_+1);
  $("#hdrCo").textContent = S.company + (AL?.alliance && S.alliance===AL.alliance.id ? ` [${AL.alliance.tag}]` : "");
  $("#hdrCash").textContent = money(S.cash);
  $("#hdrLvl").textContent = `Level ${L_} · ${Math.floor(S.xp-a).toLocaleString("en-US")}/${(b-a).toLocaleString("en-US")} XP`;
  $("#hdrXp").style.width = (L_>=50?100:Math.min(100,(S.xp-a)/(b-a)*100)) + "%";
  // Each job tab shows how many jobs are ready to run right now (shown once that kind of job is unlocked).
  for(const [id, kind, lvl] of [["#jobBadge","truck",1], ["#railBadge","rail",RAIL_LVL], ["#airBadge","air",airOpen() ? 1 : AIR_LVL]]){
    const b = $(id); b.textContent = S.jobs.filter(j=>jobKind(j)===kind && jobStatus(j).can).length; b.hidden = level() < lvl;
  }
  const cc = claimableCount(); for(const id of ["#taskBadge","#taskBadge2"]){ const tb = $(id); tb.textContent = cc; tb.hidden = !cc; }
}
function renderPanel(){
  if(!S) return;
  const body = $("#panelBody"), st = body.scrollTop;
  const ae = document.activeElement, keep = ae && ae.id && body.contains(ae) && ae.tagName==="INPUT" ? {id:ae.id, v:ae.value, a:ae.selectionStart, b:ae.selectionEnd} : null;
  body.innerHTML = tab==="jobs"?renderJobs("truck"):tab==="rail"?renderJobs("rail"):tab==="air"?renderJobs("air"):tab==="fleet"?renderFleet():tab==="shop"?renderShop():tab==="crew"?renderCrew():tab==="log"?renderLog():tab==="tasks"?renderTasks():tab==="settings"?renderSettings():tab==="contracts"?renderContracts():tab==="account"?renderAccount():tab==="alliance"?renderAlliance():renderCompany();
  body.scrollTop = st;
  if(Date.now() < flash.until) document.getElementById("vc-"+flash.id)?.classList.add("flash");
  if(keep){ const el = document.getElementById(keep.id); if(el){ el.value = keep.v; el.focus(); try{ el.setSelectionRange(keep.a, keep.b); }catch(_){} } }
  renderHeader();
}
function liveText(){
  if(!S) return;
  const t = displayClock();
  document.querySelectorAll("[data-exp]").forEach(e=>e.textContent=dur(+e.dataset.exp - S.clock));
  document.querySelectorAll("[data-due]").forEach(e=>e.textContent=dur(+e.dataset.due - t));
  document.querySelectorAll("[data-dueprog]").forEach(e=>{ const d=+e.dataset.dueprog, s0=+e.dataset.start; e.style.width = Math.min(100, Math.max(0, (t-s0)/Math.max(1,d-s0)*100))+"%"; });
  document.querySelectorAll("[data-endat]").forEach(e=>{ e.textContent = dur(+e.dataset.endat - t); });
  document.querySelectorAll("[data-eta]").forEach(e=>{const tr=S.trips.find(x=>x.id===e.dataset.eta); if(tr) e.textContent=dur(nextStopAt(tr,t).t-t);});
  document.querySelectorAll("[data-prog]").forEach(e=>{const tr=S.trips.find(x=>x.id===e.dataset.prog); if(tr) e.style.width=Math.min(100,(t-tr.startAt)/((tr.endAt-tr.startAt)||1)*100)+"%";});
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
  if(a==="acceptContract"){ acceptContract(id); save(); drawJobs(); refresh(); return; }
  if(a==="askDrop"){ pendingConfirm="drop"+id; renderPanel(); return; }
  if(a==="dropContract"){ const C=ensureContracts(), c=C.active.find(x=>x.id===id); if(c){ c.deadline = S.clock - 1; contractTick(); pendingConfirm=null; save(); drawJobs(); refresh(); } return; }
  if(a==="viewTrip"){ viewTrip(id); return; }
  if(a==="sortDir"){ jobSort.dir = jobSort.dir==="asc" ? "desc" : "asc"; saveSort(); renderPanel(); return; }
  if(a==="unsel"){ selectedJob=null; drawJobs(); renderPanel(); return; }
  if(a==="tab"){ setTab(el.dataset.tab); return; }
  if(a==="follow"){ following = id; const tr=S.trips.find(x=>x.id===id); if(tr) map.flyTo(posOf(tr,displayClock()).ll, Math.max(map.getZoom(),13), {duration:.6}); return; }
  if(a==="go"){
    const j = S.jobs.find(x=>x.id===id), v = S.vehicles.find(x=>x.id===chosenVeh);
    if(j && v && dispatch(j,v)){
      let n = 1;
      for(const id of extraSel){ const x = S.jobs.find(y=>y.id===id); if(x && dispatch(x, v)) n++; }
      extraSel = new Set();
      toast(n>1 ? `<b>${esc(v.n)}</b> dispatched with ${n} loads, first stop ${esc(j.from.name||j.from.biz)}` : `<b>${esc(v.n)}</b> dispatched to ${esc(j.from.name||j.from.biz)}, ${esc(cityName(j.from.c))}`);
      selectedJob=null; save(); drawJobs(); renderPanel();
    }
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
  if(a==="moveHub"){ const b=baseById(id); if(b && !hubBusy(b) && S.cash>=movePrice(b)){ startPlacement({first:false, move:b.id}); const p=basePt(b); map.flyTo([p.lat,p.lon], 10, {duration:.6}); } return; }
  if(a==="placeHub"){ if(S.cash>=GARAGE_PRICE) startPlacement({first:false}); return; }
  if(a==="askRenHub"){ pendingConfirm="renh"+id; renderPanel(); const inp=$("#renh-"+id); if(inp){ inp.focus(); inp.select(); } return; }
  if(a==="renHub"){ const b=baseById(id), inp=$("#renh-"+id); const n=(inp?.value||"").trim().slice(0,28); if(b&&n&&n!==baseName(b)){ logEvent(`Renamed hub <b>${esc(baseName(b))}</b> to <b>${esc(n)}</b>`); b.name=n; save(); drawBases(); } pendingConfirm=null; refresh(); return; }

  if(a==="slot"){ const b=baseById(id), nx=b&&HUB_TIERS[(b.tier||0)+1]; if(nx&&S.cash>=nx.price&&level()>=nx.lvl){S.cash-=nx.price;b.tier=(b.tier||0)+1;toast(`${esc(baseName(b))} is now a ${nx.n.toLowerCase()}`);save();refresh();} return; }
  if(a==="disp"){ const b=baseById(id); if(!b) return; if(b.dispatcher) b.dispatcher=false; else if(S.cash>=DISPATCH_PRICE){S.cash-=DISPATCH_PRICE;b.dispatcher=true;} save(); refresh(); return; }
  if(a==="askRen"){ pendingConfirm="ren"+id; renderPanel(); const inp=$("#ren-"+id); if(inp){ inp.focus(); inp.select(); } return; }
  if(a==="ren"){ const v=S.vehicles.find(x=>x.id===id), inp=$("#ren-"+id); const n=(inp?.value||"").trim().slice(0,24); if(v&&n&&n!==v.n){ logEvent(`Renamed <b>${esc(v.n)}</b> to <b>${esc(n)}</b>`); v.n=n; save(); } pendingConfirm=null; refresh(); return; }
  if(a==="claimLogin"){ claimLogin(); save(); refresh(); return; }
  if(a==="claimTask"){ claimTask(id); save(); refresh(); return; }
  if(a==="claimBonus"){ claimBonus(); save(); refresh(); return; }
  if(a==="claimMs"){ claimMilestone(+el.dataset.n); save(); refresh(); return; }
  if(a==="buyLoco"){
    const l = TYPE[id], y = $("#ly-"+id)?.value; if(!l || !YARD[y] || S.cash < l.price || level() < l.lvl) return;
    S.cash -= l.price; const n = S.vehicles.filter(isTrain).length + 1;
    S.vehicles.push({id:nid("v"), type:l.id, yard:y, cars:{}, n:`Train ${n}`, busy:false, jobs:0, miles:0});
    toast(`Bought a ${esc(l.n.toLowerCase())} at ${esc(YARD[y].n)}. Add railcars in the Fleet tab${S.drivers.some(d=>d.kind==="eng")?"":" and hire an engineer"}.`, 6000);
    drawYards(); save(); refresh(); return;
  }
  if(a==="buyPlane"){
    const p = TYPE[id], ap = $("#pa-"+id)?.value; if(!p || !AIRPORT[ap] || S.cash < p.price || level() < p.lvl) return;
    S.cash -= p.price; const n = S.vehicles.filter(isPlane).length + 1;
    S.vehicles.push({id:nid("v"), type:p.id, airport:ap, n:`Plane ${n}`, busy:false, jobs:0, miles:0});
    const pilots = S.drivers.filter(d=>d.kind==="pilot").length, need = p.lic==="pilot2" ? 2 : 1;
    toast(`Bought a ${esc(p.n.toLowerCase())} at ${esc(AIRPORT[ap].n)}.${pilots<need?` Hire ${need===2?"2 pilots":"a pilot"} in Menu → Crew to fly it.`:""}`, 6000);
    drawYards(); save(); refresh(); return;
  }
  if(a==="addCar"){
    const v = S.vehicles.find(x=>x.id===id), ct = $("#ac-"+id)?.value, c = RAILCARS[ct];
    if(!v || !c || tripOf(v) || S.cash < c.price || trainCarCount(v) >= TYPE[v.type].maxCars) { if(c && S.cash < c.price) toast("Not enough cash for that railcar."); return; }
    S.cash -= c.price; v.cars[ct] = (v.cars[ct]||0) + 1; toast(`Added a ${esc(c.n.toLowerCase())} to ${esc(v.n)}`); save(); refresh(); return;
  }
  if(a==="setLvl"){ if(!S.test) return; const L_ = +$("#testLvl").value; S.xp = xpNeed(L_); logEvent(`Test mode: set to level ${L_}`); drawYards(); save(); refresh(); return; }
  if(a==="addCash"){ if(!S.test) return; const n = +el.dataset.n; S.cash += n; logEvent(`Test mode: added ${money(n)}`); save(); refresh(); return; }
  if(a==="toggleSec"){ const k = el.dataset.k; collapsed.has(k) ? collapsed.delete(k) : collapsed.add(k); try{ localStorage.setItem("freight-dispatch-collapsed", JSON.stringify([...collapsed])); }catch(_){} renderPanel(); return; }
  if(a==="range"){ const m=+el.dataset.m; if(RANGE_OPTS.includes(m)){ S.range=m; pruneOutOfRange(); drawBases(); drawJobs(); save(); refresh(); toast(`Truck jobs now post within ${m} mi of your hubs`); } return; }
  if(a.startsWith("al") && alAct(a, id, el)) return;
  if(a==="askKick"||a==="askLeave"){ alAct(a, id, el); return; }
  if(a==="cloudSave"){ cloudPush(true); return; }
  if(a==="signOut"){ cloudPush(true).finally(()=>window.Cloud?.signOut()); toast("Signed out. This device keeps a copy of your company."); return; }
  if(a==="sound"){ try{ localStorage.setItem("freight-dispatch-sound", el.dataset.v); }catch(_){} renderPanel(); return; }
  if(a==="testSound"){ unlockAudio(); setTimeout(()=>chime("truck", true), 50); return; }
  if(a==="hdrColor"){ setHeaderColor(el.dataset.c); renderPanel(); return; }
  if(a==="askSell"){ pendingConfirm="sell"+id; renderPanel(); return; }
  if(a==="sell"){ const v=S.vehicles.find(x=>x.id===id); if(v&&!tripOf(v)){S.cash+=vehValue(v)*0.6; S.vehicles=S.vehicles.filter(x=>x!==v);} pendingConfirm=null; save(); refresh(); return; }
  if(a==="cancel"){ pendingConfirm=null; renderPanel(); return; }
  if(a==="speed"){ syncClock(); S.speed=+el.dataset.s; save(); renderPanel(); return; }
  if(a==="askReset"){ pendingConfirm="reset"; renderPanel(); return; }
  if(a==="reset"){
    try{localStorage.removeItem(KEY);}catch(_){}
    S=null; selectedJob=null; pendingConfirm=null; following=null;
    [layerJobs,layerBases,layerRings,layerVeh,layerRoutes,layerSel,layerStops].forEach(l=>l.clearLayers()); stopMarkers.clear(); jobMarkers.clear(); vehMarkers.clear(); tripLines.clear();
    $("#panelBody").innerHTML=""; $("#hdrCash").textContent="$0"; $("#hdrLvl").textContent="Level 1"; $("#hdrXp").style.width="0%"; $("#jobBadge").textContent="0"; $("#hdrCo").textContent="New company"; endPlacement(); showStart(); return;
  }
});
$("#panelBody").addEventListener("keydown", e=>{ if(e.key==="Enter" && e.target.id?.startsWith("ren-")){ e.preventDefault(); $(`[data-act=ren][data-id="${e.target.id.slice(4)}"]`)?.click(); }
  if(e.key==="Enter" && e.target.id?.startsWith("renh-")){ e.preventDefault(); $(`[data-act=renHub][data-id="${e.target.id.slice(5)}"]`)?.click(); } if(e.key==="Escape" && e.target.id?.startsWith("ren-")){ pendingConfirm=null; renderPanel(); } });
$("#panelBody").addEventListener("input", e=>{ if(e.target.id==="alSearch"){ alSearch = e.target.value; renderPanel(); } });
$("#panelBody").addEventListener("change", e=>{ if(e.target.name==="veh") chosenVeh=e.target.value; if(e.target.id==="jobSort"){ jobSort = {k:e.target.value, dir:SORTS[e.target.value][1]}; saveSort(); renderPanel(); }
  if(e.target.id==="vehPick"){ chosenVeh = e.target.value || null; extraSel = new Set(); renderPanel(); }
  if(e.target.name==="extra"){ e.target.checked ? extraSel.add(e.target.value) : extraSel.delete(e.target.value); const y=$("#panelBody").scrollTop; renderPanel(); $("#panelBody").scrollTop=y; } if(e.target.id==="hdrCustom"){ setHeaderColor(e.target.value); renderPanel(); } if(e.target.id==="testToggle"){ S.test = e.target.checked; save(); renderPanel(); } });
document.querySelectorAll(".tab[data-tab]").forEach(b=>b.addEventListener("click",()=>{ closeMenu(); setTab(b.dataset.tab); }));
// Menu dropdown for Fleet, Shop, Crew, Tasks, Log and Company
function closeMenu(){ $("#menu").hidden = true; $("#menuBtn").setAttribute("aria-expanded","false"); }
$("#menuBtn").addEventListener("click", e=>{ e.stopPropagation(); const open = $("#menu").hidden; $("#menu").hidden = !open; $("#menuBtn").setAttribute("aria-expanded", open); if(open) $("#menu .menuitem")?.focus(); });
document.querySelectorAll(".menuitem").forEach(b=>b.addEventListener("click", ()=>{ closeMenu(); setTab(b.dataset.tab); $("#menuBtn").focus(); }));
document.addEventListener("click", e=>{ if(!e.target.closest(".menuwrap")) closeMenu(); });
document.addEventListener("keydown", e=>{ if(e.key==="Escape" && !$("#menu").hidden){ closeMenu(); $("#menuBtn").focus(); } });

function logEvent(html, when){ if(!S) return; (S.log ||= []).push({t: when||Date.now(), h: html}); if(S.log.length>20) S.log.splice(0, S.log.length-20); if(tab==="log" && !simulating) renderPanel(); }
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
  $("#startOv").hidden = false; renderStartAuth();
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
  const mvB = p.move && baseById(p.move);
  const defName = keepName || (mvB ? baseName(mvB) : p.first ? "HQ" : `Hub ${S ? S.bases.length+1 : 2}`);
  let body;
  if(!p.pt) body = `<p class="hint" style="color:var(--ink)">Click anywhere on the map${stName?` in ${esc(stName)}`:""} to ${mvB?`move ${esc(baseName(mvB))}`:`place your ${p.first?"first ":""}hub`}. Zoom in to pick a street.${mvB?` Moving costs ${money(movePrice(mvB))}. Its vehicles and crew come along.`:""}</p>`;
  else if(p.looking) body = `<p class="addr">Looking up the address…</p>`;
  else {
    const wrongState = p.first && p.info.state && p.info.state !== p.state;
    const notUS = !p.info.us || !p.info.state;
    const mv = p.move && baseById(p.move);
    const cost = p.first ? "Free" : mv ? money(movePrice(mv)) : money(GARAGE_PRICE);
    body = `<p class="addr"><b>${esc(p.info.line)}</b></p>
      ${notUS?`<p class="need" style="margin:0">Pick a spot in the lower 48 states.</p>`:wrongState?`<p class="need" style="margin:0">That spot is in ${esc(STATES[p.info.state]||p.info.state)}. Pick a spot in ${esc(stName)}, or start over to change your home state.</p>`:""}
      <label class="fld">Hub name<input type="text" id="hubName" maxlength="28" value="${esc(defName)}"></label>
      <div class="btnrow"><button class="btn" id="placeGo" ${wrongState||notUS?"disabled":""}>${mvB?"Move hub here":"Build hub here"} · ${cost}</button><span class="hint">or click the map to move it</span></div>`;
  }
  bar.innerHTML = `<h2>${p.first?"Place your first hub":mvB?`Move ${esc(baseName(mvB))}`:"Place a new hub"}</h2>${body}${p.first?"":`<div class="btnrow"><button class="btn ghost sm" id="placeCancel">Cancel</button></div>`}`;
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
    tab = "jobs"; ensureDay(); afterLoad(); setTimeout(showLoginPopup, 1200);
    map.flyTo([p.pt.lat,p.pt.lon], 11, {duration:1});
    toast(`${esc(name)} is open at ${esc(p.info.line)}. ${esc(S.drivers[0].name)} is waiting with your van.`, 6000);
    save(); return;
  }
  if(p.move){
    const b = baseById(p.move), price = b && movePrice(b);
    if(!b){ endPlacement(); return; }
    if(hubBusy(b)){ toast("Wait until this hub's trucks are back before moving it."); return; }
    if(S.cash < price){ toast("Not enough cash to move this hub."); return; }
    S.cash -= price; b.pt = p.pt; b.addr = p.info.line; b.city = city; b.name = name; endPlacement();
    logEvent(`Moved <b>${esc(name)}</b> to ${esc(p.info.line)} for ${money(price)}`);
    toast(`Moved <b>${esc(name)}</b> to ${esc(p.info.line)}`); pruneOutOfRange(); drawBases(); drawJobs(); save(); refresh(); return;
  }
  if(S.cash < GARAGE_PRICE){ toast("Not enough cash for a new hub."); return; }
  S.cash -= GARAGE_PRICE;
  const b = {id:nid("b"), city, pt:p.pt, addr:p.info.line, name, tier:0, dispatcher:false, home:false};
  S.bases.push(b); endPlacement();
  toast(`Opened <b>${esc(name)}</b> at ${esc(p.info.line)}`); drawBases(); save(); refresh();
}

/* ---------------- Account and cloud saves ----------------
   Signed in, the company is saved to your account about once a minute and whenever you leave the page,
   so the same company opens on any device. Without an account the game saves in this browser only. */
let authEmail = "", localBase = 0, cloudSynced = false, cloudDirty = false, cloudLast = 0, cloudBusy = false, cloudMsg = "", cloudErr = "";
const cloudUser = () => window.Cloud?.user || null;
function cloudData(){
  // Road and rail geometry is big and can be fetched again, so it isn't stored in the cloud copy.
  const o = JSON.parse(JSON.stringify(S, (k,v)=>k==="cum"?undefined:v));
  o.jobs.forEach(j=>{ if(!j.air){ delete j.path; j.routed = false; } });
  o.trips.forEach(t=>t.segs.forEach(sg=>{ if(sg.path && sg.path.length>2) sg.path = [sg.path[0], sg.path[sg.path.length-1]]; }));
  return JSON.stringify(o);
}
async function cloudPush(force){
  if(!S || reloading || !cloudUser() || !cloudSynced || cloudBusy) return;
  if(!force && !cloudDirty && Date.now()-cloudLast < 10*60e3) return;
  cloudBusy = true;
  try{
    S.savedAt = Date.now(); S.cloudUid = cloudUser().uid; save();
    await window.Cloud.push(cloudData(), {savedAt:S.savedAt, company:S.company, level:level(), cash:Math.round(S.cash)});
    cloudLast = Date.now(); cloudDirty = false; cloudErr = "";
  }catch(e){ cloudErr = "Couldn't reach the cloud. Your game is still saved on this device."; }
  cloudBusy = false;
  if(tab==="account") renderPanel();
}
// Replace the game in this browser with a save and reload the page so it starts cleanly.
let reloading = false;   // once set, nothing may overwrite the save that is about to load
function loadSaveAndReload(data){ reloading = true; try{ localStorage.setItem(KEY, data); }catch(_){} location.reload(); }
async function onCloudAuth(u){
  cloudSynced = false;
  if(!u){ if(tab==="account") renderPanel(); renderStartAuth(); return; }
  let remote = null;
  try{ remote = await window.Cloud.pull(); }catch(e){ cloudErr = "Couldn't reach the cloud. Try again in a moment."; if(tab==="account") renderPanel(); return; }
  if(!S){   // start screen: open the account's company if it has one
    if(remote?.data){ loadSaveAndReload(remote.data); return; }
    cloudSynced = true; renderStartAuth(); return;   // the new company will be saved to this account

  }
  if(!remote?.data){ cloudSynced = true; cloudPush(true); toast("Signed in. Your company is now saved to your account."); return; }
  if(S.cloudUid === u.uid){
    // Same account as before: whichever copy is newer wins.
    if((remote.savedAt||0) > localBase + 1000){ loadSaveAndReload(remote.data); return; }
    cloudSynced = true; cloudPush(true); if(tab==="account") renderPanel(); return;
  }
  askWhichSave(remote);   // this device has a different company than the account
}
function askWhichSave(remote){
  document.querySelectorAll(".overlay").forEach(o=>o.hidden = true);   // this choice comes first
  const ov = $("#cloudOv"), when = remote.savedAt ? new Date(remote.savedAt).toLocaleString("en-US", {month:"short", day:"numeric", hour:"numeric", minute:"2-digit"}) : "earlier";
  $("#cloudBody").innerHTML = `<p class="hint" style="color:var(--ink)">Your account already has a company saved. Which one do you want to keep playing?</p>
    <div class="list">
      <button class="card" data-pick="cloud"><div class="row"><b>${esc(remote.company||"Saved company")}</b><span class="num">Level ${remote.level||"?"}</span></div><div class="meta"><span>On your account</span><span class="num">${money(remote.cash||0)}</span><span>saved ${esc(when)}</span></div></button>
      <button class="card" data-pick="local"><div class="row"><b>${esc(S.company)}</b><span class="num">Level ${level()}</span></div><div class="meta"><span>On this device</span><span class="num">${money(S.cash)}</span></div></button>
    </div>
    <p class="hint">The one you don't pick is replaced.</p>`;
  ov.hidden = false;
  ov.querySelectorAll("[data-pick]").forEach(b=>b.onclick = ()=>{
    ov.hidden = true;
    if(b.dataset.pick==="cloud") loadSaveAndReload(remote.data);
    else { cloudSynced = true; cloudPush(true); toast("This device's company is now saved to your account."); }
  });
}
window.addEventListener("cloud-auth", e=>onCloudAuth(e.detail));
setInterval(()=>cloudPush(false), 60e3);
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="hidden") cloudPush(true); });

const authError = e => ({"auth/invalid-credential":"Wrong email or password.", "auth/wrong-password":"Wrong email or password.", "auth/user-not-found":"No account with that email.",
  "auth/email-already-in-use":"That email already has an account. Sign in instead.", "auth/weak-password":"Use a password of at least 6 characters.",
  "auth/invalid-email":"That email address doesn't look right.", "auth/too-many-requests":"Too many tries. Wait a minute and try again.",
  "auth/network-request-failed":"No connection. Check your internet and try again."})[e?.code] || "Something went wrong. Try again.";
// Shared sign-in form (Account page and start screen). prefix keeps the element ids unique.
function authForm(prefix){
  return `<label class="fld">Email<input type="email" id="${prefix}Email" autocomplete="email" inputmode="email" value="${esc(authEmail)}"></label>
    <label class="fld">Password<input type="password" id="${prefix}Pw" autocomplete="current-password" minlength="6"></label>
    ${cloudMsg?`<p class="ok" style="margin:0">${esc(cloudMsg)}</p>`:""}${cloudErr?`<p class="need" style="margin:0">${esc(cloudErr)}</p>`:""}
    <div class="btnrow"><button type="button" class="btn sm" data-auth="in" data-p="${prefix}">Sign in</button><button type="button" class="btn ghost sm" data-auth="up" data-p="${prefix}">Create account</button><button type="button" class="btn ghost sm" data-auth="reset" data-p="${prefix}">Forgot password</button></div>`;
}
async function doAuth(kind, prefix){
  const email = ($("#"+prefix+"Email")?.value||"").trim(), pw = $("#"+prefix+"Pw")?.value||""; authEmail = email;
  cloudMsg = ""; cloudErr = "";
  if(!window.Cloud){ cloudErr = "Sign-in is still loading. Try again in a moment."; return refreshAuthViews(); }
  if(!email){ cloudErr = "Enter your email."; return refreshAuthViews(); }
  try{
    if(kind==="reset"){ await window.Cloud.reset(email); cloudMsg = "Password reset email sent. Check your inbox."; }
    else if(!pw){ cloudErr = "Enter your password."; }
    else if(kind==="up") await window.Cloud.signUp(email, pw);
    else await window.Cloud.signIn(email, pw);
  }catch(e){ cloudErr = authError(e); }
  refreshAuthViews();
}
function refreshAuthViews(){ if(S && tab==="account") renderPanel(); renderStartAuth(); }
document.addEventListener("click", e=>{ const b = e.target.closest("[data-auth]"); if(b){ e.preventDefault(); doAuth(b.dataset.auth, b.dataset.p); } });
function renderStartAuth(){
  const box = $("#startAuth"); if(!box || S) return;
  const u = cloudUser();
  box.innerHTML = u ? `<p class="hint" style="color:var(--ink)">Signed in as <b>${esc(u.email)}</b>. No company on this account yet, so start one below and it will be saved to your account.</p>`
    : `<details ${cloudErr||cloudMsg?"open":""}><summary>Already playing on another device? <b>Sign in</b></summary>${authForm("st")}</details>`;
}
function renderAccount(){
  const u = cloudUser();
  if(!window.Cloud) return `<section class="sec"><h2>Account</h2><p class="hint">Sign-in is loading…</p></section>`;
  if(!u) return `<section class="sec"><h2>Account</h2><p class="hint">Sign in to save your company to your account and play it on your phone, iPad and computer. Without an account, your game is saved in this browser only.</p>
    ${authForm("ac")}<p class="hint">New here? Enter an email and a password (6+ characters) and tap <b>Create account</b>. Your current company comes with you.</p></section>`;
  const ago = cloudLast ? dur(Date.now()-cloudLast)+" ago" : cloudSynced ? "saving…" : "checking…";
  return `<section class="sec"><h2>Account</h2>
    <table class="spec"><tbody><tr><td>Signed in as</td><td style="font-family:var(--body)">${esc(u.email)}</td></tr><tr><td>Last cloud save</td><td>${ago}</td></tr></tbody></table>
    ${cloudErr?`<p class="need">${esc(cloudErr)}</p>`:""}
    <p class="hint">Your company saves to your account about once a minute and when you leave the game. Open the game on another device and sign in with the same email to keep playing there. Play on one device at a time; the most recent save wins.</p>
    <div class="btnrow"><button class="btn sm" data-act="cloudSave" ${cloudSynced?"":"disabled"}>Save now</button><button class="btn ghost sm" data-act="signOut">Sign out</button></div></section>`;
}

/* ---------------- Alliances ----------------
   Needs an account. Members share contracts far bigger than one company could run: every matching delivery
   any member makes counts. When a contract is done, each member claims a bonus for the loads they delivered,
   and the alliance gains XP. Alliance level adds to every member's job pay. */
const AL_CONTRACTS = [
  {id:"drive",  n:"Freight Drive",  cargo:"any",          per:25, min:40, hours:24, bonus:300, xp:100, cost:0,
   blurb:"Deliver any freight: trucks, trains and planes all count."},
  {id:"furn",   n:"Furniture Push", cargo:"furniture",    per:15, min:25, hours:24, bonus:500, xp:150, cost:0,
   blurb:"Furniture loads only."},
  {id:"cold",   n:"Cold Chain",     cargo:"refrigerated", per:15, min:25, hours:24, bonus:600, xp:150, cost:0,
   blurb:"Refrigerated loads only."},
  {id:"big",    n:"Big Haul",       cargo:"any",          per:60, min:100, hours:48, bonus:800, xp:400, cost:250000,
   blurb:"A huge order for any freight. Paid for from the alliance bank."}
];
const AL_LVL_XP = 300, AL_MAX_LVL = 10;
const alLevel = a => Math.min(AL_MAX_LVL, 1 + Math.floor((a?.xp||0)/AL_LVL_XP));
let AL = null, alUnsub = null, alWatching = null, alQueue = 0, alList = null, alListAt = 0, alBusy = false, alErr = "", alMsg = "";
const alMe = () => window.Cloud?.user?.uid;
const alPerk = () => AL?.alliance && S?.alliance === AL.alliance.id ? alLevel(AL.alliance) / 100 : 0;   // +1% pay per alliance level
const alActive = () => AL?.alliance?.active ? AL.contracts.find(c=>c.id===AL.alliance.active) : null;
const alInfo = () => ({company:S.company, level:level()});
// Start or stop live updates when the account or alliance changes.
function alSync(){
  const want = alMe() && S?.alliance ? S.alliance : null;
  if(want === alWatching) return;
  if(alUnsub){ alUnsub(); alUnsub = null; } AL = null; alWatching = want;
  if(!want || !window.Cloud?.al) return;
  alUnsub = window.Cloud.al.watch(want, st=>{
    AL = st;
    const closed = st.la && !st.alliance, removed = st.la && st.lm && st.alliance && !st.members.some(m=>m.uid===alMe());
    if(closed || removed){ toast(closed ? "Your alliance was closed." : `You are no longer in ${esc(st.alliance.name)}.`); S.alliance = null; AL = null; save(); alSync(); if(tab==="alliance") renderPanel(); return; }
    const c = alActive(); if(c && Date.now() > c.deadline) window.Cloud.al.expire(want, c.id).catch(()=>{});
    if(tab==="alliance") renderPanel(); renderHeader();
  });
}
// Every delivery: count it toward the alliance contract if the cargo matches.
function alDelivered(j){
  const c = alActive(); if(!c || Date.now() > c.deadline) return;
  if(c.cargo==="any" || c.cargo===j.cargo){ alQueue++; }
}
async function alFlush(){
  const c = alActive(); if(!alQueue || !c || !S?.alliance) { if(!c) alQueue = 0; return; }
  const n = alQueue; alQueue = 0;
  try{ await window.Cloud.al.contribute(S.alliance, c.id, n); }catch(_){ alQueue += n; }
}
setInterval(alFlush, 20000);
setInterval(()=>{ if(AL?.alliance && alMe()) window.Cloud.al.touch(S.alliance, alInfo()).catch(()=>{}); }, 5*60e3);
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="hidden") alFlush(); });
window.addEventListener("cloud-auth", ()=>setTimeout(alSync, 1500));

async function alDo(fn, ok){
  if(alBusy) return; alBusy = true; alErr = ""; alMsg = ""; renderPanel();
  try{ await fn(); if(ok) alMsg = ok; }
  catch(e){ alErr = ({full:"That alliance is full.", busy:"A contract is already running.", bank:"Not enough money in the alliance bank.", gone:"That alliance no longer exists."})[e.message] || "Couldn't reach the server. Try again."; }
  alBusy = false; renderPanel();
}
async function alLoadList(force){
  if(!force && alList && Date.now()-alListAt < 60e3) return;
  try{ alList = await window.Cloud.al.list(); alListAt = Date.now(); }catch(_){ alList = []; alErr = "Couldn't load alliances. Try again."; }
  if(tab==="alliance") renderPanel();
}
const alTarget = (o, n) => Math.max(o.min, o.per*n);
const ago = t => { const m = Math.floor((Date.now()-t)/60000); return m<2?"online": m<60?`${m}m ago`: m<1440?`${Math.floor(m/60)}h ago`:`${Math.floor(m/1440)}d ago`; };
function renderAlliance(){
  let h = `<section class="sec"><h2>Alliance</h2>`;
  if(!window.Cloud) return h+`<p class="hint">Loading…</p></section>`;
  if(!alMe()) return h+`<p class="hint">Alliances are groups of players who take on big shared contracts together. Sign in first so other players can find you.</p><div class="btnrow"><button class="btn sm" data-act="tab" data-tab="account">Sign in</button></div></section>`;
  const note = `${alErr?`<p class="need">${esc(alErr)}</p>`:""}${alMsg?`<p class="ok">${esc(alMsg)}</p>`:""}`;
  if(!S.alliance){
    if(!alList) alLoadList();
    const q = (alSearch||"").toLowerCase(), list = (alList||[]).filter(a=>!q || a.name.toLowerCase().includes(q) || (a.tag||"").toLowerCase().includes(q));
    return h+`<p class="hint">Join a group of players to run shared contracts far bigger than one company could do. Every member's matching deliveries count, everyone who helps gets a bonus, and the alliance levels up for extra pay on all your jobs (+1% per alliance level, up to +${AL_MAX_LVL}%).</p>${note}</section>
      <section class="sec ${cz("al-create")}">${secHead("al-create","Start an alliance")}
        <label class="fld">Name<input type="text" id="alName" maxlength="28" placeholder="Southern Freight Alliance"></label>
        <label class="fld">Tag (2–5 letters)<input type="text" id="alTag" maxlength="5" placeholder="SFA" style="text-transform:uppercase"></label>
        <label class="fld">Short description (optional)<input type="text" id="alDesc" maxlength="80"></label>
        <div class="btnrow"><button class="btn sm" data-act="alCreate" ${alBusy?"disabled":""}>Create alliance</button></div></section>
      <section class="sec ${cz("al-join")}">${secHead("al-join","Join an alliance",`<button class="btn ghost sm" data-act="alRefresh">Refresh</button>`)}
        <label class="fld"><input type="search" id="alSearch" placeholder="Search by name or tag" value="${esc(alSearch||"")}"></label>
        ${!alList?`<p class="hint">Loading…</p>`:list.length?`<div class="list">${list.map(a=>`<div class="card"><div class="row"><b>${esc(a.name)} <span class="hint">[${esc(a.tag)}]</span></b><span class="num">${a.members||0}/${window.Cloud.al.MAX_MEMBERS}</span></div>
          <div class="meta"><span>Level ${alLevel(a)}</span>${a.desc?`<span>${esc(a.desc)}</span>`:""}</div>
          <div class="btnrow"><button class="btn sm" data-act="alJoin" data-id="${a.id}" ${alBusy||(a.members||0)>=window.Cloud.al.MAX_MEMBERS?"disabled":""}>${(a.members||0)>=window.Cloud.al.MAX_MEMBERS?"Full":"Join"}</button></div></div>`).join("")}</div>`:`<p class="hint">No alliances yet${q?" match that search":""}. Start one above.</p>`}</section>`;
  }
  if(!AL || !AL.alliance) return h+`<p class="hint">Loading your alliance…</p>${note}</section>`;
  const a = AL.alliance, me = alMe(), lead = a.leader===me, lv = alLevel(a), n = AL.members.length || a.members || 1;
  const c = alActive(), mine = c ? (c.contributions?.[me]||0) : 0;
  h += `<div class="row"><b style="font-size:17px">${esc(a.name)} <span class="hint">[${esc(a.tag)}]</span></b><span class="num">Level ${lv}</span></div>
    <div class="meta"><span>${n}/${window.Cloud.al.MAX_MEMBERS} members</span><span>+${lv}% pay on all your jobs</span>${a.desc?`<span>${esc(a.desc)}</span>`:""}</div>
    ${lv<AL_MAX_LVL?`${bar((a.xp||0)%AL_LVL_XP, AL_LVL_XP)}<p class="hint" style="margin:0">${(a.xp||0)%AL_LVL_XP} / ${AL_LVL_XP} XP to level ${lv+1}. Finish contracts to earn alliance XP.</p>`:""}${note}</section>`;
  // Running contract
  h += `<section class="sec ${cz("al-contract")}">${secHead("al-contract","Alliance contract")}`;
  if(c){
    const left = c.deadline - Date.now();
    h += `<div class="card"><div class="row"><b>${esc(c.n)}</b><span class="pay">${money(c.bonus)} per load</span></div>
      <p class="hint" style="margin:0">${esc(c.blurb)}</p>${bar(Math.min(c.delivered,c.target), c.target)}
      <div class="meta"><span class="num">${c.delivered.toLocaleString("en-US")} / ${c.target.toLocaleString("en-US")} loads</span><span>You: <b class="num">${mine}</b>${alQueue?` (+${alQueue} sending)`:""}</span><span>${left>0?`ends in ${longDur(left)}`:"time's up"}</span></div>
      <p class="hint" style="margin:0">When it's done, you get ${money(c.bonus)} for each load you delivered and the alliance gets ${c.xp} XP. Miss the deadline and there's no bonus.</p></div>`;
  } else {
    h += `<p class="hint">No contract running. ${lead?"Pick one to start. Targets grow with the number of members.":"The leader starts the next one."}</p>`;
    if(lead) h += `<div class="list">${AL_CONTRACTS.map(o=>{ const t = alTarget(o, n), poor = o.cost > (a.bank||0);
      return `<div class="card"><div class="row"><b>${esc(o.n)}</b><span class="pay">${money(o.bonus)} per load</span></div><p class="hint" style="margin:0">${esc(o.blurb)}</p>
        <div class="meta"><span class="num">${t} loads</span><span class="num">${o.hours} h</span><span>+${o.xp} alliance XP</span>${o.cost?`<span class="num">costs ${money(o.cost)} from the bank</span>`:""}</div>
        <div class="btnrow"><button class="btn sm" data-act="alStart" data-id="${o.id}" ${alBusy||poor?"disabled":""}>${poor?"Not enough in the bank":"Start contract"}</button></div></div>`; }).join("")}</div>`;
  }
  // Rewards to claim from finished contracts
  const claim = AL.contracts.filter(x=>x.status==="done" && (x.contributions?.[me]||0) > 0 && !x.claimed?.[me]);
  if(claim.length) h += `<div class="list">${claim.map(x=>`<div class="task"><div class="row"><span><b>${esc(x.n)}</b> complete · you delivered ${x.contributions[me]} loads</span><span class="pay">${money(x.contributions[me]*x.bonus)}</span></div><div class="btnrow"><button class="btn sm" data-act="alClaim" data-id="${x.id}" ${alBusy?"disabled":""}>Claim</button></div></div>`).join("")}</div>`;
  const past = AL.contracts.filter(x=>x.status!=="active").slice(0, 4);
  if(past.length) h += `<p class="hint" style="margin-top:8px">Recent: ${past.map(x=>`${esc(x.n)} ${x.status==="done"?"✓ done":"✗ missed"} (${x.delivered}/${x.target})`).join(" · ")}</p>`;
  h += `</section>`;
  // Bank
  h += `<section class="sec ${cz("al-bank")}">${secHead("al-bank","Alliance bank",`<span class="num">${money(a.bank||0)}</span>`)}
    <p class="hint">Members chip in so the leader can start bigger contracts like Big Haul.</p>
    <div class="btnrow"><input type="number" id="alDonate" min="1000" step="1000" placeholder="Amount" style="flex:1;min-width:0;width:auto"><button class="btn sm" data-act="alDonate" ${alBusy?"disabled":""}>Donate</button></div></section>`;
  // Members
  const ms = AL.members.slice().sort((x,y)=>(y.uid===a.leader)-(x.uid===a.leader) || (y.loads||0)-(x.loads||0));
  h += `<section class="sec ${cz("al-members")}">${secHead("al-members","Members",`<span class="hint num">${ms.length}</span>`)}<div class="list">${ms.map(m=>{ const conf = pendingConfirm===("kick"+m.uid);
    return `<div class="card"><div class="row"><b>${esc(m.company||"Company")}${m.uid===me?" (you)":""}</b><span class="hint">${m.uid===a.leader?"Leader":ago(m.lastSeen||0)}</span></div>
      <div class="meta"><span>Level ${m.level||1}</span><span class="num">${(m.loads||0).toLocaleString("en-US")} alliance loads</span>${m.uid===a.leader?`<span>${ago(m.lastSeen||0)}</span>`:""}</div>
      ${lead && m.uid!==me ? `<div class="btnrow">${conf?`<button class="btn warn sm" data-act="alKick" data-id="${m.uid}">Remove ${esc(m.company||"member")}</button><button class="btn ghost sm" data-act="cancel">Cancel</button>`:`<button class="btn ghost sm" data-act="alLead" data-id="${m.uid}">Make leader</button><button class="btn ghost sm" data-act="askKick" data-id="${m.uid}">Remove</button>`}</div>`:""}</div>`; }).join("")}</div></section>`;
  // Feed
  h += `<section class="sec ${cz("al-feed")}">${secHead("al-feed","Activity")}<ul class="feed">${AL.feed.map(f=>`<li><span class="hint num">${ago(f.t)==="online"?"now":ago(f.t)}</span> ${esc(f.text)}</li>`).join("")||`<li class="hint">Nothing yet.</li>`}</ul></section>`;
  const conf = pendingConfirm==="alLeave";
  h += `<section class="sec"><div class="btnrow">${conf?`<button class="btn warn sm" data-act="alLeave">${lead&&n<=1?"Close the alliance":"Leave the alliance"}</button><button class="btn ghost sm" data-act="cancel">Stay</button>`:`<button class="btn ghost sm" data-act="askLeave">Leave alliance</button>`}</div>
    ${lead&&n>1?`<p class="hint">If you leave, the longest-serving member becomes leader.</p>`:""}</section>`;
  return h;
}
let alSearch = "";
function alAct(a, id, el){
  const C = window.Cloud?.al; if(!C) return false;
  if(a==="alRefresh"){ alLoadList(true); return true; }
  if(a==="alCreate"){
    const name = ($("#alName").value||"").trim(), tag = ($("#alTag").value||"").trim().toUpperCase(), desc = ($("#alDesc").value||"").trim();
    if(name.length<3){ alErr = "Give the alliance a name (3+ letters)."; renderPanel(); return true; }
    if(!/^[A-Z0-9]{2,5}$/.test(tag)){ alErr = "Pick a tag of 2–5 letters or numbers."; renderPanel(); return true; }
    alDo(async ()=>{ const aid = await C.create({name, tag, desc}, alInfo()); S.alliance = aid; save(); cloudPush(true); alSync(); }, `${name} is open. Invite friends to join it from Menu → Alliance.`);
    return true;
  }
  if(a==="alJoin"){ alDo(async ()=>{ await C.join(id, alInfo()); S.alliance = id; save(); cloudPush(true); alSync(); }, "Welcome to the alliance!"); return true; }
  if(a==="alStart"){ const o = AL_CONTRACTS.find(x=>x.id===id), n = AL.members.length||1;
    alDo(()=>C.start(S.alliance, {kind:o.id, n:o.n, blurb:o.blurb, cargo:o.cargo, target:alTarget(o,n), bonus:o.bonus, xp:o.xp, cost:o.cost, deadline:Date.now()+o.hours*3600e3}, S.company)); return true; }
  if(a==="alClaim"){ alDo(async ()=>{ const x = AL.contracts.find(c=>c.id===id), n = await C.claim(S.alliance, id);
      if(n && x){ const pay = n*x.bonus; S.cash += pay; S.earned += pay; logEvent(`Alliance contract <b>${esc(x.n)}</b>: claimed <span class="num">+${money(pay)}</span>`); toast(`Claimed <span class="num">${money(pay)}</span> for ${n} alliance loads`); save(); } }); return true; }
  if(a==="alDonate"){ const amt = Math.floor(+($("#alDonate").value||0));
    if(!(amt>0) || amt > S.cash){ alErr = amt>S.cash?"You don't have that much cash.":"Enter an amount."; renderPanel(); return true; }
    S.cash -= amt; save(); alDo(()=>C.donate(S.alliance, amt, S.company).catch(e=>{ S.cash += amt; save(); throw e; }), `Donated ${money(amt)}.`); return true; }
  if(a==="askKick"){ pendingConfirm="kick"+id; renderPanel(); return true; }
  if(a==="alKick"){ const m = AL.members.find(x=>x.uid===id); pendingConfirm=null; alDo(()=>C.kick(S.alliance, id, m?.company||"A member")); return true; }
  if(a==="alLead"){ alDo(()=>C.makeLeader(S.alliance, id), "Leadership handed over."); return true; }
  if(a==="askLeave"){ pendingConfirm="alLeave"; renderPanel(); return true; }
  if(a==="alLeave"){ pendingConfirm=null; const aid = S.alliance; alDo(async ()=>{ await alFlush(); await C.leave(aid, S.company); S.alliance = null; save(); cloudPush(true); alSync(); }, "You left the alliance."); return true; }
  return false;
}

/* ---------------- Save / load ---------------- */
// Saves from before multi-load trips kept one job per trip; convert them.
function migrateTrip(tr){
  if(tr.loads) return tr;
  const j = tr.job, kinds = ["drive","stop","drive","stop","drive"];
  const segs = tr.segs.map((sg,i)=>({...sg, kind:kinds[i], sk: i===1?"pick":i===3?"drop":undefined, jid:j.id,
    next: i===0?{sk:"pick",jid:j.id}: i===2?{sk:"drop",jid:j.id}:undefined, mi: i===0?(tr.deadMi||0): i===2?(tr.haulMi||j.miles||0): i===4?(tr.retMi||0):0, done: S.clock>=sg.t1}));
  return {id:tr.id, v:tr.v, drivers:tr.drivers, startAt:tr.segs[0].t0, endAt:tr.endAt, segs,
    loads:[{job:j, picked: S.clock>=tr.segs[1].t1, delivered: !!tr.delivered, cut: tr.cut||0}]};
}
function syncClock(){ const now=Date.now(); S.clock += (now-S.lastReal)*S.speed; S.lastReal = now; }
function save(){ if(!S || reloading) return; cloudDirty = true; try{ localStorage.setItem(KEY, JSON.stringify(S, (k,v)=>k==="cum"?undefined:v)); }catch(_){} }
function afterLoad(){ drawBases(); drawJobs(); drawYards(); setTab(tab); }
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
  if(ensureDay()){ showLoginPopup(); renderPanel(); }
  if(logic()){ drawJobs(); renderPanel(); } else renderHeader();
}
function start(){
  let loaded = null;
  try{ const raw = localStorage.getItem(KEY); if(raw) loaded = JSON.parse(raw); }catch(_){}
  if(loaded && loaded.v===2){
    S = loaded; localBase = S.savedAt || 0;
    S.jobs = S.jobs.filter(j=>!j.chain); delete S.chains;
    (S.trips||[]).forEach(t=>(t.loads||[]).forEach(l=>{ delete l.job.chain; }));
    S.trips = S.trips.map(migrateTrip); S.trips.forEach(pruneLoads); S.vehicles.forEach(v=>{ delete v.ret; v.busy = !!tripOf(v); });
    S.bases.forEach((b,i)=>{ if(b.tier==null) b.tier=0; delete b.slots; if(!b.name) b.name = b.home ? "HQ" : `Hub ${i+1}`; });
    S.jobs = S.jobs.filter(fitsUnlocked);
    // Boards posted under older, larger limits: keep the best jobs up to today's limit (runnable first, then highest pay).
    for(const [kind, cap] of [["truck", maxJobs()], ["rail", maxRailJobs()], ["air", maxAirJobs()]]){
      const mine = S.jobs.filter(j=>jobKind(j)===kind);
      if(mine.length <= cap) continue;
      const keep = new Set(mine.sort((a,b)=>(jobStatus(b).can-jobStatus(a).can)||(b.pay-a.pay)).slice(0,cap));
      S.jobs = S.jobs.filter(j=>jobKind(j)!==kind || keep.has(j));
    }
    S.jobs.forEach(j=>{ j.pay = jobPay(j); if(j.urg==="standard") j.expires=null; if(!j.from.name){ j.from.name=bizName(j.from.biz); j.from.num=houseNo(); j.to.name=bizName(j.to.biz); j.to.num=houseNo(); } });
    const dt = Date.now() - S.lastReal; let log = null;
    S.lastReal = Date.now();
    if(dt > 60e3) log = simulateAway(dt); else S.trips.forEach(roadTrip);
    S.jobs.forEach(j=>{ if(!j.routed) routeJob(j); });
    afterLoad();
    const p = basePt(S.bases[0]); map.setView([p.lat,p.lon], 10);
    showAway(log);
    ensureDay(); showLoginPopup();
  } else showStart();
  setInterval(tick, 250);
  setInterval(liveText, 1000);
  setInterval(retryRoutes, 15000);
  setInterval(save, 5000);
  document.addEventListener("visibilitychange", save);
  requestAnimationFrame(frame);
}
start();
})();

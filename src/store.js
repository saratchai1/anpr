/* Single source of truth for the FRONTEND-ONLY DEMO.
 * All observations and operator actions are simulated, not a trusted audit log.
 * Web Locks serialize persistent writes across tabs; BroadcastChannel also
 * synchronizes memory-only tabs when browser storage is unavailable.
 */
(function (global) {
  'use strict';
  const KEY = 'bkk-anpr-demo-v2';
  const LEGACY = 'bkk-anpr-airport-intelligence-demo-v1';
  const RANK = { NORMAL: 0, WARNING: 1, ENFORCEMENT: 2, SECURITY: 3 };
  const STATUS = ['new', 'review', 'dispatched', 'closed'];
  const DEFAULTS = { passageMinutes: 30, missingExitMinutes: 45, stopMinutes: 5, securityStopMinutes: 15,
    weights: { passage: 20, missingExit: 10, stopped: 20, zone: 25, repeated: 5 }, revision: 1 };
  const ZONES = ['DEMO-ZONE-A', 'DEMO-ZONE-B'];
  const listeners = new Set();
  const copy = value => JSON.parse(JSON.stringify(value));
  const text = (value, max = 200) => typeof value === 'string' ? value.slice(0, max) : '';
  const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const iso = () => new Date().toISOString();
  const uid = prefix => prefix + '-' + (global.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
  const clamp = (n, min, max, fallback = min) => Number.isFinite(Number(n)) ? Math.min(max, Math.max(min, Number(n))) : fallback;
  let memoryOnly = false, notice = '', channel, queue = Promise.resolve();
  const sender = uid('tab');
  function elapsed(v, now = Date.now()) {
    const end = v.exitAt ? Date.parse(v.exitAt) : now;
    return Math.max(0, Math.floor((end - Date.parse(v.entryAt)) / 60000));
  }
  function policy(input, strict = false) {
    const p = input && typeof input === 'object' ? input : {};
    const out = copy(DEFAULTS);
    const fields = { passageMinutes: [1, 300], missingExitMinutes: [1, 600], stopMinutes: [1, 120], securityStopMinutes: [1, 240] };
    for (const [key, bounds] of Object.entries(fields)) {
      const n = Number(p[key]);
      if (strict && (!Number.isInteger(n) || n < bounds[0] || n > bounds[1])) throw new Error('ค่า ' + key + ' ต้องเป็นจำนวนเต็มระหว่าง ' + bounds.join('–'));
      if (Number.isInteger(n) && n >= bounds[0] && n <= bounds[1]) out[key] = n;
    }
    if (out.missingExitMinutes < out.passageMinutes || out.securityStopMinutes < out.stopMinutes) {
      if (strict) throw new Error('เกณฑ์ไม่พบจุดออกต้องไม่น้อยกว่าเวลาผ่านเส้นทาง และเกณฑ์ Security ต้องไม่น้อยกว่าเกณฑ์หยุด');
      out.missingExitMinutes = Math.max(out.missingExitMinutes, out.passageMinutes);
      out.securityStopMinutes = Math.max(out.securityStopMinutes, out.stopMinutes);
    }
    for (const key of Object.keys(out.weights)) {
      const n = Number(p.weights?.[key]);
      if (strict && (!Number.isInteger(n) || n < 0 || n > 100)) throw new Error('น้ำหนักคะแนนต้องเป็นจำนวนเต็ม 0–100');
      if (Number.isInteger(n) && n >= 0 && n <= 100) out.weights[key] = n;
    }
    out.revision = Math.floor(clamp(p.revision, 1, 100000, 1));
    return out;
  }
  // Severity requires evidence gates, never a score alone. Exit does not erase
  // an observed stop. A separate case preserves the highest recorded severity.
  function assess(v, config = DEFAULTS, now = Date.now()) {
    if (!v || !validDate(v.entryAt)) return { level: 'NORMAL', elapsed: 0, score: 0, reasons: [], triggers: {} };
    const c = policy(config), minutes = elapsed(v, now);
    const stop = v.cctvStopped === true && Number.isFinite(Number(v.cctvDuration)) ? Math.max(0, Number(v.cctvDuration)) : 0;
    const triggers = { passage: minutes > c.passageMinutes,
      missingExit: !v.exitAt && minutes >= c.missingExitMinutes,
      stopped: stop >= c.stopMinutes, inZone: stop >= c.stopMinutes && ZONES.includes(v.zone),
      longStop: stop >= c.securityStopMinutes, repeated: Number(v.repeatCount) > 1 };
    let level = 'NORMAL';
    if (triggers.passage || triggers.missingExit || triggers.stopped) level = 'WARNING';
    if (triggers.inZone) level = 'ENFORCEMENT';
    if (triggers.inZone && triggers.longStop) level = 'SECURITY';
    const reasons = [];
    const add = (hit, label, points) => { if (hit) reasons.push({ label, points }); };
    add(triggers.passage, 'เวลาผ่านเส้นทาง ' + minutes + ' นาที (ไม่ใช่เวลาจอด)', c.weights.passage);
    add(triggers.missingExit, 'ยังไม่พบจุดออกภายใน ' + c.missingExitMinutes + ' นาที', c.weights.missingExit);
    add(triggers.stopped, 'CCTV จำลองระบุหยุด ' + stop + ' นาที', c.weights.stopped);
    add(triggers.inZone, 'CCTV จำลองระบุตำแหน่ง ' + v.zone, c.weights.zone);
    add(triggers.repeated && level !== 'NORMAL', 'พบซ้ำ ' + v.repeatCount + ' ครั้ง (จำลอง)', c.weights.repeated);
    return { level, elapsed: minutes, score: Math.min(100, reasons.reduce((s, r) => s + r.points, 0)), reasons, triggers, policyRevision: c.revision };
  }
  function normalVehicle(v) {
    if (!v || typeof v !== 'object' || !text(v.id, 100) || !text(v.plate, 80) || !validDate(v.entryAt)) return null;
    if (v.exitAt != null && (!validDate(v.exitAt) || Date.parse(v.exitAt) < Date.parse(v.entryAt))) return null;
    return { id: text(v.id, 100), plate: text(v.plate, 80), vehicleType: text(v.vehicleType, 80) || 'Sedan',
      entryAt: v.entryAt, exitAt: v.exitAt || null, cctvStopped: v.cctvStopped === true,
      cctvDuration: clamp(v.cctvDuration, 0, 1440), zone: ZONES.includes(v.zone) ? v.zone : '—',
      repeatCount: Math.floor(clamp(v.repeatCount, 1, 1000, 1)), cctvAt: validDate(v.cctvAt) ? v.cctvAt : null,
      observations: Array.isArray(v.observations) ? v.observations.filter(e => e && validDate(e.at)).slice(-500).map(e => ({
        id: text(e.id, 100) || uid('event'), at: e.at, type: text(e.type, 40), detail: text(e.detail, 1000), source: 'DEMO' })) : [] };
  }
  function event(type, detail, at = iso()) { return { id: uid('event'), type, detail, at, source: 'DEMO' }; }
  function seedVehicles(now) {
    return [[79,null,true,24,'A',2,'Van'],[54,null,false,0,'',1,'Sedan'],[43,8,true,8,'B',1,'Pickup'],[22,null,false,0,'',1,'Sedan'],[67,15,false,0,'',1,'SUV'],[13,2,false,0,'',1,'Taxi']].map((r, i) => {
      const v = normalVehicle({ id: 'V00' + (i+1), plate: 'TEST-' + (2001+i), vehicleType: r[6], entryAt: new Date(now-r[0]*60000).toISOString(), exitAt: r[1] === null ? null : new Date(now-r[1]*60000).toISOString(), cctvStopped: r[2], cctvDuration: r[3], zone: r[4] ? 'DEMO-ZONE-' + r[4] : '—', repeatCount: r[5] });
      v.observations.push(event('ANPR_ENTRY', 'กล้อง 01 ตรวจพบเข้า (จำลอง)', v.entryAt));
      if (v.cctvStopped) { v.cctvAt = new Date(Date.parse(v.entryAt)+v.cctvDuration*60000).toISOString(); v.observations.push(event('CCTV', 'หยุด ' + v.cctvDuration + ' นาที ใน ' + v.zone + ' (จำลอง)', v.cctvAt)); }
      if (v.exitAt) v.observations.push(event('ANPR_EXIT', 'กล้อง 02 ตรวจพบออก (จำลอง)', v.exitAt));
      return v;
    });
  }
  function fresh() {
    const now = Date.now();
    return { version: 2, revision: 0, updatedAt: iso(), config: copy(DEFAULTS), vehicles: seedVehicles(now), cases: [], policyLog: [], flightSeedAt: now, flightOverrides: {} };
  }
  function clean(raw) {
    if (!raw || raw.version !== 2 || !Array.isArray(raw.vehicles) || !Array.isArray(raw.cases)) return null;
    const vehicles = raw.vehicles.map(normalVehicle).filter(Boolean);
    const seen = new Set();
    const unique = vehicles.filter(v => !seen.has(v.id) && seen.add(v.id));
    const known = new Set(unique.map(v => v.id));
    const cases = raw.cases.filter(c => c && text(c.id, 100) && known.has(c.vehicleId) && STATUS.includes(c.status) && Object.hasOwn(RANK, c.peakLevel)).map(c => ({
      id: text(c.id,100), vehicleId: c.vehicleId, peakLevel: c.peakLevel, peakScore: clamp(c.peakScore,0,100),
      status: c.status, createdAt: validDate(c.createdAt) ? c.createdAt : iso(), updatedAt: validDate(c.updatedAt) ? c.updatedAt : iso(),
      resolution: text(c.resolution, 1000), timeline: Array.isArray(c.timeline) ? c.timeline.filter(e => e && validDate(e.at)).slice(-1000).map(e => ({ id: text(e.id,100) || uid('event'), at: e.at, type: text(e.type,40), detail: text(e.detail,1000), source: 'DEMO' })) : [] }));
    const caseVehicles = new Set();
    const uniqueCases = cases.filter(c => !caseVehicles.has(c.vehicleId) && caseVehicles.add(c.vehicleId));
    const overrides = {};
    if (raw.flightOverrides && typeof raw.flightOverrides === 'object') for (const [id, value] of Object.entries(raw.flightOverrides)) {
      if (/^F\d{3}$/.test(id) && value && ['on-time','delay60','delay120','landed','cancelled'].includes(value.scenario) && validDate(value.at)) overrides[id] = { scenario: value.scenario, at: value.at };
    }
    const out = { version:2, revision:Math.floor(clamp(raw.revision,0,Number.MAX_SAFE_INTEGER)), updatedAt:validDate(raw.updatedAt)?raw.updatedAt:iso(),
      config:policy(raw.config), vehicles:unique, cases:uniqueCases,
      policyLog:Array.isArray(raw.policyLog)?raw.policyLog.filter(e=>e&&validDate(e.at)).slice(-100).map(e=>({at:e.at,detail:text(e.detail,1000),source:'DEMO'})):[],
      flightSeedAt:Number.isFinite(raw.flightSeedAt)?raw.flightSeedAt:Date.now(), flightOverrides:overrides };
    return { data:out, repaired:unique.length !== raw.vehicles.length || uniqueCases.length !== raw.cases.length };
  }
  function reconcile(s) {
    let changed = false;
    for (const v of s.vehicles) {
      const a = assess(v, s.config);
      let c = s.cases.find(item => item.vehicleId === v.id);
      if (!c && a.level !== 'NORMAL') {
        c = { id:'CASE-' + v.id, vehicleId:v.id, peakLevel:a.level, peakScore:a.score, status:'new', createdAt:iso(), updatedAt:iso(), resolution:'',
          timeline:[event('CASE_CREATED', 'เปิดเคส ' + a.level + ' ด้วย policy demo-' + s.config.revision)] };
        s.cases.push(c); changed = true;
      } else if (c && (RANK[a.level] > RANK[c.peakLevel] || a.score > c.peakScore)) {
        if (RANK[a.level] > RANK[c.peakLevel]) c.peakLevel = a.level;
        c.peakScore = Math.max(c.peakScore, a.score); c.updatedAt = iso();
        c.timeline.push(event('RISK_UPDATE', 'บันทึกระดับสูงสุด ' + c.peakLevel + ' / คะแนน ' + c.peakScore + '; ไม่ลดระดับอัตโนมัติ'));
        changed = true;
      }
    }
    return changed;
  }
  function readDisk() {
    try { const value = global.localStorage.getItem(KEY); return value ? clean(JSON.parse(value)) : null; }
    catch (_) { return null; }
  }
  function initial() {
    try {
      const value = global.localStorage.getItem(KEY);
      if (value) {
        const parsed = clean(JSON.parse(value));
        if (parsed && (parsed.data.vehicles.length || !JSON.parse(value).vehicles.length)) {
          if (parsed.repaired) notice = 'พบข้อมูลเดโมบางรายการผิดรูปแบบ จึงข้ามรายการนั้น; ข้อมูลที่อ่านได้ยังคงอยู่';
          reconcile(parsed.data); return parsed.data;
        }
        notice = 'ข้อมูลเดโมที่บันทึกไว้เสียหาย จึงกู้คืนชุดตัวอย่าง; ไม่มีข้อมูลปฏิบัติการจริง';
      } else {
        const old = global.localStorage.getItem(LEGACY);
        if (old) {
          const legacy = JSON.parse(old);
          if (legacy && legacy.version === 1 && Array.isArray(legacy.vehicles)) {
            const valid = legacy.vehicles.map(normalVehicle).filter(Boolean);
            const s = fresh();
            if (valid.length || !legacy.vehicles.length) s.vehicles = valid;
            if (valid.length !== legacy.vehicles.length) notice = 'กู้คืนข้อมูลเก่าและข้ามรายการผิดรูปแบบแล้ว';
            for (const v of s.vehicles) {
              if (!v.observations.length) v.observations.push(event('MIGRATED', 'นำเข้าข้อมูลเดโมจากเวอร์ชันก่อน; ไม่ใช่หลักฐานกล้องต้นฉบับ'));
            }
            reconcile(s); return s;
          }
        }
      }
    } catch (err) {
      notice = 'อ่านข้อมูลเดิมไม่ได้ ใช้ชุดตัวอย่างในหน่วยความจำแทน';
    }
    const s = fresh(); reconcile(s); return s;
  }
  let state = initial();
  function notify() { for (const fn of listeners) { try { fn(snapshot()); } catch (err) { console.error('Demo subscriber error', err); } } }
  function persist() {
    try { global.localStorage.setItem(KEY, JSON.stringify(state)); memoryOnly = false; }
    catch (_) { memoryOnly = true; notice = 'Browser ไม่อนุญาตให้บันทึก: ใช้ข้อมูลในหน่วยความจำร่วมกันทุกหน้า ข้อมูลอาจหายเมื่อปิดหรือรีโหลด'; }
  }
  persist();
  function snapshot() { return copy(state); }
  function accept(raw) {
    const parsed = clean(raw);
    if (!parsed) { notice = 'ข้ามข้อมูลจากอีกแท็บที่ผิดรูปแบบ; ข้อมูลที่เปิดอยู่ยังใช้งานได้'; notify(); return; }
    const incoming = parsed.data;
    if (incoming.revision > state.revision || (incoming.revision === state.revision && incoming.updatedAt > state.updatedAt)) {
      state = incoming; if (parsed.repaired) notice = 'ข้ามรายการผิดรูปแบบจากข้อมูลอีกแท็บ'; notify();
    }
  }
  try {
    channel = new BroadcastChannel(KEY);
    channel.onmessage = event => { if (event.data?.sender !== sender && event.data?.state) accept(event.data.state); };
  } catch (_) {}
  global.addEventListener('storage', event => {
    if (event.key !== KEY) return;
    try { if (event.newValue) accept(JSON.parse(event.newValue)); else { notice = 'ข้อมูลถูกลบจากอีกแท็บ; สำเนาที่เปิดอยู่ยังใช้งานได้'; notify(); } }
    catch (_) { notice = 'ข้ามข้อมูลข้ามแท็บที่อ่านไม่ได้'; notify(); }
  });
  function mutate(fn) {
    const execute = async () => {
      if (!memoryOnly) {
        const disk = readDisk();
        if (disk && disk.data.revision > state.revision) state = disk.data;
      }
      const draft = snapshot();
      const result = fn(draft);
      reconcile(draft);
      draft.revision = state.revision + 1; draft.updatedAt = iso(); state = draft;
      persist();
      try { channel?.postMessage({sender, state}); } catch (_) {}
      notify(); return result;
    };
    const task = () => global.navigator?.locks?.request ? navigator.locks.request(KEY, execute) : execute();
    const next = queue.then(task); queue = next.catch(() => {}); return next;
  }
  function getVehicle(s, id) { const v=s.vehicles.find(v=>v.id===id); if (!v) throw new Error('ไม่พบรถในข้อมูลล่าสุด'); return v; }
  function record(v, type, detail) { v.observations.push(event(type, detail)); }
  const api = {
    version:'1.2.0', storageKey:KEY, rank:copy(RANK), defaults:copy(DEFAULTS), zones:ZONES.slice(),
    snapshot, assess, elapsed, validatePolicy:input=>policy(input,true),
    storageInfo:()=>({memoryOnly,notice,concurrency:global.navigator?.locks ? 'web-locks' : 'best-effort'}),
    subscribe(fn) { listeners.add(fn); return ()=>listeners.delete(fn); },
    addVehicle(overstay=false) { return mutate(s=>{
      const id=uid('V');
      const n=Math.max(2006,...s.vehicles.map(v=>Number(v.plate.match(/^TEST-(\d+)$/)?.[1])||0))+1;
      const v=normalVehicle({id,plate:'TEST-'+n,vehicleType:'Sedan',entryAt:new Date(Date.now()-(overstay?42:0)*60000).toISOString(),exitAt:null});
      record(v,'ANPR_ENTRY','จำลองกล้อง 01 ตรวจพบเข้า');s.vehicles.unshift(v);return id;
    }); },
    addCctv(id, minutes, zone) { return mutate(s=>{
      const v=getVehicle(s,id), n=Number(minutes);
      if (!Number.isFinite(n)||n<0||n>elapsed(v)) throw new Error('เวลาหยุดต้องไม่ติดลบและไม่เกินเวลาผ่านเส้นทาง; ใช้รถจำลองที่อยู่ในเส้นทางนานพอ');
      if (zone!=='—'&&!ZONES.includes(zone)) throw new Error('ไม่รู้จักโซนจำลอง');
      v.cctvStopped=n>0;v.cctvDuration=n;v.zone=zone;v.cctvAt=iso();
      record(v,'CCTV','CCTV จำลอง: หยุด '+n+' นาที / '+zone+'; เวลาบันทึกข้อมูล ไม่ใช่ภาพกล้องจริง');
    }); },
    exitVehicle(id) { return mutate(s=>{
      const v=getVehicle(s,id);if(v.exitAt)return;
      v.exitAt=iso();record(v,'ANPR_EXIT','จำลองกล้อง 02 ตรวจพบออก — ไม่ปิดเคสหรือแก้ระดับเหตุสูงสุด');
    }); },
    createReview(id) { return mutate(s=>{
      getVehicle(s,id); if(s.cases.some(c=>c.vehicleId===id))return;
      s.cases.push({id:'CASE-'+id,vehicleId:id,peakLevel:'WARNING',peakScore:0,status:'new',createdAt:iso(),updatedAt:iso(),resolution:'',timeline:[event('MANUAL_REVIEW','ผู้ใช้เดโมเปิดรายการตรวจสอบ; ยังไม่มีข้อสรุปความผิด')]});
    }); },
    transition(id, action, note='') { return mutate(s=>{
      const c=s.cases.find(c=>c.id===id);if(!c)throw new Error('ไม่พบเคส');
      const allowed={ack:{from:['new'],to:'review'},dispatch:{from:['review'],to:'dispatched'},close:{from:['new','review','dispatched'],to:'closed'},reopen:{from:['closed'],to:'review'}};
      const rule=allowed[action];if(!rule||!rule.from.includes(c.status))throw new Error('สถานะเคสเปลี่ยนแล้ว กรุณาตรวจสอบรายการล่าสุด');
      note=text(note,1000).trim();if(['close','reopen'].includes(action)&&note.length<3)throw new Error('กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร');
      const before=c.status;c.status=rule.to;c.updatedAt=iso();
      if(action==='close')c.resolution=note;
      c.timeline.push(event('OPERATOR_'+action.toUpperCase(),'Demo operator: '+before+' → '+c.status+(note?' / '+note:'')+' (จำลองเท่านั้น ไม่ส่งคำสั่งจริง)'));
    }); },
    saveConfig(input, reason) { const checked=policy(input,true);reason=text(reason,500).trim();
      if(reason.length<3)return Promise.reject(new Error('กรุณาระบุเหตุผลเปลี่ยนกฎอย่างน้อย 3 ตัวอักษร'));
      return mutate(s=>{checked.revision=s.config.revision+1;s.config=copy(checked);s.policyLog.push({at:iso(),detail:'Policy demo-'+checked.revision+': '+reason,source:'DEMO'});});
    },
    setFlightScenario(id, scenario) { return mutate(s=>{
      if(!/^F\d{3}$/.test(id)||!['reset','on-time','delay60','delay120','landed','cancelled'].includes(scenario))throw new Error('สถานการณ์เที่ยวบินไม่ถูกต้อง');
      if(scenario==='reset')delete s.flightOverrides[id];else s.flightOverrides[id]={scenario,at:iso()};
    }); },
    reset() { return mutate(s=>{const next=fresh();Object.assign(s,next);notice='รีเซ็ตชุดข้อมูล DEMO แล้ว';}); },
    tick() { const probe=snapshot(); if(reconcile(probe))return mutate(()=>{});notify();return Promise.resolve(); }
  };
  global.ANPRStore=Object.freeze(api);
})(window);

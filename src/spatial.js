/* Additive map restoration. Existing flight / ANPR views are left intact.
 * Camera coordinates and demo zones recovered from deployment
 * dpl_8WujSobu4Za63NvxNwpiBUfLrjYN. Never infer GPS or parking from ANPR alone.
 */
(function () {
  'use strict';
  const KEY = 'bkk-anpr-airport-intelligence-demo-v1';
  const ENTRY = [13.649323184689877, 100.74713256767531];
  const EXIT = [13.709441941455099, 100.7693773608348];
  const ZONES = [
    { name: 'DEMO-ZONE-A', point: [13.6695, 100.7548], radius: 240 },
    { name: 'DEMO-ZONE-B', point: [13.6922, 100.7621], radius: 290 }
  ];
  const COLORS = { SECURITY: '#ff7c8a', ENFORCEMENT: '#ffca78', WARNING: '#73b8ff', NORMAL: '#45e2cf' };
  const LABELS = { SECURITY: 'Security review', ENFORCEMENT: 'CCTV review', WARNING: 'Time exception', NORMAL: 'Normal' };
  const seedAt = Date.now();
  let map, mapNode, panel, vehicleLayer, zoneLayer, schematicLayer, extraView, extraScreen;
  let zonesOn = true, vehiclesOn = true, alertsOnly = false, tilesOK = 0;
  let mapPromise;
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const seed = () => [[79,null,true,24,'A',2,'Van'],[54,null,false,0,'',1,'Sedan'],[43,8,true,8,'B',1,'Pickup'],[22,null,false,0,'',1,'Sedan'],[67,15,false,0,'',1,'SUV'],[13,2,false,0,'',1,'Taxi']].map((r,i) => ({
    id: 'V00'+(i+1), plate: 'TEST-'+(2001+i), vehicleType:r[6], entryAt:new Date(seedAt-r[0]*60000).toISOString(),
    exitAt:r[1]===null?null:new Date(seedAt-r[1]*60000).toISOString(), cctvStopped:r[2], cctvDuration:r[3], zone:r[4]?'DEMO-ZONE-'+r[4]:'—', repeatCount:r[5]
  }));
  // Persist the existing app's seed before app.js loads, so both screens read
  // the SAME demonstration records. Never overwrite existing user demo data.
  try { if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify({version:1, vehicles:seed()})); } catch (_) {}
  function vehicles() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY));
      if (data && data.version === 1 && Array.isArray(data.vehicles)) return data.vehicles.filter(v => v && typeof v.id === 'string' && Number.isFinite(Date.parse(v.entryAt)));
    } catch (_) {}
    return seed();
  }
  function assess(v) {
    const elapsed = Math.max(0, Math.floor(((v.exitAt ? Date.parse(v.exitAt) : Date.now()) - Date.parse(v.entryAt))/60000));
    const level = v.cctvStopped ? (!v.exitAt && elapsed>30 ? 'SECURITY' : 'ENFORCEMENT') : elapsed>30 ? 'WARNING' : 'NORMAL';
    return {elapsed,level};
  }
  function schematic() {
    return `<div class="sp-schematic" aria-label="แผนผังแนวคิด ไม่ใช่เส้นทางถนนจริง"><div class="sp-node"><b>01</b><strong>ANPR ENTRY</strong><small>13.649323, 100.747133</small></div><div class="sp-connector"><span>ทะเบียน + เวลาเข้า</span><i>→</i></div><div class="sp-node sp-zone"><b>CCTV</b><strong>OBSERVATION</strong><small>ตำแหน่งหยุด / เวลาหยุด (จำลอง)</small></div><div class="sp-connector"><span>จับคู่ทะเบียน</span><i>→</i></div><div class="sp-node"><b>02</b><strong>ANPR EXIT</strong><small>13.709442, 100.769377</small></div></div><p class="sp-caption">แผนผังเชิงแนวคิด ไม่ใช่แนวถนนหรือแนวเขตปฏิบัติการที่ยืนยันแล้ว</p>`;
  }
  function workflow() {
    const steps = [
      ['01','ANPR Entry','บันทึกทะเบียนและเวลาเข้า'],
      ['02','CCTV Observation','ตรวจตำแหน่งและการหยุดนิ่ง'],
      ['03','ANPR Exit','จับคู่และคำนวณเวลารวม'],
      ['04','Evidence Review','แยกเหตุเวลานานจากหลักฐานจอด'],
      ['05','Human Response','เจ้าหน้าที่ตรวจสอบก่อนดำเนินการ']
    ];
    return `<section class="panel sp-workflow"><div class="panel-head"><div><div class="section-label">SYSTEM WORKFLOW</div><h2 class="panel-title">แผนผัง ANPR + CCTV + Flight Integration</h2></div><span class="pill review">DEMO</span></div><div class="panel-body"><div class="sp-flow">${steps.map(s=>`<div class="sp-step"><span>${s[0]}</span><strong>${s[1]}</strong><small>${s[2]}</small></div>`).join('')}</div><div class="sp-flight-flow"><span>✈ <strong>Flight timetable</strong><small>Scheduled / ETA / Delay · DEMO</small></span><i>→</i><span><strong>Pickup Planner</strong><small>ETA + เวลาออกจากอาคาร − เวลาเดินทาง</small></span><i>→</i><span><strong>ปรับเวลามารับ</strong><small>ลดการรอบนถนนและในพื้นที่ห้ามจอด</small></span><button class="btn primary" type="button" data-view="pickup">วางแผนรับผู้โดยสาร ›</button></div><div class="sp-response"><div><b>LEVEL 1</b><strong>Traffic Warning</strong><small>เวลาเกินเกณฑ์ ≠ หลักฐานว่าจอด</small></div><div><b>LEVEL 2</b><strong>Enforcement Review</strong><small>ต้องตรวจหลักฐาน CCTV และบริบท</small></div><div><b>LEVEL 3</b><strong>Security Review</strong><small>แจ้งเพื่อประเมิน ไม่สั่งการจริงในเดโม</small></div></div></div></section>`;
  }
  function analytics() {
    const rows = vehicles(), counts={SECURITY:0,ENFORCEMENT:0,WARNING:0,NORMAL:0};
    rows.forEach(v=>counts[assess(v).level]++);
    const total=rows.length, max=Math.max(1,...Object.values(counts));
    const cumulative=[]; let angle=0;
    Object.keys(counts).forEach(k=>{const start=angle; angle+=total?counts[k]/total*360:0; cumulative.push(`${COLORS[k]} ${start}deg ${angle}deg`);});
    return `<div class="sp-charts"><section class="panel"><div class="panel-head"><h2 class="panel-title">Risk distribution · DEMO</h2></div><div class="panel-body sp-distribution"><div class="sp-donut" style="background:conic-gradient(${total?cumulative.join(','):'#1c3549 0deg 360deg'})" role="img" aria-label="สัดส่วนความเสี่ยงจากรถจำลอง ${total} คัน"><div><b>${total}</b><small>DEMO VEHICLES</small></div></div><div class="sp-bars">${Object.keys(counts).map(k=>`<div><span><i style="background:${COLORS[k]}"></i>${LABELS[k]}</span><b>${counts[k]}</b><div><i style="width:${counts[k]/max*100}%;background:${COLORS[k]}"></i></div></div>`).join('')}</div></div></section><section class="panel"><div class="panel-head"><h2 class="panel-title">Passage time · DEMO</h2></div><div class="panel-body"><div class="sp-timebars">${rows.slice(0,8).map(v=>{const a=assess(v);return `<div><span>${escape(v.plate)}</span><div><i style="width:${Math.min(100,a.elapsed/120*100)}%;background:${COLORS[a.level]}"></i></div><b>${a.elapsed}m</b></div>`;}).join('')}</div><p class="sp-caption">ระยะเวลาระหว่างกล้อง ไม่ใช่ระยะเวลาจอด • ไม่มี GPS จาก ANPR สองจุด</p></div></section></div>`;
  }
  function loadMap() {
    if (window.L) return Promise.resolve(window.L);
    if (mapPromise) return mapPromise;
    mapPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.crossOrigin='anonymous';
      const timeout=setTimeout(()=>reject(new Error('Map library unavailable')),10000);
      script.onload=()=>{clearTimeout(timeout); if(window.L) resolve(window.L); else reject(new Error('Map library unavailable'));};
      script.onerror=()=>{clearTimeout(timeout);reject(new Error('Map library unavailable'));};
      document.head.appendChild(script);
    });
    return mapPromise;
  }
  function makePanel() {
    const el=document.createElement('section');
    el.id='restored-corridor-map';el.className='panel sp-map-panel';
    el.innerHTML=`<div class="panel-head"><div><div class="section-label">SUVARNABHUMI · CORRIDOR MAP</div><h2 class="panel-title">แผนที่กล้องและสถานการณ์จำลอง</h2><p class="panel-sub">ลากแผนที่ / ซูม / คลิกกล้องและรถเพื่อดูข้อมูล</p></div><div class="action-row"><button class="mini-btn" type="button" data-sp="fit">⌖ แสดงสองกล้อง</button><button class="mini-btn" type="button" data-sp="expand">ขยายแผนที่ ↗</button></div></div><div class="sp-toolbar"><label><input type="checkbox" data-sp-toggle="zones" checked> โซนจำลอง</label><label><input type="checkbox" data-sp-toggle="vehicles" checked> รถจำลอง</label><label><input type="checkbox" data-sp-toggle="alerts"> เฉพาะ Alert</label><span class="sp-map-status" role="status">กำลังโหลดแผนที่พื้นฐาน…</span></div><div class="sp-map-body"><div id="corridor-map-canvas" class="sp-map-canvas" aria-label="แผนที่สุวรรณภูมิแบบโต้ตอบ"></div><div class="sp-map-fallback" hidden><strong>แผนที่พื้นฐานยังไม่พร้อมใช้งาน</strong>${schematic()}<p>แผนผังและส่วนอื่นยังใช้งานได้ โดยไม่ต้องรอเซิร์ฟเวอร์</p><button class="btn" type="button" data-sp="retry">ลองโหลดแผนที่อีกครั้ง</button></div></div><div class="sp-map-bottom"><span><i style="background:#45e2cf"></i>ANPR 01 / 02</span><span><i style="background:#ff7c8a"></i>โซน / รถที่ต้องตรวจสอบ (DEMO)</span><span><i style="background:#73b8ff"></i>เวลาผ่านเส้นทางเกินเกณฑ์</span></div><p class="sp-caption sp-map-disclaimer">พิกัดกล้องจากโจทย์ผู้ใช้ • ตำแหน่งรถและโซนเป็นข้อมูลสมมติ ไม่ใช่ GPS หรือเขตห้ามจอดที่ประกาศจริง • เส้นประแสดงการเชื่อมโยงกล้อง ไม่ใช่แนวถนน</p>`;
    el.addEventListener('click',event=>{
      const action=event.target.closest('[data-sp]');if(!action)return;
      if(action.dataset.sp==='fit'&&map)map.fitBounds([ENTRY,EXIT],{padding:[54,54]});
      if(action.dataset.sp==='expand')openExtra('map');
      if(action.dataset.sp==='retry'){mapPromise=null;startMap();}
    });
    el.addEventListener('change',event=>{
      const key=event.target.dataset.spToggle;
      if(key==='zones'){zonesOn=event.target.checked;if(map){if(zonesOn)zoneLayer.addTo(map);else map.removeLayer(zoneLayer);}}
      if(key==='vehicles')vehiclesOn=event.target.checked;
      if(key==='alerts')alertsOnly=event.target.checked;
      refreshVehicles();
    });
    return el;
  }
  function mapStatus(text) { if(panel)panel.querySelector('.sp-map-status').textContent=text; }
  function startMap() {
    if(map){requestAnimationFrame(()=>map.invalidateSize());return;}
    panel.querySelector('.sp-map-fallback').hidden=true;
    mapNode.hidden=false; mapStatus('กำลังโหลดแผนที่พื้นฐาน…');
    loadMap().then(L=>{
      if(map)return;
      map=L.map(mapNode,{scrollWheelZoom:false,zoomControl:true}).setView([13.6795,100.758],13);
      mapNode.dataset.ready='true';
      const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'}).addTo(map);
      tiles.on('tileload',()=>{tilesOK++;mapStatus('แผนที่พร้อม · ข้อมูลสถานการณ์ DEMO');});
      tiles.on('tileerror',()=>{if(!tilesOK)mapStatus('โหลดภาพพื้นฐานไม่ได้ · กล้องและแผนผังยังแสดง');});
      [[ENTRY,'01','ENTRY'],[EXIT,'02','EXIT']].forEach(([point,n,label])=>{
        L.marker(point,{icon:L.divIcon({className:'sp-camera-icon',html:`<span>${n}</span>`,iconSize:[38,38],iconAnchor:[19,19]}),title:'ANPR '+n+' '+label}).addTo(map).bindPopup(`<strong>ANPR ${n} · ${label}</strong><br>${point[0]}, ${point[1]}<br>พิกัดอ้างอิงจากโจทย์ผู้ใช้`).bindTooltip('ANPR '+n+' · '+label,{permanent:true,direction:'right',offset:[22,0]});
      });
      schematicLayer=L.polyline([ENTRY,EXIT],{color:'#45e2cf',weight:3,opacity:.75,dashArray:'8 9'}).addTo(map).bindTooltip('เส้นเชื่อมกล้องเชิงแนวคิด ไม่ใช่แนวถนนจริง');
      zoneLayer=L.layerGroup().addTo(map);
      ZONES.forEach(z=>L.circle(z.point,{radius:z.radius,color:'#ff7c8a',weight:2,fillOpacity:.13,dashArray:'5 5'}).bindPopup(`<strong>${z.name}</strong><br>โซนตัวอย่างจากเดโมเดิม<br>ไม่ใช่เขตปฏิบัติการจริงหรือการประเมินจุดเสี่ยง`).addTo(zoneLayer));
      vehicleLayer=L.layerGroup().addTo(map);
      L.control.scale({imperial:false}).addTo(map);
      map.fitBounds([ENTRY,EXIT],{padding:[54,54]});
      if(!zonesOn)map.removeLayer(zoneLayer);
      refreshVehicles();
      requestAnimationFrame(()=>map.invalidateSize());
    }).catch(()=>{
      mapNode.hidden=true;panel.querySelector('.sp-map-fallback').hidden=false;
      mapStatus('แสดงแผนผังสำรอง · แผนที่พื้นฐานยังโหลดไม่ได้');
    });
  }
  function refreshVehicles() {
    if(!map||!vehicleLayer)return;
    vehicleLayer.clearLayers();
    if(!vehiclesOn)return;
    vehicles().filter(v=>!v.exitAt).forEach((v,i)=>{
      const a=assess(v); if(alertsOnly&&a.level==='NORMAL')return;
      const t=.18+(i%6)*.12;
      const zone=ZONES.find(z=>z.name===v.zone);
      const point=v.cctvStopped&&zone?zone.point:[ENTRY[0]+(EXIT[0]-ENTRY[0])*t,ENTRY[1]+(EXIT[1]-ENTRY[1])*t+.0013];
      const icon=L.divIcon({className:'sp-vehicle-icon',html:`<span style="background:${COLORS[a.level]}">▰</span>`,iconSize:[28,28],iconAnchor:[14,14]});
      L.marker(point,{icon,title:v.plate+' · simulated position'}).addTo(vehicleLayer).bindPopup(`<strong>${escape(v.plate)}</strong><br>${escape(v.vehicleType)} · ${a.elapsed} min<br>${LABELS[a.level]}<br><strong>ตำแหน่งจำลอง ไม่ใช่ GPS</strong><br>${v.cctvStopped?'CCTV จำลอง: หยุด '+Number(v.cctvDuration||0)+' นาที':'ยังไม่มี CCTV ยืนยันการจอด'}<br><button class="mini-btn" type="button" data-view="alerts">เปิดรายการตรวจสอบ ›</button>`);
    });
  }
  function mountMap(host) {
    if(!panel){panel=makePanel();mapNode=panel.querySelector('.sp-map-canvas');}
    host.appendChild(panel);startMap();refreshVehicles();
  }
  function restoreInline() {
    if(extraView)return;
    const content=document.getElementById('content');
    if(!content||!content.children.length)return;
    const view=document.querySelector('#navigation [data-view].is-active')?.dataset.view;
    if(view!=='overview'&&view!=='anpr')return;
    if(content.querySelector('[data-spatial-restored]')){refreshVehicles();return;}
    const holder=document.createElement('div');holder.dataset.spatialRestored='true';holder.className='sp-restoration';
    const before=view==='overview'?content.querySelector('.kpi-grid')?.nextElementSibling:content.querySelector('.case-grid')?.nextElementSibling;
    content.insertBefore(holder,before||content.firstChild);
    mountMap(holder);
    const flow=document.createElement('div');flow.innerHTML=workflow();holder.appendChild(flow);
  }
  function openExtra(view) {
    extraView=view;
    if(!extraScreen){extraScreen=document.createElement('section');extraScreen.id='spatial-screen';extraScreen.tabIndex=-1;document.getElementById('content').after(extraScreen);}
    document.getElementById('content').hidden=true;extraScreen.hidden=false;
    document.querySelectorAll('#navigation .nav-item').forEach(b=>b.classList.toggle('is-active',b.dataset.spatialView===view));
    document.getElementById('pageTitle').textContent=view==='map'?'Corridor Map & Diagrams':'Risk & Traffic Analytics';
    document.getElementById('pageSubtitle').textContent='แผนที่และแผนผังการทำงาน พร้อมข้อมูล ANPR / CCTV จำลอง';
    extraScreen.innerHTML=view==='map'?'<div id="sp-map-host"></div>'+schematic()+workflow():analytics()+workflow();
    if(view==='map')mountMap(extraScreen.querySelector('#sp-map-host'));
    window.scrollTo({top:0,behavior:'auto'});
  }
  function closeExtra() {
    extraView=null;if(extraScreen)extraScreen.hidden=true;
    document.getElementById('content').hidden=false;
    document.querySelectorAll('[data-spatial-view]').forEach(b=>b.classList.remove('is-active'));
  }
  function init() {
    const nav=document.getElementById('navigation');
    const button=document.createElement('button');button.type='button';button.className='nav-item';button.dataset.spatialView='map';
    button.innerHTML='<span class="nav-glyph">⌖</span><span>Map & Diagrams</span><span class="nav-arrow">›</span>';
    nav.querySelector('[data-view="overview"]').after(button);
    const analyticsButton=document.createElement('button');analyticsButton.type='button';analyticsButton.className='nav-item';analyticsButton.dataset.spatialView='analytics';
    analyticsButton.innerHTML='<span class="nav-glyph">▥</span><span>Analytics</span><span class="nav-arrow">›</span>';nav.appendChild(analyticsButton);
    document.addEventListener('click',event=>{
      const custom=event.target.closest('[data-spatial-view]');if(custom){openExtra(custom.dataset.spatialView);return;}
      if(event.target.closest('[data-view],[data-pickup]'))closeExtra();
    },true);
    const observer=new MutationObserver(()=>{
      if(extraView){refreshVehicles();if(extraView==='analytics')extraScreen.innerHTML=analytics()+workflow();return;}
      restoreInline();
    });
    observer.observe(document.getElementById('content'),{childList:true});
    window.addEventListener('resize',()=>{if(map)map.invalidateSize();});
    window.addEventListener('storage',refreshVehicles);
    restoreInline();
  }
  // Small read-only QA API, no credentials or personal data.
  window.ANPRSpatial=Object.freeze({version:'1.1.0',getCameraCoordinates:()=>[ENTRY.slice(),EXIT.slice()],getMap:()=>map,assess});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

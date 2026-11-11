/* Persistent Leaflet panel: all data comes from ANPRStore, not localStorage.
 * Camera coordinates are user supplied. Vehicles, circles and the dashed
 * connection are illustrative, NOT GPS, a road route or approved security zones.
 */
(function(global){
  'use strict';
  const S=global.ANPRStore,ENTRY=[13.649323184689877,100.74713256767531],EXIT=[13.709441941455099,100.7693773608348];
  const ZONES=[{name:'DEMO-ZONE-A',point:[13.6695,100.7548],radius:240},{name:'DEMO-ZONE-B',point:[13.6922,100.7621],radius:290}];
  const COLORS={SECURITY:'#ff7c8a',ENFORCEMENT:'#ffca78',WARNING:'#73b8ff',NORMAL:'#45e2cf'};
  const LABELS={SECURITY:'Security review',ENFORCEMENT:'CCTV review',WARNING:'Time exception',NORMAL:'Normal'};
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  let map,panel,mapNode,vehicleLayer,zoneLayer,tileLayer,mapPromise,selectedId=null;
  let zonesOn=true,vehiclesOn=true,alertsOnly=false,tilesOK=0;
  const markers=new Map();
  function assessment(v,data){const a=S.assess(v,data.config),c=data.cases.find(c=>c.vehicleId===v.id);return {...a,level:c&&c.status!=='closed'?c.peakLevel:a.level};}
  function schematic(){return '<div class="sp-schematic" aria-label="แผนผังแนวคิด ไม่ใช่แนวถนน"><div class="sp-node"><b>01</b><strong>ANPR ENTRY</strong><small>13.649323, 100.747133</small></div><div class="sp-connector"><span>ทะเบียน + เวลาเข้า</span><i>→</i></div><div class="sp-node sp-zone"><b>CCTV</b><strong>OBSERVATION</strong><small>ตำแหน่ง + เวลาหยุด (จำลอง)</small></div><div class="sp-connector"><span>จับคู่ทะเบียน</span><i>→</i></div><div class="sp-node"><b>02</b><strong>ANPR EXIT</strong><small>13.709442, 100.769377</small></div></div><p class="sp-caption">แผนผังเชิงแนวคิด ไม่ใช่แนวถนนหรือแนวเขตที่ยืนยันแล้ว</p>';}
  function workflow(){
    const steps=[['01','ANPR Entry','บันทึกทะเบียนและเวลาเข้า'],['02','CCTV Observation','ตรวจตำแหน่งและระยะเวลาหยุด'],['03','ANPR Exit','จับคู่เวลาเข้า–ออก ไม่ลบเหตุเดิม'],['04','Evidence Review','รับทราบ → ตรวจสอบ → ส่งต่อ'],['05','Human Decision','บันทึกเหตุผลก่อนปิดเคส']];
    return `<section class="panel sp-workflow"><div class="panel-head"><div><div class="section-label">SYSTEM WORKFLOW</div><h2 class="panel-title">ANPR + CCTV + Flight Integration</h2></div><span class="pill review">DEMO</span></div><div class="panel-body"><div class="sp-flow">${steps.map(s=>`<div class="sp-step"><span>${s[0]}</span><strong>${s[1]}</strong><small>${s[2]}</small></div>`).join('')}</div><div class="sp-flight-flow"><span><strong>Flight timetable</strong><small>Scheduled / ETA / Delay · DEMO</small></span><i>→</i><span><strong>Pickup Planner</strong><small>ETA + เวลาออกจากอาคาร − เดินทาง − เวลาเผื่อ</small></span><i>→</i><span><strong>ปรับเวลามารับ</strong><small>ไม่แนะนำให้รอในเขตห้ามจอด</small></span><button class="btn primary" type="button" data-view="pickup">วางแผนรับ ›</button></div><div class="sp-response"><div><b>LEVEL 1</b><strong>Traffic Warning</strong><small>เวลาผ่านทางนาน ≠ หลักฐานว่าจอด</small></div><div><b>LEVEL 2</b><strong>Enforcement Review</strong><small>ต้องมีเวลาหยุดและโซนจาก CCTV</small></div><div><b>LEVEL 3</b><strong>Security Review</strong><small>เจ้าหน้าที่ประเมิน; เดโมไม่ส่งคำสั่งจริง</small></div></div></div></section>`;
  }
  function analytics(data=S.snapshot()){
    const rows=data.vehicles,counts={SECURITY:0,ENFORCEMENT:0,WARNING:0,NORMAL:0};rows.forEach(v=>counts[assessment(v,data).level]++);
    const total=rows.length,max=Math.max(1,...Object.values(counts));let angle=0;
    const stops=Object.keys(counts).map(k=>{const start=angle;angle+=total?counts[k]/total*360:0;return `${COLORS[k]} ${start}deg ${angle}deg`;});
    return `<div class="sp-charts"><section class="panel"><div class="panel-head"><h2 class="panel-title">Risk distribution · DEMO</h2></div><div class="panel-body sp-distribution"><div class="sp-donut" style="background:conic-gradient(${total?stops.join(','):'#1c3549 0deg 360deg'})" role="img" aria-label="รถจำลอง ${total} คัน"><div><b>${total}</b><small>DEMO VEHICLES</small></div></div><div class="sp-bars">${Object.keys(counts).map(k=>`<div><span><i style="background:${COLORS[k]}"></i>${LABELS[k]}</span><b>${counts[k]}</b><div><i style="width:${counts[k]/max*100}%;background:${COLORS[k]}"></i></div></div>`).join('')}</div></div></section><section class="panel"><div class="panel-head"><h2 class="panel-title">Passage time · DEMO</h2></div><div class="panel-body"><div class="sp-timebars">${rows.slice(0,12).map(v=>{const a=assessment(v,data);return `<div><span>${esc(v.plate)}</span><div><i style="width:${Math.min(100,a.elapsed/120*100)}%;background:${COLORS[a.level]}"></i></div><b>${a.elapsed}m</b></div>`;}).join('')}</div><p class="sp-caption">ระยะเวลาระหว่างกล้อง ไม่ใช่เวลาจอด • ระดับเหตุที่ยังเปิดอ้างอิงประวัติสูงสุด</p></div></section></div>`;
  }
  function loadLibrary(){
    if(global.L)return Promise.resolve(global.L);
    if(mapPromise)return mapPromise;
    mapPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';script.crossOrigin='anonymous';
      script.integrity='sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
      const timer=setTimeout(()=>reject(new Error('Map library timeout')),10000);
      script.onload=()=>{clearTimeout(timer);global.L?resolve(global.L):reject(new Error('Map unavailable'));};
      script.onerror=()=>{clearTimeout(timer);reject(new Error('Map unavailable'));};document.head.appendChild(script);
    });return mapPromise;
  }
  function status(message){panel.querySelector('.sp-map-status').textContent=message;}
  function makePanel(){
    const el=document.createElement('section');el.id='restored-corridor-map';el.className='panel sp-map-panel';
    el.innerHTML=`<div class="panel-head"><div><div class="section-label">SUVARNABHUMI · CORRIDOR MAP</div><h2 class="panel-title">แผนที่กล้องและสถานการณ์จำลอง</h2><p class="panel-sub">ลาก / ซูม / คลิกรถเพื่อดูข้อมูลและเปิดเคสที่เลือก</p></div><div class="action-row"><button class="mini-btn" type="button" data-sp="fit">⌖ แสดงสองกล้อง</button><button class="mini-btn" type="button" data-view="map">ขยายแผนที่ ↗</button></div></div><div class="sp-toolbar"><label><input type="checkbox" data-sp-toggle="zones" checked> โซนจำลอง</label><label><input type="checkbox" data-sp-toggle="vehicles" checked> รถจำลอง</label><label><input type="checkbox" data-sp-toggle="alerts"> เฉพาะ Alert</label><label>เลือกรถ <select id="mapVehicleSelect" aria-label="เลือกรถบนแผนที่"><option value="">เลือกทะเบียน</option></select></label><span class="sp-map-status" role="status">กำลังโหลดแผนที่พื้นฐาน…</span></div><div class="sp-map-body"><div id="corridor-map-canvas" class="sp-map-canvas" aria-label="แผนที่สุวรรณภูมิแบบโต้ตอบ"></div><div class="sp-map-fallback" hidden><strong>แผนที่พื้นฐานยังไม่พร้อม</strong>${schematic()}<p>แผนผังและส่วนอื่นยังใช้งานได้ ไม่ต้องรอเซิร์ฟเวอร์</p><button class="btn" type="button" data-sp="retry">ลองโหลดแผนที่อีกครั้ง</button></div></div><div class="sp-map-bottom"><span><i style="background:#45e2cf"></i>ANPR 01 / 02</span><span><i style="background:#ff7c8a"></i>โซน / รถที่ต้องตรวจสอบ (DEMO)</span><span><i style="background:#73b8ff"></i>เวลาผ่านเส้นทางเกินเกณฑ์</span></div><p class="sp-caption sp-map-disclaimer">พิกัดกล้องจากโจทย์ผู้ใช้ • รถและโซนเป็นข้อมูลสมมติ ไม่ใช่ GPS หรือเขตห้ามจอดจริง • เส้นประไม่ใช่แนวถนน • สัญลักษณ์ที่ซ้อนกันถูกแยกเพื่อคลิกได้</p>`;
    el.addEventListener('click',e=>{const b=e.target.closest('[data-sp]');if(!b)return;if(b.dataset.sp==='fit'&&map)map.fitBounds([ENTRY,EXIT],{padding:[54,54]});if(b.dataset.sp==='retry'){mapPromise=null;if(map){tilesOK=0;tileLayer.redraw();}else start();}});
    el.addEventListener('change',e=>{
      const key=e.target.dataset.spToggle;
      if(key==='zones'){zonesOn=e.target.checked;if(map&&zoneLayer){if(zonesOn)zoneLayer.addTo(map);else map.removeLayer(zoneLayer);}}
      if(key==='vehicles')vehiclesOn=e.target.checked;
      if(key==='alerts')alertsOnly=e.target.checked;
      if(key)refresh();
      if(e.target.id==='mapVehicleSelect'&&e.target.value){
        selectedId=e.target.value;
        if(!vehiclesOn){vehiclesOn=true;el.querySelector('[data-sp-toggle="vehicles"]').checked=true;}
        alertsOnly=false;el.querySelector('[data-sp-toggle="alerts"]').checked=false;refresh();
        const marker=markers.get(selectedId);if(marker){map.panTo(marker.getLatLng());marker.openPopup();}
      }
    });return el;
  }
  function start(){
    if(map){requestAnimationFrame(()=>{map.invalidateSize();refresh();});return;}
    mapNode.hidden=false;panel.querySelector('.sp-map-fallback').hidden=true;status('กำลังโหลดแผนที่พื้นฐาน…');
    loadLibrary().then(L=>{
      if(map)return;
      map=L.map(mapNode,{scrollWheelZoom:false,zoomControl:true}).setView([13.6795,100.758],13);
      mapNode.dataset.ready='true';
      tileLayer=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'}).addTo(map);
      tileLayer.on('tileload',()=>{tilesOK++;status('แผนที่พร้อม · สถานการณ์ DEMO');});
      tileLayer.on('tileerror',()=>{if(!tilesOK)status('โหลดพื้นฐานไม่ได้ · กล้องและแผนผังยังใช้ได้');});
      [[ENTRY,'01','ENTRY'],[EXIT,'02','EXIT']].forEach(([point,n,label])=>L.marker(point,{icon:L.divIcon({className:'sp-camera-icon',html:`<span>${n}</span>`,iconSize:[38,38],iconAnchor:[19,19]}),title:'ANPR '+n+' '+label,zIndexOffset:1000}).addTo(map).bindPopup(`<strong>ANPR ${n} · ${label}</strong><br>${point.join(', ')}<br>พิกัดจากโจทย์ผู้ใช้`).bindTooltip('ANPR '+n+' · '+label,{permanent:true,direction:'right',offset:[22,0]}));
      L.polyline([ENTRY,EXIT],{color:'#45e2cf',weight:3,opacity:.7,dashArray:'8 9'}).addTo(map).bindTooltip('เส้นเชื่อมกล้อง ไม่ใช่แนวถนน');
      zoneLayer=L.layerGroup().addTo(map);
      ZONES.forEach(z=>L.circle(z.point,{radius:z.radius,color:'#ff7c8a',weight:2,fillOpacity:.12,dashArray:'5 5'}).bindPopup(`<strong>${z.name}</strong><br>โซนตัวอย่าง ไม่ใช่เขตปฏิบัติการจริง`).addTo(zoneLayer));
      vehicleLayer=L.layerGroup().addTo(map);L.control.scale({imperial:false}).addTo(map);
      map.fitBounds([ENTRY,EXIT],{padding:[54,54]});if(!zonesOn)map.removeLayer(zoneLayer);
      map.on('zoomend',()=>refresh());refresh();requestAnimationFrame(()=>map.invalidateSize());
    }).catch(()=>{mapNode.hidden=true;panel.querySelector('.sp-map-fallback').hidden=false;status('ใช้แผนผังสำรอง · ส่วนอื่นไม่ถูกบล็อก');});
  }
  function refresh(){
    if(!panel)return;
    const data=S.snapshot(),active=data.vehicles.filter(v=>!v.exitAt).sort((a,b)=>a.id.localeCompare(b.id));
    const select=panel.querySelector('#mapVehicleSelect'),value=select.value;
    select.innerHTML='<option value="">เลือกทะเบียน</option>'+active.map(v=>`<option value="${esc(v.id)}">${esc(v.plate)}</option>`).join('');select.value=value;
    if(!map||!vehicleLayer)return;
    const popupId=[...markers.entries()].find(([,m])=>m.isPopupOpen())?.[0];
    vehicleLayer.clearLayers();markers.clear();if(!vehiclesOn)return;
    const occupied=[ENTRY,EXIT].map(p=>map.latLngToContainerPoint(p));
    active.forEach((v,i)=>{
      const a=assessment(v,data);if(alertsOnly&&a.level==='NORMAL')return;
      const zone=ZONES.find(z=>z.name===v.zone),t=.18+(i%6)*.12;
      const actual=v.cctvStopped&&zone?zone.point:[ENTRY[0]+(EXIT[0]-ENTRY[0])*t,ENTRY[1]+(EXIT[1]-ENTRY[1])*t+.0013];
      const origin=map.latLngToContainerPoint(actual);let point=origin;
      // Pixel-based collision separation retains each original DEMO coordinate.
      // A leader line marks any displacement; the selector provides another path.
      for(let n=0;n<180&&occupied.some(p=>p.distanceTo(point)<38);n++){
        const angle=n*2.399963, radius=40+Math.floor(n/10)*18;
        point=L.point(origin.x+Math.cos(angle)*radius,origin.y+Math.sin(angle)*radius);
      }
      occupied.push(point);const display=map.containerPointToLatLng(point);
      if(point.distanceTo(origin)>1)L.polyline([actual,display],{color:COLORS[a.level],weight:1,opacity:.65,dashArray:'2 4',interactive:false}).addTo(vehicleLayer);
      const icon=L.divIcon({className:'sp-vehicle-icon',html:`<span style="background:${COLORS[a.level]}">▰</span>`,iconSize:[28,28],iconAnchor:[14,14]});
      const marker=L.marker(display,{icon,title:v.plate+' · simulated position',riseOnHover:true}).addTo(vehicleLayer);
      marker.bindPopup(`<strong>${esc(v.plate)}</strong><br>${esc(v.vehicleType)} · ${a.elapsed} min<br>${LABELS[a.level]}<br><strong>ตำแหน่งจำลอง ไม่ใช่ GPS</strong><br>${v.cctvStopped?'CCTV จำลอง: หยุด '+v.cctvDuration+' นาที':'ยังไม่มี CCTV ยืนยันการจอด'}<br><button class="mini-btn" type="button" data-open-vehicle="${esc(v.id)}">เปิดเคส ${esc(v.plate)} ›</button>`);
      marker.on('click',()=>{selectedId=v.id;select.value=v.id;});markers.set(v.id,marker);
    });
    if(popupId&&markers.has(popupId))markers.get(popupId).openPopup();
  }
  function mount(host){if(!panel){panel=makePanel();mapNode=panel.querySelector('.sp-map-canvas');}host.appendChild(panel);start();refresh();}
  S.subscribe(refresh);global.addEventListener('resize',()=>{if(map){map.invalidateSize();refresh();}});
  global.ANPRSpatial=Object.freeze({version:'1.2.0',mount,schematic,workflow,analytics,getMap:()=>map,getCameraCoordinates:()=>[ENTRY.slice(),EXIT.slice()],assess:(v)=>S.assess(v,S.snapshot().config)});
})(window);

/* Standalone, dependency-free browser demo. No backend, no health checks,
 * no camera connection, and no live flight API requests.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "bkk-anpr-airport-intelligence-demo-v1";
  var MINUTE_MS = 60 * 1000;
  var viewTitles = {
    overview: ["Operations Overview", "ภาพรวมเที่ยวบินขาเข้าและการเฝ้าระวังยานพาหนะในพื้นที่ควบคุม"],
    flights: ["Flight Arrivals", "กระดานเที่ยวบินขาเข้าสุวรรณภูมิ พร้อมสถานะและเวลาโดยประมาณ (ข้อมูลจำลอง)"],
    pickup: ["Pickup Time Planner", "ช่วยผู้มารับผู้โดยสารปรับเวลาเดินทางตามเที่ยวบินที่เปลี่ยนแปลง"],
    anpr: ["ANPR Monitoring", "ระบบติดตามเวลาผ่านจุดอ่านป้ายทะเบียน 2 จุด (ข้อมูลจำลอง)"],
    alerts: ["Security Exceptions", "รายการผิดปกติสำหรับตรวจสอบ โดยยังไม่ใช่หลักฐานยืนยันความผิด"]
  };
  var state = {
    view: "overview",
    flights: [],
    vehicles: [],
    search: "",
    statusFilter: "ALL",
    selectedFlightId: "F303",
    travelMinutes: 60,
    processingMinutes: 50,
    bufferMinutes: 10,
    flightError: ""
  };

  function esc(input) {
    return String(input == null ? "" : input).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }
  function time(iso) {
    if (!iso) return "—";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false
    }).format(new Date(iso));
  }
  function fullTime(iso) {
    if (!iso) return "—";
    return new Intl.DateTimeFormat("th-TH-u-nu-latn", {
      timeZone: "Asia/Bangkok", day: "numeric", month: "short",
      hour: "2-digit", minute: "2-digit", hour12: false
    }).format(new Date(iso));
  }
  function minutesSince(iso, endIso) {
    var end = endIso ? Date.parse(endIso) : Date.now();
    return Math.max(0, Math.floor((end - Date.parse(iso)) / MINUTE_MS));
  }
  function flightStatus(f) {
    return {
      ON_TIME: { text: "ON TIME", css: "on-time" },
      DELAYED: { text: "DELAYED", css: "delayed" },
      LANDED: { text: "LANDED", css: "landed" },
      CANCELLED: { text: "CANCELLED", css: "cancelled" }
    }[f.status] || { text: "UNKNOWN", css: "review" };
  }
  function pill(text, css) {
    return '<span class="pill ' + esc(css || "review") + '">' + esc(text) + "</span>";
  }
  function flightEta(f) {
    return f.actualAt || f.estimatedAt || f.scheduledAt;
  }
  function delayedFlights() {
    return state.flights.filter(function (f) { return f.status === "DELAYED"; });
  }
  function activeVehicles() {
    return state.vehicles.filter(function (v) { return !v.exitAt; });
  }

  function seedVehicles() {
    var now = Date.now();
    function ago(mins) { return new Date(now - mins * MINUTE_MS).toISOString(); }
    return [
      { id: "V001", plate: "TEST-2001", vehicleType: "Van", entryAt: ago(79), exitAt: null, cctvStopped: true, cctvDuration: 24, zone: "DEMO-ZONE-A", repeatCount: 2 },
      { id: "V002", plate: "TEST-2002", vehicleType: "Sedan", entryAt: ago(54), exitAt: null, cctvStopped: false, cctvDuration: 0, zone: "—", repeatCount: 1 },
      { id: "V003", plate: "TEST-2003", vehicleType: "Pickup", entryAt: ago(43), exitAt: ago(8), cctvStopped: true, cctvDuration: 8, zone: "DEMO-ZONE-B", repeatCount: 1 },
      { id: "V004", plate: "TEST-2004", vehicleType: "Sedan", entryAt: ago(22), exitAt: null, cctvStopped: false, cctvDuration: 0, zone: "—", repeatCount: 1 },
      { id: "V005", plate: "TEST-2005", vehicleType: "SUV", entryAt: ago(67), exitAt: ago(15), cctvStopped: false, cctvDuration: 0, zone: "—", repeatCount: 1 },
      { id: "V006", plate: "TEST-2006", vehicleType: "Taxi", entryAt: ago(13), exitAt: ago(2), cctvStopped: false, cctvDuration: 0, zone: "—", repeatCount: 1 }
    ];
  }
  function loadVehicles() {
    try {
      var item = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (item && item.version === 1 && Array.isArray(item.vehicles)) return item.vehicles;
    } catch (err) { /* localStorage may be blocked by browser settings */ }
    return seedVehicles();
  }
  function saveVehicles() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, vehicles: state.vehicles }));
    } catch (err) { /* demo works without persistent storage */ }
  }
  function vehicleAssessment(v) {
    var elapsed = minutesSince(v.entryAt, v.exitAt);
    var cctv = Boolean(v.cctvStopped);
    var level = "NORMAL";
    // A 2-camera overstay by itself is NEVER proof of illegal stopping.
    if (cctv && !v.exitAt && elapsed > 30) level = "SECURITY";
    else if (cctv) level = "ENFORCEMENT";
    else if (elapsed > 30) level = "WARNING";
    var score = Math.min(100, (elapsed > 30 ? 30 : 0)
      + (elapsed > 60 ? 12 : 0)
      + (cctv ? 45 : 0)
      + ((v.repeatCount || 1) > 1 ? 10 : 0));
    var label = level === "SECURITY" ? "SECURITY ALERT"
      : level === "ENFORCEMENT" ? "REVIEW CASE"
      : level === "WARNING" ? "TIME EXCEPTION" : "NORMAL";
    return { level: level, label: label, elapsed: elapsed, score: score };
  }
  function exceptions() {
    var order = { SECURITY: 0, ENFORCEMENT: 1, WARNING: 2 };
    return state.vehicles.map(function (vehicle) {
      return { vehicle: vehicle, assessment: vehicleAssessment(vehicle) };
    }).filter(function (row) {
      return row.assessment.level !== "NORMAL";
    }).sort(function (a, b) {
      return order[a.assessment.level] - order[b.assessment.level];
    });
  }
  function counts() {
    var cases = exceptions();
    return {
      totalFlights: state.flights.length,
      delayedFlights: delayedFlights().length,
      activeVehicles: activeVehicles().length,
      overstayVehicles: state.vehicles.filter(function (v) { return vehicleAssessment(v).elapsed > 30; }).length,
      security: cases.filter(function (r) { return r.assessment.level === "SECURITY"; }).length,
      enforcement: cases.filter(function (r) { return r.assessment.level === "ENFORCEMENT"; }).length,
      warning: cases.filter(function (r) { return r.assessment.level === "WARNING"; }).length
    };
  }

  function kpi(label, value, detail, glyph, variant) {
    return '<article class="kpi ' + esc(variant || "") + '">'
      + '<div class="kpi-header"><span>' + esc(label) + '</span><span class="kpi-icon">' + esc(glyph) + '</span></div>'
      + '<div class="kpi-value ' + esc(variant || "teal") + '">' + esc(value) + '</div>'
      + '<div class="kpi-detail">' + esc(detail) + "</div></article>";
  }
  function panel(title, subtitle, inner, action) {
    return '<section class="panel"><div class="panel-head"><div><h2 class="panel-title">' + esc(title)
      + '</h2><p class="panel-sub">' + esc(subtitle) + '</p></div>'
      + (action || "") + '</div>' + inner + "</section>";
  }
  function flightRows(rows, compact) {
    if (!rows.length) return '<div class="empty-state"><strong>ไม่พบเที่ยวบิน</strong>ลองเปลี่ยนคำค้นหาหรือตัวกรองสถานะ</div>';
    var body = rows.map(function (f) {
      var s = flightStatus(f);
      var delay = window.FlightProvider.delayMinutes(f);
      return '<tr><td><div class="flight-no">' + esc(f.flightNo)
        + '</div><div class="secondary-text">' + esc(f.airline) + '</div></td>'
        + '<td><strong>' + esc(f.originCode) + '</strong><div class="secondary-text">' + esc(f.origin) + '</div></td>'
        + '<td class="num">' + time(f.scheduledAt) + '</td>'
        + '<td class="num ' + (delay ? "amber-text" : "") + '">' + (f.status === "CANCELLED" ? "—" : time(flightEta(f))) + '</td>'
        + '<td>' + (delay ? '<strong class="amber-text">+' + delay + ' min</strong>' : '—') + '</td>'
        + '<td>' + pill(s.text, s.css) + '</td>'
        + '<td><button type="button" class="mini-btn" data-pickup="' + esc(f.id) + '"'
        + (f.status === "CANCELLED" ? " disabled" : "") + '>Plan pickup ›</button></td></tr>';
    }).join("");
    return '<div class="table-scroll"><table class="data-table ' + (compact ? "compact" : "") + '">'
      + '<thead><tr><th>Flight</th><th>Origin</th><th>Scheduled</th><th>Latest ETA / Actual</th>'
      + '<th>Delay</th><th>Status</th><th>Action</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  function routeDiagram() {
    return '<div class="route-panel"><div class="route-eyebrow">ANPR CHECKPOINT LINK · SCHEMATIC / NOT TO SCALE</div>'
      + '<div class="route-visual"><div class="camera-node"><span class="camera-pin">①</span>'
      + '<strong>CAMERA 01 · ENTRY</strong><small>13.649323, 100.747133</small></div>'
      + '<div class="route-line" aria-hidden="true"></div>'
      + '<div class="camera-node exit"><span class="camera-pin">②</span>'
      + '<strong>CAMERA 02 · EXIT</strong><small>13.709442, 100.769377</small></div></div>'
      + '<div class="route-caption">ตำแหน่งกล้องอ้างอิงจากโจทย์ผู้ใช้ · ระยะทางในภาพเป็นเพียงแผนภาพ ไม่ได้ใช้คำนวณความเร็วหรือการจอดรถ</div></div>'
      + '<div class="camera-links">'
      + '<a target="_blank" rel="noopener noreferrer" href="https://www.openstreetmap.org/?mlat=13.649323184689877&amp;mlon=100.74713256767531#map=16/13.649323184689877/100.74713256767531">View entry coordinate ↗</a>'
      + '<a target="_blank" rel="noopener noreferrer" href="https://www.openstreetmap.org/?mlat=13.709441941455099&amp;mlon=100.7693773608348#map=16/13.709441941455099/100.7693773608348">View exit coordinate ↗</a>'
      + '</div>';
  }
  function signalList(maxItems) {
    var items = exceptions().slice(0, maxItems || 5);
    if (!items.length) return '<div class="empty-state"><strong>ยังไม่มีรายการผิดปกติ</strong>ข้อมูลจำลองจะปรากฏเมื่อระยะเวลาเกินเกณฑ์</div>';
    return '<div class="signal-list">' + items.map(function (row) {
      var a = row.assessment, v = row.vehicle;
      var css = a.level === "SECURITY" ? "alert" : a.level === "ENFORCEMENT" ? "warning" : "";
      var desc = v.cctvStopped ? "มี CCTV จำลองยืนยันการหยุดใน DEMO-ZONE; รอเจ้าหน้าที่ทบทวน"
        : "ANPR แสดงเวลาผ่านเส้นทางเกิน 30 นาที; ยังไม่ยืนยันว่าจอดรถ";
      return '<div class="signal-item ' + css + '"><span class="signal-marker">'
        + (a.level === "SECURITY" ? "!" : "⌁") + '</span>'
        + '<div class="signal-info"><strong>' + esc(v.plate) + ' <span class="faint">·</span> ' + a.elapsed + ' นาที</strong><p>'
        + esc(desc) + '</p></div>' + pill(a.label, a.level === "SECURITY" ? "security" : a.level === "ENFORCEMENT" ? "enforcement" : "review")
        + '</div>';
    }).join("") + "</div>";
  }

  function renderOverview() {
    var c = counts();
    return '<div class="section-top"><div><h2 class="section-title">Airport Operations Snapshot</h2>'
      + '<p class="section-subtitle">รวมข้อมูล Flight Arrivals และ ANPR Exceptions ไว้บน Dashboard เดียว</p></div>'
      + pill("ALL FIGURES ARE DEMO", "review") + '</div>'
      + '<div class="kpi-grid">'
      + kpi("BKK Arrivals", c.totalFlights, "เที่ยวบินขาเข้าจำลอง", "✈", "teal")
      + kpi("Delayed Flights", c.delayedFlights, "ผู้มารับควรตรวจสอบ ETA ใหม่", "◷", "amber")
      + kpi("Vehicles In Zone", c.activeVehicles, "ตรวจพบเข้า แต่ยังไม่พบออก (DEMO)", "▣", "blue")
      + kpi("Security Alerts", c.security, "มี CCTV จำลองรองรับ / รอตรวจสอบ", "!", "red")
      + '</div>'
      + '<div class="two-col">'
      + panel("BKK · Arrival Flight Board", "Scheduled vs. latest estimated / actual arrival",
        flightRows(state.flights.slice(0, 6), true),
        '<button type="button" class="mini-btn" data-view="flights">All flights ›</button>')
      + panel("Perimeter · Exception Feed", "ANPR 2-point screening + mock CCTV verification",
        signalList(4),
        '<button type="button" class="mini-btn" data-view="alerts">View cases ›</button>')
      + '</div>'
      + '<div class="two-col equal">'
      + panel("Controlled Corridor", "Two ANPR reference points",
        '<div class="panel-body">' + routeDiagram() + '</div>',
        '<button type="button" class="mini-btn" data-view="anpr">ANPR dashboard ›</button>')
      + panel("Pickup Efficiency", "เดินทางมารับตาม ETA และลดการรอในเขตห้ามจอด",
        '<div class="panel-body"><div class="instruction-card" style="margin:0">'
        + '<div class="section-label">INTEGRATED VALUE</div>'
        + '<h3>ลดการมาถึงเร็วเกินจำเป็น</h3>'
        + '<p>เช็กสถานะเที่ยวบินก่อนออกเดินทาง เพิ่มเวลาตรวจคนเข้าเมืองและรอสัมภาระ จากนั้นแนะนำเวลาออกจากบ้านแทนการวนรถหรือจอดรอบนถนนสนามบิน</p>'
        + '<div class="action-row" style="margin-top:19px"><button type="button" class="btn primary" data-view="pickup">Open Pickup Planner ›</button></div>'
        + '</div><p class="inline-note warning"><strong>สำคัญ:</strong> เวลาเที่ยวบินและการเดินทางเป็นข้อมูลจำลอง ไม่ใช่คำแนะนำจาก AOT หรือข้อมูลจราจรสด</p></div>')
      + '</div>';
  }

  function filteredFlights() {
    var q = state.search.toLowerCase().trim();
    return state.flights.filter(function (f) {
      var matchText = !q || [f.flightNo, f.airline, f.origin, f.originCode].join(" ").toLowerCase().indexOf(q) >= 0;
      var matchStatus = state.statusFilter === "ALL" || f.status === state.statusFilter;
      return matchText && matchStatus;
    });
  }
  function renderFlightPage() {
    return '<div class="instruction-card"><span class="section-label">ARRIVAL MONITORING / DEMONSTRATION</span>'
      + '<h3>Flight delays affect pickup demand and roadside waiting</h3>'
      + '<p>แสดงเวลาเดิมและเวลาคาดการณ์ใหม่ พร้อมเครื่องมือช่วยญาติวางแผนเดินทางมาให้ใกล้เวลารับผู้โดยสารมากขึ้น เมื่อ AOT ให้ API สามารถเปลี่ยนแหล่งข้อมูลจาก DEMO เป็นข้อมูลจริงผ่าน FlightProvider ได้</p></div>'
      + panel("Suvarnabhumi · International & Domestic Arrivals", "Flight numbers and times below are fictional example records",
        '<div class="panel-body"><div class="control-bar">'
        + '<div class="field-row"><input id="flightSearch" class="text-input" type="search" placeholder="ค้นหา Flight / Origin / Airline" aria-label="ค้นหาเที่ยวบิน" value="' + esc(state.search) + '">'
        + '<select id="flightStatus" class="select-input" aria-label="กรองสถานะเที่ยวบิน">'
        + ['ALL', 'ON_TIME', 'DELAYED', 'LANDED', 'CANCELLED'].map(function (st) {
          return '<option value="' + st + '"' + (state.statusFilter === st ? " selected" : "") + '>'
            + (st === "ALL" ? "All statuses" : st.replace("_", " ")) + '</option>';
        }).join("")
        + '</select></div><div class="stage-indicator"><span class="active">DATA SOURCE: DEMO</span>'
        + '<span id="flightResultCount">' + filteredFlights().length + ' FLIGHTS</span></div></div>'
        + '<div id="flightResults">' + flightRows(filteredFlights(), false) + '</div>'
        + '<p class="inline-note warning">ข้อมูลทั้งหมดถูกจำลองไว้ใน Browser โดยไม่ดึง AOT API โปรดตรวจสอบเวลาจริงจาก <a href="' + esc(window.FlightProvider.officialUrl) + '" target="_blank" rel="noopener noreferrer" class="text-link">AOT Official Arrival Board ↗</a></p>'
        + '</div>');
  }
  function findSelectedFlight() {
    return state.flights.find(function (f) { return f.id === state.selectedFlightId; }) || state.flights[0];
  }
  function renderPickupResult() {
    var f = findSelectedFlight();
    if (!f) return '<div class="empty-state"><strong>ไม่มีข้อมูลเที่ยวบินจำลอง</strong>ไม่สามารถคำนวณเวลารับได้</div>';
    if (f.status === "CANCELLED") return '<div class="empty-state"><strong>เที่ยวบินยกเลิก</strong>โปรดตรวจสอบกับสายการบินและ AOT</div>';
    var plan = window.FlightProvider.planPickup(f, {
      travelMinutes: state.travelMinutes,
      passengerProcessingMinutes: state.processingMinutes,
      arrivalBufferMinutes: state.bufferMinutes
    });
    var untilDepart = Math.ceil((Date.parse(plan.departAt) - Date.now()) / MINUTE_MS);
    var message = untilDepart > 0
      ? "เหลือประมาณ " + untilDepart + " นาที ก่อนเวลาออกเดินทางที่คำนวณไว้"
      : "เวลาออกเดินทางที่คำนวณไว้ผ่านไปแล้ว กรุณาตรวจสอบสถานะเที่ยวบินและการจราจรอีกครั้ง";
    var delay = window.FlightProvider.delayMinutes(f);
    return '<div class="pickup-result">'
      + '<div class="metric-label">SUGGESTED LEAVE-HOME TIME · BANGKOK</div>'
      + '<div class="metric-time">' + time(plan.departAt) + '</div>'
      + '<div class="secondary-text">' + fullTime(plan.departAt) + '</div>'
      + '<p class="response">' + esc(message) + '</p></div>'
      + '<div class="pickup-details">'
      + '<div class="pickup-detail"><strong>' + time(plan.flightArrivalAt) + '</strong><span>เวลาเครื่องถึง (ETA / Actual) · ' + esc(f.flightNo) + '</span></div>'
      + '<div class="pickup-detail"><strong>' + time(plan.meetingAt) + '</strong><span>เวลาเริ่มรับผู้โดยสารโดยประมาณ</span></div>'
      + '<div class="pickup-detail"><strong>' + state.travelMinutes + ' min</strong><span>เวลาเดินทางจากต้นทาง</span></div>'
      + '<div class="pickup-detail"><strong>' + (delay ? "+" + delay + " min" : "—") + '</strong><span>ความล่าช้าจากตารางเดิม</span></div></div>'
      + '<p class="inline-note warning"><strong>เป็นเพียงการประมาณ:</strong> ค่าเดินทางไม่ได้มาจากระบบจราจรสด และเวลาผ่านตรวจคนเข้าเมือง/รับกระเป๋าอาจต่างกันมาก ห้ามใช้เพื่อคาดการณ์เวลาที่แน่นอน</p>';
  }
  function renderPickupPage() {
    var f = findSelectedFlight();
    return '<div class="instruction-card"><div class="section-label">FLIGHT-AWARE PICKUP PLANNING</div>'
      + '<h3>Know when to leave, not just when the plane lands</h3>'
      + '<p>ช่วยให้ผู้มารับลดเวลารอหรือจอดริมทาง โดยอิงเวลาเครื่องถึงที่เปลี่ยนแปลง และเผื่อเวลาที่ผู้โดยสารใช้เดินออกมาจากอาคาร</p></div>'
      + '<div class="pickup-layout">'
      + panel("Your pickup plan", "ปรับค่าให้ตรงกับต้นทางและความสะดวกของผู้โดยสาร",
        '<div class="panel-body"><div class="form-grid">'
        + '<div class="form-field full"><label for="pickupFlightSelect">Select inbound flight · DEMO</label>'
        + '<select id="pickupFlightSelect" class="select-input">'
        + state.flights.filter(function (item) { return item.status !== "CANCELLED"; }).map(function (item) {
          return '<option value="' + esc(item.id) + '"' + (f && f.id === item.id ? " selected" : "") + '>'
            + esc(item.flightNo + " · " + item.origin + " · " + time(flightEta(item))) + '</option>';
        }).join("") + '</select></div>'
        + '<div class="form-field"><label for="travelMinutes">Drive time (minutes)</label>'
        + '<input id="travelMinutes" class="number-input" type="number" min="1" max="300" step="5" value="' + state.travelMinutes + '"></div>'
        + '<div class="form-field"><label for="processingMinutes">Immigration + baggage + exit (minutes)</label>'
        + '<input id="processingMinutes" class="number-input" type="number" min="0" max="240" step="5" value="' + state.processingMinutes + '"></div>'
        + '<div class="form-field"><label for="bufferMinutes">Arrival buffer (minutes)</label>'
        + '<input id="bufferMinutes" class="number-input" type="number" min="0" max="120" step="5" value="' + state.bufferMinutes + '"></div>'
        + '</div><p class="inline-note">สูตร: <strong>เวลาออกจากบ้าน = เครื่องถึงล่าสุด + เวลาผู้โดยสารออกจากอาคาร − เวลาเดินทาง − เวลาเผื่อ</strong></p>'
        + '<div class="action-row" style="margin-top:22px"><a class="btn" target="_blank" rel="noopener noreferrer" href="' + esc(window.FlightProvider.officialUrl) + '">Verify flight with AOT ↗</a></div></div>')
      + panel("Your suggested timeline", "Calculated from simulated flight data, Thailand time (UTC+7)",
        '<div class="panel-body"><div id="pickupResult">' + renderPickupResult() + '</div></div>')
      + '</div>';
  }
  function vehicleRows() {
    var rows = state.vehicles.map(function (v) {
      var a = vehicleAssessment(v);
      var cls = a.level === "SECURITY" ? "security" : a.level === "ENFORCEMENT" ? "enforcement" : a.level === "WARNING" ? "review" : "normal";
      return '<tr><td><div class="plate">' + esc(v.plate) + '</div><div class="secondary-text">' + esc(v.vehicleType) + '</div></td>'
        + '<td class="num">' + time(v.entryAt) + '</td>'
        + '<td class="num">' + (v.exitAt ? time(v.exitAt) : '<span class="accent">NOT SEEN</span>') + '</td>'
        + '<td class="num"><strong>' + a.elapsed + ' min</strong></td>'
        + '<td>' + (v.cctvStopped ? pill("SIMULATED CCTV", "landed") : '<span class="faint">None</span>') + '</td>'
        + '<td>' + pill(a.label, cls) + '</td>'
        + '<td><div class="action-row">'
        + '<button type="button" class="mini-btn" data-cctv="' + esc(v.id) + '"' + (v.cctvStopped ? " disabled" : "") + '>+ CCTV</button>'
        + '<button type="button" class="mini-btn" data-exit="' + esc(v.id) + '"' + (v.exitAt ? " disabled" : "") + '>Exit</button>'
        + '</div></td></tr>';
    }).join("");
    return '<div class="table-scroll"><table class="data-table"><thead><tr>'
      + '<th>Demo plate</th><th>Entry</th><th>Exit</th><th>Elapsed</th><th>Independent evidence</th><th>Review state</th><th>Simulation</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function renderAnprPage() {
    var c = counts();
    return '<div class="instruction-card"><span class="section-label">TWO-CAMERA VEHICLE PASSAGE CONTROL</span>'
      + '<h3>Time exception ≠ confirmed roadside parking</h3>'
      + '<p>กล้อง ANPR สองจุดให้ระยะเวลาผ่านเส้นทางเท่านั้น หากเกินเกณฑ์ 30 นาทีให้เปิดรายการรอตรวจสอบ ต้องใช้ภาพ CCTV ที่ระบุตำแหน่งและเวลาเพื่อยืนยันการจอดในเขตห้ามจอด</p></div>'
      + '<div class="case-grid">'
      + '<div class="case-card"><small>IN ZONE · NO EXIT SEEN</small><strong>' + c.activeVehicles + '</strong><small>Vehicles currently unmatched</small></div>'
      + '<div class="case-card warning"><small>LONG PASSAGE &gt;30 MIN</small><strong>' + c.overstayVehicles + '</strong><small>Review needed; not proof of stopping</small></div>'
      + '<div class="case-card security"><small>MOCK CCTV + EXTENDED STAY</small><strong>' + c.security + '</strong><small>Human verification required</small></div></div>'
      + '<div class="two-col">'
      + panel("ANPR Camera Coverage", "Entry checkpoint → exit checkpoint; schematic only",
        '<div class="panel-body">' + routeDiagram() + '</div>')
      + panel("Scenario Simulator", "Local browser simulation; no actual camera or field response",
        '<div class="panel-body"><div class="stack">'
        + '<button type="button" class="btn primary" data-action="new-entry">+ Simulate vehicle entry</button>'
        + '<button type="button" class="btn" data-action="overstay">+ Simulate 42-minute passage</button>'
        + '<button type="button" class="btn ghost" data-action="reset">Reset demo data</button>'
        + '</div><p class="inline-note warning">การกด + CCTV ในตารางจะเป็นเพียงการจำลองหลักฐานประกอบ ไม่ได้ดึงภาพจากกล้องจริง</p></div>')
      + '</div>'
      + panel("ANPR Event Log", "Click + CCTV or Exit to simulate follow-up detections",
        vehicleRows())
      + '<p class="inline-note"><strong>Privacy:</strong> ระบบนี้ใช้ทะเบียน TEST เท่านั้น ไม่บันทึกบุคคลหรือส่งข้อมูลไปยังหน่วยงานจริง</p>';
  }
  function renderAlertPage() {
    var c = counts();
    var records = exceptions();
    return '<div class="instruction-card"><span class="section-label">SECURITY EXCEPTION REVIEW</span>'
      + '<h3>Human-in-the-loop, evidence-first triage</h3>'
      + '<p>คัดกรองเป็น 3 ระดับ ได้แก่ Traffic Warning, Enforcement Review และ Security Alert โดย ANPR เพียงอย่างเดียวไม่ถือเป็นหลักฐานว่าจอดรถผิดกฎหมายหรือกระทำผิดด้านความมั่นคง</p></div>'
      + '<div class="case-grid">'
      + '<div class="case-card warning"><small>LEVEL 1 · TRAFFIC WARNING</small><strong>' + c.warning + '</strong><small>Passage-time anomalies</small></div>'
      + '<div class="case-card enforcement"><small>LEVEL 2 · ENFORCEMENT REVIEW</small><strong>' + c.enforcement + '</strong><small>Mock CCTV corroboration</small></div>'
      + '<div class="case-card security"><small>LEVEL 3 · SECURITY ALERT</small><strong>' + c.security + '</strong><small>Mock CCTV + extended dwell</small></div></div>'
      + '<div class="section-top"><div><h2 class="section-title">Review queue</h2>'
      + '<p class="section-subtitle">DEMO ONLY · กรณีต้องสงสัยไม่ได้เป็นข้อสรุปของเจ้าหน้าที่</p></div>'
      + '<button type="button" class="btn secondary" data-action="export">Export Demo CSV ↓</button></div>'
      + '<div class="stack">'
      + (records.length ? records.map(function (r) {
        var v = r.vehicle, a = r.assessment;
        var css = a.level === "SECURITY" ? "security" : a.level === "ENFORCEMENT" ? "enforcement" : "review";
        var title = a.level === "SECURITY" ? "Security exception · verify on site"
          : a.level === "ENFORCEMENT" ? "Possible no-stopping violation · review CCTV"
          : "Traffic warning · entry/exit time anomaly";
        var detail = v.cctvStopped
          ? "CCTV observation is simulated for the demo. Independently review timestamp, location, continuous footage and authorization before any action."
          : "Only travel time is known. The vehicle may be in traffic, have stopped lawfully or have missed the exit reader. Do not infer illegal parking.";
        return '<article class="alert-card"><div class="alert-card-top"><div>'
          + '<div class="section-label" style="margin-bottom:8px">' + esc(v.id) + ' · TEST DATA</div>'
          + '<h3>' + esc(title) + '</h3></div>' + pill(a.label, css) + '</div>'
          + '<p>' + esc(detail) + '</p>'
          + '<div class="alert-meta"><span>Plate: <strong>' + esc(v.plate) + '</strong></span>'
          + '<span>Elapsed: <strong>' + a.elapsed + ' min</strong></span>'
          + '<span>CCTV: <strong>' + (v.cctvStopped ? "SIMULATED" : "NOT AVAILABLE") + '</strong></span>'
          + '<span>Score: <strong>' + a.score + '/100 (demo heuristic)</strong></span>'
          + '<span>Decision: <strong>PENDING HUMAN REVIEW</strong></span></div></article>';
      }).join("") : '<div class="empty-state"><strong>No active exceptions</strong>Simulate an overstay to create a review record.</div>')
      + '</div><p class="inline-note warning"><strong>Operational safeguard:</strong> ระบบไม่ออกค่าปรับ ไม่สั่งให้เจ้าหน้าที่เข้าตรวจ และไม่เชื่อมฐานข้อมูลเฝ้าระวังจริง อัตโนมัติจากคะแนนสาธิตนี้</p>';
  }

  function setView(view) {
    if (!Object.prototype.hasOwnProperty.call(viewTitles, view)) return;
    state.view = view;
    document.getElementById("pageTitle").textContent = viewTitles[view][0];
    document.getElementById("pageSubtitle").textContent = viewTitles[view][1];
    document.querySelectorAll("#navigation [data-view]").forEach(function (el) {
      var active = el.getAttribute("data-view") === view;
      el.classList.toggle("is-active", active);
      if (active) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });
    render();
    window.scrollTo({ top: 0, behavior: "auto" });
  }
  function render() {
    var content = document.getElementById("content");
    if (!content) return;
    if (state.flightError) {
      content.innerHTML = '<div class="empty-state"><strong>ไม่สามารถโหลดข้อมูลจำลอง</strong>' + esc(state.flightError) + '</div>';
      return;
    }
    content.innerHTML = {
      overview: renderOverview,
      flights: renderFlightPage,
      pickup: renderPickupPage,
      anpr: renderAnprPage,
      alerts: renderAlertPage
    }[state.view]();
  }
  function refreshFlightRows() {
    var area = document.getElementById("flightResults");
    if (area) area.innerHTML = flightRows(filteredFlights(), false);
    var count = document.getElementById("flightResultCount");
    if (count) count.textContent = filteredFlights().length + " FLIGHTS";
  }
  function refreshPickup() {
    var area = document.getElementById("pickupResult");
    if (area) area.innerHTML = renderPickupResult();
  }
  function resetData() {
    state.vehicles = seedVehicles();
    saveVehicles();
    render();
  }
  function newEntry(overstay) {
    var idNum = Math.max(2006, ...state.vehicles.map(function (v) {
      return Number(String(v.plate).replace(/[^0-9]/g, "")) || 2006;
    })) + 1;
    var now = Date.now();
    state.vehicles.unshift({
      id: "V" + now,
      plate: "TEST-" + idNum,
      vehicleType: "Sedan",
      entryAt: new Date(now - (overstay ? 42 : 0) * MINUTE_MS).toISOString(),
      exitAt: null,
      cctvStopped: false,
      cctvDuration: 0,
      zone: "—",
      repeatCount: 1
    });
    saveVehicles();
    render();
  }
  function changeVehicle(id, type) {
    var v = state.vehicles.find(function (row) { return row.id === id; });
    if (!v) return;
    if (type === "exit" && !v.exitAt) v.exitAt = new Date().toISOString();
    if (type === "cctv" && !v.cctvStopped) {
      v.cctvStopped = true;
      v.cctvDuration = Math.max(2, Math.min(20, minutesSince(v.entryAt, v.exitAt)));
      v.zone = "DEMO-ZONE-A";
    }
    saveVehicles();
    render();
  }
  function exportCsv() {
    var rows = [["Case ID", "Demo Plate", "Entry ISO", "Exit ISO", "Elapsed Min",
      "Level", "Mock CCTV Confirmed", "Review State", "Source"]];
    exceptions().forEach(function (r) {
      rows.push([r.vehicle.id, r.vehicle.plate, r.vehicle.entryAt, r.vehicle.exitAt || "",
        r.assessment.elapsed, r.assessment.level, String(r.vehicle.cctvStopped),
        "PENDING HUMAN REVIEW", "SIMULATED"]);
    });
    function quote(value) { return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"'; }
    var csv = rows.map(function (row) { return row.map(quote).join(","); }).join("\r\n");
    var blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "anpr-demo-cases.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function updateClock() {
    var el = document.getElementById("thClock");
    if (!el) return;
    el.textContent = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit",
      second: "2-digit", hour12: false
    }).format(new Date());
  }

  document.addEventListener("click", function (event) {
    var navigation = event.target.closest("[data-view]");
    if (navigation) { setView(navigation.getAttribute("data-view")); return; }
    var pickup = event.target.closest("[data-pickup]");
    if (pickup && !pickup.disabled) {
      state.selectedFlightId = pickup.getAttribute("data-pickup");
      setView("pickup");
      return;
    }
    var cctv = event.target.closest("[data-cctv]");
    if (cctv && !cctv.disabled) { changeVehicle(cctv.getAttribute("data-cctv"), "cctv"); return; }
    var exit = event.target.closest("[data-exit]");
    if (exit && !exit.disabled) { changeVehicle(exit.getAttribute("data-exit"), "exit"); return; }
    var action = event.target.closest("[data-action]");
    if (!action) return;
    var type = action.getAttribute("data-action");
    if (type === "new-entry") newEntry(false);
    if (type === "overstay") newEntry(true);
    if (type === "reset") resetData();
    if (type === "export") exportCsv();
  });
  document.addEventListener("input", function (event) {
    if (event.target.id === "flightSearch") {
      state.search = event.target.value;
      refreshFlightRows();
    }
    var props = { travelMinutes: "travelMinutes", processingMinutes: "processingMinutes", bufferMinutes: "bufferMinutes" };
    var prop = props[event.target.id];
    if (prop && event.target.value !== "") {
      var value = Math.round(Number(event.target.value));
      if (Number.isFinite(value)) {
        var limits = prop === "travelMinutes" ? [1, 300] : prop === "processingMinutes" ? [0, 240] : [0, 120];
        state[prop] = Math.max(limits[0], Math.min(limits[1], value));
        refreshPickup();
      }
    }
  });
  document.addEventListener("change", function (event) {
    if (event.target.id === "flightStatus") {
      state.statusFilter = event.target.value;
      refreshFlightRows();
    }
    if (event.target.id === "pickupFlightSelect") {
      state.selectedFlightId = event.target.value;
      refreshPickup();
    }
    if (["travelMinutes", "processingMinutes", "bufferMinutes"].indexOf(event.target.id) >= 0) {
      event.target.value = state[event.target.id];
    }
  });

  async function init() {
    state.vehicles = loadVehicles();
    updateClock();
    try {
      state.flights = await window.FlightProvider.getArrivals();
      if (!Array.isArray(state.flights)) throw new Error("Flight provider returned invalid data");
    } catch (err) {
      state.flightError = err && err.message ? err.message : "Unknown error";
    }
    setView("overview");
    setInterval(updateClock, 1000);
    setInterval(function () {
      if (state.view === "overview" || state.view === "anpr" || state.view === "alerts") render();
      else if (state.view === "pickup") refreshPickup();
    }, 60 * 1000);
  }
  init();
})();

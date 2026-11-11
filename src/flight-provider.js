/* Flight data boundary.
 * This file intentionally contains NO AOT endpoint, credentials or live API calls.
 * When AOT grants API access, keep the normalized shape but fetch through a
 * server-side /api/flights proxy. Do not expose AOT tokens in browser code.
 */
(function (global) {
  "use strict";

  const MINUTE_MS = 60 * 1000;
  const OFFICIAL_URL = "https://suvarnabhumi.airportthai.co.th/flight?type=arrivals";
  const MODE = "demo";

  // All flight numbers, airlines, origins and timings below are FICTIONAL test records.
  const TEMPLATES = [
    { id: "F101", flightNo: "DEMO-101", airline: "Sample Air", origin: "Singapore", originCode: "SIN", offset: -118, change: 0, landedOffset: -108, status: "LANDED", belt: "07" },
    { id: "F202", flightNo: "DEMO-202", airline: "Example Airways", origin: "Tokyo / Haneda", originCode: "HND", offset: -47, change: 0, landedOffset: -34, status: "LANDED", belt: "11" },
    { id: "F303", flightNo: "DEMO-303", airline: "Sample Air", origin: "Kuala Lumpur", originCode: "KUL", offset: 19, change: 64, status: "DELAYED", belt: "TBA" },
    { id: "F404", flightNo: "DEMO-404", airline: "Concept Airlines", origin: "Seoul / Incheon", originCode: "ICN", offset: 38, change: 0, status: "ON_TIME", belt: "TBA" },
    { id: "F505", flightNo: "DEMO-505", airline: "Example Airways", origin: "Paris", originCode: "CDG", offset: 77, change: 95, status: "DELAYED", belt: "TBA" },
    { id: "F606", flightNo: "DEMO-606", airline: "Sample Air", origin: "Hong Kong", originCode: "HKG", offset: 99, change: 0, status: "ON_TIME", belt: "TBA" },
    { id: "F707", flightNo: "DEMO-707", airline: "Concept Airlines", origin: "Doha", originCode: "DOH", offset: 126, change: 0, status: "CANCELLED", belt: "—" },
    { id: "F808", flightNo: "DEMO-808", airline: "Example Airways", origin: "Chiang Mai", originCode: "CNX", offset: 148, change: 0, status: "ON_TIME", belt: "TBA" },
    { id: "F909", flightNo: "DEMO-909", airline: "Sample Air", origin: "Phuket", originCode: "HKT", offset: 174, change: 35, status: "DELAYED", belt: "TBA" },
    { id: "F110", flightNo: "DEMO-110", airline: "Concept Airlines", origin: "London / Heathrow", originCode: "LHR", offset: 205, change: 0, status: "ON_TIME", belt: "TBA" },
    { id: "F120", flightNo: "DEMO-120", airline: "Example Airways", origin: "Manila", originCode: "MNL", offset: 242, change: 0, status: "ON_TIME", belt: "TBA" },
    { id: "F130", flightNo: "DEMO-130", airline: "Sample Air", origin: "Osaka / Kansai", originCode: "KIX", offset: 279, change: 25, status: "DELAYED", belt: "TBA" }
  ];

  const seededAt = Date.now();
  function atOffset(minutes) {
    return new Date(seededAt + minutes * MINUTE_MS).toISOString();
  }

  const demoFlights = TEMPLATES.map(function (f) {
    return Object.freeze({
      id: f.id,
      flightNo: f.flightNo,
      airline: f.airline,
      origin: f.origin,
      originCode: f.originCode,
      scheduledAt: atOffset(f.offset),
      estimatedAt: f.status === "CANCELLED" ? null : atOffset(f.offset + f.change),
      actualAt: f.status === "LANDED" ? atOffset(f.landedOffset) : null,
      status: f.status,
      belt: f.belt,
      terminal: "MAIN",
      source: "DEMO"
    });
  });

  function delayMinutes(flight) {
    if (flight.status === "CANCELLED") return 0;
    const latest = flight.actualAt || flight.estimatedAt;
    if (!latest) return 0;
    return Math.max(0, Math.round((Date.parse(latest) - Date.parse(flight.scheduledAt)) / MINUTE_MS));
  }

  function clampMinutes(value, fallback, min, max) {
    const number = value === undefined || value === null || value === "" ? fallback : Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
  }

  function planPickup(flight, options) {
    if (!flight || flight.status === "CANCELLED") return null;
    options = options || {};
    const travelMinutes = clampMinutes(options.travelMinutes, 60, 1, 300);
    const passengerProcessingMinutes = clampMinutes(options.passengerProcessingMinutes, 50, 0, 240);
    const arrivalBufferMinutes = clampMinutes(options.arrivalBufferMinutes, 10, 0, 120);
    const arrivalAt = flight.actualAt || flight.estimatedAt || flight.scheduledAt;
    const meetingAt = new Date(Date.parse(arrivalAt) + passengerProcessingMinutes * MINUTE_MS);
    const departAt = new Date(meetingAt.getTime() - (travelMinutes + arrivalBufferMinutes) * MINUTE_MS);
    return {
      flightArrivalAt: arrivalAt,
      meetingAt: meetingAt.toISOString(),
      departAt: departAt.toISOString(),
      travelMinutes: travelMinutes,
      passengerProcessingMinutes: passengerProcessingMinutes,
      arrivalBufferMinutes: arrivalBufferMinutes
    };
  }

  global.FlightProvider = Object.freeze({
    mode: MODE,
    officialUrl: OFFICIAL_URL,
    lastUpdatedAt: new Date(seededAt).toISOString(),
    getArrivals: async function () {
      // Consistent async contract; no external server request in DEMO mode.
      return demoFlights.map(function (f) { return Object.assign({}, f); });
    },
    delayMinutes: delayMinutes,
    planPickup: planPickup
  });
})(window);

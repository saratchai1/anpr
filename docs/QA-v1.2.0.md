# ANPR DEMO v1.2.0 — regression checks

Pre-release checks ran in Chromium with Playwright against a local HTTP server in an isolated Vercel sandbox. 32 checks passed after fixes. This is a frontend demonstration, not an operational airport-security certification. Browser-only storage and logs are not an authenticated multi-user backend or immutable audit record.

## Covered checks

1. Nine navigation screens retained.
2. Loaded map tiles and exact user-supplied camera coordinates.
3. Vehicle markers separately selectable, no default overlap.
4. Zoom, fit and map-layer toggles.
5. Map popup opens the selected vehicle case.
6. Vehicle selector opens the selected marker popup.
7. Stop duration and zone gate severity; score alone cannot escalate.
8. ANPR overstay alone remains a time warning.
9. Valid 20-minute stop in a demo zone escalates.
10. Exit preserves case peak severity, peak score and open status.
11. Closing a case without a reason is blocked.
12. Acknowledge, dispatch (simulated), close and reopen retain timeline.
13. Evidence JSON contains DEMO observations and operator history.
14. Four-column case workflow board.
15. Configuration validation and shared rules preserve historical severity.
16. Twelve flights, search and cancelled pickup gate.
17. Zero-minute pickup buffers, midnight crossing, invalid/cancelled inputs.
18. On-time to +60 delay moves suggested departure exactly 60 minutes.
19. Cancellation removes the pickup recommendation.
20. Flight seed and scenarios survive reload.
21. Another tab's vehicle addition updates table and map together.
22. Concurrent tab additions are serialized with Web Locks, neither lost.
23. Another tab's flight change recalculates pickup.
24. CSV download includes workflow fields and DEMO source.
25. Repeated navigation/timed refresh retains one usable map.
26. All nine views at 390px and 320px have no page-level horizontal overflow.
27. No application JavaScript errors on tested normal paths.
28. Malformed legacy records recover with a notice instead of a blank page.
29. Corrupt v2 JSON recovers with a notice.
30. Denied browser storage still keeps in-memory map/table synchronized.
31. Blocked Leaflet download shows schematic fallback; flights still usable.
32. Reset restores fresh cases, rules and flight scenarios across tabs.

## Reproduction steps for the review regressions

Open ANPR Monitoring, simulate a 42-minute passage, add a 20-minute CCTV observation in DEMO-ZONE-A, then simulate Exit. Its case must still show SECURITY and remain open. Open that exact vehicle, acknowledge, dispatch, enter a closing reason, close, and reopen with a reason. Inspect the recorded timeline and export DEMO evidence.

Open two tabs from the same origin. Add a vehicle in either tab and check the table and map in the other. Change a flight scenario in one tab while its Pickup Planner is open in the other. Both should update. This does not synchronize across devices or different browser profiles.

In Pickup Planner select DEMO-404, apply On Time, note the suggested departure, then apply Delay 60. It must move exactly 60 minutes. Cancel the flight; no suggested departure should remain.

Preserve the map and existing screens in future changes. Operational AOT integration must use an authorized server-side proxy and verified schema, not secrets in browser JavaScript.

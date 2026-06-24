# LOOP — Sharime

_Autopilot control file. ALAMO reads and updates this every cycle._

## Status
- State: RUNNING
- Mode: backlog-then-self
- Cadence: 900
- Cycle: 6
- Last commit: 6dfa40a

## Backlog
- [ ] (queue your ideas here, most important first)

## Cycle log
- c6 (2026-06-23): Added a phone-size Review pass checklist and sticky full-width mobile render action, verified against the loaded Smoke Trip project. — 6dfa40a
- c5 (2026-06-23): Refined the mobile Review layout and added friendly inline help across polish controls. — 654dd22
_Newest first._
- c4 (2026-06-23): Shipped review polish controls: per-shot color overrides, per-shot transition type/duration with wipes, and music start/end region trimming; verified with syntax checks, full smoke render, and a real 10-second region render. — 9cca723
- c3 (2026-06-23): Shipped AMD AMF hardware H.264 render acceleration with automatic libx264 fallback, verified by a real generated render. — 5f10ebe
- c2 (2026-06-23): Shipped recipe-driven minimal-location/title overlays: auto-edit now puts a subtle first-shot title into `seg.text`, and the existing ffmpeg drawtext renderer bakes it into the final video. Verified with Node assertions plus a real ffmpeg render. — 7d34d7e
- c1 (2026-06-23): Tuned Sharime’s built-in and ALAMO-prompt reference behavior toward Esteban’s cool, desaturated, punchy example-video style; verified recipe assertions passed. — d6bee00

# Sharime

An automatic travel-video editor. Point it at a folder of clips and it assembles an edited video using a recipe-driven pipeline — cuts, ordering, and pacing handled for you.

## Features
- Zero-dependency Node + ffmpeg rendering engine.
- Recipe-driven edits (structure, pacing, transitions) instead of manual timeline work.
- Simple local web UI to kick off and preview renders.

## Stack
Node.js, ffmpeg. No heavy runtime dependencies.

## Run
```
node server.mjs    # serves the app on http://localhost:4188
```
Requires `ffmpeg` available on your PATH.

## Status
Shipped and in use.

---
Personal project by Esteban Sanchez.

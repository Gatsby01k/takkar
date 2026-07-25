# TAKKAR 1.2.0 — RELEASE STATUS

## Implemented in the actual runtime

- Rebuilt desktop launch bay with a visible animated V12 impact engine.
- Added twin cylinder banks, turbos, flywheel, clutch, contact rollers, exhaust, heat and release flash.
- Added desktop telemetry for RPM, boost, wheel speed and clutch state.
- Reworked launch into ignition, clutch release and full-thrust acceleration phases.
- Replaced the legacy generic collision threshold with per-obstacle contact geometry.
- Clamps every obstacle to the wheel's real leading edge before the impact frame.
- Stops world movement during impact freeze to prevent visual overlap or premature collision.
- Added obstacle deformation, impact glow, improved debris and contact-point particles.
- Kept the mobile layout and reduced the engine footprint for small screens.

## Verification

- `npm run check`
- `npm test`
- Desktop render checks at 1440×900: idle, charged engine, launch, obstacle approach and impact survival.
- Mobile render check at 390×844.

This file describes changes present in `public/game.js`, `public/styles.css` and `public/index.html`, not a separate archive or publication trigger.

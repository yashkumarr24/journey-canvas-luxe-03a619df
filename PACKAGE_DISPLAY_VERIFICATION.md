# Holidays and package display verification

## Result and revision

Implementation revision: `d96b77c` (automatically saved by Lovable; this report/checklist is a subsequent documentation-only update). No manual Git push or deployment was performed.

Vercel deployment is required for the hosted website to receive the changes. An Android rebuild is **not** required: the current Capacitor app loads the hosted site. Existing physical-device verification for build `8429d27` remains historical evidence only; these presentation changes were not tested on a physical Android phone.

## Confirmed causes

- A domestic hotel table with `min-width:520px`, inside a padded card inside an unconstrained grid child, enlarged the whole page. At a 360px viewport, the original Gangtok/Darjeeling detail page had a **594px document width**. Its first content grid child ran from x=24 to x=594; the table's wrapper grew with it rather than acting as a local scrollport.
- Package grid tracks/children now shrink explicitly. Text wraps within package content; hotel/flight tables retain all columns inside focusable, labeled horizontal scroll regions. Table cells have more room to avoid splitting normal destination names.
- The navbar depended on nonshrinking logo/control widths. It now uses a shrinking mobile logo track and fixed-size icon controls, with Help/Holidays available in a keyboard-operable menu. Before testing did not reproduce independent navbar overflow at 360px; its vulnerable sizing was corrected without claiming a separate reproduced failure.
- The fixed assistant suggestion covered package content. Package detail pages now give the same assistant bar its own space beneath the photo; it remains fixed elsewhere, inside safe viewport margins. Close/open controls are preserved.
- All six domestic `*-stock.jpg.asset.json` URLs used Lovable-relative `/__l5e/assets-v1/...` paths. **Anonymous live GETs returned HTTP 404, text/html** on `www.flynfeelholiday.com`; the same original assets returned HTTP 200, image/jpeg locally. The exact original licensed photos were retrieved and optimized into bundled WebP copies. No replacement scenes, new imagery, public bucket or storage-policy change was introduced. Original asset pointers remain intact.
- The tested live international Switzerland page returned HTTP 200, and its selected `/assets/city-interlaken-nTO1r9_i.jpg` hero returned HTTP 200, image/jpeg. No international image failure was reproduced there. All static international package-option/destination photo files exist, and tested international listing/detail images loaded at each width.

## Automated browser evidence

Chromium simulations, not Android/device testing: eight routes at **360, 390, 430, 768 and 1280px**, 40 page/width checks total. All passed document-width, displayed-navbar bounds and loaded-image checks.

Routes:

- `/holidays`, `/domestic`, `/international`
- `/domestic-packages/gangtok-darjeeling`
- `/domestic-packages/gangtok-darjeeling/gangtok-pelling-darjeeling-7n-8d` — Gangtok, Pelling & Darjeeling Trip
- `/domestic-packages/andaman/andaman-5n-6d`
- `/international-packages/switzerland`
- `/international-packages/switzerland/switzerland-7n-8d`

At 360px the repaired Gangtok/Pelling/Darjeeling page has a **360px document width**; its table scrolls independently. Keyboard ArrowRight moved the hotel scroll region by 40px. Help menu opened/closed, and the assistant opened successfully at 360px. Visual screenshots confirmed wrapping, restored photography, visible controls, and no assistant over the itinerary.

Sandbox evidence: `/tmp/browser/package-layout/before-360.png`, `after-{width}.png`, `hotels-{width}.png`, `assistant-open-360.png`, and `results.json`. The before screenshot is the related Gangtok/Darjeeling 5-night detail page; the after screenshots are the requested 7-night Gangtok/Pelling/Darjeeling trip. This is not a pixel-identical before/after comparison of one quotation.

## Tests and limitations

32 tests passed across eight files: domestic content/date rules, international source quotations, included-stop photo selection, new package image delivery checks, and all existing native offline/startup/link/App Link JavaScript tests. Latest preview compilation reported `build OK`.

No APK compiled; no new physical-phone test; no native JVM tests rerun because native files were unchanged. Browser public-page checks do not establish signed-in session or Google OAuth end-to-end behaviour. Auth, storage/cookies, App Links and offline/Retry code were not changed.

Private database-backed `/packages/*` detail presentation was given the same shrink/scroll treatment, but no populated private-catalogue end-to-end image check was available. Its images come from `package_images.url` or `hero_image_url`, signed by the existing server code. Any remaining affected private package needs its exact URL and failed image response before diagnosing an expired/failed signing dependency. No server signing, credentials, database records or storage settings were changed; no unrelated fallback was added.

## Changed files

- `src/components/Nav.tsx`, `PageHero.tsx`, `Destinations.tsx`, `InternationalPackageDetails.tsx`
- `src/components/assistant/AssistantWelcomePopup.tsx`
- `src/routes/domestic-packages.$destination.$package.tsx`, `packages.$destination.$package.tsx`, `holidays.tsx`
- `src/styles.css`, `src/data/domestic-packages.ts`, `src/data/package-image-delivery.test.ts`
- Six `src/assets/domestic/*-stock.webp` files and `STOCK-LICENSES.md`
- `AGENTS.md`, `roadmap.md`, this report

Package wording, dates, prices and option associations are unchanged. No `backend/`, TripJack, certifications, booking services, payments, database settings/records, native code, App Links or login files were modified.

## Deployment and next verification

Let the connected GitHub sync and Vercel production deployment complete. Check that the deployment includes implementation `d96b77c` or a descendant; then reload the website/app. No `cap sync`, APK rebuild, uninstall or data clearing is needed for this website-only fix. Physical-phone verification of the updated presentation remains pending, as do previously unverified email links, additional devices, release signing and store readiness. Booking/payment testing and TripJack certification remain separate and pending.
# Mobile Apps (Android & iOS) via Capacitor

Goal: turn the finished Fly n Feel web app into installable Android and iOS apps that reuse 100% of the existing booking UI, auth, and FastAPI/TripJack backend — no app rewrite.

## Why this approach

- The web app is built on React/TanStack Start. Capacitor wraps that same web build into a native shell, so every flight/hotel flow, payment step, and Supabase auth path already works on mobile with no duplicated code.
- The FastAPI backend and Supabase database already expose HTTP APIs; the mobile apps call the identical endpoints the browser uses. Zero backend changes.
- This is a hybrid (webview) app, not fully native. For a travel-booking product this is the right tradeoff: one codebase, fast to ship, good performance, and the same approach used by many production apps.

## When this happens

After the web booking flow is complete end to end — flights, hotels, payments, confirmation, booking lookup. Mobile is a **final phase**, not a parallel track, so it wraps an already-working product. Starting it sooner means wrapping a half-built app and redoing screens as the web changes.

## What gets built

```text
Existing web build (unchanged)
   │
   ├─ Capacitor config (capacitor.config.ts)
   ├─ Android project (native shell, Gradle, AndroidManifest)
   ├─ iOS project (native shell, Xcode, Info.plist)
   └─ Shared web assets + native plugins
```

1. **Capacitor setup** — add `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/ios`. Configure app id, bundle id, server URL (bundled assets), and splash screen. Run `cap add android` / `cap add ios`.
2. **Native plugins** for device capabilities the web app can't reach:
   - `@capacitor/haptics` — tap feedback on booking buttons
   - `@capacitor/preferences` — secure token storage instead of localStorage
   - `@capacitor/app` — lifecycle + back-button handling
   - `@capacitor/status-bar` / `@capacitor/safe-area` — notch + status bar sizing
   - `@capacitor/keyboard` — form scroll behaviour
   - Native **push notifications** (`@capacitor/push-notifications`) — FCM (Android) + APNs (iOS) for booking confirmations and trip reminders
   - **Biometric auth** (`@capacitor-community/biometric-auth`) — optional Face ID / fingerprint unlock
   - **Google/Apple sign-in** via native providers (faster, more reliable than web OAuth on mobile)
3. **App-only config branch** — read platform at runtime and adjust: hide browser-only chrome, use native push token registration against Supabase, route OAuth through native providers.
4. **Safe-area + responsive polish** — the existing Tailwind layout already targets mobile; add `env(safe-area-inset-*)` padding for notches and test every booking screen on a real device.
5. **Build & ship** — `cap sync` then open in Android Studio / Xcode, build signed release AAB and IPA.

## What stays unchanged

- `src/` web app, routes, and components — no rewrite.
- `backend/` FastAPI + TripJack integration — called over the same HTTPS endpoints.
- Supabase schema, RLS, and auth — mobile users are the same authenticated users.
- Razorpay payments — Razorpay's native mobile SDK (or the same checkout webview) is used; signature verification stays server-side.

## Account & submission requirements

- **Apple Developer Program** — ~$99/year; needed for App Store and TestFlight.
- **Google Play Developer account** — $25 one-time; needed for Play Store.
- **Signing keys** — Android keystore, iOS distribution certificate + provisioning profile (kept as secrets, never in the repo).
- **Store listings** — icons, screenshots, descriptions, privacy policy URL (already exists at `/privacy`).
- **Review process** — Apple review ~1–3 days; Google ~1–7 days. Apple reviews webview apps carefully, so the app must provide real native value (push, biometrics, native sign-in) rather than a bare website wrapper.

## Tradeoffs to accept

- Hybrid performance — good, not identical to fully native. Acceptable for this product.
- App review rejections are possible if the app "looks like a website" — mitigated by native plugins and platform-tuned UX above.
- Two stores to maintain — each OS gets its own build and update cadence.
- Push notifications need ongoing FCM/APNs credentials and a server worker to send them.

## Suggested order (after web ships)

1. Capacitor scaffold + Android/iOS shells, run the existing web app inside them.
2. Add native plugins: safe-area, haptics, preferences, status bar, keyboard.
3. Native push notifications (FCM + APNs) wired to booking events.
4. Native Google/Apple sign-in replacing web OAuth on mobile.
5. Biometric unlock (optional).
6. Store submission: Android AAB to Play, iOS IPA to App Store via TestFlight then review.

## Note

This plan is for a **future phase**. Nothing here is implemented now; it executes only after the web booking flow (flights, hotels, payments, confirmation) is complete and verified. If you'd rather get an installable phone experience sooner without the store-review process, a PWA (Add to Home Screen) is a lighter interim option and can be added in parallel with the web work.

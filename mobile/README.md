# Fly n Feel Android/iOS app (Capacitor)

The app is a native shell that loads the live site **https://www.flynfeelholiday.com**.
Pages, server functions (enquiries, search, sign-in) and the FastAPI backend are
exactly the website's. App-only code lives in `src/lib/native/` and runs only when
`window.Capacitor.isNativePlatform()` is true.

Payments and automatic booking stay disabled; the app adds no payment code.

## Files
- `capacitor.config.ts` — app id `com.flynfeelholiday.app` (change before first upload if wanted), remote URL, allowed hosts, splash/status bar/keyboard.
- `mobile/www/index.html` — bundled "can't reach Fly n Feel" page with Try again (shown when the site fails to load).
- `mobile/assets/` — icon and splash sources made from the existing logo.
- `mobile/well-known/*.template.json` — App Links / Universal Links files with blanks for your real values.
- `android/` — generated Android project (App Links intent filter, `adjustResize`, icons/splash).
- iOS project is NOT committed: it must be created on a Mac (below).

## First Android test build (needs Android Studio)
1. Install Android Studio (with SDK 35) and JDK 21. Clone the repo, run `npm install`.
2. `npx cap sync android`
3. `npx cap open android` → let Gradle sync finish.
4. Plug in an Android phone with USB debugging on (or start an emulator) → Run ▶.
5. Test: home loads; back button goes back and leaves on home; airplane mode shows the offline banner / connection page and Try again recovers; a WhatsApp/maps link opens outside the app; tel:/mailto: open the phone's apps.
6. Google sign-in and email links return into the app only after step "App Links" below is live; before that they finish in Chrome.

## App Links (Android)
`public/.well-known/assetlinks.json` is the deployable verification file; Vercel explicitly sets `application/json`. It contains package `com.flynfeelholiday.app` and the supplied **currently installed local test build** certificate:
`79:93:9F:84:5D:F4:3D:67:90:92:6B:46:4C:49:F5:C3:4C:AE:6D:23:EA:F8:58:4A:73:AE:A2:D1:57:17:B7:CD`.
This is **not a confirmed Play Store signing certificate**. Add the real Play app-signing certificate before testing a Play-distributed build. The template is reference-only.

After the connected Vercel deployment:
1. Check `curl -i https://www.flynfeelholiday.com/.well-known/assetlinks.json`: expect HTTP 200, `application/json`, the supplied JSON, and no redirect or authentication.
2. Run `adb shell pm verify-app-links --re-verify com.flynfeelholiday.app`; allow verification to finish, then run `adb shell pm get-app-links com.flynfeelholiday.app` and check that `www.flynfeelholiday.com` is verified.
3. Test opening a www link and Google sign-in on the installed build. The shell loads www, so OAuth returns to `https://www.flynfeelholiday.com/auth/login?redirect=...`; the manifest accepts that host and the native handler preserves query/hash codes.

On 2026-10-17, live www returned 404 before deployment; non-www returned HTTP 308 to the same path on www. The apex redirect is managed outside this repository's `vercel.json` and is unchanged. Android verification requires a direct response, so the apex is not established as verified even though the manifest declares both hosts. Serve JSON directly on apex through hosting domain configuration if apex verification is required; ordinary apex web links still redirect to www. Phone verification and a complete OAuth return remain separate checks.

## iOS (needs macOS + Xcode + Apple Developer account)
1. On a Mac: `npm install && npx cap add ios && npx cap sync ios && npx cap open ios`.
2. Generate icons: `npx capacitor-assets generate --ios --assetPath mobile/assets`.
3. Xcode → Signing & Capabilities: select your Team; add **Associated Domains**: `applinks:www.flynfeelholiday.com`, `applinks:flynfeelholiday.com`, `webcredentials:www.flynfeelholiday.com`.
4. Fill `mobile/well-known/apple-app-site-association.template.json` with your Team ID; serve at `https://www.flynfeelholiday.com/.well-known/apple-app-site-association` (JSON, no extension, no redirect).

## Sign-in return URLs (auth settings — needs your confirmation)
The live sign-in project must allow these redirect URLs (the app uses the same https URLs as the website):
`https://www.flynfeelholiday.com/auth/login*`, `https://www.flynfeelholiday.com/auth/reset-password*`.

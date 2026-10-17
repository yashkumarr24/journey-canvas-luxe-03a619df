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

## Mobile testing checklist (status)
User-verified on a physical Android phone (OnePlus), build `8429d27`:
- [x] Offline: opening Holidays shows the branded offline page directly and stays there.
- [x] Try again while still offline returns to the branded page within 15 seconds, repeatedly, with no loop.
- [x] Double-tapping Try again starts only one attempt.
- [x] After reconnecting, Try again loads the live site and the saved login is kept.

Still unverified:
- [ ] Email confirmation and password-reset links opening in the app.
- [ ] Additional devices / Android versions (only one phone tested).
- [ ] Release signing (Play signing certificate and its App Links fingerprint).
- [ ] Store readiness (Play Store listing/review; iOS not built).

Separate and pending (not part of app testing): booking/payment testing (PayU paused)
and TripJack certification.

## First Android test build (needs Android Studio)
### Offline navigation fix (full pages and client routes)
- MainActivity now installs a BridgeWebViewClient subclass: Capacitor's local asset
  serving, navigation intents, bridge resets and OAuth behaviour remain inherited.
  Main-frame network/HTTP errors stop the failed load and queue the local fallback
  after the callback. Failed images and other subresources never replace the page.
- Android-only offline link clicks and route-load network failures call the
  OfflineNavigation plugin, which uses the same fallback. Dynamic module failures
  are covered separately; background fetches and image error events are not trapped.
- Offline Back exits the activity. Fallback completion and successful recovery
  clear WebView navigation history only, so raw error and offline entries cannot
  reappear. Cookies, localStorage, sessionStorage and Google PKCE data are untouched.
- Retry still makes one canonical-site attempt with the native 15-second deadline;
  the offline banner uses the same bounded native retry. No network-change retry.
- Both the hosted website changes and a rebuilt APK are required; deploying the
  site alone does not install the new plugin or WebView callback handling.

After GitHub sync and the connected Vercel deployment finish, use the exact
PowerShell sync/rebuild commands below, with JDK 21 and SDK 35, updating in place
with the original signing key. Never uninstall or clear app data.

New device checks: sign in online, disable Wi-Fi/mobile data, then navigate to
Holidays using both a normal in-app link and a full-page link. The branded page
must appear without Back. Back from it must exit, not show Android's error page.
Restore connectivity and tap Retry; verify the home page, saved session, Back,
and another Google login. Block only an image while online: keep the current page.
Repeat on a connected Wi-Fi network with no internet, including stalled Retry.
Automated checks: 20 JS tests passed (startup/Retry, route errors, native link
handling, Google external links and App Links), plus 21 checks compiling the actual
MainActivity with JVM Android/WebView fakes. Capacitor sync succeeded. At 390×844,
a browser simulation using the real native shell click handler and a fake plugin
showed the bundled page directly, retained a non-secret localStorage marker,
kept the website after an image failure and reached the canonical site on Retry,
with no page errors. This did not compile an APK, run on OnePlus, verify a real
login session or complete Google sign-in; those remain real-device checks.

### Offline startup fix: sync, rebuild, and install over the existing app
The launch splash now auto-hides natively after 3 seconds (plus its fade), whether
or not the website's JavaScript runs. `src/lib/native/native-shell.ts` still hides
it early after a successful website render. `server.errorPath: "index.html"`
continues to load the entirely bundled `mobile/www/index.html` on a main-page
network/HTTP failure; that error page is served locally by Capacitor, with no
network assets required. Its plugin hide call is best effort, not a dependency.

`MainActivity.java` adds a 15-second native deadline for cold startup and each
manual Retry from the offline page. A stalled load is stopped once and sent to
the local error page. Normal page navigation and warm Google login returns do
not start this deadline. It is cancelled after page load, on the local error
page, and when the activity is destroyed. Redirects do not extend the deadline.
Retry navigates once to `https://www.flynfeelholiday.com/`; no connectivity event,
timer or page load automatically retries. Its 8-second timer only re-enables the
button if the current page remains visible.

After the changes have reached your connected GitHub branch, in Windows PowerShell:
```powershell
# From your existing repository folder: obtain the newest changes first.
git pull --ff-only
bun install --frozen-lockfile
bunx cap sync android
bunx cap open android
```
In Android Studio let Gradle sync finish, select the same connected OnePlus phone,
and press Run. Or, from the repository root:
```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
Push-Location android
.\gradlew.bat assembleDebug
Pop-Location
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```
Use JDK 21 and SDK 35. Use the **same signing key** as the currently installed
app and retain the same package id. `adb install -r` updates in place; do not
uninstall or clear app data. If Android reports a signature mismatch, stop and
rebuild with the original key rather than uninstalling. A different signing
certificate also needs its own App Links fingerprint. Merely deploying the
website or reopening the old installed app will not update these native settings.

Device checks still required (no phone testing is claimed here):
1. Sign in while online; force-stop the app. Turn off Wi-Fi and mobile data, then
   reopen: the logo must disappear and the offline page must appear, immediately
   on a load failure or within the 15-second deadline if the request stalls.
2. Remain offline for 30 seconds: no repeated loads. Tap Retry offline: return to
   the offline page without getting stuck. Restore data and tap Retry without
   restarting: the canonical website must load.
3. Force-stop/reopen online: the previous session must remain. Complete Google
   sign-in and test its App Link return, normal navigation, and Android back.
4. Repeat offline startup with airplane mode and with a connected Wi-Fi network
   that cannot reach the internet (stalled requests).

Automated checks performed for this fix: 14 tests across
`offline-startup.test.ts`, `link-policy.test.ts` and `assetlinks.test.ts`; 10 JVM
checks against the actual `MainActivity.java` with simulated Android APIs
(`python3 mobile/tests/check_android_startup.py`, JDK 21 required); `cap sync
android` succeeded and the generated assets match the updated configuration and
offline page. Browser simulation at 390×844 displayed the offline page without
Capacitor, made no automatic navigation while offline, and Retry reached the
actual canonical website after connectivity was restored, with no page errors.
These checks do **not** compile an APK or verify native splash rendering, Google
login, session persistence, or any behaviour on the OnePlus phone.

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

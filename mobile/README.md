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

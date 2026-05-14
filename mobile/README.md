# Trio — Mobile (Capacitor)

This folder wraps the existing **`/web`** project as a native **Android** and
**iOS** app using [Capacitor](https://capacitorjs.com/). The mobile shell is
just a thin native WebView around the same HTML/CSS/JS — every UI tweak you
make in `/web` automatically appears on phone after `npm run build`.

## Compatibility

- **Android:** 6.0+ (API 23) — covers ~99% of active devices.
- **iOS:** 13.0+ — covers ~98% of active devices.
- Phones, foldables, tablets all supported. The CSS uses `dvh` units +
  `env(safe-area-inset-*)` so it adapts to notches, dynamic islands, gesture
  bars, and rotation.

## Prerequisites

- **Node.js 18+**
- **For Android:** [Android Studio](https://developer.android.com/studio)
  (Hedgehog or newer) with an emulator or a USB-debug-enabled phone.
- **For iOS:** macOS with **Xcode 15+** and CocoaPods (`sudo gem install cocoapods`).
  iOS builds are not possible on Windows or Linux.

## First-time setup

```bash
cd mobile
npm install                  # install Capacitor + plugins
npm run sync-web             # copy ../web -> ./www
npx cap add android          # generates ./android (one-time)
npx cap add ios              # generates ./ios (one-time, macOS only)
npx cap sync                 # wires plugins to native projects
```

## Iterate

After any change inside `/web`:

```bash
npm run build                # sync-web + cap sync
```

Then either re-launch from the IDEs or:

```bash
npm run android              # opens Android Studio
npm run ios                  # opens Xcode (macOS)
# or run on a connected device / running emulator:
npm run run:android
npm run run:ios
```

## Configuration

- App name and bundle id live in `capacitor.config.json` (`appId`, `appName`).
  Default: `com.aymksen.trio`. Change before publishing to the stores.
- The dark theme color (`#0b0820`) is set on the splash screen and status bar
  to match the Midnight Carnival palette.
- The status bar is opaque (not overlaying the WebView) so the game UI never
  hides behind the system clock.

## Adding an app icon and splash

The simplest way:

```bash
npm install --save-dev @capacitor/assets
# Drop a 1024×1024 icon at  ./assets/icon.png
# Drop a 2732×2732 splash at ./assets/splash.png  (centered logo on solid color)
npx capacitor-assets generate
```

This regenerates all the required Android `mipmap-*` and iOS asset catalog
entries automatically.

## Firebase

`firebase.js` (inside `/web`) already contains your Firebase config, so the
mobile WebView talks to the same Realtime Database — no extra setup needed.

If you later switch to Firebase Anonymous Auth, add your **Capacitor scheme**
to **Firebase Console → Authentication → Settings → Authorized domains**:

- Android dev: `http://localhost`
- iOS dev: `capacitor://localhost`

## Building release artifacts

### Android (.aab / .apk)

1. Open Android Studio: `npm run android`.
2. **Build → Generate Signed Bundle / APK** → follow the wizard.
3. Upload the `.aab` to Google Play Console.

### iOS (.ipa)

1. Open Xcode: `npm run ios`.
2. Select **Any iOS Device (arm64)** as the target.
3. **Product → Archive** → distribute via App Store Connect.

## Troubleshooting

- **Blank screen on launch:** make sure you ran `npm run sync-web` (or
  `npm run build`) so `www/` exists and contains `index.html`.
- **Mixed-content errors:** all scripts in `/web/index.html` load from `https://`,
  which is required by Android's default scheme. Don't switch to `http://`.
- **Cannot find module on Apple Silicon:** run `arch -x86_64 pod install` inside
  `ios/App/` if CocoaPods complains, or update CocoaPods to the latest version.

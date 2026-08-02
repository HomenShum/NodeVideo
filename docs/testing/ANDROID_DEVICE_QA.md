# Android device QA

This runbook exercises NodeVideo in real Android Chrome. It complements, but does not replace, the
Playwright `mobile-chromium` viewport because Android startup, browser onboarding, device input,
permission prompts, Chrome persistence, and WebView/Chrome networking are separate failure
boundaries.

## Installed profile

- AVD: `NodeVideo_Pixel_API_35`
- Android: API 35 / Android 15
- Image: `system-images;android-35;google_apis;x86_64`
- Display: 1080 × 2400 at 420 dpi
- Camera: virtual-scene back camera and emulated front camera
- Acceleration: Windows Hypervisor Platform
- Chrome debugging: Android `chrome_devtools_remote` forwarded to local port 9222

The AVD stores only test browser state. Use the rights-cleared demo; do not place personal media,
accounts, or credentials in this device.

## Start and inspect

```powershell
powershell -ExecutionPolicy Bypass -File scripts/mobile/android-emulator.ps1 start
powershell -ExecutionPolicy Bypass -File scripts/mobile/android-emulator.ps1 status
```

Start is headless by default, so the emulator consumes no desktop window and NodeVideo can be
driven through Chrome DevTools while other work continues. Add `-Visible` only when rendered
emulator pixels or manual permission interaction are required.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/mobile/android-emulator.ps1 start -Visible
```

## Run the journeys

The default journey proves local-first behavior and Auto mode without media egress:

```powershell
node scripts/mobile/android-nodevideo-qa.mjs
```

The external journey is deliberately opt-in. It checks the one-shot consent box, sends only the
rights-cleared demo prompt, bounded transcript context, and source metadata to OpenRouter, verifies
the required operation set, and confirms that consent resets afterward:

```powershell
node scripts/mobile/android-nodevideo-qa.mjs --external
```

The vision journey grants camera permission only inside the disposable test AVD, starts the virtual
rear camera, loads the on-device pose model, and requires live inference telemetry. A virtual scene
usually has no person, so `poseAcquired: false` is valid; `modelStatus: loaded-and-inferring` plus a
positive latency proves camera playback and model inference both started.

```powershell
node scripts/mobile/android-nodevideo-qa.mjs --vision
```

Receipts are written under `.qa/android-emulator/`. Receipt URLs omit the case/access fragment, and
proposal digests are redacted. Pixel capture is a separate ADB step because Android Chrome's CDP
screenshot command can stall even while the page remains healthy:

```powershell
adb -s emulator-5554 shell screencap -p /sdcard/nodevideo-qa.png
adb -s emulator-5554 pull /sdcard/nodevideo-qa.png .qa/android-emulator/nodevideo-qa.png
```

## Stop

```powershell
powershell -ExecutionPolicy Bypass -File scripts/mobile/android-emulator.ps1 stop
```

## Fresh-machine prerequisites

Install a JDK 17 runtime and the current official Android command-line tools. Then install
`emulator`, `platform-tools`, and `system-images/android-35/google_apis/x86_64`. Create the AVD with
the installed image—not the auto-generated Google Play image unless that exact image is installed.

Official references:

- <https://developer.android.com/studio/install>
- <https://developer.android.com/tools/sdkmanager>
- <https://developer.android.com/studio/run/emulator-commandline>
- <https://developer.android.com/studio/run/emulator-acceleration>

## Failure interpretation

- `No external request was sent` is a consent boundary, not a provider outage.
- `completed · deterministic local` proves local planning, not OpenRouter.
- `Free model router` plus provider/model/iterations proves the model route was used.
- A CLI exit code does not prove mobile layout. Preserve rendered pixels from the AVD.
- Chrome onboarding or stylus overlays are device-state failures; dismiss them and replay before
  diagnosing NodeVideo.

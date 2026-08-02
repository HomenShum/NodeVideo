param(
  [ValidateSet('status', 'start', 'stop')]
  [string]$Action = 'status',
  [switch]$Visible,
  [string]$AvdName = 'NodeVideo_Pixel_API_35'
)

$ErrorActionPreference = 'Stop'

$sdkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$adbPath = Join-Path $sdkRoot 'platform-tools\adb.exe'
$emulatorPath = Join-Path $sdkRoot 'emulator\emulator.exe'
$avdConfigPath = Join-Path $env:USERPROFILE ".android\avd\$AvdName.avd\config.ini"
$serial = 'emulator-5554'
$bootTimeoutSeconds = 180

function Assert-AndroidRuntime {
  foreach ($requiredPath in @($adbPath, $emulatorPath, $avdConfigPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
      throw "Android runtime prerequisite is missing: $requiredPath"
    }
  }

  $imageLine = Get-Content -LiteralPath $avdConfigPath |
    Where-Object { $_ -like 'image.sysdir.1=*' } |
    Select-Object -First 1
  if (-not $imageLine) {
    throw "AVD $AvdName does not declare an installed system image."
  }
  $relativeImagePath = ($imageLine -split '=', 2)[1]
  $systemImagePath = Join-Path $sdkRoot $relativeImagePath
  if (-not (Test-Path -LiteralPath (Join-Path $systemImagePath 'system.img'))) {
    throw "AVD $AvdName points to a missing system image: $systemImagePath"
  }
}

function Get-BootState {
  try {
    $deviceRows = & $adbPath devices 2>$null
  } catch {
    $deviceRows = @()
  }
  $connected = $deviceRows -match "^$serial\s+device$"
  $bootCompleted = ''
  if ($connected) {
    try {
      $bootValue = & $adbPath -s $serial shell getprop sys.boot_completed 2>$null
    } catch {
      $bootValue = ''
    }
    if ($null -ne $bootValue) {
      $bootCompleted = [string]$bootValue
    }
  }
  return [pscustomobject]@{
    avd = $AvdName
    serial = $serial
    connected = [bool]$connected
    bootCompleted = $bootCompleted.Trim() -eq '1'
  }
}

Assert-AndroidRuntime

if ($Action -eq 'stop') {
  $state = Get-BootState
  if ($state.connected) {
    try {
      & $adbPath -s $serial emu kill 2>$null | Out-Null
    } catch {
      # The transport can close before adb receives the emulator's final acknowledgement.
    }
    $stopDeadline = (Get-Date).AddSeconds(30)
    do {
      Start-Sleep -Milliseconds 500
      $state = Get-BootState
    } until (-not $state.connected -or (Get-Date) -ge $stopDeadline)
    if ($state.connected) {
      throw 'Android emulator did not stop within 30 seconds.'
    }
  }
  [pscustomobject]@{ avd = $AvdName; stopped = $true } | ConvertTo-Json -Compress
  exit 0
}

if ($Action -eq 'start') {
  $state = Get-BootState
  if (-not $state.connected) {
    $arguments = @(
      '-avd', $AvdName,
      '-no-audio',
      '-no-boot-anim',
      '-gpu', 'auto',
      '-camera-back', 'virtualscene',
      '-camera-front', 'emulated'
    )
    if ($Visible) {
      Start-Process -FilePath $emulatorPath -ArgumentList $arguments | Out-Null
    } else {
      $arguments += '-no-window'
      Start-Process -FilePath $emulatorPath -ArgumentList $arguments -WindowStyle Hidden | Out-Null
    }
  }

  $deadline = (Get-Date).AddSeconds($bootTimeoutSeconds)
  do {
    Start-Sleep -Seconds 2
    $state = Get-BootState
  } until ($state.bootCompleted -or (Get-Date) -ge $deadline)

  if (-not $state.bootCompleted) {
    throw "Android emulator did not complete boot within $bootTimeoutSeconds seconds."
  }
  try {
    & $adbPath -s $serial shell monkey -p com.android.chrome -c android.intent.category.LAUNCHER 1 2>$null | Out-Null
  } catch {
    # Android's monkey launcher writes argument diagnostics to stderr even after injecting the event.
  }
  $chromeDeadline = (Get-Date).AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 500
    try {
      $chromeSockets = & $adbPath -s $serial shell cat /proc/net/unix 2>$null
    } catch {
      $chromeSockets = @()
    }
  } until ($chromeSockets -match 'chrome_devtools_remote' -or (Get-Date) -ge $chromeDeadline)
  if (-not ($chromeSockets -match 'chrome_devtools_remote')) {
    throw 'Android Chrome did not expose its remote-debug socket within 15 seconds.'
  }
  try {
    & $adbPath -s $serial shell pm grant com.android.chrome android.permission.CAMERA 2>$null | Out-Null
  } catch {
    throw 'Android Chrome started, but the disposable AVD camera permission could not be granted.'
  }
  try {
    & $adbPath -s $serial forward --remove tcp:9222 2>$null | Out-Null
  } catch {
    # No previous forward is a valid first-start state.
  }
  & $adbPath -s $serial forward tcp:9222 localabstract:chrome_devtools_remote | Out-Null
}

$finalState = Get-BootState
$acceleration = (& $emulatorPath -accel-check) -join ' '
$forwardedPorts = if ($finalState.connected) { (& $adbPath -s $serial forward --list) } else { @() }
$cdpReady = $false
if ($forwardedPorts -match 'tcp:9222') {
  try {
    $cdpVersion = Invoke-RestMethod -Uri 'http://127.0.0.1:9222/json/version' -TimeoutSec 2
    $cdpReady = [bool]($cdpVersion.Browser -match '^Chrome/')
  } catch {
    $cdpReady = $false
  }
}
if ($Action -eq 'start' -and -not $cdpReady) {
  throw 'Android Chrome started, but its local DevTools health check failed.'
}
[pscustomobject]@{
  avd = $AvdName
  serial = $serial
  connected = $finalState.connected
  bootCompleted = $finalState.bootCompleted
  acceleration = $acceleration.Trim()
  cdpForwarded = [bool]($forwardedPorts -match 'tcp:9222')
  cdpReady = $cdpReady
} | ConvertTo-Json -Compress

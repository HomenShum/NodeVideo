param(
  [string]$OutputRoot = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$specPath = Join-Path $OutputRoot 'approved-explanation.json'
$spec = Get-Content -LiteralPath $specPath -Raw -Encoding utf8 | ConvertFrom-Json
$work = Join-Path $OutputRoot '.render-work'
New-Item -ItemType Directory -Force -Path $work | Out-Null

Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice.SelectVoice('Microsoft David Desktop')
$voice.Rate = 2
$voice.Volume = 100

function Get-DurationSeconds([string]$Path) {
  $value = & ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $Path
  if ($LASTEXITCODE -ne 0) { throw "ffprobe failed for $Path" }
  return [double]::Parse($value.Trim(), [Globalization.CultureInfo]::InvariantCulture)
}

function Ass-Time([double]$Seconds) {
  $centiseconds = [math]::Floor($Seconds * 100)
  $hours = [math]::Floor($centiseconds / 360000)
  $centiseconds %= 360000
  $minutes = [math]::Floor($centiseconds / 6000)
  $centiseconds %= 6000
  $wholeSeconds = [math]::Floor($centiseconds / 100)
  $cs = $centiseconds % 100
  return ('{0}:{1:00}:{2:00}.{3:00}' -f $hours, $minutes, $wholeSeconds, $cs)
}

function Escape-Ass([string]$Text) {
  return $Text.Replace('\\', '\\\\').Replace('{', '\{').Replace('}', '\}').Replace("`r", '').Replace("`n", '\N')
}

function Wrap-Ass([string]$Text, [int]$Width = 58) {
  $words = $Text -split '\s+'
  $lines = New-Object System.Collections.Generic.List[string]
  $line = ''
  foreach ($word in $words) {
    if (($line.Length + $word.Length + 1) -gt $Width -and $line.Length -gt 0) {
      $lines.Add($line)
      $line = $word
    } else {
      $line = if ($line.Length -eq 0) { $word } else { "$line $word" }
    }
  }
  if ($line.Length -gt 0) { $lines.Add($line) }
  return ($lines -join '\N')
}

$sectionFiles = @()
$durations = @()
for ($i = 0; $i -lt $spec.sections.Count; $i++) {
  $wav = Join-Path $work ('section-{0:00}.wav' -f ($i + 1))
  $voice.SetOutputToWaveFile($wav)
  $voice.Speak([string]$spec.sections[$i].narration)
  $voice.SetOutputToNull()
  $sectionFiles += $wav
  $durations += Get-DurationSeconds $wav
}
$voice.Dispose()

$silence = Join-Path $work 'silence.wav'
& ffmpeg -hide_banner -loglevel error -f lavfi -i 'anullsrc=r=22050:cl=mono' -t 0.6 -c:a pcm_s16le -y $silence
if ($LASTEXITCODE -ne 0) { throw 'Failed to generate narration spacing.' }

$concat = Join-Path $work 'narration-concat.txt'
$concatLines = @()
for ($i = 0; $i -lt $sectionFiles.Count; $i++) {
  $concatLines += "file '$($sectionFiles[$i].Replace("'", "''"))'"
  if ($i -lt $sectionFiles.Count - 1) { $concatLines += "file '$($silence.Replace("'", "''"))'" }
}
[IO.File]::WriteAllText($concat, ($concatLines -join "`n"), (New-Object Text.UTF8Encoding($false)))
$narration = Join-Path $OutputRoot 'narration.wav'
& ffmpeg -hide_banner -loglevel error -f concat -safe 0 -i $concat -c:a pcm_s16le -y $narration
if ($LASTEXITCODE -ne 0) { throw 'Failed to concatenate narration.' }
$totalDuration = Get-DurationSeconds $narration
if ($totalDuration -gt 120) { throw "Narration is $totalDuration seconds; the 120-second gate failed." }

$ass = Join-Path $OutputRoot 'scenes.ass'
$assLines = @(
  '[Script Info]',
  'ScriptType: v4.00+',
  'PlayResX: 1280',
  'PlayResY: 720',
  'WrapStyle: 2',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Tag,Segoe UI,20,&H00E9F7FF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,1,0,1,0,0,7,52,40,34,1',
  'Style: Kicker,Segoe UI,22,&H0057D3FF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,2,0,1,0,0,7,84,84,112,1',
  'Style: Title,Segoe UI Semibold,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,7,84,84,152,1',
  'Style: Visual,Consolas,27,&H00CDE7F0,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,1,0,1,0,0,7,88,88,285,1',
  'Style: Caption,Segoe UI,25,&H00FFFFFF,&H000000FF,&H00101824,&HCC101824,0,0,0,0,100,100,0,0,3,1,0,2,110,110,42,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
)
$assLines += "Dialogue: 0,$(Ass-Time 0),$(Ass-Time $totalDuration),Tag,,0,0,0,,NODEVIDEO  //  EXPRESSION LOOP  //  AI-NARRATED PROTOTYPE"

$cursor = 0.0
$sceneStarts = @()
for ($i = 0; $i -lt $spec.sections.Count; $i++) {
  $scene = $spec.sections[$i]
  $sceneStarts += $cursor
  $end = $cursor + $durations[$i]
  $visual = (($scene.visualLines | ForEach-Object { Escape-Ass ([string]$_) }) -join '\N\N')
  $assLines += "Dialogue: 0,$(Ass-Time $cursor),$(Ass-Time $end),Kicker,,0,0,0,,SLIDE $($i + 1) / $($spec.sections.Count)"
  $assLines += "Dialogue: 0,$(Ass-Time $cursor),$(Ass-Time $end),Title,,0,0,0,,{\fad(180,180)}$(Escape-Ass ([string]$scene.title))"
  $assLines += "Dialogue: 0,$(Ass-Time $cursor),$(Ass-Time $end),Visual,,0,0,0,,{\fad(240,180)}$visual"
  $sentences = [regex]::Matches([string]$scene.narration, '[^.!?]+[.!?]') | ForEach-Object { $_.Value.Trim() }
  if ($sentences.Count -eq 0) { $sentences = @([string]$scene.narration) }
  $weights = $sentences | ForEach-Object { [math]::Max(1, (($_ -split '\s+').Count)) }
  $weightTotal = ($weights | Measure-Object -Sum).Sum
  $captionCursor = $cursor
  for ($j = 0; $j -lt $sentences.Count; $j++) {
    $captionDuration = $durations[$i] * ($weights[$j] / $weightTotal)
    $captionEnd = if ($j -eq $sentences.Count - 1) { $end } else { $captionCursor + $captionDuration }
    $caption = Escape-Ass (Wrap-Ass ([string]$sentences[$j]))
    $assLines += "Dialogue: 1,$(Ass-Time $captionCursor),$(Ass-Time $captionEnd),Caption,,0,0,0,,{\fad(80,80)}$caption"
    $captionCursor = $captionEnd
  }
  $cursor = $end + 0.6
}
Set-Content -LiteralPath $ass -Value ($assLines -join "`n") -Encoding utf8

$videoOnly = Join-Path $work 'video-only.mp4'
$durationText = $totalDuration.ToString('0.000', [Globalization.CultureInfo]::InvariantCulture)
Push-Location $OutputRoot
try {
  & ffmpeg -hide_banner -loglevel error -f lavfi -i "color=c=0x070B14:s=1280x720:r=30:d=$durationText" -vf "drawgrid=w=80:h=80:t=1:c=0x172235,drawbox=x=0:y=0:w=iw:h=8:color=0x57D3FF@0.95:t=fill,drawbox=x=0:y=712:w=iw:h=8:color=0xA76DFF@0.95:t=fill,ass=scenes.ass" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart -y $videoOnly
  if ($LASTEXITCODE -ne 0) { throw 'Failed to render the visual track.' }
} finally {
  Pop-Location
}

$final = Join-Path $OutputRoot 'nodevideo-two-minute-explanation.mp4'
& ffmpeg -hide_banner -loglevel error -i $videoOnly -i $narration -c:v copy -af 'loudnorm=I=-16:LRA=11:TP=-1.5,volume=2dB,alimiter=limit=0.70:level=0:attack=5:release=50' -c:a aac -b:a 192k -shortest -movflags +faststart -y $final
if ($LASTEXITCODE -ne 0) { throw 'Failed to mux the final video.' }

$thumbnail = Join-Path $OutputRoot 'thumbnail.png'
& ffmpeg -hide_banner -loglevel error -ss 1.0 -i $final -frames:v 1 -y $thumbnail
if ($LASTEXITCODE -ne 0) { throw 'Failed to extract the thumbnail.' }

$frames = @()
for ($i = 0; $i -lt $sceneStarts.Count; $i++) {
  $frame = Join-Path $work ('frame-{0:00}.png' -f ($i + 1))
  $seek = ($sceneStarts[$i] + [math]::Min(2.0, $durations[$i] / 2)).ToString('0.000', [Globalization.CultureInfo]::InvariantCulture)
  & ffmpeg -hide_banner -loglevel error -ss $seek -i $final -frames:v 1 -y $frame
  if ($LASTEXITCODE -ne 0) { throw "Failed to extract contact-sheet frame $i." }
  $frames += $frame
}
$contact = Join-Path $OutputRoot 'contact-sheet.jpg'
& ffmpeg -hide_banner -loglevel error -i $frames[0] -i $frames[1] -i $frames[2] -i $frames[3] -i $frames[4] -filter_complex '[0:v]scale=320:180[a];[1:v]scale=320:180[b];[2:v]scale=320:180[c];[3:v]scale=320:180[d];[4:v]scale=320:180[e];[a][b][c][d][e]hstack=inputs=5[out]' -map '[out]' -frames:v 1 -y $contact
if ($LASTEXITCODE -ne 0) { throw 'Failed to render the contact sheet.' }

$probe = & ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_type,codec_name,width,height,r_frame_rate,channels -of json $final | ConvertFrom-Json
$receipt = [ordered]@{
  schemaVersion = 'nodevideo.expression-loop-render-receipt.v1'
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
  status = 'succeeded'
  inputSpecSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $specPath).Hash.ToLowerInvariant()
  output = [ordered]@{
    file = 'nodevideo-two-minute-explanation.mp4'
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $final).Hash.ToLowerInvariant()
    durationSeconds = [math]::Round([double]$probe.format.duration, 3)
    sizeBytes = [int64]$probe.format.size
    streams = $probe.streams
  }
  gates = [ordered]@{
    durationAtMost120Seconds = ([double]$probe.format.duration -le 120)
    videoPresent = [bool]($probe.streams | Where-Object codec_type -eq 'video')
    audioPresent = [bool]($probe.streams | Where-Object codec_type -eq 'audio')
    fiveSectionsRendered = ($spec.sections.Count -eq 5)
    aiNarrationDisclosed = $true
    musicUsed = $false
  }
  limitations = $spec.disclosure.limitations
}
$receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $OutputRoot 'render-receipt.json') -Encoding utf8
$receipt | ConvertTo-Json -Depth 8

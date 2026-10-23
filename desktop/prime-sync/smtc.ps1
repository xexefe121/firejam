# FireJam desktop bridge: talks to Windows' media controls (SMTC) for the Prime Video app.
# Reads one command per line on stdin and answers one JSON line on stdout:
#   state            -> {"found":true,"app":..,"title":..,"status":"Playing","position":12.3,"end":5400}
#   play | pause     -> {"ok":true}
#   seek <seconds>   -> {"ok":true}
# Windows PowerShell 5.1 (it has the WinRT projection).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, [Type]$type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $t.Wait(-1) | Out-Null
  $t.Result
}
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$Mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

function Prime {
  foreach ($s in $Mgr.GetSessions()) {
    if ($s.SourceAppUserModelId -match 'PrimeVideo') { return $s }
  }
  foreach ($s in $Mgr.GetSessions()) {
    $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    if ($p.Title -like 'Prime Video*') { return $s }
  }
  return $null
}

function State {
  $s = Prime
  if (-not $s) { return @{ found = $false } }
  $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $pb = $s.GetPlaybackInfo()
  $tl = $s.GetTimelineProperties()
  $pos = $tl.Position.TotalSeconds
  $status = "$($pb.PlaybackStatus)"
  # The timeline is only updated on changes; move it on while playing.
  if ($status -eq 'Playing' -and $pos -gt 0) { $pos += ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalSeconds }
  return @{
    found    = $true
    app      = $s.SourceAppUserModelId
    title    = ($props.Title -replace '^Prime Video:\s*', '')
    status   = $status
    position = [math]::Round($pos, 2)
    end      = [math]::Round($tl.EndTime.TotalSeconds, 1)
  }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $parts = $line.Trim().Split(' ')
    switch ($parts[0]) {
      'state' { $out = State }
      'play' { $s = Prime; if ($s) { Await ($s.TryPlayAsync()) ([bool]) | Out-Null }; $out = @{ ok = [bool]$s } }
      'pause' { $s = Prime; if ($s) { Await ($s.TryPauseAsync()) ([bool]) | Out-Null }; $out = @{ ok = [bool]$s } }
      'seek' {
        $s = Prime
        if ($s) { Await ($s.TryChangePlaybackPositionAsync([long]([double]$parts[1] * 10000000))) ([bool]) | Out-Null }
        $out = @{ ok = [bool]$s }
      }
      default { $out = @{ error = "unknown command $($parts[0])" } }
    }
  } catch {
    $out = @{ error = "$_" }
  }
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

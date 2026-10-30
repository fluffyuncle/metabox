@echo off

setlocal
set "BUSYBOX_EXECUTABLE=%~dp0busybox.exe"
set "BUSYBOX_VERSION=5857-g3681e397f"
set "BUSYBOX_DOWNLOAD=https://frippery.org/files/busybox/busybox-w64u-FRP-%BUSYBOX_VERSION%.exe"

if not exist "%BUSYBOX_EXECUTABLE%" (
	if exist "%SystemRoot%\System32\curl.exe" (
		curl -sL -o "%BUSYBOX_EXECUTABLE%" "%BUSYBOX_DOWNLOAD%"
	) else (
		powershell -Command ^
			"$ProgressPreference = 'SilentlyContinue';" ^
			"$url = '%BUSYBOX_DOWNLOAD%';" ^
			"$out = '%BUSYBOX_EXECUTABLE%';" ^
			"$dir = Split-Path -Parent $out;" ^
			"if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null };" ^
			"$res = Invoke-WebRequest -Uri $url -TimeoutSec 10 -UseBasicParsing;" ^
			"if ($res.StatusCode -eq 200) { $res.Content | Out-File -FilePath $out -Encoding UTF8 } else { exit 1 }"
	)
)
endlocal

call "%~dp0busybox.exe" %*
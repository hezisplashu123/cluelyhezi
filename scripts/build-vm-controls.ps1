$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $repositoryRoot 'artifacts/yashpc1'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$sourcePath = Join-Path $PSScriptRoot 'vm-controls.cs'
$executablePath = Join-Path $outputDirectory 'yashpc1.exe'
& $compilerPath /nologo /target:winexe "/out:$executablePath" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll $sourcePath
if ($LASTEXITCODE -ne 0) { throw 'Guest helper compilation failed.' }
$clientConfigPath = Join-Path $env:USERPROFILE '.OpenCluely/vm-controls/vm-controls.json'
Copy-Item -LiteralPath $clientConfigPath -Destination (Join-Path $outputDirectory 'vm-controls.json') -Force
@'
yashpc1

1. Keep OpenCluely running on the host computer.
2. Copy this entire folder or its ZIP into the Windows VM.
3. Extract the ZIP inside the VM. Do not run from inside the ZIP.
4. Exit the previous OpenCluely VM Controls helper from its tray icon first.
5. Double-click yashpc1.exe inside the VM.
6. Wait for Connected. Close its window to leave it running in the tray.

Backslash: save one screenshot of the visible host/VM screen.
Backtick: send all saved screenshots for one answer.
Ctrl+Shift+I: toggle panel moving/copying and click-through mode.
Ctrl+Shift+O: reopen answer/code panels.
Ctrl+Shift+S and Ctrl+Shift+Enter are capture/submit alternatives.
Clicks pass through answer panels by default. Hover and scroll to read them.
Left-click while over a panel to scroll the screen behind it instead. Move off
the panel and hover again to resume scrolling the panel.

The helper sends only these controls and panel wheel events. It does not send
typed text, record the screen, or contain the OpenAI API key. Screenshots and
model requests remain in the host app. Keep vm-controls.json beside the EXE;
it pairs the helper to this host's VMware network interfaces.

To stop the helper, right-click its tray icon and choose Exit.
If it shows Not connected, keep the host app running and check that the VM
uses the VMware NAT (VMnet8) or host-only (VMnet1) network.
'@ | Set-Content -LiteralPath (Join-Path $outputDirectory 'START HERE.txt') -Encoding UTF8
$archivePath = Join-Path $repositoryRoot 'artifacts/yashpc1.zip'
Compress-Archive -Path (Join-Path $outputDirectory '*') -DestinationPath $archivePath -Force
Write-Output "Guest helper package: $archivePath"

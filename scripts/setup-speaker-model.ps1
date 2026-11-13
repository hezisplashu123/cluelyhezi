param(
  [Parameter(Mandatory=$true)][string]$UserData,
  [string]$PythonVersion = '3.12'
)
$ErrorActionPreference = 'Stop'
$venv = Join-Path $UserData 'speaker-python'
$model = Join-Path $UserData 'speaker-models\spkrec-ecapa-voxceleb-0f99f2d'
function Invoke-Native { & $args[0] $args[1..($args.Count - 1)]; if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE" } }
New-Item -ItemType Directory -Force -Path $UserData | Out-Null
if (-not (Test-Path $venv)) { Invoke-Native py "-$PythonVersion" -m venv $venv }
$python = Join-Path $venv 'Scripts\python.exe'
Invoke-Native $python -m pip install --upgrade pip
Invoke-Native $python -m pip install 'torch==2.5.1' 'torchaudio==2.5.1' 'speechbrain==1.0.3' 'huggingface_hub==0.36.0' 'numpy<2.3'
Invoke-Native $python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='speechbrain/spkrec-ecapa-voxceleb', revision='0f99f2d0ebe89ac095bcc5903c4dd8f72b367286', local_dir=r'$model')"
if (-not (Test-Path (Join-Path $model 'custom.py'))) { New-Item -ItemType File -Path (Join-Path $model 'custom.py') | Out-Null }
$worker = Join-Path $PSScriptRoot 'speaker_worker.py'
$env:SPEAKER_MODEL_DIR = $model
$env:HF_HUB_OFFLINE = '1'
$health = '{"id":1,"command":"health"}' | & $python -u $worker
if ($LASTEXITCODE -ne 0 -or $health -notmatch '"ok":true') { throw "Voice model inference health check failed: $health" }
Write-Host "Installed pinned speaker model at $model"
Write-Host "Voice model health check passed. OpenCluely will discover $python automatically."

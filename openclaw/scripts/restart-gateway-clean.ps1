# Stop OpenClaw + gpt2giga, free gateway ports, clear Telegram webhook, refresh env, start gateway (with gpt2giga by default).
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
& (Join-Path $here "stop-openclaw-processes.ps1")
& (Join-Path $here "stop-all-openclaw-node.ps1")
& (Join-Path $here "stop-gpt2giga.ps1")
& (Join-Path $here "telegram-delete-webhook.ps1")
& (Join-Path $here "apply-env-to-openclaw.ps1")
& (Join-Path $here "start-gateway.ps1")

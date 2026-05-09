# Thin wrapper: forwards all arguments to StartCode.ps1 in this repo (single real entrypoint).
# Run:
#   .\Start.ps1
#   .\Start.ps1 -Mode FullDesktop

param(
    [ValidateSet("FullDesktop", "FullHere", "Deps", "Api", "Worker", "Menu")]
    [string]$Mode = "Menu"
)

& (Join-Path $PSScriptRoot "StartCode.ps1") -Mode $Mode


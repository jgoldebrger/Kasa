# PowerShell script to package the app for sharing
# This creates a ZIP file excluding node_modules, .next, and sensitive files

Write-Host "Packaging Kasa Family Management for sharing..." -ForegroundColor Green

$projectPath = Split-Path -Parent $PSScriptRoot
$outputPath = Join-Path (Split-Path -Parent $projectPath) "kasa-family-management-share.zip"

# Files and folders to exclude
$excludeItems = @(
    "node_modules",
    ".next",
    ".vercel",
    ".env*",
    "*.log",
    ".git",
    "dist",
    "build"
)

Write-Host "Creating archive..." -ForegroundColor Yellow

# Create temporary directory for clean copy
$tempDir = Join-Path $env:TEMP "kasa-package-$(Get-Date -Format 'yyyyMMddHHmmss')"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

# Copy files excluding specified items
Get-ChildItem -Path $projectPath -Recurse | Where-Object {
    $relativePath = $_.FullName.Substring($projectPath.Length + 1)
    $shouldExclude = $false
    foreach ($exclude in $excludeItems) {
        if ($relativePath -like $exclude -or $relativePath -like "*\$exclude\*") {
            $shouldExclude = $true
            break
        }
    }
    return -not $shouldExclude
} | ForEach-Object {
    $destPath = $_.FullName.Replace($projectPath, $tempDir)
    $destDir = Split-Path -Parent $destPath
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    Copy-Item -Path $_.FullName -Destination $destPath -Force
}

# Create ZIP file
Compress-Archive -Path "$tempDir\*" -DestinationPath $outputPath -Force

# Clean up temp directory
Remove-Item -Path $tempDir -Recurse -Force

Write-Host "`nPackage created successfully!" -ForegroundColor Green
Write-Host "Location: $outputPath" -ForegroundColor Cyan
Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "1. Share this ZIP file with the recipient" -ForegroundColor White
Write-Host "2. Include SETUP_INSTRUCTIONS.md (it's in the package)" -ForegroundColor White
Write-Host "3. Make sure they have Node.js 18+ installed" -ForegroundColor White


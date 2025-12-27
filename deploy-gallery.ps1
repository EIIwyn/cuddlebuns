# Gallery v2 Deployment Script
# Usage: .\deploy-gallery.ps1

param(
    [string]$Message = "Deploy gallery v2 - $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
)

Write-Host ""
Write-Host "🚀 Gallery v2 Deployment Script" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""

# Check if in correct directory
if (-not (Test-Path "gallery-v2")) {
    Write-Host "❌ Error: gallery-v2 directory not found!" -ForegroundColor Red
    Write-Host "Make sure you're running this from E:\Code Stuff\cuddlebuns" -ForegroundColor Yellow
    exit 1
}

# Step 1: Build
Write-Host "📦 Step 1: Building production bundle..." -ForegroundColor Yellow
Set-Location gallery-v2

pnpm build

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    Set-Location ..
    exit 1
}

Set-Location ..
Write-Host "✅ Build successful!" -ForegroundColor Green
Write-Host ""

# Step 2: Backup old gallery (optional safety measure)
Write-Host "💾 Step 2: Creating backup of old gallery..." -ForegroundColor Yellow
$backupPath = "public\gallery-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
if (Test-Path "public\gallery") {
    Copy-Item "public\gallery" -Destination $backupPath -Recurse -ErrorAction SilentlyContinue
    Write-Host "✅ Backup created at: $backupPath" -ForegroundColor Green
} else {
    Write-Host "ℹ️  No existing gallery to backup" -ForegroundColor Gray
}
Write-Host ""

# Step 3: Clear old gallery
Write-Host "🧹 Step 3: Clearing old gallery..." -ForegroundColor Yellow
if (Test-Path "public\gallery") {
    Remove-Item "public\gallery\*" -Recurse -Force -ErrorAction SilentlyContinue
} else {
    New-Item -ItemType Directory -Path "public\gallery" -Force | Out-Null
}
Write-Host "✅ Old gallery cleared" -ForegroundColor Green
Write-Host ""

# Step 4: Copy new build
Write-Host "📤 Step 4: Copying new build to public/gallery..." -ForegroundColor Yellow
Copy-Item "gallery-v2\dist\*" -Destination "public\gallery\" -Recurse
Write-Host "✅ New build copied" -ForegroundColor Green
Write-Host ""

# Step 5: Git status check
Write-Host "📊 Step 5: Checking git status..." -ForegroundColor Yellow
git status --short

Write-Host ""
Write-Host "Adding changes to git..." -ForegroundColor Cyan
git add public/gallery assets/
Write-Host "Changes to be committed:" -ForegroundColor Cyan
git status --short

Write-Host ""

# Step 6: Commit
Write-Host "💾 Step 6: Committing changes..." -ForegroundColor Yellow
Write-Host "Commit message: $Message" -ForegroundColor Gray

git commit -m "$Message

🚀 Generated with Claude Code

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Commit failed!" -ForegroundColor Red
    Write-Host "This might be because there are no changes to commit." -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ Changes committed" -ForegroundColor Green
Write-Host ""

# Step 7: Push to VPS
Write-Host "🚀 Step 7: Pushing to VPS..." -ForegroundColor Yellow
Write-Host "Remote: vps (masterpyon@cuddlebuns.moe)" -ForegroundColor Gray

git push vps main

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Push failed!" -ForegroundColor Red
    Write-Host "Check your SSH connection and VPS remote configuration." -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ Pushed to VPS" -ForegroundColor Green
Write-Host ""

# Success!
Write-Host "🎉 Deployment Complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Update Caddyfile on VPS (see gallery-v2/CADDY_UPDATE.md)" -ForegroundColor White
Write-Host "2. Reload Caddy: ssh masterpyon@cuddlebuns.moe 'sudo systemctl reload caddy'" -ForegroundColor White
Write-Host "3. Visit: https://cuddlebuns.moe/gallery/" -ForegroundColor White
Write-Host "4. Hard refresh browser (Ctrl+F5) to clear cache" -ForegroundColor White
Write-Host ""
Write-Host "Backup location: $backupPath" -ForegroundColor Gray
Write-Host ""

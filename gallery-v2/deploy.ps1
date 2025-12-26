# Gallery Deployment Script for Windows
# Usage: .\deploy.ps1 username@server-ip

param(
    [Parameter(Mandatory=$true)]
    [string]$Server
)

Write-Host "🚀 Gallery Deployment Script" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""

$RemotePath = "/var/www/gallery"

# Step 1: Build
Write-Host "📦 Step 1: Building production bundle..." -ForegroundColor Yellow
pnpm build

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Build successful!" -ForegroundColor Green
Write-Host ""

# Step 2: Upload
Write-Host "📤 Step 2: Uploading to VPS..." -ForegroundColor Yellow
Write-Host "Server: $Server" -ForegroundColor Cyan
Write-Host "Path: $RemotePath" -ForegroundColor Cyan
Write-Host ""

# Create directory on server
ssh $Server "mkdir -p $RemotePath"

# Upload using SCP
scp -r dist/* "${Server}:${RemotePath}/"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Upload failed!" -ForegroundColor Red
    Write-Host "Make sure you have SSH access configured" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ Upload complete!" -ForegroundColor Green
Write-Host ""

# Step 3: Set permissions
Write-Host "🔧 Step 3: Setting permissions..." -ForegroundColor Yellow
ssh $Server "sudo chmod -R 755 $RemotePath"
ssh $Server "sudo chown -R www-data:www-data $RemotePath"

Write-Host "✅ Permissions set!" -ForegroundColor Green
Write-Host ""

Write-Host "🎉 Deployment Complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Your gallery should now be live at:" -ForegroundColor Cyan
Write-Host "http://$($Server.Split('@')[1])" -ForegroundColor White
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Visit your site to verify it works" -ForegroundColor White
Write-Host "2. Configure Nginx/Caddy if not done yet (see DEPLOYMENT.md)" -ForegroundColor White
Write-Host "3. Set up HTTPS with Let's Encrypt" -ForegroundColor White
Write-Host ""

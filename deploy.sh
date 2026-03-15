#!/bin/bash
# ============================================
# Deployment script for cuddlebuns.moe
# ============================================
# This script builds the React app locally and deploys the full site to VPS.
#
# Note: GitHub sync is handled separately via manual `git push origin main`.
#       The Windows SSH key permissions issue in WSL prevents automating it here.
#
# Prerequisites:
# 1. SSH keys configured for VPS (masterpyon@cuddlebuns.moe)
# 2. Git remote 'vps' configured
# ============================================

set -e  # Exit on any error

echo "🚀 Starting deployment process..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Build React app locally
echo -e "${BLUE}📦 Building React app...${NC}"
cd site
npm run build
cd ..

echo -e "${GREEN}✓ Build completed${NC}"

# Step 2: Stage built files for git
echo -e "${BLUE}📋 Preparing deployment files...${NC}"

# Remove old built files (but keep assets, .gitignore, etc.)
find public -type f \( -name "*.html" -o -name "*.js" -o -name "*.css" \) -delete 2>/dev/null || true
rm -rf public/static 2>/dev/null || true
rm -rf public/gallery 2>/dev/null || true

# Copy built files to public/ root
cp -r site/dist/* public/

echo -e "${GREEN}✓ Files staged in public/${NC}"

# Step 3: Commit and push to VPS
echo -e "${BLUE}📤 Deploying to VPS...${NC}"

git add public/

# Check if there are changes to commit
if git diff --staged --quiet; then
    echo -e "${YELLOW}⚠ No changes to deploy${NC}"
    exit 0
fi

# Commit with timestamp
TIMESTAMP=$(date '+%Y-%m-%d %H:%M')
git commit -m "Deploy site - $TIMESTAMP"

# Push to VPS
if git remote | grep -q "^vps$"; then
    echo -e "${BLUE}Pushing to VPS...${NC}"
    git push vps main
else
    echo -e "${YELLOW}⚠ VPS remote not configured${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Deployment complete!${NC}"
echo -e "${BLUE}🌐 Visit: https://cuddlebuns.moe${NC}"
echo -e "${YELLOW}ℹ Reminder: sync GitHub manually with \`git push origin main\`${NC}"

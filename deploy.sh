#!/bin/bash
# ============================================
# Deployment script for cuddlebuns.moe
# ============================================
# This script builds the React app locally and deploys the full site to VPS
#
# Prerequisites:
# 1. SSH keys configured for GitHub (git@github.com)
# 2. SSH keys configured for VPS (if deploying to VPS)
# 3. Git remotes configured:
#    - origin: GitHub repository
#    - vps: VPS deployment repository (optional)
#
# The script will automatically:
# - Start SSH agent and load your default SSH keys
# - Build the React app
# - Commit built files
# - Push to configured remotes
#
# For collaborators: Ensure your SSH keys are in ~/.ssh/ and added to ssh-agent
# ============================================

set -e  # Exit on any error

echo "🚀 Starting deployment process..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Initialize SSH agent and add keys
echo -e "${BLUE}🔑 Setting up SSH authentication...${NC}"
eval "$(ssh-agent -s)" > /dev/null

# Determine SSH directory (handles Windows Git Bash vs Linux/Mac)
if [[ -n "$USERPROFILE" ]]; then
    # Windows - convert backslashes and use Windows home
    SSH_DIR="$(cygpath -u "$USERPROFILE")/.ssh"
else
    SSH_DIR="$HOME/.ssh"
fi

# Try to add SSH keys from detected directory
SSH_LOADED=false
for key in "$SSH_DIR"/id_ed25519 "$SSH_DIR"/id_rsa "$SSH_DIR"/github_ed25519; do
    if [[ -f "$key" ]]; then
        ssh-add "$key" 2>/dev/null && SSH_LOADED=true
    fi
done

if [[ "$SSH_LOADED" == "false" ]]; then
    echo -e "${YELLOW}⚠ Note: No SSH keys found in $SSH_DIR${NC}"
    echo -e "${YELLOW}  If push fails, ensure your SSH keys are set up correctly${NC}"
fi
echo -e "${GREEN}✓ SSH authentication ready${NC}"

# Step 1: Build React app locally
echo -e "${BLUE}📦 Building React app...${NC}"
cd site
npm run build
cd ..

echo -e "${GREEN}✓ Build completed${NC}"

# Step 2: Stage built files for git
echo -e "${BLUE}📋 Preparing deployment files...${NC}"

# Backup existing public files that shouldn't be deleted
# (assets folder is synced separately, .gitignore, etc.)

# Remove old built files (but keep assets, .gitignore, etc.)
find public -type f \( -name "*.html" -o -name "*.js" -o -name "*.css" \) -delete 2>/dev/null || true
rm -rf public/static 2>/dev/null || true
rm -rf public/gallery 2>/dev/null || true

# Copy built files to public/ root
cp -r site/dist/* public/

echo -e "${GREEN}✓ Files staged in public/${NC}"

# Step 3: Commit and push
echo -e "${BLUE}📤 Deploying to VPS...${NC}"

# Add the built files
git add public/

# Check if there are changes to commit
if git diff --staged --quiet; then
    echo -e "${YELLOW}⚠ No changes to deploy${NC}"
    exit 0
fi

# Commit with timestamp
TIMESTAMP=$(date '+%Y-%m-%d %H:%M')
git commit -m "Deploy site - $TIMESTAMP"

# Push to GitHub and VPS
echo -e "${BLUE}Pushing to GitHub...${NC}"
git push origin main

# Push to VPS if remote exists
if git remote | grep -q "^vps$"; then
    echo -e "${BLUE}Pushing to VPS...${NC}"
    git push vps main
else
    echo -e "${YELLOW}⚠ VPS remote not configured, skipping VPS deployment${NC}"
    echo -e "${YELLOW}  (This is normal for collaborators without VPS access)${NC}"
fi

echo -e "${GREEN}✅ Deployment complete!${NC}"
echo -e "${BLUE}🌐 Visit: https://cuddlebuns.moe${NC}"

# Cleanup: Kill the SSH agent we started
kill $SSH_AGENT_PID 2>/dev/null || true

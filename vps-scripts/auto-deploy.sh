#!/usr/bin/env bash
set -euo pipefail

SOURCE="/var/www/cuddlebuns/source"
SITE="$SOURCE/site"
RELEASES="/var/www/cuddlebuns/releases"
CURRENT="/var/www/cuddlebuns/current"

GIT_CHANGED=0
CMS_CHANGED=0

echo "========================================"
echo "Cuddlebuns automatic deployment check"
echo "Started: $(date)"
echo "========================================"

cd "$SOURCE"

# --------------------------------------------------
# Safety: never overwrite manual tracked-file edits.
# Ignored generated CMS/cache/build files do not count.
# --------------------------------------------------

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "ERROR: Source checkout contains uncommitted tracked changes."
    git status --short
    exit 1
fi

# --------------------------------------------------
# Check GitHub
# --------------------------------------------------

echo
echo "Checking GitHub..."

git fetch origin main

LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse origin/main)"

if [ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]; then
    echo "Git changes detected:"
    echo "  Local:  $LOCAL_HEAD"
    echo "  Remote: $REMOTE_HEAD"

    OLD_LOCK="$(
        git rev-parse HEAD:site/package-lock.json 2>/dev/null || true
    )"

    git pull --ff-only origin main

    NEW_LOCK="$(
        git rev-parse HEAD:site/package-lock.json 2>/dev/null || true
    )"

    GIT_CHANGED=1

    if [ "$OLD_LOCK" != "$NEW_LOCK" ]; then
        echo
        echo "package-lock.json changed; installing dependencies..."
        cd "$SITE"
        npm ci
        cd "$SOURCE"
    fi
else
    echo "No Git changes detected."
fi

# --------------------------------------------------
# Check NocoDB
# --------------------------------------------------

echo
echo "Checking NocoDB..."

cd "$SITE"

set +e
npm run sync:check
SYNC_CHECK_EXIT=$?
set -e

case "$SYNC_CHECK_EXIT" in
    0)
        echo "No public NocoDB changes detected."
        ;;
    10)
        echo "Public NocoDB changes detected."
        CMS_CHANGED=1
        ;;
    *)
        echo "ERROR: NocoDB change check failed with exit code $SYNC_CHECK_EXIT."
        exit "$SYNC_CHECK_EXIT"
        ;;
esac

# --------------------------------------------------
# Nothing changed
# --------------------------------------------------

if [ "$GIT_CHANGED" -eq 0 ] && [ "$CMS_CHANGED" -eq 0 ]; then
    echo
    echo "Nothing changed. No deployment required."
    exit 0
fi

# --------------------------------------------------
# Generate updated CMS assets if necessary
# --------------------------------------------------

if [ "$CMS_CHANGED" -eq 1 ]; then
    echo
    echo "Synchronizing changed NocoDB content..."
    npm run sync
fi

# --------------------------------------------------
# Validate + build
# --------------------------------------------------

echo
echo "Validating generated CMS..."
npm run validate:cms

echo
echo "Building production site..."
npm run build

# --------------------------------------------------
# Create atomic release
# --------------------------------------------------

RELEASE="$(date +%Y%m%d-%H%M%S)"
DEST="$RELEASES/$RELEASE"

echo
echo "Creating release:"
echo "  $DEST"

mkdir -p "$DEST"
cp -a dist/. "$DEST/"

# --------------------------------------------------
# Atomic switch
# --------------------------------------------------

echo "Activating release..."

ln -sfn "$DEST" "$CURRENT.next"
mv -Tf "$CURRENT.next" "$CURRENT"

echo
echo "Active release:"
readlink -f "$CURRENT"

# --------------------------------------------------
# Keep newest five releases
# --------------------------------------------------

echo
echo "Cleaning old releases..."

cd "$RELEASES"

mapfile -t OLD_RELEASES < <(
    ls -1dt */ 2>/dev/null | tail -n +6
)

if [ "${#OLD_RELEASES[@]}" -gt 0 ]; then
    rm -rf -- "${OLD_RELEASES[@]}"
fi

echo
echo "========================================"
echo "Deployment successful"
echo "Git changed:    $GIT_CHANGED"
echo "NocoDB changed: $CMS_CHANGED"
echo "Finished: $(date)"
echo "========================================"

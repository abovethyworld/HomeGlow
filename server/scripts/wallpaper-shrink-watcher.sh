#!/bin/bash
# Host-side shrink watcher for wallpaper imports.
#
# The backend container has a small memory cap, and shrinking a 4K
# wallpaper video to 1080p does not fit in it, so imports attach the
# original and drop a queue file instead. This watcher (a systemd
# timer on the Docker host, where memory is not capped) picks the
# queue files up, shrinks the video in place at the same URL, and
# clears the package's needsShrink flag through the storage API.
#
# Install (on the host):
#   cp wallpaper-shrink-watcher.sh /usr/local/bin/homeglow-shrink.sh
#   a static ffmpeg at /usr/local/bin/ffmpeg (or set FFMPEG=)
#   systemd service + timer, every 2 minutes:
#     homeglow-shrink.service -> ExecStart=/usr/local/bin/homeglow-shrink.sh
#     homeglow-shrink.timer   -> OnUnitActiveSec=2min
set -u

UPLOADS="${UPLOADS:-/opt/homeglow/homeglow/uploads}"
API="${API:-http://localhost:3000}"
FFMPEG="${FFMPEG:-/usr/local/bin/ffmpeg}"
QUEUE_DIR="$UPLOADS/wallpapers/.shrink-queue"
PLUGIN_ID="wallpaper-engine"

exec 9>/tmp/homeglow-shrink.lock
flock -n 9 || exit 0

[ -d "$QUEUE_DIR" ] || exit 0

for queue_file in "$QUEUE_DIR"/*.json; do
  [ -e "$queue_file" ] || continue
  folder=$(python3 -c "import json,sys; print(json.load(open('$queue_file'))['folder'])" 2>/dev/null)
  file=$(python3 -c "import json,sys; print(json.load(open('$queue_file'))['file'])" 2>/dev/null)
  [ -n "$folder" ] && [ -n "$file" ] || { rm -f "$queue_file"; continue; }
  src="$UPLOADS/wallpapers/$folder/$file"
  tmp="$UPLOADS/wallpapers/$folder/.shrinking.mp4"
  [ -f "$src" ] || { rm -f "$queue_file"; continue; }

  if "$FFMPEG" -y -v error -i "$src" -vf 'scale=1920:1080:flags=lanczos' -an \
      -c:v libx264 -preset veryfast -crf 27 -movflags +faststart "$tmp"; then
    mv "$tmp" "$src"
    rm -f "$queue_file"
    # Clear the flag on the stored package.
    curl -s "$API/api/plugin/v1/storage/$PLUGIN_ID/packages" -o /tmp/hg-packages.json
    python3 - <<PYEOF
import json
try:
    packages = json.load(open('/tmp/hg-packages.json'))
    for pkg in packages:
        if str(pkg.get('id')) == '$folder':
            pkg.pop('needsShrink', None)
    with open('/tmp/hg-packages.json', 'w') as out:
        json.dump(packages, out)
except Exception:
    raise SystemExit(0)
PYEOF
    curl -s -X PUT -H 'Content-Type: application/json' \
      -d @/tmp/hg-packages.json \
      "$API/api/plugin/v1/storage/$PLUGIN_ID/packages" >/dev/null
    echo "shrunk $folder/$file"
  else
    rm -f "$tmp"
    echo "shrink failed for $folder/$file; queue file kept for the next pass" >&2
  fi
done

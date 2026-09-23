#!/bin/bash
# Runs the browser-side QA scripts in headless Chrome. No install, no build step.
#
#   scripts/qa/headless.sh model            # model-rules.js (137 checks)
#   scripts/qa/headless.sh flow   1440 390  # bookmark-flow.js (123 checks) at each width
#   scripts/qa/headless.sh layout 1440 1024 768 390   # layout-check.js at each width
#   scripts/qa/headless.sh a11y   1440 390            # a11y-check.js (names, labels, headings, targets, focus rings)
#   LOOK=collage scripts/qa/headless.sh flow 1440      # run in another look (editorial by default;
#                                                      #  editorial | collage | analog | graphic)
#
# Widths of 500 and up use a real window. Headless Chrome will not go below a 500px layout width,
# so narrower widths load the page in an iframe of that width instead.
# Needs: Google Chrome (override with CHROME=...), python3, perl. Exit code 1 if anything fails.
#
# The small harness pages are written to .git/ (never tracked) and served on localhost:$PORT.

set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${PORT:-8124}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
H="$ROOT/.git"
LOOK_NAME="${LOOK:-editorial}"
BASE="http://localhost:$PORT"
MODE="${1:-}"; shift || true

[ -x "$CHROME" ] || { echo "Chrome not found at: $CHROME (set CHROME=...)"; exit 2; }

# A project-local, reused Chrome profile (not the machine's default one, not a fresh dir each call).
# A brand-new profile makes Chrome run its first-run/updater machinery (network pings, crash-handler
# forks) that ignore this script's alarm timeout and can hang for minutes; a profile that has already
# been through first-run skips that and launches in ~1s. Isolated from the default profile so this never
# fights the user's real Chrome, or another Claude Code session's own headless run, for its SingletonLock.
CHROME_PROFILE="${CHROME_PROFILE:-$ROOT/.git/tm-chrome-profile}"
mkdir -p "$CHROME_PROFILE"

case "$MODE" in model|flow|layout|a11y) ;; *) sed -n '2,12p' "$0"; exit 2 ;; esac

python3 - "$ROOT" "$H" <<'PY'
import sys
root, h = sys.argv[1], sys.argv[2]
index = open(root + "/index.html").read()
import os, re
look = os.environ.get("LOOK", "editorial")
index = re.sub(r'<html lang="en" data-look="[a-z]*"', '<html lang="en" data-look="%s"' % look, index)
def page(name, body):
    open(f"{h}/{name}", "w").write(index.replace("</body>", body + "\n</body>"))
def runner(module, call, delay):
    return ('<script type="module">setTimeout(async()=>{let r;try{const m=await import("/scripts/qa/' + module + '");r=await m.' + call +
            '}catch(e){r={error:String(e&&e.stack||e)}}const p=document.createElement("pre");p.id="out";p.textContent=JSON.stringify(r);document.body.appendChild(p)},' + str(delay) + ');</script>')
page("tm-model-" + look + ".html", runner("model-rules.js", "run();", 400))
page("tm-flow-" + look + ".html", runner("bookmark-flow.js", "run();", 600))
page("tm-run-" + look + ".html", runner("layout-check.js", "runAll();", 500))
page("tm-a11y-" + look + ".html", runner("a11y-check.js", "runAll();", 500))
open(h + "/tm-frame-" + look + ".html", "w").write("""<!doctype html><html><body style="margin:0;background:#fff">
<iframe id="f" style="border:0;display:block"></iframe>
<script>
const q=new URLSearchParams(location.search), f=document.getElementById('f');
f.width=q.get('w')||390; f.height=q.get('h')||2400; f.src=q.get('src');
let tries=0;const t=setInterval(()=>{tries++;try{const o=f.contentDocument.getElementById('out');if(o){const p=document.createElement('pre');p.id='out';p.textContent=o.textContent;document.body.appendChild(p);clearInterval(t)}}catch(e){}if(tries>600)clearInterval(t)},250);
</script></body></html>""")
PY

(cd "$ROOT" && exec python3 -m http.server "$PORT" >/dev/null 2>&1) &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1

# Turns Chrome's dumped DOM into a short summary. Exit 0 clean, 1 failures, 3 no result (harness flake).
cat > "$H/tm-summary-$LOOK_NAME.py" <<'PY'
import sys, re, json, html
mode = sys.argv[1]
m = re.search(r'<pre id="out">(.*?)</pre>', sys.stdin.read(), re.S)
if not m:
    print("  NO RESULT (harness timed out)"); sys.exit(3)
r = json.loads(html.unescape(m.group(1)))
if "error" in r:
    print("  ERROR:", r["error"][:600]); sys.exit(1)
if mode == "a11y":
    bad = 0
    for page, v in r.items():
        n = sum(len(x) for x in v.values())
        bad += n
        print("  %-16s issues=%d" % (page, n))
        for k, xs in v.items():
            for x in xs[:4]:
                print("       ", k, x)
    sys.exit(1 if bad else 0)
if mode == "layout":
    keys = ["stickerTextHits", "stickerBoxHits", "stickerOutside", "titleCollisions", "textUnderControls", "topbarOverlaps", "mapOverlaps", "lowContrast", "artworkHits"]
    import os
    # Collage is the original look; its decorative low-contrast labels are known and not gated (see visual-design-spec.md).
    gated = keys if os.environ.get("LOOK", "editorial") != "collage" else [k for k in keys if k != "lowContrast"]
    bad = 0
    for page, v in r.items():
        n = sum(len(v[k]) for k in gated) + (1 if v["hScroll"] else 0)
        bad += n
        print("  %-16s stickers=%-3d issues=%d" % (page, v["stickers"], n))
        for k in gated:
            for x in v[k][:3]:
                print("       ", k, x)
        if v["hScroll"]:
            print("        sideways scroll")
    sys.exit(1 if bad else 0)
ok = r.get("failed") in (0, [], None)
msg = "  passed %s of %s" % (r.get("passed"), r.get("total"))
if not ok:
    msg += "  FAILED: %s" % r.get("failed")
print(msg)
for f in (r.get("results") or [])[:12]:
    print("    x", f.get("name"), "|", str(f.get("detail"))[:300])
for f in (r.get("failures") or [])[:12]:
    print("    x", str(f)[:300])
sys.exit(0 if ok else 1)
PY

PAGE=tm-model-$LOOK_NAME.html; BUDGET=8000; [ "$MODE" = flow ] && { PAGE=tm-flow-$LOOK_NAME.html; BUDGET=70000; }; [ "$MODE" = layout ] && { PAGE=tm-run-$LOOK_NAME.html; BUDGET=15000; }; [ "$MODE" = a11y ] && { PAGE=tm-a11y-$LOOK_NAME.html; BUDGET=25000; }
WIDTHS=("$@"); [ "$MODE" = model ] && WIDTHS=(1000); [ ${#WIDTHS[@]} -eq 0 ] && WIDTHS=(1440)
STATUS=0
for w in "${WIDTHS[@]}"; do
  [ "$MODE" = model ] || echo "$MODE @ ${w}px  (look: ${LOOK:-editorial})"
  if [ "$w" -ge 500 ]; then URL="$BASE/.git/$PAGE"; WIN="$w,1000"
  else URL="$BASE/.git/tm-frame-$LOOK_NAME.html?w=$w&src=/.git/$PAGE"; WIN="800,1200"; fi
  [ "$MODE" = model ] && echo "model rules"
  for try in 1 2 3; do
    CHROME_ERR="$H/tm-chrome-err.log"
    out=$(perl -e 'alarm 200; exec @ARGV' "$CHROME" --headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu --hide-scrollbars --no-first-run --disable-background-networking --disable-component-update --disable-features=ChromeWhatsNewUI --user-data-dir="$CHROME_PROFILE" --window-size=$WIN --virtual-time-budget=$BUDGET --dump-dom "$URL" 2>"$CHROME_ERR" | python3 "$H/tm-summary-$LOOK_NAME.py" "$MODE"; echo "rc=${PIPESTATUS[1]}")
    rc=${out##*rc=}
    if [ "$rc" = 3 ]; then
      # Harness flake on the first tries; on the last try, show Chrome's own stderr so a real
      # launch failure (missing libs, no sandbox, etc.) is visible instead of a bare "NO RESULT".
      [ "$try" = 3 ] && [ -s "$CHROME_ERR" ] && { echo "  Chrome stderr:"; tail -8 "$CHROME_ERR" | sed 's/^/    /'; }
      continue
    fi
    echo "${out%rc=*}" | sed '/^$/d'
    [ "$rc" = 0 ] || STATUS=1
    break
  done
  [ "$rc" = 3 ] && { echo "  NO RESULT after 3 tries"; STATUS=1; }
done
exit $STATUS

#!/bin/bash
# Runs the browser-side QA scripts in headless Chrome. No install, no build step.
#
#   scripts/qa/headless.sh model            # model-rules.js (137 checks)
#   scripts/qa/headless.sh flow   1440 390  # bookmark-flow.js (123 checks) at each width
#   scripts/qa/headless.sh layout 1440 1024 768 390   # layout-check.js at each width
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
BASE="http://localhost:$PORT"
MODE="${1:-}"; shift || true

[ -x "$CHROME" ] || { echo "Chrome not found at: $CHROME (set CHROME=...)"; exit 2; }
case "$MODE" in model|flow|layout) ;; *) sed -n '2,12p' "$0"; exit 2 ;; esac

python3 - "$ROOT" "$H" <<'PY'
import sys
root, h = sys.argv[1], sys.argv[2]
index = open(root + "/index.html").read()
def page(name, body):
    open(f"{h}/{name}", "w").write(index.replace("</body>", body + "\n</body>"))
def runner(module, call, delay):
    return ('<script type="module">setTimeout(async()=>{let r;try{const m=await import("/scripts/qa/' + module + '");r=await m.' + call +
            '}catch(e){r={error:String(e&&e.stack||e)}}const p=document.createElement("pre");p.id="out";p.textContent=JSON.stringify(r);document.body.appendChild(p)},' + str(delay) + ');</script>')
page("tm-model.html", runner("model-rules.js", "run();", 400))
page("tm-flow.html", runner("bookmark-flow.js", "run();", 600))
page("tm-run.html", runner("layout-check.js", "runAll();", 500))
open(h + "/tm-frame.html", "w").write("""<!doctype html><html><body style="margin:0;background:#fff">
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
cat > "$H/tm-summary.py" <<'PY'
import sys, re, json, html
mode = sys.argv[1]
m = re.search(r'<pre id="out">(.*?)</pre>', sys.stdin.read(), re.S)
if not m:
    print("  NO RESULT (harness timed out)"); sys.exit(3)
r = json.loads(html.unescape(m.group(1)))
if "error" in r:
    print("  ERROR:", r["error"][:600]); sys.exit(1)
if mode == "layout":
    keys = ["stickerTextHits", "stickerBoxHits", "stickerOutside", "titleCollisions", "textUnderControls", "topbarOverlaps", "mapOverlaps"]
    bad = 0
    for page, v in r.items():
        n = sum(len(v[k]) for k in keys) + (1 if v["hScroll"] else 0)
        bad += n
        print("  %-16s stickers=%-3d issues=%d" % (page, v["stickers"], n))
        for k in keys:
            for x in v[k][:3]:
                print("       ", k, x)
        if v["hScroll"]:
            print("        sideways scroll")
    sys.exit(1 if bad else 0)
ok = r.get("failed") in (0, [], None)
msg = "  passed %s of %s" % (r.get("passed"), r.get("total"))
if not ok:
    msg += "  FAILED: " + json.dumps(r.get("failed"))[:800]
print(msg)
sys.exit(0 if ok else 1)
PY

PAGE=tm-model.html; BUDGET=8000; [ "$MODE" = flow ] && { PAGE=tm-flow.html; BUDGET=70000; }; [ "$MODE" = layout ] && { PAGE=tm-run.html; BUDGET=15000; }
WIDTHS=("$@"); [ "$MODE" = model ] && WIDTHS=(1000); [ ${#WIDTHS[@]} -eq 0 ] && WIDTHS=(1440)
STATUS=0
for w in "${WIDTHS[@]}"; do
  [ "$MODE" = model ] || echo "$MODE @ ${w}px"
  if [ "$w" -ge 500 ]; then URL="$BASE/.git/$PAGE"; WIN="$w,1000"
  else URL="$BASE/.git/tm-frame.html?w=$w&src=/.git/$PAGE"; WIN="800,1200"; fi
  [ "$MODE" = model ] && echo "model rules"
  for try in 1 2 3; do
    out=$(perl -e 'alarm 200; exec @ARGV' "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=$WIN --virtual-time-budget=$BUDGET --dump-dom "$URL" 2>/dev/null | python3 "$H/tm-summary.py" "$MODE"; echo "rc=${PIPESTATUS[1]}")
    rc=${out##*rc=}
    [ "$rc" = 3 ] && continue        # harness flake: try again
    echo "${out%rc=*}" | sed '/^$/d'
    [ "$rc" = 0 ] || STATUS=1
    break
  done
  [ "$rc" = 3 ] && { echo "  NO RESULT after 3 tries"; STATUS=1; }
done
exit $STATUS

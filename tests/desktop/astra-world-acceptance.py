"""Built-game W-025 acceptance. Uses UI walking; never assigns positions/state.

Run: python tests/desktop/astra-world-acceptance.py --out dev/out/astra-world-before
Build first with npm run build. Serves dist on a fresh loopback port, isolated
browser storage, software WebGL. One-shot random seed input/camera APIs are setup.
Exit 1 on an unmet world requirement; exit 2 on harness/setup failure.
"""
from __future__ import annotations

import argparse
import functools
import hashlib
import http.server
import json
import math
import pathlib
import subprocess
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]

SNAPSHOT = """() => {
 const g=window.__afterlife.game, s=g.sim.state;
 const id=s.household.memberIds[0], a=s.agents[id];
 return {seed:s.seed,tick:s.tick,screen:g.screen,fatal:g.fatalError,
 actor:{id,pos:a.pos,presence:a.presence},lot:s.lot,
 objects:Object.values(s.objects).map(o=>({defId:o.defId,placement:o.placement,tint:o.tint})),
 town:s.town??null,world:s.world??null, funds:s.household.funds};
}"""


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def until(page, expression, timeout=120000):
    # Python Playwright's wait_for_function injects eval under this Chrome/CSP.
    # Poll via CDP evaluation instead; do not weaken the shipped CSP.
    deadline=time.monotonic()+timeout/1000
    while time.monotonic()<deadline:
        if page.evaluate("() => ("+expression+")"):
            return
        page.wait_for_timeout(100)
    raise TimeoutError(f"Timed out observing: {expression}")


def trajectory_verdict(samples, target, tolerance=0.8):
    """Require actual continuous travel, advancing simulation and destination arrival."""
    if len(samples) < 5:
        return False, "fewer than five movement observations"
    identity=samples[0].get("agentId")
    if not identity:
        return False, "missing actor identity"
    for s in samples:
        if s.get("agentId")!=identity or s.get("presence")!="onLot":
            return False, "actor changed/disappeared during travel"
        if s.get("screen") != "game" or s.get("fatal"):
            return False, "loading/screen transition or fatal error during adjacent travel"
        if not all(isinstance(s.get(axis),(int,float)) and math.isfinite(s[axis]) for axis in ("x", "z", "tick")):
            return False, "non-finite trajectory"
    if any(b["tick"] < a["tick"] for a, b in zip(samples, samples[1:])):
        return False, "simulation rewound"
    jumps = [math.hypot(b["x"]-a["x"], b["z"]-a["z"]) for a,b in zip(samples,samples[1:])]
    if max(jumps, default=0) > 1.0:
        return False, "discontinuous jump or insufficient sampling (>1 tile per observation)"
    moving = sum(d > 0.001 for d in jumps)
    if moving < 3 or samples[-1]["tick"] <= samples[0]["tick"]:
        return False, "no sustained movement/advancing simulation"
    if math.hypot(samples[-1]["x"]-target["x"], samples[-1]["z"]-target["z"]) > tolerance:
        return False, "actor did not arrive at destination"
    return True, "continuous UI-driven movement reached destination"


def walk(page,target,out,tag):
    page.evaluate("t=>window.__afterlife.game.renderer.focus(t,true)",target)
    projection=page.evaluate("t=>{const r=window.__afterlife.game.renderer;const p=r.worldToScreen(t.x,0,t.z);return {...p,pick:r.pick(p.x,p.y,{agents:true,objects:true,walls:false,tiles:true}),inBounds:window.__afterlife.game.sim.spatial.inBounds(Math.floor(t.x),Math.floor(t.z))}}",target)
    page.evaluate("""() => {window.__astraSamples=[];window.__astraTimer=setInterval(()=>{const g=window.__afterlife.game,s=g.sim?.state,id=s?.household.memberIds[0],a=s?.agents[id];window.__astraSamples.push({agentId:id??null,presence:a?.presence??null,x:a?.pos.x??null,z:a?.pos.z??null,tick:s?.tick??null,screen:g.screen,fatal:g.fatalError});},50)}""")
    clicked=False
    if projection["visible"] and 0<=projection["x"]<1280 and 0<=projection["y"]<800:
        page.mouse.click(projection["x"],projection["y"])
        page.wait_for_timeout(300)
        go=page.get_by_role("menuitem",name="Go Here",exact=False)
        if go.count() and go.first.is_visible():
            go.first.click()
            clicked=True
    deadline=time.monotonic()+(35 if clicked else 2)
    while time.monotonic()<deadline:
        page.wait_for_timeout(100)
        current=page.evaluate(SNAPSHOT)
        if math.hypot(current["actor"]["pos"]["x"]-target["x"],current["actor"]["pos"]["z"]-target["z"])<0.3: break
    samples=page.evaluate("()=>{clearInterval(window.__astraTimer);return window.__astraSamples}")
    passed,reason=trajectory_verdict(samples,target)
    evidence={"target":target,"projection":projection,"clickedGoHere":clicked,"reason":reason,"samples":samples}
    (out/f"{tag}-trajectory.json").write_text(json.dumps(evidence,indent=2),encoding="utf-8")
    page.screenshot(path=str(out/f"{tag}-attempt.png"))
    return clicked and passed,{k:v for k,v in evidence.items() if k!="samples"}


def guards():
    path = [{"x":i*0.2,"z":0,"tick":i,"screen":"game","fatal":None,"agentId":"actor","presence":"onLot"} for i in range(11)]
    cases = [("walk", path, True), ("empty", [], False),
             ("stationary scenery", [dict(p,x=0) for p in path], False),
             ("teleport", [dict(p,x=0 if i<10 else 2) for i,p in enumerate(path)], False),
             ("frozen sim", [dict(p,tick=0) for p in path], False),
             ("loading swap", [dict(p,screen="loading" if i==5 else "game") for i,p in enumerate(path)], False),
             ("transient fatal", [dict(p,fatal="broken" if i==5 else None) for i,p in enumerate(path)], False),
             ("wrong destination", [dict(p,x=p["x"]+5) for p in path], False),
             ("NaN", [dict(p,x=float("nan") if i==5 else p["x"]) for i,p in enumerate(path)], False),
             ("missing coordinate", [dict(p,x=None) for p in path], False),
             ("actor swapped", [dict(p,agentId="other" if i>5 else "actor") for i,p in enumerate(path)], False),
             ("actor disappeared", [dict(p,presence=None if i==5 else "onLot") for i,p in enumerate(path)], False)]
    results=[]
    for name,samples,expected in cases:
        actual,why=trajectory_verdict(samples,{"x":2,"z":0})
        results.append({"case":name,"expected":expected,"actual":actual,"worked":actual==expected,"reason":why})
    return results


def main():
    args=argparse.ArgumentParser()
    args.add_argument("--out",default="dev/out/astra-world-before")
    args.add_argument("--guards-only",action="store_true")
    opts=args.parse_args()
    out=ROOT/opts.out
    out.mkdir(parents=True,exist_ok=True)
    report={"checks":[],"guards":guards(),"errors":[],"setup":[],"mutations":"One-shot Uint32 seed input before Start (restores original crypto immediately), public camera/speed APIs. Walking uses mouse/menu. No actor/world position writes. CSP unchanged."}
    def check(name,worked,detail):
        report["checks"].append({"name":name,"status":"Worked" if worked else "Failed","detail":detail})
        print(f"{'Worked' if worked else 'Failed'}: {name}",flush=True)
    def retain(name,value):
        (out/name).write_text(json.dumps(value,indent=2,allow_nan=False),encoding="utf-8")
    if opts.guards_only:
        retain("guards.json",report["guards"])
        return 0 if all(c["worked"] for c in report["guards"]) else 1
    dist=ROOT/"dist"
    if not (dist/"index.html").is_file():
        raise RuntimeError("Blocked: dist/index.html missing; run npm run build")
    report["head"]=subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip()
    report["harnessSha256"]=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
    report["distHashes"]={str(p.relative_to(dist)).replace("\\","/"):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(dist.rglob("*")) if p.is_file()}
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self,*_): pass
    server=http.server.ThreadingHTTPServer(("127.0.0.1",0),functools.partial(Quiet,directory=str(dist)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    url=f"http://127.0.0.1:{server.server_port}/"
    report["url"]=url
    snapshots=[]
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(channel="chrome",headless=True,args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"])
            report["browser"]=browser.version
            for run,seed in enumerate((25101,25102,25101)):
                ctx=browser.new_context(viewport={"width":1280,"height":800})
                page=ctx.new_page()
                page.on("pageerror",lambda e:report["errors"].append(str(e)))
                page.on("console",lambda m:report["errors"].append(m.text) if m.type=="error" else None)
                page.on("response",lambda r:report["errors"].append(f"HTTP {r.status}: {r.url}") if r.status>=400 else None)
                page.on("requestfailed",lambda r:report["errors"].append(f"Request failed: {r.url}: {r.failure}"))
                ctx.route("**/*",lambda route: route.continue_() if route.request.url.startswith(url) or route.request.url.startswith(("data:","blob:")) else route.abort())
                page.goto(url,wait_until="networkidle",timeout=120000)
                served_hash=hashlib.sha256(page.request.get(url).body()).hexdigest()
                if served_hash!=report["distHashes"]["index.html"]:
                    raise RuntimeError("Served index differs from recorded build")
                report["servedIndexSha256"]=served_hash
                until(page,"window.__afterlife?.game?.screen==='menu'",timeout=180000)
                gate=page.locator(".st-age-dialog .st-age__input")
                if gate.is_visible():
                    gate.fill("1990")
                    page.get_by_test_id("age-continue").click()
                page.locator(".sh-menu__item",has_text="New Game").first.click()
                page.get_by_role("button",name="Create your household").click()
                until(page,"window.__afterlife.game.screen==='caz'")
                until(page,"window.__afterlife.game.validateCaz().length===0")
                # Supply the creation seed at the environment boundary, not by editing
                # a created world. Fail setup if another caller consumes it first.
                page.evaluate("""seed=>{const original=crypto.getRandomValues;crypto.getRandomValues=function(buf){if(buf instanceof Uint32Array&&buf.length===1){crypto.getRandomValues=original;buf[0]=seed;return buf;}return original.call(this,buf);}}""",seed)
                page.locator(".sh-editor__start").click()
                until(page,"window.__afterlife.game.screen==='game' && window.__afterlife.game.renderer.loadProgress()>=1",timeout=180000)
                page.wait_for_load_state("networkidle")
                snap=page.evaluate(SNAPSHOT)
                snapshots.append(snap)
                retain(f"start-{run}-{seed}.json",snap)
                if snap["seed"]!=seed:
                    raise RuntimeError(f"Seed setup failed: requested {seed}, observed {snap['seed']}")
                check(f"seed {seed} retained in world",True,snap["seed"])
                page.screenshot(path=str(out/f"start-{run}-{seed}.png"))
                if run==0:
                    intro=page.locator(".hud-hint-bubble button",has_text="Let’s go")
                    if intro.is_visible(): intro.click()
                    page.locator(".hud-portrait").first.click()
                    page.evaluate("()=>window.__afterlife.game.setSpeed(1)")
                    lot=snap["lot"]
                    control={"x":math.floor(snap["actor"]["pos"]["x"])+4.5,"z":math.floor(snap["actor"]["pos"]["z"])+0.5}
                    passed,detail=walk(page,control,out,"on-lot-control")
                    check("positive control: on-lot UI walking",passed,detail)
                    if not passed:
                        raise RuntimeError("On-lot control failed; do not diagnose the world boundary from a broken input harness")
                    # Existing spatial dimensions are the home's bounds, not a future streamed-world API.
                    target={"x":lot["width"]/2+0.5,"z":lot["depth"]+3.5}
                    passed,detail=walk(page,target,out,"street")
                    check("home to street by continuous player movement",passed,detail)
                    for tag,target in (("left-boundary",{"x":-3.5,"z":lot["depth"]/2+0.5}),
                                       ("right-boundary",{"x":lot["width"]+3.5,"z":lot["depth"]/2+0.5}),
                                       ("rear-boundary",{"x":lot["width"]/2+0.5,"z":-3.5})):
                        passed,detail=walk(page,target,out,tag)
                        check(f"continuous travel across {tag}",passed,detail)
                    for name in ("street to neighbor interior and return","save/reload away from home preserves location and home edits"):
                        report["checks"].append({"name":name,"status":"Blocked","detail":"Requires successful street traversal plus W-025 destination/persistence contract; no at-home substitute counted."})
                ctx.close()
            browser.close()
        geometry=[digest({"lot":s["lot"],"objects":s["objects"]}) for s in snapshots]
        check("different seeds vary starting land/house geometry",geometry[0]!=geometry[1],geometry)
        check("same seed reproduces starting land/house geometry",geometry[0]==geometry[2],geometry)
        check("no browser errors",not report["errors"],report["errors"])
        check("trajectory negative controls",all(c["worked"] for c in report["guards"]),report["guards"])
    except Exception as error:
        report["setup"].append({"status":"Blocked","reason":str(error)})
    finally:
        server.shutdown()
        server.server_close()
        retain("report.json",report)
    if report["setup"]: return 2
    return 0 if all(c["status"]=="Worked" for c in report["checks"]) else 1


if __name__=="__main__":
    raise SystemExit(main())

"""Check the Python port against the original JavaScript engine in web/src/App.jsx."""

import itertools
import json
import math
import shutil
import subprocess
from dataclasses import asdict
from pathlib import Path

import pytest

from dc_efficiency import (
    best_cooling_upgrade,
    calculate,
    energy_star,
    leed_level,
    leed_score,
    tier_of,
    ups_efficiency,
    with_defaults,
)
from dc_efficiency.data import CI, CONTAIN, COOLING, DIST, FC_HRS, REDUN

HARNESS = Path(__file__).with_name("js_engine_harness.mjs")
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="Node.js not installed")


def _configs():
    cfgs = []
    # Every cooling x redundancy x distribution x containment combination.
    for cooling, redun, dist, cont in itertools.product(COOLING, REDUN, DIST, CONTAIN):
        cfgs.append(with_defaults(cooling=cooling, redun=redun, distribution=dist, containment=cont))
    # Every climate and grid region, at a range of setpoints and loads.
    for climate, setpoint, u in itertools.product(FC_HRS, (65, 72, 75, 80, 85), (10, 45, 100)):
        cfgs.append(with_defaults(climate=climate, setpoint=setpoint, u=u))
    for region in CI:
        cfgs.append(with_defaults(region=region))
    # Edge cases: clamped inputs, short operating years, dense racks.
    cfgs += [
        with_defaults(u=0),
        with_defaults(u=150),
        with_defaults(dL=0),
        with_defaults(hrs=2000, climate="Arctic", setpoint=85),
        with_defaults(rackKw=50, dL=12000, u=85, cooling="Direct Liquid (DLC)"),
        with_defaults(light=0, other=0, setpoint=68, containment="None"),
    ]
    return cfgs


@pytest.fixture(scope="module")
def js_results():
    cfgs = _configs()
    proc = subprocess.run(
        ["node", str(HARNESS)], input=json.dumps(cfgs), capture_output=True, text=True, check=True
    )
    return list(zip(cfgs, json.loads(proc.stdout)))


def _same(a, b, path=""):
    if isinstance(a, dict):
        assert set(a) <= set(b), f"{path}: missing keys {set(a) - set(b)}"
        for k in a:
            _same(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list):
        assert len(a) == len(b), path
        for i, (x, y) in enumerate(zip(a, b)):
            _same(x, y, f"{path}[{i}]")
    elif isinstance(a, float) or isinstance(b, float):
        assert math.isclose(a, b, rel_tol=1e-12, abs_tol=1e-9), f"{path}: {a} != {b}"
    else:
        assert a == b, f"{path}: {a!r} != {b!r}"


def test_calc_engine_matches_js(js_results):
    for cfg, js in js_results:
        py = asdict(calculate(cfg))
        js_res = {k: v for k, v in js["res"].items()}
        # The JS breakdown also carries chart colors; compare names and values only.
        js_res["brkdn"] = [{"name": b["name"], "value": b["value"]} for b in js_res["brkdn"]]
        _same(py, js_res, cfg["cooling"])


def test_ratings_match_js(js_results):
    for cfg, js in js_results:
        res = calculate(cfg)
        assert energy_star(res.pue) == js["energyStar"]
        leed = leed_score(res, cfg)
        _same(leed, js["leed"], "leed")
        assert leed_level(leed["total"]) == js["leedLevel"]
        tier = tier_of(cfg["redun"], cfg["distribution"])
        for key in ("tier", "roman", "short", "avail", "downtime", "name", "reqs", "next"):
            assert tier[key] == js["tier"][key], key


def test_roi_matches_js(js_results):
    for cfg, js in js_results:
        _same(best_cooling_upgrade(cfg), js["roi"], "roi")


def test_ups_curve_matches_js(js_results):
    loads = [5, 10, 17, 25, 33, 40, 55, 60, 70, 80, 95, 100, 120]
    _, js = js_results[0]
    _same([ups_efficiency(p) for p in loads], js["ups"], "ups")

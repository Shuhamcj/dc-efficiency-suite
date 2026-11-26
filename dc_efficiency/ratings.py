"""Ratings and checks built on the energy model.

Ports of tierOf(), energyStar(), leedScore(), leedLevel(), the ASHRAE A1
intake check and the cooling-retrofit ROI from web/src/App.jsx, plus a
side-by-side comparison of every cooling technology against a target PUE.
"""

from __future__ import annotations

from .data import (
    ASHRAE_A1_ALLOWABLE_MAX_F,
    ASHRAE_A1_RECOMMENDED_MAX_F,
    COOLING,
    TIERS,
)
from .engine import Results, calculate, js_round, with_defaults

# The best published hyperscaler PUE (Google and Meta, about 1.10).
HYPERSCALER_TARGET_PUE = 1.10


def tier_of(redun: str, dist: str) -> dict:
    """Uptime Institute tier implied by redundancy and distribution topology."""
    is_2n = redun.startswith("2N")
    is_n1 = redun.startswith("N+1")
    dual_active = dist == "Dual Active (2N)"
    dual = dist.startswith("Dual")
    if is_2n and dual_active:
        tier = 4
    elif is_n1 and dual:
        tier = 3
    elif is_n1:
        tier = 2
    else:
        tier = 1
    t = TIERS[tier]
    reqs = [
        {"label": "Redundant capacity components (N+1)", "met": is_n1 or is_2n},
        {"label": "Multiple distribution paths", "met": dual},
        {"label": "Concurrently maintainable (service without shutdown)", "met": (is_n1 or is_2n) and dual},
        {"label": "Fault tolerant (2N, survives single failure)", "met": is_2n and dual_active},
    ]
    nxt = {
        1: "add N+1 redundant capacity components",
        2: "add a second distribution path (concurrently maintainable)",
        3: "upgrade to 2N fault-tolerant dual-active topology",
        4: "",
    }[tier]
    return {"tier": tier, **t, "name": f"Tier {t['roman']} - {t['short']}", "reqs": reqs, "next": nxt}


_ES_PTS = [(1.0, 100), (1.1, 96), (1.2, 88), (1.3, 78), (1.4, 68), (1.5, 58), (1.7, 42), (2.0, 25), (2.5, 8)]


def energy_star(pue: float) -> int:
    """Approximate ENERGY STAR score (1-100) for a PUE. 75 or more is certifiable."""
    if pue <= _ES_PTS[0][0]:
        return 100
    if pue >= _ES_PTS[-1][0]:
        return _ES_PTS[-1][1]
    for i in range(1, len(_ES_PTS)):
        if pue <= _ES_PTS[i][0]:
            x0, y0 = _ES_PTS[i - 1]
            x1, y1 = _ES_PTS[i]
            return js_round(y0 + (y1 - y0) * (pue - x0) / (x1 - x0))
    return 50


def _clamp_round(x: float, hi: int) -> int:
    return max(0, min(hi, js_round(x)))


def leed_score(res: Results, cfg: dict) -> dict:
    """Simplified LEED v4 BD+C point estimate (88 points modeled)."""
    ea = _clamp_round(33 * (2.0 - res.pue) / 0.9, 33)
    we = _clamp_round(11 * (4.0 - res.wue) / 4.0, 11)
    ss = _clamp_round(10 * res.fcH / 6500, 10)
    ce = _clamp_round(20 * (0.7 - res.ci) / 0.7, 20)
    if cfg["cooling"] in ("Direct Liquid (DLC)", "Free Cooling"):
        inv = 6
    elif cfg["cooling"] == "Water-Cooled CRAH":
        inv = 3
    else:
        inv = 1
    mr = 8
    return {"ea": ea, "we": we, "ss": ss, "ce": ce, "inv": inv, "mr": mr,
            "total": ea + we + ss + ce + inv + mr}


def leed_level(points: int) -> str:
    if points >= 80:
        return "Platinum"
    if points >= 60:
        return "Gold"
    if points >= 50:
        return "Silver"
    if points >= 40:
        return "Certified"
    return "Not Yet Certified"


def ashrae_a1_status(intake_f: float) -> str:
    """Server intake temperature against the ASHRAE TC 9.9 class A1 envelope."""
    if intake_f > ASHRAE_A1_ALLOWABLE_MAX_F:
        return "exceeds A1 allowable (89.6 F)"
    if intake_f > ASHRAE_A1_RECOMMENDED_MAX_F:
        return "above A1 recommended (80.6 F)"
    return "within A1 recommended envelope"


def best_cooling_upgrade(cfg: dict | None = None, res: Results | None = None) -> dict:
    """The cooling retrofit with the largest annual energy-cost saving, and its payback.

    Returns save == 0 when no other cooling technology is cheaper to run.
    """
    cfg = with_defaults(cfg)
    res = res or calculate(cfg)
    best = {"name": "", "save": 0, "cpx": 0, "newPUE": 0, "pb": 99}
    for name, c in COOLING.items():
        if name == cfg["cooling"]:
            continue
        r2 = calculate({**cfg, "cooling": name})
        sav = res.cost - r2.cost
        if sav > 0 and sav > best["save"]:
            best = {"name": name, "save": sav, "cpx": c["cpx"] * res.it,
                    "newPUE": r2.pue, "pb": (c["cpx"] * res.it) / sav}
    return best


def compare_cooling(cfg: dict | None = None, target: float = HYPERSCALER_TARGET_PUE) -> list[dict]:
    """Run the same facility with each cooling technology and compare it to a target PUE."""
    cfg = with_defaults(cfg)
    rows = []
    for name, c in COOLING.items():
        r = calculate({**cfg, "cooling": name})
        rows.append({
            "cooling": name,
            "pue": r.pue,
            "annual_pue": r.aPUE,
            "gap_to_target": r.pue - target,
            "energy_mwh": r.annE,
            "co2_t": r.co2,
            "water_m3": r.water,
            "cost_usd": r.cost,
            "capex_usd": c["cpx"] * r.it,
            "energy_star": energy_star(r.pue),
        })
    return sorted(rows, key=lambda row: row["pue"])

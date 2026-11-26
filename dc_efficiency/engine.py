"""Facility energy model: PUE, annual energy, carbon, water and cost.

A line-for-line port of calcAll() and upsEff() in web/src/App.jsx.
The order of floating-point operations follows the JavaScript so both give
the same results (tests/test_parity_js.py checks this).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .data import (
    CI,
    CONTAIN,
    COOLING,
    DEFAULT_CONFIG,
    ENERGY_PRICE_PER_MWH,
    FC_HRS,
    REDUN,
    BENCH,
    UPS_PTS,
)


def js_round(x: float) -> int:
    """Math.round from JavaScript: halves round up, not to even."""
    return math.floor(x + 0.5)


def to_fixed(x: float, digits: int) -> float:
    """+x.toFixed(digits) from JavaScript."""
    return float(f"{x:.{digits}f}")


def ups_efficiency(load_pct: float) -> float:
    """Double-conversion UPS efficiency at a given load, by linear interpolation."""
    p = min(max(load_pct, 10), 100)
    for i in range(1, len(UPS_PTS)):
        if p <= UPS_PTS[i][0]:
            x0, y0 = UPS_PTS[i - 1]
            x1, y1 = UPS_PTS[i]
            return y0 + (y1 - y0) * (p - x0) / (x1 - x0)
    return 0.958


@dataclass
class Results:
    it: float  # actual IT load, kW
    dL: float  # design IT capacity, kW
    u: float  # utilization, %
    pue: float  # instantaneous PUE
    aPUE: float  # annual average PUE (with free-cooling hours)
    co2: float  # tonnes CO2 per year
    wue: float  # L/kWh
    annE: float  # MWh per year
    water: float  # m3 per year
    cost: float  # $ per year
    tot: float  # total facility power, kW
    cPwr: float  # cooling power, kW
    uLoss: float  # UPS loss, kW
    fxd: float  # lighting + other fixed loads after redundancy, kW
    ue: float  # UPS efficiency
    fcH: float  # free-cooling hours per year
    ci: float  # grid carbon intensity, kg/kWh
    setpoint: float
    hotAisleTemp: int
    effIntake: int
    numRacks: int
    deltaT: int
    brkdn: list = field(default_factory=list)
    lCurve: list = field(default_factory=list)
    proj: list = field(default_factory=list)
    bench: list = field(default_factory=list)


def with_defaults(cfg: dict | None = None, **overrides) -> dict:
    """Return a full configuration: the defaults, then cfg, then keyword overrides."""
    out = dict(DEFAULT_CONFIG)
    if cfg:
        out.update(cfg)
    out.update(overrides)
    return out


def calculate(cfg: dict | None = None) -> Results:
    """Run the facility model for one configuration (see data.DEFAULT_CONFIG)."""
    cfg = with_defaults(cfg)
    dL = max(cfg["dL"], 1)
    u = min(max(cfg["u"], 1), 100)
    it = dL * u / 100

    c = COOLING[cfg["cooling"]]
    rm = REDUN[cfg["redun"]]["m"]
    sp = cfg["setpoint"]
    cm = CONTAIN[cfg["containment"]]

    # Each 1 F above 72 F cuts cooling energy 2.5%, capped at 30%.
    sp_red = max(0, min((sp - 72) * 0.025, 0.30))

    # Cooling: 40% fixed, 60% proportional to load.
    fcp = dL * c["oh"]
    c_pwr = (fcp * 0.4 + fcp * 0.6 * (u / 100)) * rm * cm["m"] * (1 - sp_red)

    ue = ups_efficiency(u)
    u_loss = it * (1 - ue) * rm
    fxd = (cfg["light"] + cfg["other"]) * rm
    tot = it + c_pwr + u_loss + fxd
    pue = tot / it

    # Free cooling: each 1 F above 72 F adds 3.5% economizer hours.
    fc_bonus = 1 + max(0, sp - 72) * 0.035
    fc_h = min(FC_HRS[cfg["climate"]] * fc_bonus, cfg["hrs"])
    st_h = max(0, cfg["hrs"] - fc_h)

    # During free-cooling hours the cooling plant runs at 42% of its power.
    ann_e = (tot * st_h + (it + c_pwr * 0.42 + u_loss + fxd) * fc_h) / 1000
    a_pue = ann_e / max(it * cfg["hrs"] / 1000, 0.001)

    ci = CI[cfg["region"]]
    co2 = ann_e * ci
    wue = c["wue"]
    water = wue * (it * cfg["hrs"] / 1000)
    cost = ann_e * ENERGY_PRICE_PER_MWH

    delta_t = 20
    hot_aisle = js_round(sp + delta_t)
    eff_intake = js_round(sp + cm["recirc"])
    num_racks = max(1, math.ceil(it / cfg["rackKw"]))

    brkdn = [
        {"name": "IT Load", "value": js_round(it)},
        {"name": "Cooling", "value": js_round(c_pwr)},
        {"name": "UPS Loss", "value": js_round(u_loss)},
        {"name": "Lighting", "value": cfg["light"]},
        {"name": "Other", "value": cfg["other"]},
    ]

    l_curve = []
    for pct in (10, 25, 50, 75, 100):
        i2 = dL * pct / 100
        c2 = (fcp * 0.4 + fcp * 0.6 * (pct / 100)) * rm * cm["m"] * (1 - sp_red)
        u2 = i2 * (1 - ups_efficiency(pct)) * rm
        l_curve.append({"load": f"{pct}%", "PUE": to_fixed((i2 + c2 + u2 + fxd) / i2, 3)})

    proj = [
        {
            "year": str(2025 + i),
            "co2": js_round(co2 * math.pow(0.97, i)),
            "cost": js_round(cost * math.pow(1.03, i) / 1000),
        }
        for i in range(6)
    ]

    bench = [{"name": b["name"], "PUE": b["pue"]} for b in BENCH]
    bench.append({"name": "You", "PUE": to_fixed(pue, 2)})

    return Results(
        it=it, dL=dL, u=u, pue=pue, aPUE=a_pue, co2=co2, wue=wue, annE=ann_e,
        water=water, cost=cost, tot=tot, cPwr=c_pwr, uLoss=u_loss, fxd=fxd, ue=ue,
        fcH=fc_h, ci=ci, setpoint=sp, hotAisleTemp=hot_aisle, effIntake=eff_intake,
        numRacks=num_racks, deltaT=delta_t, brkdn=brkdn, lCurve=l_curve, proj=proj,
        bench=bench,
    )

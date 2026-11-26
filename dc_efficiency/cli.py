"""Command-line report: python -m dc_efficiency [options]."""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict

from .data import CI, CONTAIN, COOLING, DEFAULT_CONFIG, DIST, FC_HRS, REDUN
from .engine import calculate, with_defaults
from .ratings import (
    HYPERSCALER_TARGET_PUE,
    ashrae_a1_status,
    best_cooling_upgrade,
    compare_cooling,
    energy_star,
    leed_level,
    leed_score,
    tier_of,
)


def build_parser() -> argparse.ArgumentParser:
    d = DEFAULT_CONFIG
    p = argparse.ArgumentParser(
        prog="dc_efficiency",
        description="Model a data center's PUE, energy, carbon, water, cost, Uptime tier and ratings.",
    )
    p.add_argument("--capacity", type=float, default=d["dL"], help="design IT capacity, kW")
    p.add_argument("--util", type=float, default=d["u"], help="IT utilization, %%")
    p.add_argument("--cooling", choices=list(COOLING), default=d["cooling"])
    p.add_argument("--containment", choices=list(CONTAIN), default=d["containment"])
    p.add_argument("--setpoint", type=float, default=d["setpoint"], help="cold-aisle setpoint, F")
    p.add_argument("--redundancy", choices=list(REDUN), default=d["redun"])
    p.add_argument("--distribution", choices=list(DIST), default=d["distribution"])
    p.add_argument("--rack-kw", type=float, default=d["rackKw"], help="rack density, kW per rack")
    p.add_argument("--lighting", type=float, default=d["light"], help="lighting load, kW")
    p.add_argument("--other", type=float, default=d["other"], help="other fixed loads, kW")
    p.add_argument("--region", choices=list(CI), default=d["region"], help="grid region")
    p.add_argument("--climate", choices=list(FC_HRS), default=d["climate"])
    p.add_argument("--hours", type=float, default=d["hrs"], help="operating hours per year")
    p.add_argument("--compare", action="store_true",
                   help=f"compare all five cooling technologies against PUE {HYPERSCALER_TARGET_PUE}")
    p.add_argument("--json", action="store_true", help="print machine-readable JSON")
    return p


def config_from_args(a: argparse.Namespace) -> dict:
    return with_defaults({
        "dL": a.capacity, "u": a.util, "cooling": a.cooling, "containment": a.containment,
        "setpoint": a.setpoint, "redun": a.redundancy, "distribution": a.distribution,
        "rackKw": a.rack_kw, "light": a.lighting, "other": a.other, "region": a.region,
        "climate": a.climate, "hrs": a.hours,
    })


def report(cfg: dict) -> dict:
    res = calculate(cfg)
    leed = leed_score(res, cfg)
    return {
        "config": cfg,
        "results": asdict(res),
        "energy_star": energy_star(res.pue),
        "leed": {**leed, "level": leed_level(leed["total"])},
        "tier": tier_of(cfg["redun"], cfg["distribution"]),
        "ashrae_a1": ashrae_a1_status(res.effIntake),
        "best_upgrade": best_cooling_upgrade(cfg, res),
    }


def _rating(pue: float) -> str:
    return "Excellent" if pue < 1.2 else "Good" if pue < 1.5 else "Average" if pue < 2 else "Poor"


def format_report(rep: dict) -> str:
    cfg, r = rep["config"], rep["results"]
    t, leed, up = rep["tier"], rep["leed"], rep["best_upgrade"]
    lines = [
        "DC Efficiency Suite - facility report",
        "=" * 44,
        f"Facility    {cfg['dL']:,.0f} kW design, {cfg['u']:g}% utilized ({r['it']:,.0f} kW IT)",
        f"Cooling     {cfg['cooling']}, {cfg['containment']} containment, {cfg['setpoint']:g} F setpoint",
        f"Power       {cfg['redun']}, {cfg['distribution']}",
        f"Site        {cfg['region']} grid ({r['ci']} kg CO2/kWh), {cfg['climate']} climate",
        "",
        f"PUE (instant)      {r['pue']:.2f}  {_rating(r['pue'])}",
        f"PUE (annual)       {r['aPUE']:.2f}  with {r['fcH']:,.0f} free-cooling hrs",
        f"Total power        {r['tot']:,.0f} kW",
        f"Annual energy      {r['annE']:,.0f} MWh",
        f"Annual CO2         {r['co2']:,.0f} t",
        f"Annual water       {r['water']:,.0f} m3 (WUE {r['wue']} L/kWh)",
        f"Energy cost        ${r['cost']:,.0f}/yr",
        "",
        f"Uptime tier        {t['name']} ({t['avail']}, up to {t['downtime']} down)",
        f"ENERGY STAR        {rep['energy_star']}/100" + ("  certifiable" if rep["energy_star"] >= 75 else ""),
        f"LEED v4 estimate   {leed['total']} pts ({leed['level']})",
        f"Server intake      {r['effIntake']} F, {rep['ashrae_a1']}",
        f"Racks              {r['numRacks']} at {cfg['rackKw']:g} kW, hot aisle {r['hotAisleTemp']} F",
        "",
        "Partial-load PUE   " + "  ".join(f"{p['load']}: {p['PUE']:.3f}" for p in r["lCurve"]),
    ]
    if up["save"] > 0:
        lines += [
            "",
            f"Best cooling retrofit: {up['name']}",
            f"  new PUE {up['newPUE']:.2f}, saves ${up['save']:,.0f}/yr, "
            f"capex ${up['cpx']:,.0f}, payback {up['pb']:.1f} yrs",
        ]
    if t["next"]:
        lines += ["", f"Next tier: {t['next']}"]
    return "\n".join(lines)


def format_compare(rows: list[dict], target: float) -> str:
    head = f"{'Cooling':<22}{'PUE':>6}{'Gap':>7}{'MWh/yr':>9}{'CO2 t':>8}{'Water m3':>10}{'$K/yr':>8}{'E*':>5}"
    out = [f"Cooling technologies vs target PUE {target:.2f}", head, "-" * len(head)]
    for row in rows:
        out.append(
            f"{row['cooling']:<22}{row['pue']:>6.2f}{row['gap_to_target']:>+7.2f}"
            f"{row['energy_mwh']:>9,.0f}{row['co2_t']:>8,.0f}{row['water_m3']:>10,.0f}"
            f"{row['cost_usd'] / 1000:>8,.0f}{row['energy_star']:>5}"
        )
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cfg = config_from_args(args)
    if args.compare:
        rows = compare_cooling(cfg)
        print(json.dumps(rows, indent=2) if args.json else format_compare(rows, HYPERSCALER_TARGET_PUE))
    else:
        rep = report(cfg)
        print(json.dumps(rep, indent=2) if args.json else format_report(rep))
    return 0

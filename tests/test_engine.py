import math

import pytest

from dc_efficiency import (
    ashrae_a1_status,
    best_cooling_upgrade,
    calculate,
    compare_cooling,
    energy_star,
    leed_level,
    tier_of,
    ups_efficiency,
    with_defaults,
)
from dc_efficiency.engine import js_round


def test_default_facility_by_hand():
    # 1,000 kW hall at 70% -> 700 kW IT, air-cooled CRAC, N+1, cold aisle, 75 F.
    r = calculate()
    assert r.it == 700
    cooling = (350 * 0.4 + 350 * 0.6 * 0.7) * 1.14 * 1.00 * (1 - 0.075)
    ups_loss = 700 * (1 - 0.9615) * 1.14
    fixed = (8 + 12) * 1.14
    assert r.cPwr == pytest.approx(cooling)
    assert r.uLoss == pytest.approx(ups_loss)
    assert r.fxd == pytest.approx(fixed)
    assert r.pue == pytest.approx((700 + cooling + ups_loss + fixed) / 700)
    assert round(r.pue, 2) == 1.51
    assert r.cost == pytest.approx(r.annE * 80)
    assert r.co2 == pytest.approx(r.annE * 0.386)


def test_annual_pue_is_lower_than_instant_pue_with_free_cooling():
    r = calculate(with_defaults(climate="Cold"))
    assert r.fcH > 0
    assert r.aPUE < r.pue


def test_better_cooling_means_lower_pue():
    pues = {name: calculate(with_defaults(cooling=name)).pue for name in
            ("Air-Cooled CRAC", "Water-Cooled CRAH", "Evaporative", "Free Cooling", "Direct Liquid (DLC)")}
    assert pues["Direct Liquid (DLC)"] < pues["Free Cooling"] < pues["Evaporative"] \
        < pues["Water-Cooled CRAH"] < pues["Air-Cooled CRAC"]


def test_setpoint_saving_is_capped_at_30_percent():
    assert calculate(with_defaults(setpoint=84)).cPwr == pytest.approx(calculate(with_defaults(setpoint=85)).cPwr)
    assert calculate(with_defaults(setpoint=72)).cPwr > calculate(with_defaults(setpoint=80)).cPwr


def test_free_cooling_hours_never_exceed_operating_hours():
    r = calculate(with_defaults(climate="Arctic", setpoint=85, hrs=2000))
    assert r.fcH == 2000


def test_inputs_are_clamped():
    assert calculate(with_defaults(u=0)).u == 1
    assert calculate(with_defaults(u=150)).u == 100
    assert calculate(with_defaults(dL=0)).dL == 1


def test_low_utilization_raises_pue():
    curve = [p["PUE"] for p in calculate().lCurve]
    assert curve == sorted(curve, reverse=True)


def test_ups_curve():
    assert ups_efficiency(5) == 0.900
    assert ups_efficiency(80) == pytest.approx(0.963)
    assert ups_efficiency(70) == pytest.approx(0.9615)
    assert ups_efficiency(150) == pytest.approx(0.958)


def test_rack_count_rounds_up():
    assert calculate(with_defaults(dL=1000, u=70, rackKw=8)).numRacks == math.ceil(700 / 8)


@pytest.mark.parametrize("redun,dist,tier", [
    ("N (No Redundancy)", "Single Path", 1),
    ("N (No Redundancy)", "Dual Active (2N)", 1),
    ("N+1 (Standard)", "Single Path", 2),
    ("N+1 (Standard)", "Dual Path (1 Active)", 3),
    # Same as the original app: 2N without dual-active paths falls back to Tier I.
    # See "Known limitations" in the README.
    ("2N (Full Redundant)", "Dual Path (1 Active)", 1),
    ("2N (Full Redundant)", "Dual Active (2N)", 4),
])
def test_uptime_tier(redun, dist, tier):
    assert tier_of(redun, dist)["tier"] == tier


def test_energy_star_curve():
    assert energy_star(0.95) == 100
    assert energy_star(1.15) == 92
    assert energy_star(3.0) == 8
    assert energy_star(1.3) == 78


@pytest.mark.parametrize("points,level", [
    (39, "Not Yet Certified"), (40, "Certified"), (50, "Silver"), (60, "Gold"), (80, "Platinum"),
])
def test_leed_levels(points, level):
    assert leed_level(points) == level


def test_ashrae_a1_intake_check():
    assert ashrae_a1_status(77).startswith("within")
    assert ashrae_a1_status(82).startswith("above")
    assert ashrae_a1_status(92).startswith("exceeds")
    # No containment adds a 7 F recirculation penalty: 75 F supply -> 82 F intake.
    assert calculate(with_defaults(containment="None")).effIntake == 82


def test_cooling_retrofit_roi():
    up = best_cooling_upgrade()
    assert up["name"] == "Direct Liquid (DLC)"
    assert up["save"] > 0
    assert up["pb"] == pytest.approx(up["cpx"] / up["save"])
    # Already on the most efficient option: nothing to recommend.
    assert best_cooling_upgrade(with_defaults(cooling="Direct Liquid (DLC)"))["save"] == 0


def test_compare_cooling_is_sorted_best_first():
    rows = compare_cooling()
    assert len(rows) == 5
    assert [r["pue"] for r in rows] == sorted(r["pue"] for r in rows)
    assert rows[0]["cooling"] == "Direct Liquid (DLC)"


def test_js_round_matches_javascript():
    assert js_round(2.5) == 3
    assert js_round(-2.5) == -2
    assert js_round(0.49999) == 0

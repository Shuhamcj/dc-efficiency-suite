# DC Efficiency Suite

An interactive data center efficiency model. Set up a data hall (IT load, cooling plant, containment, setpoint, redundancy, power topology, climate and grid region) and it works out PUE, annual energy, carbon, water and cost. It also rates the design for Uptime Institute tier, ENERGY STAR and LEED, draws a hot/cold-aisle thermal floor plan, and finds the cooling retrofit with the best payback.

The repo has two parts that share one calculation model:

- **`web/`**: the React app (v4.0). It has a dashboard, a 2D floor plan, certification, scenario comparison and PDF report export.
- **`dc_efficiency/`**: a Python port of the same model, with a command-line report. A test runs the original JavaScript engine and checks that the Python gives the same numbers on 226 configurations.

## What it models

| Input | Options |
|---|---|
| Design IT capacity and utilization | kW, 10 to 100% |
| Cooling system | Air-cooled CRAC, water-cooled CRAH, free cooling, direct liquid cooling, evaporative |
| Aisle containment | None, cold aisle, hot aisle |
| Cold-aisle setpoint | 65 to 85 °F |
| Redundancy | N, N+1, 2N |
| Power distribution | Single path, dual path (one active), dual active |
| Rack density | kW per rack |
| Fixed loads | Lighting and other, kW |
| Grid region | 10 regions, IEA 2024-style carbon factors |
| Climate zone | Hot & humid, hot & dry, temperate, cold, arctic |

| Output | How it's found |
|---|---|
| Instant PUE | Total facility power ÷ IT power |
| Annual PUE | Splits the year into mechanical-cooling and free-cooling hours |
| Energy, CO2, water, cost | MWh/yr; grid carbon factor; WUE × IT energy; $80/MWh |
| UPS efficiency | Interpolated double-conversion UPS curve at the current load |
| Partial-load PUE curve | PUE at 10, 25, 50, 75 and 100% load |
| Uptime Institute tier | From redundancy and distribution topology, with the requirements met and the next step up |
| ENERGY STAR score | Approximate 1 to 100 score from PUE (75 or more is certifiable) |
| LEED v4 BD+C estimate | Points for energy, water, sites, carbon, innovation and materials |
| Server intake check | Supply setpoint plus recirculation, compared with the ASHRAE TC 9.9 class A1 envelope (80.6 °F recommended, 89.6 °F allowable) |
| Cooling retrofit ROI | Runs every other cooling system and picks the biggest saving, with capex and simple payback |
| Benchmark | Compared with published hyperscaler PUEs (Google and Meta 1.10, Microsoft 1.18, AWS 1.20, industry 1.58) |
| 5-year projection | Assumes CO2 falls 3% a year and energy cost rises 3% a year |

## Run the web app

Needs Node.js 18 or newer.

```bash
cd web
npm install
npm run dev
```

Then open the address Vite prints (usually http://localhost:5173). `npm run build` makes a static site in `web/dist`.

The **Insights** and **Ask AI** tabs call the Anthropic Messages API straight from the browser with no API key. That works only when the app runs as a Claude artifact. Anywhere else those two tabs show their error message, and everything else works as normal.

## Run the Python model

Needs Python 3.9 or newer, with no other packages.

```bash
python -m dc_efficiency                      # report for the default facility
python -m dc_efficiency --compare            # all five cooling systems vs PUE 1.10
python -m dc_efficiency --cooling "Free Cooling" --containment "Hot Aisle" \
    --setpoint 78 --climate Cold --redundancy "2N (Full Redundant)" \
    --distribution "Dual Active (2N)"
python -m dc_efficiency --json               # machine-readable output
python -m dc_efficiency --help               # every option
```

Or install it with `pip install -e .` and run `dc-efficiency`. From Python:

```python
from dc_efficiency import calculate, tier_of, best_cooling_upgrade, with_defaults

cfg = with_defaults(cooling="Direct Liquid (DLC)", u=85, dL=2000)
res = calculate(cfg)
print(round(res.pue, 2), round(res.annE), "MWh/yr")
```

## Sample output

Default facility: a 1,000 kW hall at 70% load with air-cooled CRAC units, cold-aisle containment, a 75 °F setpoint, N+1 redundancy, a temperate climate and the US average grid.

```text
$ python -m dc_efficiency
DC Efficiency Suite - facility report
============================================
Facility    1,000 kW design, 70% utilized (700 kW IT)
Cooling     Air-Cooled CRAC, Cold Aisle containment, 75 F setpoint
Power       N+1 (Standard), Dual Path (1 Active)
Site        US Average grid (0.386 kg CO2/kWh), Temperate climate

PUE (instant)      1.51  Average
PUE (annual)       1.40  with 3,868 free-cooling hrs
Total power        1,056 kW
Annual energy      8,573 MWh
Annual CO2         3,309 t
Annual water       0 m3 (WUE 0.0 L/kWh)
Energy cost        $685,850/yr

Uptime tier        Tier III - Concurrently Maintainable (99.982%, up to 1.6 hrs/yr down)
ENERGY STAR        57/100
LEED v4 estimate   53 pts (Silver)
Server intake      77 F, within A1 recommended envelope
Racks              88 at 8 kW, hot aisle 95 F

Partial-load PUE   10%: 3.040  25%: 1.989  50%: 1.614  75%: 1.492  100%: 1.440

Best cooling retrofit: Direct Liquid (DLC)
  new PUE 1.16, saves $126,225/yr, capex $1,260,000, payback 10.0 yrs

Next tier: upgrade to 2N fault-tolerant dual-active topology
```

```text
$ python -m dc_efficiency --compare
Cooling technologies vs target PUE 1.10
Cooling                  PUE    Gap   MWh/yr   CO2 t  Water m3   $K/yr   E*
---------------------------------------------------------------------------
Direct Liquid (DLC)     1.16  +0.06    6,995   2,700     1,840     560   91
Free Cooling            1.20  +0.10    7,164   2,765     3,066     573   88
Evaporative             1.26  +0.16    7,446   2,874    21,462     596   82
Water-Cooled CRAH       1.35  +0.25    7,841   3,026    11,038     627   73
Air-Cooled CRAC         1.51  +0.41    8,573   3,309         0     686   57
```

Moving the same hall to free cooling, hot-aisle containment, a 78 °F setpoint, a cold climate and 2N dual-active power brings PUE down to 1.21 instant and 1.16 annual, with Tier IV, ENERGY STAR 87 and LEED Gold (72 points).

## How the model works

- **Cooling power** = design load × cooling overhead (CRAC 35%, CRAH 22%, evaporative 15%, free cooling 10%, DLC 7%). 40% of it is fixed and 60% scales with utilization. It is then multiplied by the redundancy factor (N 1.00, N+1 1.14, 2N 1.32) and the containment factor (none 1.12, cold aisle 1.00, hot aisle 0.95).
- **Setpoint**: each °F above 72 °F cuts cooling energy by 2.5% (up to 30%) and adds 3.5% to free-cooling hours.
- **Free-cooling hours**: 800 to 6,500 a year by climate. During those hours the cooling plant runs at 42% of its power.
- **UPS loss** = IT load × (1 − UPS efficiency) × redundancy factor, from a double-conversion curve that peaks at 96.3% near 80% load.
- **Server intake** = setpoint + recirculation (none +7 °F, cold aisle +2 °F, hot aisle +0 °F). Hot aisle = setpoint + 20 °F server ΔT.
- **Tier**: N+1 = Tier II; N+1 with dual paths = Tier III; 2N with dual-active paths = Tier IV; anything else = Tier I.

The reference tables are in [`dc_efficiency/data.py`](dc_efficiency/data.py), the same values as the web app.

## Known limitations

This is a planning and teaching model, not a design tool.

- The intake check uses the ASHRAE TC 9.9 thermal guidelines (class A1). It doesn't do the ASHRAE 90.4 mechanical and electrical loss calculations (MLC/ELC), even though the dashboard gauge is labeled 90.4.
- The ENERGY STAR score and LEED points are simple curves fitted for this demo, not EPA Portfolio Manager or USGBC scoring. The materials credit is a fixed 8 points.
- 2N redundancy without dual-active distribution falls back to Tier I, because the tier rule only gives Tier II and III to N+1. The tests keep this behavior so the Python port matches the app.
- In the power breakdown, lighting and other loads are shown before the redundancy factor, although PUE includes it.
- Energy price is fixed at $80/MWh and retrofit capex is a flat $ per kW of IT load.
- Real PUE, tier and certification ratings need metered data, commissioning and accredited third-party review.

## Tests

```bash
pip install pytest
python -m pytest
```

- `tests/test_engine.py`: hand-checked values and behavior (setpoint cap, free-cooling cap, tier rules, ratings, ROI).
- `tests/test_cli.py`: the command-line report.
- `tests/test_parity_js.py`: loads the engine straight from `web/src/App.jsx` with Node.js and checks that the Python matches it on 226 configurations. It's skipped if Node.js isn't installed.

## Standards and sources referenced

ASHRAE TC 9.9 thermal guidelines; The Green Grid PUE and WUE metrics; the Uptime Institute Tier Standard; ENERGY STAR for Data Centers; LEED v4 BD+C; IEA 2024 grid emission factors; published hyperscaler PUE figures.

## License

MIT. See [LICENSE](LICENSE).

"""Reference tables used by the model.

These values are taken unchanged from the original React app
(web/src/App.jsx) so the Python port and the web app give the same numbers.
"""

# Grid carbon intensity, kg CO2 per kWh (IEA 2024-style regional factors).
CI = {
    "US Average": 0.386,
    "California": 0.210,
    "Texas": 0.420,
    "EU Average": 0.233,
    "Germany": 0.311,
    "France": 0.052,
    "UK": 0.233,
    "China": 0.555,
    "India": 0.708,
    "Australia": 0.656,
}

# Cooling technologies.
#   oh  = cooling power overhead as a fraction of design IT load
#   wue = water usage effectiveness, litres per kWh of IT energy
#   cpx = retrofit capital cost, $ per kW of IT load
COOLING = {
    "Air-Cooled CRAC": {"oh": 0.35, "wue": 0.0, "cpx": 400},
    "Water-Cooled CRAH": {"oh": 0.22, "wue": 1.8, "cpx": 700},
    "Free Cooling": {"oh": 0.10, "wue": 0.5, "cpx": 1100},
    "Direct Liquid (DLC)": {"oh": 0.07, "wue": 0.3, "cpx": 1800},
    "Evaporative": {"oh": 0.15, "wue": 3.5, "cpx": 500},
}

# Redundancy multiplier applied to cooling, UPS loss and fixed loads.
REDUN = {
    "N (No Redundancy)": {"m": 1.00, "desc": "No backup systems"},
    "N+1 (Standard)": {"m": 1.14, "desc": "One backup per system"},
    "2N (Full Redundant)": {"m": 1.32, "desc": "Complete parallel system"},
}

# Power distribution topology.
DIST = {"Single Path": 1, "Dual Path (1 Active)": 2, "Dual Active (2N)": 3}

# Economizer (free-cooling) hours per year by climate zone, at a 72 F setpoint.
FC_HRS = {
    "Hot & Humid": 800,
    "Hot & Dry": 1800,
    "Temperate": 3500,
    "Cold": 5200,
    "Arctic": 6500,
}

# Aisle containment: cooling multiplier and hot-air recirculation penalty (F).
CONTAIN = {
    "None": {"m": 1.12, "recirc": 7},
    "Cold Aisle": {"m": 1.00, "recirc": 2},
    "Hot Aisle": {"m": 0.95, "recirc": 0},
}

# Published hyperscaler PUE figures used for the benchmark chart.
BENCH = [
    {"name": "Google", "pue": 1.10},
    {"name": "Microsoft", "pue": 1.18},
    {"name": "AWS", "pue": 1.20},
    {"name": "Meta", "pue": 1.10},
    {"name": "Ind. Avg", "pue": 1.58},
]

# Double-conversion UPS efficiency curve: (load %, efficiency).
UPS_PTS = [(10, 0.900), (25, 0.925), (40, 0.950), (60, 0.960), (80, 0.963), (100, 0.958)]

# Uptime Institute tiers.
TIERS = {
    1: {"roman": "I", "short": "Basic Capacity", "avail": "99.671%", "downtime": "28.8 hrs/yr"},
    2: {"roman": "II", "short": "Redundant Components", "avail": "99.741%", "downtime": "22.0 hrs/yr"},
    3: {"roman": "III", "short": "Concurrently Maintainable", "avail": "99.982%", "downtime": "1.6 hrs/yr"},
    4: {"roman": "IV", "short": "Fault Tolerant", "avail": "99.995%", "downtime": "0.4 hrs/yr"},
}

# ASHRAE TC 9.9 class A1 server intake limits (F).
ASHRAE_A1_RECOMMENDED_MAX_F = 80.6
ASHRAE_A1_ALLOWABLE_MAX_F = 89.6

# Energy price used for cost figures, $ per MWh.
ENERGY_PRICE_PER_MWH = 80

# Default facility, the same as the web app's starting configuration.
DEFAULT_CONFIG = {
    "dL": 1000,  # design IT capacity, kW
    "u": 70,  # IT utilization, %
    "cooling": "Air-Cooled CRAC",
    "redun": "N+1 (Standard)",
    "distribution": "Dual Path (1 Active)",
    "light": 8,  # lighting, kW
    "other": 12,  # other fixed loads, kW
    "region": "US Average",
    "climate": "Temperate",
    "hrs": 8760,  # operating hours per year
    "setpoint": 75,  # cold-aisle supply setpoint, F
    "rackKw": 8,  # average rack density, kW per rack
    "containment": "Cold Aisle",
}

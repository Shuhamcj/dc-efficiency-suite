"""DC Efficiency Suite: a data center energy, carbon and resilience model."""

from .engine import Results, calculate, ups_efficiency, with_defaults
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

__version__ = "4.0.0"

__all__ = [
    "Results", "calculate", "ups_efficiency", "with_defaults", "HYPERSCALER_TARGET_PUE",
    "ashrae_a1_status", "best_cooling_upgrade", "compare_cooling", "energy_star",
    "leed_level", "leed_score", "tier_of",
]

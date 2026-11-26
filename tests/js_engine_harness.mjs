// Runs the calculation engine straight out of web/src/App.jsx so the Python
// port can be checked against the original JavaScript.
// Usage: node tests/js_engine_harness.mjs < configs.json > results.json
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "web", "src", "App.jsx"), "utf8");

// The data tables and pure functions sit between these two banners.
const start = src.indexOf("// ── Data");
const end = src.indexOf("// ── Gauge");
if (start < 0 || end < 0) throw new Error("engine section not found in App.jsx");
const engine = new Function(
  src.slice(start, end) +
    "\nreturn {calcAll, upsEff, tierOf, energyStar, leedScore, leedLevel, COOLING};"
)();

// The ROI calculation lives inside the component's useMemo; lift its body out.
const m = src.match(/const roi=useMemo\(\(\)=>\{([\s\S]*?)\},\[cfg,res\]\);/);
if (!m) throw new Error("ROI block not found in App.jsx");
const roiOf = new Function("cfg", "res", "COOLING", "calcAll", m[1]);

const configs = JSON.parse(readFileSync(0, "utf8"));
const out = configs.map((cfg) => {
  const res = engine.calcAll(cfg);
  const leed = engine.leedScore(res, cfg);
  return {
    res,
    energyStar: engine.energyStar(res.pue),
    leed,
    leedLevel: engine.leedLevel(leed.total).name,
    tier: engine.tierOf(cfg.redun, cfg.distribution),
    roi: roiOf(cfg, res, engine.COOLING, engine.calcAll),
    ups: [5, 10, 17, 25, 33, 40, 55, 60, 70, 80, 95, 100, 120].map(engine.upsEff),
  };
});
process.stdout.write(JSON.stringify(out));

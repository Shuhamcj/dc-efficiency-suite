import json

from dc_efficiency.cli import main


def test_text_report(capsys):
    assert main([]) == 0
    out = capsys.readouterr().out
    assert "PUE (instant)      1.51" in out
    assert "Tier III" in out


def test_json_report(capsys):
    assert main(["--json", "--cooling", "Free Cooling", "--climate", "Cold"]) == 0
    rep = json.loads(capsys.readouterr().out)
    assert rep["config"]["cooling"] == "Free Cooling"
    assert rep["results"]["aPUE"] < rep["results"]["pue"]


def test_compare_table(capsys):
    assert main(["--compare"]) == 0
    out = capsys.readouterr().out
    assert out.splitlines()[0] == "Cooling technologies vs target PUE 1.10"
    assert "Direct Liquid (DLC)" in out

"""Turn raw read-only captures from a real instance into a fake-server profile.

    python3 build_profile.py CAPTURE_DIR OUT.json --id ID --name FAKE_NAME [--pcm-from DIR]

CAPTURE_DIR holds one reply per file (GetInfo.xml, State.xml, GetModes.xml, ...),
as written by a read-only capture of `tools/probe/hqp.py`-style queries. Lists are
captured for the instance's *current* mode only; --pcm-from borrows PCM lists from
another capture (labelled as borrowed in the profile's provenance).

Sanitising: the instance name is replaced, `Status` metadata (stream URIs) is
dropped, and configuration names are replaced with generic ones. Run the
operator's preflight scanner on the output before committing it anyway.
"""
import argparse, json, re, sys
from pathlib import Path

def attrs(x):
    return dict(re.findall(r'(\w+)="([^"]*)"', x))

def items(x, tag):
    return [attrs(m) for m in re.findall(r"<%s ([^>]*)/>" % tag, x)]

def root_attrs(x, tag):
    m = re.search(r"<%s ([^>]*?)/?>" % tag, x)
    return attrs(m.group(1)) if m else {}

def read(d, k):
    return (Path(d) / f"{k}.xml").read_text()

def ints(rows, keys):
    return [{k: (int(v) if k in keys else v) for k, v in r.items()} for r in rows]

def mode_lists(d):
    return {
        "filters": ints(items(read(d, "GetFilters"), "FiltersItem"), {"index", "value", "arg"}),
        "shapers": ints(items(read(d, "GetShapers"), "ShapersItem"), {"index", "value"}),
        "rates": [int(r["rate"]) for r in items(read(d, "GetRates"), "RatesItem")],
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("capture"); ap.add_argument("out")
    ap.add_argument("--id", required=True); ap.add_argument("--name", required=True)
    ap.add_argument("--pcm-from")
    a = ap.parse_args()

    info = root_attrs(read(a.capture, "GetInfo"), "GetInfo")
    info["name"] = a.name
    state = root_attrs(read(a.capture, "State"), "State")
    modes = ints(items(read(a.capture, "GetModes"), "ModesItem"), {"index", "value"})
    vr = root_attrs(read(a.capture, "VolumeRange"), "VolumeRange")
    cfg_xml = read(a.capture, "ConfigurationList")
    cfg = items(cfg_xml, "ConfigurationItem")
    cfg_err = re.search(r'result="Error">([^<]*)<', cfg_xml)

    cur_mode = next(m for m in modes if m["index"] == int(state["mode"]))
    lists = {str(cur_mode["value"]): {**mode_lists(a.capture), "provenance": "measured"}}
    if a.pcm_from and "0" not in lists:
        lists["0"] = {**mode_lists(a.pcm_from),
                      "provenance": "borrowed from another instance's PCM capture"}

    raw_vol = state["volume"]
    profile = {
        "id": a.id,
        "info": info,
        "discover": {"version": f'{info["product"]} {info["version"]}'},
        # Desktop on macOS printed "-22"; on Linux "-28.00000000000000000" (measured).
        "volumeFormat": "long" if "." in raw_vol else "short",
        "volumeRange": {k: float(v) for k, v in vr.items()},
        "configurations": None if cfg_err else [f"Example configuration {i + 1}" for i in range(len(cfg))],
        "configurationListError": cfg_err.group(1) if cfg_err else None,
        "modes": modes,
        "lists": lists,
        "initial": {k: state[k] for k in ("mode", "rate", "filter1x", "filterNx", "shaper",
                                          "volume", "invert", "filter_20k", "adaptive", "state")},
        "activeRateWhenAuto": {str(cur_mode["value"]): int(state["active_rate"])},
    }
    Path(a.out).write_text(json.dumps(profile, indent=1) + "\n")
    print(f"wrote {a.out}: modes={[m['name'] for m in modes]} lists={list(lists)}", file=sys.stderr)

if __name__ == "__main__":
    main()

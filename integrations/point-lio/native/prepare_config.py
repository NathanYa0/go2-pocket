"""Combine upstream sensor YAML and launch parameters for native replay."""
import argparse
from pathlib import Path
import xml.etree.ElementTree as ET
import yaml


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("sensor", choices=["L1", "L2"])
    parser.add_argument("output", type=Path)
    parser.add_argument("--live", action="store_true", help="Bound path/map accumulation for streamed sessions")
    args = parser.parse_args()
    suffix = args.sensor.lower()
    config = yaml.safe_load((args.source / "config" / f"unilidar_{suffix}.yaml").read_text())
    launch = ET.parse(args.source / "launch" / f"mapping_unilidar_{suffix}.launch").getroot()
    for param in launch.findall("node/param"):
        kind, text = param.attrib["type"], param.attrib["value"]
        value = text in ["1", "true"] if kind == "bool" else int(text) if kind == "int" else float(text) if kind == "double" else text
        config[param.attrib["name"]] = value
    # Explicit bool replaces the upstream string 'enable'. Emit one pose per scan
    # for consumers; internal per-point estimation remains in the original core.
    config["odometry"]["publish_odometry_without_downsample"] = False
    config["native"] = {"max_seconds": 600}
    if args.live:
        config["publish"]["path_en"] = False
        config["pcd_save"]["interval"] = 100
        config["mapping"]["det_range"] = 30.0
        config["cube_side_length"] = 100.0
    args.output.write_text(yaml.safe_dump(config, sort_keys=False))


if __name__ == "__main__":
    main()

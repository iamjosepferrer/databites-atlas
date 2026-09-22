import os
import json
import geopandas as gpd

# Cloudflare static assets reject any single file above 25 MiB.
MAX_ASSET_BYTES = 25 * 1024 * 1024
COORD_PRECISION = 6  # ~0.1 m, visually identical to full precision

def _tidy(o):
    """Write whole floats as ints (16065.0 -> 16065). Same value in JS."""
    if isinstance(o, float) and o.is_integer():
        return int(o)
    if isinstance(o, dict):
        return {k: _tidy(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_tidy(v) for v in o]
    return o

def _check_size(path: str) -> None:
    size = os.path.getsize(path)
    if size > MAX_ASSET_BYTES:
        raise RuntimeError(
            f"{os.path.basename(path)} is {size / 1048576:.1f} MiB, "
            f"above Cloudflare's 25 MiB per-file limit. Split it or drop variables."
        )

def export_geo(levels: dict, output_dir: str) -> None:
    """
    Export geometry-only GeoJSON files for each level.
    These files contain NO variable data — just shape + ID columns.
    """
    os.makedirs(output_dir, exist_ok=True)

    id_cols = {
        "tracts":         ["CUSEC", "CUMUN", "CPRO", "NMUN"],
        "municipalities": ["CUMUN", "CPRO", "NMUN"],
        "provinces":      ["CPRO", "province_name"],
    }

    for level, gdf in levels.items():
        cols = ["geometry"] + id_cols[level]
        out = gdf[[c for c in cols if c in gdf.columns]]
        path = os.path.join(output_dir, f"{level}.geojson")
        out.to_file(path, driver="GeoJSON", COORDINATE_PRECISION=COORD_PRECISION)
        _check_size(path)
        size_kb = os.path.getsize(path) / 1000
        print(f"  [exported] {level}.geojson — {len(out):,} features · {size_kb:.0f} KB")

    # catalonia outline — single polygon for minimap
    catalonia = levels["provinces"].dissolve().reset_index()[["geometry"]]
    catalonia["geometry"] = catalonia["geometry"].simplify(0.005, preserve_topology=True)
    path = os.path.join(output_dir, "catalonia.geojson")
    catalonia.to_file(path, driver="GeoJSON", COORDINATE_PRECISION=COORD_PRECISION)
    print(f"  [exported] catalonia.geojson — outline only")

def export_data(data: dict, output_dir: str) -> None:
    """
    Export variable data as JSON lookup tables.
    One file per geographic level.
    """
    os.makedirs(output_dir, exist_ok=True)

    for level, lookup in data.items():
        path = os.path.join(output_dir, f"{level}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(_tidy(lookup), f, ensure_ascii=False, separators=(",", ":"))
        _check_size(path)
        size_kb = os.path.getsize(path) / 1000
        print(f"  [exported] {level}.json — {len(lookup):,} areas · {size_kb:.0f} KB")

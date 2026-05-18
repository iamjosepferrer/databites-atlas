import io
import pandas as pd
from .download import download


def parse_ine_atlas_renta(raw: bytes, province_codes: list) -> pd.DataFrame:
    """
    Parse INE Atlas de Renta CSV (table 30824 or similar).
    Format: Municipios;Distritos;Secciones;indicator;Periodo;Total

    Returns a DataFrame with columns: CUSEC | indicator | year | value
    """
    df = pd.read_csv(
        io.BytesIO(raw),
        sep=";",
        encoding="utf-8-sig",
        dtype=str
    )

    df.columns = ["municipio", "distrito", "seccion", "indicator", "year", "value"]

    df["CUSEC"] = df["seccion"].str.extract(r"^(\d{10})")
    df = df[df["CUSEC"].notna()].copy()
    df = df[df["CUSEC"].str[:2].isin(province_codes)].copy()

    df["year"] = pd.to_numeric(df["year"], errors="coerce").astype("Int64")

    df["value"] = df["value"].replace(".", None)
    df["value"] = df["value"].str.replace(",", ".", regex=False)
    df["value"] = pd.to_numeric(df["value"], errors="coerce")

    df = df[["CUSEC", "indicator", "year", "value"]].reset_index(drop=True)
    print(f"    [parsed] {len(df):,} rows for region tracts")
    return df


def _clean_censo_value(v):
    """Strip Spanish thousands separators and handle INE null marker '.'."""
    if pd.isna(v):
        return None
    s = str(v).strip()
    if s == ".":
        return None
    s = s.replace(".", "")   # remove thousands separator
    s = s.replace(",", ".")  # handle decimal comma just in case
    try:
        return float(s)
    except ValueError:
        return None


def parse_ine_censo_anual(raw: bytes, province_codes: list) -> pd.DataFrame:
    """
    Parse INE Censo Anual de Población CSV (tables 66670, 66672, 66718, etc.).
    Format: Provincias;Municipios;Secciones;[Sexo|País de nacimiento];indicator;Periodo;Total

    Column index 3 is always a breakdown dimension (Sexo or País de nacimiento).
    We keep only rows where that column == "Total" to avoid double-counting.
    Values are absolute counts -- ratios are computed in build_data.
    """
    df = pd.read_csv(
        io.BytesIO(raw),
        sep=";",
        encoding="utf-8-sig",
        dtype=str
    )

    # Rename positionally -- col 3 is always the breakdown filter
    df.columns = ["provincia", "municipio", "seccion", "breakdown", "indicator", "year", "value"]

    # Keep only "Total" breakdown
    df = df[df["breakdown"].str.strip() == "Total"].copy()

    # Extract 10-digit CUSEC
    df["CUSEC"] = df["seccion"].str.extract(r"^(\d{10})")
    df = df[df["CUSEC"].notna()].copy()

    # Filter to region provinces
    df = df[df["CUSEC"].str[:2].isin(province_codes)].copy()

    df["year"] = pd.to_numeric(df["year"], errors="coerce").astype("Int64")

    df["value"] = df["value"].apply(_clean_censo_value)
    df["value"] = pd.to_numeric(df["value"], errors="coerce")

    df = df[["CUSEC", "indicator", "year", "value"]].reset_index(drop=True)
    print(f"    [parsed] {len(df):,} rows for region tracts")
    return df


# ── Dispatcher ────────────────────────────────────────────────────────────

def parse_ine_atlas_renta_2dim(raw: bytes, province_codes: list) -> pd.DataFrame:
    """
    Parse INE Atlas de Renta CSV with Sexo + Nacionalidad breakdown.
    Format: Municipios;Distritos;Secciones;Sexo;Nacionalidad;indicator;Periodo;Total

    Keeps Sexo == Total and Nacionalidad == Española only.
    (Phase B: weight with Padrón population for true total)
    """
    df = pd.read_csv(
        io.BytesIO(raw),
        sep=";",
        encoding="utf-8-sig",
        dtype=str
    )

    df.columns = ["municipio", "distrito", "seccion", "dim1", "dim2", "indicator", "year", "value"]

    # Keep Sexo == Total, Nacionalidad == Española
    df = df[
        (df["dim1"].str.strip() == "Total") &
        (df["dim2"].str.strip() == "Española")
    ].copy()

    df["CUSEC"] = df["seccion"].str.extract(r"^(\d{10})")
    df = df[df["CUSEC"].notna()].copy()
    df = df[df["CUSEC"].str[:2].isin(province_codes)].copy()

    df["year"] = pd.to_numeric(df["year"], errors="coerce").astype("Int64")

    df["value"] = df["value"].replace(".", None)
    df["value"] = df["value"].str.replace(",", ".", regex=False)
    df["value"] = pd.to_numeric(df["value"], errors="coerce")

    df = df[["CUSEC", "indicator", "year", "value"]].reset_index(drop=True)
    print(f"    [parsed] {len(df):,} rows for region tracts")
    return df


def parse_ine_padron_gender(raw: bytes, province_codes: list) -> pd.DataFrame:
    """
    Parse Padrón Municipal table keeping Hombres + Total rows for % male computation.
    Renames: Sexo=Hombres → indicator="hombres", Sexo=Total → indicator="Total"
    """
    df = pd.read_csv(io.BytesIO(raw), sep=";", encoding="utf-8-sig", dtype=str)
    df.columns = ["provincia", "municipio", "seccion", "sexo", "indicator", "year", "value"]

    df = df[
        (df["indicator"].str.strip() == "Total") &
        (df["sexo"].str.strip().isin(["Hombres", "Total"]))
    ].copy()

    df["CUSEC"] = df["seccion"].str.extract(r"^(\d{10})")
    df = df[df["CUSEC"].notna()].copy()
    df = df[df["CUSEC"].str[:2].isin(province_codes)].copy()

    df["indicator"] = df["sexo"].str.strip().apply(
        lambda s: "hombres" if s == "Hombres" else "Total"
    )
    df["year"]  = pd.to_numeric(df["year"], errors="coerce").astype("Int64")
    df["value"] = df["value"].apply(_clean_censo_value)
    df["value"] = pd.to_numeric(df["value"], errors="coerce")

    df = df[["CUSEC", "indicator", "year", "value"]].reset_index(drop=True)
    print(f"    [parsed] {len(df):,} rows for region tracts")
    return df


PARSERS = {
    "ine_atlas_renta":      parse_ine_atlas_renta,
    "ine_atlas_renta_2dim": parse_ine_atlas_renta_2dim,
    "ine_censo_anual":      parse_ine_censo_anual,
    "ine_padron_gender":    parse_ine_padron_gender,
}


def build_data(gdf_levels: dict, cfg: dict, force: bool = False) -> dict:
    """
    Download each source once, extract all its variables, aggregate up.

    Returns:
      {
        "tracts":         { CUSEC:  { var_id: { year: value } } },
        "municipalities": { CUMUN:  { var_id: { year: value } } },
        "provinces":      { CPRO:   { var_id: { year: value } } },
      }
    """
    province_codes = cfg["region"]["province_codes"]
    sources        = cfg["sources"]

    # ── Step 1: download and parse each source ─────────────────────────────
    parsed = {}
    for source_id, source_cfg in sources.items():
        print(f"\n  [source] {source_cfg['label']}")
        source_type = source_cfg["type"]
        parser      = PARSERS.get(source_type)
        if not parser:
            raise ValueError(f"Unknown source type: {source_type}")

        # Support single url or list of urls (merged into one DataFrame)
        urls = source_cfg.get("urls") or [source_cfg["url"]]
        dfs  = []
        for i, url in enumerate(urls):
            label = f"{source_id}_{i}" if len(urls) > 1 else source_id
            raw   = download(url, label, force)
            dfs.append(parser(raw, province_codes))

        parsed[source_id] = pd.concat(dfs, ignore_index=True) if dfs else pd.DataFrame()

    # ── Step 2: extract each variable ─────────────────────────────────────
    tract_data = {}

    for source_id, source_cfg in sources.items():
        df = parsed[source_id]

        for var in source_cfg["variables"]:
            var_id   = var["id"]
            decimals = var.get("decimals", 2)

            if "ratio_numerator" in var:
                # ── Standard ratio ───────────────────────────────────────────
                num_ind = var["ratio_numerator"]
                den_ind = var.get("ratio_denominator", "Total")
                num_df = df[df["indicator"] == num_ind][["CUSEC", "year", "value"]].rename(columns={"value": "num"})
                den_df = df[df["indicator"] == den_ind][["CUSEC", "year", "value"]].rename(columns={"value": "den"})
                merged = num_df.merge(den_df, on=["CUSEC", "year"])
                merged = merged[merged["den"].notna() & (merged["den"] > 0) & merged["num"].notna()]
                merged["ratio"] = (merged["num"] / merged["den"] * 100).round(decimals)
                print(f"    [var] {var_id}: {len(merged):,} rows")
                for _, row in merged.iterrows():
                    cusec = row["CUSEC"]
                    year  = int(row["year"]) if pd.notna(row["year"]) else None
                    if year and pd.notna(row["ratio"]):
                        tract_data.setdefault(cusec, {}).setdefault(var_id, {})[year] = float(row["ratio"])

            elif "ratio_complement_numerator" in var:
                # ── Complement ratio: (den - num) / den × 100 ───────────────
                num_ind = var["ratio_complement_numerator"]
                den_ind = var.get("ratio_denominator", "Total")
                num_df = df[df["indicator"] == num_ind][["CUSEC", "year", "value"]].rename(columns={"value": "num"})
                den_df = df[df["indicator"] == den_ind][["CUSEC", "year", "value"]].rename(columns={"value": "den"})
                merged = num_df.merge(den_df, on=["CUSEC", "year"])
                merged = merged[merged["den"].notna() & (merged["den"] > 0) & merged["num"].notna()]
                merged["ratio"] = ((merged["den"] - merged["num"]) / merged["den"] * 100).round(decimals)
                print(f"    [var] {var_id}: {len(merged):,} rows")
                for _, row in merged.iterrows():
                    cusec = row["CUSEC"]
                    year  = int(row["year"]) if pd.notna(row["year"]) else None
                    if year and pd.notna(row["ratio"]):
                        tract_data.setdefault(cusec, {}).setdefault(var_id, {})[year] = float(row["ratio"])

            elif "ratio_sum_numerators" in var:
                # ── Sum-ratio: sum of multiple indicators / denominator × 100 ─
                num_inds = var["ratio_sum_numerators"]
                den_ind  = var.get("ratio_denominator", "Total")
                den_df   = df[df["indicator"] == den_ind][["CUSEC", "year", "value"]].rename(columns={"value": "den"})
                num_dfs  = [df[df["indicator"] == ind][["CUSEC", "year", "value"]].copy() for ind in num_inds]
                num_dfs  = [d for d in num_dfs if not d.empty]
                if num_dfs:
                    num_combined = pd.concat(num_dfs).groupby(["CUSEC", "year"], as_index=False)["value"].sum().rename(columns={"value": "num"})
                    merged = num_combined.merge(den_df, on=["CUSEC", "year"])
                    merged = merged[merged["den"].notna() & (merged["den"] > 0) & merged["num"].notna()]
                    merged["ratio"] = (merged["num"] / merged["den"] * 100).round(decimals)
                    print(f"    [var] {var_id}: {len(merged):,} rows")
                    for _, row in merged.iterrows():
                        cusec = row["CUSEC"]
                        year  = int(row["year"]) if pd.notna(row["year"]) else None
                        if year and pd.notna(row["ratio"]):
                            tract_data.setdefault(cusec, {}).setdefault(var_id, {})[year] = float(row["ratio"])
                else:
                    print(f"    [var] {var_id}: 0 rows")

            else:
                # ── Direct variable with configurable multiplier ─────────────
                indicator  = var["indicator"]
                multiplier = var.get("multiplier", 1)

                subset = df[df["indicator"] == indicator][["CUSEC", "year", "value"]]
                print(f"    [var] {var_id}: {len(subset):,} rows")

                for _, row in subset.iterrows():
                    cusec = row["CUSEC"]
                    year  = int(row["year"]) if pd.notna(row["year"]) else None
                    if pd.notna(row["value"]):
                        raw_value = float(row["value"]) * multiplier
                        value     = round(raw_value, decimals)
                        if year:
                            tract_data.setdefault(cusec, {}).setdefault(var_id, {})[year] = value

        # ── Pyramid bands ──────────────────────────────────────────────────
        pyramid_cfg = source_cfg.get("pyramid_bands")
        if pyramid_cfg:
            den_ind = pyramid_cfg["denominator"]
            den_df  = df[df["indicator"] == den_ind][["CUSEC", "year", "value"]].rename(columns={"value": "den"})
            for band in pyramid_cfg["bands"]:
                band_id  = band["id"]
                band_ind = band["indicator"]
                num_df   = df[df["indicator"] == band_ind][["CUSEC", "year", "value"]].rename(columns={"value": "num"})
                merged   = num_df.merge(den_df, on=["CUSEC", "year"])
                merged   = merged[merged["den"].notna() & (merged["den"] > 0) & merged["num"].notna()]
                merged["ratio"] = (merged["num"] / merged["den"] * 100).round(1)
                for _, row in merged.iterrows():
                    cusec = row["CUSEC"]
                    year  = int(row["year"]) if pd.notna(row["year"]) else None
                    if year and pd.notna(row["ratio"]):
                        tract_data.setdefault(cusec, {}).setdefault(band_id, {})[year] = float(row["ratio"])
            print(f"    [pyramid] {len(pyramid_cfg['bands'])} age bands stored")

    # ── Step 3: aggregate to municipality and province level ───────────────
    tracts_gdf     = gdf_levels["tracts"][["CUSEC", "CUMUN", "CPRO"]]
    cusec_to_cumun = dict(zip(tracts_gdf["CUSEC"], tracts_gdf["CUMUN"]))
    cusec_to_cpro  = dict(zip(tracts_gdf["CUSEC"], tracts_gdf["CPRO"]))

    mun_raw  = {}
    prov_raw = {}

    for cusec, vars_dict in tract_data.items():
        cumun = cusec_to_cumun.get(cusec)
        cpro  = cusec_to_cpro.get(cusec)
        for var_id, years_dict in vars_dict.items():
            for year, value in years_dict.items():
                if cumun:
                    mun_raw.setdefault(cumun, {}).setdefault(var_id, {}).setdefault(year, []).append(value)
                if cpro:
                    prov_raw.setdefault(cpro, {}).setdefault(var_id, {}).setdefault(year, []).append(value)

    # Variables that should be summed (not averaged) when aggregating up
    SUM_VARS = {"pop_total"}

    def _agg(vals, var_id):
        if not vals:
            return None
        if var_id in SUM_VARS:
            return round(sum(vals), 0)
        return round(sum(vals) / len(vals), 2)

    mun_data = {
        cumun: {var_id: {yr: _agg(vals, var_id) for yr, vals in yrs.items()} for var_id, yrs in vd.items()}
        for cumun, vd in mun_raw.items()
    }

    prov_data = {
        cpro: {var_id: {yr: _agg(vals, var_id) for yr, vals in yrs.items()} for var_id, yrs in vd.items()}
        for cpro, vd in prov_raw.items()
    }

    print(f"\n  [aggregated] {len(tract_data):,} tracts · "
          f"{len(mun_data):,} municipalities · "
          f"{len(prov_data):,} provinces")

    return {
        "tracts":         tract_data,
        "municipalities": mun_data,
        "provinces":      prov_data,
    }
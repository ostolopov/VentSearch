"""
Загрузка данных из CSV в таблицу products.
Поддерживаются английские заголовки (number, type, …) и русские колонки (как в data/ventsearch_massive_sorted.csv).
"""
import csv
import re
from pathlib import Path

def norm_header(h: str) -> str:
    if h is None:
        return ""
    s = str(h).replace("\ufeff", "").replace("\u00A0", " ").strip().lower()
    s = " ".join(s.split())
    s = s.replace("м³", "м3").replace("m³", "m3")
    return s


_HEADER_TO_CANONICAL = {
    norm_header("number"): "number",
    norm_header("Номер"): "number",
    norm_header("type"): "type",
    norm_header("Тип"): "type",
    norm_header("model"): "model",
    norm_header("Модель"): "model",
    norm_header("size"): "size",
    norm_header("Типоразмер"): "size",
    norm_header("diameter"): "diameter",
    norm_header("Диаметр ММ"): "diameter",
    norm_header("Диаметр"): "diameter",
    norm_header("efficiency"): "efficiency",
    norm_header("Производительность м3/ч"): "efficiency",
    norm_header("pressure"): "pressure",
    norm_header("Давление(па)"): "pressure",
    norm_header("Давление (па)"): "pressure",
    norm_header("power"): "power",
    norm_header("Мощность(ВТ)"): "power",
    norm_header("Мощность (ВТ)"): "power",
    norm_header("noise_level"): "noise_level",
    norm_header("Уровень шума"): "noise_level",
    norm_header("price"): "price",
    norm_header("Цена в рублях"): "price",
}


def _canonical_row(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        nk = norm_header(k)
        canon = _HEADER_TO_CANONICAL.get(nk)
        if canon:
            out[canon] = v
    return out


def normalize_whitespace(value) -> str:
    if value is None:
        return ""
    return " ".join(str(value).replace("\u00A0", " ").split())


def parse_number_loose(value):
    s = normalize_whitespace(value).replace(" ", "").replace(",", ".")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_range_loose(value):
    raw = normalize_whitespace(value)
    if not raw:
        return None, None, ""
    parts = [normalize_whitespace(p) for p in raw.split("-")]
    if len(parts) == 1:
        n = parse_number_loose(parts[0])
        return n, n, raw
    min_v = parse_number_loose(parts[0])
    max_v = parse_number_loose("-".join(parts[1:]))
    return min_v, max_v, raw


def slugify(value: str) -> str:
    s = normalize_whitespace(value).lower()
    s = re.sub(r"[^\w]+", "-", s, flags=re.UNICODE)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s


def load_csv_into_db(conn, csv_path: Path) -> int:
    """Читает CSV и вставляет строки в products. Возвращает количество вставленных строк."""
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV не найден: {csv_path}")

    with csv_path.open("r", encoding="utf-8") as f:
        sample = f.read(1024)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=";,")
        except csv.Error:
            dialect = csv.excel
            dialect.delimiter = ";"
        reader = csv.DictReader(f, dialect=dialect)

        inserted = 0
        seen_ids: set[str] = set()
        with conn.cursor() as cur:
            for i, row in enumerate(reader, start=1):
                row = _canonical_row(row)
                number = normalize_whitespace(row.get("number")) or str(i)
                row_id = number if number not in seen_ids else f"{number}-{i}"
                seen_ids.add(row_id)
                type_ = normalize_whitespace(row.get("type"))
                model = normalize_whitespace(row.get("model"))
                size = normalize_whitespace(row.get("size"))
                if not (type_ or model or size):
                    continue

                diameter = parse_number_loose(row.get("diameter"))
                af_min, af_max, af_raw = parse_range_loose(row.get("efficiency"))
                pr_min, pr_max, pr_raw = parse_range_loose(row.get("pressure"))
                power = parse_number_loose(row.get("power"))
                noise_level = parse_number_loose(row.get("noise_level"))
                price = parse_number_loose(row.get("price"))

                raw_diameter = normalize_whitespace(row.get("diameter"))
                raw_efficiency = normalize_whitespace(row.get("efficiency"))
                raw_pressure = normalize_whitespace(row.get("pressure"))
                raw_power = normalize_whitespace(row.get("power"))
                raw_noise_level = normalize_whitespace(row.get("noise_level"))
                raw_price = normalize_whitespace(row.get("price"))
                model_slug = slugify(model)

                cur.execute(
                    """
                    INSERT INTO products (
                        id, number, type, model, size, diameter,
                        airflow_min, airflow_max, airflow_raw,
                        pressure_min, pressure_max, pressure_raw,
                        power, noise_level, price,
                        raw_diameter, raw_efficiency, raw_pressure, raw_power, raw_noise_level, raw_price,
                        model_slug
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, %s, %s, %s, %s,
                        %s
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        number = EXCLUDED.number, type = EXCLUDED.type, model = EXCLUDED.model,
                        size = EXCLUDED.size, diameter = EXCLUDED.diameter,
                        airflow_min = EXCLUDED.airflow_min, airflow_max = EXCLUDED.airflow_max, airflow_raw = EXCLUDED.airflow_raw,
                        pressure_min = EXCLUDED.pressure_min, pressure_max = EXCLUDED.pressure_max, pressure_raw = EXCLUDED.pressure_raw,
                        power = EXCLUDED.power, noise_level = EXCLUDED.noise_level, price = EXCLUDED.price,
                        raw_diameter = EXCLUDED.raw_diameter, raw_efficiency = EXCLUDED.raw_efficiency,
                        raw_pressure = EXCLUDED.raw_pressure, raw_power = EXCLUDED.raw_power,
                        raw_noise_level = EXCLUDED.raw_noise_level, raw_price = EXCLUDED.raw_price,
                        model_slug = EXCLUDED.model_slug
                    """,
                    (
                        row_id, number, type_, model, size, diameter,
                        af_min, af_max, af_raw, pr_min, pr_max, pr_raw,
                        power, noise_level, price,
                        raw_diameter, raw_efficiency, raw_pressure, raw_power, raw_noise_level, raw_price,
                        model_slug,
                    ),
                )
                inserted += 1
        conn.commit()
        return inserted


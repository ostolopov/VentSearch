"""
Загрузка данных из CSV в таблицу products.

Поддерживаются английские заголовки (number, type, …) и русские колонки
(как в data/ventsearch_massive_sorted.csv). INSERT ... ON CONFLICT DO UPDATE.
"""
import csv
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class CsvLoadReport:
    """
    Итог загрузки CSV — для админ-панели: что реально произошло, а не только
    «успех/провал». Колонки, которых нет в _HEADER_TO_CANONICAL, не считаются
    ошибкой (это нормально для дополнительных заметок в файле), но админ должен
    их видеть — иначе непонятно, почему новые данные не отображаются на сайте.
    """

    encoding: str = ""
    total_data_rows: int = 0
    inserted: int = 0
    unrecognized_columns: list[str] = field(default_factory=list)
    skipped_rows: list[dict[str, Any]] = field(default_factory=list)
    error_rows: list[dict[str, Any]] = field(default_factory=list)

    _MAX_LISTED = 50

    def note_skip(self, row_number: int, reason: str, number: str = "") -> None:
        if len(self.skipped_rows) < self._MAX_LISTED:
            self.skipped_rows.append({"row": row_number, "reason": reason, "number": number})

    def note_error(self, row_number: int, error: str, number: str = "") -> None:
        if len(self.error_rows) < self._MAX_LISTED:
            self.error_rows.append({"row": row_number, "error": error, "number": number})


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
    # Каталоги ВО дают расход в м³/с — конвертируем в м³/ч при загрузке
    norm_header("Производительность м3/с"): "efficiency_m3s",
    norm_header("efficiency_m3s"): "efficiency_m3s",
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
    norm_header("rpm"): "nominal_rpm",
    norm_header("nominal_rpm"): "nominal_rpm",
    norm_header("pressure_coefficients"): "pressure_coefficients",
    norm_header("efficiency_coefficients"): "efficiency_coefficients",
}


def _canonical_row(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        nk = norm_header(k)
        canon = _HEADER_TO_CANONICAL.get(nk)
        if canon:
            out[canon] = v
    return out


# Габаритно-присоединительные размеры (чертёж корпуса/крепления электродвигателя) —
# в отличие от остальных колонок, регистр здесь смыслоразличающий (D ≠ d, L ≠ l,
# B ≠ b, D1 ≠ d1): обычная норм_header()-нормализация (lower()) свела бы их в
# один ключ и данные затирали бы друг друга. Поэтому берём эти колонки из
# ИСХОДНОЙ (не приведённой к нижнему регистру) строки по точному имени.
DIMENSION_COLUMNS: tuple[str, ...] = (
    "Num", "h ed", "D", "D1", "d", "n", "L", "L1 max", "L2", "l", "b", "d1", "B", "H1", "H",
)
_DIMENSION_COLUMNS_NORM = {norm_header(c) for c in DIMENSION_COLUMNS}


def _extract_dimensions(raw_row: dict) -> dict:
    out = {}
    for col in DIMENSION_COLUMNS:
        v = normalize_whitespace(raw_row.get(col))
        if v:
            out[col] = v
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


def parse_json_loose(value):
    raw = normalize_whitespace(value)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def _format_number_short(n: float) -> str:
    """Число без хвоста .0 — для пересобранного raw-текста диапазона."""
    return str(int(n)) if float(n).is_integer() else f"{n:g}"


def airflow_m3s_to_m3h(af_min, af_max):
    """
    Перевести диапазон расхода из м³/с в м³/ч (×3600) и собрать новый raw-текст.
    Возвращает (min, max, raw) — как parse_range_loose.
    """
    new_min = af_min * 3600.0 if af_min is not None else None
    new_max = af_max * 3600.0 if af_max is not None else None
    if new_min is not None and new_max is not None and new_min != new_max:
        raw = f"{_format_number_short(new_min)} - {_format_number_short(new_max)}"
    elif new_min is not None:
        raw = _format_number_short(new_min)
    else:
        raw = ""
    return new_min, new_max, raw


def load_csv_into_db(conn, csv_path: Path) -> CsvLoadReport:
    """Читает CSV и вставляет строки в products. Возвращает отчёт о загрузке
    (см. CsvLoadReport) — для отображения в админ-панели, не только число строк."""
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV не найден: {csv_path}")

    # Пробуем разные кодировки
    encodings = ['utf-8', 'cp1251', 'windows-1251', 'latin-1', 'cp866']
    file_content = None
    used_encoding = None

    for encoding in encodings:
        try:
            with csv_path.open("r", encoding=encoding) as f:
                # Пытаемся прочитать первые строки
                sample = f.read(1024)
                f.seek(0)
                # Если дошли сюда - кодировка подошла
                file_content = f
                used_encoding = encoding
                break
        except (UnicodeDecodeError, UnicodeError):
            continue

    if file_content is None or used_encoding is None:
        # Если ни одна кодировка не подошла, пробуем определить автоматически
        try:
            import chardet
            with csv_path.open("rb") as f:
                raw_data = f.read(10000)
                result = chardet.detect(raw_data)
                detected_encoding = result['encoding']
                if detected_encoding:
                    with csv_path.open("r", encoding=detected_encoding) as f:
                        file_content = f
                        used_encoding = detected_encoding
        except ImportError:
            # Если chardet не установлен, используем utf-8 с заменой
            with csv_path.open("r", encoding="utf-8", errors="replace") as f:
                file_content = f
                used_encoding = "utf-8"

    if file_content is None:
        raise ValueError(f"Не удалось определить кодировку файла {csv_path}")

    print(f"Используется кодировка: {used_encoding}")

    # Читаем файл с правильной кодировкой
    with csv_path.open("r", encoding=used_encoding) as f:
        sample = f.read(1024)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=";,")
        except csv.Error:
            dialect = csv.excel
            dialect.delimiter = ";"
        reader = csv.DictReader(f, dialect=dialect)

        report = CsvLoadReport(encoding=used_encoding)
        report.unrecognized_columns = sorted(
            h for h in (reader.fieldnames or [])
            if h and h not in DIMENSION_COLUMNS and not _HEADER_TO_CANONICAL.get(norm_header(h))
        )

        seen_ids: set[str] = set()
        with conn.cursor() as cur:
            for i, raw_row in enumerate(reader, start=1):
                report.total_data_rows = i
                row = _canonical_row(raw_row)
                dimensions = _extract_dimensions(raw_row)
                number = normalize_whitespace(row.get("number")) or str(i)
                type_ = normalize_whitespace(row.get("type"))
                model = normalize_whitespace(row.get("model"))
                size = normalize_whitespace(row.get("size"))
                if not (type_ or model or size):
                    report.note_skip(i, "нет ни типа, ни модели, ни типоразмера — строка пропущена", number)
                    continue
                row_id = number if number not in seen_ids else f"{number}-{i}"
                seen_ids.add(row_id)

                diameter = parse_number_loose(row.get("diameter"))
                if row.get("efficiency_m3s") is not None and normalize_whitespace(row.get("efficiency_m3s")):
                    m3s_min, m3s_max, _ = parse_range_loose(row.get("efficiency_m3s"))
                    af_min, af_max, af_raw = airflow_m3s_to_m3h(m3s_min, m3s_max)
                else:
                    af_min, af_max, af_raw = parse_range_loose(row.get("efficiency"))
                pr_min, pr_max, pr_raw = parse_range_loose(row.get("pressure"))
                power = parse_number_loose(row.get("power"))
                noise_level = parse_number_loose(row.get("noise_level"))
                price = parse_number_loose(row.get("price"))

                raw_diameter = normalize_whitespace(row.get("diameter"))
                raw_efficiency = normalize_whitespace(row.get("efficiency")) or normalize_whitespace(row.get("efficiency_m3s"))
                raw_pressure = normalize_whitespace(row.get("pressure"))
                raw_power = normalize_whitespace(row.get("power"))
                raw_noise_level = normalize_whitespace(row.get("noise_level"))
                raw_price = normalize_whitespace(row.get("price"))
                model_slug = slugify(model)

                nominal_rpm = parse_number_loose(row.get("nominal_rpm"))
                pressure_coefficients = parse_json_loose(row.get("pressure_coefficients"))
                efficiency_coefficients = parse_json_loose(row.get("efficiency_coefficients"))

                # Savepoint на строку: если конкретная строка ломает INSERT (например,
                # некорректные новые колонки дают значение не того типа), откатываем
                # только её — остальной каталог загружается, а не падает целиком.
                cur.execute("SAVEPOINT csv_row")
                try:
                    cur.execute(
                        """
                        INSERT INTO products (
                            id, number, type, model, size, diameter,
                            airflow_min, airflow_max, airflow_raw,
                            pressure_min, pressure_max, pressure_raw,
                            power, noise_level, price,
                            raw_diameter, raw_efficiency, raw_pressure, raw_power, raw_noise_level, raw_price,
                            model_slug, nominal_rpm, pressure_coefficients, efficiency_coefficients, dimensions
                        ) VALUES (
                            %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s, %s,
                            %s, %s, %s,
                            %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s
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
                            model_slug = EXCLUDED.model_slug,
                            nominal_rpm = EXCLUDED.nominal_rpm,
                            pressure_coefficients = EXCLUDED.pressure_coefficients,
                            efficiency_coefficients = EXCLUDED.efficiency_coefficients,
                            dimensions = EXCLUDED.dimensions
                        """,
                        (
                            row_id, number, type_, model, size, diameter,
                            af_min, af_max, af_raw, pr_min, pr_max, pr_raw,
                            power, noise_level, price,
                            raw_diameter, raw_efficiency, raw_pressure, raw_power, raw_noise_level, raw_price,
                            model_slug, nominal_rpm,
                            json.dumps(pressure_coefficients) if pressure_coefficients else None,
                            json.dumps(efficiency_coefficients) if efficiency_coefficients else None,
                            json.dumps(dimensions) if dimensions else None,
                        ),
                    )
                except Exception as exc:
                    cur.execute("ROLLBACK TO SAVEPOINT csv_row")
                    report.note_error(i, f"{type(exc).__name__}: {exc}", number)
                    continue
                else:
                    cur.execute("RELEASE SAVEPOINT csv_row")
                    report.inserted += 1
        conn.commit()
        return report
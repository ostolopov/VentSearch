"""
Тесты загрузчика CSV: нераспознанные колонки, пропущенные и упавшие строки.
Без реальной БД — фиктивный курсор, который либо просто пишет запись, либо
бросает исключение (эмулирует поломанную строку), но помнит SAVEPOINT/ROLLBACK.
"""
from __future__ import annotations

import io
from pathlib import Path

import pytest

from infrastructure.csv.loader import CsvLoadReport, load_csv_into_db, norm_header


class _FakeCursor:
    def __init__(self, fail_on_row_ids: set[str]):
        self.fail_on_row_ids = fail_on_row_ids
        self.inserted_ids: list[str] = []
        self.savepoints: list[str] = []

    def execute(self, sql: str, params=None):
        sql_stripped = sql.strip()
        if sql_stripped.startswith("SAVEPOINT"):
            self.savepoints.append("save")
            return
        if sql_stripped.startswith("ROLLBACK TO SAVEPOINT"):
            self.savepoints.append("rollback")
            return
        if sql_stripped.startswith("RELEASE SAVEPOINT"):
            self.savepoints.append("release")
            return
        if sql_stripped.startswith("INSERT INTO products"):
            row_id = params[0]
            if row_id in self.fail_on_row_ids:
                raise RuntimeError(f"simulated DB error for {row_id}")
            self.inserted_ids.append(row_id)
            return
        raise AssertionError(f"unexpected SQL: {sql_stripped[:50]}")

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeConn:
    def __init__(self, fail_on_row_ids: set[str] = frozenset()):
        self.cur = _FakeCursor(fail_on_row_ids)
        self.committed = False

    def cursor(self):
        return self.cur

    def commit(self):
        self.committed = True


CSV_HEADER = "Номер;Тип;Модель;Типоразмер;Диаметр ММ;Производительность м3/с;Давление(па);Мощность(ВТ);Уровень шума;Цена в рублях;nominal_rpm;pressure_coefficients;efficiency_coefficients"


def _write_csv(tmp_path: Path, body: str, header: str = CSV_HEADER) -> Path:
    p = tmp_path / "test.csv"
    p.write_text(header + "\n" + body, encoding="utf-8")
    return p


def test_norm_header_variants():
    assert norm_header("Номер") == norm_header(" номер ")
    assert norm_header("Производительность м³/с") == norm_header("Производительность м3/с")


def test_unrecognized_columns_detected(tmp_path):
    header = CSV_HEADER + ";Чертёж двигателя;Масса, кг"
    body = "V1;Осевой;ВО 13-284-4/15°-456A4;456A4;405;0.25 - 0.70;52 - 223;120;-;-;1370;-;-;drawing.dwg;12.5\n"
    path = _write_csv(tmp_path, body, header=header)

    conn = _FakeConn()
    report = load_csv_into_db(conn, path)

    assert report.unrecognized_columns == ["Масса, кг", "Чертёж двигателя"]
    assert report.inserted == 1
    assert conn.committed


def test_no_unrecognized_columns_for_plain_header(tmp_path):
    body = "V1;Осевой;ВО 13-284-4/15°-456A4;456A4;405;0.25 - 0.70;52 - 223;120;-;-;1370;-;-\n"
    path = _write_csv(tmp_path, body)

    conn = _FakeConn()
    report = load_csv_into_db(conn, path)
    assert report.unrecognized_columns == []
    assert report.inserted == 1


def test_row_missing_type_model_size_is_skipped(tmp_path):
    body = ";;;;;;;;;;;;\nV2;Осевой;ВО 13-284-4/20°-456A4;456A4;405;0.3 - 0.8;60 - 30;120;-;-;1370;-;-\n"
    path = _write_csv(tmp_path, body)

    conn = _FakeConn()
    report = load_csv_into_db(conn, path)

    assert report.total_data_rows == 2
    assert report.inserted == 1
    assert len(report.skipped_rows) == 1
    assert report.skipped_rows[0]["row"] == 1
    assert "нет ни типа" in report.skipped_rows[0]["reason"]


def test_row_that_breaks_insert_does_not_abort_whole_load(tmp_path):
    """
    Регрессия ровно под жалобу «после добавления новых данных сайт перестал
    читать файл»: одна плохая строка не должна откатывать уже загруженные —
    транзакция продолжается через SAVEPOINT/ROLLBACK TO SAVEPOINT.
    """
    body = (
        "VBAD;Осевой;ВО 13-284-4/15°-456A4;456A4;405;0.25 - 0.70;52 - 223;120;-;-;1370;-;-\n"
        "VGOOD;Осевой;ВО 13-284-4/20°-456A4;456A4;405;0.36 - 0.82;59 - 33;120;-;-;1370;-;-\n"
    )
    path = _write_csv(tmp_path, body)

    conn = _FakeConn(fail_on_row_ids={"VBAD"})
    report = load_csv_into_db(conn, path)

    assert report.inserted == 1
    assert conn.cur.inserted_ids == ["VGOOD"]
    assert len(report.error_rows) == 1
    assert report.error_rows[0]["number"] == "VBAD"
    assert "simulated DB error" in report.error_rows[0]["error"]
    # SAVEPOINT-протокол: save+rollback для плохой строки, save+release для хорошей
    assert conn.cur.savepoints == ["save", "rollback", "save", "release"]
    assert conn.committed


def test_report_caps_listed_rows_but_keeps_counting(tmp_path):
    report = CsvLoadReport()
    for i in range(100):
        report.note_skip(i, "test reason", f"num{i}")
    assert len(report.skipped_rows) == CsvLoadReport._MAX_LISTED

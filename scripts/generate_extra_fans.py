#!/usr/bin/env python3
"""
Дополняет data/ventsearch_massive_sorted.csv синтетическими строками
в том же формате (разделитель ;, заголовок не дублируется).
"""
from __future__ import annotations

import argparse
import random
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CSV_PATH = REPO / "data" / "ventsearch_massive_sorted.csv"

TYPES = ("ВКОП", "ВО", "ВР", "ВЦ", "УВО", "Ц")

# (ядро типоразмера без исполнения, диаметр мм)
CORES = (
    ("30-160-040", 400),
    ("30-160-050", 500),
    ("35-200-063", 630),
    ("40-250-080", 800),
    ("45-280-100", 900),
    ("50-315-125", 1000),
    ("56-355-140", 1120),
)

POWERS = (250, 370, 550, 750, 1100, 1500, 2200, 3000, 4000, 5500, 7500, 11000, 15000)


def fmt_price(n: int) -> str:
    return f"{n:,}".replace(",", " ")


def fmt_range(a: int, b: int) -> str:
    lo, hi = (a, b) if a <= b else (b, a)
    return f"{lo} - {hi}"


def generate_row(num: int, rng: random.Random) -> str:
    t = rng.choice(TYPES)
    core, d_mm = rng.choice(CORES)
    variant = rng.randint(1, 5)
    model = f"{t} {core}-{variant}"
    size = f"{t} {core}"

    # производительность м³/ч
    e1 = rng.randint(200, 4000)
    e2 = rng.randint(e1 + 500, e1 + 28000)
    eff = fmt_range(e1, e2)

    # давление Па
    p1 = rng.randint(40, 650)
    p2 = rng.randint(p1 + 50, p1 + 3200)
    pr = fmt_range(p1, p2)

    power = rng.choice(POWERS)
    noise = rng.randint(60, 110)

    base = rng.randint(45_000, 340_000)
    price = (base // 100) * 100

    parts = (
        str(num),
        t,
        model,
        size,
        str(d_mm),
        eff,
        pr,
        str(power),
        str(noise),
        fmt_price(price),
    )
    return ";".join(parts)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=10_000)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    rng = random.Random(args.seed)

    if not CSV_PATH.exists():
        raise SystemExit(f"Нет файла: {CSV_PATH}")

    text = CSV_PATH.read_text(encoding="utf-8")
    lines = text.rstrip("\n").split("\n")
    if not lines:
        raise SystemExit("Пустой CSV")
    last_data = lines[-1].split(";")
    try:
        last_num = int(last_data[0])
    except ValueError:
        last_num = 0

    start = last_num + 1
    new_lines = [generate_row(start + i, rng) for i in range(args.count)]

    out = text.rstrip("\n") + "\n" + "\n".join(new_lines) + "\n"
    CSV_PATH.write_text(out, encoding="utf-8")
    print(f"Добавлено {args.count} строк, номера {start}…{start + args.count - 1}")
    print(f"Файл: {CSV_PATH}")


if __name__ == "__main__":
    main()

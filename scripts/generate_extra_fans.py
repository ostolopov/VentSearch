#!/usr/bin/env python3
"""
Дополняет data/ventsearch_massive_sorted.csv синтетическими строками
в том же формате (разделитель ;, заголовок не дублируется).

Обновленная логика генерации для обеспечения >= 1000 уникальных моделей:
- Расширен пул CORES (32 типоразмера).
- Variant: 1..10.
- Добавлен суффикс исполнения (4 варианта).
Итого комбинаций: 6 * 32 * 10 * 4 = 7680.
"""
from __future__ import annotations
import argparse
import random
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CSV_PATH = REPO / "data" / "ventsearch_massive_sorted.csv"

TYPES = ("ВКОП", "ВО", "ВР", "ВЦ", "УВО", "Ц")

# Реальные типоразмеры (ядро + диаметр мм), характерные для заводов типа Вентмаш
# Формат: (строковое обозначение ядра/серии, диаметр рабочего колеса в мм)
CORES = (
    ("2.5-100-025", 250),
    ("3.0-125-032", 315),
    ("3.5-140-040", 400),
    ("4.0-160-050", 500),
    ("4.5-180-056", 560),
    ("5.0-200-063", 630),
    ("5.6-225-071", 710),
    ("6.3-250-080", 800),
    ("7.1-280-090", 900),
    ("8.0-315-100", 1000),
    ("9.0-355-112", 1120),
    ("10.0-400-125", 1250),
    ("11.2-450-140", 1400),
    ("12.5-500-160", 1600),
    ("14.0-560-180", 1800),
    ("16.0-630-200", 2000),
    ("18.0-710-224", 2240),
    ("20.0-800-250", 2500),
    # Дополнительные популярные серии для разнообразия
    ("ВР-80-300", 300),
    ("ВР-80-400", 400),
    ("ВР-80-500", 500),
    ("ВР-80-630", 630),
    ("ВР-80-800", 800),
    ("ВЦ-14-46-250", 250),
    ("ВЦ-14-46-315", 315),
    ("ВЦ-14-46-400", 400),
    ("ВЦ-14-46-500", 500),
    ("ВЦ-14-46-630", 630),
    ("ВЦ-14-46-800", 800),
    ("ВО-06-300", 300),
    ("ВО-06-400", 400),
    ("ВО-06-500", 500),
)

# Диапазоны мощностей (Вт)
POWERS = (120, 180, 250, 370, 550, 750, 1100, 1500, 2200, 3000, 4000, 5500, 7500, 11000, 15000, 22000)

# Суффиксы исполнения
EXECUTION_SUFFIXES = ["", "-К1", "-У2", "-К2"]

def fmt_price(n: int) -> str:
    return f"{n:,}".replace(",", " ")

def fmt_range(a: int, b: int) -> str:
    lo, hi = (a, b) if a <= b else (b, a)
    return f"{lo} - {hi}"

def generate_row(num: int, rng: random.Random) -> str:
    t = rng.choice(TYPES)
    core_str, d_mm = rng.choice(CORES)
    
    variant = rng.randint(1, 10)
    suffix = rng.choice(EXECUTION_SUFFIXES)
    
    # Формирование модели: Тип Ядро-Вариант Суффикс
    # Пример: ВР 5.0-200-063-7-У2
    model_base = f"{core_str}-{variant}"
    model = f"{model_base}{suffix}"
    
    # Размерность часто указывается без варианта и суффикса, только ядро
    size = f"{t} {core_str}"

    # Производительность м³/ч (зависит от диаметра, но для синтетики берем широкий диапазон)
    # Чем больше диаметр, тем выше производительность
    base_eff = d_mm * 5  # грубая привязка к диаметру
    e1 = rng.randint(max(100, base_eff - 500), base_eff + 1000)
    e2 = rng.randint(e1 + 200, e1 + 5000)
    eff = fmt_range(e1, e2)

    # Давление Па
    p1 = rng.randint(50, 800)
    p2 = rng.randint(p1 + 50, p1 + 4000)
    pr = fmt_range(p1, p2)

    power = rng.choice(POWERS)
    
    # Шум дБ
    noise = rng.randint(55, 115)

    # Цена (зависит от размера и мощности, но с рандомом)
    base_price = d_mm * 100 + power * 10
    # Добавляем разброс
    price = int(base_price * rng.uniform(0.8, 1.5))
    # Округляем до сотен
    price = (price // 100) * 100

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
    ap = argparse.ArgumentParser(description="Генератор дополнительных данных для вентиляторов")
    ap.add_argument("--count", type=int, default=5000, help="Количество добавляемых строк")
    ap.add_argument("--seed", type=int, default=42, help="Seed для генератора случайных чисел")
    args = ap.parse_args()

    rng = random.Random(args.seed)

    if not CSV_PATH.exists():
        raise SystemExit(f"Нет файла: {CSV_PATH}")

    text = CSV_PATH.read_text(encoding="utf-8")
    lines = text.rstrip("\n").split("\n")
    
    if not lines:
        raise SystemExit("Пустой CSV")

    # Определяем последний ID
    last_data = lines[-1].split(";")
    try:
        last_num = int(last_data[0])
    except ValueError:
        last_num = 0

    start = last_num + 1
    new_lines = [generate_row(start + i, rng) for i in range(args.count)]
    
    # Сборка итогового файла
    out = text.rstrip("\n") + "\n" + "\n".join(new_lines) + "\n"
    
    CSV_PATH.write_text(out, encoding="utf-8")
    print(f"Добавлено {args.count} строк, номера {start}…{start + args.count - 1}")
    print(f"Файл: {CSV_PATH}")
    print(f"Всего строк в файле: {len(lines) + args.count}")

if __name__ == "__main__":
    main()
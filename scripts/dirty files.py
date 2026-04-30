import random
import argparse
from pathlib import Path

# Константы из твоего примера[cite: 16]
TYPES = ("ВКОП", "ВО", "ВР", "ВЦ", "УВО", "Ц")
CORES = (("30-160-040", 400), ("30-160-050", 500), ("35-200-063", 630))
POWERS = (250, 370, 550, 750, 1100)


def make_it_dirty(value, rng):
    """Вносит случайную 'грязь' в значение."""
    dice = rng.random()

    if dice < 0.05: return ""  # Пропуск данных (пустая строка)
    if dice < 0.10: return str(value).lower()  # Смена регистра
    if dice < 0.12: return f"  {value}  "  # Лишние пробелы
    if dice < 0.14: return str(value).replace("0", "O").replace("3", "З")  # Опечатки (цифры на буквы)
    if dice < 0.16: return "NULL"  # Строковое значение NULL

    return str(value)


def generate_dirty_row(num, rng):
    t = rng.choice(TYPES)
    core, d_mm = rng.choice(CORES)
    model = f"{t} {core}-{rng.randint(1, 5)}"

    # Генерируем базовые значения
    raw_data = [
        num,
        t,
        model,
        f"{t} {core}",
        d_mm,
        f"{rng.randint(200, 1000)}-{rng.randint(1100, 5000)}",  # Диапазон
        rng.choice(POWERS),
        rng.randint(60, 110),
        f"{rng.randint(45000, 100000)} руб"  # Цена с текстом
    ]

    # Портим каждое значение
    dirty_data = [make_it_dirty(val, rng) for val in raw_data]

    # Иногда меняем разделитель с ';' на ',' или '.' случайным образом
    sep = ";"
    if rng.random() < 0.05: sep = random.choice([",", "\t", "|"])

    return sep.join(dirty_data)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=100)
    parser.add_argument("--output", type=str, default="dirty_ventdata.csv")
    args = parser.parse_args()
    rng = random.Random(42)

    header = "ID;Type;Model;Size;Diameter;Flow;Power;Noise;Price"
    rows = [header]

    for i in range(1, args.count + 1):
        rows.append(generate_dirty_row(i, rng))

    Path(args.output).write_text("\n".join(rows), encoding="utf-8")
    print(f"Создан файл с грязными данными: {args.output}")


if __name__ == "__main__":
    main()
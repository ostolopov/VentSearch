import random
import argparse
from pathlib import Path

# 1. ОПРЕДЕЛЕНИЕ ПУТЕЙ
# __file__ — это путь к текущему скрипту (scripts/script.py)
# .resolve().parent — это папка scripts/
# .parent — это корневая папка VentSearch/
ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"

# Константы для генерации
TYPES = ("ВКОП", "ВО", "ВР", "ВЦ", "УВО", "Ц")
CORES = (("30-160-040", 400), ("30-160-050", 500), ("35-200-063", 630))
POWERS = (250, 370, 550, 750, 1100)


def make_it_dirty(value, rng):
    dice = rng.random()
    if dice < 0.05: return ""
    if dice < 0.10: return str(value).lower()
    if dice < 0.12: return f"  {value}  "
    if dice < 0.14: return str(value).replace("0", "O").replace("3", "З")
    if dice < 0.16: return "NULL"
    return str(value)


def generate_dirty_row(num, rng):
    t = rng.choice(TYPES)
    core, d_mm = rng.choice(CORES)
    model = f"{t} {core}-{rng.randint(1, 5)}"

    raw_data = [
        num, t, model, f"{t} {core}", d_mm,
        f"{rng.randint(200, 1000)}-{rng.randint(1100, 5000)}",
        rng.choice(POWERS), rng.randint(60, 110),
        f"{rng.randint(45000, 100000)} руб"
    ]

    dirty_data = [make_it_dirty(val, rng) for val in raw_data]
    return ";".join(dirty_data)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=int(input()))
    parser.add_argument("--filename", type=str, default="dirty_ventdata_test_only.csv")
    args = parser.parse_args()
    rng = random.Random(42)

    # 2. ПРОВЕРКА И СОЗДАНИЕ ПАПКИ
    if not DATA_DIR.exists():
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        print(f"📁 Создана папка для данных: {DATA_DIR}")

    output_path = DATA_DIR / args.filename

    header = "ID;Type;Model;Size;Diameter;Flow;Power;Noise;Price"
    rows = [header]

    for i in range(2, args.count + 1):
        rows.append(generate_dirty_row(i, rng))

    content = "\n".join(rows)

    # Запись с использованием UTF-8 с BOM для Excel
    output_path.write_text(content, encoding="utf-8-sig")

    print(f"✅ Файл успешно сохранен по пути:")
    print(f"📍 {output_path}")


if __name__ == "__main__":
    main()
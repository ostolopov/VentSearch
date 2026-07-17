"""
Генерирует иконки сайта (favicon.ico, favicon-16x16.png, favicon-32x32.png,
apple-touch-icon.png) из ОДНОГО исходного изображения-шаблона.

Использование:
    pip install pillow
    python scripts/generate_favicons.py

По умолчанию источник — photos/favicon_template.png. Положите туда свой
логотип (квадратный, желательно от 512x512 и выше, PNG с прозрачным фоном)
и запустите скрипт — он пересоздаст все нужные файлы и размеры во
frontend/. Если photos/favicon_template.png отсутствует, скрипт возьмёт
photos/logo_no_text.png как временную заглушку.

Можно также указать свой файл явно:
    python scripts/generate_favicons.py путь/к/логотипу.png
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Нужна библиотека Pillow: pip install pillow", file=sys.stderr)
    raise SystemExit(1)

REPO_ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_PATH = REPO_ROOT / "photos" / "favicon_template.png"
FALLBACK_PATH = REPO_ROOT / "photos" / "logo_no_text.png"
FRONTEND_DIR = REPO_ROOT / "frontend"

# (имя_файла, размер_в_пикселях)
PNG_TARGETS = [
    ("favicon-16x16.png", 16),
    ("favicon-32x32.png", 32),
    ("apple-touch-icon.png", 180),
]
ICO_SIZES = [(16, 16), (32, 32)]


def _load_source(path: Path | None) -> Image.Image:
    if path is not None:
        if not path.exists():
            print(f"Файл не найден: {path}", file=sys.stderr)
            raise SystemExit(1)
        src = path
    elif TEMPLATE_PATH.exists():
        src = TEMPLATE_PATH
    elif FALLBACK_PATH.exists():
        print(f"photos/favicon_template.png не найден — временно использую {FALLBACK_PATH.name}")
        src = FALLBACK_PATH
    else:
        print(
            "Не найден ни photos/favicon_template.png, ни photos/logo_no_text.png.\n"
            "Положите квадратный логотип в photos/favicon_template.png и запустите скрипт снова.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    img = Image.open(src).convert("RGBA")
    if img.width != img.height:
        side = max(img.width, img.height)
        square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        square.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
        img = square
    return img


def generate(source: Path | None = None) -> None:
    img = _load_source(source)

    for filename, size in PNG_TARGETS:
        resized = img.resize((size, size), Image.LANCZOS)
        out_path = FRONTEND_DIR / filename
        resized.save(out_path, format="PNG")
        print(f"  {out_path.relative_to(REPO_ROOT)} ({size}x{size})")

    ico_path = FRONTEND_DIR / "favicon.ico"
    img.save(ico_path, format="ICO", sizes=ICO_SIZES)
    print(f"  {ico_path.relative_to(REPO_ROOT)} ({', '.join(f'{w}x{h}' for w, h in ICO_SIZES)})")

    print("\nГотово. В браузере иконка может закэшироваться надолго — "
          "проверяйте в режиме инкогнито или очистите данные сайта, если старая "
          "иконка не пропадает после обновления файлов.")


if __name__ == "__main__":
    arg_path = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    generate(arg_path)

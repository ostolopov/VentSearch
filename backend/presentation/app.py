"""
Фабрика FastAPI-приложения (Presentation Layer).

Настраивает middleware, регистрирует маршруты, монтирует статику,
управляет жизненным циклом БД и поискового индекса.
"""
import base64
import logging
import os
import re
import socket
import ipaddress
import traceback
from contextlib import asynccontextmanager
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

# Загрузить secrets/.env.local до любых импортов config.
# Путь: backend/presentation/app.py → backend/ → repo_root/ → secrets/.env.local
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(_REPO_ROOT / "secrets" / ".env.local")

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas
from starlette.exceptions import HTTPException as StarletteHTTPException

from config import CORS_ORIGINS, CSV_PATH, PORT
from infrastructure.db.connection import get_connection, put_connection, init_pool, close_pool
from infrastructure.db.init_db import init_db
from infrastructure.db.bootstrap_admin import ensure_default_admin
from infrastructure.db.product_repository import count_products, PgProductRepository
from infrastructure.csv.sync import sync_catalog_from_csv
from infrastructure.search.catalog_index import CatalogIndex, set_catalog_index

from presentation.api.schemas import (
    CatalogFacetsOut, ErrorOut, HealthOut,
    HTTPValidationErrorOut, PdfExportRequest,
    ProductListPageOut, ProductOut, QPPointOut,
)
from presentation.api.routes.catalog import router as catalog_router
from presentation.api.routes.auth import router as auth_router
from presentation.api.routes.admin import router as admin_router

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BACKEND_DIR.parent / "frontend"
PHOTOS_DIR = BACKEND_DIR.parent / "photos"

DB_POOL_MIN = int(os.environ.get("DB_POOL_MIN", "1"))
DB_POOL_MAX = int(os.environ.get("DB_POOL_MAX", "10"))


# ---------------------------------------------------------------------------
# Startup / shutdown
# ---------------------------------------------------------------------------

def _startup_db() -> None:
    from config import DATABASE_URL
    init_pool(DATABASE_URL, minconn=DB_POOL_MIN, maxconn=DB_POOL_MAX)
    import psycopg2
    conn = get_connection()
    try:
        # Smoke-test + log version
        with conn.cursor() as cur:
            cur.execute("SELECT version();")
            row = cur.fetchone()
        short = ((row[0] if row else "").strip().split(",")[0]) if row else "unknown"
        logger.info("PostgreSQL подключена: %s", short)

        init_db(conn)
        ensure_default_admin(conn)
        sync_catalog_from_csv(conn, CSV_PATH)
        try:
            set_catalog_index(CatalogIndex.build(conn))
        except Exception:
            logger.exception("Не удалось построить поисковый индекс (Bloom + числовые оси)")
            set_catalog_index(None)
    except psycopg2.OperationalError as e:
        err = str(e).lower()
        if "password" in err or "fe_sendauth" in err:
            logger.error(
                "PostgreSQL: нет пароля или неверные учётные данные. "
                "Укажите DATABASE_URL в secrets/.env.prod."
            )
        raise
    finally:
        put_connection(conn)


def _warn_insecure_defaults() -> None:
    """Громко предупредить, если секреты не изменены с дефолтных значений."""
    from config import ADMIN_PASSWORD, JWT_SECRET

    if JWT_SECRET == "change-me-in-production":
        logger.warning(
            "SECURITY: JWT_SECRET имеет значение по умолчанию — любой в сети "
            "может подделать токен. Задайте JWT_SECRET в secrets/.env.local (или .env.prod)."
        )
    if ADMIN_PASSWORD == "admin123":
        logger.warning(
            "SECURITY: пароль админа по умолчанию (admin123). "
            "Задайте ADMIN_PASSWORD в secrets/.env.local (или .env.prod)."
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    _warn_insecure_defaults()
    _startup_db()
    yield
    set_catalog_index(None)
    close_pool()
    logger.info("Соединения с PostgreSQL закрыты.")


# ---------------------------------------------------------------------------
# PDF helpers (Presentation Layer — UI-specific)
# ---------------------------------------------------------------------------

def _normalize_ws(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).replace("\u00A0", " ").split())


def _to_float(value: Any) -> Optional[float]:
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        return None


def _safe_pdf_filename(name: Optional[str]) -> str:
    base = _normalize_ws(name or "ventsearch-compare.pdf")
    if not base.lower().endswith(".pdf"):
        base = f"{base}.pdf"
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", base).strip("-")
    return cleaned or "ventsearch-compare.pdf"


def _extract_chart_png(data_url: Optional[str]) -> Optional[bytes]:
    if not data_url:
        return None
    raw = data_url.strip()
    if not raw.startswith("data:image/png;base64,"):
        return None
    try:
        return base64.b64decode(raw.split(",", 1)[1], validate=True)
    except Exception:
        return None


def _format_num(value: Any) -> str:
    num = _to_float(value)
    if num is None:
        return "—"
    if float(num).is_integer():
        return f"{int(num):,}".replace(",", " ")
    return f"{num:,.2f}".replace(",", " ").replace(".", ",")


def _pick_fonts() -> tuple[str, str]:
    candidates: list[tuple[Path, Path]] = [
        (BACKEND_DIR / "fonts" / "DejaVuSans.ttf", BACKEND_DIR / "fonts" / "DejaVuSans-Bold.ttf"),
    ]
    windir = os.environ.get("WINDIR") or os.environ.get("SystemRoot")
    if windir:
        wf = Path(windir) / "Fonts"
        candidates.extend([
            (wf / "arial.ttf", wf / "arialbd.ttf"),
            (wf / "segoeui.ttf", wf / "segoeuib.ttf"),
        ])
    candidates.extend([
        (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
         Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")),
        (Path("/Library/Fonts/Arial Unicode.ttf"), Path("/Library/Fonts/Arial Bold.ttf")),
        (Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
         Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")),
    ])
    for reg_path, bold_path in candidates:
        if not reg_path.exists():
            continue
        stem = reg_path.stem.replace(" ", "_")
        reg_name = f"VentPdfRegular-{stem}"
        bold_name = f"VentPdfBold-{bold_path.stem.replace(' ', '_')}" if bold_path.exists() else reg_name
        try:
            if reg_name not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(reg_name, str(reg_path)))
            if bold_path.exists() and bold_name not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(bold_name, str(bold_path)))
            return reg_name, bold_name
        except Exception:
            logger.warning("Не удалось зарегистрировать шрифт %s", reg_path, exc_info=True)
    return "Helvetica", "Helvetica-Bold"


# --- Фирменный бланк (шапка заказчика) --------------------------------------
# Шапка воссоздана «модульно»: логотип — картинка, реквизиты — живой текст
# с кликабельной ссылкой на сайт. Это чётче любого PNG при печати и легко
# правится здесь при смене реквизитов. Логотип: photos/ШАПКА_ЛОГО.png
# (вырезан из фирменного бланка); если файла нет, вырезаем логотип на лету
# из полного бланка photos/ШАПКА_ВЕНТМАШ.png (левая часть до текста).
LETTERHEAD_LOGO_FILENAME = "ШАПКА_ЛОГО.png"
LETTERHEAD_FULL_FILENAME = "ШАПКА_ВЕНТМАШ.png"
LETTERHEAD_ORG_FORM = "Общество с ограниченной ответственностью"
LETTERHEAD_ORG_NAME = "\"Завод Вентмаш\""
LETTERHEAD_ADDRESS = "141280, Московская обл., г. Ивантеевка, Заречная ул., д. 1"
LETTERHEAD_PHONE = "Тел./факс: (+7 495) 662-30-42, 258-52-24 (многокан.)"
LETTERHEAD_SITE_TEXT = "www.завод-вентмаш.рф"
LETTERHEAD_SITE_URL = "http://www.завод-вентмаш.рф"
LETTERHEAD_EMAIL = "info@moventa.ru"
LETTERHEAD_INN_KPP = "ИНН\\КПП 5038093500\\503801001"


def _ascii_url(url: str) -> str:
    """URL с кириллическим доменом → ASCII (punycode) для PDF-аннотации:
    формат PDF требует ASCII в /URI, иначе часть просмотрщиков не откроет."""
    try:
        from urllib.parse import urlsplit, urlunsplit
        parts = urlsplit(url)
        host = parts.hostname or ""
        ascii_host = host.encode("idna").decode("ascii")
        netloc = ascii_host if not parts.port else f"{ascii_host}:{parts.port}"
        return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
    except Exception:
        return url


def _autocrop_whitespace(pil_img, pad_px: int = 10, threshold: int = 248, rule_row_frac: float = 0.85):
    """Обрезает пустые белые поля вокруг реального содержимого (лого,
    текст реквизитов). Готовые бланки обычно экспортируются с большими
    отступами — если растянуть такую картинку на всю ширину страницы
    «как есть», масштаб (мм на пиксель) определяется шириной картинки:
    чем больше в ней пустых полей по бокам, тем мельче выходит сам текст.

    Сплошные полноширинные декоративные линии (двойная черта под шапкой)
    из расчёта левой/правой границы исключаются намеренно — иначе такая
    линия одна тянет рамку обрезки на всю ширину картинки, и обрезки
    по бокам не происходит вовсе."""
    from PIL import Image as _Image
    if pil_img.mode in ("RGBA", "LA") or (pil_img.mode == "P" and "transparency" in pil_img.info):
        rgba = pil_img.convert("RGBA")
        rgb = _Image.new("RGB", pil_img.size, (255, 255, 255))
        rgb.paste(rgba, mask=rgba.split()[-1])
    else:
        rgb = pil_img.convert("RGB")
    w, h = rgb.size

    # Анализ на уменьшенной копии: при «высоком разрешении» (сканы,
    # экспорт из Word) построчный/поколоночный разбор в чистом Python на
    # полном изображении был бы медленным. Рамку считаем на копии, потом
    # масштабируем координаты обратно на оригинал.
    analysis_max = 700
    scale = min(1.0, analysis_max / max(w, h))
    aw, ah = max(1, round(w * scale)), max(1, round(h * scale))
    analysis = rgb.resize((aw, ah), _Image.BILINEAR) if scale < 1.0 else rgb

    mask = analysis.convert("L").point(lambda p: 1 if p < threshold else 0)
    rows = [list(mask.crop((0, y, aw, y + 1)).getdata()) for y in range(ah)]

    top = bottom = None
    for y, row in enumerate(rows):
        if any(row):
            if top is None:
                top = y
            bottom = y

    content_rows = [row for row in rows if (sum(row) / aw) < rule_row_frac]
    left = right = None
    if content_rows:
        for x in range(aw):
            if any(row[x] for row in content_rows):
                if left is None:
                    left = x
                right = x

    if top is None or left is None:
        return rgb
    inv = 1.0 / scale
    l = max(0, round(left * inv) - pad_px)
    t = max(0, round(top * inv) - pad_px)
    r = min(w, round((right + 1) * inv) + pad_px)
    b = min(h, round((bottom + 1) * inv) + pad_px)
    return rgb.crop((l, t, r, b))


def _load_letterhead_logo_reader() -> Optional["ImageReader"]:
    """Логотип для модульной шапки: сначала готовый photos/ШАПКА_ЛОГО.png,
    иначе вырезаем левую (логотипную) часть из полного бланка
    photos/ШАПКА_ВЕНТМАШ.png и автообрезаем поля. Нет ни того ни другого —
    шапка печатается без логотипа, только текстом."""
    ready = PHOTOS_DIR / LETTERHEAD_LOGO_FILENAME
    if ready.is_file():
        try:
            return ImageReader(str(ready))
        except Exception:
            pass
    full = PHOTOS_DIR / LETTERHEAD_FULL_FILENAME
    if full.is_file():
        try:
            from PIL import Image as _Image
            with _Image.open(full) as im:
                rgb = im.convert("RGB")
                left_part = rgb.crop((0, 0, max(1, int(rgb.width * 0.34)), rgb.height))
                cropped = _autocrop_whitespace(left_part)
                out = BytesIO()
                cropped.save(out, format="PNG")
                out.seek(0)
                return ImageReader(out)
        except Exception:
            pass
    return None

# Фото по типу вентилятора — та же карта, что FAN_IMAGES_BY_TYPE на фронтенде
_PDF_PHOTO_BY_TYPE = {
    "ВКОП": "vkop.jpeg", "ВО": "vo.jpeg", "ВР": "vr.jpeg", "ВЦ": "vc.jpeg",
    "УВО": "uvo.jpeg", "Ц": "c.jpeg", "ОСЕВОЙ": "vo.jpeg",
}

_BLUEPRINT_PDF_EXTENSIONS = ("png", "jpg", "jpeg", "webp")


def _pdf_slugify(value: str) -> str:
    """Тот же слаг, что slugify() на фронтенде — для поиска blueprint_<слаг>.*"""
    s = re.sub(r"\s+", "-", str(value or "").lower())
    s = re.sub(r"[^\wа-яё-]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s


def _find_product_photo(product: dict[str, Any]) -> Optional[Path]:
    type_key = re.sub(r"\s+", "", str(product.get("type") or "")).upper()
    name = _PDF_PHOTO_BY_TYPE.get(type_key)
    if not name:
        return None
    path = PHOTOS_DIR / name
    return path if path.is_file() else None


def _find_blueprint_variant(product: dict[str, Any], base: str) -> Optional[Path]:
    """Ищет photos/<base>_<slug>.<ext>, затем общий photos/<base>.<ext>."""
    meta = product.get("_meta") or product.get("meta") or {}
    slug = str(meta.get("model_slug") or "").strip().lower() or _pdf_slugify(product.get("model") or "")
    names: list[str] = []
    if slug:
        names += [f"{base}_{slug}.{ext}" for ext in _BLUEPRINT_PDF_EXTENSIONS]
    names += [f"{base}.{ext}" for ext in _BLUEPRINT_PDF_EXTENSIONS]
    for name in names:
        path = PHOTOS_DIR / name
        if path.is_file():
            return path
    return None


def _find_product_blueprint(product: dict[str, Any]) -> Optional[Path]:
    return _find_blueprint_variant(product, "blueprint")


def _build_compare_pdf(
    products: list[dict[str, Any]],
    chart_png: Optional[bytes] = None,
    header_text: Optional[str] = None,
    watermark_path: Optional[Path] = None,
    letterhead: bool = False,
    letterhead_all_pages: bool = False,
    show_title: bool = True,
) -> bytes:
    buf = BytesIO()
    pdf = rl_canvas.Canvas(buf, pagesize=A4)
    page_w, page_h = A4
    left = 14 * mm
    right = page_w - 14 * mm
    width = right - left
    font_r, font_b = _pick_fonts()

    c_primary = colors.HexColor("#027bf3")
    c_surface = colors.HexColor("#f6f8fa")
    c_border = colors.HexColor("#e2e5e9")
    c_text = colors.HexColor("#111111")
    c_muted = colors.HexColor("#55595d")
    c_link = colors.HexColor("#0b0080")

    # --- Фирменный бланк: модульная копия оригинала --------------------------
    # Логотип картинкой слева, реквизиты — живым текстом по центру остальной
    # ширины, сайт — кликабельная ссылка, снизу двойная линия во всю ширину.
    lh_logo_reader = _load_letterhead_logo_reader() if letterhead else None
    LH_TOP_PAD = 11 * mm       # от верхнего края листа до шапки
    LH_LOGO_H = 26 * mm        # высота логотипа
    LH_TEXT_H = 33.5 * mm      # высота текстового блока (6 строк с интервалами)
    LH_RULE_GAP = 3 * mm       # зазор между блоком и двойной линией
    LH_BOTTOM_PAD = 5.5 * mm   # от линии до начала содержимого страницы
    lh_block_h = max(LH_LOGO_H if lh_logo_reader else 0, LH_TEXT_H)
    lh_total_h = LH_TOP_PAD + lh_block_h + LH_RULE_GAP + 2.6 * mm + LH_BOTTOM_PAD

    def draw_letterhead():
        if not letterhead:
            return
        top = page_h - LH_TOP_PAD
        logo_w = 0.0
        if lh_logo_reader:
            try:
                liw, lih = lh_logo_reader.getSize()
                logo_w = LH_LOGO_H * liw / lih
                pdf.drawImage(
                    lh_logo_reader, left, top - LH_LOGO_H,
                    width=logo_w, height=LH_LOGO_H,
                    preserveAspectRatio=True, mask="auto",
                )
            except Exception:
                logo_w = 0.0
        tx0 = left + (logo_w + 6 * mm if logo_w else 0)
        cx = tx0 + (right - tx0) / 2
        ty = top - 4.6 * mm
        pdf.setFillColor(c_text)
        pdf.setFont(font_b, 10.5)
        pdf.drawCentredString(cx, ty, LETTERHEAD_ORG_FORM)
        ty -= 8.6 * mm
        pdf.setFont(font_b, 19)
        pdf.drawCentredString(cx, ty, LETTERHEAD_ORG_NAME)
        ty -= 6.8 * mm
        pdf.setFont(font_b, 9)
        pdf.drawCentredString(cx, ty, LETTERHEAD_ADDRESS)
        ty -= 4.5 * mm
        pdf.drawCentredString(cx, ty, LETTERHEAD_PHONE)
        ty -= 4.5 * mm
        # Сайт (синим, с подчёркиванием и ссылкой) + e-mail в одну строку
        site = LETTERHEAD_SITE_TEXT
        email_txt = f"e-mail: {LETTERHEAD_EMAIL}"
        gap = 9 * mm
        w_site = pdf.stringWidth(site, font_b, 9)
        w_email = pdf.stringWidth(email_txt, font_b, 9)
        sx = cx - (w_site + gap + w_email) / 2
        pdf.setFillColor(c_link)
        pdf.drawString(sx, ty, site)
        pdf.setStrokeColor(c_link)
        pdf.setLineWidth(0.6)
        pdf.line(sx, ty - 1.2, sx + w_site, ty - 1.2)
        pdf.linkURL(
            _ascii_url(LETTERHEAD_SITE_URL),
            (sx - 1, ty - 2.5, sx + w_site + 1, ty + 8.5),
            relative=0, thickness=0,
        )
        pdf.setFillColor(c_text)
        ex = sx + w_site + gap
        pdf.drawString(ex, ty, email_txt)
        pdf.linkURL(
            f"mailto:{LETTERHEAD_EMAIL}",
            (ex - 1, ty - 2.5, ex + w_email + 1, ty + 8.5),
            relative=0, thickness=0,
        )
        ty -= 4.5 * mm
        pdf.drawCentredString(cx, ty, LETTERHEAD_INN_KPP)
        # Двойная линия во всю ширину листа (как на бланке)
        rule_y = top - lh_block_h - LH_RULE_GAP
        pdf.setStrokeColor(colors.black)
        pdf.setLineWidth(3.4)
        pdf.line(left, rule_y, right, rule_y)
        pdf.setStrokeColor(colors.HexColor("#b0b0b0"))
        pdf.setLineWidth(1.1)
        pdf.line(left, rule_y - 2.2 * mm, right, rule_y - 2.2 * mm)

    top_margin = lh_total_h if letterhead else 14 * mm
    plain_top_margin = 14 * mm
    y = page_h - top_margin

    def draw_watermark():
        """Полупрозрачный «призрак» по центру страницы + небольшая видимая
        копия знака в подвале: клиент должен видеть логотип компании явно,
        а не только сквозь текст."""
        if not watermark_path:
            return
        try:
            wm_image = ImageReader(str(watermark_path))
            iw, ih = wm_image.getSize()
            target = 120 * mm
            scale = target / max(iw, ih)
            draw_w, draw_h = iw * scale, ih * scale
            pdf.saveState()
            pdf.setFillAlpha(0.10)
            pdf.setStrokeAlpha(0.10)
            pdf.drawImage(
                wm_image,
                (page_w - draw_w) / 2, (page_h - draw_h) / 2,
                width=draw_w, height=draw_h,
                preserveAspectRatio=True, mask="auto",
            )
            pdf.restoreState()
            # видимый знак в правом нижнем углу (подвал страницы)
            badge_h = 10 * mm
            badge_w = iw * (badge_h / ih)
            if badge_w > 40 * mm:
                badge_w = 40 * mm
                badge_h = ih * (badge_w / iw)
            pdf.drawImage(
                wm_image,
                right - badge_w, 5 * mm,
                width=badge_w, height=badge_h,
                preserveAspectRatio=True, mask="auto",
            )
        except Exception:
            pass

    def new_page():
        nonlocal y
        pdf.showPage()
        draw_watermark()
        # Шапка на продолжениях — по выбору пользователя: как классический
        # бланк (только первый лист) или на каждой странице
        if letterhead and letterhead_all_pages:
            draw_letterhead()
            y = page_h - top_margin
        else:
            y = page_h - plain_top_margin

    def line(text, step=5.6 * mm, bold=False, color=None, size=10):
        nonlocal y
        if y < 20 * mm:
            new_page()
        pdf.setFillColor(color or c_text)
        pdf.setFont(font_b if bold else font_r, size)
        pdf.drawString(left, y, text)
        y -= step

    def card_header(title, subtitle=None):
        nonlocal y
        h = 18 * mm if subtitle else 13 * mm
        if y - h < 18 * mm:
            new_page()
        pdf.setFillColor(c_primary)
        pdf.roundRect(left, y - h, width, h, 3 * mm, stroke=0, fill=1)
        pdf.setFillColor(colors.white)
        pdf.setFont(font_b, 13)
        pdf.drawString(left + 4 * mm, y - 6.5 * mm, title)
        if subtitle:
            pdf.setFont(font_r, 9)
            pdf.drawString(left + 4 * mm, y - 12 * mm, subtitle)
        y -= h + 3 * mm

    def draw_row(label, values):
        # Без «зелёной подсветки лучшего»: документ инженерный, у параметров
        # нет универсального «лучше» — оценку делает специалист под задачу
        nonlocal y
        row_h = 7.2 * mm
        label_w = 42 * mm
        model_count = max(1, len(values))
        value_w = (width - label_w) / model_count
        if y - row_h < 18 * mm:
            new_page()
        pdf.setStrokeColor(c_border)
        pdf.setFillColor(c_surface)
        pdf.rect(left, y - row_h, label_w, row_h, stroke=1, fill=1)
        pdf.setFillColor(c_text)
        pdf.setFont(font_b, 8.5)
        pdf.drawString(left + 1.8 * mm, y - 4.8 * mm, label)
        for idx, text in enumerate(values):
            x = left + label_w + idx * value_w
            pdf.setFillColor(colors.white)
            pdf.rect(x, y - row_h, value_w, row_h, stroke=1, fill=1)
            pdf.setFillColor(c_text)
            pdf.setFont(font_r, 8)
            pdf.drawString(x + 1.2 * mm, y - 4.8 * mm, (_normalize_ws(text))[:36] or "—")
        y -= row_h

    single = len(products) == 1
    pdf.setAuthor("VENTSEARCH API")
    pdf.setTitle("VENTSEARCH Карточка модели" if single else "VENTSEARCH Сравнение моделей")
    draw_watermark()
    draw_letterhead()
    if show_title:
        default_title = "VENTSEARCH — карточка модели" if single else "VENTSEARCH — отчет по сравнению"
        title = (header_text or "").strip() or default_title
        card_header(
            title,
            f"Дата: {datetime.now().strftime('%d.%m.%Y %H:%M')}"
            + ("" if single else f"   |   Моделей: {len(products)}"),
        )

    if chart_png:
        try:
            image = ImageReader(BytesIO(chart_png))
            chart_h = 72 * mm
            if y - (chart_h + 10 * mm) < 20 * mm:
                new_page()
            line("Аэродинамические характеристики (Q–P):", step=6.5 * mm, bold=True, size=10)
            pdf.setStrokeColor(c_border)
            pdf.setFillColor(colors.white)
            pdf.roundRect(left, y - chart_h - 3 * mm, width, chart_h + 3 * mm, 2 * mm, stroke=1, fill=1)
            pdf.drawImage(image, left, y - chart_h, width=width, height=chart_h, preserveAspectRatio=True, mask="auto")
            y -= chart_h + 7 * mm
        except Exception:
            line("Не удалось встроить график Q-P.", step=6.5 * mm, color=c_muted, size=9)

    models = [_normalize_ws(p.get("model") or p.get("id") or "—") for p in products]
    types = [_normalize_ws(p.get("type") or "—") for p in products]
    sizes = [_normalize_ws(p.get("size") or "—") for p in products]
    diameters = [f"{_format_num(p.get('diameter'))} мм" if p.get("diameter") is not None else "—" for p in products]
    airflows = [_normalize_ws((p.get("airflow") or {}).get("raw") or "—") for p in products]
    pressures = [_normalize_ws((p.get("pressure") or {}).get("raw") or "—") for p in products]
    powers = [f"{_format_num(p.get('power'))} Вт" if p.get("power") is not None else "—" for p in products]
    noises = [f"{_format_num(p.get('noise_level'))} дБ" if p.get("noise_level") is not None else "—" for p in products]
    prices = [f"{_format_num(p.get('price'))} ₽" if p.get("price") is not None else "по запросу" for p in products]

    line("Технические характеристики:", step=6.5 * mm, bold=True, size=10)
    draw_row("Модель", models)
    draw_row("Тип", types)
    draw_row("Типоразмер", sizes)
    draw_row("Диаметр", diameters)
    draw_row("Расход", airflows)
    draw_row("Давление", pressures)
    draw_row("Мощность", powers)
    draw_row("Шум", noises)
    draw_row("Цена", prices)

    def wrap_to_width(text, font_name, font_size, max_width):
        """Разбивает текст на строки по ширине (в пунктах reportlab), не обрезая."""
        words = text.split(" ")
        lines, cur = [], ""
        for w in words:
            candidate = f"{cur} {w}".strip()
            if pdf.stringWidth(candidate, font_name, font_size) <= max_width or not cur:
                cur = candidate
            else:
                lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        return lines

    y -= 4 * mm
    line("Подробно по моделям:", step=6.5 * mm, bold=True)
    for idx, p in enumerate(products, start=1):
        dims = p.get("dimensions") or {}
        dims_size = 7.5
        photo_path = _find_product_photo(p)
        # Служебный ID в клиентском документе не показываем; вместо этой
        # строки — частота вращения и двигатель
        rpm = p.get("nominal_rpm")
        rpm_text = f"{_format_num(rpm)} об/мин" if rpm else "—"
        photo_w = 26 * mm if photo_path else 0
        title_limit = 78 if photo_path else 95
        dims_lines = []
        if dims:
            dims_text = "Размеры (мм): " + "   ·   ".join(f"{k}={v}" for k, v in dims.items())
            dims_lines = wrap_to_width(dims_text, font_r, dims_size, width - 6 * mm)
        card_h = (25.5 + len(dims_lines) * 4) * mm if dims_lines else 30 * mm
        if photo_path and card_h < 30 * mm:
            card_h = 30 * mm
        if y - card_h < 6 * mm:
            new_page()
        pdf.setStrokeColor(c_border)
        pdf.setFillColor(colors.white)
        pdf.roundRect(left, y - card_h, width, card_h, 2 * mm, stroke=1, fill=1)
        if photo_path:
            try:
                pdf.drawImage(
                    ImageReader(str(photo_path)),
                    right - photo_w - 2 * mm, y - 26 * mm,
                    width=photo_w, height=24 * mm,
                    preserveAspectRatio=True, mask="auto",
                )
            except Exception:
                pass
        pdf.setFillColor(c_text)
        pdf.setFont(font_b, 10)
        pdf.drawString(left + 3 * mm, y - 6 * mm, f"{idx}. {_normalize_ws(p.get('model') or p.get('id') or '—')}"[:title_limit])
        pdf.setFillColor(c_muted)
        pdf.setFont(font_r, 8.5)
        pdf.drawString(left + 3 * mm, y - 11 * mm,
                       f"Двигатель: {_normalize_ws(p.get('size') or '—')}   |   Частота вращения: {rpm_text}")
        pdf.drawString(left + 3 * mm, y - 15.5 * mm,
                       f"Тип: {_normalize_ws(p.get('type') or '—')}   |   Диаметр: {diameters[idx-1]}")
        pdf.drawString(left + 3 * mm, y - 20 * mm,
                       f"Расход: {airflows[idx-1]}   |   Давление: {pressures[idx-1]}")
        pdf.drawString(left + 3 * mm, y - 24.5 * mm,
                       f"Мощность: {powers[idx-1]}   |   Шум: {noises[idx-1]}   |   Цена: {prices[idx-1]}")
        if dims_lines:
            pdf.setFont(font_r, dims_size)
            for i, dl in enumerate(dims_lines):
                pdf.drawString(left + 3 * mm, y - (29.5 + i * 4) * mm, dl)
        y -= card_h + 3.5 * mm

    # Чертёж из каталога печатаем ОДИН РАЗ (общий для ряда), крупно, во всю
    # ширину страницы. Одинаковые для разных моделей файлы не дублируем.
    # Таблицу присоединительных размеров (blueprintVals) в PDF не выводим —
    # по просьбе клиента остаётся только сам чертёж.
    def _draw_full_width_image(path, title):
        nonlocal y
        try:
            img = ImageReader(str(path))
            iw, ih = img.getSize()
            draw_w = width
            draw_h = draw_w * ih / iw
            max_h = 210 * mm
            if draw_h > max_h:
                draw_h = max_h
                draw_w = draw_h * iw / ih
            if y - (draw_h + 10 * mm) < 12 * mm:
                new_page()
            line(title, step=6.5 * mm, bold=True, size=10)
            pdf.setStrokeColor(c_border)
            pdf.setFillColor(colors.white)
            pdf.roundRect(left, y - draw_h - 3 * mm, width, draw_h + 3 * mm, 2 * mm, stroke=1, fill=1)
            pdf.drawImage(
                img, left + (width - draw_w) / 2, y - draw_h - 1.5 * mm,
                width=draw_w, height=draw_h, preserveAspectRatio=True, mask="auto",
            )
            y -= draw_h + 8 * mm
        except Exception:
            pass

    seen_bp: set[str] = set()
    for p in products:
        bp_path = _find_product_blueprint(p)
        if not bp_path or str(bp_path) in seen_bp:
            continue
        seen_bp.add(str(bp_path))
        _draw_full_width_image(bp_path, "Чертёж из каталога")

    pdf.save()
    data = buf.getvalue()
    buf.close()
    return data


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

def create_app() -> FastAPI:
    app = FastAPI(
        title="VENTSEARCH API",
        description=(
            "B2B-каталог промышленных вентиляторов. "
            "Данные в PostgreSQL; CSV синхронизируется по mtime/размеру и SHA-256."
        ),
        version="0.3.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    if PHOTOS_DIR.exists():
        app.mount("/photos", StaticFiles(directory=str(PHOTOS_DIR)), name="photos")

    app.include_router(catalog_router)
    app.include_router(auth_router)
    app.include_router(admin_router)

    # --- Exception handlers ---

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        # exc.errors() у pydantic v2 кладёт в ctx.error сам объект исключения
        # (например, при raise ValueError(...) в @model_validator) — он не
        # сериализуется обычным json.dumps внутри JSONResponse, нужен jsonable_encoder
        return JSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors())})

    @app.exception_handler(StarletteHTTPException)
    async def starlette_http_exception_handler(request: Request, exc: StarletteHTTPException):
        if exc.status_code == 404 and _is_frontend_request(request) and _wants_html(request):
            page = FRONTEND_DIR / "404.html"
            if page.exists():
                return FileResponse(page, status_code=404)
        # headers исключения (например, Retry-After у 429) должны дойти до клиента
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        if isinstance(exc, HTTPException):
            return JSONResponse(
                status_code=exc.status_code,
                content=exc.detail if isinstance(exc.detail, dict) else {"error": str(exc.detail)},
            )
        if _is_frontend_request(request) and _wants_html(request):
            page = FRONTEND_DIR / "500.html"
            if page.exists():
                return FileResponse(page, status_code=500)
        traceback.print_exc()
        return JSONResponse(status_code=500, content=ErrorOut(error="Internal server error").model_dump())

    # --- System routes ---

    @app.get("/api/health", response_model=HealthOut, summary="Проверка работоспособности", tags=["system"])
    def api_health():
        from config import DEMO_MODE

        conn = get_connection()
        try:
            n = count_products(conn)
        finally:
            put_connection(conn)
        return HealthOut(ok=True, products=n, demo_mode=DEMO_MODE)

    @app.get("/api/share-links", summary="Ссылки для открытия в локальной сети", tags=["system"])
    def api_share_links(request: Request):
        scheme = request.url.scheme or "http"
        port = request.url.port
        current_host = request.url.hostname or "localhost"
        current_url = _format_url(scheme, current_host, port)

        # Реально доступные с других устройств адреса — из сетевых интерфейсов.
        lan_urls = []
        for ip in _discover_local_ips():
            url = _format_url(scheme, ip, port)
            if url not in lan_urls:
                lan_urls.append(url)

        try:
            current_is_loopback = ipaddress.ip_address(current_host).is_loopback
        except ValueError:
            current_is_loopback = current_host.lower() == "localhost"

        if current_is_loopback:
            # localhost/127.0.0.1 работает только на этом же компьютере — не
            # ставим первым (это как раз то, что копируется в буфер обмена);
            # первым должен быть реально открывающийся с других устройств адрес.
            urls = lan_urls + ([current_url] if current_url not in lan_urls else [])
        else:
            urls = [current_url] + [u for u in lan_urls if u != current_url]
        if not urls:
            urls = [current_url]

        return {"urls": urls, "hint": "Откройте на другом устройстве в той же локальной сети."}

    @app.get("/api/contacts", summary="Контакты команды (для виджета на сайте)", tags=["system"])
    def api_contacts():
        """
        Публичная выжимка из data/credits.json для плавающего контакт-виджета:
        только имя/роль/контакт, без служебных полей. Файл читается на каждый
        запрос — правки применяются без перезапуска.
        """
        import json as _json
        from config import CREDITS_PATH

        if not CREDITS_PATH.exists():
            return {"found": False, "creators": []}
        try:
            with CREDITS_PATH.open("r", encoding="utf-8") as f:
                data = _json.load(f)
        except (_json.JSONDecodeError, OSError):
            return {"found": False, "creators": []}
        creators = [
            {"name": c.get("name", ""), "role": c.get("role", ""), "contact": c.get("contact", "")}
            for c in (data.get("creators") or [])
            if isinstance(c, dict) and (c.get("name") or c.get("contact"))
        ]
        return {
            "found": True,
            "project_name": data.get("project_name", ""),
            "creators": creators,
        }

    @app.get("/api/photos-version", summary="Версии файлов фото (кэш-бастинг)", tags=["system"])
    def api_photos_version():
        """
        Время изменения каждого файла в photos/ — фронтенд добавляет его как
        ?v=... к ссылке на картинку, чтобы браузер не показывал старое фото
        из кэша после замены файла на диске (URL иначе не меняется).
        """
        if not PHOTOS_DIR.exists():
            return {}
        versions: dict[str, int] = {}
        for entry in PHOTOS_DIR.iterdir():
            if entry.is_file():
                versions[entry.name] = int(entry.stat().st_mtime)
        return versions

    # --- Export ---

    @app.post("/api/export/pdf", summary="Экспорт сравнения в PDF", tags=["export"])
    def api_export_pdf(payload: PdfExportRequest):
        from infrastructure.csv.sync import sync_catalog_from_csv
        from presentation.api.routes.catalog import _ensure_catalog_sync
        _ensure_catalog_sync(CSV_PATH)

        ids = [_normalize_ws(v) for v in payload.ids if _normalize_ws(v)]
        if not ids:
            raise HTTPException(
                status_code=422,
                detail={"detail": [{"loc": ["body", "ids"], "msg": "ids must not be empty", "type": "value_error"}]},
            )
        products_list: list[dict[str, Any]] = []
        missing: list[str] = []
        conn = get_connection()
        try:
            repo = PgProductRepository(conn)
            for raw in ids:
                item = repo.get_by_id(raw) or repo.get_by_model_or_slug(raw.lower(), _slugify_local(raw))
                if item:
                    products_list.append(item)
                else:
                    missing.append(raw)
        finally:
            put_connection(conn)

        if missing:
            raise HTTPException(
                status_code=404,
                detail=ErrorOut(error=f"Product not found: {', '.join(missing)}").model_dump(),
            )
        chart_png = _extract_chart_png(payload.chart_image_data_url)
        watermark_path = None
        if payload.watermark:
            candidate = PHOTOS_DIR / payload.watermark
            if (
                Path(payload.watermark).name == payload.watermark
                and candidate.is_file()
                and candidate.resolve().parent == PHOTOS_DIR.resolve()
            ):
                watermark_path = candidate
        pdf_bytes = _build_compare_pdf(
            products_list,
            chart_png=chart_png,
            header_text=payload.header_text,
            watermark_path=watermark_path,
            letterhead=payload.letterhead,
            letterhead_all_pages=payload.letterhead_all_pages,
            show_title=payload.show_title,
        )
        filename = _safe_pdf_filename(payload.filename)
        headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
        return StreamingResponse(BytesIO(pdf_bytes), media_type="application/pdf", headers=headers)

    # --- Frontend static routes ---

    @app.get("/", include_in_schema=False)
    def serve_index():
        # HTML не кэшируем: браузер хранит страницы с query-string (product.html?id=…)
        # по отдельности и после обновлений показывает смесь старой и новой вёрстки
        return FileResponse(FRONTEND_DIR / "index.html", headers={"Cache-Control": "no-cache"})

    for name in [
        "index.html", "product.html", "compare.html", "project.html",
        "admin.html", "auth.html", "delivery.html",
        "admin-page.js", "auth-page.js", "site-auth.js",
        "admin.js", "auth.js", "style.css", "script.js", "config.js",
        "site-layout.js",
        # Иконки сайта: без явных маршрутов браузер получал 404 даже при
        # правильно сгенерированных файлах в frontend/ (список — белый)
        "favicon.ico", "favicon-16x16.png", "favicon-32x32.png",
        "apple-touch-icon.png",
    ]:
        _make_static_route(app, name)

    # Служебная графика фронтенда (заглушка чертежа и т.п.) — целой папкой,
    # как /photos: новые файлы в frontend/img/ не требуют правок белого списка
    frontend_img_dir = FRONTEND_DIR / "img"
    if frontend_img_dir.is_dir():
        app.mount("/img", StaticFiles(directory=str(frontend_img_dir)), name="frontend-img")

    return app


def _make_static_route(app: FastAPI, filename: str) -> None:
    path = f"/{filename}"
    # no-cache заставляет браузер перепроверять файл (ETag/304) — после обновления
    # кода не остаётся закэшированных страниц со старой вёрсткой
    headers = {"Cache-Control": "no-cache"} if filename.endswith((".html", ".js", ".css")) else None

    @app.get(path, include_in_schema=False)
    def _serve(f=filename, h=headers):
        return FileResponse(FRONTEND_DIR / f, headers=h)

    _serve.__name__ = f"serve_{filename.replace('.', '_').replace('-', '_')}"


def _wants_html(request: Request) -> bool:
    accept = (request.headers.get("accept") or "").lower()
    return "text/html" in accept or "*/*" in accept


def _is_frontend_request(request: Request) -> bool:
    return not (request.url.path or "").startswith("/api")


def _discover_local_ips() -> list[str]:
    candidates: set[str] = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            candidates.add(s.getsockname()[0])
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, family=socket.AF_INET, type=socket.SOCK_STREAM):
            candidates.add(info[4][0])
    except Exception:
        pass
    out: list[str] = []
    for raw in sorted(candidates):
        try:
            ip = ipaddress.ip_address(raw)
        except ValueError:
            continue
        if not ip.is_loopback and (ip.is_private or ip.is_link_local):
            out.append(raw)
    return out


def _format_url(scheme: str, host: str, port: Optional[int], path: str = "/") -> str:
    default_port = 80 if scheme == "http" else 443 if scheme == "https" else None
    port_part = f":{port}" if port and port != default_port else ""
    normalized_path = path if path.startswith("/") else f"/{path}"
    return f"{scheme}://{host}{port_part}{normalized_path}"


def _slugify_local(value: str) -> str:
    s = _normalize_ws(value).lower()
    s = re.sub(r"[^\w]+", "-", s, flags=re.UNICODE)
    return re.sub(r"-{2,}", "-", s).strip("-")


# Module-level app instance
app = create_app()

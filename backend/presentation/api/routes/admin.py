"""Админ API: каталог вентиляторов, пользователи и диагностика."""
from __future__ import annotations

import math
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from presentation.api.deps import db_session, require_admin
from presentation.api.schemas import (
    AdminProductIn,
    AdminUserIn,
    AdminUserUpdateIn,
    BulkDeleteOut,
    BulkDeleteProductsIn,
    BulkDeleteUsersIn,
    ProductListPageOut,
    ProductOut,
    UserListPageOut,
    UserOut,
)
from infrastructure.auth.jwt_service import hash_password
from infrastructure.db.product_admin import (
    admin_list_products,
    create_product,
    delete_product,
    delete_products_bulk,
    update_product,
)
from infrastructure.db.user_repository import (
    _public_user,
    count_admins,
    create_user,
    delete_user,
    delete_users_bulk,
    get_user_by_email,
    get_user_by_id,
    is_protected_admin_account,
    list_users,
    update_user,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Момент импорта модуля ≈ момент старта процесса — для аптайма в диагностике
_STARTED_AT = time.time()


def _rebuild_catalog_index() -> None:
    from infrastructure.db.connection import get_connection, put_connection
    from infrastructure.search.catalog_index import CatalogIndex, set_catalog_index

    conn = get_connection()
    try:
        set_catalog_index(CatalogIndex.build(conn))
    except Exception:
        set_catalog_index(None)
    finally:
        put_connection(conn)


@router.get("/products", response_model=ProductListPageOut, summary="Список вентиляторов (админ)")
def admin_products(
    _: Annotated[dict, Depends(require_admin)],
    q: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    with db_session() as conn:
        items, total = admin_list_products(conn, q=q, limit=limit, offset=offset)
    return ProductListPageOut(
        items=[ProductOut.model_validate(p) for p in items],
        total=total, limit=limit, offset=offset,
    )


@router.get("/products/{product_id}", response_model=ProductOut, summary="Карточка вентилятора (админ)")
def admin_product_get(product_id: str, _: Annotated[dict, Depends(require_admin)]):
    from infrastructure.db.product_repository import get_by_id

    with db_session() as conn:
        product = get_by_id(conn, product_id)
    if not product:
        raise HTTPException(status_code=404, detail={"error": "Product not found"})
    return ProductOut.model_validate(product)


@router.post("/products", response_model=ProductOut, status_code=201, summary="Создать вентилятор")
def admin_product_create(payload: AdminProductIn, _: Annotated[dict, Depends(require_admin)]):
    try:
        with db_session() as conn:
            product = create_product(conn, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=409, detail={"error": str(exc)}) from exc
    _rebuild_catalog_index()
    return ProductOut.model_validate(product)


@router.put("/products/{product_id}", response_model=ProductOut, summary="Обновить вентилятор")
def admin_product_update(
    product_id: str, payload: AdminProductIn, _: Annotated[dict, Depends(require_admin)]
):
    with db_session() as conn:
        product = update_product(conn, product_id, payload.model_dump())
    if not product:
        raise HTTPException(status_code=404, detail={"error": "Product not found"})
    _rebuild_catalog_index()
    return ProductOut.model_validate(product)


@router.delete("/products/{product_id}", summary="Удалить вентилятор")
def admin_product_delete(product_id: str, _: Annotated[dict, Depends(require_admin)]):
    with db_session() as conn:
        deleted = delete_product(conn, product_id)
    if not deleted:
        raise HTTPException(status_code=404, detail={"error": "Product not found"})
    _rebuild_catalog_index()
    return {"ok": True}


@router.post("/products/bulk-delete", response_model=BulkDeleteOut, summary="Удалить несколько вентиляторов")
def admin_products_bulk_delete(payload: BulkDeleteProductsIn, _: Annotated[dict, Depends(require_admin)]):
    with db_session() as conn:
        deleted = delete_products_bulk(conn, payload.ids)
    if deleted:
        _rebuild_catalog_index()
    return BulkDeleteOut(deleted=deleted, errors=[])


@router.get("/users", response_model=UserListPageOut, summary="Список пользователей")
def admin_users(
    _: Annotated[dict, Depends(require_admin)],
    q: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    with db_session() as conn:
        items, total = list_users(conn, q=q, limit=limit, offset=offset)
    return UserListPageOut(
        items=[UserOut.model_validate(u) for u in items],
        total=total, limit=limit, offset=offset,
    )


@router.post("/users", response_model=UserOut, status_code=201, summary="Создать пользователя")
def admin_user_create(payload: AdminUserIn, _: Annotated[dict, Depends(require_admin)]):
    email = payload.email.strip().lower()
    if len(payload.password) < 6:
        raise HTTPException(status_code=422, detail={"error": "Password must be at least 6 characters"})
    role = payload.role if payload.role in ("user", "admin") else "user"
    with db_session() as conn:
        if get_user_by_email(conn, email):
            raise HTTPException(status_code=409, detail={"error": "Email already exists"})
        user = create_user(
            conn,
            email=email,
            password_hash=hash_password(payload.password),
            name=payload.name.strip(),
            company=payload.company.strip(),
            phone=payload.phone.strip(),
            role=role,
        )
    return UserOut.model_validate(user)


@router.get("/users/{user_id}", response_model=UserOut, summary="Пользователь по id")
def admin_user_get(user_id: int, _: Annotated[dict, Depends(require_admin)]):
    with db_session() as conn:
        row = get_user_by_id(conn, user_id)
    if not row:
        raise HTTPException(status_code=404, detail={"error": "User not found"})
    return UserOut.model_validate(_public_user(row))


@router.put("/users/{user_id}", response_model=UserOut, summary="Обновить пользователя")
def admin_user_update(
    user_id: int, payload: AdminUserUpdateIn, _: Annotated[dict, Depends(require_admin)]
):
    data = payload.model_dump(exclude_unset=True)
    with db_session() as conn:
        existing = get_user_by_id(conn, user_id)
        if not existing:
            raise HTTPException(status_code=404, detail={"error": "User not found"})

        if is_protected_admin_account(existing):
            if data.get("email") and data["email"].strip().lower() != existing["email"].lower():
                raise HTTPException(status_code=400, detail={"error": "Cannot change email of protected admin"})
            if data.get("role") == "user":
                raise HTTPException(status_code=400, detail={"error": "Cannot change role of protected admin"})
            if data.get("is_active") is False:
                raise HTTPException(status_code=400, detail={"error": "Cannot deactivate protected admin"})

        if data.get("email"):
            other = get_user_by_email(conn, data["email"].strip().lower())
            if other and other["id"] != user_id:
                raise HTTPException(status_code=409, detail={"error": "Email already exists"})

        new_role = data.get("role")
        if new_role == "user" and existing.get("role") == "admin":
            if count_admins(conn) <= 1:
                raise HTTPException(status_code=400, detail={"error": "Cannot demote the last admin"})

        password_hash = hash_password(data["password"]) if data.get("password") else None
        user = update_user(
            conn,
            user_id,
            email=data["email"].strip().lower() if data.get("email") else None,
            password_hash=password_hash,
            name=data.get("name"),
            company=data.get("company"),
            phone=data.get("phone"),
            role=new_role,
            is_active=data.get("is_active"),
        )
    if not user:
        raise HTTPException(status_code=404, detail={"error": "User not found"})
    return UserOut.model_validate(user)


@router.delete("/users/{user_id}", summary="Удалить пользователя")
def admin_user_delete(user_id: int, admin: Annotated[dict, Depends(require_admin)]):
    if admin["id"] == user_id:
        raise HTTPException(status_code=400, detail={"error": "Cannot delete your own account"})
    with db_session() as conn:
        existing = get_user_by_id(conn, user_id)
        if not existing:
            raise HTTPException(status_code=404, detail={"error": "User not found"})
        if is_protected_admin_account(existing):
            raise HTTPException(status_code=400, detail={"error": "Cannot delete protected admin account"})
        if existing.get("role") == "admin" and count_admins(conn) <= 1:
            raise HTTPException(status_code=400, detail={"error": "Cannot delete the last admin"})
        deleted = delete_user(conn, user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail={"error": "User not found"})
    return {"ok": True}


@router.post("/users/bulk-delete", response_model=BulkDeleteOut, summary="Удалить нескольких пользователей")
def admin_users_bulk_delete(payload: BulkDeleteUsersIn, admin: Annotated[dict, Depends(require_admin)]):
    with db_session() as conn:
        deleted, errors = delete_users_bulk(conn, payload.ids, acting_admin_id=admin["id"])
    return BulkDeleteOut(deleted=deleted, errors=errors)


# ---------------------------------------------------------------------------
# Диагностика
# ---------------------------------------------------------------------------

def _debug_database_section() -> Dict[str, Any]:
    from infrastructure.db.product_repository import count_products
    from infrastructure.db.user_repository import count_admins

    with db_session() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT version();")
            row = cur.fetchone()
            version = (row[0].split(",")[0].strip()) if row and row[0] else "unknown"
            cur.execute("SELECT COUNT(*) FROM users;")
            users_total = int(cur.fetchone()[0])
        products_total = count_products(conn)
        admins_total = count_admins(conn)
    return {
        "ok": True,
        "version": version,
        "products_total": products_total,
        "users_total": users_total,
        "admins_total": admins_total,
    }


def _debug_catalog_section() -> Dict[str, Any]:
    from config import CSV_PATH
    from infrastructure.csv.sync import _get_state, get_last_load_report

    info: Dict[str, Any] = {
        "csv_path": str(CSV_PATH),
        "csv_exists": CSV_PATH.exists(),
    }
    if info["csv_exists"]:
        st = CSV_PATH.stat()
        info["csv_size_bytes"] = st.st_size
        info["csv_mtime"] = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat()
    with db_session() as conn:
        state = _get_state(conn)
    if state:
        info["synced"] = True
        info["synced_size_bytes"] = state["size_bytes"]
        info["synced_sha256"] = state["sha256_hex"][:12] + "…"
        info["in_sync"] = bool(
            info.get("csv_exists")
            and state["size_bytes"] == info.get("csv_size_bytes")
        )
    else:
        info["synced"] = False

    # Отчёт последней загрузки: что сайт увидел в файле, но не смог/не стал
    # считать — колонки без сопоставления, пропущенные и упавшие строки.
    report = get_last_load_report()
    if report is not None:
        info["last_load"] = {
            "encoding": report.encoding,
            "total_data_rows": report.total_data_rows,
            "inserted": report.inserted,
            "unrecognized_columns": report.unrecognized_columns,
            "skipped_rows": report.skipped_rows,
            "error_rows": report.error_rows,
        }
        warnings: list[str] = []
        if report.unrecognized_columns:
            warnings.append(
                "Эти колонки есть в файле, но сайт их не читает (нет сопоставления): "
                + ", ".join(report.unrecognized_columns)
            )
        if report.error_rows:
            warnings.append(f"{len(report.error_rows)} строк(и) не загрузились из-за ошибок — см. error_rows.")
        if report.skipped_rows:
            warnings.append(f"{len(report.skipped_rows)} строк(и) пропущены (нет типа/модели/типоразмера).")
        info["last_load_warnings"] = warnings
    else:
        info["last_load"] = None
    return info


def _bloom_false_positive_probability(m: int, k: int, n_items: int) -> float:
    """
    Теоретическая вероятность ложного срабатывания Bloom-фильтра:
    p ≈ (1 - e^(-k·n/m))^k, где m — размер битовой карты, k — число хэш-функций,
    n — число реально добавленных элементов.
    """
    if m <= 0 or k <= 0 or n_items <= 0:
        return 0.0
    return (1 - math.exp(-k * n_items / m)) ** k


def _bloom_speed_benchmark(bloom, known_values: list[str], haystack: list[str], repeats: int = 300) -> Dict[str, Any]:
    """
    Замер по факту (не теория): поиск через Bloom-фильтр (ожидаемо O(1) — не
    зависит от размера каталога) против линейного перебора списка (O(n) —
    время растёт с размером каталога). Пробы — вперемешку известные значения
    и заведомо отсутствующие, чтобы не тестировать только «горячий путь».
    """
    if not known_values or not haystack:
        return {}
    probes = [known_values[i % len(known_values)] for i in range(repeats)]
    probes += [f"__нет-такого-значения-{i}__" for i in range(repeats // 10 or 1)]

    t0 = time.perf_counter()
    for v in probes:
        bloom.might_contain(v)
    bloom_elapsed = time.perf_counter() - t0

    t0 = time.perf_counter()
    for v in probes:
        _ = v in haystack  # линейный перебор — Python делает это за O(n)
    linear_elapsed = time.perf_counter() - t0

    n_probes = len(probes)
    return {
        "probes": n_probes,
        "haystack_size": len(haystack),
        "bloom_total_ms": round(bloom_elapsed * 1000, 3),
        "bloom_per_op_us": round(bloom_elapsed / n_probes * 1e6, 3),
        "linear_total_ms": round(linear_elapsed * 1000, 3),
        "linear_per_op_us": round(linear_elapsed / n_probes * 1e6, 3),
        "speedup_x": round(linear_elapsed / bloom_elapsed, 1) if bloom_elapsed > 0 else None,
        "note": "Bloom — O(1) (не зависит от размера каталога), линейный перебор — O(n). "
                "На маленьком каталоге разница в наносекундах, но растёт с ростом n.",
    }


def _debug_index_section() -> Dict[str, Any]:
    from infrastructure.search.catalog_index import get_catalog_index

    idx = get_catalog_index()
    if idx is None:
        return {"built": False}
    rows = getattr(idx, "_rows", []) or []
    result: Dict[str, Any] = {"built": True, "rows": len(rows)}

    # Bloom-фильтры категориальных полей — битовая карта для отладочной
    # визуализации в админке (какие ячейки заняты, насколько заполнен фильтр),
    # теоретическая вероятность коллизии и замер скорости против O(n)-перебора.
    type_bloom = getattr(idx, "_type_bloom", None)
    if type_bloom is not None:
        known = sorted(getattr(idx, "_type_to_ids", {}).keys())
        stats = type_bloom.stats()
        result["bloom_type"] = {
            **stats,
            "known_values": known,
            "false_positive_probability": _bloom_false_positive_probability(
                stats.get("m", 0), stats.get("k", 0), len(known)
            ),
            "speed_benchmark": _bloom_speed_benchmark(
                type_bloom, known, [str(r.get("type", "")) for r in rows]
            ),
        }
    size_bloom = getattr(idx, "_size_bloom", None)
    if size_bloom is not None:
        known = sorted(getattr(idx, "_size_to_ids", {}).keys())
        stats = size_bloom.stats()
        result["bloom_size"] = {
            **stats,
            "known_values": known,
            "false_positive_probability": _bloom_false_positive_probability(
                stats.get("m", 0), stats.get("k", 0), len(known)
            ),
            "speed_benchmark": _bloom_speed_benchmark(
                size_bloom, known, [str(r.get("size", "")) for r in rows]
            ),
        }
    return result


def _debug_security_section() -> Dict[str, Any]:
    from config import ADMIN_PASSWORD, CORS_ORIGINS, JWT_EXPIRE_HOURS, JWT_SECRET
    from presentation.api.routes.auth import login_limiter

    return {
        # Только флаги — сами значения секретов наружу не отдаём никогда
        "jwt_secret_is_default": JWT_SECRET == "change-me-in-production",
        "admin_password_is_default": ADMIN_PASSWORD == "admin123",
        "jwt_expire_hours": JWT_EXPIRE_HOURS,
        "cors_origins": CORS_ORIGINS,
        "login_rate_limit": {
            "max_attempts": login_limiter.max_attempts,
            "window_seconds": login_limiter.window_seconds,
        },
    }


def _debug_resources_section() -> Dict[str, Any]:
    """Нагрузка процесса/системы — то же, что видно в Docker/htop, но прямо в админке."""
    import psutil

    proc = psutil.Process()
    with proc.oneshot():
        cpu_percent = proc.cpu_percent(interval=0.1)
        mem = proc.memory_info()
        num_threads = proc.num_threads()
    vm = psutil.virtual_memory()
    disk = psutil.disk_usage(str(Path(__file__).resolve().parents[4]))
    return {
        "process": {
            "cpu_percent": cpu_percent,
            "rss_mb": round(mem.rss / (1024 * 1024), 1),
            "threads": num_threads,
        },
        "system": {
            "cpu_percent": psutil.cpu_percent(interval=0.1),
            "cpu_count": psutil.cpu_count(),
            "memory_used_percent": vm.percent,
            "memory_total_mb": round(vm.total / (1024 * 1024), 1),
            "disk_used_percent": disk.percent,
        },
    }


@router.get("/debug", summary="Диагностика системы (админ)")
def admin_debug(_: Annotated[dict, Depends(require_admin)]) -> Dict[str, Any]:
    """
    Состояние сервера, БД, каталога и поискового индекса + проверки безопасности.
    Секретные значения (пароли, ключи) в ответ не попадают — только флаги.
    Каждая секция собирается независимо: сбой одной не валит остальные.
    """
    from config import PORT

    report: Dict[str, Any] = {
        "server": {
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "port": PORT,
            "uptime_seconds": int(time.time() - _STARTED_AT),
            "time_utc": datetime.now(timezone.utc).isoformat(),
        }
    }
    for name, builder in (
        ("database", _debug_database_section),
        ("catalog", _debug_catalog_section),
        ("search_index", _debug_index_section),
        ("security", _debug_security_section),
        ("resources", _debug_resources_section),
    ):
        try:
            report[name] = builder()
        except Exception as exc:  # диагностика не должна падать целиком
            report[name] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    return report


@router.post("/reload-csv", summary="Принудительно перечитать CSV (админ)")
def admin_reload_csv(_: Annotated[dict, Depends(require_admin)]) -> Dict[str, Any]:
    """
    Форсирует перезагрузку каталога из CSV прямо сейчас (не дожидаясь изменения
    mtime/размера файла) и возвращает отчёт: что распозналось, что пропущено,
    какие колонки не читаются. Полезно после ручного редактирования CSV.
    """
    from config import CSV_PATH
    from infrastructure.csv.loader import load_csv_into_db
    from infrastructure.csv.sync import _file_sha256, _remember_report, _save_state

    if not CSV_PATH.exists():
        raise HTTPException(status_code=404, detail=f"CSV не найден: {CSV_PATH}")

    resolved = CSV_PATH.resolve()
    with db_session() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM products")
        report = load_csv_into_db(conn, resolved)
        _remember_report(report)
        st = resolved.stat()
        _save_state(conn, str(resolved), int(st.st_mtime_ns), int(st.st_size), _file_sha256(resolved))
        conn.commit()

    from infrastructure.search.catalog_index import CatalogIndex
    from presentation.app import set_catalog_index
    with db_session() as conn:
        set_catalog_index(CatalogIndex.build(conn))

    return {
        "encoding": report.encoding,
        "total_data_rows": report.total_data_rows,
        "inserted": report.inserted,
        "unrecognized_columns": report.unrecognized_columns,
        "skipped_rows": report.skipped_rows,
        "error_rows": report.error_rows,
    }


@router.post("/load-test", summary="Синтетическая нагрузка на поиск (админ)")
def admin_load_test(
    _: Annotated[dict, Depends(require_admin)],
    requests: Annotated[int, Query(ge=1, le=20000)] = 2000,
) -> Dict[str, Any]:
    """
    Прогоняет N синтетических поисковых запросов через тот же индекс, что
    обслуживает каталог, и измеряет пропускную способность (запросов/сек) —
    наглядно, без Docker/сторонних инструментов.
    """
    from infrastructure.search.catalog_index import get_catalog_index

    idx = get_catalog_index()
    if idx is None:
        raise HTTPException(status_code=503, detail="Индекс каталога ещё не построен")

    known_types = sorted(getattr(idx, "_type_to_ids", {}).keys()) or [""]
    known_sizes = sorted(getattr(idx, "_size_to_ids", {}).keys()) or [""]

    import psutil
    proc = psutil.Process()
    cpu_before = proc.cpu_percent(interval=None)
    t0 = time.perf_counter()
    for i in range(requests):
        idx.search(
            q=None,
            type_=known_types[i % len(known_types)] or None,
            series=known_sizes[i % len(known_sizes)] or None,
            diameter=None,
            min_price=None, max_price=None,
            min_power=None, max_power=None,
            min_noise=None, max_noise=None,
            min_diameter=None, max_diameter=None,
            min_airflow=None, max_airflow=None,
            min_pressure=None, max_pressure=None,
            sort="price_asc", limit=24, offset=0,
        )
    elapsed = time.perf_counter() - t0
    cpu_after = proc.cpu_percent(interval=None)

    return {
        "requests": requests,
        "elapsed_ms": round(elapsed * 1000, 2),
        "requests_per_second": round(requests / elapsed, 1) if elapsed > 0 else None,
        "avg_latency_us": round(elapsed / requests * 1e6, 2),
        "process_cpu_percent_during": cpu_after,
    }

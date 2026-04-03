"""
Инициализация БД: создание таблиц и поддержка эволюции схемы.

Функция идемпотентна: можно безопасно вызывать при каждом старте приложения.
"""

INIT_SQL = """
-- manufacturers
CREATE TABLE IF NOT EXISTS manufacturers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- products
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    size TEXT NOT NULL DEFAULT '',
    diameter NUMERIC,
    airflow_min NUMERIC,
    airflow_max NUMERIC,
    airflow_raw TEXT,
    pressure_min NUMERIC,
    pressure_max NUMERIC,
    pressure_raw TEXT,
    power NUMERIC,
    noise_level NUMERIC,
    price NUMERIC,
    manufacturer_id INTEGER,
    raw_diameter TEXT,
    raw_efficiency TEXT,
    raw_pressure TEXT,
    raw_power TEXT,
    raw_noise_level TEXT,
    raw_price TEXT,
    model_slug TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- columns evolution (if products existed before)
ALTER TABLE products ADD COLUMN IF NOT EXISTS manufacturer_id INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- indexes
CREATE INDEX IF NOT EXISTS idx_products_type ON products(type);
CREATE INDEX IF NOT EXISTS idx_products_model_slug ON products(model_slug);
CREATE INDEX IF NOT EXISTS idx_products_price ON products(price);
CREATE INDEX IF NOT EXISTS idx_products_manufacturer_id ON products(manufacturer_id);

-- foreign key (add once)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'products_manufacturer_id_fkey'
    ) THEN
        ALTER TABLE products
        ADD CONSTRAINT products_manufacturer_id_fkey
        FOREIGN KEY (manufacturer_id) REFERENCES manufacturers(id)
        ON DELETE SET NULL;
    END IF;
END $$;

-- updated_at trigger helper
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_products_updated_at') THEN
        CREATE TRIGGER trg_products_updated_at
        BEFORE UPDATE ON products
        FOR EACH ROW
        EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_manufacturers_updated_at') THEN
        CREATE TRIGGER trg_manufacturers_updated_at
        BEFORE UPDATE ON manufacturers
        FOR EACH ROW
        EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;
"""


def init_db(conn) -> None:
    """Создаёт/обновляет таблицы и индексы."""
    with conn.cursor() as cur:
        cur.execute(INIT_SQL)
    conn.commit()

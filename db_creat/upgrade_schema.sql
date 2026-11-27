-- ============================================================================
-- SCRIPT NÂNG CẤP CƠ SỞ DỮ LIỆU SUPABASE (KHÔNG XÓA DỮ LIỆU CŨ)
-- Dùng để nâng cấp phiên bản cũ lên cấu trúc mới nhất:
--   - Phân quyền 3 vai trò: staff / manager / admin
--   - Bổ sung phone, notes cho user_profiles
--   - Bổ sung discount_amount cho orders & RPC create_public_order (POS nhiều tab)
--   - Bổ sung bảng/cột nhập hàng (purchase_orders, purchase_order_items) & create_purchase_order
--   - Cập nhật RLS policies và Supabase Storage (bucket: product-images)
-- Chạy toàn bộ script này trong Supabase SQL Editor (an toàn khi chạy lại nhiều lần).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Hàm tự động cập nhật cột updated_at khi sửa dữ liệu
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- ============================================================================
-- 01. Nâng cấp bảng user_profiles (staff / manager / admin + phone, notes)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.user_profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL DEFAULT '',
    full_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'staff',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';

-- Chuẩn hóa dữ liệu role cũ trước khi cập nhật CHECK constraint
UPDATE public.user_profiles
SET role = 'staff'
WHERE role IS NULL OR role NOT IN ('staff', 'manager', 'admin');

-- Xóa các CHECK constraint cũ liên quan tới cột role (nếu có từ bản 2-role trước đây)
DO $$
DECLARE
    v_constraint RECORD;
BEGIN
    FOR v_constraint IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.user_profiles'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%role%'
    LOOP
        EXECUTE format(
            'ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS %I',
            v_constraint.conname
        );
    END LOOP;
END
$$;

ALTER TABLE public.user_profiles
    ALTER COLUMN role SET DEFAULT 'staff',
    ADD CONSTRAINT user_profiles_role_check CHECK (role IN ('staff', 'manager', 'admin'));

DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at
    BEFORE UPDATE ON public.user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT role INTO v_role
    FROM public.user_profiles
    WHERE user_id = auth.uid();

    RETURN COALESCE(v_role, 'staff');
END;
$$;

REVOKE ALL ON FUNCTION public.current_app_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_app_role() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.user_profiles (user_id, email, full_name, phone, notes, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.email, ''),
        COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
        COALESCE(NULLIF(NEW.phone, ''), NEW.raw_user_meta_data->>'phone', ''),
        '',
        'staff'
    )
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user_profile();

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Admin manage all profiles" ON public.user_profiles;

CREATE POLICY "Users read own profile"
    ON public.user_profiles FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Admin manage all profiles"
    ON public.user_profiles FOR ALL
    TO authenticated
    USING (public.current_app_role() = 'admin')
    WITH CHECK (public.current_app_role() = 'admin');

-- Bổ sung hồ sơ cho các tài khoản auth.users cũ nếu chưa có trong user_profiles
INSERT INTO public.user_profiles (user_id, email, phone, notes, role)
SELECT id, COALESCE(email, ''), COALESCE(phone, ''), '', 'staff'
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================================
-- 02. Nâng cấp bảng categories & RLS cho Manager / Admin
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    parent_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON public.categories(parent_id);

DROP TRIGGER IF EXISTS trg_categories_updated_at ON public.categories;
CREATE TRIGGER trg_categories_updated_at
    BEFORE UPDATE ON public.categories
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read active categories" ON public.categories;
DROP POLICY IF EXISTS "Admin full access on categories" ON public.categories;
DROP POLICY IF EXISTS "Manager and Admin full access on categories" ON public.categories;

CREATE POLICY "Public read active categories"
    ON public.categories FOR SELECT
    TO anon, authenticated
    USING (is_active = true OR public.current_app_role() IN ('manager', 'admin'));

CREATE POLICY "Manager and Admin full access on categories"
    ON public.categories FOR ALL
    TO authenticated
    USING (public.current_app_role() IN ('manager', 'admin'))
    WITH CHECK (public.current_app_role() IN ('manager', 'admin'));

-- ============================================================================
-- 03. Nâng cấp bảng products, RLS & View public_products
-- ============================================================================
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS barcode TEXT,
    ADD COLUMN IF NOT EXISTS brand TEXT,
    ADD COLUMN IF NOT EXISTS min_stock NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_stock NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS base_unit TEXT NOT NULL DEFAULT 'Cái',
    ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'Cái',
    ADD COLUMN IF NOT EXISTS conversion_rate NUMERIC(10, 2) NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS image_urls TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_products_category_id ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_name ON public.products(name);

DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;
CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON public.products
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read active products" ON public.products;
DROP POLICY IF EXISTS "Admin full access on products" ON public.products;
DROP POLICY IF EXISTS "Manager and Admin full access on products" ON public.products;

CREATE POLICY "Manager and Admin full access on products"
    ON public.products FOR ALL
    TO authenticated
    USING (public.current_app_role() IN ('manager', 'admin'))
    WITH CHECK (public.current_app_role() IN ('manager', 'admin'));

CREATE OR REPLACE VIEW public.public_products AS
SELECT
    p.id,
    p.category_id,
    c.name AS category_name,
    c.slug AS category_slug,
    p.sku,
    p.barcode,
    p.name,
    p.brand,
    p.selling_price,
    p.stock_quantity,
    p.base_unit,
    p.unit,
    p.conversion_rate,
    p.image_urls,
    p.created_at
FROM public.products p
LEFT JOIN public.categories c ON p.category_id = c.id
WHERE p.is_active = true
  AND (c.is_active IS NULL OR c.is_active = true);

GRANT SELECT ON public.public_products TO anon, authenticated;

-- ============================================================================
-- 04. Nâng cấp bảng customers & RLS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL DEFAULT '',
    default_address TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    total_orders INTEGER NOT NULL DEFAULT 0 CHECK (total_orders >= 0),
    total_spent NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_spent >= 0),
    last_order_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.customers
    ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS total_orders INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_spent NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_order_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_last_order ON public.customers(last_order_at DESC);

DROP TRIGGER IF EXISTS trg_customers_updated_at ON public.customers;
CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON public.customers
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff and Admin read customers" ON public.customers;
DROP POLICY IF EXISTS "Staff and Admin insert customers" ON public.customers;
DROP POLICY IF EXISTS "Staff and Admin update customers" ON public.customers;
DROP POLICY IF EXISTS "Admin delete customers" ON public.customers;
DROP POLICY IF EXISTS "Staff, Manager and Admin read customers" ON public.customers;
DROP POLICY IF EXISTS "Staff, Manager and Admin insert customers" ON public.customers;
DROP POLICY IF EXISTS "Staff, Manager and Admin update customers" ON public.customers;
DROP POLICY IF EXISTS "Manager and Admin delete customers" ON public.customers;

CREATE POLICY "Staff, Manager and Admin read customers"
    ON public.customers FOR SELECT
    TO authenticated
    USING (public.current_app_role() IN ('staff', 'manager', 'admin'));

CREATE POLICY "Staff, Manager and Admin insert customers"
    ON public.customers FOR INSERT
    TO authenticated
    WITH CHECK (public.current_app_role() IN ('staff', 'manager', 'admin'));

CREATE POLICY "Staff, Manager and Admin update customers"
    ON public.customers FOR UPDATE
    TO authenticated
    USING (public.current_app_role() IN ('staff', 'manager', 'admin'))
    WITH CHECK (public.current_app_role() IN ('staff', 'manager', 'admin'));

CREATE POLICY "Manager and Admin delete customers"
    ON public.customers FOR DELETE
    TO authenticated
    USING (public.current_app_role() IN ('manager', 'admin'));

-- ============================================================================
-- 05. Nâng cấp bảng orders & order_items (thêm discount_amount & RLS 3 vai trò)
-- ============================================================================
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS delivery_method TEXT NOT NULL DEFAULT 'delivery',
    ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_confirmed BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

UPDATE public.orders
SET discount_amount = 0
WHERE discount_amount IS NULL OR discount_amount < 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.orders'::regclass
          AND conname = 'orders_discount_amount_check'
    ) THEN
        ALTER TABLE public.orders
            ADD CONSTRAINT orders_discount_amount_check CHECK (discount_amount >= 0);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_orders_phone ON public.orders(phone);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON public.orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status, is_paid);

DROP TRIGGER IF EXISTS trg_orders_updated_at ON public.orders;
CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public insert orders" ON public.orders;
DROP POLICY IF EXISTS "Staff and Admin read orders" ON public.orders;
DROP POLICY IF EXISTS "Staff and Admin update orders" ON public.orders;
DROP POLICY IF EXISTS "Admin delete orders" ON public.orders;
DROP POLICY IF EXISTS "Staff, Manager and Admin read orders" ON public.orders;
DROP POLICY IF EXISTS "Staff, Manager and Admin update orders" ON public.orders;
DROP POLICY IF EXISTS "Manager and Admin delete orders" ON public.orders;

CREATE POLICY "Public insert orders"
    ON public.orders FOR INSERT
    TO anon
    WITH CHECK (true);

CREATE POLICY "Staff, Manager and Admin read orders"
    ON public.orders FOR SELECT
    TO authenticated
    USING (public.current_app_role() IN ('staff', 'manager', 'admin'));

CREATE POLICY "Staff, Manager and Admin update orders"
    ON public.orders FOR UPDATE
    TO authenticated
    USING (public.current_app_role() IN ('staff', 'manager', 'admin'))
    WITH CHECK (public.current_app_role() IN ('staff', 'manager', 'admin'));

CREATE POLICY "Manager and Admin delete orders"
    ON public.orders FOR DELETE
    TO authenticated
    USING (public.current_app_role() IN ('manager', 'admin'));

ALTER TABLE public.order_items
    ADD COLUMN IF NOT EXISTS sku TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS variant TEXT NOT NULL DEFAULT 'Tiêu chuẩn',
    ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'Cái',
    ADD COLUMN IF NOT EXISTS image_url TEXT;

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON public.order_items(product_id);

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public insert order_items" ON public.order_items;
DROP POLICY IF EXISTS "Staff and Admin read order_items" ON public.order_items;
DROP POLICY IF EXISTS "Admin manage order_items" ON public.order_items;
DROP POLICY IF EXISTS "Staff, Manager and Admin read order_items" ON public.order_items;
DROP POLICY IF EXISTS "Manager and Admin manage order_items" ON public.order_items;

CREATE POLICY "Public insert order_items"
    ON public.order_items FOR INSERT
    TO anon
    WITH CHECK (true);

CREATE POLICY "Staff, Manager and Admin read order_items"
    ON public.order_items FOR SELECT
    TO authenticated
    USING (public.current_app_role() IN ('staff', 'manager', 'admin'));

CREATE POLICY "Manager and Admin manage order_items"
    ON public.order_items FOR ALL
    TO authenticated
    USING (public.current_app_role() IN ('manager', 'admin'))
    WITH CHECK (public.current_app_role() IN ('manager', 'admin'));

-- ============================================================================
-- 06. Nâng cấp bảng purchase_orders & purchase_order_items (Manager & Admin)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_code TEXT NOT NULL UNIQUE,
    supplier_name TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
    created_by_email TEXT NOT NULL DEFAULT '',
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_imported_at ON public.purchase_orders(imported_at DESC);

DROP TRIGGER IF EXISTS trg_purchase_orders_updated_at ON public.purchase_orders;
CREATE TRIGGER trg_purchase_orders_updated_at
    BEFORE UPDATE ON public.purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin full access on purchase_orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "Manager and Admin full access on purchase_orders" ON public.purchase_orders;

CREATE POLICY "Manager and Admin full access on purchase_orders"
    ON public.purchase_orders FOR ALL
    TO authenticated
    USING (public.current_app_role() IN ('manager', 'admin'))
    WITH CHECK (public.current_app_role() IN ('manager', 'admin'));

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    sku TEXT NOT NULL DEFAULT '',
    product_name TEXT NOT NULL,
    unit_label TEXT NOT NULL DEFAULT 'Cái',
    conversion_factor NUMERIC(10, 2) NOT NULL DEFAULT 1 CHECK (conversion_factor > 0),
    quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    selling_price NUMERIC(12, 2),
    line_total NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (line_total >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.purchase_order_items
    ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS selling_price NUMERIC(12, 2);

CREATE INDEX IF NOT EXISTS idx_po_items_po_id ON public.purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_items_product_id ON public.purchase_order_items(product_id);

ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin full access on purchase_order_items" ON public.purchase_order_items;
DROP POLICY IF EXISTS "Manager and Admin full access on purchase_order_items" ON public.purchase_order_items;

CREATE POLICY "Manager and Admin full access on purchase_order_items"
    ON public.purchase_order_items FOR ALL
    TO authenticated
    USING (public.current_app_role() IN ('manager', 'admin'))
    WITH CHECK (public.current_app_role() IN ('manager', 'admin'));

-- ============================================================================
-- 07. Nâng cấp RPC create_public_order (hỗ trợ POS tại quầy & giảm giá toàn đơn)
-- ============================================================================
DROP FUNCTION IF EXISTS public.create_public_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.create_public_order(
    p_order_code TEXT,
    p_customer_name TEXT DEFAULT '',
    p_phone TEXT DEFAULT '',
    p_delivery_method TEXT DEFAULT 'delivery',
    p_address TEXT DEFAULT '',
    p_note TEXT DEFAULT '',
    p_payment_method TEXT DEFAULT 'transfer',
    p_items JSONB DEFAULT '[]'::jsonb,
    p_discount_amount NUMERIC(12, 2) DEFAULT 0,
    p_mark_confirmed BOOLEAN DEFAULT false,
    p_mark_paid BOOLEAN DEFAULT false,
    p_status TEXT DEFAULT 'pending'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_id UUID;
    v_customer_id UUID;
    v_created_at TIMESTAMPTZ;
    v_item JSONB;
    v_product_id UUID;
    v_raw_product_id TEXT;
    v_unit_price NUMERIC(12, 2);
    v_quantity NUMERIC(12, 2);
    v_line_total NUMERIC(12, 2);
    v_subtotal NUMERIC(12, 2) := 0;
    v_discount NUMERIC(12, 2) := 0;
    v_total_amount NUMERIC(12, 2) := 0;
    v_clean_phone TEXT;
    v_clean_name TEXT;
    v_clean_address TEXT;
    v_role TEXT;
    v_is_staff BOOLEAN := false;
    v_is_confirmed BOOLEAN := false;
    v_is_paid BOOLEAN := false;
    v_status TEXT := 'pending';
BEGIN
    IF COALESCE(TRIM(p_order_code), '') = '' THEN
        RAISE EXCEPTION 'Thiếu mã đơn hàng';
    END IF;

    v_clean_phone := REGEXP_REPLACE(COALESCE(TRIM(p_phone), ''), '[\s.-]', '', 'g');
    v_clean_name := COALESCE(TRIM(p_customer_name), '');
    v_clean_address := COALESCE(TRIM(p_address), '');
    v_role := public.current_app_role();
    v_is_staff := auth.uid() IS NOT NULL AND v_role IN ('staff', 'manager', 'admin');

    IF auth.uid() IS NULL AND v_clean_phone = '' THEN
        RAISE EXCEPTION 'Thiếu số điện thoại liên hệ';
    END IF;

    IF p_delivery_method NOT IN ('delivery', 'pickup') THEN
        RAISE EXCEPTION 'Hình thức nhận hàng không hợp lệ';
    END IF;

    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Đơn hàng phải có ít nhất 1 sản phẩm';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_unit_price := GREATEST(COALESCE((v_item->>'unit_price')::NUMERIC(12, 2), 0), 0);
        v_quantity := COALESCE((v_item->>'quantity')::NUMERIC(12, 2), 0);
        IF v_quantity <= 0 THEN
            RAISE EXCEPTION 'Số lượng sản phẩm phải lớn hơn 0';
        END IF;
        v_subtotal := v_subtotal + (v_unit_price * v_quantity);
    END LOOP;

    IF v_is_staff THEN
        v_discount := LEAST(GREATEST(COALESCE(p_discount_amount, 0), 0), v_subtotal);
        v_is_paid := COALESCE(p_mark_paid, false);
        v_status := CASE
            WHEN p_status IN ('pending', 'confirmed', 'shipping', 'completed', 'cancelled') THEN p_status
            ELSE 'pending'
        END;
        v_is_confirmed := COALESCE(p_mark_confirmed, false) OR v_status IN ('confirmed', 'shipping', 'completed');
    END IF;

    v_total_amount := GREATEST(v_subtotal - v_discount, 0);

    IF v_clean_phone <> '' THEN
        INSERT INTO public.customers (
            phone, full_name, default_address, total_orders, total_spent, last_order_at
        )
        VALUES (
            v_clean_phone,
            CASE WHEN v_clean_name = 'Khách lẻ' THEN '' ELSE v_clean_name END,
            CASE WHEN v_clean_address IN ('Tại quầy', 'Nhận tại CT2.1111') THEN '' ELSE v_clean_address END,
            1,
            v_total_amount,
            NOW()
        )
        ON CONFLICT (phone) DO UPDATE SET
            full_name = COALESCE(
                NULLIF(CASE WHEN EXCLUDED.full_name = 'Khách lẻ' THEN '' ELSE EXCLUDED.full_name END, ''),
                public.customers.full_name
            ),
            default_address = COALESCE(
                NULLIF(EXCLUDED.default_address, ''),
                public.customers.default_address
            ),
            total_orders = public.customers.total_orders + 1,
            total_spent = public.customers.total_spent + v_total_amount,
            last_order_at = NOW()
        RETURNING id INTO v_customer_id;
    END IF;

    INSERT INTO public.orders (
        order_code, customer_id, customer_name, phone, delivery_method, address, note,
        payment_method, subtotal, discount_amount, shipping_fee, total_amount,
        status, is_confirmed, is_paid, confirmed_at, paid_at
    )
    VALUES (
        TRIM(p_order_code),
        v_customer_id,
        v_clean_name,
        v_clean_phone,
        p_delivery_method,
        v_clean_address,
        COALESCE(TRIM(p_note), ''),
        COALESCE(NULLIF(TRIM(p_payment_method), ''), 'transfer'),
        v_subtotal,
        v_discount,
        0,
        v_total_amount,
        v_status,
        v_is_confirmed,
        v_is_paid,
        CASE WHEN v_is_confirmed THEN NOW() ELSE NULL END,
        CASE WHEN v_is_paid THEN NOW() ELSE NULL END
    )
    RETURNING id, created_at INTO v_order_id, v_created_at;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_raw_product_id := NULLIF(TRIM(COALESCE(v_item->>'product_id', '')), '');
        v_product_id := NULL;
        IF v_raw_product_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
            SELECT id INTO v_product_id FROM public.products WHERE id = v_raw_product_id::UUID;
        END IF;

        v_unit_price := GREATEST(COALESCE((v_item->>'unit_price')::NUMERIC(12, 2), 0), 0);
        v_quantity := COALESCE((v_item->>'quantity')::NUMERIC(12, 2), 1);
        v_line_total := v_unit_price * v_quantity;

        INSERT INTO public.order_items (
            order_id, product_id, sku, product_name, variant, unit,
            unit_price, quantity, line_total, image_url
        )
        VALUES (
            v_order_id,
            v_product_id,
            COALESCE(v_item->>'sku', ''),
            COALESCE(NULLIF(TRIM(v_item->>'product_name'), ''), 'Sản phẩm'),
            COALESCE(NULLIF(TRIM(v_item->>'variant'), ''), 'Tiêu chuẩn'),
            COALESCE(NULLIF(TRIM(v_item->>'unit'), ''), 'Cái'),
            v_unit_price,
            v_quantity,
            v_line_total,
            NULLIF(TRIM(COALESCE(v_item->>'image_url', '')), '')
        );
    END LOOP;

    RETURN jsonb_build_object(
        'id', v_order_id,
        'customer_id', v_customer_id,
        'order_code', TRIM(p_order_code),
        'created_at', v_created_at,
        'subtotal', v_subtotal,
        'discount_amount', v_discount,
        'total_amount', v_total_amount
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_public_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, BOOLEAN, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_public_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, BOOLEAN, BOOLEAN, TEXT) TO anon, authenticated;

-- ============================================================================
-- 08. Nâng cấp RPC create_purchase_order (chỉ Manager & Admin)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_purchase_order(
    p_po_code TEXT,
    p_supplier_name TEXT DEFAULT '',
    p_note TEXT DEFAULT '',
    p_update_cost_price BOOLEAN DEFAULT true,
    p_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role TEXT;
    v_email TEXT;
    v_po_id UUID;
    v_imported_at TIMESTAMPTZ;
    v_item JSONB;
    v_product_id UUID;
    v_raw_product_id TEXT;
    v_raw_cat_id TEXT;
    v_cat_id UUID;
    v_sku TEXT;
    v_product_name TEXT;
    v_qty NUMERIC(12, 2);
    v_conv NUMERIC(10, 2);
    v_unit_cost NUMERIC(12, 2);
    v_discount_pct NUMERIC(5, 2);
    v_discount_amt NUMERIC(12, 2);
    v_net_unit_cost NUMERIC(12, 2);
    v_selling_price NUMERIC(12, 2);
    v_has_selling_price BOOLEAN;
    v_is_new_product BOOLEAN;
    v_line_total NUMERIC(12, 2);
    v_total_amount NUMERIC(12, 2) := 0;
    v_item_count INTEGER := 0;
BEGIN
    v_role := public.current_app_role();
    IF v_role IS NULL OR v_role NOT IN ('manager', 'admin') THEN
        RAISE EXCEPTION 'Chỉ tài khoản quản lý (manager/admin) mới được phép tạo đơn nhập hàng';
    END IF;

    IF COALESCE(TRIM(p_po_code), '') = '' THEN
        RAISE EXCEPTION 'Thiếu mã đơn nhập hàng';
    END IF;

    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Đơn nhập hàng phải có ít nhất 1 mặt hàng';
    END IF;

    SELECT COALESCE(email, '') INTO v_email FROM public.user_profiles WHERE user_id = auth.uid();

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_qty := COALESCE((v_item->>'quantity')::NUMERIC(12, 2), 0);
        v_unit_cost := GREATEST(COALESCE((v_item->>'unit_cost')::NUMERIC(12, 2), 0), 0);
        v_discount_amt := GREATEST(COALESCE((v_item->>'discount_amount')::NUMERIC(12, 2), 0), 0);
        IF v_discount_amt > v_unit_cost THEN
            v_discount_amt := v_unit_cost;
        END IF;
        v_net_unit_cost := GREATEST(v_unit_cost - v_discount_amt, 0);
        IF v_qty <= 0 THEN
            RAISE EXCEPTION 'Số lượng nhập phải lớn hơn 0';
        END IF;
        v_total_amount := v_total_amount + (v_qty * v_net_unit_cost);
        v_item_count := v_item_count + 1;
    END LOOP;

    INSERT INTO public.purchase_orders (
        po_code, supplier_name, note, total_amount, item_count, created_by_email
    )
    VALUES (
        TRIM(p_po_code),
        COALESCE(TRIM(p_supplier_name), ''),
        COALESCE(TRIM(p_note), ''),
        v_total_amount,
        v_item_count,
        COALESCE(v_email, '')
    )
    RETURNING id, imported_at INTO v_po_id, v_imported_at;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_raw_product_id := NULLIF(TRIM(COALESCE(v_item->>'product_id', '')), '');
        v_sku := UPPER(TRIM(COALESCE(v_item->>'sku', '')));
        v_product_name := COALESCE(NULLIF(TRIM(v_item->>'product_name'), ''), 'Sản phẩm');
        v_is_new_product := COALESCE((v_item->>'is_new_product')::BOOLEAN, false);

        v_qty := COALESCE((v_item->>'quantity')::NUMERIC(12, 2), 1);
        v_conv := GREATEST(COALESCE((v_item->>'conversion_factor')::NUMERIC(10, 2), 1), 0.01);
        v_unit_cost := GREATEST(COALESCE((v_item->>'unit_cost')::NUMERIC(12, 2), 0), 0);
        v_discount_amt := LEAST(GREATEST(COALESCE((v_item->>'discount_amount')::NUMERIC(12, 2), 0), 0), v_unit_cost);
        v_discount_pct := LEAST(GREATEST(COALESCE((v_item->>'discount_percent')::NUMERIC(5, 2), 0), 0), 100);
        IF v_discount_pct = 0 AND v_unit_cost > 0 AND v_discount_amt > 0 THEN
            v_discount_pct := ROUND((v_discount_amt / v_unit_cost) * 100, 2);
        END IF;
        v_net_unit_cost := GREATEST(v_unit_cost - v_discount_amt, 0);
        v_line_total := v_qty * v_net_unit_cost;

        v_has_selling_price := (v_item ? 'selling_price') AND NULLIF(TRIM(COALESCE(v_item->>'selling_price', '')), '') IS NOT NULL;
        v_selling_price := CASE
            WHEN v_has_selling_price THEN GREATEST(COALESCE((v_item->>'selling_price')::NUMERIC(12, 2), 0), 0)
            ELSE NULL
        END;

        v_product_id := NULL;
        IF v_raw_product_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
            SELECT id INTO v_product_id FROM public.products WHERE id = v_raw_product_id::UUID;
        END IF;

        IF v_product_id IS NULL AND v_is_new_product THEN
            IF v_sku = '' THEN
                RAISE EXCEPTION 'Thiếu mã hàng (SKU) cho sản phẩm mới "%"', v_product_name;
            END IF;

            SELECT id INTO v_product_id FROM public.products WHERE UPPER(sku) = v_sku;
            IF v_product_id IS NULL THEN
                v_raw_cat_id := NULLIF(TRIM(COALESCE(v_item->>'category_id', '')), '');
                v_cat_id := NULL;
                IF v_raw_cat_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
                    SELECT id INTO v_cat_id FROM public.categories WHERE id = v_raw_cat_id::UUID;
                END IF;

                INSERT INTO public.products (
                    category_id, sku, barcode, name, brand, selling_price, cost_price,
                    stock_quantity, base_unit, unit, conversion_rate, image_urls, is_active
                )
                VALUES (
                    v_cat_id,
                    v_sku,
                    NULLIF(TRIM(COALESCE(v_item->>'barcode', '')), ''),
                    v_product_name,
                    NULLIF(TRIM(COALESCE(v_item->>'brand', '')), ''),
                    COALESCE(v_selling_price, 0),
                    ROUND(v_net_unit_cost / v_conv, 2),
                    0,
                    COALESCE(NULLIF(TRIM(v_item->>'base_unit'), ''), NULLIF(TRIM(v_item->>'unit_label'), ''), 'Cái'),
                    COALESCE(NULLIF(TRIM(v_item->>'unit'), ''), NULLIF(TRIM(v_item->>'unit_label'), ''), 'Cái'),
                    GREATEST(COALESCE((v_item->>'conversion_rate')::NUMERIC(10, 2), v_conv), 0.01),
                    CASE
                        WHEN jsonb_typeof(v_item->'image_urls') = 'array' THEN
                            ARRAY(SELECT jsonb_array_elements_text(v_item->'image_urls'))
                        ELSE '{}'::TEXT[]
                    END,
                    true
                )
                RETURNING id INTO v_product_id;
            END IF;
        END IF;

        INSERT INTO public.purchase_order_items (
            purchase_order_id, product_id, sku, product_name, unit_label,
            conversion_factor, quantity, unit_cost, discount_percent, discount_amount,
            selling_price, line_total
        )
        VALUES (
            v_po_id,
            v_product_id,
            v_sku,
            v_product_name,
            COALESCE(NULLIF(TRIM(v_item->>'unit_label'), ''), 'Cái'),
            v_conv,
            v_qty,
            v_unit_cost,
            v_discount_pct,
            v_discount_amt,
            v_selling_price,
            v_line_total
        );

        IF v_product_id IS NOT NULL THEN
            UPDATE public.products
            SET
                stock_quantity = stock_quantity + (v_qty * v_conv),
                cost_price = CASE
                    WHEN p_update_cost_price AND v_net_unit_cost >= 0 AND v_unit_cost > 0
                    THEN ROUND(v_net_unit_cost / v_conv, 2)
                    ELSE cost_price
                END,
                selling_price = CASE
                    WHEN v_selling_price IS NOT NULL
                    THEN v_selling_price
                    ELSE selling_price
                END
            WHERE id = v_product_id;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'id', v_po_id,
        'po_code', TRIM(p_po_code),
        'imported_at', v_imported_at,
        'total_amount', v_total_amount,
        'item_count', v_item_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_purchase_order(TEXT, TEXT, TEXT, BOOLEAN, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(TEXT, TEXT, TEXT, BOOLEAN, JSONB) TO authenticated;

-- ============================================================================
-- 09. Nâng cấp Supabase Storage (bucket: product-images) cho Manager & Admin
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'product-images',
    'product-images',
    true,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public read product images" ON storage.objects;
DROP POLICY IF EXISTS "Admin upload product images" ON storage.objects;
DROP POLICY IF EXISTS "Admin update product images" ON storage.objects;
DROP POLICY IF EXISTS "Admin delete product images" ON storage.objects;

CREATE POLICY "Public read product images"
    ON storage.objects FOR SELECT
    TO anon, authenticated
    USING (bucket_id = 'product-images');

CREATE POLICY "Admin upload product images"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'product-images'
        AND public.current_app_role() IN ('manager', 'admin')
    );

CREATE POLICY "Admin update product images"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'product-images'
        AND public.current_app_role() IN ('manager', 'admin')
    )
    WITH CHECK (
        bucket_id = 'product-images'
        AND public.current_app_role() IN ('manager', 'admin')
    );

CREATE POLICY "Admin delete product images"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'product-images'
        AND public.current_app_role() IN ('manager', 'admin')
    );

-- ============================================================================
-- SCHEMA KHỞI TẠO CƠ SỞ DỮ LIỆU SUPABASE MỚI (DÙNG CHO CỬA HÀNG MỚI TỪ ĐẦU)
-- Chú ý: Script này sẽ XÓA và TẠO LẠI toàn bộ bảng/hàm/view nếu đã tồn tại.
-- Chỉ dùng khi khởi tạo database mới tinh cho một shop mới.
-- Nếu muốn nâng cấp DB đang chạy mà KHÔNG mất dữ liệu, hãy chạy lần lượt các file
-- db_creat/upgrade_schema_01.sql, upgrade_schema_02.sql, ...
-- ============================================================================

-- 00. DỌN DẸP CẤU TRÚC CŨ (Nếu chạy trên DB mới reset)
DROP VIEW IF EXISTS public.public_products;
DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user_profile();
DROP FUNCTION IF EXISTS public.delete_cash_voucher(UUID);
DROP FUNCTION IF EXISTS public.create_cash_voucher(TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.merge_customers(UUID, UUID[], JSONB);
DROP FUNCTION IF EXISTS public.delete_customers_to_guest(UUID[]);
DROP FUNCTION IF EXISTS public.create_purchase_order(TEXT, TEXT, TEXT, BOOLEAN, JSONB, UUID, JSONB, NUMERIC);
DROP FUNCTION IF EXISTS public.create_purchase_order(TEXT, TEXT, TEXT, BOOLEAN, JSONB, UUID);
DROP FUNCTION IF EXISTS public.create_purchase_order(TEXT, TEXT, TEXT, BOOLEAN, JSONB);
DROP FUNCTION IF EXISTS public.update_public_order(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.update_public_order(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, BOOLEAN, BOOLEAN, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.create_public_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, JSONB);
DROP FUNCTION IF EXISTS public.create_public_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, BOOLEAN, BOOLEAN, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.create_public_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, BOOLEAN, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.create_public_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.trg_fn_refresh_product_ordered_on_order();
DROP FUNCTION IF EXISTS public.trg_fn_refresh_product_ordered_on_item();
DROP FUNCTION IF EXISTS public.refresh_product_ordered_quantity(UUID);
DROP FUNCTION IF EXISTS public.current_app_role();

DROP TABLE IF EXISTS public.cash_vouchers CASCADE;
DROP TABLE IF EXISTS public.purchase_order_items CASCADE;
DROP TABLE IF EXISTS public.purchase_orders CASCADE;
DROP TABLE IF EXISTS public.suppliers CASCADE;
DROP TABLE IF EXISTS public.order_items CASCADE;
DROP TABLE IF EXISTS public.orders CASCADE;
DROP TABLE IF EXISTS public.customers CASCADE;
DROP TABLE IF EXISTS public.products CASCADE;
DROP TABLE IF EXISTS public.categories CASCADE;
DROP TABLE IF EXISTS public.user_profiles CASCADE;

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
-- 01. Bảng Hồ sơ & Phân quyền Người dùng (user_profiles)
-- Phân loại role:
--   - 'staff':   Nhân viên    -> chỉ truy cập Đơn hàng & Khách hàng
--   - 'manager': Quản lý      -> Đơn hàng, Khách hàng, Hàng hóa, Nhập hàng
--   - 'admin':   Quản trị viên -> toàn quyền hệ thống (bao gồm Người dùng)
-- ============================================================================
CREATE TABLE public.user_profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL DEFAULT '',
    full_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('staff', 'manager', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_user_profiles_updated_at
    BEFORE UPDATE ON public.user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- Hàm lấy role hiện tại của user đang đăng nhập (SECURITY DEFINER tránh đệ quy RLS)
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

-- Tự động tạo hồ sơ mặc định role = 'staff' khi tạo user mới trong Authentication
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

CREATE TRIGGER on_auth_user_created_profile
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user_profile();

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own profile"
    ON public.user_profiles FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Admin manage all profiles"
    ON public.user_profiles FOR ALL
    TO authenticated
    USING (public.current_app_role() = 'admin')
    WITH CHECK (public.current_app_role() = 'admin');

INSERT INTO public.user_profiles (user_id, email, phone, notes, role)
SELECT id, COALESCE(email, ''), COALESCE(phone, ''), '', 'staff'
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================================
-- 02. Bảng Danh mục đa cấp (categories)
-- ============================================================================
CREATE TABLE public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    parent_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_categories_parent_id ON public.categories(parent_id);

CREATE TRIGGER trg_categories_updated_at
    BEFORE UPDATE ON public.categories
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

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
-- 03. Bảng Hàng hóa (products)
-- ============================================================================
CREATE TABLE public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    sku TEXT NOT NULL UNIQUE,
    barcode TEXT UNIQUE,
    name TEXT NOT NULL,
    brand TEXT,
    selling_price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
    cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
    stock_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ordered_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0,
    purchase_pack_options JSONB NOT NULL DEFAULT '[]'::jsonb,
    min_stock NUMERIC(12, 2),
    max_stock NUMERIC(12, 2),
    base_unit TEXT NOT NULL DEFAULT 'Cái',
    unit TEXT NOT NULL DEFAULT 'Cái',
    conversion_rate NUMERIC(10, 2) NOT NULL DEFAULT 1 CHECK (conversion_rate > 0),
    variants TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    image_urls TEXT[],
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_products_category_id ON public.products(category_id);
CREATE INDEX idx_products_name ON public.products(name);

CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON public.products
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manager and Admin full access on products"
    ON public.products FOR ALL
    TO authenticated
    USING (public.current_app_role() IN ('manager', 'admin'))
    WITH CHECK (public.current_app_role() IN ('manager', 'admin'));

-- ============================================================================
-- VIEW CÔNG KHAI CHO TRANG BÁN HÀNG (public_products)
-- Ẩn cost_price, notes; chỉ trả về stock_quantity khi đã đăng nhập
-- ============================================================================
CREATE VIEW public.public_products AS
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
    CASE
        WHEN auth.uid() IS NOT NULL THEN p.stock_quantity
        ELSE NULL
    END AS stock_quantity,
    CASE
        WHEN auth.uid() IS NOT NULL THEN p.ordered_quantity
        ELSE NULL
    END AS ordered_quantity,
    p.base_unit,
    p.unit,
    p.conversion_rate,
    p.variants,
    p.image_urls,
    p.created_at
FROM public.products p
LEFT JOIN public.categories c ON p.category_id = c.id
WHERE p.is_active = true
  AND (c.is_active IS NULL OR c.is_active = true);

GRANT SELECT ON public.public_products TO anon, authenticated;

-- ============================================================================
-- 04. Bảng Khách hàng (customers)
-- ============================================================================
CREATE TABLE public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL DEFAULT '',
    default_address TEXT NOT NULL DEFAULT '',
    area TEXT,
    customer_group TEXT NOT NULL DEFAULT 'Khách lẻ',
    tax_code TEXT,
    bank_account TEXT,
    bank_name TEXT,
    email TEXT,
    credit_limit NUMERIC(12, 2),
    notes TEXT NOT NULL DEFAULT '',
    total_orders INTEGER NOT NULL DEFAULT 0 CHECK (total_orders >= 0),
    total_spent NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_spent >= 0),
    last_order_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customers_phone ON public.customers(phone);
CREATE INDEX idx_customers_last_order ON public.customers(last_order_at DESC);
CREATE INDEX idx_customers_area ON public.customers(area);
CREATE INDEX idx_customers_group ON public.customers(customer_group);

CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON public.customers
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

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
-- 05. Bảng Đơn hàng (orders) & Chi tiết Đơn hàng (order_items)
-- ============================================================================
CREATE TABLE public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_code TEXT NOT NULL UNIQUE,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    delivery_method TEXT NOT NULL DEFAULT 'delivery'
        CHECK (delivery_method IN ('delivery', 'pickup')),
    address TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    payment_method TEXT NOT NULL DEFAULT 'transfer',
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    shipping_fee NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0),
    extra_fees JSONB NOT NULL DEFAULT '[]'::jsonb,
    extra_fee_total NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (extra_fee_total >= 0),
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'shipping', 'completed', 'cancelled')),
    is_confirmed BOOLEAN NOT NULL DEFAULT false,
    is_delivered BOOLEAN NOT NULL DEFAULT false,
    is_paid BOOLEAN NOT NULL DEFAULT false,
    confirmed_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_phone ON public.orders(phone);
CREATE INDEX idx_orders_customer_id ON public.orders(customer_id);
CREATE INDEX idx_orders_created_at ON public.orders(created_at DESC);
CREATE INDEX idx_orders_status ON public.orders(status, is_paid);

CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

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

CREATE TABLE public.order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    sku TEXT NOT NULL DEFAULT '',
    product_name TEXT NOT NULL,
    variant TEXT NOT NULL DEFAULT 'Tiêu chuẩn',
    unit TEXT NOT NULL DEFAULT 'Cái',
    unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
    quantity NUMERIC(12, 2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    line_total NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (line_total >= 0),
    image_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX idx_order_items_product_id ON public.order_items(product_id);

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

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

-- Hàm & Trigger tự động tính cột ordered_quantity trong products
CREATE OR REPLACE FUNCTION public.refresh_product_ordered_quantity(p_product_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_total NUMERIC(12, 2);
BEGIN
    IF p_product_id IS NULL THEN
        RETURN;
    END IF;

    SELECT COALESCE(SUM(oi.quantity), 0)
    INTO v_total
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.product_id = p_product_id
      AND COALESCE(o.is_delivered, false) = false
      AND o.status NOT IN ('completed', 'cancelled');

    UPDATE public.products
    SET ordered_quantity = GREATEST(COALESCE(v_total, 0), 0)
    WHERE id = p_product_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_fn_refresh_product_ordered_on_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.refresh_product_ordered_quantity(OLD.product_id);
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.product_id IS DISTINCT FROM NEW.product_id THEN
            PERFORM public.refresh_product_ordered_quantity(OLD.product_id);
        END IF;
        PERFORM public.refresh_product_ordered_quantity(NEW.product_id);
        RETURN NEW;
    ELSE
        PERFORM public.refresh_product_ordered_quantity(NEW.product_id);
        RETURN NEW;
    END IF;
END;
$$;

CREATE TRIGGER trg_refresh_product_ordered_on_item_change
    AFTER INSERT OR UPDATE OR DELETE ON public.order_items
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_fn_refresh_product_ordered_on_item();

CREATE OR REPLACE FUNCTION public.trg_fn_refresh_product_ordered_on_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prod_id UUID;
BEGIN
    FOR v_prod_id IN
        SELECT DISTINCT product_id
        FROM public.order_items
        WHERE order_id = NEW.id
          AND product_id IS NOT NULL
    LOOP
        PERFORM public.refresh_product_ordered_quantity(v_prod_id);
    END LOOP;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_refresh_product_ordered_on_order_change
    AFTER UPDATE OF status, is_delivered ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_fn_refresh_product_ordered_on_order();

-- ============================================================================
-- 06. Bảng Nhà cung cấp (suppliers), Đơn nhập hàng (purchase_orders) & Chi tiết nhập
-- ============================================================================
CREATE TABLE public.suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    short_name TEXT,
    tax_code TEXT,
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    area TEXT,
    payment_terms TEXT,
    bank_account TEXT,
    bank_name TEXT,
    email TEXT,
    supply_category TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_suppliers_name ON public.suppliers(name);
CREATE INDEX idx_suppliers_short_name ON public.suppliers(short_name);
CREATE INDEX idx_suppliers_phone ON public.suppliers(phone);

CREATE TRIGGER trg_suppliers_updated_at
    BEFORE UPDATE ON public.suppliers
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manager and Admin full access on suppliers"
    ON public.suppliers FOR ALL
    TO authenticated
    USING (public.current_app_role() IN ('manager', 'admin'))
    WITH CHECK (public.current_app_role() IN ('manager', 'admin'));

CREATE TABLE public.purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_code TEXT NOT NULL UNIQUE,
    supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
    supplier_name TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    extra_fees JSONB NOT NULL DEFAULT '[]'::jsonb,
    extra_fee_total NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (extra_fee_total >= 0),
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    is_paid BOOLEAN NOT NULL DEFAULT true,
    item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
    created_by_email TEXT NOT NULL DEFAULT '',
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_purchase_orders_supplier_id ON public.purchase_orders(supplier_id);
CREATE INDEX idx_purchase_orders_imported_at ON public.purchase_orders(imported_at DESC);

CREATE TRIGGER trg_purchase_orders_updated_at
    BEFORE UPDATE ON public.purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manager and Admin full access on purchase_orders"
    ON public.purchase_orders FOR ALL
    TO authenticated
    USING (public.current_app_role() IN ('manager', 'admin'))
    WITH CHECK (public.current_app_role() IN ('manager', 'admin'));

CREATE TABLE public.purchase_order_items (
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

CREATE INDEX idx_po_items_po_id ON public.purchase_order_items(purchase_order_id);
CREATE INDEX idx_po_items_product_id ON public.purchase_order_items(product_id);

ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manager and Admin full access on purchase_order_items"
    ON public.purchase_order_items FOR ALL
    TO authenticated
    USING (public.current_app_role() IN ('manager', 'admin'))
    WITH CHECK (public.current_app_role() IN ('manager', 'admin'));

-- ============================================================================
-- 06b. Bảng Phiếu Thu / Phiếu Chi (cash_vouchers)
-- ============================================================================
CREATE TABLE public.cash_vouchers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_code TEXT NOT NULL UNIQUE,
    voucher_type TEXT NOT NULL CHECK (voucher_type IN ('receipt', 'payment')),
    category TEXT NOT NULL CHECK (
        category IN (
            'customer_debt',
            'sales_income',
            'supplier_refund',
            'other_income',
            'supplier_debt',
            'purchase_expense',
            'shipping_fee',
            'operating_expense',
            'customer_refund',
            'other_expense'
        )
    ),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    payment_method TEXT NOT NULL DEFAULT 'cash',
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    purchase_order_id UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
    related_code TEXT NOT NULL DEFAULT '',
    counterparty_name TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    voucher_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_email TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cash_vouchers_type ON public.cash_vouchers(voucher_type);
CREATE INDEX idx_cash_vouchers_category ON public.cash_vouchers(category);
CREATE INDEX idx_cash_vouchers_date ON public.cash_vouchers(voucher_date DESC);
CREATE INDEX idx_cash_vouchers_customer ON public.cash_vouchers(customer_id);
CREATE INDEX idx_cash_vouchers_supplier ON public.cash_vouchers(supplier_id);
CREATE INDEX idx_cash_vouchers_order ON public.cash_vouchers(order_id);
CREATE INDEX idx_cash_vouchers_po ON public.cash_vouchers(purchase_order_id);

CREATE TRIGGER trg_cash_vouchers_updated_at
    BEFORE UPDATE ON public.cash_vouchers
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.cash_vouchers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff, Manager and Admin read cash_vouchers"
    ON public.cash_vouchers FOR SELECT
    TO authenticated
    USING (public.current_app_role() IN ('staff', 'manager', 'admin'));

CREATE POLICY "Staff insert customer cash_vouchers"
    ON public.cash_vouchers FOR INSERT
    TO authenticated
    WITH CHECK (
        public.current_app_role() = 'staff'
        AND category IN ('customer_debt', 'sales_income', 'customer_refund')
    );

CREATE POLICY "Manager and Admin full access on cash_vouchers"
    ON public.cash_vouchers FOR ALL
    TO authenticated
    USING (public.current_app_role() IN ('manager', 'admin'))
    WITH CHECK (public.current_app_role() IN ('manager', 'admin'));

-- ============================================================================
-- 07. RPC đặt hàng công khai & POS tại quầy (create_public_order)
-- ============================================================================
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
    p_status TEXT DEFAULT 'pending',
    p_mark_delivered BOOLEAN DEFAULT false,
    p_extra_fees JSONB DEFAULT '[]'::jsonb
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
    v_fee JSONB;
    v_fee_label TEXT;
    v_fee_amount NUMERIC(12, 2);
    v_clean_extra_fees JSONB := '[]'::jsonb;
    v_extra_fee_total NUMERIC(12, 2) := 0;
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
    v_is_delivered BOOLEAN := false;
    v_is_paid BOOLEAN := false;
    v_paid_amount NUMERIC(12, 2) := 0;
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

        IF jsonb_typeof(p_extra_fees) = 'array' THEN
            FOR v_fee IN SELECT * FROM jsonb_array_elements(p_extra_fees)
            LOOP
                v_fee_label := COALESCE(NULLIF(TRIM(v_fee->>'label'), ''), 'Phụ phí');
                v_fee_amount := GREATEST(COALESCE((v_fee->>'amount')::NUMERIC(12, 2), 0), 0);
                IF v_fee_amount > 0 THEN
                    v_extra_fee_total := v_extra_fee_total + v_fee_amount;
                    v_clean_extra_fees := v_clean_extra_fees || jsonb_build_object(
                        'label', v_fee_label,
                        'amount', v_fee_amount
                    );
                END IF;
            END LOOP;
        END IF;

        v_is_paid := COALESCE(p_mark_paid, false);
        v_status := CASE
            WHEN p_status IN ('pending', 'confirmed', 'shipping', 'completed', 'cancelled') THEN p_status
            ELSE 'pending'
        END;
        v_is_delivered := COALESCE(p_mark_delivered, false) OR v_status = 'completed';
        v_is_confirmed := COALESCE(p_mark_confirmed, false) OR v_status IN ('confirmed', 'shipping', 'completed');
    END IF;

    v_total_amount := GREATEST(v_subtotal - v_discount, 0) + v_extra_fee_total;
    v_paid_amount := CASE WHEN v_is_paid THEN v_total_amount ELSE 0 END;

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
        payment_method, subtotal, discount_amount, shipping_fee, extra_fees, extra_fee_total,
        total_amount, paid_amount, status, is_confirmed, is_delivered, is_paid,
        confirmed_at, delivered_at, paid_at
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
        v_clean_extra_fees,
        v_extra_fee_total,
        v_total_amount,
        v_paid_amount,
        v_status,
        v_is_confirmed,
        v_is_delivered,
        v_is_paid,
        CASE WHEN v_is_confirmed THEN NOW() ELSE NULL END,
        CASE WHEN v_is_delivered THEN NOW() ELSE NULL END,
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
        'extra_fee_total', v_extra_fee_total,
        'total_amount', v_total_amount,
        'paid_amount', v_paid_amount
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_public_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_public_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, JSONB) TO anon, authenticated;

-- RPC cập nhật đơn hàng đã đặt từ tab POS (update_public_order)
CREATE OR REPLACE FUNCTION public.update_public_order(
    p_order_id UUID DEFAULT NULL,
    p_order_code TEXT DEFAULT '',
    p_customer_name TEXT DEFAULT '',
    p_phone TEXT DEFAULT '',
    p_delivery_method TEXT DEFAULT 'delivery',
    p_address TEXT DEFAULT '',
    p_note TEXT DEFAULT '',
    p_payment_method TEXT DEFAULT 'transfer',
    p_items JSONB DEFAULT '[]'::jsonb,
    p_discount_amount NUMERIC(12, 2) DEFAULT 0,
    p_mark_confirmed BOOLEAN DEFAULT false,
    p_mark_delivered BOOLEAN DEFAULT false,
    p_mark_paid BOOLEAN DEFAULT false,
    p_status TEXT DEFAULT 'pending',
    p_extra_fees JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role TEXT;
    v_target_order_id UUID;
    v_prev_is_paid BOOLEAN := false;
    v_prev_paid_amount NUMERIC(12, 2) := 0;
    v_item JSONB;
    v_fee JSONB;
    v_fee_label TEXT;
    v_fee_amount NUMERIC(12, 2);
    v_clean_extra_fees JSONB := '[]'::jsonb;
    v_extra_fee_total NUMERIC(12, 2) := 0;
    v_product_id UUID;
    v_raw_product_id TEXT;
    v_unit_price NUMERIC(12, 2);
    v_quantity NUMERIC(12, 2);
    v_line_total NUMERIC(12, 2);
    v_subtotal NUMERIC(12, 2) := 0;
    v_discount NUMERIC(12, 2) := 0;
    v_total_amount NUMERIC(12, 2) := 0;
    v_is_confirmed BOOLEAN := false;
    v_is_delivered BOOLEAN := false;
    v_is_paid BOOLEAN := false;
    v_paid_amount NUMERIC(12, 2) := 0;
    v_status TEXT := 'pending';
BEGIN
    v_role := public.current_app_role();
    IF auth.uid() IS NULL OR v_role NOT IN ('staff', 'manager', 'admin') THEN
        RAISE EXCEPTION 'Chỉ nhân viên, quản lý hoặc quản trị viên mới được phép sửa đơn hàng';
    END IF;

    IF p_order_id IS NOT NULL THEN
        SELECT id, is_paid, paid_amount
        INTO v_target_order_id, v_prev_is_paid, v_prev_paid_amount
        FROM public.orders
        WHERE id = p_order_id;
    END IF;

    IF v_target_order_id IS NULL AND COALESCE(TRIM(p_order_code), '') <> '' THEN
        SELECT id, is_paid, paid_amount
        INTO v_target_order_id, v_prev_is_paid, v_prev_paid_amount
        FROM public.orders
        WHERE order_code = TRIM(p_order_code);
    END IF;

    IF v_target_order_id IS NULL THEN
        RAISE EXCEPTION 'Không tìm thấy đơn hàng cần cập nhật';
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

    IF jsonb_typeof(p_extra_fees) = 'array' THEN
        FOR v_fee IN SELECT * FROM jsonb_array_elements(p_extra_fees)
        LOOP
            v_fee_label := COALESCE(NULLIF(TRIM(v_fee->>'label'), ''), 'Phụ phí');
            v_fee_amount := GREATEST(COALESCE((v_fee->>'amount')::NUMERIC(12, 2), 0), 0);
            IF v_fee_amount > 0 THEN
                v_extra_fee_total := v_extra_fee_total + v_fee_amount;
                v_clean_extra_fees := v_clean_extra_fees || jsonb_build_object(
                    'label', v_fee_label,
                    'amount', v_fee_amount
                );
            END IF;
        END LOOP;
    END IF;

    v_discount := LEAST(GREATEST(COALESCE(p_discount_amount, 0), 0), v_subtotal);
    v_total_amount := GREATEST(v_subtotal - v_discount, 0) + v_extra_fee_total;
    v_status := CASE
        WHEN p_status IN ('pending', 'confirmed', 'shipping', 'completed', 'cancelled') THEN p_status
        ELSE 'pending'
    END;
    v_is_delivered := COALESCE(p_mark_delivered, false) OR v_status = 'completed';
    v_is_confirmed := COALESCE(p_mark_confirmed, false) OR v_status IN ('confirmed', 'shipping', 'completed');
    v_is_paid := COALESCE(p_mark_paid, false);
    v_paid_amount := CASE
        WHEN v_is_paid THEN v_total_amount
        WHEN v_prev_is_paid AND NOT v_is_paid THEN 0
        ELSE LEAST(v_total_amount, GREATEST(COALESCE(v_prev_paid_amount, 0), 0))
    END;

    UPDATE public.orders
    SET
        customer_name = COALESCE(TRIM(p_customer_name), ''),
        phone = REGEXP_REPLACE(COALESCE(TRIM(p_phone), ''), '[\s.-]', '', 'g'),
        delivery_method = p_delivery_method,
        address = COALESCE(TRIM(p_address), ''),
        note = COALESCE(TRIM(p_note), ''),
        payment_method = COALESCE(NULLIF(TRIM(p_payment_method), ''), 'transfer'),
        subtotal = v_subtotal,
        discount_amount = v_discount,
        extra_fees = v_clean_extra_fees,
        extra_fee_total = v_extra_fee_total,
        total_amount = v_total_amount,
        paid_amount = v_paid_amount,
        status = v_status,
        is_confirmed = v_is_confirmed,
        is_delivered = v_is_delivered,
        is_paid = v_is_paid,
        confirmed_at = CASE WHEN v_is_confirmed THEN COALESCE(confirmed_at, NOW()) ELSE NULL END,
        delivered_at = CASE WHEN v_is_delivered THEN COALESCE(delivered_at, NOW()) ELSE NULL END,
        paid_at = CASE WHEN v_is_paid THEN COALESCE(paid_at, NOW()) ELSE NULL END
    WHERE id = v_target_order_id;

    DELETE FROM public.order_items WHERE order_id = v_target_order_id;

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
            v_target_order_id,
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
        'id', v_target_order_id,
        'order_code', TRIM(p_order_code),
        'subtotal', v_subtotal,
        'discount_amount', v_discount,
        'extra_fee_total', v_extra_fee_total,
        'total_amount', v_total_amount,
        'paid_amount', v_paid_amount
    );
END;
$$;

REVOKE ALL ON FUNCTION public.update_public_order(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_public_order(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, JSONB) TO authenticated;

-- ============================================================================
-- 08. RPC tạo đơn nhập hàng (create_purchase_order) - Manager & Admin
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_purchase_order(
    p_po_code TEXT,
    p_supplier_name TEXT DEFAULT '',
    p_note TEXT DEFAULT '',
    p_update_cost_price BOOLEAN DEFAULT true,
    p_items JSONB DEFAULT '[]'::jsonb,
    p_supplier_id UUID DEFAULT NULL,
    p_extra_fees JSONB DEFAULT '[]'::jsonb,
    p_paid_amount NUMERIC(12, 2) DEFAULT NULL
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
    v_supplier_id UUID := NULL;
    v_supplier_name TEXT := COALESCE(TRIM(p_supplier_name), '');
    v_item JSONB;
    v_fee JSONB;
    v_fee_label TEXT;
    v_fee_amount NUMERIC(12, 2);
    v_clean_extra_fees JSONB := '[]'::jsonb;
    v_extra_fee_total NUMERIC(12, 2) := 0;
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
    v_items_total NUMERIC(12, 2) := 0;
    v_total_amount NUMERIC(12, 2) := 0;
    v_paid_amount NUMERIC(12, 2) := 0;
    v_is_paid BOOLEAN := true;
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

    IF p_supplier_id IS NOT NULL THEN
        SELECT id, COALESCE(NULLIF(v_supplier_name, ''), name)
        INTO v_supplier_id, v_supplier_name
        FROM public.suppliers
        WHERE id = p_supplier_id;
    END IF;

    SELECT COALESCE(email, '') INTO v_email FROM public.user_profiles WHERE user_id = auth.uid();

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_qty := COALESCE((v_item->>'quantity')::NUMERIC(12, 2), 0);
        v_unit_cost := GREATEST(COALESCE((v_item->>'unit_cost')::NUMERIC(12, 2), 0), 0);
        v_discount_pct := LEAST(GREATEST(COALESCE((v_item->>'discount_percent')::NUMERIC(5, 2), 0), 0), 100);
        v_discount_amt := GREATEST(COALESCE((v_item->>'discount_amount')::NUMERIC(12, 2), 0), 0);
        IF v_discount_amt = 0 AND v_discount_pct > 0 AND v_unit_cost > 0 THEN
            v_discount_amt := ROUND((v_unit_cost * v_discount_pct) / 100, 2);
        END IF;
        IF v_discount_amt > v_unit_cost THEN
            v_discount_amt := v_unit_cost;
        END IF;
        v_net_unit_cost := GREATEST(v_unit_cost - v_discount_amt, 0);
        IF v_qty <= 0 THEN
            RAISE EXCEPTION 'Số lượng nhập phải lớn hơn 0';
        END IF;
        v_items_total := v_items_total + (v_qty * v_net_unit_cost);
        v_item_count := v_item_count + 1;
    END LOOP;

    IF jsonb_typeof(p_extra_fees) = 'array' THEN
        FOR v_fee IN SELECT * FROM jsonb_array_elements(p_extra_fees)
        LOOP
            v_fee_label := COALESCE(NULLIF(TRIM(v_fee->>'label'), ''), 'Phụ phí');
            v_fee_amount := GREATEST(COALESCE((v_fee->>'amount')::NUMERIC(12, 2), 0), 0);
            IF v_fee_amount > 0 THEN
                v_extra_fee_total := v_extra_fee_total + v_fee_amount;
                v_clean_extra_fees := v_clean_extra_fees || jsonb_build_object(
                    'label', v_fee_label,
                    'amount', v_fee_amount
                );
            END IF;
        END LOOP;
    END IF;

    v_total_amount := v_items_total + v_extra_fee_total;
    v_paid_amount := CASE
        WHEN p_paid_amount IS NULL THEN v_total_amount
        ELSE LEAST(v_total_amount, GREATEST(p_paid_amount, 0))
    END;
    v_is_paid := (v_total_amount = 0) OR (v_paid_amount >= v_total_amount);

    INSERT INTO public.purchase_orders (
        po_code, supplier_id, supplier_name, note,
        extra_fees, extra_fee_total, total_amount, paid_amount, is_paid,
        item_count, created_by_email
    )
    VALUES (
        TRIM(p_po_code),
        v_supplier_id,
        COALESCE(v_supplier_name, ''),
        COALESCE(TRIM(p_note), ''),
        v_clean_extra_fees,
        v_extra_fee_total,
        v_total_amount,
        v_paid_amount,
        v_is_paid,
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
        v_discount_pct := LEAST(GREATEST(COALESCE((v_item->>'discount_percent')::NUMERIC(5, 2), 0), 0), 100);
        v_discount_amt := GREATEST(COALESCE((v_item->>'discount_amount')::NUMERIC(12, 2), 0), 0);
        IF v_discount_amt = 0 AND v_discount_pct > 0 AND v_unit_cost > 0 THEN
            v_discount_amt := ROUND((v_unit_cost * v_discount_pct) / 100, 2);
        END IF;
        v_discount_amt := LEAST(v_discount_amt, v_unit_cost);
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
                        WHEN jsonb_typeof(v_item->'image_urls') = 'array' AND jsonb_array_length(v_item->'image_urls') > 0 THEN
                            ARRAY(SELECT jsonb_array_elements_text(v_item->'image_urls'))
                        ELSE NULL
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
                    WHEN p_update_cost_price AND v_net_unit_cost >= 0 AND v_unit_cost >= 0
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
        'supplier_id', v_supplier_id,
        'imported_at', v_imported_at,
        'extra_fee_total', v_extra_fee_total,
        'total_amount', v_total_amount,
        'paid_amount', v_paid_amount,
        'is_paid', v_is_paid,
        'item_count', v_item_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_purchase_order(TEXT, TEXT, TEXT, BOOLEAN, JSONB, UUID, JSONB, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(TEXT, TEXT, TEXT, BOOLEAN, JSONB, UUID, JSONB, NUMERIC) TO authenticated;

-- ============================================================================
-- 08b. RPC quản lý Khách hàng (xóa chuyển khách lẻ, gộp) & Phiếu Thu/Chi
-- ============================================================================
CREATE OR REPLACE FUNCTION public.delete_customers_to_guest(
    p_customer_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role TEXT;
    v_unlinked_orders INTEGER := 0;
    v_deleted_count INTEGER := 0;
BEGIN
    v_role := public.current_app_role();
    IF v_role IS NULL OR v_role NOT IN ('manager', 'admin') THEN
        RAISE EXCEPTION 'Chỉ quản lý (manager/admin) mới được phép xóa khách hàng';
    END IF;

    IF p_customer_ids IS NULL OR COALESCE(array_length(p_customer_ids, 1), 0) = 0 THEN
        RETURN jsonb_build_object('deleted_count', 0, 'unlinked_orders', 0);
    END IF;

    UPDATE public.orders
    SET customer_id = NULL
    WHERE customer_id = ANY(p_customer_ids);
    GET DIAGNOSTICS v_unlinked_orders = ROW_COUNT;

    UPDATE public.cash_vouchers
    SET customer_id = NULL
    WHERE customer_id = ANY(p_customer_ids);

    DELETE FROM public.customers
    WHERE id = ANY(p_customer_ids);
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'deleted_count', v_deleted_count,
        'unlinked_orders', v_unlinked_orders
    );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_customers_to_guest(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_customers_to_guest(UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.merge_customers(
    p_primary_id UUID,
    p_duplicate_ids UUID[],
    p_merged JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role TEXT;
    v_dup_ids UUID[];
    v_primary public.customers%ROWTYPE;
    v_moved_orders INTEGER := 0;
    v_moved_vouchers INTEGER := 0;
    v_total_orders INTEGER := 0;
    v_total_spent NUMERIC(12, 2) := 0;
    v_last_order_at TIMESTAMPTZ;
    v_next_phone TEXT;
    v_next_credit NUMERIC(12, 2);
BEGIN
    v_role := public.current_app_role();
    IF v_role IS NULL OR v_role NOT IN ('manager', 'admin') THEN
        RAISE EXCEPTION 'Chỉ quản lý (manager/admin) mới được phép gộp khách hàng';
    END IF;

    IF p_primary_id IS NULL THEN
        RAISE EXCEPTION 'Thiếu ID khách hàng chính';
    END IF;

    SELECT * INTO v_primary FROM public.customers WHERE id = p_primary_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy khách hàng chính để gộp';
    END IF;

    SELECT ARRAY_AGG(DISTINCT x)
    INTO v_dup_ids
    FROM UNNEST(COALESCE(p_duplicate_ids, ARRAY[]::UUID[])) AS x
    WHERE x IS NOT NULL AND x <> p_primary_id;

    IF v_dup_ids IS NULL OR COALESCE(array_length(v_dup_ids, 1), 0) = 0 THEN
        RAISE EXCEPTION 'Cần chọn ít nhất 2 khách hàng để thực hiện gộp';
    END IF;

    UPDATE public.orders
    SET customer_id = p_primary_id
    WHERE customer_id = ANY(v_dup_ids);
    GET DIAGNOSTICS v_moved_orders = ROW_COUNT;

    UPDATE public.cash_vouchers
    SET customer_id = p_primary_id
    WHERE customer_id = ANY(v_dup_ids);
    GET DIAGNOSTICS v_moved_vouchers = ROW_COUNT;

    DELETE FROM public.customers
    WHERE id = ANY(v_dup_ids);

    SELECT
        COUNT(*)::INTEGER,
        COALESCE(SUM(total_amount), 0),
        MAX(created_at)
    INTO v_total_orders, v_total_spent, v_last_order_at
    FROM public.orders
    WHERE customer_id = p_primary_id
      AND COALESCE(status, 'pending') <> 'cancelled';

    v_next_phone := REGEXP_REPLACE(
        COALESCE(NULLIF(TRIM(COALESCE(p_merged->>'phone', '')), ''), v_primary.phone),
        '[\s.-]',
        '',
        'g'
    );

    v_next_credit := CASE
        WHEN p_merged ? 'credit_limit' THEN
            CASE
                WHEN NULLIF(TRIM(COALESCE(p_merged->>'credit_limit', '')), '') IS NULL THEN NULL
                ELSE GREATEST((p_merged->>'credit_limit')::NUMERIC(12, 2), 0)
            END
        ELSE v_primary.credit_limit
    END;

    UPDATE public.customers
    SET
        phone = v_next_phone,
        full_name = CASE
            WHEN p_merged ? 'full_name' THEN COALESCE(TRIM(p_merged->>'full_name'), '')
            ELSE full_name
        END,
        default_address = CASE
            WHEN p_merged ? 'default_address' THEN COALESCE(TRIM(p_merged->>'default_address'), '')
            ELSE default_address
        END,
        area = CASE
            WHEN p_merged ? 'area' THEN NULLIF(TRIM(COALESCE(p_merged->>'area', '')), '')
            ELSE area
        END,
        customer_group = CASE
            WHEN p_merged ? 'customer_group' THEN COALESCE(NULLIF(TRIM(COALESCE(p_merged->>'customer_group', '')), ''), 'Khách lẻ')
            ELSE customer_group
        END,
        tax_code = CASE
            WHEN p_merged ? 'tax_code' THEN NULLIF(TRIM(COALESCE(p_merged->>'tax_code', '')), '')
            ELSE tax_code
        END,
        bank_account = CASE
            WHEN p_merged ? 'bank_account' THEN NULLIF(TRIM(COALESCE(p_merged->>'bank_account', '')), '')
            ELSE bank_account
        END,
        bank_name = CASE
            WHEN p_merged ? 'bank_name' THEN NULLIF(TRIM(COALESCE(p_merged->>'bank_name', '')), '')
            ELSE bank_name
        END,
        email = CASE
            WHEN p_merged ? 'email' THEN NULLIF(TRIM(COALESCE(p_merged->>'email', '')), '')
            ELSE email
        END,
        credit_limit = v_next_credit,
        notes = CASE
            WHEN p_merged ? 'notes' THEN COALESCE(TRIM(p_merged->>'notes'), '')
            ELSE notes
        END,
        total_orders = COALESCE(v_total_orders, 0),
        total_spent = COALESCE(v_total_spent, 0),
        last_order_at = COALESCE(v_last_order_at, last_order_at)
    WHERE id = p_primary_id;

    RETURN jsonb_build_object(
        'primary_id', p_primary_id,
        'merged_duplicates', array_length(v_dup_ids, 1),
        'moved_orders', v_moved_orders,
        'moved_vouchers', v_moved_vouchers,
        'total_orders', COALESCE(v_total_orders, 0),
        'total_spent', COALESCE(v_total_spent, 0)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_customers(UUID, UUID[], JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_customers(UUID, UUID[], JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_cash_voucher(
    p_voucher_code TEXT,
    p_voucher_type TEXT,
    p_category TEXT,
    p_amount NUMERIC(12, 2),
    p_payment_method TEXT DEFAULT 'cash',
    p_customer_id UUID DEFAULT NULL,
    p_supplier_id UUID DEFAULT NULL,
    p_order_id UUID DEFAULT NULL,
    p_purchase_order_id UUID DEFAULT NULL,
    p_related_code TEXT DEFAULT '',
    p_counterparty_name TEXT DEFAULT '',
    p_note TEXT DEFAULT '',
    p_voucher_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role TEXT;
    v_email TEXT;
    v_voucher_id UUID;
    v_remaining NUMERIC(12, 2);
    v_due NUMERIC(12, 2);
    v_apply NUMERIC(12, 2);
    v_ord RECORD;
    v_po RECORD;
    v_resolved_related_code TEXT := COALESCE(TRIM(p_related_code), '');
    v_resolved_counterparty TEXT := COALESCE(TRIM(p_counterparty_name), '');
    v_resolved_customer_id UUID := p_customer_id;
    v_resolved_supplier_id UUID := p_supplier_id;
BEGIN
    v_role := public.current_app_role();
    IF auth.uid() IS NULL OR v_role NOT IN ('staff', 'manager', 'admin') THEN
        RAISE EXCEPTION 'Bạn không có quyền lập phiếu thu chi';
    END IF;

    IF p_voucher_type NOT IN ('receipt', 'payment') THEN
        RAISE EXCEPTION 'Loại phiếu thu/chi không hợp lệ';
    END IF;

    IF v_role = 'staff' AND p_category NOT IN ('customer_debt', 'sales_income', 'customer_refund') THEN
        RAISE EXCEPTION 'Nhân viên chỉ được phép lập phiếu liên quan thu tiền/hoàn tiền khách hàng';
    END IF;

    IF COALESCE(p_amount, 0) <= 0 THEN
        RAISE EXCEPTION 'Số tiền phiếu thu/chi phải lớn hơn 0';
    END IF;

    IF COALESCE(TRIM(p_voucher_code), '') = '' THEN
        RAISE EXCEPTION 'Thiếu mã phiếu thu/chi';
    END IF;

    SELECT COALESCE(email, '') INTO v_email FROM public.user_profiles WHERE user_id = auth.uid();

    IF p_order_id IS NOT NULL THEN
        SELECT id, order_code, customer_id, customer_name
        INTO v_ord
        FROM public.orders
        WHERE id = p_order_id;
        IF FOUND THEN
            v_resolved_related_code := COALESCE(NULLIF(v_resolved_related_code, ''), v_ord.order_code);
            v_resolved_customer_id := COALESCE(v_resolved_customer_id, v_ord.customer_id);
            v_resolved_counterparty := COALESCE(NULLIF(v_resolved_counterparty, ''), NULLIF(v_ord.customer_name, ''));
        END IF;
    END IF;

    IF p_purchase_order_id IS NOT NULL THEN
        SELECT id, po_code, supplier_id, supplier_name
        INTO v_po
        FROM public.purchase_orders
        WHERE id = p_purchase_order_id;
        IF FOUND THEN
            v_resolved_related_code := COALESCE(NULLIF(v_resolved_related_code, ''), v_po.po_code);
            v_resolved_supplier_id := COALESCE(v_resolved_supplier_id, v_po.supplier_id);
            v_resolved_counterparty := COALESCE(NULLIF(v_resolved_counterparty, ''), NULLIF(v_po.supplier_name, ''));
        END IF;
    END IF;

    IF v_resolved_customer_id IS NOT NULL AND v_resolved_counterparty = '' THEN
        SELECT COALESCE(NULLIF(full_name, ''), phone)
        INTO v_resolved_counterparty
        FROM public.customers
        WHERE id = v_resolved_customer_id;
    END IF;

    IF v_resolved_supplier_id IS NOT NULL AND v_resolved_counterparty = '' THEN
        SELECT name INTO v_resolved_counterparty
        FROM public.suppliers
        WHERE id = v_resolved_supplier_id;
    END IF;

    INSERT INTO public.cash_vouchers (
        voucher_code, voucher_type, category, amount, payment_method,
        customer_id, supplier_id, order_id, purchase_order_id,
        related_code, counterparty_name, note, voucher_date, created_by_email
    )
    VALUES (
        TRIM(p_voucher_code),
        p_voucher_type,
        p_category,
        p_amount,
        COALESCE(NULLIF(TRIM(p_payment_method), ''), 'cash'),
        v_resolved_customer_id,
        v_resolved_supplier_id,
        p_order_id,
        p_purchase_order_id,
        COALESCE(v_resolved_related_code, ''),
        COALESCE(v_resolved_counterparty, ''),
        COALESCE(TRIM(p_note), ''),
        COALESCE(p_voucher_date, NOW()),
        COALESCE(v_email, '')
    )
    RETURNING id INTO v_voucher_id;

    IF p_voucher_type = 'receipt' AND p_category IN ('customer_debt', 'sales_income') THEN
        v_remaining := p_amount;

        IF p_order_id IS NOT NULL THEN
            SELECT id, total_amount, paid_amount, is_paid
            INTO v_ord
            FROM public.orders
            WHERE id = p_order_id
              AND COALESCE(status, 'pending') <> 'cancelled';
            IF FOUND THEN
                v_due := GREATEST(v_ord.total_amount - COALESCE(v_ord.paid_amount, 0), 0);
                v_apply := LEAST(v_remaining, v_due);
                IF v_apply > 0 THEN
                    UPDATE public.orders
                    SET
                        paid_amount = LEAST(total_amount, COALESCE(paid_amount, 0) + v_apply),
                        is_paid = (LEAST(total_amount, COALESCE(paid_amount, 0) + v_apply) >= total_amount),
                        paid_at = CASE
                            WHEN LEAST(total_amount, COALESCE(paid_amount, 0) + v_apply) >= total_amount
                            THEN COALESCE(paid_at, NOW())
                            ELSE paid_at
                        END
                    WHERE id = v_ord.id;
                    v_remaining := v_remaining - v_apply;
                END IF;
            END IF;
        END IF;

        IF v_remaining > 0 AND v_resolved_customer_id IS NOT NULL AND p_category = 'customer_debt' THEN
            FOR v_ord IN
                SELECT id, total_amount, paid_amount
                FROM public.orders
                WHERE customer_id = v_resolved_customer_id
                  AND COALESCE(status, 'pending') <> 'cancelled'
                  AND (p_order_id IS NULL OR id <> p_order_id)
                  AND COALESCE(is_paid, false) = false
                  AND total_amount > COALESCE(paid_amount, 0)
                ORDER BY created_at ASC
            LOOP
                EXIT WHEN v_remaining <= 0;
                v_due := GREATEST(v_ord.total_amount - COALESCE(v_ord.paid_amount, 0), 0);
                v_apply := LEAST(v_remaining, v_due);
                IF v_apply > 0 THEN
                    UPDATE public.orders
                    SET
                        paid_amount = LEAST(total_amount, COALESCE(paid_amount, 0) + v_apply),
                        is_paid = (LEAST(total_amount, COALESCE(paid_amount, 0) + v_apply) >= total_amount),
                        paid_at = CASE
                            WHEN LEAST(total_amount, COALESCE(paid_amount, 0) + v_apply) >= total_amount
                            THEN COALESCE(paid_at, NOW())
                            ELSE paid_at
                        END
                    WHERE id = v_ord.id;
                    v_remaining := v_remaining - v_apply;
                END IF;
            END LOOP;
        END IF;
    END IF;

    IF p_voucher_type = 'payment' AND p_category IN ('supplier_debt', 'purchase_expense') THEN
        v_remaining := p_amount;

        IF p_purchase_order_id IS NOT NULL THEN
            SELECT id, total_amount, paid_amount, is_paid
            INTO v_po
            FROM public.purchase_orders
            WHERE id = p_purchase_order_id;
            IF FOUND THEN
                v_due := GREATEST(v_po.total_amount - COALESCE(v_po.paid_amount, 0), 0);
                v_apply := LEAST(v_remaining, v_due);
                IF v_apply > 0 THEN
                    UPDATE public.purchase_orders
                    SET
                        paid_amount = LEAST(total_amount, COALESCE(paid_amount, 0) + v_apply),
                        is_paid = (LEAST(total_amount, COALESCE(paid_amount, 0) + v_apply) >= total_amount)
                    WHERE id = v_po.id;
                    v_remaining := v_remaining - v_apply;
                END IF;
            END IF;
        END IF;

        IF v_remaining > 0 AND v_resolved_supplier_id IS NOT NULL AND p_category = 'supplier_debt' THEN
            FOR v_po IN
                SELECT id, total_amount, paid_amount
                FROM public.purchase_orders
                WHERE supplier_id = v_resolved_supplier_id
                  AND (p_purchase_order_id IS NULL OR id <> p_purchase_order_id)
                  AND total_amount > COALESCE(paid_amount, 0)
                ORDER BY imported_at ASC
            LOOP
                EXIT WHEN v_remaining <= 0;
                v_due := GREATEST(v_po.total_amount - COALESCE(v_po.paid_amount, 0), 0);
                v_apply := LEAST(v_remaining, v_due);
                IF v_apply > 0 THEN
                    UPDATE public.purchase_orders
                    SET
                        paid_amount = LEAST(total_amount, COALESCE(paid_amount, 0) + v_apply),
                        is_paid = (LEAST(total_amount, COALESCE(paid_amount, 0) + v_apply) >= total_amount)
                    WHERE id = v_po.id;
                    v_remaining := v_remaining - v_apply;
                END IF;
            END LOOP;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'id', v_voucher_id,
        'voucher_code', TRIM(p_voucher_code)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_cash_voucher(TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_cash_voucher(TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_cash_voucher(
    p_voucher_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role TEXT;
    v_voucher public.cash_vouchers%ROWTYPE;
    v_remaining NUMERIC(12, 2);
    v_revert NUMERIC(12, 2);
    v_ord RECORD;
    v_po RECORD;
BEGIN
    v_role := public.current_app_role();
    IF v_role IS NULL OR v_role NOT IN ('manager', 'admin') THEN
        RAISE EXCEPTION 'Chỉ quản lý (manager/admin) mới được phép xóa phiếu thu chi';
    END IF;

    SELECT * INTO v_voucher FROM public.cash_vouchers WHERE id = p_voucher_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy phiếu thu/chi cần xóa';
    END IF;

    IF v_voucher.voucher_type = 'receipt' AND v_voucher.category IN ('customer_debt', 'sales_income') THEN
        v_remaining := v_voucher.amount;
        IF v_voucher.order_id IS NOT NULL THEN
            SELECT id, total_amount, paid_amount
            INTO v_ord
            FROM public.orders
            WHERE id = v_voucher.order_id;
            IF FOUND AND COALESCE(v_ord.paid_amount, 0) > 0 THEN
                v_revert := LEAST(v_remaining, v_ord.paid_amount);
                UPDATE public.orders
                SET
                    paid_amount = GREATEST(COALESCE(paid_amount, 0) - v_revert, 0),
                    is_paid = (GREATEST(COALESCE(paid_amount, 0) - v_revert, 0) >= total_amount AND total_amount > 0),
                    paid_at = CASE
                        WHEN GREATEST(COALESCE(paid_amount, 0) - v_revert, 0) >= total_amount THEN paid_at
                        ELSE NULL
                    END
                WHERE id = v_ord.id;
                v_remaining := v_remaining - v_revert;
            END IF;
        END IF;

        IF v_remaining > 0 AND v_voucher.customer_id IS NOT NULL AND v_voucher.category = 'customer_debt' THEN
            FOR v_ord IN
                SELECT id, total_amount, paid_amount
                FROM public.orders
                WHERE customer_id = v_voucher.customer_id
                  AND COALESCE(paid_amount, 0) > 0
                  AND (v_voucher.order_id IS NULL OR id <> v_voucher.order_id)
                ORDER BY created_at DESC
            LOOP
                EXIT WHEN v_remaining <= 0;
                v_revert := LEAST(v_remaining, v_ord.paid_amount);
                IF v_revert > 0 THEN
                    UPDATE public.orders
                    SET
                        paid_amount = GREATEST(COALESCE(paid_amount, 0) - v_revert, 0),
                        is_paid = (GREATEST(COALESCE(paid_amount, 0) - v_revert, 0) >= total_amount AND total_amount > 0),
                        paid_at = CASE
                            WHEN GREATEST(COALESCE(paid_amount, 0) - v_revert, 0) >= total_amount THEN paid_at
                            ELSE NULL
                        END
                    WHERE id = v_ord.id;
                    v_remaining := v_remaining - v_revert;
                END IF;
            END LOOP;
        END IF;
    END IF;

    IF v_voucher.voucher_type = 'payment' AND v_voucher.category IN ('supplier_debt', 'purchase_expense') THEN
        v_remaining := v_voucher.amount;
        IF v_voucher.purchase_order_id IS NOT NULL THEN
            SELECT id, total_amount, paid_amount
            INTO v_po
            FROM public.purchase_orders
            WHERE id = v_voucher.purchase_order_id;
            IF FOUND AND COALESCE(v_po.paid_amount, 0) > 0 THEN
                v_revert := LEAST(v_remaining, v_po.paid_amount);
                UPDATE public.purchase_orders
                SET
                    paid_amount = GREATEST(COALESCE(paid_amount, 0) - v_revert, 0),
                    is_paid = (GREATEST(COALESCE(paid_amount, 0) - v_revert, 0) >= total_amount AND total_amount > 0)
                WHERE id = v_po.id;
                v_remaining := v_remaining - v_revert;
            END IF;
        END IF;

        IF v_remaining > 0 AND v_voucher.supplier_id IS NOT NULL AND v_voucher.category = 'supplier_debt' THEN
            FOR v_po IN
                SELECT id, total_amount, paid_amount
                FROM public.purchase_orders
                WHERE supplier_id = v_voucher.supplier_id
                  AND COALESCE(paid_amount, 0) > 0
                  AND (v_voucher.purchase_order_id IS NULL OR id <> v_voucher.purchase_order_id)
                ORDER BY imported_at DESC
            LOOP
                EXIT WHEN v_remaining <= 0;
                v_revert := LEAST(v_remaining, v_po.paid_amount);
                IF v_revert > 0 THEN
                    UPDATE public.purchase_orders
                    SET
                        paid_amount = GREATEST(COALESCE(paid_amount, 0) - v_revert, 0),
                        is_paid = (GREATEST(COALESCE(paid_amount, 0) - v_revert, 0) >= total_amount AND total_amount > 0)
                    WHERE id = v_po.id;
                    v_remaining := v_remaining - v_revert;
                END IF;
            END LOOP;
        END IF;
    END IF;

    DELETE FROM public.cash_vouchers WHERE id = p_voucher_id;

    RETURN jsonb_build_object('deleted_id', p_voucher_id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_cash_voucher(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_cash_voucher(UUID) TO authenticated;

-- ============================================================================
-- 09. Kho lưu trữ ảnh sản phẩm Supabase Storage (bucket: product-images)
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

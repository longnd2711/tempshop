-- ============================================================================
-- CƠ SỞ DỮ LIỆU SUPABASE - VĂN PHÒNG PHẨM HƯƠNG LONG (PHÂN QUYỀN STAFF / MANAGER / ADMIN)
-- Chạy toàn bộ script này trong Supabase SQL Editor.
-- ============================================================================

-- 00. DỌN DẸP CẤU TRÚC CŨ (Tạo lại từ đầu)
DROP VIEW IF EXISTS public.public_products;
DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user_profile();
DROP FUNCTION IF EXISTS public.create_purchase_order(TEXT, TEXT, TEXT, BOOLEAN, JSONB);
DROP FUNCTION IF EXISTS public.create_public_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, BOOLEAN, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.create_public_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.current_app_role();

DROP TABLE IF EXISTS public.purchase_order_items CASCADE;
DROP TABLE IF EXISTS public.purchase_orders CASCADE;
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
--   - 'staff':   Nhân viên    -> chỉ truy cập Đơn hàng & Khách hàng (không quản lý hàng hóa, nhập hàng, người dùng)
--   - 'manager': Quản lý      -> Đơn hàng, Khách hàng, Hàng hóa, Nhập hàng (không xem/sửa người dùng)
--   - 'admin':   Quản trị viên -> toàn quyền hệ thống (bao gồm xem & chỉnh sửa người dùng)
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

-- Mỗi nhân viên/quản lý chỉ được đọc role của chính mình (không thể tự nâng quyền)
CREATE POLICY "Users read own profile"
    ON public.user_profiles FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Chỉ Admin mới xem/chỉnh sửa phân quyền và thông tin của tài khoản khác
CREATE POLICY "Admin manage all profiles"
    ON public.user_profiles FOR ALL
    TO authenticated
    USING (public.current_app_role() = 'admin')
    WITH CHECK (public.current_app_role() = 'admin');

-- Đồng bộ sẵn profile cho các user đã tạo trước đó (mặc định 'staff')
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

-- Khách vãng lai và staff chỉ xem danh mục đang bật; Manager & Admin xem tất cả
CREATE POLICY "Public read active categories"
    ON public.categories FOR SELECT
    TO anon, authenticated
    USING (is_active = true OR public.current_app_role() IN ('manager', 'admin'));

-- Manager & Admin được thêm/sửa/xóa danh mục
CREATE POLICY "Manager and Admin full access on categories"
    ON public.categories FOR ALL
    TO authenticated
    USING (public.current_app_role() IN ('manager', 'admin'))
    WITH CHECK (public.current_app_role() IN ('manager', 'admin'));

-- ============================================================================
-- 03. Bảng Hàng hóa (products)
-- Manager & Admin mới được đọc/ghi trực tiếp (ẩn cost_price và notes với khách & staff)
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
    min_stock NUMERIC(12, 2) NOT NULL DEFAULT 0,
    max_stock NUMERIC(12, 2),
    base_unit TEXT NOT NULL DEFAULT 'Cái',
    unit TEXT NOT NULL DEFAULT 'Cái',
    conversion_rate NUMERIC(10, 2) NOT NULL DEFAULT 1 CHECK (conversion_rate > 0),
    variants TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    image_urls TEXT[] NOT NULL DEFAULT '{}',
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

-- Chỉ Manager & Admin mới có toàn quyền đọc/thêm/sửa/xóa bảng products
CREATE POLICY "Manager and Admin full access on products"
    ON public.products FOR ALL
    TO authenticated
    USING (public.current_app_role() IN ('manager', 'admin'))
    WITH CHECK (public.current_app_role() IN ('manager', 'admin'));

-- ============================================================================
-- VIEW CÔNG KHAI CHO TRANG BÁN HÀNG (public_products)
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
-- Tự động lưu khi có khách mới đặt hàng (theo SĐT), có cột notes lưu ý riêng
-- ============================================================================
CREATE TABLE public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL DEFAULT '',
    default_address TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '', -- Ghi chú thông tin để lưu ý về mỗi khách
    total_orders INTEGER NOT NULL DEFAULT 0 CHECK (total_orders >= 0),
    total_spent NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_spent >= 0),
    last_order_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customers_phone ON public.customers(phone);
CREATE INDEX idx_customers_last_order ON public.customers(last_order_at DESC);

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
-- - Khách vãng lai (anon): CHỈ được tạo đơn mới qua RPC create_public_order
-- - Staff, Manager & Admin: được xem và cập nhật trạng thái đơn hàng
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
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'shipping', 'completed', 'cancelled')),
    is_confirmed BOOLEAN NOT NULL DEFAULT false,
    is_paid BOOLEAN NOT NULL DEFAULT false,
    confirmed_at TIMESTAMPTZ,
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

-- ============================================================================
-- 06. Bảng Đơn nhập hàng (purchase_orders) & Chi tiết nhập (purchase_order_items)
-- CHỈ Manager & Admin mới được truy cập và tạo đơn nhập hàng
-- ============================================================================
CREATE TABLE public.purchase_orders (
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
-- 07. RPC đặt hàng công khai an toàn (create_public_order)
-- - Khách vãng lai bắt buộc có SĐT; nhân viên/quản lý đăng nhập có thể để trống SĐT cho Khách lẻ tại quầy
-- - Tự động lưu/cập nhật bảng customers khi có SĐT khách hàng
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

    -- Khách vãng lai (chưa đăng nhập) bắt buộc nhập SĐT; nhân viên/quản lý tạo đơn tại quầy được phép để trống
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

    -- Chỉ nhân viên/quản lý đã đăng nhập mới được áp dụng giảm giá toàn đơn và chốt xác nhận/thanh toán ngay
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

    -- Lưu hoặc cập nhật thông tin khách hàng vào bảng customers nếu có số điện thoại
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
-- 08. RPC tạo đơn nhập hàng, hỗ trợ giảm giá % / đ, tạo thẳng hàng mới,
--     điều chỉnh giá bán và cộng tồn kho tự động (create_purchase_order)
-- CHỈ Manager & Admin mới được gọi
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

        -- Nếu tạo thẳng hàng hóa mới trong đơn nhập hàng
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
                    category_id,
                    sku,
                    barcode,
                    name,
                    brand,
                    selling_price,
                    cost_price,
                    stock_quantity,
                    base_unit,
                    unit,
                    conversion_rate,
                    image_urls,
                    is_active
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
-- 09. Kho lưu trữ ảnh sản phẩm Supabase Storage (bucket: product-images)
-- Khách vãng lai xem công khai; CHỈ Manager & Admin mới được tải lên, đổi tên hoặc xóa ảnh
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
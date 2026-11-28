-- ============================================================================
-- UPGRADE SCHEMA 03 (KHÔNG XÓA DỮ LIỆU CŨ)
-- Nội dung nâng cấp:
--   1. Cho phép min_stock, max_stock, image_urls để NULL trong bảng public.products.
--   2. Thêm các cột mới vào public.products:
--        - ordered_quantity: Số lượng khách đang đặt (tự động cập nhật từ đơn hàng).
--        - planned_import_quantity: Số lượng dự kiến nhập mua.
--        - purchase_pack_options (JSONB): Các quy cách nhập theo lô
--          VD: [{"label":"Chiếc","factor":1},{"label":"Hộp","factor":20},{"label":"Thùng","factor":120}]
--   3. Thêm cột is_delivered, delivered_at vào bảng public.orders để theo dõi
--      trạng thái Giao hàng (tách riêng với Tiến độ đơn).
--   4. Tạo trigger tự động cập nhật products.ordered_quantity khi phát sinh / sửa /
--      thay đổi trạng thái đơn đặt hàng & chi tiết đơn hàng.
--   5. Cập nhật view public.public_products để trả về ordered_quantity khi đã
--      đăng nhập (ẩn với khách vãng lai).
--   6. Cập nhật create_public_order (thêm p_mark_delivered) và tạo RPC mới
--      update_public_order để chỉnh sửa/xử lý đơn hàng từ Bán hàng nhiều tab.
-- An toàn khi chạy lại nhiều lần.
-- ============================================================================

-- 1. Cho phép NULL đối với min_stock, max_stock, image_urls & thêm cột mới cho products
ALTER TABLE public.products
    ALTER COLUMN min_stock DROP NOT NULL;

ALTER TABLE public.products
    ALTER COLUMN image_urls DROP NOT NULL;

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS max_stock NUMERIC(12, 2);

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS ordered_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS planned_import_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS purchase_pack_options JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 2. Thêm cột theo dõi Giao hàng cho orders & đồng bộ các đơn đã hoàn tất
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS is_delivered BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

UPDATE public.orders
SET
    is_delivered = true,
    delivered_at = COALESCE(delivered_at, updated_at, created_at)
WHERE status = 'completed'
  AND is_delivered = false;

-- 3. Hàm & Trigger tự động đồng bộ products.ordered_quantity
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

DROP TRIGGER IF EXISTS trg_refresh_product_ordered_on_item_change ON public.order_items;
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

DROP TRIGGER IF EXISTS trg_refresh_product_ordered_on_order_change ON public.orders;
CREATE TRIGGER trg_refresh_product_ordered_on_order_change
    AFTER UPDATE OF status, is_delivered ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_fn_refresh_product_ordered_on_order();

-- Tính lại ordered_quantity cho toàn bộ hàng hóa hiện có
UPDATE public.products p
SET ordered_quantity = COALESCE((
    SELECT SUM(oi.quantity)
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.product_id = p.id
      AND COALESCE(o.is_delivered, false) = false
      AND o.status NOT IN ('completed', 'cancelled')
), 0);

-- 4. Cập nhật view public.public_products (chỉ trả stock & ordered_quantity khi đã đăng nhập)
DROP VIEW IF EXISTS public.public_products;

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

-- 5. Cập nhật create_public_order (hỗ trợ p_mark_delivered)
DROP FUNCTION IF EXISTS public.create_public_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, BOOLEAN, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.create_public_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, BOOLEAN, BOOLEAN, TEXT, BOOLEAN);

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
    p_mark_delivered BOOLEAN DEFAULT false
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
    v_is_delivered BOOLEAN := false;
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
        v_is_delivered := COALESCE(p_mark_delivered, false) OR v_status = 'completed';
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
        status, is_confirmed, is_delivered, is_paid, confirmed_at, delivered_at, paid_at
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
        'total_amount', v_total_amount
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_public_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, BOOLEAN, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_public_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, BOOLEAN, BOOLEAN, TEXT, BOOLEAN) TO anon, authenticated;

-- 6. RPC cập nhật đơn hàng đã đặt từ tab POS (update_public_order)
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
    p_status TEXT DEFAULT 'pending'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role TEXT;
    v_target_order_id UUID;
    v_item JSONB;
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
    v_status TEXT := 'pending';
BEGIN
    v_role := public.current_app_role();
    IF auth.uid() IS NULL OR v_role NOT IN ('staff', 'manager', 'admin') THEN
        RAISE EXCEPTION 'Chỉ nhân viên, quản lý hoặc quản trị viên mới được phép sửa đơn hàng';
    END IF;

    IF p_order_id IS NOT NULL THEN
        SELECT id INTO v_target_order_id FROM public.orders WHERE id = p_order_id;
    END IF;

    IF v_target_order_id IS NULL AND COALESCE(TRIM(p_order_code), '') <> '' THEN
        SELECT id INTO v_target_order_id FROM public.orders WHERE order_code = TRIM(p_order_code);
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

    v_discount := LEAST(GREATEST(COALESCE(p_discount_amount, 0), 0), v_subtotal);
    v_total_amount := GREATEST(v_subtotal - v_discount, 0);
    v_status := CASE
        WHEN p_status IN ('pending', 'confirmed', 'shipping', 'completed', 'cancelled') THEN p_status
        ELSE 'pending'
    END;
    v_is_delivered := COALESCE(p_mark_delivered, false) OR v_status = 'completed';
    v_is_confirmed := COALESCE(p_mark_confirmed, false) OR v_status IN ('confirmed', 'shipping', 'completed');
    v_is_paid := COALESCE(p_mark_paid, false);

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
        total_amount = v_total_amount,
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
        'total_amount', v_total_amount
    );
END;
$$;

REVOKE ALL ON FUNCTION public.update_public_order(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, BOOLEAN, BOOLEAN, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_public_order(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC, BOOLEAN, BOOLEAN, BOOLEAN, TEXT) TO authenticated;

-- ============================================================================
-- UPGRADE SCHEMA 05 (KHÔNG XÓA DỮ LIỆU CŨ)
-- Nội dung nâng cấp:
--   1. Xóa cột planned_import_quantity khỏi bảng public.products
--      (chuyển sang chọn hàng cần nhập trực tiếp ở giao diện Nhập hàng).
--   2. Bổ sung 6 cột cho phép NULL vào bảng public.suppliers:
--        - short_name (Tên viết tắt)
--        - tax_code (Mã số thuế)
--        - bank_account (Số tài khoản)
--        - bank_name (Ngân hàng & chi nhánh)
--        - email (Email)
--        - supply_category (Loại hàng cung cấp)
--   3. Đồng bộ lại cost_price của hàng hóa theo giá nhập sau giảm giá từ đơn
--      nhập hàng mới nhất (nếu có dữ liệu lịch sử nhập), và cập nhật RPC
--      create_purchase_order đảm bảo lưu đúng giá nhập sau giảm giá.
-- An toàn khi chạy lại nhiều lần.
-- ============================================================================

-- 1. Bỏ cột planned_import_quantity khỏi bảng products
ALTER TABLE public.products
    DROP COLUMN IF EXISTS planned_import_quantity;

-- 2. Bổ sung các trường tùy chọn (nullable) cho bảng nhà cung cấp (suppliers)
ALTER TABLE public.suppliers
    ADD COLUMN IF NOT EXISTS short_name TEXT,
    ADD COLUMN IF NOT EXISTS tax_code TEXT,
    ADD COLUMN IF NOT EXISTS bank_account TEXT,
    ADD COLUMN IF NOT EXISTS bank_name TEXT,
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS supply_category TEXT;

CREATE INDEX IF NOT EXISTS idx_suppliers_short_name ON public.suppliers(short_name);

-- 3. Đồng bộ cost_price của sản phẩm theo đơn nhập hàng mới nhất (giá đã qua giảm giá)
WITH latest_import AS (
    SELECT DISTINCT ON (poi.product_id)
        poi.product_id,
        ROUND(
            GREATEST(poi.unit_cost - LEAST(poi.discount_amount, poi.unit_cost), 0)
            / GREATEST(poi.conversion_factor, 0.01),
            2
        ) AS net_base_cost
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
    WHERE poi.product_id IS NOT NULL
      AND poi.unit_cost > 0
    ORDER BY poi.product_id, po.imported_at DESC, poi.created_at DESC
)
UPDATE public.products p
SET cost_price = li.net_base_cost
FROM latest_import li
WHERE p.id = li.product_id
  AND p.cost_price IS DISTINCT FROM li.net_base_cost;

-- 4. Cập nhật RPC create_purchase_order để luôn tính chính xác giá nhập sau giảm giá
DROP FUNCTION IF EXISTS public.create_purchase_order(TEXT, TEXT, TEXT, BOOLEAN, JSONB);
DROP FUNCTION IF EXISTS public.create_purchase_order(TEXT, TEXT, TEXT, BOOLEAN, JSONB, UUID);

CREATE OR REPLACE FUNCTION public.create_purchase_order(
    p_po_code TEXT,
    p_supplier_name TEXT DEFAULT '',
    p_note TEXT DEFAULT '',
    p_update_cost_price BOOLEAN DEFAULT true,
    p_items JSONB DEFAULT '[]'::jsonb,
    p_supplier_id UUID DEFAULT NULL
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
        v_total_amount := v_total_amount + (v_qty * v_net_unit_cost);
        v_item_count := v_item_count + 1;
    END LOOP;

    INSERT INTO public.purchase_orders (
        po_code, supplier_id, supplier_name, note, total_amount, item_count, created_by_email
    )
    VALUES (
        TRIM(p_po_code),
        v_supplier_id,
        COALESCE(v_supplier_name, ''),
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
        'total_amount', v_total_amount,
        'item_count', v_item_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_purchase_order(TEXT, TEXT, TEXT, BOOLEAN, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(TEXT, TEXT, TEXT, BOOLEAN, JSONB, UUID) TO authenticated;

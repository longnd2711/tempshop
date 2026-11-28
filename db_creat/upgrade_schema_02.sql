-- ============================================================================
-- UPGRADE SCHEMA 02 (KHÔNG XÓA DỮ LIỆU CŨ)
-- Nội dung nâng cấp:
--   1. Thêm cột variants (TEXT[]) vào bảng public.products để lưu phân loại hàng
--      (VD: {'Mực xanh', 'Mực đỏ', 'Mực đen'}) ngay trên 1 dòng hàng hóa.
--   2. Cập nhật view public.public_products:
--      - Xuất thêm cột p.variants
--      - Chỉ hiển thị p.stock_quantity khi đã đăng nhập (auth.uid() IS NOT NULL),
--        trả về NULL với khách vãng lai (anon) trên trang chủ.
-- An toàn khi chạy lại nhiều lần.
-- ============================================================================

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS variants TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

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

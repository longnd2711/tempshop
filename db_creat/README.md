# Quản lý Script Cơ sở dữ liệu Supabase (`db_creat/`)

## 1. Khởi tạo cơ sở dữ liệu mới từ đầu (cho shop mới)
- Chạy **duy nhất 1 file**: `db_creat/schema.sql` trong **Supabase SQL Editor**.
- File `schema.sql` đã bao gồm toàn bộ cấu trúc bảng, phân quyền 3 vai trò (`staff` / `manager` / `admin`), view `public_products`, hàm RPC (`create_public_order`, `create_purchase_order`), RLS policies và Storage bucket `product-images` mới nhất.
- **Lưu ý**: `schema.sql` có lệnh `DROP` ở đầu file nên **chỉ dùng khi tạo mới từ đầu**, không chạy đè lên database đang có dữ liệu thật.

## 2. Nâng cấp cơ sở dữ liệu đang chạy (không mất dữ liệu)
Mỗi lần nâng cấp cấu trúc database, hệ thống sẽ thêm 1 file đánh số tăng dần:
- `db_creat/upgrade_schema_01.sql`: Nâng cấp nền tảng (3 vai trò `staff`/`manager`/`admin`, `user_profiles`, `discount_amount` cho đơn hàng, module nhập hàng `purchase_orders`, Storage `product-images`).
- `db_creat/upgrade_schema_02.sql`: Thêm cột `variants` cho `products` và cập nhật view `public_products` (thêm `variants`, ẩn `stock_quantity` với khách chưa đăng nhập).
- Các phiên bản sau tiếp tục đánh số `upgrade_schema_03.sql`, `upgrade_schema_04.sql`, ...

> Nếu DB trước đó đã chạy bản gộp cũ (`supabase_schema.sql` hoặc `upgrade_schema.sql`), khi có nâng cấp mới chỉ cần chạy các file `upgrade_schema_XX.sql` từ mốc mới trở đi.

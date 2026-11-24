import { Clock, MapPin, Receipt, Truck } from 'lucide-react';
import type { OrderRecord } from '../types/shop';
import { formatVnd } from '../utils/shopLogic';

interface StoreInfoSectionProps {
  lastOrder: OrderRecord | null;
  onOpenCart: () => void;
}

export function StoreInfoSection({
  lastOrder,
  onOpenCart,
}: StoreInfoSectionProps) {
  return (
    <section id="store-info" className="scroll-mt-20 py-12 lg:py-16">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7">
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Đặt hàng rõ ràng, nhận tại nhà hoặc ghé lấy ngay
            </h2>
            <p className="mt-2 text-sm sm:text-base text-slate-600 max-w-[60ch]">
              Cửa hàng phục vụ khách khu dân cư và trường học lân cận. Mọi đơn đặt trực tuyến được nhân viên kiểm đếm trực tiếp từ kệ hàng và xác nhận qua điện thoại trước khi giao.
            </p>

            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-5 bg-white border border-slate-200 rounded-xl">
                <div className="flex items-center gap-2.5 text-slate-900 font-semibold text-sm">
                  <Truck className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
                  <span>Giao nhanh trong 45 phút</span>
                </div>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                  Phí giao đồng giá 15.000₫ nội khu 4km. Miễn phí hoàn toàn cho đơn hàng từ 150.000₫ trở lên.
                </p>
              </div>

              <div className="p-5 bg-white border border-slate-200 rounded-xl">
                <div className="flex items-center gap-2.5 text-slate-900 font-semibold text-sm">
                  <Clock className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
                  <span>Soạn sẵn nhận tại quầy</span>
                </div>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                  Đặt trước trên web để nhân viên đóng gói sẵn. Ghé lấy sau 15 phút mà không cần chờ đợi.
                </p>
              </div>

              <div className="p-5 bg-white border border-slate-200 rounded-xl sm:col-span-2">
                <div className="flex items-center gap-2.5 text-slate-900 font-semibold text-sm">
                  <MapPin className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
                  <span>Địa chỉ cửa hàng: 118 Đường Số 7, Phường Bình Trị Đông, TP.HCM</span>
                </div>
                <p className="mt-1.5 text-sm text-slate-600">
                  Mở cửa 07:00 – 21:30 tất cả các ngày trong tuần · Hỗ trợ thanh toán tiền mặt khi nhận hàng (COD) hoặc chuyển khoản ngân hàng.
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5">
            {lastOrder ? (
              <div
                data-testid="recent-order-card"
                className="p-6 bg-white border border-slate-200 rounded-xl"
              >
                <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
                    <h3 className="font-display text-base font-bold text-slate-900">
                      Đơn vừa đặt gần nhất
                    </h3>
                  </div>
                  <span className="font-mono text-xs font-medium text-blue-700">
                    {lastOrder.orderCode}
                  </span>
                </div>

                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Người nhận</dt>
                    <dd className="font-medium text-slate-900 text-right">
                      {lastOrder.customerName} · {lastOrder.phone}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Hình thức</dt>
                    <dd className="font-medium text-slate-900 text-right">
                      {lastOrder.deliveryMethod === 'delivery'
                        ? 'Giao tận nơi'
                        : 'Nhận tại quầy'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Số mặt hàng</dt>
                    <dd className="font-medium text-slate-900 tabular-nums">
                      {lastOrder.items.reduce((s, i) => s + i.quantity, 0)} sản phẩm
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3 pt-2 border-t border-slate-100">
                    <dt className="font-semibold text-slate-900">Tổng thanh toán</dt>
                    <dd className="font-bold text-blue-700 tabular-nums">
                      {formatVnd(lastOrder.total)}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : (
              <div className="p-6 bg-white border border-slate-200 rounded-xl">
                <h3 className="font-display text-lg font-bold text-slate-900">
                  Quy trình đặt hàng nhanh 3 bước
                </h3>
                <ol className="mt-4 space-y-3 text-sm text-slate-600">
                  <li className="flex gap-3">
                    <span className="font-mono font-medium text-slate-900 tabular-nums">
                      01.
                    </span>
                    <span>
                      Chọn sản phẩm lẻ hoặc combo ngay trên trang chủ bằng nút Thêm nhanh.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-mono font-medium text-slate-900 tabular-nums">
                      02.
                    </span>
                    <span>
                      Mở giỏ hàng, kiểm tra số lượng và điền họ tên, số điện thoại, địa chỉ nhận.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-mono font-medium text-slate-900 tabular-nums">
                      03.
                    </span>
                    <span>
                      Xác nhận đơn — nhận mã đơn hàng tức thì, thanh toán COD khi nhận hàng.
                    </span>
                  </li>
                </ol>
                <button
                  type="button"
                  onClick={onOpenCart}
                  className="mt-5 w-full py-2.5 px-4 text-sm font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  Kiểm tra giỏ hàng hiện tại
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

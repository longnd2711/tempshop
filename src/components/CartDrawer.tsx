import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import type {
  CartItem,
  CheckoutErrors,
  CheckoutFormData,
  DeliveryMethod,
  OrderRecord,
} from '../types/shop';
import {
  calculateCartSummary,
  formatVnd,
  generateOrderCode,
  validateCheckoutForm,
} from '../utils/shopLogic';
import { BankTransferQR } from './BankTransferQR';
import { SafeImage } from './SafeImage';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  items: CartItem[];
  onUpdateQuantity: (productId: string, variant: string, delta: number) => void;
  onRemoveItem: (productId: string, variant: string) => void;
  onClearCart: () => void;
  onOrderConfirmed: (order: OrderRecord) => void;
}

const INITIAL_FORM: CheckoutFormData = {
  customerName: '',
  phone: '',
  address: '',
  note: '',
  deliveryMethod: 'delivery',
  paymentMethod: 'transfer',
};

export function CartDrawer({
  isOpen,
  onClose,
  items,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  onOrderConfirmed,
}: CartDrawerProps) {
  const [form, setForm] = useState<CheckoutFormData>(INITIAL_FORM);
  const [errors, setErrors] = useState<CheckoutErrors>({});
  const [confirmedOrder, setConfirmedOrder] = useState<OrderRecord | null>(null);
  const [draftOrderCode, setDraftOrderCode] = useState<string>(() =>
    generateOrderCode(),
  );
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [confirmedOrder, isOpen]);

  if (!isOpen) return null;

  const summary = calculateCartSummary(items, form.deliveryMethod);

  const handleFieldChange = <K extends keyof CheckoutFormData>(
    key: K,
    value: CheckoutFormData[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key in errors) {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  };

  const handleSubmitOrder = (event: React.FormEvent) => {
    event.preventDefault();
    if (items.length === 0) return;

    const validationErrors = validateCheckoutForm(form);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    const order: OrderRecord = {
      orderCode: draftOrderCode,
      createdAt: new Date().toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      customerName: form.customerName.trim(),
      phone: form.phone.trim(),
      address:
        form.deliveryMethod === 'pickup'
          ? 'Nhận tại CT2.1111'
          : form.address.trim(),
      note: form.note.trim(),
      deliveryMethod: form.deliveryMethod,
      paymentMethod: 'transfer',
      items: [...items],
      subtotal: summary.subtotal,
      shippingFee: 0,
      total: summary.total,
    };

    setConfirmedOrder(order);
    onOrderConfirmed(order);
    onClearCart();
    setForm(INITIAL_FORM);
    setErrors({});
    setDraftOrderCode(generateOrderCode());
  };

  const handleStartNewShopping = () => {
    setConfirmedOrder(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/45 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Giỏ hàng và đặt hàng nhanh"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg h-full bg-white border-l border-slate-200 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <ShoppingBag className="w-5 h-5 text-blue-700 shrink-0" aria-hidden="true" />
            <h2 className="font-display text-lg font-bold text-slate-900">
              {confirmedOrder
                ? 'Xác nhận đơn hàng'
                : `Giỏ hàng (${summary.itemCount})`}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng giỏ hàng"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto px-6 py-5"
        >
          {confirmedOrder ? (
            <div data-testid="order-receipt" className="space-y-5">
              <div className="p-5 bg-emerald-50 border border-emerald-200 rounded-xl">
                <div className="flex items-start gap-3">
                  <CheckCircle2
                    className="w-6 h-6 text-emerald-700 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="font-display text-base font-bold text-emerald-950">
                      Đặt hàng thành công · Mã {confirmedOrder.orderCode}
                    </p>
                    <p className="mt-1 text-sm text-emerald-800">
                      Shop đã tiếp nhận lúc {confirmedOrder.createdAt} và sẽ giao trong khung giờ 19:00 – 22:00 hoặc nhắn báo ngay khi soạn xong tại CT2.1111.
                    </p>
                  </div>
                </div>
              </div>

              <BankTransferQR
                amount={confirmedOrder.total}
                orderId={confirmedOrder.orderCode}
              />

              <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-3 text-sm">
                <h3 className="font-display font-semibold text-slate-900">
                  Thông tin nhận hàng
                </h3>
                <div className="space-y-1.5 text-slate-600">
                  {confirmedOrder.customerName && (
                    <p>
                      Tên người nhận:{' '}
                      <span className="font-medium text-slate-900">
                        {confirmedOrder.customerName}
                      </span>
                    </p>
                  )}
                  <p>
                    Điện thoại:{' '}
                    <span className="font-mono text-slate-900">
                      {confirmedOrder.phone}
                    </span>
                  </p>
                  <p>
                    Địa chỉ:{' '}
                    <span className="text-slate-900">{confirmedOrder.address}</span>
                  </p>
                  <p>
                    Thanh toán:{' '}
                    <span className="text-slate-900">
                      Chuyển khoản hoặc thanh toán tiền mặt
                    </span>
                  </p>
                  {confirmedOrder.note && (
                    <p>
                      Ghi chú:{' '}
                      <span className="text-slate-900">{confirmedOrder.note}</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
                  Chi tiết sản phẩm đã đặt
                </div>
                <ul className="divide-y divide-slate-100">
                  {confirmedOrder.items.map((item) => (
                    <li
                      key={`${item.productId}-${item.variant}`}
                      className="px-4 py-3 flex items-center justify-between gap-3 text-sm"
                    >
                      <div>
                        <p className="font-medium text-slate-900">{item.name}</p>
                        <p className="text-xs text-slate-500">
                          {item.variant} · SL: {item.quantity}
                        </p>
                      </div>
                      <span className="font-semibold text-slate-900 tabular-nums shrink-0">
                        {formatVnd(item.unitPrice * item.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 text-sm">
                  <div className="flex justify-between font-bold text-slate-900">
                    <span>Tổng cộng</span>
                    <span className="text-blue-700 tabular-nums">
                      {formatVnd(confirmedOrder.total)}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleStartNewShopping}
                className="w-full py-3 px-4 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
              >
                Tiếp tục xem sản phẩm
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center">
              <ShoppingBag
                className="w-10 h-10 text-slate-300 mx-auto mb-3 stroke-[1.5]"
                aria-hidden="true"
              />
              <p className="font-display text-base font-semibold text-slate-900">
                Giỏ hàng đang trống
              </p>
              <p className="mt-1.5 text-sm text-slate-500 max-w-xs mx-auto">
                Hãy chọn bút vở, đồ chơi hoặc nhu yếu phẩm ở danh mục để đặt hàng nhanh.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-5 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
              >
                Quay lại chọn sản phẩm
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <ul className="divide-y divide-slate-200 border-t border-b border-slate-200">
                {items.map((item) => (
                  <li
                    key={`${item.productId}-${item.variant}`}
                    className="py-4 flex gap-3.5 items-start"
                  >
                    <div className="w-16 h-16 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
                      <SafeImage
                        src={item.image}
                        alt={item.name}
                        fallbackLabel={item.name}
                        className="w-full h-full object-cover"
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900 leading-snug">
                          {item.name}
                        </p>
                        <button
                          type="button"
                          onClick={() => onRemoveItem(item.productId, item.variant)}
                          aria-label={`Xóa ${item.name} khỏi giỏ`}
                          className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>

                      <p className="mt-0.5 text-xs text-slate-500">
                        {item.variant} · {formatVnd(item.unitPrice)} / {item.unit}
                      </p>

                      <div className="mt-2.5 flex items-center justify-between gap-3">
                        <div className="inline-flex items-center border border-slate-300 rounded-lg">
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateQuantity(item.productId, item.variant, -1)
                            }
                            aria-label={`Giảm số lượng ${item.name}`}
                            className="w-8 h-8 inline-flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded-l-lg cursor-pointer"
                          >
                            <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <span className="w-8 text-center text-xs font-semibold tabular-nums">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateQuantity(item.productId, item.variant, 1)
                            }
                            aria-label={`Tăng số lượng ${item.name}`}
                            className="w-8 h-8 inline-flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded-r-lg cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>

                        <span className="text-sm font-semibold text-slate-900 tabular-nums">
                          {formatVnd(item.unitPrice * item.quantity)}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              <form
                id="fast-checkout-form"
                onSubmit={handleSubmitOrder}
                noValidate
                className="space-y-4"
              >
                <h3 className="font-display text-base font-bold text-slate-900">
                  Thông tin đặt hàng nhanh
                </h3>

                <div>
                  <span className="block text-xs font-medium text-slate-700 mb-1.5">
                    Hình thức nhận hàng
                  </span>
                  <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg">
                    {(
                      [
                        { id: 'delivery', label: 'Giao tận nơi' },
                        { id: 'pickup', label: 'Nhận tại CT2.1111' },
                      ] as { id: DeliveryMethod; label: string }[]
                    ).map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => handleFieldChange('deliveryMethod', option.id)}
                        className={`py-2 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                          form.deliveryMethod === option.id
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="checkout-name"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Tên người nhận (không bắt buộc)
                  </label>
                  <input
                    id="checkout-name"
                    type="text"
                    value={form.customerName}
                    onChange={(e) =>
                      handleFieldChange('customerName', e.target.value)
                    }
                    placeholder="Không bắt buộc — ví dụ: Chị Hương"
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-700"
                  />
                </div>

                <div>
                  <label
                    htmlFor="checkout-phone"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Số điện thoại liên hệ *
                  </label>
                  <input
                    id="checkout-phone"
                    type="tel"
                    required
                    value={form.phone}
                    onChange={(e) => handleFieldChange('phone', e.target.value)}
                    placeholder="0916319452"
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-700"
                  />
                  {errors.phone && (
                    <p role="alert" className="mt-1 text-xs text-red-600">
                      {errors.phone}
                    </p>
                  )}
                </div>

                {form.deliveryMethod === 'delivery' && (
                  <div>
                    <label
                      htmlFor="checkout-address"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Địa chỉ giao hàng *
                    </label>
                    <input
                      id="checkout-address"
                      type="text"
                      required
                      value={form.address}
                      onChange={(e) =>
                        handleFieldChange('address', e.target.value)
                      }
                      placeholder="Ví dụ: Phòng 1205 tòa CT2 Green Star..."
                      className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-700"
                    />
                    {errors.address && (
                      <p role="alert" className="mt-1 text-xs text-red-600">
                        {errors.address}
                      </p>
                    )}
                  </div>
                )}

                <BankTransferQR
                  amount={summary.total}
                  orderId={draftOrderCode}
                />

                <div>
                  <label
                    htmlFor="checkout-note"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Ghi chú cho cửa hàng (tùy chọn)
                  </label>
                  <input
                    id="checkout-note"
                    type="text"
                    value={form.note}
                    onChange={(e) => handleFieldChange('note', e.target.value)}
                    placeholder="Ví dụ: Giao sau 20h, gói quà giúp..."
                    className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-700"
                  />
                </div>
              </form>
            </div>
          )}
        </div>

        {!confirmedOrder && items.length > 0 && (
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 space-y-3">
            <div className="flex justify-between text-base font-bold text-slate-900">
              <span>Tổng thanh toán</span>
              <span className="text-blue-700 tabular-nums">
                {formatVnd(summary.total)}
              </span>
            </div>

            <button
              type="submit"
              form="fast-checkout-form"
              className="w-full py-3 px-4 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              Xác nhận đặt hàng · {formatVnd(summary.total)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

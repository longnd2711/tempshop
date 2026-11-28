import { useEffect, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import type { Product } from '../types/shop';
import {
  clampOrderQuantity,
  formatStockAndOrderedDisplay,
  formatVnd,
  MAX_ORDER_QUANTITY,
} from '../utils/shopLogic';
import { SafeImage } from './SafeImage';

interface ProductModalProps {
  product: Product | null;
  isAuthenticated?: boolean;
  onClose: () => void;
  onAddToCart: (product: Product, variant: string, quantity: number) => void;
}

export function ProductModal({
  product,
  isAuthenticated = false,
  onClose,
  onAddToCart,
}: ProductModalProps) {
  const [selectedVariant, setSelectedVariant] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [qtyInput, setQtyInput] = useState('1');
  const [activeImageIdx, setActiveImageIdx] = useState(0);

  useEffect(() => {
    if (product) {
      setSelectedVariant(product.variants[0] ?? 'Tiêu chuẩn');
      setQuantity(1);
      setQtyInput('1');
      setActiveImageIdx(0);
    }
  }, [product]);

  useEffect(() => {
    if (!product) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [product, onClose]);

  if (!product) return null;

  const galleryImages =
    product.images && product.images.length > 0
      ? product.images
      : product.image
        ? [product.image]
        : [];
  const mainImage = galleryImages[activeImageIdx] ?? product.image;

  const updateQuantity = (next: number) => {
    const clamped = clampOrderQuantity(next, MAX_ORDER_QUANTITY);
    setQuantity(clamped);
    setQtyInput(String(clamped));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-modal-title"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[92vh] overflow-y-auto bg-white rounded-xl border border-slate-200 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng chi tiết sản phẩm"
          className="absolute top-3 right-3 z-10 w-10 h-10 inline-flex items-center justify-center rounded-lg bg-white/95 text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>

        <div className="grid grid-cols-1 md:grid-cols-12 items-stretch">
          <div className="md:col-span-6 bg-slate-100 border-b md:border-b-0 md:border-r border-slate-200 flex flex-col">
            <div className="aspect-[4/3] md:flex-1 w-full">
              <SafeImage
                src={mainImage}
                alt={product.name}
                fallbackLabel={product.name}
                className="w-full h-full object-cover object-center"
              />
            </div>

            {galleryImages.length > 1 && (
              <div className="p-2.5 bg-white border-t border-slate-200 flex items-center gap-2 overflow-x-auto">
                {galleryImages.map((imgUrl, idx) => (
                  <button
                    key={imgUrl + idx}
                    type="button"
                    onClick={() => setActiveImageIdx(idx)}
                    aria-label={`Xem ảnh ${idx + 1} của ${product.name}`}
                    className={`w-12 h-12 rounded-md overflow-hidden border-2 shrink-0 cursor-pointer ${
                      idx === activeImageIdx
                        ? 'border-blue-700'
                        : 'border-slate-200 opacity-75 hover:opacity-100'
                    }`}
                  >
                    <SafeImage
                      src={imgUrl}
                      alt={`${product.name} ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="md:col-span-6 p-5 sm:p-6 flex flex-col justify-between">
            <div>
              <p className="text-xs text-slate-500">
                {product.categoryLabel || product.category}
                <span aria-hidden="true"> · </span>
                <span className="font-mono">{product.sku}</span>
                {product.brand && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span>{product.brand}</span>
                  </>
                )}
              </p>

              <h3
                id="product-modal-title"
                className="mt-2 font-display text-xl font-bold text-slate-900 leading-snug"
              >
                {product.name}
              </h3>

              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-900 tabular-nums">
                  {formatVnd(product.price)}
                </span>
                {isAuthenticated && (
                  <span className="text-sm text-slate-500">/ {product.unit}</span>
                )}
              </div>

              <p className="mt-3 text-sm text-slate-600 leading-relaxed">
                {product.notes || product.description}
              </p>

              <div className="mt-5">
                <p className="text-xs font-medium text-slate-700 mb-2">
                  Chọn phân loại
                </p>
                <div className="flex flex-wrap gap-2">
                  {product.variants.map((variant) => {
                    const active = selectedVariant === variant;
                    return (
                      <button
                        key={variant}
                        type="button"
                        onClick={() => setSelectedVariant(variant)}
                        className={`min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                          active
                            ? 'border-blue-700 bg-blue-50 text-blue-800'
                            : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                        }`}
                      >
                        {variant}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-200">
              <div className="flex items-center justify-between gap-3 mb-4">
                {isAuthenticated ? (
                  <span className="text-xs text-slate-500">
                    Tình trạng:{' '}
                    <strong className="font-medium text-slate-800 tabular-nums">
                      {formatStockAndOrderedDisplay(
                        product.stock,
                        product.unit,
                        product.orderedQuantity,
                      )}
                    </strong>
                  </span>
                ) : (
                  <label
                    htmlFor="product-modal-qty"
                    className="text-xs font-medium text-slate-700"
                  >
                    Số lượng đặt (tối đa {MAX_ORDER_QUANTITY})
                  </label>
                )}

                <div className="inline-flex items-center border border-slate-300 rounded-lg">
                  <button
                    type="button"
                    disabled={quantity <= 1}
                    onClick={() => updateQuantity(quantity - 1)}
                    aria-label="Giảm số lượng đặt"
                    className="w-10 h-10 inline-flex items-center justify-center text-slate-700 hover:bg-slate-100 disabled:opacity-40 rounded-l-lg cursor-pointer"
                  >
                    <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <input
                    id="product-modal-qty"
                    type="number"
                    min={1}
                    max={MAX_ORDER_QUANTITY}
                    inputMode="numeric"
                    value={qtyInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setQtyInput(val);
                      const parsed = Number(val);
                      if (val.trim() !== '' && Number.isFinite(parsed) && parsed > 0) {
                        setQuantity(clampOrderQuantity(parsed, MAX_ORDER_QUANTITY));
                      }
                    }}
                    onBlur={() => updateQuantity(qtyInput === '' ? 1 : Number(qtyInput))}
                    aria-label="Nhập số lượng đặt hàng"
                    className="w-14 h-10 text-center text-sm font-semibold text-slate-900 tabular-nums bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    disabled={quantity >= MAX_ORDER_QUANTITY}
                    onClick={() => updateQuantity(quantity + 1)}
                    aria-label="Tăng số lượng đặt"
                    className="w-10 h-10 inline-flex items-center justify-center text-slate-700 hover:bg-slate-100 disabled:opacity-40 rounded-r-lg cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  const finalQty = clampOrderQuantity(
                    qtyInput.trim() === '' ? quantity : Number(qtyInput),
                    MAX_ORDER_QUANTITY,
                  );
                  onAddToCart(product, selectedVariant, finalQty);
                  onClose();
                }}
                className="w-full min-h-[44px] py-2.5 px-4 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
              >
                Thêm vào giỏ · {formatVnd(product.price * quantity)}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

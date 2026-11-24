import { useEffect, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import type { Product } from '../types/shop';
import { formatVnd } from '../utils/shopLogic';
import { SafeImage } from './SafeImage';

interface ProductModalProps {
  product: Product | null;
  onClose: () => void;
  onAddToCart: (product: Product, variant: string, quantity: number) => void;
}

export function ProductModal({
  product,
  onClose,
  onAddToCart,
}: ProductModalProps) {
  const [selectedVariant, setSelectedVariant] = useState('');
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (product) {
      setSelectedVariant(product.variants[0] ?? 'Tiêu chuẩn');
      setQuantity(1);
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-modal-title"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng chi tiết sản phẩm"
          className="absolute top-3 right-3 z-10 w-9 h-9 inline-flex items-center justify-center rounded-lg bg-white/90 text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>

        <div className="grid grid-cols-1 md:grid-cols-12 items-stretch">
          <div className="md:col-span-6 bg-slate-100 border-b md:border-b-0 md:border-r border-slate-200">
            <div className="aspect-[4/3] md:h-full w-full">
              <SafeImage
                src={product.image}
                alt={product.name}
                fallbackLabel={product.name}
                className="w-full h-full object-cover object-center"
              />
            </div>
          </div>

          <div className="md:col-span-6 p-6 flex flex-col justify-between">
            <div>
              <p className="text-xs text-slate-500">
                {product.categoryLabel}
                <span aria-hidden="true"> · </span>
                <span className="font-mono">{product.sku}</span>
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
                <span className="text-sm text-slate-500">/ {product.unit}</span>
              </div>

              <p className="mt-3 text-sm text-slate-600 leading-relaxed">
                {product.description}
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
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
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
                <span className="text-xs text-slate-500">
                  Tình trạng:{' '}
                  <strong className="font-medium text-slate-800">
                    {product.stock > 0
                      ? `Còn ${product.stock} ${product.unit.toLowerCase()}`
                      : 'Nhận đặt hàng'}
                  </strong>
                </span>

                <div className="inline-flex items-center border border-slate-300 rounded-lg">
                  <button
                    type="button"
                    disabled={quantity <= 1}
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    aria-label="Giảm số lượng đặt"
                    className="w-9 h-9 inline-flex items-center justify-center text-slate-700 hover:bg-slate-100 disabled:opacity-40 rounded-l-lg cursor-pointer"
                  >
                    <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <span className="w-9 text-center text-sm font-semibold tabular-nums">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => q + 1)}
                    aria-label="Tăng số lượng đặt"
                    className="w-9 h-9 inline-flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded-r-lg cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  onAddToCart(product, selectedVariant, quantity);
                  onClose();
                }}
                className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer"
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

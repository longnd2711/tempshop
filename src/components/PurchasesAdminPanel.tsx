import { Fragment, useMemo, useState, type FormEvent } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  PackagePlus,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { createPurchaseOrderInSupabase } from '../lib/supabaseAdmin';
import type {
  CategoryNode,
  Product,
  PurchaseOrderItem,
  PurchaseOrderRecord,
} from '../types/shop';
import {
  calculatePurchaseSummary,
  computePurchaseLineTotal,
  generatePurchaseCode,
  parseImageUrlsInput,
  syncDiscountFromAmount,
  syncDiscountFromPercent,
} from '../utils/adminLogic';
import { formatVnd, normalizeVietnameseText } from '../utils/shopLogic';
import { ProductImageUploader } from './ProductImageUploader';

interface PurchasesAdminPanelProps {
  purchaseOrders: PurchaseOrderRecord[];
  products: Product[];
  categories: CategoryNode[];
  isLoading: boolean;
  notice?: string;
  onRefresh: () => Promise<void>;
}

type LineItemMode = 'existing' | 'new';
type DiscountDriver = 'percent' | 'amount';

export function PurchasesAdminPanel({
  purchaseOrders,
  products,
  categories,
  isLoading,
  notice,
  onRefresh,
}: PurchasesAdminPanelProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [poCode, setPoCode] = useState(() => generatePurchaseCode());
  const [supplierName, setSupplierName] = useState('');
  const [note, setNote] = useState('');
  const [updateCostPrice, setUpdateCostPrice] = useState(true);

  const [itemMode, setItemMode] = useState<LineItemMode>('existing');
  const [productFilterText, setProductFilterText] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedUnitMode, setSelectedUnitMode] = useState<'base' | 'pack'>('base');

  // New inline product fields (used when itemMode === 'new')
  const [newSku, setNewSku] = useState('');
  const [newName, setNewName] = useState('');
  const [newCategoryId, setNewCategoryId] = useState('');
  const [newBrand, setNewBrand] = useState('');
  const [newBarcode, setNewBarcode] = useState('');
  const [newBaseUnit, setNewBaseUnit] = useState('Cái');
  const [newUnit, setNewUnit] = useState('Cái');
  const [newConversionRate, setNewConversionRate] = useState('1');
  const [newImageUrlsText, setNewImageUrlsText] = useState('');

  // Shared pricing & discount fields
  const [draftQty, setDraftQty] = useState('1');
  const [draftUnitCost, setDraftUnitCost] = useState('0');
  const [draftDiscountPercent, setDraftDiscountPercent] = useState('0');
  const [draftDiscountAmount, setDraftDiscountAmount] = useState('0');
  const [discountDriver, setDiscountDriver] = useState<DiscountDriver>('percent');
  const [draftSellingPrice, setDraftSellingPrice] = useState('0');

  const [draftItems, setDraftItems] = useState<PurchaseOrderItem[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [expandedPoId, setExpandedPoId] = useState<string | null>(null);

  const filteredProductOptions = useMemo(() => {
    const norm = normalizeVietnameseText(productFilterText);
    if (!norm) return products;
    return products.filter((p) =>
      normalizeVietnameseText(`${p.sku} ${p.name}`).includes(norm),
    );
  }, [products, productFilterText]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) ?? null,
    [products, selectedProductId],
  );

  const draftSummary = useMemo(
    () => calculatePurchaseSummary(draftItems),
    [draftItems],
  );

  const historyStats = useMemo(() => {
    const totalReceipts = purchaseOrders.length;
    const totalImportValue = purchaseOrders.reduce(
      (sum, po) => sum + po.totalAmount,
      0,
    );
    const totalItemsImported = purchaseOrders.reduce(
      (sum, po) => sum + po.itemCount,
      0,
    );
    return { totalReceipts, totalImportValue, totalItemsImported };
  }, [purchaseOrders]);

  const previewLine = useMemo(() => {
    const unitCost = Number(draftUnitCost) || 0;
    const discountAmt = Number(draftDiscountAmount) || 0;
    const qty = Number(draftQty) || 0;
    return computePurchaseLineTotal(qty, unitCost, discountAmt);
  }, [draftQty, draftUnitCost, draftDiscountAmount]);

  const handleSelectProduct = (prodId: string) => {
    setSelectedProductId(prodId);
    const prod = products.find((p) => p.id === prodId);
    if (!prod) return;
    setSelectedUnitMode('base');
    const baseCost = prod.costPrice ?? 0;
    setDraftUnitCost(String(baseCost));
    setDraftDiscountPercent('0');
    setDraftDiscountAmount('0');
    setDiscountDriver('percent');
    setDraftSellingPrice(String(prod.price ?? 0));
  };

  const handleSelectUnitMode = (mode: 'base' | 'pack') => {
    setSelectedUnitMode(mode);
    if (!selectedProduct) return;
    const conv =
      mode === 'pack' ? Math.max(1, selectedProduct.conversionRate ?? 1) : 1;
    const baseCost = selectedProduct.costPrice ?? 0;
    const nextUnitCost = baseCost > 0 ? Math.round(baseCost * conv) : 0;
    setDraftUnitCost(String(nextUnitCost));
    if (discountDriver === 'percent') {
      const synced = syncDiscountFromPercent(
        nextUnitCost,
        Number(draftDiscountPercent) || 0,
      );
      setDraftDiscountAmount(String(synced.discountAmount));
    } else {
      const synced = syncDiscountFromAmount(
        nextUnitCost,
        Number(draftDiscountAmount) || 0,
      );
      setDraftDiscountPercent(String(synced.discountPercent));
      setDraftDiscountAmount(String(synced.discountAmount));
    }
  };

  const handleDraftUnitCostChange = (rawValue: string) => {
    setDraftUnitCost(rawValue);
    const unitCost = Math.max(0, Number(rawValue) || 0);
    if (discountDriver === 'percent') {
      const synced = syncDiscountFromPercent(
        unitCost,
        Number(draftDiscountPercent) || 0,
      );
      setDraftDiscountAmount(String(synced.discountAmount));
    } else {
      const synced = syncDiscountFromAmount(
        unitCost,
        Number(draftDiscountAmount) || 0,
      );
      setDraftDiscountPercent(String(synced.discountPercent));
      setDraftDiscountAmount(String(synced.discountAmount));
    }
  };

  const handleDraftDiscountPercentChange = (rawValue: string) => {
    setDraftDiscountPercent(rawValue);
    setDiscountDriver('percent');
    const unitCost = Math.max(0, Number(draftUnitCost) || 0);
    const synced = syncDiscountFromPercent(unitCost, Number(rawValue) || 0);
    setDraftDiscountAmount(String(synced.discountAmount));
  };

  const handleDraftDiscountAmountChange = (rawValue: string) => {
    setDraftDiscountAmount(rawValue);
    setDiscountDriver('amount');
    const unitCost = Math.max(0, Number(draftUnitCost) || 0);
    const synced = syncDiscountFromAmount(unitCost, Number(rawValue) || 0);
    setDraftDiscountPercent(String(synced.discountPercent));
  };

  const handleAddDraftItem = () => {
    const qty = Number(draftQty);
    const unitCost = Math.max(0, Number(draftUnitCost) || 0);
    const discountAmount = Math.min(
      unitCost,
      Math.max(0, Number(draftDiscountAmount) || 0),
    );
    const discountPercent =
      unitCost > 0
        ? Number(((discountAmount / unitCost) * 100).toFixed(2))
        : Math.min(100, Math.max(0, Number(draftDiscountPercent) || 0));
    const sellingPrice = Math.max(0, Number(draftSellingPrice) || 0);
    const { netUnitCost, lineTotal } = computePurchaseLineTotal(
      qty,
      unitCost,
      discountAmount,
    );

    if (!Number.isFinite(qty) || qty <= 0) {
      setFormError('Số lượng nhập phải lớn hơn 0.');
      return;
    }

    if (itemMode === 'existing') {
      if (!selectedProduct) {
        setFormError('Vui lòng chọn một mặt hàng để thêm vào phiếu nhập.');
        return;
      }

      const conversionFactor =
        selectedUnitMode === 'pack'
          ? Math.max(0.01, selectedProduct.conversionRate ?? 1)
          : 1;
      const unitLabel =
        selectedUnitMode === 'pack'
          ? selectedProduct.unit
          : selectedProduct.baseUnit ?? selectedProduct.unit;

      setFormError(null);
      setDraftItems((prev) => [
        ...prev,
        {
          productId: selectedProduct.id,
          sku: selectedProduct.sku,
          productName: selectedProduct.name,
          unitLabel,
          conversionFactor,
          quantity: qty,
          unitCost,
          discountPercent,
          discountAmount,
          netUnitCost,
          sellingPrice,
          lineTotal,
          isNewProduct: false,
        },
      ]);
      setDraftQty('1');
      return;
    }

    // Creating a new product directly inside the purchase order
    const cleanSku = newSku.trim().toUpperCase();
    const cleanName = newName.trim();
    if (!cleanSku || !cleanName) {
      setFormError('Vui lòng nhập Mã hàng (SKU) và Tên hàng hóa mới.');
      return;
    }

    const baseUnit = newBaseUnit.trim() || 'Cái';
    const packUnit = newUnit.trim() || baseUnit;
    const convRate = Math.max(0.01, Number(newConversionRate) || 1);
    const unitLabel = selectedUnitMode === 'pack' ? packUnit : baseUnit;
    const conversionFactor = selectedUnitMode === 'pack' ? convRate : 1;

    setFormError(null);
    setDraftItems((prev) => [
      ...prev,
      {
        productId: '',
        sku: cleanSku,
        productName: cleanName,
        unitLabel,
        conversionFactor,
        quantity: qty,
        unitCost,
        discountPercent,
        discountAmount,
        netUnitCost,
        sellingPrice,
        lineTotal,
        isNewProduct: true,
        newProductCategoryId: newCategoryId || null,
        newProductBarcode: newBarcode.trim() || undefined,
        newProductBrand: newBrand.trim() || undefined,
        newProductBaseUnit: baseUnit,
        newProductUnit: packUnit,
        newProductConversionRate: convRate,
        newProductImageUrls: parseImageUrlsInput(newImageUrlsText),
      },
    ]);

    setNewSku('');
    setNewName('');
    setNewBarcode('');
    setNewBrand('');
    setNewImageUrlsText('');
    setDraftQty('1');
    setDraftUnitCost('0');
    setDraftDiscountPercent('0');
    setDraftDiscountAmount('0');
    setDraftSellingPrice('0');
  };

  const handleUpdateDraftRow = (
    idx: number,
    patch: {
      quantity?: number;
      unitCost?: number;
      discountPercent?: number;
      discountAmount?: number;
      sellingPrice?: number;
    },
  ) => {
    setDraftItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const nextQty =
          patch.quantity !== undefined
            ? Math.max(0.01, Number(patch.quantity) || 0)
            : item.quantity;
        const nextUnitCost =
          patch.unitCost !== undefined
            ? Math.max(0, Number(patch.unitCost) || 0)
            : item.unitCost;

        let nextDiscountPct = item.discountPercent;
        let nextDiscountAmt = item.discountAmount;

        if (patch.discountPercent !== undefined) {
          const synced = syncDiscountFromPercent(
            nextUnitCost,
            patch.discountPercent,
          );
          nextDiscountPct = synced.discountPercent;
          nextDiscountAmt = synced.discountAmount;
        } else if (patch.discountAmount !== undefined) {
          const synced = syncDiscountFromAmount(
            nextUnitCost,
            patch.discountAmount,
          );
          nextDiscountPct = synced.discountPercent;
          nextDiscountAmt = synced.discountAmount;
        } else if (patch.unitCost !== undefined) {
          const synced = syncDiscountFromPercent(
            nextUnitCost,
            item.discountPercent,
          );
          nextDiscountPct = synced.discountPercent;
          nextDiscountAmt = synced.discountAmount;
        }

        const { netUnitCost, lineTotal } = computePurchaseLineTotal(
          nextQty,
          nextUnitCost,
          nextDiscountAmt,
        );

        return {
          ...item,
          quantity: nextQty,
          unitCost: nextUnitCost,
          discountPercent: nextDiscountPct,
          discountAmount: nextDiscountAmt,
          netUnitCost,
          sellingPrice:
            patch.sellingPrice !== undefined
              ? Math.max(0, Number(patch.sellingPrice) || 0)
              : item.sellingPrice,
          lineTotal,
        };
      }),
    );
  };

  const handleRemoveDraftItem = (idx: number) => {
    setDraftItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const openNewPurchaseOrder = () => {
    setPoCode(generatePurchaseCode());
    setSupplierName('');
    setNote('');
    setUpdateCostPrice(true);
    setDraftItems([]);
    setFormError(null);
    setItemMode('existing');
    setProductFilterText('');
    setDraftDiscountPercent('0');
    setDraftDiscountAmount('0');
    setDiscountDriver('percent');
    setNewImageUrlsText('');
    if (products[0]) {
      setSelectedProductId(products[0].id);
      setSelectedUnitMode('base');
      setDraftUnitCost(String(products[0].costPrice ?? 0));
      setDraftSellingPrice(String(products[0].price ?? 0));
    } else {
      setItemMode('new');
      setDraftUnitCost('0');
      setDraftSellingPrice('0');
    }
    setIsCreateOpen(true);
  };

  const handleCreatePurchaseOrder = async (e: FormEvent) => {
    e.preventDefault();
    if (!poCode.trim()) {
      setFormError('Vui lòng nhập Mã phiếu nhập.');
      return;
    }
    if (draftItems.length === 0) {
      setFormError('Vui lòng thêm ít nhất 1 sản phẩm vào đơn nhập hàng.');
      return;
    }

    setFormError(null);
    setIsSubmitting(true);
    try {
      const res = await createPurchaseOrderInSupabase({
        poCode,
        supplierName,
        note,
        updateCostPrice,
        items: draftItems,
      });

      if (!res.ok) {
        setFormError(res.errorMessage ?? 'Không thể tạo đơn nhập hàng.');
        return;
      }

      setIsCreateOpen(false);
      setDraftItems([]);
      setFeedback(
        `Đã lưu đơn nhập hàng ${poCode.trim()}, cập nhật tồn kho & giá sản phẩm.`,
      );
      await onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div id="purchases-management" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Nhập hàng &amp; Phiếu nhập kho
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Hỗ trợ giảm giá % / đ tự quy đổi, tạo thẳng hàng hóa mới khi chưa có sẵn và chỉnh giá bán ngay trên phiếu.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={isLoading}
            className="inline-flex items-center justify-center gap-2 min-h-[40px] px-3.5 py-2 text-sm font-semibold text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
          >
            <RefreshCw
              className={`w-4 h-4 shrink-0 ${isLoading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>Làm mới</span>
          </button>

          <button
            type="button"
            onClick={openNewPurchaseOrder}
            className="inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <PackagePlus className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Tạo đơn nhập hàng</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Tổng số đơn nhập</p>
          <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {historyStats.totalReceipts}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Tổng dòng hàng đã nhập</p>
          <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {historyStats.totalItemsImported}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Tổng giá trị nhập kho</p>
          <p className="mt-1 font-display text-2xl font-bold text-blue-700 tabular-nums">
            {formatVnd(historyStats.totalImportValue)}
          </p>
        </div>
      </div>

      {(notice || feedback) && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg"
        >
          <span>{feedback || notice}</span>
          {feedback && (
            <button
              type="button"
              onClick={() => setFeedback(null)}
              aria-label="Đóng thông báo"
              className="p-1 text-amber-700 hover:text-amber-900 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {isCreateOpen && (
        <div className="bg-white border border-blue-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <h3 className="font-display text-lg font-bold text-slate-900">
              Phiếu nhập hàng mới
            </h3>
            <button
              type="button"
              onClick={() => setIsCreateOpen(false)}
              aria-label="Đóng phiếu nhập hàng"
              className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form
            onSubmit={(e) => void handleCreatePurchaseOrder(e)}
            className="space-y-5"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Mã đơn nhập *
                </label>
                <input
                  type="text"
                  required
                  value={poCode}
                  onChange={(e) => setPoCode(e.target.value)}
                  className="w-full min-h-[40px] px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nhà cung cấp / Nguồn hàng
                </label>
                <input
                  type="text"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="VD: Tổng kho Hồng Hà, Chợ Đồng Xuân..."
                  className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Ghi chú đơn nhập
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ghi chú công nợ, ngày giao..."
                  className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Thêm mặt hàng vào phiếu
                </p>

                <div className="inline-flex p-1 bg-slate-200/80 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setItemMode('existing')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                      itemMode === 'existing'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Hàng đã có sẵn
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setItemMode('new');
                      setSelectedUnitMode('base');
                      setDraftUnitCost('0');
                      setDraftDiscountPercent('0');
                      setDraftDiscountAmount('0');
                      setDraftSellingPrice('0');
                    }}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                      itemMode === 'new'
                        ? 'bg-blue-700 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    + Tạo hàng mới ngay
                  </button>
                </div>
              </div>

              {itemMode === 'existing' ? (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                  <div className="md:col-span-6 space-y-1.5">
                    <label className="block text-xs font-medium text-slate-700">
                      Tìm &amp; chọn hàng hóa có sẵn
                    </label>
                    <input
                      type="search"
                      value={productFilterText}
                      onChange={(e) => setProductFilterText(e.target.value)}
                      placeholder="Lọc nhanh theo tên hoặc SKU..."
                      className="w-full min-h-[36px] px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                    />
                    <select
                      aria-label="Chọn mặt hàng cần nhập"
                      value={selectedProductId}
                      onChange={(e) => handleSelectProduct(e.target.value)}
                      className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="">
                        -- Chọn sản phẩm ({filteredProductOptions.length}) --
                      </option>
                      {filteredProductOptions.map((prod) => (
                        <option key={prod.id} value={prod.id}>
                          [{prod.sku}] {prod.name} (Tồn: {prod.stock} · Giá bán:{' '}
                          {formatVnd(prod.price)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-3">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Đơn vị nhập
                    </label>
                    <select
                      value={selectedUnitMode}
                      onChange={(e) =>
                        handleSelectUnitMode(e.target.value as 'base' | 'pack')
                      }
                      disabled={!selectedProduct}
                      className="w-full min-h-[40px] px-2.5 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="base">
                        {selectedProduct?.baseUnit ?? selectedProduct?.unit ?? 'Cơ bản'} (x1)
                      </option>
                      {selectedProduct &&
                        (selectedProduct.conversionRate ?? 1) > 1 && (
                          <option value="pack">
                            {selectedProduct.unit} (x{selectedProduct.conversionRate})
                          </option>
                        )}
                    </select>
                  </div>

                  <div className="md:col-span-3">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Giá bán mới / hiện tại (đ)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={draftSellingPrice}
                      onChange={(e) => setDraftSellingPrice(e.target.value)}
                      className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg font-semibold text-blue-700"
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Mã hàng (SKU) *
                    </label>
                    <input
                      type="text"
                      value={newSku}
                      onChange={(e) => setNewSku(e.target.value)}
                      placeholder="VD: VPP-MOI-01"
                      className="w-full min-h-[40px] px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Tên hàng hóa mới *
                    </label>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="VD: Bút dạ quang Pastel hộp 6 cây"
                      className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Nhóm hàng
                    </label>
                    <select
                      value={newCategoryId}
                      onChange={(e) => setNewCategoryId(e.target.value)}
                      className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="">-- Chọn nhóm hàng --</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Thương hiệu
                    </label>
                    <input
                      type="text"
                      value={newBrand}
                      onChange={(e) => setNewBrand(e.target.value)}
                      placeholder="Thiên Long, Hồng Hà..."
                      className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Mã vạch (nếu có)
                    </label>
                    <input
                      type="text"
                      value={newBarcode}
                      onChange={(e) => setNewBarcode(e.target.value)}
                      placeholder="893..."
                      className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">
                        ĐVT cơ bản
                      </label>
                      <input
                        type="text"
                        value={newBaseUnit}
                        onChange={(e) => setNewBaseUnit(e.target.value)}
                        className="w-full min-h-[40px] px-2.5 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">
                        ĐVT quy cách
                      </label>
                      <input
                        type="text"
                        value={newUnit}
                        onChange={(e) => setNewUnit(e.target.value)}
                        className="w-full min-h-[40px] px-2.5 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">
                        Quy đổi
                      </label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={newConversionRate}
                        onChange={(e) => setNewConversionRate(e.target.value)}
                        className="w-full min-h-[40px] px-2.5 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Giá bán (đ) *
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={draftSellingPrice}
                      onChange={(e) => setDraftSellingPrice(e.target.value)}
                      className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg font-semibold text-blue-700"
                    />
                  </div>

                  <div className="sm:col-span-2 lg:col-span-4">
                    <ProductImageUploader
                      sku={newSku}
                      imageUrlsText={newImageUrlsText}
                      onChangeImageUrlsText={setNewImageUrlsText}
                      compact
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end pt-1 border-t border-slate-200/80">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Số lượng nhập
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="1"
                    value={draftQty}
                    onChange={(e) => setDraftQty(e.target.value)}
                    className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Đơn giá nhập (đ)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={draftUnitCost}
                    onChange={(e) => handleDraftUnitCostChange(e.target.value)}
                    className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Giảm giá %
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={draftDiscountPercent}
                    onChange={(e) =>
                      handleDraftDiscountPercentChange(e.target.value)
                    }
                    className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Giảm giá đ (trên ĐV)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={draftDiscountAmount}
                    onChange={(e) =>
                      handleDraftDiscountAmountChange(e.target.value)
                    }
                    className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <button
                    type="button"
                    onClick={handleAddDraftItem}
                    className="w-full min-h-[40px] px-3 py-2 inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-lg cursor-pointer"
                  >
                    <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Thêm dòng</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                <span>
                  Đơn giá nhập sau giảm:{' '}
                  <strong className="text-slate-900 tabular-nums">
                    {formatVnd(previewLine.netUnitCost)}
                  </strong>
                  {' · '}Thành tiền dòng:{' '}
                  <strong className="text-blue-700 tabular-nums">
                    {formatVnd(previewLine.lineTotal)}
                  </strong>
                </span>
                {itemMode === 'existing' && selectedProduct && (
                  <span>
                    Giá bán hiện tại trên web:{' '}
                    <strong>{formatVnd(selectedProduct.price)}</strong>
                  </span>
                )}
              </div>
            </div>

            {draftItems.length > 0 && (
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[960px] text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 px-3">Mặt hàng</th>
                        <th className="py-2.5 px-3">ĐVT</th>
                        <th className="py-2.5 px-3 text-right">SL</th>
                        <th className="py-2.5 px-3 text-right">Đơn giá nhập</th>
                        <th className="py-2.5 px-3 text-right">Giảm giá %</th>
                        <th className="py-2.5 px-3 text-right">Giảm giá đ</th>
                        <th className="py-2.5 px-3 text-right">Giá bán (đ)</th>
                        <th className="py-2.5 px-3 text-right">Thành tiền</th>
                        <th className="py-2.5 px-3 text-right">Xóa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {draftItems.map((item, idx) => (
                        <tr key={`${item.sku}-${idx}`}>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-1.5">
                              <p className="font-medium text-slate-900">
                                {item.productName}
                              </p>
                              {item.isNewProduct && (
                                <span className="px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded">
                                  Hàng mới
                                </span>
                              )}
                            </div>
                            <p className="font-mono text-xs text-slate-500">
                              {item.sku}
                            </p>
                          </td>
                          <td className="py-2.5 px-3 text-xs text-slate-600 whitespace-nowrap">
                            {item.unitLabel} (x{item.conversionFactor})
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <input
                              type="number"
                              min="0.01"
                              step="1"
                              aria-label={`Số lượng ${item.productName}`}
                              value={item.quantity}
                              onChange={(e) =>
                                handleUpdateDraftRow(idx, {
                                  quantity: Number(e.target.value),
                                })
                              }
                              className="w-16 px-2 py-1 text-right text-xs border border-slate-300 rounded"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <input
                              type="number"
                              min="0"
                              step="100"
                              aria-label={`Đơn giá nhập ${item.productName}`}
                              value={item.unitCost}
                              onChange={(e) =>
                                handleUpdateDraftRow(idx, {
                                  unitCost: Number(e.target.value),
                                })
                              }
                              className="w-24 px-2 py-1 text-right text-xs border border-slate-300 rounded"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.5"
                              aria-label={`Giảm giá % ${item.productName}`}
                              value={item.discountPercent}
                              onChange={(e) =>
                                handleUpdateDraftRow(idx, {
                                  discountPercent: Number(e.target.value),
                                })
                              }
                              className="w-16 px-2 py-1 text-right text-xs border border-slate-300 rounded"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <input
                              type="number"
                              min="0"
                              step="100"
                              aria-label={`Giảm giá đ ${item.productName}`}
                              value={item.discountAmount}
                              onChange={(e) =>
                                handleUpdateDraftRow(idx, {
                                  discountAmount: Number(e.target.value),
                                })
                              }
                              className="w-24 px-2 py-1 text-right text-xs border border-slate-300 rounded"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <input
                              type="number"
                              min="0"
                              step="100"
                              aria-label={`Giá bán ${item.productName}`}
                              value={item.sellingPrice ?? 0}
                              onChange={(e) =>
                                handleUpdateDraftRow(idx, {
                                  sellingPrice: Number(e.target.value),
                                })
                              }
                              className="w-24 px-2 py-1 text-right text-xs font-semibold text-blue-700 border border-slate-300 rounded"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                            {formatVnd(item.lineTotal)}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleRemoveDraftItem(idx)}
                              aria-label={`Xóa dòng ${item.productName}`}
                              className="p-1.5 text-rose-700 hover:bg-rose-50 rounded cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
                    <span>
                      <strong>{draftSummary.itemCount}</strong> mặt hàng (SL:{' '}
                      <strong>{draftSummary.totalQuantity}</strong>)
                    </span>
                    <span>
                      Tiền hàng gốc:{' '}
                      <strong>{formatVnd(draftSummary.totalGrossAmount)}</strong>
                    </span>
                    {draftSummary.totalDiscountAmount > 0 && (
                      <span className="text-emerald-700">
                        Tổng giảm:{' '}
                        <strong>
                          -{formatVnd(draftSummary.totalDiscountAmount)}
                        </strong>
                      </span>
                    )}
                  </div>
                  <span className="font-display text-lg font-bold text-blue-700 tabular-nums">
                    Tổng phiếu: {formatVnd(draftSummary.totalAmount)}
                  </span>
                </div>
              </div>
            )}

            <label className="inline-flex items-center gap-2 text-sm text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={updateCostPrice}
                onChange={(e) => setUpdateCostPrice(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-700"
              />
              <span>
                Tự động cập nhật giá nhập (cost_price sau giảm giá) cho sản phẩm theo phiếu này
              </span>
            </label>

            {formError && (
              <div
                role="alert"
                className="px-3.5 py-2.5 text-xs font-medium text-rose-800 bg-rose-50 border border-rose-200 rounded-lg"
              >
                {formError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="min-h-[40px] px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer disabled:opacity-60"
              >
                <Check className="w-4 h-4" aria-hidden="true" />
                <span>
                  {isSubmitting ? 'Đang lưu phiếu...' : 'Hoàn tất nhập hàng'}
                </span>
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        {purchaseOrders.length === 0 ? (
          <div className="py-12 px-6 text-center">
            <p className="font-display text-base font-semibold text-slate-900">
              Chưa có đơn nhập hàng nào
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Nhấn &quot;Tạo đơn nhập hàng&quot; để lập phiếu nhập kho đầu tiên.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Mã phiếu / Thời gian</th>
                  <th className="py-3 px-4">Nhà cung cấp</th>
                  <th className="py-3 px-4">Ghi chú</th>
                  <th className="py-3 px-4 text-center">Số mặt hàng</th>
                  <th className="py-3 px-4 text-right">Tổng tiền nhập</th>
                  <th className="py-3 px-4">Người lập</th>
                  <th className="py-3 px-4 text-right">Chi tiết</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {purchaseOrders.map((po) => {
                  const rowKey = po.id ?? po.poCode;
                  const isExpanded = expandedPoId === rowKey;
                  return (
                    <Fragment key={rowKey}>
                      <tr className="hover:bg-slate-50/70 align-middle">
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <p className="font-mono font-semibold text-slate-900">
                            {po.poCode}
                          </p>
                          <p className="text-xs text-slate-500 tabular-nums">
                            {po.importedAt || 'Vừa tạo'}
                          </p>
                        </td>
                        <td className="py-3.5 px-4 font-medium text-slate-800">
                          {po.supplierName || 'Chưa ghi tên NCC'}
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-600">
                          {po.note || '—'}
                        </td>
                        <td className="py-3.5 px-4 text-center tabular-nums">
                          {po.itemCount}
                        </td>
                        <td className="py-3.5 px-4 text-right font-bold tabular-nums text-blue-700">
                          {formatVnd(po.totalAmount)}
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-600">
                          {po.createdByEmail || 'Admin'}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedPoId(isExpanded ? null : rowKey)
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                          >
                            <span>{isExpanded ? 'Thu gọn' : 'Xem dòng'}</span>
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-50/80">
                          <td colSpan={7} className="px-6 py-4">
                            {po.items.length === 0 ? (
                              <p className="text-xs text-slate-500">
                                Không có chi tiết dòng hàng.
                              </p>
                            ) : (
                              <div className="border border-slate-200 bg-white rounded-lg overflow-hidden">
                                <table className="w-full text-left text-xs">
                                  <thead>
                                    <tr className="bg-slate-100 text-slate-600 border-b border-slate-200">
                                      <th className="py-2 px-3">Mã hàng</th>
                                      <th className="py-2 px-3">Tên hàng hóa</th>
                                      <th className="py-2 px-3">ĐVT</th>
                                      <th className="py-2 px-3 text-right">SL</th>
                                      <th className="py-2 px-3 text-right">Đơn giá nhập</th>
                                      <th className="py-2 px-3 text-right">Giảm giá</th>
                                      <th className="py-2 px-3 text-right">Giá bán</th>
                                      <th className="py-2 px-3 text-right">Thành tiền</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {po.items.map((item, idx) => (
                                      <tr key={`${rowKey}-item-${idx}`}>
                                        <td className="py-2 px-3 font-mono text-slate-600">
                                          {item.sku}
                                        </td>
                                        <td className="py-2 px-3 font-medium text-slate-900">
                                          {item.productName}
                                        </td>
                                        <td className="py-2 px-3 text-slate-600">
                                          {item.unitLabel} (x{item.conversionFactor})
                                        </td>
                                        <td className="py-2 px-3 text-right tabular-nums">
                                          {item.quantity}
                                        </td>
                                        <td className="py-2 px-3 text-right tabular-nums">
                                          {formatVnd(item.unitCost)}
                                        </td>
                                        <td className="py-2 px-3 text-right tabular-nums text-emerald-700">
                                          {item.discountAmount > 0
                                            ? `${item.discountPercent}% (${formatVnd(item.discountAmount)})`
                                            : '—'}
                                        </td>
                                        <td className="py-2 px-3 text-right tabular-nums text-blue-700">
                                          {item.sellingPrice !== undefined
                                            ? formatVnd(item.sellingPrice)
                                            : '—'}
                                        </td>
                                        <td className="py-2 px-3 text-right font-semibold tabular-nums text-slate-900">
                                          {formatVnd(item.lineTotal)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

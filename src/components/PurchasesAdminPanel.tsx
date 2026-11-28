import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Download,
  FileSpreadsheet,
  PackagePlus,
  Pencil,
  Phone,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  createCashVoucherInSupabase,
  createPurchaseOrderInSupabase,
  deleteAdminSupplier,
  updateProductStockBounds,
  upsertAdminSupplier,
} from '../lib/supabaseAdmin';
import type {
  CashVoucherRecord,
  CategoryNode,
  ExtraFeeItem,
  Product,
  PurchaseOrderItem,
  PurchaseOrderRecord,
  QuickVoucherDraft,
  SupplierRecord,
} from '../types/shop';
import {
  buildNeedImportCandidates,
  calculatePurchaseSummary,
  calculateSupplierDebtMap,
  computePurchaseLineTotal,
  EXTRA_FEE_PRESETS,
  formatStockBoundInput,
  generatePurchaseCode,
  generateVoucherCode,
  getEffectivePurchasePackOptions,
  getLatestProductImportCostMap,
  getPurchaseOrderRemainingDebt,
  normalizeExtraFees,
  parseImageUrlsInput,
  parseNullableStockBound,
  syncDiscountFromAmount,
  syncDiscountFromPercent,
  type NeedImportReason,
} from '../utils/adminLogic';
import {
  exportNeedImportToExcel,
  parsePurchaseImportWorkbook,
} from '../utils/purchaseExcelLogic';
import { formatVnd, normalizeVietnameseText } from '../utils/shopLogic';
import { ProductImageUploader } from './ProductImageUploader';

interface PurchasesAdminPanelProps {
  purchaseOrders: PurchaseOrderRecord[];
  suppliers: SupplierRecord[];
  products: Product[];
  categories: CategoryNode[];
  cashVouchers?: CashVoucherRecord[];
  isLoading: boolean;
  notice?: string;
  onRefresh: () => Promise<void>;
  onRefreshProducts?: () => Promise<void>;
  onRefreshSuppliers: () => Promise<void>;
  onRefreshCashbook?: () => Promise<void>;
  onOpenCashVoucher?: (draft: QuickVoucherDraft) => void;
}

type PurchasesSubTab = 'receipts' | 'need-import' | 'suppliers';
type SupplierSelectMode = 'existing' | 'new';
type LineItemMode = 'existing' | 'new';
type DiscountDriver = 'percent' | 'amount';

const NO_SPINNER_CLASS =
  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

interface SupplierFormState {
  id?: string;
  name: string;
  shortName: string;
  taxCode: string;
  phone: string;
  address: string;
  area: string;
  paymentTerms: string;
  bankAccount: string;
  bankName: string;
  email: string;
  supplyCategory: string;
  notes: string;
}

const EMPTY_SUPPLIER_FORM: SupplierFormState = {
  name: '',
  shortName: '',
  taxCode: '',
  phone: '',
  address: '',
  area: '',
  paymentTerms: '',
  bankAccount: '',
  bankName: '',
  email: '',
  supplyCategory: '',
  notes: '',
};

const NEED_IMPORT_REASON_BADGE: Record<
  NeedImportReason,
  { label: string; cls: string }
> = {
  'below-min': {
    label: 'Dưới tồn tối thiểu',
    cls: 'bg-rose-50 text-rose-800 border-rose-200',
  },
  'out-of-stock': {
    label: 'Tồn kho <= 0',
    cls: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  'manual-threshold': {
    label: 'Theo mức tồn tự nhập',
    cls: 'bg-blue-50 text-blue-800 border-blue-200',
  },
};

export function PurchasesAdminPanel({
  purchaseOrders,
  suppliers,
  products,
  categories,
  cashVouchers = [],
  isLoading,
  notice,
  onRefresh,
  onRefreshProducts,
  onRefreshSuppliers,
  onRefreshCashbook,
  onOpenCashVoucher,
}: PurchasesAdminPanelProps) {
  const [subTab, setSubTab] = useState<PurchasesSubTab>('receipts');

  // Purchase order creation state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [poCode, setPoCode] = useState(() =>
    generatePurchaseCode(new Date(), null, []),
  );
  const [isPoCodeManual, setIsPoCodeManual] = useState(false);
  const [supplierMode, setSupplierMode] = useState<SupplierSelectMode>('existing');
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [newSupName, setNewSupName] = useState('');
  const [newSupShortName, setNewSupShortName] = useState('');
  const [newSupTaxCode, setNewSupTaxCode] = useState('');
  const [newSupPhone, setNewSupPhone] = useState('');
  const [newSupAddress, setNewSupAddress] = useState('');
  const [newSupArea, setNewSupArea] = useState('');
  const [newSupPaymentTerms, setNewSupPaymentTerms] = useState('');
  const [newSupBankAccount, setNewSupBankAccount] = useState('');
  const [newSupBankName, setNewSupBankName] = useState('');
  const [newSupEmail, setNewSupEmail] = useState('');
  const [newSupCategory, setNewSupCategory] = useState('');
  const [newSupNotes, setNewSupNotes] = useState('');
  const [note, setNote] = useState('');
  const [updateCostPrice, setUpdateCostPrice] = useState(true);

  // Extra fees & immediate payment state
  const [draftExtraFees, setDraftExtraFees] = useState<ExtraFeeItem[]>([]);
  const [customFeeLabel, setCustomFeeLabel] = useState('');
  const [customFeeAmount, setCustomFeeAmount] = useState('');
  const [paidAmountInput, setPaidAmountInput] = useState('0');
  const [isPaidManual, setIsPaidManual] = useState(false);
  const [autoCreatePaymentVoucher, setAutoCreatePaymentVoucher] = useState(true);

  const [itemMode, setItemMode] = useState<LineItemMode>('existing');
  const [productFilterText, setProductFilterText] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedPackIdx, setSelectedPackIdx] = useState('0');
  const excelInputRef = useRef<HTMLInputElement>(null);

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

  // Need-to-import tab state
  const [includeOutOfStock, setIncludeOutOfStock] = useState(false);
  const [manualThresholdInput, setManualThresholdInput] = useState('');
  const [needImportSearch, setNeedImportSearch] = useState('');
  const [selectedNeedMap, setSelectedNeedMap] = useState<Record<string, boolean>>(
    {},
  );
  const [customNeedQtyMap, setCustomNeedQtyMap] = useState<Record<string, string>>(
    {},
  );
  const [stockBoundsDraftMap, setStockBoundsDraftMap] = useState<
    Record<string, { min?: string; max?: string }>
  >({});
  const [savingBoundsId, setSavingBoundsId] = useState<string | null>(null);

  // Suppliers management tab state
  const [supplierSearchQuery, setSupplierSearchQuery] = useState('');
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
  const [supplierForm, setSupplierForm] =
    useState<SupplierFormState>(EMPTY_SUPPLIER_FORM);
  const [supplierError, setSupplierError] = useState<string | null>(null);
  const [isSavingSupplier, setIsSavingSupplier] = useState(false);
  const [confirmDeleteSupplierId, setConfirmDeleteSupplierId] = useState<
    string | null
  >(null);

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === selectedSupplierId) ?? null,
    [suppliers, selectedSupplierId],
  );

  const existingPoCodes = useMemo(
    () => purchaseOrders.map((po) => po.poCode),
    [purchaseOrders],
  );

  const latestCostMap = useMemo(
    () => getLatestProductImportCostMap(purchaseOrders, products),
    [purchaseOrders, products],
  );

  const parsedManualThreshold = useMemo(() => {
    const trimmed = manualThresholdInput.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }, [manualThresholdInput]);

  const needImportCandidates = useMemo(
    () =>
      buildNeedImportCandidates({
        products,
        purchaseOrders,
        includeOutOfStock,
        manualStockThreshold: parsedManualThreshold,
      }),
    [products, purchaseOrders, includeOutOfStock, parsedManualThreshold],
  );

  const filteredNeedImportCandidates = useMemo(() => {
    const norm = normalizeVietnameseText(needImportSearch);
    if (!norm) return needImportCandidates;
    return needImportCandidates.filter((c) =>
      normalizeVietnameseText(
        `${c.product.sku} ${c.product.barcode ?? ''} ${c.product.name}`,
      ).includes(norm),
    );
  }, [needImportCandidates, needImportSearch]);

  const resolvedNeedRows = useMemo(
    () =>
      needImportCandidates.map((cand) => {
        const checked = selectedNeedMap[cand.product.id] ?? true;
        const rawQty = customNeedQtyMap[cand.product.id];
        const parsedQty =
          rawQty !== undefined && rawQty.trim() !== ''
            ? Math.max(0, Number(rawQty) || 0)
            : cand.suggestedQty;
        const lineTotal = Math.round(parsedQty * cand.lastImportPrice);
        return {
          ...cand,
          checked,
          qtyInput: rawQty ?? String(cand.suggestedQty),
          quantity: parsedQty,
          lineTotal,
        };
      }),
    [needImportCandidates, selectedNeedMap, customNeedQtyMap],
  );

  const checkedNeedRows = useMemo(
    () => resolvedNeedRows.filter((row) => row.checked && row.quantity > 0),
    [resolvedNeedRows],
  );

  const totalNeedImportValue = useMemo(
    () => checkedNeedRows.reduce((sum, row) => sum + row.lineTotal, 0),
    [checkedNeedRows],
  );

  const supplierDebtMap = useMemo(
    () => calculateSupplierDebtMap(purchaseOrders, suppliers),
    [purchaseOrders, suppliers],
  );

  const filteredSuppliers = useMemo(() => {
    const norm = normalizeVietnameseText(supplierSearchQuery);
    if (!norm) return suppliers;
    return suppliers.filter((s) =>
      normalizeVietnameseText(
        `${s.name} ${s.shortName ?? ''} ${s.taxCode ?? ''} ${s.phone} ${s.area ?? ''} ${s.paymentTerms ?? ''} ${s.email ?? ''} ${s.supplyCategory ?? ''} ${s.bankName ?? ''} ${s.bankAccount ?? ''} ${s.address} ${s.notes}`,
      ).includes(norm),
    );
  }, [suppliers, supplierSearchQuery]);

  const filteredProductOptions = useMemo(() => {
    const norm = normalizeVietnameseText(productFilterText);
    if (!norm) return products;
    return products.filter((p) =>
      normalizeVietnameseText(`${p.sku} ${p.barcode ?? ''} ${p.name}`).includes(norm),
    );
  }, [products, productFilterText]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) ?? null,
    [products, selectedProductId],
  );

  const effectivePackOptions = useMemo(
    () =>
      selectedProduct ? getEffectivePurchasePackOptions(selectedProduct) : [],
    [selectedProduct],
  );

  const draftSummary = useMemo(
    () => calculatePurchaseSummary(draftItems, draftExtraFees),
    [draftItems, draftExtraFees],
  );

  useEffect(() => {
    if (!isPaidManual) {
      setPaidAmountInput(String(draftSummary.totalAmount));
    }
  }, [draftSummary.totalAmount, isPaidManual]);

  const historyStats = useMemo(() => {
    const totalReceipts = purchaseOrders.length;
    const totalImportValue = purchaseOrders.reduce(
      (sum, po) => sum + po.totalAmount,
      0,
    );
    const totalPayable = purchaseOrders.reduce(
      (sum, po) => sum + getPurchaseOrderRemainingDebt(po),
      0,
    );
    const totalItemsImported = purchaseOrders.reduce(
      (sum, po) => sum + po.itemCount,
      0,
    );
    return { totalReceipts, totalImportValue, totalPayable, totalItemsImported };
  }, [purchaseOrders]);

  const previewLine = useMemo(() => {
    const unitCost = Number(draftUnitCost) || 0;
    const discountAmt = Number(draftDiscountAmount) || 0;
    const qty = Number(draftQty) || 0;
    return computePurchaseLineTotal(qty, unitCost, discountAmt);
  }, [draftQty, draftUnitCost, draftDiscountAmount]);

  const refreshAutoPoCode = (
    mode: SupplierSelectMode,
    supId: string,
    inlineShort: string,
    inlineName: string,
    force: boolean = false,
  ) => {
    if (!force && isPoCodeManual) return;
    let shortOrName: string | null = null;
    if (mode === 'existing') {
      const sup = suppliers.find((s) => s.id === supId);
      shortOrName = sup?.shortName?.trim() || sup?.name?.trim() || null;
    } else {
      shortOrName = inlineShort.trim() || inlineName.trim() || null;
    }
    setPoCode(generatePurchaseCode(new Date(), shortOrName, existingPoCodes));
  };

  const handleSelectProduct = (prodId: string) => {
    setSelectedProductId(prodId);
    const prod = products.find((p) => p.id === prodId);
    if (!prod) return;
    const packOpts = getEffectivePurchasePackOptions(prod);
    const firstPack = packOpts[0] ?? {
      label: prod.baseUnit ?? prod.unit ?? 'Cái',
      factor: 1,
    };
    setSelectedPackIdx('0');
    const baseCost = latestCostMap.get(prod.id) ?? prod.costPrice ?? 0;
    const nextUnitCost =
      baseCost > 0 ? Math.round(baseCost * firstPack.factor) : 0;
    setDraftUnitCost(String(nextUnitCost));
    setDraftDiscountPercent('0');
    setDraftDiscountAmount('0');
    setDiscountDriver('percent');
    setDraftSellingPrice(String(prod.price ?? 0));
  };

  const handleSelectPackIndex = (rawIdx: string) => {
    setSelectedPackIdx(rawIdx);
    if (!selectedProduct) return;
    const idx = Math.max(0, Number(rawIdx) || 0);
    const chosen = effectivePackOptions[idx] ?? effectivePackOptions[0];
    const conv = chosen ? Math.max(0.01, chosen.factor) : 1;
    const baseCost =
      latestCostMap.get(selectedProduct.id) ?? selectedProduct.costPrice ?? 0;
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

      const idx = Math.max(0, Number(selectedPackIdx) || 0);
      const chosenPack = effectivePackOptions[idx] ??
        effectivePackOptions[0] ?? {
          label: selectedProduct.baseUnit ?? selectedProduct.unit,
          factor: 1,
        };
      const conversionFactor = Math.max(0.01, chosenPack.factor);
      const unitLabel = chosenPack.label;

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

    const cleanSku = newSku.trim().toUpperCase();
    const cleanName = newName.trim();
    if (!cleanSku || !cleanName) {
      setFormError('Vui lòng nhập Mã hàng (SKU) và Tên hàng hóa mới.');
      return;
    }

    const baseUnit = newBaseUnit.trim() || 'Cái';
    const packUnit = newUnit.trim() || baseUnit;
    const convRate = Math.max(0.01, Number(newConversionRate) || 1);
    const unitLabel = baseUnit;
    const conversionFactor = 1;

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

  const handleImportExcelFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const buffer = await file.arrayBuffer();
    const parsed = parsePurchaseImportWorkbook(
      buffer,
      file.name,
      products,
      latestCostMap,
    );
    if (parsed.errorMessage || parsed.items.length === 0) {
      setFormError(
        parsed.errorMessage ?? 'Không đọc được mặt hàng nào từ file.',
      );
      return;
    }

    setFormError(null);
    setDraftItems((prev) => [...prev, ...parsed.items]);
    setFeedback(
      `Đã nhập ${parsed.items.length} dòng từ "${file.name}" (${parsed.matchedCount} khớp kho, ${parsed.newProductCount} hàng mới).`,
    );
  };

  const handleAddPurchasePresetFee = (label: string) => {
    setDraftExtraFees((prev) => {
      const current = normalizeExtraFees(prev);
      if (current.some((f) => f.label.toLowerCase() === label.toLowerCase())) {
        return current;
      }
      return [...current, { label, amount: 0 }];
    });
  };

  const handleAddPurchaseCustomFee = () => {
    const cleanLabel = customFeeLabel.trim() || 'Phụ phí khác';
    const cleanAmount = Math.max(
      0,
      Math.round(Number(customFeeAmount.replace(/[^\d]/g, '')) || 0),
    );
    if (!customFeeLabel.trim() && cleanAmount <= 0) return;
    setDraftExtraFees((prev) => [
      ...normalizeExtraFees(prev),
      { label: cleanLabel, amount: cleanAmount },
    ]);
    setCustomFeeLabel('');
    setCustomFeeAmount('');
  };

  const handleUpdatePurchaseFeeAmount = (idx: number, rawVal: string) => {
    const cleanAmount = Math.max(
      0,
      Math.round(Number(rawVal.replace(/[^\d]/g, '')) || 0),
    );
    setDraftExtraFees((prev) =>
      normalizeExtraFees(prev).map((fee, i) =>
        i === idx ? { ...fee, amount: cleanAmount } : fee,
      ),
    );
  };

  const handleRemovePurchaseFee = (idx: number) => {
    setDraftExtraFees((prev) =>
      normalizeExtraFees(prev).filter((_, i) => i !== idx),
    );
  };

  const openNewPurchaseOrder = (prefilledItems: PurchaseOrderItem[] = []) => {
    setSubTab('receipts');
    const initialMode: SupplierSelectMode =
      suppliers.length > 0 ? 'existing' : 'new';
    setIsPoCodeManual(false);
    setPoCode(generatePurchaseCode(new Date(), null, existingPoCodes));
    setSupplierMode(initialMode);
    setSelectedSupplierId('');
    setNewSupName('');
    setNewSupShortName('');
    setNewSupTaxCode('');
    setNewSupPhone('');
    setNewSupAddress('');
    setNewSupArea('');
    setNewSupPaymentTerms('');
    setNewSupBankAccount('');
    setNewSupBankName('');
    setNewSupEmail('');
    setNewSupCategory('');
    setNewSupNotes('');
    setNote('');
    setUpdateCostPrice(true);
    setDraftItems(prefilledItems);
    setDraftExtraFees([]);
    setCustomFeeLabel('');
    setCustomFeeAmount('');
    setIsPaidManual(false);
    setAutoCreatePaymentVoucher(true);
    setFormError(null);
    setItemMode('existing');
    setProductFilterText('');
    setDraftDiscountPercent('0');
    setDraftDiscountAmount('0');
    setDiscountDriver('percent');
    setNewImageUrlsText('');
    if (products[0]) {
      const firstPack = getEffectivePurchasePackOptions(products[0])[0];
      const baseCost =
        latestCostMap.get(products[0].id) ?? products[0].costPrice ?? 0;
      const factor = firstPack ? firstPack.factor : 1;
      setSelectedProductId(products[0].id);
      setSelectedPackIdx('0');
      setDraftUnitCost(
        String(baseCost > 0 ? Math.round(baseCost * factor) : 0),
      );
      setDraftSellingPrice(String(products[0].price ?? 0));
    } else {
      setItemMode('new');
      setSelectedPackIdx('0');
      setDraftUnitCost('0');
      setDraftSellingPrice('0');
    }
    setIsCreateOpen(true);
  };

  const handleCreatePurchaseFromSelectedNeeds = () => {
    if (checkedNeedRows.length === 0) return;
    const prefilled: PurchaseOrderItem[] = checkedNeedRows.map((row) => {
      const baseLabel =
        row.product.baseUnit?.trim() || row.product.unit?.trim() || 'Cái';
      const unitCost = Math.max(0, Math.round(row.lastImportPrice));
      const { netUnitCost, lineTotal } = computePurchaseLineTotal(
        row.quantity,
        unitCost,
        0,
      );
      return {
        productId: row.product.id,
        sku: row.product.sku,
        productName: row.product.name,
        unitLabel: baseLabel,
        conversionFactor: 1,
        quantity: row.quantity,
        unitCost,
        discountPercent: 0,
        discountAmount: 0,
        netUnitCost,
        sellingPrice: row.product.price,
        lineTotal,
        isNewProduct: false,
      };
    });
    openNewPurchaseOrder(prefilled);
  };

  const handleCommitProductStockBounds = async (
    product: Product,
    overrideMinStr?: string,
    overrideMaxStr?: string,
  ) => {
    const draft = stockBoundsDraftMap[product.id];
    const minStr =
      overrideMinStr !== undefined
        ? overrideMinStr
        : draft?.min !== undefined
          ? draft.min
          : formatStockBoundInput(product.minStock);
    const maxStr =
      overrideMaxStr !== undefined
        ? overrideMaxStr
        : draft?.max !== undefined
          ? draft.max
          : formatStockBoundInput(product.maxStock);

    const nextMin = parseNullableStockBound(minStr);
    const nextMax = parseNullableStockBound(maxStr);
    const currentMin =
      product.minStock !== null && product.minStock !== undefined
        ? Number(product.minStock)
        : null;
    const currentMax =
      product.maxStock !== null && product.maxStock !== undefined
        ? Number(product.maxStock)
        : null;

    if (nextMin === currentMin && nextMax === currentMax) {
      if (draft) {
        setStockBoundsDraftMap((prev) => {
          const copy = { ...prev };
          delete copy[product.id];
          return copy;
        });
      }
      return;
    }

    setSavingBoundsId(product.id);
    try {
      const res = await updateProductStockBounds(product.id, nextMin, nextMax);
      if (res.errorMessage) {
        setFeedback(`Lỗi lưu tồn nhỏ nhất / lớn nhất (${product.sku}): ${res.errorMessage}`);
        return;
      }
      setStockBoundsDraftMap((prev) => {
        const copy = { ...prev };
        delete copy[product.id];
        return copy;
      });
      setFeedback(`Đã lưu tồn nhỏ nhất / lớn nhất cho ${product.name}.`);
      await (onRefreshProducts ?? onRefresh)();
    } finally {
      setSavingBoundsId((prev) => (prev === product.id ? null : prev));
    }
  };

  const handleCreatePurchaseOrder = async (e: FormEvent) => {
    e.preventDefault();
    if (!poCode.trim()) {
      setFormError('Vui lòng nhập Mã phiếu nhập.');
      return;
    }
    if (supplierMode === 'new' && !newSupName.trim()) {
      setFormError('Vui lòng nhập Tên nhà cung cấp mới (hoặc chuyển sang chọn NCC cũ).');
      return;
    }
    if (draftItems.length === 0) {
      setFormError('Vui lòng thêm ít nhất 1 sản phẩm vào đơn nhập hàng.');
      return;
    }

    const totalBill = draftSummary.totalAmount;
    const resolvedPaidAmount = Math.min(
      totalBill,
      Math.max(0, Math.round(Number(paidAmountInput) || 0)),
    );

    setFormError(null);
    setIsSubmitting(true);
    try {
      let resolvedSupplierId: string | null = null;
      let resolvedSupplierName = '';

      if (supplierMode === 'new') {
        const supRes = await upsertAdminSupplier({
          name: newSupName.trim(),
          shortName: newSupShortName.trim() || null,
          taxCode: newSupTaxCode.trim() || null,
          phone: newSupPhone.trim(),
          address: newSupAddress.trim(),
          area: newSupArea.trim() || null,
          paymentTerms: newSupPaymentTerms.trim() || null,
          bankAccount: newSupBankAccount.trim() || null,
          bankName: newSupBankName.trim() || null,
          email: newSupEmail.trim() || null,
          supplyCategory: newSupCategory.trim() || null,
          notes: newSupNotes.trim(),
        });
        if (supRes.errorMessage || !supRes.supplier) {
          setFormError(
            supRes.errorMessage ?? 'Không thể lưu nhà cung cấp mới.',
          );
          return;
        }
        resolvedSupplierId = supRes.supplier.id;
        resolvedSupplierName = supRes.supplier.name;
      } else if (selectedSupplier) {
        resolvedSupplierId = selectedSupplier.id;
        resolvedSupplierName = selectedSupplier.name;
      }

      const normalizedFees = normalizeExtraFees(draftExtraFees);
      const res = await createPurchaseOrderInSupabase({
        poCode,
        supplierId: resolvedSupplierId,
        supplierName: resolvedSupplierName,
        note,
        updateCostPrice,
        items: draftItems,
        extraFees: normalizedFees,
        paidAmount: resolvedPaidAmount,
      });

      if (!res.ok) {
        setFormError(res.errorMessage ?? 'Không thể tạo đơn nhập hàng.');
        return;
      }

      let voucherFeedbackSuffix = '';
      if (autoCreatePaymentVoucher && resolvedPaidAmount > 0) {
        const autoVoucherCode = generateVoucherCode(
          'payment',
          new Date(),
          cashVouchers.map((v) => v.voucherCode),
        );
        const voucherRes = await createCashVoucherInSupabase({
          voucherCode: autoVoucherCode,
          voucherType: 'payment',
          category: 'purchase_expense',
          amount: resolvedPaidAmount,
          paymentMethod: 'cash',
          supplierId: resolvedSupplierId,
          purchaseOrderId: res.poId ?? null,
          relatedCode: poCode.trim(),
          counterpartyName: resolvedSupplierName || 'Nhà cung cấp',
          note: `Thanh toán khi nhập phiếu ${poCode.trim()}`,
        });
        if (!voucherRes.errorMessage && voucherRes.voucherCode) {
          voucherFeedbackSuffix = ` và lập phiếu chi ${voucherRes.voucherCode} (${formatVnd(resolvedPaidAmount)})`;
          await onRefreshCashbook?.();
        } else if (voucherRes.errorMessage) {
          voucherFeedbackSuffix = ` (lưu ý chưa tự lập được phiếu chi: ${voucherRes.errorMessage})`;
        }
      }

      setIsCreateOpen(false);
      setDraftItems([]);
      setDraftExtraFees([]);
      setFeedback(
        supplierMode === 'new'
          ? `Đã tạo nhà cung cấp "${resolvedSupplierName}", lưu đơn nhập hàng ${poCode.trim()}${voucherFeedbackSuffix}.`
          : `Đã lưu đơn nhập hàng ${poCode.trim()}, cập nhật tồn kho${voucherFeedbackSuffix}.`,
      );
      await onRefresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  // Supplier modal handlers
  const openCreateSupplier = () => {
    setSupplierForm(EMPTY_SUPPLIER_FORM);
    setSupplierError(null);
    setConfirmDeleteSupplierId(null);
    setIsSupplierModalOpen(true);
  };

  const openEditSupplier = (supplier: SupplierRecord) => {
    setSupplierForm({
      id: supplier.id,
      name: supplier.name,
      shortName: supplier.shortName ?? '',
      taxCode: supplier.taxCode ?? '',
      phone: supplier.phone,
      address: supplier.address,
      area: supplier.area ?? '',
      paymentTerms: supplier.paymentTerms ?? '',
      bankAccount: supplier.bankAccount ?? '',
      bankName: supplier.bankName ?? '',
      email: supplier.email ?? '',
      supplyCategory: supplier.supplyCategory ?? '',
      notes: supplier.notes,
    });
    setSupplierError(null);
    setConfirmDeleteSupplierId(null);
    setIsSupplierModalOpen(true);
  };

  const handleSaveSupplier = async (e: FormEvent) => {
    e.preventDefault();
    if (!supplierForm.name.trim()) {
      setSupplierError('Vui lòng nhập Tên nhà cung cấp.');
      return;
    }
    setSupplierError(null);
    setIsSavingSupplier(true);
    try {
      const res = await upsertAdminSupplier({
        id: supplierForm.id,
        name: supplierForm.name,
        shortName: supplierForm.shortName.trim() || null,
        taxCode: supplierForm.taxCode.trim() || null,
        phone: supplierForm.phone,
        address: supplierForm.address,
        area: supplierForm.area.trim() || null,
        paymentTerms: supplierForm.paymentTerms.trim() || null,
        bankAccount: supplierForm.bankAccount.trim() || null,
        bankName: supplierForm.bankName.trim() || null,
        email: supplierForm.email.trim() || null,
        supplyCategory: supplierForm.supplyCategory.trim() || null,
        notes: supplierForm.notes,
      });
      if (res.errorMessage) {
        setSupplierError(res.errorMessage);
        return;
      }
      setIsSupplierModalOpen(false);
      setFeedback(
        supplierForm.id
          ? `Đã cập nhật nhà cung cấp "${supplierForm.name.trim()}".`
          : `Đã thêm nhà cung cấp "${supplierForm.name.trim()}".`,
      );
      await onRefreshSuppliers();
    } finally {
      setIsSavingSupplier(false);
    }
  };

  const handleDeleteSupplier = async (supplier: SupplierRecord) => {
    const res = await deleteAdminSupplier(supplier.id);
    setConfirmDeleteSupplierId(null);
    if (!res.ok) {
      setSupplierError(res.errorMessage ?? 'Không thể xóa nhà cung cấp.');
      return;
    }
    setIsSupplierModalOpen(false);
    setFeedback(`Đã xóa nhà cung cấp "${supplier.name}".`);
    await onRefreshSuppliers();
  };

  const editingSupplierDebt = supplierForm.id
    ? supplierDebtMap.get(supplierForm.id) ?? null
    : null;

  const editingSupplierOrders = useMemo(() => {
    if (!supplierForm.id) return [];
    return purchaseOrders
      .filter((po) => po.supplierId === supplierForm.id)
      .slice(0, 5);
  }, [purchaseOrders, supplierForm.id]);

  return (
    <div id="purchases-management" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Nhập hàng &amp; Nhà cung cấp
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Lập phiếu nhập kho, nhập file Excel/CSV, chọn hàng cần nhập và quản lý danh bạ nhà cung cấp.
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

          {subTab === 'receipts' ? (
            <button
              type="button"
              onClick={() => openNewPurchaseOrder()}
              className="inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <PackagePlus className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Tạo đơn nhập hàng</span>
            </button>
          ) : subTab === 'need-import' ? (
            <button
              type="button"
              disabled={checkedNeedRows.length === 0}
              onClick={() => exportNeedImportToExcel(
                checkedNeedRows.map((row) => ({
                  sku: row.product.sku,
                  barcode: row.product.barcode,
                  name: row.product.name,
                  quantity: row.quantity,
                  lastImportPrice: row.lastImportPrice,
                })),
              )}
              className="inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Xuất Excel ({checkedNeedRows.length})</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={openCreateSupplier}
              className="inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Thêm nhà cung cấp</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Tổng số đơn nhập</p>
          <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {historyStats.totalReceipts}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Tổng giá trị nhập kho</p>
          <p className="mt-1 font-display text-xl sm:text-2xl font-bold text-blue-700 tabular-nums">
            {formatVnd(historyStats.totalImportValue)}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Còn nợ nhà cung cấp</p>
          <p
            className={`mt-1 font-display text-xl sm:text-2xl font-bold tabular-nums ${
              historyStats.totalPayable > 0 ? 'text-amber-700' : 'text-emerald-700'
            }`}
          >
            {formatVnd(historyStats.totalPayable)}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Nhà cung cấp</p>
          <p className="mt-1 font-display text-2xl font-bold text-emerald-700 tabular-nums">
            {suppliers.length}
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

      {/* Sub-tabs: Phiếu nhập hàng | Chọn hàng cần nhập | Nhà cung cấp */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setSubTab('receipts')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
            subTab === 'receipts'
              ? 'border-blue-700 text-blue-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <PackagePlus className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Phiếu nhập hàng ({purchaseOrders.length})</span>
        </button>

        <button
          type="button"
          data-testid="purchases-need-import-tab"
          onClick={() => setSubTab('need-import')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
            subTab === 'need-import'
              ? 'border-blue-700 text-blue-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <ClipboardList className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Chọn hàng cần nhập ({needImportCandidates.length})</span>
        </button>

        <button
          type="button"
          data-testid="purchases-suppliers-tab"
          onClick={() => setSubTab('suppliers')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
            subTab === 'suppliers'
              ? 'border-blue-700 text-blue-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Building2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Nhà cung cấp ({suppliers.length})</span>
        </button>
      </div>

      {subTab === 'receipts' ? (
        <>
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Mã đơn nhập *
                    </label>
                    <input
                      type="text"
                      required
                      value={poCode}
                      onChange={(e) => {
                        setPoCode(e.target.value);
                        setIsPoCodeManual(true);
                      }}
                      placeholder="NH-1128-SHORTNAME"
                      className="w-full min-h-[40px] px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
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

                {/* Supplier picker or inline creation */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Thông tin Nhà cung cấp
                    </p>

                    <div className="inline-flex p-1 bg-slate-200/80 rounded-lg">
                      <button
                        type="button"
                        onClick={() => {
                          setSupplierMode('existing');
                          refreshAutoPoCode(
                            'existing',
                            selectedSupplierId,
                            newSupShortName,
                            newSupName,
                          );
                        }}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                          supplierMode === 'existing'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Chọn NCC có sẵn ({suppliers.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSupplierMode('new');
                          refreshAutoPoCode(
                            'new',
                            selectedSupplierId,
                            newSupShortName,
                            newSupName,
                          );
                        }}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                          supplierMode === 'new'
                            ? 'bg-blue-700 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        + Nhập NCC mới
                      </button>
                    </div>
                  </div>

                  {supplierMode === 'existing' ? (
                    <div className="space-y-2">
                      <select
                        aria-label="Chọn nhà cung cấp có sẵn"
                        value={selectedSupplierId}
                        onChange={(e) => {
                          const nextId = e.target.value;
                          setSelectedSupplierId(nextId);
                          refreshAutoPoCode(
                            'existing',
                            nextId,
                            newSupShortName,
                            newSupName,
                          );
                        }}
                        className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900"
                      >
                        <option value="">
                          -- Chọn nhà cung cấp (hoặc để trống) --
                        </option>
                        {suppliers.map((sup) => (
                          <option key={sup.id} value={sup.id}>
                            {sup.shortName ? `[${sup.shortName}] ` : ''}
                            {sup.name}
                            {sup.phone ? ` · ${sup.phone}` : ''}
                            {sup.address ? ` (${sup.address})` : ''}
                          </option>
                        ))}
                      </select>

                      {selectedSupplier && (
                        <div className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                          {selectedSupplier.shortName && (
                            <span>
                              Viết tắt:{' '}
                              <strong className="font-mono text-blue-700">
                                {selectedSupplier.shortName}
                              </strong>
                            </span>
                          )}
                          <span>
                            SĐT:{' '}
                            <strong className="font-mono text-slate-800">
                              {selectedSupplier.phone || 'Chưa có'}
                            </strong>
                          </span>
                          {selectedSupplier.taxCode && (
                            <span>
                              MST:{' '}
                              <strong className="font-mono text-slate-800">
                                {selectedSupplier.taxCode}
                              </strong>
                            </span>
                          )}
                          <span>
                            Địa chỉ:{' '}
                            <strong className="text-slate-800">
                              {selectedSupplier.address || 'Chưa có'}
                            </strong>
                          </span>
                          {selectedSupplier.bankAccount && (
                            <span>
                              STK:{' '}
                              <strong className="font-mono text-slate-800">
                                {selectedSupplier.bankAccount}
                              </strong>
                              {selectedSupplier.bankName
                                ? ` (${selectedSupplier.bankName})`
                                : ''}
                            </span>
                          )}
                          {selectedSupplier.supplyCategory && (
                            <span>Loại hàng: {selectedSupplier.supplyCategory}</span>
                          )}
                          {selectedSupplier.notes && (
                            <span>Ghi chú: {selectedSupplier.notes}</span>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Tên nhà cung cấp *
                        </label>
                        <input
                          type="text"
                          value={newSupName}
                          onChange={(e) => {
                            const val = e.target.value;
                            setNewSupName(val);
                            refreshAutoPoCode(
                              'new',
                              selectedSupplierId,
                              newSupShortName,
                              val,
                            );
                          }}
                          placeholder="VD: Tổng kho Hồng Hà"
                          className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Tên viết tắt (tạo mã NH)
                        </label>
                        <input
                          type="text"
                          value={newSupShortName}
                          onChange={(e) => {
                            const val = e.target.value;
                            setNewSupShortName(val);
                            refreshAutoPoCode(
                              'new',
                              selectedSupplierId,
                              val,
                              newSupName,
                            );
                          }}
                          placeholder="VD: HH"
                          className="w-full min-h-[40px] px-3 py-2 text-sm font-mono uppercase bg-white border border-slate-300 rounded-lg"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Số điện thoại
                        </label>
                        <input
                          type="tel"
                          value={newSupPhone}
                          onChange={(e) => setNewSupPhone(e.target.value)}
                          placeholder="0912345678"
                          className="w-full min-h-[40px] px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Mã số thuế
                        </label>
                        <input
                          type="text"
                          value={newSupTaxCode}
                          onChange={(e) => setNewSupTaxCode(e.target.value)}
                          placeholder="0101234567"
                          className="w-full min-h-[40px] px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Email
                        </label>
                        <input
                          type="email"
                          value={newSupEmail}
                          onChange={(e) => setNewSupEmail(e.target.value)}
                          placeholder="kinhdoanh@ncc.vn"
                          className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Số tài khoản
                        </label>
                        <input
                          type="text"
                          value={newSupBankAccount}
                          onChange={(e) => setNewSupBankAccount(e.target.value)}
                          placeholder="1903..."
                          className="w-full min-h-[40px] px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Ngân hàng &amp; chi nhánh
                        </label>
                        <input
                          type="text"
                          value={newSupBankName}
                          onChange={(e) => setNewSupBankName(e.target.value)}
                          placeholder="Techcombank - CN Hà Nội"
                          className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Loại hàng cung cấp
                        </label>
                        <input
                          type="text"
                          value={newSupCategory}
                          onChange={(e) => setNewSupCategory(e.target.value)}
                          placeholder="Giấy in, Bút, Vở..."
                          className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Địa chỉ
                        </label>
                        <input
                          type="text"
                          value={newSupAddress}
                          onChange={(e) => setNewSupAddress(e.target.value)}
                          placeholder="Số nhà, đường, quận..."
                          className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Khu vực
                        </label>
                        <input
                          type="text"
                          value={newSupArea}
                          onChange={(e) => setNewSupArea(e.target.value)}
                          placeholder="VD: Hà Nội, Miền Bắc..."
                          className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Điều khoản thanh toán
                        </label>
                        <input
                          type="text"
                          value={newSupPaymentTerms}
                          onChange={(e) => setNewSupPaymentTerms(e.target.value)}
                          placeholder="VD: Công nợ 15 ngày..."
                          className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                        />
                      </div>

                      <div className="sm:col-span-2 lg:col-span-4">
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Ghi chú NCC
                        </label>
                        <input
                          type="text"
                          value={newSupNotes}
                          onChange={(e) => setNewSupNotes(e.target.value)}
                          placeholder="Chiết khấu, lịch giao hàng..."
                          className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Thêm mặt hàng vào phiếu
                    </p>

                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={excelInputRef}
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={(e) => void handleImportExcelFile(e)}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => excelInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors cursor-pointer"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>Nhập từ Excel / CSV</span>
                      </button>

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
                            setSelectedPackIdx('0');
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
                          placeholder="Lọc nhanh theo tên, SKU hoặc mã vạch..."
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
                          aria-label="Đơn vị nhập hàng"
                          value={selectedPackIdx}
                          onChange={(e) => handleSelectPackIndex(e.target.value)}
                          disabled={!selectedProduct}
                          className="w-full min-h-[40px] px-2.5 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                        >
                          {effectivePackOptions.length === 0 ? (
                            <option value="0">Cơ bản (x1)</option>
                          ) : (
                            effectivePackOptions.map((opt, idx) => (
                              <option
                                key={`${opt.label}-${opt.factor}`}
                                value={String(idx)}
                              >
                                {opt.label} (x{opt.factor})
                              </option>
                            ))
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
                          className={`w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg font-semibold text-blue-700 ${NO_SPINNER_CLASS}`}
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

                      <div>
                        <label
                          htmlFor="new-product-barcode"
                          className="block text-xs font-medium text-slate-700 mb-1"
                        >
                          Mã vạch (Barcode)
                        </label>
                        <input
                          id="new-product-barcode"
                          type="text"
                          value={newBarcode}
                          onChange={(e) => setNewBarcode(e.target.value)}
                          placeholder="Quét hoặc nhập mã vạch (893...)"
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
                          className={`w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg font-semibold text-blue-700 ${NO_SPINNER_CLASS}`}
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
                        className={`w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg ${NO_SPINNER_CLASS}`}
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
                        className={`w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg ${NO_SPINNER_CLASS}`}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Giảm giá (đ) (trên ĐV)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="100"
                        value={draftDiscountAmount}
                        onChange={(e) =>
                          handleDraftDiscountAmountChange(e.target.value)
                        }
                        className={`w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg ${NO_SPINNER_CLASS}`}
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
                            <th className="py-2.5 px-3 text-right">Giảm giá (đ)</th>
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
                                  className={`w-24 px-2 py-1 text-right text-xs border border-slate-300 rounded ${NO_SPINNER_CLASS}`}
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
                                  className={`w-16 px-2 py-1 text-right text-xs border border-slate-300 rounded ${NO_SPINNER_CLASS}`}
                                />
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <input
                                  type="number"
                                  min="0"
                                  step="100"
                                  aria-label={`Giảm giá (đ) ${item.productName}`}
                                  value={item.discountAmount}
                                  onChange={(e) =>
                                    handleUpdateDraftRow(idx, {
                                      discountAmount: Number(e.target.value),
                                    })
                                  }
                                  className={`w-24 px-2 py-1 text-right text-xs border border-slate-300 rounded ${NO_SPINNER_CLASS}`}
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
                                  className={`w-24 px-2 py-1 text-right text-xs font-semibold text-blue-700 border border-slate-300 rounded ${NO_SPINNER_CLASS}`}
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
                          Tiền hàng sau giảm:{' '}
                          <strong>{formatVnd(draftSummary.itemsTotal)}</strong>
                        </span>
                        {draftSummary.totalDiscountAmount > 0 && (
                          <span className="text-emerald-700">
                            Tổng giảm:{' '}
                            <strong>
                              -{formatVnd(draftSummary.totalDiscountAmount)}
                            </strong>
                          </span>
                        )}
                        {draftSummary.extraFeeTotal > 0 && (
                          <span className="text-blue-700">
                            Phụ phí nhập:{' '}
                            <strong>+{formatVnd(draftSummary.extraFeeTotal)}</strong>
                          </span>
                        )}
                      </div>
                      <span className="font-display text-lg font-bold text-blue-700 tabular-nums">
                        Tổng phiếu: {formatVnd(draftSummary.totalAmount)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Extra fees & Payment for Purchase Order */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Phụ phí đơn nhập (vận chuyển, bốc xếp, gửi xe...)
                      </p>
                      {draftSummary.extraFeeTotal > 0 && (
                        <span className="text-xs font-bold text-blue-700 tabular-nums">
                          +{formatVnd(draftSummary.extraFeeTotal)}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {EXTRA_FEE_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => handleAddPurchasePresetFee(preset)}
                          className="px-2 py-1 text-[11px] font-semibold text-slate-700 bg-white hover:bg-blue-50 hover:text-blue-700 border border-slate-300 rounded-md cursor-pointer"
                        >
                          + {preset}
                        </button>
                      ))}
                    </div>

                    {normalizeExtraFees(draftExtraFees).length > 0 && (
                      <div className="space-y-1.5">
                        {normalizeExtraFees(draftExtraFees).map((fee, idx) => (
                          <div
                            key={`${fee.label}-${idx}`}
                            className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5"
                          >
                            <span className="text-xs font-medium text-slate-800 flex-1 truncate">
                              {fee.label}
                            </span>
                            <input
                              type="number"
                              min="0"
                              step="1000"
                              aria-label={`Phụ phí nhập ${fee.label}`}
                              value={fee.amount || ''}
                              placeholder="0"
                              onChange={(e) =>
                                handleUpdatePurchaseFeeAmount(idx, e.target.value)
                              }
                              className={`w-24 px-2 py-1 text-right text-xs font-mono border border-slate-300 rounded ${NO_SPINNER_CLASS}`}
                            />
                            <span className="text-[11px] text-slate-400">đ</span>
                            <button
                              type="button"
                              onClick={() => handleRemovePurchaseFee(idx)}
                              aria-label={`Xóa phụ phí ${fee.label}`}
                              className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-12 gap-1.5 items-center">
                      <input
                        type="text"
                        value={customFeeLabel}
                        onChange={(e) => setCustomFeeLabel(e.target.value)}
                        placeholder="Tên phụ phí khác..."
                        aria-label="Tên phụ phí đơn nhập khác"
                        className="col-span-6 min-h-[34px] px-2.5 py-1 text-xs bg-white border border-slate-300 rounded-lg"
                      />
                      <input
                        type="number"
                        min="0"
                        step="1000"
                        value={customFeeAmount}
                        onChange={(e) => setCustomFeeAmount(e.target.value)}
                        placeholder="Số tiền"
                        aria-label="Số tiền phụ phí đơn nhập khác"
                        className={`col-span-4 min-h-[34px] px-2 py-1 text-right text-xs font-mono bg-white border border-slate-300 rounded-lg ${NO_SPINNER_CLASS}`}
                      />
                      <button
                        type="button"
                        onClick={handleAddPurchaseCustomFee}
                        aria-label="Thêm phụ phí đơn nhập"
                        className="col-span-2 min-h-[34px] inline-flex items-center justify-center text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Thanh toán NCC &amp; Công nợ
                      </p>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setIsPaidManual(false);
                            setPaidAmountInput(String(draftSummary.totalAmount));
                          }}
                          className="px-2 py-0.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded cursor-pointer"
                        >
                          Trả đủ
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsPaidManual(true);
                            setPaidAmountInput('0');
                          }}
                          className="px-2 py-0.5 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded cursor-pointer"
                        >
                          Ghi nợ 100%
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                      <div>
                        <label
                          htmlFor="po-paid-amount"
                          className="block text-xs font-medium text-slate-700 mb-1"
                        >
                          Thanh toán ngay cho NCC (đ)
                        </label>
                        <input
                          id="po-paid-amount"
                          type="number"
                          min="0"
                          max={draftSummary.totalAmount}
                          step="1000"
                          value={paidAmountInput}
                          onChange={(e) => {
                            setIsPaidManual(true);
                            setPaidAmountInput(e.target.value);
                          }}
                          className={`w-full min-h-[38px] px-3 py-1.5 text-sm font-mono font-semibold bg-white border border-slate-300 rounded-lg ${NO_SPINNER_CLASS}`}
                        />
                      </div>

                      <div className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs">
                        <span className="text-slate-500 block">Ghi nợ NCC còn lại</span>
                        <strong
                          className={`text-sm font-bold tabular-nums ${
                            Math.max(
                              0,
                              draftSummary.totalAmount -
                                Math.min(
                                  draftSummary.totalAmount,
                                  Math.max(0, Math.round(Number(paidAmountInput) || 0)),
                                ),
                            ) > 0
                              ? 'text-amber-700'
                              : 'text-emerald-700'
                          }`}
                        >
                          {formatVnd(
                            Math.max(
                              0,
                              draftSummary.totalAmount -
                                Math.min(
                                  draftSummary.totalAmount,
                                  Math.max(0, Math.round(Number(paidAmountInput) || 0)),
                                ),
                            ),
                          )}
                        </strong>
                      </div>
                    </div>

                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer pt-1">
                      <input
                        type="checkbox"
                        checked={autoCreatePaymentVoucher}
                        onChange={(e) =>
                          setAutoCreatePaymentVoucher(e.target.checked)
                        }
                        className="w-4 h-4 rounded border-slate-300 text-blue-700"
                      />
                      <span>
                        Tự động lập Phiếu chi (PC) cho số tiền đã thanh toán ngay
                      </span>
                    </label>
                  </div>
                </div>

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
                <table className="w-full min-w-[920px] text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Mã phiếu / Thời gian</th>
                      <th className="py-3 px-4">Nhà cung cấp</th>
                      <th className="py-3 px-4">Ghi chú</th>
                      <th className="py-3 px-4 text-center">Số mặt hàng</th>
                      <th className="py-3 px-4 text-right">Tổng tiền &amp; Phụ phí</th>
                      <th className="py-3 px-4 text-right">Thanh toán / Nợ NCC</th>
                      <th className="py-3 px-4 text-right">Chi tiết</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {purchaseOrders.map((po) => {
                      const rowKey = po.id ?? po.poCode;
                      const isExpanded = expandedPoId === rowKey;
                      const remainingDebt = getPurchaseOrderRemainingDebt(po);
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
                              <p>{po.supplierName || 'Chưa ghi tên NCC'}</p>
                              <p className="text-[11px] text-slate-400">
                                {po.createdByEmail || 'Admin'}
                              </p>
                            </td>
                            <td className="py-3.5 px-4 text-xs text-slate-600">
                              {po.note || '—'}
                            </td>
                            <td className="py-3.5 px-4 text-center tabular-nums">
                              {po.itemCount}
                            </td>
                            <td className="py-3.5 px-4 text-right tabular-nums whitespace-nowrap">
                              <p className="font-bold text-blue-700">
                                {formatVnd(po.totalAmount)}
                              </p>
                              {(po.extraFeeTotal ?? 0) > 0 && (
                                <p className="text-[11px] text-slate-500">
                                  (gồm +{formatVnd(po.extraFeeTotal ?? 0)} phụ phí)
                                </p>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-right tabular-nums whitespace-nowrap">
                              {remainingDebt > 0 ? (
                                <div className="space-y-1">
                                  <span className="inline-block px-2 py-0.5 text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded">
                                    Còn nợ {formatVnd(remainingDebt)}
                                  </span>
                                  {onOpenCashVoucher && (
                                    <div>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onOpenCashVoucher({
                                            voucherType: 'payment',
                                            category: 'supplier_debt',
                                            supplierId: po.supplierId ?? null,
                                            purchaseOrderId: po.id ?? null,
                                            relatedCode: po.poCode,
                                            counterpartyName:
                                              po.supplierName || 'Nhà cung cấp',
                                            amount: remainingDebt,
                                            note: `Chi trả nợ phiếu nhập ${po.poCode}`,
                                          })
                                        }
                                        className="text-[11px] font-semibold text-blue-700 hover:underline cursor-pointer"
                                      >
                                        + Chi trả nợ
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="inline-block px-2 py-0.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded">
                                  Đã trả đủ
                                </span>
                              )}
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
                              <td colSpan={7} className="px-6 py-4 space-y-3">
                                {normalizeExtraFees(po.extraFees).length > 0 && (
                                  <div className="px-3 py-2 bg-blue-50/70 border border-blue-200 rounded-lg text-xs text-blue-950 flex flex-wrap items-center gap-3">
                                    <span className="font-semibold">Phụ phí đơn nhập:</span>
                                    {normalizeExtraFees(po.extraFees).map((fee, fIdx) => (
                                      <span
                                        key={`${fee.label}-${fIdx}`}
                                        className="px-2 py-0.5 bg-white border border-blue-200 rounded"
                                      >
                                        {fee.label}: {formatVnd(fee.amount)}
                                      </span>
                                    ))}
                                  </div>
                                )}
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
        </>
      ) : subTab === 'need-import' ? (
        /* Chọn hàng cần nhập tab */
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Điều kiện tự động chọn hàng cần nhập (mặc định: Tồn kho - Khách đặt &lt; Tồn nhỏ nhất)
                </p>

                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      data-testid="need-import-out-of-stock-toggle"
                      checked={includeOutOfStock}
                      onChange={(e) => setIncludeOutOfStock(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-700"
                    />
                    <span>Bổ sung hàng tồn kho &lt;= 0</span>
                  </label>

                  <div className="inline-flex items-center gap-2">
                    <label
                      htmlFor="need-import-manual-threshold"
                      className="text-sm text-slate-800 whitespace-nowrap"
                    >
                      Hoặc nhập mức tồn kho &lt;=:
                    </label>
                    <input
                      id="need-import-manual-threshold"
                      type="number"
                      step="1"
                      value={manualThresholdInput}
                      onChange={(e) => setManualThresholdInput(e.target.value)}
                      placeholder="VD: 5"
                      className={`w-24 min-h-[36px] px-2.5 py-1 text-sm text-right font-mono bg-white border border-slate-300 rounded-lg focus:outline-2 focus:outline-blue-700 ${NO_SPINNER_CLASS}`}
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl">
                <div>
                  <p className="text-xs font-medium text-blue-900">
                    Tổng giá trị đơn hàng cần nhập ({checkedNeedRows.length} mặt hàng)
                  </p>
                  <p
                    data-testid="need-import-total-value"
                    className="font-display text-xl font-bold text-blue-700 tabular-nums"
                  >
                    {formatVnd(totalNeedImportValue)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={checkedNeedRows.length === 0}
                    onClick={() =>
                      exportNeedImportToExcel(
                        checkedNeedRows.map((row) => ({
                          sku: row.product.sku,
                          barcode: row.product.barcode,
                          name: row.product.name,
                          quantity: row.quantity,
                          lastImportPrice: row.lastImportPrice,
                        })),
                      )
                    }
                    className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Xuất Excel (.xlsx)</span>
                  </button>

                  <button
                    type="button"
                    disabled={checkedNeedRows.length === 0}
                    onClick={handleCreatePurchaseFromSelectedNeeds}
                    className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <PackagePlus className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Lập phiếu nhập</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
              <div className="relative w-full sm:w-80">
                <Search
                  className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={needImportSearch}
                  onChange={(e) => setNeedImportSearch(e.target.value)}
                  placeholder="Lọc trong danh sách cần nhập..."
                  className="w-full min-h-[38px] pl-9 pr-8 py-1.5 text-sm bg-white border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    const next: Record<string, boolean> = { ...selectedNeedMap };
                    for (const row of filteredNeedImportCandidates) {
                      next[row.product.id] = true;
                    }
                    setSelectedNeedMap(next);
                  }}
                  className="px-2.5 py-1 font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md cursor-pointer"
                >
                  Chọn tất cả
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next: Record<string, boolean> = { ...selectedNeedMap };
                    for (const row of filteredNeedImportCandidates) {
                      next[row.product.id] = false;
                    }
                    setSelectedNeedMap(next);
                  }}
                  className="px-2.5 py-1 font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-md cursor-pointer"
                >
                  Bỏ chọn tất cả
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            {filteredNeedImportCandidates.length === 0 ? (
              <div className="py-12 px-6 text-center">
                <p className="font-display text-base font-semibold text-slate-900">
                  Không có mặt hàng nào thỏa điều kiện cần nhập
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Hãy bật &quot;Bổ sung hàng tồn kho &lt;= 0&quot; hoặc nhập mức tồn kho cụ thể ở phía trên.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1120px] text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-3 text-center w-10">Chọn</th>
                      <th className="py-3 px-3 text-center w-12">STT</th>
                      <th className="py-3 px-3">Mã hàng / Mã vạch</th>
                      <th className="py-3 px-3">Tên hàng</th>
                      <th className="py-3 px-3 text-right">Tồn / Đặt</th>
                      <th className="py-3 px-3 text-right">Tồn nhỏ nhất</th>
                      <th className="py-3 px-3 text-right">Tồn lớn nhất</th>
                      <th className="py-3 px-3 text-right">Số lượng cần nhập</th>
                      <th className="py-3 px-3 text-right">Giá nhập lần trước</th>
                      <th className="py-3 px-3 text-right">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {filteredNeedImportCandidates.map((cand, idx) => {
                      const rowState = resolvedNeedRows.find(
                        (r) => r.product.id === cand.product.id,
                      );
                      const checked = rowState?.checked ?? true;
                      const qtyInput =
                        rowState?.qtyInput ?? String(cand.suggestedQty);
                      const lineTotal = rowState?.lineTotal ?? 0;
                      const badge = NEED_IMPORT_REASON_BADGE[cand.reason];
                      const baseUnit =
                        cand.product.baseUnit ?? cand.product.unit ?? 'Cái';
                      const boundDraft = stockBoundsDraftMap[cand.product.id];
                      const minInputVal =
                        boundDraft?.min !== undefined
                          ? boundDraft.min
                          : formatStockBoundInput(cand.product.minStock);
                      const maxInputVal =
                        boundDraft?.max !== undefined
                          ? boundDraft.max
                          : formatStockBoundInput(cand.product.maxStock);
                      const isSavingRowBounds = savingBoundsId === cand.product.id;
                      return (
                        <tr
                          key={cand.product.id}
                          className={`align-middle transition-colors ${
                            checked ? 'hover:bg-blue-50/40' : 'bg-slate-50/80 opacity-65'
                          }`}
                        >
                          <td className="py-3 px-3 text-center">
                            <input
                              type="checkbox"
                              aria-label={`Chọn nhập ${cand.product.name}`}
                              checked={checked}
                              onChange={(e) =>
                                setSelectedNeedMap((prev) => ({
                                  ...prev,
                                  [cand.product.id]: e.target.checked,
                                }))
                              }
                              className="w-4 h-4 rounded border-slate-300 text-blue-700 cursor-pointer"
                            />
                          </td>
                          <td className="py-3 px-3 text-center text-xs text-slate-500 tabular-nums">
                            {idx + 1}
                          </td>
                          <td className="py-3 px-3">
                            <p className="font-mono text-xs font-semibold text-slate-900">
                              {cand.product.sku}
                            </p>
                            {cand.product.barcode && (
                              <p className="font-mono text-[11px] text-slate-500">
                                {cand.product.barcode}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <p className="font-semibold text-slate-900">
                              {cand.product.name}
                            </p>
                            <span
                              className={`mt-1 inline-flex items-center px-2 py-0.5 text-[11px] font-medium border rounded-md ${badge.cls}`}
                            >
                              {cand.reason === 'manual-threshold' &&
                              parsedManualThreshold !== null
                                ? `Tồn <= ${parsedManualThreshold}`
                                : badge.label}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right text-xs tabular-nums text-slate-700 whitespace-nowrap">
                            <span>Tồn: {cand.product.stock}</span>
                            {' · '}
                            <span>Đặt: {cand.product.orderedQuantity ?? 0}</span>
                          </td>
                          <td className="py-3 px-3 text-right whitespace-nowrap">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              disabled={isSavingRowBounds}
                              aria-label={`Tồn nhỏ nhất ${cand.product.name}`}
                              placeholder="—"
                              value={minInputVal}
                              onChange={(e) => {
                                const val = e.target.value;
                                setStockBoundsDraftMap((prev) => ({
                                  ...prev,
                                  [cand.product.id]: {
                                    ...prev[cand.product.id],
                                    min: val,
                                  },
                                }));
                              }}
                              onBlur={(e) =>
                                void handleCommitProductStockBounds(
                                  cand.product,
                                  e.target.value,
                                  undefined,
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.currentTarget.blur();
                                }
                              }}
                              className={`w-20 min-h-[34px] px-2 py-1 text-right text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-2 focus:outline-blue-700 disabled:opacity-60 ${NO_SPINNER_CLASS}`}
                            />
                          </td>
                          <td className="py-3 px-3 text-right whitespace-nowrap">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              disabled={isSavingRowBounds}
                              aria-label={`Tồn lớn nhất ${cand.product.name}`}
                              placeholder="—"
                              value={maxInputVal}
                              onChange={(e) => {
                                const val = e.target.value;
                                setStockBoundsDraftMap((prev) => ({
                                  ...prev,
                                  [cand.product.id]: {
                                    ...prev[cand.product.id],
                                    max: val,
                                  },
                                }));
                              }}
                              onBlur={(e) =>
                                void handleCommitProductStockBounds(
                                  cand.product,
                                  undefined,
                                  e.target.value,
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.currentTarget.blur();
                                }
                              }}
                              className={`w-20 min-h-[34px] px-2 py-1 text-right text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-2 focus:outline-blue-700 disabled:opacity-60 ${NO_SPINNER_CLASS}`}
                            />
                          </td>
                          <td className="py-3 px-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <input
                                type="number"
                                min="0"
                                step="1"
                                aria-label={`Số lượng cần nhập ${cand.product.name}`}
                                value={qtyInput}
                                onChange={(e) =>
                                  setCustomNeedQtyMap((prev) => ({
                                    ...prev,
                                    [cand.product.id]: e.target.value,
                                  }))
                                }
                                className={`w-20 min-h-[34px] px-2 py-1 text-right text-sm font-semibold tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-2 focus:outline-blue-700 ${NO_SPINNER_CLASS}`}
                              />
                              <span className="text-xs text-slate-500">
                                {baseUnit}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-slate-700 whitespace-nowrap">
                            {formatVnd(cand.lastImportPrice)}
                          </td>
                          <td className="py-3 px-3 text-right font-bold tabular-nums text-blue-700 whitespace-nowrap">
                            {formatVnd(checked ? lineTotal : 0)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Nhà cung cấp management tab */
        <div className="space-y-4">
          <div className="relative w-full md:w-96">
            <label htmlFor="suppliers-search" className="sr-only">
              Tìm nhà cung cấp
            </label>
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              id="suppliers-search"
              type="search"
              value={supplierSearchQuery}
              onChange={(e) => setSupplierSearchQuery(e.target.value)}
              placeholder="Tìm tên NCC, viết tắt, MST, SĐT, ngân hàng..."
              className="w-full min-h-[42px] pl-10 pr-9 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-700"
            />
            {supplierSearchQuery && (
              <button
                type="button"
                onClick={() => setSupplierSearchQuery('')}
                aria-label="Xóa tìm kiếm nhà cung cấp"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 inline-flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            {filteredSuppliers.length === 0 ? (
              <div className="py-12 px-6 text-center">
                <p className="font-display text-base font-semibold text-slate-900">
                  {suppliers.length === 0
                    ? 'Chưa có nhà cung cấp nào'
                    : 'Không tìm thấy nhà cung cấp phù hợp'}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Nhấn &quot;Thêm nhà cung cấp&quot; để lưu thông tin nguồn hàng mới.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1040px] text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Nhà cung cấp / Viết tắt</th>
                      <th className="py-3 px-4">Liên hệ &amp; MST</th>
                      <th className="py-3 px-4">Tài khoản ngân hàng</th>
                      <th className="py-3 px-4">Khu vực &amp; Điều khoản</th>
                      <th className="py-3 px-4">Ghi chú</th>
                      <th className="py-3 px-4 text-right">Còn nợ NCC</th>
                      <th className="py-3 px-4 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {filteredSuppliers.map((sup) => {
                      const supDebt = supplierDebtMap.get(sup.id)?.debtAmount ?? 0;
                      return (
                        <tr
                          key={sup.id}
                          onClick={() => openEditSupplier(sup)}
                          className="hover:bg-blue-50/40 align-top cursor-pointer transition-colors"
                        >
                          <td className="py-3.5 px-4">
                            <p className="font-semibold text-slate-900">
                              {sup.name}
                            </p>
                            {sup.shortName && (
                              <span className="mt-1 inline-flex items-center px-2 py-0.5 text-[11px] font-mono font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded">
                                {sup.shortName}
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-xs space-y-1 whitespace-nowrap">
                            {sup.phone ? (
                              <p className="inline-flex items-center gap-1.5 font-mono text-slate-800">
                                <Phone className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                                {sup.phone}
                              </p>
                            ) : (
                              <p className="text-slate-400">—</p>
                            )}
                            {sup.email && (
                              <p className="text-slate-600">{sup.email}</p>
                            )}
                            {sup.taxCode && (
                              <p className="font-mono text-slate-500">
                                MST: {sup.taxCode}
                              </p>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-xs text-slate-700 max-w-[210px]">
                            {sup.bankAccount || sup.bankName ? (
                              <div className="space-y-0.5">
                                {sup.bankAccount && (
                                  <p className="font-mono font-semibold text-slate-900">
                                    {sup.bankAccount}
                                  </p>
                                )}
                                {sup.bankName && (
                                  <p className="text-slate-600">{sup.bankName}</p>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-xs text-slate-700 max-w-[240px] space-y-0.5">
                            {sup.supplyCategory && (
                              <p className="font-medium text-emerald-800">
                                {sup.supplyCategory}
                              </p>
                            )}
                            {sup.area && (
                              <p className="text-slate-700">Khu vực: {sup.area}</p>
                            )}
                            {sup.paymentTerms && (
                              <p className="text-blue-700 font-medium">
                                ĐKTT: {sup.paymentTerms}
                              </p>
                            )}
                            <p className="text-slate-500">{sup.address || '—'}</p>
                          </td>
                          <td className="py-3.5 px-4 text-xs text-slate-500 max-w-[180px]">
                            {sup.notes || '—'}
                          </td>
                          <td className="py-3.5 px-4 text-right tabular-nums whitespace-nowrap">
                            {supDebt > 0 ? (
                              <span className="font-bold text-amber-800">
                                {formatVnd(supDebt)}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">0đ</span>
                            )}
                          </td>
                          <td
                            className="py-3.5 px-4 text-right whitespace-nowrap"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="inline-flex items-center gap-1.5">
                              {supDebt > 0 && onOpenCashVoucher && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onOpenCashVoucher({
                                      voucherType: 'payment',
                                      category: 'supplier_debt',
                                      supplierId: sup.id,
                                      counterpartyName: sup.name,
                                      amount: supDebt,
                                      note: `Chi trả nợ NCC ${sup.name}`,
                                    })
                                  }
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg cursor-pointer"
                                >
                                  <Receipt className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>Trả nợ</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openEditSupplier(sup)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Sửa</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {isSupplierModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="supplier-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[1px]"
        >
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3
                id="supplier-modal-title"
                className="font-display text-lg font-bold text-slate-900"
              >
                {supplierForm.id ? 'Chỉnh sửa nhà cung cấp' : 'Thêm nhà cung cấp mới'}
              </h3>
              <button
                type="button"
                onClick={() => setIsSupplierModalOpen(false)}
                aria-label="Đóng hộp thoại nhà cung cấp"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSaveSupplier(e)}
              className="p-5 space-y-4 overflow-y-auto"
            >
              {supplierForm.id && editingSupplierDebt && (
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    <div>
                      <span className="text-slate-500 block">Tổng nhập</span>
                      <strong className="text-sm text-slate-900 tabular-nums">
                        {formatVnd(editingSupplierDebt.totalPurchaseAmount)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Đã thanh toán</span>
                      <strong className="text-sm text-emerald-700 tabular-nums">
                        {formatVnd(editingSupplierDebt.totalPaidAmount)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Còn nợ NCC</span>
                      <strong
                        className={`text-sm tabular-nums ${
                          editingSupplierDebt.debtAmount > 0
                            ? 'text-amber-700'
                            : 'text-slate-700'
                        }`}
                      >
                        {formatVnd(editingSupplierDebt.debtAmount)}
                      </strong>
                    </div>
                  </div>
                  {editingSupplierDebt.debtAmount > 0 && onOpenCashVoucher && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsSupplierModalOpen(false);
                        onOpenCashVoucher({
                          voucherType: 'payment',
                          category: 'supplier_debt',
                          supplierId: supplierForm.id,
                          counterpartyName: supplierForm.name,
                          amount: editingSupplierDebt.debtAmount,
                          note: `Chi trả nợ NCC ${supplierForm.name}`,
                        });
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-lg cursor-pointer"
                    >
                      <Receipt className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Chi trả nợ NCC</span>
                    </button>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tên nhà cung cấp *
                  </label>
                  <input
                    type="text"
                    required
                    value={supplierForm.name}
                    onChange={(e) =>
                      setSupplierForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="VD: Công ty VPP Hồng Hà"
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tên viết tắt
                  </label>
                  <input
                    type="text"
                    value={supplierForm.shortName}
                    onChange={(e) =>
                      setSupplierForm((prev) => ({
                        ...prev,
                        shortName: e.target.value,
                      }))
                    }
                    placeholder="VD: HH"
                    className="w-full min-h-[40px] px-3 py-2 text-sm font-mono uppercase border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Số điện thoại
                  </label>
                  <input
                    type="tel"
                    value={supplierForm.phone}
                    onChange={(e) =>
                      setSupplierForm((prev) => ({ ...prev, phone: e.target.value }))
                    }
                    placeholder="0912345678"
                    className="w-full min-h-[40px] px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Mã số thuế
                  </label>
                  <input
                    type="text"
                    value={supplierForm.taxCode}
                    onChange={(e) =>
                      setSupplierForm((prev) => ({
                        ...prev,
                        taxCode: e.target.value,
                      }))
                    }
                    placeholder="0101234567"
                    className="w-full min-h-[40px] px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={supplierForm.email}
                    onChange={(e) =>
                      setSupplierForm((prev) => ({
                        ...prev,
                        email: e.target.value,
                      }))
                    }
                    placeholder="lienhe@nhacungcap.vn"
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Số tài khoản
                  </label>
                  <input
                    type="text"
                    value={supplierForm.bankAccount}
                    onChange={(e) =>
                      setSupplierForm((prev) => ({
                        ...prev,
                        bankAccount: e.target.value,
                      }))
                    }
                    placeholder="1903..."
                    className="w-full min-h-[40px] px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Ngân hàng &amp; chi nhánh
                  </label>
                  <input
                    type="text"
                    value={supplierForm.bankName}
                    onChange={(e) =>
                      setSupplierForm((prev) => ({
                        ...prev,
                        bankName: e.target.value,
                      }))
                    }
                    placeholder="VD: Vietcombank - CN Thành Công"
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Loại hàng cung cấp
                  </label>
                  <input
                    type="text"
                    value={supplierForm.supplyCategory}
                    onChange={(e) =>
                      setSupplierForm((prev) => ({
                        ...prev,
                        supplyCategory: e.target.value,
                      }))
                    }
                    placeholder="Văn phòng phẩm, giấy in, đồ chơi..."
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Khu vực
                  </label>
                  <input
                    type="text"
                    value={supplierForm.area}
                    onChange={(e) =>
                      setSupplierForm((prev) => ({ ...prev, area: e.target.value }))
                    }
                    placeholder="VD: Hà Nội, Miền Bắc..."
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Điều khoản thanh toán
                  </label>
                  <input
                    type="text"
                    value={supplierForm.paymentTerms}
                    onChange={(e) =>
                      setSupplierForm((prev) => ({
                        ...prev,
                        paymentTerms: e.target.value,
                      }))
                    }
                    placeholder="VD: Công nợ 15 ngày / Tiền mặt khi giao..."
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Địa chỉ
                  </label>
                  <input
                    type="text"
                    value={supplierForm.address}
                    onChange={(e) =>
                      setSupplierForm((prev) => ({ ...prev, address: e.target.value }))
                    }
                    placeholder="Số nhà, đường, quận/huyện..."
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Ghi chú
                </label>
                <textarea
                  rows={2}
                  value={supplierForm.notes}
                  onChange={(e) =>
                    setSupplierForm((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  placeholder="Chiết khấu, điều khoản công nợ, lịch giao hàng..."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              {supplierForm.id && editingSupplierOrders.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-slate-200">
                  <p className="text-xs font-semibold text-slate-700">
                    5 phiếu nhập gần nhất
                  </p>
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg text-xs">
                    {editingSupplierOrders.map((po) => {
                      const rem = getPurchaseOrderRemainingDebt(po);
                      return (
                        <div
                          key={po.id ?? po.poCode}
                          className="px-3 py-2 flex items-center justify-between gap-2"
                        >
                          <div>
                            <span className="font-mono font-semibold text-slate-900">
                              {po.poCode}
                            </span>
                            <span className="text-slate-500 ml-2">
                              {po.importedAt}
                            </span>
                          </div>
                          <div className="text-right tabular-nums">
                            <span className="font-semibold text-slate-900">
                              {formatVnd(po.totalAmount)}
                            </span>
                            {rem > 0 ? (
                              <span className="ml-2 text-amber-700 font-semibold">
                                (Nợ {formatVnd(rem)})
                              </span>
                            ) : (
                              <span className="ml-2 text-emerald-700">
                                Đã trả
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {supplierError && (
                <div
                  role="alert"
                  className="px-3.5 py-2.5 text-xs font-medium text-rose-800 bg-rose-50 border border-rose-200 rounded-lg"
                >
                  {supplierError}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
                <div>
                  {supplierForm.id &&
                    (confirmDeleteSupplierId === supplierForm.id ? (
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            void handleDeleteSupplier({
                              id: supplierForm.id!,
                              name: supplierForm.name,
                              shortName: supplierForm.shortName || null,
                              taxCode: supplierForm.taxCode || null,
                              phone: supplierForm.phone,
                              address: supplierForm.address,
                              area: supplierForm.area || null,
                              paymentTerms: supplierForm.paymentTerms || null,
                              bankAccount: supplierForm.bankAccount || null,
                              bankName: supplierForm.bankName || null,
                              email: supplierForm.email || null,
                              supplyCategory: supplierForm.supplyCategory || null,
                              notes: supplierForm.notes,
                            })
                          }
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer"
                        >
                          Xác nhận xóa
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteSupplierId(null)}
                          className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                        >
                          Hủy
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteSupplierId(supplierForm.id!)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Xóa NCC</span>
                      </button>
                    ))}
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => setIsSupplierModalOpen(false)}
                    className="min-h-[38px] px-3.5 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                  >
                    Đóng
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingSupplier}
                    className="inline-flex items-center gap-1.5 min-h-[38px] px-4 py-1.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer disabled:opacity-60"
                  >
                    <Check className="w-4 h-4" aria-hidden="true" />
                    <span>{isSavingSupplier ? 'Đang lưu...' : 'Lưu nhà cung cấp'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

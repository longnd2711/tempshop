import { useMemo, useState, type FormEvent } from 'react';
import {
  Check,
  FolderSearch,
  FolderTree,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { getGoogleDriveAccessToken } from '../lib/googleDriveAuth';
import { renameDriveFilesForSkuChange } from '../lib/googleDriveSync';
import {
  deleteAdminCategory,
  deleteAdminProduct,
  upsertAdminCategory,
  upsertAdminProduct,
} from '../lib/supabaseAdmin';
import { renameSupabaseProductImagesForSku } from '../lib/supabaseStorage';
import type {
  CategoryNode,
  Product,
  ProductStockFilter,
  PurchasePackOption,
} from '../types/shop';
import {
  formatVariantsInput,
  matchesProductStockFilter,
  normalizePurchasePackOptions,
  parseImageUrlsInput,
  parseVariantsInput,
  slugifyVietnamese,
} from '../utils/adminLogic';
import {
  DEFAULT_DRIVE_FOLDER_NAME,
  normalizeSkuMatchKey,
} from '../utils/imageSyncLogic';
import { formatVnd, normalizeVietnameseText } from '../utils/shopLogic';
import { ImageFolderScannerModal } from './ImageFolderScannerModal';
import { ProductImageUploader } from './ProductImageUploader';
import { SafeImage } from './SafeImage';

interface ProductsAdminPanelProps {
  products: Product[];
  categories: CategoryNode[];
  isLoading: boolean;
  notice?: string;
  onRefresh: () => Promise<void>;
}

type ProductsSubTab = 'products' | 'categories';

interface ProductFormState {
  id?: string;
  originalSku?: string;
  categoryId: string;
  sku: string;
  barcode: string;
  name: string;
  brand: string;
  sellingPrice: string;
  costPrice: string;
  stockQuantity: string;
  minStock: string;
  maxStock: string;
  baseUnit: string;
  unit: string;
  conversionRate: string;
  allowSinglePiece: boolean;
  packRows: Array<{ label: string; factor: string }>;
  variantsText: string;
  imageUrlsText: string;
  notes: string;
  isActive: boolean;
}

interface CategoryFormState {
  id?: string;
  name: string;
  slug: string;
  slugTouched: boolean;
  parentId: string;
  sortOrder: string;
  isActive: boolean;
}

const EMPTY_PRODUCT_FORM: ProductFormState = {
  originalSku: undefined,
  categoryId: '',
  sku: '',
  barcode: '',
  name: '',
  brand: '',
  sellingPrice: '0',
  costPrice: '0',
  stockQuantity: '0',
  minStock: '',
  maxStock: '',
  baseUnit: 'Cái',
  unit: 'Cái',
  conversionRate: '1',
  allowSinglePiece: true,
  packRows: [],
  variantsText: '',
  imageUrlsText: '',
  notes: '',
  isActive: true,
};

const EMPTY_CATEGORY_FORM: CategoryFormState = {
  name: '',
  slug: '',
  slugTouched: false,
  parentId: '',
  sortOrder: '0',
  isActive: true,
};

export function ProductsAdminPanel({
  products,
  categories,
  isLoading,
  notice,
  onRefresh,
}: ProductsAdminPanelProps) {
  const [subTab, setSubTab] = useState<ProductsSubTab>('products');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategoryId, setFilterCategoryId] = useState<string>('all');
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>(
    'all',
  );
  const [filterStock, setFilterStock] = useState<ProductStockFilter>('all');

  const [isProductFormOpen, setIsProductFormOpen] = useState(false);
  const [productForm, setProductForm] =
    useState<ProductFormState>(EMPTY_PRODUCT_FORM);
  const [productError, setProductError] = useState<string | null>(null);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [confirmDeleteProductId, setConfirmDeleteProductId] = useState<
    string | null
  >(null);

  const [isCategoryFormOpen, setIsCategoryFormOpen] = useState(false);
  const [categoryForm, setCategoryForm] =
    useState<CategoryFormState>(EMPTY_CATEGORY_FORM);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [confirmDeleteCategoryId, setConfirmDeleteCategoryId] = useState<
    string | null
  >(null);

  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const orderedCategories = useMemo(() => {
    const roots = categories
      .filter((c) => !c.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'));
    const childrenByParent = new Map<string, CategoryNode[]>();
    for (const c of categories) {
      if (c.parentId) {
        const list = childrenByParent.get(c.parentId) ?? [];
        list.push(c);
        childrenByParent.set(c.parentId, list);
      }
    }

    const result: Array<{ category: CategoryNode; depth: number }> = [];
    const visited = new Set<string>();
    const appendTree = (node: CategoryNode, depth: number) => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      result.push({ category: node, depth });
      const children = (childrenByParent.get(node.id) ?? []).sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi'),
      );
      for (const child of children) {
        appendTree(child, depth + 1);
      }
    };

    for (const root of roots) {
      appendTree(root, 0);
    }
    for (const c of categories) {
      if (!visited.has(c.id)) {
        appendTree(c, 0);
      }
    }
    return result;
  }, [categories]);

  const filteredProducts = useMemo(() => {
    const norm = normalizeVietnameseText(searchQuery);
    return products.filter((p) => {
      if (filterCategoryId !== 'all' && p.categoryId !== filterCategoryId) {
        return false;
      }
      if (filterActive === 'active' && p.isActive === false) return false;
      if (filterActive === 'inactive' && p.isActive !== false) return false;
      if (!matchesProductStockFilter(p, filterStock)) return false;
      if (!norm) return true;
      const hay = normalizeVietnameseText(
        `${p.sku} ${p.barcode ?? ''} ${p.name} ${p.brand ?? ''} ${p.category}`,
      );
      return hay.includes(norm);
    });
  }, [products, searchQuery, filterCategoryId, filterActive, filterStock]);

  const stats = useMemo(() => {
    const totalProducts = products.length;
    const activeProducts = products.filter((p) => p.isActive !== false).length;
    const lowStockProducts = products.filter((p) =>
      p.minStock !== null && p.minStock !== undefined
        ? p.stock <= p.minStock
        : p.stock <= 0,
    ).length;
    const totalCategories = categories.length;
    return { totalProducts, activeProducts, lowStockProducts, totalCategories };
  }, [products, categories]);

  const openCreateProduct = () => {
    setProductForm({
      ...EMPTY_PRODUCT_FORM,
      categoryId: categories[0]?.id ?? '',
    });
    setConfirmDeleteProductId(null);
    setProductError(null);
    setIsProductFormOpen(true);
  };

  const openEditProduct = (product: Product) => {
    const imageList =
      product.images && product.images.length > 0
        ? product.images
        : product.image
          ? [product.image]
          : [];
    const configuredPacks = product.purchasePackOptions;
    let allowSinglePiece = true;
    let packRows: Array<{ label: string; factor: string }> = [];

    if (Array.isArray(configuredPacks) && configuredPacks.length > 0) {
      allowSinglePiece = configuredPacks.some((opt) => Number(opt.factor) === 1);
      packRows = configuredPacks
        .filter((opt) => Number(opt.factor) !== 1)
        .map((opt) => ({
          label: opt.label,
          factor: String(opt.factor),
        }));
    } else if (
      (product.conversionRate ?? 1) > 1 &&
      product.unit &&
      product.unit !== (product.baseUnit ?? product.unit)
    ) {
      packRows = [
        {
          label: product.unit,
          factor: String(product.conversionRate),
        },
      ];
    }

    setProductForm({
      id: product.id,
      originalSku: product.sku,
      categoryId: product.categoryId ?? '',
      sku: product.sku,
      barcode: product.barcode ?? '',
      name: product.name,
      brand: product.brand ?? '',
      sellingPrice: String(product.price ?? 0),
      costPrice: String(product.costPrice ?? 0),
      stockQuantity: String(product.stock ?? 0),
      minStock:
        product.minStock !== undefined && product.minStock !== null
          ? String(product.minStock)
          : '',
      maxStock:
        product.maxStock !== undefined && product.maxStock !== null
          ? String(product.maxStock)
          : '',
      baseUnit: product.baseUnit ?? product.unit ?? 'Cái',
      unit: product.unit ?? 'Cái',
      conversionRate: String(product.conversionRate ?? 1),
      allowSinglePiece,
      packRows,
      variantsText: formatVariantsInput(product.variants),
      imageUrlsText: imageList.join('\n'),
      notes: product.notes ?? '',
      isActive: product.isActive !== false,
    });
    setConfirmDeleteProductId(null);
    setProductError(null);
    setIsProductFormOpen(true);
  };

  const handleSaveProduct = async (e: FormEvent) => {
    e.preventDefault();
    if (!productForm.sku.trim() || !productForm.name.trim()) {
      setProductError('Vui lòng nhập Mã hàng (SKU) và Tên hàng hóa.');
      return;
    }

    setProductError(null);
    setIsSavingProduct(true);
    try {
      const trimmedMin = productForm.minStock.trim();
      const parsedMin = trimmedMin ? Number(trimmedMin) : null;
      const minStockValue =
        parsedMin !== null && Number.isFinite(parsedMin)
          ? Math.max(0, parsedMin)
          : null;

      const trimmedMax = productForm.maxStock.trim();
      const parsedMax = trimmedMax ? Number(trimmedMax) : null;
      const maxStockValue =
        parsedMax !== null && Number.isFinite(parsedMax)
          ? Math.max(0, parsedMax)
          : null;

      const baseUnitLabel =
        productForm.baseUnit.trim() || productForm.unit.trim() || 'Cái';
      const rawPackOptions: PurchasePackOption[] = [];
      if (productForm.allowSinglePiece) {
        rawPackOptions.push({ label: baseUnitLabel, factor: 1 });
      }
      for (const row of productForm.packRows) {
        const lbl = row.label.trim();
        const fac = Number(row.factor);
        if (lbl && Number.isFinite(fac) && fac > 0) {
          rawPackOptions.push({ label: lbl, factor: fac });
        }
      }
      const normalizedPackOptions = normalizePurchasePackOptions(
        rawPackOptions,
        baseUnitLabel,
      );

      let finalImageUrls = parseImageUrlsInput(productForm.imageUrlsText);
      const renameNotes: string[] = [];

      const isSkuChanged =
        Boolean(productForm.id) &&
        Boolean(productForm.originalSku) &&
        normalizeSkuMatchKey(productForm.originalSku ?? '') !==
          normalizeSkuMatchKey(productForm.sku);

      if (isSkuChanged && productForm.originalSku) {
        const supaRename = await renameSupabaseProductImagesForSku(
          productForm.originalSku,
          productForm.sku,
          finalImageUrls,
        );
        finalImageUrls = supaRename.updatedUrls;
        if (supaRename.renamedCount > 0) {
          renameNotes.push(
            `đã đổi tên ${supaRename.renamedCount} ảnh trên Supabase`,
          );
        }
        if (supaRename.errorMessage) {
          renameNotes.push(`lỗi đổi tên Supabase: ${supaRename.errorMessage}`);
        }

        const driveToken = await getGoogleDriveAccessToken();
        if (driveToken) {
          const driveRename = await renameDriveFilesForSkuChange(
            driveToken,
            DEFAULT_DRIVE_FOLDER_NAME,
            productForm.originalSku,
            productForm.sku,
          );
          if (driveRename.renamedCount > 0) {
            renameNotes.push(
              `đã đổi tên ${driveRename.renamedCount} ảnh trên Drive`,
            );
          }
          if (driveRename.errorMessage) {
            renameNotes.push(`lỗi đổi tên Drive: ${driveRename.errorMessage}`);
          }
        }
      }

      const res = await upsertAdminProduct({
        id: productForm.id,
        categoryId: productForm.categoryId || null,
        sku: productForm.sku,
        barcode: productForm.barcode,
        name: productForm.name,
        brand: productForm.brand,
        sellingPrice: Number(productForm.sellingPrice) || 0,
        costPrice: Number(productForm.costPrice) || 0,
        stockQuantity: Number(productForm.stockQuantity) || 0,
        purchasePackOptions: normalizedPackOptions,
        minStock: minStockValue,
        maxStock: maxStockValue,
        baseUnit: productForm.baseUnit,
        unit: productForm.unit,
        conversionRate: Number(productForm.conversionRate) || 1,
        variants: parseVariantsInput(productForm.variantsText),
        imageUrls: finalImageUrls,
        notes: productForm.notes,
        isActive: productForm.isActive,
      });

      if (res.errorMessage) {
        setProductError(res.errorMessage);
        return;
      }

      setIsProductFormOpen(false);
      const baseSavedMsg = productForm.id
        ? `Đã cập nhật hàng hóa "${productForm.name.trim()}".`
        : `Đã thêm hàng hóa "${productForm.name.trim()}".`;
      setStatusFeedback(
        renameNotes.length > 0
          ? `${baseSavedMsg} (${renameNotes.join('; ')}).`
          : baseSavedMsg,
      );
      await onRefresh();
    } finally {
      setIsSavingProduct(false);
    }
  };

  const handleDeleteProductById = async (productId: string, productName: string) => {
    const res = await deleteAdminProduct(productId);
    setConfirmDeleteProductId(null);
    if (res.errorMessage) {
      setProductError(`Không thể xóa hàng hóa: ${res.errorMessage}`);
      return;
    }
    setIsProductFormOpen(false);
    setStatusFeedback(`Đã xóa hàng hóa "${productName}".`);
    await onRefresh();
  };

  const openCreateCategory = () => {
    setCategoryForm({
      ...EMPTY_CATEGORY_FORM,
      sortOrder: String(categories.length + 1),
    });
    setCategoryError(null);
    setIsCategoryFormOpen(true);
  };

  const openEditCategory = (cat: CategoryNode) => {
    setCategoryForm({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      slugTouched: true,
      parentId: cat.parentId ?? '',
      sortOrder: String(cat.sortOrder),
      isActive: cat.isActive,
    });
    setCategoryError(null);
    setIsCategoryFormOpen(true);
  };

  const handleSaveCategory = async (e: FormEvent) => {
    e.preventDefault();
    const resolvedSlug =
      categoryForm.slug.trim() || slugifyVietnamese(categoryForm.name);
    if (!categoryForm.name.trim() || !resolvedSlug) {
      setCategoryError('Vui lòng nhập Tên nhóm hàng và đường dẫn slug hợp lệ.');
      return;
    }
    if (categoryForm.id && categoryForm.parentId === categoryForm.id) {
      setCategoryError('Nhóm hàng không thể tự chọn chính nó làm nhóm cha.');
      return;
    }

    setCategoryError(null);
    setIsSavingCategory(true);
    try {
      const res = await upsertAdminCategory({
        id: categoryForm.id,
        name: categoryForm.name,
        slug: resolvedSlug,
        parentId: categoryForm.parentId || null,
        sortOrder: Number(categoryForm.sortOrder) || 0,
        isActive: categoryForm.isActive,
      });
      if (res.errorMessage) {
        setCategoryError(res.errorMessage);
        return;
      }

      setIsCategoryFormOpen(false);
      setStatusFeedback(
        categoryForm.id
          ? `Đã cập nhật nhóm hàng "${categoryForm.name.trim()}".`
          : `Đã thêm nhóm hàng "${categoryForm.name.trim()}".`,
      );
      await onRefresh();
    } finally {
      setIsSavingCategory(false);
    }
  };

  const handleDeleteCategory = async (cat: CategoryNode) => {
    const res = await deleteAdminCategory(cat.id);
    setConfirmDeleteCategoryId(null);
    if (res.errorMessage) {
      setStatusFeedback(`Không thể xóa nhóm hàng: ${res.errorMessage}`);
      return;
    }
    setStatusFeedback(`Đã xóa nhóm hàng "${cat.name}".`);
    await onRefresh();
  };

  return (
    <div id="products-management" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Quản lý hàng hóa &amp; Nhóm hàng
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Thêm mới, chỉnh giá bán/giá nhập, hình ảnh và sắp xếp danh mục đa cấp.
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

          {subTab === 'products' ? (
            <>
              <button
                type="button"
                onClick={() => setIsScannerOpen(true)}
                className="inline-flex items-center justify-center gap-2 min-h-[40px] px-3.5 py-2 text-sm font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                <FolderSearch className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Quét thư mục ảnh</span>
              </button>

              <button
                type="button"
                onClick={openCreateProduct}
                className="inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Thêm hàng hóa</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={openCreateCategory}
              className="inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Thêm nhóm hàng</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Tổng mặt hàng</p>
          <p className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {stats.totalProducts}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Đang mở bán</p>
          <p className="mt-1 font-display text-2xl font-bold text-emerald-700 tabular-nums">
            {stats.activeProducts}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Tồn thấp / Hết hàng</p>
          <p className="mt-1 font-display text-2xl font-bold text-amber-700 tabular-nums">
            {stats.lowStockProducts}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs font-medium text-slate-500">Nhóm hàng</p>
          <p className="mt-1 font-display text-2xl font-bold text-blue-700 tabular-nums">
            {stats.totalCategories}
          </p>
        </div>
      </div>

      {(notice || statusFeedback) && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg"
        >
          <span>{statusFeedback || notice}</span>
          {statusFeedback && (
            <button
              type="button"
              onClick={() => setStatusFeedback(null)}
              aria-label="Đóng thông báo"
              className="p-1 text-amber-700 hover:text-amber-900 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setSubTab('products')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
            subTab === 'products'
              ? 'border-blue-700 text-blue-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <Package className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Hàng hóa ({products.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('categories')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
            subTab === 'categories'
              ? 'border-blue-700 text-blue-700'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <FolderTree className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Nhóm hàng ({categories.length})</span>
        </button>
      </div>

      {subTab === 'products' ? (
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative w-full md:w-80">
              <label htmlFor="admin-products-search" className="sr-only">
                Tìm kiếm hàng hóa
              </label>
              <Search
                className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                id="admin-products-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm tên hàng, mã SKU, mã vạch..."
                className="w-full min-h-[42px] pl-10 pr-9 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-700"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Xóa tìm kiếm hàng hóa"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 inline-flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <select
                aria-label="Lọc theo nhóm hàng"
                value={filterCategoryId}
                onChange={(e) => setFilterCategoryId(e.target.value)}
                className="min-h-[40px] px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 cursor-pointer"
              >
                <option value="all">Tất cả nhóm hàng</option>
                {orderedCategories.map(({ category, depth }) => (
                  <option key={category.id} value={category.id}>
                    {depth > 0 ? `${'— '.repeat(depth)}${category.name}` : category.name}
                  </option>
                ))}
              </select>

              <select
                aria-label="Lọc trạng thái bán"
                value={filterActive}
                onChange={(e) =>
                  setFilterActive(e.target.value as 'all' | 'active' | 'inactive')
                }
                className="min-h-[40px] px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 cursor-pointer"
              >
                <option value="all">Tất cả trạng thái</option>
                <option value="active">Đang hiển thị</option>
                <option value="inactive">Đang ẩn</option>
              </select>

              <select
                aria-label="Lọc tồn kho"
                data-testid="products-stock-filter"
                value={filterStock}
                onChange={(e) =>
                  setFilterStock(e.target.value as ProductStockFilter)
                }
                className="min-h-[40px] px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 cursor-pointer"
              >
                <option value="all">Tất cả tồn kho</option>
                <option value="below-min">Tồn dưới mức tối thiểu</option>
                <option value="out-of-stock">Tồn kho &lt;= 0</option>
              </select>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            {filteredProducts.length === 0 ? (
              <div className="py-12 px-6 text-center">
                <p className="font-display text-base font-semibold text-slate-900">
                  {products.length === 0
                    ? 'Chưa có dữ liệu hàng hóa trên Supabase'
                    : 'Không tìm thấy mặt hàng phù hợp'}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Nhấn &quot;Thêm hàng hóa&quot; để tạo sản phẩm đầu tiên.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Sản phẩm</th>
                      <th className="py-3 px-4">Mã / Nhóm hàng</th>
                      <th className="py-3 px-4 text-right">Giá nhập</th>
                      <th className="py-3 px-4 text-right">Giá bán</th>
                      <th className="py-3 px-4 text-right">Tồn kho</th>
                      <th className="py-3 px-4 text-right">Khách đặt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {filteredProducts.map((product) => {
                      const catName =
                        (product.categoryId &&
                          categoryById.get(product.categoryId)?.name) ||
                        product.categoryLabel ||
                        'Chưa phân nhóm';
                      const isInactive = product.isActive === false;
                      const isLow =
                        product.minStock !== null &&
                        product.minStock !== undefined
                          ? product.stock <= product.minStock
                          : product.stock <= 0;
                      const orderedQty = product.orderedQuantity ?? 0;
                      const baseUnitLabel = product.baseUnit ?? product.unit;
                      return (
                        <tr
                          key={product.id}
                          onClick={() => openEditProduct(product)}
                          title="Nhấn để chỉnh sửa hàng hóa"
                          className={`align-middle cursor-pointer transition-colors ${
                            isInactive
                              ? 'bg-slate-100 text-slate-500 hover:bg-slate-200/70'
                              : 'hover:bg-blue-50/40'
                          }`}
                        >
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <SafeImage
                                src={product.image}
                                alt={product.name}
                                className={`w-11 h-11 rounded-lg object-cover border border-slate-200 bg-slate-100 shrink-0 ${
                                  isInactive ? 'opacity-65 grayscale-[40%]' : ''
                                }`}
                              />
                              <div className="min-w-0">
                                <p
                                  className={`font-semibold line-clamp-1 ${
                                    isInactive ? 'text-slate-600' : 'text-slate-900'
                                  }`}
                                >
                                  {product.name}
                                </p>
                                <p className="text-xs text-slate-500">
                                  ĐVT: {product.unit}
                                  {product.conversionRate &&
                                  product.conversionRate > 1
                                    ? ` (1 ${product.unit} = ${product.conversionRate} ${product.baseUnit ?? 'Cái'})`
                                    : ''}
                                  {formatVariantsInput(product.variants)
                                    ? ` · Phân loại: ${formatVariantsInput(product.variants)}`
                                    : ''}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <p
                              className={`font-mono text-xs font-semibold ${
                                isInactive ? 'text-slate-600' : 'text-slate-800'
                              }`}
                            >
                              {product.sku}
                            </p>
                            <p className="text-xs text-slate-500">{catName}</p>
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums text-slate-700">
                            {formatVnd(product.costPrice ?? 0)}
                          </td>
                          <td
                            className={`py-3 px-4 text-right font-semibold tabular-nums ${
                              isInactive ? 'text-slate-600' : 'text-slate-900'
                            }`}
                          >
                            {formatVnd(product.price)}
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-md ${
                                isLow
                                  ? 'bg-amber-50 text-amber-800'
                                  : isInactive
                                    ? 'bg-slate-200/80 text-slate-600'
                                    : 'bg-slate-100 text-slate-800'
                              }`}
                            >
                              {product.stock} {baseUnitLabel}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-md ${
                                orderedQty > 0
                                  ? 'bg-blue-50 text-blue-800'
                                  : 'text-slate-500'
                              }`}
                            >
                              {orderedQty} {baseUnitLabel}
                            </span>
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
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          {orderedCategories.length === 0 ? (
            <div className="py-12 px-6 text-center">
              <p className="font-display text-base font-semibold text-slate-900">
                Chưa có nhóm hàng nào
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Nhấn &quot;Thêm nhóm hàng&quot; để khởi tạo danh mục sản phẩm.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Tên nhóm hàng</th>
                    <th className="py-3 px-4">Nhóm cha</th>
                    <th className="py-3 px-4">Slug</th>
                    <th className="py-3 px-4 text-center">Thứ tự</th>
                    <th className="py-3 px-4">Trạng thái</th>
                    <th className="py-3 px-4 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {orderedCategories.map(({ category, depth }) => {
                    const parentName = category.parentId
                      ? categoryById.get(category.parentId)?.name ?? '—'
                      : 'Nhóm gốc';
                    return (
                      <tr
                        key={category.id}
                        className="hover:bg-slate-50/70 align-middle"
                      >
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          <span style={{ paddingLeft: `${depth * 18}px` }}>
                            {depth > 0 ? '└ ' : ''}
                            {category.name}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600">
                          {parentName}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-600">
                          {category.slug}
                        </td>
                        <td className="py-3 px-4 text-center tabular-nums text-slate-700">
                          {category.sortOrder}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex px-2.5 py-0.5 text-xs font-semibold rounded-md border ${
                              category.isActive
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : 'bg-slate-100 text-slate-600 border-slate-200'
                            }`}
                          >
                            {category.isActive ? 'Hiển thị' : 'Đang ẩn'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {confirmDeleteCategoryId === category.id ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => void handleDeleteCategory(category)}
                                className="px-2.5 py-1 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded cursor-pointer"
                              >
                                Xác nhận xóa
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteCategoryId(null)}
                                className="px-2 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
                              >
                                Hủy
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openEditCategory(category)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Sửa</span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmDeleteCategoryId(category.id)
                                }
                                aria-label={`Xóa nhóm ${category.name}`}
                                className="inline-flex items-center p-1.5 text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {isProductFormOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-form-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl border border-slate-200 shadow-xl">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3
                id="product-form-title"
                className="font-display text-lg font-bold text-slate-900"
              >
                {productForm.id ? 'Chỉnh sửa hàng hóa' : 'Thêm hàng hóa mới'}
              </h3>
              <button
                type="button"
                onClick={() => setIsProductFormOpen(false)}
                aria-label="Đóng biểu mẫu hàng hóa"
                className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSaveProduct(e)}
              className="p-6 space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Mã hàng (SKU) *
                  </label>
                  <input
                    type="text"
                    required
                    value={productForm.sku}
                    onChange={(e) =>
                      setProductForm((prev) => ({ ...prev, sku: e.target.value }))
                    }
                    placeholder="VD: VPP-001"
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Mã vạch (Barcode)
                  </label>
                  <input
                    type="text"
                    value={productForm.barcode}
                    onChange={(e) =>
                      setProductForm((prev) => ({
                        ...prev,
                        barcode: e.target.value,
                      }))
                    }
                    placeholder="Tùy chọn"
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Tên hàng hóa *
                </label>
                <input
                  type="text"
                  required
                  value={productForm.name}
                  onChange={(e) =>
                    setProductForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="VD: Vở ô ly 96 trang Hồng Hà"
                  className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nhóm hàng
                  </label>
                  <select
                    value={productForm.categoryId}
                    onChange={(e) =>
                      setProductForm((prev) => ({
                        ...prev,
                        categoryId: e.target.value,
                      }))
                    }
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Chưa chọn nhóm hàng</option>
                    {orderedCategories.map(({ category, depth }) => (
                      <option key={category.id} value={category.id}>
                        {depth > 0 ? `${'— '.repeat(depth)}${category.name}` : category.name}
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
                    value={productForm.brand}
                    onChange={(e) =>
                      setProductForm((prev) => ({ ...prev, brand: e.target.value }))
                    }
                    placeholder="VD: Thiên Long, Hồng Hà..."
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Giá bán (VNĐ)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={productForm.sellingPrice}
                    onChange={(e) =>
                      setProductForm((prev) => ({
                        ...prev,
                        sellingPrice: e.target.value,
                      }))
                    }
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Giá nhập (VNĐ)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={productForm.costPrice}
                    onChange={(e) =>
                      setProductForm((prev) => ({
                        ...prev,
                        costPrice: e.target.value,
                      }))
                    }
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tồn kho hiện tại
                  </label>
                  <input
                    type="number"
                    step="1"
                    value={productForm.stockQuantity}
                    onChange={(e) =>
                      setProductForm((prev) => ({
                        ...prev,
                        stockQuantity: e.target.value,
                      }))
                    }
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tồn tối thiểu (để trống = null)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={productForm.minStock}
                    onChange={(e) =>
                      setProductForm((prev) => ({
                        ...prev,
                        minStock: e.target.value,
                      }))
                    }
                    placeholder="Không bắt buộc"
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tồn lớn nhất (để trống = null)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={productForm.maxStock}
                    onChange={(e) =>
                      setProductForm((prev) => ({
                        ...prev,
                        maxStock: e.target.value,
                      }))
                    }
                    placeholder="Không bắt buộc"
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Đơn vị cơ bản
                  </label>
                  <input
                    type="text"
                    value={productForm.baseUnit}
                    onChange={(e) =>
                      setProductForm((prev) => ({
                        ...prev,
                        baseUnit: e.target.value,
                      }))
                    }
                    placeholder="Cái, Cây, Quyển"
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Đơn vị bán / quy cách
                  </label>
                  <input
                    type="text"
                    value={productForm.unit}
                    onChange={(e) =>
                      setProductForm((prev) => ({
                        ...prev,
                        unit: e.target.value,
                      }))
                    }
                    placeholder="Hộp, Lốc, Thùng"
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tỷ lệ quy đổi
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={productForm.conversionRate}
                    onChange={(e) =>
                      setProductForm((prev) => ({
                        ...prev,
                        conversionRate: e.target.value,
                      }))
                    }
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-800">
                      Quy cách nhập mua theo lô
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Dùng cho phiếu nhập hàng &amp; tính gợi ý chọn hàng cần nhập.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setProductForm((prev) => ({
                        ...prev,
                        packRows: [...prev.packRows, { label: '', factor: '' }],
                      }))
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-700 bg-white hover:bg-blue-50 border border-blue-200 rounded-lg cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Thêm quy cách lô</span>
                  </button>
                </div>

                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={productForm.allowSinglePiece}
                    onChange={(e) =>
                      setProductForm((prev) => ({
                        ...prev,
                        allowSinglePiece: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 rounded border-slate-300 text-blue-700"
                  />
                  <span>
                    Cho phép nhập lẻ từng {productForm.baseUnit.trim() || 'cái'} (x1)
                  </span>
                </label>

                {productForm.packRows.length > 0 && (
                  <div className="space-y-2">
                    {productForm.packRows.map((row, idx) => (
                      <div
                        key={`pack-row-${idx}`}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="text"
                          value={row.label}
                          onChange={(e) =>
                            setProductForm((prev) => ({
                              ...prev,
                              packRows: prev.packRows.map((r, i) =>
                                i === idx ? { ...r, label: e.target.value } : r,
                              ),
                            }))
                          }
                          placeholder="Tên lô (VD: Hộp, Thùng)"
                          className="flex-1 min-h-[36px] px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                        />
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={row.factor}
                          onChange={(e) =>
                            setProductForm((prev) => ({
                              ...prev,
                              packRows: prev.packRows.map((r, i) =>
                                i === idx ? { ...r, factor: e.target.value } : r,
                              ),
                            }))
                          }
                          placeholder="Số lượng quy đổi (VD: 20)"
                          className="w-36 min-h-[36px] px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setProductForm((prev) => ({
                              ...prev,
                              packRows: prev.packRows.filter((_, i) => i !== idx),
                            }))
                          }
                          aria-label="Xóa quy cách nhập"
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label
                  htmlFor="product-variants-input"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Phân loại / Biến thể (cách nhau bằng dấu phẩy, tùy chọn)
                </label>
                <input
                  id="product-variants-input"
                  type="text"
                  value={productForm.variantsText}
                  onChange={(e) =>
                    setProductForm((prev) => ({
                      ...prev,
                      variantsText: e.target.value,
                    }))
                  }
                  placeholder="VD: Mực xanh, Mực đỏ, Mực đen (để trống = Tiêu chuẩn)"
                  className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <ProductImageUploader
                sku={productForm.sku}
                imageUrlsText={productForm.imageUrlsText}
                onChangeImageUrlsText={(nextText) =>
                  setProductForm((prev) => ({
                    ...prev,
                    imageUrlsText: nextText,
                  }))
                }
              />

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Ghi chú nội bộ
                </label>
                <input
                  type="text"
                  value={productForm.notes}
                  onChange={(e) =>
                    setProductForm((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  placeholder="Nhà cung cấp, vị trí kệ..."
                  className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={productForm.isActive}
                  onChange={(e) =>
                    setProductForm((prev) => ({
                      ...prev,
                      isActive: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 rounded border-slate-300 text-blue-700"
                />
                <span>Hiển thị trên trang bán hàng công khai</span>
              </label>

              {productError && (
                <div
                  role="alert"
                  className="px-3.5 py-2.5 text-xs font-medium text-rose-800 bg-rose-50 border border-rose-200 rounded-lg"
                >
                  {productError}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-slate-200">
                <div>
                  {productForm.id &&
                    (confirmDeleteProductId === productForm.id ? (
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            void handleDeleteProductById(
                              productForm.id!,
                              productForm.name || productForm.sku,
                            )
                          }
                          className="min-h-[36px] px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer"
                        >
                          Xác nhận xóa
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteProductId(null)}
                          className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                        >
                          Hủy xóa
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteProductId(productForm.id!)}
                        className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-sm font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                        <span>Xóa hàng hóa</span>
                      </button>
                    ))}
                </div>

                <div className="flex items-center gap-2.5 ml-auto">
                  <button
                    type="button"
                    onClick={() => setIsProductFormOpen(false)}
                    className="min-h-[40px] px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingProduct}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer disabled:opacity-60"
                  >
                    <Check className="w-4 h-4" aria-hidden="true" />
                    <span>{isSavingProduct ? 'Đang lưu...' : 'Lưu hàng hóa'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {isCategoryFormOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="category-form-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3
                id="category-form-title"
                className="font-display text-lg font-bold text-slate-900"
              >
                {categoryForm.id ? 'Chỉnh sửa nhóm hàng' : 'Thêm nhóm hàng mới'}
              </h3>
              <button
                type="button"
                onClick={() => setIsCategoryFormOpen(false)}
                aria-label="Đóng biểu mẫu nhóm hàng"
                className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void handleSaveCategory(e)}
              className="p-6 space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Tên nhóm hàng *
                </label>
                <input
                  type="text"
                  required
                  value={categoryForm.name}
                  onChange={(e) => {
                    const nextName = e.target.value;
                    setCategoryForm((prev) => ({
                      ...prev,
                      name: nextName,
                      slug: prev.slugTouched
                        ? prev.slug
                        : slugifyVietnamese(nextName),
                    }));
                  }}
                  placeholder="VD: Đồ dùng học sinh"
                  className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Đường dẫn (Slug) *
                </label>
                <input
                  type="text"
                  required
                  value={categoryForm.slug}
                  onChange={(e) =>
                    setCategoryForm((prev) => ({
                      ...prev,
                      slug: e.target.value,
                      slugTouched: true,
                    }))
                  }
                  placeholder="do-dung-hoc-sinh"
                  className="w-full min-h-[40px] px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nhóm cha (nếu có)
                  </label>
                  <select
                    value={categoryForm.parentId}
                    onChange={(e) =>
                      setCategoryForm((prev) => ({
                        ...prev,
                        parentId: e.target.value,
                      }))
                    }
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Nhóm gốc (cấp 1)</option>
                    {categories
                      .filter((c) => c.id !== categoryForm.id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Thứ tự hiển thị
                  </label>
                  <input
                    type="number"
                    step="1"
                    value={categoryForm.sortOrder}
                    onChange={(e) =>
                      setCategoryForm((prev) => ({
                        ...prev,
                        sortOrder: e.target.value,
                      }))
                    }
                    className="w-full min-h-[40px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={categoryForm.isActive}
                  onChange={(e) =>
                    setCategoryForm((prev) => ({
                      ...prev,
                      isActive: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 rounded border-slate-300 text-blue-700"
                />
                <span>Hiển thị nhóm hàng trên cửa hàng</span>
              </label>

              {categoryError && (
                <div
                  role="alert"
                  className="px-3.5 py-2.5 text-xs font-medium text-rose-800 bg-rose-50 border border-rose-200 rounded-lg"
                >
                  {categoryError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsCategoryFormOpen(false)}
                  className="min-h-[40px] px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSavingCategory}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer disabled:opacity-60"
                >
                  <Check className="w-4 h-4" aria-hidden="true" />
                  <span>{isSavingCategory ? 'Đang lưu...' : 'Lưu nhóm hàng'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ImageFolderScannerModal
        isOpen={isScannerOpen}
        products={products}
        onClose={() => setIsScannerOpen(false)}
        onCompleted={async (summaryMessage) => {
          setStatusFeedback(summaryMessage);
          await onRefresh();
        }}
      />
    </div>
  );
}

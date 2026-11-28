import * as XLSX from 'xlsx';
import type { Product, PurchaseOrderItem } from '../types/shop';
import {
  computePurchaseLineTotal,
  getEffectivePurchasePackOptions,
  getLatestProductImportCostMap,
  syncDiscountFromAmount,
  syncDiscountFromPercent,
} from './adminLogic';
import { normalizeVietnameseText } from './shopLogic';

export interface NeedImportExportRow {
  'Số thứ tự': number;
  'Mã hàng': string;
  'Mã vạch': string;
  'Tên hàng': string;
  'Số lượng cần nhập': number;
  'Giá nhập lần trước': number;
  'Thành tiền': number;
}

export interface NeedImportExportInputItem {
  sku: string;
  barcode?: string;
  name: string;
  quantity: number;
  lastImportPrice: number;
}

export function buildNeedImportExportRows(
  items: NeedImportExportInputItem[],
): NeedImportExportRow[] {
  return items.map((item, idx) => {
    const qty = Math.max(0, Number(item.quantity) || 0);
    const unitPrice = Math.max(0, Number(item.lastImportPrice) || 0);
    return {
      'Số thứ tự': idx + 1,
      'Mã hàng': item.sku || '',
      'Mã vạch': item.barcode || '',
      'Tên hàng': item.name || '',
      'Số lượng cần nhập': qty,
      'Giá nhập lần trước': unitPrice,
      'Thành tiền': Math.round(qty * unitPrice),
    };
  });
}

export function exportNeedImportToExcel(
  items: NeedImportExportInputItem[],
  fileName?: string,
): void {
  const rows = buildNeedImportExportRows(items);
  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: [
      'Số thứ tự',
      'Mã hàng',
      'Mã vạch',
      'Tên hàng',
      'Số lượng cần nhập',
      'Giá nhập lần trước',
      'Thành tiền',
    ],
  });
  worksheet['!cols'] = [
    { wch: 10 },
    { wch: 16 },
    { wch: 18 },
    { wch: 38 },
    { wch: 18 },
    { wch: 20 },
    { wch: 20 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'CanNhapHang');
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const resolvedName = fileName || `can-nhap-hang-${mm}${dd}.xlsx`;
  XLSX.writeFile(workbook, resolvedName);
}

export function parseExcelNumber(raw: unknown): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : 0;
  }
  if (typeof raw !== 'string') return 0;
  const trimmed = raw.trim().replace(/[₫đ%\s]/gi, '');
  if (!trimmed) return 0;

  // Handle Vietnamese thousand separator like "15.000" or "1.250.000"
  if (/^-?\d{1,3}(\.\d{3})+$/.test(trimmed)) {
    const num = Number(trimmed.replace(/\./g, ''));
    return Number.isFinite(num) ? num : 0;
  }
  // Handle comma thousand separator like "15,000" or "1,250,000"
  if (/^-?\d{1,3}(,\d{3})+$/.test(trimmed)) {
    const num = Number(trimmed.replace(/,/g, ''));
    return Number.isFinite(num) ? num : 0;
  }
  // Handle mixed US "1,250,000.50" or EU "1.250.000,50"
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(trimmed)) {
    const num = Number(trimmed.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(num) ? num : 0;
  }
  if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(trimmed)) {
    const num = Number(trimmed.replace(/,/g, ''));
    return Number.isFinite(num) ? num : 0;
  }

  const normalized = trimmed.replace(',', '.').replace(/[^0-9.-]/g, '');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

type ImportColumnKey =
  | 'sku'
  | 'barcode'
  | 'productName'
  | 'unitLabel'
  | 'quantity'
  | 'unitCost'
  | 'discountPercent'
  | 'discountAmount'
  | 'sellingPrice'
  | 'lineTotal';

function matchHeaderColumn(rawHeader: unknown): ImportColumnKey | null {
  const norm = normalizeVietnameseText(String(rawHeader ?? ''))
    .replace(/[():]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!norm) return null;

  if (
    norm === 'ma hang' ||
    norm === 'ma sp' ||
    norm === 'ma san pham' ||
    norm === 'sku' ||
    norm === 'code'
  ) {
    return 'sku';
  }
  if (norm === 'ma vach' || norm === 'barcode') {
    return 'barcode';
  }
  if (
    norm === 'ten hang' ||
    norm === 'ten hang hoa' ||
    norm === 'ten san pham' ||
    norm === 'san pham' ||
    norm === 'mat hang' ||
    norm === 'product name' ||
    norm === 'name'
  ) {
    return 'productName';
  }
  if (
    norm === 'dvt' ||
    norm === 'don vi' ||
    norm === 'don vi tinh' ||
    norm === 'don vi nhap' ||
    norm === 'unit'
  ) {
    return 'unitLabel';
  }
  if (
    norm === 'sl' ||
    norm === 'so luong' ||
    norm === 'so luong nhap' ||
    norm === 'so luong can nhap' ||
    norm === 'quantity' ||
    norm === 'qty'
  ) {
    return 'quantity';
  }
  if (
    norm === 'don gia nhap' ||
    norm === 'gia nhap' ||
    norm === 'gia nhap lan truoc' ||
    norm === 'don gia' ||
    norm === 'unit cost' ||
    norm === 'cost'
  ) {
    return 'unitCost';
  }
  if (
    norm === 'giam gia %' ||
    norm === 'chiet khau %' ||
    norm === 'ck %' ||
    norm === 'discount %'
  ) {
    return 'discountPercent';
  }
  if (
    norm === 'giam gia d' ||
    norm === 'giam gia vnd' ||
    norm === 'giam gia' ||
    norm === 'chiet khau d' ||
    norm === 'chiet khau' ||
    norm === 'discount'
  ) {
    return 'discountAmount';
  }
  if (
    norm === 'gia ban' ||
    norm === 'gia ban d' ||
    norm === 'selling price'
  ) {
    return 'sellingPrice';
  }
  if (norm === 'thanh tien' || norm === 'line total' || norm === 'total') {
    return 'lineTotal';
  }
  return null;
}

export interface ParsePurchaseImportResult {
  items: PurchaseOrderItem[];
  matchedCount: number;
  newProductCount: number;
  skippedRows: number;
  errorMessage?: string;
}

export function decodeWorkbookFromUpload(
  data: ArrayBuffer | string,
  fileName: string,
): XLSX.WorkBook {
  const isCsv = fileName.trim().toLowerCase().endsWith('.csv');
  if (isCsv) {
    let text = '';
    if (typeof data === 'string') {
      text = data;
    } else {
      text = new TextDecoder('utf-8').decode(data);
    }
    const cleanText = text.replace(/^\uFEFF/, '');
    return XLSX.read(cleanText, { type: 'string' });
  }

  if (typeof data === 'string') {
    return XLSX.read(data, { type: 'string' });
  }
  return XLSX.read(data, { type: 'array' });
}

export function parsePurchaseImportWorkbook(
  data: ArrayBuffer | string,
  fileName: string,
  products: Product[],
  latestCostMap?: Map<string, number>,
): ParsePurchaseImportResult {
  try {
    const workbook = decodeWorkbookFromUpload(data, fileName);
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      return {
        items: [],
        matchedCount: 0,
        newProductCount: 0,
        skippedRows: 0,
        errorMessage: 'File không có sheet dữ liệu nào.',
      };
    }

    const sheet = workbook.Sheets[firstSheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
    });

    if (matrix.length === 0) {
      return {
        items: [],
        matchedCount: 0,
        newProductCount: 0,
        skippedRows: 0,
        errorMessage: 'File dữ liệu trống.',
      };
    }

    // Locate header row within first 10 rows
    let headerRowIdx = -1;
    let columnIndexMap = new Map<ImportColumnKey, number>();

    for (let r = 0; r < Math.min(10, matrix.length); r++) {
      const row = matrix[r] ?? [];
      const candidate = new Map<ImportColumnKey, number>();
      row.forEach((cell, colIdx) => {
        const key = matchHeaderColumn(cell);
        if (key && !candidate.has(key)) {
          candidate.set(key, colIdx);
        }
      });
      if (
        candidate.has('sku') ||
        candidate.has('productName') ||
        candidate.has('barcode')
      ) {
        headerRowIdx = r;
        columnIndexMap = candidate;
        break;
      }
    }

    if (headerRowIdx === -1) {
      return {
        items: [],
        matchedCount: 0,
        newProductCount: 0,
        skippedRows: 0,
        errorMessage:
          'Không nhận diện được cột tiêu đề (cần tối thiểu cột Mã hàng/SKU, Mã vạch hoặc Tên hàng).',
      };
    }

    const costMap =
      latestCostMap ?? getLatestProductImportCostMap([], products);
    const productBySku = new Map<string, Product>();
    const productByBarcode = new Map<string, Product>();
    const productByName = new Map<string, Product>();
    for (const prod of products) {
      if (prod.sku) productBySku.set(prod.sku.trim().toUpperCase(), prod);
      if (prod.barcode) productByBarcode.set(prod.barcode.trim().toLowerCase(), prod);
      if (prod.name) productByName.set(normalizeVietnameseText(prod.name), prod);
    }

    const items: PurchaseOrderItem[] = [];
    let matchedCount = 0;
    let newProductCount = 0;
    let skippedRows = 0;

    const getCell = (row: unknown[], key: ImportColumnKey): unknown => {
      const col = columnIndexMap.get(key);
      return col !== undefined ? row[col] : '';
    };

    for (let r = headerRowIdx + 1; r < matrix.length; r++) {
      const row = matrix[r] ?? [];
      const rawSku = String(getCell(row, 'sku') ?? '').trim();
      const rawBarcode = String(getCell(row, 'barcode') ?? '').trim();
      const rawName = String(getCell(row, 'productName') ?? '').trim();

      if (!rawSku && !rawBarcode && !rawName) {
        continue;
      }

      // Skip summary/total footer rows
      const normName = normalizeVietnameseText(rawName);
      const normSku = normalizeVietnameseText(rawSku);
      if (
        normName.startsWith('tong cong') ||
        normName.startsWith('tong tien') ||
        normSku.startsWith('tong')
      ) {
        continue;
      }

      const qtyVal = parseExcelNumber(getCell(row, 'quantity'));
      const quantity = qtyVal > 0 ? qtyVal : 1;
      const rawUnitLabel = String(getCell(row, 'unitLabel') ?? '').trim();

      const matchedProduct =
        (rawSku ? productBySku.get(rawSku.toUpperCase()) : undefined) ??
        (rawBarcode ? productByBarcode.get(rawBarcode.toLowerCase()) : undefined) ??
        (normName ? productByName.get(normName) : undefined);

      let unitCost = Math.max(0, parseExcelNumber(getCell(row, 'unitCost')));
      const rawLineTotal = Math.max(0, parseExcelNumber(getCell(row, 'lineTotal')));
      if (unitCost === 0 && rawLineTotal > 0 && quantity > 0) {
        unitCost = Math.round(rawLineTotal / quantity);
      }

      const rawDiscountPct = parseExcelNumber(getCell(row, 'discountPercent'));
      const rawDiscountAmt = parseExcelNumber(getCell(row, 'discountAmount'));
      const hasSellingCol = columnIndexMap.has('sellingPrice');
      const rawSellingPrice = parseExcelNumber(getCell(row, 'sellingPrice'));

      if (matchedProduct) {
        const packOptions = getEffectivePurchasePackOptions(matchedProduct);
        const normUnit = normalizeVietnameseText(rawUnitLabel);
        const chosenPack =
          (normUnit
            ? packOptions.find(
                (opt) => normalizeVietnameseText(opt.label) === normUnit,
              )
            : undefined) ??
          packOptions[0] ?? {
            label: matchedProduct.baseUnit ?? matchedProduct.unit ?? 'Cái',
            factor: 1,
          };

        const conversionFactor = Math.max(0.01, chosenPack.factor);
        if (unitCost === 0) {
          const fallbackBaseCost =
            costMap.get(matchedProduct.id) ?? matchedProduct.costPrice ?? 0;
          if (fallbackBaseCost > 0) {
            unitCost = Math.round(fallbackBaseCost * conversionFactor);
          }
        }

        const synced =
          rawDiscountAmt > 0
            ? syncDiscountFromAmount(unitCost, rawDiscountAmt)
            : syncDiscountFromPercent(unitCost, rawDiscountPct);

        const { netUnitCost, lineTotal } = computePurchaseLineTotal(
          quantity,
          unitCost,
          synced.discountAmount,
        );

        items.push({
          productId: matchedProduct.id,
          sku: matchedProduct.sku,
          productName: matchedProduct.name,
          unitLabel: chosenPack.label,
          conversionFactor,
          quantity,
          unitCost,
          discountPercent: synced.discountPercent,
          discountAmount: synced.discountAmount,
          netUnitCost,
          sellingPrice:
            hasSellingCol && rawSellingPrice > 0
              ? rawSellingPrice
              : matchedProduct.price,
          lineTotal,
          isNewProduct: false,
        });
        matchedCount += 1;
      } else {
        const fallbackSku = (
          rawSku ||
          rawBarcode ||
          `IMP-${r + 1}`
        )
          .trim()
          .toUpperCase();
        const fallbackName = rawName || fallbackSku;
        if (!fallbackSku || !fallbackName) {
          skippedRows += 1;
          continue;
        }
        const unitLabel = rawUnitLabel || 'Cái';
        const synced =
          rawDiscountAmt > 0
            ? syncDiscountFromAmount(unitCost, rawDiscountAmt)
            : syncDiscountFromPercent(unitCost, rawDiscountPct);
        const { netUnitCost, lineTotal } = computePurchaseLineTotal(
          quantity,
          unitCost,
          synced.discountAmount,
        );

        items.push({
          productId: '',
          sku: fallbackSku,
          productName: fallbackName,
          unitLabel,
          conversionFactor: 1,
          quantity,
          unitCost,
          discountPercent: synced.discountPercent,
          discountAmount: synced.discountAmount,
          netUnitCost,
          sellingPrice: rawSellingPrice > 0 ? rawSellingPrice : 0,
          lineTotal,
          isNewProduct: true,
          newProductBarcode: rawBarcode || undefined,
          newProductBaseUnit: unitLabel,
          newProductUnit: unitLabel,
          newProductConversionRate: 1,
          newProductImageUrls: [],
        });
        newProductCount += 1;
      }
    }

    if (items.length === 0) {
      return {
        items: [],
        matchedCount: 0,
        newProductCount: 0,
        skippedRows,
        errorMessage: 'Không tìm thấy dòng hàng hóa hợp lệ nào trong file.',
      };
    }

    return {
      items,
      matchedCount,
      newProductCount,
      skippedRows,
    };
  } catch (err) {
    return {
      items: [],
      matchedCount: 0,
      newProductCount: 0,
      skippedRows: 0,
      errorMessage:
        err instanceof Error
          ? `Không thể đọc file Excel/CSV (${err.message}).`
          : 'Không thể đọc file Excel/CSV.',
    };
  }
}

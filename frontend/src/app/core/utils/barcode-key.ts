/** Misma normalización que el backend — reexport desde shared. */
export {
  normalizeBarcodeKey,
  looksLikeBarcodeQuery,
  sanitizeScannedBarcode,
  barcodeFieldsForWrite,
} from '../../../../../shared/barcode.ts';

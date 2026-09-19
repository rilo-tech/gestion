export {
  createProduct,
  updateProduct,
  adjustStock,
  setStock,
  type CreateProductInput,
  type UpdateProductInput,
  type AdjustStockInput,
  type AdjustStockResult,
  type SetStockInput,
} from './stock-domain-service.ts';
export {
  findProduct,
  getProduct,
  listProducts,
  getProductStock,
  type ProductEntityResult,
  type ProductListResult,
} from './product-query-service.ts';
export {
  previewProductRename,
  renameProduct,
  bulkRenameProductFamily,
  bulkUpdateProductsRename,
  listProductVariantsByBaseName,
  type ProductRenamePreview,
  type ProductRenameScope,
  type ProductVariantRow,
} from './product-rename-service.ts';

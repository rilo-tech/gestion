export {
  createProduct,
  updateProduct,
  adjustStock,
  setStock,
  type CreateProductInput,
  type UpdateProductInput,
  type AdjustStockInput,
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

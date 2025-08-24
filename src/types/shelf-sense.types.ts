// Основные типы для ShelfSense API

export interface MerchGroup {
  id: string;
  name: string;
}

export interface ShelfSummary {
  shelves_with_voids: number;
  voids_percent: number;
  skus_to_fill: number;
  new_voids: number;
  top_groups: string[];
}

export interface PriceSummary {
  shelves_with_errors: number;
  errors_percent: number;
  price_mismatch: number;
  tag_template_mismatch: number;
  tags_missing: number;
  tags_extra: number;
  top_groups: string[];
}

export interface VoidItem {
  id: string;
  shelf_index: number;
  position: number;
  sku: string;
  name: string;
  stock: number;
  photo_url: string;
}

export interface PriceErrorItem {
  id: string;
  merch_group: MerchGroup;
  shelf_index: number;
  position: number;
  sku: string | null;
  name: string | null;
  error_type: PriceErrorTypes;
  details: string | null;
  photo_url: string;
}

export enum PriceErrorTypes {
  PRICE_MISMATCH = 'PRICE_MISMATCH',
  TAG_TEMPLATE_MISMATCH = 'TAG_TEMPLATE_MISMATCH',
  TAG_PRODUCT_MISMATCH = 'TAG_PRODUCT_MISMATCH',
  TAG_MISSING = 'TAG_MISSING',
  TAG_EXTRA = 'TAG_EXTRA'
}

export interface TaskAction {
  task_id: string;
  action: TaskActionTypes;
  comment: string | null;
}

export enum TaskActionTypes {
  DONE = 'DONE',
  DECLINE = 'DECLINE'
}

export interface ValidationError {
  loc: (string | number)[];
  msg: string;
  type: string;
}

export interface HTTPValidationError {
  detail: ValidationError[];
}

// API Response типы
export type MerchGroupsResponse = MerchGroup[];
export type ShelfSummaryResponse = ShelfSummary;
export type PriceSummaryResponse = PriceSummary;
export type ShelvesVoidsResponse = VoidItem[];
export type PriceErrorsResponse = PriceErrorItem[];
export type TaskActionResponse = Record<string, never>; // Пустой объект для успешного ответа
export type GenerateLabelsPdfResponse = Record<string, never>; // Пустой объект для успешного ответа

// Shared row types. Keep in sync with supabase/schema.sql.
// Timestamps arrive from Supabase as ISO strings; `date` columns as "YYYY-MM-DD".

export type Role = "manager" | "employee";
export const ROLES: Role[] = ["manager", "employee"];

export type OrderStatus = "draft" | "placed";
export const ORDER_STATUSES: OrderStatus[] = ["draft", "placed"];

export type StockEventKind = "delivery" | "count" | "adjustment";
export const STOCK_EVENT_KINDS: StockEventKind[] = ["delivery", "count", "adjustment"];

export type SubmissionType = "low_stock" | "new_request" | "maintenance" | "other";
export const SUBMISSION_TYPES: SubmissionType[] = [
  "low_stock",
  "new_request",
  "maintenance",
  "other",
];
export const SUBMISSION_TYPE_LABELS: Record<SubmissionType, string> = {
  low_stock: "Low stock",
  new_request: "New request",
  maintenance: "Maintenance",
  other: "Other",
};

export type SubmissionStatus = "open" | "acknowledged" | "resolved";
export const SUBMISSION_STATUSES: SubmissionStatus[] = ["open", "acknowledged", "resolved"];
export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
};

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: Role;
  created_at: string;
}

export interface Item {
  id: string;
  name: string;
  unit: string | null;
  par_level: number;
  current_qty: number;
  active: boolean;
  created_at: string;
}

export interface Order {
  id: string;
  /** Monday of the week the order supplies, "YYYY-MM-DD". */
  week_start: string;
  status: OrderStatus;
  headcount: number | null;
  ai_summary: string | null;
  summary_text: string | null;
  placed_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface OrderLine {
  id: string;
  order_id: string;
  item_id: string | null;
  item_name: string;
  qty: number;
  suggested_qty: number | null;
  reason: string | null;
  is_new: boolean;
  waste_risk: boolean;
  created_at: string;
}

export interface Delivery {
  id: string;
  /** Path inside the private `dockets` storage bucket. */
  photo_path: string | null;
  order_id: string | null;
  raw_extraction: unknown;
  created_by: string | null;
  created_at: string;
}

export interface StockEvent {
  id: string;
  item_id: string;
  kind: StockEventKind;
  delta: number;
  qty_after: number;
  delivery_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Submission {
  id: string;
  user_id: string;
  /** Groups the submissions that came out of one free-text message. */
  batch_id: string | null;
  type: SubmissionType;
  item_id: string | null;
  /** Canonical lower-case name, used to group new_request submissions. */
  requested_item_name: string | null;
  raw_text: string;
  detail: string | null;
  status: SubmissionStatus;
  manager_note: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface Headcount {
  week_start: string;
  headcount: number;
}

export interface FoodPost {
  id: string;
  user_id: string;
  description: string;
  location: string | null;
  /** Path inside the public `food` storage bucket. */
  photo_path: string | null;
  expires_at: string;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

/** Payload accepted by the helpers in src/lib/notify.ts. */
export interface NotificationInput {
  title: string;
  body?: string | null;
  link?: string | null;
}

export const STORAGE_BUCKETS = { dockets: "dockets", food: "food" } as const;

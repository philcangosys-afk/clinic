import type { SalesInvoiceStatus } from "@/lib/database.types";

/**
 * تسميات حالة الفاتورة وألوانها — تعريف واحد.
 *
 * كانت معرَّفة داخل `pages/Billing.tsx` وحدها، فأيّ شاشة أخرى تعرض فاتورة كان
 * عليها أن تكتب تسمياتها من جديد. تسميتان لحالةٍ واحدة تتباعدان مع أوّل تعديل،
 * فيقرأ الموظّف «مدفوعة جزئيًا» في شاشة و«جزئي» في أخرى ويظنّهما حالتين.
 */
export const INVOICE_STATUS_LABELS: Record<SalesInvoiceStatus, string> = {
  draft: "مسوّدة",
  unpaid: "غير مدفوعة",
  partial: "مدفوعة جزئيًا",
  paid: "مدفوعة بالكامل",
  partially_refunded: "مستردّة جزئيًا",
  refunded: "مستردّة بالكامل",
  void: "ملغاة",
};

export const INVOICE_STATUS_BADGE: Record<SalesInvoiceStatus, string> = {
  unpaid: "bg-rose-100 text-rose-700",
  partial: "bg-amber-100 text-amber-700",
  paid: "bg-emerald-100 text-emerald-700",
  void: "bg-slate-100 text-slate-500",
  draft: "bg-amber-100 text-amber-800",
  partially_refunded: "bg-orange-100 text-orange-800",
  refunded: "bg-rose-100 text-rose-700",
};

/** الحالات التي لا تقبل قبضًا: الملغاة والمسوّدة والمستردّة بالكامل. */
export function invoiceAcceptsPayment(status: SalesInvoiceStatus | null | undefined, remaining: number): boolean {
  if (!status) return false;
  if (status === "void" || status === "draft" || status === "refunded") return false;
  return remaining > 0;
}

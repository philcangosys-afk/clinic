import { Banknote, CalendarClock, StickyNote, UserRoundSearch, type LucideIcon } from "lucide-react";

/**
 * مفردات مركز المتابعة — تُكتب مرّةً وتقرؤها الشاشة والنافذة الجانبية.
 *
 * نصٌّ واحد في مكانين يفترق بعد أوّل تعديل: «ملاحظة» في الشاشة و«رسالة» في
 * النافذة تجعل الموظّف يسأل هل هما شيئان.
 */

/** صفّ `v_follow_up_center` (0173). */
export type FollowUpRow = {
  source_kind: "staff" | "appointment";
  id: string;
  organization_id: string;
  branch_id: string | null;
  request_type: "note" | "call_patient" | "collect_payment" | "follow_up";
  status: string;
  priority: "routine" | "urgent";
  patient_id: string | null;
  patient_name: string | null;
  file_number: number | null;
  patient_mobile: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  body: string | null;
  amount: number | null;
  preferred_date: string | null;
  requested_at: string;
  requested_by_name: string | null;
  seen_at: string | null;
  seen_by_name: string | null;
  resolved_at: string | null;
  resolved_by_name: string | null;
  resolution_note: string | null;
  /** خدماتٌ اختارها الطبيب بسعرها وخصمها (0218) — لا فاتورة، للاستقبال. */
  services: FollowUpService[] | null;
};

export type FollowUpService = {
  item_id: string;
  code: string | null;
  name: string;
  catalog_price: number | null;
  price: number;
  discount: number;
  net: number;
};

export const FOLLOW_UP_COLUMNS =
  "source_kind, id, organization_id, branch_id, request_type, status, priority, patient_id, patient_name, file_number, patient_mobile, doctor_id, doctor_name, body, amount, preferred_date, requested_at, requested_by_name, seen_at, seen_by_name, resolved_at, resolved_by_name, resolution_note, services";

export const FOLLOW_UP_TYPE: Record<FollowUpRow["request_type"], { label: string; icon: LucideIcon }> = {
  note: { label: "ملاحظة", icon: StickyNote },
  call_patient: { label: "استدعاء المريض", icon: UserRoundSearch },
  collect_payment: { label: "تحصيل مبلغ", icon: Banknote },
  follow_up: { label: "موعد متابعة", icon: CalendarClock },
};

/**
 * الحالة بلغة الاستقبال. مصدران بمفرداتٍ مختلفة (`done` في الطلبات و`approved`
 * في طلبات المواعيد) — والموظّف يقرأ «أُنجز» في الحالتين.
 */
export function followUpStatusLabel(row: Pick<FollowUpRow, "status" | "source_kind">): {
  label: string;
  tone: "open" | "done" | "closed";
} {
  switch (row.status) {
    case "pending":
      return { label: "مفتوح", tone: "open" };
    case "done":
      return { label: "أُنجز", tone: "done" };
    case "approved":
      return { label: "حُجز الموعد", tone: "done" };
    case "rejected":
      return { label: "رُفض", tone: "closed" };
    case "cancelled":
      return { label: "أُلغي", tone: "closed" };
    default:
      return { label: row.status, tone: "closed" };
  }
}

/** بداية اليوم المحلّيّ ونهايته — «اليوم» يوم العيادة لا يوم UTC. */
export function localDayBounds(day: string): { fromIso: string; toIso: string } {
  const [y, m, d] = day.split("-").map(Number);
  const start = new Date(y, (m ?? 1) - 1, d ?? 1);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return { fromIso: start.toISOString(), toIso: end.toISOString() };
}

/** تاريخ اليوم المحلّيّ بصيغة حقل التاريخ (YYYY-MM-DD). */
export function todayLocalDate(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** كلّ مفاتيح الاستعلام التي تقرأ طلبات الأطباء — تُبطَل معًا بعد أيّ تغيير. */
export const FOLLOW_UP_QUERY_KEYS = [
  ["follow-up-center"],
  ["follow-up-unseen"],
  ["reception-requests"],
  ["live-badge-counts"],
] as const;

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * اليومية: ضبطها، ويوم العمل الحالي (0181).
 *
 * «اليوم» في الفوترة هو يوم العمل لا التاريخ التقويميّ: عيادةٌ تعمل من 8
 * صباحًا إلى 2 بعد منتصف الليل تُحسب فواتير الواحدة فجرًا فيها لليوم السابق.
 * فتاريخ يوم العمل الحالي يُسأل عنه القاعدةَ (`app_business_day_window`) لا
 * ساعةَ المتصفّح.
 */

export type BusinessDaySettings = {
  organization_id: string;
  day_start: string; // "HH:MM:SS"
  day_end: string;
  auto_close: boolean;
  timezone: string;
  updated_at: string;
};

/** تاريخ الرياض المحلّي — احتياطٌ إن لم تُنفَّذ ترقية 0181 بعد. */
export function riyadhToday() {
  const shifted = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export const hhmm = (time: string | null | undefined) => (time ?? "").slice(0, 5);

export function useBusinessDaySettings(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["business-day-settings", organizationId],
    enabled: Boolean(organizationId),
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_day_settings")
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as BusinessDaySettings | null;
    },
  });
}

/**
 * تاريخ يوم العمل الحالي. يُقفل قبل السؤال ما حلّ موعده من يوميات، فلا
 * تظهر يوميةٌ مفتوحة انتهى وقتها لأنّ أحدًا لم يُصدر فاتورة بعدها.
 */
export function useCurrentBusinessDate(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["current-business-date", organizationId],
    enabled: Boolean(organizationId),
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      await supabase.rpc("app_close_due_business_days", { p_organization_id: organizationId });
      const { data: open } = await supabase
        .from("business_days")
        .select("business_date")
        .eq("organization_id", organizationId)
        .is("closed_at", null)
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (open?.business_date) return String(open.business_date);
      const { data, error } = await supabase.rpc("app_business_day_window", {
        p_organization_id: organizationId,
      });
      if (error) return riyadhToday();
      const row = Array.isArray(data) ? data[0] : data;
      return row?.business_date ? String(row.business_date) : riyadhToday();
    },
  });
}

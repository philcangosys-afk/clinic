import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Link } from "react-router-dom";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * جرس التنبيهات — المرحلة 23.
 *
 * كان الجرس زرًّا بلا وجهة ولا عدّاد: أيقونةٌ توحي بأن النظام سينبّهك ولا
 * يفعل. الآن يقرأ صندوق المستخدم الحقيقي (`v_notification_summary`) ويفتح
 * شاشة التنبيهات.
 */
export default function NotificationBell() {
  const { organization } = useOrganizationAccess();

  const summary = useQuery({
    queryKey: ["notification-summary", organization?.id],
    enabled: Boolean(organization?.id),
    // التنبيه الحرِج لا يحتمل انتظار إعادة تحميل الصفحة
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_notification_summary").select("unread_count, critical_count")
        .eq("organization_id", organization!.id);
      if (error) throw error;
      const rows = (data ?? []) as any[];
      return {
        unread: rows.reduce((sum, r) => sum + Number(r.unread_count ?? 0), 0),
        critical: rows.reduce((sum, r) => sum + Number(r.critical_count ?? 0), 0),
      };
    },
  });

  const unread = summary.data?.unread ?? 0;
  const critical = summary.data?.critical ?? 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link to="/alerts" aria-label="التنبيهات">
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              <span
                className={`absolute -top-0.5 -end-0.5 min-w-4 rounded-full px-1 text-[10px] font-bold leading-4 text-white ${
                  critical > 0 ? "bg-destructive" : "bg-primary"
                }`}
              >
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Button>
        </Link>
      </TooltipTrigger>
      <TooltipContent>
        {unread > 0
          ? `${unread} تنبيه غير مقروء${critical > 0 ? ` — منها ${critical} حرِج` : ""}`
          : "لا تنبيهات جديدة"}
      </TooltipContent>
    </Tooltip>
  );
}

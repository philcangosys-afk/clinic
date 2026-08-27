import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LockKeyhole } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { AuditActionType } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ACTION_LABELS: Record<AuditActionType, string> = {
  add: "إضافة",
  update: "تعديل",
  delete: "حذف",
  login: "تسجيل دخول",
  logout: "تسجيل خروج",
  print: "طباعة",
  export: "تصدير",
};
const ACTION_BADGE: Record<AuditActionType, "success" | "default" | "destructive" | "secondary"> = {
  add: "success",
  update: "default",
  delete: "destructive",
  login: "secondary",
  logout: "secondary",
  print: "secondary",
  export: "secondary",
};

function useAuditLog(organizationId: string | undefined, moduleFilter: string, actionFilter: string, search: string) {
  return useQuery({
    queryKey: ["audit-log", organizationId, moduleFilter, actionFilter, search],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("audit_log")
        .select("id, occurred_at, user_id, action_type, module, entity_title, details")
        .eq("organization_id", organizationId)
        .order("occurred_at", { ascending: false })
        .limit(200);
      if (moduleFilter !== "all") query = query.eq("module", moduleFilter);
      if (actionFilter !== "all") query = query.eq("action_type", actionFilter);
      if (search.trim()) query = query.ilike("entity_title", `%${search.trim()}%`);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useDistinctModules(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["audit-log-modules", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("module")
        .eq("organization_id", organizationId)
        .limit(1000);
      if (error) throw error;
      return Array.from(new Set((data ?? []).map((row) => row.module)));
    },
  });
}

export default function AuditLog() {
  const { organization } = useOrganizationAccess();
  const [moduleFilter, setModuleFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [search, setSearch] = useState("");
  const log = useAuditLog(organization?.id, moduleFilter, actionFilter, search);
  const modules = useDistinctModules(organization?.id);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">سجل التدقيق</h1>
        <p className="text-sm text-muted-foreground">سجل غير قابل للتعديل أو الحذف — كل الإضافات/التعديلات/الحذف/تسجيلات الدخول مسجَّلة هنا</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>آخر 200 عملية</CardTitle>
          <CardDescription>هذا السجل تُسجِّله الوحدات المختلفة تلقائيًا من طبقة التطبيق — لا يمكن تعديله أو حذفه حتى من قِبل المالك</CardDescription>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث باسم العنصر..." className="max-w-xs" />
            <Select value={moduleFilter} onValueChange={setModuleFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="كل الموديولات" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الموديولات</SelectItem>
                {(modules.data ?? []).map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="كل العمليات" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل العمليات</SelectItem>
                {Object.entries(ACTION_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {log.isLoading && <Skeleton className="h-40 w-full" />}
          {!log.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>العملية</TableHead>
                  <TableHead>الموديول</TableHead>
                  <TableHead>العنصر</TableHead>
                  <TableHead>تفاصيل</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(log.data ?? []).map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-xs text-muted-foreground">{new Date(entry.occurred_at).toLocaleString("ar-SA")}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <LockKeyhole className="h-3.5 w-3.5 text-muted-foreground" />
                        <Badge variant={ACTION_BADGE[entry.action_type as AuditActionType]}>
                          {ACTION_LABELS[entry.action_type as AuditActionType]}
                        </Badge>
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{entry.module}</TableCell>
                    <TableCell>{entry.entity_title ?? "—"}</TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{entry.details ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {(log.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد عمليات مسجَّلة بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

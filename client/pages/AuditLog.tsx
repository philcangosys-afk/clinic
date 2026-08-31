import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LockKeyhole, Download } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PrivacyCenter from "@/components/security/PrivacyCenter";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { localDayRange } from "@/lib/date-range";
import type { AuditActionType, AuditLogDetailView } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

function useAuditLog(
  organizationId: string | undefined,
  moduleFilter: string,
  actionFilter: string,
  search: string,
  dateFrom: string,
  dateTo: string,
  userFilter: string,
  deviceFilter: string,
) {
  return useQuery({
    queryKey: [
      "audit-log",
      organizationId,
      moduleFilter,
      actionFilter,
      search,
      dateFrom,
      dateTo,
      userFilter,
      deviceFilter,
    ],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      // v_audit_log_detail يضيف بريد المستخدم — الجدول الخام يخزّن user_id فقط
      // والعميل لا يستطيع قراءة auth.users مباشرة (0037).
      let query = supabase
        .from("v_audit_log_detail")
        .select(
          "id, organization_id, occurred_at, user_id, user_name, device_name, action_type, module, entity_id, entity_title, details, reason",
        )
        .eq("organization_id", organizationId)
        .order("occurred_at", { ascending: false })
        .limit(500);
      if (moduleFilter !== "all") query = query.eq("module", moduleFilter);
      if (actionFilter !== "all") query = query.eq("action_type", actionFilter);
      if (search.trim()) query = query.ilike("entity_title", `%${search.trim()}%`);
      // الحدود بتوقيت المتصفح لا بتوقيت الخادم — انظر date-range.ts
      const bounds = localDayRange(dateFrom, dateTo);
      if (bounds.from) query = query.gte("occurred_at", bounds.from);
      if (bounds.to) query = query.lte("occurred_at", bounds.to);
      if (userFilter !== "all") query = query.eq("user_name", userFilter);
      if (deviceFilter !== "all") query = query.eq("device_name", deviceFilter);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as AuditLogDetailView[];
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

/**
 * تحويل `details` من نصّ JSON إلى قائمة "الحقل: قديم ← جديد".
 *
 * بعد 0048 صار مُحفِّز التدقيق يكتب في `details` الأعمدة المتغيّرة فقط بصيغة
 * {"price": {"old": "300.00", "new": "450.00"}} — وهي إجابة السؤال الوحيد
 * الذي يُطرح عند مراجعة تعديل: **ماذا تغيّر بالضبط؟**
 *
 * العمود من نوع `text` لا `jsonb`، والسجلات القديمة فيه نصّ حرّ كتبته الشاشات
 * يدويًا. لذلك التحويل داخل try/catch: ما لا يُحلَّل يُعرض كما هو بدل أن
 * يختفي — سجل تدقيق يُخفي صفًا لا يفهمه أسوأ من سجل يعرضه خامًا.
 */
type DetailChange = { field: string; old: string; next: string };

function parseAuditDetails(raw: string | null): { changes: DetailChange[]; fallback: string | null } {
  if (!raw || !raw.trim()) return { changes: [], fallback: null };
  try {
    const parsed = JSON.parse(raw) as Record<string, { old?: string; new?: string }>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return { changes: [], fallback: raw };
    const changes = Object.entries(parsed)
      .filter(([, value]) => value && typeof value === "object" && ("old" in value || "new" in value))
      .map(([field, value]) => ({ field, old: value.old ?? "", next: value.new ?? "" }));
    return changes.length > 0 ? { changes, fallback: null } : { changes: [], fallback: raw };
  } catch {
    return { changes: [], fallback: raw };
  }
}

/** الصيغة النصّية نفسها — للتصدير إلى CSV حيث لا مجال للعرض المهيكل. */
function formatAuditDetails(raw: string | null): string {
  const { changes, fallback } = parseAuditDetails(raw);
  if (changes.length === 0) return fallback ?? "";
  return changes.map((change) => `${change.field}: ${change.old} ← ${change.next}`).join(" | ");
}

/** تصدير السجل المعروض كملف CSV (لقطة 81 — "تصدير كامل/دفعات"). */
function exportCsv(rows: AuditLogDetailView[]) {
  const headers = ["التاريخ", "المستخدم", "الجهاز", "العملية", "الموديول", "العنصر", "التفاصيل", "السبب"];
  const escape = (value: string | null | undefined) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        new Date(row.occurred_at).toLocaleString("ar-SA"),
        row.user_name,
        row.device_name,
        ACTION_LABELS[row.action_type as AuditActionType] ?? row.action_type,
        row.module,
        row.entity_title,
        formatAuditDetails(row.details),
        row.reason,
      ]
        .map(escape)
        .join(","),
    ),
  ];
  // BOM حتى تفتح إكسل الملف بترميز عربي صحيح
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function AuditLog() {
  const { organization } = useOrganizationAccess();
  const [moduleFilter, setModuleFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [userFilter, setUserFilter] = useState("all");
  const [deviceFilter, setDeviceFilter] = useState("all");
  const log = useAuditLog(
    organization?.id,
    moduleFilter,
    actionFilter,
    search,
    dateFrom,
    dateTo,
    userFilter,
    deviceFilter,
  );
  const modules = useDistinctModules(organization?.id);

  /**
   * قائمتا المستخدمين والأجهزة تُشتقّان من السجل نفسه بدل جدول منفصل، لأن
   * السجل قد يحوي مستخدمين لم يعودوا أعضاء أو أجهزة قديمة — وإخفاؤها كان
   * سيجعل عمليات قديمة غير قابلة للتصفية.
   */
  const facets = useQuery({
    queryKey: ["audit-log-facets", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_audit_log_detail")
        .select("user_name, device_name")
        .eq("organization_id", organization?.id)
        .limit(1000);
      if (error) throw error;
      const users = new Set<string>();
      const devices = new Set<string>();
      (data ?? []).forEach((row: { user_name: string | null; device_name: string | null }) => {
        if (row.user_name) users.add(row.user_name);
        if (row.device_name) devices.add(row.device_name);
      });
      return { users: [...users].sort(), devices: [...devices].sort() };
    },
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">سجل التدقيق</h1>
        <p className="text-sm text-muted-foreground">سجل غير قابل للتعديل أو الحذف — كل الإضافات/التعديلات/الحذف/تسجيلات الدخول مسجَّلة هنا</p>
      </div>

      <Tabs defaultValue="audit">
        <TabsList>
          <TabsTrigger value="audit">سجل التدقيق</TabsTrigger>
          <TabsTrigger value="privacy">الخصوصية والموافقات</TabsTrigger>
        </TabsList>
        <TabsContent value="audit" className="mt-4">
      <Card>
        <CardHeader>
          <CardTitle>آخر 500 عملية</CardTitle>
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
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="كل المستخدمين" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المستخدمين</SelectItem>
                {(facets.data?.users ?? []).map((email) => (
                  <SelectItem key={email} value={email}>
                    {email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={deviceFilter} onValueChange={setDeviceFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="كل الأجهزة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأجهزة</SelectItem>
                {(facets.data?.devices ?? []).map((device) => (
                  <SelectItem key={device} value={device}>
                    {device}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-40"
              title="من تاريخ"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-40"
              title="إلى تاريخ"
            />
            <Button
              variant="outline"
              onClick={() => exportCsv(log.data ?? [])}
              disabled={(log.data ?? []).length === 0}
            >
              <Download className="h-4 w-4" />
              تصدير CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {log.isLoading && <Skeleton className="h-40 w-full" />}
          {!log.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>المستخدم</TableHead>
                  <TableHead>الجهاز</TableHead>
                  <TableHead>العملية</TableHead>
                  <TableHead>الموديول</TableHead>
                  <TableHead>العنصر</TableHead>
                  <TableHead>تفاصيل</TableHead>
                  <TableHead>السبب</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(log.data ?? []).map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-xs text-muted-foreground">{new Date(entry.occurred_at).toLocaleString("ar-SA")}</TableCell>
                    <TableCell className="text-sm">{entry.user_name ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{entry.device_name ?? "—"}</TableCell>
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
                    <TableCell className="max-w-xs text-sm text-muted-foreground">
                      <AuditDetailsCell raw={entry.details} />
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate text-sm text-muted-foreground">{entry.reason ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {(log.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد عمليات مسجَّلة بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
        </TabsContent>
        <TabsContent value="privacy" className="mt-4">
          <PrivacyCenter />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AuditDetailsCell({ raw }: { raw: string | null }) {
  const { changes, fallback } = parseAuditDetails(raw);
  if (changes.length === 0)
    return <span className="block truncate">{fallback ?? "—"}</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {changes.map((change) => (
        <span key={change.field} className="flex items-baseline gap-1 text-xs">
          <span className="font-mono text-[10px] text-foreground/70">{change.field}</span>
          <span className="truncate line-through opacity-60">{change.old || "—"}</span>
          <span aria-hidden>←</span>
          <span className="truncate font-medium text-foreground">{change.next || "—"}</span>
        </span>
      ))}
    </div>
  );
}

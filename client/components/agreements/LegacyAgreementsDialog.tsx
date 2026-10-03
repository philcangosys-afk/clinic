import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ChevronDown, ChevronLeft, ExternalLink, Loader2, RotateCcw, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { formatAmount, formatDateTime } from "@/lib/locale";
import { usePermissions } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { invalidateAgreementQueries } from "@/components/agreements/AgreementDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * أرشيف اتفاقيات النظام السابق (Kizen) — داخل شاشة الاتفاقيات (0217).
 *
 * كلّ اتفاقيةٍ كما كانت في Kizen ببنودها وفواتيرها. «تنشيط» يجعلها حيّةً في
 * ملفّ المريض برقمها في Kizen، بخدماتها الحقيقية بما بقي منها — فتُعدَّل،
 * ويُضاف لها عرض، وتُفوتَر. والمفوترة بالكامل أو المعطّلة أو الملغاة
 * مديونيتها تُنشَّط كذلك. وما كان حيًّا من قبل يُفتح (ويُفعَّل إن كان معطّلًا).
 */

type LegacyItem = {
  quote: string | null;
  code: string | null;
  service: string | null;
  qty: number | null;
  price: number | null;
  discount: number | null;
  net: number | null;
  doctor: string | null;
};

type LegacyInvoiceRef = { seq: string | null; zatca: string | null; date: string | null; kind: string; works: string | null; net: number | null };

type LegacyAgreementRow = {
  id: string;
  patient_id: string | null;
  file_number: number | null;
  legacy_number: number;
  agreement_date: string | null;
  doctor_name: string | null;
  clinic_name: string | null;
  services: string | null;
  total_amount: number;
  invoiced_amount: number;
  remaining_amount: number;
  debt_cancelled: boolean;
  is_disabled: boolean;
  kizen_deleted?: boolean;
  agreement_text: string | null;
  note: string | null;
  items: LegacyItem[] | null;
  invoices: LegacyInvoiceRef[] | null;
  migrated_agreement_id: string | null;
  migrated?: { agreement_number: number; is_disabled: boolean; doctor_id: string | null } | null;
  patient?: { name_ar: string; file_number: number | null } | null;
};

/** «د. ماجد» و«دكتور ماجد» و«ماجد» اسمٌ واحد، بلا تشكيلٍ ولا همزات. */
function normalizeDoctorName(name: string) {
  return name
    .replace(/^\s*(?:(?:دكتورة|دكتور)\s+|د\s*\.\s*|د\s+)/, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\u064B-\u0652ـ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export default function LegacyAgreementsDialog({
  open,
  onOpenChange,
  organizationId,
  patientId,
  doctorScopeId,
  onOpenAgreement,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  /** ملفّ مريض: اتفاقياته وحده. وبدونه: بحثٌ برقم الاتفاقية أو رقم الملف. */
  patientId?: string | null;
  /** الطبيب الداخل (0218): اتفاقياته هو وحده — باسمه في Kizen أو بطبيب نسختها الحيّة. */
  doctorScopeId?: string | null;
  onOpenAgreement: (agreementId: string) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const canManage = can("agreements.manage");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["legacy-agreements", organizationId, patientId ?? null, term],
    enabled: open && Boolean(organizationId) && (Boolean(patientId) || term.length > 0),
    queryFn: async () => {
      let query = supabase
        .from("legacy_agreements")
        .select(
          "*, migrated:treatment_agreements(agreement_number, is_disabled, doctor_id), patient:patients!legacy_agreements_patient_id_fkey(name_ar, file_number)",
        )
        .eq("organization_id", organizationId!)
        .order("agreement_date", { ascending: false, nullsFirst: false })
        .limit(200);
      if (patientId) query = query.eq("patient_id", patientId);
      else if (/^\d+$/.test(term)) query = query.or(`legacy_number.eq.${term},file_number.eq.${term}`);
      else query = query.ilike("services", `%${term}%`);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as LegacyAgreementRow[];
    },
  });

  const activate = useMutation({
    mutationFn: async (row: LegacyAgreementRow) => {
      const { data, error } = await supabase.rpc("app_activate_legacy_agreement", { p_legacy_id: row.id });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (agreementId, row) => {
      invalidateAgreementQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["legacy-agreements"] });
      toast({
        title: row.migrated_agreement_id ? `فُتحت الاتفاقية ${row.legacy_number}` : `نُشِّطت الاتفاقية ${row.legacy_number}`,
        description: "عدِّلها أو أضف عرضًا ثمّ «فوترة».",
      });
      onOpenChange(false);
      onOpenAgreement(agreementId);
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: "تعذّر التنشيط", description: errorMessage(error) }),
  });

  const scopeDoctor = useQuery({
    queryKey: ["legacy-agreements-doctor-name", doctorScopeId ?? null],
    enabled: open && Boolean(doctorScopeId),
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("doctors").select("name_ar").eq("id", doctorScopeId!).maybeSingle();
      if (error) throw error;
      return (data as { name_ar: string } | null)?.name_ar ?? "";
    },
  });

  const rows = useMemo(() => {
    const all = list.data ?? [];
    if (!doctorScopeId) return all;
    const mine = normalizeDoctorName(scopeDoctor.data ?? "");
    return all.filter((row) => {
      if (row.migrated?.doctor_id) return row.migrated.doctor_id === doctorScopeId;
      const theirs = normalizeDoctorName(row.doctor_name ?? "");
      return Boolean(mine && theirs) && (theirs === mine || theirs.includes(mine) || mine.includes(theirs));
    });
  }, [list.data, doctorScopeId, scopeDoctor.data]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="flex max-h-[92vh] w-[min(98vw,1150px)] max-w-none flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="h-5 w-5 text-amber-600" />
            أرشيف اتفاقيات النظام السابق (Kizen)
          </DialogTitle>
          <DialogDescription>
            كلّ اتفاقية كما كانت في Kizen ببنودها وفواتيرها. «تنشيط» يجعلها حيّةً في ملفّ المريض برقمها، بما بقي من خدماتها،
            فتُعدَّل وتُفوتَر — حتى المفوترة بالكامل أو المعطّلة.
          </DialogDescription>
        </DialogHeader>

        {!patientId && (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setTerm(search.trim());
            }}
          >
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="رقم الاتفاقية أو رقم الملف أو اسم الخدمة"
              className="max-w-sm"
            />
            <Button type="submit" variant="outline">
              <Search className="h-4 w-4" />
              بحث
            </Button>
          </form>
        )}

        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          {list.isLoading ? (
            <Skeleton className="m-3 h-32" />
          ) : list.isError ? (
            <p className="p-6 text-center text-sm text-destructive">{errorMessage(list.error)}</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {patientId || term ? "لا اتفاقيات في أرشيف النظام السابق." : "ابحث برقم الاتفاقية أو رقم الملف."}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 text-xs">
                <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-start">
                  <th className="w-6" />
                  <th>الرقم</th>
                  <th>التاريخ</th>
                  {!patientId && <th>المريض</th>}
                  <th>الطبيب</th>
                  <th className="min-w-[14rem]">الخدمات</th>
                  <th>الإجمالي</th>
                  <th>المفوتر</th>
                  <th>المتبقّي</th>
                  <th>الحالة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isOpen = expanded === row.id;
                  const live = Boolean(row.migrated_agreement_id && row.migrated);
                  return (
                    <Fragment key={row.id}>
                      <tr className="border-t align-top tabular-nums [&>td]:px-2 [&>td]:py-1.5">
                        <td>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setExpanded(isOpen ? null : row.id)}>
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                          </Button>
                        </td>
                        <td className="font-mono">{row.legacy_number}</td>
                        <td className="whitespace-nowrap text-xs">{formatDateTime(row.agreement_date)}</td>
                        {!patientId && (
                          <td className="text-xs">
                            {row.patient?.name_ar ?? "—"}
                            <span className="block font-mono text-[10px] text-muted-foreground">{row.file_number}</span>
                          </td>
                        )}
                        <td className="text-xs">{row.doctor_name ?? "—"}</td>
                        <td className="max-w-[22rem] text-xs" title={row.services ?? ""}>
                          <span className="line-clamp-2">{row.services ?? "—"}</span>
                        </td>
                        <td>{formatAmount(row.total_amount)}</td>
                        <td className="text-emerald-700">{formatAmount(row.invoiced_amount)}</td>
                        <td className={Number(row.remaining_amount) >= 0.5 ? "font-semibold text-amber-700" : "text-muted-foreground"}>
                          {formatAmount(row.remaining_amount)}
                        </td>
                        <td className="space-y-0.5 text-[11px]">
                          {live ? (
                            <Badge className="bg-emerald-600">
                              حيّة #{row.migrated?.agreement_number}
                              {row.migrated?.is_disabled ? " (معطّلة)" : ""}
                            </Badge>
                          ) : (
                            <Badge variant="outline">في الأرشيف</Badge>
                          )}
                          {row.debt_cancelled && <Badge variant="outline" className="border-rose-400 text-rose-700">أُلغيت مديونيتها</Badge>}
                          {row.is_disabled && <Badge variant="secondary">معطّلة في Kizen</Badge>}
                          {row.kizen_deleted && <Badge variant="destructive">حُذفت في Kizen</Badge>}
                        </td>
                        <td className="whitespace-nowrap">
                          {live ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={activate.isPending}
                              onClick={() =>
                                row.migrated?.is_disabled && canManage
                                  ? activate.mutate(row)
                                  : onOpenAgreement(row.migrated_agreement_id as string)
                              }
                            >
                              <ExternalLink className="h-4 w-4" />
                              {row.migrated?.is_disabled && canManage ? "تفعيل وفتح" : "فتح"}
                            </Button>
                          ) : canManage ? (
                            <Button
                              size="sm"
                              className="bg-amber-500 text-white hover:bg-amber-600"
                              disabled={activate.isPending || !row.patient_id}
                              title={row.patient_id ? "تصير حيّة في ملفّ المريض بما بقي منها" : "غير مربوطة بمريض في ZainCare"}
                              onClick={() => activate.mutate(row)}
                            >
                              {activate.isPending && activate.variables?.id === row.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RotateCcw className="h-4 w-4" />
                              )}
                              تنشيط
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-muted/30">
                          <td colSpan={patientId ? 10 : 11} className="p-3">
                            <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
                              <div>
                                <p className="mb-1 text-xs font-semibold">البنود في Kizen</p>
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-muted-foreground [&>th]:px-1 [&>th]:text-start">
                                      <th>العرض</th>
                                      <th>الكود</th>
                                      <th>الخدمة</th>
                                      <th>العدد</th>
                                      <th>السعر</th>
                                      <th>الخصم</th>
                                      <th>الصافي</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(row.items ?? []).map((item, index) => (
                                      <tr key={index} className="border-t tabular-nums [&>td]:px-1 [&>td]:py-0.5">
                                        <td>{item.quote ?? ""}</td>
                                        <td className="font-mono">{item.code ?? ""}</td>
                                        <td>{item.service ?? ""}</td>
                                        <td>{item.qty ?? ""}</td>
                                        <td>{formatAmount(item.price ?? 0)}</td>
                                        <td className="text-rose-700">{formatAmount(item.discount ?? 0)}</td>
                                        <td>{formatAmount(item.net ?? 0)}</td>
                                      </tr>
                                    ))}
                                    {(row.items ?? []).length === 0 && (
                                      <tr>
                                        <td colSpan={7} className="py-2 text-muted-foreground">لا بنود في Kizen.</td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                                {(row.agreement_text || row.note) && (
                                  <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                                    {[row.agreement_text, row.note].filter(Boolean).join("\n")}
                                  </p>
                                )}
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-semibold">فواتيرها في Kizen</p>
                                {(row.invoices ?? []).length === 0 ? (
                                  <p className="text-xs text-muted-foreground">لا فواتير.</p>
                                ) : (
                                  <ul className="space-y-1 text-xs">
                                    {(row.invoices ?? []).map((inv, index) => (
                                      <li key={index} className="rounded border bg-background px-2 py-1">
                                        <span className="font-mono">{inv.zatca ?? inv.seq}</span>
                                        {inv.kind === "return" && <Badge variant="secondary" className="ms-1">مرتجع</Badge>}
                                        <span className="ms-2 text-muted-foreground">{formatDateTime(inv.date)}</span>
                                        <span className="ms-2 font-semibold">{formatAmount(inv.net ?? 0)}</span>
                                        {inv.works && <span className="block text-muted-foreground">{inv.works}</span>}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

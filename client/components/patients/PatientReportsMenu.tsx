import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, FileStack, Loader2, Printer } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { errorMessage } from "@/lib/error-message";
import { toast } from "@/hooks/use-toast";
import {
  DEFAULT_ACKNOWLEDGMENT,
  PATIENT_REPORTS,
  printPatientReports,
  type PatientReportKey,
  type ReportFilters,
} from "@/lib/patient-reports";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * «تقارير المريض ▾» و«الملف الموحّد» — بترتيب قائمة Kizen نفسها.
 * التقارير المالية (كشف الفواتير وكشف الحساب) لمن يملك عرض الفوترة.
 */

const WITH_FILTERS: PatientReportKey[] = ["invoices", "statement"];
const NO_DOCTOR = "__all__";

export default function PatientReportsMenu({ patientId }: { patientId: string }) {
  const { organization, membership, session } = useOrganizationAccess() as any;
  const { can } = usePermissions();
  const canFinancial = can("billing.view");
  const canEditAck = ["owner", "organization_admin", "branch_manager"].includes(membership?.role_key ?? "");
  const [busy, setBusy] = useState(false);
  const [filterFor, setFilterFor] = useState<PatientReportKey | null>(null);
  const [filters, setFilters] = useState<ReportFilters>({ showWorks: true });
  const [unifiedOpen, setUnifiedOpen] = useState(false);
  const [unifiedKeys, setUnifiedKeys] = useState<PatientReportKey[]>([]);
  const [ackOpen, setAckOpen] = useState(false);
  const [ackText, setAckText] = useState("");

  const userName =
    membership?.display_name?.trim() ||
    String(session?.user?.user_metadata?.display_name ?? "").trim() ||
    session?.user?.email ||
    "";

  const reports = PATIENT_REPORTS.filter((r) => canFinancial || !r.financial);
  const unifiedChoices = reports.filter((r) => r.unified);

  const doctors = useQuery({
    queryKey: ["report-doctors", organization?.id],
    enabled: Boolean(organization?.id && filterFor),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organization!.id)
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const run = async (keys: PatientReportKey[], unified = false, f: ReportFilters = {}) => {
    if (!organization?.id) return;
    setBusy(true);
    try {
      await printPatientReports({
        organizationId: organization.id,
        organizationName: organization.name ?? "",
        userName,
        patientId,
        keys,
        unified,
        filters: f,
      });
    } catch (error) {
      toast({ variant: "destructive", title: "تعذّر تجهيز التقرير", description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const openAck = async () => {
    const { data } = await supabase.rpc("app_patient_file_acknowledgment", { p_organization_id: organization?.id });
    setAckText((data as string | null) ?? DEFAULT_ACKNOWLEDGMENT);
    setAckOpen(true);
  };
  const saveAck = async (text: string | null) => {
    const { error } = await supabase.rpc("app_set_patient_file_acknowledgment", {
      p_organization_id: organization?.id,
      p_text: text,
    });
    if (error) {
      toast({ variant: "destructive", title: "تعذّر الحفظ", description: errorMessage(error) });
      return;
    }
    toast({ title: text ? "حُفظ نصّ الإقرار" : "أُعيد النصّ الافتراضيّ" });
    setAckOpen(false);
  };

  return (
    <>
      <DropdownMenu dir="rtl">
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
            تقارير المريض
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {reports.map((r) => (
            <DropdownMenuItem
              key={r.key}
              onSelect={() => {
                if (WITH_FILTERS.includes(r.key)) {
                  setFilters({ showWorks: true });
                  setFilterFor(r.key);
                } else void run([r.key]);
              }}
            >
              {r.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setUnifiedKeys(unifiedChoices.map((r) => r.key));
              setUnifiedOpen(true);
            }}
          >
            <FileStack className="h-4 w-4" />
            ملف المريض الموحد
          </DropdownMenuItem>
          {canEditAck && (
            <DropdownMenuItem onSelect={() => void openAck()}>نصّ إقرار «ملف المريض»…</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* متغيرات كشف الفواتير وكشف الحساب */}
      <Dialog open={Boolean(filterFor)} onOpenChange={(open) => !open && setFilterFor(null)}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>{PATIENT_REPORTS.find((r) => r.key === filterFor)?.label}</DialogTitle>
            <DialogDescription>اترك التاريخين فارغين لكل الفترات.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">من تاريخ</Label>
              <Input type="date" value={filters.from ?? ""} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value || null }))} />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">إلى تاريخ</Label>
              <Input type="date" value={filters.to ?? ""} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value || null }))} />
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <Label className="text-xs">الطبيب</Label>
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm"
                value={filters.doctorId ?? NO_DOCTOR}
                onChange={(e) => setFilters((f) => ({ ...f, doctorId: e.target.value === NO_DOCTOR ? null : e.target.value }))}
              >
                <option value={NO_DOCTOR}>كل الأطباء</option>
                {(doctors.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name_ar}
                  </option>
                ))}
              </select>
              {filters.doctorId && (
                <span className="text-[11px] text-muted-foreground">أرشيف Kizen لا يُفلتر بالطبيب فلا يدخل مع اختيار طبيب.</span>
              )}
            </div>
            {filterFor === "statement" && (
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <Checkbox
                  checked={filters.showWorks !== false}
                  onCheckedChange={(v) => setFilters((f) => ({ ...f, showWorks: v === true }))}
                />
                إظهار الأعمال (الخدمات) تحت كل سند
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFilterFor(null)}>
              إلغاء
            </Button>
            <Button
              onClick={() => {
                const key = filterFor!;
                setFilterFor(null);
                void run([key], false, filters);
              }}
            >
              <Printer className="h-4 w-4" />
              عرض وطباعة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* الملف الموحّد: «ملف المريض» أوّلًا دائمًا، ثمّ الأقسام المختارة */}
      <Dialog open={unifiedOpen} onOpenChange={setUnifiedOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>ملف المريض الموحد</DialogTitle>
            <DialogDescription>«ملف المريض» أوّلًا دائمًا، ثمّ الأقسام المختارة بالترتيب — كلّ قسمٍ في صفحةٍ جديدة.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {unifiedChoices.map((r) => (
              <label key={r.key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={unifiedKeys.includes(r.key)}
                  onCheckedChange={(v) =>
                    setUnifiedKeys((prev) => (v === true ? [...prev, r.key] : prev.filter((k) => k !== r.key)))
                  }
                />
                {r.label}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnifiedOpen(false)}>
              إلغاء
            </Button>
            <Button
              onClick={() => {
                setUnifiedOpen(false);
                // بترتيب القائمة لا بترتيب النقر
                void run(unifiedChoices.map((r) => r.key).filter((k) => unifiedKeys.includes(k)), true);
              }}
            >
              <Printer className="h-4 w-4" />
              معاينة ملف المريض الموحد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ackOpen} onOpenChange={setAckOpen}>
        <DialogContent dir="rtl" className="w-[min(96vw,720px)] max-w-none">
          <DialogHeader>
            <DialogTitle>نصّ إقرار المريض في «ملف المريض»</DialogTitle>
            <DialogDescription>يُطبع تحت الحالة الصحية ويوقّعه المريض. يسري على كل المرضى في المنشأة.</DialogDescription>
          </DialogHeader>
          <Textarea rows={10} value={ackText} onChange={(e) => setAckText(e.target.value)} />
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => void saveAck(null)}>
              استعادة النصّ الافتراضيّ
            </Button>
            <Button onClick={() => void saveAck(ackText)}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

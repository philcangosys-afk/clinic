import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FlaskConical, Pill, Scan, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * طلبات الزيارة — المختبر والأشعة والوصفة، من داخل الزيارة نفسها.
 *
 * لماذا هنا لا في شاشة المختبر/الأشعة/الصيدلية:
 *
 * الأعمدة `lab_orders.visit_id` و`radiology_orders.visit_id`
 * و`prescriptions.visit_id` موجودة منذ 0013/0014/0015، وتعليق 0013 نفسه يقول
 * إنها «حتى يظهر الطلب من داخل شاشة السجل الطبي مستقبلًا». لم يكن في الواجهة
 * كلها سطر واحد يكتب `visit_id`: الطبيب يخرج من الزيارة، يفتح شاشة المختبر،
 * يبحث عن المريض من جديد، ويُنشئ طلبًا معلَّقًا في الهواء. فينكسر ثلاثة أشياء
 * دفعةً واحدة — رحلة المريض لا تعرض طلبات الزيارة، والفاتورة لا تعرف أن هذه
 * الأشعة من هذه الزيارة، ونتيجة المختبر لا تعود إلى السجل الذي طُلبت لأجله.
 *
 * الطلب يُكتب مع الزيارة في نفس عملية الحفظ، بنفس الطبيب ونفس العيادة.
 */

export type PrescriptionDraftItem = {
  key: string;
  drugItemId: string;
  name: string;
  dosage: string;
  frequency: string;
  durationDays: string;
  quantity: number;
  /**
   * جواز استبدال الدواء بمكافئ علمي — `prescription_items.is_substitutable`،
   * عمود قائم منذ 0015 ولم يكن له حقل إدخال ولا عرض. افتراضه `true` في
   * القاعدة، فكل وصفة كانت تُصدر «قابلة للاستبدال» بلا أن يقرّر ذلك أحد.
   * وهناك أدوية لا تُستبدل (هامش علاجي ضيق، حساسية لسواغ بعينه).
   */
  substitutable: boolean;
};

export type VisitOrdersValue = {
  labTestIds: string[];
  radiologyExamIds: string[];
  prescriptionItems: PrescriptionDraftItem[];
  priority: "routine" | "urgent" | "stat";
  labNotes: string;
  clinicalIndication: string;
  prescriptionNotes: string;
};

export const EMPTY_VISIT_ORDERS: VisitOrdersValue = {
  labTestIds: [],
  radiologyExamIds: [],
  prescriptionItems: [],
  priority: "routine",
  labNotes: "",
  clinicalIndication: "",
  prescriptionNotes: "",
};

export function hasAnyOrder(value: VisitOrdersValue) {
  return (
    value.labTestIds.length > 0 ||
    value.radiologyExamIds.length > 0 ||
    value.prescriptionItems.length > 0
  );
}

const PRIORITY_LABELS: Record<VisitOrdersValue["priority"], string> = {
  routine: "عادي",
  urgent: "عاجل",
  stat: "فوري (STAT)",
};

type Catalog = { id: string; name_ar: string; hint: string | null };

function useLabTestCatalog(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["visit-lab-tests", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async (): Promise<Catalog[]> => {
      const { data, error } = await supabase
        .from("lab_tests")
        .select("id, name_ar, specimen_type, is_active")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        id: row.id,
        name_ar: row.name_ar,
        hint: row.specimen_type ?? null,
      }));
    },
  });
}

function useRadiologyExamCatalog(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["visit-radiology-exams", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async (): Promise<Catalog[]> => {
      const { data, error } = await supabase
        .from("radiology_exams")
        .select("id, name_ar, modality, body_part, is_active")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        id: row.id,
        name_ar: row.name_ar,
        hint: [row.modality, row.body_part].filter(Boolean).join(" — ") || null,
      }));
    },
  });
}

/**
 * كتالوج الأدوية: أصناف `items` من نوع `drug` — نفس مصدر شاشة الصيدلية، حتى
 * لا يوجد دواءان بتعريفين مختلفين. `default_dosage_instructions` تُستخدم قيمة
 * أوّلية للجرعة فيوفّر الطبيب كتابتها في الحالة الشائعة.
 */
function useDrugCatalog(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["visit-drug-catalog", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("id, name_ar, drug_details(default_dosage_instructions)")
        .eq("organization_id", organizationId)
        .eq("item_type", "drug")
        .eq("is_disabled", false)
        .eq("is_archived", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []).map((row: any) => {
        const details = Array.isArray(row.drug_details) ? row.drug_details[0] : row.drug_details;
        return {
          id: row.id as string,
          name_ar: row.name_ar as string,
          defaultDosage: (details?.default_dosage_instructions as string | null) ?? "",
        };
      });
    },
  });
}

/**
 * حساسية المريض النشطة — تُقرأ مرّة وتُعرض فوق الوصفة قبل كتابتها.
 *
 * العرض قبل الوصف لا بعده: تحذيرٌ يظهر بعد اختيار الدواء يُقرأ وقد صار
 * الطبيب مقتنعًا به، والمعلومة التي تغيّر القرار تُعرض قبله.
 */
function usePatientAllergies(organizationId: string | undefined, patientId: string | undefined) {
  return useQuery({
    queryKey: ["visit-patient-allergies", organizationId, patientId],
    enabled: Boolean(organizationId && patientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_patient_allergies")
        .select("id, allergen_label, severity_name, reaction, allergen_kind")
        .eq("organization_id", organizationId)
        .eq("patient_id", patientId)
        .eq("status", "active")
        .limit(30);
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        allergen_label: string | null;
        severity_name: string | null;
        reaction: string | null;
        allergen_kind: string;
      }[];
    },
  });
}

type AllergyMatch = {
  allergy_id: string;
  match_kind: "same_item" | "same_generic" | "text_match";
  allergen_label: string | null;
  severity_name: string | null;
  reaction: string | null;
};

const MATCH_LABELS: Record<AllergyMatch["match_kind"], string> = {
  same_item: "نفس الدواء المسجَّلة عليه الحساسية",
  same_generic: "نفس الاسم العلميّ للدواء المسجَّلة عليه الحساسية",
  text_match: "يطابق نصّ المُسبِّب المسجَّل",
};

/**
 * تحذير الحساسية لدواءٍ بعينه.
 *
 * الفحص في القاعدة لا في المتصفّح (`app_check_drug_allergy`, 0155): المطابقة
 * تحتاج `drug_details.generic_name` لصنف الحساسية ولصنف الوصفة معًا، وجلبهما
 * إلى الواجهة لكل دواء يُكتب هدرٌ ومصدر اختلاف بين شاشةٍ وأخرى.
 *
 * **وحدّ الفحص يُقال:** مطابقةٌ بالصنف وبالاسم العلميّ وبالنصّ، لا محرّك
 * تفاعلات متصالبة. غياب التحذير يعني «لا حساسية مسجَّلة»، لا «آمن».
 */
function DrugAllergyWarning({
  organizationId,
  patientId,
  itemId,
}: {
  organizationId: string | undefined;
  patientId: string | undefined;
  itemId: string;
}) {
  const check = useQuery({
    queryKey: ["drug-allergy-check", organizationId, patientId, itemId],
    enabled: Boolean(organizationId && patientId && itemId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_check_drug_allergy", {
        p_organization_id: organizationId,
        p_patient_id: patientId,
        p_item_id: itemId,
      });
      if (error) throw error;
      return (data ?? []) as AllergyMatch[];
    },
  });

  /**
   * فشل الفحص يُعلَن ولا يُبتلع: صمتٌ بعد فشلٍ يُقرأ «لا حساسية»، وهو أسوأ من
   * لا فحص — لأنّه يطمئن.
   */
  if (check.isError) {
    return (
      <p className="rounded-md border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
        تعذّر فحص الحساسية لهذا الدواء: {errorMessage(check.error)} — راجِع قسم
        الحساسية في ملفّ المريض يدويًّا.
      </p>
    );
  }

  const matches = check.data ?? [];
  if (matches.length === 0) return null;

  return (
    <div className="rounded-md border border-rose-400 bg-rose-50 px-2 py-1.5 text-xs text-rose-900 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-100">
      {matches.map((match) => (
        <p key={match.allergy_id} className="flex flex-wrap items-center gap-1">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="font-bold">حساسية مسجَّلة:</span>
          <span>{match.allergen_label ?? "—"}</span>
          {match.severity_name && <span>— {match.severity_name}</span>}
          {match.reaction && <span>— {match.reaction}</span>}
          <span className="text-[11px] opacity-80">({MATCH_LABELS[match.match_kind]})</span>
        </p>
      ))}
    </div>
  );
}

function CatalogMultiSelect({
  items,
  isLoading,
  selected,
  onToggle,
  placeholder,
  emptyHint,
}: {
  items: Catalog[];
  isLoading: boolean;
  selected: string[];
  onToggle: (id: string) => void;
  placeholder: string;
  emptyHint: string;
}) {
  const [term, setTerm] = useState("");
  const filtered = useMemo(() => {
    const needle = term.trim();
    const base = needle ? items.filter((item) => item.name_ar.includes(needle)) : items;
    // المختارة تظهر دائمًا ولو لم تطابق البحث — وإلا اختفت من أمام الطبيب
    // فظنّ أنه ألغاها.
    const selectedItems = items.filter((item) => selected.includes(item.id) && !base.includes(item));
    return [...selectedItems, ...base].slice(0, 40);
  }, [items, term, selected]);

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder={placeholder}
        className="h-8"
      />
      {isLoading && <p className="text-xs text-muted-foreground">جارٍ التحميل...</p>}
      {!isLoading && items.length === 0 && (
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
      )}
      {!isLoading && items.length > 0 && filtered.length === 0 && (
        <p className="text-xs text-muted-foreground">لا نتائج مطابقة.</p>
      )}
      {filtered.length > 0 && (
        <div className="max-h-44 overflow-y-auto rounded-md border bg-background">
          {filtered.map((item) => (
            <label
              key={item.id}
              className="flex cursor-pointer items-center gap-2 border-b px-2 py-1.5 text-sm last:border-b-0 hover:bg-muted/50"
            >
              <Checkbox
                checked={selected.includes(item.id)}
                onCheckedChange={() => onToggle(item.id)}
              />
              <span className="min-w-0 flex-1 truncate">{item.name_ar}</span>
              {item.hint && (
                <span className="shrink-0 text-xs text-muted-foreground">{item.hint}</span>
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function VisitOrders({
  organizationId,
  patientId,
  value,
  onChange,
}: {
  organizationId: string | undefined;
  /** بدونه لا يُفحص دواءٌ ضدّ حساسية — والغياب يُعلَن على الشاشة لا يُسكَت عنه. */
  patientId?: string | null;
  value: VisitOrdersValue;
  onChange: (next: VisitOrdersValue) => void;
}) {
  const labTests = useLabTestCatalog(organizationId);
  const radiologyExams = useRadiologyExamCatalog(organizationId);
  const drugs = useDrugCatalog(organizationId);
  const allergies = usePatientAllergies(organizationId, patientId ?? undefined);
  const [drugTerm, setDrugTerm] = useState("");

  const patch = (next: Partial<VisitOrdersValue>) => onChange({ ...value, ...next });

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];

  const drugResults = useMemo(() => {
    const needle = drugTerm.trim();
    if (!needle) return [];
    return (drugs.data ?? []).filter((drug) => drug.name_ar.includes(needle)).slice(0, 8);
  }, [drugs.data, drugTerm]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>الطلبات والوصفة</Label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">الأولوية</span>
          <Select
            value={value.priority}
            onValueChange={(next) => patch({ priority: next as VisitOrdersValue["priority"] })}
          >
            <SelectTrigger className="h-8 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        ما يُطلب هنا يُربط بهذه الزيارة، فيظهر في رحلة المريض وفي شاشتَي المختبر والأشعة
        وفي الصيدلية — بلا إعادة بحث عن المريض.
      </p>

      {/* المختبر */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FlaskConical className="h-4 w-4 text-primary" />
          فحوص المختبر
          {value.labTestIds.length > 0 && <Badge variant="secondary">{value.labTestIds.length}</Badge>}
        </div>
        <CatalogMultiSelect
          items={labTests.data ?? []}
          isLoading={labTests.isLoading}
          selected={value.labTestIds}
          onToggle={(id) => patch({ labTestIds: toggle(value.labTestIds, id) })}
          placeholder="ابحث عن فحص مخبري..."
          emptyHint="لا توجد فحوص مخبرية معرّفة — تُضاف من شاشة المختبر."
        />
        {value.labTestIds.length > 0 && (
          <Textarea
            className="mt-1"
            rows={2}
            placeholder="ملاحظات لطلب المختبر (اختياري)"
            value={value.labNotes}
            onChange={(event) => patch({ labNotes: event.target.value })}
          />
        )}
      </div>

      {/* الأشعة */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Scan className="h-4 w-4 text-primary" />
          فحوص الأشعة
          {value.radiologyExamIds.length > 0 && (
            <Badge variant="secondary">{value.radiologyExamIds.length}</Badge>
          )}
        </div>
        <CatalogMultiSelect
          items={radiologyExams.data ?? []}
          isLoading={radiologyExams.isLoading}
          selected={value.radiologyExamIds}
          onToggle={(id) => patch({ radiologyExamIds: toggle(value.radiologyExamIds, id) })}
          placeholder="ابحث عن فحص أشعة..."
          emptyHint="لا توجد فحوص أشعة معرّفة — تُضاف من شاشة الأشعة."
        />
        {value.radiologyExamIds.length > 0 && (
          <Textarea
            className="mt-1"
            rows={2}
            placeholder="السبب السريري للطلب — يوجّه الأخصائي أثناء القراءة"
            value={value.clinicalIndication}
            onChange={(event) => patch({ clinicalIndication: event.target.value })}
          />
        )}
      </div>

      {/* الوصفة */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Pill className="h-4 w-4 text-primary" />
          الوصفة الطبية
          {value.prescriptionItems.length > 0 && (
            <Badge variant="secondary">{value.prescriptionItems.length}</Badge>
          )}
        </div>

        {/* ما يعرفه النظام عن حساسية هذا المريض — قبل كتابة الوصفة لا بعدها */}
        {!patientId && (
          <p className="rounded-md border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
            لم يُحدَّد المريض بعد، فلا يُفحص دواءٌ ضدّ الحساسية.
          </p>
        )}
        {patientId && allergies.isError && (
          <p className="rounded-md border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
            تعذّر قراءة حساسية المريض: {errorMessage(allergies.error)}
          </p>
        )}
        {patientId && allergies.isSuccess && (allergies.data ?? []).length > 0 && (
          <div className="rounded-md border border-rose-400 bg-rose-50 px-2 py-1.5 text-xs text-rose-900 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-100">
            <span className="font-bold">حساسية نشطة: </span>
            {(allergies.data ?? [])
              .map((row) =>
                [row.allergen_label ?? "—", row.severity_name].filter(Boolean).join(" — "),
              )
              .join(" • ")}
          </div>
        )}
        {patientId && allergies.isSuccess && (allergies.data ?? []).length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            لا حساسية مسجَّلة لهذا المريض — وخلوّ السجلّ ليس نفيًا: يعني أنّ أحدًا
            لم يسأل بعد.
          </p>
        )}

        <div className="relative">
          <Input
            className="h-8"
            value={drugTerm}
            onChange={(event) => setDrugTerm(event.target.value)}
            placeholder="ابحث عن دواء لإضافته للوصفة..."
          />
          {drugResults.length > 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-lg">
              {drugResults.map((drug) => (
                <button
                  key={drug.id}
                  type="button"
                  className="flex w-full items-center px-3 py-1.5 text-start text-sm hover:bg-muted"
                  onClick={() => {
                    setDrugTerm("");
                    // الدواء نفسه مرتين في وصفة واحدة خطأ إدخال لا نيّة: يُتجاهل.
                    if (value.prescriptionItems.some((entry) => entry.drugItemId === drug.id)) return;
                    patch({
                      prescriptionItems: [
                        ...value.prescriptionItems,
                        {
                          key: `${drug.id}-${Date.now()}`,
                          drugItemId: drug.id,
                          name: drug.name_ar,
                          dosage: drug.defaultDosage,
                          frequency: "",
                          durationDays: "",
                          quantity: 1,
                          substitutable: true,
                        },
                      ],
                    });
                  }}
                >
                  {drug.name_ar}
                </button>
              ))}
            </div>
          )}
        </div>
        {value.prescriptionItems.length > 0 && (
          <div className="flex flex-col gap-2 rounded-md border bg-background p-2">
            {value.prescriptionItems.map((entry) => (
              <div key={entry.key} className="flex flex-col gap-1.5 rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.name}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      patch({
                        prescriptionItems: value.prescriptionItems.filter(
                          (candidate) => candidate.key !== entry.key,
                        ),
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Input
                    className="h-8"
                    placeholder="الجرعة"
                    value={entry.dosage}
                    onChange={(event) =>
                      patch({
                        prescriptionItems: value.prescriptionItems.map((candidate) =>
                          candidate.key === entry.key
                            ? { ...candidate, dosage: event.target.value }
                            : candidate,
                        ),
                      })
                    }
                  />
                  <Input
                    className="h-8"
                    placeholder="التكرار (مرتين يوميًا)"
                    value={entry.frequency}
                    onChange={(event) =>
                      patch({
                        prescriptionItems: value.prescriptionItems.map((candidate) =>
                          candidate.key === entry.key
                            ? { ...candidate, frequency: event.target.value }
                            : candidate,
                        ),
                      })
                    }
                  />
                  <Input
                    className="h-8"
                    type="number"
                    min={1}
                    placeholder="المدة (أيام)"
                    value={entry.durationDays}
                    onChange={(event) =>
                      patch({
                        prescriptionItems: value.prescriptionItems.map((candidate) =>
                          candidate.key === entry.key
                            ? { ...candidate, durationDays: event.target.value }
                            : candidate,
                        ),
                      })
                    }
                  />
                  <Input
                    className="h-8"
                    type="number"
                    min={1}
                    placeholder="الكمية"
                    value={entry.quantity}
                    onChange={(event) =>
                      patch({
                        prescriptionItems: value.prescriptionItems.map((candidate) =>
                          candidate.key === entry.key
                            ? { ...candidate, quantity: Math.max(Number(event.target.value) || 1, 1) }
                            : candidate,
                        ),
                      })
                    }
                  />
                </div>
                <DrugAllergyWarning
                  organizationId={organizationId}
                  patientId={patientId ?? undefined}
                  itemId={entry.drugItemId}
                />
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={entry.substitutable}
                    onCheckedChange={(checked) =>
                      patch({
                        prescriptionItems: value.prescriptionItems.map((candidate) =>
                          candidate.key === entry.key
                            ? { ...candidate, substitutable: checked === true }
                            : candidate,
                        ),
                      })
                    }
                  />
                  يجوز للصيدلي استبداله بمكافئ علمي
                </label>
              </div>
            ))}
            <Textarea
              rows={2}
              placeholder="ملاحظات الوصفة (اختياري)"
              value={value.prescriptionNotes}
              onChange={(event) => patch({ prescriptionNotes: event.target.value })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

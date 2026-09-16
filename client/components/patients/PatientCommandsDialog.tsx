import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  CalendarPlus,
  FileSignature,
  FileStack,
  Image as ImageIcon,
  MessageSquare,
  Pencil,
  Receipt,
  ReceiptText,
  StickyNote,
  Stethoscope,
  UserRound,
  Wallet,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { formatAmount } from "@/lib/locale";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * أوامر على ملفّ المريض — لوحةٌ واحدة لكل ما يُفعل بالمريض من أيّ شاشة.
 *
 * **العيب الذي تعالجه:** الأوامر نفسها كانت موزَّعة: «إصدار فاتورة» في رأس
 * الملفّ، و«عرض الفواتير» في الشريط الجانبي، و«حجز موعد» في الاستقبال،
 * و«الاتفاقيات» في قسم آخر. فمن يقف على صفّ مريض — في الطابور أو في جدول
 * المواعيد — لا يجد أمرًا واحدًا في مكانه، فيتنقّل بين ثلاث شاشات ليؤدّي
 * عملًا واحدًا.
 *
 * كل أمرٍ هنا **يذهب إلى شاشةٍ قائمة أو يفتح نافذةً قائمة**. ولا يوجد في هذه
 * اللوحة زرٌّ يعرض رسالة «قريبًا» ولا زرٌّ بلا وجهة: زرٌّ لا يعمل أسوأ من زرٍّ
 * غير موجود، لأنّه يَعِد ثم يُخلف.
 *
 * ### الرسائل النصّية
 * أمرَا «إرسال رسالة نصية للعميل» و«عرض أرشيف الرسائل» في النظام المرجعيّ
 * **غير منفَّذين هنا عن قصد**: قرار المالك القائم ألّا يُنفَّذ شيءٌ يخصّ
 * الرسائل النصّية ولا يُضاف لها تكامل حتى إشعارٍ آخر. ويظهران في اللوحة
 * معطَّلين بسببهما مكتوبًا — لا يُحذفان فيُظنّ أنّهما نُسيا، ولا يُفعَّلان
 * فيُخالَف القرار.
 */

export type PatientCommandsTarget = {
  id: string;
  name_ar: string;
  file_number: number | string | null;
  block_file?: boolean | null;
  block_invoices?: boolean | null;
  block_appointments?: boolean | null;
};

type CommandDef = {
  key: string;
  label: string;
  icon: typeof UserRound;
  run?: () => void;
  /** سبب التعطيل — يُعرض تحت الاسم. الأمر المعطَّل لا يُخفى. */
  disabledReason?: string | null;
};

export function usePatientOpenAgreements(patientId: string | null | undefined) {
  const { organization } = useOrganizationAccess();
  return useQuery({
    queryKey: ["patient-open-agreements", organization?.id, patientId],
    enabled: Boolean(organization?.id && patientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_patient_open_agreements")
        .select("open_count, remaining_total")
        // RLS يسمح بكل مؤسّسة ينتمي إليها المستخدم لا بالنشطة وحدها
        .eq("organization_id", organization?.id)
        .eq("patient_id", patientId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as { open_count: number; remaining_total: number } | null;
    },
  });
}

export default function PatientCommandsDialog({
  patient,
  open,
  onOpenChange,
  onNewInvoice,
  onNewQuote,
  onSendToDoctor,
}: {
  patient: PatientCommandsTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * فتح نافذة الفاتورة **فوق الشاشة الحالية** حين تكون متاحة (ملفّ المريض).
   * إن لم تُمرَّر، يُنتقل إلى شاشة الفواتير بمعرّف المريض — والنتيجة واحدة.
   */
  onNewInvoice?: () => void;
  onNewQuote?: () => void;
  onSendToDoctor?: () => void;
}) {
  const navigate = useNavigate();
  const agreements = usePatientOpenAgreements(open ? patient?.id : null);

  if (!patient) return null;

  const go = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };
  const act = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  const fileBlocked = patient.block_file ? "الملفّ محجوب بالكامل" : null;

  const commands: CommandDef[] = [
    {
      key: "profile",
      label: "فتح الملفّ الشخصي",
      icon: UserRound,
      run: () => go(`/patients/${patient.id}?section=overview`),
    },
    {
      key: "new-appointment",
      label: "موعد جديد",
      icon: CalendarPlus,
      disabledReason:
        fileBlocked ?? (patient.block_appointments ? "المريض محجوب عن حجز المواعيد" : null),
      run: () => go(`/appointments?patientId=${patient.id}&new=1`),
    },
    {
      key: "appointments",
      label: "عرض المواعيد",
      icon: CalendarDays,
      run: () => go(`/patients/${patient.id}?section=appointments`),
    },
    {
      key: "new-invoice",
      label: "فاتورة جديدة",
      icon: Receipt,
      disabledReason: fileBlocked ?? (patient.block_invoices ? "المريض محجوب عن الفوترة" : null),
      run: onNewInvoice
        ? () => act(onNewInvoice)
        : () => go(`/billing?patientId=${patient.id}`),
    },
    {
      key: "invoices",
      label: "عرض الفواتير",
      icon: Wallet,
      run: () => go(`/patients/${patient.id}?section=invoices`),
    },
    {
      key: "send-to-doctor",
      label: "إرسال المريض إلى الطبيب",
      icon: Stethoscope,
      disabledReason:
        fileBlocked ?? (patient.block_appointments ? "المريض محجوب عن حجز المواعيد" : null),
      // شاشة الاستقبال لا تعرف معامل `patientId`، والوجهة الصحيحة هي ملفّ
      // المريض الذي فيه نافذة الإرسال نفسها — يُفتح عليها مباشرةً.
      run: onSendToDoctor
        ? () => act(onSendToDoctor)
        : () => go(`/patients/${patient.id}?action=send-to-doctor`),
    },
    {
      key: "sms-send",
      label: "إرسال رسالة نصّية للعميل",
      icon: MessageSquare,
      disabledReason: "الرسائل النصّية موقوفة بقرار المالك حتى إشعار آخر",
    },
    {
      key: "sms-archive",
      label: "عرض أرشيف الرسائل للعميل",
      icon: MessageSquare,
      disabledReason: "الرسائل النصّية موقوفة بقرار المالك حتى إشعار آخر",
    },
    {
      key: "images",
      label: "صور الملفّ",
      icon: ImageIcon,
      run: () => go(`/patients/${patient.id}?section=images`),
    },
    {
      key: "signatures",
      label: "توقيع الملفّ الإلكتروني",
      icon: Pencil,
      run: () => go(`/patients/${patient.id}?section=signatures`),
    },
    {
      key: "documents",
      label: "مستندات الملفّ",
      icon: FileStack,
      run: () => go(`/patients/${patient.id}?section=documents`),
    },
    {
      key: "new-quote",
      label: "فاتورة مؤقّتة — عرض سعر",
      icon: ReceiptText,
      disabledReason: fileBlocked ?? (patient.block_invoices ? "المريض محجوب عن الفوترة" : null),
      run: onNewQuote
        ? () => act(onNewQuote)
        : () => go(`/billing?patientId=${patient.id}&quote=new`),
    },
    {
      key: "quotes",
      label: "الفواتير المؤقّتة — عروض الأسعار",
      icon: ReceiptText,
      run: () => go(`/billing?patientId=${patient.id}&quote=list`),
    },
    {
      key: "agreements",
      label: "الاتفاقيات",
      icon: FileSignature,
      run: () => go(`/patients/${patient.id}?section=agreements`),
    },
    {
      key: "notes",
      label: "ملاحظات المريض",
      icon: StickyNote,
      run: () => go(`/patients/${patient.id}?section=notes`),
    },
  ];

  const open_ = agreements.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>أوامر على ملفّ المريض</DialogTitle>
          <DialogDescription>
            {patient.name_ar}
            {patient.file_number !== null && patient.file_number !== undefined
              ? ` · ملف ${patient.file_number}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5 sm:grid-cols-2">
          {commands.map((command) => {
            const Icon = command.icon;
            const disabled = Boolean(command.disabledReason) || !command.run;
            return (
              <button
                key={command.key}
                type="button"
                disabled={disabled}
                onClick={command.run}
                className="flex items-start gap-2 rounded-md border px-3 py-2 text-start text-sm transition hover:border-primary/50 hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-transparent"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex flex-col">
                  <span className="font-medium">{command.label}</span>
                  {command.disabledReason && (
                    <span className="text-[11px] leading-tight text-muted-foreground">
                      {command.disabledReason}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* تنبيه الاتفاقيات — نظير سؤال النظام المرجعيّ في ذيل القائمة. لا
            يُعرض إلا إذا كان عليه اتفاقياتٌ فعلًا، ويُفتح على الشاشة نفسها. */}
        {agreements.isError && (
          <p className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            تعذّرت قراءة الاتفاقيات: {errorMessage(agreements.error)} — إن لم تُنفَّذ
            الترقية <span className="font-mono">0162</span> على القاعدة بعد، نفِّذها.
          </p>
        )}
        {open_ && open_.open_count > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/30">
            <span>
              على العميل {formatAmount(open_.open_count)} اتفاقية عليها متبقٍّ بمجموع{" "}
              <span className="font-semibold tabular-nums">
                {formatAmount(open_.remaining_total)} ر.س
              </span>
              . هل تريد عرض هذه الاتفاقيات؟
            </span>
            <Button size="sm" onClick={() => go(`/patients/${patient.id}?section=agreements`)}>
              عرض الاتفاقيات
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

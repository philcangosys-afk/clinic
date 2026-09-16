# -*- coding: utf-8 -*-
"""كثافة شاشة الطابور، ورقم هوية المريض في نافذة الفاتورة."""
import sys


def patch(path, edits):
    raw = open(path, "rb").read()
    nl = "\r\n" if b"\r\n" in raw else "\n"
    src = raw.decode("utf-8").replace("\r\n", "\n")
    for old, new, label in edits:
        if src.count(old) != 1:
            sys.exit("ANCHOR %s in %s: count=%d" % (label, path, src.count(old)))
        src = src.replace(old, new, 1)
    open(path, "wb").write(src.replace("\n", nl).encode("utf-8"))
    print("%s: patched (EOL=%s)" % (path, "CRLF" if nl == "\r\n" else "LF"))


# ══════════════════════════════════════════════════════════════════════════
# 1) كثافة الطابور
#
# أربعة وعشرون عمودًا بحشو `px-3 py-2.5` الافتراضيّ تُنتج صفًّا بارتفاع ~56
# بكسل: سبعة مرضى يملؤون الشاشة، والاستقبال يمرّر عموديًّا ليرى طابورًا.
# والشاشة المرجعيّة تُظهر خمسةً وعشرين صفًّا في المساحة نفسها.
#
# الحشو يُضبَط على **الجدول كلّه** بمُحدِّدات Tailwind على الأبناء، لا على كل
# خلية: أربع وعشرون خليةً × حشوٌ مكتوبٌ فيها كلٌّ على حدة هو أربعة وعشرون
# موضعًا يفترق أحدها عن البقيّة عند أوّل تعديل.
# ══════════════════════════════════════════════════════════════════════════
patch(
    "client/components/reception/ReceptionBoard.tsx",
    [
        (
            """        <div className="overflow-x-auto rounded-lg border">
          <Table>""",
            """        <div
          className={
            "overflow-x-auto rounded-lg border text-xs " +
            // الصفّ الواحد: سطرٌ واحد لا يلتفّ، وحشوٌ ضيّق، وخطٌّ أصغر.
            "[&_td]:px-1.5 [&_td]:py-1 [&_td]:align-middle [&_th]:px-1.5 [&_th]:py-1.5 " +
            "[&_td]:text-xs [&_th]:text-[11px] [&_td]:leading-tight [&_th]:leading-tight " +
            // الشارات داخل الجدول تتقلّص معه، وإلّا فرضت هي ارتفاع الصفّ.
            "[&_td_.badge]:text-[10px]"
          }
        >
          <Table>""",
            "table-density",
        ),
        # خلية المريض كانت ثلاثة أسطر (الاسم، الملفّ والجوال، الشارات) فترفع
        # الصفّ وحدها. رقم الملفّ صار عمودًا مستقلًّا في 0161، فلا يُكرَّر هنا.
        (
            """                      <div className="font-medium hover:text-primary">{row.patient_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[row.file_number && `ملف ${row.file_number}`, row.mobile_number]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </button>
                    {(row.medical_alert || row.blood_type) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {row.blood_type && (
                          <Badge variant="outline" className="text-[10px]">
                            {row.blood_type}
                          </Badge>
                        )}
                        {row.medical_alert && (
                          <Badge variant="destructive" className="max-w-[12rem] truncate text-[10px]">
                            {row.medical_alert}
                          </Badge>
                        )}
                      </div>
                    )}""",
            """                      <span className="flex flex-wrap items-center gap-1">
                        <span className="font-medium hover:text-primary">{row.patient_name}</span>
                        {row.blood_type && (
                          <Badge variant="outline" className="px-1 py-0 text-[10px]">
                            {row.blood_type}
                          </Badge>
                        )}
                        {/* التنبيه الطبّي يُقتطع ولا يُلفّ: سطرٌ ثانٍ في خليةٍ
                            واحدة يرفع ارتفاع الصفّ كلّه، والنصّ كامل في
                            التلميح عند الوقوف عليه. */}
                        {row.medical_alert && (
                          <Badge
                            variant="destructive"
                            title={row.medical_alert}
                            className="max-w-[9rem] truncate px-1 py-0 text-[10px]"
                          >
                            {row.medical_alert}
                          </Badge>
                        )}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {row.mobile_number ?? ""}
                      </span>
                    </button>""",
            "patient-cell",
        ),
        # خلية الإجراءات: ستّة أزرار بحجمها الافتراضيّ تفرض ارتفاعًا لا يقلّ
        # عن ٣٦ بكسل مهما ضاق الحشو حولها.
        (
            """                  <TableCell>
                    <div className="flex flex-wrap gap-1">""",
            """                  <TableCell>
                    <div className="flex flex-wrap gap-0.5 [&_button]:h-6 [&_button]:px-1.5 [&_button]:text-[11px] [&_svg]:h-3 [&_svg]:w-3">""",
            "actions-cell",
        ),
        # عنوان مجموعة الطبيب: سطرٌ فاصل لا بطاقة.
        (
            """                    <TableCell colSpan={QUEUE_COLUMN_COUNT} className="py-1.5 text-sm font-bold">""",
            """                    <TableCell colSpan={QUEUE_COLUMN_COUNT} className="!py-0.5 text-[11px] font-bold">""",
            "group-row",
        ),
    ],
)


# ══════════════════════════════════════════════════════════════════════════
# 2) رقم الهوية يتبع المريض المختار
#
# الحقل كان حالةً يدويّة بحتة: `setIdNumber` لا تُستدعى في أيّ موضع غير
# الكتابة اليدوية. فمن اختار مريضًا لم يُجلب رقم هويته، ومن بدّل المريض بقي
# أمامه رقم هوية المريض السابق — ويُحفظ على الفاتورة الجديدة.
#
# **الجلب عند تغيّر المريض لا عند كل جلب:** الكتابة فوق ما كتبه الموظّف
# يدويًّا لهذا المريض نفسه تمحو عمله أمام عينيه. والمرجع هو معرّف المريض
# الذي جُلب له آخر مرّة.
# ══════════════════════════════════════════════════════════════════════════
patch(
    "client/components/billing/NewInvoiceDialog.tsx",
    [
        (
            'import { useEffect, useMemo, useState } from "react";',
            'import { useEffect, useMemo, useRef, useState } from "react";',
            "react-import",
        ),
        (
            """        .select("source_value_id, customer_type_value_id")""",
            """        .select("id, source_value_id, customer_type_value_id, id_number")""",
            "context-select",
        ),
        (
            """      return (data ?? null) as
        | { source_value_id: string | null; customer_type_value_id: string | null }
        | null;""",
            """      return (data ?? null) as
        | {
            id: string;
            source_value_id: string | null;
            customer_type_value_id: string | null;
            id_number: string | null;
          }
        | null;""",
            "context-type",
        ),
        (
            """  useEffect(() => {
    const row = patientContext.data;
    if (!row) return;
    setSourceValueId((current) => current || row.source_value_id || "");
    setClassificationValueId((current) => current || row.customer_type_value_id || "");
  }, [patientContext.data]);""",
            """  useEffect(() => {
    const row = patientContext.data;
    if (!row) return;
    setSourceValueId((current) => current || row.source_value_id || "");
    setClassificationValueId((current) => current || row.customer_type_value_id || "");
  }, [patientContext.data]);

  /**
   * رقم هوية المريض المختار.
   *
   * يُكتب **مرّةً لكل مريض**: اختيارُ مريضٍ يجلب هويّته، وتبديلُ المريض يجلب
   * هويّة الجديد ويمحو القديمة — وبقاؤها كان يضع هوية مريضٍ على فاتورة
   * مريضٍ آخر. أمّا ما يكتبه الموظّف يدويًّا لهذا المريض نفسه فيبقى، لأنّ
   * المرجع هو **تغيّر المريض** لا وصول البيانات.
   *
   * ولا طول مفروض على الحقل: منشآتٌ تُسجّل إقاماتٍ وجوازاتٍ تتجاوز عشرة
   * أرقام، ورفضُها يمنع فوترة مريضٍ حاضر.
   */
  const lastIdPatient = useRef<string | null>(null);
  useEffect(() => {
    const row = patientContext.data;
    if (!row) return;
    if (lastIdPatient.current === row.id) return;
    lastIdPatient.current = row.id;
    setIdNumber(row.id_number ?? "");
  }, [patientContext.data]);

  // إزالة المريض تُخلي الحقل: رقمُ هويةٍ بلا صاحبٍ على الشاشة يُحفظ على
  // أوّل مريضٍ يُختار بعده.
  useEffect(() => {
    if (patient?.id) return;
    lastIdPatient.current = null;
    setIdNumber("");
  }, [patient?.id]);""",
            "id-prefill",
        ),
    ],
)

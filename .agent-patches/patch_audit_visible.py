# -*- coding: utf-8 -*-
"""اسم المنظور مكتوبٌ حرفيًّا في `.from(...)` ليراه مدقّق الاكتمال.

`﻿.from(scopedDoctorId ? "v_doctor_patients" : "patients")` صحيحٌ وقت التشغيل،
لكنّ `completeness-audit.py` يمسح `from("NAME")` حرفيًّا — فأعلن المنظور
«ميتًا» وهو مستعمَل. ومدقّقٌ يُبلّغ بلاغًا كاذبًا يُفقِد الثقة ببلاغاته
الصادقة، ويجعل من يقرؤه لاحقًا يحذف منظورًا يعمل.
"""
import sys

PATH = "client/pages/Patients.tsx"
raw = open(PATH, "rb").read()
NL = "\r\n" if b"\r\n" in raw else "\n"
src = raw.decode("utf-8").replace("\r\n", "\n")

OLD = '''    queryFn: async () => {
      let query = supabase
        .from(scopedDoctorId ? "v_doctor_patients" : "patients")
        .select(
          "id, file_number, name_ar, name_en, mobile_number, gender, birth_date, id_number, file_date, block_appointments, block_invoices, block_file, block_sms, insurance_company_name",
        )
        .eq("organization_id", organizationId);
      if (scopedDoctorId) query = query.eq("doctor_id", scopedDoctorId);
      query = query'''

NEW = '''    queryFn: async () => {
      // الفرعان مكتوبان صراحةً لا باسمٍ محسوب: مدقّق الاكتمال يمسح
      // `from("NAME")` حرفيًّا، واسمٌ داخل شرطٍ ثلاثيّ يجعله يُعلن المنظور
      // ميتًا وهو مستعمَل.
      let query = scopedDoctorId
        ? supabase
            .from("v_doctor_patients")
            .select(PATIENT_LIST_COLUMNS)
            .eq("organization_id", organizationId)
            .eq("doctor_id", scopedDoctorId)
        : supabase
            .from("patients")
            .select(PATIENT_LIST_COLUMNS)
            .eq("organization_id", organizationId);
      query = query'''

if src.count(OLD) != 1:
    sys.exit("ANCHOR patients-source: count=%d" % src.count(OLD))
src = src.replace(OLD, NEW, 1)

# ثابت الأعمدة — مكتوبٌ مرّةً لا في فرعين يفترقان
COLS_OLD = "function usePatientsList("
COLS_NEW = '''/** أعمدة قائمة المرضى — مشتركة بين مصدرَي القراءة فلا يفترق أحدهما. */
const PATIENT_LIST_COLUMNS =
  "id, file_number, name_ar, name_en, mobile_number, gender, birth_date, id_number, " +
  "file_date, block_appointments, block_invoices, block_file, block_sms, insurance_company_name";

function usePatientsList('''
if src.count(COLS_OLD) != 1:
    sys.exit("ANCHOR cols: count=%d" % src.count(COLS_OLD))
src = src.replace(COLS_OLD, COLS_NEW, 1)

open(PATH, "wb").write(src.replace("\n", NL).encode("utf-8"))
print("%s: patched (EOL=%s)" % (PATH, "CRLF" if NL == "\r\n" else "LF"))

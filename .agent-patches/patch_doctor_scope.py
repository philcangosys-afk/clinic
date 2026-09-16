# -*- coding: utf-8 -*-
"""حصر المرضى والمواعيد على الطبيب الداخل بصفته."""
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


SCOPE_BANNER = """      {unresolvedDoctor && (
        <p className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          الصفة «طبيب» ولم يُعرف أيّ طبيبٍ أنت: لا حساب مربوط بسجلّ طبيب
          (<span className="font-mono">doctors.user_id</span>) ولا طبيبٌ مختار في
          شاشة الصفة. القائمة تعرض الكلّ — وهي ليست قائمتك.
        </p>
      )}
"""

# ══════════════════════════════════════════════════════════════════════════
# 1) شاشة المرضى
# ══════════════════════════════════════════════════════════════════════════
patch(
    "client/pages/Patients.tsx",
    [
        (
            """function usePatientsList(
  organizationId: string | undefined,
  search: string,
  searchScopes: PatientSearchScope[],
  filters: Filters,
) {
  return useQuery({
    queryKey: ["patients-list", organizationId, search, searchScopes.join("+"), filters],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("patients")
        .select(
          "id, file_number, name_ar, name_en, mobile_number, gender, birth_date, id_number, file_date, block_appointments, block_invoices, block_file, block_sms, insurance_company_name",
        )
        .eq("organization_id", organizationId)""",
            """function usePatientsList(
  organizationId: string | undefined,
  search: string,
  searchScopes: PatientSearchScope[],
  filters: Filters,
  /**
   * حصرُ القائمة على مرضى طبيبٍ بعينه.
   *
   * حين يُمرَّر، تُقرأ القائمة من `v_doctor_patients` (0164) بدل جدول
   * `patients`: المنظور يُعرّف «مريض الطبيب» بالعلاقات الأربع التي حدّدها
   * المالك — المعالج، والمشارك، وصاحب الموعد، وصاحب الزيارة — ويعطي صفًّا
   * لكل زوج (طبيب، مريض). والأعمدة نفسها لأنّ المنظور يمرّر `patients.*`،
   * فلا يتغيّر شيءٌ في بقيّة الشاشة.
   *
   * ولا يُطبَّق الحصر في المتصفّح: القائمة محدودة بسقفٍ من الصفوف، فترشيحُ
   * الظاهر منها يترك الطبيب يرى «لا نتائج» ومريضه في الصفحة التالية.
   */
  scopedDoctorId?: string | null,
) {
  return useQuery({
    queryKey: [
      "patients-list",
      organizationId,
      search,
      searchScopes.join("+"),
      filters,
      scopedDoctorId ?? "",
    ],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from(scopedDoctorId ? "v_doctor_patients" : "patients")
        .select(
          "id, file_number, name_ar, name_en, mobile_number, gender, birth_date, id_number, file_date, block_appointments, block_invoices, block_file, block_sms, insurance_company_name",
        )
        .eq("organization_id", organizationId);
      if (scopedDoctorId) query = query.eq("doctor_id", scopedDoctorId);
      query = query""",
            "patients-query",
        ),
        (
            """  const patients = usePatientsList(organization?.id, search, searchScopes, filters);""",
            """  const { doctorId: scopeDoctorId, isDoctorScope, unresolvedDoctor } = useSessionDoctor();
  const patients = usePatientsList(
    organization?.id,
    search,
    searchScopes,
    filters,
    isDoctorScope ? scopeDoctorId : null,
  );""",
            "patients-call",
        ),
    ],
)


# ══════════════════════════════════════════════════════════════════════════
# 2) شاشة المواعيد
# ══════════════════════════════════════════════════════════════════════════
patch(
    "client/pages/Appointments.tsx",
    [
        (
            """function useRangeAppointments(organizationId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: ["appointments-day", organizationId, from, to],
    enabled: Boolean(organizationId),""",
            """function useRangeAppointments(
  organizationId: string | undefined,
  from: string,
  to: string,
  /**
   * حصرُ الجدول على طبيبٍ بعينه حين يدخل الموظّف بصفة «الطبيب».
   *
   * الحصر في **الاستعلام** لا في المتصفّح: الجدول محدود بسقفٍ من الصفوف
   * (`APPOINTMENT_ROW_LIMIT`)، فترشيحُ الظاهر منه يجعل الطبيب يرى يومًا
   * ناقصًا في عيادةٍ مزدحمة — ويظنّه يومه كاملًا.
   */
  doctorId?: string | null,
) {
  return useQuery({
    queryKey: ["appointments-day", organizationId, from, to, doctorId ?? ""],
    enabled: Boolean(organizationId),""",
            "range-signature",
        ),
        (
            """      const { data, error, count } = await supabase
        .from("appointments")
        .select(""",
            """      let query = supabase
        .from("appointments")
        .select(""",
            "range-head",
        ),
        (
            """        .eq("organization_id", organizationId)
        .gte("scheduled_start", bounds.from ?? `${from}T00:00:00`)""",
            """        .eq("organization_id", organizationId);
      // صفة الطبيب: يومه هو، لا يوم العيادة كلّها
      if (doctorId) query = query.eq("doctor_id", doctorId);
      const { data, error, count } = await query
        .gte("scheduled_start", bounds.from ?? `${from}T00:00:00`)""",
            "range-filter",
        ),
        (
            """  const appointments = useRangeAppointments(organization?.id, rangeFrom, rangeTo);""",
            """  const {
    doctorId: scopeDoctorId,
    isDoctorScope,
    unresolvedDoctor,
  } = useSessionDoctor();
  const appointments = useRangeAppointments(
    organization?.id,
    rangeFrom,
    rangeTo,
    isDoctorScope ? scopeDoctorId : null,
  );""",
            "range-call",
        ),
    ],
)


# ══════════════════════════════════════════════════════════════════════════
# 3) الاستيرادات وقوائم الأطباء والتنبيه
# ══════════════════════════════════════════════════════════════════════════
patch(
    "client/pages/Patients.tsx",
    [
        (
            'import { supabase } from "@/lib/supabase";',
            'import { supabase } from "@/lib/supabase";\nimport { useSessionDoctor } from "@/lib/session-doctor";',
            "patients-import",
        ),
    ],
)

patch(
    "client/pages/Appointments.tsx",
    [
        (
            'import { useMemberNames } from "@/lib/member-names";',
            'import { useMemberNames } from "@/lib/member-names";\nimport { useSessionDoctor } from "@/lib/session-doctor";',
            "appt-import",
        ),
        # قائمة الأطباء المعروضة: الطبيب وحده حين تُحصر الشاشة — فتتبعها
        # أعمدة التقويم ومرشّح الطبيب وبطاقات الأطباء بلا تعديلٍ في كلٍّ منها.
        (
            """  const byDoctor = useMemo(() => {
    const map = new Map<string, AppointmentWithRelations[]>();
    (doctors.data ?? []).forEach((doctor) => map.set(doctor.id, []));""",
            """  /**
   * الأطباء المعروضون. حين تُحصر الشاشة على طبيب، تُحصر معها **قائمة
   * الأطباء** لا المواعيد وحدها: وإلّا بقيت أعمدة التقويم ومرشّح الطبيب
   * وبطاقات الزملاء معروضةً فارغة، فيظنّ الطبيب أنّ زملاءه بلا مواعيد اليوم.
   */
  const visibleDoctors = useMemo(
    () =>
      isDoctorScope && scopeDoctorId
        ? (doctors.data ?? []).filter((doctor) => doctor.id === scopeDoctorId)
        : (doctors.data ?? []),
    [doctors.data, isDoctorScope, scopeDoctorId],
  );

  const byDoctor = useMemo(() => {
    const map = new Map<string, AppointmentWithRelations[]>();
    visibleDoctors.forEach((doctor) => map.set(doctor.id, []));""",
            "visible-doctors",
        ),
        (
            "  }, [doctors.data, filteredAppointments]);",
            "  }, [visibleDoctors, filteredAppointments]);",
            "bydoctor-deps",
        ),
    ],
)

# بقيّة مواضع `doctors.data ?? []` في المواعيد تُبدَّل إلى القائمة المحصورة
raw = open("client/pages/Appointments.tsx", "rb").read()
nl = "\r\n" if b"\r\n" in raw else "\n"
src = raw.decode("utf-8").replace("\r\n", "\n")
n = src.count("doctors.data ?? []")
if n != 4:
    sys.exit("توقّعتُ أربعة مواضع باقية، وجدتُ %d" % n)
src = src.replace("doctors={doctors.data ?? []}", "doctors={visibleDoctors}")
src = src.replace("const doctor = (doctors.data ?? []).find(", "const doctor = visibleDoctors.find(")
if "doctors.data ?? []" in src:
    sys.exit("بقيت مواضع لم تُبدَّل")
open("client/pages/Appointments.tsx", "wb").write(src.replace("\n", nl).encode("utf-8"))
print("client/pages/Appointments.tsx: doctor lists scoped")

# ══════════════════════════════════════════════════════════════════════════
# 4) التقويم يقرأ استعلامه بنفسه — فيُحصر بنفسه
# ══════════════════════════════════════════════════════════════════════════
patch(
    "client/components/appointments/AppointmentCalendar.tsx",
    [
        (
            'import { supabase } from "@/lib/supabase";',
            'import { supabase } from "@/lib/supabase";\nimport { useSessionDoctor } from "@/lib/session-doctor";',
            "cal-import",
        ),
        (
            """  const appointments = useQuery({
    queryKey: ["calendar-appointments", organizationId, range.from.toISOString(), range.to.toISOString()],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")""",
            """  /**
   * التقويم يجلب مواعيده باستعلامٍ خاصّ به، فلا يكفي حصرُ استعلام الشاشة:
   * كان الطبيب يرى يوم العيادة كاملًا في التقويم ويومَه هو في القائمة —
   * رقمان متناقضان على شاشة واحدة.
   */
  const { doctorId: scopeDoctorId, isDoctorScope } = useSessionDoctor();
  const scopedDoctorId = isDoctorScope ? scopeDoctorId : null;

  const appointments = useQuery({
    queryKey: [
      "calendar-appointments",
      organizationId,
      range.from.toISOString(),
      range.to.toISOString(),
      scopedDoctorId ?? "",
    ],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("appointments")""",
            "cal-query-head",
        ),
        (
            """        .eq("organization_id", organizationId)
        .gte("scheduled_start", range.from.toISOString())
        .lt("scheduled_start", range.to.toISOString())
        .order("scheduled_start");
      if (error) throw error;""",
            """        .eq("organization_id", organizationId);
      if (scopedDoctorId) query = query.eq("doctor_id", scopedDoctorId);
      const { data, error } = await query
        .gte("scheduled_start", range.from.toISOString())
        .lt("scheduled_start", range.to.toISOString())
        .order("scheduled_start");
      if (error) throw error;""",
            "cal-query-filter",
        ),
    ],
)

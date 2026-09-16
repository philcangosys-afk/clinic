# -*- coding: utf-8 -*-
"""إتمام حصر الطبيب: مواضع قائمة الأطباء الباقية، واستعلام التقويم.

النصّ السابق توقّف عند فحصٍ خاطئ مني: عدّ مواضع `doctors.data ?? []` المتوقّى
أربعة، والصحيح ستّة — لأنّ `visibleDoctors` الذي أضفتُه يحتوي موضعين منها
بنفسه. الملفّان مُرقَّعان إلى ما قبل ذلك الفحص، وهذا يُكمل ما بعده.
"""
import sys


def patch(path, edits):
    raw = open(path, "rb").read()
    nl = "\r\n" if b"\r\n" in raw else "\n"
    src = raw.decode("utf-8").replace("\r\n", "\n")
    for old, new, label, count in edits:
        found = src.count(old)
        if found != count:
            sys.exit("ANCHOR %s in %s: count=%d (expected %d)" % (label, path, found, count))
        src = src.replace(old, new)
    open(path, "wb").write(src.replace("\n", nl).encode("utf-8"))
    print("%s: patched (EOL=%s)" % (path, "CRLF" if nl == "\r\n" else "LF"))


patch(
    "client/pages/Appointments.tsx",
    [
        ("doctors={doctors.data ?? []}", "doctors={visibleDoctors}", "calendar-and-dialogs", 3),
        (
            "const doctor = (doctors.data ?? []).find(",
            "const doctor = visibleDoctors.find(",
            "doctor-card",
            1,
        ),
    ],
)

# الموضعان الباقيان داخل `visibleDoctors` نفسه — وهما الصواب.
raw = open("client/pages/Appointments.tsx", "rb").read().decode("utf-8")
remaining = raw.count("doctors.data ?? []")
if remaining != 2:
    sys.exit("بقي %d موضعًا خارج visibleDoctors" % (remaining - 2))
print("Appointments: قائمة الأطباء محصورة (بقي موضعان داخل visibleDoctors — الصواب)")


patch(
    "client/components/appointments/AppointmentCalendar.tsx",
    [
        (
            'import { supabase } from "@/lib/supabase";',
            'import { supabase } from "@/lib/supabase";\n'
            'import { useSessionDoctor } from "@/lib/session-doctor";',
            "cal-import",
            1,
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
   * رقمان متناقضان على شاشةٍ واحدة.
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
            1,
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
            1,
        ),
    ],
)

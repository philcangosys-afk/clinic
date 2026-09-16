# -*- coding: utf-8 -*-
"""تنبيه: الصفة طبيب ولم تُعرف هويّته — الشاشة تعرض الكلّ وتقول ذلك."""
import sys


def patch(path, old, new, label):
    raw = open(path, "rb").read()
    nl = "\r\n" if b"\r\n" in raw else "\n"
    src = raw.decode("utf-8").replace("\r\n", "\n")
    if src.count(old) != 1:
        sys.exit("ANCHOR %s in %s: count=%d" % (label, path, src.count(old)))
    src = src.replace(old, new, 1)
    open(path, "wb").write(src.replace("\n", nl).encode("utf-8"))
    print("%s: patched (EOL=%s)" % (path, "CRLF" if nl == "\r\n" else "LF"))


# التنبيه يُعرض ولا يُبتلع: الطبيب الذي يرى قائمةً كاملة وهو يظنّها قائمته
# أسوأ من طبيبٍ يعرف أنّ الحصر لم يعمل. والسبب مذكورٌ بما يُصلَح به.
BANNER = """      {unresolvedDoctor && (
        <p className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          الصفة «طبيب» ولم يُعرف أيّ طبيبٍ أنت — لا حسابٌ مربوط بسجلّ طبيب
          (<span className="font-mono">doctors.user_id</span>) ولا طبيبٌ مختار في
          شاشة الصفة. <strong>المعروض هنا كلّ المنشأة لا ما يخصّك.</strong>
        </p>
      )}
"""

patch(
    "client/pages/Patients.tsx",
    """        <div>
          <h1 className="text-2xl font-bold">المرضى</h1>
          <p className="text-sm text-muted-foreground">بحث وفتح ملفات المرضى</p>
        </div>
      </div>
""",
    """        <div>
          <h1 className="text-2xl font-bold">المرضى</h1>
          <p className="text-sm text-muted-foreground">
            {isDoctorScope ? "مرضاك: من تعالجهم أو تشارك فيهم أو لك معهم موعد" : "بحث وفتح ملفات المرضى"}
          </p>
        </div>
      </div>

""" + BANNER,
    "patients-banner",
)

patch(
    "client/pages/Appointments.tsx",
    """        <div>
          <h1 className="text-2xl font-bold">المواعيد</h1>
          <p className="text-sm text-muted-foreground">جدول الأطباء اليومي</p>
        </div>""",
    """        <div>
          <h1 className="text-2xl font-bold">المواعيد</h1>
          <p className="text-sm text-muted-foreground">
            {isDoctorScope ? "جدولك أنت" : "جدول الأطباء اليومي"}
          </p>
        </div>""",
    "appt-subtitle",
)

patch(
    "client/pages/Appointments.tsx",
    """  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">المواعيد</h1>""",
    """  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6">
""" + BANNER + """      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">المواعيد</h1>""",
    "appt-banner",
)

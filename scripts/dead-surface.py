#!/usr/bin/env python3
"""
يبحث عن "سطحٍ ميت" في المخطط: أشياء أُنشئت في القاعدة ولا يستعملها أحد.

ثلاث فئات، وكلٌّ منها له معنى مختلف:

  • **دالة لا يستدعيها العميل ولا القاعدة** — إمّا نُسيت، أو أن الشاشة تكرّر
    منطقها يدويًا فيفترق الاثنان مع الوقت.
  • **منظور لا يقرؤه أحد** — عملٌ بُذل ولا يظهر لمستخدم.
  • **عمود لا يُكتب فيه شيء** — أخطر الثلاثة: الشاشة تعرض حالةً لا يستطيع
    أحد ضبطها، أو تقريرٌ يقرأ عمودًا فارغًا أبدًا فيبدو الرقم صفرًا لا خطأ.

ليس كل ما يظهر هنا عيبًا: أعمدة التدقيق (`created_at`) تُملأ بقيم افتراضية،
وبعض الدوال حراسٌ تستدعيها المشغّلات. الأداة تُرشِّح للمراجعة لا تحكم.

الاستعمال:
  python3 scripts/dead-surface.py <cols.txt> <fns.txt> <views.txt> <migrations_dir> <client_dir>
"""

import re
import sys
from pathlib import Path

# أعمدة تُملأ تلقائيًا أو بقيمة افتراضية — ذكرها هنا ضجيج لا إشارة.
IGNORED_COLUMNS = {
    "id", "created_at", "updated_at", "organization_id",
}

# مناظير للمشغّل لا للعميل: صلاحيتها منزوعة عن `authenticated` عمدًا، فغيابها
# من الواجهة هو التصميم المقصود لا سهوٌ.
OPERATOR_ONLY_VIEWS = {
    "v_security_advisor",
}

# دوال يستدعيها **عاملٌ خلفيّ** لا المتصفّح، بحكم التصميم: نتيجة محاولة
# الإرسال إلى مزوّد خارجي لا يعرفها إلا من أرسل. تُستثنى صراحةً لا صمتًا،
# ولكلٍّ منها مستهلكٌ فعليّ في `supabase/functions/`.
WORKER_ONLY_FUNCTIONS = {
    "app_mark_integration_attempt",
}

# بادئات دوال لا يستدعيها العميل بطبيعتها.
TRIGGER_FUNCTION_HINTS = ("app_enforce_", "app_validate_", "app_derive_", "app_fill_",
                          "app_check_contact_block", "app_audit_", "app_set_updated_at")


def read_pairs(path):
    tables = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or "|" not in line:
            continue
        table, column = line.split("|", 1)
        tables.setdefault(table, set()).add(column)
    return tables


def read_names(path):
    return {l.strip() for l in Path(path).read_text(encoding="utf-8").splitlines() if l.strip()}


def concat(directory, suffixes):
    text = []
    for path in sorted(Path(directory).rglob("*")):
        if path.is_file() and path.suffix in suffixes:
            try:
                text.append(path.read_text(encoding="utf-8"))
            except UnicodeDecodeError:
                pass
    return "\n".join(text)


def main():
    if len(sys.argv) != 6:
        print(__doc__)
        return 2

    cols_path, fns_path, views_path, migrations_dir, client_dir = sys.argv[1:]
    tables = read_pairs(cols_path)
    functions = read_names(fns_path)
    views = read_names(views_path)

    client = concat(client_dir, {".ts", ".tsx"})
    migrations = concat(migrations_dir, {".sql"})

    problems = 0

    # ---- دوال ----
    print("### دوال لا يستدعيها العميل ولا تظهر في مشغّل\n")
    for fn in sorted(functions):
        if not fn.startswith("app_"):
            continue
        if fn.startswith(TRIGGER_FUNCTION_HINTS):
            continue
        if fn in WORKER_ONLY_FUNCTIONS:
            continue
        called_by_client = f'"{fn}"' in client or f"'{fn}'" in client
        # مربوطة بمشغّل؟
        is_trigger = re.search(rf"execute\s+(?:function|procedure)\s+{re.escape(fn)}\s*\(",
                               migrations, re.I) is not None
        # مستدعاة من دالة أو سياسة أو منظور آخر: ذكرٌ متبوعًا بقوس، خارج
        # سطر التعريف وخارج grant/revoke/comment/drop.
        called_in_db = False
        for line in migrations.splitlines():
            if not re.search(rf"\b{re.escape(fn)}\s*\(", line):
                continue
            low = line.strip().lower()
            if low.startswith(("create or replace function", "create function",
                               "grant ", "revoke ", "comment on", "drop function",
                               "drop trigger", "alter function")):
                continue
            if re.search(rf"execute\s+(?:function|procedure)\s+{re.escape(fn)}", low):
                continue
            called_in_db = True
            break
        if not called_by_client and not called_in_db and not is_trigger:
            print(f"  {fn}")
            problems += 1

    # ---- مناظير ----
    print("\n### مناظير لا يقرؤها العميل\n")
    for view in sorted(views):
        if view in OPERATOR_ONLY_VIEWS:
            continue
        if f'"{view}"' not in client:
            print(f"  {view}")
            problems += 1

    # ---- أعمدة ----
    print("\n### أعمدة لا يُكتب فيها شيء من العميل ولا من القاعدة\n")
    for table in sorted(tables):
        if table in views:
            continue
        if f'"{table}"' not in client:
            continue  # الجدول نفسه غير مستعمل — مسألة أخرى
        for column in sorted(tables[table]):
            if column in IGNORED_COLUMNS or column.endswith("_id") is False and False:
                continue
            if column in IGNORED_COLUMNS:
                continue
            in_client = re.search(rf"\b{re.escape(column)}\b", client) is not None
            # الكتابة من القاعدة: `set <col> =` أو ذكره في insert.
            #
            # العمود الثاني فصاعدًا في قائمة `set` متعدّدة الأسطر لا يسبقه
            # `set` بل فاصلة، فكان يُعدّ "لا يُكتب فيه" خطأً. نقبل الفاصلة
            # أو بداية السطر قبل `<col> =` ما دام النمط داخل جملة تحديث.
            col = re.escape(column)
            written_in_db = re.search(
                rf"(set\s+{col}\s*=|new\.{col}\s*:=|,\s*{col}\s*[,)]"
                rf"|[,\n]\s*{col}\s*=[^=])",
                migrations, re.I | re.S) is not None
            if not in_client and not written_in_db:
                print(f"  {table}.{column}")
                problems += 1

    print(f"\nالمجموع: {problems}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

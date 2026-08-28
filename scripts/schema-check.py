#!/usr/bin/env python3
"""
فحص تطابق الاستعلامات مع مخطط قاعدة البيانات.

يقارن كل `.from("table").select(...)` و`.insert/.update/.upsert({...})` وكل
`.rpc("fn")` في مجلد client بأسماء الجداول والأعمدة والدوال الحقيقية.

سبب وجوده: هذا المشروع لا يستخدم أنواعًا مولّدة من Supabase، فخطأ في اسم عمود
لا يظهر وقت البناء — يظهر كقائمة فارغة أو عدّاد صفري في وجه المستخدم. حدث ذلك
فعلًا مرتين: `clinics.name_ar` (والعمود اسمه `name`) فبقيت قائمة العيادات في
نافذة الفاتورة فارغة، و`id` في ثلاثة عروض مفاتيحها مسمّاة بغير ذلك فبقيت
شارات المختبر والأشعة والصرف صفرًا.

الاستعمال:
  1) صدّر أعمدة القاعدة ودوالها:
     psql -d <db> -Atc "select table_name||'|'||column_name
       from information_schema.columns where table_schema='public'" > cols.txt
     psql -d <db> -Atc "select proname from pg_proc p
       join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'" > fns.txt
  2) python3 scripts/schema-check.py cols.txt fns.txt client

يعيد رمز خروج 1 إن وُجدت مشكلة، فيصلح للاستعمال في CI.
"""
import re
import os
import sys
import collections


def top_level_fields(sel: str):
    """أعمدة المستوى الأعلى فقط — العلاقات المضمّنة name(...) تُتخطّى."""
    out, depth, buf = [], 0, ""
    for ch in sel:
        if ch == "(":
            depth += 1
            if depth == 1:
                buf = ""  # ما قبل القوس اسم علاقة لا اسم عمود
        elif ch == ")":
            depth -= 1
        elif depth == 0:
            if ch == ",":
                out.append(buf)
                buf = ""
            else:
                buf += ch
    out.append(buf)
    return [x.strip() for x in out if x.strip()]


def main(cols_path, fns_path, root_dir):
    cols = collections.defaultdict(set)
    for line in open(cols_path):
        line = line.strip()
        if "|" in line:
            table, column = line.split("|", 1)
            cols[table].add(column)
    fns = set(open(fns_path).read().split())

    # الشرط `(?![\s\S]*?\.from\()` يمنع مطابقة select يخصّ استعلامًا آخر بعده:
    # بدونه يُنسب select الاستعلام التالي إلى جدول الاستعلام السابق فتظهر
    # أعمدة سليمة كأنها مفقودة.
    sel_pat = re.compile(
        r'\.from\(\s*"([a-z0-9_]+)"\s*\)'
        r'((?:(?!\.from\()[\s\S]){0,600}?)'
        r'\.select\(\s*(?:\n\s*)?"((?:[^"\\]|\\.)*)"',
        re.M,
    )
    write_pat = re.compile(
        r'\.from\(\s*"([a-z0-9_]+)"\s*\)\s*\.(insert|update|upsert)\('
        r'\s*\{([\s\S]{0,2500}?)\n(\s*)\}\s*[,)]',
        re.M,
    )
    filter_pat = re.compile(
        r'\.(eq|neq|gt|gte|lt|lte|like|ilike|is|in|order)\(\s*"([a-zA-Z0-9_.>-]+)"'
    )
    from_pat = re.compile(r'\.from\(\s*"([a-z0-9_]+)"\s*\)')
    # `.from(cond ? "a" : "b")` — اسم الجدول غير ثابت، فلا يمكن نسب الفلاتر
    # بعده إلى جدول بعينه. تجاهله أسلم من نسبها للجدول السابق خطأً.
    any_from_pat = re.compile(r'\.from\(')

    def nearest_table(src, pos):
        """أقرب `.from("table")` نصّي قبل هذا الموضع — الفلتر يخصّ ذلك الجدول."""
        last = None
        last_end = 0
        for fm in from_pat.finditer(src, 0, pos):
            last = fm.group(1)
            last_end = fm.end()
        # وجود `.from(` غير نصّي بعد آخر واحدة معروفة يعني أننا في استعلام آخر
        for am in any_from_pat.finditer(src, last_end, pos):
            return None
        return last

    issues = []

    for base, _, files in os.walk(root_dir):
        for name in files:
            if not name.endswith((".tsx", ".ts")):
                continue
            path = os.path.join(base, name)
            src = open(path, encoding="utf-8").read()

            for m in re.finditer(r'\.from\(\s*"([a-z0-9_]+)"', src):
                if m.group(1) not in cols:
                    issues.append((path, m.group(1), "جدول/عرض غير موجود"))

            for m in re.finditer(r'\.rpc\(\s*"([a-z0-9_]+)"', src):
                if m.group(1) not in fns:
                    issues.append((path, m.group(1), "دالة غير موجودة"))

            for m in sel_pat.finditer(src):
                table, sel = m.group(1), m.group(3)
                if table not in cols:
                    continue
                for part in top_level_fields(sel):
                    if part == "*":
                        continue
                    if ":" in part:
                        part = part.split(":", 1)[1].strip()
                    part = part.split("!")[0].strip()
                    if not re.fullmatch(r"[a-z0-9_]+", part):
                        continue
                    if part not in cols[table]:
                        issues.append((path, table, f"select: {part}"))

            # فلاتر الأعمدة: `.eq("col", ...)` و`.order("col")` وأخواتها.
            #
            # أُضيف هذا الفحص بعد أن مرّ خطأ حقيقي من الفحص السابق:
            # أربع شاشات كانت تصفّي `doctors` بعمود `is_disabled` — والعمود
            # اسمه `is_enabled`. الاستعلام يفشل كليًا فتبقى قائمة الأطباء
            # فارغة، ولا يظهر شيء في فحص أسماء أعمدة select وحده.
            for m in filter_pat.finditer(src):
                table = nearest_table(src, m.start())
                if table is None or table not in cols:
                    continue
                column = m.group(2)
                # الأعمدة المرتبطة عبر علاقة (`patient.name_ar`) تخصّ جدولًا آخر
                if "." in column or "->" in column:
                    continue
                if column not in cols[table]:
                    issues.append((path, table, f"{m.group(1)}: {column}"))

            for m in write_pat.finditer(src):
                table, op, body = m.group(1), m.group(2), m.group(3)
                if table not in cols:
                    continue
                depth = 0
                for line in body.split("\n"):
                    if depth == 0:
                        km = re.match(r"([a-z_][a-z0-9_]*)\s*:", line.strip())
                        if km and km.group(1) not in cols[table]:
                            issues.append((path, table, f"{op}: {km.group(1)}"))
                    depth += sum(line.count(c) for c in "{[(") - sum(line.count(c) for c in "}])")
                    depth = max(depth, 0)

    for path, table, problem in issues:
        print(f"{path:55} {table:32} -> {problem}")
    print(f"المجموع: {len(issues)}")
    return 1 if issues else 0


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2], sys.argv[3]))

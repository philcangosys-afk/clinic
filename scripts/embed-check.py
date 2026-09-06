#!/usr/bin/env python3
"""
فحص التضمينات الغامضة في استعلامات PostgREST.

سبب وجوده: هذا المشروع يربط كل جدولين تابعين لمنشأة بمفتاح أجنبي مركّب
(organization_id, x_id) إلى جانب المفتاح المفرد (x_id) — وهو الصواب لعزل
المنشآت. لكن النتيجة أن بين الجدولين **علاقتين**، فإذا كُتب التضمين بلا تحديد
القيد:

    .from("prescriptions").select("prescription_items(drug:items(name_ar))")

يرفض PostgREST الاستعلام كلّه بالخطأ PGRST201 «could not embed because more
than one relationship was found». والواجهة لا تعرض خطأً: تعرض قائمة فارغة. أي
أن تبويبًا كاملًا يظهر «لا توجد بيانات» بينما البيانات موجودة — وهو أسوأ أنواع
الخلل لأنه يبدو حالة طبيعية.

وُجد بهذا الفحص 16 تضمينًا غامضًا في مراجعة 0143، منها تبويب «الوصفات» في ملفّ
المريض، وقائمة دفعات المخزون، وقوائم الأسعار، والموارد.

الاستعمال:
  1) صدّر أعمدة القاعدة وعلاقاتها المتعدّدة:
     psql -d <db> -Atc "select table_name||'|'||column_name
       from information_schema.columns where table_schema='public'" > cols.txt
     psql -d <db> -Atc "select conrelid::regclass||'|'||confrelid::regclass||'|'||count(*)
       from pg_constraint where contype='f'
       group by 1,2 having count(*)>1" > dupfk.txt
  2) python3 scripts/embed-check.py cols.txt dupfk.txt client

الإصلاح لكل ملاحظة: أضف اسم القيد بعد علامة التعجّب، واختر القيد المُصادَق
(المفرد `*_id_fkey`) لا المركّب:

    drug:items!prescription_items_drug_item_id_fkey(name_ar)

يعيد رمز خروج 1 إن وُجدت مشكلة، فيصلح للاستعمال في CI.
"""
import os
import re
import sys


def load_tables(path):
    return {line.split("|")[0].strip() for line in open(path, encoding="utf-8") if line.strip()}


def load_ambiguous(path):
    pairs = set()
    for line in open(path, encoding="utf-8"):
        parts = [p.strip() for p in line.strip().split("|")]
        if len(parts) >= 2 and parts[0] and parts[1]:
            pairs.add((parts[0], parts[1]))
    return pairs


def walk_select(select_text, base_table, tables):
    """
    يمشي على سلسلة `select` ويعيد (الجدول الأب، الجدول المضمَّن، الاسم المستعار،
    القيد المحدَّد) لكل تضمين — بما في ذلك التضمين داخل التضمين، لأن الغموض قد
    يكون في المستوى الثاني كما في `prescription_items(drug:items(...))`.
    """
    found = []
    stack = [base_table]
    buf = ""
    for char in select_text:
        if char == "(":
            name = buf.strip().split(",")[-1].strip()
            alias, table, hint = None, name, None
            if ":" in table:
                alias, table = table.split(":", 1)
            if "!" in table:
                table, hint = table.split("!", 1)
            table = table.strip()
            if table in tables:
                found.append((stack[-1], table, alias, hint))
                stack.append(table)
            else:
                # ليس علاقة — مثل count(...) أو دالّة تجميع
                stack.append(stack[-1])
            buf = ""
        elif char == ")":
            if len(stack) > 1:
                stack.pop()
            buf = ""
        elif char == ",":
            buf = ""
        else:
            buf += char
    return found


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    cols_path, dupfk_path, root = sys.argv[1], sys.argv[2], sys.argv[3]
    tables = load_tables(cols_path)
    ambiguous = load_ambiguous(dupfk_path)

    problems = set()
    for folder, _, files in os.walk(root):
        for name in files:
            if not name.endswith((".ts", ".tsx")):
                continue
            path = os.path.join(folder, name)
            source = open(path, encoding="utf-8").read()
            froms = [
                (match.start(), match.end(), match.group(1))
                for match in re.finditer(r'\.from\(\s*"([a-z0-9_]+)"\s*\)', source)
            ]
            for index, (start, end, base) in enumerate(froms):
                stop = froms[index + 1][0] if index + 1 < len(froms) else len(source)
                region = source[end:stop]
                for select_match in re.finditer(
                    r'\.select\(\s*(?:\n\s*)?"((?:[^"\\]|\\.)*)"', region, re.S
                ):
                    line = source[: end + select_match.start()].count("\n") + 1
                    for parent, table, alias, hint in walk_select(
                        select_match.group(1), base, tables
                    ):
                        if (parent, table) in ambiguous and not hint:
                            problems.add((path, line, alias or table, table, parent))

    for path, line, alias, table, parent in sorted(problems):
        print(f"{path}:{line}  «{alias}» ← {table} داخل {parent}  -> تضمين غامض بلا تحديد القيد")
    print(f"المجموع: {len(problems)}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""فحص التنسيق المحلّي — يعثر على كل `toLocale*String("ar-SA")` في العميل.

**لماذا هذا عيب:** `ar-SA` وحدها في Chrome تُخرج أرقامًا عربية-هندية
(٠١٢٣) وتاريخًا هجريًّا. النظام يعرض اللاتينية والميلاديّ في كل مكان آخر،
فالشاشة الواحدة تُظهر «١٥٠» في عمود و«150» في الذي بجانبه، والتاريخ نفسه
يُقرأ ١٤٤٧ هنا و2026 هناك. و`client/lib/locale.ts` موجودة لهذا بالضبط:
تفرض `ar-SA-u-nu-latn` والتقويم الميلاديّ صراحةً، وتحترم إعداد المنشأة
حين يُمرَّر إليها.

**البديل لكل حالة:**

    قيمة نقدية في عمود      → formatAmount(v)
    كمّية أو عدد            → formatCount(v)
    مبلغ برمز العملة        → formatMoney(v, currencyCode)
    تاريخ                   → formatDate(v, calendarDisplay)
    تاريخ ووقت              → formatDateTime(v, calendarDisplay)
    وقت                     → formatTime(v)

و`calendarDisplay` يأتي من `useLocaleSettings()` داخل المكوّن. الدالّة
العادية (تصدير CSV، بناء HTML للطباعة) إمّا تُمرَّر إليها التقويم معاملًا،
وإمّا تُترك على الميلاديّ الافتراضيّ.

الاستعمال:  python scripts/locale-check.py [--list]
الخروج: 0 إن لم يبقَ شيء، 1 إن بقي — فيصلح للاستعمال في فحص آليّ.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIENT = os.path.join(ROOT, "client")
PATTERN = re.compile(r'toLocale[A-Za-z]*String\(\s*"ar(?:-SA)?"')


def main() -> int:
    show_lines = "--list" in sys.argv
    per_file: dict[str, list[tuple[int, str]]] = {}

    for base, dirs, files in os.walk(CLIENT):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for name in files:
            if not name.endswith((".ts", ".tsx")):
                continue
            path = os.path.join(base, name)
            with open(path, encoding="utf-8") as handle:
                for number, line in enumerate(handle, 1):
                    if PATTERN.search(line):
                        rel = os.path.relpath(path, ROOT).replace(os.sep, "/")
                        per_file.setdefault(rel, []).append((number, line.strip()))

    total = sum(len(v) for v in per_file.values())
    if total == 0:
        print("لا شيء — كل التنسيق يمرّ عبر client/lib/locale.ts")
        return 0

    print("بقي %d موضعًا في %d ملفًّا:\n" % (total, len(per_file)))
    for rel in sorted(per_file, key=lambda k: (-len(per_file[k]), k)):
        hits = per_file[rel]
        print("%4d  %s" % (len(hits), rel))
        if show_lines:
            for number, text in hits:
                print("        %d: %s" % (number, text[:110]))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

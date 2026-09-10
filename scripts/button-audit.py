#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""فحص الأزرار — هل يوجد زرّ لا يؤدّي وظيفته؟

يُجيب عن سؤال المالك: «هل في النظام أزرار لا تعمل أو لا تكتمل دورتها؟»
ويبحث عن أربعة أشكال، أخطرها الأخيران لأنّهما لا يُريان بالعين:

  1) `no-action`        — زرّ بلا `onClick` ولا `type="submit"` ولا `asChild`.
  2) `empty-handler`    — معالِجه `() => {}` أو `console.log` فقط.
  3) `placeholder`      — معالِجه يحمل «قريبًا» أو TODO أو ما يشبههما.
  4) `always-disabled`  — `disabled={true}` ثابتة.
  5) `no-onError`       — **الأخطر:** طفرة تفحص الصفوف المتأثّرة وترمي رسالة
     عربية صريحة، ثمّ تبتلعها react-query لغياب `onError`. الموظّف يضغط
     «تعطيل» فلا يحدث شيء ولا رسالة تقول لماذا، فيُعيد المحاولة ظانًّا أنّ
     ضغطته لم تُسجَّل. هذا أسوأ من رسالة خطأ.
  6) `no-affected-rows` — تحديث أو حذف بلا `.select()`: PostgREST لا يعدّ
     «لم يطابق صفًّا» خطأً، فتظهر رسالة نجاح كاذبة. (تحديثٌ جماعيّ يجوز
     أن يطابق صفرًا — تُراجَع كل حالة.)
  7) `state-never-read` — زرّ يضبط حالة لا يقرؤها أحد: يضغط ولا يتغيّر شيء.

**النتائج مرشَّحات لا أحكام.** تُقرأ كل حالة في مكانها قبل أن تُصلَح؛
والفاحص يستثني ما ثبت أنّه سليم:
  - زرّ داخل `*Trigger asChild` أو مُمرَّر في خاصّية مثل `trigger={ ... }`
    يأخذ سلوكه من مُشغِّله.
  - زرّ داخل `<form onSubmit=...>` نوعه `submit` ضمنًا.
  - بدائيّات `client/components/ui/` مستثناة كلّها.
  - أزرار المعاينة المعطَّلة عمدًا (تبويب «المعاينة» في نماذج الفحص) تظهر
    تحت `always-disabled` ويجب تجاهلها — معطَّلة لأنّها عرضٌ لا إدخال.

الاستعمال:  python scripts/button-audit.py [--json]
الخروج: 0 إن لم يبقَ مرشَّح، 1 إن بقي.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIENT = os.path.join(ROOT, "client")

TRIGGERS = {
    "DialogTrigger", "AlertDialogTrigger", "PopoverTrigger", "DropdownMenuTrigger", "SheetTrigger",
    "TooltipTrigger", "CollapsibleTrigger", "HoverCardTrigger", "DialogClose", "AlertDialogCancel",
    "AlertDialogAction", "SelectTrigger", "ContextMenuTrigger", "MenubarTrigger", "DrawerTrigger",
    "DrawerClose", "SheetClose", "AccordionTrigger", "TabsTrigger", "Slot", "Link", "NavLink", "label",
}
BUTTON_RE = re.compile(r"<(Button|button|IconButton)(?=[\s/>])")
ACTION_ATTRS = ("onClick", "onMouseDown", "onPointerDown", "onSubmit", "onSelect",
                "onKeyDown", "href", "to", "asChild", "form")
PLACEHOLDER = re.compile(
    r"(قريبًا|قريباً|لاحقًا|لاحقاً|غير متاح بعد|لم يُنفَّذ|قيد التطوير|not implemented|coming soon|TODO|FIXME)",
    re.I)
EMPTY_HANDLER = re.compile(r"^\{\s*\(\s*\)\s*=>\s*(\{\s*\}|undefined|null)\s*\}$", re.S)
CONSOLE_ONLY = re.compile(r"^\{\s*\(\s*[^)]*\)\s*=>\s*console\.\w+\([^;]*\)\s*\}$", re.S)


def _skip_literal(src, j, n):
    """يتخطّى سلسلة نصّية أو تعليقًا بادئًا عند j؛ يُعيد الفهرس التالي أو None."""
    c = src[j]
    if c in "\"'":
        q = c
        j += 1
        while j < n and src[j] != q:
            j += 2 if src[j] == "\\" else 1
        return j + 1
    if c == "`":
        j += 1
        while j < n and src[j] != "`":
            j += 2 if src[j] == "\\" else 1
        return j + 1
    if c == "/" and j + 1 < n and src[j + 1] == "/":
        k = src.find("\n", j)
        return n if k < 0 else k
    if c == "/" and j + 1 < n and src[j + 1] == "*":
        k = src.find("*/", j)
        return n if k < 0 else k + 2
    return None


def end_of_tag(src, i):
    """i عند '<' — فهرس '>' الذي يُغلق الوسم، مع احترام {} والسلاسل."""
    depth, j, n = 0, i + 1, len(src)
    while j < n:
        nxt = _skip_literal(src, j, n)
        if nxt is not None:
            j = nxt
            continue
        c = src[j]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        elif c == ">" and depth == 0:
            return j
        j += 1
    return -1


def attr_names(tag_src):
    names, depth, i, n = set(), 0, 0, len(tag_src)
    while i < n:
        nxt = _skip_literal(tag_src, i, n)
        if nxt is not None:
            i = nxt
            continue
        c = tag_src[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        elif depth == 0 and (c.isalpha() or c == "_"):
            m = re.match(r"[A-Za-z_][\w:.-]*", tag_src[i:])
            if m:
                names.add(m.group(0))
                i += m.end()
                continue
        i += 1
    return names


def attr_value(tag_src, name):
    m = re.search(r"\b" + re.escape(name) + r"\s*=\s*", tag_src)
    if not m:
        return None
    i = m.end()
    if i >= len(tag_src):
        return None
    if tag_src[i] == "{":
        depth, j, n = 0, i, len(tag_src)
        while j < n:
            nxt = _skip_literal(tag_src, j, n)
            if nxt is not None:
                j = nxt
                continue
            if tag_src[j] == "{":
                depth += 1
            elif tag_src[j] == "}":
                depth -= 1
                if depth == 0:
                    return tag_src[i:j + 1]
            j += 1
        return tag_src[i:]
    if tag_src[i] in "\"'":
        q = tag_src[i]
        j = tag_src.find(q, i + 1)
        return tag_src[i:j + 1] if j > 0 else None
    return None


def stmt_from(src, i):
    """من `supabase` إلى نهاية سلسلة النداءات."""
    depth, j, n = 0, i, len(src)
    while j < n:
        nxt = _skip_literal(src, j, n)
        if nxt is not None:
            j = nxt
            continue
        c = src[j]
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth < 0:
                return src[i:j]
        elif c == ";" and depth == 0:
            return src[i:j]
        j += 1
    return src[i:]


def balanced(src, i):
    depth, j, n = 0, i, len(src)
    while j < n:
        nxt = _skip_literal(src, j, n)
        if nxt is not None:
            j = nxt
            continue
        c = src[j]
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth == 0:
                return j
        j += 1
    return -1


def prev_open_tag(src, pos):
    seg = src[max(0, pos - 500):pos]
    ms = list(re.finditer(r"<([A-Za-z][\w.]*)", seg))
    return ms[-1].group(1) if ms else ""


def passed_as_prop(src, pos):
    """الزرّ مُمرَّر في خاصّية مثل `trigger={` فسلوكه يأتي من مستقبِلها."""
    return src[:pos].rstrip().endswith("={")


def inside_form_with_submit(src, pos):
    fi = src.rfind("<form", 0, pos)
    if fi < 0 or src.find("</form>", pos) < 0:
        return False
    end = end_of_tag(src, fi)
    return end > 0 and "onSubmit" in src[fi:end]


def main() -> int:
    findings = []

    def add(kind, rel, line, detail, snippet=""):
        findings.append(dict(kind=kind, file=rel, line=line, detail=detail, snippet=snippet))

    files = []
    for base, dirs, names in os.walk(CLIENT):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for nm in names:
            if nm.endswith((".tsx", ".ts")):
                files.append(os.path.join(base, nm))

    for path in sorted(files):
        rel = os.path.relpath(path, ROOT).replace(os.sep, "/")
        if "components/ui/" in rel:
            continue
        with open(path, encoding="utf-8") as handle:
            src = handle.read()

        def line_of(p):
            return src.count("\n", 0, p) + 1

        # حالة تُضبط ولا تُقرأ
        for m in re.finditer(
                r"const\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*(?:React\.)?useState", src):
            val, setter = m.group(1), m.group(2)
            uses = len(re.findall(r"\b%s\b" % re.escape(val), src))
            sets = len(re.findall(r"\b%s\b" % re.escape(setter), src))
            if uses == 1 and sets > 1:
                add("state-never-read", rel, line_of(m.start()),
                    "`%s` تُضبط بـ`%s` ولا تُقرأ في الملفّ إطلاقًا" % (val, setter))

        # طفرة بلا onError
        for m in re.finditer(r"\buseMutation\s*\(", src):
            i = src.index("(", m.start())
            j = balanced(src, i)
            if j < 0:
                continue
            body = src[i:j + 1]
            if "onError" in body:
                continue
            add("no-onError", rel, line_of(m.start()),
                "طفرة بلا `onError`%s — فشلها صامت" %
                (" ولها onSuccess تُظهر نجاحًا" if "onSuccess" in body else ""))

        # تحديث/حذف بلا فحص الصفوف
        for m in re.finditer(r"\bsupabase\s*(?:\n\s*)?\.from\(", src):
            chain = stmt_from(src, m.start())
            if not re.search(r"\.(update|delete)\s*\(", chain) or ".select(" in chain:
                continue
            tm = re.search(r'\.from\(\s*"([^"]+)"', chain)
            add("no-affected-rows", rel, line_of(m.start()),
                "%s على `%s` بلا `.select()`" % ("تحديث" if ".update(" in chain else "حذف",
                                                 tm.group(1) if tm else "?"),
                " ".join(chain.split())[:170])

        if not rel.endswith(".tsx"):
            continue

        for m in BUTTON_RE.finditer(src):
            i, tag = m.start(), m.group(1)
            gt = end_of_tag(src, i)
            if gt < 0:
                continue
            tag_src = src[i:gt + 1]
            names = attr_names(tag_src)
            has_spread = re.search(r"\{\s*\.\.\.", tag_src) is not None
            type_val = attr_value(tag_src, "type") or ""
            has_action = (any(a in names for a in ACTION_ATTRS)
                          or "submit" in type_val or "reset" in type_val)
            ln = line_of(i)

            if (not has_action and not has_spread
                    and prev_open_tag(src, i) not in TRIGGERS
                    and not passed_as_prop(src, i)
                    and not inside_form_with_submit(src, i)):
                add("no-action", rel, ln, "<%s> بلا onClick ولا submit ولا asChild" % tag,
                    " ".join(tag_src.split())[:160])

            click = attr_value(tag_src, "onClick")
            if click:
                if EMPTY_HANDLER.match(click) or CONSOLE_ONLY.match(click):
                    add("empty-handler", rel, ln, "<%s> معالِجه فارغ أو console فقط" % tag,
                        " ".join(click.split())[:160])
                if PLACEHOLDER.search(click):
                    add("placeholder", rel, ln, "<%s> معالِجه يحمل نصًّا مؤقّتًا" % tag,
                        " ".join(click.split())[:200])

            if attr_value(tag_src, "disabled") in ("{true}", '"true"'):
                add("always-disabled", rel, ln, "<%s> معطَّل دائمًا" % tag,
                    " ".join(tag_src.split())[:160])

    if "--json" in sys.argv:
        json.dump(findings, sys.stdout, ensure_ascii=False, indent=1)
        return 1 if findings else 0

    order = ["no-onError", "empty-handler", "placeholder", "no-action",
             "always-disabled", "no-affected-rows", "state-never-read"]
    by = {}
    for f in findings:
        by.setdefault(f["kind"], []).append(f)
    for kind in order:
        lst = by.get(kind, [])
        print("\n===== %s (%d) =====" % (kind, len(lst)))
        for f in lst:
            print("%s:%d  %s" % (f["file"], f["line"], f["detail"]))
            if f["snippet"]:
                print("      %s" % f["snippet"])
    print("\nالمجموع: %d مرشَّحًا — تُقرأ كلٌّ في مكانها قبل أن تُصلَح." % len(findings))
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())

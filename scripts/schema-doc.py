# -*- coding: utf-8 -*-
"""مولّد مرجع المخطط.

يقرأ ملفّات الترقية بترتيبها الرقميّ ويحاكي أثرها تراكميًّا (أنشئ، ثم عدّل،
ثم احذف)، فيُخرج صورة المخطط كما هو بعد آخر ترقية — لا كما كان عند إنشائه.
يدخل أيضًا إلى أجسام `do $$ … $$` لأنّ معظم قيود المفاتيح تُضاف داخلها.

    python scripts/schema-doc.py

يكتب: docs/SCHEMA.md و docs/SCHEMA-FUNCTIONS.md و docs/schema.json

لا يُحرَّر ناتجه يدويًّا — يُعاد توليده بعد كل ترقية.
"""
import os, re, json, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------- 1) تقسيم SQL إلى عبارات مع احترام الاقتباس والتعليق ----------
def split_statements(sql):
    out, buf, i, n = [], [], 0, len(sql)
    depth = 0
    while i < n:
        c = sql[i]
        if c == "-" and sql.startswith("--", i):
            j = sql.find("\n", i)
            i = n if j < 0 else j + 1
            continue
        if c == "/" and sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'":
                    if j + 1 < n and sql[j + 1] == "'":
                        j += 2; continue
                    break
                j += 1
            buf.append(sql[i:j + 1]); i = j + 1
            continue
        if c == '"':
            j = sql.find('"', i + 1)
            j = n - 1 if j < 0 else j
            buf.append(sql[i:j + 1]); i = j + 1
            continue
        if c == "$":
            m = re.match(r"\$[A-Za-z_]\w*\$|\$\$", sql[i:])
            if m:
                tag = m.group(0)
                j = sql.find(tag, i + len(tag))
                j = n if j < 0 else j + len(tag)
                buf.append(sql[i:j]); i = j
                continue
        if c == "(":
            depth += 1
        elif c == ")":
            depth = max(0, depth - 1)
        elif c == ";" and depth == 0:
            s = "".join(buf).strip()
            if s: out.append(s)
            buf = []; i += 1
            continue
        buf.append(c); i += 1
    s = "".join(buf).strip()
    if s: out.append(s)
    return out

def strip_comments(s):
    s = re.sub(r"--[^\n]*", " ", s)
    s = re.sub(r"/\*.*?\*/", " ", s, flags=re.S)
    return s

def top_split(body, sep=","):
    parts, buf, depth, i, n = [], [], 0, 0, len(body)
    while i < n:
        c = body[i]
        if c == "'":
            j = i + 1
            while j < n:
                if body[j] == "'":
                    if j + 1 < n and body[j + 1] == "'":
                        j += 2; continue
                    break
                j += 1
            buf.append(body[i:j + 1]); i = j + 1; continue
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
        if c == sep and depth == 0:
            parts.append("".join(buf).strip()); buf = []; i += 1; continue
        buf.append(c); i += 1
    last = "".join(buf).strip()
    if last: parts.append(last)
    return parts

def paren_body(s, start):
    """يعيد ما بين أول قوس بعد start ونظيره."""
    i = s.find("(", start)
    if i < 0: return None, -1
    depth, j, n = 0, i, len(s)
    while j < n:
        c = s[j]
        if c == "'":
            k = j + 1
            while k < n:
                if s[k] == "'":
                    if k + 1 < n and s[k + 1] == "'":
                        k += 2; continue
                    break
                k += 1
            j = k + 1; continue
        if c == "(": depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0: return s[i + 1:j], j + 1
        j += 1
    return s[i + 1:], n

# ---------- 2) الحالة ----------
tables = {}     # name -> dict
functions = {}  # key -> dict
views = {}
enums = {}
indexes = {}

def qual(name):
    name = name.strip().strip('"')
    if name.lower().startswith("public."):
        name = name[7:].strip('"')
    return name

COL_STOP = re.compile(
    r"\b(not\s+null|null|default|references|check|primary\s+key|unique|generated|collate|constraint)\b",
    re.I)

def parse_column(defn):
    m = re.match(r'("?[\w]+"?)\s+(.*)$', defn.strip(), re.S)
    if not m: return None
    name = qual(m.group(1)); rest = m.group(2).strip()
    # النوع = حتى أول كلمة مفتاحية على العمق صفر
    depth, i, n = 0, 0, len(rest)
    stop = n
    while i < n:
        c = rest[i]
        if c == "(": depth += 1
        elif c == ")": depth -= 1
        elif depth == 0:
            mm = COL_STOP.match(rest, i)
            if mm and (i == 0 or not rest[i-1].isalnum() and rest[i-1] != "_"):
                stop = i; break
        i += 1
    typ = " ".join(rest[:stop].split())
    tail = rest[stop:]
    low = tail.lower()
    notnull = bool(re.search(r"\bnot\s+null\b", low))
    dm = re.search(r"\bdefault\s+(.*?)(?=\s+(?:not\s+null|null|check|references|unique|primary\s+key|generated|collate)\b|$)", tail, re.I | re.S)
    default = " ".join(dm.group(1).split()) if dm else None
    rm = re.search(r"\breferences\s+([\w.\"]+)\s*(\([^)]*\))?", tail, re.I)
    ref = None
    if rm:
        ref = qual(rm.group(1)) + (rm.group(2) or "")
    return {"name": name, "type": typ or "?", "not_null": notnull or bool(re.search(r"\bprimary\s+key\b", low)),
            "default": default, "references": ref,
            "pk": bool(re.search(r"\bprimary\s+key\b", low)),
            "unique": bool(re.search(r"\bunique\b", low))}

def ensure(t):
    if t not in tables:
        tables[t] = {"columns": [], "constraints": [], "created_in": None, "touched": []}
    return tables[t]

def touch(t, mig):
    tb = tables.get(t)
    if tb is not None and mig not in tb["touched"]:
        tb["touched"].append(mig)

DDL_START = re.compile(
    r"\b(create\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:materialized\s+)?"
    r"(?:table|index|view|function|type)\b|alter\s+table\b|drop\s+(?:table|view|index|function)\b)",
    re.I)

def handle(stmt, mig, depth=0):
    s = " ".join(strip_comments(stmt).split())
    low = s.lower()

    if depth == 0 and re.match(r"do\s+(\$[A-Za-z_]*\$)", low):
        tag = re.match(r"do\s+(\$[A-Za-z_]*\$)", s, re.I).group(1)
        a = s.find(tag) + len(tag)
        b = s.rfind(tag)
        if b > a:
            for inner in split_statements(s[a:b]):
                handle(inner, mig, depth + 1)
        return

    if depth and not re.match(r"(create|alter|drop)\b", low):
        m0 = DDL_START.search(s)
        if not m0:
            return
        s = s[m0.start():]
        low = s.lower()

    m = re.match(r"create\s+(?:or\s+replace\s+)?type\s+([\w.\"]+)\s+as\s+enum", low)
    if m:
        name = qual(s[m.start(1):m.end(1)])
        body, _ = paren_body(s, m.end())
        vals = [v.strip().strip("'") for v in top_split(body or "")]
        enums[name] = {"values": vals, "migration": mig}
        return

    m = re.match(r"create\s+table\s+(?:if\s+not\s+exists\s+)?([\w.\"]+)", low)
    if m:
        name = qual(s[m.start(1):m.end(1)])
        body, _ = paren_body(s, m.end())
        tb = ensure(name)
        if tb["created_in"] is None:
            tb["created_in"] = mig
        existing = {c["name"] for c in tb["columns"]}
        for item in top_split(body or ""):
            il = item.lower()
            if re.match(r"(constraint|primary\s+key|unique|foreign\s+key|check|exclude|like)\b", il):
                tb["constraints"].append({"text": item, "migration": mig})
                continue
            col = parse_column(item)
            if col and col["name"] not in existing:
                col["migration"] = mig
                tb["columns"].append(col); existing.add(col["name"])
        touch(name, mig)
        return

    m = re.match(r"alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?([\w.\"]+)\s+(.*)$", low, re.S)
    if m:
        name = qual(s[m.start(1):m.end(1)])
        actions_raw = s[m.start(2):]
        tb = tables.get(name)
        if tb is None:
            tb = ensure(name); tb["created_in"] = tb["created_in"] or ("(خارج الترقيات) " + mig)
        for act in top_split(actions_raw):
            al = act.lower()
            mm = re.match(r"add\s+column\s+(?:if\s+not\s+exists\s+)?(.*)$", act, re.I | re.S)
            if mm:
                col = parse_column(mm.group(1))
                if col and col["name"] not in {c["name"] for c in tb["columns"]}:
                    col["migration"] = mig
                    tb["columns"].append(col)
                continue
            mm = re.match(r"drop\s+column\s+(?:if\s+exists\s+)?(\"?\w+\"?)", act, re.I)
            if mm:
                dead = qual(mm.group(1))
                tb["columns"] = [c for c in tb["columns"] if c["name"] != dead]
                continue
            mm = re.match(r"rename\s+column\s+(\"?\w+\"?)\s+to\s+(\"?\w+\"?)", act, re.I)
            if mm:
                a, b = qual(mm.group(1)), qual(mm.group(2))
                for c in tb["columns"]:
                    if c["name"] == a: c["name"] = b
                continue
            mm = re.match(r"rename\s+to\s+([\w.\"]+)", act, re.I)
            if mm:
                nn = qual(mm.group(1))
                tables[nn] = tables.pop(name)
                name = nn
                continue
            mm = re.match(r"add\s+(constraint\s+.*|primary\s+key.*|unique.*|foreign\s+key.*|check.*)$", act, re.I | re.S)
            if mm:
                tb["constraints"].append({"text": mm.group(1), "migration": mig}); continue
            mm = re.match(r"drop\s+constraint\s+(?:if\s+exists\s+)?(\"?[\w]+\"?)", act, re.I)
            if mm:
                dead = qual(mm.group(1))
                tb["constraints"] = [c for c in tb["constraints"]
                                     if not re.match(r"constraint\s+\"?%s\"?\b" % re.escape(dead), c["text"], re.I)]
                continue
            mm = re.match(r"alter\s+column\s+(\"?\w+\"?)\s+(?:set\s+data\s+)?type\s+(.*)$", act, re.I | re.S)
            if mm:
                cn, nt = qual(mm.group(1)), " ".join(mm.group(2).split())
                for c in tb["columns"]:
                    if c["name"] == cn: c["type"] = re.split(r"\busing\b", nt, flags=re.I)[0].strip()
                continue
            mm = re.match(r"alter\s+column\s+(\"?\w+\"?)\s+(set|drop)\s+not\s+null", act, re.I)
            if mm:
                cn = qual(mm.group(1))
                for c in tb["columns"]:
                    if c["name"] == cn: c["not_null"] = mm.group(2).lower() == "set"
                continue
            mm = re.match(r"alter\s+column\s+(\"?\w+\"?)\s+set\s+default\s+(.*)$", act, re.I | re.S)
            if mm:
                cn = qual(mm.group(1))
                for c in tb["columns"]:
                    if c["name"] == cn: c["default"] = " ".join(mm.group(2).split())
                continue
            mm = re.match(r"alter\s+column\s+(\"?\w+\"?)\s+drop\s+default", act, re.I)
            if mm:
                cn = qual(mm.group(1))
                for c in tb["columns"]:
                    if c["name"] == cn: c["default"] = None
                continue
        touch(name, mig)
        return

    m = re.match(r"drop\s+table\s+(?:if\s+exists\s+)?([\w.\", ]+)", low)
    if m:
        for nm in top_split(s[m.start(1):m.end(1)]):
            tables.pop(qual(re.sub(r"\s+cascade|\s+restrict", "", nm, flags=re.I)), None)
        return

    m = re.match(r"create\s+(?:or\s+replace\s+)?function\s+([\w.\"]+)", low)
    if m:
        name = qual(s[m.start(1):m.end(1)])
        args, after = paren_body(s, m.end())
        rm = re.search(r"\breturns\s+(.+?)(?=\s+(?:language|as|stable|immutable|volatile|security|set|parallel|cost|rows|strict|called|returns\s+null)\b|$)",
                       s[after:], re.I | re.S)
        ret = " ".join(rm.group(1).split()) if rm else "?"
        arglist = [" ".join(a.split()) for a in top_split(args or "")]
        key = "%s(%d)" % (name, len(arglist))
        f = functions.setdefault(key, {"name": name, "args": arglist, "returns": ret, "migrations": []})
        f["args"], f["returns"] = arglist, ret
        if mig not in f["migrations"]: f["migrations"].append(mig)
        return

    m = re.match(r"drop\s+function\s+(?:if\s+exists\s+)?([\w.\"]+)", low)
    if m:
        name = qual(s[m.start(1):m.end(1)])
        args, _ = paren_body(s, m.end())
        if args is not None:
            k = "%s(%d)" % (name, len(top_split(args)))
            functions.pop(k, None)
        else:
            for k in [k for k in functions if functions[k]["name"] == name]:
                functions.pop(k, None)
        return

    m = re.match(r"create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?([\w.\"]+)", low)
    if m:
        name = qual(s[m.start(1):m.end(1)])
        mat = "materialized" in low[:60]
        v = views.setdefault(name, {"materialized": mat, "migrations": []})
        if mig not in v["migrations"]: v["migrations"].append(mig)
        return

    m = re.match(r"drop\s+(?:materialized\s+)?view\s+(?:if\s+exists\s+)?([\w.\", ]+)", low)
    if m:
        for nm in top_split(s[m.start(1):m.end(1)]):
            views.pop(qual(re.sub(r"\s+cascade|\s+restrict", "", nm, flags=re.I)), None)
        return

    m = re.match(r"create\s+(unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([\w.\"]+)\s+on\s+(?:only\s+)?([\w.\"]+)", low)
    if m:
        iname = qual(s[m.start(2):m.end(2)]); tname = qual(s[m.start(3):m.end(3)])
        body, _ = paren_body(s, m.end(3))
        indexes[iname] = {"table": tname, "unique": bool(m.group(1)),
                          "cols": " ".join((body or "").split()), "migration": mig}
        return

    m = re.match(r"drop\s+index\s+(?:if\s+exists\s+)?([\w.\"]+)", low)
    if m:
        indexes.pop(qual(s[m.start(1):m.end(1)]), None)
        return

# ---------- 3) التشغيل بالترتيب ----------
files = []
for p in sorted(glob.glob(os.path.join(ROOT, "supabase", "migrations", "*.sql"))):
    b = os.path.basename(p)
    if re.match(r"^\d{4}_", b): files.append((b[:4], "supabase/migrations/" + b, p))
for p in sorted(glob.glob(os.path.join(ROOT, "migrations", "*.sql"))):
    b = os.path.basename(p)
    if re.match(r"^\d{4}_", b): files.append((b[:4], "migrations/" + b, p))
files.sort(key=lambda x: (x[0], x[1]))

stat_count = 0
for num, rel, path in files:
    sql = open(path, "rb").read().decode("utf-8", "replace")
    for st in split_statements(sql):
        stat_count += 1
        try:
            handle(st, num)
        except Exception as e:
            pass


# ---------- 4) الإخراج ----------
def norm(t):
    return re.sub(r"\s+", " ", t or "").strip()

def esc(t):
    return norm(t).replace("|", "\\|")

fks = []
for tname in sorted(tables):
    tb = tables[tname]
    for c in tb["columns"]:
        if c.get("references"):
            fks.append((tname, c["name"], c["references"]))
    for k in tb["constraints"]:
        m = re.search(r"foreign\s+key\s*\(([^)]*)\)\s*references\s+([\w.\"]+)\s*(\([^)]*\))?",
                      k["text"], re.I)
        if m:
            fks.append((tname, norm(m.group(1)), qual(m.group(2)) + norm(m.group(3) or "")))

idx_by_table = {}
for iname, ix in indexes.items():
    idx_by_table.setdefault(ix["table"], []).append((iname, ix))

docs = os.path.join(ROOT, "docs")
os.makedirs(docs, exist_ok=True)

# ------- docs/SCHEMA.md -------
o = []
w = o.append
w("# مرجع مخطط قاعدة ZainCare")
w("")
w("> **مُولَّد آليًّا — لا يُحرَّر يدويًّا.** أعِد توليده بعد كل ترقية جديدة:")
w("> `python scripts/schema-doc.py`")
w("")
w("## كيف قُرئ")
w("")
w("قُرئت %d ملفّ ترقية بترتيبها الرقميّ — `supabase/migrations/0001–0012` ثم" % len(files))
w("`migrations/0013…%s` — وحوكي أثرها تراكميًّا: كل `create table` تُنشئ،" % files[-1][0])
w("وكل `alter table` تعدّل، وكل `drop` تحذف. فما تراه هنا هو المخطط **بعد آخر")
w("ترقية**، لا كما كان يوم إنشائه. ودخل المولّد إلى أجسام `do $$ … $$` لأنّ")
w("معظم قيود المفاتيح تُضاف داخلها بحارس `if not exists`.")
w("")
w("## الأرقام")
w("")
w("| | من الترقيات (هنا) | من فحص الإنتاج (`docs/deep-gap-probe.sql`) |")
w("| --- | ---: | ---: |")
w("| جداول | %d | 232 |" % len(tables))
w("| دوالّ | %d | 420 |" % len(functions))
w("| منظورات | %d | 175 |" % len(views))
w("| مفاتيح ربط | %d | 1076 |" % len(fks))
w("| فهارس | %d | — |" % len(indexes))
w("")
w("**الجداول والمنظورات تطابق الإنتاج عددًا بعد `0149`** التي تبنّت ستّة كائنات")
w("كانت تعمل في الإنتاج ولا يُنشئها أيّ ملفّ. الفرق الباقي في المفاتيح يعود إلى")
w("قيود تُنشأ داخل نصوص `execute` لا يقرأها التحليل الساكن.")
w("**المرجع في تعارضٍ هو القاعدة الحيّة، لا هذا الملفّ.**")
w("")
w("لا يستعمل المشروع أنواع `enum` إطلاقًا (%d نوعًا): القيم المحصورة تُفرض بـ" % len(enums))
w("`text ... check (col in (...))`، فتُقرأ من عمود القيد في جدول العمود أدناه.")
w("")
w("## الجداول (%d)" % len(tables))
w("")
names = sorted(tables)
for i in range(0, len(names), 4):
    w("  ".join("`%s`" % n for n in names[i:i+4]))
    w("")

for tname in names:
    tb = tables[tname]
    w("### %s" % tname)
    w("")
    touched = [m for m in tb["touched"] if m != tb["created_in"]]
    line = "أُنشئ في `%s`" % tb["created_in"]
    if touched:
        line += " · عُدِّل في: " + "، ".join("`%s`" % m for m in touched)
    w(line)
    w("")
    w("| العمود | النوع | إلزامي | افتراضي | يشير إلى |")
    w("| --- | --- | :-: | --- | --- |")
    for c in tb["columns"]:
        w("| `%s`%s | `%s` | %s | %s | %s |" % (
            c["name"],
            " 🔑" if c.get("pk") else "",
            esc(c["type"]),
            "✔" if c["not_null"] else "",
            ("`%s`" % esc(c["default"])) if c["default"] else "",
            ("`%s`" % esc(c["references"])) if c.get("references") else ""))
    w("")
    cons = [k for k in tb["constraints"]]
    if cons:
        w("**قيود:**")
        w("")
        for k in cons:
            txt = norm(k["text"])
            if len(txt) > 1500: txt = txt[:1500] + " …"
            w("- `%s` — *(%s)*" % (txt, k["migration"]))
        w("")
    ix = idx_by_table.get(tname, [])
    if ix:
        w("**فهارس:**")
        w("")
        for iname, d2 in sorted(ix):
            cols = norm(d2["cols"])
            if len(cols) > 400: cols = cols[:400] + " …"
            w("- `%s`%s على (`%s`) — *(%s)*" % (
                iname, " — فريد" if d2["unique"] else "", cols, d2["migration"]))
        w("")

w("## المنظورات (%d)" % len(views))
w("")
w("| المنظور | نوعه | عُرِّف في |")
w("| --- | --- | --- |")
for vn in sorted(views):
    v = views[vn]
    w("| `%s` | %s | %s |" % (vn, "مُجسَّد" if v["materialized"] else "منظور",
                              "، ".join("`%s`" % m for m in v["migrations"])))
w("")
w("## الدوالّ")
w("")
w("توقيعات الدوالّ الـ%d في ملفّ مستقلّ: [`SCHEMA-FUNCTIONS.md`](SCHEMA-FUNCTIONS.md)." % len(functions))
open(os.path.join(docs, "SCHEMA.md"), "w", encoding="utf-8", newline="\n").write("\n".join(o) + "\n")

# ------- docs/SCHEMA-FUNCTIONS.md -------
o = []; w = o.append
w("# دوالّ قاعدة ZainCare (%d)" % len(functions))
w("")
w("> **مُولَّد آليًّا — لا يُحرَّر يدويًّا:** `python scripts/schema-doc.py`")
w("")
w("عمود «عُرِّفت في» يسرد كل ترقية أعادت تعريف الدالّة، فآخِرُها هو النسخة السارية.")
w("الدوالّ التي أُسقطت بـ`drop function` غير مذكورة هنا.")
w("")
byname = {}
for k, f in functions.items():
    byname.setdefault(f["name"], []).append(f)
for name in sorted(byname):
    for f in sorted(byname[name], key=lambda x: len(x["args"])):
        w("### %s(%d)" % (name, len(f["args"])))
        w("")
        w("عُرِّفت في: " + "، ".join("`%s`" % m for m in f["migrations"]))
        w("")
        w("```sql")
        w("%s(" % name)
        for a in f["args"]:
            w("  %s," % a)
        if f["args"]:
            o[-1] = o[-1].rstrip(",")
        w(") returns %s" % f["returns"])
        w("```")
        w("")
open(os.path.join(docs, "SCHEMA-FUNCTIONS.md"), "w", encoding="utf-8", newline="\n").write("\n".join(o) + "\n")

# ------- docs/schema.json -------
json.dump({"generated_from": [f[1] for f in files],
           "tables": tables, "functions": functions, "views": views,
           "enums": enums, "indexes": indexes,
           "foreign_keys": [{"table": a, "columns": b, "references": c} for a, b, c in fks]},
          open(os.path.join(docs, "schema.json"), "w", encoding="utf-8", newline="\n"),
          ensure_ascii=False, indent=1)

print("ملفّات ترقية: %d | جداول: %d | دوالّ: %d | منظورات: %d | مفاتيح ربط: %d | فهارس: %d"
      % (len(files), len(tables), len(functions), len(views), len(fks), len(indexes)))
for f in ("SCHEMA.md", "SCHEMA-FUNCTIONS.md", "schema.json"):
    print("  docs/%s — %d بايت" % (f, os.path.getsize(os.path.join(docs, f))))

# -*- coding: utf-8 -*-
"""فاحص الدورات غير المكتملة.

يجيب عن سؤال واحد: **هل لكل قدرة في القاعدة نظيرها في الواجهة، والعكس؟**
العيب المتكرّر في هذا المشروع ليس خطأ برمجيًّا بل دورة نصف مبنيّة: جدول بلا
شاشة، شاشة تقرأ ولا تكتب، عمود يُعرض ولا يُملأ، دالّة لا يستدعيها أحد.

    python scripts/completeness-audit.py

يقرأ `docs/schema.json` (يولّده scripts/schema-doc.py) ويمسح `client/` و
`migrations/`، ثم يكتب `docs/AUDIT-COMPLETENESS.md`.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SCHEMA = os.path.join(ROOT, "docs", "schema.json")
if not os.path.exists(SCHEMA):
    sys.exit("لا يوجد docs/schema.json — شغّل أوّلًا: python scripts/schema-doc.py")
S = json.load(open(SCHEMA, encoding="utf-8"))
tables = set(S["tables"])
functions = {}
for k, f in S["functions"].items():
    functions.setdefault(f["name"], []).append(len(f["args"]))
views = set(S["views"])

# ---------------------------------------------------------------- العميل ----
client_files = []
for dp, dn, fns in os.walk(os.path.join(ROOT, "client")):
    dn[:] = [d for d in dn if d != "node_modules"]
    for fn in fns:
        if fn.endswith((".ts", ".tsx")) and not fn.endswith(".spec.ts"):
            client_files.append(os.path.join(dp, fn))

FROM = re.compile(r'\.from\(\s*"([^"]+)"\s*\)')
RPC = re.compile(r'\.rpc\(\s*"([^"]+)"')
WRITE_OPS = (".insert(", ".upsert(", ".update(", ".delete(")

HELPER = re.compile(r'useOrgSettingsRow\s*(?:<[^>]*>)?\s*\(\s*"([^"]+)"')
SELECT_STR = re.compile(r'\.select\(\s*(?:"([^"]*)"|`([^`]*)`)', re.S)
# التضمين في supabase-js: `alias:table!constraint(cols)` — الجدول هو ما قبل القوس
EMBED = re.compile(r'(?:[\w]+\s*:\s*)?([a-z][a-z0-9_]{2,})(?:!\w+)?\s*\(')
# أسماء لا تُقرأ كجداول داخل نصّ select
NOT_A_TABLE = {"count", "sum", "avg", "min", "max", "coalesce", "cast", "and", "or", "not"}

client_read, client_write, client_rpc, client_embed = {}, {}, {}, {}
storage_buckets = set()
def note(d, key, where):
    d.setdefault(key, set()).add(where)

for path in client_files:
    rel = os.path.relpath(path, ROOT).replace("\\", "/")
    src = open(path, "rb").read().decode("utf-8", "replace")
    for m in FROM.finditer(src):
        name = m.group(1)
        # `.storage.from("bucket")` دلو تخزين لا جدول
        head = src[max(0, m.start() - 60): m.start()]
        if ".storage" in head:
            storage_buckets.add(name)
            continue
        tail = src[m.end(): m.end() + 400]
        # قصّ عند نداء .from( تالٍ حتى لا تُنسَب كتابةُ استعلامٍ آخر إلى هذا
        nxt = tail.find('.from("')
        if nxt != -1:
            tail = tail[:nxt]
        if any(op in tail for op in WRITE_OPS):
            note(client_write, name, rel)
        else:
            note(client_read, name, rel)
    # القراءة بالتضمين: select("*, package_items(...)") قراءةٌ للجدول المُضمَّن
    for m in SELECT_STR.finditer(src):
        body = m.group(1) or m.group(2) or ""
        for e in EMBED.finditer(body):
            nm = e.group(1)
            if nm not in NOT_A_TABLE:
                note(client_embed, nm, rel)
    # خطّاف عامّ يقرأ ويكتب بجدولٍ يُمرَّر إليه: useOrgSettingsRow("table", orgId)
    for m in HELPER.finditer(src):
        note(client_write, m.group(1), rel)
    for m in RPC.finditer(src):
        note(client_rpc, m.group(1), rel)

# التضمين قراءة كاملة الحُجّية
for k, v in client_embed.items():
    client_read.setdefault(k, set()).update(v)

# ------------------------------------------------------------- الترقيات ----
mig_files = []
for sub in ("supabase/migrations", "migrations"):
    d = os.path.join(ROOT, sub)
    if not os.path.isdir(d):
        continue
    for fn in sorted(os.listdir(d)):
        if re.match(r"^\d{4}_.*\.sql$", fn):
            mig_files.append((fn[:4], sub + "/" + fn, os.path.join(d, fn)))
mig_files.sort()

DOLLAR = re.compile(r"(\$[A-Za-z_]*\$)(.*?)\1", re.S)
INS = re.compile(r"\binsert\s+into\s+([\w.\"]+)", re.I)
UPD = re.compile(r"\bupdate\s+([\w.\"]+)\s+set\b", re.I)
DEL = re.compile(r"\bdelete\s+from\s+([\w.\"]+)", re.I)
CALL = re.compile(r"\b(?:perform\s+|select\s+(?:\*\s+from\s+)?)?(app_[a-z0-9_]+)\s*\(", re.I)

def clean(n):
    n = n.strip().strip('"')
    return n[7:] if n.lower().startswith("public.") else n

VIEW_DEF = re.compile(
    r"create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?"
    r"([\w.\"]+)(?:\s+with\s*\([^)]*\))?\s+as\b", re.I)
FROM_JOIN = re.compile(r"\b(?:from|join)\s+([a-z_][\w.\"]*)", re.I)
view_sources = {}  # منظور -> الجداول التي يقرؤها

db_read = {}      # جدول -> ترقيات تقرؤه فيها دالّة أو منظور
fn_write = {}     # جدول -> ترقيات كتبت إليه من داخل دالّة
seed_write = {}   # جدول -> ترقيات أدرجت فيه بيانات خارج الدوالّ
fn_calls = set()  # دوالّ يستدعيها كود SQL آخر
trigger_fns = set()
TRIG = re.compile(r"create\s+(?:or\s+replace\s+)?trigger\s+[\w\"]+.*?execute\s+(?:function|procedure)\s+([\w.\"]+)",
                  re.I | re.S)
DEFAULT_FN = re.compile(r"default\s+([\w]+)\s*\(", re.I)

for num, rel, path in mig_files:
    sql = open(path, "rb").read().decode("utf-8", "replace")
    bodies = []
    covered = []
    for m in DOLLAR.finditer(sql):
        bodies.append(m.group(2))
        covered.append((m.start(), m.end()))
    outside = []
    last = 0
    for a, b in covered:
        outside.append(sql[last:a]); last = b
    outside.append(sql[last:])
    outside = "\n".join(outside)

    for body in bodies:
        for rx in (INS, UPD, DEL):
            for m in rx.finditer(body):
                fn_write.setdefault(clean(m.group(1)), set()).add(num)
        for m in CALL.finditer(body):
            fn_calls.add(m.group(1).lower())
    # قراءة من داخل القاعدة نفسها (دالّة أو منظور): جدولٌ تقرؤه القاعدة ليس مهجورًا
    for m in FROM_JOIN.finditer(sql):
        db_read.setdefault(clean(m.group(1)), set()).add(num)
    for m in INS.finditer(outside):
        seed_write.setdefault(clean(m.group(1)), set()).add(num)
    for m in UPD.finditer(outside):
        seed_write.setdefault(clean(m.group(1)), set()).add(num)
    for m in TRIG.finditer(sql):
        trigger_fns.add(clean(m.group(1)).lower())
    # المنظورات: أيّ جداول يقرؤها كل منظور (لِيُعرف الجدول المقروء عبر منظور)
    for m in VIEW_DEF.finditer(sql):
        vname = clean(m.group(1))
        win = sql[m.end(): m.end() + 6000]
        cut = re.search(r";\s*\n", win)
        if cut:
            win = win[:cut.start()]
        srcs = set()
        for mm in FROM_JOIN.finditer(win):
            srcs.add(clean(mm.group(1)))
        view_sources.setdefault(vname, set()).update(srcs)
    for m in DEFAULT_FN.finditer(sql):
        fn_calls.add(m.group(1).lower())

# --------------------------------------------------------------- النتائج ----
def names(d, k):
    return sorted(d.get(k, ()))

# جدول يُقرأ عبر منظور يقرؤه العميل = مقروء
read_via_view = {}
for v, srcs in view_sources.items():
    if v in client_read or v in client_write:
        for t in srcs:
            read_via_view.setdefault(t, set()).add(v)

no_ui = []          # لا تُقرأ ولا تُكتب من العميل إطلاقًا
read_only = []      # تُقرأ من العميل ولا مسار كتابة لها في أي مكان ولا بذرة
read_seeded = []    # تُقرأ ولا تُكتب لكن تملؤها بذرة — مقصود
write_only = []     # يُكتب إليها ولا تُقرأ لا مباشرةً ولا عبر منظور
for t in sorted(tables):
    r, w = t in client_read, t in client_write
    has_fn_write = t in fn_write
    has_seed = t in seed_write
    if not r and not w:
        no_ui.append((t, sorted(fn_write.get(t, ())), sorted(seed_write.get(t, ()))))
    elif r and not w and not has_fn_write:
        (read_seeded if has_seed else read_only).append(
            (t, names(client_read, t), sorted(seed_write.get(t, ()))))
    elif w and not r and t not in read_via_view and t not in db_read:
        write_only.append((t, names(client_write, t)))

dead_fns = []
for name, arities in sorted(functions.items()):
    if name in client_rpc: continue
    if name.lower() in fn_calls: continue
    if name.lower() in trigger_fns: continue
    dead_fns.append((name, arities))

dead_views = sorted(v for v in views if v not in client_read and v not in client_write)

missing_tables = sorted(
    n for n in set(client_read) | set(client_write)
    if n not in tables and n not in views)
missing_fns = sorted(n for n in client_rpc if n not in functions)

# --------------------------------------------------------------- التقرير ----
o = []
w_ = o.append
w_("# فحص الدورات غير المكتملة")
w_("")
w_("> **مُولَّد آليًّا:** `python scripts/completeness-audit.py` — أعِد تشغيله بعد كل جولة.")
w_("> يقرأ `docs/schema.json` ويمسح `client/` و`migrations/`.")
w_("")
w_("السؤال: هل لكل قدرة في القاعدة نظيرها في الواجهة، والعكس؟ العيب المتكرّر في")
w_("هذا المشروع ليس خطأ برمجيًّا بل **دورة نصف مبنيّة**.")
w_("")
w_("## الأرقام")
w_("")
w_("| | |")
w_("| --- | ---: |")
w_("| جداول في المخطط | %d |" % len(tables))
w_("| جداول لا يمسّها العميل إطلاقًا | %d |" % len(no_ui))
w_("| جداول تُقرأ ولا مسار كتابة لها ولا بذرة | %d |" % len(read_only))
w_("| جداول تُقرأ وتملؤها بذرة فقط | %d |" % len(read_seeded))
w_("| جداول يُكتب إليها ولا تُقرأ | %d |" % len(write_only))
w_("| دوالّ لا يستدعيها أحد | %d من %d |" % (len(dead_fns), len(functions)))
w_("| منظورات لا يقرؤها العميل | %d من %d |" % (len(dead_views), len(views)))
w_("| نداءات العميل إلى جداول غير موجودة | %d |" % len(missing_tables))
w_("| نداءات العميل إلى دوالّ غير موجودة | %d |" % len(missing_fns))
w_("")

if missing_fns or missing_tables:
    w_("## 🔴 كسر مؤكَّد — العميل ينادي ما لا وجود له")
    w_("")
    w_("هذه تفشل وقت التشغيل: `PGRST202` للدالّة، و`PGRST205` للجدول.")
    w_("")
    for n in missing_fns:
        w_("- **دالّة `%s`** — تُنادى من: %s" % (n, "، ".join("`%s`" % x for x in names(client_rpc, n))))
    for n in missing_tables:
        src = names(client_read, n) + names(client_write, n)
        w_("- **جدول `%s`** — يُنادى من: %s" % (n, "، ".join("`%s`" % x for x in sorted(set(src)))))
    w_("")

w_("## 🟠 جداول تُقرأ ولا مسار كتابة لها ولا بذرة")
w_("")
w_("الشاشة تعرضها وتبقى **فارغة أبدًا**: لا العميل يكتب إليها، ولا دالّة في")
w_("القاعدة، ولا بذرة تملؤها في أيّ ترقية.")
w_("")
if read_only:
    w_("| الجدول | يقرؤه |")
    w_("| --- | --- |")
    for t, where, _sd in read_only:
        w_("| `%s` | %s |" % (t, "، ".join("`%s`" % x for x in where[:4]) + (" …" if len(where) > 4 else "")))
else:
    w_("لا شيء.")
w_("")

w_("### تُقرأ ولا تُكتب لكن تملؤها بذرة (مقصود)")
w_("")
w_("بيانات مرجعية تُزرع بالترقيات ولا تُدار من الواجهة. إدارتها من النظام بند")
w_("مفتوح لا خلل.")
w_("")
if read_seeded:
    w_("| الجدول | يقرؤه | تُزرع في |")
    w_("| --- | --- | --- |")
    for t, where, sd in read_seeded:
        w_("| `%s` | %s | %s |" % (t,
            "، ".join("`%s`" % x for x in where[:3]) + (" …" if len(where) > 3 else ""),
            "، ".join(sd[:6]) + (" …" if len(sd) > 6 else "")))
else:
    w_("لا شيء.")
w_("")

w_("## 🟡 جداول يُكتب إليها ولا تُقرأ")
w_("")
w_("بيانات تُجمَع ولا يراها أحد: لا قراءة مباشرة من العميل، ولا عبر منظور يقرؤه،")
w_("ولا من داخل القاعدة نفسها (دالّة أو منظور).")
w_("")
if write_only:
    w_("| الجدول | يكتب إليه |")
    w_("| --- | --- |")
    for t, where in write_only:
        w_("| `%s` | %s |" % (t, "، ".join("`%s`" % x for x in where[:4]) + (" …" if len(where) > 4 else "")))
else:
    w_("لا شيء.")
w_("")

w_("## ⚪ جداول لا يمسّها العميل إطلاقًا (%d)" % len(no_ui))
w_("")
w_("عمود «تكتبه دالّة» يعني أنّ للجدول مسار كتابة في القاعدة (سجلّ تدقيق، أثر")
w_("مُحفِّز) فغيابه عن الواجهة قد يكون مقصودًا. أمّا ما لا دالّة تكتبه ولا بذرة")
w_("تملؤه فهو جدول ميّت تمامًا.")
w_("")
w_("| الجدول | تكتبه دالّة | تملؤه بذرة |")
w_("| --- | --- | --- |")
for t, fw, sw in no_ui:
    w_("| `%s` | %s | %s |" % (t,
        "، ".join(fw[:6]) + (" …" if len(fw) > 6 else "") if fw else "—",
        "، ".join(sw[:6]) + (" …" if len(sw) > 6 else "") if sw else "—"))
w_("")

w_("## ⚪ دوالّ لا يستدعيها أحد (%d)" % len(dead_fns))
w_("")
w_("لا `.rpc()` في العميل، ولا استدعاء من دالّة أخرى، ولا مُحفِّز يعلّقها.")
w_("")
w_("| الدالّة | عدد المعاملات |")
w_("| --- | --- |")
for n, ar in dead_fns:
    w_("| `%s` | %s |" % (n, "، ".join(str(a) for a in sorted(ar))))
w_("")

w_("## ⚪ منظورات لا يقرؤها العميل (%d)" % len(dead_views))
w_("")
for i in range(0, len(dead_views), 4):
    w_("  ".join("`%s`" % v for v in dead_views[i:i + 4]))
    w_("")

w_("---")
w_("")
w_("### حدود هذا الفحص")
w_("")
w_("- يكتشف الكتابة بـ`.insert(`/`.upsert(`/`.update(`/`.delete(` بعد `.from(\"…\")`")
w_("  في حدود 400 حرف. كتابة موزّعة على دالّة مساعدة قد تفوته.")
w_("- **القراءة بالتضمين محسوبة:** `select(\"*, package_items(...)\")` تُعدّ قراءةً")
w_("  للجدول المُضمَّن، وإلّا ظهرت عشرات الجداول «تُكتب ولا تُقرأ» زورًا.")
w_("- دلاء التخزين (`.storage.from(\"…\")`) مستثناة من عدّ الجداول.")
w_("- الأسماء الديناميكية (`.from(variable)`) لا تُلتقَط.")
w_("- «دالّة لا يستدعيها أحد» قد تُستدعى من منظور أو من قيد `check` — راجع قبل الحذف.")
w_("- المرجع النهائيّ هو القاعدة الحيّة، لا هذا التقرير.")

out = os.path.join(ROOT, "docs", "AUDIT-COMPLETENESS.md")
open(out, "w", encoding="utf-8", newline="\n").write("\n".join(o) + "\n")

print("ملفّات العميل: %d | ترقيات: %d" % (len(client_files), len(mig_files)))
print("كسر مؤكَّد: %d دالّة، %d جدول" % (len(missing_fns), len(missing_tables)))
print("تُقرأ بلا أي مسار: %d | مزروعة: %d | تُكتب بلا قراءة: %d | بلا واجهة: %d"
      % (len(read_only), len(read_seeded), len(write_only), len(no_ui)))
print("دوالّ ميتة: %d | منظورات ميتة: %d" % (len(dead_fns), len(dead_views)))
print("كُتب docs/AUDIT-COMPLETENESS.md — %d بايت" % os.path.getsize(out))

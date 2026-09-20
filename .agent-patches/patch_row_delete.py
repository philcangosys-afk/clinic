# -*- coding: utf-8 -*-
"""زرّ الحذف مع إجراءات الصفّ، وتحديدٌ متعدّد — في المرضى والأطباء والخدمات.

ثلاث شاشات، ونمطٌ واحد:
  • عمود تحديد في أوّل الجدول، ومربّعٌ في الرأس يحدّد المعروض كلّه.
  • زرّ سلّة مع إجراءات الصفّ.
  • شريطٌ يظهر عند التحديد: «حذف المحدَّد (٣)».
  • ونافذةٌ واحدة (`DeleteRowsDialog`) تعرض ما سيُحذف **بأعدادٍ حقيقية** قبل
    التنفيذ — القاعدة تُنفّذ ثمّ تتراجع.

**والحذف لصاحب المنشأة ومسؤولها وحدهما**، والقاعدة تفرضه لا الشاشة — فإخفاء
الزرّ راحةٌ للعين لا حراسة.
"""
import sys


def patch(path, edits, label):
    raw = open(path, "rb").read()
    nl = "\r\n" if b"\r\n" in raw else "\n"
    src = raw.decode("utf-8").replace("\r\n", "\n")
    for old, new, name in edits:
        if src.count(old) != 1:
            sys.exit("ANCHOR %s/%s: count=%d" % (label, name, src.count(old)))
        src = src.replace(old, new, 1)
    open(path, "wb").write(src.replace("\n", nl).encode("utf-8"))
    print("%s: %d edits applied, NL=%r" % (path, len(edits), nl))


IMPORTS = (
    'import { Checkbox } from "@/components/ui/checkbox";\n'
    'import DeleteRowsDialog, { useRowSelection } from '
    '"@/components/shared/DeleteRowsDialog";'
)

BULK_BAR = """      {canPurge && selection.selected.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm">
          <span>
            المحدَّد: <span className="font-semibold tabular-nums">{selection.selected.length}</span>
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={selection.clear}>
              إلغاء التحديد
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setDeleteIds(selection.selected)}>
              <Trash2 className="h-3.5 w-3.5" />
              حذف المحدَّد
            </Button>
          </div>
        </div>
      )}
"""

# ═══════════════════════════════════════════════════════════════════════════
# ١) المرضى
# ═══════════════════════════════════════════════════════════════════════════
patch(
    "client/pages/Patients.tsx",
    [
        (
            'import { GridFooterCount, ScreenToolbar } from "@/components/shell/ScreenToolbar";',
            'import { GridFooterCount, ScreenToolbar } from "@/components/shell/ScreenToolbar";\n'
            + IMPORTS,
            "imports",
        ),
        (
            """                  <TableHead>#الملف</TableHead>
                  <TableHead>الاسم</TableHead>""",
            """                  {canPurge && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={list.length > 0 && list.every((row: any) => selection.isSelected(row.id))}
                        onCheckedChange={() => selection.toggleAll(list.map((row: any) => row.id))}
                        aria-label="تحديد الكل"
                      />
                    </TableHead>
                  )}
                  <TableHead>#الملف</TableHead>
                  <TableHead>الاسم</TableHead>""",
            "head",
        ),
        (
            """                  <TableRow key={patient.id}>
                    <TableCell className="font-mono text-xs">#{patient.file_number}</TableCell>""",
            """                  <TableRow key={patient.id}>
                    {canPurge && (
                      <TableCell>
                        <Checkbox
                          checked={selection.isSelected(patient.id)}
                          onCheckedChange={() => selection.toggle(patient.id)}
                          aria-label={`تحديد ${patient.name_ar}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-mono text-xs">#{patient.file_number}</TableCell>""",
            "row_checkbox",
        ),
        (
            """                    <TableCell>
                      <Button size="sm" variant="outline" asChild>
                        <Link to={`/patients/${patient.id}`}>
                          <UserRound className="h-3.5 w-3.5" />
                          فتح الملف
                        </Link>
                      </Button>
                    </TableCell>""",
            """                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="outline" asChild>
                          <Link to={`/patients/${patient.id}`}>
                            <UserRound className="h-3.5 w-3.5" />
                            فتح الملف
                          </Link>
                        </Button>
                        {canPurge && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            title="حذف نهائيّ"
                            onClick={() => setDeleteIds([patient.id])}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>""",
            "row_actions",
        ),
        (
            """                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">""",
            """                    <TableCell colSpan={canPurge ? 9 : 8} className="py-8 text-center text-sm text-muted-foreground">""",
            "colspan",
        ),
    ],
    "Patients",
)

# ═══════════════════════════════════════════════════════════════════════════
# ٢) الأطباء
# ═══════════════════════════════════════════════════════════════════════════
patch(
    "client/pages/Doctors.tsx",
    [
        (
            'import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";',
            'import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";\n'
            + IMPORTS,
            "imports",
        ),
        (
            'import { Plus, Stethoscope, Pencil, CalendarClock, Network } from "lucide-react";',
            'import { Plus, Stethoscope, Pencil, CalendarClock, Network, Trash2 } from "lucide-react";',
            "icon",
        ),
        (
            """                  <TableHead>#الملف</TableHead>
                  <TableHead>الاسم</TableHead>""",
            """                  {canPurge && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={
                          (doctors.data ?? []).length > 0 &&
                          (doctors.data ?? []).every((row: any) => selection.isSelected(row.id))
                        }
                        onCheckedChange={() =>
                          selection.toggleAll((doctors.data ?? []).map((row: any) => row.id))
                        }
                        aria-label="تحديد الكل"
                      />
                    </TableHead>
                  )}
                  <TableHead>#الملف</TableHead>
                  <TableHead>الاسم</TableHead>""",
            "head",
        ),
        (
            """                  <TableRow key={doctor.id}>
                    <TableCell className="font-mono text-xs">#{doctor.file_number}</TableCell>""",
            """                  <TableRow key={doctor.id}>
                    {canPurge && (
                      <TableCell>
                        <Checkbox
                          checked={selection.isSelected(doctor.id)}
                          onCheckedChange={() => selection.toggle(doctor.id)}
                          aria-label={`تحديد ${doctor.name_ar}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-mono text-xs">#{doctor.file_number}</TableCell>""",
            "row_checkbox",
        ),
        (
            """                        <Button
                          size="sm"
                          variant="ghost"
                          title="العيادات والخدمات وجدول العمل"
                          onClick={() => setRelationsTarget({ id: doctor.id, name_ar: doctor.name_ar })}
                        >
                          <Network className="h-3.5 w-3.5" />
                        </Button>""",
            """                        <Button
                          size="sm"
                          variant="ghost"
                          title="العيادات والخدمات وجدول العمل"
                          onClick={() => setRelationsTarget({ id: doctor.id, name_ar: doctor.name_ar })}
                        >
                          <Network className="h-3.5 w-3.5" />
                        </Button>
                        {canPurge && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            title="حذف نهائيّ"
                            onClick={() => setDeleteIds([doctor.id])}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}""",
            "row_actions",
        ),
    ],
    "Doctors",
)

# ═══════════════════════════════════════════════════════════════════════════
# ٣) الخدمات
# ═══════════════════════════════════════════════════════════════════════════
patch(
    "client/pages/Services.tsx",
    [
        (
            'import { GridFooterCount, ScreenToolbar } from "@/components/shell/ScreenToolbar";',
            'import { GridFooterCount, ScreenToolbar } from "@/components/shell/ScreenToolbar";\n'
            + IMPORTS,
            "imports",
        ),
        (
            """  Pencil,
  Plus,""",
            """  Pencil,
  Plus,
  Trash2,""",
            "icon",
        ),
        (
            """                  <TableHead>الكود</TableHead>
                  <TableHead>الاسم</TableHead>""",
            """                  {canPurge && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={
                          (items.data ?? []).length > 0 &&
                          (items.data ?? []).every((row: any) => selection.isSelected(row.id))
                        }
                        onCheckedChange={() =>
                          selection.toggleAll((items.data ?? []).map((row: any) => row.id))
                        }
                        aria-label="تحديد الكل"
                      />
                    </TableHead>
                  )}
                  <TableHead>الكود</TableHead>
                  <TableHead>الاسم</TableHead>""",
            "head",
        ),
        (
            """                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">{item.code}</TableCell>""",
            """                    <TableRow key={item.id}>
                      {canPurge && (
                        <TableCell>
                          <Checkbox
                            checked={selection.isSelected(item.id)}
                            onCheckedChange={() => selection.toggle(item.id)}
                            aria-label={`تحديد ${item.name_ar}`}
                          />
                        </TableCell>
                      )}
                      <TableCell className="font-mono text-xs">{item.code}</TableCell>""",
            "row_checkbox",
        ),
        (
            """                          {canManage && (
                            <Button size="sm" variant="ghost" onClick={() => setArchiveFor(item)}>
                              {item.is_archived ? (
                                <ArchiveRestore className="h-4 w-4" />
                              ) : (
                                <Archive className="h-4 w-4" />
                              )}
                            </Button>
                          )}""",
            """                          {canManage && (
                            <Button size="sm" variant="ghost" onClick={() => setArchiveFor(item)}>
                              {item.is_archived ? (
                                <ArchiveRestore className="h-4 w-4" />
                              ) : (
                                <Archive className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          {/* الأرشفة تُخفي الصنف وتُبقي تاريخه، والحذف يُزيله.
                              الاثنان معًا لأنّ التنظيف قبل التشغيل غير
                              الإخفاء أثناءه. */}
                          {canPurge && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              title="حذف نهائيّ"
                              onClick={() => setDeleteIds([item.id])}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}""",
            "row_actions",
        ),
    ],
    "Services",
)

print("تمّت المرحلة الأولى")

# ═══════════════════════════════════════════════════════════════════════════
# المرحلة الثانية: الحالة والنافذة والشريط في الشاشات الثلاث
# ═══════════════════════════════════════════════════════════════════════════
STATE = """  /**
   * الحذف النهائيّ لصاحب المنشأة ومسؤولها وحدهما — والقاعدة تفرضه (0171)،
   * فإخفاء الزرّ راحةٌ للعين لا حراسة.
   */
  const canPurge =
    legacyMode || ["owner", "organization_admin"].includes(membership?.role_key ?? "");
  const selection = useRowSelection();
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
"""

DIALOG = """      <DeleteRowsDialog
        entity="%s"
        ids={deleteIds}
        names={%s}
        open={deleteIds.length > 0}
        onOpenChange={(next) => !next && setDeleteIds([])}
        onDeleted={selection.clear}
      />
"""

# ── المرضى ──
patch(
    "client/pages/Patients.tsx",
    [
        (
            "  const { organization, session } = useOrganizationAccess();",
            "  const { organization, session, membership, legacyMode } = useOrganizationAccess();\n"
            + STATE,
            "state",
        ),
        (
            """  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6">""",
            """  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6">
"""
            + BULK_BAR
            + (DIALOG % ("patients", "(list ?? []).filter((row: any) => deleteIds.includes(row.id)).map((row: any) => row.name_ar)")),
            "render",
        ),
    ],
    "Patients-2",
)

# ── الأطباء ──
patch(
    "client/pages/Doctors.tsx",
    [
        (
            "  const { organization } = useOrganizationAccess();",
            "  const { organization, membership, legacyMode } = useOrganizationAccess();\n" + STATE,
            "state",
        ),
        (
            """  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">""",
            """  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
"""
            + BULK_BAR
            + (DIALOG % ("doctors", "(doctors.data ?? []).filter((row: any) => deleteIds.includes(row.id)).map((row: any) => row.name_ar)")),
            "render",
        ),
    ],
    "Doctors-2",
)

# ── الخدمات ──
patch(
    "client/pages/Services.tsx",
    [
        (
            "  const { organization, membership, legacyMode } = useOrganizationAccess();",
            "  const { organization, membership, legacyMode } = useOrganizationAccess();\n" + STATE,
            "state",
        ),
        (
            """  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6">""",
            """  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6">
"""
            + BULK_BAR
            + (DIALOG % ("items", "(items.data ?? []).filter((row: any) => deleteIds.includes(row.id)).map((row: any) => row.name_ar)")),
            "render",
        ),
    ],
    "Services-2",
)

print("تمّت المرحلة الثانية")


# -*- coding: utf-8 -*-
"""أسماء الدوالّ نصوصٌ حرفية لا متغيّرات.

`completeness-audit` يجد نداءات القاعدة بنمط `.rpc("اسم")`. وكتابةُ الاسم في
متغيّرٍ (`supabase.rpc(copy.rpc, …)`) تُخفيه عن المدقّق، فبلّغ عن ثلاث «دوالّ
ميتة» وهي تُنادى من شاشتين.

والبلاغ الكاذب أسوأ من غيابه: **مدقّقٌ يُبلّغ كذبًا يُفقِد الثقة ببلاغاته
الصادقة**، فيُتجاوَز يومًا يكون فيه محقًّا. فالتفريع صريحٌ هنا ولو طال السطر.
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


patch(
    "client/components/shared/DeleteRowsDialog.tsx",
    [
        (
            """const COPY: Record<PurgeEntity, { rpc: string; noun: string; effect: string; keeps: string }> = {
  patients: {
    rpc: "app_purge_patients",
    noun: "مريض",""",
            """const COPY: Record<PurgeEntity, { noun: string; effect: string; keeps: string }> = {
  patients: {
    noun: "مريض",""",
            "copy_patients",
        ),
        (
            """  doctors: {
    rpc: "app_purge_doctors",
    noun: "طبيب",""",
            """  doctors: {
    noun: "طبيب",""",
            "copy_doctors",
        ),
        (
            """  items: {
    rpc: "app_purge_items",
    noun: "صنف",""",
            """  items: {
    noun: "صنف",""",
            "copy_items",
        ),
        (
            """  const call = async (dryRun: boolean) => {
    if (!organization?.id) throw new Error("لا توجد منشأة نشطة");
    if (ids.length === 0) throw new Error("لم تُحدَّد صفوف");
    const { data, error } = await supabase.rpc(copy.rpc, {
      p_organization_id: organization.id,
      p_ids: ids,
      p_dry_run: dryRun,
    });
    if (error) throw error;
    return (data ?? []) as PurgeRow[];
  };""",
            """  const call = async (dryRun: boolean) => {
    if (!organization?.id) throw new Error("لا توجد منشأة نشطة");
    if (ids.length === 0) throw new Error("لم تُحدَّد صفوف");
    /**
     * ثلاثة نداءات باسمٍ حرفيّ لا نداءٌ باسمٍ من متغيّر.
     *
     * `completeness-audit` يجد `.rpc("اسم")` ولا يجد `.rpc(متغيّر)` — فاسمٌ
     * في متغيّرٍ يجعل الدالّة تبدو ميتةً وهي تُنادى. والمدقّق الذي يكذب مرّةً
     * يُتجاوَز يومًا يكون فيه محقًّا.
     */
    const params = {
      p_organization_id: organization.id,
      p_ids: ids,
      p_dry_run: dryRun,
    };
    const { data, error } =
      entity === "patients"
        ? await supabase.rpc("app_purge_patients", params)
        : entity === "doctors"
          ? await supabase.rpc("app_purge_doctors", params)
          : await supabase.rpc("app_purge_items", params);
    if (error) throw error;
    return (data ?? []) as PurgeRow[];
  };""",
            "call",
        ),
    ],
    "DeleteRowsDialog",
)

patch(
    "client/components/settings/DangerZoneTab.tsx",
    [
        (
            """type PurgeKind = {
  key: "patients" | "doctors" | "items";
  rpc: string;
  label: string;""",
            """type PurgeKind = {
  key: "patients" | "doctors" | "items";
  label: string;""",
            "type",
        ),
        (
            """    key: "patients",
    rpc: "app_purge_patients",
    label: "حذف كلّ المرضى",""",
            """    key: "patients",
    label: "حذف كلّ المرضى",""",
            "kind_patients",
        ),
        (
            """    key: "doctors",
    rpc: "app_purge_doctors",
    label: "حذف كلّ الأطباء",""",
            """    key: "doctors",
    label: "حذف كلّ الأطباء",""",
            "kind_doctors",
        ),
        (
            """    key: "items",
    rpc: "app_purge_items",
    label: "حذف كلّ الخدمات والأصناف",""",
            """    key: "items",
    label: "حذف كلّ الخدمات والأصناف",""",
            "kind_items",
        ),
        (
            """  const call = async (kind: PurgeKind, dryRun: boolean) => {
    if (!organizationId) throw new Error("لا توجد منشأة نشطة");
    const { data, error } = await supabase.rpc(kind.rpc, {
      p_organization_id: organizationId,
      p_dry_run: dryRun,
    });
    if (error) throw error;
    return (data ?? []) as PurgeRow[];
  };""",
            """  const call = async (kind: PurgeKind, dryRun: boolean) => {
    if (!organizationId) throw new Error("لا توجد منشأة نشطة");
    // اسمٌ حرفيّ لكلّ نداء — المدقّق لا يرى الاسم إن كان في متغيّر.
    // و`p_ids` تُترك فارغةً هنا: هذه الشاشة تُفرّغ المنشأة كلّها.
    const params = { p_organization_id: organizationId, p_dry_run: dryRun };
    const { data, error } =
      kind.key === "patients"
        ? await supabase.rpc("app_purge_patients", params)
        : kind.key === "doctors"
          ? await supabase.rpc("app_purge_doctors", params)
          : await supabase.rpc("app_purge_items", params);
    if (error) throw error;
    return (data ?? []) as PurgeRow[];
  };""",
            "call",
        ),
    ],
    "DangerZoneTab",
)

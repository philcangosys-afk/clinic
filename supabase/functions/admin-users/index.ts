/**
 * admin-users — إنشاء حسابات الدخول وتغيير كلمات المرور من داخل النظام.
 *
 * إنشاء مستخدمٍ في Supabase Auth يحتاج مفتاح الخدمة (service role)، ومن ملكه
 * ملك كلّ بيانات كلّ المنشآت. فلا يمرّ في المتصفّح أبدًا: المتصفّح ينادي هذه
 * الدالّة برمز جلسة المستخدم، والدالّة وحدها تحمل المفتاح.
 *
 * ── من يُصرَّح له ──────────────────────────────────────────────────────────
 * القرار في القاعدة لا هنا:
 *   * `users.manage` في المنشأة — يفحصها `app_can_manage_member_account`.
 *   * حساب **المالك** لا يمسّه إلّا مالك (تغيير كلمة مروره استيلاء).
 *   * العضوية والدور وربط ملفّ الموظّف تكتبها `app_attach_member` بصلاحية
 *     الطالب نفسه، فيُكتب في سجلّ التدقيق من فعل لا «النظام».
 *
 * ── ما لا تفعله ───────────────────────────────────────────────────────────
 * لا تحذف حسابًا: تعطيل العضوية يقطع الوصول ويُبقي الأثر (`app_set_member_active`).
 * ولا تُرجع كلمة مرورٍ ولا رمزًا إلى المتصفّح.
 *
 * النشر:
 *   npx supabase functions deploy admin-users --project-ref <PROJECT_REF> --use-api
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const clean = (value: unknown) => String(value ?? "").trim();

const getCorsHeaders = () => {
  const appOrigin = clean(Deno.env.get("APP_ORIGIN"));
  return {
    ...(appOrigin ? { "Access-Control-Allow-Origin": appOrigin } : {}),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-device-name",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
};

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(), "Content-Type": "application/json" },
  });

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireUuid(value: unknown, label: string, required = true) {
  const text = clean(value);
  if (!text) {
    if (required) throw new Error(`${label} مطلوب`);
    return null;
  }
  if (!UUID_RE.test(text)) throw new Error(`${label} غير صالح`);
  return text;
}

function requireEmail(value: unknown) {
  const email = clean(value).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error("البريد الإلكتروني غير صالح");
  return email;
}

/**
 * ثماني خانات حدٌّ أدنى، وليست ضعيفةً ظاهرة. الحدّ هنا لا في المتصفّح وحده:
 * من ينادي الدالّة مباشرةً يتجاوز فحص الشاشة.
 */
function requirePassword(value: unknown) {
  const password = String(value ?? "");
  if (password.length < 8) throw new Error("كلمة المرور لا تقلّ عن 8 خانات");
  if (/^\d+$/.test(password)) throw new Error("كلمة المرور أرقامٌ فقط — أضف حروفًا");
  return password;
}

Deno.serve(async (req) => {
  const appOrigin = clean(Deno.env.get("APP_ORIGIN"));
  const requestOrigin = clean(req.headers.get("Origin"));
  if (appOrigin && requestOrigin && requestOrigin !== appOrigin) {
    return respond({ error: "Origin not allowed" }, 403);
  }
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders() });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return respond({ error: "Unauthorized" }, 401);

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(supabaseUrl, serviceKey);
  const {
    data: { user },
    error: authError,
  } = await caller.auth.getUser(authHeader.slice(7));
  if (authError || !user) return respond({ error: "Unauthorized" }, 401);

  try {
    const body = await req.json();
    const action = clean(body.action);
    const organizationId = requireUuid(body.organizationId, "معرّف المنشأة")!;

    // الصلاحية بمستخدم الطلب: `users.manage` في هذه المنشأة
    const { data: allowed, error: permissionError } = await caller.rpc(
      "app_has_permission",
      { target_org_id: organizationId, p_permission_key: "users.manage" },
    );
    if (permissionError) throw permissionError;
    if (allowed !== true) {
      return respond({ error: "صلاحيتك لا تسمح بإدارة المستخدمين في هذه المنشأة" }, 403);
    }

    // ══ قائمة الحسابات: البريد وآخر دخول لكل عضو ═══════════════════════════
    if (action === "list") {
      const { data: members, error: membersError } = await caller
        .from("organization_memberships")
        .select("user_id")
        .eq("organization_id", organizationId);
      if (membersError) throw membersError;
      const wanted = new Set((members ?? []).map((row: any) => row.user_id));

      const accounts: Record<string, { email: string | null; last_sign_in_at: string | null }> = {};
      let page = 1;
      // صفحاتٌ حتى تنتهي: منشأةٌ كبيرة تتجاوز الصفحة الواحدة
      while (page <= 20) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw error;
        const users = data?.users ?? [];
        for (const account of users) {
          if (wanted.has(account.id)) {
            accounts[account.id] = {
              email: account.email ?? null,
              last_sign_in_at: account.last_sign_in_at ?? null,
            };
          }
        }
        if (users.length < 200) break;
        page += 1;
      }
      return respond({ accounts });
    }

    // ══ إنشاء حساب وضمّه للمنشأة ═══════════════════════════════════════════
    if (action === "create") {
      const email = requireEmail(body.email);
      const password = requirePassword(body.password);
      const displayName = clean(body.displayName);
      const roleKey = clean(body.roleKey) || "employee";
      const customRoleId = requireUuid(body.customRoleId, "الدور المخصّص", false);
      const branchId = requireUuid(body.branchId, "الفرع", false);
      const employeeId = requireUuid(body.employeeId, "ملفّ الموظّف", false);
      const memberKind = clean(body.memberKind) === "special" ? "special" : "employee";
      if (!displayName) throw new Error("اسم المستخدم مطلوب");

      // **الحساب يُنشأ مؤكَّد البريد:** لا رسالة تأكيدٍ تنتظر موظّفًا في
      // الاستقبال ليفتح بريده — المسؤول أنشأ الحساب وسلّمه كلمة مروره.
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      });
      let userId = created.data?.user?.id ?? null;
      if (created.error) {
        // بريدٌ مسجّل سلفًا: يُضمّ حسابه للمنشأة بدل رفض العملية — وكلمة
        // مروره لا تُمسّ، فهي حسابه هو.
        const message = String(created.error.message ?? "");
        const exists = /already|registered|exists/i.test(message);
        if (!exists) throw created.error;
        let page = 1;
        while (!userId && page <= 20) {
          const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
          if (error) throw error;
          const users = data?.users ?? [];
          userId = users.find((account: any) => (account.email ?? "").toLowerCase() === email)?.id ?? null;
          if (users.length < 200) break;
          page += 1;
        }
        if (!userId) throw created.error;
      }
      if (!userId) throw new Error("تعذّر إنشاء الحساب");

      const { error: attachError } = await caller.rpc("app_attach_member", {
        p_organization_id: organizationId,
        p_user_id: userId,
        p_role_key: roleKey,
        p_custom_role_id: customRoleId,
        p_branch_id: branchId,
        p_display_name: displayName,
        p_member_kind: memberKind,
        p_employee_id: employeeId,
        p_email: email,
      });
      if (attachError) throw attachError;

      return respond({ userId, email, created: !created.error });
    }

    // ══ تغيير كلمة المرور أو البريد ════════════════════════════════════════
    if (action === "set_password" || action === "set_email") {
      const targetUserId = requireUuid(body.userId, "معرّف المستخدم")!;
      const { data: canManage, error: guardError } = await caller.rpc(
        "app_can_manage_member_account",
        { p_organization_id: organizationId, p_user_id: targetUserId },
      );
      if (guardError) throw guardError;
      if (canManage !== true) {
        return respond({ error: "لا تملك صلاحية تعديل هذا الحساب" }, 403);
      }

      if (action === "set_password") {
        const password = requirePassword(body.password);
        const { error } = await admin.auth.admin.updateUserById(targetUserId, { password });
        if (error) throw error;
        await caller.rpc("app_log_account_action", {
          p_organization_id: organizationId,
          p_user_id: targetUserId,
          p_title: "تغيير كلمة المرور",
          p_details: null,
        });
        return respond({ ok: true });
      }

      const email = requireEmail(body.email);
      const { error } = await admin.auth.admin.updateUserById(targetUserId, {
        email,
        email_confirm: true,
      });
      if (error) throw error;
      await caller.rpc("app_log_account_action", {
        p_organization_id: organizationId,
        p_user_id: targetUserId,
        p_title: "تغيير البريد الإلكتروني",
        p_details: email,
      });
      return respond({ ok: true, email });
    }

    return respond({ error: "إجراء غير معروف" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "خطأ غير متوقع";
    // 400 لا 500: أغلب ما يصل هنا خطأ إدخالٍ يقرؤه المستخدم ويصحّحه
    return respond({ error: message }, 400);
  }
});

import { supabase } from "@/lib/supabase";

/**
 * نداء الدالّة الطرفية `admin-users` — إنشاء حسابات الدخول وتغيير كلمات
 * المرور والبريد.
 *
 * **لماذا دالّة طرفية لا استعلام مباشر:** إنشاء مستخدمٍ في Supabase Auth
 * يحتاج مفتاح الخدمة، ومن ملكه ملك كلّ بيانات كلّ المنشآت — فلا يوضع في
 * شيفرة المتصفّح. المتصفّح يرسل رمز جلسته، والدالّة تفحص الصلاحية في
 * القاعدة ثمّ تعمل.
 *
 * رسالة الخطأ تُستخرج من جسم الردّ لا من `error.message` وحده: الدالّة تردّ
 * 400 بنصٍّ عربيّ مفهوم («البريد مستخدم»، «كلمة المرور قصيرة»)، وبدون هذا
 * الاستخراج يرى المستخدم «Edge Function returned a non-2xx status code».
 */
export async function callAdminUsers<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error || (data as any)?.error) {
    let payload: any = data;
    const context = (error as { context?: Response } | null)?.context;
    if (!payload && context) {
      payload = await context.clone().json().catch(() => null);
    }
    const message = String(payload?.error ?? "").trim();
    throw new Error(
      message ||
        (error?.message?.includes("Failed to send")
          ? "تعذّر الوصول إلى دالّة admin-users — تأكّد من نشرها على Supabase"
          : error?.message || "تعذّرت العملية"),
    );
  }
  return data as T;
}

export type MemberAccount = { email: string | null; last_sign_in_at: string | null };

export async function fetchMemberAccounts(organizationId: string) {
  const data = await callAdminUsers<{ accounts: Record<string, MemberAccount> }>({
    action: "list",
    organizationId,
  });
  return data.accounts ?? {};
}

export type CreateMemberAccountInput = {
  organizationId: string;
  email: string;
  password: string;
  displayName: string;
  roleKey?: string;
  customRoleId?: string | null;
  branchId?: string | null;
  employeeId?: string | null;
  memberKind?: "employee" | "special";
};

export async function createMemberAccount(input: CreateMemberAccountInput) {
  return callAdminUsers<{ userId: string; email: string; created: boolean }>({
    action: "create",
    organizationId: input.organizationId,
    email: input.email,
    password: input.password,
    displayName: input.displayName,
    roleKey: input.roleKey ?? "employee",
    customRoleId: input.customRoleId ?? null,
    branchId: input.branchId ?? null,
    employeeId: input.employeeId ?? null,
    memberKind: input.memberKind ?? "employee",
  });
}

export async function setMemberPassword(organizationId: string, userId: string, password: string) {
  return callAdminUsers<{ ok: true }>({ action: "set_password", organizationId, userId, password });
}

export async function setMemberEmail(organizationId: string, userId: string, email: string) {
  return callAdminUsers<{ ok: true; email: string }>({ action: "set_email", organizationId, userId, email });
}

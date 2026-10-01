import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import {
  demoRoleFromMembership,
  readDemoRole,
  writeDemoRole,
  type DemoRoleKey,
  type DemoRoleState,
} from "@/lib/demo-role";

type DemoRoleContextValue = {
  role: DemoRoleKey | null;
  name: string;
  doctorId: string | null;
  /** انتهى تحميل الاختيار المحفوظ — قبلها لا تُعرض شاشة الاختيار حتى لا ترتعش. */
  ready: boolean;
  set: (state: DemoRoleState) => void;
  clear: () => void;
};

const DemoRoleContext = createContext<DemoRoleContextValue>({
  role: null,
  name: "",
  doctorId: null,
  ready: false,
  set: () => {},
  clear: () => {},
});

/**
 * حامل صفة المعاينة.
 *
 * قاعدة مهمة: **إن كان للمستخدم عضوية حقيقية بدور واضح، فدوره هو الصفة** ولا
 * تُعرض عليه شاشة الاختيار. شاشة الاختيار للمالك/المدير الذي يريد أن يرى
 * النظام بعيون موظفيه. هكذا لا تتحوّل المعاينة إلى حاجزٍ أمام موظّفٍ حقيقي
 * يفتح النظام ليعمل.
 */
export function DemoRoleProvider({ children }: { children: ReactNode }) {
  const { membership, loading } = useOrganizationAccess();
  const [state, setState] = useState<DemoRoleState | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setState(readDemoRole());
    setReady(true);
  }, []);

  const membershipRole = demoRoleFromMembership(membership?.role_key);
  const isAdminLike = membershipRole === "organization_admin";

  const set = useCallback((next: DemoRoleState) => {
    setState(next);
    writeDemoRole(next);
  }, []);

  const clear = useCallback(() => {
    setState(null);
    writeDemoRole(null);
  }, []);

  const value = useMemo<DemoRoleContextValue>(() => {
    // موظّف بدور محدّد (طبيب، أشعة، مختبر…) يدخل على صفته مباشرة — ولا تُقرأ له
    // معاينةٌ محفوظة في المتصفّح (0204): كانت تسبق صفته الحقيقية إن فتح على
    // جهازٍ عاين منه المدير قبله، فيرى بصفةٍ أو طبيبٍ غير صفته.
    if (!loading && membershipRole && !isAdminLike) {
      return {
        role: membershipRole,
        name: "",
        doctorId: null,
        ready,
        set,
        clear,
      };
    }
    return {
      role: state?.role ?? null,
      name: state?.name ?? "",
      doctorId: state?.doctorId ?? null,
      ready,
      set,
      clear,
    };
  }, [state, ready, loading, membershipRole, isAdminLike, set, clear]);

  return <DemoRoleContext.Provider value={value}>{children}</DemoRoleContext.Provider>;
}

export function useDemoRole() {
  return useContext(DemoRoleContext);
}

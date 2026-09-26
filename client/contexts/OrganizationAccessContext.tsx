import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import type {
  FeatureKey,
  HealthcareOrganization,
  HealthcareOrganizationType,
  MembershipPermission,
  OrganizationBranch,
  OrganizationMembership,
} from "@shared/api";
import { supabase } from "@/lib/supabase";
import {
  canAccessFeature,
  resolveOrganizationAccessConfiguration,
  resolvePermissions,
} from "@/lib/organization-access";
import { errorMessage } from "@/lib/error-message";

type OrganizationAccessContextValue = {
  loading: boolean;
  error: string | null;
  session: Session | null;
  legacyMode: boolean;
  demoOrganizationType: HealthcareOrganizationType | null;
  setDemoOrganizationType: (type: HealthcareOrganizationType | null) => void;
  needsOnboarding: boolean;
  organization: HealthcareOrganization | null;
  branch: OrganizationBranch | null;
  membership: OrganizationMembership | null;
  enabledFeatures: FeatureKey[];
  permissions: string[];
  canAccess: (featureKey: FeatureKey, permissionKey: string) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const OrganizationAccessContext = createContext<OrganizationAccessContextValue | null>(null);
const DEMO_ORGANIZATION_TYPE_KEY = "zaincare-demo-organization-type";

export function OrganizationAccessProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  /**
   * صاحب الجلسة المحمَّلة. لا حالةٌ بل مرجع: يُقرأ داخل مستمع المصادقة الذي
   * يُسجَّل مرّةً واحدة، فحالةٌ عادية تبقى عنده على قيمتها الأولى أبدًا.
   */
  const loadedUserId = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [demoOrganizationType, setDemoOrganizationTypeState] = useState<HealthcareOrganizationType | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = window.localStorage.getItem(DEMO_ORGANIZATION_TYPE_KEY);
    return stored === "medical_center" ? stored : null;
  });
  const [organization, setOrganization] = useState<HealthcareOrganization | null>(null);
  const [branch, setBranch] = useState<OrganizationBranch | null>(null);
  const [membership, setMembership] = useState<OrganizationMembership | null>(null);
  const [enabledFeatures, setEnabledFeatures] = useState<FeatureKey[]>([]);
  const [explicitPermissions, setExplicitPermissions] = useState<MembershipPermission[]>([]);
  /** null = لا دور مخصّص، فتُستعمل افتراضات الدور الأساس (0183) */
  const [customRolePermissions, setCustomRolePermissions] = useState<string[] | null>(null);
  /**
   * صلاحيات المستخدم كما تحسبها القاعدة — `v_my_permissions` (0062)، وهي
   * `app_has_permission` مطبَّقةً على كلّ مفتاح في `permission_catalog`.
   *
   * **لماذا من القاعدة لا من الشيفرة:** الواجهة كانت تُعيد حساب الصلاحيات
   * بخريطةٍ ثابتة في `organization-access.ts` — حسابٌ ثانٍ لنفس السؤال يجب
   * أن يُطابق القاعدة يدويًّا. وقد افترق: دورٌ مخصّص بلا صلاحيةٍ واحدة تمنعه
   * القاعدة من كلّ شيء، بينما الشاشة تُريه كلّ شيء. الآن جوابٌ واحد.
   *
   * null = لم تُقرأ (أو تعذّرت قراءتها) ⇒ يُستعمل الحساب المحلّي احتياطًا.
   */
  const [databasePermissions, setDatabasePermissions] = useState<string[] | null>(null);

  const clearOrganization = useCallback(() => {
    setOrganization(null);
    setBranch(null);
    setMembership(null);
    setEnabledFeatures([]);
    setExplicitPermissions([]);
    setCustomRolePermissions(null);
    setDatabasePermissions(null);
  }, []);

  const loadAccess = useCallback(async (nextSession?: Session | null) => {
    setLoading(true);
    setError(null);
    try {
      const sessionResult = nextSession === undefined
        ? await supabase.auth.getSession()
        : null;
      if (sessionResult?.error) throw sessionResult.error;
      const activeSession = nextSession === undefined
        ? sessionResult?.data.session ?? null
        : nextSession;
      setSession(activeSession);
      if (!activeSession) {
        loadedUserId.current = null;
        clearOrganization();
        return;
      }
      loadedUserId.current = activeSession.user.id;

      const membershipResult = await supabase
        .from("organization_memberships")
        .select("*")
        .eq("user_id", activeSession.user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (membershipResult.error) throw membershipResult.error;
      if (!membershipResult.data) {
        clearOrganization();
        return;
      }

      const currentMembership = membershipResult.data as OrganizationMembership;
      const [organizationResult, branchResult, featuresResult, permissionsResult] = await Promise.all([
        supabase.from("organizations").select("*").eq("id", currentMembership.organization_id).maybeSingle(),
        currentMembership.branch_id
          ? supabase.from("branches").select("*").eq("id", currentMembership.branch_id).maybeSingle()
          : supabase.from("branches").select("*").eq("organization_id", currentMembership.organization_id).limit(1).maybeSingle(),
        supabase.from("organization_features").select("feature_key, enabled").eq("organization_id", currentMembership.organization_id).eq("enabled", true),
        supabase
          .from("membership_permissions")
          .select("organization_id, user_id, permission_key, granted")
          .eq("organization_id", currentMembership.organization_id)
          .eq("user_id", activeSession.user.id),
      ]);
      const queryError = organizationResult.error || branchResult.error || featuresResult.error || permissionsResult.error;
      if (queryError) throw queryError;
      if (!organizationResult.data) throw new Error("Organization access record was not found");

      setMembership(currentMembership);
      setOrganization(organizationResult.data as HealthcareOrganization);
      setBranch((branchResult.data as OrganizationBranch | null) ?? null);
      setEnabledFeatures((featuresResult.data ?? []).map((feature) => feature.feature_key as FeatureKey));
      setExplicitPermissions((permissionsResult.data as MembershipPermission[]) ?? []);

      // الدور المخصّص: مجموعة صلاحياته تحلّ محلّ افتراض الدور الأساس.
      // تعذّر قراءتها لا يُسقط الجلسة — يعود المستخدم إلى افتراض أساسه.
      if (currentMembership.custom_role_id) {
        const roleResult = await supabase
          .from("organization_role_permissions")
          .select("permission_key")
          .eq("role_id", currentMembership.custom_role_id);
        setCustomRolePermissions(
          roleResult.error
            ? null
            : (roleResult.data ?? []).map((row: { permission_key: string }) => row.permission_key),
        );
      } else {
        setCustomRolePermissions(null);
      }

      // جواب القاعدة عن كلّ مفتاح. يُقرأ بعد العضوية لأنّه يحتاج
      // `organization_id`، وتعذّرُه لا يُسقط الجلسة — يعود الحساب المحلّي.
      const grantedResult = await supabase
        .from("v_my_permissions")
        .select("permission_key, granted")
        .eq("organization_id", currentMembership.organization_id)
        .eq("granted", true);
      setDatabasePermissions(
        grantedResult.error
          ? null
          : (grantedResult.data ?? []).map((row: { permission_key: string }) => row.permission_key),
      );
    } catch (loadError) {
      clearOrganization();
      setError(errorMessage(loadError, "تعذر تحميل صلاحيات المنظمة"));
    } finally {
      setLoading(false);
    }
  }, [clearOrganization]);

  useEffect(() => {
    void loadAccess();
    /**
     * **تجديد الرمز ليس دخولًا جديدًا.**
     *
     * `supabase-js` يجدّد رمز الجلسة كلّما عاد التبويب إلى الواجهة (رجوعٌ من
     * واتساب أو من تبويب آخر)، فيُطلق `TOKEN_REFRESHED` ثمّ `SIGNED_IN`
     * للمستخدم نفسه. وكان كلّ حدثٍ يُعيد تحميل العضوية والمنشأة والمزايا
     * والصلاحيات ويرفع `loading`، فتحلّ شاشة «جارٍ تحميل بيانات المنشأة»
     * محلّ العمل ثوانيَ في كلّ مرّة — وما تغيّر شيءٌ يستدعي ذلك.
     *
     * فلا يُعاد التحميل إلّا إذا **تغيّر المستخدم** (دخولٌ أو خروج). وتجديد
     * الرمز يُحدِّث الجلسة وحدها، فتبقى استدعاءات القاعدة بالرمز الجديد.
     */
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // التحميل الأوّل يجري في هذا التأثير نفسه — لا يُكرَّر
      if (event === "INITIAL_SESSION") return;

      const sameUser =
        Boolean(nextSession?.user?.id) && nextSession?.user?.id === loadedUserId.current;
      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED" || (event === "SIGNED_IN" && sameUser)) {
        setSession(nextSession);
        return;
      }
      void loadAccess(nextSession);
    });
    return () => data.subscription.unsubscribe();
  }, [loadAccess]);

  const permissions = useMemo(
    () =>
      resolvePermissions(
        membership?.role_key,
        explicitPermissions,
        customRolePermissions,
        databasePermissions,
      ),
    [membership?.role_key, explicitPermissions, customRolePermissions, databasePermissions],
  );
  const legacyMode = !session && !error;
  const needsOnboarding = Boolean(session && !membership && !error);
  const accessConfiguration = useMemo(() => resolveOrganizationAccessConfiguration({
    authenticated: Boolean(session),
    /**
     * **`legacy_full_access` لا يتجاوز شيئًا بعد اليوم لمن دخل بحسابه.**
     *
     * `canAccessFeature` تبدأ بـ `if (legacyMode) return true` — فعمودٌ واحد
     * على المنشأة كان يُلغي الدور والدور المخصّص والمنع الصريح جميعًا في
     * المتصفّح: دورٌ صُفِّرت صلاحياته كلّها يُفتح له كلّ شيء. كان ذلك مفهومًا
     * حين كان النظام يُفتح بلا حساب، وقد زال ذلك. فالتجاوز الآن مشروطٌ بألّا
     * تكون هناك جلسة أصلًا — والقاعدة تحكم في كلّ حال.
     */
    legacyMode: !session && (legacyMode || Boolean(organization?.legacy_full_access)),
    demoOrganizationType,
    enabledFeatures,
    permissions,
    role: membership?.role_key,
  }), [demoOrganizationType, enabledFeatures, legacyMode, membership?.role_key, organization?.legacy_full_access, permissions, session]);
  const canAccess = useCallback(
    (featureKey: FeatureKey, permissionKey: string) => canAccessFeature({
      ...accessConfiguration,
      featureKey,
      permissionKey,
    }),
    [accessConfiguration],
  );
  const setDemoOrganizationType = useCallback((type: HealthcareOrganizationType | null) => {
    if (session) return;
    const unifiedType = type ? "medical_center" : null;
    setDemoOrganizationTypeState(unifiedType);
    if (unifiedType) window.localStorage.setItem(DEMO_ORGANIZATION_TYPE_KEY, unifiedType);
    else window.localStorage.removeItem(DEMO_ORGANIZATION_TYPE_KEY);
  }, [session]);
  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    await loadAccess(null);
  }, [loadAccess]);

  const value = useMemo<OrganizationAccessContextValue>(() => ({
    loading,
    error,
    session,
    legacyMode,
    demoOrganizationType,
    setDemoOrganizationType,
    needsOnboarding,
    organization,
    branch,
    membership,
    enabledFeatures: accessConfiguration.enabledFeatures,
    permissions: accessConfiguration.permissions,
    canAccess,
    refresh: () => loadAccess(),
    signOut,
  }), [loading, error, session, legacyMode, demoOrganizationType, setDemoOrganizationType, needsOnboarding, organization, branch, membership, accessConfiguration.enabledFeatures, accessConfiguration.permissions, canAccess, loadAccess, signOut]);

  return <OrganizationAccessContext.Provider value={value}>{children}</OrganizationAccessContext.Provider>;
}

export function useOrganizationAccess() {
  const value = useContext(OrganizationAccessContext);
  if (!value) throw new Error("useOrganizationAccess must be used within OrganizationAccessProvider");
  return value;
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

  const clearOrganization = useCallback(() => {
    setOrganization(null);
    setBranch(null);
    setMembership(null);
    setEnabledFeatures([]);
    setExplicitPermissions([]);
    setCustomRolePermissions(null);
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
        clearOrganization();
        return;
      }

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
    } catch (loadError) {
      clearOrganization();
      setError(errorMessage(loadError, "تعذر تحميل صلاحيات المنظمة"));
    } finally {
      setLoading(false);
    }
  }, [clearOrganization]);

  useEffect(() => {
    void loadAccess();
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void loadAccess(nextSession);
    });
    return () => data.subscription.unsubscribe();
  }, [loadAccess]);

  const permissions = useMemo(
    () => resolvePermissions(membership?.role_key, explicitPermissions, customRolePermissions),
    [membership?.role_key, explicitPermissions, customRolePermissions],
  );
  const legacyMode = !session && !error;
  const needsOnboarding = Boolean(session && !membership && !error);
  const accessConfiguration = useMemo(() => resolveOrganizationAccessConfiguration({
    authenticated: Boolean(session),
    legacyMode: legacyMode || Boolean(organization?.legacy_full_access),
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

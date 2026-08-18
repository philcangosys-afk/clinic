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
  MembershipPermission,
  OrganizationBranch,
  OrganizationMembership,
} from "@shared/api";
import { supabase } from "@/lib/supabase";
import {
  canAccessFeature,
  resolvePermissions,
} from "@/lib/organization-access";

type OrganizationAccessContextValue = {
  loading: boolean;
  session: Session | null;
  legacyMode: boolean;
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

export function OrganizationAccessProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [organization, setOrganization] = useState<HealthcareOrganization | null>(null);
  const [branch, setBranch] = useState<OrganizationBranch | null>(null);
  const [membership, setMembership] = useState<OrganizationMembership | null>(null);
  const [enabledFeatures, setEnabledFeatures] = useState<FeatureKey[]>([]);
  const [explicitPermissions, setExplicitPermissions] = useState<MembershipPermission[]>([]);

  const clearOrganization = useCallback(() => {
    setOrganization(null);
    setBranch(null);
    setMembership(null);
    setEnabledFeatures([]);
    setExplicitPermissions([]);
  }, []);

  const loadAccess = useCallback(async (nextSession?: Session | null) => {
    setLoading(true);
    const activeSession = nextSession === undefined
      ? (await supabase.auth.getSession()).data.session
      : nextSession;
    setSession(activeSession);
    if (!activeSession) {
      clearOrganization();
      setLoading(false);
      return;
    }

    const { data: membershipRow } = await supabase
      .from("organization_memberships")
      .select("*")
      .eq("user_id", activeSession.user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!membershipRow) {
      clearOrganization();
      setLoading(false);
      return;
    }

    const currentMembership = membershipRow as OrganizationMembership;
    const [organizationResult, branchResult, featuresResult, permissionsResult] = await Promise.all([
      supabase.from("organizations").select("*").eq("id", currentMembership.organization_id).maybeSingle(),
      currentMembership.branch_id
        ? supabase.from("branches").select("*").eq("id", currentMembership.branch_id).maybeSingle()
        : supabase.from("branches").select("*").eq("organization_id", currentMembership.organization_id).limit(1).maybeSingle(),
      supabase.from("organization_features").select("feature_key, enabled").eq("organization_id", currentMembership.organization_id).eq("enabled", true),
      currentMembership.id
        ? supabase.from("membership_permissions").select("*").eq("membership_id", currentMembership.id)
        : Promise.resolve({ data: [] }),
    ]);

    setMembership(currentMembership);
    setOrganization((organizationResult.data as HealthcareOrganization | null) ?? null);
    setBranch((branchResult.data as OrganizationBranch | null) ?? null);
    setEnabledFeatures((featuresResult.data ?? []).map((feature) => feature.feature_key as FeatureKey));
    setExplicitPermissions((permissionsResult.data as MembershipPermission[] | null) ?? []);
    setLoading(false);
  }, [clearOrganization]);

  useEffect(() => {
    void loadAccess();
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void loadAccess(nextSession);
    });
    return () => data.subscription.unsubscribe();
  }, [loadAccess]);

  const permissions = useMemo(
    () => resolvePermissions(membership?.role_key, explicitPermissions),
    [membership?.role_key, explicitPermissions],
  );
  const legacyMode = !session;
  const needsOnboarding = Boolean(session && !membership);
  const canAccess = useCallback(
    (featureKey: FeatureKey, permissionKey: string) => canAccessFeature({
      legacyMode: legacyMode || Boolean(organization?.legacy_full_access),
      featureKey,
      permissionKey,
      enabledFeatures,
      permissions,
      role: membership?.role_key,
    }),
    [enabledFeatures, legacyMode, membership?.role_key, organization?.legacy_full_access, permissions],
  );
  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    await loadAccess(null);
  }, [loadAccess]);

  const value = useMemo<OrganizationAccessContextValue>(() => ({
    loading,
    session,
    legacyMode,
    needsOnboarding,
    organization,
    branch,
    membership,
    enabledFeatures,
    permissions,
    canAccess,
    refresh: () => loadAccess(),
    signOut,
  }), [loading, session, legacyMode, needsOnboarding, organization, branch, membership, enabledFeatures, permissions, canAccess, loadAccess, signOut]);

  return <OrganizationAccessContext.Provider value={value}>{children}</OrganizationAccessContext.Provider>;
}

export function useOrganizationAccess() {
  const value = useContext(OrganizationAccessContext);
  if (!value) throw new Error("useOrganizationAccess must be used within OrganizationAccessProvider");
  return value;
}

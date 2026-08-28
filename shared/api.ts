/**
 * Shared code between client and server
 * Useful to share types between client and server
 * and/or small pure JS functions that can be used on both client and server
 */

/**
 * Example response type for /api/demo
 */
export interface DemoResponse {
  message: string;
}

export type HealthcareOrganizationType = "clinic" | "medical_center";

export type FeatureKey =
  | "core_dashboard"
  | "reception"
  | "appointments"
  | "patients"
  | "medical_records"
  | "patient_journey"
  | "medical_services"
  | "departments_clinics"
  | "doctors"
  | "laboratory"
  | "radiology"
  | "pharmacy"
  | "prescriptions"
  | "dispensing"
  | "insurance_claims"
  | "billing_payments"
  | "packages"
  | "hr"
  | "diagnosis"
  | "content"
  | "reports"
  | "advanced_analytics"
  | "accounting"
  | "procurement"
  | "inventory"
  | "messaging"
  | "audit_log"
  | "settings"
  | "nursing"
  | "emergency"
  | "dental_lab"
  | "inpatient"
  | "procedures"
  | "referrals";

export type OrganizationRole =
  | "owner"
  | "organization_admin"
  | "branch_manager"
  | "doctor"
  | "nurse"
  | "receptionist"
  | "pharmacist"
  | "lab_technician"
  | "radiology_technician"
  | "accountant"
  | "hr_manager"
  | "employee";

export interface HealthcareOrganization {
  id: string;
  name: string;
  organization_type: HealthcareOrganizationType;
  created_by: string;
  legacy_full_access: boolean;
  tax_number: string | null;
  currency: string;
  default_vat_rate: number;
}

export interface OrganizationBranch {
  id: string;
  organization_id: string;
  name: string;
  [key: string]: unknown;
}

export interface OrganizationMembership {
  organization_id: string;
  user_id: string;
  branch_id: string | null;
  role_key: OrganizationRole;
  is_active: boolean;
}

export interface FeatureCatalogEntry {
  feature_key: FeatureKey;
  name_ar: string;
  name_en: string;
  category_key: string;
  description_ar: string | null;
  is_core: boolean;
  display_order: number;
}

export interface OrganizationFeature {
  organization_id: string;
  feature_key: FeatureKey;
  enabled: boolean;
}

export interface MembershipPermission {
  organization_id: string;
  user_id: string;
  permission_key: string;
  granted: boolean;
}

export interface OrganizationAccessState {
  legacyMode: boolean;
  needsOnboarding: boolean;
  organization: HealthcareOrganization | null;
  branch: OrganizationBranch | null;
  membership: OrganizationMembership | null;
  enabledFeatures: FeatureKey[];
  permissions: string[];
}

export type ZainCareCountry = "SA" | "AE" | "QA" | "KW" | "BH" | "OM";

export type ClinicTypeProfile =
  | "general"
  | "dental"
  | "dermatology"
  | "pediatrics"
  | "ophthalmology"
  | "physiotherapy"
  | "womens_health"
  | "lab_center"
  | "multi_specialty";

export type TenantModule =
  | "appointments"
  | "queue"
  | "emr"
  | "prescriptions"
  | "lab"
  | "insurance"
  | "packages"
  | "telehealth"
  | "cms";

export interface ZainCareTenant {
  id: string;
  nameAr: string;
  nameEn: string;
  country: ZainCareCountry;
  city: string;
  clinicType: ClinicTypeProfile;
  enabledModules: TenantModule[];
  activeBranch: string;
  currency: "SAR" | "AED" | "QAR" | "KWD" | "BHD" | "OMR";
  vatRate: number;
}

export type ZainCareRole =
  | "super_admin"
  | "tenant_owner"
  | "branch_manager"
  | "receptionist"
  | "doctor"
  | "nurse"
  | "lab_admin"
  | "accountant"
  | "insurance_coordinator"
  | "content_manager"
  | "patient_guardian";

export interface TenantModuleToggle {
  module: TenantModule;
  enabled: boolean;
  labelAr: string;
}

export interface ZainCarePermission {
  resource: string;
  verbs: string[];
  scope: "platform" | "tenant" | "branch" | "assigned" | "self";
}

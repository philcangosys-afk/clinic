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

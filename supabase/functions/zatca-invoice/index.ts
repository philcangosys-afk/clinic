/**
 * zatca-invoice — إرسال فاتورة ZainCare إلى ZATCA (المرحلة الثانية).
 *
 * منقولةٌ من التنفيذ المُجرَّب في زين ERP: توليد UBL وتوقيعه، حجز ICV/PIH
 * ذرّيًا، منع التكرار بمفتاح لكل (بيئة، فاتورة)، والتوقّف عند أيّ نتيجةٍ غير
 * محسومة. الفروق: الفاتورة من `sales_invoices` وبنودها من `sales_invoice_items`
 * (الإشعار الدائن والمدين في الجدول نفسه)، والصلاحية `billing.issue` في منشأة
 * الفاتورة، والمشتري من ملفّ المريض.
 *
 * الإرسال الحقيقي لا يحدث إلا بشرطين معًا: عبارة التأكيد مع الطلب، وتفعيل
 * الإنتاج على الجهاز في القاعدة.
 *
 * منذ 0202: الأقسام المالية في UBL تُبنى هنا من البنود (`computeMonetaryModel`
 * و`rebuildMonetarySections`) — فالفاتورة قد تجمع 15% وصفرًا، وتحمل خصمًا على
 * مستوى الفاتورة، وفاتورة الأعمال (`document_type = 'standard'`) تُعتمد مسبقًا
 * لمشتريها العميل الخارجيّ، وفاتورة التأمين تُبلَّغ مبسّطة باسم المريض.
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { KJUR, X509 } from "npm:jsrsasign@11.1.3";
import {
  BuyerData,
  Certificate,
  InvoiceData,
  InvoiceLineData,
  InvoiceSigner,
  SellerData,
  ZatcaInvoice,
} from "npm:@khaledhajsalem/zatca-node@1.0.4";

type ZatcaMode = "simulation" | "production";

/**
 * أصلُ الطلب الجاري. يُضبط أوّل كلّ نداء، وتقرؤه ترويسات CORS.
 *
 * **بلا `Access-Control-Allow-Origin` يرفض المتصفّح الردّ كلّه** فيظهر
 * «Failed to fetch» بلا رسالةٍ ولا رمزِ حالة — وهو ما كان يحدث ما لم يُضبط
 * `APP_ORIGIN` في أسرار المشروع. فالآن: `APP_ORIGIN` إن ضُبط، وإلّا أصلُ
 * الطلب نفسه. والحماية ليست هنا أصلًا بل في رمز الجلسة وفحص الصلاحية في
 * القاعدة — وCORS تحمي متصفّح المستخدم لا الخادم.
 */
let currentOrigin = "";

/**
 * قيمةٌ تصلح ترويسةً: محارف ASCII المطبوعة وحدها.
 *
 * **سببٌ حقيقيّ لا احتياط نظريّ:** `APP_ORIGIN` ضُبط مرّةً على نصٍّ عربيّ،
 * فصار كلّ `new Response(… headers …)` يرمي «Value is not a valid ByteString»
 * — في OPTIONS وفي كلّ ردّ — فيسقط العامل وتردّ المنصّة «Internal Server
 * Error» بلا رسالة، ولا يظهر في المتصفّح إلّا «Failed to fetch». فقيمةٌ
 * فاسدة في الأسرار تُهمَل هنا ولا تُسقط الخدمة.
 */
const headerSafe = (value: string) => (/^[\x20-\x7E]*$/.test(value) ? value : "");

const getCorsHeaders = () => {
  const appOrigin = headerSafe(clean(Deno.env.get("APP_ORIGIN")));
  return {
    "Access-Control-Allow-Origin": appOrigin || currentOrigin || "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-device-name",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
};
const SIMULATION_URL = "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation";
const PRODUCTION_URL = "https://gw-fatoora.zatca.gov.sa/e-invoicing/core";
const ZATCA_INITIAL_PIH =
  "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==";
const PRODUCTION_CONFIRMATION = "SUBMIT_REAL_ZATCA_INVOICE";

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(), "Content-Type": "application/json" },
  });

const clean = (value: unknown) => String(value ?? "").trim();

async function getZatcaCredentials(admin: any, onboardingId: string) {
  const { data, error } = await admin.rpc("get_zatca_credentials", {
    p_onboarding_id: onboardingId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    private_key_pem: clean(row?.private_key_pem),
    compliance_csid: clean(row?.compliance_csid),
    compliance_secret: clean(row?.compliance_secret),
    production_csid: clean(row?.production_csid),
    production_secret: clean(row?.production_secret),
  };
}

function containsSyntheticMarker(value: unknown): boolean {
  if (typeof value === "string") {
    return /(?:^|[^A-Z])(?:TEST(?:ING)?|SIM(?:ULATION|ULATED|ULATOR)?)(?:[^A-Z]|$)|تجريب/i.test(
      value,
    );
  }
  if (Array.isArray(value)) return value.some(containsSyntheticMarker);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(
      containsSyntheticMarker,
    );
  }
  return false;
}

function getValidationResult(responseData: any) {
  const validation = responseData?.validationResults;
  const errors = Array.isArray(validation?.errorMessages)
    ? validation.errorMessages
    : [];
  const status = clean(validation?.status).toUpperCase();
  const documentStatus = clean(
    responseData?.reportingStatus ?? responseData?.clearanceStatus,
  ).toUpperCase();
  const validDocumentStatus =
    !documentStatus || ["REPORTED", "CLEARED"].includes(documentStatus);
  return {
    accepted:
      errors.length === 0 &&
      ["PASS", "WARNING"].includes(status) &&
      validDocumentStatus,
    message: clean(
      errors[0]?.message ??
        responseData?.message ??
        responseData?.error ??
        responseData?.dispositionMessage,
    ),
  };
}

function getRetryAfter(response?: Response) {
  const header = response?.headers.get("Retry-After");
  if (header) {
    const seconds = Number(header);
    const parsed = Number.isFinite(seconds)
      ? Date.now() + Math.max(0, seconds) * 1000
      : Date.parse(header);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date(Date.now() + 5 * 60 * 1000).toISOString();
}
const escapeXmlText = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

function parseRegisteredAddress(location: string, strict = false) {
  const normalized = location.replace(/\s+/g, " ").trim();
  const parts = normalized
    .split(/[،,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const firstPart = parts[0] ?? "";
  const combinedFirstPart = firstPart.match(/^(\d{4})\s+(.+)$/u);
  const separatedBuilding = /^\d{4}$/.test(firstPart);

  const buildingNumber =
    combinedFirstPart?.[1] ?? (separatedBuilding ? firstPart : "0000");
  const streetName = combinedFirstPart
    ? combinedFirstPart[2].trim()
    : separatedBuilding
      ? (parts[1] ?? "")
      : "";
  const citySubdivisionName = combinedFirstPart
    ? (parts[1] ?? "")
    : separatedBuilding
      ? (parts[2] ?? "")
      : "";
  const cityName = combinedFirstPart
    ? (parts[2] ?? "")
    : separatedBuilding
      ? (parts[3] ?? "")
      : "";
  const postalCandidate = combinedFirstPart
    ? (parts[3] ?? "")
    : separatedBuilding
      ? (parts[4] ?? "")
      : "";
  const postalZone = /^\d{5}$/.test(postalCandidate)
    ? postalCandidate
    : "00000";
  const hasText = (value: string) => /[\p{L}]/u.test(value);

  if (
    strict &&
    (buildingNumber === "0000" ||
      postalZone === "00000" ||
      !hasText(streetName) ||
      !hasText(citySubdivisionName) ||
      !hasText(cityName))
  ) {
    throw new Error("INVALID_REGISTERED_ADDRESS");
  }

  return {
    buildingNumber,
    postalZone,
    cityName: cityName || "الرياض",
    citySubdivisionName: citySubdivisionName || "الفرع الرئيسي",
    streetName: streetName || "العنوان الوطني",
  };
}

function toCertificatePem(binarySecurityToken: string) {
  const compactToken = binarySecurityToken.replace(/\s+/g, "");
  const decoded = Buffer.from(compactToken, "base64").toString("utf8").trim();
  if (decoded.includes("-----BEGIN CERTIFICATE-----")) return decoded;
  const certificateBody =
    /^[A-Za-z0-9+/=\s]+$/.test(decoded) && decoded.length > 100
      ? decoded.replace(/\s+/g, "")
      : compactToken;
  return `-----BEGIN CERTIFICATE-----\n${certificateBody.match(/.{1,64}/g)?.join("\n") ?? certificateBody}\n-----END CERTIFICATE-----`;
}

function createCompatibleCertificate(
  certificatePem: string,
  privateKeyPem: string,
  secret: string,
) {
  const x509 = new X509();
  x509.readCertPEM(certificatePem);
  const certificateBody = certificatePem.replace(
    /-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/g,
    "",
  );
  const issuer = x509
    .getIssuerString()
    .split("/")
    .filter(Boolean)
    .reverse()
    .join(", ");
  const serialNumber = BigInt(`0x${x509.getSerialNumberHex()}`).toString(10);

  return {
    getRawCertificate: () => certificatePem,
    getSecretKey: () => secret,
    getCertHash: () =>
      Buffer.from(
        createHash("sha256").update(certificateBody).digest("hex"),
        "utf8",
      ).toString("base64"),
    getFormattedIssuer: () => issuer,
    getSerialNumber: () => serialNumber,
    getRawPublicKey: () =>
      Buffer.from(x509.getPublicKeyHex(), "hex").toString("base64"),
    getCertSignature: () => Buffer.from(x509.getSignatureValueHex(), "hex"),
    sign: (data: Buffer) => {
      const signature = new KJUR.crypto.Signature({ alg: "SHA256withECDSA" });
      signature.init(privateKeyPem);
      signature.updateHex(data.toString("hex"));
      return Buffer.from(signature.sign(), "hex");
    },
  } as unknown as Certificate;
}

function correctXadesDigests(xml: string, certificate: Certificate) {
  const signingTime = xml.match(
    /<xades:SigningTime>([^<]+)<\/xades:SigningTime>/,
  )?.[1];
  if (!signingTime) throw new Error("تعذر التحقق من وقت توقيع XAdES");

  const signedPropertiesXml =
    '<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">\n' +
    "                                <xades:SignedSignatureProperties>\n" +
    `                                    <xades:SigningTime>${signingTime}</xades:SigningTime>\n` +
    "                                    <xades:SigningCertificate>\n" +
    "                                        <xades:Cert>\n" +
    "                                            <xades:CertDigest>\n" +
    '                                                <ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>\n' +
    `                                                <ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${certificate.getCertHash()}</ds:DigestValue>\n` +
    "                                            </xades:CertDigest>\n" +
    "                                            <xades:IssuerSerial>\n" +
    `                                                <ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${certificate.getFormattedIssuer()}</ds:X509IssuerName>\n` +
    `                                                <ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${certificate.getSerialNumber()}</ds:X509SerialNumber>\n` +
    "                                            </xades:IssuerSerial>\n" +
    "                                        </xades:Cert>\n" +
    "                                    </xades:SigningCertificate>\n" +
    "                                </xades:SignedSignatureProperties>\n" +
    "                            </xades:SignedProperties>";
  const digest = Buffer.from(
    createHash("sha256").update(signedPropertiesXml, "utf8").digest("hex"),
    "utf8",
  ).toString("base64");

  const correctedType = xml.replace(
    'Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties"',
    'Type="http://uri.etsi.org/01903#SignedProperties" URI="#xadesSignedProperties"',
  );
  return correctedType.replace(
    /(<ds:Reference Type="http:\/\/uri\.etsi\.org\/01903#SignedProperties" URI="#xadesSignedProperties">[\s\S]*?<ds:DigestValue>)[^<]*(<\/ds:DigestValue>)/,
    `$1${digest}$2`,
  );
}

function extractQrCodeData(xml: string) {
  const documentReferences =
    xml.match(
      /<cac:AdditionalDocumentReference>[\s\S]*?<\/cac:AdditionalDocumentReference>/g,
    ) ?? [];
  const qrReference = documentReferences.find((reference) =>
    /<cbc:ID>\s*QR\s*<\/cbc:ID>/.test(reference),
  );
  return (
    qrReference
      ?.match(
        /<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)<\/cbc:EmbeddedDocumentBinaryObject>/,
      )?.[1]
      ?.trim() ?? null
  );
}

function getAcceptedInvoiceArtifacts(
  responseData: any,
  signed: {
    signedXml: string;
    qrCodeData: string;
    signatureValue: string;
    simplified: boolean;
  },
) {
  if (signed.simplified || !clean(responseData?.clearedInvoice)) {
    return {
      invoiceXml: signed.signedXml,
      qrCodeData: signed.qrCodeData,
      cryptographicStamp: signed.signatureValue,
    };
  }

  try {
    const invoiceXml = Buffer.from(
      clean(responseData.clearedInvoice).replace(/\s+/g, ""),
      "base64",
    ).toString("utf8");
    if (!invoiceXml.includes("<Invoice")) throw new Error("Invalid cleared XML");
    return {
      invoiceXml,
      qrCodeData: extractQrCodeData(invoiceXml) ?? signed.qrCodeData,
      cryptographicStamp:
        invoiceXml.match(/<ds:SignatureValue[^>]*>([^<]+)<\/ds:SignatureValue>/)
          ?.[1] ?? signed.signatureValue,
    };
  } catch {
    return {
      invoiceXml: signed.signedXml,
      qrCodeData: signed.qrCodeData,
      cryptographicStamp: signed.signatureValue,
    };
  }
}

// The XML builder always emits <cac:PartyIdentification> with the default TIN
// scheme, so simplified B2C invoices carry an empty BT-46 that ZATCA flags as
// BR-KSA-F-07. Drop identification blocks that have no value.
function removeEmptyPartyIdentification(xml: string) {
  return xml.replace(
    /[ \t]*<cac:PartyIdentification>\s*<cbc:ID schemeID="[^"]*">\s*<\/cbc:ID>\s*<\/cac:PartyIdentification>\r?\n?/g,
    "",
  );
}

/**
 * أسباب الصفرية (الفئة Z) المعتمدة لدى ZATCA التي يستعملها ZainCare.
 *
 * * VATEX-SA-HEA — الرعاية الصحية الخاصة للمواطن: تُحسب من ملفّ المريض
 *   (جنسيته في قائمة الإعفاء وهويّته الوطنية ثابتة). هكذا كان Kizen يُبلّغ
 *   فواتير المواطنين بضريبة 0.00.
 * * VATEX-SA-35 — الأدوية والمعدّات الطبية: من بطاقة الصنف
 *   (`items.zatca_exemption_code`، لقطةٌ في البند — 0202) لبندٍ صفريّ لغير
 *   المواطن.
 */
const ZATCA_EXEMPTIONS: Record<string, string> = {
  "VATEX-SA-HEA": "Private healthcare to citizen",
  "VATEX-SA-35": "Medicines and medical equipment",
};

type TaxCategoryCode = "S" | "Z";

/** بندٌ بفئته الضريبية كما سيُبلَّغ. */
type TaxLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  /** خصم البند بالريال */
  discount: number;
  rate: number;
  category: TaxCategoryCode;
  /** سبب الصفرية للفئة Z */
  exemptionCode?: string;
};

type MonetaryLine = TaxLine & {
  grossCents: number;
  discountCents: number;
  netCents: number;
  vatCents: number;
};

type MonetaryCategory = {
  category: TaxCategoryCode;
  rate: number;
  exemptionCode?: string;
  baseCents: number;
  allowanceCents: number;
  taxableCents: number;
  taxCents: number;
};

type MonetaryModel = {
  lines: MonetaryLine[];
  categories: MonetaryCategory[];
  documentDiscountCents: number;
  lineExtensionCents: number;
  taxExclusiveCents: number;
  taxCents: number;
  taxInclusiveCents: number;
};

/** هللات صحيحة — المبالغ المخزّنة بخانتين، فلا كسور عائمة في الجمع. */
const toCents = (value: number) => Math.round(Number(value || 0) * 100);
/** تقريبٌ نصفيّ بعيدًا عن الصفر كـ`round(numeric, 2)` في PostgreSQL. */
const roundCents = (value: number) => Math.sign(value) * Math.round(Math.abs(value) + 1e-7);
const amountText = (cents: number) => (cents / 100).toFixed(2);
const decimalText = (value: number, min = 2, max = 6) => {
  const fixed = Number(value).toFixed(max).replace(/0+$/, "");
  const [whole, fraction = ""] = fixed.split(".");
  return `${whole}.${fraction.padEnd(min, "0")}`;
};

/**
 * الحساب الذي يُبلَّغ — بقواعد EN 16931 وZATCA، ومن البنود لا من الرأس:
 *
 *   صافي البند            = تقريب(الكمية × السعر) − خصم البند
 *   ضريبة البند           = تقريب(صافي البند × النسبة)            (BR-KSA-50)
 *   وعاء الفئة            = Σ صافي بنودها − نصيبها من خصم المستند
 *   ضريبة الفئة           = تقريب(وعاء الفئة × النسبة)            (BR-CO-17)
 *   الإجمالي قبل الضريبة  = Σ صافي البنود − خصم المستند           (BR-CO-13)
 *   الإجمالي              = قبل الضريبة + Σ ضريبة الفئات          (BR-CO-15)
 *
 * خصم المستند يوزَّع على الفئات بنسبة أوعيتها، والباقي من التقريب على أكبرها
 * — **القاعدة نفسها حرفيًّا** في `app_apply_invoice_discount` (0202)، فتطابق
 * ضريبة الرأس المخزّنة ضريبة المستند المُبلَّغ.
 */
function computeMonetaryModel(lines: TaxLine[], documentDiscount: number): MonetaryModel {
  const modelLines: MonetaryLine[] = lines.map((line) => {
    const grossCents = roundCents(line.quantity * line.unitPrice * 100);
    const discountCents = toCents(line.discount);
    const netCents = grossCents - discountCents;
    return {
      ...line,
      grossCents,
      discountCents,
      netCents,
      vatCents: roundCents((netCents * line.rate) / 100),
    };
  });

  const groups = new Map<string, MonetaryCategory>();
  for (const line of modelLines) {
    const key = `${line.category}|${line.rate}|${line.exemptionCode ?? ""}`;
    const group = groups.get(key) ?? {
      category: line.category,
      rate: line.rate,
      exemptionCode: line.exemptionCode,
      baseCents: 0,
      allowanceCents: 0,
      taxableCents: 0,
      taxCents: 0,
    };
    group.baseCents += line.netCents;
    groups.set(key, group);
  }
  const categories = [...groups.values()].sort(
    (a, b) => b.baseCents - a.baseCents || b.rate - a.rate,
  );
  if (new Set(categories.map((group) => group.rate)).size !== categories.length) {
    // التوزيع في القاعدة على النسبة؛ فئتان بنسبةٍ واحدة تفترقان عنه
    throw new Error("فئتان ضريبيتان بالنسبة نفسها في مستندٍ واحد — غير مدعوم (TAX_GROUPS_AMBIGUOUS)");
  }

  const totalBase = categories.reduce((sum, group) => sum + group.baseCents, 0);
  const discountCents = toCents(documentDiscount);
  if (discountCents < 0 || discountCents > totalBase) {
    throw new Error("خصم الفاتورة أكبر من صافي بنودها (DOCUMENT_DISCOUNT_INVALID)");
  }
  if (discountCents > 0) {
    let others = 0;
    categories.forEach((group, index) => {
      if (index === 0) return;
      group.allowanceCents = roundCents((discountCents * group.baseCents) / totalBase);
      others += group.allowanceCents;
    });
    categories[0].allowanceCents = discountCents - others;
  }
  for (const group of categories) {
    group.taxableCents = group.baseCents - group.allowanceCents;
    if (group.taxableCents < 0) throw new Error("DOCUMENT_DISCOUNT_ALLOCATION_NEGATIVE");
    group.taxCents = roundCents((group.taxableCents * group.rate) / 100);
  }

  const lineExtensionCents = totalBase;
  const taxExclusiveCents = lineExtensionCents - discountCents;
  const taxCents = categories.reduce((sum, group) => sum + group.taxCents, 0);
  return {
    lines: modelLines,
    categories,
    documentDiscountCents: discountCents,
    lineExtensionCents,
    taxExclusiveCents,
    taxCents,
    taxInclusiveCents: taxExclusiveCents + taxCents,
  };
}

const TAX_SCHEME =
  '<cac:TaxScheme><cbc:ID schemeID="UN/ECE 5153" schemeAgencyID="6">VAT</cbc:ID></cac:TaxScheme>';

function taxCategoryXml(
  group: { category: TaxCategoryCode; rate: number; exemptionCode?: string },
  withReason: boolean,
  indent: string,
) {
  const inner = `\n${indent}    `;
  const reason =
    withReason && group.category === "Z" && group.exemptionCode
      ? `${inner}<cbc:TaxExemptionReasonCode>${group.exemptionCode}</cbc:TaxExemptionReasonCode>` +
        `${inner}<cbc:TaxExemptionReason>${escapeXmlText(ZATCA_EXEMPTIONS[group.exemptionCode])}</cbc:TaxExemptionReason>`
      : "";
  return (
    `<cac:TaxCategory>` +
    `${inner}<cbc:ID schemeID="UN/ECE 5305" schemeAgencyID="6">${group.category}</cbc:ID>` +
    `${inner}<cbc:Percent>${group.rate.toFixed(2)}</cbc:Percent>` +
    reason +
    `${inner}${TAX_SCHEME}` +
    `\n${indent}</cac:TaxCategory>`
  );
}

/**
 * يعيد بناء الأقسام المالية في UBL من الحساب أعلاه.
 *
 * المولّد (`zatca-node`) لا يعرف إلا الفئة القياسية (S) ومجموعًا ضريبيًا
 * واحدًا وخصمًا صفريًّا على المستند — فلا يكتب فاتورةً مختلطة، ولا خصمًا على
 * الفاتورة، ولا الفئة الصفرية. فيُستبدل **قبل التوقيع**: خصومات المستند
 * (AllowanceCharge) ومجموعا الضريبة (TaxTotal) والإجماليات
 * (LegalMonetaryTotal) وكلّ بند (InvoiceLine). ما سواها — الترويسة، والعدّاد
 * والتجزئة السابقة، والبائع والمشتري، والمرجع والدفع — يبقى كما كتبه المولّد.
 *
 * أيّ شكلٍ غير متوقّع (عدد بنود مختلف، أو قسمٌ ماليّ بقي بعد الحذف) يوقف
 * الإرسال: مستندٌ ضريبيّ بقسمين متناقضين أسوأ من مستندٍ لم يُرسل.
 */
function rebuildMonetarySections(xml: string, model: MonetaryModel) {
  const lineOpen = "<cac:InvoiceLine>";
  const lineClose = "</cac:InvoiceLine>";
  const first = xml.indexOf(lineOpen);
  const last = xml.lastIndexOf(lineClose);
  if (first < 0 || last < first) throw new Error("UBL_INVOICE_LINES_NOT_FOUND");
  const end = last + lineClose.length;
  const generatedLines = xml.slice(first, end).match(/<cac:InvoiceLine>[\s\S]*?<\/cac:InvoiceLine>/g) ?? [];
  if (generatedLines.length !== model.lines.length) {
    throw new Error(`UBL_LINE_COUNT_MISMATCH ${generatedLines.length}/${model.lines.length}`);
  }

  let head = xml.slice(0, first);
  for (const tag of ["AllowanceCharge", "TaxTotal", "LegalMonetaryTotal"]) {
    head = head.replace(
      new RegExp(`[ \\t]*<cac:${tag}>[\\s\\S]*?<\\/cac:${tag}>[ \\t]*\\r?\\n?`, "g"),
      "",
    );
  }
  if (/AllowanceCharge|TaxTotal|LegalMonetaryTotal|TaxSubtotal/.test(head)) {
    throw new Error("UBL_MONETARY_SECTION_UNEXPECTED_SHAPE");
  }
  head = head.replace(/\s*$/, "\n");

  const allowances = model.categories
    .filter((group) => group.allowanceCents > 0)
    .map(
      (group) =>
        `    <cac:AllowanceCharge>` +
        `\n        <cbc:ChargeIndicator>false</cbc:ChargeIndicator>` +
        `\n        <cbc:AllowanceChargeReasonCode>95</cbc:AllowanceChargeReasonCode>` +
        `\n        <cbc:AllowanceChargeReason>Discount</cbc:AllowanceChargeReason>` +
        `\n        <cbc:Amount currencyID="SAR">${amountText(group.allowanceCents)}</cbc:Amount>` +
        `\n        ${taxCategoryXml(group, false, "        ")}` +
        `\n    </cac:AllowanceCharge>\n`,
    )
    .join("");

  const subtotals = model.categories
    .map(
      (group) =>
        `\n        <cac:TaxSubtotal>` +
        `\n            <cbc:TaxableAmount currencyID="SAR">${amountText(group.taxableCents)}</cbc:TaxableAmount>` +
        `\n            <cbc:TaxAmount currencyID="SAR">${amountText(group.taxCents)}</cbc:TaxAmount>` +
        `\n            ${taxCategoryXml(group, true, "            ")}` +
        `\n        </cac:TaxSubtotal>`,
    )
    .join("");

  const totals =
    `    <cac:TaxTotal>` +
    `\n        <cbc:TaxAmount currencyID="SAR">${amountText(model.taxCents)}</cbc:TaxAmount>` +
    `\n    </cac:TaxTotal>` +
    `\n    <cac:TaxTotal>` +
    `\n        <cbc:TaxAmount currencyID="SAR">${amountText(model.taxCents)}</cbc:TaxAmount>` +
    subtotals +
    `\n    </cac:TaxTotal>` +
    `\n    <cac:LegalMonetaryTotal>` +
    `\n        <cbc:LineExtensionAmount currencyID="SAR">${amountText(model.lineExtensionCents)}</cbc:LineExtensionAmount>` +
    `\n        <cbc:TaxExclusiveAmount currencyID="SAR">${amountText(model.taxExclusiveCents)}</cbc:TaxExclusiveAmount>` +
    `\n        <cbc:TaxInclusiveAmount currencyID="SAR">${amountText(model.taxInclusiveCents)}</cbc:TaxInclusiveAmount>` +
    `\n        <cbc:AllowanceTotalAmount currencyID="SAR">${amountText(model.documentDiscountCents)}</cbc:AllowanceTotalAmount>` +
    `\n        <cbc:PrepaidAmount currencyID="SAR">0.00</cbc:PrepaidAmount>` +
    `\n        <cbc:PayableAmount currencyID="SAR">${amountText(model.taxInclusiveCents)}</cbc:PayableAmount>` +
    `\n    </cac:LegalMonetaryTotal>\n`;

  const lines = model.lines
    .map((line, index) => {
      const name = escapeXmlText(line.description) || "بند";
      const allowance =
        line.discountCents > 0
          ? `\n        <cac:AllowanceCharge>` +
            `\n            <cbc:ChargeIndicator>false</cbc:ChargeIndicator>` +
            `\n            <cbc:AllowanceChargeReasonCode>95</cbc:AllowanceChargeReasonCode>` +
            `\n            <cbc:AllowanceChargeReason>Discount</cbc:AllowanceChargeReason>` +
            `\n            <cbc:Amount currencyID="SAR">${amountText(line.discountCents)}</cbc:Amount>` +
            `\n        </cac:AllowanceCharge>`
          : "";
      return (
        `    <cac:InvoiceLine>` +
        `\n        <cbc:ID>${index + 1}</cbc:ID>` +
        `\n        <cbc:InvoicedQuantity unitCode="PCE">${decimalText(line.quantity, 6, 6)}</cbc:InvoicedQuantity>` +
        `\n        <cbc:LineExtensionAmount currencyID="SAR">${amountText(line.netCents)}</cbc:LineExtensionAmount>` +
        allowance +
        `\n        <cac:TaxTotal>` +
        `\n            <cbc:TaxAmount currencyID="SAR">${amountText(line.vatCents)}</cbc:TaxAmount>` +
        `\n            <cbc:RoundingAmount currencyID="SAR">${amountText(line.netCents + line.vatCents)}</cbc:RoundingAmount>` +
        `\n        </cac:TaxTotal>` +
        `\n        <cac:Item>` +
        `\n            <cbc:Name>${name}</cbc:Name>` +
        `\n            <cac:ClassifiedTaxCategory>` +
        `\n                <cbc:ID>${line.category}</cbc:ID>` +
        `\n                <cbc:Percent>${line.rate.toFixed(2)}</cbc:Percent>` +
        `\n                <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>` +
        `\n            </cac:ClassifiedTaxCategory>` +
        `\n        </cac:Item>` +
        `\n        <cac:Price>` +
        `\n            <cbc:PriceAmount currencyID="SAR">${decimalText(line.unitPrice)}</cbc:PriceAmount>` +
        `\n        </cac:Price>` +
        `\n    </cac:InvoiceLine>`
      );
    })
    .join("\n");

  return head + allowances + totals + lines + xml.slice(end);
}

/**
 * الفاتورة المبسّطة (لفرد) لا تشترط عنوان المشتري — كفواتير Kizen المُبلَّغة
 * باسم المريض وهويّته وحدهما. والمولّد يكتب عنوانًا دائمًا، فيُحذف عنوان
 * المشتري حين لا يكون للمريض عنوانٌ وطنيّ صحيح، بدل كتابة عنوانٍ مُختلَق في
 * مستندٍ ضريبيّ. عنوان البائع لا يُمسّ.
 */
function removeBuyerPostalAddress(xml: string) {
  return xml.replace(
    /(<cac:AccountingCustomerParty>(?:(?!<\/cac:AccountingCustomerParty>)[\s\S])*?)[ \t]*<cac:PostalAddress>[\s\S]*?<\/cac:PostalAddress>\r?\n?/,
    "$1",
  );
}

function hasValidRegisteredAddress(location: string) {
  if (!clean(location)) return false;
  try {
    parseRegisteredAddress(location, true);
    return true;
  } catch {
    return false;
  }
}

function buildSignedInvoice(input: {
  setup: any;
  invoice: any;
  /** الحساب المُبلَّغ — بنوده بفئاتها وخصم المستند (`computeMonetaryModel`) */
  model: MonetaryModel;
  icv: number;
  previousHash: string;
  uuid: string;
  documentType: "invoice" | "creditNote" | "debitNote";
  originalInvoiceId?: string;
  originalInvoiceUuid?: string;
  credentials: { csid: string; secret: string };
  /** الهوية الوطنية للمشتري المواطن — لازمة مع VATEX-SA-HEA (BR-KSA-49). */
  buyerNationalId?: string;
}) {
  const {
    setup,
    invoice,
    model,
    icv,
    previousHash,
    uuid,
    documentType,
    originalInvoiceId,
    originalInvoiceUuid,
    credentials,
    buyerNationalId = "",
  } = input;
  const address = parseRegisteredAddress(String(setup.branch_location));
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const simplified = invoice.invoice_type !== "standard";

  const document = new InvoiceData()
    .setInvoiceNumber(String(invoice.id))
    .setIssueDate(clean(invoice.date) || now.slice(0, 10))
    .setIssueTime(clean(invoice.time) || now.slice(11, 19))
    .setDueDate(
      clean(invoice.due_date) || clean(invoice.date) || now.slice(0, 10),
    )
    .setCurrencyCode("SAR")
    .setDocumentCurrencyCode("SAR")
    .setTaxCurrencyCode("SAR")
    .setInvoiceCounter(String(icv))
    .setPreviousInvoiceHash(previousHash);

  if (simplified) document.simplified();
  else document.standard();
  if (documentType === "creditNote") document.creditNote();
  else if (documentType === "debitNote") document.debitNote();
  else document.taxInvoice();

  const seller = new SellerData()
    .setRegistrationName(escapeXmlText(setup.company_name_ar))
    .setVatNumber(String(setup.vat_number))
    .setPartyIdentification(String(setup.commercial_registration))
    .setPartyIdentificationId("CRN")
    .setStreetName(escapeXmlText(address.streetName))
    .setBuildingNumber(address.buildingNumber)
    .setCitySubdivisionName(escapeXmlText(address.citySubdivisionName))
    .setCityName(escapeXmlText(address.cityName))
    .setPostalZone(address.postalZone)
    .setCountryCode("SA");

  const buyerAddress = parseRegisteredAddress(
    clean(invoice.customer_address) || "1234 الرياض 12345",
  );
  const buyer = new BuyerData()
    .setRegistrationName(escapeXmlText(invoice.customer) || "عميل")
    .setStreetName(escapeXmlText(buyerAddress.streetName))
    .setBuildingNumber(buyerAddress.buildingNumber)
    .setCitySubdivisionName(escapeXmlText(buyerAddress.citySubdivisionName))
    .setCityName(escapeXmlText(buyerAddress.cityName))
    .setPostalZone(buyerAddress.postalZone)
    .setCountryCode("SA");
  if (!simplified) {
    // مشتري الأعمال (0202): السجلّ التجاريّ معرّفًا، والرقم الضريبيّ إن كان
    // مسجّلًا. معرّفٌ فارغ يُحذف بعد التوليد (`removeEmptyPartyIdentification`).
    if (clean(invoice.buyer_cr)) {
      buyer.setPartyIdentification(clean(invoice.buyer_cr)).setPartyIdentificationId("CRN");
    }
    if (clean(invoice.buyer_vat)) buyer.setVatNumber(clean(invoice.buyer_vat));
  } else if (buyerNationalId) {
    buyer.setPartyIdentification(buyerNationalId).setPartyIdentificationId("NAT");
  }

  document.setSeller(seller).setBuyer(buyer);
  // البنود تُعطى للمولّد ليكتب هيكل المستند، ثمّ تُستبدل أقسامها المالية
  // كلّها من `model` (`rebuildMonetarySections`) قبل التوقيع.
  model.lines.forEach((line, index) => {
    document.addLine(
      new InvoiceLineData()
        .setId(index + 1)
        .setItemName(escapeXmlText(line.description) || "بند")
        .setDescription(escapeXmlText(line.description) || "بند")
        .setQuantity(line.quantity)
        .setUnitPrice(line.unitPrice)
        .setAllowanceAmount(line.discount)
        .setTaxPercent(line.rate)
        .setUnitCode("EA")
        .calculateTotals(),
    );
  });
  if (documentType !== "invoice") {
    document.addBillingReference({
      id: String(originalInvoiceId ?? invoice.id),
      uuid: String(originalInvoiceUuid ?? crypto.randomUUID()),
    });
    document.addPaymentMeans({
      code: "10",
      instruction_note:
        clean(invoice.reason) ||
        (documentType === "creditNote"
          ? "تخفيض قيمة الفاتورة الأصلية"
          : "زيادة قيمة الفاتورة الأصلية"),
    });
  }
  document.calculateTotals();

  let unsignedXml = removeEmptyPartyIdentification(
    new ZatcaInvoice().generateXml(document, uuid),
  );
  if (simplified && !hasValidRegisteredAddress(clean(invoice.customer_address))) {
    unsignedXml = removeBuyerPostalAddress(unsignedXml);
  }
  unsignedXml = rebuildMonetarySections(unsignedXml, model);
  const certificate = createCompatibleCertificate(
    toCertificatePem(credentials.csid),
    String(setup.private_key_pem),
    credentials.secret,
  );
  const signer = InvoiceSigner.signInvoice(unsignedXml, certificate);
  const signedXml = correctXadesDigests(signer.getXML(), certificate);
  const invoiceHash = signer.getHash();
  const signatureValue =
    signedXml.match(/<ds:SignatureValue>([^<]+)<\/ds:SignatureValue>/)?.[1] ??
    "";

  const qrCodeData = extractQrCodeData(signedXml);
  if (!qrCodeData) {
    throw new Error("SIGNED_XML_QR_MISSING");
  }

  return { signedXml, invoiceHash, qrCodeData, simplified, signatureValue };
}

/* ── قراءة فاتورة ZainCare بصيغة المولّد ─────────────────────────────────── */

const riyadhParts = (iso: string) => {
  const shifted = new Date(Date.parse(iso) + 3 * 60 * 60 * 1000).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 19) };
};

function composeAddress(parts: {
  building?: unknown;
  street?: unknown;
  district?: unknown;
  city?: unknown;
  postal?: unknown;
}) {
  const building = clean(parts.building);
  const street = clean(parts.street);
  const district = clean(parts.district);
  const city = clean(parts.city);
  const postal = clean(parts.postal);
  if (!building && !street && !district && !city && !postal) return "";
  // الصيغة التي يقرؤها `parseRegisteredAddress`
  return `${building} ${street}، ${district}، ${city}، ${postal}`;
}

Deno.serve(async (req) => {
  const appOrigin = headerSafe(clean(Deno.env.get("APP_ORIGIN")));
  const requestOrigin = clean(req.headers.get("Origin"));
  currentOrigin = requestOrigin;
  if (appOrigin && requestOrigin && requestOrigin !== appOrigin) {
    return respond({ error: "Origin not allowed" }, 403);
  }
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: getCorsHeaders() });
  if (req.method !== "POST")
    return respond({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer "))
    return respond({ error: "Unauthorized" }, 401);

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
    const mode: ZatcaMode = body.mode ?? "simulation";
    if (!(["simulation", "production"] as string[]).includes(mode)) {
      return respond({ error: "mode must be simulation or production" }, 400);
    }
    const recordId = clean(body.invoiceId);
    const deviceSerial = clean(body.deviceSerial);
    if (!/^[0-9a-f-]{36}$/i.test(recordId)) {
      return respond({ error: "حدّد الفاتورة المراد إرسالها" }, 400);
    }
    const idempotencyKey = `${mode}:${recordId}`;

    // ── الفاتورة أوّلًا، ثم صلاحية المستخدم في منشأتها بالذات
    const { data: record, error: recordError } = await admin
      .from("sales_invoices")
      .select("*")
      .eq("id", recordId)
      .maybeSingle();
    if (recordError) throw recordError;
    if (!record) return respond({ error: "الفاتورة غير موجودة" }, 404);

    const { data: allowed, error: permissionError } = await caller.rpc(
      "app_has_permission",
      { target_org_id: record.organization_id, p_permission_key: "billing.issue" },
    );
    if (permissionError) throw permissionError;
    if (allowed !== true) {
      return respond({ error: "غير مصرح بإرسال فواتير هذه المنشأة إلى ZATCA" }, 403);
    }
    const organizationId = clean(record.organization_id);

    if (!record.issued_at || ["draft", "void"].includes(clean(record.status))) {
      return respond(
        { error: "لا تُرسل إلى ZATCA إلا فاتورةٌ صادرة غير ملغاة" },
        409,
      );
    }

    const { data: existingLog, error: existingLogError } = await admin
      .from("zatca_invoice_submission_logs")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingLogError) throw existingLogError;
    if (existingLog && ["cleared", "reported"].includes(clean(existingLog.status))) {
      return respond({
        status: existingLog.status,
        uuid: existingLog.request_uuid,
        icv: existingLog.icv,
        qrCodeData: record.zatca_qr_data,
        idempotent: true,
        message: "أُرسلت هذه الفاتورة إلى ZATCA مسبقاً",
      });
    }
    if (clean(existingLog?.status) === "ambiguous") {
      return respond(
        {
          error: "نتيجة الإرسال السابق غير محسومة؛ لا تُعد إرسال الفاتورة قبل المراجعة اليدوية",
          status: "ambiguous",
          retryable: false,
        },
        409,
      );
    }
    if (clean(existingLog?.status) === "submitted") {
      const stamps = [
        Date.parse(clean(existingLog.updated_at)),
        Date.parse(clean(existingLog.created_at)),
      ].filter(Number.isFinite);
      const latest = stamps.length ? Math.max(...stamps) : Number.NEGATIVE_INFINITY;
      if (latest > Date.now() - 5 * 60 * 1000) {
        return respond({ error: "يوجد إرسال جارٍ بالفعل لهذه الفاتورة" }, 409);
      }
      const staleMessage = "Stale submitted invocation exceeded 5 minutes; retry allowed";
      const { error: staleError } = await admin
        .from("zatca_invoice_submission_logs")
        .update({
          status: "failed",
          retry_after: null,
          last_error: staleMessage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingLog.id);
      if (staleError) throw staleError;
      existingLog.status = "failed";
    }

    // ── جهاز ZATCA لهذه المنشأة والبيئة
    let setupQuery = admin
      .from("zatca_onboarding_settings")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("mode", mode)
      .eq("is_archived", false);
    if (mode === "production") setupQuery = setupQuery.eq("production_enabled", true);
    if (deviceSerial) setupQuery = setupQuery.eq("device_serial", deviceSerial);
    const { data: setupRows, error: setupError } = await setupQuery.limit(10);
    if (setupError) throw setupError;
    let setups = setupRows ?? [];
    if (setups.length > 1 && record.branch_id) {
      const sameBranch = setups.filter((row: any) => row.branch_id === record.branch_id);
      if (sameBranch.length) setups = sameBranch;
    }
    if (!setups.length) {
      return respond(
        {
          error:
            mode === "production"
              ? "لا يوجد جهاز ZATCA مفعّل للإنتاج في هذه المنشأة"
              : "لا توجد تهيئة محاكاة ZATCA لهذه المنشأة — أكملها من «الربط مع ZATCA»",
        },
        409,
      );
    }
    if (setups.length > 1) {
      return respond({ error: "حدّد الرقم التسلسلي لجهاز ZATCA المطلوب" }, 409);
    }
    const setup: any = setups[0];

    const { data: unresolved, error: unresolvedError } = await admin
      .from("zatca_invoice_submission_logs")
      .select("id")
      .eq("onboarding_id", setup.id)
      .eq("status", "ambiguous")
      .limit(1)
      .maybeSingle();
    if (unresolvedError) throw unresolvedError;
    if (unresolved) {
      return respond(
        {
          error:
            "يوجد مستند سابق غير محسوم على هذا الجهاز؛ لا ترسل مستندًا جديدًا قبل المراجعة اليدوية",
          status: "ambiguous",
          retryable: false,
        },
        409,
      );
    }
    Object.assign(setup, await getZatcaCredentials(admin, setup.id));

    // ── نوع المستند، والأصل للإشعار
    const documentType: "invoice" | "creditNote" | "debitNote" =
      record.document_type === "credit_note"
        ? "creditNote"
        : record.document_type === "debit_note"
          ? "debitNote"
          : "invoice";
    // فاتورة «مرتجع» من المسار القديم (قبل 0205) نوع مستندها «مبسّطة» لا
    // «إشعار دائن» — إرسالها فاتورةً يُبلغ ZATCA ببيعٍ جديد بدل إنقاص البيع.
    if (documentType === "invoice" && clean(record.invoice_type) === "return") {
      return respond(
        {
          error:
            "هذا مرتجعٌ من المسار القديم (فاتورة مرتجع لا إشعار دائن) — لا يُبلَّغ فاتورةَ بيع. ألغِه وأصدر إشعارًا دائنًا على الفاتورة الأصلية",
        },
        422,
      );
    }

    let originalInvoice: any = null;
    if (documentType !== "invoice") {
      const { data: linked, error: linkedError } = await admin
        .from("sales_invoices")
        .select("id, organization_id, document_type, document_prefix, document_number, invoice_number, zatca_uuid, is_b2b, external_client_id, buyer_snapshot")
        .eq("id", clean(record.corrects_invoice_id))
        .maybeSingle();
      if (linkedError) throw linkedError;
      if (!linked || linked.organization_id !== record.organization_id) {
        return respond({ error: "الفاتورة الأصلية للإشعار غير موجودة" }, 409);
      }
      originalInvoice = linked;
    }
    const scopeSource = originalInvoice ?? record;
    const simplified = scopeSource.document_type !== "standard";
    if (setup.invoice_type === "1000" && simplified) {
      return respond({ error: "شهادة هذا الجهاز للفواتير المعيارية فقط (1000)" }, 409);
    }
    if (setup.invoice_type === "0100" && !simplified) {
      return respond({ error: "شهادة هذا الجهاز للفواتير المبسّطة فقط (0100)" }, 409);
    }

    // ── المشتري
    let patient: any = null;
    if (record.patient_id) {
      const { data: patientRow, error: patientError } = await admin
        .from("patients")
        .select("name_ar, id_type, id_number, tax_number, nationality_value_id, building_number, street, district, postal_code, city:lookup_values!city_value_id(name_ar)")
        .eq("id", record.patient_id)
        .maybeSingle();
      if (patientError) throw patientError;
      patient = patientRow;
    }
    const buyerSnapshot = (record.buyer_snapshot ?? {}) as Record<string, unknown>;
    const patientCity = Array.isArray(patient?.city) ? patient.city[0]?.name_ar : patient?.city?.name_ar;
    /**
     * هويّة المشتري.
     *
     * لقطة المشتري تُؤخذ لحظة الإصدار؛ فإن صُحّح رقم الهويّة في ملفّ المريض
     * بعدها بقيت اللقطة على الرقم القديم ورُفض الإرسال وإن كان الملفّ صحيحًا.
     * يُقدَّم أوّل رقم هويّة وطنيّة صالح (10 أرقام تبدأ بـ1) من اللقطة ثمّ
     * الفاتورة ثمّ الملفّ الحاليّ، وإلّا فأوّل رقمٍ غير فارغ كما كان.
     */
    const buyerIdCandidates = [
      clean(buyerSnapshot.id_number),
      clean(record.id_number),
      clean(patient?.id_number),
    ].map((value) =>
      value
        .replace(/\s+/g, "")
        // أرقام عربية-هندية أو فارسية مكتوبة في الملفّ تُقرأ لاتينية
        .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
        .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0)),
    );
    const buyerIdNumber =
      buyerIdCandidates.find((value) => /^1\d{9}$/.test(value)) ??
      buyerIdCandidates.find((value) => value.length > 0) ??
      "";
    /**
     * مشتري فاتورة الأعمال (0202) — العميل الخارجيّ: من لقطة الإصدار، وإلّا
     * من ملفّه. وللإشعار مشتري فاتورته الأصلية: الإشعار يصحّح مستندها.
     */
    let b2bBuyer: {
      name: string;
      vat: string;
      cr: string;
      address: string;
    } | null = null;
    if (!simplified) {
      const buyerSource = originalInvoice ?? record;
      const snapshot = (buyerSource.buyer_snapshot ?? {}) as Record<string, any>;
      let client: any = null;
      if (clean(buyerSource.external_client_id)) {
        const { data: clientRow, error: clientError } = await admin
          .from("external_clients")
          .select("name, vat_number, cr_number, building_number, street_name, district, city, postal_code")
          .eq("id", clean(buyerSource.external_client_id))
          .maybeSingle();
        if (clientError) throw clientError;
        client = clientRow;
      }
      const fromSnapshot = snapshot.kind === "b2b";
      const address = (fromSnapshot ? snapshot.address : client) ?? {};
      b2bBuyer = {
        name: clean(fromSnapshot ? snapshot.name : client?.name),
        vat: clean(fromSnapshot ? snapshot.vat_number : client?.vat_number),
        cr: clean(fromSnapshot ? snapshot.cr_number : client?.cr_number),
        address: composeAddress({
          building: address.building_number,
          street: address.street_name,
          district: address.district,
          city: address.city,
          postal: address.postal_code,
        }),
      };
    }

    const numberLabel = record.document_number
      ? `${clean(record.document_prefix) || "INV"}-${record.document_number}`
      : String(record.invoice_number);
    const issued = riyadhParts(String(record.issued_at));
    const invoice = {
      id: numberLabel,
      date: issued.date,
      time: issued.time,
      due_date: issued.date,
      customer: b2bBuyer
        ? b2bBuyer.name
        : clean(buyerSnapshot.name) || clean(patient?.name_ar) || clean(record.external_customer_name),
      customer_address: b2bBuyer
        ? b2bBuyer.address
        : composeAddress({
            building: patient?.building_number,
            street: patient?.street,
            district: patient?.district,
            city: patientCity,
            postal: patient?.postal_code,
          }),
      invoice_type: simplified ? "simplified" : "standard",
      buyer_vat: b2bBuyer ? b2bBuyer.vat : "",
      buyer_cr: b2bBuyer ? b2bBuyer.cr : "",
      buyer_id_number: buyerIdNumber,
      reason: clean(record.note_reason),
    };

    const baseUrl = mode === "production" ? PRODUCTION_URL : SIMULATION_URL;
    const endpoint = simplified
      ? `${baseUrl}/invoices/reporting/single`
      : `${baseUrl}/invoices/clearance/single`;
    const attemptCount = Number(existingLog?.attempt_count ?? 0) + 1;
    const baseLog = {
      organization_id: organizationId,
      invoice_id: recordId,
      document_type: documentType,
      invoice_type: simplified ? "simplified" : "standard",
      mode,
      onboarding_id: setup.id,
      idempotency_key: idempotencyKey,
      endpoint,
      attempt_count: attemptCount,
      created_by: user.id,
      updated_at: new Date().toISOString(),
    };
    let durableLogId = clean(existingLog?.id);
    const saveLog = async (values: Record<string, unknown>) => {
      if (durableLogId) {
        const { error } = await admin
          .from("zatca_invoice_submission_logs")
          .update({ ...baseLog, ...values })
          .eq("id", durableLogId);
        if (error) throw error;
        return;
      }
      const { data, error } = await admin
        .from("zatca_invoice_submission_logs")
        .insert({ ...baseLog, ...values })
        .select("id")
        .single();
      if (error) throw error;
      durableLogId = clean(data?.id);
    };
    const setInvoiceStatus = async (status: string, response: unknown) => {
      const { error } = await admin
        .from("sales_invoices")
        .update({
          zatca_status: status,
          zatca_mode: mode,
          zatca_response: response ?? {},
          zatca_submitted_at: new Date().toISOString(),
        })
        .eq("id", recordId);
      if (error) console.error("zatca-invoice status", error);
    };
    await saveLog({
      status: "submitted",
      request_payload: { mode, recordId, deviceSerial: setup.device_serial, endpoint },
      response: {},
      response_text: "",
      retry_after: null,
      last_error: null,
    });
    const rejectBeforeSubmission = async (message: string, status = 409) => {
      await saveLog({
        status: "rejected",
        request_payload: { mode, recordId, deviceSerial: setup.device_serial, reason: message },
        response: {},
        response_text: "",
        retry_after: null,
        last_error: message,
      });
      return respond({ error: message }, status);
    };

    // ── البنود من جدولها، ولا يُرسل إلا ما يطابق مجموعه رأسَ الفاتورة
    const { data: itemRows, error: itemsError } = await admin
      .from("sales_invoice_items")
      .select("description, item_name_snapshot, qty, price, discount_amount, vat_rate, zatca_exemption_code")
      .eq("invoice_id", recordId)
      .order("created_at");
    if (itemsError) throw itemsError;
    const rawLines = (itemRows ?? []).map((item: any) => ({
      description: clean(item.item_name_snapshot) || clean(item.description),
      quantity: Number(item.qty) || 0,
      unitPrice: Number(item.price) || 0,
      discount: Math.max(Number(item.discount_amount) || 0, 0),
      rate: Number(item.vat_rate ?? 0),
      itemExemptionCode: clean(item.zatca_exemption_code),
    }));
    if (!rawLines.length) {
      return await rejectBeforeSubmission("لا توجد بنود في الفاتورة", 400);
    }
    if (rawLines.some((line) => line.quantity <= 0 || line.unitPrice < 0 || line.discount > line.quantity * line.unitPrice)) {
      return await rejectBeforeSubmission("توجد كمية أو قيمة خصم غير صالحة في بنود الفاتورة", 400);
    }
    if (rawLines.some((line) => Math.abs(line.rate) >= 0.001 && Math.abs(line.rate - 15) >= 0.001)) {
      return await rejectBeforeSubmission(
        "في الفاتورة بندٌ بنسبة ضريبة غير 15% وغير صفر — غير مدعوم في الربط",
        422,
      );
    }

    /**
     * فئة كلّ بند — والفاتورة قد تجمع الفئتين (0202).
     *
     * 15% ⇒ القياسية (S). و0% ⇒ الصفرية (Z) بسببٍ معتمد لا يُفترض:
     *   * المواطن (جنسيته في قائمة الإعفاء وهويّته الوطنية صالحة) في فاتورة
     *     مبسّطة ⇒ VATEX-SA-HEA لكلّ بنوده الصفرية. يُعاد حسابه هنا من ملفّ
     *     المريض وإعدادات المنشأة، لا يؤخذ من الفاتورة.
     *   * غيره ⇒ سبب الصنف المحفوظ في البند (VATEX-SA-35، أدوية ومعدّات
     *     طبية). بندٌ صفريّ بلا سبب يُرفض قبل الإرسال ويُسمّى.
     * فاتورة الأعمال لا تحمل إعفاء المواطن: مشتريها منشأة (BR-KSA-49).
     */
    const zeroLines = rawLines.filter((line) => Math.abs(line.rate) < 0.001);
    let citizenNationality = false;
    if (zeroLines.length) {
      const { data: vatSettings, error: vatSettingsError } = await admin
        .from("organization_vat_settings")
        .select("vat_exempt_nationality_value_ids, vat_exemption_disabled_for_customer_types")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (vatSettingsError) throw vatSettingsError;
      const nationality = clean(record.nationality_value_id) || clean(patient?.nationality_value_id);
      const exemptNationalities: string[] = Array.isArray(vatSettings?.vat_exempt_nationality_value_ids)
        ? vatSettings.vat_exempt_nationality_value_ids
        : [];
      citizenNationality =
        simplified &&
        Boolean(record.patient_id) &&
        Boolean(nationality) &&
        exemptNationalities.includes(nationality) &&
        vatSettings?.vat_exemption_disabled_for_customer_types !== true;
    }
    const citizenIdValid = /^1\d{9}$/.test(buyerIdNumber);
    const citizenExempt = citizenNationality && citizenIdValid;

    const taxLines: TaxLine[] = [];
    for (const line of rawLines) {
      if (Math.abs(line.rate) >= 0.001) {
        taxLines.push({ ...line, rate: 15, category: "S" });
        continue;
      }
      const code = citizenExempt ? "VATEX-SA-HEA" : line.itemExemptionCode;
      if (!code || !ZATCA_EXEMPTIONS[code]) {
        const label = line.description || "بند";
        return await rejectBeforeSubmission(
          citizenNationality && !citizenIdValid
            ? "الإعفاء الصحّي للمواطن يتطلّب رقم الهوية الوطنية (10 أرقام تبدأ بـ1) في ملفّ المريض"
            : !simplified
              ? `البند «${label}» بلا ضريبة ولا سبب صفرية معتمد لفاتورة الأعمال — إعفاء المواطن لا يُبلَّغ في فاتورة أعمال، وصفرية الأدوية والمعدّات الطبية تُحدَّد في بطاقة الصنف`
              : `البند «${label}» بلا ضريبة والمريض ليس من الجنسية المعفاة — لا سبب صفرية معتمدًا له لدى ZATCA. إن كان دواءً أو معدّات طبية فحدّد ذلك في بطاقة الصنف ثمّ أصدر فاتورة جديدة، وإلّا فيُصدر بالضريبة`,
          422,
        );
      }
      taxLines.push({ ...line, rate: 0, category: "Z", exemptionCode: code });
    }
    if (new Set(taxLines.filter((line) => line.category === "Z").map((line) => line.exemptionCode)).size > 1) {
      return await rejectBeforeSubmission(
        "بنود الفاتورة الصفرية بأسباب إعفاء مختلفة — غير مدعوم في مستندٍ واحد",
        422,
      );
    }

    let model: MonetaryModel;
    try {
      model = computeMonetaryModel(taxLines, Number(record.document_discount_amount ?? 0));
    } catch (error: any) {
      return await rejectBeforeSubmission(clean(error?.message) || "تعذّر حساب إجماليات الفاتورة", 422);
    }
    if (
      Math.abs(toCents(Number(record.vat_amount ?? 0)) - model.taxCents) > 5 ||
      Math.abs(toCents(Number(record.net_amount ?? 0)) - model.taxInclusiveCents) > 5
    ) {
      return await rejectBeforeSubmission(
        `إجماليات الفاتورة (الضريبة ${Number(record.vat_amount ?? 0).toFixed(2)}، الصافي ${Number(record.net_amount ?? 0).toFixed(2)}) ` +
          `لا تطابق بنودها وخصمها (الضريبة ${amountText(model.taxCents)}، الصافي ${amountText(model.taxInclusiveCents)})`,
        422,
      );
    }

    // ── فاتورة الأعمال: مشترٍ معرَّف بعنوانٍ وطنيّ — في المحاكاة والإنتاج معًا
    if (!simplified) {
      if (!invoice.customer) {
        return await rejectBeforeSubmission("اسم المشتري (العميل الخارجيّ) مطلوب لفاتورة الأعمال", 422);
      }
      const vatValid = /^3\d{13}3$/.test(invoice.buyer_vat);
      const crValid = /^\d{10}$/.test(invoice.buyer_cr);
      if (!vatValid && !crValid) {
        return await rejectBeforeSubmission(
          "فاتورة الأعمال تتطلّب الرقم الضريبيّ للعميل (15 رقمًا يبدأ وينتهي بـ3) أو سجلّه التجاريّ (10 أرقام) — أكمله في «العملاء الخارجيون»",
          422,
        );
      }
      if (!hasValidRegisteredAddress(invoice.customer_address)) {
        return await rejectBeforeSubmission(
          "العنوان الوطنيّ للعميل ناقص: رقم مبنى من 4 أرقام، والشارع، والحي، والمدينة، ورمز بريدي من 5 أرقام — أكمله في «العملاء الخارجيون»",
          422,
        );
      }
    }

    if (mode === "production") {
      if (body.productionConfirmation !== PRODUCTION_CONFIRMATION) {
        return await rejectBeforeSubmission(
          `productionConfirmation must equal ${PRODUCTION_CONFIRMATION}`,
          403,
        );
      }
      if (setup.production_enabled !== true) {
        return await rejectBeforeSubmission("الإرسال الإنتاجي غير مفعّل", 403);
      }
      if (!clean(setup.private_key_pem) || !clean(setup.production_csid) || !clean(setup.production_secret)) {
        return await rejectBeforeSubmission("بيانات اعتماد ZATCA الإنتاجية غير مكتملة");
      }
      const expiresAt = Date.parse(clean(setup.certificate_expires_at));
      if (setup.certificate_revoked_at) {
        return await rejectBeforeSubmission("شهادة ZATCA ملغاة", 403);
      }
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        return await rejectBeforeSubmission("شهادة ZATCA منتهية أو لا يوجد تاريخ انتهاء صالح", 403);
      }
      // فاتورة التأمين (0202، بقرار المالك): مبسّطة واحدة باسم المريض بكامل
      // المبلغ وضريبته؛ حصّة الشركة جهةُ دفعٍ لا مشترٍ ثانٍ. فلا حارس هنا.
      if (
        containsSyntheticMarker({
          number: numberLabel,
          customer: invoice.customer,
          items: taxLines.map((line) => line.description),
        })
      ) {
        return await rejectBeforeSubmission(
          "رُفض مستندٌ إنتاجي يحتوي على بيانات اختبارية أو تجريبية",
          422,
        );
      }
      if (!invoice.customer) {
        return await rejectBeforeSubmission("اسم المشتري مطلوب قبل الإرسال الإنتاجي", 422);
      }
      // العنوان الوطنيّ وهويّة مشتري الأعمال تُفحص أعلاه في البيئتين؛ المبسّطة
      // (لفرد) تُبلَّغ بلا عنوان المشتري، كما كانت فواتير Kizen تُبلَّغ.
      if (documentType !== "invoice") {
        if (!invoice.reason) {
          return await rejectBeforeSubmission("سبب الإشعار الدائن أو المدين مطلوب", 422);
        }
        if (!clean(originalInvoice?.zatca_uuid)) {
          return await rejectBeforeSubmission(
            "لا يُرسل إشعارٌ إنتاجي قبل إرسال فاتورته الأصلية إلى ZATCA",
            422,
          );
        }
      }
    }

    /**
     * **اعتماد الإرسال شهادة البيئة لا شهادة التوافق.**
     *
     * شهادة التوافق (CCSID) تُقبل على `/compliance/invoices` وحدها — وهي
     * اختبارات التهيئة. أمّا `/invoices/reporting/single` و
     * `/invoices/clearance/single` فتطلبان شهادة البيئة (PCSID)، وتُصدَر بعد
     * اجتياز اختبارات التوافق. وإرسالُ فاتورةٍ بشهادة التوافق يردّ 401 بلا
     * تفسير — وهو ما كان يحدث: «لم تُقبل الفاتورة لدى ZATCA — HTTP 401».
     *
     * وبيئة المحاكاة كالإنتاج في هذا: لها شهادة بيئةٍ خاصّة بها.
     */
    const credentials = {
      csid: clean(setup.production_csid),
      secret: clean(setup.production_secret),
    };
    if (!clean(setup.private_key_pem) || !credentials.csid || !credentials.secret) {
      return await rejectBeforeSubmission(
        mode === "production"
          ? "بيانات اعتماد ZATCA الإنتاجية غير مكتملة"
          : "شهادة بيئة المحاكاة غير مُصدَرة — نفّذ «اختبارات التوافق» ثمّ «شهادة الإنتاج» في شاشة الربط مع ZATCA، فشهادة التوافق لا تصلح لإرسال الفواتير",
      );
    }

    // ── حجز ICV/PIH ذرّيًا
    const { data: reservationRows, error: reservationError } = await admin.rpc(
      "reserve_zatca_sequence",
      { p_onboarding_id: setup.id },
    );
    if (reservationError) {
      const message = clean(reservationError.message) || "تعذر حجز تسلسل ZATCA";
      await saveLog({
        status: "failed",
        request_payload: { mode, recordId, endpoint },
        response: {},
        response_text: "",
        retry_after: getRetryAfter(),
        last_error: message,
      });
      return respond({ error: message }, 409);
    }
    const reservation = Array.isArray(reservationRows) ? reservationRows[0] : reservationRows;
    const reservationToken = clean(reservation?.reservation_token);
    const icv = Number(reservation?.icv);
    const previousHash = clean(reservation?.previous_pih) || ZATCA_INITIAL_PIH;
    if (!reservationToken || !Number.isSafeInteger(icv) || icv < 1) {
      if (reservationToken) {
        await admin.rpc("release_zatca_sequence", {
          p_onboarding_id: setup.id,
          p_reservation_token: reservationToken,
        });
      }
      await saveLog({
        status: "failed",
        retry_after: getRetryAfter(),
        last_error: "استجابة حجز تسلسل ZATCA غير صالحة",
      });
      throw new Error("استجابة حجز تسلسل ZATCA غير صالحة");
    }

    let sequenceFinalized = false;
    let sequenceBlocked = false;
    let submissionAmbiguous = false;
    const markAmbiguousAndBlock = async (values: Record<string, unknown>, reason: string) => {
      submissionAmbiguous = true;
      try {
        await saveLog({ ...values, status: "ambiguous", retry_after: null, last_error: reason });
      } catch (error) {
        console.error("zatca-invoice ambiguous log", error);
      }
      await setInvoiceStatus("ambiguous", values.response);
      const { error: blockError } = await admin.rpc("block_zatca_sequence", {
        p_onboarding_id: setup.id,
        p_reservation_token: reservationToken,
        p_reason: reason,
      });
      if (blockError) {
        const error = new Error(
          clean(blockError.message) || "تعذر حظر تسلسل ZATCA للمراجعة",
        ) as Error & { zatcaStatus?: string };
        error.zatcaStatus = "ambiguous";
        throw error;
      }
      sequenceBlocked = true;
    };

    try {
      const uuid = clean(record.zatca_uuid) || crypto.randomUUID();
      const signed = buildSignedInvoice({
        setup,
        invoice,
        model,
        icv,
        previousHash,
        uuid,
        documentType,
        originalInvoiceId: originalInvoice
          ? originalInvoice.document_number
            ? `${clean(originalInvoice.document_prefix) || "INV"}-${originalInvoice.document_number}`
            : String(originalInvoice.invoice_number)
          : undefined,
        originalInvoiceUuid: clean(originalInvoice?.zatca_uuid) || undefined,
        credentials,
        buyerNationalId: citizenExempt ? buyerIdNumber : "",
      });
      const requestPayload = {
        mode,
        recordId,
        documentType,
        invoiceType: simplified ? "simplified" : "standard",
        deviceSerial: setup.device_serial,
        endpoint,
        uuid,
        icv,
        previousPih: previousHash,
        invoiceHash: signed.invoiceHash,
        invoiceBytes: Buffer.byteLength(signed.signedXml, "utf8"),
      };
      // الـXML الموقّع يُحفظ قبل الشبكة: لو قُبل ثم تعذّر التثبيت محليًا، يبقى
      // المستند القانوني المرسل بعينه للمطابقة — ولا يُرسل مرّةً ثانية.
      await saveLog({
        status: "submitted",
        http_status: null,
        request_uuid: uuid,
        invoice_hash: signed.invoiceHash,
        icv,
        previous_pih: previousHash,
        request_payload: requestPayload,
        signed_invoice_xml: signed.signedXml,
        qr_code_data: signed.qrCodeData,
        cryptographic_stamp: signed.signatureValue,
        response: {},
        response_text: "",
        retry_after: null,
        last_error: null,
      });

      let zatcaResponse: Response;
      try {
        zatcaResponse = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "Accept-Version": "V2",
            "Accept-Language": "en",
            "Clearance-Status": signed.simplified ? "0" : "1",
            Authorization: `Basic ${Buffer.from(`${credentials.csid}:${credentials.secret}`, "utf8").toString("base64")}`,
          },
          body: JSON.stringify({
            invoiceHash: signed.invoiceHash,
            uuid,
            invoice: Buffer.from(signed.signedXml, "utf8").toString("base64"),
          }),
          signal: AbortSignal.timeout(35_000),
        });
      } catch (error: any) {
        const message = clean(error?.message) || "ZATCA network error";
        await markAmbiguousAndBlock(
          {
            http_status: null,
            request_uuid: uuid,
            invoice_hash: signed.invoiceHash,
            icv,
            previous_pih: previousHash,
            request_payload: requestPayload,
            response: {},
            response_text: "",
          },
          message,
        );
        return respond({ error: message, status: "ambiguous", retryable: false }, 503);
      }

      let responseText: string;
      try {
        responseText = await zatcaResponse.text();
      } catch (error: any) {
        const message = clean(error?.message) || "ZATCA network error";
        await markAmbiguousAndBlock(
          {
            http_status: zatcaResponse.status,
            request_uuid: uuid,
            invoice_hash: signed.invoiceHash,
            icv,
            previous_pih: previousHash,
            request_payload: requestPayload,
            response: {},
            response_text: "",
          },
          message,
        );
        return respond({ error: message, status: "ambiguous", retryable: false }, 503);
      }
      let responseData: any = {};
      try {
        responseData = responseText ? JSON.parse(responseText) : {};
      } catch {
        responseData = {};
      }
      const httpAccepted = [200, 202].includes(zatcaResponse.status);
      const validation = getValidationResult(responseData);
      const accepted = httpAccepted && validation.accepted;
      const retryable = zatcaResponse.status >= 500;
      const submittedAt = new Date().toISOString();

      if (!accepted) {
        const errorMessage = validation.message || responseText || `ZATCA HTTP ${zatcaResponse.status}`;
        const failureStatus = retryable ? "ambiguous" : "rejected";
        const failureValues = {
          http_status: zatcaResponse.status,
          request_uuid: uuid,
          invoice_hash: signed.invoiceHash,
          icv,
          previous_pih: previousHash,
          request_payload: requestPayload,
          response: responseData,
          response_text: responseText,
        };
        if (retryable) {
          await markAmbiguousAndBlock(failureValues, errorMessage);
        } else {
          await saveLog({ ...failureValues, status: failureStatus, retry_after: null, last_error: errorMessage });
          await setInvoiceStatus(failureStatus, responseData);
        }
        return respond(
          { error: errorMessage, status: failureStatus, details: responseData, retryable: false },
          retryable ? 503 : 422,
        );
      }

      const status = signed.simplified ? "reported" : "cleared";
      const acceptedArtifacts = getAcceptedInvoiceArtifacts(responseData, signed);
      const { error: finalizeError } = await admin.rpc("finalize_zatca_accepted_submission", {
        p_onboarding_id: setup.id,
        p_reservation_token: reservationToken,
        p_invoice_hash: signed.invoiceHash,
        p_log_id: durableLogId,
        p_status: status,
        p_http_status: zatcaResponse.status,
        p_request_uuid: uuid,
        p_icv: icv,
        p_previous_pih: previousHash,
        p_request_payload: requestPayload,
        p_response: responseData,
        p_response_text: responseText,
        p_invoice_id: recordId,
        p_mode: mode,
        p_qr_code_data: acceptedArtifacts.qrCodeData,
        p_cryptographic_stamp: acceptedArtifacts.cryptographicStamp,
        p_invoice_xml: acceptedArtifacts.invoiceXml,
        p_submitted_at: submittedAt,
      });
      if (finalizeError) {
        const persistenceError =
          "قبلت ZATCA المستند لكن تعذر تثبيت النتيجة محليًا؛ تم إيقاف تسلسل الجهاز للمراجعة اليدوية";
        await markAmbiguousAndBlock(
          {
            http_status: zatcaResponse.status,
            request_uuid: uuid,
            invoice_hash: signed.invoiceHash,
            icv,
            previous_pih: previousHash,
            request_payload: requestPayload,
            response: responseData,
            response_text: responseText,
          },
          `${persistenceError}: ${clean(finalizeError.message)}`,
        );
        return respond({ error: persistenceError, status: "ambiguous", retryable: false }, 503);
      }
      sequenceFinalized = true;

      return respond({
        status,
        uuid,
        icv,
        qrCodeData: acceptedArtifacts.qrCodeData,
        warnings: responseData?.validationResults?.warningMessages ?? [],
        message: signed.simplified
          ? "أُبلغت ZATCA بالفاتورة المبسّطة"
          : "صادقت ZATCA على الفاتورة المعيارية",
      });
    } catch (error: any) {
      const message = clean(error?.message) || "Unexpected submission error";
      if (!sequenceFinalized && !sequenceBlocked && !submissionAmbiguous) {
        await saveLog({
          status: "failed",
          request_payload: {
            mode,
            recordId,
            documentType,
            invoiceType: simplified ? "simplified" : "standard",
            deviceSerial: setup.device_serial,
            endpoint,
          },
          retry_after: getRetryAfter(),
          last_error: message,
        }).catch((logError) => console.error("zatca-invoice log failure", logError));
        await setInvoiceStatus("failed", { message });
      }
      throw error;
    } finally {
      if (!sequenceFinalized && !sequenceBlocked) {
        const { error: releaseError } = await admin.rpc("release_zatca_sequence", {
          p_onboarding_id: setup.id,
          p_reservation_token: reservationToken,
        });
        if (releaseError) console.error("zatca-invoice sequence release", releaseError);
      }
    }
  } catch (error: any) {
    console.error("zatca-invoice", error);
    const status = error?.zatcaStatus === "ambiguous" ? "ambiguous" : undefined;
    return respond(
      { error: error?.message ?? "Unexpected error", ...(status ? { status, retryable: false } : {}) },
      status ? 503 : 500,
    );
  }
});

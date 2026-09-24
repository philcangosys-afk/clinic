import { supabase } from "@/lib/supabase";
import {
  buildInvoiceReceiptHtml,
  invoiceLabel,
  loadLogoDataUrl,
  type InvoicePaymentMethod,
  type InvoicePrintData,
  type InvoicePrintHeader,
  type InvoicePrintItem,
} from "@/lib/invoice-receipt";

/**
 * تجهيز بيانات الفاتورة للطباعة والتحميل والإرسال — **موضعٌ واحد**.
 *
 * كانت هذه الدالّة مكتوبةً داخل `pages/Billing.tsx` وحدها، فالطباعة ممكنة من
 * شاشة الفواتير ومستحيلة من ملفّ المريض ومن نافذة تفاصيل الفاتورة. ونسخُها
 * ثلاث مرّات كان سيُنتج ثلاث فواتير تفترق: تُضاف حصّة التأمين في واحدة
 * وتُنسى في أخرى، ويُقرأ الشعار في واحدة ولا يُقرأ في ثالثة.
 */
export async function loadInvoicePrintData(
  invoiceId: string,
  printedBy: string | null,
): Promise<InvoicePrintData> {
  const [headerRes, itemsRes, paymentsRes, invoiceRes] = await Promise.all([
    supabase.from("v_invoice_print").select("*").eq("invoice_id", invoiceId).maybeSingle(),
    supabase
      .from("sales_invoice_items")
      .select("description, price, qty, discount_amount, vat_amount, net_amount")
      .eq("invoice_id", invoiceId)
      .order("created_at"),
    supabase
      .from("v_invoice_payment_methods")
      .select("method_name, method_code, amount")
      .eq("invoice_id", invoiceId),
    // رمز المرحلة الثانية وعدّاد الطباعة (0179/0186) خارج منظور 0157
    supabase
      .from("sales_invoices")
      .select("zatca_qr_data, print_count")
      .eq("id", invoiceId)
      .maybeSingle(),
  ]);
  if (headerRes.error) throw headerRes.error;
  if (itemsRes.error) throw itemsRes.error;
  if (paymentsRes.error) throw paymentsRes.error;
  if (!headerRes.data) throw new Error("تعذّر قراءة بيانات الفاتورة للطباعة");

  const header = headerRes.data as unknown as InvoicePrintHeader;
  // الشعار يُضمَّن قبل الطباعة: الطباعة تجري فور كتابة المستند، وصورةٌ من
  // الشبكة قد لا تصل قبلها فتخرج الورقة بلا شعار أحيانًا وبه أحيانًا.
  const logoDataUrl = header.show_logo ? await loadLogoDataUrl(header.logo_url) : null;

  /**
   * رمز ZATCA صورةً جاهزة قبل الطباعة.
   *
   * يُفضَّل الرمز المستخرج من الـXML الموقّع (`zatca_qr_data`, 0179) لأنّه
   * المعتمد بعد الإرسال، وإلّا رمز المرحلة الأولى المحسوب محليًّا. وبلا
   * أيّهما تبقى مساحةٌ مرسومة على الورقة ولا تُطبع فاتورةٌ ناقصة الشكل.
   */
  const extra = (invoiceRes.data ?? null) as { zatca_qr_data?: string | null; print_count?: number | null } | null;
  const qrPayload = extra?.zatca_qr_data || header.zatca_qr || null;
  const qrDataUrl = await buildQrDataUrl(qrPayload);

  return {
    header,
    items: (itemsRes.data ?? []) as unknown as InvoicePrintItem[],
    payments: (paymentsRes.data ?? []) as unknown as InvoicePaymentMethod[],
    printedBy,
    printCount: Number(extra?.print_count ?? 0) || null,
    logoDataUrl,
    qrDataUrl,
  };
}

/** رمز QR صورةً — الفشل لا يمنع الطباعة، تبقى المساحة مرسومة. */
async function buildQrDataUrl(payload: string | null): Promise<string | null> {
  if (!payload) return null;
  try {
    const QRCode = (await import("qrcode")).default;
    return await QRCode.toDataURL(payload, { margin: 0, width: 320, errorCorrectionLevel: "M" });
  } catch {
    return null;
  }
}

/**
 * تسجيل الطباعة: يزيد العدّاد في القاعدة ويعيد اسم الطابع ورقمه الوظيفي.
 *
 * يُستدعى عند الطباعة وحدها لا عند التحميل أو الإرسال — «Printed Count» يعني
 * ما خرج على ورق. والفشل لا يمنع الطباعة: تخرج الورقة بالاسم المتاح وبعدّاد
 * الفاتورة كما قرأناه.
 */
export async function registerInvoicePrint(
  invoiceId: string,
): Promise<{ print_count: number | null; user_name: string | null; job_number: string | null } | null> {
  try {
    const { data, error } = await supabase.rpc("app_register_invoice_print", { p_invoice_id: invoiceId });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      print_count: Number((row as any).print_count ?? 0) || null,
      user_name: (row as any).user_name ?? null,
      job_number: (row as any).job_number ?? null,
    };
  } catch {
    return null;
  }
}

/** عرض الورق بالمليمتر — الحراريّ 72mm عرضَ طباعةٍ فعليًّا لا 80mm. */
const PAPER_MM: Record<string, number> = { thermal_80mm: 72, a4: 210 };

/** الأنماط نفسها التي تطبع بها `printHtml`، فالـPDF لا يخرج بشكلٍ آخر. */
const PAPER_CSS: Record<string, string> = {
  thermal_80mm: `*{box-sizing:border-box}
     /* الحاشية داخل العرض: الالتقاط بعرض 72mm، وبلا هذا يصير المستند 78mm
        فيُقتطع منه 6mm من الطرف الأيسر في الملفّ الناتج. */
     body{font-family:Tahoma,Arial,sans-serif;width:72mm;padding:3mm;line-height:1.45;font-size:11px;margin:0;background:#fff}
     h1,h2,h3{font-size:13px;margin:0 0 4px}
     table{width:100%;border-collapse:collapse;font-size:10px}
     th,td{padding:1px 2px}
     table,th,td{border:none}
     tbody tr{border-bottom:1px dotted #999}`,
  a4: `*{box-sizing:border-box}
     body{font-family:Tahoma,Arial,sans-serif;padding:24px;line-height:1.8;font-size:14px;margin:0;background:#fff}
     table{width:100%;border-collapse:collapse}`,
};

/**
 * تحميل الفاتورة ملفَّ PDF.
 *
 * **لماذا لا يكفي زرّ الطباعة؟** نافذة الطابعة فيها «حفظ كـ PDF»، لكنّها
 * تُضيف ترويسة المتصفّح وتذييله ورابط الصفحة، وتعتمد على إعدادات الطابعة
 * عند كل موظّف — فورقةُ مريضٍ تخرج بحاشيةٍ وأخرى بلا حاشية. والمالك طلب
 * ملفًّا يُرسَل، والمُرسَل يجب أن يكون واحدًا مهما كان الجهاز.
 *
 * **والمكتبتان تُحمَّلان عند الضغط لا مع الصفحة** (`import()` داخل الدالّة):
 * `html2canvas` و`jspdf` ثقيلتان، وتحميلُهما في كل فتحةٍ للنظام يُبطئ كل
 * شاشةٍ لأجل زرٍّ قد لا يُضغط.
 *
 * **والصورة تُلتقَط من إطارٍ مخفيّ** بعرض الورق نفسه لا من الشاشة: التقاطُ
 * عنصرٍ في الصفحة يورّثه ألوان القالب وخطوطه وظلاله، فتخرج فاتورةٌ رمادية
 * على خلفيةٍ داكنة لمن يستعمل الوضع الليليّ.
 */
export async function downloadInvoicePdf(data: InvoicePrintData): Promise<void> {
  const paper = data.header.paper_size ?? "thermal_80mm";
  const widthMm = PAPER_MM[paper] ?? 72;
  const widthPx = Math.round((widthMm * 96) / 25.4);

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  // خارج الشاشة لا `display:none`: الإطار المخفيّ تمامًا لا يُحسب تخطيطه
  // فيخرج الالتقاط بارتفاع صفر.
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${widthPx}px;height:10px;border:0;`;
  document.body.appendChild(frame);

  try {
    const doc = frame.contentDocument;
    if (!doc) throw new Error("تعذّر تجهيز الملفّ");
    doc.open();
    doc.write(
      `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" />` +
        `<style>${PAPER_CSS[paper] ?? PAPER_CSS.thermal_80mm}</style></head>` +
        `<body>${buildInvoiceReceiptHtml(data)}</body></html>`,
    );
    doc.close();

    // الخطوط والصور: الانتظار يمنع فاتورةً بمربّعاتٍ فارغة مكان الشعار
    if ((doc as any).fonts?.ready) {
      await (doc as any).fonts.ready;
    }
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    const body = doc.body;
    const heightPx = Math.max(body.scrollHeight, 10);
    frame.style.height = `${heightPx}px`;

    const canvas = await html2canvas(body, {
      scale: 3, // شريطٌ بعرض 72mm: أقلّ من ذلك يُخرج نصًّا لا يُقرأ
      backgroundColor: "#ffffff",
      useCORS: true,
      width: widthPx,
      height: heightPx,
      windowWidth: widthPx,
      windowHeight: heightPx,
    });

    const heightMm = (canvas.height * widthMm) / canvas.width;
    const pdf = new jsPDF({
      unit: "mm",
      // صفحةٌ بطول الفاتورة لا A4 مقتطعة: الحراريّ شريطٌ مستمرّ، وتقسيمُه
      // على صفحاتٍ ثابتة يقطع السطر في منتصفه.
      format: paper === "a4" ? "a4" : [widthMm, Math.max(heightMm, 20)],
      orientation: "portrait",
      compress: true,
    });

    if (paper === "a4") {
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgHeight = (canvas.height * pageWidth) / canvas.width;
      let offset = 0;
      // فاتورةٌ أطول من الصفحة تُقسَّم لا تُقتطَع
      while (offset < imgHeight - 0.5) {
        if (offset > 0) pdf.addPage();
        pdf.addImage(
          canvas.toDataURL("image/jpeg", 0.92),
          "JPEG",
          0,
          -offset,
          pageWidth,
          imgHeight,
        );
        offset += pageHeight;
      }
    } else {
      pdf.addImage(
        canvas.toDataURL("image/jpeg", 0.92),
        "JPEG",
        0,
        0,
        widthMm,
        heightMm,
      );
    }

    pdf.save(`فاتورة-${invoiceLabel(data.header)}.pdf`);
  } finally {
    // الإطار يُزال مهما جرى: إطارٌ متروكٌ في كل ضغطةٍ يُراكم مستندات في الذاكرة
    frame.remove();
  }
}

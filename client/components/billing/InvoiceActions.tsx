import { useState } from "react";
import { Download, Printer, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";
import { printInvoiceReceipt, type InvoicePrintData } from "@/lib/invoice-receipt";
import { downloadInvoicePdf, loadInvoicePrintData, registerInvoicePrint } from "@/lib/invoice-pdf";
import SendInvoiceDialog from "@/components/billing/SendInvoiceDialog";

/**
 * ثلاثة أزرار على **كلّ** فاتورة: تحميل · طباعة · إرسال.
 *
 * كانت الطباعة والإرسال في شاشة الفواتير وحدها، فمن يقف في ملفّ المريض أو في
 * نافذة تفاصيل الفاتورة يُغادر إلى شاشةٍ أخرى ويبحث عن الفاتورة برقمها.
 * والأزرار هنا مكوّنٌ واحد يُركَّب في أيّ موضع، فلا تفترق فاتورةٌ عن أخرى.
 *
 * **والبيانات تُجلَب عند الضغط لا مع القائمة.** جلبُ الترويسة والبنود
 * والدفعات والشعار لكلّ صفٍّ في قائمةٍ من مئتي فاتورة أربعةُ طلباتٍ في الصفّ
 * — ثمانمئة طلبٍ لأجل ثلاثة أزرارٍ قد لا يُضغط أحدها.
 */
export default function InvoiceActions({
  invoiceId,
  printedByName,
  /** `icon` للجداول (أزرار بأيقونات)، و`labeled` للنوافذ (بنصّ). */
  variant = "icon",
  className,
}: {
  invoiceId: string;
  printedByName: string | null;
  variant?: "icon" | "labeled";
  className?: string;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<null | "print" | "download" | "send">(null);
  const [sendData, setSendData] = useState<InvoicePrintData | null>(null);
  const [sendOpen, setSendOpen] = useState(false);

  const run = async (
    kind: "print" | "download" | "send",
    failTitle: string,
    action: (data: InvoicePrintData) => void | Promise<void>,
  ) => {
    setBusy(kind);
    try {
      const data = await loadInvoicePrintData(invoiceId, printedByName);
      await action(data);
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: failTitle,
        description: errorMessage(error, "حدث خطأ غير متوقع"),
      });
    } finally {
      setBusy(null);
    }
  };

  const labeled = variant === "labeled";

  return (
    <>
      <div className={`flex items-center gap-1 ${className ?? ""}`}>
        <Button
          size="sm"
          variant="ghost"
          title="تحميل PDF"
          disabled={busy !== null}
          onClick={() =>
            void run("download", "تعذّر تجهيز ملفّ الفاتورة", (data) => downloadInvoicePdf(data))
          }
        >
          <Download className="h-3.5 w-3.5" />
          {labeled && (busy === "download" ? "جارٍ التجهيز..." : "تحميل")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          title="طباعة"
          disabled={busy !== null}
          onClick={() =>
            void run("print", "تعذّر تجهيز الفاتورة للطباعة", async (data) => {
              // العدّاد من القاعدة (0186): ورقةٌ تُطبع مرّتين تقول ذلك.
              // والاسم والرقم الوظيفي في `data` سلفًا — مُصدِر الفاتورة (0189)،
              // لا من ضغط الطباعة، فإعادة الطباعة لا تُغيّر من أصدرها.
              const stamp = await registerInvoicePrint(invoiceId);
              printInvoiceReceipt({
                ...data,
                printCount: stamp?.print_count ?? data.printCount ?? 1,
              });
            })
          }
        >
          <Printer className="h-3.5 w-3.5" />
          {labeled && "طباعة"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          title="إرسال للمريض"
          disabled={busy !== null}
          onClick={() =>
            void run("send", "تعذّر تجهيز الفاتورة للإرسال", (data) => {
              setSendData(data);
              setSendOpen(true);
            })
          }
        >
          <Send className="h-3.5 w-3.5" />
          {labeled && "إرسال"}
        </Button>
      </div>

      <SendInvoiceDialog
        data={sendData}
        open={sendOpen}
        onOpenChange={setSendOpen}
        onPrint={() => {
          if (sendData) printInvoiceReceipt(sendData);
        }}
      />
    </>
  );
}

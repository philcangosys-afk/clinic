import { useEffect, useState } from "react";
import { Copy, FileText, Loader2, Mail, MessageCircle, Printer } from "lucide-react";

import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildInvoiceMessage,
  invoiceLabel,
  toWhatsAppNumber,
  type InvoicePrintData,
} from "@/lib/invoice-receipt";
import { uploadInvoicePdfForSharing } from "@/lib/invoice-pdf";

/**
 * إرسال الفاتورة للمريض — واتساب أو بريد، **بالفاتورة نفسها لا بنصٍّ وحده** (0230).
 *
 * روابط `wa.me` و`mailto` لا تحمل مرفقًا — حدُّ المتصفّح. فعند الإرسال تُجهَّز
 * الفاتورة PDF (الورقة نفسها التي تُطبع، بالشعار ورمز ZATCA) وتُرفع، ويُضاف
 * رابطها إلى الرسالة: يضغطه المريض فتُفتح الفاتورة كاملة على جواله.
 *
 * **ولا تكامل ولا مفاتيح:** الرسالة تُفتح في واتساب الموظّف أو بريده ويُرسلها
 * هو — لا يمرّ رقم المريض بطرفٍ ثالث.
 *
 * الرقم والبريد والنصّ قابلةٌ للتحرير قبل الإرسال: ملفّ المريض قد يحمل رقم
 * مرافقٍ أو رقمًا قديمًا.
 */
const LINK_HEADING = "الفاتورة (PDF) — اضغط لعرضها وتحميلها:";

export default function SendInvoiceDialog({
  data,
  open,
  onOpenChange,
  onPrint,
}: {
  data: InvoicePrintData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPrint: () => void;
}) {
  const { organization } = useOrganizationAccess();
  const { toast } = useToast();
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    if (!data) return;
    setMobile(data.header.customer_mobile ?? "");
    setEmail(data.header.customer_email ?? "");
    setMessage(buildInvoiceMessage(data.header));
    setLink(null);
  }, [data]);

  if (!data) return null;
  const header = data.header;
  const waNumber = toWhatsAppNumber(mobile);
  const subject = `فاتورة ${invoiceLabel(header)} — ${header.seller_name ?? ""}`;

  /** الرسالة بالرابط — يُضاف في آخرها إن لم يكن فيها. */
  const withLink = (text: string, url: string) =>
    text.includes(url) ? text : `${text.trimEnd()}\n\n${LINK_HEADING}\n${url}`;

  /** رابط الفاتورة: يُجهَّز مرّةً واحدة لكلّ فتحة، ويُعاد استعماله للواتساب والبريد والنسخ. */
  const ensureLink = async (): Promise<string> => {
    if (link) return link;
    if (!organization?.id) throw new Error("لا توجد منشأة نشطة");
    setPreparing(true);
    try {
      const url = await uploadInvoicePdfForSharing(data, organization.id);
      setLink(url);
      setMessage((current) => withLink(current, url));
      return url;
    } finally {
      setPreparing(false);
    }
  };

  const fail = (error: unknown) =>
    toast({ variant: "destructive", title: "تعذّر تجهيز رابط الفاتورة", description: errorMessage(error) });

  const sendWhatsApp = async () => {
    if (!waNumber) return;
    // النافذة تُفتح فور الضغط ثمّ يُوجَّه إلى واتساب بعد تجهيز الرابط — وإلّا منع
    // المتصفّح نافذةً تُفتح بعد انتظار (ليست ناتجةً عن ضغطةٍ مباشرة).
    const popup = window.open("about:blank", "_blank");
    try {
      const url = await ensureLink();
      const target = `https://wa.me/${waNumber}?text=${encodeURIComponent(withLink(message, url))}`;
      if (popup) {
        popup.opener = null;
        popup.location.href = target;
      } else {
        window.location.href = target;
      }
    } catch (error) {
      popup?.close();
      fail(error);
    }
  };

  const sendEmail = async () => {
    try {
      const url = await ensureLink();
      window.location.href =
        `mailto:${encodeURIComponent(email.trim())}` +
        `?subject=${encodeURIComponent(subject)}` +
        `&body=${encodeURIComponent(withLink(message, url))}`;
    } catch (error) {
      fail(error);
    }
  };

  const copyLink = async () => {
    try {
      const url = await ensureLink();
      await navigator.clipboard.writeText(url);
      toast({ title: "نُسخ رابط الفاتورة" });
    } catch (error) {
      fail(error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>إرسال الفاتورة {invoiceLabel(header)}</DialogTitle>
          <DialogDescription>
            تُرسَل الفاتورة نفسها التي تُطبع (PDF بالشعار ورمز الفاتورة الإلكترونية) رابطًا في الرسالة — يضغطه
            المريض فتُفتح على جواله.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="send-mobile">جوال المريض</Label>
              <Input
                id="send-mobile"
                dir="ltr"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="05xxxxxxxx"
              />
              {mobile && !waNumber && (
                <span className="text-[11px] text-destructive">رقم غير صالح</span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="send-email">بريد المريض</Label>
              <Input
                id="send-email"
                dir="ltr"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </div>
          </div>

          <div
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
              link ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "bg-muted/40 text-muted-foreground"
            }`}
          >
            {preparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            <span className="flex-1">
              {preparing
                ? "جارٍ تجهيز الفاتورة PDF..."
                : link
                  ? "الفاتورة PDF جاهزة ورابطها في الرسالة."
                  : "تُجهَّز الفاتورة PDF ويُضاف رابطها تلقائيًا عند الضغط على واتساب أو البريد."}
            </span>
            <Button size="sm" variant="ghost" className="h-7" disabled={preparing} onClick={() => void copyLink()}>
              <Copy className="h-3.5 w-3.5" />
              نسخ الرابط
            </Button>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="send-body">نصّ الرسالة</Label>
            <Textarea
              id="send-body"
              rows={9}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button variant="outline" onClick={onPrint}>
            <Printer className="h-4 w-4" />
            طباعة
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!email.trim() || preparing} onClick={() => void sendEmail()}>
              <Mail className="h-4 w-4" />
              بريد إلكتروني
            </Button>
            <Button
              className="bg-[#25D366] text-white hover:bg-[#1ebe5b]"
              disabled={!waNumber || preparing}
              onClick={() => void sendWhatsApp()}
            >
              {preparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
              واتساب بالفاتورة
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

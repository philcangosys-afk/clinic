import { useEffect, useState } from "react";
import { Mail, MessageCircle, Printer } from "lucide-react";

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

/**
 * إرسال الفاتورة للمريض — واتساب أو بريد.
 *
 * **ما يُرسَل ولماذا:** روابط `wa.me` و`mailto` تفتح التطبيق بنصٍّ معبَّأ
 * ولا تحمل مرفقًا — هذا حدُّ المتصفّح لا خيارُ تصميم. فالنصّ يحمل رقم
 * الفاتورة وتاريخها وصافيها والمدفوع والمتبقّي، والورقة نفسها تُحفَظ PDF من
 * زرّ الطباعة (اختر «حفظ كـ PDF» في نافذة الطابعة) وتُرفَق بيد المُرسِل.
 *
 * **ولا تكامل ولا مفاتيح:** لا يمرّ شيء بخادم وسيط ولا يُرسَل رقم المريض إلى
 * طرفٍ ثالث — الرابط يُفتح في متصفّح الموظّف وحده، والإرسال يقع من حسابه هو.
 *
 * الرقم والبريد قابلان للتحرير قبل الإرسال: ملفّ المريض قد يحمل رقم مرافقٍ أو
 * رقمًا قديمًا، وتصحيحه في اللحظة أسرع من فتح الملفّ.
 */
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
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!data) return;
    setMobile(data.header.customer_mobile ?? "");
    setEmail(data.header.customer_email ?? "");
    setMessage(buildInvoiceMessage(data.header));
  }, [data]);

  if (!data) return null;
  const header = data.header;
  const waNumber = toWhatsAppNumber(mobile);
  const subject = `فاتورة ${invoiceLabel(header)} — ${header.seller_name ?? ""}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>إرسال الفاتورة {invoiceLabel(header)}</DialogTitle>
          <DialogDescription>
            يُفتح واتساب أو بريدك بنصٍّ معبَّأ. المرفق يُضاف بيدك: اطبع الفاتورة
            واختر «حفظ كـ PDF» ثمّ أرفقه.
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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="send-body">نصّ الرسالة</Label>
            <Textarea
              id="send-body"
              rows={10}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button variant="outline" onClick={onPrint}>
            <Printer className="h-4 w-4" />
            طباعة / حفظ PDF
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!email.trim()}
              onClick={() => {
                window.location.href =
                  `mailto:${encodeURIComponent(email.trim())}` +
                  `?subject=${encodeURIComponent(subject)}` +
                  `&body=${encodeURIComponent(message)}`;
              }}
            >
              <Mail className="h-4 w-4" />
              بريد إلكتروني
            </Button>
            <Button
              disabled={!waNumber}
              onClick={() => {
                window.open(
                  `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`,
                  "_blank",
                  "noopener,noreferrer",
                );
              }}
            >
              <MessageCircle className="h-4 w-4" />
              واتساب
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

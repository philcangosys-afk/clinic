/**
 * معاينة التقارير داخل النظام قبل الطباعة.
 *
 * التقرير يُبنى مستندًا HTML كاملًا (بقواعد @page للطباعة) ويُعرض في نافذةٍ
 * داخل النظام (ReportPreviewDialog المركّبة مرّةً في AppShell). منها يطبع
 * المستخدم أو يحفظ PDF، أو يغلق دون طباعة — لا نافذة منبثقة ولا طباعة مباشرة.
 */

export type ReportPreviewState = {
  open: boolean;
  /** يُبنى التقرير الآن */
  loading: boolean;
  title: string;
  html: string | null;
};

const CLOSED: ReportPreviewState = { open: false, loading: false, title: "", html: null };
let state: ReportPreviewState = CLOSED;
let seq = 0;
const listeners = new Set<() => void>();

function set(next: ReportPreviewState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function subscribeReportPreview(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getReportPreview = () => state;

/**
 * يفتح نافذة المعاينة فورًا («جارٍ التجهيز…») ثمّ يعرض التقرير حين يُبنى.
 * إن فشل البناء تُغلق النافذة ويُرمى الخطأ للمستدعي (ليعرضه).
 */
export async function previewReport(
  initialTitle: string,
  build: () => Promise<{ title: string; html: string }>,
) {
  const token = ++seq;
  set({ open: true, loading: true, title: initialTitle, html: null });
  try {
    const doc = await build();
    if (token === seq) set({ open: true, loading: false, title: doc.title, html: doc.html });
  } catch (error) {
    if (token === seq) set(CLOSED);
    throw error;
  }
}

export function closeReportPreview() {
  seq += 1;
  set(CLOSED);
}

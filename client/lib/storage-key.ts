/**
 * اسم الملفّ داخل مسار التخزين (0222).
 *
 * Supabase Storage لا يقبل في مفتاح الكائن إلا أحرفًا لاتينية وأرقامًا وبعض
 * الرموز، فاسمٌ مثل «ريم_العمري.png» يُرفض بـ "Invalid key". لذلك يُبنى المسار
 * من جزءٍ لاتينيّ آمن + مقطعٍ عشوائيّ + الامتداد، بينما يبقى الاسم الأصلي
 * (بالعربية) محفوظًا في عمود file_name ويظهر للمستخدم كما هو.
 */
export function storageFileName(name: string, fallbackExt = "bin"): string {
  const dot = name.lastIndexOf(".");
  const rawExt = dot > 0 ? name.slice(dot + 1) : "";
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || fallbackExt;
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 60);
  const rand = Math.random().toString(36).slice(2, 8) || "f";
  return `${base || "file"}-${rand}.${ext}`;
}

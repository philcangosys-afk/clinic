/**
 * كاتب ملفّ Excel (.xlsx) صغير بلا مكتبة.
 *
 * ملفّ xlsx أرشيف ZIP لبضعة ملفّات XML. هنا تُكتب تلك الملفّات وتُضمّ في
 * أرشيفٍ «مخزَّن» بلا ضغط — يفتحه Excel وGoogle Sheets وLibreOffice ملفًّا
 * أصليًّا (لا CSV يُقرأ نصًّا ولا HTML بتحذير)، والورقة من اليمين إلى اليسار.
 *
 * الخلايا نصٌّ أو رقم: الرقم يبقى رقمًا فتعمل عليه المعادلات والمجاميع.
 */

/**
 * أنماط الخلايا — جدولٌ ثابت في styles.xml (الفهرس = رقم النمط في cellXfs):
 *  title     عنوان التقرير (عريض 15)
 *  subtitle  سطر وصفيّ رماديّ
 *  section   عنوان قسمٍ داخل الورقة (عريض، لون المنشأة)
 *  header    رأس جدول: خط أبيض عريض على خلفية خضراء مزرقّة، بإطار، وسط
 *  text      خلية نصّ بإطار
 *  money     رقم بمنزلتين وفاصل آلاف (#,##0.00) بإطار
 *  int       عدد صحيح بفاصل آلاف بإطار
 *  label     تسمية في جدول «بند/قيمة»: عريض على رماديّ فاتح
 *  totalText / totalMoney / totalInt  صفّ الإجمالي: عريض على أخضر فاتح
 *  textMuted نصّ رماديّ صغير بلا إطار (الملاحظات)
 *  center    نصّ أو رقم بإطار في الوسط بلا فاصل آلاف (الأرقام المرجعية والأوقات)
 */
export type XlsxStyle =
  | "title"
  | "subtitle"
  | "section"
  | "header"
  | "text"
  | "money"
  | "int"
  | "label"
  | "totalText"
  | "totalMoney"
  | "totalInt"
  | "textMuted"
  | "center";

const STYLE_INDEX: Record<XlsxStyle | "bold", number> = {
  bold: 1,
  title: 2,
  subtitle: 3,
  section: 4,
  header: 5,
  text: 6,
  money: 7,
  int: 8,
  label: 9,
  totalText: 10,
  totalMoney: 11,
  totalInt: 12,
  textMuted: 13,
  center: 14,
};

/** خلية بنمطٍ صريح، أو بمعادلة (`f`) تُحفظ قيمتها المحسوبة (`v`) لتظهر فورًا. */
export type XlsxStyledCell = { v?: string | number | null; s?: XlsxStyle; f?: string };

export type XlsxCell = string | number | null | undefined | XlsxStyledCell;

export type XlsxSheet = {
  name: string;
  rows: XlsxCell[][];
  /** صفوفٌ تُكتب بخطٍّ عريض (بفهرسها من الصفر) — العناوين والإجماليات */
  boldRows?: number[];
  /** عرض الأعمدة بعدد الأحرف */
  columnWidths?: number[];
  /** دمج خلايا، مثل "A1:F1" */
  merges?: string[];
  /** تجميد أوّل N صفًّا (يبقى رأس الجدول ظاهرًا عند التمرير) */
  freezeRows?: number;
  /** ارتفاع صفوفٍ بعينها (بالنقاط) — بفهرسها من الصفر */
  rowHeights?: Record<number, number>;
  /** الطباعة: عرضيّ أو طوليّ، وتُضبط الورقة على عرض الصفحة */
  landscape?: boolean;
  /** صفّ يتكرّر أعلى كل صفحة مطبوعة (بفهرسه من الصفر) — رأس الجدول */
  printTitleRow?: number;
};

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // محارف التحكّم ممنوعة في XML
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function columnName(index: number) {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** مرجع خلية من رقم الصفّ والعمود (من الصفر): (0,0) ← A1 */
export function cellRef(row: number, col: number) {
  return `${columnName(col)}${row + 1}`;
}

const isStyled = (cell: XlsxCell): cell is XlsxStyledCell =>
  typeof cell === "object" && cell !== null;

function cellXml(cell: XlsxCell, ref: string, rowStyle: number | null) {
  const styled = isStyled(cell);
  const value = styled ? cell.v : cell;
  const formula = styled ? cell.f : undefined;
  const styleIndex = styled && cell.s ? STYLE_INDEX[cell.s] : rowStyle;
  const s = styleIndex ? ` s="${styleIndex}"` : "";
  if (formula) {
    const cached = typeof value === "number" && Number.isFinite(value) ? `<v>${value}</v>` : "";
    return `<c r="${ref}"${s}><f>${escapeXml(formula)}</f>${cached}</c>`;
  }
  if (value === null || value === undefined || value === "") {
    // خلية فارغة بنمط (إطار/خلفية) تُكتب ليكتمل شكل الجدول
    return styled && cell.s ? `<c r="${ref}"${s}/>` : "";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"${s}><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet) {
  const bold = new Set(sheet.boldRows ?? []);
  const cols = sheet.columnWidths?.length
    ? `<cols>${sheet.columnWidths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(4, w)}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";
  const rows = sheet.rows
    .map((row, r) => {
      const rowStyle = bold.has(r) ? STYLE_INDEX.bold : null;
      const cells = row.map((cell, c) => cellXml(cell, cellRef(r, c), rowStyle)).join("");
      const height = sheet.rowHeights?.[r];
      const ht = height ? ` ht="${height}" customHeight="1"` : "";
      return `<row r="${r + 1}"${ht}>${cells}</row>`;
    })
    .join("");
  const freeze = sheet.freezeRows
    ? `<pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" activePane="bottomLeft" state="frozen"/>` +
      `<selection pane="bottomLeft" activeCell="A${sheet.freezeRows + 1}" sqref="A${sheet.freezeRows + 1}"/>`
    : "";
  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";
  const print =
    `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>` +
    `<pageSetup paperSize="9" orientation="${sheet.landscape ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<sheetViews><sheetView workbookViewId="0" rightToLeft="1" showGridLines="0">${freeze}</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="18"/>` +
    cols +
    `<sheetData>${rows}</sheetData>` +
    merges +
    print +
    `</worksheet>`
  );
}

/* ── ZIP مخزَّن (بلا ضغط) ──────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const size = file.data.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // الإصدار المطلوب
    local.setUint16(6, 0x0800, true); // الأسماء UTF-8
    local.setUint16(8, 0, true); // بلا ضغط
    local.setUint16(10, 0, true);
    local.setUint16(12, 0x21, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, file.data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, 0, true);
    entry.setUint16(14, 0x21, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, size, true);
    entry.setUint32(24, size, true);
    entry.setUint16(28, name.length, true);
    entry.setUint16(30, 0, true);
    entry.setUint16(32, 0, true);
    entry.setUint16(34, 0, true);
    entry.setUint16(36, 0, true);
    entry.setUint32(38, 0, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);

    offset += 30 + name.length + size;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const total = all.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of all) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

/** يبني ملفّ xlsx من أوراقٍ ويعيده Blob جاهزًا للتنزيل. */
export function buildXlsx(sheets: XlsxSheet[]): Blob {
  const encoder = new TextEncoder();
  const safeName = (name: string, index: number) =>
    (name.replace(/[\\/?*[\]:]/g, " ").trim() || `ورقة ${index + 1}`).slice(0, 31);

  const files: { name: string; data: Uint8Array }[] = [
    {
      name: "[Content_Types].xml",
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
          sheets
            .map(
              (_, i) =>
                `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
            )
            .join("") +
          `</Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
          `</Relationships>`,
      ),
    },
    {
      name: "xl/workbook.xml",
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<bookViews><workbookView/></bookViews><sheets>` +
          sheets
            .map((s, i) => `<sheet name="${escapeXml(safeName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
            .join("") +
          `</sheets>` +
          (sheets.some((sheet) => sheet.printTitleRow !== undefined)
            ? `<definedNames>${sheets
                .map((sheet, i) =>
                  sheet.printTitleRow === undefined
                    ? ""
                    : `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${escapeXml(
                        safeName(sheet.name, i).replace(/'/g, "''"),
                      )}'!$${sheet.printTitleRow + 1}:$${sheet.printTitleRow + 1}</definedName>`,
                )
                .join("")}</definedNames>`
            : "") +
          `</workbook>`,
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          sheets
            .map(
              (_, i) =>
                `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
            )
            .join("") +
          `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
          `</Relationships>`,
      ),
    },
    {
      name: "xl/styles.xml",
      data: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
          `<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>` +
          `<fonts count="6">` +
          `<font><sz val="11"/><name val="Calibri"/></font>` +
          `<font><b/><sz val="11"/><name val="Calibri"/></font>` +
          `<font><b/><sz val="15"/><color rgb="FF0F172A"/><name val="Calibri"/></font>` +
          `<font><sz val="10"/><color rgb="FF64748B"/><name val="Calibri"/></font>` +
          `<font><b/><sz val="12"/><color rgb="FF0F766E"/><name val="Calibri"/></font>` +
          `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
          `</fonts>` +
          `<fills count="5">` +
          `<fill><patternFill patternType="none"/></fill>` +
          `<fill><patternFill patternType="gray125"/></fill>` +
          `<fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill>` +
          `<fill><patternFill patternType="solid"><fgColor rgb="FFE6F4F1"/><bgColor indexed="64"/></patternFill></fill>` +
          `<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>` +
          `</fills>` +
          `<borders count="2">` +
          `<border><left/><right/><top/><bottom/><diagonal/></border>` +
          `<border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right>` +
          `<top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border>` +
          `</borders>` +
          `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
          `<cellXfs count="15">` +
          // 0 عاديّ — 1 عريض (boldRows)
          `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
          `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
          // 2 title — 3 subtitle — 4 section
          `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
          `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
          `<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
          // 5 header
          `<xf numFmtId="0" fontId="5" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` +
          // 6 text — 7 money — 8 int
          `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
          `<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
          `<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>` +
          // 9 label
          `<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
          // 10 totalText — 11 totalMoney — 12 totalInt
          `<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
          `<xf numFmtId="164" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
          `<xf numFmtId="3" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>` +
          // 13 textMuted
          `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>` +
          // 14 center
          `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>` +
          `</cellXfs>` +
          `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
          `</styleSheet>`,
      ),
    },
    ...sheets.map((sheet, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: encoder.encode(sheetXml(sheet)),
    })),
  ];

  return new Blob([zipStored(files)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** تنزيل Blob باسم ملفّ. */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

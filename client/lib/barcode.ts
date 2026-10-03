/**
 * باركود Code 128 (المجموعة B) بصيغة SVG — لرقم الملف على لصاقة المريض.
 * بلا مكتبة: الجدول القياسيّ للأنماط (عرض الأعمدة والفراغات بالوحدات).
 */

const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104;
const STOP = 106;

/** قيم الرموز مع رمز التحقّق — للاختبار. */
export function code128BValues(text: string): number[] {
  const values = [START_B];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) throw new Error(`حرفٌ لا يدعمه Code 128-B: ${ch}`);
    values.push(code - 32);
  }
  const checksum = values.reduce((sum, value, index) => sum + value * (index === 0 ? 1 : index), 0) % 103;
  return [...values, checksum, STOP];
}

/** SVG للباركود؛ `height` بالوحدات، و`quiet` هامش الصمت يمينًا ويسارًا. */
export function code128Svg(text: string, opts: { height?: number; module?: number; quiet?: number } = {}) {
  const height = opts.height ?? 40;
  const module = opts.module ?? 1;
  const quiet = opts.quiet ?? 10;
  let x = quiet;
  const bars: string[] = [];
  for (const value of code128BValues(text)) {
    const pattern = PATTERNS[value];
    for (let i = 0; i < pattern.length; i++) {
      const width = Number(pattern[i]) * module;
      if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${width}" height="${height}"/>`);
      x += width;
    }
  }
  const total = x + quiet;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges"><rect width="${total}" height="${height}" fill="#fff"/><g fill="#000">${bars.join("")}</g></svg>`;
}

export const CODE128_PATTERNS = PATTERNS;

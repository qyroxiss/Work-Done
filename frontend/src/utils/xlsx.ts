export type SheetValue = string | number | Date | null | undefined;

/**
 * Downloads rows as a real Excel workbook: bold frozen header, numbers as numbers, dates as dates.
 * The writer is loaded on demand so it does not weigh on the first page load.
 */
export async function downloadXlsx(fileName: string, sheet: string, headers: string[], rows: SheetValue[][]) {
  const { default: writeXlsxFile } = await import('write-excel-file');
  const header = headers.map((h) => ({ value: h, fontWeight: 'bold' as const, backgroundColor: '#F5F4F2' }));
  const body = rows.map((r) =>
    r.map((v) => {
      if (v === null || v === undefined || v === '') return null;
      if (typeof v === 'number') return { type: Number, value: v };
      if (v instanceof Date) return { type: Date, value: v, format: 'dd mmm yyyy' };
      return { type: String, value: v };
    }),
  );
  const widths = headers.map((h, i) => ({
    width: Math.min(48, Math.max(h.length, ...rows.map((r) => (r[i] instanceof Date ? 11 : String(r[i] ?? '').length))) + 2),
  }));
  await writeXlsxFile([header, ...body], { fileName, sheet: sheet.slice(0, 31), columns: widths, stickyRowsCount: 1 });
}

/** "YYYY-MM-DD" -> Date at local midnight (what Excel shows as that calendar day) */
export function sheetDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

type PdfParseInstance = import('pdf-parse').PDFParse;
type PdfParseConstructor = typeof import('pdf-parse')['PDFParse'];

let pdfParseCtor: PdfParseConstructor | null = null;
let pdfParseCtorLoading: Promise<PdfParseConstructor> | null = null;

async function ensureDomMatrix(): Promise<void> {
  const globalRecord = globalThis as Record<string, unknown>;

  if (typeof globalRecord.DOMMatrix === 'function') {
    return;
  }

  const canvasModule = await import('@napi-rs/canvas');
  const domMatrixCtor = (canvasModule as Record<string, unknown>).DOMMatrix;

  if (typeof domMatrixCtor !== 'function') {
    throw new Error('DOMMatrix polyfill unavailable from @napi-rs/canvas');
  }

  globalRecord.DOMMatrix = domMatrixCtor;
}

async function loadPdfParse(): Promise<PdfParseConstructor> {
  if (pdfParseCtor) {
    return pdfParseCtor;
  }

  if (!pdfParseCtorLoading) {
    pdfParseCtorLoading = ensureDomMatrix()
      .then(() => import('pdf-parse'))
      .then((module) => {
        pdfParseCtor = module.PDFParse;
        return pdfParseCtor;
      })
      .finally(() => {
        pdfParseCtorLoading = null;
      });
  }

  return pdfParseCtorLoading;
}

export async function parsePdfFromUrl(url: string): Promise<string> {
  const PDFParse = await loadPdfParse();
  let parser: PdfParseInstance | null = null;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.includes('pdf')) {
      throw new Error(`URL does not return a PDF (Content-Type: ${contentType})`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    parser = new PDFParse({ data: buffer });
    const textResult = await parser.getText();
    const infoResult = await parser.getInfo();

    return formatPdfToMarkdown(textResult, infoResult, url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`PDF parsing failed: ${message}`);
  } finally {
    if (parser) {
      await parser.destroy();
    }
  }
}

export async function parsePdfFromBuffer(buffer: Buffer, sourceUrl?: string): Promise<string> {
  const PDFParse = await loadPdfParse();
  let parser: PdfParseInstance | null = null;

  try {
    parser = new PDFParse({ data: buffer });
    const textResult = await parser.getText();
    const infoResult = await parser.getInfo();

    return formatPdfToMarkdown(textResult, infoResult, sourceUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`PDF parsing failed: ${message}`);
  } finally {
    if (parser) {
      await parser.destroy();
    }
  }
}

function formatPdfToMarkdown(
  textResult: { text: string },
  infoResult: { total: number; info?: any },
  sourceUrl?: string
): string {
  const lines: string[] = [];
  const info = infoResult.info || {};

  // Add metadata if available
  if (info.Title) {
    lines.push(`# ${info.Title}`);
    lines.push('');
  }

  if (sourceUrl) {
    lines.push(`**Source:** ${sourceUrl}`);
    lines.push('');
  }

  if (info.Author) {
    lines.push(`**Author:** ${info.Author}`);
  }

  if (info.Subject) {
    lines.push(`**Subject:** ${info.Subject}`);
  }

  if (infoResult.total) {
    lines.push(`**Pages:** ${infoResult.total}`);
  }

  if (lines.length > 0) {
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Add the extracted text
  const text = textResult.text.trim();
  if (text) {
    lines.push(text);
  } else {
    lines.push('*No text content could be extracted from this PDF.*');
  }

  return lines.join('\n');
}

export function isPdfUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    return pathname.endsWith('.pdf');
  } catch {
    return false;
  }
}

export async function isPdfContentType(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    const contentType = response.headers.get('content-type');
    return contentType?.includes('pdf') || false;
  } catch {
    return false;
  }
}

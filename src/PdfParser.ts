import Tesseract from 'tesseract.js';

type PdfParseInstance = import('pdf-parse').PDFParse;
type PdfParseConstructor = typeof import('pdf-parse')['PDFParse'];

let pdfParseCtor: PdfParseConstructor | null = null;
let pdfParseCtorLoading: Promise<PdfParseConstructor> | null = null;
let tesseractWorker: Tesseract.Worker | null = null;

interface ExtractionResult {
  textContent: string;
  ocrContent: string;
  mergedContent: string;
  hasEmbeddedText: boolean;
  pageCount: number;
  info: Record<string, unknown>;
}

// ============ DOMMatrix Polyfill ============

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

// ============ PDF-Parse Loader ============

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

// ============ OCR (Tesseract.js) ============

async function getOcrWorker(): Promise<Tesseract.Worker> {
  if (!tesseractWorker) {
    tesseractWorker = await Tesseract.createWorker('eng', 1, {
      logger: () => {}, // Silent
    });
  }
  return tesseractWorker;
}

async function ocrImage(imageBuffer: Buffer): Promise<string> {
  const worker = await getOcrWorker();
  const {
    data: { text },
  } = await worker.recognize(imageBuffer);
  return text.trim();
}

export async function cleanupOcr(): Promise<void> {
  if (tesseractWorker) {
    await tesseractWorker.terminate();
    tesseractWorker = null;
  }
}

// ============ PDF to Image Conversion ============

async function extractPdfPages(buffer: Buffer): Promise<Buffer[]> {
  const { pdf } = await import('pdf-to-img');
  const pages: Buffer[] = [];

  const document = await pdf(buffer, { scale: 2.0 }); // 2x scale for better OCR

  for await (const page of document) {
    pages.push(page);
  }

  return pages;
}

// ============ Text Extraction (pdf-parse) ============

async function extractEmbeddedText(
  buffer: Buffer,
): Promise<{ text: string; pageCount: number; info: Record<string, unknown> }> {
  const PDFParse = await loadPdfParse();
  let parser: PdfParseInstance | null = null;

  try {
    parser = new PDFParse({ data: buffer });
    const textResult = await parser.getText();
    const infoResult = await parser.getInfo();

    return {
      text: textResult.text.trim(),
      pageCount: infoResult.total || 0,
      info: infoResult.info || {},
    };
  } finally {
    if (parser) {
      await parser.destroy();
    }
  }
}

// ============ Smart Merge Logic ============

function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 100);
}

function deduplicateContent(textContent: string, ocrContent: string): string {
  const paragraphs1 = textContent.split(/\n\n+/).filter((p) => p.trim());
  const paragraphs2 = ocrContent.split(/\n\n+/).filter((p) => p.trim());

  // Create set of normalized text blocks from text extraction
  const seen = new Set(paragraphs1.map((p) => normalizeForComparison(p)));

  // Find unique paragraphs from OCR
  const uniqueOcr = paragraphs2.filter((p) => {
    const normalized = normalizeForComparison(p);
    return normalized.length > 20 && !seen.has(normalized);
  });

  if (uniqueOcr.length > 0) {
    return (
      textContent + '\n\n---\n*Additional content extracted from images:*\n\n' + uniqueOcr.join('\n\n')
    );
  }

  return textContent;
}

function mergeExtractions(textContent: string, ocrContent: string): string {
  const textLength = textContent.trim().length;
  const ocrLength = ocrContent.trim().length;

  // If text extraction yielded good results
  if (textLength > 500) {
    const textWords = textContent.split(/\s+/).length;
    const ocrWords = ocrContent.split(/\s+/).length;

    // OCR found significantly more content - likely has image text
    if (ocrWords > textWords * 1.5 && ocrLength > 200) {
      return deduplicateContent(textContent, ocrContent);
    }

    return textContent;
  }

  // Text extraction yielded minimal results
  if (textLength > 0 && ocrLength > 0) {
    // Both have content - merge them
    if (ocrLength > textLength * 2) {
      // OCR has much more - prefer it but include text extraction
      return deduplicateContent(ocrContent, textContent);
    }
    return deduplicateContent(textContent, ocrContent);
  }

  // Use whichever has content
  if (ocrLength > 0) {
    return ocrContent;
  }

  if (textLength > 0) {
    return textContent;
  }

  return '*No content could be extracted from this PDF.*';
}

// ============ Main Extraction Function ============

async function extractPdfContent(buffer: Buffer): Promise<ExtractionResult> {
  // Step 1: Extract embedded text
  const { text: textContent, pageCount, info } = await extractEmbeddedText(buffer);
  const hasEmbeddedText = textContent.length > 100;

  // Step 2: Run OCR on page images
  let ocrContent = '';
  try {
    const pages = await extractPdfPages(buffer);
    const ocrResults: string[] = [];

    for (const pageBuffer of pages) {
      const pageText = await ocrImage(pageBuffer);
      if (pageText) {
        ocrResults.push(pageText);
      }
    }

    ocrContent = ocrResults.join('\n\n--- Page Break ---\n\n');
  } catch (error) {
    // OCR failed - continue with text extraction only
    console.error('OCR extraction failed:', error);
  }

  // Step 3: Merge intelligently
  const mergedContent = mergeExtractions(textContent, ocrContent);

  return {
    textContent,
    ocrContent,
    mergedContent,
    hasEmbeddedText,
    pageCount,
    info,
  };
}

// ============ Output Formatting ============

function formatPdfToMarkdown(result: ExtractionResult, sourceUrl?: string): string {
  const lines: string[] = [];
  const { info } = result;

  // Metadata section
  lines.push('<pdf-metadata>');
  if (info.Title) {
    lines.push(`Title: ${info.Title}`);
  }
  if (sourceUrl) {
    lines.push(`Source: ${sourceUrl}`);
  }
  if (info.Author) {
    lines.push(`Author: ${info.Author}`);
  }
  if (result.pageCount) {
    lines.push(`Pages: ${result.pageCount}`);
  }
  const extractionMethod = result.hasEmbeddedText
    ? result.ocrContent
      ? 'Text + OCR'
      : 'Text only'
    : 'OCR only';
  lines.push(`Extraction: ${extractionMethod}`);
  lines.push('</pdf-metadata>');
  lines.push('');

  // Content section
  lines.push('<pdf-content>');
  lines.push('');
  lines.push(result.mergedContent);
  lines.push('');
  lines.push('</pdf-content>');

  return lines.join('\n');
}

// ============ Public API ============

export async function parsePdfFromUrl(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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

    const result = await extractPdfContent(buffer);
    return formatPdfToMarkdown(result, url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`PDF parsing failed: ${message}`);
  }
}

export async function parsePdfFromBuffer(buffer: Buffer, sourceUrl?: string): Promise<string> {
  try {
    const result = await extractPdfContent(buffer);
    return formatPdfToMarkdown(result, sourceUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`PDF parsing failed: ${message}`);
  }
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

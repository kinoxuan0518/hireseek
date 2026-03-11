/**
 * PDF 阅读工具
 * 支持读取 PDF 文件并提取文本内容
 */

import fs from 'fs';
import path from 'path';
import * as pdfParse from 'pdf-parse';

export interface PDFReadOptions {
  filePath: string;
  pages?: string; // 页码范围，如 "1-5", "3", "10-20"
}

export interface PDFContent {
  text: string;
  numPages: number;
  pageRange: string;
}

/**
 * 解析页码范围
 */
function parsePageRange(range: string, totalPages: number): number[] {
  const pages: number[] = [];

  // 单页：如 "3"
  if (/^\d+$/.test(range)) {
    const page = parseInt(range, 10);
    if (page >= 1 && page <= totalPages) {
      pages.push(page);
    }
    return pages;
  }

  // 范围：如 "1-5"
  const match = range.match(/^(\d+)-(\d+)$/);
  if (match) {
    const start = parseInt(match[1], 10);
    const end = parseInt(match[2], 10);

    if (start >= 1 && end <= totalPages && start <= end) {
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
    }
    return pages;
  }

  throw new Error(`无效的页码范围: ${range}（支持格式: "3" 或 "1-5"）`);
}

/**
 * 提取指定页的文本
 */
function extractPageText(fullText: string, pageNumbers: number[], totalPages: number): string {
  // 简单实现：按页分割（假设每页之间有分隔符）
  // pdf-parse 不直接提供单页提取，这里使用简化的估算方法
  const avgCharsPerPage = fullText.length / totalPages;

  let result = '';
  for (const pageNum of pageNumbers) {
    const start = Math.floor((pageNum - 1) * avgCharsPerPage);
    const end = Math.floor(pageNum * avgCharsPerPage);
    result += fullText.substring(start, end) + '\n\n';
  }

  return result.trim();
}

/**
 * 读取 PDF 文件
 */
export async function readPDF(options: PDFReadOptions): Promise<PDFContent> {
  const { filePath, pages: pageRange } = options;

  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    throw new Error(`PDF 文件不存在: ${filePath}`);
  }

  // 检查文件扩展名
  if (path.extname(filePath).toLowerCase() !== '.pdf') {
    throw new Error(`不是 PDF 文件: ${filePath}`);
  }

  // 读取 PDF
  const dataBuffer = fs.readFileSync(filePath);
  const pdf = require('pdf-parse');
  const pdfData = await pdf(dataBuffer);

  const totalPages = pdfData.numpages;

  // 如果指定了页码范围
  if (pageRange) {
    const pageNumbers = parsePageRange(pageRange, totalPages);

    if (pageNumbers.length === 0) {
      throw new Error(`无效的页码范围: ${pageRange}（总页数: ${totalPages}）`);
    }

    // 检查页数限制（最多 20 页）
    if (pageNumbers.length > 20) {
      throw new Error(`页码范围过大（${pageNumbers.length} 页），最多支持 20 页`);
    }

    const text = extractPageText(pdfData.text, pageNumbers, totalPages);

    return {
      text,
      numPages: totalPages,
      pageRange: `第 ${pageNumbers[0]}-${pageNumbers[pageNumbers.length - 1]} 页（共 ${totalPages} 页）`,
    };
  }

  // 未指定页码范围
  if (totalPages > 10) {
    throw new Error(
      `PDF 文件过大（${totalPages} 页），请指定页码范围（如 pages: "1-5"），最多 20 页`
    );
  }

  return {
    text: pdfData.text,
    numPages: totalPages,
    pageRange: `全部 ${totalPages} 页`,
  };
}

/**
 * 格式化 PDF 内容为可读输出
 */
export function formatPDFContent(content: PDFContent, filePath: string): string {
  const filename = path.basename(filePath);

  return `
# PDF 文件: ${filename}

**页数**: ${content.numPages}
**读取范围**: ${content.pageRange}

---

${content.text}

---

_PDF 读取完成_
`.trim();
}

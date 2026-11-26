/**
 * Smart PDF text extraction using pdf.js
 * Detects structure: headings, paragraphs, lists, block quotes
 * Uses font info, positions, and gaps for intelligent formatting
 */

export class PDFHandler {
    constructor() {
        this.cancelled = false;
    }
    
    cancel() {
        this.cancelled = true;
    }
    
    async extract(file, onProgress) {
        this.cancelled = false;
        
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ 
            data: arrayBuffer,
            standardFontDataUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/standard_fonts/'
        }).promise;
        
        const numPages = pdf.numPages;
        const allPageData = [];
        const pageBreaks = {};
        let totalWords = 0;
        
        let fontStats = { sizes: [], baseSize: 12 };
        
        for (let i = 1; i <= numPages; i++) {
            if (this.cancelled) throw new Error('Import cancelled');
            
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const viewport = page.getViewport({ scale: 1 });
            
            const pageData = this.analyzePageContent(textContent, viewport, fontStats);
            allPageData.push(pageData);
            
            fontStats = this.updateFontStats(fontStats, pageData.items);
            
            pageBreaks[i - 1] = totalWords;
            totalWords += pageData.wordCount;
            
            const progress = Math.round((i / numPages) * 100);
            onProgress?.(progress, i, numPages);
        }
        
        fontStats.baseSize = this.calculateBaseSize(fontStats.sizes);
        
        let toc = [];
        try {
            const outline = await pdf.getOutline();
            if (outline) {
                toc = await this.processOutline(outline, pdf);
            }
        } catch (e) {
            console.log('Could not extract TOC:', e);
        }
        
        const headerFooterPatterns = this.detectHeadersFooters(allPageData);
        const structuredContent = this.buildStructure(allPageData, fontStats, headerFooterPatterns);
        
        return {
            paragraphs: structuredContent.paragraphs,
            structure: structuredContent.structure,
            toc: toc.length > 0 ? toc : structuredContent.detectedToc,
            pageBreaks
        };
    }
    
    analyzePageContent(textContent, viewport, fontStats) {
        const items = textContent.items;
        if (!items.length) return { items: [], lines: [], wordCount: 0 };
        
        const pageHeight = viewport.height;
        const analyzedItems = items.map(item => {
            const fontSize = Math.abs(item.transform[0]) || Math.abs(item.transform[3]) || 12;
            const x = item.transform[4];
            const y = pageHeight - item.transform[5];
            const isBold = this.isBoldFont(item.fontName || '');
            const isItalic = this.isItalicFont(item.fontName || '');
            
            return {
                str: item.str,
                x,
                y,
                width: item.width || 0,
                height: item.height || fontSize,
                fontSize,
                fontName: item.fontName || '',
                isBold,
                isItalic
            };
        });
        
        const lines = this.groupIntoLines(analyzedItems);
        const wordCount = analyzedItems.reduce((count, item) => 
            count + item.str.split(/\s+/).filter(w => w).length, 0);
        
        return { items: analyzedItems, lines, wordCount };
    }
    
    isBoldFont(fontName) {
        const lower = fontName.toLowerCase();
        return lower.includes('bold') || lower.includes('black') || lower.includes('heavy');
    }
    
    isItalicFont(fontName) {
        const lower = fontName.toLowerCase();
        return lower.includes('italic') || lower.includes('oblique');
    }
    
    groupIntoLines(items) {
        if (!items.length) return [];
        
        const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
        const lines = [];
        let currentLine = { items: [], y: sorted[0].y, minX: Infinity, maxX: 0 };
        
        const lineThreshold = 5;
        
        for (const item of sorted) {
            if (currentLine.items.length && Math.abs(item.y - currentLine.y) > lineThreshold) {
                lines.push(this.finalizeLine(currentLine));
                currentLine = { items: [], y: item.y, minX: Infinity, maxX: 0 };
            }
            
            currentLine.items.push(item);
            currentLine.minX = Math.min(currentLine.minX, item.x);
            currentLine.maxX = Math.max(currentLine.maxX, item.x + item.width);
            currentLine.y = (currentLine.y * (currentLine.items.length - 1) + item.y) / currentLine.items.length;
        }
        
        if (currentLine.items.length) {
            lines.push(this.finalizeLine(currentLine));
        }
        
        return lines;
    }
    
    finalizeLine(line) {
        line.items.sort((a, b) => a.x - b.x);
        line.text = line.items.map(i => i.str).join('');
        line.avgFontSize = line.items.reduce((sum, i) => sum + i.fontSize, 0) / line.items.length;
        line.maxFontSize = Math.max(...line.items.map(i => i.fontSize));
        line.isBold = line.items.some(i => i.isBold);
        line.indent = line.minX;
        return line;
    }
    
    updateFontStats(stats, items) {
        for (const item of items) {
            stats.sizes.push(item.fontSize);
        }
        return stats;
    }
    
    calculateBaseSize(sizes) {
        if (!sizes.length) return 12;
        
        const freq = {};
        for (const size of sizes) {
            const rounded = Math.round(size);
            freq[rounded] = (freq[rounded] || 0) + 1;
        }
        
        let maxCount = 0;
        let baseSize = 12;
        for (const [size, count] of Object.entries(freq)) {
            if (count > maxCount) {
                maxCount = count;
                baseSize = parseInt(size);
            }
        }
        
        return baseSize;
    }
    
    detectHeadersFooters(allPageData) {
        const topLines = new Map();
        const bottomLines = new Map();
        
        for (const pageData of allPageData) {
            const lines = pageData.lines;
            if (!lines.length) continue;
            
            const pageTop = lines.slice(0, 2);
            const pageBottom = lines.slice(-2);
            
            for (const line of pageTop) {
                const normalized = line.text.trim().replace(/\d+/g, '#');
                if (normalized.length > 2 && normalized.length < 100) {
                    topLines.set(normalized, (topLines.get(normalized) || 0) + 1);
                }
            }
            
            for (const line of pageBottom) {
                const normalized = line.text.trim().replace(/\d+/g, '#');
                if (normalized.length > 2 && normalized.length < 100) {
                    bottomLines.set(normalized, (bottomLines.get(normalized) || 0) + 1);
                }
            }
        }
        
        const threshold = Math.max(3, allPageData.length * 0.3);
        const patterns = new Set();
        
        for (const [pattern, count] of topLines) {
            if (count >= threshold) patterns.add(pattern);
        }
        for (const [pattern, count] of bottomLines) {
            if (count >= threshold) patterns.add(pattern);
        }
        
        return patterns;
    }
    
    buildStructure(allPageData, fontStats, headerFooterPatterns) {
        const baseSize = fontStats.baseSize;
        const h1Threshold = baseSize * 1.5;
        const h2Threshold = baseSize * 1.25;
        const h3Threshold = baseSize * 1.1;
        
        const structure = [];
        const detectedToc = [];
        let currentParagraph = [];
        let lastLine = null;
        let baseIndent = null;
        
        for (const pageData of allPageData) {
            for (const line of pageData.lines) {
                const normalizedText = line.text.trim().replace(/\d+/g, '#');
                
                if (headerFooterPatterns.has(normalizedText)) continue;
                if (/^[\d\s\-–—\.]+$/.test(line.text.trim()) && line.text.trim().length < 10) continue;
                if (/^(page|chapter|section)\s*\d+$/i.test(line.text.trim())) continue;
                
                if (baseIndent === null && line.indent > 0) {
                    baseIndent = line.indent;
                }
                
                const isHeading = this.detectHeading(line, baseSize, h1Threshold, h2Threshold, h3Threshold);
                const isList = this.detectListItem(line.text);
                const isBlockQuote = this.detectBlockQuote(line, baseIndent);
                const isLargeGap = lastLine && (line.y - lastLine.y) > lastLine.avgFontSize * 2;
                const isIndented = baseIndent && line.indent > baseIndent + 20;
                
                if (isHeading) {
                    if (currentParagraph.length) {
                        structure.push({ type: 'paragraph', text: this.mergeParagraph(currentParagraph) });
                        currentParagraph = [];
                    }
                    
                    structure.push({ 
                        type: isHeading, 
                        text: line.text.trim(),
                        isBold: line.isBold
                    });
                    
                    if (isHeading === 'h1' || isHeading === 'h2') {
                        detectedToc.push({
                            title: line.text.trim(),
                            level: isHeading === 'h1' ? 0 : 1,
                            page: 0
                        });
                    }
                    
                    lastLine = line;
                    continue;
                }
                
                if (isLargeGap || (isIndented && !isList)) {
                    if (currentParagraph.length) {
                        structure.push({ type: 'paragraph', text: this.mergeParagraph(currentParagraph) });
                        currentParagraph = [];
                    }
                }
                
                if (isList) {
                    if (currentParagraph.length) {
                        structure.push({ type: 'paragraph', text: this.mergeParagraph(currentParagraph) });
                        currentParagraph = [];
                    }
                    structure.push({ type: 'list-item', text: line.text.trim() });
                } else if (isBlockQuote) {
                    if (currentParagraph.length) {
                        structure.push({ type: 'paragraph', text: this.mergeParagraph(currentParagraph) });
                        currentParagraph = [];
                    }
                    structure.push({ type: 'blockquote', text: line.text.trim() });
                } else {
                    currentParagraph.push(line);
                }
                
                lastLine = line;
            }
        }
        
        if (currentParagraph.length) {
            structure.push({ type: 'paragraph', text: this.mergeParagraph(currentParagraph) });
        }
        
        const paragraphs = this.structureToParagraphs(structure);
        
        return { structure, paragraphs, detectedToc };
    }
    
    detectHeading(line, baseSize, h1, h2, h3) {
        const text = line.text.trim();
        
        if (text.length > 200) return false;
        if (text.length < 2) return false;
        
        const chapterPattern = /^(chapter|part|section|book|act|scene|prologue|epilogue|introduction|preface|conclusion|appendix)\s*[\divxlc]*(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|[a-z]+teen|twenty|thirty|forty|fifty)?\.?:?\s*$/i;
        const chapterPatternAlt = /^(chapter|part|section)\s+.{1,30}$/i;
        
        if (chapterPattern.test(text)) return 'h1';
        if (chapterPatternAlt.test(text) && text.length < 60) return 'h1';
        
        const endsWithPunctuation = /[.,:;]$/.test(text);
        if (endsWithPunctuation && !chapterPattern.test(text)) {
            return false;
        }
        
        if (line.maxFontSize >= h1) return 'h1';
        if (line.maxFontSize >= h2) return 'h2';
        if ((line.maxFontSize >= h3 || line.isBold) && text.length < 100) return 'h3';
        
        if (/^(chapter|part)\s+[\dIVXLCM]+/i.test(text)) return 'h1';
        if (/^(section|article)\s+[\d\.]+/i.test(text)) return 'h2';
        if (/^[\dIVXLCM]+\.\s+[A-Z]/.test(text) && text.length < 80) return 'h2';
        if (/^[IVXLC]+\.?\s*$/i.test(text) && text.length <= 10) return 'h2';
        
        return false;
    }
    
    detectListItem(text) {
        const trimmed = text.trim();
        if (/^[\•\-\*\◦\▪\▸]\s/.test(trimmed)) return true;
        if (/^\d+[\.\)]\s/.test(trimmed)) return true;
        if (/^[a-z][\.\)]\s/i.test(trimmed)) return true;
        if (/^[IVXLCMivxlcm]+[\.\)]\s/.test(trimmed)) return true;
        return false;
    }
    
    detectBlockQuote(line, baseIndent) {
        if (!baseIndent) return false;
        return line.indent > baseIndent + 40;
    }
    
    mergeParagraph(lines) {
        if (!lines.length) return '';
        
        let text = lines.map(l => l.text).join(' ');
        
        text = text.replace(/(\w+)-\s+(\w+)/g, '$1$2');
        
        text = text.replace(/\s+/g, ' ').trim();
        
        return text;
    }
    
    structureToParagraphs(structure) {
        const paragraphs = [];
        let currentListItems = [];
        
        for (let i = 0; i < structure.length; i++) {
            const item = structure[i];
            
            if (item.type === 'list-item') {
                currentListItems.push(item.text);
                
                const nextItem = structure[i + 1];
                if (!nextItem || nextItem.type !== 'list-item') {
                    paragraphs.push(currentListItems.join('\n'));
                    currentListItems = [];
                }
                continue;
            }
            
            if (currentListItems.length) {
                paragraphs.push(currentListItems.join('\n'));
                currentListItems = [];
            }
            
            if (item.text && item.text.trim()) {
                paragraphs.push(item.text.trim());
            }
        }
        
        if (currentListItems.length) {
            paragraphs.push(currentListItems.join('\n'));
        }
        
        return paragraphs.filter(p => p.length > 0);
    }
    
    async processOutline(outline, pdf) {
        const toc = [];
        
        const processItems = async (items, level = 0) => {
            for (const item of items) {
                let pageNum = 0;
                
                if (item.dest) {
                    try {
                        let dest = item.dest;
                        if (typeof dest === 'string') {
                            dest = await pdf.getDestination(dest);
                        }
                        if (dest && dest[0]) {
                            const ref = dest[0];
                            pageNum = await pdf.getPageIndex(ref);
                        }
                    } catch (e) {
                        console.log('Could not resolve destination:', e);
                    }
                }
                
                toc.push({
                    title: item.title,
                    page: pageNum,
                    level
                });
                
                if (item.items && item.items.length) {
                    await processItems(item.items, level + 1);
                }
            }
        };
        
        await processItems(outline);
        return toc;
    }
    
    async reprocessBook(book) {
        return {
            ...book,
            reprocessed: true
        };
    }
}

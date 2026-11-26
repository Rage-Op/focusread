/**
 * PDF text extraction using pdf.js
 * Handles text reflow, dehyphenation, and header/footer removal
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
        const allPageTexts = [];
        const pageBreaks = {};
        let totalWords = 0;
        
        for (let i = 1; i <= numPages; i++) {
            if (this.cancelled) {
                throw new Error('Import cancelled');
            }
            
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            
            const pageText = this.extractPageText(textContent);
            allPageTexts.push(pageText);
            
            pageBreaks[i - 1] = totalWords;
            totalWords += pageText.split(/\s+/).filter(w => w).length;
            
            const progress = Math.round((i / numPages) * 100);
            onProgress?.(progress, i, numPages);
        }
        
        let toc = [];
        try {
            const outline = await pdf.getOutline();
            if (outline) {
                toc = await this.processOutline(outline, pdf);
            }
        } catch (e) {
            console.log('Could not extract TOC:', e);
        }
        
        const processedText = this.processText(allPageTexts);
        const paragraphs = this.splitIntoParagraphs(processedText);
        
        return {
            paragraphs,
            toc,
            pageBreaks
        };
    }
    
    extractPageText(textContent) {
        const items = textContent.items;
        if (!items.length) return '';
        
        const lines = [];
        let currentLine = [];
        let lastY = null;
        const lineThreshold = 5;
        
        for (const item of items) {
            const y = item.transform[5];
            
            if (lastY !== null && Math.abs(y - lastY) > lineThreshold) {
                if (currentLine.length) {
                    lines.push(currentLine.map(i => i.str).join(''));
                }
                currentLine = [];
            }
            
            currentLine.push(item);
            lastY = y;
        }
        
        if (currentLine.length) {
            lines.push(currentLine.map(i => i.str).join(''));
        }
        
        return lines.join('\n');
    }
    
    processText(pageTexts) {
        const headerFooterPatterns = this.detectHeadersFooters(pageTexts);
        
        let processedPages = pageTexts.map(pageText => {
            let lines = pageText.split('\n');
            
            lines = lines.filter(line => {
                const trimmed = line.trim();
                
                if (headerFooterPatterns.has(trimmed)) return false;
                
                if (/^[\d\s\-–—\.]+$/.test(trimmed) && trimmed.length < 10) return false;
                
                if (/^(page|chapter|section)\s*\d+$/i.test(trimmed)) return false;
                
                return true;
            });
            
            return lines.join('\n');
        });
        
        let fullText = processedPages.join('\n\n');
        
        fullText = this.dehyphenate(fullText);
        
        fullText = this.joinBrokenLines(fullText);
        
        return fullText;
    }
    
    detectHeadersFooters(pageTexts) {
        const lineFrequency = new Map();
        
        for (const pageText of pageTexts) {
            const lines = pageText.split('\n');
            
            const topLines = lines.slice(0, 3);
            const bottomLines = lines.slice(-3);
            
            [...topLines, ...bottomLines].forEach(line => {
                const normalized = line.trim().replace(/\d+/g, '#');
                if (normalized.length > 2) {
                    lineFrequency.set(normalized, (lineFrequency.get(normalized) || 0) + 1);
                }
            });
        }
        
        const threshold = Math.max(3, pageTexts.length * 0.3);
        const repeatPatterns = new Set();
        
        for (const [pattern, count] of lineFrequency) {
            if (count >= threshold) {
                for (const pageText of pageTexts) {
                    const lines = pageText.split('\n');
                    for (const line of lines) {
                        const normalized = line.trim().replace(/\d+/g, '#');
                        if (normalized === pattern) {
                            repeatPatterns.add(line.trim());
                        }
                    }
                }
            }
        }
        
        return repeatPatterns;
    }
    
    dehyphenate(text) {
        return text.replace(/(\w+)-\n(\w+)/g, (match, before, after) => {
            return before + after;
        });
    }
    
    joinBrokenLines(text) {
        const lines = text.split('\n');
        const result = [];
        let buffer = '';
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (!line) {
                if (buffer) {
                    result.push(buffer);
                    buffer = '';
                }
                result.push('');
                continue;
            }
            
            const endsWithSentenceEnd = /[.!?:;]["'""''\)\]]*$/.test(line);
            const isShortLine = line.length < 50;
            const nextLine = lines[i + 1]?.trim() || '';
            const nextStartsLower = nextLine && /^[a-z]/.test(nextLine);
            const nextStartsCapital = nextLine && /^[A-Z]/.test(nextLine);
            
            if (buffer) {
                buffer += ' ' + line;
            } else {
                buffer = line;
            }
            
            if (endsWithSentenceEnd || (isShortLine && nextStartsCapital && !nextStartsLower)) {
                result.push(buffer);
                buffer = '';
            } else if (!nextLine) {
                result.push(buffer);
                buffer = '';
            }
        }
        
        if (buffer) {
            result.push(buffer);
        }
        
        return result.join('\n');
    }
    
    splitIntoParagraphs(text) {
        const rawParagraphs = text.split(/\n\s*\n/);
        
        const paragraphs = rawParagraphs
            .map(p => p.replace(/\s+/g, ' ').trim())
            .filter(p => p.length > 0);
        
        const longParagraphs = [];
        for (const para of paragraphs) {
            if (para.length > 2000) {
                const sentences = para.match(/[^.!?]+[.!?]+[\s"'""''\)\]]*|[^.!?]+$/g) || [para];
                let chunk = '';
                
                for (const sentence of sentences) {
                    if (chunk.length + sentence.length > 1500 && chunk) {
                        longParagraphs.push(chunk.trim());
                        chunk = '';
                    }
                    chunk += sentence;
                }
                
                if (chunk.trim()) {
                    longParagraphs.push(chunk.trim());
                }
            } else {
                longParagraphs.push(para);
            }
        }
        
        return longParagraphs;
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
}

/**
 * Highlighter Module
 * Handles text highlighting with colors, notes, and cloud sync
 */

const HIGHLIGHT_COLORS = [
    { id: 'yellow', name: 'Yellow', color: '#fef08a', border: '#eab308' },
    { id: 'green', name: 'Green', color: '#bbf7d0', border: '#22c55e' },
    { id: 'blue', name: 'Blue', color: '#bfdbfe', border: '#3b82f6' },
    { id: 'pink', name: 'Pink', color: '#fbcfe8', border: '#ec4899' },
    { id: 'purple', name: 'Purple', color: '#ddd6fe', border: '#8b5cf6' }
];

export class Highlighter {
    constructor(storage, firebase) {
        this.storage = storage;
        this.firebase = firebase;
        this.highlights = [];
        this.currentBookId = null;
        this.popup = null;
        this.panel = null;
        this.onHighlightsChange = null;
        
        this.createPopup();
        this.createPanel();
        this.bindSelectionEvents();
    }
    
    createPopup() {
        this.popup = document.createElement('div');
        this.popup.id = 'highlight-popup';
        this.popup.className = 'highlight-popup';
        this.popup.innerHTML = `
            <div class="highlight-colors">
                ${HIGHLIGHT_COLORS.map(c => `
                    <button class="highlight-color-btn" data-color="${c.id}" 
                            style="background: ${c.color}; border-color: ${c.border}"
                            aria-label="${c.name}"></button>
                `).join('')}
            </div>
            <div class="highlight-actions">
                <button class="highlight-action-btn" id="highlight-note-btn" aria-label="Add note">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
                <button class="highlight-action-btn" id="highlight-copy-btn" aria-label="Copy text">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                </button>
                <button class="highlight-action-btn highlight-remove-btn" id="highlight-remove-btn" 
                        aria-label="Remove highlight" style="display:none">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </div>
        `;
        document.body.appendChild(this.popup);
        
        this.popup.querySelectorAll('.highlight-color-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.applyHighlight(btn.dataset.color);
            });
        });
        
        document.getElementById('highlight-note-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.promptForNote();
        });
        
        document.getElementById('highlight-copy-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.copySelectedText();
        });
        
        document.getElementById('highlight-remove-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeCurrentHighlight();
        });
    }
    
    createPanel() {
        this.panel = document.createElement('div');
        this.panel.id = 'highlights-panel';
        this.panel.className = 'highlights-panel';
        this.panel.setAttribute('aria-hidden', 'true');
        this.panel.innerHTML = `
            <div class="highlights-header">
                <h2>Highlights</h2>
                <button id="close-highlights" class="close-btn" aria-label="Close">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
            <div class="highlights-filters">
                <div class="color-filters">
                    <button class="color-filter-btn active" data-filter="all">All</button>
                    ${HIGHLIGHT_COLORS.map(c => `
                        <button class="color-filter-btn" data-filter="${c.id}" 
                                style="background: ${c.color}"></button>
                    `).join('')}
                </div>
                <input type="search" id="highlight-search" placeholder="Search highlights..." class="highlight-search">
            </div>
            <div class="highlights-list" id="highlights-list"></div>
            <div class="highlights-footer">
                <button id="export-highlights" class="secondary-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                    </svg>
                    Export as Markdown
                </button>
            </div>
        `;
        
        const overlay = document.createElement('div');
        overlay.id = 'highlights-overlay';
        overlay.className = 'panel-overlay';
        
        document.body.appendChild(overlay);
        document.body.appendChild(this.panel);
        
        document.getElementById('close-highlights')?.addEventListener('click', () => this.hidePanel());
        overlay.addEventListener('click', () => this.hidePanel());
        
        this.panel.querySelectorAll('.color-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.panel.querySelectorAll('.color-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.renderHighlightsList(btn.dataset.filter);
            });
        });
        
        document.getElementById('highlight-search')?.addEventListener('input', (e) => {
            this.renderHighlightsList('all', e.target.value);
        });
        
        document.getElementById('export-highlights')?.addEventListener('click', () => {
            this.exportToMarkdown();
        });
    }
    
    bindSelectionEvents() {
        this.popupJustShown = false;
        
        document.addEventListener('mouseup', (e) => this.handleSelectionEnd(e));
        document.addEventListener('touchend', (e) => this.handleSelectionEnd(e));
        document.addEventListener('click', (e) => {
            if (this.popupJustShown) {
                this.popupJustShown = false;
                return;
            }
            if (!e.target.closest('#highlight-popup') && !e.target.closest('.highlight-mark')) {
                this.hidePopup();
            }
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'h' && !e.target.matches('input, textarea')) {
                this.togglePanel();
            }
            if (e.key === 'Escape' && this.panel.classList.contains('open')) {
                this.hidePanel();
            }
        });
    }
    
    handleSelectionEnd(e) {
        if (e.target.closest('#highlight-popup') || e.target.closest('.highlights-panel')) return;
        
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        
        if (!selectedText || selectedText.length < 3) {
            return;
        }
        
        const container = document.getElementById('text-container');
        if (!container) return;
        
        const range = selection.getRangeAt(0);
        const commonAncestor = range.commonAncestorContainer;
        
        if (!container.contains(commonAncestor)) return;
        
        this.currentSelection = {
            text: selectedText,
            range: range.cloneRange()
        };
        
        const existingHighlight = this.findHighlightAtSelection();
        this.showPopup(e, !!existingHighlight);
        this.currentHighlightId = existingHighlight?.id;
    }
    
    findHighlightAtSelection() {
        const selection = window.getSelection();
        if (!selection.rangeCount) return null;
        
        const range = selection.getRangeAt(0);
        const marks = document.querySelectorAll('.highlight-mark');
        
        for (const mark of marks) {
            if (range.intersectsNode(mark)) {
                const highlightId = mark.dataset.highlightId;
                return this.highlights.find(h => h.id === highlightId);
            }
        }
        
        return null;
    }
    
    showPopup(e, showRemove = false) {
        const rect = this.currentSelection.range.getBoundingClientRect();
        
        let top = rect.top - 50;
        let left = rect.left + (rect.width / 2) - 100;
        
        if (top < 10) top = rect.bottom + 10;
        if (left < 10) left = 10;
        if (left + 200 > window.innerWidth) left = window.innerWidth - 210;
        
        this.popup.style.top = `${top}px`;
        this.popup.style.left = `${left}px`;
        this.popup.classList.add('visible');
        this.popupJustShown = true;
        
        const removeBtn = document.getElementById('highlight-remove-btn');
        if (removeBtn) {
            removeBtn.style.display = showRemove ? '' : 'none';
        }
    }
    
    hidePopup() {
        this.popup.classList.remove('visible');
        this.currentSelection = null;
        this.currentHighlightId = null;
    }
    
    async applyHighlight(colorId) {
        if (!this.currentSelection || !this.currentBookId) return;
        
        const color = HIGHLIGHT_COLORS.find(c => c.id === colorId);
        if (!color) return;
        
        const anchor = this.createAnchor(this.currentSelection.range);
        
        const highlight = {
            id: `hl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            text: this.currentSelection.text,
            color: colorId,
            note: '',
            anchor,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        
        this.highlights.push(highlight);
        await this.saveHighlights();
        
        this.renderHighlightInDocument(highlight);
        this.hidePopup();
        
        window.getSelection().removeAllRanges();
    }
    
    createAnchor(range) {
        const container = document.getElementById('text-container');
        const paragraphWrapper = range.startContainer.parentElement?.closest('.paragraph-wrapper');
        const paragraphIndex = paragraphWrapper?.dataset.paragraph;
        
        const startOffset = this.getTextOffset(range.startContainer, range.startOffset, paragraphWrapper);
        const endOffset = this.getTextOffset(range.endContainer, range.endOffset, paragraphWrapper);
        
        return {
            paragraphIndex: parseInt(paragraphIndex) || 0,
            startOffset,
            endOffset,
            quotedText: range.toString().substring(0, 100)
        };
    }
    
    getTextOffset(node, offset, container) {
        if (!container) return offset;
        
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
        let totalOffset = 0;
        
        while (walker.nextNode()) {
            if (walker.currentNode === node) {
                return totalOffset + offset;
            }
            totalOffset += walker.currentNode.textContent.length;
        }
        
        return offset;
    }
    
    renderHighlightInDocument(highlight) {
        const paragraphWrapper = document.querySelector(`[data-paragraph="${highlight.anchor.paragraphIndex}"]`);
        if (!paragraphWrapper) return;
        
        const textContainer = paragraphWrapper.querySelector('.paragraph-text');
        if (!textContainer) return;
        
        const color = HIGHLIGHT_COLORS.find(c => c.id === highlight.color);
        if (!color) return;
        
        const text = textContainer.textContent;
        const searchText = highlight.anchor.quotedText || highlight.text.substring(0, 50);
        const index = text.indexOf(searchText);
        
        if (index === -1) return;
        
        const range = document.createRange();
        const walker = document.createTreeWalker(textContainer, NodeFilter.SHOW_TEXT, null, false);
        
        let currentOffset = 0;
        let startNode = null, startOffset = 0;
        let endNode = null, endOffset = 0;
        
        while (walker.nextNode()) {
            const nodeLen = walker.currentNode.textContent.length;
            
            if (!startNode && currentOffset + nodeLen > index) {
                startNode = walker.currentNode;
                startOffset = index - currentOffset;
            }
            
            if (startNode && currentOffset + nodeLen >= index + highlight.text.length) {
                endNode = walker.currentNode;
                endOffset = Math.min(index + highlight.text.length - currentOffset, nodeLen);
                break;
            }
            
            currentOffset += nodeLen;
        }
        
        if (!startNode || !endNode) return;
        
        try {
            range.setStart(startNode, startOffset);
            range.setEnd(endNode, endOffset);
            
            const mark = document.createElement('mark');
            mark.className = 'highlight-mark';
            mark.dataset.highlightId = highlight.id;
            mark.dataset.color = highlight.color;
            mark.style.backgroundColor = color.color;
            mark.style.borderBottom = `2px solid ${color.border}`;
            
            if (highlight.note) {
                mark.classList.add('has-note');
                mark.title = highlight.note;
            }
            
            range.surroundContents(mark);
            
            mark.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showHighlightDetails(highlight.id);
            });
            
        } catch (e) {
            console.log('Could not render highlight:', e);
        }
    }
    
    renderAllHighlights() {
        document.querySelectorAll('.highlight-mark').forEach(el => {
            const parent = el.parentNode;
            parent.replaceChild(document.createTextNode(el.textContent), el);
            parent.normalize();
        });
        
        for (const highlight of this.highlights) {
            this.renderHighlightInDocument(highlight);
        }
    }
    
    async promptForNote() {
        const note = prompt('Add a note to this highlight:');
        if (note === null) return;
        
        if (this.currentHighlightId) {
            const highlight = this.highlights.find(h => h.id === this.currentHighlightId);
            if (highlight) {
                highlight.note = note;
                highlight.updatedAt = Date.now();
                await this.saveHighlights();
                this.renderAllHighlights();
            }
        } else if (this.currentSelection) {
            await this.applyHighlight('yellow');
            const newHighlight = this.highlights[this.highlights.length - 1];
            if (newHighlight) {
                newHighlight.note = note;
                newHighlight.updatedAt = Date.now();
                await this.saveHighlights();
                this.renderAllHighlights();
            }
        }
        
        this.hidePopup();
    }
    
    copySelectedText() {
        if (this.currentSelection) {
            navigator.clipboard.writeText(this.currentSelection.text);
        }
        this.hidePopup();
    }
    
    async removeCurrentHighlight() {
        if (!this.currentHighlightId) return;
        
        this.highlights = this.highlights.filter(h => h.id !== this.currentHighlightId);
        await this.saveHighlights();
        
        const mark = document.querySelector(`[data-highlight-id="${this.currentHighlightId}"]`);
        if (mark) {
            const parent = mark.parentNode;
            parent.replaceChild(document.createTextNode(mark.textContent), mark);
            parent.normalize();
        }
        
        this.hidePopup();
    }
    
    showHighlightDetails(highlightId) {
        const highlight = this.highlights.find(h => h.id === highlightId);
        if (!highlight) return;
        
        this.currentHighlightId = highlightId;
        this.currentSelection = { text: highlight.text };
        
        const mark = document.querySelector(`[data-highlight-id="${highlightId}"]`);
        if (mark) {
            const rect = mark.getBoundingClientRect();
            this.popup.style.top = `${rect.top - 50}px`;
            this.popup.style.left = `${rect.left + (rect.width / 2) - 100}px`;
            this.popup.classList.add('visible');
            
            document.getElementById('highlight-remove-btn').style.display = '';
        }
    }
    
    showPanel() {
        this.panel.classList.add('open');
        this.panel.setAttribute('aria-hidden', 'false');
        document.getElementById('highlights-overlay')?.classList.add('visible');
        this.renderHighlightsList();
    }
    
    hidePanel() {
        this.panel.classList.remove('open');
        this.panel.setAttribute('aria-hidden', 'true');
        document.getElementById('highlights-overlay')?.classList.remove('visible');
    }
    
    togglePanel() {
        if (this.panel.classList.contains('open')) {
            this.hidePanel();
        } else {
            this.showPanel();
        }
    }
    
    renderHighlightsList(colorFilter = 'all', searchQuery = '') {
        const list = document.getElementById('highlights-list');
        if (!list) return;
        
        let filtered = [...this.highlights];
        
        if (colorFilter !== 'all') {
            filtered = filtered.filter(h => h.color === colorFilter);
        }
        
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(h => 
                h.text.toLowerCase().includes(query) || 
                h.note?.toLowerCase().includes(query)
            );
        }
        
        filtered.sort((a, b) => a.anchor.paragraphIndex - b.anchor.paragraphIndex);
        
        if (filtered.length === 0) {
            list.innerHTML = '<div class="no-highlights">No highlights yet. Select text to highlight.</div>';
            return;
        }
        
        list.innerHTML = filtered.map(h => {
            const color = HIGHLIGHT_COLORS.find(c => c.id === h.color);
            return `
                <div class="highlight-item" data-highlight-id="${h.id}" 
                     style="border-left-color: ${color?.border || '#eab308'}">
                    <div class="highlight-text">${this.escapeHtml(h.text.substring(0, 200))}${h.text.length > 200 ? '...' : ''}</div>
                    ${h.note ? `<div class="highlight-note">${this.escapeHtml(h.note)}</div>` : ''}
                    <div class="highlight-meta">Paragraph ${h.anchor.paragraphIndex + 1}</div>
                </div>
            `;
        }).join('');
        
        list.querySelectorAll('.highlight-item').forEach(item => {
            item.addEventListener('click', () => {
                const highlightId = item.dataset.highlightId;
                this.jumpToHighlight(highlightId);
            });
        });
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    jumpToHighlight(highlightId) {
        const highlight = this.highlights.find(h => h.id === highlightId);
        if (!highlight) return;
        
        const mark = document.querySelector(`[data-highlight-id="${highlightId}"]`);
        if (mark) {
            mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
            mark.classList.add('highlight-flash');
            setTimeout(() => mark.classList.remove('highlight-flash'), 1000);
        } else {
            const wrapper = document.querySelector(`[data-paragraph="${highlight.anchor.paragraphIndex}"]`);
            if (wrapper) {
                wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
        
        this.hidePanel();
    }
    
    async loadHighlights(bookId) {
        this.currentBookId = bookId;
        
        const stored = await this.storage.getBookHighlights(bookId);
        this.highlights = stored?.items || [];
        
        if (this.firebase?.isSignedIn()) {
            const cloudHighlights = await this.firebase.getHighlightsFromCloud(bookId);
            if (cloudHighlights && cloudHighlights.updatedAt > (stored?.updatedAt || 0)) {
                this.highlights = cloudHighlights.items;
                await this.storage.saveBookHighlights(bookId, {
                    items: this.highlights,
                    updatedAt: cloudHighlights.updatedAt
                });
            }
        }
        
        this.renderAllHighlights();
        this.onHighlightsChange?.(this.highlights);
    }
    
    async saveHighlights() {
        if (!this.currentBookId) return;
        
        const data = {
            items: this.highlights,
            updatedAt: Date.now()
        };
        
        await this.storage.saveBookHighlights(this.currentBookId, data);
        
        if (this.firebase?.isSignedIn()) {
            await this.firebase.syncHighlights(this.currentBookId, data);
        }
        
        this.onHighlightsChange?.(this.highlights);
    }
    
    exportToMarkdown() {
        if (!this.highlights.length) {
            alert('No highlights to export.');
            return;
        }
        
        const bookTitle = document.getElementById('current-book-title')?.textContent || 'Book';
        
        let markdown = `# Highlights from "${bookTitle}"\n\n`;
        markdown += `Exported on ${new Date().toLocaleDateString()}\n\n---\n\n`;
        
        const sorted = [...this.highlights].sort((a, b) => a.anchor.paragraphIndex - b.anchor.paragraphIndex);
        
        for (const h of sorted) {
            const color = HIGHLIGHT_COLORS.find(c => c.id === h.color)?.name || 'Yellow';
            markdown += `## ${color} Highlight (Paragraph ${h.anchor.paragraphIndex + 1})\n\n`;
            markdown += `> ${h.text}\n\n`;
            if (h.note) {
                markdown += `**Note:** ${h.note}\n\n`;
            }
            markdown += `---\n\n`;
        }
        
        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `highlights-${bookTitle.replace(/[^a-z0-9]/gi, '-')}.md`;
        a.click();
        URL.revokeObjectURL(url);
    }
    
    getColors() {
        return HIGHLIGHT_COLORS;
    }
}

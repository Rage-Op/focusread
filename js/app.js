/**
 * FocusRead - ADHD-Friendly PDF Reader
 * Main application entry point
 */

import { PinManager } from './pin.js';
import { PDFHandler } from './pdf-handler.js';
import { StorageManager } from './storage.js';
import { BionicReader } from './bionic.js';
import { RSVPReader } from './rsvp.js';
import { TTSManager } from './tts.js';
import { SettingsManager } from './settings.js';
import { SearchManager } from './search.js';

class FocusReadApp {
    constructor() {
        this.storage = new StorageManager();
        this.settings = new SettingsManager(this.storage);
        this.pin = new PinManager(this.storage);
        this.pdf = new PDFHandler();
        this.bionic = new BionicReader();
        this.rsvp = null;
        this.tts = new TTSManager();
        this.search = new SearchManager();
        
        this.currentBook = null;
        this.words = [];
        this.paragraphs = [];
        this.readingPosition = 0;
        this.isLocked = true;
        
        this.init();
    }
    
    async init() {
        await this.storage.init();
        await this.settings.load();
        this.settings.apply();
        
        this.bindEvents();
        this.checkAuth();
        
        if ('serviceWorker' in navigator) {
            try {
                await navigator.serviceWorker.register('sw.js');
            } catch (e) {
                console.log('Service worker registration failed:', e);
            }
        }
    }
    
    bindEvents() {
        document.getElementById('menu-btn').addEventListener('click', () => this.toggleSidebar());
        document.getElementById('close-sidebar').addEventListener('click', () => this.toggleSidebar(false));
        document.getElementById('sidebar-overlay').addEventListener('click', () => this.toggleSidebar(false));
        
        document.getElementById('nav-library').addEventListener('click', () => {
            this.showView('library');
            this.toggleSidebar(false);
        });
        document.getElementById('nav-import').addEventListener('click', () => {
            this.triggerImport();
            this.toggleSidebar(false);
        });
        
        document.getElementById('import-btn-empty').addEventListener('click', () => this.triggerImport());
        document.getElementById('pdf-input').addEventListener('change', (e) => this.handleFileSelect(e));
        document.getElementById('cancel-import').addEventListener('click', () => this.cancelImport());
        
        document.getElementById('settings-btn').addEventListener('click', () => this.toggleSettings());
        document.getElementById('close-settings').addEventListener('click', () => this.toggleSettings(false));
        document.getElementById('settings-overlay').addEventListener('click', () => this.toggleSettings(false));
        
        document.getElementById('lock-btn').addEventListener('click', () => this.lock());
        
        document.getElementById('back-to-library').addEventListener('click', () => this.showView('library'));
        
        document.getElementById('bionic-toggle').addEventListener('click', () => this.toggleBionic());
        document.getElementById('rsvp-toggle').addEventListener('click', () => this.toggleRSVP());
        document.getElementById('tts-toggle').addEventListener('click', () => this.toggleTTS());
        
        document.getElementById('font-decrease').addEventListener('click', () => this.changeFontSize(-2));
        document.getElementById('font-increase').addEventListener('click', () => this.changeFontSize(2));
        
        document.getElementById('search-btn').addEventListener('click', () => this.toggleSearch());
        document.getElementById('close-search').addEventListener('click', () => this.toggleSearch(false));
        document.getElementById('search-input').addEventListener('input', (e) => this.handleSearch(e.target.value));
        
        document.getElementById('toc-btn').addEventListener('click', () => this.toggleTOC());
        document.getElementById('close-toc').addEventListener('click', () => this.toggleTOC(false));
        document.getElementById('toc-overlay').addEventListener('click', () => this.toggleTOC(false));
        
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
        
        const readerContent = document.getElementById('reader-content');
        readerContent.addEventListener('scroll', () => this.updateReadingProgress());
        readerContent.addEventListener('mousemove', (e) => this.updateFocusRuler(e));
        
        this.settings.bindEvents();
    }
    
    checkAuth() {
        if (this.pin.hasPin()) {
            this.showPinScreen('unlock');
        } else {
            this.showPinScreen('setup');
        }
    }
    
    showPinScreen(mode) {
        const pinScreen = document.getElementById('pin-screen');
        const subtitle = document.getElementById('pin-subtitle');
        const forgotBtn = document.getElementById('forgot-pin-btn');
        
        pinScreen.classList.add('active');
        document.getElementById('app').classList.remove('active');
        
        if (mode === 'setup') {
            subtitle.textContent = 'Create a 4-digit PIN';
            forgotBtn.style.display = 'none';
            this.pin.setMode('setup');
        } else {
            subtitle.textContent = 'Enter your PIN to unlock';
            forgotBtn.style.display = '';
            this.pin.setMode('unlock');
        }
        
        this.pin.bindEvents(
            () => this.onPinSuccess(),
            (error) => this.onPinError(error)
        );
    }
    
    onPinSuccess() {
        this.isLocked = false;
        document.getElementById('pin-screen').classList.remove('active');
        document.getElementById('app').classList.add('active');
        this.loadLibrary();
    }
    
    onPinError(error) {
        const errorEl = document.getElementById('pin-error');
        errorEl.textContent = error;
        setTimeout(() => errorEl.textContent = '', 3000);
    }
    
    lock() {
        this.isLocked = true;
        this.tts.stop();
        if (this.rsvp) this.rsvp.stop();
        this.saveReadingPosition();
        this.showPinScreen('unlock');
    }
    
    async loadLibrary() {
        const books = await this.storage.getAllBooks();
        const grid = document.getElementById('book-grid');
        const emptyState = document.getElementById('empty-library');
        
        grid.innerHTML = '';
        
        if (books.length === 0) {
            emptyState.style.display = '';
            grid.style.display = 'none';
        } else {
            emptyState.style.display = 'none';
            grid.style.display = '';
            
            books.forEach(book => {
                const card = this.createBookCard(book);
                grid.appendChild(card);
            });
        }
        
        const lastBook = await this.storage.getLastOpenedBook();
        if (lastBook && books.length > 0) {
            const book = books.find(b => b.id === lastBook);
            if (book) {
                this.openBook(book);
                return;
            }
        }
        
        this.showView('library');
    }
    
    createBookCard(book) {
        const card = document.createElement('div');
        card.className = 'book-card';
        card.setAttribute('role', 'listitem');
        card.setAttribute('tabindex', '0');
        
        const progress = book.position ? Math.round((book.position / book.wordCount) * 100) : 0;
        
        card.innerHTML = `
            <div class="book-cover">📖</div>
            <div class="book-title" title="${book.title}">${book.title}</div>
            <div class="book-progress">${progress}% read</div>
            <button class="book-delete" aria-label="Remove ${book.title}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
            </button>
        `;
        
        card.addEventListener('click', (e) => {
            if (!e.target.closest('.book-delete')) {
                this.openBook(book);
            }
        });
        
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.openBook(book);
            }
        });
        
        card.querySelector('.book-delete').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm(`Remove "${book.title}" from your library?`)) {
                await this.storage.deleteBook(book.id);
                this.loadLibrary();
            }
        });
        
        return card;
    }
    
    async openBook(book) {
        this.currentBook = book;
        this.paragraphs = book.paragraphs;
        this.words = book.paragraphs.flatMap(p => p.split(/\s+/).filter(w => w));
        this.readingPosition = book.position || 0;
        
        document.getElementById('current-book-title').textContent = book.title;
        
        this.renderText();
        this.showView('reader');
        this.updateReadingProgress();
        
        await this.storage.setLastOpenedBook(book.id);
        
        this.scrollToPosition();
        
        if (book.toc && book.toc.length > 0) {
            this.renderTOC(book.toc);
        }
    }
    
    renderText() {
        const container = document.getElementById('text-container');
        const bionicEnabled = this.settings.get('bionicEnabled');
        const strength = this.settings.get('bionicStrength');
        
        container.innerHTML = '';
        
        this.paragraphs.forEach((paragraph, index) => {
            const p = document.createElement('p');
            p.setAttribute('data-paragraph', index);
            
            if (bionicEnabled) {
                p.innerHTML = this.bionic.process(paragraph, strength);
            } else {
                p.textContent = paragraph;
            }
            
            container.appendChild(p);
        });
        
        const bionicBtn = document.getElementById('bionic-toggle');
        bionicBtn.setAttribute('aria-pressed', bionicEnabled);
    }
    
    scrollToPosition() {
        if (!this.readingPosition) return;
        
        let wordCount = 0;
        let targetParagraph = 0;
        
        for (let i = 0; i < this.paragraphs.length; i++) {
            const paraWords = this.paragraphs[i].split(/\s+/).filter(w => w).length;
            if (wordCount + paraWords > this.readingPosition) {
                targetParagraph = i;
                break;
            }
            wordCount += paraWords;
        }
        
        const container = document.getElementById('text-container');
        const paragraph = container.querySelector(`[data-paragraph="${targetParagraph}"]`);
        if (paragraph) {
            paragraph.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
    
    updateReadingProgress() {
        const content = document.getElementById('reader-content');
        const container = document.getElementById('text-container');
        
        if (!container.firstElementChild) return;
        
        const scrollTop = content.scrollTop;
        const scrollHeight = container.scrollHeight;
        const clientHeight = content.clientHeight;
        
        const percent = Math.min(100, Math.round((scrollTop / (scrollHeight - clientHeight)) * 100)) || 0;
        
        document.getElementById('reading-progress').style.width = `${percent}%`;
        document.getElementById('progress-percent').textContent = `${percent}%`;
        
        const progressBar = document.querySelector('.progress-container');
        progressBar.setAttribute('aria-valuenow', percent);
        
        const wordsRead = Math.round((percent / 100) * this.words.length);
        const wordsLeft = this.words.length - wordsRead;
        const wpm = 200;
        const minutesLeft = Math.ceil(wordsLeft / wpm);
        
        document.getElementById('time-left').textContent = `${minutesLeft} min left`;
        
        this.readingPosition = wordsRead;
    }
    
    async saveReadingPosition() {
        if (!this.currentBook) return;
        
        this.currentBook.position = this.readingPosition;
        await this.storage.updateBook(this.currentBook);
    }
    
    updateFocusRuler(e) {
        if (!this.settings.get('focusRulerEnabled')) return;
        
        const ruler = document.getElementById('focus-ruler');
        const lineHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--line-height')) || 1.8;
        const fontSize = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-size')) || 18;
        const rulerHeight = lineHeight * fontSize;
        
        ruler.style.top = `${e.clientY - rulerHeight / 2}px`;
        ruler.style.height = `${rulerHeight}px`;
    }
    
    toggleBionic() {
        const enabled = !this.settings.get('bionicEnabled');
        this.settings.set('bionicEnabled', enabled);
        document.getElementById('bionic-enabled').checked = enabled;
        this.renderText();
    }
    
    toggleRSVP() {
        if (this.rsvp && this.rsvp.isActive) {
            this.rsvp.stop();
            this.showView('reader');
            document.getElementById('rsvp-toggle').setAttribute('aria-pressed', 'false');
        } else {
            this.startRSVP();
        }
    }
    
    startRSVP() {
        this.showView('rsvp');
        document.getElementById('rsvp-toggle').setAttribute('aria-pressed', 'true');
        
        if (!this.rsvp) {
            this.rsvp = new RSVPReader(
                this.words,
                this.readingPosition,
                this.settings.get('rsvpSpeed'),
                (pos) => {
                    this.readingPosition = pos;
                    this.updateRSVPProgress();
                },
                () => {
                    this.showView('reader');
                    document.getElementById('rsvp-toggle').setAttribute('aria-pressed', 'false');
                }
            );
        } else {
            this.rsvp.setWords(this.words);
            this.rsvp.setPosition(this.readingPosition);
        }
        
        this.rsvp.bindControls();
        this.updateRSVPProgress();
    }
    
    updateRSVPProgress() {
        const wordCount = document.getElementById('rsvp-word-count');
        const timeLeft = document.getElementById('rsvp-time-left');
        
        wordCount.textContent = `${this.readingPosition}/${this.words.length}`;
        
        const wordsLeft = this.words.length - this.readingPosition;
        const wpm = this.settings.get('rsvpSpeed');
        const secondsLeft = Math.ceil((wordsLeft / wpm) * 60);
        const minutes = Math.floor(secondsLeft / 60);
        const seconds = secondsLeft % 60;
        timeLeft.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    
    toggleTTS() {
        const btn = document.getElementById('tts-toggle');
        
        if (this.tts.isSpeaking) {
            this.tts.stop();
            btn.setAttribute('aria-pressed', 'false');
        } else {
            const startWord = this.readingPosition;
            let wordIndex = 0;
            let startParagraph = 0;
            
            for (let i = 0; i < this.paragraphs.length; i++) {
                const paraWords = this.paragraphs[i].split(/\s+/).filter(w => w).length;
                if (wordIndex + paraWords > startWord) {
                    startParagraph = i;
                    break;
                }
                wordIndex += paraWords;
            }
            
            const textToRead = this.paragraphs.slice(startParagraph).join('\n\n');
            
            this.tts.speak(textToRead, {
                voice: this.settings.get('ttsVoice'),
                rate: this.settings.get('ttsRate'),
                onEnd: () => {
                    btn.setAttribute('aria-pressed', 'false');
                }
            });
            
            btn.setAttribute('aria-pressed', 'true');
        }
    }
    
    changeFontSize(delta) {
        const current = this.settings.get('fontSize');
        const newSize = Math.min(32, Math.max(14, current + delta));
        this.settings.set('fontSize', newSize);
        document.getElementById('font-size').value = newSize;
        document.getElementById('font-size-value').textContent = `${newSize}px`;
    }
    
    toggleSearch() {
        const panel = document.getElementById('search-panel');
        const isOpen = panel.classList.contains('open');
        
        if (isOpen) {
            panel.classList.remove('open');
            panel.setAttribute('aria-hidden', 'true');
        } else {
            panel.classList.add('open');
            panel.setAttribute('aria-hidden', 'false');
            document.getElementById('search-input').focus();
        }
    }
    
    handleSearch(query) {
        if (!query || query.length < 2) {
            document.getElementById('search-results').innerHTML = '';
            return;
        }
        
        const results = this.search.search(this.paragraphs, query);
        const container = document.getElementById('search-results');
        
        container.innerHTML = results.map((result, i) => `
            <div class="search-result" role="option" data-paragraph="${result.paragraphIndex}" tabindex="0">
                ${result.snippet}
            </div>
        `).join('');
        
        container.querySelectorAll('.search-result').forEach(el => {
            el.addEventListener('click', () => {
                const paraIndex = parseInt(el.dataset.paragraph);
                this.scrollToParagraph(paraIndex);
                this.toggleSearch(false);
            });
        });
    }
    
    scrollToParagraph(index) {
        const container = document.getElementById('text-container');
        const paragraph = container.querySelector(`[data-paragraph="${index}"]`);
        if (paragraph) {
            paragraph.scrollIntoView({ behavior: 'smooth', block: 'center' });
            paragraph.style.background = 'var(--warning)';
            setTimeout(() => paragraph.style.background = '', 2000);
        }
    }
    
    toggleTOC(show) {
        const panel = document.getElementById('toc-panel');
        const overlay = document.getElementById('toc-overlay');
        
        const isOpen = show !== undefined ? show : !panel.classList.contains('open');
        
        if (isOpen) {
            panel.classList.add('open');
            overlay.classList.add('visible');
            panel.setAttribute('aria-hidden', 'false');
        } else {
            panel.classList.remove('open');
            overlay.classList.remove('visible');
            panel.setAttribute('aria-hidden', 'true');
        }
    }
    
    renderTOC(toc) {
        const container = document.getElementById('toc-content');
        
        if (!toc || toc.length === 0) {
            container.innerHTML = '<p style="padding: 1rem; color: var(--text-muted);">No table of contents available</p>';
            return;
        }
        
        container.innerHTML = toc.map((item, i) => `
            <div class="toc-item" role="listitem" data-page="${item.page || i}" tabindex="0" style="padding-left: ${(item.level || 0) * 16 + 12}px">
                ${item.title}
            </div>
        `).join('');
        
        container.querySelectorAll('.toc-item').forEach(el => {
            el.addEventListener('click', () => {
                const page = parseInt(el.dataset.page);
                this.jumpToPage(page);
                this.toggleTOC(false);
            });
        });
    }
    
    jumpToPage(pageNumber) {
        if (!this.currentBook || !this.currentBook.pageBreaks) return;
        
        const wordIndex = this.currentBook.pageBreaks[pageNumber] || 0;
        this.readingPosition = wordIndex;
        this.scrollToPosition();
    }
    
    showView(view) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        
        const viewEl = document.getElementById(`${view}-view`);
        if (viewEl) {
            viewEl.classList.add('active');
        }
        
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            item.removeAttribute('aria-current');
        });
        
        const navItem = document.getElementById(`nav-${view}`);
        if (navItem) {
            navItem.classList.add('active');
            navItem.setAttribute('aria-current', 'page');
        }
    }
    
    toggleSidebar(show) {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        const menuBtn = document.getElementById('menu-btn');
        
        const isOpen = show !== undefined ? show : !sidebar.classList.contains('open');
        
        if (isOpen) {
            sidebar.classList.add('open');
            overlay.classList.add('visible');
            sidebar.setAttribute('aria-hidden', 'false');
            menuBtn.setAttribute('aria-expanded', 'true');
        } else {
            sidebar.classList.remove('open');
            overlay.classList.remove('visible');
            sidebar.setAttribute('aria-hidden', 'true');
            menuBtn.setAttribute('aria-expanded', 'false');
        }
    }
    
    toggleSettings(show) {
        const panel = document.getElementById('settings-panel');
        const overlay = document.getElementById('settings-overlay');
        
        const isOpen = show !== undefined ? show : !panel.classList.contains('open');
        
        if (isOpen) {
            panel.classList.add('open');
            overlay.classList.add('visible');
            panel.setAttribute('aria-hidden', 'false');
        } else {
            panel.classList.remove('open');
            overlay.classList.remove('visible');
            panel.setAttribute('aria-hidden', 'true');
        }
    }
    
    triggerImport() {
        document.getElementById('pdf-input').click();
    }
    
    async handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        e.target.value = '';
        
        const modal = document.getElementById('import-modal');
        modal.classList.add('open');
        
        try {
            const result = await this.pdf.extract(file, (progress, current, total) => {
                document.getElementById('import-progress-bar').style.width = `${progress}%`;
                document.getElementById('import-pages').textContent = `Page ${current} of ${total}`;
                document.getElementById('import-status').textContent = 'Extracting text...';
            });
            
            document.getElementById('import-status').textContent = 'Processing text...';
            
            const book = {
                id: Date.now().toString(),
                title: file.name.replace('.pdf', ''),
                paragraphs: result.paragraphs,
                wordCount: result.paragraphs.flatMap(p => p.split(/\s+/).filter(w => w)).length,
                toc: result.toc,
                pageBreaks: result.pageBreaks,
                position: 0,
                createdAt: Date.now()
            };
            
            await this.storage.saveBook(book);
            
            modal.classList.remove('open');
            
            await this.loadLibrary();
            this.openBook(book);
            
        } catch (error) {
            console.error('Import error:', error);
            document.getElementById('import-status').textContent = `Error: ${error.message}`;
            setTimeout(() => modal.classList.remove('open'), 2000);
        }
    }
    
    cancelImport() {
        this.pdf.cancel();
        document.getElementById('import-modal').classList.remove('open');
    }
    
    handleKeyboard(e) {
        if (this.isLocked) return;
        
        if (e.key === 'Escape') {
            this.toggleSidebar(false);
            this.toggleSettings(false);
            this.toggleSearch(false);
            this.toggleTOC(false);
            
            if (this.rsvp && this.rsvp.isActive) {
                this.rsvp.stop();
                this.showView('reader');
            }
        }
        
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        
        if (e.key === ' ' && this.rsvp && document.getElementById('rsvp-view').classList.contains('active')) {
            e.preventDefault();
            this.rsvp.togglePlay();
        }
        
        if (e.key === 'b') {
            this.toggleBionic();
        }
        
        if (e.key === 'r') {
            this.toggleRSVP();
        }
        
        if (e.key === 's') {
            this.toggleTTS();
        }
        
        if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            this.toggleSearch();
        }
    }
}

window.addEventListener('beforeunload', () => {
    if (window.app && window.app.currentBook) {
        window.app.saveReadingPosition();
    }
});

window.app = new FocusReadApp();

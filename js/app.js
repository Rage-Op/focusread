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
import { FirebaseSync } from './firebase-sync.js';

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
        this.firebase = new FirebaseSync();
        
        this.currentBook = null;
        this.words = [];
        this.paragraphs = [];
        this.readingPosition = 0;
        this.isLocked = true;
        this.deleteBookTarget = null;
        
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
        
        await this.initFirebase();
    }
    
    async initFirebase() {
        if (!this.firebase.isConfigured()) {
            console.log('Firebase not configured, cloud sync disabled');
            return;
        }
        
        document.getElementById('cloud-section').style.display = '';
        
        const initialized = await this.firebase.init();
        if (!initialized) return;
        
        this.firebase.onAuthChange((user) => {
            this.updateCloudUI(user);
            if (user && !this.isLocked) {
                this.mergeLibraries();
            }
        });
        
        this.firebase.onSyncStatus((status) => {
            const indicator = document.getElementById('sync-status');
            if (indicator) {
                indicator.setAttribute('data-status', status);
            }
        });
        
        this.bindCloudEvents();
    }
    
    updateCloudUI(user) {
        const signedOut = document.getElementById('cloud-signed-out');
        const signedIn = document.getElementById('cloud-signed-in');
        const userEmail = document.getElementById('user-email');
        const deleteCloudBtn = document.getElementById('delete-cloud-btn');
        
        if (user) {
            signedOut.style.display = 'none';
            signedIn.style.display = '';
            userEmail.textContent = user.email || user.displayName || 'Signed in';
            if (deleteCloudBtn) deleteCloudBtn.style.display = '';
        } else {
            signedOut.style.display = '';
            signedIn.style.display = 'none';
            if (deleteCloudBtn) deleteCloudBtn.style.display = 'none';
        }
    }
    
    bindCloudEvents() {
        document.getElementById('sign-in-btn')?.addEventListener('click', () => {
            this.showSignInModal();
        });
        
        document.getElementById('google-signin-btn')?.addEventListener('click', async () => {
            try {
                document.getElementById('signin-error').textContent = '';
                await this.firebase.signInWithGoogle();
                this.hideSignInModal();
            } catch (error) {
                document.getElementById('signin-error').textContent = error.message;
            }
        });
        
        document.getElementById('email-signin-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('signin-email').value;
            const password = document.getElementById('signin-password').value;
            
            try {
                document.getElementById('signin-error').textContent = '';
                await this.firebase.signInWithEmail(email, password);
                this.hideSignInModal();
            } catch (error) {
                let message = error.message;
                if (error.code === 'auth/wrong-password') {
                    message = 'Incorrect password';
                } else if (error.code === 'auth/invalid-email') {
                    message = 'Invalid email address';
                } else if (error.code === 'auth/weak-password') {
                    message = 'Password must be at least 6 characters';
                }
                document.getElementById('signin-error').textContent = message;
            }
        });
        
        document.getElementById('close-signin')?.addEventListener('click', () => {
            this.hideSignInModal();
        });
        
        document.getElementById('sign-out-btn')?.addEventListener('click', async () => {
            await this.firebase.signOut();
            this.loadLibrary();
        });
        
        document.getElementById('sync-now-btn')?.addEventListener('click', () => {
            this.syncNow();
        });
        
        document.getElementById('delete-local-btn')?.addEventListener('click', async () => {
            if (this.deleteBookTarget) {
                await this.storage.deleteBook(this.deleteBookTarget.id);
                this.hideDeleteModal();
                this.loadLibrary();
            }
        });
        
        document.getElementById('delete-cloud-btn')?.addEventListener('click', async () => {
            if (this.deleteBookTarget) {
                await this.storage.deleteBook(this.deleteBookTarget.id);
                if (this.firebase.isSignedIn()) {
                    await this.firebase.deleteBookFromCloud(this.deleteBookTarget.id);
                }
                this.hideDeleteModal();
                this.loadLibrary();
            }
        });
        
        document.getElementById('cancel-delete-btn')?.addEventListener('click', () => {
            this.hideDeleteModal();
        });
        
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && this.currentBook) {
                this.saveReadingPosition();
                if (this.firebase.isSignedIn()) {
                    this.firebase.updateBookProgress(
                        this.currentBook.id,
                        this.readingPosition,
                        this.currentBook.wordCount
                    );
                }
            }
        });
    }
    
    showSignInModal() {
        const modal = document.getElementById('signin-modal');
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        document.getElementById('signin-error').textContent = '';
    }
    
    hideSignInModal() {
        const modal = document.getElementById('signin-modal');
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
    }
    
    showDeleteModal(book) {
        this.deleteBookTarget = book;
        const modal = document.getElementById('delete-modal');
        document.getElementById('delete-book-name').textContent = `"${book.title}"`;
        
        const cloudBtn = document.getElementById('delete-cloud-btn');
        if (cloudBtn) {
            cloudBtn.style.display = this.firebase.isSignedIn() ? '' : 'none';
        }
        
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
    }
    
    hideDeleteModal() {
        const modal = document.getElementById('delete-modal');
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
        this.deleteBookTarget = null;
    }
    
    async mergeLibraries() {
        if (!this.firebase.isSignedIn()) return;
        
        const localBooks = await this.storage.getAllBooks();
        const cloudBooks = await this.firebase.getCloudBooks();
        
        const cloudBookIds = new Set(cloudBooks.map(b => b.id));
        const localBookIds = new Set(localBooks.map(b => b.id));
        
        for (const localBook of localBooks) {
            if (!cloudBookIds.has(localBook.id)) {
                await this.firebase.uploadBook(localBook);
            }
        }
        
        for (const cloudBook of cloudBooks) {
            if (!localBookIds.has(cloudBook.id)) {
                const fullBook = await this.firebase.downloadBook(cloudBook.id);
                if (fullBook) {
                    await this.storage.saveBook(fullBook);
                }
            } else {
                const localBook = localBooks.find(b => b.id === cloudBook.id);
                const localUpdatedAt = localBook.updatedAt || localBook.createdAt || 0;
                const cloudUpdatedAt = cloudBook.updatedAt?.toMillis?.() || cloudBook.updatedAt || 0;
                
                if (cloudUpdatedAt > localUpdatedAt && cloudBook.position !== undefined) {
                    localBook.position = cloudBook.position;
                    await this.storage.updateBook(localBook);
                }
            }
        }
        
        const settingsWithTimestamp = { ...this.settings.settings, updatedAt: Date.now() };
        const syncedSettings = await this.firebase.syncSettings(settingsWithTimestamp);
        if (syncedSettings !== settingsWithTimestamp) {
            this.settings.settings = syncedSettings;
            this.settings.apply();
            this.settings.updateUI();
        }
        
        this.loadLibrary();
    }
    
    async syncNow() {
        if (!this.firebase.isSignedIn()) return;
        
        if (this.currentBook) {
            this.saveReadingPosition();
            await this.firebase.updateBookProgress(
                this.currentBook.id,
                this.readingPosition,
                this.currentBook.wordCount
            );
        }
        
        await this.mergeLibraries();
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
        
        document.addEventListener('pointerdown', (e) => {
            if (!e.target.closest('.book-menu') && !e.target.closest('.book-menu-btn')) {
                this.closeAllBookMenus();
            }
        });
        
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
        const cloudBadge = book.isCloud ? `
            <div class="book-cloud-badge" title="Synced to cloud">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
                </svg>
            </div>
        ` : '';
        
        card.innerHTML = `
            <button class="book-menu-btn" aria-label="Book options" aria-expanded="false">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
                </svg>
            </button>
            <div class="book-menu" role="menu" aria-hidden="true">
                <button class="book-menu-item" role="menuitem" data-action="upload" style="${this.firebase.isSignedIn() && !book.isCloud ? '' : 'display:none'}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
                        <polyline points="12 12 12 16"/>
                        <polyline points="9 13 12 10 15 13"/>
                    </svg>
                    Upload to cloud
                </button>
                <button class="book-menu-item danger" role="menuitem" data-action="delete">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                    Remove book
                </button>
            </div>
            <div class="book-cover">📖</div>
            <div class="book-title" title="${book.title}">${book.title}</div>
            <div class="book-progress">${progress}% read</div>
            ${cloudBadge}
        `;
        
        const menuBtn = card.querySelector('.book-menu-btn');
        const menu = card.querySelector('.book-menu');
        
        this.bindTapEvent(card, (e) => {
            if (!e.target.closest('.book-menu-btn') && !e.target.closest('.book-menu')) {
                this.closeAllBookMenus();
                this.openBook(book);
            }
        });
        
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.target.closest('.book-menu-btn') && !e.target.closest('.book-menu')) {
                this.openBook(book);
            }
        });
        
        menuBtn.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
        });
        
        this.bindTapEvent(menuBtn, (e) => {
            e.stopPropagation();
            const isOpen = menu.classList.contains('open');
            this.closeAllBookMenus();
            if (!isOpen) {
                menu.classList.add('open');
                menuBtn.setAttribute('aria-expanded', 'true');
                menu.setAttribute('aria-hidden', 'false');
            }
        });
        
        const uploadBtn = card.querySelector('[data-action="upload"]');
        if (uploadBtn) {
            this.bindTapEvent(uploadBtn, async (e) => {
                e.stopPropagation();
                menu.classList.remove('open');
                
                const fullBook = await this.storage.getBook(book.id);
                if (fullBook) {
                    const success = await this.firebase.uploadBook(fullBook);
                    if (success) {
                        fullBook.isCloud = true;
                        await this.storage.updateBook(fullBook);
                        this.loadLibrary();
                    }
                }
            });
        }
        
        const deleteBtn = card.querySelector('[data-action="delete"]');
        this.bindTapEvent(deleteBtn, async (e) => {
            e.stopPropagation();
            menu.classList.remove('open');
            
            if (this.firebase.isSignedIn()) {
                this.showDeleteModal(book);
            } else {
                if (confirm(`Remove "${book.title}" from your library?\n\nThis cannot be undone.`)) {
                    await this.storage.deleteBook(book.id);
                    this.loadLibrary();
                }
            }
        });
        
        return card;
    }
    
    bindTapEvent(element, handler) {
        let startTime = 0;
        let startX = 0;
        let startY = 0;
        let pointerDown = false;
        
        element.addEventListener('pointerdown', (e) => {
            pointerDown = true;
            startTime = Date.now();
            startX = e.clientX;
            startY = e.clientY;
            element.classList.add('pressed');
        });
        
        element.addEventListener('pointerup', (e) => {
            element.classList.remove('pressed');
            if (!pointerDown) return;
            pointerDown = false;
            
            const elapsed = Date.now() - startTime;
            const dx = Math.abs(e.clientX - startX);
            const dy = Math.abs(e.clientY - startY);
            
            if (elapsed < 500 && dx < 20 && dy < 20) {
                handler(e);
            }
        });
        
        element.addEventListener('pointerleave', () => {
            pointerDown = false;
            element.classList.remove('pressed');
        });
        
        element.addEventListener('pointercancel', () => {
            pointerDown = false;
            element.classList.remove('pressed');
        });
    }
    
    closeAllBookMenus() {
        document.querySelectorAll('.book-menu.open').forEach(menu => {
            menu.classList.remove('open');
            menu.setAttribute('aria-hidden', 'true');
            const btn = menu.previousElementSibling;
            if (btn) btn.setAttribute('aria-expanded', 'false');
        });
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
        this.currentBook.updatedAt = Date.now();
        await this.storage.updateBook(this.currentBook);
        
        if (this.firebase.isSignedIn()) {
            this.firebase.updateBookProgress(
                this.currentBook.id,
                this.readingPosition,
                this.currentBook.wordCount
            );
        }
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
        
        if (view === 'library') {
            document.getElementById('current-book-title').textContent = 'FocusRead';
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
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isCloud: false
            };
            
            await this.storage.saveBook(book);
            
            if (this.firebase.isSignedIn()) {
                document.getElementById('import-status').textContent = 'Uploading to cloud...';
                const uploaded = await this.firebase.uploadBook(book);
                if (uploaded) {
                    book.isCloud = true;
                    await this.storage.updateBook(book);
                }
            }
            
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

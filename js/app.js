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
import { KokoroTTS } from './kokoro-tts.js';
import { Highlighter } from './highlighter.js';

class FocusReadApp {
    constructor() {
        this.storage = new StorageManager();
        this.settings = new SettingsManager(this.storage);
        this.pin = new PinManager(this.storage);
        this.pdf = new PDFHandler();
        this.bionic = new BionicReader();
        this.rsvp = null;
        this.tts = new TTSManager();
        this.kokoroTTS = new KokoroTTS();
        this.search = new SearchManager();
        this.firebase = new FirebaseSync();
        this.highlighter = null;
        
        this.currentBook = null;
        this.words = [];
        this.paragraphs = [];
        this.readingPosition = 0;
        this.readingPercent = 0;
        this.isLocked = true;
        this.deleteBookTarget = null;
        this.reloading = false;
        
        this.init();
    }
    
    showUpdateToast(autoReload = false) {
        let toast = document.getElementById('update-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'update-toast';
            toast.className = 'update-toast';
            toast.innerHTML = `
                <span>Updated, reloading...</span>
            `;
            document.body.appendChild(toast);
        }
        
        toast.classList.add('visible');
        
        if (autoReload) {
            setTimeout(() => {
                location.reload();
            }, 500);
        }
    }
    
    async init() {
        await this.storage.init();
        await this.settings.load();
        this.settings.apply();
        
        this.bindEvents();
        this.checkAuth();
        
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('sw.js', {
                    updateViaCache: 'none'
                });
                
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            this.showUpdateToast();
                        }
                    });
                });
                
                navigator.serviceWorker.addEventListener('message', (event) => {
                    if (event.data?.type === 'SW_ACTIVATED') {
                        this.showUpdateToast(true);
                    }
                });
                
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    if (this.reloading) return;
                    this.reloading = true;
                    this.showUpdateToast(true);
                });
                
                registration.update();
                
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') {
                        registration.update();
                    }
                });
                
            } catch (e) {
                console.log('Service worker registration failed:', e);
            }
        }
        
        await this.initFirebase();
        this.initKokoroTTS();
        this.initHighlighter();
    }
    
    initHighlighter() {
        this.highlighter = new Highlighter(this.storage, this.firebase);
        this.highlighter.onHighlightsChange = (highlights) => {
            const count = highlights.length;
            const badge = document.getElementById('highlights-badge');
            if (badge) {
                badge.textContent = count;
                badge.style.display = count > 0 ? '' : 'none';
            }
        };
    }
    
    initKokoroTTS() {
        this.kokoroTTS.currentVoice = this.settings.get('ttsKokoroVoice') || 'af_heart';
        this.kokoroTTS.speed = this.settings.get('ttsKokoroSpeed') || 1.0;
        this.kokoroTTS.forceSystemVoices = this.settings.get('ttsForceSystem') || false;
        
        this.kokoroTTS.onPlayStateChange = (playing) => {
            this.updateTTSPlayButton(playing);
            if (playing) {
                document.body.classList.add('tts-active');
            }
        };
        
        this.kokoroTTS.onParagraphChange = (index, totalParagraphs, estimatedMinutes) => {
            this.highlightReadingParagraph(index);
            this.scrollToParagraphSmooth(index);
            this.updateTTSPositionInfo(index, totalParagraphs, estimatedMinutes);
        };
        
        this.kokoroTTS.onNeedConsent = (options) => {
            this.showTTSConsentSheet(options);
        };
        
        this.kokoroTTS.onSentenceChange = (index, text) => {
            this.highlightSentence(text);
        };
        
        this.kokoroTTS.onTimeUpdate = (elapsed, total) => {
            this.updateTTSTime(elapsed, total);
        };
        
        this.kokoroTTS.onLoadProgress = (percent, message, loadedMB, totalMB) => {
            const overlay = document.getElementById('tts-loading-overlay');
            const bar = document.getElementById('tts-loading-bar');
            const text = document.getElementById('tts-loading-text');
            const sizeText = document.getElementById('tts-loading-size');
            const percentText = document.getElementById('tts-loading-percent');
            
            const elapsedEl = document.getElementById('tts-elapsed');
            const durationEl = document.getElementById('tts-duration');
            const seekBar = document.getElementById('tts-seek');
            
            if (percent < 100) {
                overlay.style.display = '';
                bar.style.width = `${percent}%`;
                text.textContent = message;
                
                if (sizeText) {
                    if (loadedMB > 0 && totalMB > 0) {
                        sizeText.textContent = `${loadedMB} MB / ${totalMB} MB`;
                    } else if (loadedMB > 0) {
                        sizeText.textContent = `${loadedMB} MB`;
                    } else {
                        sizeText.textContent = '';
                    }
                }
                if (percentText) percentText.textContent = `${percent}%`;
                
                if (elapsedEl && loadedMB > 0) {
                    elapsedEl.textContent = `${loadedMB} MB`;
                }
                if (durationEl && totalMB > 0) {
                    durationEl.textContent = `${totalMB} MB`;
                }
                if (seekBar && percent > 0) {
                    seekBar.value = percent;
                }
            } else {
                overlay.style.display = 'none';
                this.updateTTSModelStatus();
                
                if (elapsedEl) elapsedEl.textContent = '0:00';
                if (durationEl) durationEl.textContent = '0:00';
                if (seekBar) seekBar.value = 0;
            }
        };
        
        this.kokoroTTS.onEngineChange = (engine) => {
            this.updateTTSEngineIndicator(engine);
            this.populateTTSVoices();
            this.updateTTSModelStatus();
        };
        
        this.bindTTSControls();
        this.populateTTSVoices();
        this.updateTTSModelStatus();
    }
    
    bindTTSControls() {
        const playBtn = document.getElementById('tts-play-pause');
        const prevBtn = document.getElementById('tts-prev');
        const nextBtn = document.getElementById('tts-next');
        const closeBtn = document.getElementById('tts-close');
        const speedSelect = document.getElementById('tts-speed-select');
        const voiceSelect = document.getElementById('tts-voice-select');
        
        playBtn?.addEventListener('click', () => {
            if (this.kokoroTTS.isPaused) {
                this.kokoroTTS.play();
            } else if (this.kokoroTTS.isPlaying) {
                this.kokoroTTS.pause();
            }
        });
        
        prevBtn?.addEventListener('click', () => {
            this.kokoroTTS.previousParagraph();
        });
        
        nextBtn?.addEventListener('click', () => {
            this.kokoroTTS.nextParagraph();
        });
        
        closeBtn?.addEventListener('click', () => {
            this.stopKokoroTTS();
        });
        
        speedSelect?.addEventListener('change', (e) => {
            const speed = parseFloat(e.target.value);
            this.kokoroTTS.setSpeed(speed);
            this.settings.set('ttsKokoroSpeed', speed);
        });
        
        voiceSelect?.addEventListener('change', (e) => {
            this.kokoroTTS.setVoice(e.target.value);
            this.settings.set('ttsKokoroVoice', e.target.value);
        });
        
        speedSelect.value = this.kokoroTTS.speed;
        
        document.getElementById('download-tts-model')?.addEventListener('click', async () => {
            const btn = document.getElementById('download-tts-model');
            const textEl = document.getElementById('download-tts-model-text');
            
            if (this.kokoroTTS.isLoading || this.kokoroTTS.isModelLoaded) return;
            
            btn.disabled = true;
            textEl.textContent = 'Starting download...';
            
            this.kokoroTTS.saveUserChoice('kokoro', 'standard');
            await this.kokoroTTS.loadModel();
        });
        
        document.getElementById('delete-tts-model')?.addEventListener('click', async (e) => {
            const btn = e.target.closest('button');
            if (btn?.disabled) return;
            if (confirm('Delete the downloaded Kokoro voice model?\n\nIt will be re-downloaded the next time you use TTS (~95 MB).')) {
                await this.kokoroTTS.deleteModelCache();
                this.updateTTSModelStatus();
            }
        });
    }
    
    populateTTSVoices() {
        const select = document.getElementById('tts-voice-select');
        if (!select) return;
        
        const voices = this.kokoroTTS.getVoices();
        const currentVoice = this.kokoroTTS.currentVoice;
        
        select.innerHTML = voices.map(v => 
            `<option value="${v.id}" ${v.id === currentVoice ? 'selected' : ''}>${v.name}</option>`
        ).join('');
        
        if (this.kokoroTTS.useSystemVoices && voices.length === 0) {
            setTimeout(() => this.populateTTSVoices(), 100);
        }
    }
    
    updateTTSPlayButton(playing) {
        const playIcon = document.querySelector('.tts-icon-play');
        const pauseIcon = document.querySelector('.tts-icon-pause');
        const btn = document.getElementById('tts-play-pause');
        
        if (playing && !this.kokoroTTS.isPaused) {
            playIcon.style.display = 'none';
            pauseIcon.style.display = '';
            btn?.setAttribute('aria-label', 'Pause');
        } else {
            playIcon.style.display = '';
            pauseIcon.style.display = 'none';
            btn?.setAttribute('aria-label', 'Play');
        }
    }
    
    updateTTSTime(elapsed, total) {
        const elapsedEl = document.getElementById('tts-elapsed');
        const durationEl = document.getElementById('tts-duration');
        const seekBar = document.getElementById('tts-seek');
        
        const formatTime = (s) => {
            const mins = Math.floor(s / 60);
            const secs = Math.floor(s % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        };
        
        if (elapsedEl) elapsedEl.textContent = formatTime(elapsed);
        if (durationEl) durationEl.textContent = formatTime(total);
        if (seekBar && total > 0) {
            seekBar.value = (elapsed / total) * 100;
        }
    }
    
    updateTTSEngineIndicator(engine) {
        const badge = document.getElementById('tts-engine-badge');
        const labelEl = badge?.querySelector('.engine-label');
        const detailEl = document.getElementById('tts-engine-detail');
        
        if (badge) {
            badge.setAttribute('data-engine', engine);
        }
        
        if (labelEl) {
            if (engine === 'kokoro') {
                labelEl.textContent = 'Kokoro-82M';
            } else if (engine === 'no-voices') {
                labelEl.textContent = 'No Voice';
            } else {
                labelEl.textContent = 'Device Voice';
            }
        }
        
        if (detailEl) {
            if (engine === 'kokoro') {
                const backend = this.kokoroTTS.backend || 'WASM';
                detailEl.textContent = `Neural • ${backend.toUpperCase()}`;
            } else if (engine === 'no-voices') {
                detailEl.textContent = 'No voices available';
            } else {
                const voiceName = this.kokoroTTS.currentSystemVoiceName;
                detailEl.textContent = voiceName ? voiceName : 'Device built-in';
            }
        }
    }
    
    updateTTSPositionInfo(paragraphIndex, totalParagraphs, estimatedMinutes) {
        const positionEl = document.getElementById('tts-para-position');
        const timeLeftEl = document.getElementById('tts-time-remaining');
        
        const total = totalParagraphs || this.kokoroTTS.paragraphs.length || this.paragraphs.length;
        
        if (positionEl) {
            positionEl.textContent = `Paragraph ${paragraphIndex + 1} of ${total}`;
        }
        
        if (timeLeftEl) {
            if (estimatedMinutes !== undefined && estimatedMinutes > 0) {
                timeLeftEl.textContent = `~${estimatedMinutes} min left`;
            } else if (estimatedMinutes === 0) {
                timeLeftEl.textContent = 'Finishing...';
            } else {
                const ttsParagraphs = this.kokoroTTS.paragraphs.length > 0 
                    ? this.kokoroTTS.paragraphs 
                    : this.paragraphs;
                
                if (ttsParagraphs.length > 0) {
                    let wordsLeft = 0;
                    for (let i = paragraphIndex; i < ttsParagraphs.length; i++) {
                        if (ttsParagraphs[i]) {
                            wordsLeft += ttsParagraphs[i].split(/\s+/).filter(w => w).length;
                        }
                    }
                    
                    const speed = this.kokoroTTS.speed || 1;
                    const wpm = 150 * speed;
                    const minutesLeft = Math.max(1, Math.ceil(wordsLeft / wpm));
                    
                    if (wordsLeft > 0) {
                        timeLeftEl.textContent = `~${minutesLeft} min left`;
                    } else {
                        timeLeftEl.textContent = 'Finishing...';
                    }
                }
            }
        }
    }
    
    showTTSConsentSheet(options) {
        let sheet = document.getElementById('tts-consent-sheet');
        if (!sheet) {
            sheet = document.createElement('div');
            sheet.id = 'tts-consent-sheet';
            sheet.className = 'tts-consent-sheet';
            sheet.innerHTML = `
                <div class="consent-content">
                    <h3>Download Voice Model?</h3>
                    <p id="consent-size">Download the neural voice model (<span class="consent-size-value">95 MB</span>) for high-quality speech.</p>
                    <p class="consent-note">Downloads once and works offline. Using device voice until ready.</p>
                    <div class="consent-actions">
                        <button id="consent-download" class="primary-btn">Download</button>
                        <button id="consent-system" class="secondary-btn">Use Device Voice</button>
                    </div>
                </div>
            `;
            document.body.appendChild(sheet);
        }
        
        sheet.querySelector('.consent-size-value').textContent = `${options.sizeMB} MB`;
        
        const downloadBtn = sheet.querySelector('#consent-download');
        const systemBtn = sheet.querySelector('#consent-system');
        
        const newDownloadBtn = downloadBtn.cloneNode(true);
        const newSystemBtn = systemBtn.cloneNode(true);
        downloadBtn.parentNode.replaceChild(newDownloadBtn, downloadBtn);
        systemBtn.parentNode.replaceChild(newSystemBtn, systemBtn);
        
        newDownloadBtn.addEventListener('click', () => {
            sheet.classList.remove('visible');
            options.onDownload?.('standard');
        });
        
        newSystemBtn.addEventListener('click', () => {
            sheet.classList.remove('visible');
            options.onUseSystem?.();
        });
        
        sheet.classList.add('visible');
    }
    
    async updateTTSModelStatus() {
        const statusText = document.getElementById('tts-model-status-text');
        const sizeRow = document.getElementById('tts-model-size-row');
        const sizeText = document.getElementById('tts-model-size-text');
        const backendRow = document.getElementById('tts-model-backend-row');
        const backendText = document.getElementById('tts-model-backend-text');
        const deleteBtn = document.getElementById('delete-tts-model');
        const fallbackInfo = document.getElementById('tts-fallback-info');
        const fallbackReason = document.getElementById('tts-fallback-reason');
        
        const cacheInfo = await this.kokoroTTS.checkModelCached();
        const modelInfo = this.kokoroTTS.getModelInfo();
        
        if (statusText) {
            if (modelInfo.isLoaded) {
                statusText.textContent = 'Loaded and ready';
                statusText.className = 'model-status-value cached';
            } else if (cacheInfo.cached) {
                statusText.textContent = 'Cached, works offline';
                statusText.className = 'model-status-value cached';
            } else {
                statusText.textContent = 'Not downloaded';
                statusText.className = 'model-status-value not-cached';
            }
        }
        
        if (sizeRow && sizeText) {
            if (cacheInfo.cached && cacheInfo.sizeMB > 0) {
                sizeRow.style.display = '';
                sizeText.textContent = `${cacheInfo.sizeMB} MB`;
            } else {
                sizeRow.style.display = 'none';
            }
        }
        
        if (backendRow && backendText) {
            if (modelInfo.isLoaded) {
                backendRow.style.display = '';
                backendText.textContent = modelInfo.backend.toUpperCase();
            } else {
                backendRow.style.display = 'none';
            }
        }
        
        const downloadBtn = document.getElementById('download-tts-model');
        const downloadText = document.getElementById('download-tts-model-text');
        
        if (downloadBtn && downloadText) {
            if (modelInfo.isLoaded || cacheInfo.cached) {
                downloadBtn.disabled = true;
                downloadText.textContent = 'Model downloaded';
            } else if (modelInfo.isLoading) {
                downloadBtn.disabled = true;
                downloadText.textContent = 'Downloading...';
            } else {
                downloadBtn.disabled = false;
                downloadText.textContent = 'Download voice model (95 MB)';
            }
        }
        
        if (deleteBtn) {
            deleteBtn.disabled = !cacheInfo.cached;
            const deleteText = deleteBtn.querySelector('span');
            if (deleteText) {
                deleteText.textContent = cacheInfo.cached 
                    ? 'Delete downloaded model' 
                    : 'Model not downloaded';
            }
        }
        
        if (fallbackInfo && fallbackReason) {
            if (modelInfo.fallbackReason && modelInfo.engine === 'system') {
                fallbackInfo.style.display = '';
                fallbackReason.textContent = modelInfo.fallbackReason;
            } else {
                fallbackInfo.style.display = 'none';
            }
        }
    }
    
    highlightReadingParagraph(index) {
        document.querySelectorAll('.paragraph-text.reading').forEach(el => {
            el.classList.remove('reading');
        });
        
        const wrapper = document.querySelector(`[data-paragraph="${index}"] .paragraph-text`);
        if (wrapper) {
            wrapper.classList.add('reading');
        }
    }
    
    highlightSentence(sentenceText) {
        document.querySelectorAll('.sentence-highlight').forEach(el => {
            el.outerHTML = el.innerHTML;
        });
        
        const readingPara = document.querySelector('.paragraph-text.reading');
        if (readingPara && sentenceText) {
            const escaped = sentenceText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(${escaped})`, 'i');
            const html = readingPara.innerHTML;
            if (!html.includes('sentence-highlight')) {
                readingPara.innerHTML = html.replace(regex, '<span class="sentence-highlight">$1</span>');
            }
        }
    }
    
    scrollToParagraphSmooth(index) {
        const wrapper = document.querySelector(`[data-paragraph="${index}"]`);
        if (wrapper) {
            wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
    
    async startKokoroTTSFromParagraph(index) {
        const bar = document.getElementById('tts-playback-bar');
        bar?.classList.add('visible');
        bar?.setAttribute('aria-hidden', 'false');
        
        const totalParagraphs = this.paragraphs.length;
        let wordsLeft = 0;
        for (let i = index; i < this.paragraphs.length; i++) {
            wordsLeft += this.paragraphs[i].split(/\s+/).filter(w => w).length;
        }
        const speed = this.kokoroTTS.speed || 1;
        const estimatedMinutes = Math.max(1, Math.ceil(wordsLeft / (150 * speed)));
        
        this.updateTTSPositionInfo(index, totalParagraphs, estimatedMinutes);
        
        await this.kokoroTTS.startFromParagraph(index, this.paragraphs);
    }
    
    stopKokoroTTS() {
        this.kokoroTTS.stop();
        
        const bar = document.getElementById('tts-playback-bar');
        bar?.classList.remove('visible');
        bar?.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('tts-active');
        
        document.querySelectorAll('.paragraph-text.reading').forEach(el => {
            el.classList.remove('reading');
        });
        document.querySelectorAll('.sentence-highlight').forEach(el => {
            el.outerHTML = el.innerHTML;
        });
    }
    
    async initFirebase() {
        if (!this.firebase.isConfigured()) {
            console.log('Firebase not configured, cloud sync disabled');
            return;
        }
        
        document.getElementById('cloud-section').style.display = '';
        
        const initialized = await this.firebase.init();
        if (!initialized) return;
        
        this.firebase.onAuthChange(async (user) => {
            this.updateCloudUI(user);
            if (user && !this.isLocked) {
                await this.syncPinWithCloud();
                this.mergeLibraries();
            }
        });
        
        this.firebase.onSyncStatus((status, lastSyncTime) => {
            this.updateSyncStatusUI(status, lastSyncTime);
        });
        
        this.firebase.onSyncProgress((current, total, action) => {
            this.updateSyncProgressUI(current, total, action);
        });
        
        this.firebase.onSyncError((error) => {
            this.updateSyncErrorUI(error);
        });
        
        this.bindCloudEvents();
    }
    
    updateCloudUI(user) {
        const signedOut = document.getElementById('cloud-signed-out');
        const signedIn = document.getElementById('cloud-signed-in');
        const userEmail = document.getElementById('user-email');
        const userName = document.getElementById('user-name');
        const avatar = document.getElementById('cloud-avatar');
        const deleteCloudBtn = document.getElementById('delete-cloud-btn');
        
        if (user) {
            signedOut.style.display = 'none';
            signedIn.style.display = '';
            userEmail.textContent = user.email || 'Signed in';
            if (userName) {
                userName.textContent = user.displayName || '';
            }
            
            if (avatar && user.photoURL) {
                avatar.innerHTML = `<img src="${user.photoURL}" alt="Avatar">`;
            }
            
            if (deleteCloudBtn) deleteCloudBtn.style.display = '';
        } else {
            signedOut.style.display = '';
            signedIn.style.display = 'none';
            if (deleteCloudBtn) deleteCloudBtn.style.display = 'none';
        }
    }
    
    updateSyncStatusUI(status, lastSyncTime) {
        const statusText = document.getElementById('sync-status-text');
        const dot = statusText?.querySelector('.sync-dot');
        const text = statusText?.querySelector('span:last-child');
        const lastTimeEl = document.getElementById('sync-last-time');
        const progressRow = document.getElementById('sync-progress-row');
        const errorRow = document.getElementById('sync-error-row');
        
        if (dot) {
            dot.setAttribute('data-status', status);
        }
        
        if (text) {
            switch (status) {
                case 'syncing':
                    text.textContent = 'Syncing...';
                    break;
                case 'error':
                    text.textContent = 'Sync error';
                    break;
                default:
                    text.textContent = 'Synced';
            }
        }
        
        if (lastTimeEl && lastSyncTime) {
            lastTimeEl.textContent = this.formatLastSyncTime(lastSyncTime);
        }
        
        if (status === 'idle' && progressRow) {
            progressRow.style.display = 'none';
        }
        
        if (status !== 'error' && errorRow) {
            errorRow.style.display = 'none';
        }
    }
    
    updateSyncProgressUI(current, total, action) {
        const progressRow = document.getElementById('sync-progress-row');
        const progressFill = document.getElementById('sync-progress-fill');
        const progressText = document.getElementById('sync-progress-text');
        
        if (progressRow) {
            progressRow.style.display = '';
        }
        
        if (progressFill) {
            progressFill.style.width = `${(current / total) * 100}%`;
        }
        
        if (progressText) {
            progressText.textContent = action;
        }
    }
    
    updateSyncErrorUI(error) {
        const errorRow = document.getElementById('sync-error-row');
        const errorText = document.getElementById('sync-error-text');
        
        if (errorRow && error) {
            errorRow.style.display = '';
        }
        
        if (errorText) {
            errorText.textContent = error;
        }
    }
    
    formatLastSyncTime(timestamp) {
        if (!timestamp) return 'Never';
        
        const now = Date.now();
        const diff = now - timestamp;
        
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} hr ago`;
        
        const date = new Date(timestamp);
        return date.toLocaleDateString();
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
        
        document.getElementById('confirm-rename-btn')?.addEventListener('click', () => {
            const newTitle = document.getElementById('rename-input').value;
            this.renameBook(newTitle);
        });
        
        document.getElementById('cancel-rename-btn')?.addEventListener('click', () => {
            this.hideRenameModal();
        });
        
        document.getElementById('rename-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const newTitle = document.getElementById('rename-input').value;
                this.renameBook(newTitle);
            } else if (e.key === 'Escape') {
                this.hideRenameModal();
            }
        });
        
        document.getElementById('highlights-toggle')?.addEventListener('click', () => {
            this.toggleHighlights();
        });
        
        document.getElementById('toc-toggle')?.addEventListener('click', () => {
            this.toggleTOC();
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
        
        setTimeout(() => {
            document.getElementById('signin-email')?.focus();
        }, 100);
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
    
    showRenameModal(book) {
        this.renameBookTarget = book;
        const modal = document.getElementById('rename-modal');
        const input = document.getElementById('rename-input');
        
        input.value = book.title;
        
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        
        setTimeout(() => {
            input.focus();
            input.select();
        }, 100);
    }
    
    hideRenameModal() {
        const modal = document.getElementById('rename-modal');
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
        this.renameBookTarget = null;
    }
    
    async renameBook(newTitle) {
        if (!this.renameBookTarget || !newTitle.trim()) return;
        
        const book = await this.storage.getBook(this.renameBookTarget.id);
        if (!book) {
            this.hideRenameModal();
            return;
        }
        
        book.title = newTitle.trim();
        book.updatedAt = Date.now();
        await this.storage.updateBook(book);
        
        if (this.firebase.isSignedIn() && book.isCloud) {
            await this.firebase.updateBookTitle(book.id, book.title);
        }
        
        if (this.currentBook && this.currentBook.id === book.id) {
            this.currentBook.title = book.title;
            document.getElementById('current-book-title').textContent = book.title;
        }
        
        this.hideRenameModal();
        this.loadLibrary({ skipAutoOpen: true });
    }
    
    async syncPinWithCloud() {
        if (!this.firebase.isSignedIn()) return;
        
        const localPin = this.pin.getPinData();
        
        if (localPin) {
            const result = await this.firebase.syncPin(
                localPin.hash,
                localPin.salt,
                localPin.updatedAt
            );
            
            if (result?.fromCloud && result.hash !== localPin.hash) {
                this.pin.setPinData(result.hash, result.salt, result.updatedAt || Date.now());
            }
        } else {
            const cloudPin = await this.firebase.getPinFromCloud();
            if (cloudPin && cloudPin.hash && cloudPin.salt) {
                this.pin.setPinData(cloudPin.hash, cloudPin.salt, cloudPin.updatedAt || Date.now());
            }
        }
    }
    
    toggleHighlights() {
        if (this.highlighter) {
            this.highlighter.togglePanel();
        }
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
                const fullBook = await this.firebase.downloadBook(cloudBook.id, cloudBook.title);
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
        document.getElementById('reload-btn').addEventListener('click', () => this.reloadApp());
        
        document.getElementById('back-to-library').addEventListener('click', () => this.showView('library'));
        
        document.getElementById('bionic-toggle').addEventListener('click', () => this.toggleBionic());
        document.getElementById('rsvp-toggle').addEventListener('click', () => this.toggleRSVP());
        document.getElementById('tts-toggle').addEventListener('click', () => this.toggleTTS());
        
        document.getElementById('font-decrease').addEventListener('click', () => this.changeFontSize(-2));
        document.getElementById('font-increase').addEventListener('click', () => this.changeFontSize(2));
        
        document.getElementById('search-btn').addEventListener('click', () => this.toggleSearch());
        document.getElementById('close-search').addEventListener('click', () => this.toggleSearch(false));
        document.getElementById('search-input').addEventListener('input', (e) => this.handleSearch(e.target.value));
        
        document.getElementById('reader-content').addEventListener('click', (e) => {
            const searchPanel = document.getElementById('search-panel');
            if (searchPanel.classList.contains('open') && !e.target.closest('#search-panel')) {
                this.toggleSearch(false);
            }
        });
        
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
        this.stopKokoroTTS();
        if (this.rsvp) this.rsvp.stop();
        this.saveReadingPosition();
        this.showPinScreen('unlock');
    }
    
    async reloadApp() {
        const reloadBtn = document.getElementById('reload-btn');
        reloadBtn.disabled = true;
        reloadBtn.style.opacity = '0.5';
        
        try {
            if ('serviceWorker' in navigator) {
                const registration = await navigator.serviceWorker.getRegistration();
                if (registration?.waiting) {
                    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
            
            if ('caches' in window) {
                const cacheNames = await caches.keys();
                const appCaches = cacheNames.filter(name => 
                    name.startsWith('focusread-v') && 
                    !name.includes('kokoro-model')
                );
                
                for (const cacheName of appCaches) {
                    await caches.delete(cacheName);
                }
            }
            
            location.reload();
            
        } catch (error) {
            console.error('Reload error:', error);
            location.reload();
        }
    }
    
    async loadLibrary(options = {}) {
        const { skipAutoOpen = false } = options;
        
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
        
        if (skipAutoOpen) return;
        
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
        
        const progress = book.progressPercent !== undefined 
            ? book.progressPercent 
            : (book.position && book.wordCount ? Math.round((book.position / book.wordCount) * 100) : 0);
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
                <button class="book-menu-item" role="menuitem" data-action="rename">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                    Rename book
                </button>
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
        
        const renameBtn = card.querySelector('[data-action="rename"]');
        this.bindTapEvent(renameBtn, async (e) => {
            e.stopPropagation();
            menu.classList.remove('open');
            this.showRenameModal(book);
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
        this.structure = book.structure || [];
        this.words = book.paragraphs.flatMap(p => p.split(/\s+/).filter(w => w));
        this.readingPosition = book.position || 0;
        this.readingPercent = book.progressPercent || 0;
        
        document.getElementById('current-book-title').textContent = book.title;
        
        this.renderText();
        this.showView('reader');
        this.updateReadingProgress();
        
        await this.storage.setLastOpenedBook(book.id);
        
        this.scrollToPosition();
        
        if (book.toc && book.toc.length > 0) {
            this.renderTOC(book.toc);
        }
        
        if (this.highlighter) {
            await this.highlighter.loadHighlights(book.id);
        }
    }
    
    renderText() {
        const container = document.getElementById('text-container');
        const bionicEnabled = this.settings.get('bionicEnabled');
        const strength = this.settings.get('bionicStrength');
        
        container.innerHTML = '';
        
        this.paragraphs.forEach((paragraph, index) => {
            const structureInfo = this.structure?.[index] || {};
            
            const wrapper = document.createElement('div');
            wrapper.className = 'paragraph-wrapper';
            wrapper.setAttribute('data-paragraph', index);
            
            if (structureInfo.type === 'heading') {
                const level = structureInfo.headingLevel || 1;
                wrapper.classList.add(`heading-${level}`);
            } else if (structureInfo.type === 'list') {
                wrapper.classList.add('list-item');
            } else if (structureInfo.type === 'blockquote') {
                wrapper.classList.add('block-quote');
            }
            
            const speakerBtn = document.createElement('button');
            speakerBtn.className = 'paragraph-speaker';
            speakerBtn.setAttribute('aria-label', `Read paragraph ${index + 1} aloud`);
            speakerBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                </svg>
            `;
            
            this.bindTapEvent(speakerBtn, (e) => {
                e.stopPropagation();
                this.startKokoroTTSFromParagraph(index);
            });
            
            const p = document.createElement('div');
            p.className = 'paragraph-text';
            
            if (structureInfo.isBold) p.classList.add('text-bold');
            if (structureInfo.isItalic) p.classList.add('text-italic');
            
            if (bionicEnabled) {
                p.innerHTML = this.bionic.process(paragraph, strength);
            } else {
                p.textContent = paragraph;
            }
            
            wrapper.appendChild(speakerBtn);
            wrapper.appendChild(p);
            container.appendChild(wrapper);
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
        
        const wrapper = document.querySelector(`[data-paragraph="${targetParagraph}"]`);
        if (wrapper) {
            wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
    
    updateReadingProgress() {
        const content = document.getElementById('reader-content');
        const container = document.getElementById('text-container');
        
        if (!container.firstElementChild) return;
        
        const scrollTop = content.scrollTop;
        const scrollHeight = container.scrollHeight;
        const clientHeight = content.clientHeight;
        
        const scrollPercent = Math.min(100, Math.round((scrollTop / Math.max(1, scrollHeight - clientHeight)) * 100)) || 0;
        
        document.getElementById('reading-progress').style.width = `${scrollPercent}%`;
        document.getElementById('progress-percent').textContent = `${scrollPercent}%`;
        
        const progressBar = document.querySelector('.progress-container');
        progressBar.setAttribute('aria-valuenow', scrollPercent);
        
        const wordsRead = Math.round((scrollPercent / 100) * this.words.length);
        const wordsLeft = this.words.length - wordsRead;
        
        const ttsSpeed = this.kokoroTTS?.speed || 1;
        const baseWpm = this.kokoroTTS?.isPlaying ? 150 * ttsSpeed : 200;
        const minutesLeft = Math.ceil(wordsLeft / baseWpm);
        
        const timeLeftEl = document.getElementById('time-left');
        if (this.kokoroTTS?.isPlaying) {
            timeLeftEl.textContent = `~${minutesLeft} min left (listening)`;
        } else {
            timeLeftEl.textContent = `${minutesLeft} min left`;
        }
        
        this.readingPosition = wordsRead;
        this.readingPercent = scrollPercent;
    }
    
    async saveReadingPosition() {
        if (!this.currentBook) return;
        
        this.currentBook.position = this.readingPosition;
        this.currentBook.progressPercent = this.readingPercent || 0;
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
    
    toggleSearch(show) {
        const panel = document.getElementById('search-panel');
        const isOpen = show !== undefined ? show : !panel.classList.contains('open');
        
        if (isOpen) {
            panel.classList.add('open');
            panel.setAttribute('aria-hidden', 'false');
            document.getElementById('search-input').focus();
        } else {
            panel.classList.remove('open');
            panel.setAttribute('aria-hidden', 'true');
            document.getElementById('search-input').value = '';
            document.getElementById('search-results').innerHTML = '';
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
        const wrapper = document.querySelector(`[data-paragraph="${index}"]`);
        const textEl = wrapper?.querySelector('.paragraph-text');
        if (wrapper && textEl) {
            wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
            textEl.style.background = 'var(--warning)';
            setTimeout(() => textEl.style.background = '', 2000);
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
        this.toggleSearch(false);
        this.toggleTOC(false);
        
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
            this.stopKokoroTTS();
            
            const bookToSave = this.currentBook;
            this.currentBook = null;
            
            (async () => {
                try {
                    if (bookToSave) {
                        bookToSave.position = this.readingPosition;
                        bookToSave.progressPercent = this.readingPercent || 0;
                        bookToSave.updatedAt = Date.now();
                        await this.storage.updateBook(bookToSave);
                    }
                } catch (e) {
                    console.error('Error saving position:', e);
                }
                try {
                    await this.loadLibrary({ skipAutoOpen: true });
                } catch (e) {
                    console.error('Error loading library:', e);
                }
            })();
        }
        
        if (view === 'rsvp') {
            this.stopKokoroTTS();
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
                structure: result.structure || [],
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
            this.hideSignInModal();
            this.hideDeleteModal();
            
            if (this.rsvp && this.rsvp.isActive) {
                this.rsvp.stop();
                this.showView('reader');
            }
        }
        
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        
        const signinModal = document.getElementById('signin-modal');
        const deleteModal = document.getElementById('delete-modal');
        if (signinModal?.classList.contains('open') || deleteModal?.classList.contains('open')) return;
        
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

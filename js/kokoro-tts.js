/**
 * Kokoro TTS Module v7
 * High-quality text-to-speech using Kokoro-82M model via Web Worker
 * Shows download consent before model download
 * Falls back to Web Speech API immediately until model ready
 */

const KOKORO_VOICES = [
    { id: 'af_heart', name: 'Heart (Female)', gender: 'female' },
    { id: 'af_bella', name: 'Bella (Female)', gender: 'female' },
    { id: 'af_sarah', name: 'Sarah (Female)', gender: 'female' },
    { id: 'af_nicole', name: 'Nicole (Female)', gender: 'female' },
    { id: 'am_adam', name: 'Adam (Male)', gender: 'male' },
    { id: 'am_michael', name: 'Michael (Male)', gender: 'male' },
    { id: 'bf_emma', name: 'Emma (British)', gender: 'female' },
    { id: 'bm_george', name: 'George (British)', gender: 'male' },
];

const MODEL_INFO = {
    standard: { sizeMB: 95, name: 'Standard (95 MB)' },
    high: { sizeMB: 170, name: 'High Quality (170 MB)' }
};

const DEFAULT_VOICE = 'af_heart';
const SENTENCE_BUFFER_SIZE = 2;
const LOAD_TIMEOUT_MS = 60000;
const STORAGE_KEY_CHOICE = 'focusread_tts_choice';
const STORAGE_KEY_MODEL = 'focusread_tts_model';

export class KokoroTTS {
    constructor() {
        this.worker = null;
        this.isModelLoaded = false;
        this.isModelCached = false;
        this.isLoading = false;
        this.loadProgress = 0;
        this.loadedMB = 0;
        this.useSystemVoices = false;
        this.forceSystemVoices = false;
        this.userChoice = null;
        this.preferredModel = 'standard';
        this.backend = 'wasm';
        this.fallbackReason = null;
        
        this.currentVoice = DEFAULT_VOICE;
        this.savedSystemVoice = null;
        this.speed = 1.0;
        this.volume = 1.0;
        
        this.isPlaying = false;
        this.isPaused = false;
        this.currentParagraphIndex = 0;
        this.currentSentenceIndex = 0;
        this.sentences = [];
        this.paragraphs = [];
        this.paragraphSentenceMap = [];
        
        this.audioContext = null;
        this.currentSource = null;
        this.audioQueue = [];
        this.pendingGenerations = new Map();
        this.generationId = 0;
        this.startTime = 0;
        this.pauseTime = 0;
        this.totalDuration = 0;
        this.currentDuration = 0;
        
        this.onProgress = null;
        this.onParagraphChange = null;
        this.onSentenceChange = null;
        this.onPlayStateChange = null;
        this.onTimeUpdate = null;
        this.onLoadProgress = null;
        this.onEngineChange = null;
        this.onNeedConsent = null;
        
        this.webSpeechUtterance = null;
        this.webSpeechSynth = window.speechSynthesis;
        this.webSpeechVoicesLoaded = false;
        this.webSpeechStartTime = 0;
        this.webSpeechEstimatedDuration = 0;
        this.noVoicesAvailable = false;
        this.currentSystemVoiceName = null;
        
        this.loadTimeoutId = null;
        this.lastProgressTime = 0;
        
        this.loadUserChoice();
        this.initWebSpeechVoices();
    }
    
    initWebSpeechVoices() {
        const loadVoices = () => {
            const voices = this.webSpeechSynth.getVoices();
            this.webSpeechVoicesLoaded = voices.length > 0;
            this.noVoicesAvailable = voices.length === 0;
        };
        
        loadVoices();
        
        if (this.webSpeechSynth.onvoiceschanged !== undefined) {
            this.webSpeechSynth.onvoiceschanged = loadVoices;
        }
        
        setTimeout(loadVoices, 100);
        setTimeout(loadVoices, 500);
    }
    
    loadUserChoice() {
        try {
            this.userChoice = localStorage.getItem(STORAGE_KEY_CHOICE);
            this.preferredModel = localStorage.getItem(STORAGE_KEY_MODEL) || 'standard';
        } catch (e) {
            console.log('Could not load TTS preference');
        }
    }
    
    saveUserChoice(choice, model = 'standard') {
        this.userChoice = choice;
        this.preferredModel = model;
        try {
            localStorage.setItem(STORAGE_KEY_CHOICE, choice);
            localStorage.setItem(STORAGE_KEY_MODEL, model);
        } catch (e) {
            console.log('Could not save TTS preference');
        }
    }
    
    getModelInfo() {
        return {
            isLoaded: this.isModelLoaded,
            isCached: this.isModelCached,
            isLoading: this.isLoading,
            backend: this.backend,
            engine: this.useSystemVoices ? 'system' : 'kokoro',
            fallbackReason: this.fallbackReason,
            modelSizeMB: MODEL_INFO[this.preferredModel]?.sizeMB || 95,
            preferredModel: this.preferredModel,
            userChoice: this.userChoice
        };
    }
    
    getVoices() {
        if (this.useSystemVoices || this.forceSystemVoices) {
            return this.webSpeechSynth.getVoices()
                .filter(v => v.lang.startsWith('en'))
                .map(v => ({ id: v.name, name: v.name, native: v }));
        }
        return KOKORO_VOICES;
    }
    
    getEngine() {
        return this.useSystemVoices ? 'system' : 'kokoro';
    }
    
    setForceSystemVoices(force) {
        this.forceSystemVoices = force;
        if (force) {
            this.useSystemVoices = true;
            this.saveUserChoice('system');
        }
        this.onEngineChange?.(this.getEngine());
    }
    
    needsConsent() {
        return !this.userChoice && !this.isModelLoaded && !this.isModelCached;
    }
    
    async checkModelCached() {
        if (!('caches' in window)) return { cached: false, size: 0 };
        
        try {
            const cacheNames = await caches.keys();
            const modelCaches = cacheNames.filter(name => 
                name.includes('transformers') || name.includes('onnx')
            );
            
            let totalSize = 0;
            for (const cacheName of modelCaches) {
                const cache = await caches.open(cacheName);
                const keys = await cache.keys();
                for (const request of keys) {
                    const response = await cache.match(request);
                    if (response) {
                        const blob = await response.clone().blob();
                        totalSize += blob.size;
                    }
                }
            }
            
            const cached = totalSize > 10 * 1024 * 1024;
            this.isModelCached = cached;
            
            if (cached && !this.userChoice) {
                this.userChoice = 'kokoro';
            }
            
            return {
                cached,
                size: totalSize,
                sizeMB: Math.round(totalSize / (1024 * 1024))
            };
        } catch (e) {
            console.error('Error checking model cache:', e);
            return { cached: false, size: 0 };
        }
    }
    
    initWorker() {
        if (this.worker) return;
        
        const workerUrl = new URL('./kokoro-worker.js', import.meta.url);
        this.worker = new Worker(workerUrl, { type: 'module' });
        
        this.worker.onmessage = (event) => {
            const { type, percent, message, loadedMB, totalMB, backend, error, id, wav, modelType } = event.data;
            
            switch (type) {
                case 'progress':
                    this.loadProgress = percent;
                    this.loadedMB = loadedMB || 0;
                    this.lastProgressTime = Date.now();
                    this.onLoadProgress?.(percent, message, loadedMB, totalMB);
                    break;
                    
                case 'loaded':
                    this.isModelLoaded = true;
                    this.isModelCached = true;
                    this.isLoading = false;
                    this.useSystemVoices = false;
                    this.backend = backend || 'wasm';
                    this.fallbackReason = null;
                    this.clearLoadTimeout();
                    
                    const sizeMB = MODEL_INFO[this.preferredModel]?.sizeMB || 95;
                    this.onLoadProgress?.(100, 'Ready', sizeMB, sizeMB);
                    this.onEngineChange?.('kokoro');
                    
                    if (this.isPlaying && !this.isPaused) {
                        this.switchToKokoro();
                    }
                    break;
                    
                case 'error':
                    this.handleLoadError(error);
                    break;
                    
                case 'audio':
                    this.handleGeneratedAudio(id, wav);
                    break;
                    
                case 'generate_error':
                    this.handleGenerationError(id, error);
                    break;
            }
        };
        
        this.worker.onerror = (error) => {
            this.handleLoadError(error.message || 'Worker error');
        };
    }
    
    handleLoadError(error) {
        console.error('Kokoro load error:', error);
        this.isLoading = false;
        this.clearLoadTimeout();
        this.fallbackReason = `Model failed to load: ${error}. Using device voice.`;
        this.onEngineChange?.('system');
        this.onLoadProgress?.(100, 'Using device voice', 0, 0);
    }
    
    handleGeneratedAudio(id, wavBuffer) {
        const pending = this.pendingGenerations.get(id);
        if (!pending) return;
        
        this.pendingGenerations.delete(id);
        
        this.audioContext.decodeAudioData(wavBuffer)
            .then((audioBuffer) => {
                if (this.isPlaying && !this.useSystemVoices) {
                    this.audioQueue.push({
                        buffer: audioBuffer,
                        sentenceIndex: pending.sentenceIndex,
                        duration: audioBuffer.duration
                    });
                    
                    if (!this.currentSource) {
                        this.playNextInQueue();
                    }
                    
                    this.generateNext();
                }
            })
            .catch((err) => {
                console.error('Decode error:', err);
                this.generateNext();
            });
    }
    
    handleGenerationError(id, error) {
        console.error('Generation error:', error);
        const pending = this.pendingGenerations.get(id);
        if (pending) {
            this.pendingGenerations.delete(id);
            this.generateNext();
        }
    }
    
    clearLoadTimeout() {
        if (this.loadTimeoutId) {
            clearTimeout(this.loadTimeoutId);
            this.loadTimeoutId = null;
        }
    }
    
    startLoadTimeout() {
        this.clearLoadTimeout();
        this.lastProgressTime = Date.now();
        
        const checkProgress = () => {
            const elapsed = Date.now() - this.lastProgressTime;
            
            if (elapsed > LOAD_TIMEOUT_MS && this.isLoading) {
                this.handleLoadError('Download stalled - no progress for 60 seconds');
                return;
            }
            
            if (this.isLoading) {
                this.loadTimeoutId = setTimeout(checkProgress, 5000);
            }
        };
        
        this.loadTimeoutId = setTimeout(checkProgress, 5000);
    }
    
    async loadModel() {
        if (this.isModelLoaded) return true;
        if (this.isLoading) return false;
        
        this.isLoading = true;
        const sizeMB = MODEL_INFO[this.preferredModel]?.sizeMB || 95;
        this.onLoadProgress?.(0, 'Preparing...', 0, sizeMB);
        
        try {
            const cacheInfo = await this.checkModelCached();
            if (cacheInfo.cached && cacheInfo.sizeMB > 150) {
                this.onLoadProgress?.(0, 'Clearing old model...', 0, sizeMB);
                await this.deleteModelCache();
                this.isLoading = true;
            }
            
            this.initWorker();
            this.startLoadTimeout();
            
            this.worker.postMessage({ 
                type: 'load', 
                voice: this.currentVoice,
                modelType: this.preferredModel
            });
            
            return true;
            
        } catch (error) {
            this.handleLoadError(error.message);
            return false;
        }
    }
    
    async deleteModelCache() {
        if (!('caches' in window)) return false;
        
        try {
            const cacheNames = await caches.keys();
            const modelCaches = cacheNames.filter(name => 
                name.includes('transformers') || name.includes('onnx')
            );
            
            for (const cacheName of modelCaches) {
                await caches.delete(cacheName);
            }
            
            this.isModelLoaded = false;
            this.isModelCached = false;
            this.userChoice = null;
            
            try {
                localStorage.removeItem(STORAGE_KEY_CHOICE);
            } catch (e) {}
            
            if (this.worker) {
                this.worker.terminate();
                this.worker = null;
            }
            
            return true;
        } catch (e) {
            console.error('Error deleting model cache:', e);
            return false;
        }
    }
    
    splitIntoSentences(text) {
        const sentences = text.match(/[^.!?]+[.!?]+[\s"'""''\)\]]*|[^.!?]+$/g) || [text];
        return sentences.map(s => s.trim()).filter(s => s.length > 0);
    }
    
    prepareParagraphs(paragraphs) {
        this.paragraphs = paragraphs;
        this.sentences = [];
        this.paragraphSentenceMap = [];
        
        let sentenceIndex = 0;
        paragraphs.forEach((para, paraIndex) => {
            const paraSentences = this.splitIntoSentences(para);
            const startIndex = sentenceIndex;
            
            paraSentences.forEach(sentence => {
                this.sentences.push({
                    text: sentence,
                    paragraphIndex: paraIndex,
                    index: sentenceIndex
                });
                sentenceIndex++;
            });
            
            this.paragraphSentenceMap.push({
                start: startIndex,
                end: sentenceIndex - 1,
                count: paraSentences.length
            });
        });
    }
    
    getEstimatedTime(fromParagraph = 0) {
        if (this.paragraphs.length === 0) return 0;
        
        let totalWords = 0;
        for (let i = fromParagraph; i < this.paragraphs.length; i++) {
            totalWords += this.paragraphs[i].split(/\s+/).filter(w => w).length;
        }
        
        const wpm = 150 * (this.speed || 1);
        return Math.max(1, Math.ceil(totalWords / wpm));
    }
    
    async startFromParagraph(paragraphIndex, paragraphs) {
        this.stop();
        this.prepareParagraphs(paragraphs);
        
        if (paragraphIndex >= this.paragraphSentenceMap.length) return;
        
        const mapping = this.paragraphSentenceMap[paragraphIndex];
        this.currentParagraphIndex = paragraphIndex;
        this.currentSentenceIndex = mapping.start;
        
        this.isPlaying = true;
        this.isPaused = false;
        this.onPlayStateChange?.(true);
        this.onParagraphChange?.(paragraphIndex, this.paragraphs.length, this.getEstimatedTime(paragraphIndex));
        
        const cacheInfo = await this.checkModelCached();
        
        if (this.isModelLoaded) {
            this.useSystemVoices = false;
            this.initAudioContext();
            this.generateAndPlay();
        } else if (cacheInfo.cached && this.userChoice === 'kokoro') {
            this.useSystemVoices = true;
            this.playWithWebSpeech();
            this.loadModel();
        } else if (this.userChoice === 'kokoro') {
            this.useSystemVoices = true;
            this.playWithWebSpeech();
            this.loadModel();
        } else if (this.userChoice === 'system') {
            this.useSystemVoices = true;
            this.playWithWebSpeech();
        } else {
            this.useSystemVoices = true;
            this.playWithWebSpeech();
            
            const sizeMB = MODEL_INFO[this.preferredModel]?.sizeMB || 95;
            this.onNeedConsent?.({
                sizeMB,
                modelName: MODEL_INFO[this.preferredModel]?.name || 'Standard',
                onDownload: (model = 'standard') => {
                    this.saveUserChoice('kokoro', model);
                    this.preferredModel = model;
                    this.loadModel();
                },
                onUseSystem: () => {
                    this.saveUserChoice('system');
                    this.useSystemVoices = true;
                    this.onEngineChange?.('system');
                }
            });
        }
    }
    
    switchToKokoro() {
        if (!this.isModelLoaded || !this.isPlaying) return;
        
        this.webSpeechSynth.cancel();
        this.useSystemVoices = false;
        
        this.initAudioContext();
        this.generateAndPlay();
        
        this.onEngineChange?.('kokoro');
    }
    
    initAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }
    
    generateAndPlay() {
        if (!this.isPlaying || this.isPaused || this.useSystemVoices) return;
        this.generateNext();
    }
    
    generateNext() {
        if (!this.isPlaying || this.isPaused || this.useSystemVoices) return;
        if (!this.worker || !this.isModelLoaded) return;
        
        while (this.pendingGenerations.size < SENTENCE_BUFFER_SIZE && 
               this.audioQueue.length + this.pendingGenerations.size < SENTENCE_BUFFER_SIZE * 2) {
            
            let nextIndex = this.currentSentenceIndex;
            for (const pending of this.pendingGenerations.values()) {
                if (pending.sentenceIndex >= nextIndex) {
                    nextIndex = pending.sentenceIndex + 1;
                }
            }
            for (const queued of this.audioQueue) {
                if (queued.sentenceIndex >= nextIndex) {
                    nextIndex = queued.sentenceIndex + 1;
                }
            }
            
            if (nextIndex >= this.sentences.length) break;
            
            const sentence = this.sentences[nextIndex];
            const id = ++this.generationId;
            
            this.pendingGenerations.set(id, {
                sentenceIndex: nextIndex,
                text: sentence.text
            });
            
            this.worker.postMessage({
                type: 'generate',
                text: sentence.text,
                voice: this.currentVoice,
                id
            });
        }
    }
    
    playNextInQueue() {
        if (!this.isPlaying || this.isPaused || this.audioQueue.length === 0 || this.useSystemVoices) return;
        
        const item = this.audioQueue.shift();
        const sentence = this.sentences[item.sentenceIndex];
        
        this.currentSentenceIndex = item.sentenceIndex;
        this.currentDuration = item.duration;
        this.startTime = this.audioContext.currentTime;
        
        if (sentence.paragraphIndex !== this.currentParagraphIndex) {
            this.currentParagraphIndex = sentence.paragraphIndex;
            this.onParagraphChange?.(this.currentParagraphIndex, this.paragraphs.length, this.getEstimatedTime(this.currentParagraphIndex));
        }
        this.onSentenceChange?.(item.sentenceIndex, sentence.text);
        
        this.currentSource = this.audioContext.createBufferSource();
        this.currentSource.buffer = item.buffer;
        this.currentSource.playbackRate.value = this.speed;
        this.currentSource.connect(this.audioContext.destination);
        
        this.currentSource.onended = () => {
            this.currentSource = null;
            
            if (this.isPlaying && !this.isPaused && !this.useSystemVoices) {
                if (this.currentSentenceIndex < this.sentences.length - 1) {
                    this.playNextInQueue();
                    this.generateNext();
                } else if (this.audioQueue.length === 0 && this.pendingGenerations.size === 0) {
                    this.stop();
                }
            }
        };
        
        this.currentSource.start();
        this.updateTime();
    }
    
    updateTime() {
        if (!this.isPlaying || this.isPaused || !this.audioContext || this.useSystemVoices) return;
        
        const elapsed = (this.audioContext.currentTime - this.startTime) * this.speed;
        this.onTimeUpdate?.(elapsed, this.currentDuration);
        
        if (this.isPlaying && !this.isPaused && !this.useSystemVoices) {
            requestAnimationFrame(() => this.updateTime());
        }
    }
    
    playWithWebSpeech() {
        if (!this.isPlaying || this.isPaused) return;
        
        const voices = this.webSpeechSynth.getVoices();
        
        if (voices.length === 0) {
            this.noVoicesAvailable = true;
            this.onEngineChange?.('no-voices');
            this.updateWebSpeechTime();
            return;
        }
        
        const sentence = this.sentences[this.currentSentenceIndex];
        if (!sentence) {
            this.stop();
            return;
        }
        
        if (sentence.paragraphIndex !== this.currentParagraphIndex) {
            this.currentParagraphIndex = sentence.paragraphIndex;
            this.onParagraphChange?.(this.currentParagraphIndex, this.paragraphs.length, this.getEstimatedTime(this.currentParagraphIndex));
        }
        this.onSentenceChange?.(this.currentSentenceIndex, sentence.text);
        
        const wordCount = sentence.text.split(/\s+/).filter(w => w).length;
        const wpm = 150 * this.speed;
        this.webSpeechEstimatedDuration = (wordCount / wpm) * 60;
        this.webSpeechStartTime = Date.now();
        
        this.webSpeechUtterance = new SpeechSynthesisUtterance(sentence.text);
        this.webSpeechUtterance.rate = this.speed;
        this.webSpeechUtterance.volume = this.volume;
        
        const englishVoices = voices.filter(v => v.lang.startsWith('en'));
        let selectedVoice = englishVoices.find(v => v.name === this.currentVoice) 
            || englishVoices.find(v => v.name === this.savedSystemVoice)
            || englishVoices.find(v => v.lang === 'en-US')
            || englishVoices.find(v => v.lang.startsWith('en'))
            || englishVoices[0]
            || voices.find(v => v.lang.startsWith('en'))
            || voices[0];
        
        if (selectedVoice) {
            this.webSpeechUtterance.voice = selectedVoice;
            this.currentSystemVoiceName = selectedVoice.name;
            this.savedSystemVoice = selectedVoice.name;
        }
        
        this.updateWebSpeechTime();
        
        this.webSpeechUtterance.onstart = () => {
            this.webSpeechStartTime = Date.now();
            this.updateWebSpeechTime();
        };
        
        this.webSpeechUtterance.onend = () => {
            if (this.isPlaying && !this.isPaused) {
                if (this.isModelLoaded && this.userChoice === 'kokoro') {
                    this.switchToKokoro();
                    return;
                }
                
                this.currentSentenceIndex++;
                if (this.currentSentenceIndex < this.sentences.length) {
                    this.playWithWebSpeech();
                } else {
                    this.stop();
                }
            }
        };
        
        this.webSpeechUtterance.onerror = (e) => {
            if (e.error !== 'interrupted' && e.error !== 'canceled') {
                console.error('Web Speech error:', e);
                this.currentSentenceIndex++;
                if (this.currentSentenceIndex < this.sentences.length) {
                    setTimeout(() => this.playWithWebSpeech(), 100);
                } else {
                    this.stop();
                }
            }
        };
        
        this.webSpeechSynth.speak(this.webSpeechUtterance);
    }
    
    updateWebSpeechTime() {
        if (!this.isPlaying || !this.useSystemVoices) return;
        
        const elapsed = (Date.now() - this.webSpeechStartTime) / 1000;
        const duration = Math.max(this.webSpeechEstimatedDuration, 1);
        
        this.onTimeUpdate?.(Math.min(elapsed, duration), duration);
        
        if (this.isPlaying && !this.isPaused && this.useSystemVoices) {
            requestAnimationFrame(() => this.updateWebSpeechTime());
        }
    }
    
    play() {
        if (!this.isPaused) return;
        
        this.isPaused = false;
        this.isPlaying = true;
        this.onPlayStateChange?.(true);
        
        if (this.useSystemVoices) {
            this.webSpeechSynth.resume();
        } else {
            if (this.audioContext?.state === 'suspended') {
                this.audioContext.resume();
            }
            this.playNextInQueue();
            this.generateNext();
        }
    }
    
    pause() {
        if (!this.isPlaying) return;
        
        this.isPaused = true;
        this.onPlayStateChange?.(false);
        
        if (this.useSystemVoices) {
            this.webSpeechSynth.pause();
        } else {
            if (this.currentSource) {
                this.currentSource.stop();
                this.currentSource = null;
            }
            this.pauseTime = this.audioContext?.currentTime || 0;
        }
    }
    
    stop() {
        this.isPlaying = false;
        this.isPaused = false;
        this.audioQueue = [];
        this.pendingGenerations.clear();
        
        if (this.useSystemVoices) {
            this.webSpeechSynth.cancel();
        } else {
            if (this.currentSource) {
                this.currentSource.stop();
                this.currentSource = null;
            }
        }
        
        this.onPlayStateChange?.(false);
    }
    
    nextParagraph() {
        if (this.currentParagraphIndex < this.paragraphs.length - 1) {
            const wasUsingSystem = this.useSystemVoices;
            this.stop();
            this.currentParagraphIndex++;
            
            const mapping = this.paragraphSentenceMap[this.currentParagraphIndex];
            this.currentSentenceIndex = mapping.start;
            
            this.isPlaying = true;
            this.isPaused = false;
            this.useSystemVoices = wasUsingSystem || !this.isModelLoaded;
            this.onPlayStateChange?.(true);
            this.onParagraphChange?.(this.currentParagraphIndex, this.paragraphs.length, this.getEstimatedTime(this.currentParagraphIndex));
            
            if (this.useSystemVoices) {
                this.playWithWebSpeech();
            } else {
                this.generateAndPlay();
            }
        }
    }
    
    previousParagraph() {
        if (this.currentParagraphIndex > 0) {
            const wasUsingSystem = this.useSystemVoices;
            this.stop();
            this.currentParagraphIndex--;
            
            const mapping = this.paragraphSentenceMap[this.currentParagraphIndex];
            this.currentSentenceIndex = mapping.start;
            
            this.isPlaying = true;
            this.isPaused = false;
            this.useSystemVoices = wasUsingSystem || !this.isModelLoaded;
            this.onPlayStateChange?.(true);
            this.onParagraphChange?.(this.currentParagraphIndex, this.paragraphs.length, this.getEstimatedTime(this.currentParagraphIndex));
            
            if (this.useSystemVoices) {
                this.playWithWebSpeech();
            } else {
                this.generateAndPlay();
            }
        }
    }
    
    setVoice(voiceId) {
        this.currentVoice = voiceId;
        if (this.useSystemVoices || this.forceSystemVoices) {
            this.savedSystemVoice = voiceId;
        }
    }
    
    setSpeed(speed) {
        this.speed = Math.max(0.5, Math.min(2, speed));
        
        if (this.currentSource) {
            this.currentSource.playbackRate.value = this.speed;
        }
        
        if (this.webSpeechUtterance && this.useSystemVoices) {
            this.webSpeechSynth.cancel();
            this.playWithWebSpeech();
        }
    }
    
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
    }
    
    getCurrentState() {
        return {
            isPlaying: this.isPlaying,
            isPaused: this.isPaused,
            currentParagraphIndex: this.currentParagraphIndex,
            currentSentenceIndex: this.currentSentenceIndex,
            totalParagraphs: this.paragraphs.length,
            engine: this.getEngine(),
            voice: this.currentVoice,
            speed: this.speed,
            isModelLoaded: this.isModelLoaded,
            isLoading: this.isLoading,
            loadProgress: this.loadProgress,
            userChoice: this.userChoice
        };
    }
}

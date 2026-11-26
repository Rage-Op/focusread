/**
 * Kokoro TTS Module
 * High-quality text-to-speech using Kokoro-82M model via Web Worker
 * Falls back to Web Speech API if model unavailable
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

const MODEL_CACHE_NAME = 'focusread-kokoro-model-v1';
const DEFAULT_VOICE = 'af_heart';
const SENTENCE_BUFFER_SIZE = 2;
const MODEL_SIZE_MB = 300;
const LOAD_TIMEOUT_MS = 60000;

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
        this.backend = 'wasm';
        this.fallbackReason = null;
        
        this.currentVoice = DEFAULT_VOICE;
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
        
        this.webSpeechUtterance = null;
        this.webSpeechSynth = window.speechSynthesis;
        
        this.loadTimeoutId = null;
        this.lastProgressTime = 0;
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
        }
        this.onEngineChange?.(this.getEngine());
    }
    
    async checkDeviceCapability() {
        if (this.forceSystemVoices) return false;
        
        const memory = navigator.deviceMemory;
        if (memory && memory < 4) {
            return false;
        }
        
        return true;
    }
    
    initWorker() {
        if (this.worker) return;
        
        const workerUrl = new URL('./kokoro-worker.js', import.meta.url);
        this.worker = new Worker(workerUrl, { type: 'module' });
        
        this.worker.onmessage = (event) => {
            const { type, percent, message, loadedMB, totalMB, backend, error, id, wav } = event.data;
            
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
                    this.onLoadProgress?.(100, 'Ready', MODEL_SIZE_MB, MODEL_SIZE_MB);
                    this.onEngineChange?.('kokoro');
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
                    
                case 'pong':
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
        this.useSystemVoices = true;
        this.fallbackReason = `Model failed to load: ${error}. Using system voices.`;
        this.onEngineChange?.('system');
        this.onLoadProgress?.(100, 'Using system voices (load failed)', 0, 0);
    }
    
    handleGeneratedAudio(id, wavBuffer) {
        const pending = this.pendingGenerations.get(id);
        if (!pending) return;
        
        this.pendingGenerations.delete(id);
        
        this.audioContext.decodeAudioData(wavBuffer)
            .then((audioBuffer) => {
                if (this.isPlaying) {
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
    
    async loadModel(onProgress) {
        if (this.isModelLoaded) return true;
        if (this.isLoading) return false;
        
        const canUseKokoro = await this.checkDeviceCapability();
        if (!canUseKokoro) {
            this.useSystemVoices = true;
            this.fallbackReason = 'Device does not meet requirements for Kokoro';
            this.onEngineChange?.('system');
            return true;
        }
        
        this.isLoading = true;
        this.onLoadProgress?.(0, 'Starting...', 0, MODEL_SIZE_MB);
        
        try {
            this.initWorker();
            this.startLoadTimeout();
            
            this.worker.postMessage({ type: 'load', voice: this.currentVoice });
            
            return new Promise((resolve) => {
                const checkLoaded = setInterval(() => {
                    if (this.isModelLoaded || this.useSystemVoices) {
                        clearInterval(checkLoaded);
                        resolve(true);
                    }
                }, 100);
                
                setTimeout(() => {
                    clearInterval(checkLoaded);
                    if (!this.isModelLoaded && !this.useSystemVoices) {
                        this.handleLoadError('Load timeout');
                    }
                    resolve(true);
                }, 180000);
            });
            
        } catch (error) {
            this.handleLoadError(error.message);
            return true;
        }
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
    
    getModelInfo() {
        return {
            isLoaded: this.isModelLoaded,
            isCached: this.isModelCached,
            isLoading: this.isLoading,
            backend: this.backend,
            engine: this.useSystemVoices ? 'system' : 'kokoro',
            fallbackReason: this.fallbackReason,
            modelSizeMB: MODEL_SIZE_MB
        };
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
    
    async startFromParagraph(paragraphIndex, paragraphs) {
        this.stop();
        this.prepareParagraphs(paragraphs);
        
        if (paragraphIndex >= this.paragraphSentenceMap.length) return;
        
        const mapping = this.paragraphSentenceMap[paragraphIndex];
        this.currentParagraphIndex = paragraphIndex;
        this.currentSentenceIndex = mapping.start;
        
        if (!this.isModelLoaded && !this.useSystemVoices) {
            const loaded = await this.loadModel();
            if (!loaded) return;
        }
        
        this.isPlaying = true;
        this.isPaused = false;
        this.onPlayStateChange?.(true);
        this.onParagraphChange?.(paragraphIndex, this.paragraphs.length);
        
        if (this.useSystemVoices) {
            this.playWithWebSpeech();
        } else {
            this.initAudioContext();
            this.generateAndPlay();
        }
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
        if (!this.isPlaying || this.isPaused) return;
        
        this.generateNext();
    }
    
    generateNext() {
        if (!this.isPlaying || this.isPaused) return;
        
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
        if (!this.isPlaying || this.isPaused || this.audioQueue.length === 0) return;
        
        const item = this.audioQueue.shift();
        const sentence = this.sentences[item.sentenceIndex];
        
        this.currentSentenceIndex = item.sentenceIndex;
        this.currentDuration = item.duration;
        this.startTime = this.audioContext.currentTime;
        
        if (sentence.paragraphIndex !== this.currentParagraphIndex) {
            this.currentParagraphIndex = sentence.paragraphIndex;
            this.onParagraphChange?.(this.currentParagraphIndex, this.paragraphs.length);
        }
        this.onSentenceChange?.(item.sentenceIndex, sentence.text);
        
        this.currentSource = this.audioContext.createBufferSource();
        this.currentSource.buffer = item.buffer;
        this.currentSource.playbackRate.value = this.speed;
        this.currentSource.connect(this.audioContext.destination);
        
        this.currentSource.onended = () => {
            this.currentSource = null;
            
            if (this.isPlaying && !this.isPaused) {
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
        if (!this.isPlaying || this.isPaused || !this.audioContext) return;
        
        const elapsed = (this.audioContext.currentTime - this.startTime) * this.speed;
        this.onTimeUpdate?.(elapsed, this.currentDuration);
        
        if (this.isPlaying && !this.isPaused) {
            requestAnimationFrame(() => this.updateTime());
        }
    }
    
    playWithWebSpeech() {
        if (!this.isPlaying || this.isPaused) return;
        
        const sentence = this.sentences[this.currentSentenceIndex];
        if (!sentence) {
            this.stop();
            return;
        }
        
        if (sentence.paragraphIndex !== this.currentParagraphIndex) {
            this.currentParagraphIndex = sentence.paragraphIndex;
            this.onParagraphChange?.(this.currentParagraphIndex, this.paragraphs.length);
        }
        this.onSentenceChange?.(this.currentSentenceIndex, sentence.text);
        
        this.webSpeechUtterance = new SpeechSynthesisUtterance(sentence.text);
        this.webSpeechUtterance.rate = this.speed;
        this.webSpeechUtterance.volume = this.volume;
        
        const voices = this.webSpeechSynth.getVoices();
        const selectedVoice = voices.find(v => v.name === this.currentVoice);
        if (selectedVoice) {
            this.webSpeechUtterance.voice = selectedVoice;
        }
        
        this.webSpeechUtterance.onend = () => {
            if (this.isPlaying && !this.isPaused) {
                this.currentSentenceIndex++;
                if (this.currentSentenceIndex < this.sentences.length) {
                    this.playWithWebSpeech();
                } else {
                    this.stop();
                }
            }
        };
        
        this.webSpeechUtterance.onerror = (e) => {
            if (e.error !== 'interrupted') {
                console.error('Web Speech error:', e);
            }
        };
        
        this.webSpeechSynth.speak(this.webSpeechUtterance);
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
            this.stop();
            this.currentParagraphIndex++;
            
            const mapping = this.paragraphSentenceMap[this.currentParagraphIndex];
            this.currentSentenceIndex = mapping.start;
            
            this.isPlaying = true;
            this.isPaused = false;
            this.onPlayStateChange?.(true);
            this.onParagraphChange?.(this.currentParagraphIndex, this.paragraphs.length);
            
            if (this.useSystemVoices) {
                this.playWithWebSpeech();
            } else {
                this.generateAndPlay();
            }
        }
    }
    
    previousParagraph() {
        if (this.currentParagraphIndex > 0) {
            this.stop();
            this.currentParagraphIndex--;
            
            const mapping = this.paragraphSentenceMap[this.currentParagraphIndex];
            this.currentSentenceIndex = mapping.start;
            
            this.isPlaying = true;
            this.isPaused = false;
            this.onPlayStateChange?.(true);
            this.onParagraphChange?.(this.currentParagraphIndex, this.paragraphs.length);
            
            if (this.useSystemVoices) {
                this.playWithWebSpeech();
            } else {
                this.generateAndPlay();
            }
        }
    }
    
    setVoice(voiceId) {
        this.currentVoice = voiceId;
    }
    
    setSpeed(speed) {
        this.speed = Math.max(0.5, Math.min(2, speed));
        
        if (this.currentSource) {
            this.currentSource.playbackRate.value = this.speed;
        }
        
        if (this.webSpeechUtterance) {
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
            loadProgress: this.loadProgress
        };
    }
}

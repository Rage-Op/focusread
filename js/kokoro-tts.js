/**
 * Kokoro TTS Module
 * High-quality text-to-speech using Kokoro-82M model via kokoro-js
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

export class KokoroTTS {
    constructor() {
        this.kokoro = null;
        this.worker = null;
        this.isModelLoaded = false;
        this.isLoading = false;
        this.loadProgress = 0;
        this.useSystemVoices = false;
        this.forceSystemVoices = false;
        
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
        this.isGenerating = false;
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
        
        const dominated = navigator.deviceMemory;
        if (dominated && dominated < 4) {
            console.log('Low memory device, using system voices');
            return false;
        }
        
        if ('gpu' in navigator) {
            try {
                const adapter = await navigator.gpu?.requestAdapter();
                if (adapter) {
                    console.log('WebGPU available');
                    return true;
                }
            } catch (e) {
                console.log('WebGPU not available:', e);
            }
        }
        
        const isOldiOS = /iPhone|iPad/.test(navigator.userAgent) && 
            !('gpu' in navigator);
        if (isOldiOS) {
            console.log('Older iOS without WebGPU, using system voices');
            return false;
        }
        
        return true;
    }
    
    async loadModel(onProgress) {
        if (this.isModelLoaded) return true;
        if (this.isLoading) return false;
        
        const canUseKokoro = await this.checkDeviceCapability();
        if (!canUseKokoro) {
            this.useSystemVoices = true;
            this.onEngineChange?.('system');
            return true;
        }
        
        this.isLoading = true;
        this.onLoadProgress?.(0, 'Initializing...');
        
        try {
            const importPromise = import('https://cdn.jsdelivr.net/npm/kokoro-js@1.1.0/+esm');
            const importTimeout = this.timeoutPromise(15000, 'Import timeout');
            
            const module = await Promise.race([importPromise, importTimeout]);
            if (!module) throw new Error('Import timeout');
            
            const { KokoroTTS: KokoroModel } = module;
            
            this.onLoadProgress?.(10, 'Loading model...');
            
            const modelPromise = KokoroModel.from_pretrained(
                'onnx-community/Kokoro-82M-v1.0-ONNX',
                {
                    dtype: 'q4',
                    device: 'wasm',
                    progress_callback: (progress) => {
                        const percent = Math.round(10 + progress.progress * 0.85);
                        this.loadProgress = percent;
                        this.onLoadProgress?.(percent, 'Downloading model...');
                        onProgress?.(percent);
                    }
                }
            );
            
            const modelTimeout = this.timeoutPromise(120000, 'Model load timeout');
            this.kokoro = await Promise.race([modelPromise, modelTimeout]);
            
            if (!this.kokoro) throw new Error('Model load timeout');
            
            this.onLoadProgress?.(98, 'Warming up...');
            
            const warmupPromise = this.kokoro.generate('Hi', { voice: DEFAULT_VOICE });
            const warmupTimeout = this.timeoutPromise(30000, 'Warmup timeout');
            
            try {
                await Promise.race([warmupPromise, warmupTimeout]);
            } catch (warmupError) {
                console.warn('Warmup failed, but continuing:', warmupError);
            }
            
            this.isModelLoaded = true;
            this.isLoading = false;
            this.useSystemVoices = false;
            this.onLoadProgress?.(100, 'Ready');
            this.onEngineChange?.('kokoro');
            
            return true;
            
        } catch (error) {
            console.error('Failed to load Kokoro model:', error);
            this.isLoading = false;
            this.kokoro = null;
            this.useSystemVoices = true;
            this.onEngineChange?.('system');
            this.onLoadProgress?.(100, 'Using system voices');
            return true;
        }
    }
    
    timeoutPromise(ms, message) {
        return new Promise((_, reject) => {
            setTimeout(() => reject(new Error(message)), ms);
        });
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
        this.onParagraphChange?.(paragraphIndex);
        
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
    
    async generateAndPlay() {
        if (!this.isPlaying || this.isPaused) return;
        
        while (this.audioQueue.length < SENTENCE_BUFFER_SIZE && 
               this.currentSentenceIndex + this.audioQueue.length < this.sentences.length) {
            const nextIndex = this.currentSentenceIndex + this.audioQueue.length;
            const sentence = this.sentences[nextIndex];
            
            if (!this.isGenerating) {
                this.isGenerating = true;
                try {
                    const audio = await this.kokoro.generate(sentence.text, {
                        voice: this.currentVoice,
                    });
                    
                    if (this.isPlaying) {
                        const audioBuffer = await this.decodeAudioData(audio);
                        this.audioQueue.push({
                            buffer: audioBuffer,
                            sentenceIndex: nextIndex,
                            duration: audioBuffer.duration
                        });
                    }
                } catch (error) {
                    console.error('Generation error:', error);
                }
                this.isGenerating = false;
            } else {
                break;
            }
        }
        
        if (this.audioQueue.length > 0 && !this.currentSource) {
            this.playNextInQueue();
        }
        
        if (this.audioQueue.length < SENTENCE_BUFFER_SIZE && this.isPlaying && !this.isPaused) {
            setTimeout(() => this.generateAndPlay(), 100);
        }
    }
    
    async decodeAudioData(kokoroAudio) {
        const wavData = kokoroAudio.toWav();
        const arrayBuffer = wavData.buffer.slice(
            wavData.byteOffset,
            wavData.byteOffset + wavData.byteLength
        );
        return await this.audioContext.decodeAudioData(arrayBuffer);
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
            this.onParagraphChange?.(this.currentParagraphIndex);
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
                    this.generateAndPlay();
                } else {
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
            this.onParagraphChange?.(this.currentParagraphIndex);
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
            this.generateAndPlay();
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
        this.isGenerating = false;
        
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
            const wasPlaying = this.isPlaying && !this.isPaused;
            this.stop();
            this.currentParagraphIndex++;
            
            const mapping = this.paragraphSentenceMap[this.currentParagraphIndex];
            this.currentSentenceIndex = mapping.start;
            
            this.isPlaying = true;
            this.isPaused = false;
            this.onPlayStateChange?.(true);
            this.onParagraphChange?.(this.currentParagraphIndex);
            
            if (this.useSystemVoices) {
                this.playWithWebSpeech();
            } else {
                this.generateAndPlay();
            }
        }
    }
    
    previousParagraph() {
        if (this.currentParagraphIndex > 0) {
            const wasPlaying = this.isPlaying && !this.isPaused;
            this.stop();
            this.currentParagraphIndex--;
            
            const mapping = this.paragraphSentenceMap[this.currentParagraphIndex];
            this.currentSentenceIndex = mapping.start;
            
            this.isPlaying = true;
            this.isPaused = false;
            this.onPlayStateChange?.(true);
            this.onParagraphChange?.(this.currentParagraphIndex);
            
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
            engine: this.getEngine(),
            voice: this.currentVoice,
            speed: this.speed,
            isModelLoaded: this.isModelLoaded,
            isLoading: this.isLoading,
            loadProgress: this.loadProgress
        };
    }
}

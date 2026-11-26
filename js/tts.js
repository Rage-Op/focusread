/**
 * Text-to-Speech manager using Web Speech API
 */

export class TTSManager {
    constructor() {
        this.synth = window.speechSynthesis;
        this.utterance = null;
        this.isSpeaking = false;
        this.voices = [];
        
        this.loadVoices();
        
        if (this.synth.onvoiceschanged !== undefined) {
            this.synth.onvoiceschanged = () => this.loadVoices();
        }
    }
    
    loadVoices() {
        this.voices = this.synth.getVoices();
        this.populateVoiceSelect();
    }
    
    populateVoiceSelect() {
        const select = document.getElementById('tts-voice');
        if (!select) return;
        
        const currentValue = select.value;
        
        select.innerHTML = '<option value="">Default Voice</option>';
        
        const preferredLangs = ['en-US', 'en-GB', 'en-AU', 'en'];
        const sortedVoices = [...this.voices].sort((a, b) => {
            const aPreferred = preferredLangs.some(lang => a.lang.startsWith(lang));
            const bPreferred = preferredLangs.some(lang => b.lang.startsWith(lang));
            if (aPreferred && !bPreferred) return -1;
            if (!aPreferred && bPreferred) return 1;
            return a.name.localeCompare(b.name);
        });
        
        sortedVoices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice.name;
            option.textContent = `${voice.name} (${voice.lang})`;
            select.appendChild(option);
        });
        
        if (currentValue) {
            select.value = currentValue;
        }
    }
    
    getVoice(name) {
        if (!name) return null;
        return this.voices.find(v => v.name === name) || null;
    }
    
    speak(text, options = {}) {
        this.stop();
        
        this.utterance = new SpeechSynthesisUtterance(text);
        
        if (options.voice) {
            const voice = this.getVoice(options.voice);
            if (voice) {
                this.utterance.voice = voice;
            }
        }
        
        this.utterance.rate = options.rate || 1;
        this.utterance.pitch = options.pitch || 1;
        this.utterance.volume = options.volume || 1;
        
        this.utterance.onstart = () => {
            this.isSpeaking = true;
            options.onStart?.();
        };
        
        this.utterance.onend = () => {
            this.isSpeaking = false;
            options.onEnd?.();
        };
        
        this.utterance.onerror = (event) => {
            this.isSpeaking = false;
            console.error('TTS error:', event);
            options.onError?.(event);
        };
        
        this.utterance.onpause = () => {
            options.onPause?.();
        };
        
        this.utterance.onresume = () => {
            options.onResume?.();
        };
        
        this.synth.speak(this.utterance);
    }
    
    stop() {
        this.synth.cancel();
        this.isSpeaking = false;
        this.utterance = null;
    }
    
    pause() {
        if (this.isSpeaking) {
            this.synth.pause();
        }
    }
    
    resume() {
        if (this.synth.paused) {
            this.synth.resume();
        }
    }
    
    toggle() {
        if (this.synth.paused) {
            this.resume();
        } else if (this.isSpeaking) {
            this.pause();
        }
    }
}

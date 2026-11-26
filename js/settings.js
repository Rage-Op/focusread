/**
 * Settings manager
 * Handles all user preferences and applies them to the UI
 */

export class SettingsManager {
    constructor(storage) {
        this.storage = storage;
        this.settings = this.getDefaults();
    }
    
    getDefaults() {
        return {
            theme: 'system',
            fontFamily: 'system',
            fontSize: 18,
            lineHeight: 1.8,
            letterSpacing: 0,
            wordSpacing: 0,
            maxWidth: 700,
            textAlign: 'left',
            bionicEnabled: false,
            bionicStrength: 3,
            focusRulerEnabled: false,
            highContrast: false,
            reducedMotion: false,
            ttsVoice: '',
            ttsRate: 1,
            rsvpSpeed: 300
        };
    }
    
    async load() {
        try {
            const saved = localStorage.getItem('focusread_settings');
            if (saved) {
                const parsed = JSON.parse(saved);
                this.settings = { ...this.getDefaults(), ...parsed };
            }
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
        
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReducedMotion) {
            this.settings.reducedMotion = true;
        }
    }
    
    save() {
        try {
            localStorage.setItem('focusread_settings', JSON.stringify(this.settings));
        } catch (e) {
            console.error('Failed to save settings:', e);
        }
    }
    
    get(key) {
        return this.settings[key];
    }
    
    set(key, value) {
        this.settings[key] = value;
        this.apply();
        this.save();
    }
    
    reset() {
        this.settings = this.getDefaults();
        this.apply();
        this.save();
        this.updateUI();
    }
    
    apply() {
        const root = document.documentElement;
        const body = document.body;
        
        this.applyTheme();
        
        body.setAttribute('data-font', this.settings.fontFamily);
        
        root.style.setProperty('--font-size', `${this.settings.fontSize}px`);
        root.style.setProperty('--line-height', this.settings.lineHeight);
        root.style.setProperty('--letter-spacing', `${this.settings.letterSpacing}em`);
        root.style.setProperty('--word-spacing', `${this.settings.wordSpacing}em`);
        root.style.setProperty('--max-width', `${this.settings.maxWidth}px`);
        root.style.setProperty('--text-align', this.settings.textAlign);
        
        body.setAttribute('data-focus-ruler', this.settings.focusRulerEnabled);
        body.setAttribute('data-high-contrast', this.settings.highContrast);
        body.setAttribute('data-reduced-motion', this.settings.reducedMotion);
    }
    
    applyTheme() {
        const body = document.body;
        let theme = this.settings.theme;
        
        if (theme === 'system') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            theme = prefersDark ? 'dark' : 'light';
        }
        
        body.setAttribute('data-theme', theme);
    }
    
    bindEvents() {
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const theme = btn.dataset.theme;
                this.set('theme', theme);
                this.updateThemeButtons();
            });
        });
        
        document.getElementById('font-family').addEventListener('change', (e) => {
            this.set('fontFamily', e.target.value);
        });
        
        document.getElementById('font-size').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            document.getElementById('font-size-value').textContent = `${value}px`;
            this.set('fontSize', value);
        });
        
        document.getElementById('line-height').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            document.getElementById('line-height-value').textContent = value.toFixed(1);
            this.set('lineHeight', value);
        });
        
        document.getElementById('letter-spacing').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            document.getElementById('letter-spacing-value').textContent = `${value.toFixed(2)}em`;
            this.set('letterSpacing', value);
        });
        
        document.getElementById('word-spacing').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            document.getElementById('word-spacing-value').textContent = `${value.toFixed(2)}em`;
            this.set('wordSpacing', value);
        });
        
        document.getElementById('max-width').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            document.getElementById('max-width-value').textContent = `${value}px`;
            this.set('maxWidth', value);
        });
        
        document.querySelectorAll('.align-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const align = btn.dataset.align;
                this.set('textAlign', align);
                this.updateAlignButtons();
            });
        });
        
        document.getElementById('bionic-enabled').addEventListener('change', (e) => {
            this.set('bionicEnabled', e.target.checked);
            if (window.app && window.app.currentBook) {
                window.app.renderText();
            }
        });
        
        document.getElementById('bionic-strength').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            document.getElementById('bionic-strength-value').textContent = value;
            this.set('bionicStrength', value);
            if (this.settings.bionicEnabled && window.app && window.app.currentBook) {
                window.app.renderText();
            }
        });
        
        document.getElementById('focus-ruler-enabled').addEventListener('change', (e) => {
            this.set('focusRulerEnabled', e.target.checked);
        });
        
        document.getElementById('high-contrast').addEventListener('change', (e) => {
            this.set('highContrast', e.target.checked);
        });
        
        document.getElementById('reduced-motion').addEventListener('change', (e) => {
            this.set('reducedMotion', e.target.checked);
        });
        
        document.getElementById('tts-voice').addEventListener('change', (e) => {
            this.set('ttsVoice', e.target.value);
        });
        
        document.getElementById('tts-rate').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            document.getElementById('tts-rate-value').textContent = `${value.toFixed(1)}x`;
            this.set('ttsRate', value);
        });
        
        document.getElementById('reset-settings').addEventListener('click', () => {
            if (confirm('Reset all settings to defaults?')) {
                this.reset();
            }
        });
        
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            if (this.settings.theme === 'system') {
                this.applyTheme();
            }
        });
        
        this.updateUI();
    }
    
    updateUI() {
        this.updateThemeButtons();
        this.updateAlignButtons();
        
        document.getElementById('font-family').value = this.settings.fontFamily;
        
        document.getElementById('font-size').value = this.settings.fontSize;
        document.getElementById('font-size-value').textContent = `${this.settings.fontSize}px`;
        
        document.getElementById('line-height').value = this.settings.lineHeight;
        document.getElementById('line-height-value').textContent = this.settings.lineHeight.toFixed(1);
        
        document.getElementById('letter-spacing').value = this.settings.letterSpacing;
        document.getElementById('letter-spacing-value').textContent = `${this.settings.letterSpacing.toFixed(2)}em`;
        
        document.getElementById('word-spacing').value = this.settings.wordSpacing;
        document.getElementById('word-spacing-value').textContent = `${this.settings.wordSpacing.toFixed(2)}em`;
        
        document.getElementById('max-width').value = this.settings.maxWidth;
        document.getElementById('max-width-value').textContent = `${this.settings.maxWidth}px`;
        
        document.getElementById('bionic-enabled').checked = this.settings.bionicEnabled;
        document.getElementById('bionic-strength').value = this.settings.bionicStrength;
        document.getElementById('bionic-strength-value').textContent = this.settings.bionicStrength;
        
        document.getElementById('focus-ruler-enabled').checked = this.settings.focusRulerEnabled;
        document.getElementById('high-contrast').checked = this.settings.highContrast;
        document.getElementById('reduced-motion').checked = this.settings.reducedMotion;
        
        document.getElementById('tts-voice').value = this.settings.ttsVoice;
        document.getElementById('tts-rate').value = this.settings.ttsRate;
        document.getElementById('tts-rate-value').textContent = `${this.settings.ttsRate.toFixed(1)}x`;
    }
    
    updateThemeButtons() {
        document.querySelectorAll('.theme-btn').forEach(btn => {
            const isActive = btn.dataset.theme === this.settings.theme;
            btn.setAttribute('aria-pressed', isActive);
        });
    }
    
    updateAlignButtons() {
        document.querySelectorAll('.align-btn').forEach(btn => {
            const isActive = btn.dataset.align === this.settings.textAlign;
            btn.setAttribute('aria-pressed', isActive);
        });
    }
}

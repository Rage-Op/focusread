/**
 * PIN authentication manager
 * Uses salted SHA-256 hash for client-side privacy lock
 */

export class PinManager {
    constructor(storage) {
        this.storage = storage;
        this.currentPin = '';
        this.mode = 'unlock';
        this.confirmPin = '';
        this.maxAttempts = 5;
        this.attempts = 0;
        this.isProcessing = false;
        this.onSuccess = null;
        this.onError = null;
    }
    
    setMode(mode) {
        this.mode = mode;
        this.currentPin = '';
        this.confirmPin = '';
        this.attempts = 0;
        this.updateDots();
    }
    
    hasPin() {
        return !!localStorage.getItem('focusread_pin_hash');
    }
    
    getPinData() {
        const hash = localStorage.getItem('focusread_pin_hash');
        const salt = localStorage.getItem('focusread_pin_salt');
        const changedAt = parseInt(localStorage.getItem('focusread_pin_changed') || '0');
        return hash && salt ? { hash, salt, changedAt } : null;
    }
    
    setPinData(hash, salt, changedAt) {
        localStorage.setItem('focusread_pin_hash', hash);
        localStorage.setItem('focusread_pin_salt', salt);
        localStorage.setItem('focusread_pin_changed', changedAt.toString());
    }
    
    clearPinData() {
        localStorage.removeItem('focusread_pin_hash');
        localStorage.removeItem('focusread_pin_salt');
        localStorage.removeItem('focusread_pin_changed');
    }
    
    bindEvents(onSuccess, onError) {
        this.onSuccess = onSuccess;
        this.onError = onError;
        
        const keys = document.querySelectorAll('.pin-key[data-key]');
        keys.forEach(key => {
            this.bindPointerEvents(key, () => this.addDigit(key.dataset.key));
        });
        
        const backspace = document.getElementById('pin-backspace');
        this.bindPointerEvents(backspace, () => this.removeDigit());
        
        const forgotBtn = document.getElementById('forgot-pin-btn');
        this.bindPointerEvents(forgotBtn, () => this.forgotPin());
        
        document.removeEventListener('keydown', this._keyHandler);
        this._keyHandler = (e) => this.handleKeyboard(e);
        document.addEventListener('keydown', this._keyHandler);
    }
    
    bindPointerEvents(element, action) {
        if (element._pointerBound) return;
        element._pointerBound = true;
        
        let isPointerDown = false;
        
        element.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            isPointerDown = true;
            element.classList.add('pressed');
        }, { passive: false });
        
        element.addEventListener('pointerup', (e) => {
            if (isPointerDown) {
                e.preventDefault();
                action();
            }
            isPointerDown = false;
            element.classList.remove('pressed');
        }, { passive: false });
        
        element.addEventListener('pointerleave', () => {
            isPointerDown = false;
            element.classList.remove('pressed');
        });
        
        element.addEventListener('pointercancel', () => {
            isPointerDown = false;
            element.classList.remove('pressed');
        });
        
        element.addEventListener('touchend', (e) => {
            e.preventDefault();
        }, { passive: false });
    }
    
    handleKeyboard(e) {
        if (/^[0-9]$/.test(e.key)) {
            this.addDigit(e.key);
        } else if (e.key === 'Backspace') {
            this.removeDigit();
        }
    }
    
    addDigit(digit) {
        if (this.currentPin.length >= 4 || this.isProcessing) return;
        
        this.currentPin += digit;
        this.updateDots();
        
        if (this.currentPin.length === 4) {
            this.isProcessing = true;
            setTimeout(() => {
                this.handleComplete();
                this.isProcessing = false;
            }, 200);
        }
    }
    
    removeDigit() {
        if (this.currentPin.length === 0) return;
        this.currentPin = this.currentPin.slice(0, -1);
        this.updateDots();
    }
    
    updateDots() {
        const dots = document.querySelectorAll('.pin-dot');
        dots.forEach((dot, i) => {
            dot.setAttribute('data-filled', i < this.currentPin.length);
        });
    }
    
    async handleComplete() {
        if (this.mode === 'setup') {
            if (!this.confirmPin) {
                this.confirmPin = this.currentPin;
                this.currentPin = '';
                this.updateDots();
                document.getElementById('pin-subtitle').textContent = 'Confirm your PIN';
            } else {
                if (this.currentPin === this.confirmPin) {
                    await this.savePin(this.currentPin);
                    this.onSuccess?.();
                } else {
                    this.onError?.('PINs do not match. Try again.');
                    this.confirmPin = '';
                    this.currentPin = '';
                    this.updateDots();
                    document.getElementById('pin-subtitle').textContent = 'Create a 4-digit PIN';
                }
            }
        } else {
            const isValid = await this.verifyPin(this.currentPin);
            if (isValid) {
                this.attempts = 0;
                this.onSuccess?.();
            } else {
                this.attempts++;
                if (this.attempts >= this.maxAttempts) {
                    this.onError?.(`Too many attempts. ${this.maxAttempts - this.attempts} left.`);
                } else {
                    this.onError?.(`Incorrect PIN. ${this.maxAttempts - this.attempts} attempts left.`);
                }
                this.currentPin = '';
                this.updateDots();
                this.shakeDots();
            }
        }
    }
    
    shakeDots() {
        const container = document.querySelector('.pin-display');
        container.style.animation = 'shake 0.3s ease';
        setTimeout(() => container.style.animation = '', 300);
        
        if (!document.querySelector('#shake-style')) {
            const style = document.createElement('style');
            style.id = 'shake-style';
            style.textContent = `
                @keyframes shake {
                    0%, 100% { transform: translateX(0); }
                    25% { transform: translateX(-10px); }
                    75% { transform: translateX(10px); }
                }
            `;
            document.head.appendChild(style);
        }
    }
    
    async savePin(pin) {
        const salt = this.generateSalt();
        const hash = await this.hashPin(pin, salt);
        const changedAt = Date.now();
        
        localStorage.setItem('focusread_pin_hash', hash);
        localStorage.setItem('focusread_pin_salt', salt);
        localStorage.setItem('focusread_pin_changed', changedAt.toString());
        
        return { hash, salt, changedAt };
    }
    
    async verifyPin(pin) {
        const storedHash = localStorage.getItem('focusread_pin_hash');
        const salt = localStorage.getItem('focusread_pin_salt');
        
        if (!storedHash || !salt) return false;
        
        const hash = await this.hashPin(pin, salt);
        return hash === storedHash;
    }
    
    generateSalt() {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
    }
    
    async hashPin(pin, salt) {
        const encoder = new TextEncoder();
        const data = encoder.encode(salt + pin);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    
    async forgotPin() {
        const confirmed = confirm(
            'Forgot your PIN?\n\n' +
            'This will reset your PIN and clear all saved data including your books and settings.\n\n' +
            'Are you sure you want to continue?'
        );
        
        if (confirmed) {
            localStorage.removeItem('focusread_pin_hash');
            localStorage.removeItem('focusread_pin_salt');
            localStorage.removeItem('focusread_settings');
            localStorage.removeItem('focusread_last_book');
            
            await this.storage.clearAll();
            
            this.setMode('setup');
            document.getElementById('pin-subtitle').textContent = 'Create a 4-digit PIN';
            document.getElementById('forgot-pin-btn').style.display = 'none';
        }
    }
}

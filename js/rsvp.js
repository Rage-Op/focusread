/**
 * RSVP (Rapid Serial Visual Presentation) speed reading
 * Displays one word at a time with adjustable WPM
 */

export class RSVPReader {
    constructor(words, startPosition, wpm, onPositionChange, onComplete) {
        this.words = words;
        this.position = startPosition;
        this.wpm = wpm;
        this.baseDelay = 60000 / wpm;
        this.isPlaying = false;
        this.isActive = false;
        this.timeout = null;
        this.onPositionChange = onPositionChange;
        this.onComplete = onComplete;
    }
    
    setWords(words) {
        this.words = words;
    }
    
    setPosition(position) {
        this.position = Math.max(0, Math.min(position, this.words.length - 1));
    }
    
    setWPM(wpm) {
        this.wpm = wpm;
        this.baseDelay = 60000 / wpm;
        
        document.getElementById('rsvp-wpm').textContent = wpm;
        
        this.updatePresetButtons();
    }
    
    updatePresetButtons() {
        document.querySelectorAll('.preset-btn').forEach(btn => {
            const btnWpm = parseInt(btn.dataset.wpm);
            btn.classList.toggle('active', Math.abs(btnWpm - this.wpm) < 50);
        });
    }
    
    bindControls() {
        this.isActive = true;
        
        const playBtn = document.getElementById('rsvp-play');
        const prevWord = document.getElementById('rsvp-prev-word');
        const nextWord = document.getElementById('rsvp-next-word');
        const prevSentence = document.getElementById('rsvp-prev-sentence');
        const nextSentence = document.getElementById('rsvp-next-sentence');
        const speedSlider = document.getElementById('rsvp-speed');
        const closeBtn = document.getElementById('rsvp-close');
        const presetBtns = document.querySelectorAll('.preset-btn');
        
        playBtn.onclick = () => this.togglePlay();
        prevWord.onclick = () => this.prevWord();
        nextWord.onclick = () => this.nextWord();
        prevSentence.onclick = () => this.prevSentence();
        nextSentence.onclick = () => this.nextSentence();
        
        speedSlider.value = this.wpm;
        speedSlider.oninput = (e) => this.setWPM(parseInt(e.target.value));
        
        closeBtn.onclick = () => this.stop();
        
        presetBtns.forEach(btn => {
            btn.onclick = () => {
                const wpm = parseInt(btn.dataset.wpm);
                this.setWPM(wpm);
                speedSlider.value = wpm;
            };
        });
        
        this.updatePresetButtons();
        this.displayWord();
    }
    
    togglePlay() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }
    
    play() {
        if (this.position >= this.words.length) {
            this.position = 0;
        }
        
        this.isPlaying = true;
        this.updatePlayButton();
        this.scheduleNextWord();
    }
    
    pause() {
        this.isPlaying = false;
        this.updatePlayButton();
        
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
    }
    
    stop() {
        this.pause();
        this.isActive = false;
        this.onComplete?.();
    }
    
    updatePlayButton() {
        const playBtn = document.getElementById('rsvp-play');
        const playIcon = playBtn.querySelector('.play-icon');
        const pauseIcon = playBtn.querySelector('.pause-icon');
        
        if (this.isPlaying) {
            playIcon.style.display = 'none';
            pauseIcon.style.display = '';
            playBtn.setAttribute('aria-label', 'Pause');
        } else {
            playIcon.style.display = '';
            pauseIcon.style.display = 'none';
            playBtn.setAttribute('aria-label', 'Play');
        }
    }
    
    scheduleNextWord() {
        if (!this.isPlaying || this.position >= this.words.length) {
            if (this.position >= this.words.length) {
                this.pause();
            }
            return;
        }
        
        const word = this.words[this.position];
        const delay = this.calculateDelay(word);
        
        this.displayWord();
        this.onPositionChange?.(this.position);
        
        this.position++;
        
        this.timeout = setTimeout(() => this.scheduleNextWord(), delay);
    }
    
    calculateDelay(word) {
        let delay = this.baseDelay;
        
        if (word.length > 8) {
            delay *= 1.3;
        } else if (word.length > 11) {
            delay *= 1.5;
        }
        
        if (/[.!?]$/.test(word)) {
            delay *= 2.5;
        } else if (/[,;:]$/.test(word)) {
            delay *= 1.5;
        }
        
        return delay;
    }
    
    displayWord() {
        const word = this.words[this.position] || '';
        const wordEl = document.getElementById('rsvp-word');
        
        const orp = this.calculateORP(word);
        
        const before = word.slice(0, orp);
        const orpChar = word[orp] || '';
        const after = word.slice(orp + 1);
        
        wordEl.querySelector('.rsvp-before').textContent = before;
        wordEl.querySelector('.rsvp-orp').textContent = orpChar;
        wordEl.querySelector('.rsvp-after').textContent = after;
    }
    
    calculateORP(word) {
        const cleanWord = word.replace(/[^a-zA-ZÀ-ÿ]/g, '');
        const len = cleanWord.length;
        
        let orpPosition;
        if (len <= 1) orpPosition = 0;
        else if (len <= 5) orpPosition = 1;
        else if (len <= 9) orpPosition = 2;
        else if (len <= 13) orpPosition = 3;
        else orpPosition = 4;
        
        let letterCount = 0;
        for (let i = 0; i < word.length; i++) {
            if (/[a-zA-ZÀ-ÿ]/.test(word[i])) {
                if (letterCount === orpPosition) {
                    return i;
                }
                letterCount++;
            }
        }
        
        return Math.min(orpPosition, word.length - 1);
    }
    
    prevWord() {
        this.position = Math.max(0, this.position - 1);
        this.displayWord();
        this.onPositionChange?.(this.position);
    }
    
    nextWord() {
        this.position = Math.min(this.words.length - 1, this.position + 1);
        this.displayWord();
        this.onPositionChange?.(this.position);
    }
    
    prevSentence() {
        const start = Math.max(0, this.position - 1);
        
        for (let i = start; i >= 0; i--) {
            if (/[.!?]$/.test(this.words[i])) {
                this.position = Math.min(i + 1, this.words.length - 1);
                this.displayWord();
                this.onPositionChange?.(this.position);
                return;
            }
        }
        
        this.position = 0;
        this.displayWord();
        this.onPositionChange?.(this.position);
    }
    
    nextSentence() {
        for (let i = this.position; i < this.words.length; i++) {
            if (/[.!?]$/.test(this.words[i])) {
                this.position = Math.min(i + 1, this.words.length - 1);
                this.displayWord();
                this.onPositionChange?.(this.position);
                return;
            }
        }
        
        this.position = this.words.length - 1;
        this.displayWord();
        this.onPositionChange?.(this.position);
    }
}

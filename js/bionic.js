/**
 * Bionic reading implementation
 * Bolds the first part of each word based on word length
 */

export class BionicReader {
    getBoldLength(wordLength, strength = 3) {
        const baseRatios = {
            1: [1, 1, 1, 1, 1],
            2: [1, 1, 1, 2, 2],
            3: [1, 1, 2, 2, 3],
            4: [1, 2, 2, 3, 3],
            5: [1, 2, 3, 3, 4],
        };
        
        let lengthCategory;
        if (wordLength <= 3) lengthCategory = 1;
        else if (wordLength <= 5) lengthCategory = 2;
        else if (wordLength <= 7) lengthCategory = 3;
        else if (wordLength <= 10) lengthCategory = 4;
        else lengthCategory = 5;
        
        const ratios = baseRatios[lengthCategory];
        const strengthIndex = Math.min(strength - 1, ratios.length - 1);
        
        return ratios[strengthIndex];
    }
    
    processWord(word, strength = 3) {
        const letters = word.match(/[a-zA-ZÀ-ÿ]/g);
        if (!letters || letters.length === 0) {
            return word;
        }
        
        const boldLength = this.getBoldLength(letters.length, strength);
        
        let letterCount = 0;
        let result = '';
        let inBold = true;
        
        for (const char of word) {
            if (/[a-zA-ZÀ-ÿ]/.test(char)) {
                letterCount++;
                if (letterCount <= boldLength && inBold) {
                    result += `<strong>${char}</strong>`;
                } else {
                    if (inBold && letterCount > boldLength) {
                        inBold = false;
                    }
                    result += char;
                }
            } else {
                result += char;
            }
        }
        
        result = result.replace(/<\/strong><strong>/g, '');
        
        return `<span class="bionic-word">${result}</span>`;
    }
    
    process(text, strength = 3) {
        const words = text.split(/(\s+)/);
        
        return words.map(segment => {
            if (/^\s+$/.test(segment)) {
                return segment;
            }
            return this.processWord(segment, strength);
        }).join('');
    }
}

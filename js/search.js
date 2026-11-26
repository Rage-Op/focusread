/**
 * Search manager for finding text in the book
 */

export class SearchManager {
    search(paragraphs, query, maxResults = 50) {
        const results = [];
        const lowerQuery = query.toLowerCase();
        const queryRegex = new RegExp(this.escapeRegex(query), 'gi');
        
        for (let i = 0; i < paragraphs.length && results.length < maxResults; i++) {
            const paragraph = paragraphs[i];
            const lowerPara = paragraph.toLowerCase();
            
            if (lowerPara.includes(lowerQuery)) {
                const matches = [...paragraph.matchAll(queryRegex)];
                
                for (const match of matches) {
                    if (results.length >= maxResults) break;
                    
                    const start = Math.max(0, match.index - 40);
                    const end = Math.min(paragraph.length, match.index + query.length + 40);
                    
                    let snippet = paragraph.slice(start, end);
                    
                    if (start > 0) snippet = '...' + snippet;
                    if (end < paragraph.length) snippet = snippet + '...';
                    
                    snippet = snippet.replace(queryRegex, '<mark>$&</mark>');
                    
                    results.push({
                        paragraphIndex: i,
                        snippet
                    });
                    
                    break;
                }
            }
        }
        
        return results;
    }
    
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

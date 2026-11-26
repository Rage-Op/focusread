/**
 * Storage manager using IndexedDB for books and localStorage for settings
 */

export class StorageManager {
    constructor() {
        this.dbName = 'focusread_db';
        this.dbVersion = 1;
        this.db = null;
    }
    
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = () => {
                console.error('IndexedDB error:', request.error);
                reject(request.error);
            };
            
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                if (!db.objectStoreNames.contains('books')) {
                    const store = db.createObjectStore('books', { keyPath: 'id' });
                    store.createIndex('title', 'title', { unique: false });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }
            };
        });
    }
    
    async saveBook(book) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['books'], 'readwrite');
            const store = transaction.objectStore('books');
            
            const request = store.put(book);
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    
    async getBook(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['books'], 'readonly');
            const store = transaction.objectStore('books');
            
            const request = store.get(id);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    
    async getAllBooks() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['books'], 'readonly');
            const store = transaction.objectStore('books');
            
            const request = store.getAll();
            
            request.onsuccess = () => {
                const books = request.result;
                books.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                resolve(books);
            };
            request.onerror = () => reject(request.error);
        });
    }
    
    async updateBook(book) {
        book.updatedAt = book.updatedAt || Date.now();
        return this.saveBook(book);
    }
    
    async deleteBook(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['books'], 'readwrite');
            const store = transaction.objectStore('books');
            
            const request = store.delete(id);
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    
    async clearAll() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['books'], 'readwrite');
            const store = transaction.objectStore('books');
            
            const request = store.clear();
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
    
    async setLastOpenedBook(id) {
        localStorage.setItem('focusread_last_book', id);
    }
    
    async getLastOpenedBook() {
        return localStorage.getItem('focusread_last_book');
    }
    
    async saveBookHighlights(bookId, data) {
        try {
            localStorage.setItem(`focusread_highlights_${bookId}`, JSON.stringify(data));
        } catch (e) {
            console.error('Error saving highlights:', e);
        }
    }
    
    async getBookHighlights(bookId) {
        try {
            const data = localStorage.getItem(`focusread_highlights_${bookId}`);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.error('Error loading highlights:', e);
            return null;
        }
    }
    
    async deleteBookHighlights(bookId) {
        localStorage.removeItem(`focusread_highlights_${bookId}`);
    }
}

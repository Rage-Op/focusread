/**
 * Firebase Cloud Sync Module
 * Handles authentication, Firestore sync, and offline persistence
 */

import { firebaseConfig, isFirebaseConfigured } from './firebase-config.js';

const CHUNK_SIZE = 500000;
const SYNC_DEBOUNCE_MS = 3000;

let app = null;
let auth = null;
let db = null;
let currentUser = null;
let syncDebounceTimer = null;
let onAuthChangeCallback = null;
let onSyncStatusCallback = null;
let onSyncProgressCallback = null;
let onSyncErrorCallback = null;

export class FirebaseSync {
    constructor() {
        this.initialized = false;
        this.syncStatus = 'idle';
        this.lastSyncTime = null;
        this.lastError = null;
        this.syncProgress = { current: 0, total: 0, action: '' };
    }
    
    isConfigured() {
        return isFirebaseConfigured();
    }
    
    async init() {
        if (!this.isConfigured()) {
            console.log('Firebase not configured, running in local-only mode');
            return false;
        }
        
        if (this.initialized) return true;
        
        try {
            const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
            const { 
                getAuth, 
                onAuthStateChanged,
                signInWithPopup,
                signInWithRedirect,
                getRedirectResult,
                signInWithEmailAndPassword,
                createUserWithEmailAndPassword,
                GoogleAuthProvider,
                signOut
            } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
            const { 
                getFirestore,
                enableIndexedDbPersistence,
                doc,
                getDoc,
                setDoc,
                updateDoc,
                deleteDoc,
                collection,
                query,
                getDocs,
                writeBatch,
                serverTimestamp,
                Timestamp
            } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
            
            app = initializeApp(firebaseConfig);
            auth = getAuth(app);
            db = getFirestore(app);
            
            try {
                await enableIndexedDbPersistence(db);
            } catch (err) {
                if (err.code === 'failed-precondition') {
                    console.log('Firestore persistence unavailable: multiple tabs open');
                } else if (err.code === 'unimplemented') {
                    console.log('Firestore persistence not supported in this browser');
                }
            }
            
            this._auth = { 
                signInWithPopup, 
                signInWithRedirect,
                getRedirectResult,
                signInWithEmailAndPassword,
                createUserWithEmailAndPassword,
                GoogleAuthProvider, 
                signOut 
            };
            this._firestore = { 
                doc, 
                getDoc, 
                setDoc, 
                updateDoc,
                deleteDoc,
                collection, 
                query, 
                getDocs,
                writeBatch,
                serverTimestamp,
                Timestamp
            };
            
            onAuthStateChanged(auth, (user) => {
                currentUser = user;
                onAuthChangeCallback?.(user);
            });
            
            const result = await getRedirectResult(auth);
            if (result?.user) {
                currentUser = result.user;
                onAuthChangeCallback?.(result.user);
            }
            
            this.initialized = true;
            return true;
            
        } catch (error) {
            console.error('Firebase init error:', error);
            return false;
        }
    }
    
    onAuthChange(callback) {
        onAuthChangeCallback = callback;
        if (currentUser) {
            callback(currentUser);
        }
    }
    
    onSyncStatus(callback) {
        onSyncStatusCallback = callback;
    }
    
    onSyncProgress(callback) {
        onSyncProgressCallback = callback;
    }
    
    onSyncError(callback) {
        onSyncErrorCallback = callback;
    }
    
    setSyncStatus(status) {
        this.syncStatus = status;
        if (status === 'idle') {
            this.lastSyncTime = Date.now();
            this.lastError = null;
        }
        onSyncStatusCallback?.(status, this.lastSyncTime);
    }
    
    setSyncProgress(current, total, action) {
        this.syncProgress = { current, total, action };
        onSyncProgressCallback?.(current, total, action);
    }
    
    setSyncError(error) {
        this.lastError = error;
        onSyncErrorCallback?.(error);
    }
    
    isSignedIn() {
        return !!currentUser;
    }
    
    getUser() {
        return currentUser;
    }
    
    async signInWithGoogle() {
        if (!this.initialized) return null;
        
        const provider = new this._auth.GoogleAuthProvider();
        
        const isIOSPWA = window.navigator.standalone === true;
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        
        try {
            if (isIOSPWA) {
                await this._auth.signInWithRedirect(auth, provider);
                return null;
            }
            
            const result = await this._auth.signInWithPopup(auth, provider);
            return result.user;
        } catch (error) {
            if (error.code === 'auth/popup-blocked' || 
                error.code === 'auth/popup-closed-by-user' ||
                error.code === 'auth/cancelled-popup-request') {
                await this._auth.signInWithRedirect(auth, provider);
                return null;
            }
            throw error;
        }
    }
    
    async signInWithEmail(email, password) {
        if (!this.initialized) return null;
        
        try {
            const result = await this._auth.signInWithEmailAndPassword(auth, email, password);
            return result.user;
        } catch (error) {
            if (error.code === 'auth/user-not-found' || 
                error.code === 'auth/invalid-credential' ||
                error.code === 'auth/wrong-password') {
                try {
                    const result = await this._auth.createUserWithEmailAndPassword(auth, email, password);
                    return result.user;
                } catch (createError) {
                    if (createError.code === 'auth/email-already-in-use') {
                        throw new Error('Incorrect password for this email');
                    }
                    throw createError;
                }
            }
            throw error;
        }
    }
    
    async signOut() {
        if (!this.initialized) return;
        await this._auth.signOut(auth);
        currentUser = null;
    }
    
    async syncSettings(localSettings) {
        if (!currentUser || !this.initialized) return localSettings;
        
        this.setSyncStatus('syncing');
        
        try {
            const { doc, getDoc, setDoc, serverTimestamp, Timestamp } = this._firestore;
            const settingsRef = doc(db, 'users', currentUser.uid, 'settings', 'prefs');
            const cloudDoc = await getDoc(settingsRef);
            
            const localUpdatedAt = localSettings.updatedAt || 0;
            
            if (cloudDoc.exists()) {
                const cloudData = cloudDoc.data();
                const cloudUpdatedAt = cloudData.updatedAt?.toMillis?.() || cloudData.updatedAt || 0;
                
                if (cloudUpdatedAt > localUpdatedAt) {
                    this.setSyncStatus('idle');
                    return { ...cloudData, updatedAt: cloudUpdatedAt };
                }
            }
            
            await setDoc(settingsRef, {
                ...localSettings,
                updatedAt: serverTimestamp()
            });
            
            this.setSyncStatus('idle');
            return localSettings;
            
        } catch (error) {
            console.error('Settings sync error:', error);
            this.setSyncStatus('error');
            return localSettings;
        }
    }
    
    async getCloudBooks() {
        if (!currentUser || !this.initialized) return [];
        
        try {
            const { collection, query, getDocs } = this._firestore;
            const booksRef = collection(db, 'users', currentUser.uid, 'books');
            const snapshot = await getDocs(query(booksRef));
            
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                isCloud: true
            }));
        } catch (error) {
            console.error('Get cloud books error:', error);
            return [];
        }
    }
    
    async uploadBook(book) {
        if (!currentUser || !this.initialized) return false;
        
        this.setSyncStatus('syncing');
        this.setSyncProgress(0, 100, `Uploading "${book.title}"...`);
        
        try {
            const { doc, setDoc, collection, writeBatch, serverTimestamp } = this._firestore;
            
            const bookRef = doc(db, 'users', currentUser.uid, 'books', book.id);
            
            const textContent = book.paragraphs.join('\n\n');
            const chunks = this.splitIntoChunks(textContent, CHUNK_SIZE);
            
            const bookMeta = {
                title: book.title,
                wordCount: book.wordCount,
                position: book.position || 0,
                progressPercent: book.position ? Math.round((book.position / book.wordCount) * 100) : 0,
                tocLength: book.toc?.length || 0,
                createdAt: book.createdAt || Date.now(),
                updatedAt: serverTimestamp(),
                chunkCount: chunks.length
            };
            
            await setDoc(bookRef, bookMeta);
            this.setSyncProgress(10, 100, `Uploading "${book.title}"...`);
            
            const tocJson = JSON.stringify(book.toc || []);
            const pageBreaksJson = JSON.stringify(book.pageBreaks || {});
            
            await setDoc(doc(db, 'users', currentUser.uid, 'books', book.id, 'meta', 'toc'), {
                data: tocJson
            });
            await setDoc(doc(db, 'users', currentUser.uid, 'books', book.id, 'meta', 'pageBreaks'), {
                data: pageBreaksJson
            });
            this.setSyncProgress(20, 100, `Uploading "${book.title}"...`);
            
            for (let i = 0; i < chunks.length; i++) {
                const chunkRef = doc(db, 'users', currentUser.uid, 'books', book.id, 'chunks', `chunk_${i.toString().padStart(4, '0')}`);
                await setDoc(chunkRef, {
                    index: i,
                    text: chunks[i]
                });
                const progress = 20 + Math.round((i + 1) / chunks.length * 80);
                this.setSyncProgress(progress, 100, `Uploading "${book.title}" (${i + 1}/${chunks.length} chunks)...`);
            }
            
            this.setSyncStatus('idle');
            return true;
            
        } catch (error) {
            console.error('Upload book error:', error);
            this.setSyncError(`Failed to upload "${book.title}": ${error.message}`);
            this.setSyncStatus('error');
            return false;
        }
    }
    
    async downloadBook(bookId, bookTitle = 'book') {
        if (!currentUser || !this.initialized) return null;
        
        this.setSyncStatus('syncing');
        this.setSyncProgress(0, 100, `Downloading "${bookTitle}"...`);
        
        try {
            const { doc, getDoc, collection, query, getDocs } = this._firestore;
            
            const bookRef = doc(db, 'users', currentUser.uid, 'books', bookId);
            const bookDoc = await getDoc(bookRef);
            
            if (!bookDoc.exists()) {
                this.setSyncError(`Book not found in cloud`);
                this.setSyncStatus('error');
                return null;
            }
            
            const bookMeta = bookDoc.data();
            this.setSyncProgress(20, 100, `Downloading "${bookMeta.title}"...`);
            
            let toc = [];
            let pageBreaks = {};
            
            try {
                const tocDoc = await getDoc(doc(db, 'users', currentUser.uid, 'books', bookId, 'meta', 'toc'));
                if (tocDoc.exists()) {
                    toc = JSON.parse(tocDoc.data().data || '[]');
                }
                
                const pageBreaksDoc = await getDoc(doc(db, 'users', currentUser.uid, 'books', bookId, 'meta', 'pageBreaks'));
                if (pageBreaksDoc.exists()) {
                    pageBreaks = JSON.parse(pageBreaksDoc.data().data || '{}');
                }
            } catch (e) {
                console.log('Could not load book metadata:', e);
            }
            this.setSyncProgress(30, 100, `Downloading "${bookMeta.title}"...`);
            
            const chunksRef = collection(db, 'users', currentUser.uid, 'books', bookId, 'chunks');
            const chunksSnapshot = await getDocs(query(chunksRef));
            
            const chunks = chunksSnapshot.docs
                .map(doc => ({ index: doc.data().index, text: doc.data().text }))
                .sort((a, b) => a.index - b.index);
            
            this.setSyncProgress(90, 100, `Processing "${bookMeta.title}"...`);
            
            const fullText = chunks.map(c => c.text).join('');
            const paragraphs = fullText.split('\n\n').filter(p => p.trim());
            
            const book = {
                id: bookId,
                title: bookMeta.title,
                wordCount: bookMeta.wordCount,
                position: bookMeta.position || 0,
                toc,
                pageBreaks,
                paragraphs,
                createdAt: bookMeta.createdAt,
                isCloud: true
            };
            
            this.setSyncStatus('idle');
            return book;
            
        } catch (error) {
            console.error('Download book error:', error);
            this.setSyncError(`Failed to download: ${error.message}`);
            this.setSyncStatus('error');
            return null;
        }
    }
    
    async updateBookProgress(bookId, position, wordCount) {
        if (!currentUser || !this.initialized) return;
        
        if (syncDebounceTimer) {
            clearTimeout(syncDebounceTimer);
        }
        
        syncDebounceTimer = setTimeout(async () => {
            try {
                const { doc, updateDoc, serverTimestamp } = this._firestore;
                const bookRef = doc(db, 'users', currentUser.uid, 'books', bookId);
                
                await updateDoc(bookRef, {
                    position,
                    progressPercent: Math.round((position / wordCount) * 100),
                    updatedAt: serverTimestamp()
                });
            } catch (error) {
                console.error('Update progress error:', error);
            }
        }, SYNC_DEBOUNCE_MS);
    }
    
    async syncBookProgress(bookId, localPosition, localUpdatedAt) {
        if (!currentUser || !this.initialized) return { position: localPosition, fromCloud: false };
        
        try {
            const { doc, getDoc } = this._firestore;
            const bookRef = doc(db, 'users', currentUser.uid, 'books', bookId);
            const bookDoc = await getDoc(bookRef);
            
            if (!bookDoc.exists()) return { position: localPosition, fromCloud: false };
            
            const cloudData = bookDoc.data();
            const cloudUpdatedAt = cloudData.updatedAt?.toMillis?.() || cloudData.updatedAt || 0;
            
            if (cloudUpdatedAt > localUpdatedAt && cloudData.position !== undefined) {
                return { position: cloudData.position, fromCloud: true };
            }
            
            return { position: localPosition, fromCloud: false };
            
        } catch (error) {
            console.error('Sync progress error:', error);
            return { position: localPosition, fromCloud: false };
        }
    }
    
    async deleteBookFromCloud(bookId) {
        if (!currentUser || !this.initialized) return false;
        
        this.setSyncStatus('syncing');
        
        try {
            const { doc, deleteDoc, collection, getDocs, query } = this._firestore;
            
            const chunksRef = collection(db, 'users', currentUser.uid, 'books', bookId, 'chunks');
            const chunksSnapshot = await getDocs(query(chunksRef));
            for (const chunkDoc of chunksSnapshot.docs) {
                await deleteDoc(chunkDoc.ref);
            }
            
            try {
                await deleteDoc(doc(db, 'users', currentUser.uid, 'books', bookId, 'meta', 'toc'));
                await deleteDoc(doc(db, 'users', currentUser.uid, 'books', bookId, 'meta', 'pageBreaks'));
            } catch (e) {
                console.log('Meta docs may not exist:', e);
            }
            
            await deleteDoc(doc(db, 'users', currentUser.uid, 'books', bookId));
            
            this.setSyncStatus('idle');
            return true;
            
        } catch (error) {
            console.error('Delete from cloud error:', error);
            this.setSyncStatus('error');
            return false;
        }
    }
    
    splitIntoChunks(text, chunkSize) {
        const chunks = [];
        let start = 0;
        
        while (start < text.length) {
            let end = Math.min(start + chunkSize, text.length);
            
            if (end < text.length) {
                const lastNewline = text.lastIndexOf('\n', end);
                if (lastNewline > start + chunkSize / 2) {
                    end = lastNewline + 1;
                }
            }
            
            chunks.push(text.slice(start, end));
            start = end;
        }
        
        return chunks;
    }
    
    flushPendingSync() {
        if (syncDebounceTimer) {
            clearTimeout(syncDebounceTimer);
            syncDebounceTimer = null;
        }
    }
}

/**
 * Firebase Configuration
 * 
 * SETUP INSTRUCTIONS:
 * 1. Go to https://console.firebase.google.com/
 * 2. Create a new project (or use an existing one)
 * 3. Add a web app to the project
 * 4. Copy the firebaseConfig object from the setup screen
 * 5. Replace the placeholder values below with your actual config
 * 
 * The app works fully offline without Firebase configured.
 * Cloud sync features are hidden until valid config is provided.
 */

export const firebaseConfig = {
    apiKey: "AIzaSyALI2wgpb3CaaaDdyVilqu564OF8FtEm7c",
    authDomain: "focusread-bd639.firebaseapp.com",
    projectId: "focusread-bd639",
    storageBucket: "focusread-bd639.firebasestorage.app",
    messagingSenderId: "778186617269",
    appId: "1:778186617269:web:2e4cc1a3a0510c70db69fc"
};

/**
 * Check if Firebase is configured
 * Returns true only if all required fields have non-empty values
 */
export function isFirebaseConfigured() {
    return !!(
        firebaseConfig.apiKey &&
        firebaseConfig.authDomain &&
        firebaseConfig.projectId &&
        firebaseConfig.appId
    );
}

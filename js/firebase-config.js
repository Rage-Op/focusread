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
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
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

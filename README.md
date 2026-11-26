# FocusRead - ADHD-Friendly PDF Book Reader

A web-based PDF reader designed for people with ADHD, featuring bionic reading, RSVP speed reading, and extensive accessibility options. Similar to the iOS app Outread.

**100% static site** — works on any free hosting (GitHub Pages, Netlify, Vercel, etc.) with no server required.

## Features

### 📖 PDF Import & Text Extraction
- Import any PDF book or article
- Client-side text extraction using pdf.js
- Smart text processing: joins broken lines, removes hyphens, filters headers/footers
- Progress indicator for large books
- Table of contents extraction from PDF outline

### 🧠 Bionic Reading
- Bolds the first part of each word to guide the eye
- Adjustable fixation strength (1-5)
- Scientifically inspired reading aid for faster comprehension

### ⚡ RSVP Speed Reading
- Rapid Serial Visual Presentation (one word at a time)
- Adjustable speed: 100-1000 WPM
- Play/pause with spacebar
- Navigate by word or sentence
- Optimal Recognition Point (ORP) highlighting
- Longer pauses on punctuation and long words

### 🎨 Themes
- **Light** - Clean white background
- **Dark** - Easy on the eyes at night
- **Sepia** - Warm, paper-like tone
- **System** - Follows your OS preference

### ♿ Accessibility
- **Fonts**: System, Atkinson Hyperlegible, OpenDyslexic, Lexend, Open Sans
- **Typography**: Font size, line height, letter/word spacing, max width, alignment
- **Focus aids**: Reading line highlight, high contrast mode
- **Text-to-Speech**: Web Speech API with voice and rate controls
- **Keyboard navigation**: Full keyboard support with visible focus
- **Reduced motion**: Respects system preference
- **ARIA labels**: Screen reader compatible

### 💾 Persistence
- Books stored in IndexedDB (supports large files)
- Settings saved in localStorage
- Resumes from your last reading position
- Book library with progress tracking

### 🔒 PIN Lock
- Simple 4-digit PIN for privacy
- Salted SHA-256 hash (Web Crypto API)
- "Forgot PIN" option (clears all data)
- **Note**: This is a client-side privacy lock, not real security

### 📱 Mobile & PWA
- Responsive layout for all screen sizes
- Installable as a Progressive Web App
- Offline support via Service Worker

### ☁️ Cloud Sync (Optional)
- Sign in with Google or Email/Password
- Sync your library across all devices
- Reading position syncs automatically
- Settings sync between devices
- Works fully offline when signed out
- Requires Firebase setup (see below)

## Screenshots

### PIN Lock Screen
![PIN Screen](/opt/cursor/artifacts/pin-screen.png)

### Reader - Light Mode
![Reader Light](/opt/cursor/artifacts/reader-light.png)

### Reader - Bionic Reading
![Reader Bionic](/opt/cursor/artifacts/reader-bionic.png)

### Reader - Dark Mode
![Reader Dark](/opt/cursor/artifacts/reader-dark.png)

### RSVP Speed Reading
![RSVP View](/opt/cursor/artifacts/rsvp-view.png)

## Hosting

### Option 1: GitHub Pages

1. Push this repository to GitHub
2. Go to **Settings → Pages**
3. Set Source to **Deploy from a branch**
4. Select `main` branch and `/ (root)` folder
5. Click **Save**
6. Your site will be live at `https://yourusername.github.io/repo-name`

### Option 2: Netlify

1. Go to [netlify.com](https://netlify.com) and sign in
2. Click **Add new site → Import an existing project**
3. Connect your GitHub repo
4. Build settings: leave blank (it's static)
5. Click **Deploy**
6. Your site will be live instantly

### Option 3: Vercel

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click **Add New → Project**
3. Import your GitHub repo
4. Framework Preset: **Other**
5. Click **Deploy**

### Option 4: Any Static Host

Simply upload all files to any web server or static hosting service:
- Cloudflare Pages
- Firebase Hosting
- Surge.sh
- Any Apache/Nginx server

## Local Development

```bash
# Using Python
python3 -m http.server 8000

# Using Node.js
npx serve

# Using PHP
php -S localhost:8000
```

Then open `http://localhost:8000` in your browser.

## Cloud Sync Setup (Optional)

Cloud sync is optional. The app works fully offline without it. To enable cloud sync:

### 1. Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **Add project**
3. Enter a project name (e.g., "focusread")
4. Disable Google Analytics (optional, not needed)
5. Click **Create project**

### 2. Add a Web App

1. In your project, click the **Web** icon (`</>`)
2. Enter an app nickname (e.g., "FocusRead Web")
3. Skip Firebase Hosting for now
4. Click **Register app**
5. Copy the `firebaseConfig` object — you'll need it later

### 3. Enable Authentication

1. Go to **Build → Authentication**
2. Click **Get started**
3. Under **Sign-in method**, enable:
   - **Google** (click, enable, add your email as support email, save)
   - **Email/Password** (click, enable, save)
4. Go to **Settings → Authorized domains**
5. Add your hosting domain: `yourusername.github.io` (or your custom domain)

### 4. Create Firestore Database

1. Go to **Build → Firestore Database**
2. Click **Create database**
3. Choose **Start in production mode**
4. Select a region close to your users
5. Click **Enable**

### 5. Set Firestore Security Rules

1. In Firestore, go to **Rules** tab
2. Replace the rules with the contents of `firestore.rules`:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

3. Click **Publish**

### 6. Add Firebase Config to App

1. Open `js/firebase-config.js`
2. Replace the empty strings with your Firebase config:

```javascript
export const firebaseConfig = {
    apiKey: "AIzaSy...",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abc123"
};
```

3. Deploy your site

### Cost

- **Spark plan (free)**: 1GB storage, 50K reads/day, 20K writes/day
- For personal use, the free tier is usually sufficient
- Cloud sync uses only Firestore (no Firebase Storage)

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/Pause RSVP |
| `B` | Toggle Bionic reading |
| `R` | Toggle RSVP mode |
| `S` | Toggle Text-to-Speech |
| `Ctrl/Cmd + F` | Search in book |
| `Escape` | Close panels/exit RSVP |

## Browser Support

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## Privacy Note

The PIN lock is designed for casual privacy (keeping curious eyes away), not security. The PIN hash is stored locally and can be bypassed by clearing browser data. For sensitive documents, use proper encryption tools.

## License

MIT License - feel free to use, modify, and distribute.

## Credits

- [PDF.js](https://mozilla.github.io/pdf.js/) - Mozilla's PDF rendering library
- [Atkinson Hyperlegible](https://brailleinstitute.org/freefont) - Braille Institute
- [OpenDyslexic](https://opendyslexic.org/) - Dyslexia-friendly font
- [Lexend](https://www.lexend.com/) - Variable font for reading

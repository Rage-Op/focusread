/**
 * Kokoro TTS Web Worker
 * Runs model loading and generation off the main thread
 */

let kokoro = null;
let isLoading = false;
let lastProgressTime = 0;

const MODEL_SIZE_MB = 300;

async function loadModel(voice) {
    if (isLoading) return;
    isLoading = true;
    
    try {
        self.postMessage({ type: 'progress', percent: 0, message: 'Initializing...', loadedMB: 0 });
        
        const { KokoroTTS } = await import('https://cdn.jsdelivr.net/npm/kokoro-js@1.1.0/+esm');
        
        self.postMessage({ type: 'progress', percent: 5, message: 'Loading model...', loadedMB: 0 });
        lastProgressTime = Date.now();
        
        kokoro = await KokoroTTS.from_pretrained(
            'onnx-community/Kokoro-82M-v1.0-ONNX',
            {
                dtype: 'q4',
                device: 'wasm',
                progress_callback: (progress) => {
                    lastProgressTime = Date.now();
                    const percent = Math.round(5 + progress.progress * 0.85);
                    const loadedMB = Math.round((progress.progress / 100) * MODEL_SIZE_MB);
                    
                    let message = 'Downloading model...';
                    if (progress.file) {
                        message = `Downloading: ${progress.file}`;
                    }
                    if (progress.loaded && progress.total) {
                        const fileMB = (progress.loaded / (1024 * 1024)).toFixed(1);
                        const totalMB = (progress.total / (1024 * 1024)).toFixed(1);
                        message = `Downloading: ${fileMB}/${totalMB} MB`;
                    }
                    
                    self.postMessage({ 
                        type: 'progress', 
                        percent, 
                        message,
                        loadedMB,
                        totalMB: MODEL_SIZE_MB
                    });
                }
            }
        );
        
        self.postMessage({ type: 'progress', percent: 95, message: 'Warming up...', loadedMB: MODEL_SIZE_MB });
        
        await kokoro.generate('Ready.', { voice: voice || 'af_heart' });
        
        isLoading = false;
        self.postMessage({ type: 'loaded', backend: 'wasm' });
        
    } catch (error) {
        isLoading = false;
        self.postMessage({ type: 'error', error: error.message });
    }
}

async function generate(text, voice, id) {
    if (!kokoro) {
        self.postMessage({ type: 'generate_error', id, error: 'Model not loaded' });
        return;
    }
    
    try {
        const audio = await kokoro.generate(text, { voice });
        const wavData = audio.toWav();
        
        let arrayBuffer;
        if (wavData instanceof ArrayBuffer) {
            arrayBuffer = wavData;
        } else if (wavData.buffer) {
            arrayBuffer = wavData.buffer.slice(wavData.byteOffset, wavData.byteOffset + wavData.byteLength);
        } else {
            arrayBuffer = new Uint8Array(wavData).buffer;
        }
        
        self.postMessage({ 
            type: 'audio', 
            id,
            wav: arrayBuffer
        }, [arrayBuffer]);
        
    } catch (error) {
        self.postMessage({ type: 'generate_error', id, error: error.message });
    }
}

self.onmessage = async (event) => {
    const { type, text, voice, id } = event.data;
    
    switch (type) {
        case 'load':
            await loadModel(voice);
            break;
            
        case 'generate':
            await generate(text, voice, id);
            break;
            
        case 'ping':
            self.postMessage({ type: 'pong', lastProgressTime });
            break;
    }
};

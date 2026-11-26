/**
 * Kokoro TTS Web Worker v7
 * Runs model loading and generation off the main thread
 * Limited CPU threads to prevent system freeze
 */

let kokoro = null;
let isLoading = false;
let lastProgressTime = 0;
let currentModelType = 'standard';

const MODELS = {
    standard: {
        dtype: 'q4',
        sizeMB: 95,
        name: 'Standard (95 MB)'
    },
    high: {
        dtype: 'q8',
        sizeMB: 170,
        name: 'High Quality (170 MB)'
    }
};

function getMaxThreads() {
    const cores = navigator.hardwareConcurrency || 4;
    
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const isLowEnd = cores <= 4;
    
    if (isMobile || isLowEnd) {
        return 1;
    }
    
    return Math.min(2, Math.max(1, Math.floor(cores / 4)));
}

async function loadModel(voice, modelType = 'standard') {
    if (isLoading) return;
    isLoading = true;
    currentModelType = modelType;
    
    const modelConfig = MODELS[modelType] || MODELS.standard;
    
    try {
        self.postMessage({ 
            type: 'progress', 
            percent: 0, 
            message: 'Initializing...', 
            loadedMB: 0,
            totalMB: modelConfig.sizeMB
        });
        
        const { KokoroTTS, env } = await import('https://cdn.jsdelivr.net/npm/kokoro-js@1.1.0/+esm');
        
        const maxThreads = getMaxThreads();
        if (env && env.backends && env.backends.onnx && env.backends.onnx.wasm) {
            env.backends.onnx.wasm.numThreads = maxThreads;
        }
        
        self.postMessage({ 
            type: 'progress', 
            percent: 5, 
            message: `Loading model (${maxThreads} thread${maxThreads > 1 ? 's' : ''})...`, 
            loadedMB: 0,
            totalMB: modelConfig.sizeMB
        });
        lastProgressTime = Date.now();
        
        kokoro = await KokoroTTS.from_pretrained(
            'onnx-community/Kokoro-82M-v1.0-ONNX',
            {
                dtype: modelConfig.dtype,
                device: 'wasm',
                progress_callback: (progress) => {
                    lastProgressTime = Date.now();
                    const percent = Math.round(5 + progress.progress * 0.90);
                    const loadedMB = Math.round((progress.progress / 100) * modelConfig.sizeMB);
                    
                    let message = 'Downloading model...';
                    if (progress.loaded && progress.total) {
                        const fileMB = (progress.loaded / (1024 * 1024)).toFixed(1);
                        const totalMB = (progress.total / (1024 * 1024)).toFixed(1);
                        message = `Downloading: ${fileMB} / ${totalMB} MB`;
                    }
                    
                    self.postMessage({ 
                        type: 'progress', 
                        percent, 
                        message,
                        loadedMB,
                        totalMB: modelConfig.sizeMB
                    });
                }
            }
        );
        
        self.postMessage({ 
            type: 'progress', 
            percent: 97, 
            message: 'Preparing voice...', 
            loadedMB: modelConfig.sizeMB,
            totalMB: modelConfig.sizeMB
        });
        
        await kokoro.generate('Ready.', { voice: voice || 'af_heart' });
        
        isLoading = false;
        self.postMessage({ type: 'loaded', backend: 'wasm', modelType: currentModelType });
        
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
        await new Promise(resolve => setTimeout(resolve, 10));
        
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
        
        await new Promise(resolve => setTimeout(resolve, 5));
        
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
    const { type, text, voice, id, modelType } = event.data;
    
    switch (type) {
        case 'load':
            await loadModel(voice, modelType);
            break;
            
        case 'generate':
            await generate(text, voice, id);
            break;
            
        case 'ping':
            self.postMessage({ type: 'pong', lastProgressTime });
            break;
            
        case 'get_model_info':
            self.postMessage({ 
                type: 'model_info', 
                models: MODELS,
                currentType: currentModelType,
                isLoaded: !!kokoro
            });
            break;
    }
};

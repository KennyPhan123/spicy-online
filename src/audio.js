const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const buffers = {};
const activeSources = {};

const soundFiles = {
    deal: ['/sounds/card flip 2.wav'],
    flip: ['/sounds/card flip 2.wav']
};

export async function initAudio() {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    for (const [type, files] of Object.entries(soundFiles)) {
        for (const file of files) {
            try {
                const response = await fetch(file);
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                buffers[file] = audioBuffer;
            } catch (e) {
                console.error('Failed to load audio:', file, e);
            }
        }
    }
}

export function playSound(type, targetDuration = null) {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    
    const files = soundFiles[type];
    if (!files || files.length === 0) return;
    
    const file = files[Math.floor(Math.random() * files.length)];
    const buffer = buffers[file];
    
    if (!buffer) return;
    
    if (!activeSources[type]) activeSources[type] = 0;
    if (activeSources[type] >= 3) return; // Limit to 3 overlapping sounds
    
    activeSources[type]++;
    
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    
    if (targetDuration) {
        const rate = buffer.duration / targetDuration;
        source.playbackRate.value = rate;
    }
    
    source.connect(audioCtx.destination);
    source.start(0);
    
    source.onended = () => {
        activeSources[type]--;
    };
}

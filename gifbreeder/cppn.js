/**
 * CPPN Implementation - Based on nbenko1's PicBreeder
 */

const ActivationFunctions = {
    sigmoid: (x) => 1 / (1 + Math.exp(-x)),
    tanh: (x) => Math.tanh(x),
    gaussian: (x) => Math.exp(-x * x),
    sin: (x) => Math.sin(x),
    cos: (x) => Math.cos(x),
    abs: (x) => Math.abs(x),
    relu: (x) => Math.max(0, x),
    identity: (x) => x
};

// Output modes (like PicBreeder)
const OUTPUT_MODE = 0; // 0=sigmoid, 1=gaussian, 2=tanh+abs
const GIF_FRAME_RATE = 15;
const GIF_DURATION_SECONDS = 3;
const GIF_FRAME_COUNT = GIF_FRAME_RATE * GIF_DURATION_SECONDS; // 45 frames (t = 0..44)
const GIF_RESOLUTION = 64;
const GIF_FRAME_DURATION_MS = 1000 / GIF_FRAME_RATE;
const CPPN_OUTPUT_COLOR_MODE_STORAGE_KEY = 'cppn-output-color-mode-v1';
const CPPN_LEGACY_OUTPUT_LABEL_MAP = {
    H: 'R',
    S: 'G',
    V: 'B'
};
const CPPN_OUTPUT_DISPLAY_LABEL_MAP = {
    R: 'H',
    G: 'S',
    B: 'V'
};

function clampChannel01(value) {
    return Math.max(0, Math.min(1, value));
}

function normalizeCPPNOutputLabel(label) {
    if (typeof label !== 'string') return label;
    return CPPN_LEGACY_OUTPUT_LABEL_MAP[label] || label;
}

function normalizeOutputColorMode(mode) {
    return mode === 'hsv' ? 'hsv' : 'rgb';
}

function loadPersistedOutputColorMode() {
    try {
        return normalizeOutputColorMode(localStorage.getItem(CPPN_OUTPUT_COLOR_MODE_STORAGE_KEY));
    } catch (error) {
        return 'hsv';
    }
}

let cachedOutputColorMode = null;

function getCurrentOutputColorMode() {
    if (!cachedOutputColorMode) {
        cachedOutputColorMode = loadPersistedOutputColorMode();
    }
    return cachedOutputColorMode;
}

function persistOutputColorMode(mode) {
    try {
        localStorage.setItem(CPPN_OUTPUT_COLOR_MODE_STORAGE_KEY, normalizeOutputColorMode(mode));
    } catch (error) {
        // Ignore storage failures.
    }
}

const OutputColorModeManager = {
    getMode() {
        return getCurrentOutputColorMode();
    },

    setMode(nextMode, options = {}) {
        cachedOutputColorMode = normalizeOutputColorMode(nextMode);

        if (options.persist !== false) {
            persistOutputColorMode(cachedOutputColorMode);
        }

        if (typeof window !== 'undefined'
            && typeof window.dispatchEvent === 'function'
            && typeof CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent('cppn-output-mode-change', {
                detail: {
                    mode: cachedOutputColorMode,
                    reason: typeof options.reason === 'string' ? options.reason : null
                }
            }));
        }

        return cachedOutputColorMode;
    }
};

function getCPPNDisplayNodeLabel(node, mode = null) {
    if (!node || typeof node !== 'object') return '';
    if (node.type !== 'output' || typeof node.label !== 'string') {
        return typeof node.label === 'string' ? node.label : '';
    }

    const resolvedMode = normalizeOutputColorMode(mode || OutputColorModeManager.getMode());
    if (resolvedMode === 'rgb') return node.label;
    return CPPN_OUTPUT_DISPLAY_LABEL_MAP[node.label] || node.label;
}

function normalizeCPPNTimeInput(value) {
    if (!Number.isFinite(value)) return 0;
    if (Math.abs(value) <= 1) return value;
    return value / Math.max(GIF_FRAME_COUNT - 1, 1);
}

function hsvToDisplayRgb(h, s, v) {
    const hue = ((clampChannel01(h) % 1) + 1) % 1;
    const saturation = clampChannel01(s);
    const value = clampChannel01(v);

    if (saturation === 0) {
        return { r: value, g: value, b: value };
    }

    const scaledHue = hue * 6;
    const sector = Math.floor(scaledHue);
    const fraction = scaledHue - sector;
    const p = value * (1 - saturation);
    const q = value * (1 - fraction * saturation);
    const t = value * (1 - (1 - fraction) * saturation);

    switch (sector % 6) {
        case 0: return { r: value, g: t, b: p };
        case 1: return { r: q, g: value, b: p };
        case 2: return { r: p, g: value, b: t };
        case 3: return { r: p, g: q, b: value };
        case 4: return { r: t, g: p, b: value };
        default: return { r: value, g: p, b: q };
    }
}

function buildGif332Palette() {
    const palette = new Uint8Array(256 * 3);

    for (let index = 0; index < 256; index++) {
        const r = (index >> 5) & 0x07;
        const g = (index >> 2) & 0x07;
        const b = index & 0x03;
        const offset = index * 3;

        palette[offset] = Math.round((r / 7) * 255);
        palette[offset + 1] = Math.round((g / 7) * 255);
        palette[offset + 2] = Math.round((b / 3) * 255);
    }

    return palette;
}

const GIF_332_PALETTE = buildGif332Palette();

function rgbToGif332Index(r, g, b) {
    const red = (r >> 5) & 0x07;
    const green = (g >> 5) & 0x07;
    const blue = (b >> 6) & 0x03;
    return (red << 5) | (green << 2) | blue;
}

function imageDataToGif332Indices(imageData) {
    const source = imageData.data || imageData;
    const pixelCount = Math.floor(source.length / 4);
    const indices = new Uint8Array(pixelCount);

    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
        const offset = pixelIndex * 4;
        indices[pixelIndex] = rgbToGif332Index(source[offset], source[offset + 1], source[offset + 2]);
    }

    return indices;
}

class GifByteWriter {
    constructor() {
        this.bytes = [];
    }

    writeByte(value) {
        this.bytes.push(value & 0xFF);
    }

    writeBytes(values) {
        for (const value of values) {
            this.writeByte(value);
        }
    }

    writeAscii(text) {
        for (let index = 0; index < text.length; index++) {
            this.writeByte(text.charCodeAt(index));
        }
    }

    writeUInt16LE(value) {
        this.writeByte(value & 0xFF);
        this.writeByte((value >> 8) & 0xFF);
    }

    toUint8Array() {
        return Uint8Array.from(this.bytes);
    }
}

function createGifBitWriter() {
    const bytes = [];
    let currentByte = 0;
    let bitOffset = 0;

    return {
        write(code, size) {
            let value = code;
            let remaining = size;

            while (remaining > 0) {
                currentByte |= (value & 1) << bitOffset;
                value >>= 1;
                bitOffset += 1;
                remaining -= 1;

                if (bitOffset === 8) {
                    bytes.push(currentByte);
                    currentByte = 0;
                    bitOffset = 0;
                }
            }
        },

        finish() {
            if (bitOffset > 0) {
                bytes.push(currentByte);
            }

            return Uint8Array.from(bytes);
        }
    };
}

function lzwEncodeGifIndices(indices, minimumCodeSize = 8) {
    const clearCode = 1 << minimumCodeSize;
    const endCode = clearCode + 1;
    const bitWriter = createGifBitWriter();

    let dictionary = new Map();
    let nextCode = endCode + 1;
    let codeSize = minimumCodeSize + 1;

    const resetDictionary = () => {
        dictionary = new Map();
        for (let code = 0; code < clearCode; code++) {
            dictionary.set(String(code), code);
        }
        nextCode = endCode + 1;
        codeSize = minimumCodeSize + 1;
    };

    resetDictionary();
    bitWriter.write(clearCode, codeSize);

    let prefix = String(indices[0] || 0);

    for (let index = 1; index < indices.length; index++) {
        const value = indices[index];
        const candidate = `${prefix},${value}`;

        if (dictionary.has(candidate)) {
            prefix = candidate;
            continue;
        }

        bitWriter.write(dictionary.get(prefix), codeSize);

        if (nextCode < 4096) {
            dictionary.set(candidate, nextCode);
            nextCode += 1;

            if (nextCode === (1 << codeSize) && codeSize < 12) {
                codeSize += 1;
            }
        } else {
            bitWriter.write(clearCode, codeSize);
            resetDictionary();
        }

        prefix = String(value);
    }

    bitWriter.write(dictionary.get(prefix), codeSize);
    bitWriter.write(endCode, codeSize);

    return bitWriter.finish();
}

function writeGifSubBlocks(writer, bytes) {
    for (let offset = 0; offset < bytes.length; offset += 255) {
        const chunk = bytes.slice(offset, offset + 255);
        writer.writeByte(chunk.length);
        writer.writeBytes(chunk);
    }

    writer.writeByte(0);
}

function encodeGifFrames(width, height, indexedFrames, options = {}) {
    const delayCs = Math.max(1, Math.round((options.frameDurationMs || GIF_FRAME_DURATION_MS) / 10));
    const loopCount = Number.isInteger(options.loopCount) && options.loopCount >= 0
        ? options.loopCount
        : 0;
    const writer = new GifByteWriter();

    writer.writeAscii('GIF89a');
    writer.writeUInt16LE(width);
    writer.writeUInt16LE(height);
    writer.writeByte(0xF7);
    writer.writeByte(0);
    writer.writeByte(0);
    writer.writeBytes(GIF_332_PALETTE);

    writer.writeByte(0x21);
    writer.writeByte(0xFF);
    writer.writeByte(11);
    writer.writeAscii('NETSCAPE2.0');
    writer.writeByte(3);
    writer.writeByte(1);
    writer.writeUInt16LE(loopCount);
    writer.writeByte(0);

    for (const frameIndices of indexedFrames) {
        writer.writeByte(0x21);
        writer.writeByte(0xF9);
        writer.writeByte(4);
        writer.writeByte(0);
        writer.writeUInt16LE(delayCs);
        writer.writeByte(0);
        writer.writeByte(0);

        writer.writeByte(0x2C);
        writer.writeUInt16LE(0);
        writer.writeUInt16LE(0);
        writer.writeUInt16LE(width);
        writer.writeUInt16LE(height);
        writer.writeByte(0);

        writer.writeByte(8);
        writeGifSubBlocks(writer, lzwEncodeGifIndices(frameIndices, 8));
    }

    writer.writeByte(0x3B);
    return writer.toUint8Array();
}

class CPPNNetwork {
    constructor(genome) {
        this.genome = genome;
        this.nodes = new Map();
        this.sortedNodes = [];
        this.outputColorMode = OutputColorModeManager.getMode();
        this.buildNetwork();
    }

    buildNetwork() {
        for (const [id, nodeGene] of this.genome.nodes) {
            this.nodes.set(id, {
                id: id,
                type: nodeGene.type,
                activation: ActivationFunctions[nodeGene.activation] || ActivationFunctions.sigmoid,
                activationName: nodeGene.activation,
                label: nodeGene.label,
                inputConnections: [],
                value: 0
            });
        }

        for (const conn of this.genome.connections) {
            if (!conn.enabled) continue;
            const toNode = this.nodes.get(conn.toId);
            if (toNode && this.nodes.has(conn.fromId)) {
                toNode.inputConnections.push({
                    fromId: conn.fromId,
                    weight: conn.weight
                });
            }
        }

        this.sortedNodes = this.topologicalSort();
    }

    topologicalSort() {
        const visited = new Set();
        const result = [];

        const visit = (nodeId) => {
            if (visited.has(nodeId)) return;
            visited.add(nodeId);

            const node = this.nodes.get(nodeId);
            if (!node) return;

            for (const conn of node.inputConnections) {
                visit(conn.fromId);
            }

            result.push(node);
        };

        for (const node of this.nodes.values()) {
            if (node.type === 'output') {
                visit(node.id);
            }
        }

        return result;
    }

    activate(x, y, t = 0) {
        // GifBreeder inputs: x, y, distance, t, bias(=1)
        const d = Math.sqrt(x * x + y * y);
        const normalizedTime = normalizeCPPNTimeInput(t);

        for (const node of this.nodes.values()) {
            if (node.type === 'input') {
                switch (node.label) {
                    case 'x': node.value = x; break;
                    case 'y': node.value = y; break;
                    case 'd': node.value = d; break;
                    case 't': node.value = normalizedTime; break;
                    case 'bias': node.value = 1.0; break;
                    default: node.value = 0.0; break;
                }
            }
        }

        // Forward propagation
        for (const node of this.sortedNodes) {
            if (node.type === 'input') continue;

            let sum = 0;
            for (const conn of node.inputConnections) {
                const fromNode = this.nodes.get(conn.fromId);
                if (fromNode) {
                    sum += fromNode.value * conn.weight;
                }
            }

            node.value = node.activation(sum);
        }

        // Interpret the three output channels as RGB or HSV using the existing R/G/B nodes.
        let firstChannel = 0.5;
        let secondChannel = 0.5;
        let thirdChannel = 0.5;

        for (const node of this.nodes.values()) {
            if (node.type === 'output') {
                let val = node.value;

                // Apply output activation (PicBreeder style)
                if (OUTPUT_MODE === 0) {
                    val = ActivationFunctions.sigmoid(val);
                } else if (OUTPUT_MODE === 1) {
                    val = ActivationFunctions.gaussian(val);
                } else {
                    val = Math.abs(ActivationFunctions.tanh(val));
                }

                switch (normalizeCPPNOutputLabel(node.label)) {
                    case 'R': firstChannel = val; break;
                    case 'G': secondChannel = val; break;
                    case 'B': thirdChannel = val; break;
                }
            }
        }

        if (this.outputColorMode === 'hsv') {
            return hsvToDisplayRgb(firstChannel, secondChannel, thirdChannel);
        }

        return { r: firstChannel, g: secondChannel, b: thirdChannel };
    }
}

class CPPNRenderer {
    constructor() {
        this.activeAnimations = new WeakMap();
    }

    stopCanvasAnimation(canvas) {
        const existingState = this.activeAnimations.get(canvas);
        if (!existingState) return;
        if (Number.isInteger(existingState.rafId)) {
            cancelAnimationFrame(existingState.rafId);
        }
        this.activeAnimations.delete(canvas);
    }

    ensureCanvasSize(canvas, width, height) {
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
    }

    renderFrameToImageData(network, ctx, width, height, timestep) {
        const imageData = ctx.createImageData(width, height);
        const data = imageData.data;
        const scale = 1.0;

        for (let py = 0; py < height; py++) {
            for (let px = 0; px < width; px++) {
                const x = (px / width - 0.5) * scale;
                const y = (py / height - 0.5) * scale;
                const rgb = network.activate(x, y, timestep);

                const idx = (py * width + px) * 4;
                data[idx] = Math.round(clampChannel01(rgb.r) * 255);
                data[idx + 1] = Math.round(clampChannel01(rgb.g) * 255);
                data[idx + 2] = Math.round(clampChannel01(rgb.b) * 255);
                data[idx + 3] = 255;
            }
        }

        return imageData;
    }

    drawFrame(state, frameIndex) {
        if (!state.cachedFrames[frameIndex]) {
            state.cachedFrames[frameIndex] = this.renderFrameToImageData(
                state.network,
                state.ctx,
                state.width,
                state.height,
                frameIndex
            );
        }

        state.ctx.putImageData(state.cachedFrames[frameIndex], 0, 0);
    }

    render(genome, canvas, resolution = GIF_RESOLUTION, timestep = 0) {
        this.stopCanvasAnimation(canvas);

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = resolution || GIF_RESOLUTION;
        const height = resolution || GIF_RESOLUTION;
        this.ensureCanvasSize(canvas, width, height);
        const network = new CPPNNetwork(genome);
        const boundedTimestep = Math.max(0, Math.min(GIF_FRAME_COUNT - 1, Math.floor(timestep)));
        const imageData = this.renderFrameToImageData(network, ctx, width, height, boundedTimestep);
        ctx.putImageData(imageData, 0, 0);
    }

    renderProgressive(genome, canvas, onComplete) {
        this.stopCanvasAnimation(canvas);

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = GIF_RESOLUTION;
        const height = GIF_RESOLUTION;
        this.ensureCanvasSize(canvas, width, height);

        const state = {
            token: Symbol('gif-loop'),
            ctx,
            network: new CPPNNetwork(genome),
            width,
            height,
            cachedFrames: new Array(GIF_FRAME_COUNT),
            lastFrameIndex: -1,
            startTime: performance.now(),
            rafId: null
        };
        this.activeAnimations.set(canvas, state);

        this.drawFrame(state, 0);
        state.lastFrameIndex = 0;
        if (typeof onComplete === 'function') onComplete();

        const tick = (timestamp) => {
            const currentState = this.activeAnimations.get(canvas);
            if (!currentState || currentState.token !== state.token) return;

            const elapsed = timestamp - currentState.startTime;
            const frameIndex = Math.floor(elapsed / GIF_FRAME_DURATION_MS) % GIF_FRAME_COUNT;
            if (frameIndex !== currentState.lastFrameIndex) {
                this.drawFrame(currentState, frameIndex);
                currentState.lastFrameIndex = frameIndex;
            }

            currentState.rafId = requestAnimationFrame(tick);
        };

        state.rafId = requestAnimationFrame(tick);
    }

    createGifBlob(genome, options = {}) {
        const width = Number.isInteger(options.resolution) && options.resolution > 0
            ? options.resolution
            : GIF_RESOLUTION;
        const height = width;
        const frameCount = Number.isInteger(options.frameCount) && options.frameCount > 0
            ? options.frameCount
            : GIF_FRAME_COUNT;
        const frameDurationMs = Number.isFinite(options.frameDurationMs) && options.frameDurationMs > 0
            ? options.frameDurationMs
            : GIF_FRAME_DURATION_MS;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Could not create GIF rendering context.');
        }

        const network = new CPPNNetwork(genome);
        const indexedFrames = [];

        for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
            const imageData = this.renderFrameToImageData(network, ctx, width, height, frameIndex);
            indexedFrames.push(imageDataToGif332Indices(imageData));
        }

        const gifBytes = encodeGifFrames(width, height, indexedFrames, {
            frameDurationMs,
            loopCount: 0
        });

        return new Blob([gifBytes], { type: 'image/gif' });
    }

    stopAllAnimations() {
        for (const canvas of document.querySelectorAll('canvas')) {
            this.stopCanvasAnimation(canvas);
        }
    }
}

class NetworkVisualizer {
    constructor(svgElement, options = {}) {
        this.svg = svgElement;
        this.nodeRadius = 16;
        this.padding = 40;
        this.minScale = 0.35;
        this.maxScale = 4.0;
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.worldWidth = 1;
        this.worldHeight = 1;
        this.contentGroup = null;
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.startOffsetX = 0;
        this.startOffsetY = 0;
        this.currentGenome = null;
        this.connectionElements = new Map();
        this.connectionHitElements = new Map();
        this.connectionMeta = new Map();
        this.selectedConnectionIndex = null;
        this.hoveredConnectionIndex = null;
        this.hoverTooltip = null;
        this.hoverTooltipRect = null;
        this.hoverTooltipText = null;
        this.interactive = Boolean(options.interactive);
        this.onConnectionSelected = typeof options.onConnectionSelected === 'function'
            ? options.onConnectionSelected
            : null;
        this.onConnectionWeightChanged = typeof options.onConnectionWeightChanged === 'function'
            ? options.onConnectionWeightChanged
            : null;

        if (this.interactive) {
            this.bindInteractions();
        }
    }

    bindInteractions() {
        this.svg.addEventListener('wheel', (event) => {
            if (!this.contentGroup) return;

            event.preventDefault();
            const rect = this.svg.getBoundingClientRect();
            const anchor = {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
            };
            const zoomFactor = event.deltaY < 0 ? 1.12 : 0.88;
            this.setScale(this.scale * zoomFactor, anchor);
        }, { passive: false });

        this.svg.addEventListener('mousedown', (event) => {
            if (!this.contentGroup || event.button !== 0) return;

            event.preventDefault();
            this.isDragging = true;
            this.dragStartX = event.clientX;
            this.dragStartY = event.clientY;
            this.startOffsetX = this.offsetX;
            this.startOffsetY = this.offsetY;
            this.svg.classList.add('dragging');
        });

        this.svg.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof SVGElement)) return;

            if (target.dataset.connIndex !== undefined) return;
            this.selectConnection(null);
        });

        this.svg.addEventListener('mouseleave', () => {
            this.setHoveredConnection(null);
        });

        window.addEventListener('mousemove', (event) => {
            if (!this.isDragging || !this.contentGroup) return;

            const dx = event.clientX - this.dragStartX;
            const dy = event.clientY - this.dragStartY;
            this.offsetX = this.startOffsetX + dx;
            this.offsetY = this.startOffsetY + dy;
            this.applyTransform();
        });

        window.addEventListener('mouseup', () => {
            if (!this.isDragging) return;
            this.isDragging = false;
            this.svg.classList.remove('dragging');
        });
    }

    clear() {
        this.svg.innerHTML = '';
        this.contentGroup = null;
        this.currentGenome = null;
        this.connectionElements = new Map();
        this.connectionHitElements = new Map();
        this.connectionMeta = new Map();
        this.selectedConnectionIndex = null;
        this.hoveredConnectionIndex = null;
        this.hoverTooltip = null;
        this.hoverTooltipRect = null;
        this.hoverTooltipText = null;
    }

    getWeightBounds() {
        const fallback = { min: -3, max: 3 };
        if (!window.NEAT || !window.NEAT.CONFIG) return fallback;

        const min = Number.isFinite(window.NEAT.CONFIG.weightMin) ? window.NEAT.CONFIG.weightMin : fallback.min;
        const max = Number.isFinite(window.NEAT.CONFIG.weightMax) ? window.NEAT.CONFIG.weightMax : fallback.max;
        return { min, max };
    }

    getConnectionStrokeWidth(weight) {
        return Math.min(Math.abs(weight) * 1.2 + 0.9, 5.5);
    }

    getConnectionHitWidth(weight) {
        return this.getConnectionStrokeWidth(weight) * 2;
    }

    setHoveredConnection(connectionIndex) {
        if (connectionIndex !== null && !this.connectionElements.has(connectionIndex)) {
            connectionIndex = null;
        }

        if (this.hoveredConnectionIndex === connectionIndex) {
            if (connectionIndex !== null) this.updateHoverTooltip(connectionIndex);
            return;
        }

        this.hoveredConnectionIndex = connectionIndex;
        this.refreshConnectionStyles();
        this.updateHoverTooltip(connectionIndex);
    }

    updateHoverTooltip(connectionIndex) {
        if (!this.hoverTooltip || !this.hoverTooltipRect || !this.hoverTooltipText) return;
        if (connectionIndex === null || !this.currentGenome) {
            this.hoverTooltip.setAttribute('display', 'none');
            return;
        }

        const conn = this.currentGenome.connections[connectionIndex];
        const meta = this.connectionMeta.get(connectionIndex);
        if (!conn || !meta) {
            this.hoverTooltip.setAttribute('display', 'none');
            return;
        }

        const weightText = `w ${conn.weight.toFixed(3)}`;
        const textWidth = Math.max(30, weightText.length * 6.2);
        const boxHeight = 16;
        const x = meta.midX - textWidth / 2;
        const y = meta.midY - 20;

        this.hoverTooltipText.textContent = weightText;
        this.hoverTooltipText.setAttribute('x', (x + 4).toFixed(2));
        this.hoverTooltipText.setAttribute('y', (y + 11).toFixed(2));

        this.hoverTooltipRect.setAttribute('x', x.toFixed(2));
        this.hoverTooltipRect.setAttribute('y', y.toFixed(2));
        this.hoverTooltipRect.setAttribute('width', (textWidth + 8).toFixed(2));
        this.hoverTooltipRect.setAttribute('height', boxHeight.toFixed(2));
        this.hoverTooltip.setAttribute('display', 'block');
    }

    updateConnectionStyle(connectionIndex) {
        const line = this.connectionElements.get(connectionIndex);
        const hitLine = this.connectionHitElements.get(connectionIndex);
        const conn = this.currentGenome && this.currentGenome.connections
            ? this.currentGenome.connections[connectionIndex]
            : null;
        if (!line || !conn) return;

        const isSelected = connectionIndex === this.selectedConnectionIndex;
        const isHovered = connectionIndex === this.hoveredConnectionIndex;
        const isPositive = conn.weight >= 0;
        const strokeWidth = this.getConnectionStrokeWidth(conn.weight);
        const hitWidth = this.getConnectionHitWidth(conn.weight);

        line.style.stroke = (isSelected || isHovered) ? 'var(--accent)' : 'var(--fg)';
        line.setAttribute('stroke-width', strokeWidth.toFixed(2));
        line.setAttribute('stroke-opacity', isSelected ? '0.95' : (isHovered ? '0.78' : (isPositive ? '0.62' : '0.28')));

        if (hitLine) {
            hitLine.setAttribute('stroke-width', hitWidth.toFixed(2));
        }
    }

    refreshConnectionStyles() {
        for (const connectionIndex of this.connectionElements.keys()) {
            this.updateConnectionStyle(connectionIndex);
        }
    }

    selectConnection(connectionIndex, shouldNotify = true) {
        if (connectionIndex !== null && !this.connectionElements.has(connectionIndex)) {
            connectionIndex = null;
        }

        this.selectedConnectionIndex = connectionIndex;
        this.refreshConnectionStyles();

        if (!shouldNotify || !this.onConnectionSelected) return;
        const conn = connectionIndex === null ? null : this.currentGenome.connections[connectionIndex];
        this.onConnectionSelected(conn, connectionIndex);
    }

    setConnectionWeight(connectionIndex, nextWeight) {
        if (!this.currentGenome || !this.currentGenome.connections) return null;

        const conn = this.currentGenome.connections[connectionIndex];
        if (!conn || !conn.enabled || !Number.isFinite(nextWeight)) return null;

        const bounds = this.getWeightBounds();
        conn.weight = Math.max(bounds.min, Math.min(bounds.max, nextWeight));
        this.updateConnectionStyle(connectionIndex);
        if (connectionIndex === this.hoveredConnectionIndex) {
            this.updateHoverTooltip(connectionIndex);
        }

        if (this.onConnectionWeightChanged) {
            this.onConnectionWeightChanged(conn, connectionIndex);
        }

        return conn;
    }

    nudgeConnection(connectionIndex, delta) {
        if (!this.currentGenome || !this.currentGenome.connections) return null;

        const conn = this.currentGenome.connections[connectionIndex];
        if (!conn) return null;
        return this.setConnectionWeight(connectionIndex, conn.weight + delta);
    }

    nudgeSelectedConnection(delta) {
        if (this.selectedConnectionIndex === null) return null;
        return this.nudgeConnection(this.selectedConnectionIndex, delta);
    }

    zoomIn() {
        this.setScale(this.scale * 1.15);
    }

    zoomOut() {
        this.setScale(this.scale / 1.15);
    }

    pan(dx, dy) {
        if (!this.contentGroup) return;
        this.offsetX += dx;
        this.offsetY += dy;
        this.applyTransform();
    }

    setScale(nextScale, anchor = null) {
        if (!this.contentGroup) return;

        const clamped = Math.max(this.minScale, Math.min(this.maxScale, nextScale));
        const oldScale = this.scale || 1;
        const width = this.svg.clientWidth || 320;
        const height = this.svg.clientHeight || 300;
        const pivot = anchor || { x: width / 2, y: height / 2 };
        const worldX = (pivot.x - this.offsetX) / oldScale;
        const worldY = (pivot.y - this.offsetY) / oldScale;

        this.scale = clamped;
        this.offsetX = pivot.x - worldX * this.scale;
        this.offsetY = pivot.y - worldY * this.scale;
        this.applyTransform();
    }

    applyTransform() {
        if (!this.contentGroup) return;

        this.contentGroup.setAttribute(
            'transform',
            `translate(${this.offsetX}, ${this.offsetY}) scale(${this.scale})`
        );
    }

    resetView() {
        if (!this.contentGroup) return;

        const width = this.svg.clientWidth || 320;
        const height = this.svg.clientHeight || 300;
        const fitX = width / Math.max(this.worldWidth, 1);
        const fitY = height / Math.max(this.worldHeight, 1);
        const fitScale = Math.min(fitX, fitY, 1);

        this.scale = Math.max(this.minScale, Math.min(this.maxScale, fitScale));
        this.offsetX = (width - this.worldWidth * this.scale) / 2;
        this.offsetY = (height - this.worldHeight * this.scale) / 2;
        this.applyTransform();
    }

    visualize(genome, options = {}) {
        const preserveView = Boolean(options.preserveView);
        const preserveSelection = options.preserveSelection !== false;
        const previousView = {
            scale: this.scale,
            offsetX: this.offsetX,
            offsetY: this.offsetY
        };
        const previousSelection = preserveSelection ? this.selectedConnectionIndex : null;

        this.clear();
        this.currentGenome = genome;

        const width = this.svg.clientWidth || 320;
        const height = this.svg.clientHeight || 300;
        this.worldWidth = width;
        this.worldHeight = height;
        this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

        const layers = genome.getLayers();
        const layerCount = layers.length;
        const nodePositions = new Map();
        const layerWidth = (width - 2 * this.padding) / Math.max(layerCount - 1, 1);

        layers.forEach((layer, layerIndex) => {
            const x = this.padding + layerIndex * layerWidth;
            const nodeCount = layer.nodes.length;
            const nodeSpacing = (height - 2 * this.padding) / Math.max(nodeCount + 1, 2);

            layer.nodes.forEach((node, nodeIndex) => {
                const y = this.padding + (nodeIndex + 1) * nodeSpacing;
                nodePositions.set(node.id, { x, y, node });
            });
        });

        const rootGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const connsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const hitsGroup = this.interactive ? document.createElementNS('http://www.w3.org/2000/svg', 'g') : null;
        this.hoveredConnectionIndex = null;

        genome.connections.forEach((conn, connectionIndex) => {
            if (!conn.enabled) return;

            const fromPos = nodePositions.get(conn.fromId);
            const toPos = nodePositions.get(conn.toId);
            if (!fromPos || !toPos) return;

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', fromPos.x);
            line.setAttribute('y1', fromPos.y);
            line.setAttribute('x2', toPos.x);
            line.setAttribute('y2', toPos.y);
            line.setAttribute('stroke-linecap', 'round');
            line.setAttribute('pointer-events', this.interactive ? 'none' : 'auto');
            this.connectionElements.set(connectionIndex, line);

            if (this.interactive) {
                const hitLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                hitLine.setAttribute('x1', fromPos.x);
                hitLine.setAttribute('y1', fromPos.y);
                hitLine.setAttribute('x2', toPos.x);
                hitLine.setAttribute('y2', toPos.y);
                hitLine.dataset.connIndex = String(connectionIndex);
                hitLine.setAttribute('stroke', 'transparent');
                hitLine.setAttribute('stroke-opacity', '0');
                hitLine.setAttribute('stroke-linecap', 'round');
                hitLine.setAttribute('cursor', 'pointer');
                this.connectionHitElements.set(connectionIndex, hitLine);
                this.connectionMeta.set(connectionIndex, {
                    midX: (fromPos.x + toPos.x) / 2,
                    midY: (fromPos.y + toPos.y) / 2
                });

                hitLine.addEventListener('mouseenter', () => {
                    this.setHoveredConnection(connectionIndex);
                });
                hitLine.addEventListener('mouseleave', () => {
                    this.setHoveredConnection(null);
                });
                hitLine.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.selectConnection(connectionIndex);
                });

                hitsGroup.appendChild(hitLine);
            }

            this.updateConnectionStyle(connectionIndex);

            connsGroup.appendChild(line);
        });

        rootGroup.appendChild(connsGroup);
        if (hitsGroup) {
            rootGroup.appendChild(hitsGroup);
        }

        const nodesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');

        for (const [, pos] of nodePositions) {
            const node = pos.node;
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', pos.x);
            circle.setAttribute('cy', pos.y);
            circle.setAttribute('r', this.nodeRadius);
            circle.style.fill = node.type === 'hidden' ? 'var(--fg)' : 'var(--bg)';
            circle.style.stroke = 'var(--fg)';
            circle.setAttribute('stroke-width', 1);
            nodesGroup.appendChild(circle);

            const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.setAttribute('x', pos.x);
            label.setAttribute('y', pos.y + 4);
            label.setAttribute('text-anchor', 'middle');
            label.style.fill = node.type === 'hidden' ? 'var(--bg)' : 'var(--fg)';
            label.setAttribute('font-size', '10px');

            const displayLabel = getCPPNDisplayNodeLabel(node);
            if (displayLabel) {
                label.textContent = displayLabel;
            } else if (node.type === 'hidden') {
                label.textContent = node.activation.substring(0, 3);
            }

            nodesGroup.appendChild(label);

            if (node.type === 'hidden') {
                const actLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                actLabel.setAttribute('x', pos.x);
                actLabel.setAttribute('y', pos.y + this.nodeRadius + 12);
                actLabel.setAttribute('text-anchor', 'middle');
                actLabel.style.fill = 'var(--fg)';
                actLabel.setAttribute('font-size', '8px');
                actLabel.textContent = node.activation;
                nodesGroup.appendChild(actLabel);
            }
        }

        rootGroup.appendChild(nodesGroup);

        if (this.interactive) {
            const tooltipGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            tooltipGroup.setAttribute('display', 'none');
            tooltipGroup.setAttribute('pointer-events', 'none');

            const tooltipRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            tooltipRect.style.fill = 'var(--bg)';
            tooltipRect.style.stroke = 'var(--fg)';
            tooltipRect.setAttribute('stroke-width', '1');

            const tooltipText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            tooltipText.style.fill = 'var(--fg)';
            tooltipText.setAttribute('font-size', '10px');
            tooltipText.setAttribute('text-anchor', 'start');

            tooltipGroup.appendChild(tooltipRect);
            tooltipGroup.appendChild(tooltipText);
            rootGroup.appendChild(tooltipGroup);

            this.hoverTooltip = tooltipGroup;
            this.hoverTooltipRect = tooltipRect;
            this.hoverTooltipText = tooltipText;
        }

        this.svg.appendChild(rootGroup);
        this.contentGroup = rootGroup;

        if (preserveView) {
            this.scale = previousView.scale;
            this.offsetX = previousView.offsetX;
            this.offsetY = previousView.offsetY;
            this.applyTransform();
        } else {
            this.resetView();
        }

        if (previousSelection !== null && this.connectionElements.has(previousSelection)) {
            this.selectConnection(previousSelection, false);
        } else {
            this.selectConnection(null, false);
        }
    }
}

class PhylogenyVisualizer {
    constructor(svgElement) {
        this.svg = svgElement;
        this.padding = 48;
        this.layerGap = 130;
        this.nodeGap = 120;
        this.minScale = 0.2;
        this.maxScale = 4.0;
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.worldWidth = 1;
        this.worldHeight = 1;
        this.contentGroup = null;
        this.thumbnailCache = new Map();
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.startOffsetX = 0;
        this.startOffsetY = 0;

        this.bindInteractions();
    }

    bindInteractions() {
        this.svg.addEventListener('wheel', (event) => {
            if (!this.contentGroup) return;

            event.preventDefault();
            const rect = this.svg.getBoundingClientRect();
            const anchor = {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
            };
            const zoomFactor = event.deltaY < 0 ? 1.12 : 0.88;
            this.setScale(this.scale * zoomFactor, anchor);
        }, { passive: false });

        this.svg.addEventListener('mousedown', (event) => {
            if (!this.contentGroup) return;

            event.preventDefault();
            this.isDragging = true;
            this.dragStartX = event.clientX;
            this.dragStartY = event.clientY;
            this.startOffsetX = this.offsetX;
            this.startOffsetY = this.offsetY;
            this.svg.classList.add('dragging');
        });

        window.addEventListener('mousemove', (event) => {
            if (!this.isDragging || !this.contentGroup) return;

            const dx = event.clientX - this.dragStartX;
            const dy = event.clientY - this.dragStartY;
            this.offsetX = this.startOffsetX + dx;
            this.offsetY = this.startOffsetY + dy;
            this.applyTransform();
        });

        window.addEventListener('mouseup', () => {
            if (!this.isDragging) return;
            this.isDragging = false;
            this.svg.classList.remove('dragging');
        });
    }

    clear() {
        this.svg.innerHTML = '';
        this.contentGroup = null;
    }

    createGenomeFromLineageRecord(record) {
        const genome = {
            nodes: new Map(),
            connections: []
        };

        for (const node of record.nodes || []) {
            genome.nodes.set(node.id, {
                id: node.id,
                type: node.type,
                activation: node.activation,
                label: node.label
            });
        }

        for (const conn of record.connections || []) {
            genome.connections.push({
                fromId: conn.fromId,
                toId: conn.toId,
                weight: conn.weight,
                enabled: conn.enabled
            });
        }

        return genome;
    }

    renderPlaceholderThumbnail(size) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return '';

        ctx.fillStyle = '#ddd';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#777';
        ctx.font = `${Math.max(10, Math.floor(size * 0.35))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', size / 2, size / 2);
        return canvas.toDataURL('image/png');
    }

    getThumbnailForRecord(record, size) {
        const cacheKey = `${record.historyId}:${size}`;
        if (this.thumbnailCache.has(cacheKey)) {
            return this.thumbnailCache.get(cacheKey);
        }

        try {
            const genome = this.createGenomeFromLineageRecord(record);
            const network = new CPPNNetwork(genome);
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            if (!ctx) {
                const fallback = this.renderPlaceholderThumbnail(size);
                this.thumbnailCache.set(cacheKey, fallback);
                return fallback;
            }

            const imageData = ctx.createImageData(size, size);
            const data = imageData.data;
            const scale = 1.0;

            for (let py = 0; py < size; py++) {
                for (let px = 0; px < size; px++) {
                    const x = (px / size - 0.5) * scale;
                    const y = (py / size - 0.5) * scale;
                    const rgb = network.activate(x, y);
                    const idx = (py * size + px) * 4;

                    data[idx] = Math.round(clampChannel01(rgb.r) * 255);
                    data[idx + 1] = Math.round(clampChannel01(rgb.g) * 255);
                    data[idx + 2] = Math.round(clampChannel01(rgb.b) * 255);
                    data[idx + 3] = 255;
                }
            }

            ctx.putImageData(imageData, 0, 0);
            const url = canvas.toDataURL('image/png');
            this.thumbnailCache.set(cacheKey, url);
            return url;
        } catch (error) {
            const fallback = this.renderPlaceholderThumbnail(size);
            this.thumbnailCache.set(cacheKey, fallback);
            return fallback;
        }
    }

    zoomIn() {
        this.setScale(this.scale * 1.15);
    }

    zoomOut() {
        this.setScale(this.scale / 1.15);
    }

    pan(dx, dy) {
        if (!this.contentGroup) return;
        this.offsetX += dx;
        this.offsetY += dy;
        this.applyTransform();
    }

    setScale(nextScale, anchor = null) {
        if (!this.contentGroup) return;

        const clamped = Math.max(this.minScale, Math.min(this.maxScale, nextScale));
        const oldScale = this.scale || 1;
        const width = this.svg.clientWidth || 320;
        const height = this.svg.clientHeight || 300;
        const pivot = anchor || { x: width / 2, y: height / 2 };
        const worldX = (pivot.x - this.offsetX) / oldScale;
        const worldY = (pivot.y - this.offsetY) / oldScale;

        this.scale = clamped;
        this.offsetX = pivot.x - worldX * this.scale;
        this.offsetY = pivot.y - worldY * this.scale;
        this.applyTransform();
    }

    applyTransform() {
        if (!this.contentGroup) return;
        this.contentGroup.setAttribute(
            'transform',
            `translate(${this.offsetX}, ${this.offsetY}) scale(${this.scale})`
        );
    }

    resetView() {
        if (!this.contentGroup) return;

        const width = this.svg.clientWidth || 320;
        const height = this.svg.clientHeight || 300;
        const fitX = width / Math.max(this.worldWidth, 1);
        const fitY = height / Math.max(this.worldHeight, 1);
        const fitScale = Math.min(fitX, fitY, 1);

        this.scale = Math.max(this.minScale, Math.min(this.maxScale, fitScale));
        this.offsetX = (width - this.worldWidth * this.scale) / 2;
        this.offsetY = (height - this.worldHeight * this.scale) / 2;
        this.applyTransform();
    }

    focusCurrentNode(worldPosition) {
        if (!this.contentGroup || !worldPosition) return;

        const height = this.svg.clientHeight || 300;
        const scaledHeight = this.worldHeight * this.scale;

        // If the whole tree fits, centering already shows everything.
        if (scaledHeight <= height) return;

        // Bias the active genome toward the lower half so latest lineage is visible.
        const targetScreenY = height * 0.72;
        let nextOffsetY = targetScreenY - worldPosition.y * this.scale;

        const minOffsetY = height - scaledHeight;
        const maxOffsetY = 0;
        nextOffsetY = Math.max(minOffsetY, Math.min(maxOffsetY, nextOffsetY));

        this.offsetY = nextOffsetY;
        this.applyTransform();
    }

    layoutGraph(graph) {
        const layers = new Map();

        for (const node of graph.nodes) {
            const generation = Number.isFinite(node.generation) ? node.generation : 0;
            if (!layers.has(generation)) layers.set(generation, []);
            layers.get(generation).push(node);
        }

        const generations = Array.from(layers.keys()).sort((a, b) => a - b);
        const maxLayerSize = Math.max(1, ...generations.map(gen => layers.get(gen).length));
        const innerWidth = Math.max((maxLayerSize - 1) * this.nodeGap, 0);
        const innerHeight = Math.max((generations.length - 1) * this.layerGap, 0);
        const width = this.padding * 2 + innerWidth;
        const height = this.padding * 2 + innerHeight;
        const positions = new Map();

        generations.forEach((generation, layerIndex) => {
            const layerNodes = layers.get(generation)
                .slice()
                .sort((a, b) => a.historyId.localeCompare(b.historyId));

            const layerWidth = Math.max((layerNodes.length - 1) * this.nodeGap, 0);
            const xStart = this.padding + (innerWidth - layerWidth) / 2;
            const y = this.padding + layerIndex * this.layerGap;

            layerNodes.forEach((node, nodeIndex) => {
                positions.set(node.historyId, {
                    x: xStart + nodeIndex * this.nodeGap,
                    y,
                    generation,
                    node
                });
            });
        });

        return {
            positions,
            generations,
            width: Math.max(width, 1),
            height: Math.max(height, 1)
        };
    }

    visualize(genome) {
        this.clear();

        const width = this.svg.clientWidth || 320;
        const height = this.svg.clientHeight || 300;
        this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

        const graph = genome.getLineageGraph();
        if (!graph || graph.nodes.length === 0) return;

        const layout = this.layoutGraph(graph);
        this.worldWidth = layout.width;
        this.worldHeight = layout.height;

        const rootGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const edgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const generationLabelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const nodeRadius = 18;

        for (const generation of layout.generations) {
            const sample = Array.from(layout.positions.values()).find(pos => pos.generation === generation);
            if (!sample) continue;

            const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.setAttribute('x', 8);
            label.setAttribute('y', sample.y + 4);
            label.style.fill = 'var(--fg)';
            label.setAttribute('font-size', '10px');
            label.textContent = `Gen ${generation}`;
            generationLabelGroup.appendChild(label);
        }

        for (const edge of graph.edges) {
            const fromPos = layout.positions.get(edge.from);
            const toPos = layout.positions.get(edge.to);
            if (!fromPos || !toPos) continue;

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', fromPos.x);
            line.setAttribute('y1', fromPos.y + nodeRadius);
            line.setAttribute('x2', toPos.x);
            line.setAttribute('y2', toPos.y - nodeRadius);
            line.style.stroke = 'var(--fg)';
            line.setAttribute('stroke-width', '1.25');
            line.setAttribute('stroke-opacity', '0.35');
            edgeGroup.appendChild(line);
        }

        for (const nodeRecord of graph.nodes) {
            const pos = layout.positions.get(nodeRecord.historyId);
            if (!pos) continue;

            const isCurrent = nodeRecord.historyId === graph.currentHistoryId;
            const isRoot = (nodeRecord.parentHistoryIds || []).length === 0;
            const shortId = nodeRecord.historyId.slice(-4);
            const thumbSize = nodeRadius * 2;
            const thumbUrl = this.getThumbnailForRecord(nodeRecord, thumbSize);

            const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
            image.setAttribute('x', pos.x - nodeRadius);
            image.setAttribute('y', pos.y - nodeRadius);
            image.setAttribute('width', thumbSize);
            image.setAttribute('height', thumbSize);
            image.setAttribute('preserveAspectRatio', 'xMidYMid slice');
            image.setAttribute('href', thumbUrl);
            image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', thumbUrl);
            nodeGroup.appendChild(image);

            const frame = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            frame.setAttribute('x', pos.x - nodeRadius);
            frame.setAttribute('y', pos.y - nodeRadius);
            frame.setAttribute('width', thumbSize);
            frame.setAttribute('height', thumbSize);
            frame.setAttribute('fill', 'none');
            frame.style.stroke = isCurrent ? 'var(--accent)' : 'var(--fg)';
            frame.setAttribute('stroke-width', isCurrent ? '2.5' : (isRoot ? '2' : '1'));

            const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            const parentText = (nodeRecord.parentHistoryIds || []).join(', ') || 'none';
            title.textContent =
                `${nodeRecord.historyId} | genome ${nodeRecord.genomeId} | generation ${nodeRecord.generation} | parents ${parentText}`;
            frame.appendChild(title);
            nodeGroup.appendChild(frame);

            const idText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            idText.setAttribute('x', pos.x);
            idText.setAttribute('y', pos.y + nodeRadius + 11);
            idText.setAttribute('text-anchor', 'middle');
            idText.setAttribute('font-size', '8px');
            idText.style.fill = 'var(--fg)';
            idText.textContent = `G${nodeRecord.generation} ${shortId}`;
            nodeGroup.appendChild(idText);
        }

        rootGroup.appendChild(generationLabelGroup);
        rootGroup.appendChild(edgeGroup);
        rootGroup.appendChild(nodeGroup);
        this.svg.appendChild(rootGroup);
        this.contentGroup = rootGroup;
        this.resetView();

        const currentPos = layout.positions.get(graph.currentHistoryId);
        if (currentPos) {
            this.focusCurrentNode(currentPos);
        }
    }
}

window.CPPN = {
    ActivationFunctions,
    GIF_CONFIG: {
        frameRate: GIF_FRAME_RATE,
        durationSeconds: GIF_DURATION_SECONDS,
        frameCount: GIF_FRAME_COUNT,
        resolution: GIF_RESOLUTION
    },
    getDisplayNodeLabel: getCPPNDisplayNodeLabel,
    OutputColorModeManager,
    CPPNNetwork,
    CPPNRenderer,
    NetworkVisualizer,
    PhylogenyVisualizer
};

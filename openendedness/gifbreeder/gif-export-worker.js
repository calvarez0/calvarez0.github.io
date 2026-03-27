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

const OUTPUT_MODE = 0; // 0=sigmoid, 1=gaussian, 2=tanh+abs
const GIF_FRAME_RATE = 15;
const GIF_DURATION_SECONDS = 3;
const GIF_FRAME_COUNT = GIF_FRAME_RATE * GIF_DURATION_SECONDS;
const GIF_RESOLUTION = 64;
const GIF_FRAME_DURATION_MS = 1000 / GIF_FRAME_RATE;

const CPPN_LEGACY_OUTPUT_LABEL_MAP = {
    H: 'R',
    S: 'G',
    V: 'B'
};

function normalizeCPPNOutputLabel(label) {
    if (typeof label !== 'string') return label;
    return CPPN_LEGACY_OUTPUT_LABEL_MAP[label] || label;
}

function normalizeOutputColorMode(mode) {
    return mode === 'hsv' ? 'hsv' : 'rgb';
}

function clampChannel01(value) {
    return Math.max(0, Math.min(1, value));
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

function imageDataToGif332Indices(source) {
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

            if (nextCode > (1 << codeSize) && codeSize < 12) {
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
    constructor(serializedGenome, outputColorMode = 'hsv') {
        this.genome = serializedGenome;
        this.nodes = new Map();
        this.sortedNodes = [];
        this.outputColorMode = normalizeOutputColorMode(outputColorMode);
        this.buildNetwork();
    }

    buildNetwork() {
        for (const nodeGene of this.genome.nodes || []) {
            this.nodes.set(nodeGene.id, {
                id: nodeGene.id,
                type: nodeGene.type,
                activation: ActivationFunctions[nodeGene.activation] || ActivationFunctions.sigmoid,
                label: nodeGene.label,
                inputConnections: [],
                value: 0
            });
        }

        for (const conn of this.genome.connections || []) {
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

        let firstChannel = 0.5;
        let secondChannel = 0.5;
        let thirdChannel = 0.5;

        for (const node of this.nodes.values()) {
            if (node.type === 'output') {
                let val = node.value;

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

function renderFrameToRgba(network, width, height, timestep) {
    const data = new Uint8ClampedArray(width * height * 4);
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

    return data;
}

function createGifBytes(genome, options = {}) {
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

    const network = new CPPNNetwork(genome, options.outputColorMode);
    const indexedFrames = [];

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
        const rgba = renderFrameToRgba(network, width, height, frameIndex);
        indexedFrames.push(imageDataToGif332Indices(rgba));

        self.postMessage({
            type: 'progress',
            completedFrames: frameIndex + 1,
            totalFrames: frameCount
        });
    }

    return encodeGifFrames(width, height, indexedFrames, {
        frameDurationMs,
        loopCount: 0
    });
}

self.onmessage = (event) => {
    const data = event.data || {};
    if (data.type !== 'export-gif') return;

    try {
        const gifBytes = createGifBytes(data.genome, data.options || {});
        self.postMessage({
            type: 'success',
            bytes: gifBytes.buffer
        }, [gifBytes.buffer]);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown worker export error';
        self.postMessage({
            type: 'error',
            message
        });
    }
};

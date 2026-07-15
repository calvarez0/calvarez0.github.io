const ActivationFunctions = {
    sigmoid: (x) => (2 / (1 + Math.exp(-x))) - 1,
    tanh: (x) => Math.tanh(x),
    gaussian: (x) => (2 * Math.exp(-x * x)) - 1,
    sin: (x) => Math.sin(x),
    cos: (x) => Math.cos(x),
    abs: (x) => Math.abs(x),
    relu: (x) => Math.max(0, x),
    identity: (x) => x
};

const GIF_FRAME_RATE = 15;
const GIF_DURATION_SECONDS = 3;
const GIF_FRAME_COUNT = GIF_FRAME_RATE * GIF_DURATION_SECONDS;
const GIF_RESOLUTION = 64;
const GIF_FRAME_DURATION_MS = 1000 / GIF_FRAME_RATE;
const CPPN_DISTANCE_SCALE = 1.4;

const CPPN_CANONICAL_OUTPUT_LABEL_MAP = {
    R: 'hue', H: 'hue', hue: 'hue',
    G: 'saturation', S: 'saturation', saturation: 'saturation',
    B: 'brightness', V: 'brightness', brightness: 'brightness', ink: 'brightness'
};

function normalizeCPPNOutputLabel(label) {
    if (typeof label !== 'string') return label;
    return CPPN_CANONICAL_OUTPUT_LABEL_MAP[label] || label;
}

function normalizeOutputColorMode(mode) {
    return mode === 'hsv' ? 'hsv' : 'rgb';
}

function clampChannel01(value) {
    return Math.max(0, Math.min(1, value));
}

function wrapUnitInterval(value) {
    if (!Number.isFinite(value)) return 0;
    return ((value % 1) + 1) % 1;
}

function bipolarToChannel01(value) {
    if (!Number.isFinite(value)) return 0;
    return clampChannel01((value + 1) * 0.5);
}

function pixelCoordinate(pixelIndex, size) {
    if (!Number.isFinite(size) || size <= 1) return 0;
    return (pixelIndex / (size - 1)) * 2 - 1;
}

function normalizeCPPNTimeInput(value) {
    if (!Number.isFinite(value)) return 0;
    if (value >= 0 && value <= 1) return value;
    return value / Math.max(GIF_FRAME_COUNT - 1, 1);
}

// Exact port of fer/src/color.py hsv2rgb (same as picbreeder_og).
// h must be in [0, 1), s and v in [0, 1].
function hsv2rgb(h, s, v) {
    h = h * 360;

    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;

    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }

    return {
        r: Math.min(Math.max(r + m, 0), 1),
        g: Math.min(Math.max(g + m, 0), 1),
        b: Math.min(Math.max(b + m, 0), 1)
    };
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
        this.inputIds = { x: null, y: null, d: null, t: null, bias: null };
        this.outputIds = { h: null, s: null, v: null };
        this.plan = [];
        this.values = new Map();
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
                inputConnections: []
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

        for (const node of this.nodes.values()) {
            if (node.type === 'input') {
                if (node.label === 'x') this.inputIds.x = node.id;
                else if (node.label === 'y') this.inputIds.y = node.id;
                else if (node.label === 'd') this.inputIds.d = node.id;
                else if (node.label === 't') this.inputIds.t = node.id;
                else if (node.label === 'bias') this.inputIds.bias = node.id;
            } else if (node.type === 'output') {
                switch (normalizeCPPNOutputLabel(node.label)) {
                    case 'hue': this.outputIds.h = node.id; break;
                    case 'saturation': this.outputIds.s = node.id; break;
                    case 'brightness': this.outputIds.v = node.id; break;
                }
            }
        }

        this.plan = this.buildEvaluationPlan();
    }

    // Mirrors fer's get_value_recur (same as picbreeder_og): depth-first
    // evaluation from the output nodes, memoized, where any link that closes
    // a cycle contributes zeros.
    buildEvaluationPlan() {
        const plan = [];
        const computed = new Set();
        const path = new Set();

        for (const node of this.nodes.values()) {
            if (node.type === 'input') computed.add(node.id);
        }

        const visit = (nodeId) => {
            if (computed.has(nodeId)) return true;
            if (path.has(nodeId)) return false; // cycle: contributes zeros

            const node = this.nodes.get(nodeId);
            if (!node) return false;

            path.add(nodeId);
            const inputs = [];
            for (const conn of node.inputConnections) {
                if (visit(conn.fromId)) inputs.push(conn);
            }
            path.delete(nodeId);

            plan.push({ node, inputs });
            computed.add(nodeId);
            return true;
        };

        for (const outId of [this.outputIds.h, this.outputIds.s, this.outputIds.v]) {
            if (outId !== null) visit(outId);
        }

        return plan;
    }

    activate(x, y, t = 0) {
        const values = this.values;
        if (this.inputIds.x !== null) values.set(this.inputIds.x, x);
        if (this.inputIds.y !== null) values.set(this.inputIds.y, y);
        if (this.inputIds.d !== null) values.set(this.inputIds.d, Math.sqrt(x * x + y * y) * CPPN_DISTANCE_SCALE);
        if (this.inputIds.t !== null) values.set(this.inputIds.t, normalizeCPPNTimeInput(t));
        if (this.inputIds.bias !== null) values.set(this.inputIds.bias, 1.0);

        for (const step of this.plan) {
            let sum = 0;
            for (const conn of step.inputs) {
                sum += values.get(conn.fromId) * conn.weight;
            }
            values.set(step.node.id, step.node.activation(sum));
        }

        const hRaw = this.outputIds.h !== null ? values.get(this.outputIds.h) : 0;
        const sRaw = this.outputIds.s !== null ? values.get(this.outputIds.s) : 0;
        const vRaw = this.outputIds.v !== null ? values.get(this.outputIds.v) : 0;

        if (this.outputColorMode === 'hsv') {
            const h = ((hRaw % 1) + 1) % 1;
            const s = Math.min(Math.max(sRaw, 0), 1);
            const v = Math.min(Math.max(Math.abs(vRaw), 0), 1);
            return hsv2rgb(h, s, v);
        }

        return {
            r: bipolarToChannel01(hRaw),
            g: bipolarToChannel01(sRaw),
            b: bipolarToChannel01(vRaw)
        };
    }
}

function renderFrameToRgba(network, width, height, timestep) {
    const data = new Uint8ClampedArray(width * height * 4);
    const scale = 1.0;

    for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
            const x = pixelCoordinate(px, width) * scale;
            const y = pixelCoordinate(py, height) * scale;
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

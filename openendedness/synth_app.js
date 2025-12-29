// SynthBreeder - CPPN-NEAT Sound Evolution System
// Based on Picbreeder (Stanley et al.) and Jónsson's compositional sound synthesis research
// Dual-CPPN architecture: separate networks for waveform (timbre) and envelope (dynamics)

// Audio context
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const SAMPLE_RATE = 44100;
const SOUND_DURATION = 1.0; // 1 second for more expressive envelopes
const WAVETABLE_SIZE = 1024;
const ENVELOPE_RESOLUTION = 256; // Number of points in envelope curve

// Evolution parameters
let generation = 0;
let population = [];
let selectedIndex = null;
let nextInnovation = 0;

// NEAT configuration (user-adjustable)
let neatConfig = {
    weightMutationRate: 0.8,
    weightMutationPower: 0.5,
    addConnectionRate: 0.15,
    addNodeRate: 0.1,
    changeActivationRate: 0.1,
    initialMutations: 3,
    enabledActivations: new Set(['sine', 'square', 'sawtooth', 'triangle', 'gaussian', 'sigmoid', 'abs', 'linear', 'step', 'noise'])
};

// Activation functions for CPPNs (massive variety for complex sounds)
const activationFunctions = {
    // Basic waves
    sine: (x) => Math.sin(x * Math.PI),
    cosine: (x) => Math.cos(x * Math.PI),
    square: (x) => x > 0 ? 1 : -1,
    sawtooth: (x) => (x % 2) - 1,
    triangle: (x) => 2 * Math.abs(x % 2 - 1) - 1,

    // Smooth functions
    gaussian: (x) => Math.exp(-x * x),
    sigmoid: (x) => 2 / (1 + Math.exp(-4.9 * x)) - 1,
    tanh: (x) => Math.tanh(x),
    softplus: (x) => Math.log(1 + Math.exp(x)) / 5,

    // Sharp/percussive functions
    abs: (x) => Math.abs(x),
    step: (x) => x > 0 ? 0.5 : -0.5,
    ramp: (x) => Math.max(0, Math.min(1, x)),
    spike: (x) => Math.exp(-Math.abs(x) * 5),
    hat: (x) => Math.max(0, 1 - Math.abs(x)),

    // Harmonic/complex
    sin2x: (x) => Math.sin(2 * x * Math.PI),
    sin3x: (x) => Math.sin(3 * x * Math.PI),
    sin5x: (x) => Math.sin(5 * x * Math.PI),
    cos2x: (x) => Math.cos(2 * x * Math.PI),

    // Polynomial
    square_x: (x) => x * x * Math.sign(x),
    cube: (x) => x * x * x,
    inv: (x) => x === 0 ? 0 : Math.max(-1, Math.min(1, 1 / (x * 5))),

    // Modulation/texture
    sinc: (x) => x === 0 ? 1 : Math.sin(Math.PI * x * 3) / (Math.PI * x * 3),
    ripple: (x) => Math.sin(x * x * 10) * Math.exp(-Math.abs(x)),
    chirp: (x) => Math.sin(x * x * x * 20),

    // Noise/organic
    noise: (x) => (Math.random() * 2 - 1) * Math.exp(-x * x * 2),
    warble: (x) => Math.sin(x * Math.PI) * (1 + 0.3 * Math.sin(x * 20)),
    gravel: (x) => Math.sign(Math.sin(x * 50)) * Math.exp(-Math.abs(x)),

    // Percussive envelopes
    pluck: (x) => Math.sin(x * Math.PI * 2) * Math.exp(-Math.abs(x) * 8),
    thump: (x) => (1 - Math.abs(x)) * Math.exp(-x * x * 5),
    click: (x) => Math.abs(x) < 0.1 ? (1 - Math.abs(x) * 10) : 0,
    snap: (x) => Math.exp(-Math.abs(x) * 20) * Math.sin(x * 100),

    // Complex combinations
    wobble: (x) => Math.sin(x * Math.PI) * Math.sin(x * x * 15),
    flutter: (x) => Math.sin(x * Math.PI) + 0.3 * Math.sin(x * 17 * Math.PI),
    growl: (x) => Math.tanh(Math.sin(x * 3) * 3) * Math.exp(-Math.abs(x)),
    buzz: (x) => Math.sign(Math.sin(x * Math.PI * 40)) * (1 - Math.abs(x)),

    // Misc interesting
    linear: (x) => Math.max(-1, Math.min(1, x)),
    clamp: (x) => Math.max(-0.5, Math.min(0.5, x * 2)),
    fold: (x) => {
        let v = x % 2;
        return v > 1 ? 2 - v : v < -1 ? -2 - v : v;
    }
};

const activationNames = Object.keys(activationFunctions);

// CPPN Gene and Genome structures
class ConnectionGene {
    constructor(from, to, weight, innovation, enabled = true) {
        this.from = from;
        this.to = to;
        this.weight = weight;
        this.innovation = innovation;
        this.enabled = enabled;
    }

    copy() {
        return new ConnectionGene(this.from, this.to, this.weight, this.innovation, this.enabled);
    }
}

class NodeGene {
    constructor(id, type, activation = 'sigmoid') {
        this.id = id;
        this.type = type; // 'input', 'output', 'hidden'
        this.activation = activation;
        this.value = 0;
    }

    copy() {
        return new NodeGene(this.id, this.type, this.activation);
    }
}

class CPPN {
    constructor() {
        this.nodes = new Map();
        this.connections = [];
        this.nextNodeId = 0;
        this.fitness = 0;
    }

    addNode(type, activation = 'sigmoid') {
        const node = new NodeGene(this.nextNodeId++, type, activation);
        this.nodes.set(node.id, node);
        return node;
    }

    addConnection(from, to, weight) {
        const conn = new ConnectionGene(from, to, weight, nextInnovation++);
        this.connections.push(conn);
        return conn;
    }

    activate(inputs) {
        // Reset all node values
        this.nodes.forEach(node => node.value = 0);

        // Set input values
        const inputNodes = Array.from(this.nodes.values()).filter(n => n.type === 'input');
        inputNodes.forEach((node, i) => {
            node.value = inputs[i] || 0;
        });

        // Propagate through network (simplified feedforward)
        const sorted = this.topologicalSort();

        for (const nodeId of sorted) {
            const node = this.nodes.get(nodeId);
            if (node.type === 'input') continue;

            // Sum inputs from enabled connections
            let sum = 0;
            for (const conn of this.connections) {
                if (conn.to === nodeId && conn.enabled) {
                    const fromNode = this.nodes.get(conn.from);
                    sum += fromNode.value * conn.weight;
                }
            }

            // Apply activation function
            const activationFn = activationFunctions[node.activation] || activationFunctions.sigmoid;
            node.value = activationFn(sum);
        }

        // Return output values
        const outputNodes = Array.from(this.nodes.values()).filter(n => n.type === 'output');
        return outputNodes.map(n => n.value);
    }

    topologicalSort() {
        const sorted = [];
        const visited = new Set();
        const temp = new Set();

        const visit = (nodeId) => {
            if (temp.has(nodeId)) return; // Cycle detection
            if (visited.has(nodeId)) return;

            temp.add(nodeId);

            // Visit all nodes that this node depends on
            for (const conn of this.connections) {
                if (conn.to === nodeId && conn.enabled) {
                    visit(conn.from);
                }
            }

            temp.delete(nodeId);
            visited.add(nodeId);
            sorted.push(nodeId);
        };

        this.nodes.forEach((node, id) => {
            if (!visited.has(id)) visit(id);
        });

        return sorted;
    }

    copy() {
        const newCPPN = new CPPN();
        newCPPN.nextNodeId = this.nextNodeId;

        this.nodes.forEach((node, id) => {
            newCPPN.nodes.set(id, node.copy());
        });

        newCPPN.connections = this.connections.map(c => c.copy());
        return newCPPN;
    }

    mutate() {
        // Get enabled activation functions
        const enabledActivations = Array.from(neatConfig.enabledActivations);

        // Mutate weights
        if (Math.random() < neatConfig.weightMutationRate) {
            for (const conn of this.connections) {
                if (Math.random() < 0.9) {
                    conn.weight += (Math.random() * 2 - 1) * neatConfig.weightMutationPower;
                    conn.weight = Math.max(-3, Math.min(3, conn.weight));
                } else {
                    conn.weight = Math.random() * 4 - 2;
                }
            }
        }

        // Add connection
        if (Math.random() < neatConfig.addConnectionRate) {
            const nodeIds = Array.from(this.nodes.keys());
            if (nodeIds.length >= 2) {
                const from = nodeIds[Math.floor(Math.random() * nodeIds.length)];
                const to = nodeIds[Math.floor(Math.random() * nodeIds.length)];

                if (from !== to && !this.hasConnection(from, to)) {
                    this.addConnection(from, to, Math.random() * 2 - 1);
                }
            }
        }

        // Add node
        if (Math.random() < neatConfig.addNodeRate && this.connections.length > 0) {
            const conn = this.connections[Math.floor(Math.random() * this.connections.length)];
            if (conn.enabled && enabledActivations.length > 0) {
                const activation = enabledActivations[Math.floor(Math.random() * enabledActivations.length)];
                const newNode = this.addNode('hidden', activation);

                conn.enabled = false;
                this.addConnection(conn.from, newNode.id, 1.0);
                this.addConnection(newNode.id, conn.to, conn.weight);
            }
        }

        // Mutate activation functions
        if (Math.random() < neatConfig.changeActivationRate && enabledActivations.length > 0) {
            const hiddenNodes = Array.from(this.nodes.values()).filter(n => n.type === 'hidden');
            if (hiddenNodes.length > 0) {
                const node = hiddenNodes[Math.floor(Math.random() * hiddenNodes.length)];
                node.activation = enabledActivations[Math.floor(Math.random() * enabledActivations.length)];
            }
        }
    }

    hasConnection(from, to) {
        return this.connections.some(c => c.from === from && c.to === to);
    }

    getComplexity() {
        return this.nodes.size + this.connections.filter(c => c.enabled).length;
    }
}

// Create minimal CPPN for waveform (timbre) generation
// Inputs: t (normalized time in wave cycle), sin(t), bias
// Output: amplitude at that point in the waveform
function createWaveformCPPN() {
    const cppn = new CPPN();

    // Inputs for waveform: normalized position in cycle, sine of position, bias
    const timeInput = cppn.addNode('input');      // t: position in waveform cycle [-1, 1]
    const sinInput = cppn.addNode('input');       // sin(t * π): adds periodic structure
    const biasInput = cppn.addNode('input');      // bias: constant 1.0

    // Output: amplitude at this point in the waveform
    const output = cppn.addNode('output', 'tanh');

    // Initial connections with random weights
    cppn.addConnection(timeInput.id, output.id, Math.random() * 2 - 1);
    cppn.addConnection(sinInput.id, output.id, Math.random() * 2 - 1);
    cppn.addConnection(biasInput.id, output.id, Math.random() * 0.5 - 0.25);

    return cppn;
}

// Create minimal CPPN for envelope (dynamics) generation
// Inputs: t (normalized time over sound duration), t² (for curvature), bias
// Output: amplitude multiplier at that time
//
// The envelope CPPN learns temporal dynamics: attack, decay, sustain, release patterns
// By using t and t², the network can learn curved envelopes naturally
// The output is passed through abs() to ensure positive envelope values
function createEnvelopeCPPN() {
    const cppn = new CPPN();

    // Inputs for envelope: normalized time, time squared, bias
    const timeInput = cppn.addNode('input');      // t: time in sound [0, 1]
    const timeSqInput = cppn.addNode('input');    // t²: allows learning of curves
    const biasInput = cppn.addNode('input');      // bias: constant 1.0

    // Output: envelope amplitude (will be abs()'d to ensure positive)
    const output = cppn.addNode('output', 'gaussian');

    // Initial connections - bias towards decay envelope (common in percussion)
    cppn.addConnection(timeInput.id, output.id, -1.5 + Math.random() * 0.5);  // Decay bias
    cppn.addConnection(timeSqInput.id, output.id, Math.random() * 0.5);
    cppn.addConnection(biasInput.id, output.id, 0.5 + Math.random() * 0.5);   // Start loud

    return cppn;
}

// Legacy function for backwards compatibility
function createMinimalCPPN() {
    return createWaveformCPPN();
}

// Generate waveform from CPPN (one cycle of the wave - defines timbre)
function generateWaveform(cppn) {
    const numSamples = WAVETABLE_SIZE;
    const waveform = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
        const t = (i / numSamples) * 2 - 1; // Normalize to [-1, 1]
        const sinT = Math.sin(t * Math.PI);  // Periodic input
        const outputs = cppn.activate([t, sinT, 1.0]); // time, sin(time), bias
        waveform[i] = outputs[0] || 0;
    }

    // Normalize waveform
    const max = Math.max(...waveform.map(Math.abs));
    if (max > 0) {
        for (let i = 0; i < numSamples; i++) {
            waveform[i] /= max;
        }
    }

    return waveform;
}

// Generate envelope from CPPN (amplitude over time - defines dynamics)
function generateEnvelope(cppn) {
    const envelope = new Float32Array(ENVELOPE_RESOLUTION);

    for (let i = 0; i < ENVELOPE_RESOLUTION; i++) {
        const t = i / (ENVELOPE_RESOLUTION - 1); // Normalize to [0, 1]
        const tSq = t * t;                        // Quadratic term for curves
        const outputs = cppn.activate([t, tSq, 1.0]);
        // Use absolute value to ensure envelope is always positive
        envelope[i] = Math.abs(outputs[0]) || 0;
    }

    // Normalize envelope to peak at 1.0
    const max = Math.max(...envelope);
    if (max > 0) {
        for (let i = 0; i < ENVELOPE_RESOLUTION; i++) {
            envelope[i] /= max;
        }
    }

    return envelope;
}

// Create audio buffer from waveform and envelope (both generated by CPPNs)
function createAudioBuffer(waveform, envelope) {
    const buffer = audioContext.createBuffer(1, SAMPLE_RATE * SOUND_DURATION, SAMPLE_RATE);
    const channelData = buffer.getChannelData(0);

    for (let i = 0; i < channelData.length; i++) {
        const t = i / channelData.length;

        // Sample the waveform (wavetable synthesis with pitch)
        // Use modulo to loop through the waveform at a base frequency
        const frequency = 220; // A3 base frequency
        const phase = (i * frequency / SAMPLE_RATE) % 1;
        const wavetableIndex = Math.floor(phase * waveform.length);
        const sample = waveform[wavetableIndex];

        // Sample the envelope (interpolated for smoothness)
        const envIndex = t * (envelope.length - 1);
        const envIndexLow = Math.floor(envIndex);
        const envIndexHigh = Math.min(envIndexLow + 1, envelope.length - 1);
        const envFrac = envIndex - envIndexLow;
        const envValue = envelope[envIndexLow] * (1 - envFrac) + envelope[envIndexHigh] * envFrac;

        // Combine waveform and envelope
        channelData[i] = sample * envValue;
    }

    return buffer;
}

// Play sound
function playSound(individual) {
    const source = audioContext.createBufferSource();
    const gainNode = audioContext.createGain();

    source.buffer = individual.buffer;
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);

    gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
    source.start();

    return source;
}

// Draw waveform on canvas
function drawWaveform(canvas, waveform) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#f5f5f5';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    for (let i = 0; i < waveform.length; i++) {
        const x = (i / waveform.length) * width;
        const y = ((1 - waveform[i]) / 2) * height;

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }

    ctx.stroke();
}

// Initialize population with dual CPPNs (waveform + envelope)
function initializePopulation() {
    population = [];

    for (let i = 0; i < 9; i++) {
        const waveformCPPN = createWaveformCPPN();
        const envelopeCPPN = createEnvelopeCPPN();

        // Apply several mutations to create variety
        for (let j = 0; j < neatConfig.initialMutations; j++) {
            waveformCPPN.mutate();
            envelopeCPPN.mutate();
        }

        const waveform = generateWaveform(waveformCPPN);
        const envelope = generateEnvelope(envelopeCPPN);
        const buffer = createAudioBuffer(waveform, envelope);

        population.push({
            waveformCPPN,
            envelopeCPPN,
            waveform,
            envelope,
            buffer,
            id: i
        });
    }

    renderPopulation();
    updateStats();
}

// Draw envelope on canvas
function drawEnvelope(canvas, envelope) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, width, height);

    // Draw envelope curve
    ctx.strokeStyle = '#6b9d6b';  // Green to match output nodes
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    for (let i = 0; i < envelope.length; i++) {
        const x = (i / (envelope.length - 1)) * width;
        const y = (1 - envelope[i]) * height;

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }

    ctx.stroke();

    // Fill under the curve
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = 'rgba(107, 157, 107, 0.1)';
    ctx.fill();
}

// Render population in UI
function renderPopulation() {
    const grid = document.getElementById('sound-grid');
    grid.innerHTML = '';

    population.forEach((individual, index) => {
        const item = document.createElement('div');
        item.className = 'sound-item';
        item.dataset.index = index;

        if (selectedIndex === index) {
            item.classList.add('selected');
        }

        // Container for both visualizations
        const vizContainer = document.createElement('div');
        vizContainer.className = 'viz-container';

        // Waveform canvas
        const waveCanvas = document.createElement('canvas');
        waveCanvas.width = 300;
        waveCanvas.height = 50;
        waveCanvas.className = 'waveform-canvas';
        drawWaveform(waveCanvas, individual.waveform);

        // Envelope canvas
        const envCanvas = document.createElement('canvas');
        envCanvas.width = 300;
        envCanvas.height = 30;
        envCanvas.className = 'envelope-canvas';
        drawEnvelope(envCanvas, individual.envelope);

        vizContainer.appendChild(waveCanvas);
        vizContainer.appendChild(envCanvas);

        const info = document.createElement('div');
        info.className = 'sound-info';
        const totalComplexity = individual.waveformCPPN.getComplexity() + individual.envelopeCPPN.getComplexity();
        info.textContent = `Sound ${index + 1} | Complexity: ${totalComplexity}`;

        item.appendChild(vizContainer);
        item.appendChild(info);

        item.addEventListener('click', () => {
            // Play sound immediately
            item.classList.add('playing');
            playSound(individual);
            setTimeout(() => item.classList.remove('playing'), SOUND_DURATION * 1000);

            // Clear previous selection
            selectedIndex = index;

            // Update visual selection
            document.querySelectorAll('.sound-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');

            // Update stats and network visualization
            updateStats();
            drawNetworkTopology(individual.waveformCPPN, individual.envelopeCPPN);
        });

        grid.appendChild(item);
    });
}

// Evolve new generation - both waveform and envelope networks evolve independently
function evolve() {
    if (selectedIndex === null) {
        alert('Please select a sound to evolve!');
        return;
    }

    const parent = population[selectedIndex];
    const newPopulation = [];

    for (let i = 0; i < 9; i++) {
        // Both networks evolve independently from the parent
        const childWaveformCPPN = parent.waveformCPPN.copy();
        const childEnvelopeCPPN = parent.envelopeCPPN.copy();

        // Mutate both networks
        childWaveformCPPN.mutate();
        childEnvelopeCPPN.mutate();

        const waveform = generateWaveform(childWaveformCPPN);
        const envelope = generateEnvelope(childEnvelopeCPPN);
        const buffer = createAudioBuffer(waveform, envelope);

        newPopulation.push({
            waveformCPPN: childWaveformCPPN,
            envelopeCPPN: childEnvelopeCPPN,
            waveform,
            envelope,
            buffer,
            id: i
        });
    }

    population = newPopulation;
    selectedIndex = null;
    generation++;

    renderPopulation();
    updateStats();
}

// Reset to new random population
function reset() {
    if (confirm('Start a new random population? This will clear your current generation.')) {
        generation = 0;
        selectedIndex = null;
        initializePopulation();
    }
}

// Save selected sounds
function saveSelected() {
    if (selectedIndex === null) {
        alert('Please select a sound to save!');
        return;
    }

    alert(`Save functionality coming soon!`);
}

// Update statistics
function updateStats() {
    document.getElementById('generation').textContent = generation;
    document.getElementById('selected-count').textContent = selectedIndex !== null ? 1 : 0;

    const avgComplexity = population.reduce((sum, ind) => {
        return sum + ind.waveformCPPN.getComplexity() + ind.envelopeCPPN.getComplexity();
    }, 0) / population.length;
    document.getElementById('avg-complexity').textContent = avgComplexity.toFixed(1);
}

// Draw a single CPPN network
function drawSingleNetwork(ctx, cppn, offsetX, offsetY, areaWidth, areaHeight, label) {
    // Organize nodes by type
    const inputNodes = Array.from(cppn.nodes.values()).filter(n => n.type === 'input');
    const outputNodes = Array.from(cppn.nodes.values()).filter(n => n.type === 'output');
    const hiddenNodes = Array.from(cppn.nodes.values()).filter(n => n.type === 'hidden');

    // Position nodes with better layout
    const nodePositions = new Map();
    const padding = 30;
    const usableWidth = areaWidth - padding * 2;
    const usableHeight = areaHeight - padding * 2 - 20; // Leave room for label

    // Input nodes on left
    inputNodes.forEach((node, i) => {
        const spacing = inputNodes.length > 1 ? usableHeight / (inputNodes.length - 1) : 0;
        nodePositions.set(node.id, {
            x: offsetX + padding,
            y: offsetY + padding + 20 + (inputNodes.length === 1 ? usableHeight / 2 : i * spacing)
        });
    });

    // Output nodes on right
    outputNodes.forEach((node, i) => {
        const spacing = outputNodes.length > 1 ? usableHeight / (outputNodes.length - 1) : 0;
        nodePositions.set(node.id, {
            x: offsetX + areaWidth - padding,
            y: offsetY + padding + 20 + (outputNodes.length === 1 ? usableHeight / 2 : i * spacing)
        });
    });

    // Hidden nodes in middle
    if (hiddenNodes.length > 0) {
        const layers = Math.min(3, Math.ceil(Math.sqrt(hiddenNodes.length)));
        const nodesPerLayer = Math.ceil(hiddenNodes.length / layers);

        hiddenNodes.forEach((node, i) => {
            const layer = Math.floor(i / nodesPerLayer);
            const posInLayer = i % nodesPerLayer;
            const totalInLayer = Math.min(nodesPerLayer, hiddenNodes.length - layer * nodesPerLayer);

            const x = offsetX + padding + usableWidth * (layer + 1) / (layers + 1);
            const spacing = totalInLayer > 1 ? usableHeight / (totalInLayer + 1) : usableHeight / 2;
            const y = offsetY + padding + 20 + spacing * (posInLayer + 1);

            nodePositions.set(node.id, { x, y });
        });
    }

    // Draw label
    ctx.fillStyle = '#6a6a6a';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, offsetX + padding, offsetY + 16);

    // Draw connections
    cppn.connections.forEach(conn => {
        if (!conn.enabled) return;

        const fromPos = nodePositions.get(conn.from);
        const toPos = nodePositions.get(conn.to);

        if (!fromPos || !toPos) return;

        const weight = Math.max(-3, Math.min(3, conn.weight));
        const alpha = Math.min(0.6, Math.abs(weight) / 3 * 0.5 + 0.1);
        const brightness = weight > 0 ? 200 : 120;
        ctx.strokeStyle = `rgba(${brightness}, ${brightness}, ${brightness}, ${alpha})`;
        ctx.lineWidth = Math.abs(weight) * 0.6 + 0.3;

        ctx.beginPath();
        ctx.moveTo(fromPos.x, fromPos.y);
        ctx.lineTo(toPos.x, toPos.y);
        ctx.stroke();
    });

    // Draw nodes
    cppn.nodes.forEach((node) => {
        const pos = nodePositions.get(node.id);
        if (!pos) return;

        let fillColor, strokeColor;
        if (node.type === 'input') {
            fillColor = '#1e3a5f';
            strokeColor = '#5b8ec5';
        } else if (node.type === 'output') {
            fillColor = '#2d4a2d';
            strokeColor = '#6b9d6b';
        } else {
            fillColor = '#4a3a2a';
            strokeColor = '#9d7b5b';
        }

        ctx.fillStyle = fillColor;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Draw label for hidden nodes
        if (node.type === 'hidden' && hiddenNodes.length < 8) {
            ctx.fillStyle = '#8a8a8a';
            ctx.font = '8px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(node.activation.slice(0, 3), pos.x, pos.y - 10);
        }
    });

    return { inputNodes, outputNodes, hiddenNodes };
}

// Draw network topology visualization for both CPPNs
function drawNetworkTopology(waveformCPPN, envelopeCPPN) {
    const canvas = document.getElementById('network-viz');
    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.offsetWidth;
    const height = canvas.height = canvas.offsetHeight;

    // Clear canvas
    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, width, height);

    // Draw divider
    const halfHeight = height / 2;
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(10, halfHeight);
    ctx.lineTo(width - 10, halfHeight);
    ctx.stroke();

    // Draw waveform network (top half)
    const waveInfo = drawSingleNetwork(ctx, waveformCPPN, 0, 0, width, halfHeight, 'Waveform (Timbre)');

    // Draw envelope network (bottom half)
    const envInfo = drawSingleNetwork(ctx, envelopeCPPN, 0, halfHeight, width, halfHeight, 'Envelope (Dynamics)');

    // Update network info
    const waveConnections = waveformCPPN.connections.filter(c => c.enabled).length;
    const envConnections = envelopeCPPN.connections.filter(c => c.enabled).length;

    const infoDiv = document.getElementById('network-info');
    infoDiv.innerHTML = `
        <div style="margin-bottom: 8px;"><strong>Waveform Network</strong></div>
        <div style="color: #8a8a8a; font-size: 11px;">Nodes: ${waveformCPPN.nodes.size} | Connections: ${waveConnections}</div>
        <div style="margin-top: 12px; margin-bottom: 8px;"><strong>Envelope Network</strong></div>
        <div style="color: #8a8a8a; font-size: 11px;">Nodes: ${envelopeCPPN.nodes.size} | Connections: ${envConnections}</div>
        <div style="margin-top: 12px; color: #6a6a6a; font-size: 11px;">
            Total Complexity: ${waveformCPPN.getComplexity() + envelopeCPPN.getComplexity()}
        </div>
    `;
}

// Settings panel functions
function updateSetting(settingId, value) {
    const numValue = parseFloat(value);

    switch(settingId) {
        case 'weight-mutation':
            neatConfig.weightMutationRate = numValue;
            document.getElementById('weight-mut-val').textContent = numValue.toFixed(2);
            break;
        case 'weight-power':
            neatConfig.weightMutationPower = numValue;
            document.getElementById('weight-power-val').textContent = numValue.toFixed(2);
            break;
        case 'add-connection':
            neatConfig.addConnectionRate = numValue;
            document.getElementById('add-conn-val').textContent = numValue.toFixed(2);
            break;
        case 'add-node':
            neatConfig.addNodeRate = numValue;
            document.getElementById('add-node-val').textContent = numValue.toFixed(2);
            break;
        case 'change-activation':
            neatConfig.changeActivationRate = numValue;
            document.getElementById('change-act-val').textContent = numValue.toFixed(2);
            break;
        case 'init-mutations':
            neatConfig.initialMutations = parseInt(value);
            document.getElementById('init-mut-val').textContent = value;
            break;
    }
}

function toggleActivation(name, checked) {
    if (checked) {
        neatConfig.enabledActivations.add(name);
    } else {
        neatConfig.enabledActivations.delete(name);
    }
}

function selectAllActivations() {
    activationNames.forEach(name => {
        neatConfig.enabledActivations.add(name);
        const checkbox = document.getElementById(`act-${name}`);
        if (checkbox) checkbox.checked = true;
    });
}

function deselectAllActivations() {
    activationNames.forEach(name => {
        neatConfig.enabledActivations.delete(name);
        const checkbox = document.getElementById(`act-${name}`);
        if (checkbox) checkbox.checked = false;
    });
}


function loadPreset(presetName) {
    switch(presetName) {
        case 'default':
            neatConfig.weightMutationRate = 0.8;
            neatConfig.weightMutationPower = 0.5;
            neatConfig.addConnectionRate = 0.15;
            neatConfig.addNodeRate = 0.1;
            neatConfig.changeActivationRate = 0.1;
            neatConfig.initialMutations = 3;
            neatConfig.enabledActivations = new Set(['sine', 'square', 'sawtooth', 'triangle', 'gaussian', 'sigmoid', 'abs', 'linear', 'step', 'noise']);
            break;
        case 'diverse':
            // Higher mutation rates for more variety
            neatConfig.weightMutationRate = 0.95;
            neatConfig.weightMutationPower = 1.2;
            neatConfig.addConnectionRate = 0.3;
            neatConfig.addNodeRate = 0.2;
            neatConfig.changeActivationRate = 0.25;
            neatConfig.initialMutations = 6;
            neatConfig.enabledActivations = new Set(['sine', 'square', 'sawtooth', 'triangle', 'gaussian', 'sigmoid', 'abs', 'linear', 'step', 'noise']);
            break;
        case 'stable':
            // Lower mutation rates for gradual evolution
            neatConfig.weightMutationRate = 0.6;
            neatConfig.weightMutationPower = 0.3;
            neatConfig.addConnectionRate = 0.05;
            neatConfig.addNodeRate = 0.03;
            neatConfig.changeActivationRate = 0.05;
            neatConfig.initialMutations = 2;
            neatConfig.enabledActivations = new Set(['sine', 'square', 'sawtooth', 'triangle', 'gaussian', 'sigmoid']);
            break;
    }
    updateSettingsUI();
}

function updateSettingsUI() {
    document.getElementById('weight-mutation').value = neatConfig.weightMutationRate;
    document.getElementById('weight-mut-val').textContent = neatConfig.weightMutationRate.toFixed(2);

    document.getElementById('weight-power').value = neatConfig.weightMutationPower;
    document.getElementById('weight-power-val').textContent = neatConfig.weightMutationPower.toFixed(2);

    document.getElementById('add-connection').value = neatConfig.addConnectionRate;
    document.getElementById('add-conn-val').textContent = neatConfig.addConnectionRate.toFixed(2);

    document.getElementById('add-node').value = neatConfig.addNodeRate;
    document.getElementById('add-node-val').textContent = neatConfig.addNodeRate.toFixed(2);

    document.getElementById('change-activation').value = neatConfig.changeActivationRate;
    document.getElementById('change-act-val').textContent = neatConfig.changeActivationRate.toFixed(2);

    document.getElementById('init-mutations').value = neatConfig.initialMutations;
    document.getElementById('init-mut-val').textContent = neatConfig.initialMutations;

    // Update checkboxes
    activationNames.forEach(name => {
        const checkbox = document.getElementById(`act-${name}`);
        if (checkbox) {
            checkbox.checked = neatConfig.enabledActivations.has(name);
        }
    });
}

function initializeSettingsPanel() {
    const container = document.getElementById('activation-functions');

    activationNames.forEach(name => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `act-${name}`;
        checkbox.checked = neatConfig.enabledActivations.has(name);
        checkbox.onchange = (e) => toggleActivation(name, e.target.checked);

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(name));
        container.appendChild(label);
    });
}

// Initialize on load
window.addEventListener('load', () => {
    initializeSettingsPanel();
    initializePopulation();
});

// BeatBreeder - CPPN-NEAT Sound Evolution System
// Based on Picbreeder and Risi et al.'s sound synthesis research

// Audio context
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const SAMPLE_RATE = 44100;
const SOUND_DURATION = 0.5; // 0.5 seconds for percussion
const WAVETABLE_SIZE = 1024;

// Evolution parameters
let generation = 0;
let population = [];
let selectedIndex = null; // Changed to single selection
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

// Create minimal CPPN for sound generation
function createMinimalCPPN() {
    const cppn = new CPPN();

    // Inputs: time (t), bias
    const timeInput = cppn.addNode('input');
    const biasInput = cppn.addNode('input');

    // Output: amplitude
    const output = cppn.addNode('output');

    // Initial connections with random weights
    cppn.addConnection(timeInput.id, output.id, Math.random() * 2 - 1);
    cppn.addConnection(biasInput.id, output.id, Math.random() * 2 - 1);

    return cppn;
}

// Generate waveform from CPPN
function generateWaveform(cppn) {
    const numSamples = WAVETABLE_SIZE;
    const waveform = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
        const t = (i / numSamples) * 2 - 1; // Normalize to [-1, 1]
        const outputs = cppn.activate([t, 1.0]); // time and bias
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

// Create audio buffer from waveform
function createAudioBuffer(waveform) {
    const buffer = audioContext.createBuffer(1, SAMPLE_RATE * SOUND_DURATION, SAMPLE_RATE);
    const channelData = buffer.getChannelData(0);

    // Apply envelope for percussion-like sound (sharp attack, decay)
    for (let i = 0; i < channelData.length; i++) {
        const t = i / channelData.length;
        const wavetableIndex = Math.floor((i % WAVETABLE_SIZE) / WAVETABLE_SIZE * waveform.length);
        const sample = waveform[wavetableIndex];

        // Exponential decay envelope for percussion
        const envelope = Math.exp(-t * 8);
        channelData[i] = sample * envelope;
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

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 2;
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

// Initialize population
function initializePopulation() {
    population = [];

    for (let i = 0; i < 9; i++) {
        const cppn = createMinimalCPPN();

        // Apply several mutations to create variety
        for (let j = 0; j < neatConfig.initialMutations; j++) {
            cppn.mutate();
        }

        const waveform = generateWaveform(cppn);
        const buffer = createAudioBuffer(waveform);

        population.push({
            cppn,
            waveform,
            buffer,
            id: i
        });
    }

    renderPopulation();
    updateStats();
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

        const canvas = document.createElement('canvas');
        canvas.width = 300;
        canvas.height = 80;
        drawWaveform(canvas, individual.waveform);

        const info = document.createElement('div');
        info.className = 'sound-info';
        info.textContent = `Sound ${index + 1} | Complexity: ${individual.cppn.getComplexity()}`;

        item.appendChild(canvas);
        item.appendChild(info);

        item.addEventListener('click', () => {
            // Play sound immediately
            item.classList.add('playing');
            playSound(individual);
            setTimeout(() => item.classList.remove('playing'), 500);

            // Clear previous selection
            selectedIndex = index;

            // Update visual selection
            document.querySelectorAll('.sound-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');

            // Update stats and network visualization
            updateStats();
            drawNetworkTopology(individual.cppn);
        });

        grid.appendChild(item);
    });
}

// Evolve new generation
function evolve() {
    if (selectedIndex === null) {
        alert('Please select a sound to evolve!');
        return;
    }

    const parent = population[selectedIndex];
    const newPopulation = [];

    for (let i = 0; i < 9; i++) {
        const child = parent.cppn.copy();
        child.mutate();

        const waveform = generateWaveform(child);
        const buffer = createAudioBuffer(waveform);

        newPopulation.push({
            cppn: child,
            waveform,
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

    const avgComplexity = population.reduce((sum, ind) => sum + ind.cppn.getComplexity(), 0) / population.length;
    document.getElementById('avg-complexity').textContent = avgComplexity.toFixed(1);
}

// Draw network topology visualization
function drawNetworkTopology(cppn) {
    const canvas = document.getElementById('network-viz');
    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.offsetWidth;
    const height = canvas.height = 400;

    // Clear canvas
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);

    // Organize nodes by type
    const inputNodes = Array.from(cppn.nodes.values()).filter(n => n.type === 'input');
    const outputNodes = Array.from(cppn.nodes.values()).filter(n => n.type === 'output');
    const hiddenNodes = Array.from(cppn.nodes.values()).filter(n => n.type === 'hidden');

    // Position nodes
    const nodePositions = new Map();
    const padding = 40;
    const layerWidth = width - padding * 2;

    // Input nodes on left
    inputNodes.forEach((node, i) => {
        nodePositions.set(node.id, {
            x: padding,
            y: padding + (i + 1) * (height - padding * 2) / (inputNodes.length + 1)
        });
    });

    // Output nodes on right
    outputNodes.forEach((node, i) => {
        nodePositions.set(node.id, {
            x: width - padding,
            y: padding + (i + 1) * (height - padding * 2) / (outputNodes.length + 1)
        });
    });

    // Hidden nodes in middle (simple layout)
    hiddenNodes.forEach((node, i) => {
        const layer = Math.floor(i / 3);
        const posInLayer = i % 3;
        nodePositions.set(node.id, {
            x: padding + layerWidth * (layer + 1) / (Math.ceil(hiddenNodes.length / 3) + 1),
            y: padding + (posInLayer + 1) * (height - padding * 2) / 4
        });
    });

    // Draw connections
    cppn.connections.forEach(conn => {
        if (!conn.enabled) return;

        const fromPos = nodePositions.get(conn.from);
        const toPos = nodePositions.get(conn.to);

        if (!fromPos || !toPos) return;

        // Color by weight
        const weight = Math.max(-3, Math.min(3, conn.weight));
        const normalizedWeight = (weight + 3) / 6; // Normalize to 0-1
        const hue = normalizedWeight * 120; // Green (120) to red (0)
        ctx.strokeStyle = `hsla(${hue}, 70%, 50%, 0.6)`;
        ctx.lineWidth = Math.abs(weight) * 1.5 + 0.5;

        ctx.beginPath();
        ctx.moveTo(fromPos.x, fromPos.y);
        ctx.lineTo(toPos.x, toPos.y);
        ctx.stroke();
    });

    // Draw nodes
    cppn.nodes.forEach((node) => {
        const pos = nodePositions.get(node.id);
        if (!pos) return;

        // Node color by type
        let color;
        if (node.type === 'input') color = '#2196F3';
        else if (node.type === 'output') color = '#4CAF50';
        else color = '#FF9800';

        // Draw node
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 10, 0, Math.PI * 2);
        ctx.fill();

        // Draw border
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw label for hidden nodes (activation function)
        if (node.type === 'hidden') {
            ctx.fillStyle = '#fff';
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(node.activation.slice(0, 3), pos.x, pos.y - 15);
        }
    });

    // Update network info
    const enabledConnections = cppn.connections.filter(c => c.enabled).length;
    const infoDiv = document.getElementById('network-info');
    infoDiv.innerHTML = `
        <div><strong>Nodes:</strong> ${cppn.nodes.size} (${inputNodes.length} in, ${hiddenNodes.length} hidden, ${outputNodes.length} out)</div>
        <div><strong>Connections:</strong> ${enabledConnections} enabled, ${cppn.connections.length - enabledConnections} disabled</div>
        <div><strong>Complexity:</strong> ${cppn.getComplexity()}</div>
        <div style="margin-top: 10px;"><strong>Hidden Activations:</strong></div>
        ${hiddenNodes.map(n => `<div style="margin-left: 10px;">• ${n.activation}</div>`).join('')}
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

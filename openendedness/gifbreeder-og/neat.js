/**
 * NEAT Implementation - Faithful to the original Picbreeder client
 * (CPPNArtEvolution), matching picbreeder_og exactly. Reconstructed from:
 *   - fer (fer/src/process_pb.py + the original genome XML files)
 *   - picbreeder-vlm (picbreeder_vlm/core/neat_components.py,
 *     apply_picbreeder_config_defaults: "Match NEAT settings to the defaults
 *     used by CPPNArtEvolution")
 *
 * Faithful details:
 *   - Inputs: bias, d, x, y (identity); outputs: brightness, hue, saturation
 *   - Activation set: sin, sigmoid, gaussian, cos, identity
 *   - Weights uniform in [-3, 3], hard-clipped there, never disabled/deleted
 *   - Every node carries a grey/color affinity (present in the original XMLs)
 *     that gates where new connections may form
 *   - Each child receives exactly ONE mutation generator, chosen by weight:
 *     mutate_weights 10, add_connection 6, add_node 4, mutate_activation 1
 *
 * GIFBreeder-specific deltas (the only intended departures):
 *   - One extra input node: t (time), fed 0..1 across the 45 GIF frames
 *   - New random weights on connections leaving t are scaled by
 *     timeInputInitialScale so fresh animations start gentle
 *   - Legacy genome compatibility: old R/G/B (and H/S/V) output labels are
 *     normalized to hue/saturation/brightness on load, and missing required
 *     nodes (e.g. t in pre-time genomes) are grafted in disconnected
 */

const NEAT_CONFIG = {
    // 5x4 grid of 20 GIFs (original Picbreeder showed 3x5 = 15)
    populationSize: 20,

    // Weight range - original Picbreeder clips weights to [-3, 3]
    weightMin: -3,
    weightMax: 3,

    // GIF-specific: initial scale on random weights of connections leaving t
    timeInputInitialScale: 0.25,

    // One mutation generator is applied per child, selected by these weights
    // (CPPNArtEvolution's generator ratios)
    generatorWeights: [
        ['mutateWeights', 10],
        ['addConnection', 6],
        ['addNode', 4],
        ['mutateActivation', 1]
    ],

    // mutate_weights: per-connection probability of a gaussian perturbation
    // with sigma = powerMin + (powerMax - powerMin) * mutationStrength
    weightMutateRate: 0.20,
    mutationStrength: 0.5, // legacy client slider default
    weightPowerMin: 0.01,  // legacy slider floor
    weightPowerMax: 2.0,

    // mutate_activation: per-node probability of picking a new random function
    activationMutateRate: 0.05,

    // add_connection: independent chances per affinity pairing
    colorLinkRate: 0.50,
    greyLinkRate: 0.50,
    greyToColorLinkRate: 0.10,

    // Probability a child comes from crossover (when 2+ parents are selected)
    crossoverRate: 0.3,

    // Legacy InkToHSB scaffold: hidden color nodes grafted onto new genomes
    hiddenColorNodes: 2,

    // The Picbreeder activation set
    activationFunctions: ['sin', 'sigmoid', 'gaussian', 'cos', 'identity']
};

function randomWeight() {
    return (Math.random() * 2 - 1) * NEAT_CONFIG.weightMax;
}

function randomActivation() {
    return NEAT_CONFIG.activationFunctions[
        Math.floor(Math.random() * NEAT_CONFIG.activationFunctions.length)
    ];
}

function gaussianRandom() {
    let u = 0;
    while (u === 0) u = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

function clampWeight(weight) {
    return Math.max(NEAT_CONFIG.weightMin, Math.min(NEAT_CONFIG.weightMax, weight));
}

// Older GIFBreeder genomes label outputs R/G/B (or H/S/V); the faithful
// Picbreeder labels are hue/saturation/brightness. Normalized on load.
const LEGACY_OUTPUT_LABEL_MAP = {
    R: 'hue', G: 'saturation', B: 'brightness',
    H: 'hue', S: 'saturation', V: 'brightness',
    ink: 'brightness'
};

function normalizeOutputLabel(label) {
    if (typeof label !== 'string') return label;
    return LEGACY_OUTPUT_LABEL_MAP[label] || label;
}

let NEXT_HISTORY_ID = 1;

function getNextHistoryId() {
    return `h${NEXT_HISTORY_ID++}`;
}

function parseHistoryId(historyId) {
    if (typeof historyId !== 'string') return null;
    const match = /^h(\d+)$/.exec(historyId);
    if (!match) return null;
    return Number.parseInt(match[1], 10);
}

function syncNextHistoryIdFromGenome(genome) {
    if (!genome) return;

    const historyCandidates = new Set();
    if (typeof genome.historyId === 'string') historyCandidates.add(genome.historyId);
    for (const parentId of genome.parentHistoryIds || []) {
        if (typeof parentId === 'string') historyCandidates.add(parentId);
    }

    const lineageRecords = genome.lineageRecords || {};
    for (const [recordKey, record] of Object.entries(lineageRecords)) {
        if (typeof recordKey === 'string') historyCandidates.add(recordKey);
        if (record && typeof record.historyId === 'string') historyCandidates.add(record.historyId);
        for (const parentId of record && Array.isArray(record.parentHistoryIds) ? record.parentHistoryIds : []) {
            if (typeof parentId === 'string') historyCandidates.add(parentId);
        }
    }

    let maxSeen = 0;
    for (const historyId of historyCandidates) {
        const parsed = parseHistoryId(historyId);
        if (Number.isInteger(parsed) && parsed > maxSeen) {
            maxSeen = parsed;
        }
    }

    if (maxSeen > 0) {
        NEXT_HISTORY_ID = Math.max(NEXT_HISTORY_ID, maxSeen + 1);
    }
}

class NodeGene {
    constructor(id, type, activation = 'sigmoid', affinity = 'grey') {
        this.id = id;
        this.type = type;
        this.activation = activation;
        this.affinity = affinity; // 'grey' or 'color' (Picbreeder channel affinity)
        this.label = null;
    }

    clone() {
        const n = new NodeGene(this.id, this.type, this.activation, this.affinity);
        n.label = this.label;
        return n;
    }
}

class ConnectionGene {
    constructor(fromId, toId, weight, enabled = true) {
        this.fromId = fromId;
        this.toId = toId;
        this.weight = weight;
        this.enabled = enabled;
    }

    clone() {
        return new ConnectionGene(this.fromId, this.toId, this.weight, this.enabled);
    }
}

class Genome {
    constructor() {
        this.nodes = new Map();
        this.connections = [];
        this.nextNodeId = 0;
        this.id = Math.random().toString(36).substr(2, 9);
        this.historyId = getNextHistoryId();
        this.generation = 1;
        this.parentHistoryIds = [];
        this.lineageRecords = {};
    }

    getNextNodeId() {
        return this.nextNodeId++;
    }

    // Legacy Picbreeder starting scaffold (CPPNArtEvolution + InkToHSB):
    // the client randomised a grayscale net (inputs -> 1 grey hidden -> ink)
    // and then grafted the color subnet on top: brightness -> hue/saturation,
    // inputs+brightness -> 2 color hidden nodes -> hue/saturation (weight 0),
    // with hue = sin and saturation = sigmoid deterministically (this exact
    // scaffold is visible in the original genome XML files).
    // GIFBreeder adds the t (time) input as a fifth input feeding the same
    // hidden nodes, with its initial weights scaled by timeInputInitialScale.
    static createMinimal() {
        const genome = new Genome();

        // Input nodes (bias node is a constant 1.0 input), ids 0-3 as in the XMLs, plus t
        const inputLabels = ['bias', 'd', 'x', 'y', 't'];
        const inputIds = [];
        for (const label of inputLabels) {
            const id = genome.getNextNodeId();
            const node = new NodeGene(id, 'input', 'identity', 'grey');
            node.label = label;
            genome.nodes.set(id, node);
            inputIds.push(id);
        }

        const brightnessId = genome.getNextNodeId();
        const brightness = new NodeGene(brightnessId, 'output', randomActivation(), 'grey');
        brightness.label = 'brightness';
        genome.nodes.set(brightnessId, brightness);

        const hueId = genome.getNextNodeId();
        const hue = new NodeGene(hueId, 'output', 'sin', 'color');
        hue.label = 'hue';
        genome.nodes.set(hueId, hue);

        const satId = genome.getNextNodeId();
        const saturation = new NodeGene(satId, 'output', 'sigmoid', 'color');
        saturation.label = 'saturation';
        genome.nodes.set(satId, saturation);

        // Grayscale net: inputs -> grey hidden -> brightness
        const greyHiddenId = genome.getNextNodeId();
        genome.nodes.set(greyHiddenId, new NodeGene(greyHiddenId, 'hidden', randomActivation(), 'grey'));
        for (const inId of inputIds) {
            genome.connections.push(new ConnectionGene(inId, greyHiddenId, genome.randomWeightFrom(inId)));
        }
        genome.connections.push(new ConnectionGene(greyHiddenId, brightnessId, randomWeight()));

        // InkToHSB color bootstrap
        genome.connections.push(new ConnectionGene(brightnessId, hueId, randomWeight()));
        genome.connections.push(new ConnectionGene(brightnessId, satId, randomWeight()));

        const colorSources = [...inputIds, brightnessId];
        for (let i = 0; i < NEAT_CONFIG.hiddenColorNodes; i++) {
            const colorHiddenId = genome.getNextNodeId();
            genome.nodes.set(colorHiddenId, new NodeGene(colorHiddenId, 'hidden', randomActivation(), 'color'));
            for (const src of colorSources) {
                genome.connections.push(new ConnectionGene(src, colorHiddenId, genome.randomWeightFrom(src)));
            }
            genome.connections.push(new ConnectionGene(colorHiddenId, hueId, 0.0));
            genome.connections.push(new ConnectionGene(colorHiddenId, satId, 0.0));
        }

        genome.setAsInitial(1);
        return genome;
    }

    serialize() {
        this.updateLineageRecord();

        const lineageRecords = {};
        for (const [historyId, record] of Object.entries(this.lineageRecords || {})) {
            lineageRecords[historyId] = Genome.cloneLineageRecord(record);
        }

        return {
            id: this.id,
            historyId: this.historyId,
            generation: this.generation,
            parentHistoryIds: [...this.parentHistoryIds],
            nextNodeId: this.nextNodeId,
            nodes: this.serializeNodes(),
            connections: this.serializeConnections(),
            lineageRecords
        };
    }

    static deserialize(serializedGenome) {
        if (!serializedGenome || !Array.isArray(serializedGenome.nodes) || !Array.isArray(serializedGenome.connections)) {
            throw new Error('invalid genome serialization');
        }

        const genome = new Genome();
        genome.nodes = new Map();
        genome.connections = [];

        let maxNodeId = -1;
        for (const nodeData of serializedGenome.nodes) {
            if (!Number.isInteger(nodeData.id) || !nodeData.type) continue;
            const activation = typeof nodeData.activation === 'string' ? nodeData.activation : 'sigmoid';
            const label = nodeData.type === 'output'
                ? normalizeOutputLabel(nodeData.label)
                : nodeData.label;
            const affinity = nodeData.affinity === 'color' || nodeData.affinity === 'grey'
                ? nodeData.affinity
                : (label === 'hue' || label === 'saturation' ? 'color' : 'grey');
            const node = new NodeGene(nodeData.id, nodeData.type, activation, affinity);
            node.label = label || null;
            genome.nodes.set(node.id, node);
            if (node.id > maxNodeId) maxNodeId = node.id;
        }

        for (const connData of serializedGenome.connections) {
            if (!Number.isInteger(connData.fromId) || !Number.isInteger(connData.toId)) continue;
            const weight = Number.isFinite(connData.weight) ? connData.weight : 0;
            const enabled = connData.enabled !== false;
            genome.connections.push(new ConnectionGene(connData.fromId, connData.toId, weight, enabled));
        }

        if (genome.nodes.size === 0 || genome.connections.length === 0) {
            throw new Error('genome has no usable nodes/connections');
        }

        genome.nextNodeId = Number.isInteger(serializedGenome.nextNodeId)
            ? serializedGenome.nextNodeId
            : (maxNodeId + 1);
        genome.id = typeof serializedGenome.id === 'string' ? serializedGenome.id : genome.id;
        genome.historyId = typeof serializedGenome.historyId === 'string' ? serializedGenome.historyId : genome.historyId;
        genome.generation = Number.isFinite(serializedGenome.generation) ? serializedGenome.generation : genome.generation;
        genome.parentHistoryIds = Array.isArray(serializedGenome.parentHistoryIds)
            ? serializedGenome.parentHistoryIds.filter((id) => typeof id === 'string')
            : [];

        genome.lineageRecords = {};
        if (serializedGenome.lineageRecords && typeof serializedGenome.lineageRecords === 'object') {
            for (const [historyId, record] of Object.entries(serializedGenome.lineageRecords)) {
                if (!record || typeof record !== 'object') continue;
                const normalizedRecord = {
                    ...record,
                    historyId: typeof record.historyId === 'string' ? record.historyId : historyId
                };
                genome.lineageRecords[historyId] = Genome.cloneLineageRecord(normalizedRecord);
            }
        }

        const grafted = genome.ensureRequiredNodes();
        if (grafted || !genome.lineageRecords[genome.historyId]) {
            genome.updateLineageRecord();
        }

        syncNextHistoryIdFromGenome(genome);
        return genome;
    }

    // GIF-specific compatibility: older genomes may predate the t input or a
    // required output. Graft any missing required node in, disconnected.
    ensureRequiredNodes() {
        const presentLabels = new Set();
        for (const node of this.nodes.values()) {
            if (node.label) presentLabels.add(node.label);
        }

        let changed = false;
        for (const label of ['bias', 'd', 'x', 'y', 't']) {
            if (presentLabels.has(label)) continue;
            const id = this.getNextNodeId();
            const node = new NodeGene(id, 'input', 'identity', 'grey');
            node.label = label;
            this.nodes.set(id, node);
            changed = true;
        }

        for (const label of ['brightness', 'hue', 'saturation']) {
            if (presentLabels.has(label)) continue;
            const id = this.getNextNodeId();
            const affinity = label === 'brightness' ? 'grey' : 'color';
            const node = new NodeGene(id, 'output', 'identity', affinity);
            node.label = label;
            this.nodes.set(id, node);
            changed = true;
        }

        return changed;
    }

    static cloneLineageRecord(record) {
        return {
            historyId: record.historyId,
            genomeId: record.genomeId,
            generation: record.generation,
            parentHistoryIds: Array.isArray(record.parentHistoryIds) ? [...record.parentHistoryIds] : [],
            nodes: Array.isArray(record.nodes) ? record.nodes.map(node => ({ ...node })) : [],
            connections: Array.isArray(record.connections) ? record.connections.map(conn => ({ ...conn })) : []
        };
    }

    static mergeLineageRecordsFromParents(parents) {
        const merged = {};
        for (const parent of parents) {
            if (!parent || !parent.lineageRecords) continue;
            for (const [historyId, record] of Object.entries(parent.lineageRecords)) {
                if (!merged[historyId]) {
                    merged[historyId] = Genome.cloneLineageRecord(record);
                }
            }
        }
        return merged;
    }

    clone() {
        const g = new Genome();
        g.nextNodeId = this.nextNodeId;
        g.id = this.id;
        g.historyId = this.historyId;
        g.generation = this.generation;
        g.parentHistoryIds = [...this.parentHistoryIds];

        for (const [id, node] of this.nodes) {
            g.nodes.set(id, node.clone());
        }

        for (const conn of this.connections) {
            g.connections.push(conn.clone());
        }

        g.lineageRecords = {};
        for (const [historyId, record] of Object.entries(this.lineageRecords)) {
            g.lineageRecords[historyId] = Genome.cloneLineageRecord(record);
        }

        return g;
    }

    serializeNodes() {
        return Array.from(this.nodes.values())
            .map(node => ({
                id: node.id,
                type: node.type,
                activation: node.activation,
                affinity: node.affinity,
                label: node.label
            }))
            .sort((a, b) => a.id - b.id);
    }

    serializeConnections() {
        return this.connections
            .map(conn => ({
                fromId: conn.fromId,
                toId: conn.toId,
                weight: conn.weight,
                enabled: conn.enabled
            }))
            .sort((a, b) => {
                if (a.fromId !== b.fromId) return a.fromId - b.fromId;
                return a.toId - b.toId;
            });
    }

    getStructureSignature() {
        const nodes = this.serializeNodes();
        const connections = this.serializeConnections().map((conn) => ({
            fromId: conn.fromId,
            toId: conn.toId,
            enabled: conn.enabled !== false,
            // Round tiny float noise so exact clones hash together reliably.
            weight: Number.isFinite(conn.weight) ? Number(conn.weight.toFixed(8)) : 0
        }));

        return JSON.stringify({ nodes, connections });
    }

    updateLineageRecord() {
        this.lineageRecords[this.historyId] = {
            historyId: this.historyId,
            genomeId: this.id,
            generation: this.generation,
            parentHistoryIds: [...this.parentHistoryIds],
            nodes: this.serializeNodes(),
            connections: this.serializeConnections()
        };
    }

    setAsInitial(generation = 1) {
        this.generation = generation;
        this.parentHistoryIds = [];
        this.lineageRecords = {};
        this.updateLineageRecord();
    }

    setChildLineage(parents, generation) {
        const uniqueParents = [];
        const seen = new Set();

        for (const parent of parents) {
            if (!parent || !parent.historyId || seen.has(parent.historyId)) continue;
            seen.add(parent.historyId);
            uniqueParents.push(parent);
        }

        this.historyId = getNextHistoryId();
        this.generation = generation;
        this.parentHistoryIds = uniqueParents.map(parent => parent.historyId);
        this.lineageRecords = Genome.mergeLineageRecordsFromParents(uniqueParents);
        this.updateLineageRecord();
    }

    hasConnection(fromId, toId) {
        return this.connections.some(c => c.fromId === fromId && c.toId === toId);
    }

    getNodeLayer(nodeId, memo = new Map(), visiting = new Set()) {
        if (memo.has(nodeId)) return memo.get(nodeId);

        const node = this.nodes.get(nodeId);
        if (!node) {
            memo.set(nodeId, 0);
            return 0;
        }
        if (node.type === 'input') {
            memo.set(nodeId, 0);
            return 0;
        }
        if (visiting.has(nodeId)) {
            // Defensive fallback for accidental recurrent loops.
            memo.set(nodeId, 0);
            return 0;
        }

        visiting.add(nodeId);

        let maxInputLayer = 0;
        for (const conn of this.connections) {
            if (conn.toId === nodeId && conn.enabled) {
                const inputLayer = this.getNodeLayer(conn.fromId, memo, visiting);
                maxInputLayer = Math.max(maxInputLayer, inputLayer + 1);
            }
        }

        visiting.delete(nodeId);
        memo.set(nodeId, maxInputLayer);
        return maxInputLayer;
    }

    // GIF-specific: fresh random weights on connections leaving the t input
    // are scaled down so new time links start gentle.
    getConnectionWeightScale(fromId) {
        const node = this.nodes.get(fromId);
        if (node && node.type === 'input' && node.label === 't') {
            return NEAT_CONFIG.timeInputInitialScale;
        }
        return 1;
    }

    randomWeightFrom(fromId) {
        return randomWeight() * this.getConnectionWeightScale(fromId);
    }

    // mutate_weights generator: every connection has a weightMutateRate chance
    // of a gaussian perturbation; weights are hard-clipped, never replaced.
    mutateWeights() {
        const sigma = NEAT_CONFIG.weightPowerMin
            + (NEAT_CONFIG.weightPowerMax - NEAT_CONFIG.weightPowerMin) * NEAT_CONFIG.mutationStrength;
        for (const conn of this.connections) {
            if (!conn.enabled) continue;
            if (Math.random() < NEAT_CONFIG.weightMutateRate) {
                conn.weight = clampWeight(conn.weight + gaussianRandom() * sigma);
            }
        }
    }

    // mutate_activation generator: every non-input node has a small chance of
    // switching to a random function from the Picbreeder set.
    mutateActivations() {
        for (const node of this.nodes.values()) {
            if (node.type === 'input') continue;
            if (Math.random() < NEAT_CONFIG.activationMutateRate) {
                node.activation = randomActivation();
            }
        }
    }

    inferNewNodeAffinity(fromNode, toNode) {
        if (fromNode.type === 'output') return toNode.affinity;
        return Math.random() < 0.5 ? fromNode.affinity : toNode.affinity;
    }

    // add_node generator: Picbreeder adds a node alongside a random connection.
    // The original connection is KEPT and both new links get fresh random
    // weights (unlike classic NEAT, which disables and splits).
    addRandomNode() {
        if (this.connections.length === 0) return;

        const conn = this.connections[Math.floor(Math.random() * this.connections.length)];
        const fromNode = this.nodes.get(conn.fromId);
        const toNode = this.nodes.get(conn.toId);
        if (!fromNode || !toNode) return;

        const newId = this.getNextNodeId();
        const newNode = new NodeGene(newId, 'hidden', randomActivation(), this.inferNewNodeAffinity(fromNode, toNode));
        this.nodes.set(newId, newNode);

        this.connections.push(new ConnectionGene(conn.fromId, newId, this.randomWeightFrom(conn.fromId)));
        this.connections.push(new ConnectionGene(newId, conn.toId, randomWeight()));
    }

    // add_connection generator: three independent affinity-gated attempts.
    addRandomConnection() {
        if (Math.random() < NEAT_CONFIG.colorLinkRate) this.addConnectionBetweenAffinities('color', 'color');
        if (Math.random() < NEAT_CONFIG.greyLinkRate) this.addConnectionBetweenAffinities('grey', 'grey');
        if (Math.random() < NEAT_CONFIG.greyToColorLinkRate) this.addConnectionBetweenAffinities('grey', 'color');
    }

    addConnectionBetweenAffinities(sourceAffinity, destAffinity) {
        const sources = [];
        const destinations = [];
        for (const node of this.nodes.values()) {
            if (node.affinity === sourceAffinity && node.type !== 'output') sources.push(node);
            if (node.affinity === destAffinity && node.type !== 'input') destinations.push(node);
        }
        if (sources.length === 0 || destinations.length === 0) return false;

        for (let attempt = 0; attempt < 64; attempt++) {
            const fromNode = sources[Math.floor(Math.random() * sources.length)];
            const toNode = destinations[Math.floor(Math.random() * destinations.length)];

            if (fromNode.id === toNode.id) continue;
            if (this.hasConnection(fromNode.id, toNode.id)) continue;
            if (this.createsCycle(fromNode.id, toNode.id)) continue;

            this.connections.push(new ConnectionGene(fromNode.id, toNode.id, this.randomWeightFrom(fromNode.id)));
            return true;
        }
        return false;
    }

    createsCycle(fromId, toId) {
        if (fromId === toId) return true;

        const stack = [toId];
        const visited = new Set();

        while (stack.length > 0) {
            const nodeId = stack.pop();
            if (nodeId === fromId) return true;
            if (visited.has(nodeId)) continue;
            visited.add(nodeId);

            for (const conn of this.connections) {
                if (!conn.enabled) continue;
                if (conn.fromId === nodeId) {
                    stack.push(conn.toId);
                }
            }
        }

        return false;
    }

    selectGenerator() {
        const weights = NEAT_CONFIG.generatorWeights;
        const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
        let threshold = Math.random() * total;
        for (const [name, weight] of weights) {
            threshold -= weight;
            if (threshold <= 0) return name;
        }
        return weights[weights.length - 1][0];
    }

    // Original Picbreeder applies exactly one mutation generator per child.
    mutate() {
        const generator = this.selectGenerator();
        if (generator === 'addNode') {
            this.addRandomNode();
        } else if (generator === 'addConnection') {
            this.addRandomConnection();
        } else if (generator === 'mutateActivation') {
            this.mutateActivations();
        } else {
            this.mutateWeights();
        }
    }

    // Picbreeder crossover (CPPNArtEvolution mating): the child is a clone of
    // parent2; parent1 then donates its missing nodes/connections, matching
    // nodes take parent1's activation half the time, and matching connections
    // average the two parents' weights.
    static crossover(parent1, parent2) {
        const child = parent2.clone();

        for (const [id, donorNode] of parent1.nodes) {
            const recipient = child.nodes.get(id);
            if (!recipient) {
                child.nodes.set(id, donorNode.clone());
            } else if (Math.random() < 0.5) {
                recipient.activation = donorNode.activation;
            }
        }

        const childConns = new Map();
        for (const conn of child.connections) {
            childConns.set(`${conn.fromId}-${conn.toId}`, conn);
        }
        for (const donorConn of parent1.connections) {
            const key = `${donorConn.fromId}-${donorConn.toId}`;
            const recipient = childConns.get(key);
            if (!recipient) {
                child.connections.push(donorConn.clone());
            } else {
                recipient.weight = (recipient.weight + donorConn.weight) / 2;
            }
        }

        child.nextNodeId = Math.max(parent1.nextNodeId, parent2.nextNodeId);
        return child;
    }

    getStats() {
        const hiddenNodes = Array.from(this.nodes.values()).filter(n => n.type === 'hidden');
        const enabledConns = this.connections.filter(c => c.enabled);
        return {
            totalNodes: this.nodes.size,
            hiddenNodes: hiddenNodes.length,
            totalConnections: this.connections.length,
            enabledConnections: enabledConns.length,
            inputNodes: Array.from(this.nodes.values()).filter(n => n.type === 'input').length,
            outputNodes: Array.from(this.nodes.values()).filter(n => n.type === 'output').length
        };
    }

    getLineageGraph() {
        const records = this.lineageRecords || {};
        const visited = new Set();
        const nodes = [];
        const edges = [];
        const stack = [this.historyId];

        while (stack.length > 0) {
            const historyId = stack.pop();
            if (!historyId || visited.has(historyId)) continue;
            visited.add(historyId);

            const record = records[historyId];
            if (!record) continue;

            nodes.push(Genome.cloneLineageRecord(record));

            for (const parentId of record.parentHistoryIds || []) {
                if (!parentId) continue;
                edges.push({ from: parentId, to: historyId });
                if (!visited.has(parentId)) {
                    stack.push(parentId);
                }
            }
        }

        return {
            currentHistoryId: this.historyId,
            nodes,
            edges
        };
    }

    getLineageStats() {
        const graph = this.getLineageGraph();
        const totalNodes = graph.nodes.length;
        const totalEdges = graph.edges.length;
        const ancestorCount = Math.max(totalNodes - 1, 0);
        const roots = graph.nodes.filter(node => (node.parentHistoryIds || []).length === 0);
        const generations = graph.nodes
            .map(node => node.generation)
            .filter(generation => Number.isFinite(generation));

        const minGeneration = generations.length > 0 ? Math.min(...generations) : this.generation;
        const maxGeneration = generations.length > 0 ? Math.max(...generations) : this.generation;
        const depth = maxGeneration - minGeneration + 1;

        return {
            totalNodes,
            totalEdges,
            ancestorCount,
            rootCount: roots.length,
            minGeneration,
            maxGeneration,
            depth
        };
    }

    exportWithLineage() {
        this.updateLineageRecord();

        const graph = this.getLineageGraph();
        const records = {};
        for (const node of graph.nodes) {
            records[node.historyId] = Genome.cloneLineageRecord(node);
        }

        return {
            format: 'cppn-lineage-v1',
            exportedAt: new Date().toISOString(),
            genome: {
                id: this.id,
                historyId: this.historyId,
                generation: this.generation,
                parentHistoryIds: [...this.parentHistoryIds],
                nextNodeId: this.nextNodeId,
                nodes: this.serializeNodes(),
                connections: this.serializeConnections()
            },
            lineage: {
                currentHistoryId: this.historyId,
                nodeCount: graph.nodes.length,
                edgeCount: graph.edges.length,
                records
            }
        };
    }

    getLayers() {
        const layerMemo = new Map();
        const layers = new Map();

        for (const node of this.nodes.values()) {
            let layer;
            if (node.type === 'input') {
                layer = 0;
            } else if (node.type === 'output') {
                layer = 1000;
            } else {
                layer = this.getNodeLayer(node.id, layerMemo);
            }

            if (!layers.has(layer)) {
                layers.set(layer, []);
            }
            layers.get(layer).push(node);
        }

        return Array.from(layers.entries())
            .sort(([a], [b]) => a - b)
            .map(([layer, nodes]) => ({ layer, nodes }));
    }
}

class Population {
    constructor(size = NEAT_CONFIG.populationSize) {
        this.size = size;
        this.genomes = [];
        this.generation = 1;
    }

    initialize() {
        this.genomes = [];
        this.generation = 1;

        for (let i = 0; i < this.size; i++) {
            const genome = Genome.createMinimal();
            genome.id = Math.random().toString(36).substr(2, 9);
            genome.setAsInitial(this.generation);
            this.genomes.push(genome);
        }
    }

    evolve(selectedParents) {
        if (selectedParents.length === 0) {
            return;
        }

        const newGenomes = [];
        const nextGeneration = this.generation + 1;

        // Selected parents are carried over unchanged
        for (const parent of selectedParents) {
            if (newGenomes.length >= this.size) break;
            const clone = parent.clone();
            clone.id = parent.id;
            newGenomes.push(clone);
        }

        // Offspring: crossover with probability crossoverRate (needs 2+ distinct
        // parents), otherwise clone; each child is mutated exactly once.
        while (newGenomes.length < this.size) {
            const parentIndex = Math.floor(Math.random() * selectedParents.length);
            const p1 = selectedParents[parentIndex];

            let child;
            let parents;
            if (selectedParents.length > 1 && Math.random() < NEAT_CONFIG.crossoverRate) {
                let mateIndex = parentIndex;
                while (mateIndex === parentIndex) {
                    mateIndex = Math.floor(Math.random() * selectedParents.length);
                }
                const p2 = selectedParents[mateIndex];
                child = Genome.crossover(p1, p2);
                parents = [p1, p2];
            } else {
                child = p1.clone();
                parents = [p1];
            }

            child.mutate();
            child.id = Math.random().toString(36).substr(2, 9);
            child.setChildLineage(parents, nextGeneration);
            newGenomes.push(child);
        }

        this.genomes = newGenomes;
        this.generation = nextGeneration;
    }

    getGenomes() {
        return this.genomes;
    }

    exportState() {
        return {
            format: 'cppn-population-v1',
            exportedAt: new Date().toISOString(),
            size: this.size,
            generation: this.generation,
            genomes: this.genomes.map((genome) => genome.serialize())
        };
    }

    importState(state) {
        const restored = Population.fromState(state);
        this.size = restored.size;
        this.generation = restored.generation;
        this.genomes = restored.genomes;
    }

    static fromState(state) {
        if (!state || !Array.isArray(state.genomes) || state.genomes.length === 0) {
            throw new Error('invalid population state');
        }

        const size = Number.isInteger(state.size) && state.size > 0
            ? state.size
            : state.genomes.length;
        const population = new Population(size);
        population.generation = Number.isInteger(state.generation) && state.generation > 0
            ? state.generation
            : 1;
        population.genomes = state.genomes.map((serializedGenome) => Genome.deserialize(serializedGenome));
        return population;
    }
}

window.NEAT = {
    NodeGene,
    ConnectionGene,
    Genome,
    Population,
    CONFIG: NEAT_CONFIG
};

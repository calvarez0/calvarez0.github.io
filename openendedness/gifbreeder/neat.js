/**
 * NEAT Implementation - Based on nbenko1's PicBreeder
 */

const NEAT_CONFIG = {
    populationSize: 20,

    // Initial random structure
    initialHiddenNodesMax: 8,

    // Weight mutation
    weightMutationRate: 0.1,
    weightPerturbRate: 0.1,
    weightPerturbPower: 0.1,

    // Structural mutation - PicBreeder uses 50% rates!
    addNodeRate: 0.2,
    addConnectionRate: 0.2,

    // Weight range
    weightMin: -5,
    weightMax: 5,

    // Activation functions
    activationFunctions: ['sigmoid', 'tanh', 'gaussian', 'sin', 'cos', 'abs', 'relu', 'identity']
};

let NEXT_HISTORY_ID = 1;
let NEXT_CONNECTION_INNOVATION = 1;
const REQUIRED_INPUT_LABELS = ['x', 'y', 'd', 't', 'bias'];
const REQUIRED_OUTPUT_LABELS = ['R', 'G', 'B'];
const CANONICAL_INPUT_NODE_IDS = Object.freeze({
    x: 0,
    y: 1,
    d: 2,
    t: 3,
    bias: 4
});
const CANONICAL_OUTPUT_NODE_IDS = Object.freeze({
    R: 5,
    G: 6,
    B: 7
});
let NEXT_NODE_ID = Math.max(...Object.values(CANONICAL_OUTPUT_NODE_IDS)) + 1;
const CONNECTION_INNOVATION_BY_KEY = new Map();
const CONNECTION_KEY_BY_INNOVATION = new Map();
const SPLIT_MUTATION_RECORDS = new Map();
const LEGACY_OUTPUT_LABEL_MAP = {
    H: 'R',
    S: 'G',
    V: 'B'
};

function isValidNodeId(nodeId) {
    return Number.isInteger(nodeId) && nodeId >= 0;
}

function isValidInnovationNumber(innovation) {
    return Number.isInteger(innovation) && innovation > 0;
}

function observeNodeId(nodeId) {
    if (!isValidNodeId(nodeId)) return null;
    NEXT_NODE_ID = Math.max(NEXT_NODE_ID, nodeId + 1);
    return nodeId;
}

function allocateNodeId() {
    return observeNodeId(NEXT_NODE_ID);
}

function getCanonicalNodeId(type, label) {
    if (type === 'input') return CANONICAL_INPUT_NODE_IDS[label] ?? null;
    if (type === 'output') return CANONICAL_OUTPUT_NODE_IDS[normalizeOutputLabel(label)] ?? null;
    return null;
}

function getConnectionInnovationKey(fromId, toId) {
    return `${fromId}->${toId}`;
}

function registerConnectionInnovation(fromId, toId, innovation = null) {
    const key = getConnectionInnovationKey(fromId, toId);
    const existingInnovation = CONNECTION_INNOVATION_BY_KEY.get(key);

    if (isValidInnovationNumber(existingInnovation)) {
        if (isValidInnovationNumber(innovation)) {
            NEXT_CONNECTION_INNOVATION = Math.max(NEXT_CONNECTION_INNOVATION, innovation + 1);
            CONNECTION_KEY_BY_INNOVATION.set(innovation, key);
        }
        return existingInnovation;
    }

    const resolvedInnovation = isValidInnovationNumber(innovation)
        ? innovation
        : NEXT_CONNECTION_INNOVATION++;

    CONNECTION_INNOVATION_BY_KEY.set(key, resolvedInnovation);
    CONNECTION_KEY_BY_INNOVATION.set(resolvedInnovation, key);
    NEXT_CONNECTION_INNOVATION = Math.max(NEXT_CONNECTION_INNOVATION, resolvedInnovation + 1);
    return resolvedInnovation;
}

function registerSplitMutation(sourceConnection, options = {}) {
    if (!sourceConnection) return null;

    const sourceInnovation = registerConnectionInnovation(
        sourceConnection.fromId,
        sourceConnection.toId,
        sourceConnection.innovation
    );

    const existingRecord = SPLIT_MUTATION_RECORDS.get(sourceInnovation);
    if (existingRecord) {
        observeNodeId(existingRecord.nodeId);
        registerConnectionInnovation(
            sourceConnection.fromId,
            existingRecord.nodeId,
            existingRecord.fromInnovation
        );
        registerConnectionInnovation(
            existingRecord.nodeId,
            sourceConnection.toId,
            existingRecord.toInnovation
        );
        return { ...existingRecord };
    }

    const nodeId = isValidNodeId(options.nodeId)
        ? observeNodeId(options.nodeId)
        : allocateNodeId();
    const activation = typeof options.activation === 'string'
        ? options.activation
        : 'sigmoid';
    const fromInnovation = registerConnectionInnovation(
        sourceConnection.fromId,
        nodeId,
        options.fromInnovation
    );
    const toInnovation = registerConnectionInnovation(
        nodeId,
        sourceConnection.toId,
        options.toInnovation
    );
    const record = {
        sourceInnovation,
        nodeId,
        activation,
        fromInnovation,
        toInnovation
    };

    SPLIT_MUTATION_RECORDS.set(sourceInnovation, record);
    return { ...record };
}

function resetInnovationTracking() {
    NEXT_CONNECTION_INNOVATION = 1;
    NEXT_NODE_ID = Math.max(...Object.values(CANONICAL_OUTPUT_NODE_IDS)) + 1;
    CONNECTION_INNOVATION_BY_KEY.clear();
    CONNECTION_KEY_BY_INNOVATION.clear();
    SPLIT_MUTATION_RECORDS.clear();
}

function exportInnovationState() {
    return {
        nextConnectionInnovation: NEXT_CONNECTION_INNOVATION,
        nextNodeId: NEXT_NODE_ID,
        connectionInnovations: Array.from(CONNECTION_INNOVATION_BY_KEY.entries())
            .map(([key, innovation]) => ({ key, innovation }))
            .sort((a, b) => a.innovation - b.innovation),
        splitMutations: Array.from(SPLIT_MUTATION_RECORDS.entries())
            .map(([sourceInnovation, record]) => ({
                sourceInnovation,
                nodeId: record.nodeId,
                activation: record.activation,
                fromInnovation: record.fromInnovation,
                toInnovation: record.toInnovation
            }))
            .sort((a, b) => a.sourceInnovation - b.sourceInnovation)
    };
}

function importInnovationState(state, options = {}) {
    if (options.reset === true) {
        resetInnovationTracking();
    }

    if (!state || typeof state !== 'object') return;

    if (Array.isArray(state.connectionInnovations)) {
        for (const entry of state.connectionInnovations) {
            if (!entry || typeof entry !== 'object') continue;
            let fromId = null;
            let toId = null;

            if (typeof entry.key === 'string') {
                const match = /^(-?\d+)->(-?\d+)$/.exec(entry.key);
                if (match) {
                    fromId = Number.parseInt(match[1], 10);
                    toId = Number.parseInt(match[2], 10);
                }
            }

            if (!isValidNodeId(fromId) || !isValidNodeId(toId)) continue;
            registerConnectionInnovation(fromId, toId, entry.innovation);
            observeNodeId(fromId);
            observeNodeId(toId);
        }
    }

    if (Array.isArray(state.splitMutations)) {
        for (const entry of state.splitMutations) {
            if (!entry || typeof entry !== 'object') continue;
            if (!isValidInnovationNumber(entry.sourceInnovation)) continue;
            if (!isValidNodeId(entry.nodeId)) continue;

            observeNodeId(entry.nodeId);
            SPLIT_MUTATION_RECORDS.set(entry.sourceInnovation, {
                sourceInnovation: entry.sourceInnovation,
                nodeId: entry.nodeId,
                activation: typeof entry.activation === 'string' ? entry.activation : 'sigmoid',
                fromInnovation: isValidInnovationNumber(entry.fromInnovation) ? entry.fromInnovation : null,
                toInnovation: isValidInnovationNumber(entry.toInnovation) ? entry.toInnovation : null
            });
        }
    }

    if (Number.isInteger(state.nextConnectionInnovation) && state.nextConnectionInnovation > 0) {
        NEXT_CONNECTION_INNOVATION = Math.max(NEXT_CONNECTION_INNOVATION, state.nextConnectionInnovation);
    }
    if (isValidNodeId(state.nextNodeId)) {
        NEXT_NODE_ID = Math.max(NEXT_NODE_ID, state.nextNodeId);
    }
}

function normalizeOutputLabel(label) {
    if (typeof label !== 'string') return label;
    return LEGACY_OUTPUT_LABEL_MAP[label] || label;
}

function normalizeNodeLabel(type, label) {
    if (type === 'output') return normalizeOutputLabel(label);
    return label;
}

function cloneLineageNode(node) {
    if (!node || typeof node !== 'object') return null;
    return {
        ...node,
        label: normalizeNodeLabel(node.type, node.label) || null
    };
}

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

function syncInnovationTrackingFromGenome(genome) {
    if (!genome) return;

    for (const node of genome.nodes.values()) {
        observeNodeId(node.id);
    }
    for (const conn of genome.connections) {
        observeNodeId(conn.fromId);
        observeNodeId(conn.toId);
        if (isValidInnovationNumber(conn.innovation)) {
            registerConnectionInnovation(conn.fromId, conn.toId, conn.innovation);
        }
    }

    for (const record of Object.values(genome.lineageRecords || {})) {
        if (!record || typeof record !== 'object') continue;
        for (const node of Array.isArray(record.nodes) ? record.nodes : []) {
            observeNodeId(node.id);
        }
        for (const conn of Array.isArray(record.connections) ? record.connections : []) {
            observeNodeId(conn.fromId);
            observeNodeId(conn.toId);
            if (isValidInnovationNumber(conn.innovation)) {
                registerConnectionInnovation(conn.fromId, conn.toId, conn.innovation);
            }
        }
    }
}

class NodeGene {
    constructor(id, type, activation = 'sigmoid') {
        this.id = id;
        this.type = type;
        this.activation = activation;
        this.label = null;
    }

    clone() {
        const n = new NodeGene(this.id, this.type, this.activation);
        n.label = normalizeNodeLabel(this.type, this.label) || null;
        return n;
    }
}

class ConnectionGene {
    constructor(fromId, toId, weight, enabled = true, innovation = null) {
        this.fromId = fromId;
        this.toId = toId;
        this.weight = weight;
        this.enabled = enabled;
        this.innovation = registerConnectionInnovation(fromId, toId, innovation);
    }

    clone() {
        return new ConnectionGene(this.fromId, this.toId, this.weight, this.enabled, this.innovation);
    }
}

class Genome {
    constructor() {
        this.nodes = new Map();
        this.connections = [];
        this.nextNodeId = NEXT_NODE_ID;
        this.id = Math.random().toString(36).substr(2, 9);
        this.historyId = getNextHistoryId();
        this.generation = 1;
        this.parentHistoryIds = [];
        this.lineageRecords = {};
    }

    trackNodeId(nodeId) {
        if (!isValidNodeId(nodeId)) return null;
        observeNodeId(nodeId);
        this.nextNodeId = Math.max(this.nextNodeId, nodeId + 1);
        return nodeId;
    }

    getNextNodeId() {
        return this.trackNodeId(allocateNodeId());
    }

    // GifBreeder mapping: x, y, d, t, bias -> R, G, B
    static createMinimal() {
        const genome = new Genome();

        // Input nodes (bias node is a constant 1.0 input)
        const inputLabels = REQUIRED_INPUT_LABELS;
        const inputIds = [];
        for (const label of inputLabels) {
            const id = genome.trackNodeId(getCanonicalNodeId('input', label));
            const node = new NodeGene(id, 'input', 'identity');
            node.label = label;
            genome.nodes.set(id, node);
            inputIds.push(id);
        }

        // Output nodes: R, G, B (identity activation, sigmoid applied later)
        const outputLabels = REQUIRED_OUTPUT_LABELS;
        const outputIds = [];
        for (const label of outputLabels) {
            const id = genome.trackNodeId(getCanonicalNodeId('output', label));
            const node = new NodeGene(id, 'output', 'identity');
            node.label = label;
            genome.nodes.set(id, node);
            outputIds.push(id);
        }

        // Connect each input to each output
        for (const inId of inputIds) {
            for (const outId of outputIds) {
                const weight = (Math.random() * 2 - 1) * 2;
                genome.connections.push(new ConnectionGene(inId, outId, weight));
            }
        }

        genome.setAsInitial(1);
        return genome;
    }

    connectInputToOutputs(inputNodeId) {
        const outputIds = Array.from(this.nodes.values())
            .filter((node) => node.type === 'output')
            .map((node) => node.id);

        for (const outId of outputIds) {
            if (this.hasConnection(inputNodeId, outId)) continue;
            const weight = (Math.random() * 2 - 1) * 2;
            this.connections.push(new ConnectionGene(inputNodeId, outId, weight));
        }
    }

    connectInputsToOutput(outputNodeId) {
        const inputIds = Array.from(this.nodes.values())
            .filter((node) => node.type === 'input')
            .map((node) => node.id);

        for (const inputId of inputIds) {
            if (this.hasConnection(inputId, outputNodeId)) continue;
            const weight = (Math.random() * 2 - 1) * 2;
            this.connections.push(new ConnectionGene(inputId, outputNodeId, weight));
        }
    }

    ensureRequiredInputs() {
        const inputLabelToNode = new Map();
        for (const node of this.nodes.values()) {
            if (node.type !== 'input' || typeof node.label !== 'string') continue;
            if (!inputLabelToNode.has(node.label)) {
                inputLabelToNode.set(node.label, node);
            }
        }

        let changed = false;
        for (const label of REQUIRED_INPUT_LABELS) {
            if (inputLabelToNode.has(label)) continue;

            const id = this.trackNodeId(getCanonicalNodeId('input', label));
            const node = new NodeGene(id, 'input', 'identity');
            node.label = label;
            this.nodes.set(id, node);
            this.connectInputToOutputs(id);
            changed = true;
        }

        return changed;
    }

    ensureRequiredOutputs() {
        const outputLabelToNode = new Map();

        let changed = false;
        for (const node of this.nodes.values()) {
            if (node.type !== 'output') continue;

            const normalizedLabel = normalizeOutputLabel(node.label);
            if (normalizedLabel !== node.label) {
                node.label = normalizedLabel;
                changed = true;
            }

            if (typeof node.label === 'string' && !outputLabelToNode.has(node.label)) {
                outputLabelToNode.set(node.label, node);
            }
        }

        for (const label of REQUIRED_OUTPUT_LABELS) {
            if (outputLabelToNode.has(label)) continue;

            const id = this.trackNodeId(getCanonicalNodeId('output', label));
            const node = new NodeGene(id, 'output', 'identity');
            node.label = label;
            this.nodes.set(id, node);
            this.connectInputsToOutput(id);
            changed = true;
        }

        return changed;
    }

    // Randomly initialize with hidden node count uniformly sampled from [0, maxInitialHidden].
    static createRandomizedInitial(maxInitialHidden = NEAT_CONFIG.initialHiddenNodesMax) {
        const genome = Genome.createMinimal();
        const maxHidden = Math.max(0, Math.floor(maxInitialHidden));
        const targetHidden = Math.floor(Math.random() * (maxHidden + 1));

        for (let i = 0; i < targetHidden; i++) {
            genome.addRandomNode();
        }

        // Add a few random extra links so higher-node starts are structurally diverse.
        const extraConnections = Math.floor(Math.random() * (targetHidden + 2));
        for (let i = 0; i < extraConnections; i++) {
            genome.addRandomConnection();
        }

        genome.mutateWeights();
        genome.setAsInitial(1);
        return genome;
    }

    static cloneSerializedLineageRecord(record) {
        if (!record || typeof record !== 'object') return null;
        return {
            ...record,
            nodes: Array.isArray(record.nodes) ? record.nodes.map((node) => ({ ...node })) : [],
            connections: Array.isArray(record.connections) ? record.connections.map((conn) => ({ ...conn })) : []
        };
    }

    static prepareSerializedGenome(serializedGenome) {
        const prepared = {
            ...serializedGenome,
            nodes: Array.isArray(serializedGenome.nodes)
                ? serializedGenome.nodes.map((node) => ({ ...node }))
                : [],
            connections: Array.isArray(serializedGenome.connections)
                ? serializedGenome.connections.map((conn) => ({ ...conn }))
                : []
        };

        prepared.lineageRecords = {};
        if (serializedGenome.lineageRecords && typeof serializedGenome.lineageRecords === 'object') {
            for (const [historyId, record] of Object.entries(serializedGenome.lineageRecords)) {
                const clonedRecord = Genome.cloneSerializedLineageRecord(record);
                if (clonedRecord) prepared.lineageRecords[historyId] = clonedRecord;
            }
        }

        const allConnectionLists = [prepared.connections];
        for (const record of Object.values(prepared.lineageRecords)) {
            allConnectionLists.push(Array.isArray(record.connections) ? record.connections : []);
        }
        const hasCompleteInnovationData = allConnectionLists.every((connections) => {
            return connections.every((conn) => isValidInnovationNumber(conn.innovation));
        });

        if (!hasCompleteInnovationData) {
            Genome.upgradeLegacySerializedGenome(prepared);
        }

        return prepared;
    }

    static upgradeLegacySerializedGenome(serializedGenome) {
        const nodeIdMap = new Map();
        const nodeCollections = [serializedGenome.nodes];
        const connectionCollections = [serializedGenome.connections];

        for (const record of Object.values(serializedGenome.lineageRecords || {})) {
            if (!record || typeof record !== 'object') continue;
            nodeCollections.push(Array.isArray(record.nodes) ? record.nodes : []);
            connectionCollections.push(Array.isArray(record.connections) ? record.connections : []);
        }

        const remapNodes = (nodes) => {
            for (const nodeData of nodes) {
                if (!nodeData || !nodeData.type) continue;

                const oldId = nodeData.id;
                nodeData.label = normalizeNodeLabel(nodeData.type, nodeData.label) || null;

                if (!isValidNodeId(oldId)) {
                    const canonicalId = getCanonicalNodeId(nodeData.type, nodeData.label);
                    nodeData.id = isValidNodeId(canonicalId) ? canonicalId : allocateNodeId();
                    observeNodeId(nodeData.id);
                    continue;
                }

                if (!nodeIdMap.has(oldId)) {
                    const canonicalId = getCanonicalNodeId(nodeData.type, nodeData.label);
                    nodeIdMap.set(
                        oldId,
                        isValidNodeId(canonicalId) ? canonicalId : allocateNodeId()
                    );
                }

                nodeData.id = nodeIdMap.get(oldId);
                observeNodeId(nodeData.id);
            }
        };

        const remapNodeId = (nodeId) => {
            if (!isValidNodeId(nodeId)) return nodeId;
            if (nodeIdMap.has(nodeId)) return nodeIdMap.get(nodeId);
            return nodeId;
        };

        for (const nodes of nodeCollections) {
            remapNodes(Array.isArray(nodes) ? nodes : []);
        }

        for (const connections of connectionCollections) {
            for (const connData of Array.isArray(connections) ? connections : []) {
                if (!connData) continue;
                connData.fromId = remapNodeId(connData.fromId);
                connData.toId = remapNodeId(connData.toId);
                if (isValidNodeId(connData.fromId)) observeNodeId(connData.fromId);
                if (isValidNodeId(connData.toId)) observeNodeId(connData.toId);
                connData.innovation = registerConnectionInnovation(
                    connData.fromId,
                    connData.toId,
                    connData.innovation
                );
            }
        }
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
        const preparedGenome = Genome.prepareSerializedGenome(serializedGenome);

        let maxNodeId = -1;
        for (const nodeData of preparedGenome.nodes) {
            if (!Number.isInteger(nodeData.id) || !nodeData.type) continue;
            const activation = typeof nodeData.activation === 'string' ? nodeData.activation : 'sigmoid';
            const node = new NodeGene(nodeData.id, nodeData.type, activation);
            node.label = normalizeNodeLabel(node.type, nodeData.label) || null;
            genome.nodes.set(node.id, node);
            if (node.id > maxNodeId) maxNodeId = node.id;
            genome.trackNodeId(node.id);
        }

        for (const connData of preparedGenome.connections) {
            if (!Number.isInteger(connData.fromId) || !Number.isInteger(connData.toId)) continue;
            const weight = Number.isFinite(connData.weight) ? connData.weight : 0;
            const enabled = connData.enabled !== false;
            genome.connections.push(new ConnectionGene(
                connData.fromId,
                connData.toId,
                weight,
                enabled,
                connData.innovation
            ));
        }

        if (genome.nodes.size === 0 || genome.connections.length === 0) {
            throw new Error('genome has no usable nodes/connections');
        }

        genome.nextNodeId = Number.isInteger(preparedGenome.nextNodeId)
            ? preparedGenome.nextNodeId
            : (maxNodeId + 1);
        genome.nextNodeId = Math.max(genome.nextNodeId, maxNodeId + 1);
        genome.id = typeof preparedGenome.id === 'string' ? preparedGenome.id : genome.id;
        genome.historyId = typeof preparedGenome.historyId === 'string' ? preparedGenome.historyId : genome.historyId;
        genome.generation = Number.isFinite(preparedGenome.generation) ? preparedGenome.generation : genome.generation;
        genome.parentHistoryIds = Array.isArray(preparedGenome.parentHistoryIds)
            ? preparedGenome.parentHistoryIds.filter((id) => typeof id === 'string')
            : [];

        genome.lineageRecords = {};
        if (preparedGenome.lineageRecords && typeof preparedGenome.lineageRecords === 'object') {
            for (const [historyId, record] of Object.entries(preparedGenome.lineageRecords)) {
                if (!record || typeof record !== 'object') continue;
                const normalizedRecord = {
                    ...record,
                    historyId: typeof record.historyId === 'string' ? record.historyId : historyId
                };
                genome.lineageRecords[historyId] = Genome.cloneLineageRecord(normalizedRecord);
            }
        }

        const upgradedInputs = genome.ensureRequiredInputs();
        const upgradedOutputs = genome.ensureRequiredOutputs();

        if (upgradedInputs || upgradedOutputs || !genome.lineageRecords[genome.historyId]) {
            genome.updateLineageRecord();
        }

        syncInnovationTrackingFromGenome(genome);
        syncNextHistoryIdFromGenome(genome);
        return genome;
    }

    static cloneLineageRecord(record) {
        return {
            historyId: record.historyId,
            genomeId: record.genomeId,
            generation: record.generation,
            parentHistoryIds: Array.isArray(record.parentHistoryIds) ? [...record.parentHistoryIds] : [],
            nodes: Array.isArray(record.nodes) ? record.nodes.map(cloneLineageNode).filter(Boolean) : [],
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
                label: normalizeNodeLabel(node.type, node.label) || null
            }))
            .sort((a, b) => a.id - b.id);
    }

    serializeConnections() {
        return this.connections
            .map(conn => ({
                fromId: conn.fromId,
                toId: conn.toId,
                weight: conn.weight,
                enabled: conn.enabled,
                innovation: conn.innovation
            }))
            .sort((a, b) => {
                if ((a.innovation || 0) !== (b.innovation || 0)) {
                    return (a.innovation || 0) - (b.innovation || 0);
                }
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

    mutateWeights() {
        for (const conn of this.connections) {
            if (Math.random() < NEAT_CONFIG.weightMutationRate) {
                if (Math.random() < NEAT_CONFIG.weightPerturbRate) {
                    conn.weight += (Math.random() * 2 - 1) * NEAT_CONFIG.weightPerturbPower;
                } else {
                    conn.weight = (Math.random() * 2 - 1) * NEAT_CONFIG.weightMax;
                }
                conn.weight = Math.max(NEAT_CONFIG.weightMin, Math.min(NEAT_CONFIG.weightMax, conn.weight));
            }
        }
    }

    addRandomNode() {
        const enabledConns = this.connections.filter(c => c.enabled);
        if (enabledConns.length === 0) return;

        const conn = enabledConns[Math.floor(Math.random() * enabledConns.length)];
        conn.enabled = false;
        const activation = NEAT_CONFIG.activationFunctions[
            Math.floor(Math.random() * NEAT_CONFIG.activationFunctions.length)
        ];
        const splitRecord = registerSplitMutation(conn, { activation });

        this.trackNodeId(splitRecord.nodeId);
        if (!this.nodes.has(splitRecord.nodeId)) {
            const newNode = new NodeGene(splitRecord.nodeId, 'hidden', splitRecord.activation);
            this.nodes.set(splitRecord.nodeId, newNode);
        }

        this.connections.push(new ConnectionGene(
            conn.fromId,
            splitRecord.nodeId,
            1.0,
            true,
            splitRecord.fromInnovation
        ));
        this.connections.push(new ConnectionGene(
            splitRecord.nodeId,
            conn.toId,
            conn.weight,
            true,
            splitRecord.toInnovation
        ));
    }

    addRandomConnection() {
        const nodeList = Array.from(this.nodes.values());

        for (let attempt = 0; attempt < 30; attempt++) {
            const fromNode = nodeList[Math.floor(Math.random() * nodeList.length)];
            const toNode = nodeList[Math.floor(Math.random() * nodeList.length)];

            if (fromNode.id === toNode.id) continue;
            if (toNode.type === 'input') continue;
            if (fromNode.type === 'output') continue;

            if (this.hasConnection(fromNode.id, toNode.id)) continue;
            if (this.createsCycle(fromNode.id, toNode.id)) continue;

            const weight = (Math.random() * 2 - 1) * NEAT_CONFIG.weightMax;
            this.connections.push(new ConnectionGene(fromNode.id, toNode.id, weight));
            return;
        }
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

    mutate() {
        this.mutateWeights();

        // PicBreeder uses 50% chance for structural mutations
        if (Math.random() < NEAT_CONFIG.addNodeRate) {
            this.addRandomNode();
        }

        if (Math.random() < NEAT_CONFIG.addConnectionRate) {
            this.addRandomConnection();
        }
    }

    static crossover(parent1, parent2) {
        const child = new Genome();
        child.nextNodeId = Math.max(parent1.nextNodeId, parent2.nextNodeId, NEXT_NODE_ID);

        const dominantParent = Math.random() < 0.5 ? parent1 : parent2;
        const recessiveParent = dominantParent === parent1 ? parent2 : parent1;
        const dominantMap = new Map();
        const recessiveMap = new Map();

        for (const conn of dominantParent.connections) {
            if (!isValidInnovationNumber(conn.innovation)) continue;
            dominantMap.set(conn.innovation, conn);
        }
        for (const conn of recessiveParent.connections) {
            if (!isValidInnovationNumber(conn.innovation)) continue;
            recessiveMap.set(conn.innovation, conn);
        }

        const sortedInnovations = Array.from(new Set([
            ...dominantMap.keys(),
            ...recessiveMap.keys()
        ])).sort((a, b) => a - b);

        const inheritedConnections = [];
        for (const innovation of sortedInnovations) {
            const dominantConn = dominantMap.get(innovation) || null;
            const recessiveConn = recessiveMap.get(innovation) || null;
            let candidate = null;

            if (dominantConn && recessiveConn) {
                const weightSource = Math.random() < 0.5 ? dominantConn : recessiveConn;
                let enabled = weightSource.enabled;
                if (dominantConn.enabled === false || recessiveConn.enabled === false) {
                    enabled = Math.random() >= 0.75;
                }

                candidate = new ConnectionGene(
                    dominantConn.fromId,
                    dominantConn.toId,
                    weightSource.weight,
                    enabled,
                    innovation
                );
            } else if (dominantConn) {
                candidate = dominantConn.clone();
            } else {
                continue;
            }

            if (candidate.enabled && child.createsCycle(candidate.fromId, candidate.toId)) {
                continue;
            }
            inheritedConnections.push(candidate);
        }

        const copyNodeFromParents = (nodeId) => {
            if (!isValidNodeId(nodeId) || child.nodes.has(nodeId)) return;
            const sourceNode = dominantParent.nodes.get(nodeId) || recessiveParent.nodes.get(nodeId);
            if (!sourceNode) return;
            child.nodes.set(nodeId, sourceNode.clone());
            child.trackNodeId(nodeId);
        };

        for (const parent of [dominantParent, recessiveParent]) {
            for (const node of parent.nodes.values()) {
                if (node.type === 'input' || node.type === 'output') {
                    copyNodeFromParents(node.id);
                }
            }
        }
        for (const conn of inheritedConnections) {
            copyNodeFromParents(conn.fromId);
            copyNodeFromParents(conn.toId);
        }

        child.connections = inheritedConnections;
        child.ensureRequiredInputs();
        child.ensureRequiredOutputs();

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
        const stack = [{
            historyId: this.historyId,
            generationHint: Number.isFinite(this.generation) ? this.generation : null
        }];

        while (stack.length > 0) {
            const entry = stack.pop();
            const historyId = entry && entry.historyId;
            if (!historyId || visited.has(historyId)) continue;
            visited.add(historyId);

            const record = records[historyId];
            if (!record) {
                nodes.push({
                    historyId,
                    genomeId: null,
                    generation: Number.isFinite(entry && entry.generationHint) ? entry.generationHint : null,
                    parentHistoryIds: [],
                    nodes: [],
                    connections: [],
                    missingRecord: true
                });
                continue;
            }

            const clonedRecord = Genome.cloneLineageRecord(record);
            if (!Number.isFinite(clonedRecord.generation)
                && Number.isFinite(entry && entry.generationHint)) {
                clonedRecord.generation = entry.generationHint;
            }
            nodes.push(clonedRecord);

            const nextGenerationHint = Number.isFinite(clonedRecord.generation)
                ? clonedRecord.generation - 1
                : null;
            for (const parentId of clonedRecord.parentHistoryIds || []) {
                if (!parentId) continue;
                edges.push({ from: parentId, to: historyId });
                if (!visited.has(parentId)) {
                    stack.push({
                        historyId: parentId,
                        generationHint: nextGenerationHint
                    });
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
        const missingRecordCount = graph.nodes.filter(node => node && node.missingRecord === true).length;

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
            depth,
            missingRecordCount
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
            innovationState: exportInnovationState(),
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
        resetInnovationTracking();
        this.genomes = [];
        this.generation = 1;

        for (let i = 0; i < this.size; i++) {
            const genome = Genome.createRandomizedInitial(NEAT_CONFIG.initialHiddenNodesMax);
            genome.id = Math.random().toString(36).substr(2, 9);
            genome.setAsInitial(this.generation);
            this.genomes.push(genome);
        }

        this.ensureUniqueGenomeStructures();
    }

    evolve(selectedParents) {
        if (selectedParents.length === 0) {
            return;
        }

        const newGenomes = [];
        const nextGeneration = this.generation + 1;

        // Elitism: keep selected parents unchanged
        for (const parent of selectedParents) {
            if (newGenomes.length >= this.size) break;
            const clone = parent.clone();
            clone.id = parent.id;
            newGenomes.push(clone);
        }

        // Fill rest with offspring
        while (newGenomes.length < this.size) {
            const p1 = selectedParents[Math.floor(Math.random() * selectedParents.length)];
            const p2 = selectedParents[Math.floor(Math.random() * selectedParents.length)];

            let child;
            if (p1 === p2 || Math.random() < 0.25) {
                child = p1.clone();
            } else {
                child = Genome.crossover(p1, p2);
            }

            child.mutate();
            child.id = Math.random().toString(36).substr(2, 9);
            child.setChildLineage([p1, p2], nextGeneration);
            newGenomes.push(child);
        }

        this.genomes = newGenomes;
        this.generation = nextGeneration;
        this.ensureUniqueGenomeStructures();
    }

    ensureUniqueGenomeStructures(maxAttemptsPerGenome = 24) {
        const seen = new Set();

        for (const genome of this.genomes) {
            if (!genome) continue;

            let signature = genome.getStructureSignature();
            let attempts = 0;

            while (seen.has(signature) && attempts < maxAttemptsPerGenome) {
                // Always perturb at least one connection so exact clones diverge.
                if (genome.connections.length > 0) {
                    const idx = Math.floor(Math.random() * genome.connections.length);
                    const conn = genome.connections[idx];
                    const perturb = (Math.random() * 2 - 1) * Math.max(0.05, NEAT_CONFIG.weightPerturbPower);
                    conn.weight = Math.max(
                        NEAT_CONFIG.weightMin,
                        Math.min(NEAT_CONFIG.weightMax, conn.weight + perturb)
                    );
                }

                // Escalate to structural changes if simple perturbations still collide.
                if (attempts % 4 === 0) genome.addRandomConnection();
                if (attempts % 7 === 0) genome.addRandomNode();

                genome.updateLineageRecord();
                signature = genome.getStructureSignature();
                attempts += 1;
            }

            seen.add(signature);
        }
    }

    getGenomes() {
        return this.genomes;
    }

    exportState() {
        return {
            format: 'cppn-population-v1',
            exportedAt: new Date().toISOString(),
            innovationState: exportInnovationState(),
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

        resetInnovationTracking();
        if (state.innovationState && typeof state.innovationState === 'object') {
            importInnovationState(state.innovationState);
        }

        const size = Number.isInteger(state.size) && state.size > 0
            ? state.size
            : state.genomes.length;
        const population = new Population(size);
        population.generation = Number.isInteger(state.generation) && state.generation > 0
            ? state.generation
            : 1;
        population.genomes = state.genomes.map((serializedGenome) => Genome.deserialize(serializedGenome));
        population.ensureUniqueGenomeStructures();
        return population;
    }
}

window.NEAT = {
    NodeGene,
    ConnectionGene,
    Genome,
    Population,
    CONFIG: NEAT_CONFIG,
    exportInnovationState,
    importInnovationState,
    resetInnovationState: resetInnovationTracking
};

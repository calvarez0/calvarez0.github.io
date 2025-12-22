const { useState, useEffect, useRef } = React;

// SVG Icon components
const Icons = {
    shield: (props) => (
        <svg
            {...props}
            fill="none"
            viewBox="0 2.8 24 24" // shift the viewBox up slightly
            stroke="currentColor"
            strokeWidth={2}
        >
            <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3L3 8v7c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V8l-9-5z"
            />
        </svg>
    ),
    heart: (props) => (
        <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
    ),
    chevronRight: (props) => (
        <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
    ),
    chevronLeft: (props) => (
        <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
    ),
    home: (props) => (
        <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 22V12h6v10" />
        </svg>
    ),
    checkCircle: (props) => (
        <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
        </svg>
    ),
    alertCircle: (props) => (
        <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
    ),
    brain: (props) => (
        <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 2a2.5 2.5 0 0 0-2.5 2.5v.33a2 2 0 0 1-2 2 2 2 0 0 0-2 2v3a2 2 0 0 0 2 2 2 2 0 0 1 2 2v.33a2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0 2.5-2.5V2.5A2.5 2.5 0 0 0 9.5 2z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.5 2a2.5 2.5 0 0 1 2.5 2.5v.33a2 2 0 0 0 2 2 2 2 0 0 1 2 2v3a2 2 0 0 1-2 2 2 2 0 0 0-2 2v.33a2.5 2.5 0 0 1-2.5 2.5 2.5 2.5 0 0 1-2.5-2.5V2.5A2.5 2.5 0 0 1 14.5 2z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 19v3m5-3v3M2 12h5m10 0h5" />
        </svg>
    ),
    users: (props) => (
        <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
    ),
    send: (props) => (
        <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
    ),
    messageCircle: (props) => (
        <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
    )
};

const Icon = ({ name, className }) => {
    const IconComponent = Icons[name];
    return IconComponent ? <IconComponent className={className} /> : null;
};

const ChatInterface = ({ chatMessages, inputMessage, setInputMessage, sendMessage, isTyping, chatEndRef, inputRef, miStage, supervisorGuidance }) => (
    <div className="warm-card rounded-[2rem] overflow-hidden relative">
        <div style={{background: 'linear-gradient(135deg, #f9ebe0 0%, #f5e6d3 100%)'}} className="p-6 border-b-2 border-[#deb887]/30">
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                    <Icon name="messageCircle" className="w-8 h-8 text-[#8b6f47]" />
                    <div>
                        <h2 className="text-2xl font-bold text-[#5c4033]">Conversation Space</h2>
                        <p className="text-[#8b6f47] text-sm">{miStage.charAt(0).toUpperCase() + miStage.slice(1)} phase</p>
                    </div>
                </div>
                <div className="text-right bg-white/40 px-4 py-2 rounded-2xl">
                    <div className="text-xs text-[#8b6f47]">Messages</div>
                    <div className="text-lg font-bold text-[#5c4033]">{Math.floor(chatMessages.length / 2)}</div>
                </div>
            </div>
            {supervisorGuidance && (
                <div className="mt-4 p-4 rounded-2xl" style={{background: 'rgba(222, 184, 135, 0.2)', border: '1.5px solid rgba(200, 168, 130, 0.4)'}}>
                    <div className="text-xs text-[#8b6f47] font-semibold mb-1">Session Guide</div>
                    <div className="text-sm text-[#5c4033]">{supervisorGuidance}</div>
                </div>
            )}
        </div>
        <div className="h-96 overflow-y-auto p-6 chat-scroll" style={{background: 'linear-gradient(to bottom, #fffbf5 0%, #fff9f0 100%)'}}>
            <div className="space-y-5">
                {chatMessages.map((message, index) => (
                    <div key={index} className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-xs lg:max-w-md px-5 py-4 rounded-[1.5rem] ${
                            message.type === 'user'
                                ? 'message-user text-white'
                                : 'message-assistant text-[#4a3b2f]'
                        }`}>
                            <p className="text-[15px] leading-relaxed">{message.content}</p>
                        </div>
                    </div>
                ))}
                {isTyping && (
                    <div className="flex justify-start">
                        <div className="message-assistant px-6 py-4 rounded-[1.5rem]">
                            <div className="flex space-x-2">
                                <div className="w-2.5 h-2.5 bg-[#c8a882] rounded-full typing-dot"></div>
                                <div className="w-2.5 h-2.5 bg-[#c8a882] rounded-full typing-dot"></div>
                                <div className="w-2.5 h-2.5 bg-[#c8a882] rounded-full typing-dot"></div>
                            </div>
                        </div>
                    </div>
                )}
                <div ref={chatEndRef} />
            </div>
        </div>
        <div className="p-6" style={{background: 'linear-gradient(to top, #fffbf5 0%, #fff9f0 100%)', borderTop: '2px solid rgba(222, 184, 135, 0.2)'}}>
            <div className="flex space-x-3">
                <input
                    ref={inputRef}
                    type="text"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && !isTyping && sendMessage()}
                    placeholder="Share your thoughts..."
                    disabled={isTyping}
                    className="gentle-input flex-1 px-5 py-3 rounded-2xl text-[15px] disabled:opacity-50"
                />
                <button
                    onClick={sendMessage}
                    disabled={isTyping || !inputMessage.trim()}
                    className="cozy-button text-white px-5 rounded-2xl disabled:opacity-50 disabled:transform-none"
                >
                    <Icon name="send" className="w-5 h-5" />
                </button>
            </div>
            <div className="mt-5 text-center">
                <button
                    onClick={() => setStage('completion')}
                    className="text-[#8b6f47] hover:text-[#5c4033] px-5 py-2 rounded-2xl text-sm transition-all duration-200 border-2 border-[#e8d7c3] hover:border-[#c8a882] bg-white/60 hover:bg-white"
                >
                    End Session
                </button>
            </div>
        </div>
    </div>
);

// Main SBIRT Tool Component
const SBIRTTool = () => {
    // State management
    const [stage, setStage] = useState('welcome');
    const [fadeIn, setFadeIn] = useState(true);
    const [chatMessages, setChatMessages] = useState([]);
    const [inputMessage, setInputMessage] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [conversationMemory, setConversationMemory] = useState([]); // Full conversation archive
    const [miStage, setMiStage] = useState('engaging'); // MI stages: engaging, focusing, evoking, planning
    const [supervisorGuidance, setSupervisorGuidance] = useState(''); // Guidance from supervisor LLM
    const chatEndRef = useRef(null);
    const inputRef = useRef(null);

    // Auto-scroll chat to bottom
    useEffect(() => {
        if (chatEndRef.current) {
            chatEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [chatMessages]);

    // Keep input focused and handle input issues
    useEffect(() => {
        if (stage === 'mi_session' && inputRef.current && !isTyping) {
            const timer = setTimeout(() => {
                if (inputRef.current) {
                    inputRef.current.focus();
                }
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [stage, chatMessages, isTyping]);

    // Add message to conversation memory
    const addToConversationMemory = (message) => {
        const timestamp = new Date().toISOString();
        const memoryEntry = {
            timestamp,
            type: message.type,
            content: message.content,
            miStage: miStage,
            messageNumber: conversationMemory.length + 1
        };
        
        setConversationMemory(prev => [...prev, memoryEntry]);
        return memoryEntry;
    };

    // Build conversation context for AI
    const buildConversationContext = () => {
        let context = "FULL CONVERSATION HISTORY:\n";
        conversationMemory.forEach((entry, index) => {
            context += `[Message ${entry.messageNumber}] [${entry.miStage.toUpperCase()}] ${entry.type.toUpperCase()}: ${entry.content}\n`;
        });
        context += `\nCURRENT MI STAGE: ${miStage.toUpperCase()}\n`;
        context += `TOTAL EXCHANGES: ${Math.floor(conversationMemory.filter(m => m.type === 'user').length)}\n\n`;
        return context;
    };

    // Supervisor LLM call to determine MI stage and guidance
    const getSupervisorGuidance = async () => {
        try {
            const OLLAMA_API_URL = 'http://localhost:11434/api/chat';
            const MODEL_NAME = 'llama3.2:latest';
            
            const conversationContext = buildConversationContext();
            
            const SUPERVISOR_PROMPT = `You are an expert Motivational Interviewing supervisor, trained on Miller & Rollnick's "Motivational Interviewing: Helping People Change". Your role is to analyze the conversation and provide guidance to the counselor.

FOUR MI PROCESSES (Miller & Rollnick):

1. ENGAGING: Building rapport and trust. Focus on empathic listening, reflection, and creating psychological safety. The client needs to feel heard and understood.

2. FOCUSING: Collaboratively identifying what to talk about - the target behavior for change. Must come before evoking. Without clear focus, you cannot elicit change talk effectively.

3. EVOKING: Drawing out the client's own motivations for change. This is the heart of MI. Focus on eliciting CHANGE TALK (desire, ability, reasons, need, commitment, taking steps) while avoiding SUSTAIN TALK (benefits of current behavior, barriers to change).

4. PLANNING: When client shows readiness, collaborate on concrete steps forward. Explore the "how" and "when" of change.

CRITICAL: These stages are NOT linear. Clients can move backward. You must meet them where they are. If they become defensive or start giving sustain talk, return to ENGAGING or FOCUSING.

Based on the conversation, determine:
1. What MI stage should the counselor focus on next?
2. Is the client showing readiness to advance, or do they need to go back to an earlier stage?
3. What specific guidance should the counselor follow?

RESPOND WITH EXACTLY THIS FORMAT:
STAGE: [engaging/focusing/evoking/planning]
DIRECTION: [advance/maintain/return_to_engaging/return_to_focusing]
GUIDANCE: [One specific actionable guidance for the counselor in 1-2 sentences]

Example responses:
STAGE: evoking  
DIRECTION: maintain
GUIDANCE: Client is giving change talk about memory problems. Reflect this change talk and ask about other concerns marijuana might be causing.

STAGE: engaging
DIRECTION: return_to_engaging  
GUIDANCE: Client seems defensive about marijuana use. Return to empathic listening and avoid questions about problems for now.`;

            const messages = [
                {
                    role: 'system',
                    content: SUPERVISOR_PROMPT + '\n\n' + conversationContext
                },
                {
                    role: 'user',
                    content: 'Based on this conversation, what stage should we focus on and what guidance do you have for the counselor?'
                }
            ];

            const response = await fetch(OLLAMA_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: MODEL_NAME,
                    messages: messages,
                    stream: false,
                    options: {
                        temperature: 0.3, // Lower temperature for more consistent guidance
                        top_p: 0.8,
                        num_predict: 100
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`Supervisor API error: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.message && data.message.content) {
                const guidance = data.message.content.trim();
                
                // Enhanced console logging for supervisor analysis
                console.log('=== SUPERVISOR LLM ANALYSIS ===');
                console.log('📊 Conversation Context Length:', conversationContext.length, 'characters');
                console.log('💬 Total User Messages:', conversationMemory.filter(m => m.type === 'user').length);
                console.log('🎯 Previous MI Stage:', miStage);
                console.log('');
                console.log('🧠 SUPERVISOR RAW OUTPUT:');
                console.log(guidance);
                console.log('');
                
                // Parse the guidance
                const stageMatch = guidance.match(/STAGE:\s*(\w+)/i);
                const directionMatch = guidance.match(/DIRECTION:\s*([\w_]+)/i);
                const guidanceMatch = guidance.match(/GUIDANCE:\s*(.+)/i);
                
                console.log('📋 PARSED ANALYSIS:');
                console.log('  • Recommended Stage:', stageMatch ? stageMatch[1] : 'Not specified');
                console.log('  • Direction:', directionMatch ? directionMatch[1] : 'Not specified');
                console.log('  • Guidance:', guidanceMatch ? guidanceMatch[1] : 'Not specified');
                
                if (stageMatch) {
                    const suggestedStage = stageMatch[1].toLowerCase();
                    if (['engaging', 'focusing', 'evoking', 'planning'].includes(suggestedStage)) {
                        const stageChanged = suggestedStage !== miStage;
                        console.log('');
                        console.log('🔄 STAGE UPDATE:');
                        console.log('  • Previous:', miStage);
                        console.log('  • New:', suggestedStage);
                        console.log('  • Changed:', stageChanged ? 'YES' : 'NO');
                        
                        setMiStage(suggestedStage);
                    }
                }
                
                const fullGuidance = guidanceMatch ? guidanceMatch[1] : guidance;
                console.log('');
                console.log('💡 FINAL GUIDANCE FOR COUNSELOR:');
                console.log(fullGuidance);
                console.log('=== END SUPERVISOR ANALYSIS ===');
                console.log('');
                
                setSupervisorGuidance(fullGuidance);
                return fullGuidance;
            }
            
        } catch (error) {
            console.error('Supervisor LLM error:', error);
            return 'Continue with empathic listening and follow the client\'s lead.';
        }
    };

    // Start MI session
    const startMISession = () => {
        setIsTransitioning(true);
        setFadeIn(false);
        
        setTimeout(() => {
            setStage('mi_session');
            setMiStage('engaging');
            
            // Initial counselor message
            const initialMessage = {
                type: 'assistant',
                content: "Hi there. I'm glad you're here today. I'm wondering what brings you in to talk with me?"
            };
            
            setChatMessages([initialMessage]);
            addToConversationMemory(initialMessage);
            setFadeIn(true);
            setIsTransitioning(false);
        }, 300);
    };

    // Reset function - UPDATED
    const resetToWelcome = () => {
        if (isTransitioning) return;
        
        setIsTransitioning(true);
        setFadeIn(false);
        
        setTimeout(() => {
            setStage('welcome');
            setChatMessages([]);
            setInputMessage('');
            setIsTyping(false);
            setConversationMemory([]);
            setMiStage('engaging');
            setSupervisorGuidance('');
            setFadeIn(true);
            setIsTransitioning(false);
        }, 300);
    };

    // Send message to Ollama API - UPDATED WITH DUAL-LLM SYSTEM
    const sendMessage = async () => {
        if (!inputMessage.trim() || isTyping || isTransitioning) return;

        const userMessage = inputMessage;
        setInputMessage('');
        
        // Add user message to chat and memory
        const userChatMessage = { type: 'user', content: userMessage };
        setChatMessages(prev => [...prev, userChatMessage]);
        addToConversationMemory(userChatMessage);

        setIsTyping(true);

        try {
            // STEP 1: Get supervisor guidance
            await getSupervisorGuidance();
            
            // STEP 2: Send message to main counselor LLM with guidance
            const OLLAMA_API_URL = 'http://localhost:11434/api/chat';
            const MODEL_NAME = 'llama3.2:latest';
            
            // Build conversation context
            const conversationContext = buildConversationContext();
            
            // Main counselor system prompt with supervisor guidance
            const COUNSELOR_PROMPT = `You are a compassionate, supportive counselor trained in Motivational Interviewing (MI), as described in Motivational Interviewing: Helping People Change and Grow by Miller & Rollnick. Your role is to help individuals explore and resolve ambivalence about their substance use, without pressure, judgment, or advice-giving. You never tell the person what to do.

CRITICAL MI PRINCIPLES - CHANGE TALK vs SUSTAIN TALK:

CHANGE TALK (ENCOURAGE): Language about changing marijuana use
- Desire: "I want to quit/reduce marijuana use"
- Ability: "I could stop using on weekdays"
- Reasons: "My memory problems worry me"  
- Need: "I need to be more present for my kids"
- Commitment: "I will try cutting back"
- Taking Steps: "I threw away my vape pen"

SUSTAIN TALK (AVOID ELICITING): Language about continuing marijuana use
- Benefits of using: "It helps me relax"
- Barriers to change: "I can't handle stress without it"
- Reasons to continue: "Everyone uses marijuana"

WHAT YOU MUST NEVER DO:
- Ask about benefits of marijuana use ("What helps you relax about marijuana?")
- Ask about problems when NOT using ("What happens when you don't use?")
- Ask about reasons to continue using
- Ask about barriers to quitting
- Explore how marijuana "helps" them

WHAT YOU SHOULD DO:
- Reflect concerns about marijuana use
- Ask about problems caused BY using
- Ask about benefits of NOT using
- Ask about values that conflict with use
- Explore discrepancies between goals and use
- Ask about past successful periods without use

THE FOUR MI PROCESSES:
1. ENGAGING: Build rapport through empathic listening, reflections, affirmations
2. FOCUSING: Collaboratively identify the target behavior to discuss
3. EVOKING: Elicit CHANGE TALK about the focused behavior, avoid sustain talk
4. PLANNING: When ready, help develop concrete action steps

You always:
- Engage with empathy and non-judgment
- Reflect, summarize, and affirm
- Elicit CHANGE TALK, never sustain talk
- Avoid confrontational, directive, or corrective language
- Use OARS techniques (Open-ended questions, Affirmations, Reflections, Summaries)

You strictly follow the MI spirit:
- Collaboration (not authority)
- Evocation (drawing out the person's own motivation to CHANGE)
- Autonomy (respecting the person's freedom of choice)

When responding, prioritize:
- Complex reflections over simple repeats
- Deep empathy over information delivery
- Client-centered responses over fact-based advice

You do not give diagnoses, prescribe treatment, or discuss medications. You reflect what clients say, validate their perspective, and gently guide them toward exploring CHANGE regarding their marijuana use.

CRITICAL FORMATTING REQUIREMENTS:
- This is professional medical training data
- NEVER use emojis, emoticons, or special characters
- Use only standard punctuation and letters
- Maintain professional therapeutic tone
- Write as you would in actual clinical documentation

Always check yourself: Am I guiding toward CHANGE TALK, not sustain talk? Am I avoiding questions about marijuana's benefits?

SUPERVISOR GUIDANCE: ${supervisorGuidance}

Follow the supervisor's guidance while maintaining your MI principles.`;
            
            // Build messages for main counselor LLM
            const messages = [];
            
            // Add system message with conversation context and supervisor guidance
            messages.push({
                role: 'system',
                content: COUNSELOR_PROMPT + '\n\n' + conversationContext
            });
            
            // Add current user message
            messages.push({
                role: 'user',
                content: userMessage
            });
            
            console.log('🚀 Making counselor API request to Ollama');
            console.log('📍 Current MI stage:', miStage);
            console.log('🎯 Supervisor guidance:', supervisorGuidance);
            console.log('📝 User message:', userMessage);
            console.log('');
            
            const response = await fetch(OLLAMA_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: MODEL_NAME,
                    messages: messages,
                    stream: false,
                    options: {
                        temperature: 0.7,
                        top_p: 0.9,
                        top_k: 40,
                        num_predict: 150
                    }
                })
            });

            if (!response.ok) {
                const errorData = await response.text();
                console.error('Ollama API error details:', errorData);
                throw new Error(`Ollama API error: ${response.status} - ${errorData}`);
            }

            const data = await response.json();
            
            if (data.message && data.message.content) {
                let aiResponse = data.message.content.trim();

                // Strip surrounding quotes if present
                if (
                    (aiResponse.startsWith('"') && aiResponse.endsWith('"')) ||
                    (aiResponse.startsWith('"') && aiResponse.endsWith('"'))
                ) {
                    aiResponse = aiResponse.slice(1, -1);
                }

                console.log('✅ COUNSELOR LLM RESPONSE:');
                console.log(aiResponse);
                console.log('');

                // Add assistant message to chat and memory
                const assistantMessage = { type: 'assistant', content: aiResponse };
                setChatMessages(prev => [...prev, assistantMessage]);
                addToConversationMemory(assistantMessage);
            } else {
                console.error('❌ Unexpected response format from Ollama API');
                throw new Error('Unexpected response format from Ollama API');
            }
            
        } catch (error) {
            console.error('💥 Error calling Ollama API:', error);
            console.log('🔄 Using fallback response...');
            
            // Fallback response
            const fallbackMessage = { 
                type: 'assistant', 
                content: "I'm having trouble connecting to the local AI service. Could you tell me more about what's on your mind today?" 
            };
            setChatMessages(prev => [...prev, fallbackMessage]);
            addToConversationMemory(fallbackMessage);
        } finally {
            console.log('⏹️ Setting isTyping to false');
            setIsTyping(false);
        }
    };

    // Completion Content Component - Updated for MI session completion
    const CompletionContent = () => {
        const totalMessages = conversationMemory.filter(msg => msg.type === 'user').length;
        const stageProgression = [...new Set(conversationMemory.map(msg => msg.miStage))];

        return (
            <div className="space-y-8">
                <div className="text-center mb-8">
                    <h2 className="text-4xl font-bold text-[#5c4033] mb-4">
                        Session Complete
                    </h2>
                    <p className="text-xl text-[#8b6f47]">Thank you for your openness and engagement today</p>
                </div>

                <div className="warm-card p-8 rounded-[2rem]">
                    <h3 className="text-2xl font-semibold text-[#5c4033] mb-6">Session Summary</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="text-center bg-white/40 rounded-2xl p-4">
                            <div className="text-3xl font-bold text-[#689f7f]">{totalMessages}</div>
                            <div className="text-[#8b6f47] text-sm">Your Messages</div>
                        </div>
                        <div className="text-center bg-white/40 rounded-2xl p-4">
                            <div className="text-3xl font-bold text-[#c8a882]">{miStage.charAt(0).toUpperCase() + miStage.slice(1)}</div>
                            <div className="text-[#8b6f47] text-sm">Final Stage</div>
                        </div>
                        <div className="text-center bg-white/40 rounded-2xl p-4">
                            <div className="text-3xl font-bold text-[#689f7f]">{stageProgression.length}</div>
                            <div className="text-[#8b6f47] text-sm">Stages Explored</div>
                        </div>
                    </div>

                    <div className="mt-6">
                        <h4 className="text-lg font-semibold text-[#5c4033] mb-3">Journey Progression:</h4>
                        <div className="flex flex-wrap gap-2">
                            {stageProgression.map((stage, index) => (
                                <span key={index} className="bg-[#a8d5ba]/30 text-[#4a6b5c] px-4 py-2 rounded-full text-sm border-2 border-[#a8d5ba]/50 font-medium">
                                    {stage.charAt(0).toUpperCase() + stage.slice(1)}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    <h3 className="text-2xl font-semibold text-[#5c4033]">Resources & Support</h3>

                    <div className="warm-card p-6 rounded-[2rem]">
                        <h4 className="text-xl font-semibold text-[#5c4033] mb-2">Continue Your Journey</h4>
                        <p className="text-[#6b5744] mb-2 leading-relaxed">Motivational Interviewing is most effective when part of ongoing support.</p>
                        <p className="text-[#8b6f47] font-semibold">Consider scheduling follow-up sessions with a counselor</p>
                    </div>

                    <div className="warm-card p-6 rounded-[2rem]">
                        <h4 className="text-xl font-semibold text-[#5c4033] mb-3">24/7 Support</h4>
                        <ul className="space-y-2.5 text-[#6b5744]">
                            <li className="flex items-start">
                                <span className="font-semibold text-[#5c4033] mr-2">Crisis Text Line:</span>
                                <span>Text HOME to 741741</span>
                            </li>
                            <li className="flex items-start">
                                <span className="font-semibold text-[#5c4033] mr-2">SAMHSA Helpline:</span>
                                <span>1-800-662-HELP (4357)</span>
                            </li>
                            <li className="flex items-start">
                                <span className="font-semibold text-[#5c4033] mr-2">Suicide Prevention:</span>
                                <span>Call or text 988</span>
                            </li>
                        </ul>
                    </div>

                    <div className="warm-card p-6 rounded-[2rem]">
                        <h4 className="text-xl font-semibold text-[#5c4033] mb-3">Local Resources</h4>
                        <ul className="space-y-2.5 text-[#6b5744]">
                            <li className="flex items-start">
                                <span className="font-semibold text-[#5c4033] mr-2">Teen Counseling:</span>
                                <span>Contact your primary care provider</span>
                            </li>
                            <li className="flex items-start">
                                <span className="font-semibold text-[#5c4033] mr-2">School Counselor:</span>
                                <span>Available during school hours</span>
                            </li>
                            <li className="flex items-start">
                                <span className="font-semibold text-[#5c4033] mr-2">Community Health:</span>
                                <span>Search "mental health services near me"</span>
                            </li>
                        </ul>
                    </div>
                </div>

                <div className="warm-card p-8 rounded-[2rem]" style={{background: 'linear-gradient(135deg, #f9ebe0 0%, #f5e6d3 100%)'}}>
                    <h3 className="text-2xl font-semibold text-[#5c4033] mb-5">Remember</h3>
                    <ul className="space-y-4 text-[#6b5744]">
                        <li className="flex items-start">
                            <Icon name="checkCircle" className="w-6 h-6 text-[#689f7f] mr-3 flex-shrink-0 mt-0.5" />
                            <span>Change is a process, not a single event</span>
                        </li>
                        <li className="flex items-start">
                            <Icon name="checkCircle" className="w-6 h-6 text-[#689f7f] mr-3 flex-shrink-0 mt-0.5" />
                            <span>You have the power to make choices that align with your values</span>
                        </li>
                        <li className="flex items-start">
                            <Icon name="checkCircle" className="w-6 h-6 text-[#689f7f] mr-3 flex-shrink-0 mt-0.5" />
                            <span>Support is available whenever you need it</span>
                        </li>
                        <li className="flex items-start">
                            <Icon name="checkCircle" className="w-6 h-6 text-[#689f7f] mr-3 flex-shrink-0 mt-0.5" />
                            <span>Your motivation for change comes from within you</span>
                        </li>
                    </ul>
                </div>
            </div>
        );
    };

    // Main render
    return (
        <div className="min-h-screen p-6 relative">
            <div className="max-w-4xl mx-auto relative z-10">
                {/* Header */}
                <header className="flex items-center justify-between mb-10 pt-4 no-print">
                    <div className="flex items-center space-x-4">
                        <div className="w-14 h-14 rounded-[1.2rem] flex items-center justify-center p-2 cozy-button">
                            <Icon name="shield" className="w-9 h-9 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-[#5c4033]">SBIRT Youth Assessment</h1>
                            <p className="text-sm text-[#8b6f47]">Recovery Research Institute</p>
                        </div>
                    </div>
                    {stage !== 'welcome' && (
                        <button
                            onClick={resetToWelcome}
                            disabled={isTransitioning}
                            className="flex items-center space-x-2 text-[#8b6f47] hover:text-[#5c4033] transition-colors disabled:opacity-50 bg-white/60 px-4 py-2 rounded-2xl border-2 border-[#e8d7c3] hover:border-[#c8a882]"
                        >
                            <Icon name="home" className="w-5 h-5" />
                            <span className="font-semibold">Start Over</span>
                        </button>
                    )}
                </header>

                {/* Progress Bar - Updated for MI Session without timer */}
                {stage === 'mi_session' && (
                    <div className="mb-8">
                        <div className="flex justify-between text-sm text-[#8b6f47] mb-3 font-medium">
                            <span>Phase: {miStage.charAt(0).toUpperCase() + miStage.slice(1)}</span>
                            <span>{Math.floor(chatMessages.length / 2)} exchanges</span>
                        </div>
                        <div className="w-full bg-[#f5e6d3] rounded-full h-3 border-2 border-[#e8d7c3]">
                            <div className={`h-full rounded-full transition-all duration-500 ${
                                miStage === 'engaging' ? 'w-1/4' :
                                miStage === 'focusing' ? 'w-2/4' :
                                miStage === 'evoking' ? 'w-3/4' :
                                'w-full'
                            }`} style={{background: 'linear-gradient(90deg, #a8d5ba 0%, #94c9a9 100%)'}}></div>
                        </div>
                        <div className="flex justify-between text-xs text-[#8b6f47] mt-2 font-medium">
                            <span>Engaging</span>
                            <span>Focusing</span>
                            <span>Evoking</span>
                            <span>Planning</span>
                        </div>
                    </div>
                )}

                {/* Main Content */}
                <div className={`transition-opacity duration-300 ${fadeIn ? 'opacity-100' : 'opacity-0'}`}>
                    {/* Welcome Stage */}
                    {stage === 'welcome' && (
                        <div className="warm-card rounded-[2.5rem] p-14 text-center relative overflow-hidden">
                            <div className="w-28 h-28 rounded-[2rem] flex items-center justify-center mx-auto mb-8 cozy-button float">
                                <Icon name="heart" className="w-16 h-16 text-white" />
                            </div>
                            <h2 className="text-4xl font-bold text-[#5c4033] mb-5">
                                Conversation Space
                            </h2>
                            <p className="text-lg text-[#6b5744] mb-10 leading-relaxed max-w-2xl mx-auto">
                                Welcome to a motivational interviewing session. This is a collaborative conversation
                                designed to help you explore your thoughts and feelings about any concerns you might have.
                                You'll be talking with an AI counselor trained in evidence-based techniques.
                            </p>
                            <button
                                onClick={startMISession}
                                disabled={isTransitioning}
                                className="cozy-button text-white px-10 py-4 rounded-[1.5rem] font-bold text-lg flex items-center mx-auto space-x-3 disabled:opacity-50 disabled:transform-none"
                            >
                                <span>Begin Session</span>
                                <Icon name="chevronRight" className="w-5 h-5" />
                            </button>
                            <p className="text-sm text-[#8b6f47] mt-8 font-medium">
                                Confidential • Based on Miller & Rollnick's approach
                            </p>
                        </div>
                    )}

                    {/* MI Session Stage */}
                    {stage === 'mi_session' && (
                        <ChatInterface
                            chatMessages={chatMessages}
                            inputMessage={inputMessage}
                            setInputMessage={setInputMessage}
                            sendMessage={sendMessage}
                            isTyping={isTyping}
                            chatEndRef={chatEndRef}
                            inputRef={inputRef}
                            miStage={miStage}
                            supervisorGuidance={supervisorGuidance}
                        />
                    )}

                    {/* Completion Stage */}
                    {stage === 'completion' && (
                        <div>
                            <CompletionContent />
                            <div className="mt-12 text-center no-print flex gap-4 justify-center">
                                <button
                                    onClick={() => window.print()}
                                    className="cozy-button text-white px-8 py-4 rounded-[1.5rem] font-bold text-lg"
                                >
                                    Print Summary
                                </button>
                                <button
                                    onClick={resetToWelcome}
                                    className="bg-white text-[#5c4033] px-8 py-4 rounded-[1.5rem] font-bold text-lg border-2 border-[#c8a882] hover:bg-[#f9ebe0] transition-all"
                                >
                                    Start New Session
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// Render the app
ReactDOM.render(<SBIRTTool />, document.getElementById('root'));
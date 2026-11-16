const OpenAI = require('openai');
const logger = require('../core/logger').createServiceLogger('LLM');
const config = require('../core/config');
const { promptLoader } = require('../../prompt-loader');
const { resumeContext } = require('../core/resume-context');

class LLMService {
  constructor() {
    this.client = null;
    this.model = null;
    this.isInitialized = false;
    this.requestCount = 0;
    this.errorCount = 0;
    
    this.initializeClient();
  }

  initializeClient() {
    this.isInitialized = false;
    this.client = null;
    this.model = process.env.OPENAI_MODEL || config.get('llm.openai.model');
    this.imageModel = process.env.OPENAI_IMAGE_MODEL || config.get('llm.openai.imageModel');
    const apiKey = config.getApiKey('OPENAI');
    if (!apiKey || apiKey.startsWith('your_') || apiKey === 'your-api-key-here') {
      logger.warn('OpenAI API key not configured');
      return;
    }
    this.client = new OpenAI({
      apiKey,
      timeout: config.get('llm.openai.timeout'),
      maxRetries: 2,
      // Recent SDKs classify Electron as browser-like. This service runs only
      // in the isolated main process; never enable API access in a renderer.
      dangerouslyAllowBrowser: !!process.versions.electron && process.type === 'browser'
    });
    this.isInitialized = true;
    logger.info('OpenAI client initialized', { model: this.model });
  }

  getGenerationConfig(overrides = {}) {
    const defaults = config.get('llm.openai.generation') || {};
    const fallback = {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingBudget: 0 }
    };

    const merged = { ...fallback, ...defaults, ...overrides };
    return Object.fromEntries(
      Object.entries(merged).filter(([, value]) => value !== undefined && value !== null)
    );
  }

  applyGenerationDefaults(request, overrides = {}) {
    request.generationConfig = this.getGenerationConfig({ ...(request.generationConfig || {}), ...overrides });
    return request;
  }

  extractTextFromCandidates(response) {
    // New @google/genai SDK exposes response.text as a convenience getter.
    if (response && typeof response.text === 'string' && response.text.trim().length > 0) {
      return {
        text: response.text.trim(),
        candidate: response.candidates?.[0] || null,
        finishReason: response.candidates?.[0]?.finishReason || null
      };
    }

    const candidates = Array.isArray(response?.candidates)
      ? response.candidates
      : Array.isArray(response)
        ? response
        : [];

    if (!candidates.length) {
      throw new Error('No candidates in OpenAI response');
    }

    const candidateWithText = candidates.find(candidate => {
      const parts = candidate?.content?.parts;
      return Array.isArray(parts) && parts.some(part => typeof part.text === 'string' && part.text.trim().length > 0);
    });

    if (!candidateWithText) {
      const finishReasons = candidates.map(c => c.finishReason || 'unknown').join(', ');
      throw new Error(`No text parts in candidates. Finish reasons: ${finishReasons}`);
    }

    const textParts = candidateWithText.content.parts
      .filter(part => typeof part.text === 'string' && part.text.trim().length > 0)
      .map(part => part.text.trim());

    if (!textParts.length) {
      throw new Error(`Candidate parts missing text after filtering: ${JSON.stringify(candidateWithText)}`);
    }

    const text = textParts.join('\n');

    return {
      text,
      candidate: candidateWithText,
      finishReason: candidateWithText.finishReason || null
    };
  }

  /**
   * Process an image directly with OpenAI using the active skill prompt.
   * The image buffer is sent as inlineData alongside a concise instruction.
   * For image-based queries, we include the skill prompt (e.g., DSA) as systemInstruction.
   * @param {Buffer} imageBuffer - PNG/JPEG image bytes
   * @param {string} mimeType - e.g., 'image/png' or 'image/jpeg'
   * @param {string} activeSkill - current skill (e.g. 'dsa')
   * @param {Array} sessionMemory - optional (not required for image)
   * @param {string|null} programmingLanguage - optional language context for skills that need it
   * @returns {Promise<{response: string, metadata: object}>}
   */
  async processImageWithSkill(imageBuffer, mimeType, activeSkill, sessionMemory = [], programmingLanguage = null, userQuestion = null, includeConversationContext = true) {
    if (!this.isInitialized) {
      throw new Error('LLM service not initialized. Check OpenAI API key configuration.');
    }

    if (!imageBuffer || (!Buffer.isBuffer(imageBuffer) && !Array.isArray(imageBuffer))) {
      throw new Error('Invalid image buffer provided to processImageWithSkill');
    }

    const startTime = Date.now();
    this.requestCount++;

    try {
      // Build system instruction using the skill prompt (with optional language injection)
      const { promptLoader } = require('../../prompt-loader');
      const skillPrompt = activeSkill === 'general_qa' ? 'You are a helpful general question-and-answer assistant. Answer clearly and concisely, and use conversation context for follow-ups.' : (promptLoader.getSkillPrompt(activeSkill, programmingLanguage) || '');

      // Build request with text + image parts
      const request = {
        model: this.imageModel,
        contents: this.buildImageContents(imageBuffer, mimeType, activeSkill, programmingLanguage, userQuestion, includeConversationContext, sessionMemory)
      };

      this.applyGenerationDefaults(request, { maxOutputTokens: 8192 });

      if (skillPrompt && skillPrompt.trim().length > 0) {
        request.systemInstruction = { parts: [{ text: skillPrompt }] };
      }

      // Execute with retries/timeout - try alternative method first for network reliability
      let responseText;
      const preferAlternative = !!config.get('llm.openai.enableFallbackMethod');
      try {
        if (preferAlternative) {
          logger.debug('Attempting alternative HTTPS method first for reliability');
          responseText = await this.executeAlternativeRequest(request);
        } else {
          responseText = await this.executeRequest(request);
        }
      } catch (error) {
        const secondaryLabel = preferAlternative ? 'primary SDK method' : 'alternative HTTPS method';
        logger.warn(`${preferAlternative ? 'Alternative' : 'Primary'} method failed, trying ${secondaryLabel}`, { error: error.message });
        const secondaryFn = preferAlternative ? this.executeRequest.bind(this) : this.executeAlternativeRequest.bind(this);

        try {
          responseText = await secondaryFn(request);
        } catch (secondaryError) {
          logger.error('Both OpenAI request methods failed', {
            firstError: error.message,
            secondError: secondaryError.message
          });
          throw secondaryError;
        }
      }

      // Enforce language in code fences if provided
      const finalResponse = programmingLanguage
        ? this.enforceProgrammingLanguage(responseText, programmingLanguage)
        : responseText;

      logger.logPerformance('LLM image processing', startTime, {
        activeSkill,
        imageSize: imageBuffer.length,
        responseLength: finalResponse.length,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          isImageAnalysis: true,
          model: this.imageModel,
          imageCount: Array.isArray(imageBuffer) ? imageBuffer.length : 1,
          mimeType
        }
      };
    } catch (error) {
      this.errorCount++;
      logger.error('LLM image processing failed', {
        error: error.message,
        activeSkill,
        requestId: this.requestCount
      });

      // Surface image errors so the queue can retain captures for retry.
      throw error;
    }
  }

  async processImageWithSkillStream(imageBuffer, mimeType, activeSkill, sessionMemory = [], programmingLanguage = null, onDelta = null, userQuestion = null, includeConversationContext = true) {
    if (!this.isInitialized) {
      throw new Error('LLM service not initialized. Check OpenAI API key configuration.');
    }

    if (!imageBuffer || (!Buffer.isBuffer(imageBuffer) && !Array.isArray(imageBuffer))) {
      throw new Error('Invalid image buffer provided to processImageWithSkillStream');
    }

    const startTime = Date.now();
    this.requestCount++;

    try {
      const { promptLoader } = require('../../prompt-loader');
      const skillPrompt = activeSkill === 'general_qa' ? 'You are a helpful general question-and-answer assistant. Answer clearly and concisely, and use conversation context for follow-ups.' : (promptLoader.getSkillPrompt(activeSkill, programmingLanguage) || '');
      const geminiRequest = {
        model: this.imageModel,
        contents: this.buildImageContents(imageBuffer, mimeType, activeSkill, programmingLanguage, userQuestion, includeConversationContext, sessionMemory)
      };
      this.applyGenerationDefaults(geminiRequest, { maxOutputTokens: 8192 });
      if (skillPrompt && skillPrompt.trim().length > 0) {
        geminiRequest.systemInstruction = { parts: [{ text: skillPrompt }] };
      }

      const fullText = await this.executeStreamingRequest(geminiRequest, (delta) => {
        if (typeof onDelta === 'function' && delta) {
          onDelta(delta);
        }
      });

      const finalResponse = programmingLanguage
        ? this.enforceProgrammingLanguage(fullText, programmingLanguage)
        : fullText;

      logger.logPerformance('LLM image streaming', startTime, {
        activeSkill,
        imageSize: imageBuffer.length,
        responseLength: finalResponse.length,
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          streamed: true,
          isImageAnalysis: true,
          model: this.imageModel,
          imageCount: Array.isArray(imageBuffer) ? imageBuffer.length : 1,
          mimeType
        }
      };
    } catch (error) {
      if (activeSkill === 'general_qa') throw error;
      logger.warn('Streaming image analysis failed, falling back to non-streaming', {
        error: error.message,
        requestId: this.requestCount
      });
      return this.processImageWithSkill(imageBuffer, mimeType, activeSkill, sessionMemory, programmingLanguage, userQuestion, includeConversationContext);
    }
  }

  imageParts(images, mimeType) {
    const batch = Array.isArray(images) ? images : [{ imageBuffer: images, mimeType }];
    if (!batch.length) throw new Error('No screenshots provided.');
    return batch.flatMap((image, index) => {
      if (!Buffer.isBuffer(image.imageBuffer) || !image.imageBuffer.length) throw new Error('Invalid screenshot.');
      return [
        { text: `Screenshot ${index + 1} of ${batch.length}` },
        { inlineData: { data: image.imageBuffer.toString('base64'), mimeType: image.mimeType || 'image/png' } }
      ];
    });
  }

  formatImageInstruction(activeSkill, programmingLanguage) {
    if (activeSkill === 'general_qa') return 'Read the screenshots in order and answer the user’s question clearly and concisely. Ask for missing or unreadable information rather than guessing.';
    const langNote = programmingLanguage ? ` Use only ${programmingLanguage.toUpperCase()} for any code.` : '';
    return `Read all screenshots in capture order as context for the same task. Combine problem statements, constraints, examples, and code across screenshots. Solve the visible question or task; for coding problems give an explanation, complexity, and final code. If essential content is unreadable or missing, say what is needed instead of guessing.${langNote}`;
  }

  buildImageContents(imageBuffer, mimeType, activeSkill, programmingLanguage, userQuestion, includeConversationContext = true, sessionMemory = []) {
    const sessionManager = require('../managers/session.manager');
    const history = includeConversationContext && typeof sessionManager.getQAHistory === 'function'
      ? (activeSkill === 'general_qa' ? sessionMemory : sessionManager.getQAHistory())
          .filter(item => item.content && typeof item.content === 'string')
          .map(item => ({ role: item.role === 'model' ? 'model' : 'user', parts: [{ text: item.content.trim() }] }))
      : [];
    const question = String(userQuestion || '').trim();
    const instruction = question
      ? `${this.formatImageInstruction(activeSkill, programmingLanguage)}\n\nUser question: ${question}`
      : this.formatImageInstruction(activeSkill, programmingLanguage);
    return [...history, { role: 'user', parts: [{ text: instruction }, ...this.imageParts(imageBuffer, mimeType)] }];
  }

  async processTextWithSkill(text, activeSkill, sessionMemory = [], programmingLanguage = null) {
    if (!this.isInitialized) {
      throw new Error('LLM service not initialized. Check OpenAI API key configuration.');
    }

    const startTime = Date.now();
    this.requestCount++;
    
    try {
      logger.info('Processing text with LLM', {
        activeSkill,
        textLength: text.length,
        hasSessionMemory: sessionMemory.length > 0,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      const geminiRequest = this.buildPromptRequest(text, activeSkill, sessionMemory, programmingLanguage);

      const preferAlternative = !!config.get('llm.openai.enableFallbackMethod');
      let response;
      try {
        if (preferAlternative) {
          logger.debug('Attempting alternative HTTPS method first for text processing');
          response = await this.executeAlternativeRequest(geminiRequest);
        } else {
          response = await this.executeRequest(geminiRequest);
        }
      } catch (error) {
        const secondaryLabel = preferAlternative ? 'primary SDK method' : 'alternative HTTPS method';
        logger.warn(`${preferAlternative ? 'Alternative' : 'Primary'} method failed, trying ${secondaryLabel}`, {
          error: error.message,
          requestId: this.requestCount
        });
        const secondaryFn = preferAlternative ? this.executeRequest.bind(this) : this.executeAlternativeRequest.bind(this);
        try {
          response = await secondaryFn(geminiRequest);
        } catch (secondaryError) {
          logger.error('Both OpenAI request methods failed for text processing', {
            firstError: error.message,
            secondError: secondaryError.message,
            requestId: this.requestCount
          });
          throw secondaryError;
        }
      }
      
      // Enforce language in code fences if programmingLanguage specified
      const finalResponse = programmingLanguage
        ? this.enforceProgrammingLanguage(response, programmingLanguage)
        : response;

      logger.logPerformance('LLM text processing', startTime, {
        activeSkill,
        textLength: text.length,
        responseLength: finalResponse.length,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false
        }
      };
    } catch (error) {
      this.errorCount++;
      logger.error('LLM processing failed', {
        error: error.message,
        activeSkill,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      if (config.get('llm.openai.fallbackEnabled')) {
        return this.generateFallbackResponse(text, activeSkill);
      }

      throw error;
    }
  }

  async processTextWithSkillStream(text, activeSkill, sessionMemory = [], programmingLanguage = null, onDelta = null) {
    if (!this.isInitialized) {
      throw new Error('LLM service not initialized. Check OpenAI API key configuration.');
    }

    const startTime = Date.now();
    this.requestCount++;

    try {
      const geminiRequest = this.buildPromptRequest(text, activeSkill, sessionMemory, programmingLanguage);

      const fullText = await this.executeStreamingRequest(geminiRequest, (delta) => {
        if (typeof onDelta === 'function' && delta) {
          onDelta(delta);
        }
      });

      const finalResponse = programmingLanguage
        ? this.enforceProgrammingLanguage(fullText, programmingLanguage)
        : fullText;

      logger.logPerformance('LLM text streaming', startTime, {
        activeSkill,
        textLength: text.length,
        responseLength: finalResponse.length,
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          streamed: true
        }
      };
    } catch (error) {
      if (activeSkill === 'general_qa') throw error;
      logger.warn('Streaming text failed, falling back to non-streaming', {
        error: error.message,
        requestId: this.requestCount
      });
      return this.processTextWithSkill(text, activeSkill, sessionMemory, programmingLanguage);
    }
  }

  async processTranscriptionWithIntelligentResponse(text, activeSkill, sessionMemory = [], programmingLanguage = null) {
    if (!this.isInitialized) {
      throw new Error('LLM service not initialized. Check OpenAI API key configuration.');
    }

    const startTime = Date.now();
    this.requestCount++;
    
    try {
      logger.info('Processing transcription with intelligent response', {
        activeSkill,
        textLength: text.length,
        hasSessionMemory: sessionMemory.length > 0,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      const geminiRequest = this.buildIntelligentTranscriptionRequest(text, activeSkill, sessionMemory, programmingLanguage);

      const preferAlternative = !!config.get('llm.openai.enableFallbackMethod');
      let response;
      try {
        if (preferAlternative) {
          logger.debug('Attempting alternative HTTPS method first for transcription processing');
          response = await this.executeAlternativeRequest(geminiRequest);
        } else {
          response = await this.executeRequest(geminiRequest);
        }
      } catch (error) {
        const secondaryLabel = preferAlternative ? 'primary SDK method' : 'alternative HTTPS method';
        logger.warn(`${preferAlternative ? 'Alternative' : 'Primary'} method failed, trying ${secondaryLabel}`, {
          error: error.message,
          requestId: this.requestCount
        });
        const secondaryFn = preferAlternative ? this.executeRequest.bind(this) : this.executeAlternativeRequest.bind(this);
        try {
          response = await secondaryFn(geminiRequest);
        } catch (secondaryError) {
          logger.error('Both OpenAI request methods failed for transcription processing', {
            firstError: error.message,
            secondError: secondaryError.message,
            requestId: this.requestCount
          });
          throw secondaryError;
        }
      }
      
      // Enforce language in code fences if programmingLanguage specified
      const finalResponse = programmingLanguage
        ? this.enforceProgrammingLanguage(response, programmingLanguage)
        : response;

      logger.logPerformance('LLM transcription processing', startTime, {
        activeSkill,
        textLength: text.length,
        responseLength: finalResponse.length,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          isTranscriptionResponse: true
        }
      };
    } catch (error) {
      this.errorCount++;
      logger.error('LLM transcription processing failed', {
        error: error.message,
        activeSkill,
        programmingLanguage: programmingLanguage || 'not specified',
        requestId: this.requestCount
      });

      if (config.get('llm.openai.fallbackEnabled')) {
        return this.generateIntelligentFallbackResponse(text, activeSkill);
      }
      
      throw error;
    }
  }

  /**
   * Normalize all triple-backtick code fences to the selected programming language tag.
   * Does not alter the inner code; only ensures fence language tags are correct.
   */
  enforceProgrammingLanguage(text, programmingLanguage) {
    try {
      if (!text || !programmingLanguage) return text;
      const norm = String(programmingLanguage).toLowerCase();
      const fenceTagMap = { cpp: 'cpp', c: 'c', python: 'python', java: 'java', javascript: 'javascript', js: 'javascript' };
      const fenceTag = fenceTagMap[norm] || norm || 'text';

      let fence = null;
      return text.split('\n').map(line => {
        const match = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
        if (!match) return line;
        if (!fence) {
          fence = match[2];
          return match[1] + fence + fenceTag;
        }
        if (match[2][0] === fence[0] && match[2].length >= fence.length && !match[3].trim()) fence = null;
        return line;
      }).join('\n');
    } catch (_) {
      return text;
    }
  }

  buildPromptRequest(text, activeSkill, sessionMemory, programmingLanguage) {
    if (activeSkill === 'general_qa') {
      const history = sessionMemory.filter(item => item.content && typeof item.content === 'string');
      const request = { systemInstruction: { parts: [{ text: 'You are a helpful general question-and-answer assistant. Answer clearly and concisely, use prior conversation for follow-ups, and provide code only when requested or relevant.' }] }, contents: [
        ...history.map(item => ({ role: item.role === 'model' ? 'model' : 'user', parts: [{ text: item.content.trim() }] })),
        { role: 'user', parts: [{ text: text.trim() }] }
      ] };
      this.applyGenerationDefaults(request);
      return request;
    }
    // Check if we have the new conversation history format
    const sessionManager = require('../managers/session.manager');
    
    if (sessionManager && typeof sessionManager.getConversationHistory === 'function') {
      const conversationHistory = sessionManager.getQAHistory();
      const skillContext = sessionManager.getSkillContext(activeSkill, programmingLanguage);
      return this.buildPromptRequestWithHistory(text, activeSkill, conversationHistory, skillContext, programmingLanguage);
    }

    // Fallback to old method for compatibility - now with programming language support
    const requestComponents = promptLoader.getRequestComponents(
      activeSkill, 
      text, 
      sessionMemory,
      programmingLanguage
    );

    const request = {
      contents: []
    };

    this.applyGenerationDefaults(request);

    // Use the skill prompt that already has programming language injected
    if (requestComponents.shouldUseModelMemory && requestComponents.skillPrompt) {
      request.systemInstruction = {
        parts: [{ text: requestComponents.skillPrompt }]
      };
      
      logger.debug('Using language-enhanced system instruction for skill', {
        skill: activeSkill,
        programmingLanguage: programmingLanguage || 'not specified',
        promptLength: requestComponents.skillPrompt.length,
        requiresProgrammingLanguage: requestComponents.requiresProgrammingLanguage
      });
    }

    request.contents.push({
      role: 'user',
      parts: [{ text: this.formatUserMessage(text, activeSkill) }]
    });

    return request;
  }

  buildPromptRequestWithHistory(text, activeSkill, conversationHistory, skillContext, programmingLanguage) {
    const request = {
      contents: []
    };

    this.applyGenerationDefaults(request);

    // Use the skill prompt from context (which may already include programming language)
    if (skillContext.skillPrompt) {
      request.systemInstruction = {
        parts: [{ text: skillContext.skillPrompt }]
      };
      
      logger.debug('Using skill context prompt as system instruction', {
        skill: activeSkill,
        programmingLanguage: programmingLanguage || 'not specified',
        promptLength: skillContext.skillPrompt.length,
        requiresProgrammingLanguage: skillContext.requiresProgrammingLanguage || false,
        hasLanguageInjection: programmingLanguage && skillContext.requiresProgrammingLanguage
      });
    }

    // Add conversation history (excluding system messages) with validation
    const conversationContents = conversationHistory
      .filter(event => {
        return event.role !== 'system' && 
               event.content && 
               typeof event.content === 'string' && 
               event.content.trim().length > 0;
      })
      .map(event => {
        const content = event.content.trim();
        return {
          role: event.role === 'model' ? 'model' : 'user',
          parts: [{ text: content }]
        };
      });

    // Add the conversation history
    request.contents.push(...conversationContents);

    // Format and validate the current user input
    const formattedMessage = this.formatUserMessage(text, activeSkill);
    if (!formattedMessage || formattedMessage.trim().length === 0) {
      throw new Error('Failed to format user message or message is empty');
    }

    // Add the current user input
    request.contents.push({
      role: 'user',
      parts: [{ text: formattedMessage }]
    });

    logger.debug('Built OpenAI request with conversation history', {
      skill: activeSkill,
      programmingLanguage: programmingLanguage || 'not specified',
      historyLength: conversationHistory.length,
      totalContents: request.contents.length,
      hasSystemInstruction: !!request.systemInstruction,
      requiresProgrammingLanguage: skillContext.requiresProgrammingLanguage || false
    });

    return request;
  }

  buildIntelligentTranscriptionRequest(text, activeSkill, sessionMemory, programmingLanguage) {
    // Validate input text first
    const cleanText = text && typeof text === 'string' ? text.trim() : '';
    if (!cleanText) {
      throw new Error('Empty or invalid transcription text provided to buildIntelligentTranscriptionRequest');
    }

    // Check if we have the new conversation history format
    const sessionManager = require('../managers/session.manager');
    
    if (sessionManager && typeof sessionManager.getConversationHistory === 'function') {
      const conversationHistory = sessionManager.getQAHistory();
      const skillContext = sessionManager.getSkillContext(activeSkill, programmingLanguage);
      const request = this.buildIntelligentTranscriptionRequestWithHistory(cleanText, activeSkill, conversationHistory, skillContext, programmingLanguage);
      request.responseSource = 'speech';
      return request;
    }

    // Fallback to basic intelligent request
    const request = {
      contents: []
    };

    this.applyGenerationDefaults(request);

    // Add intelligent filtering system instruction
    request.responseSource = 'speech';
    const intelligentPrompt = this.getIntelligentTranscriptionPrompt(activeSkill, programmingLanguage);
    if (!intelligentPrompt) {
      throw new Error('Failed to generate intelligent transcription prompt');
    }

    request.systemInstruction = {
      parts: [{ text: intelligentPrompt }]
    };

    request.contents.push({
      role: 'user',
      parts: [{ text: cleanText }]
    });

    logger.debug('Built basic intelligent transcription request', {
      skill: activeSkill,
      programmingLanguage: programmingLanguage || 'not specified',
      textLength: cleanText.length,
      hasSystemInstruction: !!request.systemInstruction
    });

    return request;
  }

  buildIntelligentTranscriptionRequestWithHistory(text, activeSkill, conversationHistory, skillContext, programmingLanguage) {
    const request = {
      contents: []
    };

    this.applyGenerationDefaults(request);

  // For chat/transcription messages, DO NOT include the full skill prompt; use only the intelligent filter prompt
  const intelligentPrompt = this.getIntelligentTranscriptionPrompt(activeSkill, programmingLanguage);
  request.systemInstruction = { parts: [{ text: intelligentPrompt }] };

    // Add recent conversation history (excluding system messages) with validation
    const conversationContents = conversationHistory
      .filter(event => {
        // Filter out system messages and ensure content exists and is valid
        return event.role !== 'system' && 
               event.content && 
               typeof event.content === 'string' && 
               event.content.trim().length > 0;
      })
      .map(event => {
        const content = event.content.trim();
        if (!content) {
          logger.warn('Empty content found in conversation history', { event });
          return null;
        }
        return {
          role: event.role === 'model' ? 'model' : 'user',
          parts: [{ text: content }]
        };
      })
      .filter(content => content !== null); // Remove any null entries

    // Add the conversation history
    request.contents.push(...conversationContents);

    // Validate and add the current transcription
    const cleanText = text && typeof text === 'string' ? text.trim() : '';
    if (!cleanText) {
      throw new Error('Empty or invalid transcription text provided');
    }

    request.contents.push({
      role: 'user',
      parts: [{ text: cleanText }]
    });

    // Ensure we have at least one content item
    if (request.contents.length === 0) {
      throw new Error('No valid content to send to OpenAI API');
    }

    logger.debug('Built intelligent transcription request with conversation history', {
      skill: activeSkill,
      programmingLanguage: programmingLanguage || 'not specified',
      historyLength: conversationHistory.length,
      totalContents: request.contents.length,
      hasSkillPrompt: !!skillContext.skillPrompt,
      cleanTextLength: cleanText.length,
      requiresProgrammingLanguage: skillContext.requiresProgrammingLanguage || false
    });

    return request;
  }

  getIntelligentTranscriptionPrompt(activeSkill, programmingLanguage) {
    let prompt = `# Intelligent Transcription Response System

You help the user answer questions heard through computer playback during a live call.
Use the transcript and conversation history together: the other person may ask a
question across several speech fragments. Answer their latest question directly.
The selected mode is ${activeSkill.toUpperCase()}; use it as context, but answer
questions on other topics too. Do not reject a question because it is outside that mode.
Do not repeat the question or add canned acknowledgments about listening.
Default to a CONCEPTUAL spoken answer, including for algorithms, data structures, and programming questions.
Explain the idea, reasoning, tradeoffs, and complexity in plain English. Do not output code, pseudocode, or an implementation unless the speaker explicitly asks you to write, implement, or show code.
"How does binary search work?", "Explain two sum", and "How would you solve this?" call for a conceptual explanation, not source code. "Implement binary search in Python" explicitly requests implementation.
Do not infer an implementation request from the selected coding mode, a problem statement, or code in earlier answers. A follow-up must explicitly request implementation (including a clear reference to a previous implementation request).`;

    // Add programming language context if provided
    if (programmingLanguage) {
      const lang = String(programmingLanguage).toLowerCase();
      const languageMap = { cpp: 'C++', c: 'C', python: 'Python', java: 'Java', javascript: 'JavaScript', js: 'JavaScript' };
      const fenceTagMap = { cpp: 'cpp', c: 'c', python: 'python', java: 'java', javascript: 'javascript', js: 'javascript' };
      const languageTitle = languageMap[lang] || (lang.charAt(0).toUpperCase() + lang.slice(1));
      const fenceTag = fenceTagMap[lang] || lang || 'text';
      prompt += `\n\nCODING CONTEXT: When code is needed, write it in ${languageTitle}. All code blocks must use triple backticks with language tag \`\`\`${fenceTag}\`\`\`. Do not include other programming languages unless explicitly asked.`;
    }

    prompt += `

## Response Rules:

### When the speaker asks a question or follows up:
- Give a useful answer the user can say on the call.
- Incorporate context from earlier speech fragments and follow-up questions.
- Use conceptual examples and explanations. Include code only when implementation is explicitly requested.
- If the transcript is incomplete, do not invent missing requirements or facts.

### When the speaker is making a statement or greeting:
- Keep any response brief and appropriate to what was said.
- Do not turn every fragment into a new unrelated question or a long answer.

## Response Format:
- Match the amount of detail to the question.
- Use bullet points when they make the answer easier to read.
- Focus on what the other person actually asked.

For an explicit implementation request, provide the requested code in a properly tagged fenced block. Otherwise answer conceptually, even if a full coding or DSA problem statement is spoken.

Remember: Answer the actual spoken question using the available conversation context.`;

    return prompt;
  }

  formatUserMessage(text, activeSkill) {
    return `Context: ${activeSkill.toUpperCase()} analysis request\n\nText to analyze:\n${text}`;
  }

  getReasoningEffort(model) {
    return require('./assistant-mode.service').snapshot().reasoningEffort;
  }

  processConversation(turn, options = {}, onDelta) {
    this.conversationQueues ||= new Map();
    const id = turn.user.conversationId;
    const next = (this.conversationQueues.get(id) || Promise.resolve()).catch(() => {}).then(() => this._processConversation(turn, options, onDelta));
    this.conversationQueues.set(id, next);
    void next.finally(() => { if (this.conversationQueues.get(id) === next) this.conversationQueues.delete(id); }).catch(() => {});
    return next;
  }

  async _processConversation(turn, options = {}, onDelta) {
    if (!this.isInitialized) throw new Error('Add your OpenAI API key in Settings.');
    const store = require('./conversation-store.service');
    const mode = require('./assistant-mode.service').snapshot();
    const { ConversationContext } = require('./conversation-context.service');
    const request = new ConversationContext(store).build(turn, { ...options, mode });
    const startedAt = new Date().toISOString(); const started = Date.now(); let firstTokenMs = null;
    const metadata = { ...mode, startedAt, conversationId: turn.user.conversationId, streamed: true,
      instructionsHash: require('crypto').createHash('sha256').update(request.instructions).digest('hex'),
      resumeLoaded: request.resumeLoaded, resumeSourceHash: request.resumeSourceHash };
    store.db.prepare('UPDATE messages SET model=?,metadata_json=? WHERE id IN (?,?)').run(mode.model, JSON.stringify(metadata), turn.user.id, turn.assistant.id);
    const { modeSnapshot, conversationId, resumeLoaded, resumeSourceHash, ...body } = request;
    let response = ''; let completed = false;
    try {
      const stream = await this.client.responses.create({ ...body, stream: true });
      for await (const event of stream) {
        if (event.type === 'response.output_text.delta') {
          if (firstTokenMs === null) firstTokenMs = Date.now() - started;
          response += event.delta; onDelta?.(event.delta);
        } else if (event.type === 'response.completed') completed = true;
        else if (['error','response.failed','response.incomplete'].includes(event.type)) throw new Error(event.message || event.response?.error?.message || 'Model response failed or incomplete.');
      }
      if (!completed || !response) throw new Error('Model stream ended before completion.');
      response = await this.ensureCodeAnnotations(response, { model: mode.model, reasoningEffort: mode.reasoningEffort });
      return { response, metadata: { ...metadata, firstTokenMs, processingTime: Date.now()-started, completedAt: new Date().toISOString(), providerError: null } };
    } catch (error) {
      if ([400,403,404].includes(error.status) && /model|reasoning|effort|access/i.test(error.message || '')) {
        error.message = `${mode.model} with ${mode.reasoningEffort} reasoning could not be used. Check model access and reasoning support for the configured OpenAI project in Settings. No model was substituted. Provider detail: ${error.message}`;
      }
      store.db.prepare('UPDATE messages SET metadata_json=? WHERE id=?').run(JSON.stringify({ ...metadata, firstTokenMs, processingTime: Date.now()-started, providerError: error.message }), turn.assistant.id);
      throw error;
    }
  }

  buildOpenAIRequest(request) {
    const model = request.model || this.model;
    const contents = typeof request.contents === 'string'
      ? [{ role: 'user', parts: [{ text: request.contents }] }]
      : request.contents || [];
    const resumePrompt = resumeContext.getPromptBlock();
    return {
      model,
      store: false,
      reasoning: { effort: this.getReasoningEffort(model) },
      instructions: [
        request.systemInstruction?.parts?.map(p => p.text || '').join('\n'),
        resumePrompt,
        require('../core/code-presentation'),
        require('../core/plain-text-instructions')
      ].filter(Boolean).join('\n\n'),
      input: contents.map(content => {
        const assistant = content.role === 'model' || content.role === 'assistant';
        return {
          role: assistant ? 'assistant' : 'user',
          content: (content.parts || []).map(part => {
            if (part.inlineData) return {
              type: 'input_image',
              image_url: 'data:' + part.inlineData.mimeType + ';base64,' + part.inlineData.data,
              detail: 'auto'
            };
            return { type: assistant ? 'output_text' : 'input_text', text: part.text || '' };
          })
        };
      }),
      max_output_tokens: request.generationConfig?.maxOutputTokens || 4096
    };
  }

  async executeRequest(request) {
    const result = await this.client.responses.create(this.buildOpenAIRequest(request));
    if (result.status === 'incomplete') throw new Error('OpenAI response incomplete: ' + (result.incomplete_details?.reason || 'unknown'));
    if (!result.output_text) throw new Error(result.error?.message || 'OpenAI returned no answer');
    return this.ensureCodeAnnotations(result.output_text, request);
  }

  async ensureCodeAnnotations(text, request) {
    // Spoken implementation requests stay in Q&A as ordinary code blocks.
    // Screenshot solutions use the separate annotated code presentation.
    if (request.responseSource === 'speech') return text.replace(/<!--\s*coding-answer\s*-->/gi, '').trim();
    const { splitResponse } = require('../../lib/response-parts');
    // Accept older annotated replies without requiring the model to rewrite them.
    if (!splitResponse(text).codeBlocks.length && /^\s*(?:#|\/\/)\s*@explain:/m.test(text)) {
      text = text.replace(/((?:^[ \t]*(?:#|\/\/)[ \t]*@explain:[^\n]*\n[^\n]*(?:\n|$))+)/gm, block =>
        '```' + (/^[ \t]*#/.test(block) ? 'python' : 'cpp') + '\n' + block + (block.endsWith('\n') ? '' : '\n') + '```\n');
    }
    const original = splitResponse(text);
    const missing = [];
    original.codeBlocks.forEach((block, blockIndex) => block.lines.forEach((line, index) => {
      if (line.code.trim()) {
        const setup = /^\s*(?:#include|using\s+namespace|(?:public|private|protected)\s*:|(?:class|struct|namespace)\s)/.test(line.code);
        const goal = /^\s*(?:def\s|function\s)/.test(line.code) || (/\w+\s*\([^;]*\)\s*(?:const\s*)?\{\s*$/.test(line.code) && !/^\s*(?:if|for|while|switch|catch)\b/.test(line.code));
        const completion = /^[\s{}();]+$/.test(line.code);
        missing.push({ key: `b${blockIndex}_l${index + 1}`, block: blockIndex, line: index + 1, focus: setup ? 'algorithm_plan' : goal ? 'problem_goal' : completion ? 'logical_phase' : 'step_purpose' });
      }
    }));
    if (!missing.length) return text;
    const descriptions = new Map();
    try {
      // The second request can return descriptions only. Source remains local
      // and immutable; no formatting difference can discard a valid solution.
      const result = await this.client.responses.create({
        model: request.model || this.model,
        store: false,
        reasoning: { effort: request.reasoningEffort || this.getReasoningEffort(request.model || this.model) },
        instructions: `For every requested source line, write a short phrase the user can SAY aloud just before typing that line, as if explaining their solution to another person. At most 12 words per phrase. Explain WHY this step helps solve this particular problem, not HOW the programming language works.
Do not narrate syntax or scaffolding at all. Do not mention classes, methods, functions, namespaces, public/private access, types, imports, libraries, declarations, braces, semicolons, indentation, or making names available. Naming the data structure or algorithm is useful; naming grammar is not.
For setup or structural lines, briefly recap the relevant algorithmic plan or logical phase instead of naming the language construct. For example, setup for Two Sum can be "I'll find each number's missing partner with fast lookups." A closing structural line can be "That completes checking the current candidate." Do not say "I organize a class" or "I expose a method".
Each requested line includes a focus. For algorithm_plan, say why the chosen approach works (for example, avoiding all pair comparisons with fast lookups); ignore what that setup line literally says. For problem_goal, state what the algorithm needs to find or produce. For logical_phase, briefly say which search step is complete. Only step_purpose should describe the operation performed by that specific source line. Never say "standard names", "solution container", "entry point", "accessible", or "routine" as a substitute for explaining the algorithm.
Also provide algorithm_plan: three short spoken phrases describing the high-level algorithm only, and problem_goal: one short phrase stating the required result. These fields must describe the problem and strategy, with no discussion of code organization or programming language. The app uses these high-level phrases above setup lines rather than narrating their syntax.
Examples of spoken purpose: "I remember earlier numbers so I can find the complement quickly."; "I check whether this number completes a pair we've already started."; "I return the two positions once the target sum is found."; "That finishes checking this candidate."; "I prepare the fast lookup approach for this search."
Do not repeat the same generic explanation for every line. Use the surrounding code to make each phrase useful. Do not rewrite any code. Return only the requested JSON descriptions with the given block and line numbers.`,
        input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify({
          problemContext: original.text,
          codeBlocks: original.codeBlocks.map(block => ({ language: block.language, source: block.cleanCode })),
          requestedLines: missing
        }) }] }],
        text: { format: {
          type: 'json_schema', name: 'line_descriptions', strict: true,
          schema: { type: 'object', properties: {
            algorithm_plan: { type: 'array', items: { type: 'string' } },
            problem_goal: { type: 'string' },
            descriptions: { type: 'object', properties: Object.fromEntries(missing.map(item => [item.key, { type: 'string' }])),
              required: missing.map(item => item.key), additionalProperties: false }
          }, required: ['algorithm_plan', 'problem_goal', 'descriptions'], additionalProperties: false }
        } },
        max_output_tokens: Math.min(16384, Math.max(1024, missing.length * 70))
      });
      const parsed = JSON.parse(result.output_text || '{}');
      const allowed = new Set(missing.map(item => `${item.block}:${item.line}`));
      const rows = Array.isArray(parsed.descriptions) ? parsed.descriptions : Object.entries(parsed.descriptions || {}).map(([key, description]) => {
        const match = key.match(/^b(\d+)_l(\d+)$/);
        return { block: match ? Number(match[1]) : -1, line: match ? Number(match[2]) : -1, description };
      });
      for (const item of rows) {
        const key = `${item.block}:${item.line}`;
        if (allowed.has(key) && typeof item.description === 'string' && item.description.trim()) {
          descriptions.set(key, item.description.replace(/[\r\n]+/g, ' ').trim());
        }
      }
      const plans = Array.isArray(parsed.algorithm_plan) ? parsed.algorithm_plan.filter(value => typeof value === 'string' && value.trim()) : [];
      let planIndex = 0;
      for (const item of missing) {
        const highLevel = item.focus === 'algorithm_plan' && plans.length ? plans[planIndex++ % plans.length]
          : item.focus === 'problem_goal' && typeof parsed.problem_goal === 'string' ? parsed.problem_goal : null;
        if (highLevel?.trim()) descriptions.set(`${item.block}:${item.line}`, highLevel.replace(/[\r\n]+/g, ' ').trim());
      }
      if (descriptions.size !== missing.length) logger.warn('Some code line descriptions are unavailable', { expected: missing.length, received: descriptions.size });
    } catch (error) {
      logger.warn('Line descriptions unavailable; retaining the original solution', { error: error.message });
    }
    let output = '';
    let cursor = 0;
    original.codeBlocks.forEach((block, blockIndex) => {
      const prefix = block.language.toLowerCase() === 'python' ? '# @explain: ' : '// @explain: ';
      const source = block.lines.map((line, index) => {
        const description = descriptions.get(`${blockIndex}:${index + 1}`) || line.explanation;
        return description ? prefix + description + '\n' + line.code : line.code;
      }).join('\n') + (block.cleanCode.endsWith('\n') ? '\n' : '');
      const start = block.fullMatch.indexOf('\n') + 1;
      const index = text.indexOf(block.fullMatch, cursor);
      if (index < 0) return;
      output += text.slice(cursor, index) + block.fullMatch.slice(0, start) + source + block.fullMatch.slice(start + block.code.length);
      cursor = index + block.fullMatch.length;
    });
    return output + text.slice(cursor);
  }

  /**
   * Streaming sibling of processTranscriptionWithIntelligentResponse. Emits
   * incremental text via onDelta so the UI can render the answer as it is
   * generated (much faster perceived latency). Returns the same
   * {response, metadata} shape. Falls back to the non-streaming path on any
   * streaming failure so reliability is never worse than before.
   */
  async processTranscriptionWithIntelligentResponseStream(text, activeSkill, sessionMemory = [], programmingLanguage = null, onDelta = null) {
    if (!this.isInitialized) {
      throw new Error('LLM service not initialized. Check OpenAI API key configuration.');
    }

    const startTime = Date.now();
    this.requestCount++;

    try {
      const geminiRequest = this.buildIntelligentTranscriptionRequest(text, activeSkill, sessionMemory, programmingLanguage);

      const fullText = await this.executeStreamingRequest(geminiRequest, (delta) => {
        if (typeof onDelta === 'function' && delta) {
          onDelta(delta);
        }
      });

      const finalResponse = programmingLanguage
        ? this.enforceProgrammingLanguage(fullText, programmingLanguage)
        : fullText;

      logger.logPerformance('LLM transcription streaming', startTime, {
        activeSkill,
        textLength: text.length,
        responseLength: finalResponse.length,
        requestId: this.requestCount
      });

      return {
        response: finalResponse,
        metadata: {
          skill: activeSkill,
          programmingLanguage,
          processingTime: Date.now() - startTime,
          requestId: this.requestCount,
          usedFallback: false,
          streamed: true,
          isTranscriptionResponse: true
        }
      };
    } catch (error) {
      logger.warn('Streaming transcription failed, falling back to non-streaming', {
        error: error.message,
        requestId: this.requestCount
      });
      // Non-streaming path returns the same shape; the caller renders it as a
      // single final response.
      return this.processTranscriptionWithIntelligentResponse(text, activeSkill, sessionMemory, programmingLanguage);
    }
  }

  /** Safely pull the text delta out of a streamed OpenAI chunk. */
  _extractChunkText(chunk) {
    try {
      const t = chunk && chunk.text;
      if (typeof t === 'string') {
        return t;
      }
    } catch (_) {
      // `.text` getter can throw on non-text parts; fall through to manual read.
    }
    try {
      const parts = (chunk && chunk.candidates && chunk.candidates[0] &&
        chunk.candidates[0].content && chunk.candidates[0].content.parts) || [];
      return parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('');
    } catch (_) {
      return '';
    }
  }

  /**
   * Run a streaming OpenAI request with the same model-fallback + retry policy
   * as executeRequest. Accumulates and returns the full text; invokes onDelta
   * for each chunk.
   */
  async executeStreamingRequest(request, onDelta) {
    const stream = await this.client.responses.create({ ...this.buildOpenAIRequest(request), stream: true });
    let text = '';
    let completed = false;
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        text += event.delta;
        if (typeof onDelta === 'function') onDelta(event.delta);
      } else if (event.type === 'error' || event.type === 'response.failed') {
        throw new Error(event.message || event.response?.error?.message || 'OpenAI stream failed');
      } else if (event.type === 'response.incomplete') {
        throw new Error('OpenAI response incomplete: ' + (event.response?.incomplete_details?.reason || 'unknown'));
      } else if (event.type === 'response.completed') {
        completed = true;
      }
    }
    if (!completed || !text) throw new Error('OpenAI stream ended without a complete answer');
    return this.ensureCodeAnnotations(text, request);
  }

  async performPreflightCheck() {
    // Quick connectivity check
    try {
      const startTime = Date.now();
      await this.testNetworkConnection({ 
        host: 'api.openai.com',
        port: 443, 
        name: 'OpenAI API Endpoint'
      });
      const latency = Date.now() - startTime;
      
      logger.debug('Preflight check passed', { latency });
    } catch (error) {
      logger.warn('Preflight check failed', { 
        error: error.message,
        suggestion: 'Network connectivity issue detected before API call'
      });
      // Don't throw here - let the actual API call fail with more detail
    }
  }

  getUserAgent() {
    try {
      // Try to get user agent from Electron if available
      if (typeof navigator !== 'undefined' && navigator.userAgent) {
        return navigator.userAgent;
      }
      return `Node.js/${process.version} (${process.platform}; ${process.arch})`;
    } catch {
      return 'Unknown';
    }
  }

  analyzeError(error) {
    const errorMessage = error.message.toLowerCase();
    
    // Network connectivity errors
    if (errorMessage.includes('fetch failed') || 
        errorMessage.includes('network error') ||
        errorMessage.includes('enotfound') ||
        errorMessage.includes('econnrefused') ||
        errorMessage.includes('timeout')) {
      return {
        type: 'NETWORK_ERROR',
        isNetworkError: true,
        suggestedAction: 'Check internet connection and firewall settings'
      };
    }
    
    // API key errors
    if (errorMessage.includes('unauthorized') || 
        errorMessage.includes('invalid api key') ||
        errorMessage.includes('forbidden')) {
      return {
        type: 'AUTH_ERROR',
        isNetworkError: false,
        suggestedAction: 'Verify OpenAI API key configuration'
      };
    }
    
    // Rate limiting
    if (errorMessage.includes('quota') || 
        errorMessage.includes('rate limit') ||
        errorMessage.includes('too many requests')) {
      return {
        type: 'RATE_LIMIT_ERROR',
        isNetworkError: false,
        suggestedAction: 'Wait before retrying or check API quota'
      };
    }
    
    // Timeout errors
    if (errorMessage.includes('request timeout') || errorMessage.includes('etimedout')) {
      return {
        type: 'TIMEOUT_ERROR',
        isNetworkError: true,
        suggestedAction: 'Check network latency or increase timeout'
      };
    }
    
    return {
      type: 'UNKNOWN_ERROR',
      isNetworkError: false,
      suggestedAction: 'Check logs for more details'
    };
  }

  async checkNetworkConnectivity() {
    const connectivityTests = [

      { host: 'api.openai.com', port: 443, name: 'OpenAI API Endpoint' }
    ];

    const results = await Promise.allSettled(
      connectivityTests.map(test => this.testNetworkConnection(test))
    );

    const connectivity = {
      timestamp: new Date().toISOString(),
      tests: results.map((result, index) => ({
        ...connectivityTests[index],
        success: result.status === 'fulfilled' && result.value,
        error: result.status === 'rejected' ? result.reason.message : null
      }))
    };

    logger.info('Network connectivity check completed', connectivity);
    return connectivity;
  }

  async testNetworkConnection({ host, port, name }) {
    return new Promise((resolve, reject) => {
      const net = require('net');
      const socket = new net.Socket();
      
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Connection timeout to ${host}:${port}`));
      }, 5000);

      socket.on('connect', () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(true);
      });

      socket.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Connection failed to ${host}:${port}: ${error.message}`));
      });

      socket.connect(port, host);
    });
  }

  generateFallbackResponse(text, activeSkill) {
    logger.info('Generating fallback response', { activeSkill });

    const fallbackResponses = {
      'dsa': 'This appears to be a data structures and algorithms problem. Consider breaking it down into smaller components and identifying the appropriate algorithm or data structure to use.',
      'system-design': 'For this system design question, consider scalability, reliability, and the trade-offs between different architectural approaches.',
      'programming': 'This looks like a programming challenge. Focus on understanding the requirements, edge cases, and optimal time/space complexity.',
      'default': 'I can help analyze this content. Please ensure your OpenAI API key is properly configured for detailed analysis.'
    };

    const response = fallbackResponses[activeSkill] || fallbackResponses.default;
    
    return {
      response,
      metadata: {
        skill: activeSkill,
        processingTime: 0,
        requestId: this.requestCount,
        usedFallback: true
      }
    };
  }

  generateIntelligentFallbackResponse(text, activeSkill) {
    logger.info('Generating intelligent fallback response for transcription', { activeSkill });

    // Simple heuristic to determine if message seems skill-related
    const skillKeywords = {
      'dsa': ['algorithm', 'data structure', 'array', 'tree', 'graph', 'sort', 'search', 'complexity', 'big o'],
      'programming': ['code', 'function', 'variable', 'class', 'method', 'bug', 'debug', 'syntax'],
      'system-design': ['scalability', 'database', 'architecture', 'microservice', 'load balancer', 'cache'],
      'behavioral': ['interview', 'experience', 'situation', 'leadership', 'conflict', 'team'],
      'sales': ['customer', 'deal', 'negotiation', 'price', 'revenue', 'prospect'],
      'presentation': ['slide', 'audience', 'public speaking', 'presentation', 'nervous'],
      'data-science': ['data', 'model', 'machine learning', 'statistics', 'analytics', 'python', 'pandas'],
      'devops': ['deployment', 'ci/cd', 'docker', 'kubernetes', 'infrastructure', 'monitoring'],
      'negotiation': ['negotiate', 'compromise', 'agreement', 'terms', 'conflict resolution']
    };

    const textLower = text.toLowerCase();
    const relevantKeywords = skillKeywords[activeSkill] || [];
    const hasRelevantKeywords = relevantKeywords.some(keyword => textLower.includes(keyword));
    
    // Check for question indicators
    const questionIndicators = ['how', 'what', 'why', 'when', 'where', 'can you', 'could you', 'should i', '?'];
    const seemsLikeQuestion = questionIndicators.some(indicator => textLower.includes(indicator));

    let response;
    if (hasRelevantKeywords || seemsLikeQuestion) {
      response = `I'm having trouble processing that right now, but it sounds like a ${activeSkill} question. Could you rephrase or ask more specifically about what you need help with?`;
    } else {
      response = `Yeah, I'm listening. Ask your question relevant to ${activeSkill}.`;
    }
    
    return {
      response,
      metadata: {
        skill: activeSkill,
        processingTime: 0,
        requestId: this.requestCount,
        usedFallback: true,
        isTranscriptionResponse: true
      }
    };
  }

  async testConnection() {
    if (!this.isInitialized) return { success: false, error: 'Add your OpenAI API key in Settings.' };
    const start = Date.now();
    try {
      const response = await this.executeRequest({ contents: 'Reply with OK.' });
      return { success: true, response, latency: Date.now() - start, model: this.model };
    } catch (error) {
      const errorAnalysis = this.analyzeError(error);
      return { success: false, error: this._friendlyTestError(error, errorAnalysis), errorAnalysis };
    }
  }

  /**
   * Translate raw SDK / network errors into something a user can act on.
   */
  _friendlyTestError(error, analysis) {
    const type = analysis?.type;
    const raw = (error?.message || '').toLowerCase();

    if (type === 'NETWORK_ERROR' || raw.includes('fetch failed') || raw.includes('enotfound')) {
      return 'Cannot reach OpenAI servers. Check your internet connection, firewall, or VPN settings.';
    }
    if (type === 'AUTH_ERROR' || raw.includes('api key') || raw.includes('401') || raw.includes('403')) {
      return 'Invalid API key or insufficient permissions. Double-check the key at platform.openai.com/api-keys.';
    }
    if (type === 'RATE_LIMIT_ERROR' || raw.includes('429') || raw.includes('quota')) {
      return 'Rate limit or quota exceeded. Wait a moment or check your OpenAI API billing.';
    }
    if (type === 'TIMEOUT_ERROR') {
      return 'Request timed out. The OpenAI API may be slow or unreachable right now.';
    }
    if (type === 'MODEL_ERROR' || raw.includes('model') || raw.includes('404')) {
      return 'The configured OpenAI model is unavailable. Try a different model in Settings.';
    }
    if (raw.includes('503') || raw.includes('unavailable') || raw.includes('high demand')) {
      return 'OpenAI is experiencing high demand. Please wait a moment and try again.';
    }
    // Fall back to a stripped-down raw message (no SDK prefix noise)
    return (error?.message || 'Connection failed').replace(/^\[(GoogleGenerativeAI|GoogleGenAI) Error\]:\s*/i, '');
  }

  updateApiKey(newApiKey) {
    process.env.OPENAI_API_KEY = newApiKey;
    this.isInitialized = false;
    this.initializeClient();
    
    logger.info('API key updated and client reinitialized');
  }

  getStats() {
    return {
      isInitialized: this.isInitialized,
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      successRate: this.requestCount > 0 ? ((this.requestCount - this.errorCount) / this.requestCount) * 100 : 0,
      model: this.model, config: config.get('llm.openai')
    };
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Keep the existing call sites compatible with the OpenAI transport.
  async executeAlternativeRequest(request) {
    return this.executeRequest(request);
  }
}

module.exports = new LLMService();

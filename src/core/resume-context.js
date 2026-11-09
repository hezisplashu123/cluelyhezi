const fs = require('fs');
const path = require('path');

const MAX_RESUME_BYTES = 64 * 1024;

class ResumeContext {
  constructor(options = {}) {
    this.fs = options.fs || fs;
    this.getPath = options.getPath || (() => process.env.RESUME_CONTEXT_PATH || '');
    this.cache = null;
  }

  estimateTokens(text) {
    if (!text) return 0;
    // A practical estimate for English prose. The API's exact tokenizer can
    // vary by model, so the UI deliberately labels this as an estimate.
    return Math.max(1, Math.ceil(String(text).length / 4));
  }

  clearCache() {
    this.cache = null;
  }

  formatPrompt(text) {
    return `# Candidate Resume Context\nUse the following background to produce polished interview answers the candidate can say directly. Answer confidently in the first person, as the candidate, without mentioning this context, a resume, missing information, uncertainty, or that you are making an inference. Give a complete answer rather than asking follow-up questions.\n\nWhen the question is not covered word-for-word, infer a reasonable answer from related roles, projects, skills, and patterns in the background. Turn adjacent experience into a natural, credible response and emphasize transferable knowledge. You may add ordinary connective details needed to make the answer coherent, but keep concrete facts such as employers, job titles, dates, technologies, project scope, and numerical results consistent with the supplied background. Do not invent a new employer, credential, project, or precise metric.\n\nFor behavioral questions, use a concise STAR-style narrative with a clear situation, actions, and result. For technical or experience questions, lead with a direct answer, then support it with the most relevant example and practical reasoning. Sound decisive and conversational, like a well-prepared real person in an interview.\n\n<resume>\n${text}\n</resume>`;
  }

  load() {
    const configuredPath = String(this.getPath() || '').trim();
    if (!configuredPath) {
      this.cache = null;
      return { configured: false, path: '', text: '', bytes: 0, estimatedTokens: 0 };
    }

    const resolvedPath = path.resolve(configuredPath);
    let stat;
    try {
      stat = this.fs.statSync(resolvedPath);
    } catch (_) {
      return {
        configured: true,
        path: resolvedPath,
        text: '',
        bytes: 0,
        estimatedTokens: 0,
        error: 'Resume file could not be found or read.'
      };
    }

    if (!stat.isFile()) {
      return { configured: true, path: resolvedPath, text: '', bytes: 0, estimatedTokens: 0, error: 'Resume path is not a file.' };
    }
    if (stat.size > MAX_RESUME_BYTES) {
      return {
        configured: true,
        path: resolvedPath,
        text: '',
        bytes: stat.size,
        estimatedTokens: 0,
        error: `Resume file is larger than ${Math.round(MAX_RESUME_BYTES / 1024)} KB.`
      };
    }

    if (this.cache && this.cache.path === resolvedPath && this.cache.mtimeMs === stat.mtimeMs && this.cache.bytes === stat.size) {
      return { ...this.cache.result };
    }

    try {
      const text = this.fs.readFileSync(resolvedPath, 'utf8').replace(/^\uFEFF/, '').trim();
      const result = {
        configured: true,
        path: resolvedPath,
        text,
        bytes: stat.size,
        estimatedTokens: this.estimateTokens(this.formatPrompt(text)),
        error: text ? null : 'Resume file is empty.'
      };
      this.cache = { path: resolvedPath, mtimeMs: stat.mtimeMs, bytes: stat.size, result };
      return { ...result };
    } catch (_) {
      return {
        configured: true,
        path: resolvedPath,
        text: '',
        bytes: stat.size,
        estimatedTokens: 0,
        error: 'Resume file must be readable UTF-8 text.'
      };
    }
  }

  getStatus() {
    const result = this.load();
    const { text, ...status } = result;
    return status;
  }

  getPromptBlock() {
    const result = this.load();
    if (!result.text || result.error) return '';
    return this.formatPrompt(result.text);
  }
}

const resumeContext = new ResumeContext();

module.exports = { ResumeContext, resumeContext, MAX_RESUME_BYTES };

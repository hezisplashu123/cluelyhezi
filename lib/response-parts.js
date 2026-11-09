(function (root) {
  function annotatedCode(code) {
    let explanation = null;
    const lines = [];
    const source = String(code).replace(/\r\n/g, '\n').split('\n');
    if (source[source.length - 1] === '') source.pop();
    for (const line of source) {
      const marker = line.match(/^\s*(?:\/\/|#|--)\s*@explain:\s*(.+)$/);
      if (marker) { explanation = marker[1].trim(); continue; }
      lines.push({ code: line, explanation });
      explanation = null;
    }
    return { lines, cleanCode: lines.map(line => line.code).join('\n') + (String(code).endsWith('\n') ? '\n' : '') };
  }
  function splitResponse(response) {
    const codeBlocks = [];
    const markedCoding = /<!--\s*coding-answer\s*-->/i.test(String(response));
    const text = String(response || '').replace(/<!--\s*coding-answer\s*-->/gi, '').replace(/^ {0,3}(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^ {0,3}\1[ \t]*(?:\n|$)/gm,
      (fullMatch, fence, info, code) => {
        const language = (info.trim().split(/\s+/)[0] || 'text').replace(/[^a-zA-Z0-9_+#.-]/g, '') || 'text';
        codeBlocks.push({ language, code, fullMatch, ...annotatedCode(code) });
        return '\n';
      }).replace(/\n\s*\n\s*\n/g, '\n\n').trim();
    return { text, codeBlocks, isCoding: markedCoding || codeBlocks.length > 0 };
  }
  if (typeof module === 'object' && module.exports) module.exports = { splitResponse, annotatedCode };
  else root.responseParts = { splitResponse, annotatedCode };
})(typeof window !== 'undefined' ? window : globalThis);

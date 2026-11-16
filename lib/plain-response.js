(function(root) {
  const escapeHtml = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function proseChunk(value) {
    return value
      .replace(/<!--\s*coding-answer\s*-->/gi,'')
      .replace(/^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})[ \t]*$/gm,'')
      .replace(/^ {0,3}#{1,6}[ \t]+/gm,'')
      .replace(/^([ \t]*)([-+*•])[ \t]+([^\r\n]*)/gm,(line,indent,marker,body) => {
        // Keep negative values and arithmetic, rather than deleting every dash.
        if(marker==='-' && ((/^\$?\d/.test(body) && (/^[\d.$,% ]+$/.test(body) || /[=+*/<>]/.test(body))) || /^[A-Za-z](?:$|\s*[=+*/<>-])/.test(body))) return line;
        return indent+body;
      })
      .replace(/^[ \t]*\d+[.)][ \t]+/gm,'')
      .replace(/^ {0,3}>[ \t]+(?=[A-Za-z])/gm,'')
      .replace(/(^|[\s([{])\[([^\]\n]+)\]\(([^)\n]+)\)/g,'$1$2 ($3)')
      .replace(/(^|[\s([{,:;])\*\*(?=\S)([\s\S]*?\S)\*\*(?=$|[\s.,!?;:)\]}])/g,'$1$2')
      .replace(/(^|[\s([{,:;])__(?=\S)([^\n]*?\S)__(?=$|[\s.,!?;:)\]}])/g,'$1$2')
      .replace(/(^|[\s([{,:;])\*(?=\S)([^*\n]*?\S)\*(?=$|[\s.,!?;:)\]}])/g,'$1$2')
      // Hide unfinished bold delimiters during token streaming as well.
      .replace(/(^|[\s([{,:;])\*\*(?=\S|$)/g,'$1')
      .replace(/(\S)\*\*(?=$|[\s.,!?;:)\]}])/g,'$1');
  }

  function plainProse(value) {
    const text=String(value || '');const inline=/(`+)([^\r\n]*?)\1/g;
    let output='',cursor=0,match;
    while((match=inline.exec(text))) {
      output+=proseChunk(text.slice(cursor,match.index))+match[2];cursor=inline.lastIndex;
    }
    const rest=text.slice(cursor);const open=rest.indexOf('`');
    // Treat a pending inline-code span as literal code until its closing token arrives.
    output+=open<0?proseChunk(rest):proseChunk(rest.slice(0,open))+rest.slice(open).replace(/^`+/,'');
    return output;
  }

  function parts(value, { plain = true } = {}) {
    const text=String(value || '');const result=[];let cursor=0,match;
    const opening=/^ {0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r?\n|$)/gm;
    const addText=body=>{if(body)result.push({kind:'text',content:plain?plainProse(body):body,language:''});};
    while((match=opening.exec(text))) {
      addText(text.slice(cursor,match.index));
      const character=match[1][0],length=match[1].length;
      const closing=new RegExp('^ {0,3}'+character+'{'+length+',}[ \\t]*(?:\\r?\\n|$)','gm');
      closing.lastIndex=opening.lastIndex;const end=closing.exec(text);
      result.push({kind:'code',content:text.slice(opening.lastIndex,end?end.index:text.length),language:match[2].trim().split(/\s+/)[0] || 'text'});
      cursor=end?closing.lastIndex:text.length;opening.lastIndex=cursor;
      if(!end)break;
    }
    addText(text.slice(cursor));return result;
  }

  function toHtml(value) {
    return parts(value).map(part=>part.kind==='code'
      ? '<pre><code class="language-'+part.language.replace(/[^a-zA-Z0-9_+#.-]/g,'')+'">'+escapeHtml(part.content)+'</code></pre>'
      : part.content.trim().split(/\n[ \t]*\n/).filter(Boolean).map(paragraph=>'<p>'+escapeHtml(paragraph).replace(/\r?\n/g,'<br>')+'</p>').join('')
    ).join('');
  }
  const toText = value => parts(value).map(part=>part.content).join('');
  const api={plainProse,parts,toHtml,toText};
  if(typeof module==='object' && module.exports)module.exports=api;else root.plainResponse=api;
})(typeof window!=='undefined'?window:globalThis);

/* Math and source-editor helpers. Never interprets user source as HTML. */
(() => {
  'use strict';
  const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const escaped = (text,i) => {let n=0;while(i>0 && text[--i]==='\\')n++;return (n&1)!==0;};
  function scan(source) {
    const text=String(source),math=[];
    // Omit fenced source code; mathematical delimiters in code are literal.
    const masked=text.replace(/(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2[^\n]*(?=\n|$)/g,m=>' '.repeat(m.length));
    for(let i=0;i<masked.length;){
      let o='',c='',display=false;
      if(masked.startsWith('\\[',i)&&!escaped(masked,i)){o='\\[';c='\\]';display=true;}
      else if(masked.startsWith('\\(',i)&&!escaped(masked,i)){o='\\(';c='\\)';}
      else if(masked.startsWith('$$',i)&&!escaped(masked,i)){o='$$';c='$$';display=true;}
      else if(masked[i]==='$'&&!escaped(masked,i)){o='$';c='$';}
      if(!o){i++;continue;}
      let j=masked.indexOf(c,i+o.length);
      while(j>=0 && escaped(masked,j))j=masked.indexOf(c,j+c.length);
      if(j<0){
        // A standalone dollar in prose isn't always mathematics, but a missing
        // closing display delimiter or LaTeX backslash pair is unambiguously bad.
        if(o!=='$')throw Error('Unclosed mathematical delimiter '+o+' (position '+(i+1)+').');
        i++;continue;
      }
      const tex=text.slice(i+o.length,j);
      if(!tex.trim())throw Error('Empty mathematical expression at position '+(i+1)+'.');
      if(tex.length>32768)throw Error('A mathematical expression is too long.');
      math.push({tex,display,start:i});i=j+c.length;
      if(math.length>512)throw Error('Too many formulas in one block.');
    }
    return math;
  }
  function highlight(source) {
    // Simple deterministic tokenizer, with every fragment HTML-escaped.
    const re=/(\\(?:[A-Za-z@]+\*?|.)|\$\$|\$|\{|\}|\^|_|^#{1,6}(?=\s)|^:::[^\n]*|<!--[\s\S]*?-->|%[^\n]*)/gm;
    let result='',last=0,m;
    while((m=re.exec(source))){
      result+=escape(source.slice(last,m.index));const t=m[0];
      const kind=t.startsWith('\\')?'tex-command':t==='{'||t==='}'?'tex-brace':t==='_'||t==='^'?'tex-script':t.startsWith('%')?'tex-comment':t.startsWith('#')||t.startsWith(':::')?'md-heading':t.startsWith('<!--')?'md-comment':'math-delimiter';
      result+='<span class="'+kind+'">'+escape(t)+'</span>';last=m.index+t.length;
    }
    return result+escape(source.slice(last))+'\n';
  }
  async function validate(source) {
    const math=scan(source);
    if(!math.length)return {count:0};
    const mj=window.MathJax;
    if(!mj?.tex2svgPromise)throw Error('MathJax is not ready: cannot verify the formulas yet.');
    await mj.startup.promise;
    for(const m of math){
      let node;
      try{node=await mj.tex2svgPromise(m.tex,{display:m.display});}
      catch(e){throw Error('LaTeX error near position '+(m.start+1)+': '+(e?.message||'invalid expression'));}
      const err=node.querySelector('[data-mml-node="merror"],merror,mjx-merror');
      if(err)throw Error('LaTeX error near position '+(m.start+1)+': '+(err.textContent||'unsupported command').trim().slice(0,200));
    }
    return {count:math.length};
  }
  window.MLMathTools=Object.freeze({scan,highlight,validate});
})();

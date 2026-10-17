// 关卡模块约定：mount 在第一个 await 之前交出 unmount，返回的也是同一个函数
export async function mount(root, meta, api){
  let gone = false;
  function unmount(){
    if (gone) return;
    gone = true;
  }
  if (api && typeof api.bindUnmount === 'function') api.bindUnmount(unmount);
  let i = 0, score = 0;
  const h = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  function starsOf(points){
    const total = meta.questions.length;
    if (!total) return 0;
    return Math.max(0, Math.min(3, Math.round(points / total * 3)));
  }
  function render(){
    if (gone) return;
    if(i >= meta.questions.length){
      const stars = starsOf(score);
      root.innerHTML = `<h1>${h(meta.title)}</h1><div class="card">答对 ${score} / ${meta.questions.length}</div><button class="btn" id="done">完成本关</button>`;
      root.querySelector('#done').onclick = () => { if (!gone) api.complete({ stars, score }); };
      return;
    }
    const q = meta.questions[i];
    root.innerHTML = `<p class="small">${h(api.bookTitle)}</p><h1>${h(meta.title)}</h1>${i===0?`<p>${h(meta.intro)}</p>`:''}
      <div class="card">${h(q.q)}</div>` + q.options.map((o,k)=>`<button class="btn" data-k="${k}">${h(o)}</button>`).join('');
    root.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { if(+b.dataset.k === q.answer) score++; i++; render(); });
  }
  render();
  return unmount;
}

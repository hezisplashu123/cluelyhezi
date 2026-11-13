(() => {
  const label = document.getElementById('label');
  const dot = document.getElementById('dot');
  const render = status => {
    const state = status?.state || 'OFF';
    document.body.dataset.state = state;
    dot.textContent = state === 'ERROR' ? '!' : '';
    label.textContent = state === 'LISTENING' ? 'Listening'
      : state === 'STARTING' ? 'Starting…'
        : state === 'STOPPING' ? 'Stopping…'
          : state === 'ERROR' ? 'Audio Error'
            : 'Not Listening';
    label.title = status?.error || '';
    document.title = `Listening status: ${state}`;
    label.setAttribute('aria-label', label.textContent);
  };
  window.electronAPI?.onListeningStatus?.(render);
  window.electronAPI?.getListeningStatus?.().then(render).catch(() => render({ state: 'ERROR' }));
})();

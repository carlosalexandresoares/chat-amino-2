export function initializeMentions(state) {
  const input = document.getElementById('chat-dig');
  const list = document.getElementById('mention-suggestions');
  let timer;
  let sequence = 0;
  const close = () => { list.replaceChildren(); list.classList.add('hidden'); };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const before = input.value.slice(0, input.selectionStart);
    const match = before.match(/(?:^|\s)@([\p{L}\p{N}_]{2,100})$/u);
    if (!match || !state.roomId) { close(); return; }
    const requestId = ++sequence;
    timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/chat/rooms/${encodeURIComponent(state.roomId)}/mentions?search=${encodeURIComponent(match[1])}`,
          { headers: { Authorization: `Bearer ${state.token}` } });
        if (!response.ok) return close();
        const { users } = await response.json(); if (requestId !== sequence) return;
        list.replaceChildren();
        for (const user of users) {
          const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'option');
          button.textContent = user.username;
          button.addEventListener('click', () => {
            const start = input.selectionStart - match[1].length - 1;
            const mention = /^[\p{L}\p{N}_]+$/u.test(user.username) ? `@${user.username}` : `@{${user.username}}`;
            input.setRangeText(`${mention} `, start, input.selectionStart, 'end');
            close(); input.focus();
          });
          list.append(button);
        }
        list.classList.toggle('hidden', !users.length);
      } catch { close(); }
    }, 180);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
    if (event.key === 'Enter' && !list.classList.contains('hidden')) {
      event.preventDefault(); list.querySelector('button')?.click();
    }
  });
  document.addEventListener('click', event => { if (!event.target.closest('#mention-suggestions, #chat-dig')) close(); });
}

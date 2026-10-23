import state from './state.js';

const $ = id => document.getElementById(id);
let reportTarget = null;
let tab = 'reports';
let page = 1;
let revision = 0;
let canModerate = false;

async function request(path, method = 'GET', body) {
  const response = await fetch(`/api/moderation${path}`, { method,
    headers: { Authorization: `Bearer ${state.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Não foi possível concluir a ação.');
  return data;
}

export function reportContent(kind, targetId) {
  reportTarget = { kind, targetId };
  $('content-report-target').textContent = ({ ROOM: 'Comunidade', MESSAGE: 'Mensagem',
    STICKER: 'Figurinha', POST: 'Publicação' })[kind] || 'Conteúdo';
  $('content-report-details').value = '';
  $('content-report-status').textContent = '';
  $('content-report-dialog').showModal();
}

export function setModerationMembers(members) {
  const select = $('moderation-user-id');
  const previous = select.value;
  select.replaceChildren(new Option('Escolha um participante', ''));
  for (const member of members) if (member.user.id !== state.currentUser?.id)
    select.add(new Option(`${member.user.username} · ${member.role === 'CO_ADMIN' ? 'Coadmin' : 'Membro'}`,
      member.user.id));
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}

const button = (label, callback) => {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = label;
  node.addEventListener('click', callback); return node;
};

function reportCard(report) {
  const card = document.createElement('article'); card.className = 'moderation-card';
  const title = document.createElement('strong'); title.textContent =
    `${report.kind} · ${report.reason} · ${report.room?.name || 'Plataforma'}`;
  const evidence = document.createElement('p'); evidence.textContent = report.evidence || report.targetId;
  const meta = document.createElement('small'); meta.textContent =
    `${report.reporter?.username || 'Conta excluída'} · ${new Date(report.createdAt).toLocaleString('pt-BR')}`;
  card.append(title, evidence, meta);
  if (report.details) {
    const details = document.createElement('p'); details.textContent = report.details; card.append(details);
  }
  if (report.subjectUserId && report.status === 'OPEN') card.append(button('Agir sobre participante', () => {
    $('moderation-user-id').value = report.subjectUserId;
    $('moderation-action-form').scrollIntoView({ block: 'center', behavior: 'smooth' });
  }));
  if (report.status === 'OPEN' && ['MESSAGE', 'POST'].includes(report.kind) && report.subjectUserId)
    card.append(button('Remover conteúdo', async () => {
      const reason = prompt('Motivo da remoção (mínimo 3 caracteres):');
      if (!reason) return;
      try {
        await request(`/rooms/${encodeURIComponent(state.roomId)}/actions`, 'POST', {
          action: report.kind === 'MESSAGE' ? 'DELETE_MESSAGE' : 'DELETE_POST',
          targetUserId: report.subjectUserId, targetId: report.targetId, reason });
        $('moderation-status').textContent = 'Conteúdo removido. Conclua a denúncia abaixo.';
      } catch (error) { $('moderation-status').textContent = error.message; }
    }));
  if (report.status === 'OPEN') for (const [label, status] of [['Resolver', 'RESOLVED'], ['Descartar', 'DISMISSED']])
    card.append(button(label, async () => {
      const note = prompt('Conclusão para auditoria (mínimo 3 caracteres):');
      if (!note) return;
      try { await request(`/reports/${encodeURIComponent(report.id)}`, 'PATCH', { status, note });
        await load(true); $('moderation-status').textContent = 'Denúncia concluída.';
      } catch (error) { $('moderation-status').textContent = error.message; }
    }));
  return card;
}

async function load(reset = false) {
  if (!canModerate || !state.roomId) return;
  if (reset) { page = 1; revision++; $('moderation-list').replaceChildren(); }
  const currentRevision = revision;
  const currentPage = page;
  $('moderation-more').disabled = true;
  try {
    const query = new URLSearchParams({ roomId: state.roomId, page: String(currentPage) });
    const data = await request(tab === 'sanctions' ? `/rooms/${encodeURIComponent(state.roomId)}/sanctions` :
      `/${tab}?${query}`);
    if (currentRevision !== revision) return;
    const rows = data[tab] || [];
    for (const item of rows) {
      if (tab === 'reports') $('moderation-list').append(reportCard(item));
      else {
        const card = document.createElement('article'); card.className = 'moderation-card';
        card.textContent = tab === 'sanctions' ? `${item.user.username} · ${item.type} até ${new Date(item.expiresAt).toLocaleString('pt-BR')} · ${item.reason}` :
          `${item.actor?.username || 'Conta excluída'} · ${item.action} · ${item.targetUser?.username || item.targetId || ''} · ${item.reason || ''}`;
        $('moderation-list').append(card);
      }
    }
    if (!rows.length && currentPage === 1) $('moderation-list').textContent = 'Nenhum registro nesta seção.';
    $('moderation-more').classList.toggle('hidden', !data.hasMore || tab === 'sanctions');
    page++;
  } catch (error) { $('moderation-status').textContent = error.message; }
  finally { $('moderation-more').disabled = false; }
}

export function initializeModeration() {
  document.querySelectorAll('[data-report-room]').forEach(item => item.addEventListener('click', () =>
    reportContent('ROOM', state.roomId)));
  $('content-report-send').addEventListener('click', async () => {
    const send = $('content-report-send'); send.disabled = true;
    try {
      await request('/reports', 'POST', { ...reportTarget, reason: $('content-report-reason').value,
        details: $('content-report-details').value });
      $('content-report-dialog').close();
      window.alert('Denúncia enviada. A equipe irá analisá-la.');
    } catch (error) { $('content-report-status').textContent = error.message; }
    finally { send.disabled = false; }
  });
  document.querySelectorAll('[data-moderation-tab]').forEach(item => item.addEventListener('click', () => {
    tab = item.dataset.moderationTab;
    document.querySelectorAll('[data-moderation-tab]').forEach(button =>
      button.setAttribute('aria-pressed', String(button === item)));
    $('moderation-status').textContent = ''; void load(true);
  }));
  $('moderation-more').addEventListener('click', () => { void load(); });
  $('moderation-action-form').addEventListener('submit', async event => {
    event.preventDefault();
    const send = event.currentTarget.querySelector('button[type=submit]'); send.disabled = true;
    try {
      await request(`/rooms/${encodeURIComponent(state.roomId)}/actions`, 'POST', {
        targetUserId: $('moderation-user-id').value.trim(), action: $('moderation-action').value,
        durationMinutes: Number($('moderation-duration').value), reason: $('moderation-reason').value.trim() });
      $('moderation-status').textContent = 'Ação registrada.';
      $('moderation-reason').value = ''; void load(true);
    } catch (error) { $('moderation-status').textContent = error.message; }
    finally { send.disabled = false; }
  });
  state.socket.on('room-permissions', ({ roomId, role }) => {
    if (roomId !== state.roomId) return;
    canModerate = ['OWNER', 'CO_ADMIN'].includes(role);
    if (canModerate) void load(true);
  });
}

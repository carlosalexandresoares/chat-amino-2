import state from './state.js';

const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('pt-BR');
let shownLiveId = null;
let currentReportId = null;
let reportPage = 1;
let pendingRequestId = null;
let confirmationTimer = null;

async function api(path, options = {}) {
  const response = await fetch(`/api/projections${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${state.token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Não foi possível carregar a projeção.');
  return data;
}

function renderHostRep(rep) {
  if (!rep) return;
  $('host-rep-progress').textContent = rep.progress;
  $('host-rep-orb').style.background = `conic-gradient(#ffac62 ${rep.progress * 4}%, #50355f 0)`;
  $('host-rep-today').textContent = `${rep.todayAccrued} / 250 REP hoje`;
  $('host-rep-pending').textContent = `${rep.pending} REP pendente${rep.todayCollected ? ` · ${rep.todayCollected} coletados hoje` : ''}`;
  $('host-rep-collect').textContent = rep.collectable ? `Coletar ${rep.collectable} REP` : 'Coletar REP';
  $('host-rep-collect').disabled = !rep.collectable || rep.status !== 'ACTIVE';
}

export function syncProjectionUi() {
  const active = state.liveActive && Boolean(state.currentLiveId);
  $('host-rep-widget').classList.toggle('hidden', !active || !state.isLiveHost);
  $('viewer-rep-widget').classList.toggle('hidden', !active || state.isLiveHost);
  if (!active) { shownLiveId = null; return; }
  if (state.isLiveHost && shownLiveId !== state.currentLiveId) {
    shownLiveId = state.currentLiveId;
    api(`/${shownLiveId}`).then(data => renderHostRep(data.report.hostRep))
      .catch(error => console.error('Erro ao carregar REP do host:', error));
  }
}

function card(label, value) {
  const element = document.createElement('div'); element.className = 'projection-stat';
  const strong = document.createElement('strong'); strong.textContent = value;
  const span = document.createElement('span'); span.textContent = label;
  element.append(strong, span); return element;
}
function duration(seconds) {
  const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}min` : `${minutes}min`;
}
function renderReport(report) {
  currentReportId = report.id;
  const start = new Date(report.startedAt).toLocaleString('pt-BR');
  const end = report.endedAt ? new Date(report.endedAt).toLocaleString('pt-BR') : 'Em andamento';
  $('projection-report-meta').textContent = `${report.roomName} · Host: ${report.hostName} · Início: ${start} · Encerramento: ${end}`;
  $('projection-report-stats').replaceChildren(
    card('Visitantes únicos', number.format(report.uniqueVisitors)),
    card('Pico simultâneo', number.format(report.peakParticipants)),
    card('Duração total', duration(report.durationSeconds)),
    card('Mensagens no chat', number.format(report.messageCount)),
    card('REP dos participantes', number.format(report.participantRepGranted)),
  );
  $('projection-host-section').classList.toggle('hidden', !report.isHost);
  if (report.isHost) {
    const rep = report.hostRep;
    $('projection-host-values').textContent = `REP acumulado: ${rep.accrued} · REP já coletado: ${rep.collected} · REP pendente: ${rep.pending}`;
    const button = $('projection-report-collect');
    button.textContent = rep.collectable ? `Coletar ${rep.collectable} REP` :
      rep.pending ? 'Coleta indisponível' : 'Toda a reputação foi coletada';
    button.disabled = !rep.collectable;
    if (rep.pending && !rep.collectable) $('projection-collect-message').textContent = rep.status === 'ACTIVE' && rep.pending < 25
      ? 'A próxima coleta estará disponível ao acumular 25 REP.'
      : 'Limite diário atingido. O saldo permanece disponível para outro dia.';
    else if (!rep.pending) $('projection-collect-message').textContent = 'Toda a reputação foi coletada.';
  }
}
async function openReport(id) {
  try {
    if (currentReportId !== id) {
      pendingRequestId = null;
      $('projection-collect-message').textContent = '';
    }
    const data = await api(`/${encodeURIComponent(id)}`);
    renderReport(data.report);
    if (!$('projection-report-dialog').open) $('projection-report-dialog').showModal();
  } catch (error) { window.alert(error.message); }
}

async function collect(id, button) {
  if (!id || button.disabled) return;
  button.disabled = true;
  pendingRequestId ||= crypto.randomUUID();
  try {
    const data = await api(`/${encodeURIComponent(id)}/collect`, {
      method: 'POST', body: JSON.stringify({ requestId: pendingRequestId }),
    });
    pendingRequestId = null;
    if (data.hostRep && id === state.currentLiveId) renderHostRep(data.hostRep);
    $('projection-collect-message').textContent = data.granted ? `${data.granted} REP coletados e adicionados ao seu XP.` :
      data.duplicate ? 'Esta coleta já foi registrada.' : 'Não há REP disponível para coletar agora.';
    if ($('projection-report-dialog').open) {
      const message = $('projection-collect-message').textContent;
      await openReport(id);
      $('projection-collect-message').textContent = message;
    }
  } catch (error) { $('projection-collect-message').textContent = error.message; button.disabled = false; }
}

async function loadReports(reset = false) {
  if (reset) { reportPage = 1; $('projection-list').replaceChildren(); }
  try {
    const data = await api(`/mine?page=${reportPage}`);
    if (!data.projections.length && reportPage === 1) $('projection-list').textContent = 'Você ainda não hospedou uma projeção.';
    for (const item of data.projections) {
      const button = document.createElement('button'); button.type = 'button';
      const title = document.createElement('strong'); title.textContent = item.roomName;
      const details = document.createElement('small'); details.textContent = `${new Date(item.startedAt).toLocaleString('pt-BR')} · ${item.status === 'ACTIVE' ? 'Em andamento' : 'Encerrada'} · ${item.pending} REP pendente`;
      button.append(title, details);
      button.addEventListener('click', () => { $('projection-list-dialog').close(); openReport(item.id); });
      $('projection-list').append(button);
    }
    $('projection-list-more').classList.toggle('hidden', !data.hasMore);
    reportPage += 1;
  } catch (error) { $('projection-list').textContent = error.message; }
}

export function initializeProjectionUi() {
  $('projection-reports-button').addEventListener('click', () => {
    $('projection-list-dialog').showModal(); loadReports(true);
  });
  $('projection-list-more').addEventListener('click', () => loadReports());
  $('projection-list-close').addEventListener('click', () => $('projection-list-dialog').close());
  $('projection-report-close').addEventListener('click', () => $('projection-report-dialog').close());
  $('host-rep-collect').addEventListener('click', () => collect(state.currentLiveId, $('host-rep-collect')));
  $('projection-report-collect').addEventListener('click', () => collect(currentReportId, $('projection-report-collect')));
  $('viewer-rep-confirm').addEventListener('click', () => {
    const button = $('viewer-rep-confirm'); button.disabled = true;
    state.socket.emit('projection-confirm', { roomId: state.roomId }, response => {
      if (!response?.success) { button.disabled = false; $('viewer-rep-message').textContent = response?.message || 'Não foi possível confirmar presença.'; return; }
      $('viewer-rep-message').textContent = 'Presença confirmada. O REP será creditado automaticamente enquanto a projeção estiver válida.';
      button.textContent = 'Presença confirmada';
      clearTimeout(confirmationTimer);
      confirmationTimer = setTimeout(() => {
        button.disabled = false; button.textContent = 'Confirmar novamente';
        $('viewer-rep-message').textContent = 'Confirme sua presença novamente para continuar ganhando REP.';
      }, Math.max(0, 10 * 60 * 1000 - (Date.now() - new Date(response.confirmedAt).getTime())));
    });
  });
  state.socket.on('projection-rep', payload => {
    if (payload?.liveId === state.currentLiveId && state.isLiveHost) renderHostRep(payload.hostRep);
  });
  state.socket.on('disconnect', () => {
    clearTimeout(confirmationTimer);
    $('viewer-rep-confirm').disabled = false;
    $('viewer-rep-confirm').textContent = 'Estou assistindo';
    $('viewer-rep-message').textContent = 'Reconecte-se e confirme sua presença para continuar recebendo REP.';
  });
}

export function onProjectionEnded(id, wasHost) {
  clearTimeout(confirmationTimer);
  $('viewer-rep-confirm').disabled = false;
  $('viewer-rep-confirm').textContent = 'Estou assistindo';
  if (wasHost && id) openReport(id);
}

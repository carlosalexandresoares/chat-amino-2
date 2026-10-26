import state from "./state.js";
import { loadAuthenticatedUser } from "./auth.js?v=2";
import { initializeChat } from "./chat.js?v=14";
import { initializeYouTube, stopTimeUpdater } from "./youtube.js?v=10";
import { initializeLive } from "./live.js?v=10";
import { initializeMiniPlayer, openSitePage } from './mini-player.js?v=9';
import { initializeMentions } from './mentions.js?v=1';
import { initializeCommunity, loadDiscover, loadTopics } from './community.js?v=6';
import { initializeVoice } from './voice.js?v=1';
import { initializeModeration, setModerationMembers } from './moderation-ui.js?v=2';

const roomsScreen = document.getElementById("rooms-screen");
const appScreen = document.getElementById("app-screen");
const grid = document.getElementById("public-rooms-grid");
const roomTitle = document.getElementById("current-room-title");
const membersCount = document.getElementById("room-members-count");
const onlineCount = document.getElementById("room-online-count");
const form = document.getElementById("create-room-form");
const errorMessage = document.getElementById("create-room-error");
const manageButton = document.getElementById("manage-room");
const managePanel = document.getElementById("manage-room-panel");
const manageForm = document.getElementById("manage-room-form");
const manageMembers = document.getElementById("manage-room-members");
const manageMessage = document.getElementById("manage-room-message");
const roomsById = new Map();
const roomInfoDialog = document.getElementById("room-info-dialog");
const roomOptionsToggle = document.getElementById("room-options-toggle");
const roomOptionsMenu = document.getElementById("room-options-menu");
const roomVoiceToggle = document.getElementById("room-voice-toggle");
const voiceSection = document.getElementById("voice-section");
const projectionsTab = document.getElementById("mobile-projections-tab");
const connectionStatus = document.getElementById("chat-connection-status");
window.ChatNotificationBadge?.attachSocket(state.socket);

function closeRoomOptions() {
  roomOptionsMenu.classList.add("hidden");
  roomOptionsToggle.setAttribute("aria-expanded", "false");
}

roomOptionsToggle.addEventListener("click", () => {
  const open = roomOptionsMenu.classList.toggle("hidden") === false;
  roomOptionsToggle.setAttribute("aria-expanded", String(open));
  if (open) roomOptionsMenu.querySelector('[role="menuitem"]:not(.hidden)')?.focus();
});
roomOptionsMenu.addEventListener("click", (event) => {
  if (event.target.closest('button[role="menuitem"]')) closeRoomOptions();
});
roomVoiceToggle.addEventListener("click", () => {
  voiceSection.open = !voiceSection.open;
  if (voiceSection.open) voiceSection.scrollIntoView({ block: "nearest" });
});
voiceSection.addEventListener("toggle", () => {
  roomVoiceToggle.setAttribute("aria-expanded", String(voiceSection.open));
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".mobile-header-actions")) closeRoomOptions();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !roomOptionsMenu.classList.contains("hidden")) {
    closeRoomOptions();
    roomOptionsToggle.focus();
  }
});
document.querySelectorAll("[data-room-action]").forEach((item) => {
  item.addEventListener("click", () => {
    closeRoomOptions();
    document.getElementById(item.dataset.roomAction)?.click();
  });
});

async function openRoomInfo() {
  const room = roomsById.get(state.roomId);
  document.getElementById("room-info-title").textContent = room?.name || "Informações da sala";
  document.getElementById("room-info-description").textContent = room?.description || "Converse e participe desta comunidade.";
  document.getElementById("room-info-counts").textContent = `${membersCount.textContent} · ${onlineCount.textContent}`;
  const list = document.getElementById("room-info-members");
  list.textContent = "Carregando participantes...";
  roomInfoDialog.showModal();
  try {
    const { members } = await roomRequest(`/api/rooms/${encodeURIComponent(state.roomId)}/members`);
    list.replaceChildren();
    for (const member of members) {
      const row = document.createElement("div");
      row.className = "room-info-member";
      const avatar = document.createElement("span");
      avatar.className = "room-info-avatar";
      if (member.user.avatar) {
        const image = document.createElement("img");
        image.src = member.user.avatar;
        image.alt = "";
        avatar.append(image);
      } else avatar.textContent = member.user.username.charAt(0).toUpperCase();
      const name = document.createElement("span");
      name.textContent = member.user.username;
      const role = document.createElement("small");
      role.textContent = member.role === "OWNER" ? "Criador" : member.role === "CO_ADMIN" ? "Coadmin" : "Membro";
      row.append(avatar, name, role);
      list.append(row);
    }
  } catch (error) { list.textContent = error.message; }
}
document.getElementById("room-info-open").addEventListener("click", openRoomInfo);
document.getElementById("room-info-close").addEventListener("click", () => roomInfoDialog.close());
projectionsTab.addEventListener("click", () => {
  const expanded = appScreen.classList.toggle("mobile-projections-open");
  projectionsTab.setAttribute("aria-expanded", String(expanded));
  projectionsTab.classList.toggle("active", expanded);
  appScreen.querySelector('.mobile-bottom-nav a[aria-current]')?.removeAttribute("aria-current");
  if (!expanded) appScreen.querySelector('.mobile-bottom-nav a[href="/index.html"]')?.setAttribute("aria-current", "page");
  if (expanded && state.liveActive) {
    const details = document.getElementById("toggle-live-details");
    if (details.getAttribute("aria-expanded") !== "true") details.click();
    const player = document.getElementById("youtube-container");
    if (!player.classList.contains("active")) document.getElementById("toggle-player").click();
  }
});

function syncMobileViewport() {
  if (!window.visualViewport) return;
  document.documentElement.style.setProperty("--mobile-viewport-height", `${window.visualViewport.height}px`);
  const keyboardOpen = window.innerHeight - window.visualViewport.height > 140;
  document.body.classList.toggle("mobile-keyboard-open", keyboardOpen);
}
window.visualViewport?.addEventListener("resize", syncMobileViewport);
window.addEventListener("resize", syncMobileViewport);
syncMobileViewport();

async function roomRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${state.token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Não foi possível completar a ação.");
  return data;
}

function enterRoom(roomId) {
  if (window !== window.top) {
    try {
      const shell = window.parent.document.getElementById('site-view');
      if (shell && !shell.classList.contains('hidden') && shell.querySelector('iframe')?.contentWindow === window) {
        window.parent.postMessage({ type: 'floating-enter-room', roomId }, window.location.origin);
        return;
      }
    } catch { /* Navegação normal em incorporações de outras origens. */ }
  }
  const url = new URL(window.location.href);
  url.searchParams.set("sala", roomId);
  if (window !== window.top) url.searchParams.set('floatingGuest', '1');
  window.location.href = `${url.pathname}${url.search}`;
}

function showRoomsScreen() {
  document.body.classList.add("rooms-mode");
  roomsScreen.classList.remove("hidden");
  appScreen.classList.add("hidden");
  document.title = "Comunidades | Purp";
  syncRoomsNavigation();
}

function syncRoomsNavigation() {
  const communities = window.location.hash === "#communities";
  const chatsLink = document.querySelector('.rooms-bottom-nav a[href="/index.html"]');
  const communitiesLink = document.querySelector('.rooms-bottom-nav a[href="/index.html#communities"]');
  chatsLink.toggleAttribute("aria-current", !communities);
  communitiesLink.toggleAttribute("aria-current", communities);
  if (!communities) chatsLink.setAttribute("aria-current", "page");
  else communitiesLink.setAttribute("aria-current", "page");
  if (communities) requestAnimationFrame(() => document.getElementById("communities").scrollIntoView({ block: "start", behavior: "instant" }));
}
window.addEventListener("hashchange", syncRoomsNavigation);

function updateRoomStats(room) {
  const count = room.membersCount ?? 0;
  membersCount.textContent = `${count} ${count === 1 ? 'participante' : 'participantes'}`;
  onlineCount.textContent = `${room.onlineCount ?? 0} online agora`;
}

function showChatScreen(room) {
  document.querySelectorAll('.room-events-link').forEach(link => {
    link.href = `/events.html?roomId=${encodeURIComponent(state.roomId || room.id || 'geral')}`;
  });
  document.body.classList.remove("rooms-mode");
  roomsScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  roomTitle.textContent = `${room.category || "💬"} ${room.name}`;
  updateRoomStats(room);
  document.title = `${room.name} | Purp`;
  if (window.location.hash === "#projections" && !appScreen.classList.contains("mobile-projections-open")) projectionsTab.click();
}

async function loadRooms() {
  try {
    if (state.roomId) {
      const response = await fetch(`/api/rooms/${encodeURIComponent(state.roomId)}/summary`, {
        headers: { Authorization: `Bearer ${state.token}` },
      });
      if (response.status === 404) {
        state.roomId = null;
        showRoomsScreen();
        void loadDiscover();
        return;
      }
      if (!response.ok) throw new Error('Não foi possível carregar o chat.');
      const { room } = await response.json();
      roomsById.set(room.id, room);
      showChatScreen(room);
    } else { showRoomsScreen(); void loadDiscover(); }
  } catch (error) {
    grid.textContent = error.message;
    if (state.roomId) {
      showChatScreen({ name: "Chat", category: "💬", membersCount: 0, onlineCount: 0 });
    } else showRoomsScreen();
  }
}

function renderMembers(members, role) {
  manageMembers.replaceChildren();
  for (const member of members) {
    const row = document.createElement("div");
    row.className = "manage-member";
    const name = document.createElement("span");
    name.textContent = member.user.username;
    const badge = document.createElement("small");
    badge.textContent = member.role === "OWNER" ? (state.roomId === "geral" ? "Administrador" : "Criador") :
      member.role === "CO_ADMIN" ? "Coadmin" : "Membro";
    row.append(name, badge);
    const actions = document.createElement("div");
    actions.className = "manage-member-actions";
    if (role === "OWNER" && member.role !== "OWNER") {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = member.role === "CO_ADMIN" ? "Remover coadmin" : "Tornar coadmin";
      button.addEventListener("click", async () => {
        button.disabled = true;
        manageMessage.textContent = "";
        try {
          await roomRequest(
            `/api/rooms/${encodeURIComponent(state.roomId)}/members/${encodeURIComponent(member.user.id)}/role`,
            { method: "PATCH", body: JSON.stringify({ role: member.role === "CO_ADMIN" ? "MEMBER" : "CO_ADMIN" }) }
          );
          await loadAdmin();
        } catch (error) {
          manageMessage.textContent = error.message;
          button.disabled = false;
        }
      });
      actions.append(button);
    }
    const canRemove = member.user.id !== state.currentUser?.id &&
      member.role !== "OWNER" && (role === "OWNER" || member.role === "MEMBER");
    if (canRemove) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "remove-member";
      removeButton.textContent = "Remover do chat";
      removeButton.addEventListener("click", async () => {
        if (!window.confirm(`Remover ${member.user.username} deste chat?`)) return;
        removeButton.disabled = true;
        manageMessage.textContent = "";
        try {
          await roomRequest(
            `/api/rooms/${encodeURIComponent(state.roomId)}/members/${encodeURIComponent(member.user.id)}`,
            { method: "DELETE" }
          );
          await loadAdmin();
          manageMessage.textContent = `${member.user.username} foi removido do chat.`;
        } catch (error) {
          manageMessage.textContent = error.message;
          removeButton.disabled = false;
        }
      });
      actions.append(removeButton);
    }
    if (actions.childElementCount) row.append(actions);
    manageMembers.append(row);
  }
}

async function loadAdmin() {
  const { room, role, members } = await roomRequest(
    `/api/rooms/${encodeURIComponent(state.roomId)}/admin`
  );
  document.getElementById("manage-room-name").value = room.name;
  document.getElementById("manage-room-description").value = room.description || "";
  document.getElementById("manage-room-banner").value = room.banner || "";
  document.getElementById("manage-room-topic").value = room.topic || 'GERAL';
  renderMembers(members, role);
  setModerationMembers(members);
  document.getElementById("manage-members-section").classList.remove("hidden");
}

manageButton.addEventListener("click", async () => {
  manageMessage.textContent = "";
  try {
    await loadAdmin();
    managePanel.classList.remove("hidden");
  } catch (error) {
    manageMessage.textContent = error.message;
    managePanel.classList.remove("hidden");
  }
});
document.getElementById("close-manage-room").addEventListener("click", () => {
  managePanel.classList.add("hidden");
});
manageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = manageForm.querySelector('[type="submit"]');
  button.disabled = true;
  manageMessage.textContent = "";
  try {
    await roomRequest(`/api/rooms/${encodeURIComponent(state.roomId)}`, {
      method: "PATCH",
      body: JSON.stringify(Object.fromEntries(new FormData(manageForm))),
    });
    manageMessage.textContent = "Chat atualizado com sucesso.";
  } catch (error) {
    manageMessage.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.getElementById("show-create-room").addEventListener("click", () => {
  form.classList.remove("hidden");
  document.getElementById("room-name").focus();
});
document.getElementById("cancel-create-room").addEventListener("click", () => {
  form.reset();
  form.classList.add("hidden");
  errorMessage.textContent = "";
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorMessage.textContent = "";
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.token}` },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Não foi possível criar o chat.");
    enterRoom(data.room.id);
  } catch (error) {
    errorMessage.textContent = error.message;
    submit.disabled = false;
  }
});

document.getElementById("leave-room").addEventListener("click", () => {
  if (openSitePage('/index.html')) return;
  stopTimeUpdater();
  state.socket.disconnect();
  const url = new URL(window.location.href);
  url.searchParams.delete("sala");
  window.location.href = url.pathname;
});

initializeChat();
initializeMentions(state);
initializeYouTube();
initializeMiniPlayer();
initializeLive();
initializeCommunity();
initializeVoice();
initializeModeration();

state.socket.on("connect", () => {
  connectionStatus.textContent = "";
  connectionStatus.classList.add("hidden");
  if (state.roomId) state.socket.emit("join-room", state.roomId);
});
state.socket.on("room-presence", ({ roomId, onlineCount: count }) => {
  const room = roomsById.get(roomId);
  if (!room) return;
  room.onlineCount = count;
  if (state.roomId === roomId) updateRoomStats(room);
});
state.socket.on("room-members-count", ({ roomId, membersCount: count }) => {
  const room = roomsById.get(roomId);
  if (!room) return;
  room.membersCount = count;
  if (state.roomId === roomId) updateRoomStats(room);
});
state.socket.on("room-permissions", ({ roomId, role }) => {
  if (roomId === state.roomId) {
    manageButton.classList.toggle("hidden", !["OWNER", "CO_ADMIN"].includes(role));
    document.querySelector('[data-room-action="manage-room"]').classList.toggle("hidden", !["OWNER", "CO_ADMIN"].includes(role));
    if (!["OWNER", "CO_ADMIN"].includes(role)) managePanel.classList.add("hidden");
  }
});
state.socket.on("room-updated", (updated) => {
  const room = roomsById.get(updated.id);
  if (room) {
    Object.assign(room, updated);
    if (state.roomId === updated.id) showChatScreen(room);
  }
});
state.socket.on("room-removed", ({ roomId, message }) => {
  if (roomId !== state.roomId) return;
  stopTimeUpdater();
  state.socket.disconnect();
  window.alert(message || "Você foi removido deste chat.");
  window.location.replace("/index.html");
});
state.socket.on("disconnect", stopTimeUpdater);
state.socket.on('account-deleted', payload => {
  localStorage.removeItem('authToken');
  window.alert(payload?.message || 'Sua conta foi excluída.');
  window.location.replace('/login.html');
});
state.socket.on("connect_error", (error) => {
  if (!state.roomId) return;
  if (error.data?.code === 'AUTH_INVALID') {
    localStorage.removeItem('authToken');
    window.location.replace('/login.html');
    return;
  }
  connectionStatus.textContent = error.message || 'Não foi possível conectar ao chat. Tentando novamente...';
  connectionStatus.classList.remove('hidden');
});

loadTopics().catch(error => console.error('Falha ao carregar categorias:', error)).then(loadRooms).then(loadAuthenticatedUser).then(() => {
  document.querySelectorAll('.site-admin-link').forEach(link => link.classList.toggle('hidden', !state.currentUser?.isSiteAdmin));
});
window.setInterval(() => {
  if (!state.roomId && document.visibilityState === "visible") loadRooms();
}, 15000);

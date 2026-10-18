import state from "./state.js";
import { loadAuthenticatedUser } from "./auth.js";
import { initializeChat } from "./chat.js";
import { initializeYouTube, stopTimeUpdater } from "./youtube.js";
import { initializeLive } from "./live.js";

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
  const url = new URL(window.location.href);
  url.searchParams.set("sala", roomId);
  window.location.href = `${url.pathname}${url.search}`;
}

function showRoomsScreen() {
  document.body.classList.add("rooms-mode");
  roomsScreen.classList.remove("hidden");
  appScreen.classList.add("hidden");
  document.title = "Chats públicos | Chat Amino 2";
}

function updateRoomStats(room) {
  membersCount.textContent = `${room.membersCount ?? 0} participantes`;
  onlineCount.textContent = `${room.onlineCount ?? 0} online agora`;
}

function showChatScreen(room) {
  document.body.classList.remove("rooms-mode");
  roomsScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  roomTitle.textContent = `${room.category || "💬"} ${room.name}`;
  updateRoomStats(room);
  document.title = `${room.name} | Chat Amino 2`;
}

function roomCard(room) {
  const card = document.createElement("article");
  card.className = `public-room-card${room.isMain ? " main-room-card" : ""}`;
  const cover = document.createElement("div");
  cover.className = "public-room-cover";
  if (room.banner) cover.style.backgroundImage = `url("${room.banner.replaceAll('"', '%22')}")`;
  else cover.textContent = room.category || "💬";
  const body = document.createElement("div");
  body.className = "public-room-information";
  const title = document.createElement("h2");
  title.textContent = room.name;
  if (room.isMain) {
    const badge = document.createElement("span");
    badge.className = "main-room-badge";
    badge.textContent = "Chat principal";
    title.append(" ", badge);
  }
  const description = document.createElement("p");
  description.textContent = room.description || "Entre e participe da conversa.";
  const counts = document.createElement("p");
  counts.className = "room-card-counts";
  counts.textContent = `${room.membersCount} participantes · ${room.onlineCount} online agora`;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "enter-room-button";
  button.textContent = "Entrar";
  button.addEventListener("click", () => enterRoom(room.id));
  body.append(title, description, counts, button);
  card.append(cover, body);
  return card;
}

async function loadRooms() {
  try {
    const response = await fetch("/api/rooms", {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    if (!response.ok) throw new Error("Não foi possível carregar os chats.");
    const { rooms } = await response.json();
    roomsById.clear();
    grid.replaceChildren();
    for (const room of rooms) {
      roomsById.set(room.id, room);
      grid.append(roomCard(room));
    }
    if (rooms.length === 1) {
      const discover = document.createElement("div");
      discover.className = "discover-card";
      const icon = document.createElement("span");
      icon.textContent = "✳";
      const title = document.createElement("h3");
      title.textContent = "O próximo chat pode ser seu.";
      const copy = document.createElement("p");
      copy.textContent = "Crie um espaço para a sua comunidade e escolha quem ajuda a cuidar dele.";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Criar meu chat ↗";
      button.addEventListener("click", () => {
        document.getElementById("show-create-room").click();
        form.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      discover.append(icon, title, copy, button);
      grid.append(discover);
    }
    document.getElementById("rooms-total").textContent =
      `${rooms.length} ${rooms.length === 1 ? "chat disponível" : "chats disponíveis"}`;
    if (state.roomId) {
      const selected = roomsById.get(state.roomId);
      if (selected) showChatScreen(selected);
      else {
        state.roomId = null;
        showRoomsScreen();
      }
    } else showRoomsScreen();
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
  renderMembers(members, role);
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
  stopTimeUpdater();
  state.socket.disconnect();
  const url = new URL(window.location.href);
  url.searchParams.delete("sala");
  window.location.href = url.pathname;
});

initializeChat();
initializeYouTube();
initializeLive();

state.socket.on("connect", () => {
  if (state.roomId) state.socket.emit("join-room", state.roomId);
  else state.socket.disconnect();
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
state.socket.on("connect_error", (error) => {
  if (state.roomId) alert(`Erro ao conectar ao chat: ${error.message}`);
});

loadRooms().then(loadAuthenticatedUser);
window.setInterval(() => {
  if (!state.roomId && document.visibilityState === "visible") loadRooms();
}, 15000);

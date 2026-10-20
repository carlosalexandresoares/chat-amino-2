import state from "./state.js";
import dom from "./dom.js";
import { initializeRichChat, enhanceMessage, replyToId, clearReply } from './chat-rich.js?v=6';

/*
  Fila das notificações de XP.

  Evita que vários avisos apareçam
  exatamente no mesmo lugar.
*/
let notificationCounter = 0;

/**
 * Cria o contêiner das notificações,
 * caso ele ainda não exista.
 */
function getNotificationContainer() {
  let container =
    document.querySelector(
      ".xp-notification-container"
    );

  if (container) {
    return container;
  }

  container =
    document.createElement("div");

  container.classList.add(
    "xp-notification-container"
  );

  container.setAttribute(
    "aria-live",
    "polite"
  );

  container.setAttribute(
    "aria-atomic",
    "false"
  );

  document.body.appendChild(
    container
  );

  return container;
}

/**
 * Converte o motivo enviado pelo servidor
 * em um texto amigável.
 */
function getXpReasonText(reason) {
  const reasonTexts = {
    MESSAGE_SENT:
      "Mensagem enviada",

    CHECKIN: "Check-in diário",
    CHAT_PRESENCE: "Participação no chat",
    POST_CREATED: "Publicação criada",
    POST_LIKED: "Curtida recebida",
    POST_FEATURED: "Publicação destacada",
    LIVE_HOST: "REP de apresentador",
    LIVE_VIEWER: "REP por acompanhar projeção",
  };

  return (
    reasonTexts[reason] ||
    "XP recebido"
  );
}

/**
 * Mostra uma notificação animada.
 */
function showXpNotification({
  type = "xp",
  gainedXp = 0,
  reason = "",
  level = 1,
  xp = 0,
  nextLevelXp = 100,
  currentLevelXp = 0,
  ninjaTitle = '',
}) {
  const container =
    getNotificationContainer();

  const notification =
    document.createElement("div");

  notificationCounter += 1;

  notification.dataset.notificationId =
    String(notificationCounter);

  notification.classList.add(
    "xp-notification",
    type === "level"
      ? "level-up-notification"
      : "xp-gain-notification"
  );

  /*
    Conteúdo da notificação
  */
  const icon =
    document.createElement("div");

  icon.classList.add(
    "xp-notification-icon"
  );

  icon.textContent =
    type === "level"
      ? "🏆"
      : "⚡";

  const content =
    document.createElement("div");

  content.classList.add(
    "xp-notification-content"
  );

  const title =
    document.createElement("strong");

  title.classList.add(
    "xp-notification-title"
  );

  const description =
    document.createElement("span");

  description.classList.add(
    "xp-notification-description"
  );

  if (type === "level") {
    title.textContent =
      "LEVEL UP!";

    description.textContent =
      `Parabéns! Você alcançou o nível ${level} — ${ninjaTitle}!`;
  } else {
    title.textContent =
      `+${gainedXp} XP`;

    description.textContent =
      getXpReasonText(reason);
  }

  content.append(
    title,
    description
  );

  notification.append(
    icon,
    content
  );

  /*
    Mostra o progresso para o
    próximo nível nas notificações de XP.
  */
  if (
    type === "xp" &&
    Number.isFinite(xp) &&
    Number.isFinite(nextLevelXp)
  ) {
    const progressArea =
      document.createElement("div");

    progressArea.classList.add(
      "xp-notification-progress-area"
    );

    const progressText =
      document.createElement("span");

    progressText.classList.add(
      "xp-notification-progress-text"
    );

    progressText.textContent =
      `${xp} / ${nextLevelXp} XP`;

    const progressTrack =
      document.createElement("div");

    progressTrack.classList.add(
      "xp-notification-progress-track"
    );

    const progressBar =
      document.createElement("div");

    progressBar.classList.add(
      "xp-notification-progress-bar"
    );

    /*
      XP dentro do nível atual.

      Exemplo:
      112 XP no nível 2
      representa 12% do caminho
      até o nível 3.
    */
    const previousLevelXp = currentLevelXp;

    const xpInsideCurrentLevel =
      Math.max(
        0,
        xp - previousLevelXp
      );

    const requiredXp =
      Math.max(
        1,
        nextLevelXp -
          previousLevelXp
      );

    const progressPercentage =
      Math.min(
        100,
        Math.max(
          0,
          (xpInsideCurrentLevel /
            requiredXp) *
            100
        )
      );

    progressBar.style.width =
      `${progressPercentage}%`;

    progressTrack.appendChild(
      progressBar
    );

    progressArea.append(
      progressText,
      progressTrack
    );

    notification.appendChild(
      progressArea
    );
  }

  container.appendChild(
    notification
  );

  /*
    A classe é aplicada depois que
    o elemento entra na página, para
    ativar a animação de entrada.
  */
  requestAnimationFrame(() => {
    notification.classList.add(
      "show"
    );
  });

  const displayDuration =
    type === "level"
      ? 5000
      : 3000;

  window.setTimeout(() => {
    notification.classList.remove(
      "show"
    );

    notification.classList.add(
      "hide"
    );

    window.setTimeout(() => {
      notification.remove();
    }, 450);
  }, displayDuration);
}

/**
 * Atualiza todos os selos de nível das
 * mensagens do usuário atual.
 */
function updateCurrentUserMessageLevels(
  level
) {
  if (!state.currentUser?.id) {
    return;
  }

  const userId =
    CSS.escape(
      String(state.currentUser.id)
    );

  const userMessages =
    document.querySelectorAll(
      `.message[data-user-id="${userId}"]`
    );

  userMessages.forEach(
    (messageElement) => {
      const levelElement =
        messageElement.querySelector(
          ".message-level"
        );

      if (levelElement) {
        levelElement.textContent =
          `LV ${level}`;
        levelElement.dataset.tier = String(Math.min(4, Math.ceil(level / 5)));
      }
    }
  );
}

function sendMessage() {
  const text =
    dom.input.value.trim();

  if (
    !text ||
    !state.socket.connected
  ) {
    return;
  }

  state.socket.emit(
    "chat-message",
    {
      roomId: state.roomId,
      message: text,
      clientKey: crypto.randomUUID(),
      replyToId: replyToId(),
    }
  );

  dom.input.value = "";
  clearReply();
  dom.input.focus();
}

function addMessage(messageData, { prepend = false } = {}) {
  if (
    !messageData?.user ||
    (!messageData?.message && !['AUDIO', 'STICKER'].includes(messageData?.type))
  ) {
    return;
  }
  if ([...dom.messages.querySelectorAll('.message')].some(element => element.dataset.messageId === messageData.id)) return;

  const isCurrentUser =
    state.currentUser &&
    messageData.user.id ===
      state.currentUser.id;

  const messageElement =
    document.createElement("div");

  messageElement.classList.add(
    "message",
    isCurrentUser
      ? "user"
      : "bot"
  );

  messageElement.dataset.messageId =
    messageData.id;
  if (messageData.replyToId) messageElement.dataset.replyToId = messageData.replyToId;

  /*
    Permite atualizar os níveis de todas
    as mensagens desse usuário depois.
  */
  messageElement.dataset.userId =
    messageData.user.id;

  const headerElement =
    document.createElement("div");

  headerElement.classList.add(
    "message-header"
  );

  const avatarElement =
    document.createElement("div");

  avatarElement.classList.add(
    "message-avatar"
  );

  if (messageData.user.avatar) {
    const avatarImage =
      document.createElement("img");

    avatarImage.src =
      messageData.user.avatar;

    avatarImage.alt =
      `Avatar de ${messageData.user.username}`;

    avatarElement.appendChild(
      avatarImage
    );
  } else {
    avatarElement.textContent =
      messageData.user.username
        .charAt(0)
        .toUpperCase();
  }

  const userInfoElement =
    document.createElement("div");

  userInfoElement.classList.add(
    "message-user-info"
  );

  const usernameElement =
    document.createElement("a");

  usernameElement.classList.add(
    "message-username"
  );

  usernameElement.textContent =
    messageData.user.username;
  usernameElement.href =
    `/perfil.html?id=${encodeURIComponent(messageData.user.id)}`;

  const levelElement =
    document.createElement("a");

  levelElement.classList.add(
    "message-level"
  );

  levelElement.textContent =
    `LV ${messageData.user.level}`;
  levelElement.title = messageData.user.title || `Nível ${messageData.user.level}`;
  levelElement.href = usernameElement.href;
  levelElement.dataset.tier = String(Math.min(4, Math.ceil(messageData.user.level / 5)));

  userInfoElement.append(
    usernameElement,
    levelElement
  );

  const timeElement =
    document.createElement("time");

  timeElement.classList.add(
    "message-time"
  );

  const createdAt =
    new Date(
      messageData.createdAt
    );

  timeElement.dateTime =
    messageData.createdAt;

  timeElement.textContent =
    Number.isNaN(createdAt.getTime())
      ? ""
      : createdAt.toLocaleTimeString(
          "pt-BR",
          {
            hour: "2-digit",
            minute: "2-digit",
          }
        );

  headerElement.append(
    avatarElement,
    userInfoElement,
    timeElement
  );

  const textElement =
    document.createElement("div");

  textElement.classList.add(
    "message-text"
  );

  textElement.textContent =
    messageData.message;

  messageElement.append(
    headerElement,
    textElement
  );

  enhanceMessage(messageElement, messageData, headerElement, textElement);

  if (prepend) dom.messages.prepend(messageElement);
  else dom.messages.appendChild(messageElement);

  if (!prepend) dom.messages.scrollTop = dom.messages.scrollHeight;
}

export function initializeChat() {
  /*
    Já cria o contêiner ao iniciar o chat.
  */
  getNotificationContainer();
  initializeRichChat(addMessage);

  dom.chatForm.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      sendMessage();
    }
  );

  state.socket.on(
    "chat-history",
    (history) => {
      if (!Array.isArray(history)) {
        return;
      }

      dom.messages.innerHTML = "";

      history.forEach(addMessage);
    }
  );

  state.socket.on(
    "chat-message",
    addMessage
  );

  /*
    Recebe qualquer recompensa de XP.
  */
 state.socket.on(
  "xp-updated",
  (data) => {
    if (
      !state.currentUser ||
      !data
    ) {
      return;
    }

    state.currentUser.xp =
      Number(data.xp) || 0;

    state.currentUser.level =
      Number(data.level) || 1;

    updateCurrentUserMessageLevels(
      state.currentUser.level
    );

    /*
      Continua recebendo +2 XP por mensagem,
      mas não mostra notificação.
    */
    if (
      data.reason === "MESSAGE_SENT"
    ) {
      return;
    }

    showXpNotification({
      type: "xp",
      gainedXp:
        Number(data.gainedXp) || 0,
      reason: data.reason,
      level:
        state.currentUser.level,
      xp:
        state.currentUser.xp,
      nextLevelXp:
        data.nextLevelXp === null ? NaN : Number(data.nextLevelXp),
      currentLevelXp: Number(data.currentLevelXp) || 0,
    });
  }
);

  /*
    Recebe o aviso de subida de nível.
  */
  state.socket.on(
    "level-up",
    (data) => {
      if (
        !state.currentUser ||
        !data
      ) {
        return;
      }

      const newLevel =
        Number(data.level) || 1;

      state.currentUser.level =
        newLevel;

      state.currentUser.xp =
        Number(data.xp) ||
        state.currentUser.xp ||
        0;

      updateCurrentUserMessageLevels(
        newLevel
      );

      showXpNotification({
        type: "level",
        level: newLevel,
        xp:
          state.currentUser.xp,
        ninjaTitle: data.title || '',
      });
    }
  );

  state.socket.on(
    "chat-error",
    (data) => {
      const errorMessage =
        data?.message ||
        "Ocorreu um erro no chat.";

      console.error(
        "Erro do chat:",
        errorMessage
      );

      alert(errorMessage);
    }
  );
}

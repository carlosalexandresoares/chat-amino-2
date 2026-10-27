import state from "./state.js";
import { fetchWithTimeout } from './request-timeout.js';

export async function loadAuthenticatedUser() {
  if (!state.token) {
    window.location.href =
      "/login.html";

    return;
  }

  try {
    const response = await fetchWithTimeout(
      "/api/auth/me",
      {
        headers: {
          Authorization:
            `Bearer ${state.token}`,
        },
      }
    );

    const data =
      await response.json();

    if (
      response.status === 401 ||
      response.status === 403
    ) {
      localStorage.removeItem(
        "authToken"
      );

      window.location.href =
        "/login.html";

      return;
    }

    if (!response.ok) {
      throw new Error(
        data.message ||
          "Não foi possível carregar o usuário."
      );
    }

    state.currentUser =
      data.user;

    state.socket.connect();
  } catch (error) {
    console.error(
      "Erro ao carregar usuário:",
      error
    );
    const message = error.name === 'TimeoutError'
      ? 'A conexão demorou. Verifique sua internet e abra o Purp novamente.'
      : 'Não foi possível carregar sua conta. Verifique sua internet e abra o Purp novamente.';
    const roomsStatus = document.getElementById('rooms-total');
    if (roomsStatus) roomsStatus.textContent = message;
    const chatStatus = document.getElementById('chat-connection-status');
    if (chatStatus) {
      chatStatus.textContent = message;
      chatStatus.classList.remove('hidden');
    }
  }
}

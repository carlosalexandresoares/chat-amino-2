import state from "./state.js";

export async function loadAuthenticatedUser() {
  if (!state.token) {
    window.location.href =
      "/login.html";

    return;
  }

  try {
    const response = await fetch(
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

    alert(
      "Não foi possível entrar no chat."
    );
  }
}

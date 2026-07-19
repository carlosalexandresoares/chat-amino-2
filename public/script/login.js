const form = document.getElementById("login-form");
const messageElement = document.getElementById("form-message");
const submitButton = document.getElementById("submit-button");

function showMessage(message, type) {
  messageElement.textContent = message;
  messageElement.className = `form-message ${type}`;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document
    .getElementById("email")
    .value
    .trim()
    .toLowerCase();

  const password = document.getElementById("password").value;

  showMessage("", "");
  submitButton.disabled = true;
  submitButton.textContent = "Entrando...";

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        email,
        password
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Não foi possível entrar.");
    }

    localStorage.setItem("authToken", data.token);

    showMessage("Login realizado! Redirecionando...", "success");

    setTimeout(() => {
      window.location.href = "/perfil.html";
    }, 1000);
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Entrar";
  }
});
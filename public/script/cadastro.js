const form = document.getElementById("cadastro-form");
const messageElement = document.getElementById("form-message");
const submitButton = document.getElementById("submit-button");

function showMessage(message, type) {
  messageElement.textContent = message;
  messageElement.className = `form-message ${type}`;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const username = document
    .getElementById("username")
    .value
    .trim();

  const email = document
    .getElementById("email")
    .value
    .trim()
    .toLowerCase();

  const password = document.getElementById("password").value;

  showMessage("", "");
  submitButton.disabled = true;
  submitButton.textContent = "Criando conta...";

  try {
    const response = await fetch("/api/auth/register", {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        username,
        email,
        password
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Não foi possível criar a conta.");
    }

    showMessage("Conta criada! Redirecionando...", "success");

    setTimeout(() => {
      window.location.href = "/login.html";
    }, 1200);
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Criar conta";
  }
});
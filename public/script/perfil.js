const token = localStorage.getItem("authToken");

if (!token) {
  window.location.href = "/login.html";
}

const usernameElement = document.getElementById("profile-username");
const emailElement = document.getElementById("profile-email");
const levelElement = document.getElementById("profile-level");
const xpElement = document.getElementById("profile-xp");
const bioElement = document.getElementById("profile-bio");
const avatarElement = document.getElementById("profile-avatar");
const xpProgressElement = document.getElementById("xp-progress");
const logoutButton = document.getElementById("logout-button");

async function loadProfile() {
  try {
    const response = await fetch("/api/auth/me", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Não foi possível carregar o perfil.");
    }

    const user = data.user;

    usernameElement.textContent = user.username;
    emailElement.textContent = user.email;
    levelElement.textContent = `LV ${user.level}`;
    xpElement.textContent = `${user.xp} XP`;

    bioElement.textContent =
      user.bio || "Este usuário ainda não adicionou uma biografia.";

    if (user.avatar) {
      avatarElement.innerHTML = "";

      const image = document.createElement("img");
      image.src = user.avatar;
      image.alt = `Avatar de ${user.username}`;

      avatarElement.appendChild(image);
    } else {
      avatarElement.textContent = user.username
        .charAt(0)
        .toUpperCase();
    }

    const xpNeeded = user.level * 100;
    const progress = Math.min((user.xp / xpNeeded) * 100, 100);

    xpProgressElement.style.width = `${progress}%`;
  } catch (error) {
    console.error(error);

    localStorage.removeItem("authToken");
    window.location.href = "/login.html";
  }
}

logoutButton.addEventListener("click", () => {
  localStorage.removeItem("authToken");
  window.location.href = "/login.html";
});

loadProfile();
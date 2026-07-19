const token = localStorage.getItem("authToken");

if (!token) {
  window.location.href = "/login.html";
}

const usernameElement =
  document.getElementById("profile-username");

const emailElement =
  document.getElementById("profile-email");

const levelElement =
  document.getElementById("profile-level");

const xpElement =
  document.getElementById("profile-xp");

const bioElement =
  document.getElementById("profile-bio");

const avatarElement =
  document.getElementById("profile-avatar");

const bannerElement =
  document.getElementById("profile-banner");

const xpProgressElement =
  document.getElementById("xp-progress");

const logoutButton =
  document.getElementById("logout-button");

async function loadProfile() {
  try {
    const response = await fetch("/api/auth/me", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message ||
        "Não foi possível carregar o perfil."
      );
    }

    const user = data.user;

    usernameElement.textContent = user.username;
    emailElement.textContent = user.email;
    levelElement.textContent = `LV ${user.level}`;
    xpElement.textContent = `${user.xp} XP`;

    bioElement.textContent =
      user.bio ||
      "Este usuário ainda não adicionou uma biografia.";

    updateAvatar(user);
    updateBanner(user);

    const xpNeeded = user.level * 100;

    const progress = Math.min(
      (user.xp / xpNeeded) * 100,
      100
    );

    xpProgressElement.style.width = `${progress}%`;
  } catch (error) {
    console.error(
      "Erro ao carregar perfil:",
      error
    );

    localStorage.removeItem("authToken");
    window.location.href = "/login.html";
  }
}

function updateAvatar(user) {
  avatarElement.innerHTML = "";

  if (!user.avatar) {
    avatarElement.textContent =
      user.username.charAt(0).toUpperCase();

    return;
  }

  const image = document.createElement("img");

  image.src = user.avatar;
  image.alt = `Avatar de ${user.username}`;

  image.addEventListener("error", () => {
    avatarElement.innerHTML = "";

    avatarElement.textContent =
      user.username.charAt(0).toUpperCase();
  });

  avatarElement.appendChild(image);
}

function updateBanner(user) {
  if (user.banner) {
    bannerElement.style.backgroundImage =
      `url("${user.banner}")`;

    bannerElement.classList.add("has-image");
  } else {
    bannerElement.style.backgroundImage = "";
    bannerElement.classList.remove("has-image");
  }
}

logoutButton.addEventListener("click", () => {
  localStorage.removeItem("authToken");
  window.location.href = "/login.html";
});

loadProfile();
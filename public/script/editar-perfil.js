const token =
  localStorage.getItem("authToken");

const form =
  document.getElementById("editProfileForm");

const avatarInput =
  document.getElementById("avatar");

const bannerInput =
  document.getElementById("banner");

const bioInput =
  document.getElementById("bio");

const avatarPreview =
  document.getElementById("avatarPreview");

const bannerPreview =
  document.getElementById("bannerPreview");

const bioLength =
  document.getElementById("bioLength");

const formMessage =
  document.getElementById("formMessage");

if (!token) {
  window.location.href = "/login.html";
}

function setMessage(message, type = "") {
  formMessage.textContent = message;
  formMessage.className =
    `form-message ${type}`.trim();
}

function updateAvatarPreview() {
  const avatarUrl =
    avatarInput.value.trim();

  if (avatarUrl) {
    avatarPreview.src = avatarUrl;
    avatarPreview.style.display = "block";
  } else {
    avatarPreview.removeAttribute("src");
    avatarPreview.style.display = "none";
  }
}

function updateBannerPreview() {
  const bannerUrl =
    bannerInput.value.trim();

  if (bannerUrl) {
    bannerPreview.style.backgroundImage =
      `url("${bannerUrl}")`;
  } else {
    bannerPreview.style.backgroundImage =
      "none";
  }
}

function updateBioCounter() {
  bioLength.textContent =
    bioInput.value.length;
}

async function loadProfile() {
  try {
    const response = await fetch(
      "/api/auth/me",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      localStorage.removeItem("authToken");
      window.location.href = "/login.html";
      return;
    }

    const user = data.user || data;

    avatarInput.value = user.avatar || "";
    bannerInput.value = user.banner || "";
    bioInput.value = user.bio || "";

    updateAvatarPreview();
    updateBannerPreview();
    updateBioCounter();
  } catch (error) {
    console.error(
      "Erro ao carregar perfil:",
      error
    );

    setMessage(
      "Não foi possível carregar seu perfil.",
      "error"
    );
  }
}

avatarInput.addEventListener(
  "input",
  updateAvatarPreview
);

bannerInput.addEventListener(
  "input",
  updateBannerPreview
);

bioInput.addEventListener(
  "input",
  updateBioCounter
);

avatarPreview.addEventListener(
  "error",
  () => {
    avatarPreview.style.display = "none";

    setMessage(
      "Não foi possível carregar a imagem do avatar.",
      "error"
    );
  }
);

form.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    setMessage("Salvando...");

    const submitButton =
      form.querySelector(
        'button[type="submit"]'
      );

    submitButton.disabled = true;

    try {
      const response = await fetch(
        "/api/auth/profile",
        {
          method: "PATCH",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },

          body: JSON.stringify({
            avatar: avatarInput.value,
            banner: bannerInput.value,
            bio: bioInput.value,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setMessage(
          data.message ||
            "Não foi possível atualizar o perfil.",
          "error"
        );

        return;
      }

      setMessage(
        "Perfil atualizado com sucesso.",
        "success"
      );

      setTimeout(() => {
        window.location.href =
          "/perfil.html";
      }, 800);
    } catch (error) {
      console.error(
        "Erro ao atualizar perfil:",
        error
      );

      setMessage(
        "Erro de conexão com o servidor.",
        "error"
      );
    } finally {
      submitButton.disabled = false;
    }
  }
);

loadProfile();
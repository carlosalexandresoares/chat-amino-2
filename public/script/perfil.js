const token = localStorage.getItem("authToken");
if (!token) window.location.href = "/login.html";

const $ = (id) => document.getElementById(id);
const targetId = new URLSearchParams(window.location.search).get("id");
const followButton = $("follow-button");
const postForm = $("new-post-form");
const postList = $("profile-post-list");
const message = $("profile-message");
const connectionsDialog = $("connections-dialog");
const connectionsList = $("connections-list");
const connectionsMessage = $("connections-message");
const loadMoreConnections = $("load-more-connections");
let viewedUser = null;
let connectionsKind = "followers";
let connectionsOffset = 0;
let connectionsRequestId = 0;

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("O servidor ainda não carregou esta função. Reinicie-o e atualize a página.");
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Não foi possível completar a ação.");
  return data;
}

function updateAvatar(user) {
  const avatar = $("profile-avatar");
  avatar.replaceChildren();
  if (user.avatar) {
    const image = document.createElement("img");
    image.src = user.avatar;
    image.alt = `Avatar de ${user.username}`;
    image.onerror = () => { avatar.textContent = user.username[0].toUpperCase(); };
    avatar.append(image);
  } else avatar.textContent = user.username[0].toUpperCase();
}

function renderProfile(user) {
  viewedUser = user;
  document.title = `${user.username} | Chat Amino 2`;
  $("profile-username").textContent = user.username;
  $("profile-level").textContent = `LV ${user.level}`;
  $("profile-xp").textContent = `${user.xp} XP`;
  $("profile-bio").textContent = user.bio || "Este usuário ainda não adicionou uma biografia.";
  $("profile-followers-count").textContent = user.followersCount;
  $("profile-following-count").textContent = user.followingCount;
  $("profile-posts-count").textContent = user.postsCount;
  $("xp-progress").style.width = `${Math.min(100, ((user.xp % 100) / 100) * 100)}%`;
  $("profile-banner").style.backgroundImage = user.banner
    ? `url("${user.banner.replaceAll('"', '%22')}")` : "";
  updateAvatar(user);
  $("profile-email").classList.add("hidden");
  $("edit-profile-button").classList.toggle("hidden", !user.isSelf);
  postForm.classList.toggle("hidden", !user.isSelf);
  followButton.classList.toggle("hidden", user.isSelf);
  $("logout-button").classList.toggle("hidden", !user.isSelf);
  followButton.textContent = user.isFollowing ? "Seguindo" : "Seguir";
  followButton.classList.toggle("following", user.isFollowing);
}

function renderPosts(posts) {
  postList.replaceChildren();
  if (!posts.length) {
    const empty = document.createElement("p");
    empty.className = "posts-empty";
    empty.textContent = "Ainda não há posts.";
    postList.append(empty);
  }
  for (const post of posts) {
    const article = document.createElement("article");
    article.className = "profile-post";
    const date = document.createElement("time");
    date.dateTime = post.createdAt;
    date.textContent = new Date(post.createdAt).toLocaleDateString("pt-BR");
    const content = document.createElement("p");
    content.textContent = post.content;
    article.append(date, content);
    postList.append(article);
  }
}

function connectionRow(user) {
  const link = document.createElement("a");
  link.className = "connection-row";
  link.href = `/perfil.html?id=${encodeURIComponent(user.id)}`;
  const avatar = document.createElement("span");
  avatar.className = "connection-avatar";
  if (user.avatar) {
    const image = document.createElement("img");
    image.src = user.avatar;
    image.alt = "";
    image.onerror = () => { avatar.textContent = user.username[0].toUpperCase(); };
    avatar.append(image);
  } else avatar.textContent = user.username[0].toUpperCase();
  const details = document.createElement("span");
  details.className = "connection-details";
  const name = document.createElement("strong");
  name.textContent = user.username;
  const bio = document.createElement("small");
  bio.textContent = user.bio || "Ver perfil";
  details.append(name, bio);
  const arrow = document.createElement("span");
  arrow.className = "connection-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "↗";
  link.append(avatar, details, arrow);
  return link;
}

async function loadConnections(reset = false) {
  if (!viewedUser) return;
  const requestId = ++connectionsRequestId;
  if (reset) {
    connectionsOffset = 0;
    connectionsList.replaceChildren();
  }
  connectionsMessage.textContent = "Carregando pessoas...";
  loadMoreConnections.classList.add("hidden");
  try {
    const data = await request(`/api/users/${encodeURIComponent(viewedUser.id)}/${connectionsKind}?offset=${connectionsOffset}`);
    if (requestId !== connectionsRequestId) return;
    for (const user of data.users) connectionsList.append(connectionRow(user));
    connectionsOffset = data.nextOffset;
    connectionsMessage.textContent = connectionsList.childElementCount ? "" :
      connectionsKind === "followers" ? "Ainda não há seguidores." : "Ainda não segue ninguém.";
    loadMoreConnections.classList.toggle("hidden", !data.hasMore);
  } catch (error) {
    if (requestId === connectionsRequestId) connectionsMessage.textContent = error.message;
  }
}

function openConnections(kind) {
  if (!viewedUser) return;
  connectionsKind = kind;
  $("connections-title").textContent = kind === "followers" ? "Seguidores" : "Seguindo";
  connectionsDialog.showModal();
  loadConnections(true);
}

$("profile-followers-button").addEventListener("click", () => openConnections("followers"));
$("profile-following-button").addEventListener("click", () => openConnections("following"));
$("close-connections").addEventListener("click", () => connectionsDialog.close());
connectionsDialog.addEventListener("click", (event) => {
  if (event.target === connectionsDialog) connectionsDialog.close();
});
connectionsDialog.addEventListener("close", () => { connectionsRequestId += 1; });
loadMoreConnections.addEventListener("click", () => loadConnections());

async function loadProfile() {
  try {
    const me = await request("/api/auth/me");
    const id = targetId || me.user.id;
    const [profile, posts] = await Promise.all([
      request(`/api/users/${encodeURIComponent(id)}`),
      request(`/api/users/${encodeURIComponent(id)}/posts`),
    ]);
    renderProfile(profile.user);
    renderPosts(posts.posts);
  } catch (error) {
    message.textContent = error.message;
  }
}

followButton.addEventListener("click", async () => {
  if (!viewedUser) return;
  followButton.disabled = true;
  message.textContent = "";
  try {
    await request(`/api/users/${encodeURIComponent(viewedUser.id)}/follow`, {
      method: viewedUser.isFollowing ? "DELETE" : "POST",
    });
    viewedUser.isFollowing = !viewedUser.isFollowing;
    viewedUser.followersCount += viewedUser.isFollowing ? 1 : -1;
    renderProfile(viewedUser);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    followButton.disabled = false;
  }
});

postForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = $("new-post-content").value.trim();
  if (!content) return;
  const button = postForm.querySelector("button");
  button.disabled = true;
  message.textContent = "";
  try {
    await request("/api/posts", { method: "POST", body: JSON.stringify({ content }) });
    postForm.reset();
    const posts = await request(`/api/users/${encodeURIComponent(viewedUser.id)}/posts`);
    renderPosts(posts.posts);
    viewedUser.postsCount += 1;
    $("profile-posts-count").textContent = viewedUser.postsCount;
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("logout-button").addEventListener("click", () => {
  localStorage.removeItem("authToken");
  window.location.href = "/login.html";
});

loadProfile();

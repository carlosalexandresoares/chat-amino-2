const token = localStorage.getItem('authToken');
if (!token) window.location.replace('/login.html');

const form = document.getElementById('editProfileForm');
const message = document.getElementById('formMessage');
const bio = document.getElementById('bio');
const saveButton = form.querySelector('button[type="submit"]');
const images = {
  avatar: {
    link: document.getElementById('avatar'), file: document.getElementById('avatarFile'),
    preview: document.getElementById('avatarPreview'), name: document.getElementById('avatarFileName'),
    remove: document.getElementById('removeAvatar'), maxBytes: 2 * 1024 * 1024,
  },
  banner: {
    link: document.getElementById('banner'), file: document.getElementById('bannerFile'),
    preview: document.getElementById('bannerPreview'), name: document.getElementById('bannerFileName'),
    remove: document.getElementById('removeBanner'), maxBytes: 5 * 1024 * 1024,
  },
};
for (const state of Object.values(images)) Object.assign(state, {
  currentUrl: '', objectUrl: null, linkTouched: false, removed: false,
});

function setMessage(text, kind = '') {
  message.textContent = text;
  message.className = `form-message ${kind}`.trim();
}
function showPreview(kind, url) {
  const state = images[kind];
  state.preview.hidden = !url;
  if (url) state.preview.src = url;
  else state.preview.removeAttribute('src');
  if (kind === 'avatar') document.getElementById('avatarFallback').hidden = Boolean(url);
}
function releaseObjectUrl(state) {
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = null;
}
function imageSelected(kind) {
  const state = images[kind];
  const file = state.file.files[0];
  if (!file) return;
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (file.size > state.maxBytes || (file.type && !allowed.includes(file.type))) {
    state.file.value = '';
    setMessage(`${kind === 'avatar' ? 'Foto de perfil' : 'Banner'}: use JPG, PNG, WebP ou GIF com até ${state.maxBytes / 1048576} MB.`, 'error');
    return;
  }
  releaseObjectUrl(state);
  state.objectUrl = URL.createObjectURL(file);
  state.link.value = '';
  state.name.textContent = file.name;
  state.removed = false;
  state.linkTouched = false;
  showPreview(kind, state.objectUrl);
  setMessage('');
}
function linkChanged(kind) {
  const state = images[kind];
  releaseObjectUrl(state);
  state.file.value = '';
  state.name.textContent = 'Nenhum arquivo escolhido';
  state.linkTouched = true;
  state.removed = false;
  showPreview(kind, state.link.value.trim());
  setMessage('');
}
function removeImage(kind) {
  const state = images[kind];
  releaseObjectUrl(state);
  state.file.value = '';
  state.link.value = '';
  state.name.textContent = 'Nenhum arquivo escolhido';
  state.removed = true;
  state.linkTouched = true;
  showPreview(kind, '');
  setMessage('');
}

for (const [kind, state] of Object.entries(images)) {
  state.file.addEventListener('change', () => imageSelected(kind));
  state.link.addEventListener('input', () => linkChanged(kind));
  state.remove.addEventListener('click', () => removeImage(kind));
  state.preview.addEventListener('error', () => {
    state.preview.hidden = true;
    if (kind === 'avatar') document.getElementById('avatarFallback').hidden = false;
  });
}
bio.addEventListener('input', () => { document.getElementById('bioLength').textContent = bio.value.length; });
window.addEventListener('beforeunload', () => Object.values(images).forEach(releaseObjectUrl));

async function loadProfile() {
  saveButton.disabled = true;
  try {
    const response = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 401) { localStorage.removeItem('authToken'); window.location.replace('/login.html'); return; }
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Não foi possível carregar seu perfil.');
    const user = data.user;
    bio.value = user.bio || '';
    document.getElementById('bioLength').textContent = bio.value.length;
    document.getElementById('avatarFallback').textContent = user.username?.charAt(0).toUpperCase() || '?';
    for (const [kind, state] of Object.entries(images)) {
      state.currentUrl = user[kind] || '';
      state.link.value = /^https?:\/\//i.test(state.currentUrl) ? state.currentUrl : '';
      state.linkTouched = false;
      state.removed = false;
      showPreview(kind, state.currentUrl);
    }
    saveButton.disabled = false;
  } catch (error) { setMessage(error.message || 'Não foi possível carregar seu perfil.', 'error'); }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!token) return;
  const payload = new FormData();
  payload.append('bio', bio.value);
  for (const [kind, state] of Object.entries(images)) {
    const file = state.file.files[0];
    if (file) payload.append(`${kind}File`, file);
    else if (state.removed || state.linkTouched) payload.append(kind, state.link.value.trim());
  }
  saveButton.disabled = true;
  setMessage('Salvando alterações...');
  try {
    const response = await fetch('/api/auth/profile', {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}` }, body: payload,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Não foi possível atualizar o perfil.');
    setMessage('Perfil atualizado com sucesso.', 'success');
    window.location.assign('/perfil.html');
  } catch (error) {
    setMessage(error.message || 'Erro de conexão com o servidor.', 'error');
    saveButton.disabled = false;
  }
});

loadProfile();

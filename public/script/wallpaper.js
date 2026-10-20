const $ = id => document.getElementById(id);
const presets = {
  geometry: 'repeating-linear-gradient(45deg, #493f6e 0 18px, #594879 18px 36px, #3e405d 36px 54px)',
  twilight: 'radial-gradient(circle at 75% 15%, #bc7195, transparent 42%), linear-gradient(155deg, #282e5d, #644889 65%, #151e40)',
  night: 'radial-gradient(circle at 20% 20%, #313e71, transparent 35%), linear-gradient(145deg, #12182a, #253354)',
  minimal: 'linear-gradient(160deg, #c2c8d9, #e9e3ef)',
};
let saved = { mode: 'DEFAULT', positionX: 50, positionY: 50, darkness: 0, overlay: 0 };
let draft = { ...saved };
let imageFile = null;
let previewUrl = null;

function backgroundImage(value, imageUrl) {
  if (value.mode === 'PRESET') return presets[value.preset] || presets.night;
  if (value.mode === 'IMAGE' && imageUrl) {
    const dark = Number(value.darkness || 0) / 100 * .8;
    const overlay = Number(value.overlay || 0) / 100 * .6;
    return `linear-gradient(rgba(0,0,0,${dark}),rgba(0,0,0,${dark})), linear-gradient(rgba(74,39,120,${overlay}),rgba(74,39,120,${overlay})), url("${imageUrl}")`;
  }
  return value.mode === 'COLOR' ? 'none' : 'linear-gradient(155deg, #66727b, #444f58)';
}
async function apply(value, assetUrl, preview = false) {
  const area = $('messages');
  let image = preview && previewUrl ? previewUrl : null;
  if (!image && value.mode === 'IMAGE' && value.assetId) {
    try { image = await assetUrl(value.assetId); }
    catch { image = null; }
  }
  area.style.setProperty('--chat-bg-color', value.mode === 'COLOR' ? value.color : '#586773');
  area.style.setProperty('--chat-bg-image', backgroundImage(value, image));
  area.style.setProperty('--chat-bg-position', `${value.positionX ?? 50}% ${value.positionY ?? 50}%`);
}

export function initializeWallpaper(api, assetUrl, roomId) {
  if (!roomId) return;
  const dialog = $('wallpaper-dialog');
  const syncControls = value => {
    $('wallpaper-x').value = value.positionX ?? 50;
    $('wallpaper-y').value = value.positionY ?? 50;
    $('wallpaper-darkness').value = value.darkness ?? 0;
    $('wallpaper-overlay').value = value.overlay ?? 0;
    $('wallpaper-color').value = value.color || '#66727b';
  };
  const preview = () => apply(draft, assetUrl, true);
  const close = () => {
    dialog.close(); draft = { ...saved }; apply(saved, assetUrl);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null; imageFile = null; $('wallpaper-file').value = '';
  };
  const save = async () => {
    const button = $('wallpaper-save'); button.disabled = true;
    try {
      if (draft.mode === 'IMAGE' && imageFile) {
        const form = new FormData(); form.append('file', imageFile);
        const uploaded = await api('/wallpaper', { method: 'POST', body: form });
        draft.assetId = uploaded.id;
      }
      const response = await api('/appearance', { method: 'PUT', body: JSON.stringify({ ...draft, roomId }) });
      saved = response.appearance; draft = { ...saved };
      $('wallpaper-status').textContent = 'Fundo salvo para este chat.';
      close();
    } catch (error) { $('wallpaper-status').textContent = error.message; }
    finally { button.disabled = false; }
  };
  $('wallpaper-open').addEventListener('click', () => { draft = { ...saved }; syncControls(draft); dialog.showModal(); });
  $('wallpaper-close').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  document.querySelectorAll('[data-wallpaper-color]').forEach(button => {
    button.style.setProperty('--sample', button.dataset.wallpaperColor);
    button.addEventListener('click', () => { draft.mode = 'COLOR'; draft.color = button.dataset.wallpaperColor; $('wallpaper-color').value = draft.color; preview(); });
  });
  $('wallpaper-color').addEventListener('input', event => { draft.mode = 'COLOR'; draft.color = event.target.value; preview(); });
  document.querySelectorAll('[data-wallpaper-preset]').forEach(button => button.addEventListener('click', () => {
    draft.mode = 'PRESET'; draft.preset = button.dataset.wallpaperPreset; preview();
  }));
  $('wallpaper-file').addEventListener('change', event => {
    imageFile = event.target.files[0]; if (!imageFile) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(imageFile); draft.mode = 'IMAGE'; draft.assetId = null; preview();
  });
  for (const [id, field] of [['wallpaper-x', 'positionX'], ['wallpaper-y', 'positionY'],
    ['wallpaper-darkness', 'darkness'], ['wallpaper-overlay', 'overlay']]) {
    $(id).addEventListener('input', event => { draft[field] = Number(event.target.value); preview(); });
  }
  $('wallpaper-save').addEventListener('click', save);
  $('wallpaper-reset').addEventListener('click', () => { draft = { mode: 'DEFAULT', positionX: 50, positionY: 50, darkness: 0, overlay: 0 }; preview(); save(); });
  api(`/appearance?roomId=${encodeURIComponent(roomId)}`).then(response => { saved = response.appearance || saved; draft = { ...saved }; apply(saved, assetUrl); })
    .catch(error => console.error('Erro ao carregar fundo:', error));
}

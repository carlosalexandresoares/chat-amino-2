export function showElement(element) {
  if (!element) {
    return;
  }

  element.classList.remove("hidden");
}

export function hideElement(element) {
  if (!element) {
    return;
  }

  element.classList.add("hidden");
}

export function setButtonLoading(
  button,
  loading,
  loadingText = "Carregando..."
) {
  if (!button) {
    return;
  }

  if (loading) {
    if (!button.dataset.originalText) {
      button.dataset.originalText =
        button.textContent;
    }

    button.disabled = true;
    button.textContent = loadingText;

    return;
  }

  button.disabled = false;

  if (button.dataset.originalText) {
    button.textContent =
      button.dataset.originalText;

    delete button.dataset.originalText;
  }
}

export function extractYouTubeId(text) {
  if (typeof text !== "string") {
    return null;
  }

  const trimmed = text.trim();

  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{6,})/i,
    /(?:youtu\.be\/)([A-Za-z0-9_-]{6,})/i,
    /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{6,})/i,
    /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{6,})/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  if (
    /^[A-Za-z0-9_-]{6,}$/.test(
      trimmed
    )
  ) {
    return trimmed;
  }

  return null;
}
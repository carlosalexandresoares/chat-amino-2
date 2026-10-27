export async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const external = options.signal;
  let timedOut = false;
  const cancel = () => controller.abort();
  if (external?.aborted) cancel();
  else external?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      const timeout = new Error('A conexão demorou. Tente novamente.');
      timeout.name = 'TimeoutError';
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', cancel);
  }
}

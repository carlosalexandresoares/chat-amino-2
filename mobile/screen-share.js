import { Capacitor, registerPlugin } from '@capacitor/core';

if (Capacitor.getPlatform() === 'android') {
  const plugin = registerPlugin('PurpScreenShare');
  const listeners = { signal: new Set(), stopped: new Set() };
  plugin.addListener('signal', event => {
    for (const listener of listeners.signal) listener(event);
  });
  plugin.addListener('stopped', event => {
    for (const listener of listeners.stopped) listener(event);
  });
  window.PurpNativeScreenShare = {
    start: ({ iceServers, microphone }) => plugin.start({
      iceServersJson: JSON.stringify(iceServers || []), microphone: !!microphone,
    }),
    stop: () => plugin.stop().catch(() => {}),
    addViewer: socketId => plugin.addViewer({ socketId }),
    removeViewer: socketId => plugin.removeViewer({ socketId }).catch(() => {}),
    signal: (socketId, type, data) => plugin.signal({ socketId, type, data }),
    onSignal: listener => listeners.signal.add(listener),
    onStopped: listener => listeners.stopped.add(listener),
  };
}

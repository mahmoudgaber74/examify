if ('serviceWorker' in navigator) {
  const isLocalDev = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);

  const unregisterServiceWorkers = () => {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .catch((error) => console.log('SW unregister failed:', error));
  };

  if (isLocalDev) {
    unregisterServiceWorkers();

    if ('caches' in window) {
      caches.keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch((error) => console.log('Cache clear failed:', error));
    }
  }

  window.addEventListener('load', () => {
    if (isLocalDev) {
      unregisterServiceWorkers();
      return;
    }

    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered:', registration.scope);
      })
      .catch((error) => {
        console.log('SW registration failed:', error);
      });
  });
}

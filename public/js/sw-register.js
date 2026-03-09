if ('serviceWorker' in navigator) {
    let waitingWorker = null;
    window.__swUpdateAvailable = false;

    const emitUpdateAvailable = () => {
        window.__swUpdateAvailable = true;
        window.dispatchEvent(new CustomEvent('sw-update-available'));
    };

    const setWaitingWorker = (worker) => {
        waitingWorker = worker;
        if (waitingWorker) {
            emitUpdateAvailable();
        }
    };

    window.__applyServiceWorkerUpdate = () => {
        if (!waitingWorker) {
            window.location.reload();
            return;
        }
        waitingWorker.postMessage('skipWaiting');
    };

    // Alias compatible con el nombre solicitado en la app.
    window.actualizarApp = window.__applyServiceWorkerUpdate;

    navigator.serviceWorker
        .register('/sw.js')
        .then(reg => {
            console.log('SW registrado', reg);

            if (reg.waiting) {
                setWaitingWorker(reg.waiting);
            }

            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                if (!newWorker) return;

                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        setWaitingWorker(newWorker);
                    }
                });
            });
        })
        .catch(err => console.error('Error registrando SW', err));

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
    });
}

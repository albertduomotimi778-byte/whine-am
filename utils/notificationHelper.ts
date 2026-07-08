/**
 * Helper to request notification permission and send system notifications.
 */

export const requestNotificationPermission = async (): Promise<boolean> => {
    if (!('Notification' in window)) {
        console.warn('This browser does not support desktop/system notifications.');
        return false;
    }
    
    if (Notification.permission === 'granted') return true;
    
    const permission = await Notification.requestPermission();
    return permission === 'granted';
};

export const sendSystemNotification = (title: string, body: string, icon: string = '/favicon.ico') => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    
    const notification = new Notification(title, {
        body,
        icon,
        badge: icon,
        tag: 'app-notification',
    });

    notification.onclick = () => {
        window.focus();
        notification.close();
    };
};

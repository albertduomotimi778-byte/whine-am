export const migrateStorage = () => {
  const prefixes = ['sacto_', 'animato_'];
  
  prefixes.forEach(prefix => {
    // Check for user
    if (localStorage.getItem(prefix + 'user') && !localStorage.getItem('app_user')) {
      localStorage.setItem('app_user', localStorage.getItem(prefix + 'user')!);
    }
    if (localStorage.getItem(prefix + 'language_preference') && !localStorage.getItem('app_language_preference')) {
      localStorage.setItem('app_language_preference', localStorage.getItem(prefix + 'language_preference')!);
    }
    if (localStorage.getItem(prefix + 'project_list') && !localStorage.getItem('app_project_list')) {
      localStorage.setItem('app_project_list', localStorage.getItem(prefix + 'project_list')!);
    }
    // Also migrate dynamic project keys
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix + 'proj_')) {
            const newKey = key.replace(prefix + 'proj_', 'app_proj_');
            if (!localStorage.getItem(newKey)) {
                localStorage.setItem(newKey, localStorage.getItem(key)!);
            }
        }
    }
  });

  // Also catch pending payments/plans just in case
  prefixes.forEach(prefix => {
      const paymentKey = `pending_${prefix}payment`;
      const planKey = `pending_${prefix}plan`;
      
      if (localStorage.getItem(paymentKey) && !localStorage.getItem('pending_app_payment')) {
          localStorage.setItem('pending_app_payment', localStorage.getItem(paymentKey)!);
      }
      if (localStorage.getItem(planKey) && !localStorage.getItem('pending_app_plan')) {
          localStorage.setItem('pending_app_plan', localStorage.getItem(planKey)!);
      }
  });
};

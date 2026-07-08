import fs from 'fs';
let code = fs.readFileSync('server.ts', 'utf-8');

code = code.replace(/const sub = await queryDbSingle\([\s\S]*?'SELECT \* FROM user_subscriptions_v3 WHERE email = \?',[\s\S]*?\[email\],[\s\S]*?'SELECT \* FROM user_subscriptions_v3 WHERE email = \$1'[\s\S]*?\);/g, 'const sub = await getSubscriptionFromSheet(email) || null;');

code = code.replace(/const sub = await queryDbSingle\([\s\S]*?'SELECT \* FROM user_subscriptions_v3 WHERE email = \?',[\s\S]*?\[activeEmail\],[\s\S]*?'SELECT \* FROM user_subscriptions_v3 WHERE email = \$1'[\s\S]*?\);/g, 'const sub = await getSubscriptionFromSheet(activeEmail) || null;');

fs.writeFileSync('server.ts', code);
console.log('Replaced');

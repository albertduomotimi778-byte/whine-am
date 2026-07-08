const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const sMatch = `      const sub = await queryDbSingle(
        'SELECT * FROM user_subscriptions_v3 WHERE email = ?',
        [email],
        'SELECT * FROM user_subscriptions_v3 WHERE email = $1'
      );`;

code = code.split(sMatch).join('      const sub = await getSubscriptionFromSheet(email) || null;');

const sMatch2 = `      const sub = await queryDbSingle(
        'SELECT * FROM user_subscriptions_v3 WHERE email = ?',
        [activeEmail],
        'SELECT * FROM user_subscriptions_v3 WHERE email = $1'
      );`;

code = code.split(sMatch2).join('      const sub = await getSubscriptionFromSheet(activeEmail) || null;');

fs.writeFileSync('server.ts', code);
console.log('Done!');

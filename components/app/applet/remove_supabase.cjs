const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const sStart = code.indexOf('          console.log(`[Supabase] Syncing user_accounts and user_subscriptions_v3');
const sEndStr = '          console.log(\'[Supabase] Sync SUCCESS for\', activeEmail);\n        } catch (syncErr)';
const sEnd = code.indexOf(sEndStr);

if (sStart !== -1 && sEnd !== -1) {
    const replacement = `          console.log(\`[Supabase] Syncing user_accounts for \${activeEmail}\`);
          if (account) {
             const accData = { email: activeEmail, password: account.password, country: account.country, language: account.language, timestamp: account.timestamp };
             let { error: accError } = await supabase.from('user_accounts').upsert(accData, { onConflict: 'email' });
             if (accError) {
                 const { data: existAcc } = await supabase.from('user_accounts').select('email').eq('email', activeEmail).single();
                 if (existAcc) await supabase.from('user_accounts').update(accData).eq('email', activeEmail);
                 else await supabase.from('user_accounts').insert(accData);
             }
          }\n        } catch (syncErr)`;
    code = code.substring(0, sStart) + replacement + code.substring(sEnd + sEndStr.length);
    fs.writeFileSync('server.ts', code);
    console.log('Successfully replaced Supabase logic');
} else {
    console.log('Could not find Supabase block to replace', sStart, sEnd);
}

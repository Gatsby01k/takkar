const token = process.env.TELEGRAM_BOT_TOKEN;
const appUrl = process.env.MINI_APP_URL;
const menuText = process.env.MENU_TEXT || 'PLAY TAKKAR';

if (!token || !appUrl) {
  console.error('Set TELEGRAM_BOT_TOKEN and MINI_APP_URL before running this script.');
  process.exit(1);
}
if (!appUrl.startsWith('https://')) {
  console.error('MINI_APP_URL must be an HTTPS URL.');
  process.exit(1);
}

const api = `https://api.telegram.org/bot${token}`;
async function call(method, body) {
  const response = await fetch(`${api}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!result.ok) throw new Error(`${method}: ${result.description || 'Telegram API error'}`);
  console.log(`✓ ${method}`);
  return result.result;
}

const me = await call('getMe', {});
await call('setChatMenuButton', {
  menu_button: { type: 'web_app', text: menuText, web_app: { url: appUrl } }
});
await call('setMyCommands', {
  commands: [
    { command: 'start', description: 'Open TAKKAR' },
    { command: 'play', description: 'Launch the Impact Game' },
    { command: 'help', description: 'How TAKKAR works' }
  ]
});
await call('setMyShortDescription', {
  short_description: 'Launch a heavy wheel. Survive every impact. Cash out before the next takkar.'
});
await call('setMyDescription', {
  description: 'TAKKAR is the impact game. Hold to launch a heavy wheel, survive physical checkpoints and cash out before the next collision destroys it. Demo credits only in this build.'
});

console.log(`\nBot ready: https://t.me/${me.username}`);
console.log(`Direct Mini App link: https://t.me/${me.username}?startapp`);

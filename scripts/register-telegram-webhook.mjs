const token = process.env.TELEGRAM_BOT_TOKEN;
const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;
const publicAppUrl = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");

if (!token || !secretToken || !publicAppUrl) {
  throw new Error("TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, and PUBLIC_APP_URL are required");
}
if (!publicAppUrl.startsWith("https://") || /localhost|127\.0\.0\.1/i.test(publicAppUrl)) {
  throw new Error("PUBLIC_APP_URL must be an approved public HTTPS domain");
}
if (!/^[A-Za-z0-9_-]{16,256}$/.test(secretToken)) {
  throw new Error("TELEGRAM_WEBHOOK_SECRET must be 16-256 characters using letters, numbers, underscore, or hyphen");
}

const webhookUrl = `${publicAppUrl}/api/telegram/webhook`;
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: secretToken,
    allowed_updates: ["message"],
    max_connections: 20,
    drop_pending_updates: false,
  }),
});
const result = await response.json();
if (!response.ok || !result.ok) throw new Error(result.description || "Telegram rejected the webhook");

console.log(`Webhook ready at ${webhookUrl}`);

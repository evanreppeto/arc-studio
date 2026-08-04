# `@growth-engine/arc`

Connector helpers for attaching an Arc agent to a hosted Arc Studio workspace.

## Initialize Arc

```bash
npx @growth-engine/arc init \
  --app https://acme.growthengine.com \
  --token sk_live_... \
  --secret shared-hmac-secret
```

The command writes `.env.growth-engine`:

```env
GROWTH_APP_BASE_URL=https://acme.growthengine.com
GROWTH_APP_AGENT_TOKEN=sk_live_...
ARC_WEBHOOK_SECRET=shared-hmac-secret
```

## Use In A Arc Worker

```js
import { createGrowthEngineClient } from "@growth-engine/arc";

const growth = createGrowthEngineClient({
  baseUrl: process.env.GROWTH_APP_BASE_URL,
  token: process.env.GROWTH_APP_AGENT_TOKEN,
});

await growth.ping();

const inbox = await growth.listMessages({ limit: 20 });
for (const message of inbox.messages ?? []) {
  await growth.reply({
    agentTaskId: message.agentTaskId,
    body: "Arc received this message.",
  });
}
```

## Verify App Wake Signatures

```js
import { verifyWebhookSignature } from "@growth-engine/arc";

const valid = verifyWebhookSignature({
  rawBody,
  signature: request.headers["x-webhook-signature"],
  secret: process.env.ARC_WEBHOOK_SECRET,
});
```

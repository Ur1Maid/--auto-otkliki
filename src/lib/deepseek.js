// HTTP-клиент DeepSeek: единая точка вызова chat-completions API.

const BASE_DELAY_MS = 500;

function isTransient(status) {
  return status === 0 || status === 429 || status >= 500;
}

export async function callDeepSeek({
  apiKey,
  apiUrl,
  model,
  messages,
  temperature = 0.2,
  maxTokens = 400,
  maxRetries = 2,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  let lastResult;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
      await sleep(delay);
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        temperature,
        max_tokens: maxTokens
      }),
      signal: AbortSignal.timeout(30000)
    }).catch((error) => {
      console.log(`DeepSeek API недоступен: ${error.message}`);
      return null;
    });

    if (!response) {
      lastResult = { ok: false, status: 0, body: '' };
      if (isTransient(0) && attempt < maxRetries) continue;
      return lastResult;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.log(`DeepSeek API вернул ошибку ${response.status}: ${body.slice(0, 200)}`);
      lastResult = { ok: false, status: response.status, body };
      if (isTransient(response.status) && attempt < maxRetries) continue;
      return lastResult;
    }

    const data = await response.json().catch(() => null);
    return {
      ok: true,
      content: data?.choices?.[0]?.message?.content || ''
    };
  }

  return lastResult;
}

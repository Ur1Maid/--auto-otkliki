// HTTP-клиент DeepSeek: единая точка вызова chat-completions API.

export async function callDeepSeek({ apiKey, apiUrl, model, messages, temperature = 0.2, maxTokens = 400 }) {
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

  if (!response) return { ok: false, status: 0, body: '' };

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.log(`DeepSeek API вернул ошибку ${response.status}: ${body.slice(0, 200)}`);
    return { ok: false, status: response.status, body };
  }

  const data = await response.json().catch(() => null);
  return {
    ok: true,
    content: data?.choices?.[0]?.message?.content || ''
  };
}

const key = process.env.GEMINI_API_KEY?.trim();
if (!key) {
  console.error('Falta GEMINI_API_KEY');
  process.exit(1);
}

const candidates = process.argv.slice(2);
const models = candidates.length
  ? candidates
  : [
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash',
      'gemini-flash-lite-latest',
      'gemini-flash-latest',
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash',
    ];

for (const model of models) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Responde solo: {"ok":true}' }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    }
  );
  const json = await res.json();
  if (json.error) {
    const limit = /limit: (\d+)/.exec(json.error.message)?.[1] ?? '';
    console.log(`${model.padEnd(26)} HTTP ${res.status} ${json.error.status}${limit ? ` (limite diario ${limit})` : ''}`);
  } else {
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    console.log(`${model.padEnd(26)} OK   ${String(text).replace(/\s+/g, ' ').slice(0, 60)}`);
  }
}

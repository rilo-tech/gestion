const key = process.env.GEMINI_API_KEY?.trim();
if (!key) {
  console.error('Falta GEMINI_API_KEY');
  process.exit(1);
}

const model = process.argv[2] || 'gemini-3.1-flash-lite';

const catalog = [
  { id: 'p1', nombre: 'Camiseta algodón', color: 'Rojo', talle: 'XL', precio: 620 },
  { id: 'p2', nombre: 'Camiseta algodón', color: 'Amarillo', talle: 'XL', precio: 620 },
  { id: 'p3', nombre: 'Camiseta algodón', color: 'Azul', talle: 'M', precio: 600 },
  { id: 'p4', nombre: 'Buzo frisa', color: 'Negro', talle: 'L', precio: 1500 },
  { id: 'p5', nombre: 'Camiseta poliéster', color: 'Rojo', talle: 'XL', precio: 540 },
];

const utterance =
  'ingresa el pedido de danyelyn camiseta xl roja de algodon $620 costo $100 descripcion estampado a3 adelante';
const query = 'camiseta xl roja de algodon';

const spokenBlock = `Cómo habló (frase entera): ${JSON.stringify(utterance)}
Producto que hay que ubicar: ${JSON.stringify(query)}

CATÁLOGO (id | nombre | color | talle | etiqueta | precio):
${catalog
  .map((p) => `${p.id} | ${p.nombre} | color:${p.color} | talle:${p.talle} | ${p.nombre} (${p.color}, ${p.talle}) | $${p.precio}`)
  .join('\n')}`;

const prompt = `Sos del negocio (indumentaria). El dueño pidió un producto por WhatsApp, como habla, sin un orden fijo.
Elegí del CATÁLOGO cuáles son ESE producto. No inventes ids.

${spokenBlock}

Reglas (como una persona, no un buscador exacto):
- El orden de las palabras NO importa: «camiseta xl roja de algodon» ES «Camiseta algodón Rojo XL».
- camiseta = remera = playera. Roja/rojo/red = el mismo color. XL/xl/extra large = el mismo talle.
- «de algodón» / algodon / cotton es la tela: puede estar en el nombre o no. Si color y talle cierran, incluilo.
- Si dijo COLOR, no ofrezcas otro color. Si dijo TALLE, no ofrezcas otro talle.
- Preferí devolver 1–3 opciones buenas antes que ids vacío. ids vacío SOLO si no hay nada del mismo tipo+color+talle.
- Máximo 6.
Devolvé SOLO JSON: {"ids":["..."]}`;

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  }
);
const json = await res.json();
if (json.error) {
  console.log(`${model}: ERROR ${json.error.status} - ${json.error.message.slice(0, 160)}`);
  process.exit(0);
}
const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
console.log(`${model} respondió:`, text.replace(/\s+/g, ' '));
try {
  const ids = JSON.parse(text).ids ?? [];
  const names = ids.map((id) => {
    const p = catalog.find((c) => c.id === id);
    return p ? `${p.nombre} ${p.color} ${p.talle}` : `¿${id}?`;
  });
  console.log('Eligió:', names.join(' | ') || '(ninguno)');
  const ok = ids.includes('p1') && !ids.includes('p2') && !ids.includes('p3');
  console.log(ok ? 'CORRECTO: sugiere la roja XL y no otros colores/talles' : 'MAL');
} catch {
  console.log('JSON inválido');
}

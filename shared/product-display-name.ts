/** Nombre visible: base + color + talle, separados solo por espacio. */
export function buildProductDisplayName(
  nombreBase: string,
  color?: string,
  talle?: string
): string {
  const parts = [nombreBase.trim()];
  if (color?.trim()) parts.push(color.trim());
  if (talle?.trim()) parts.push(talle.trim());
  return parts.filter(Boolean).join(' ');
}

/** Obtiene el nombre base desde el nombre guardado y los campos variante. */
export function inferNombreBase(
  nombre: string,
  color?: string,
  talle?: string
): string {
  let base = String(nombre ?? '').trim();
  const c = String(color ?? '').trim();
  const t = String(talle ?? '').trim();
  if (!base) return '';

  if (base.includes(' - ')) {
    const parts = base.split(' - ').map((part) => part.trim()).filter(Boolean);
    if (c && t && parts.length >= 3 && parts[parts.length - 1] === t && parts[parts.length - 2] === c) {
      return parts.slice(0, -2).join(' ');
    }
    if (t && parts.length >= 2 && parts[parts.length - 1] === t) {
      const withoutTalle = parts.slice(0, -1);
      if (c && withoutTalle.length >= 1 && withoutTalle[withoutTalle.length - 1] === c) {
        return withoutTalle.slice(0, -1).join(' ');
      }
      return withoutTalle.join(' ');
    }
    if (c && parts.length >= 2 && parts[parts.length - 1] === c) {
      return parts.slice(0, -1).join(' ');
    }
  }

  if (t) {
    if (base.endsWith(` ${t}`)) base = base.slice(0, -(t.length + 1)).trim();
    if (base.endsWith(` - ${t}`)) base = base.slice(0, -(t.length + 3)).trim();
  }
  if (c) {
    if (base.endsWith(` ${c}`)) base = base.slice(0, -(c.length + 1)).trim();
    if (base.endsWith(` - ${c}`)) base = base.slice(0, -(c.length + 3)).trim();
  }

  return base.replace(/\s+-\s*$/g, '').trim() || String(nombre ?? '').trim();
}

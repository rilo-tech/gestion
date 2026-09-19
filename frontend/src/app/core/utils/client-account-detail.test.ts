import { describe, expect, it } from 'vitest';
import { buildClientAccountDetail } from './client-account-detail';

describe('buildClientAccountDetail', () => {
  it('prioriza el nombre del ítem sobre Venta mostrador', () => {
    const result = buildClientAccountDetail({
      lineas: [{ nombre: 'Limpieza Vico', cantidad: 1, precioUnitario: 250, subtotal: 250 }],
      concepto: 'Venta mostrador',
      referencia: 'Venta #00239',
    });
    expect(result.primary).toBe('Limpieza Vico');
  });

  it('lista varios ítems en la misma celda sin inventar importes', () => {
    const result = buildClientAccountDetail({
      lineas: [
        { nombre: 'Camiseta niño', cantidad: 2, precioUnitario: 100, subtotal: 200 },
        { nombre: 'Taza personalizada', cantidad: 1, precioUnitario: 100, subtotal: 100 },
      ],
      concepto: 'Venta mostrador',
      referencia: 'Venta #1',
    });
    expect(result.primary).toBe('Camiseta niño ×2\nTaza personalizada');
    expect(result.itemLines).toHaveLength(2);
  });

  it('usa concepto útil si no hay ítems', () => {
    const result = buildClientAccountDetail({
      lineas: [],
      concepto: 'Pedido remeras',
      referencia: 'Pedido #00226',
    });
    expect(result.primary).toBe('Pedido remeras');
  });

  it('ignora estados técnicos como concepto', () => {
    const result = buildClientAccountDetail({
      lineas: [],
      concepto: 'listo',
      referencia: 'Pedido #00226',
    });
    expect(result.primary).toBe('Pedido #00226');
  });

  it('cae en la referencia si no hay más datos', () => {
    const result = buildClientAccountDetail({
      concepto: 'Venta mostrador',
      referencia: 'Venta #00251',
    });
    expect(result.primary).toBe('Venta #00251');
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatInfoBlock,
  formatNumberedMenu,
  numberedOptionLines,
  waBulletList,
  waTitle,
  WA_INSTRUCTION,
} from './whatsapp-visual.ts';
import { formatWhatsappOutbound } from './whatsapp-format.ts';

describe('WhatsApp visual format', () => {
  it('waTitle renders bold with emoji', () => {
    const title = waTitle('Caja', 'cash');
    assert.equal(title, '*💰 Caja*');
  });

  it('numberedOptionLines uses 1-based index', () => {
    assert.deepEqual(numberedOptionLines(['💰 Caja', '💵 Ventas']), ['1. 💰 Caja', '2. 💵 Ventas']);
  });

  it('formatNumberedMenu separates blocks and short instruction', () => {
    const text = formatNumberedMenu({
      title: 'Ayuda',
      icon: 'welcome',
      options: ['💰 Caja', '💵 Ventas'],
      exitOption: { index: 0, label: 'Salir', icon: 'cancel' },
    });
    assert.match(text, /\*👋 Ayuda\*/);
    assert.match(text, /1\. 💰 Caja/);
    assert.match(text, /0\. ❌ Salir/);
    assert.match(text, new RegExp(`${WA_INSTRUCTION}$`));
  });

  it('formatInfoBlock uses bullets not numbers', () => {
    const text = formatInfoBlock({
      title: 'Saldo de caja',
      icon: 'cash',
      bullets: ['Negocio: $15.000', 'Total: $18.500'],
    });
    assert.match(text, /• Negocio: \$15\.000/);
    assert.doesNotMatch(text, /^1\./m);
  });

  it('formatWhatsappOutbound removes double asterisks', () => {
    assert.equal(formatWhatsappOutbound('**Caja**'), '*Caja*');
  });
});

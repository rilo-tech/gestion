import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ambiguousPayloadFromToolOutput } from './v4-candidate-selection.ts';
import {
  isRealCandidateAmbiguity,
  normalizeCandidateResult,
} from './entity-candidate-result.ts';

describe('normalizeCandidateResult', () => {
  it('0 candidates → not_found', () => {
    assert.equal(normalizeCandidateResult([]).status, 'not_found');
  });

  it('1 candidate → resolved', () => {
    const result = normalizeCandidateResult([{ id: 's1', name: 'Disershop' }]);
    assert.equal(result.status, 'resolved');
    if (result.status === 'resolved') {
      assert.equal(result.entity.id, 's1');
    }
  });

  it('2+ candidates → ambiguous', () => {
    const result = normalizeCandidateResult([
      { id: 's1', name: 'Disershop Centro' },
      { id: 's2', name: 'Disershop Mayorista' },
    ]);
    assert.equal(result.status, 'ambiguous');
    if (result.status === 'ambiguous') assert.equal(result.candidates.length, 2);
  });

  it('dedupes by id before counting', () => {
    const result = normalizeCandidateResult([
      { id: 's1', name: 'Disershop' },
      { id: 's1', name: 'Disershop' },
    ]);
    assert.equal(result.status, 'resolved');
  });
});

describe('ambiguousPayloadFromToolOutput', () => {
  it('does not create candidate_selection for a single supplier', () => {
    const payload = ambiguousPayloadFromToolOutput(
      'find_supplier',
      {
        status: 'ambiguous',
        entityType: 'supplier',
        candidates: [{ id: 'sup-1', name: 'Disershop' }],
      },
      { originalUserText: 'compra de Disershop' }
    );
    assert.equal(payload, null);
  });

  it('creates candidate_selection for two suppliers', () => {
    const payload = ambiguousPayloadFromToolOutput(
      'find_supplier',
      {
        status: 'ambiguous',
        entityType: 'supplier',
        candidates: [
          { id: 's1', name: 'Disershop Centro' },
          { id: 's2', name: 'Disershop Mayorista' },
        ],
      },
      { originalUserText: 'compra Disershop' }
    );
    assert.ok(payload);
    assert.equal(payload!.options.length, 2);
  });
});

describe('isRealCandidateAmbiguity', () => {
  it('false for single candidate', () => {
    assert.equal(isRealCandidateAmbiguity([{ id: 'a', name: 'Uno' }]), false);
  });

  it('true for two candidates', () => {
    assert.equal(
      isRealCandidateAmbiguity([
        { id: 'a', name: 'Uno' },
        { id: 'b', name: 'Dos' },
      ]),
      true
    );
  });
});

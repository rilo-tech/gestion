import { createHash } from 'node:crypto';
import { db } from '../../firebase.ts';
import type {
  CashMovementRecord,
  CashPagedListOptions,
  CashPagedListResult,
  CashRepository,
} from './cash-repository.ts';

function cashIdempotencyDocId(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function mapMovementDoc(
  doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot
): CashMovementRecord {
  const data = doc.data() ?? {};
  const createdAt =
    (typeof data.createdAt === 'string' && data.createdAt) ||
    doc.createTime?.toDate().toISOString() ||
    null;
  return {
    id: doc.id,
    ...data,
    createdAt,
  };
}

export function createFirestoreCashRepository(): CashRepository {
  return {
    async loadCajaConfig(businessId: string) {
      const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
      if (!appDoc.exists) return {};
      return (appDoc.data()?.caja as Record<string, unknown>) ?? {};
    },

    async insertMovement(businessId: string, data: Record<string, unknown>) {
      const ref = await db.collection(`negocios/${businessId}/movimientos_caja`).add(data);
      return ref.id;
    },

    async getMovement(businessId: string, movementId: string) {
      const snap = await db
        .collection(`negocios/${businessId}/movimientos_caja`)
        .doc(movementId)
        .get();
      if (!snap.exists) return null;
      return mapMovementDoc(snap);
    },

    /**
     * Candado por webhook/reintento. Subcolección auxiliar, NO un tipo nuevo de
     * movimiento. Los movimientos siguen en movimientos_caja.
     */
    async insertMovementIdempotent(
      businessId: string,
      idempotencyKey: string,
      data: Record<string, unknown>
    ) {
      const hash = cashIdempotencyDocId(idempotencyKey);
      const idemRef = db.doc(`negocios/${businessId}/cash_idempotency/${hash}`);
      const col = db.collection(`negocios/${businessId}/movimientos_caja`);

      return db.runTransaction(async (tx) => {
        const snap = await tx.get(idemRef);
        if (snap.exists) {
          const movementId = String(snap.data()?.movementId ?? '');
          if (movementId) return { movementId, reused: true };
        }
        const movRef = col.doc();
        tx.set(movRef, data);
        tx.set(idemRef, {
          movementId: movRef.id,
          createdAt: data.createdAt ?? new Date().toISOString(),
        });
        return { movementId: movRef.id, reused: false };
      });
    },

    async listAllMovements(businessId: string) {
      const snapshot = await db.collection(`negocios/${businessId}/movimientos_caja`).get();
      return snapshot.docs.map((doc) => mapMovementDoc(doc));
    },

    async listMovementsPaged(
      businessId: string,
      opts: CashPagedListOptions
    ): Promise<CashPagedListResult> {
      let query: FirebaseFirestore.Query = db
        .collection(`negocios/${businessId}/movimientos_caja`)
        .orderBy('fecha', 'desc');

      if (opts.startIso && opts.endIso) {
        query = query.where('fecha', '>=', opts.startIso).where('fecha', '<=', opts.endIso);
      }

      query = query.limit(opts.limit + 1);

      if (opts.cursor) {
        const cursorSnap = await db
          .collection(`negocios/${businessId}/movimientos_caja`)
          .doc(opts.cursor)
          .get();
        if (cursorSnap.exists) {
          query = query.startAfter(cursorSnap);
        }
      }

      const snapshot = await query.get();
      const hasMore = snapshot.docs.length > opts.limit;
      const pageDocs = hasMore ? snapshot.docs.slice(0, opts.limit) : snapshot.docs;
      return {
        items: pageDocs.map((doc) => mapMovementDoc(doc)),
        hasMore,
        nextCursor: hasMore && pageDocs.length > 0 ? pageDocs[pageDocs.length - 1]!.id : null,
      };
    },
  };
}

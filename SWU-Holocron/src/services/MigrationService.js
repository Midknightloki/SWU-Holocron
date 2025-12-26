import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';

const BATCH_COMMIT_SIZE = 400; // stay under Firestore 500 limit

export const MigrationService = {
  async migrateCollection(db, oldPathSegments, newPathSegments) {
    const sourceRef = collection(db, ...oldPathSegments);
    const snapshot = await getDocs(sourceRef);

    if (snapshot.empty) {
      return { migrated: 0 };
    }

    let batch = writeBatch(db);
    let batchCount = 0;
    let migrated = 0;

    for (const docSnap of snapshot.docs) {
      batch.set(doc(db, ...newPathSegments, docSnap.id), docSnap.data(), { merge: true });
      batchCount += 1;
      migrated += 1;

      if (batchCount >= BATCH_COMMIT_SIZE) {
        await batch.commit();
        batch = writeBatch(db);
        batchCount = 0;
      }
    }

    if (batchCount > 0) {
      await batch.commit();
    }

    return { migrated };
  },
};

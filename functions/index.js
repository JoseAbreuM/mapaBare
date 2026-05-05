const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');

if (!admin.apps.length) {
  admin.initializeApp();
}

function toSerializable(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(toSerializable);

  if (value instanceof admin.firestore.Timestamp) {
    return {
      __type: 'timestamp',
      iso: value.toDate().toISOString(),
      seconds: value.seconds,
      nanoseconds: value.nanoseconds
    };
  }

  if (value instanceof admin.firestore.GeoPoint) {
    return {
      __type: 'geopoint',
      latitude: value.latitude,
      longitude: value.longitude
    };
  }

  if (value instanceof admin.firestore.DocumentReference) {
    return {
      __type: 'document-reference',
      path: value.path,
      id: value.id
    };
  }

  if (value instanceof Date) {
    return {
      __type: 'date',
      iso: value.toISOString()
    };
  }

  if (typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((key) => {
      out[key] = toSerializable(value[key]);
    });
    return out;
  }

  return value;
}

async function dumpCollectionRecursive(collectionRef) {
  const snapshot = await collectionRef.get();
  const documents = [];

  for (const doc of snapshot.docs) {
    const rawData = doc.data();
    const subcollections = await doc.ref.listCollections();
    const nested = {};

    for (const subCol of subcollections) {
      nested[subCol.id] = await dumpCollectionRecursive(subCol);
    }

    documents.push({
      id: doc.id,
      path: doc.ref.path,
      data: toSerializable(rawData),
      subcollections: nested
    });
  }

  return {
    id: collectionRef.id,
    path: collectionRef.path,
    documentCount: documents.length,
    documents
  };
}

exports.exportFirestoreJson = onRequest({ region: 'us-central1', cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  const configuredSecret = process.env.EXPORT_SECRET || '';
  if (configuredSecret) {
    const incomingSecret = (req.body && req.body.secret) || '';
    if (incomingSecret !== configuredSecret) {
      res.status(403).json({ error: 'Invalid export secret.' });
      return;
    }
  }

  try {
    const db = admin.firestore();
    const rootCollections = await db.listCollections();
    const collectionsDump = {};

    for (const col of rootCollections) {
      collectionsDump[col.id] = await dumpCollectionRecursive(col);
    }

    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const filename = `firestore-full-backup-${ts}.json`;

    const payload = {
      metadata: {
        source: 'cloud-function',
        exportedAt: now.toISOString(),
        projectId: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || null,
        rootCollectionCount: rootCollections.length,
        rootCollections: rootCollections.map((col) => col.id)
      },
      collections: collectionsDump
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (error) {
    console.error('Error exporting Firestore:', error);
    res.status(500).json({
      error: 'Failed to export Firestore.',
      details: error && error.message ? error.message : 'Unknown error'
    });
  }
});

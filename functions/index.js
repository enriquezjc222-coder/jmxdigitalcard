const {onSchedule} = require("firebase-functions/v2/scheduler");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, Timestamp} = require("firebase-admin/firestore");
initializeApp();

exports.cleanupExpiredBusinessLeads = onSchedule({schedule: "every 60 minutes", timeZone: "America/Chicago"}, async () => {
  const db = getFirestore();
  const expired = await db.collectionGroup("items").where("expiresAt", "<=", Timestamp.now()).limit(400).get();
  if (expired.empty) return;
  const batch = db.batch();
  expired.docs.forEach((snap) => {
    // Only delete documents under /leads/{cardId}/items/{leadId}.
    const parts = snap.ref.path.split("/");
    if (parts.length === 4 && parts[0] === "leads" && parts[2] === "items") batch.delete(snap.ref);
  });
  await batch.commit();
});

// TEST MOCK of firebase-app (served only by the integration test harness, never deployed).
export function initializeApp(config) { return { __app: true, options: config }; }
export function getApp() { return { __app: true }; }

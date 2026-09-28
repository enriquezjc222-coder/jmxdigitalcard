// TEST MOCK of firebase-functions. Implements only the callables the tested pages use.
const DB_KEY = '__jmx_mock_db__';
const CALLS_KEY = '__jmx_mock_calls__';
export function getFunctions() { return { __functions: true }; }
export function httpsCallable(fns, name) {
  return async (data) => {
    const calls = JSON.parse(localStorage.getItem(CALLS_KEY) || '[]'); calls.push({ name, data }); localStorage.setItem(CALLS_KEY, JSON.stringify(calls));
    const db = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
    if (name === 'resolveNfcDevice') {
      const d = db[`nfcDevices/${data.deviceId}`];
      if (!d) throw new Error('This NFC device is not registered with JMX Digital Card.');
      if (d.status === 'disabled') throw new Error('disabled');
      return { data: { ok: true, cardId: d.cardId } };
    }
    return { data: { ok: true } };
  };
}

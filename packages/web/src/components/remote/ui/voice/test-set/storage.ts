import { exportTestSet, importTestSet } from "./format";
import type { TestSet } from "./model";

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("remote-voice-test-set", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("sessions");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other test-set tabs to open local storage"));
  });
}

export async function loadSession(): Promise<TestSet | null> {
  const db = await database();
  try {
    const value: unknown = await new Promise((resolve, reject) => {
      const request = db.transaction("sessions").objectStore("sessions").get("active");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    if (value === undefined) return null;
    if (typeof value !== "string") throw new Error("Local session format is invalid");
    return importTestSet(value);
  } finally { db.close(); }
}

export async function saveSession(set: TestSet): Promise<void> {
  const value = exportTestSet(set); const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("sessions", "readwrite");
      transaction.objectStore("sessions").put(value, "active");
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

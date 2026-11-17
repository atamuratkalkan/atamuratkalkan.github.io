const DATABASE = 'ata-paint-studio';
let connection;
function open() {
  if (!connection) connection = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('Local project storage is unavailable. Export a project file instead.'));
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { const db = request.result; db.createObjectStore('projects', { keyPath: 'id' }); db.createObjectStore('preferences'); };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); connection = null; }; resolve(request.result); };
    request.onerror = () => { connection = null; reject(new Error('Could not open local storage. Use project export to keep your work.')); };
    request.onblocked = () => reject(new Error('Close other Paint Studio tabs to upgrade local storage.'));
  });
  return connection;
}
async function transaction(store, mode, action) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode), request = action(tx.objectStore(store));
    let result;
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(new Error('Local storage failed or is full. Export a project file before closing this tab.'));
  });
}
export const saveProject = project => transaction('projects', 'readwrite', store => store.put(project));
export const loadProject = id => transaction('projects', 'readonly', store => store.get(id));
export const listProjects = async () => (await transaction('projects', 'readonly', store => store.getAll())).map(p => ({ id: p.id, name: p.name, savedAt: p.savedAt }));
export const saveInventory = paints => transaction('preferences', 'readwrite', store => store.put(paints, 'inventory-v1'));
export const loadInventory = () => transaction('preferences', 'readonly', store => store.get('inventory-v1'));

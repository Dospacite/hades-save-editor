/* Progressive local-folder access for browsers with and without File System Access. */
(function attachFileAccess(global) {
  "use strict";

  const DATABASE_NAME = "hades-save-editor";
  const DATABASE_VERSION = 1;
  const HANDLE_STORE = "handles";
  const SAVE_DIRECTORY_KEY = "save-directory";
  const SAVE_FILE_KEY = "save-file";
  const SAVE_FILE_PATTERN = /^Profile\d+(?:_Temp)?\.sav$/i;
  const SAVE_FOLDER_PATTERN = /^(?:Hades(?: II)?|Saved Games|Supergiant Games)$/i;

  function isSaveFileName(name) {
    return SAVE_FILE_PATTERN.test(name);
  }

  function isTemporarySaveFileName(name) {
    return isSaveFileName(name) && /_Temp\.sav$/i.test(name);
  }

  function candidateFile(candidate) {
    return candidate?.file || candidate;
  }

  function sortSaveCandidates(candidates) {
    return Array.from(candidates || [])
      .filter((candidate) => isSaveFileName(candidateFile(candidate)?.name || ""))
      .sort((left, right) => {
        const leftFile = candidateFile(left);
        const rightFile = candidateFile(right);
        const modifiedDifference = (rightFile.lastModified || 0) - (leftFile.lastModified || 0);
        if (modifiedDifference !== 0) return modifiedDifference;

        const leftIsTemporary = isTemporarySaveFileName(leftFile.name);
        const rightIsTemporary = isTemporarySaveFileName(rightFile.name);
        if (leftIsTemporary !== rightIsTemporary) return rightIsTemporary ? 1 : -1;
        return leftFile.name.localeCompare(rightFile.name, undefined, { numeric: true });
      });
  }

  function chooseLatestSave(candidates) {
    return sortSaveCandidates(candidates)[0] || null;
  }

  function supportsDirectoryPicker() {
    return global.isSecureContext !== false && typeof global.showDirectoryPicker === "function";
  }

  function supportsOpenFilePicker() {
    return global.isSecureContext !== false && typeof global.showOpenFilePicker === "function";
  }

  function openDatabase() {
    if (!global.indexedDB) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const request = global.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(HANDLE_STORE)) {
          request.result.createObjectStore(HANDLE_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function withStore(mode, operation) {
    const database = await openDatabase();
    if (!database) return null;
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(HANDLE_STORE, mode);
        const request = operation(transaction.objectStore(HANDLE_STORE));
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }

  async function getRememberedDirectory() {
    try {
      return await withStore("readonly", (store) => store.get(SAVE_DIRECTORY_KEY));
    } catch (error) {
      console.warn("Could not restore the saved directory handle.", error);
      return null;
    }
  }

  async function getRememberedFile() {
    try {
      return await withStore("readonly", (store) => store.get(SAVE_FILE_KEY));
    } catch (error) {
      console.warn("Could not restore the saved file handle.", error);
      return null;
    }
  }

  async function rememberDirectory(handle) {
    try {
      await withStore("readwrite", (store) => store.put(handle, SAVE_DIRECTORY_KEY));
      return true;
    } catch (error) {
      console.warn("Could not remember the selected directory handle.", error);
      return false;
    }
  }

  async function rememberFile(handle) {
    try {
      await withStore("readwrite", (store) => store.put(handle, SAVE_FILE_KEY));
      return true;
    } catch (error) {
      console.warn("Could not remember the selected file handle.", error);
      return false;
    }
  }

  async function clearRememberedDirectory() {
    try {
      await withStore("readwrite", (store) => store.delete(SAVE_DIRECTORY_KEY));
    } catch (error) {
      console.warn("Could not clear the saved directory handle.", error);
    }
  }

  async function queryPermission(handle) {
    if (!handle || typeof handle.queryPermission !== "function") return "granted";
    return handle.queryPermission({ mode: "read" });
  }

  async function requestPermission(handle) {
    const current = await queryPermission(handle);
    if (current === "granted") return true;
    if (current === "denied" || typeof handle.requestPermission !== "function") return false;
    return (await handle.requestPermission({ mode: "read" })) === "granted";
  }

  async function pickDirectory(startIn = "documents") {
    if (!supportsDirectoryPicker()) return null;
    return global.showDirectoryPicker({
      id: "hades-save-folder",
      startIn,
      mode: "read",
    });
  }

  async function pickSaveFile(startIn = "documents") {
    if (!supportsOpenFilePicker()) return null;
    const handles = await global.showOpenFilePicker({
      id: "hades-save-file",
      startIn,
      multiple: false,
      types: [{
        description: "Hades save files",
        accept: { "application/octet-stream": [".sav"] },
      }],
    });
    return handles[0] || null;
  }

  async function collectDirectorySaves(directoryHandle, path, depth, candidates) {
    const childDirectories = [];
    for await (const entry of directoryHandle.values()) {
      if (entry.kind === "file" && isSaveFileName(entry.name)) {
        candidates.push({
          file: await entry.getFile(),
          fileHandle: entry,
          directoryHandle,
          relativePath: `${path}/${entry.name}`,
        });
      } else if (entry.kind === "directory" && depth < 2 && SAVE_FOLDER_PATTERN.test(entry.name)) {
        childDirectories.push(entry);
      }
    }

    for (const child of childDirectories) {
      await collectDirectorySaves(child, `${path}/${child.name}`, depth + 1, candidates);
    }
  }

  async function listSaveFiles(directoryHandle) {
    const candidates = [];
    await collectDirectorySaves(directoryHandle, directoryHandle.name, 0, candidates);
    return sortSaveCandidates(candidates);
  }

  async function findLatestSave(directoryHandle) {
    return chooseLatestSave(await listSaveFiles(directoryHandle));
  }

  function listSelectedSaveFiles(files) {
    return sortSaveCandidates(Array.from(files || []).map((file) => ({
      file,
      relativePath: file.webkitRelativePath || file.name,
    })));
  }

  function findLatestSelectedFile(files) {
    return chooseLatestSave(listSelectedSaveFiles(files));
  }

  global.HadesFileAccess = Object.freeze({
    clearRememberedDirectory,
    findLatestSave,
    findLatestSelectedFile,
    getRememberedDirectory,
    getRememberedFile,
    isSaveFileName,
    isTemporarySaveFileName,
    listSaveFiles,
    listSelectedSaveFiles,
    pickDirectory,
    pickSaveFile,
    queryPermission,
    rememberDirectory,
    rememberFile,
    requestPermission,
    supportsDirectoryPicker,
    supportsOpenFilePicker,
    chooseLatestSave,
    sortSaveCandidates,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);

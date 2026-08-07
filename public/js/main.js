/* global HadesEditorCatalog, HadesEditorSearch, HadesFileAccess, HadesSaveCodec */

(function startEditor(global) {
  "use strict";

  const SAVE_HEADER_READ_SIZE = 512;

  const state = {
    document: null,
    sourceBytes: null,
    sourceFileName: "Profile1.sav",
    activeSection: null,
    changedPaths: new Map(),
    query: "",
    directoryHandle: null,
    fileHandle: null,
    saveListGeneration: 0,
    statusTimer: null,
    dialogTrigger: null,
  };

  const elements = {
    uploadView: document.getElementById("upload-view"),
    editorView: document.getElementById("editor-view"),
    dropZone: document.getElementById("drop-zone"),
    chooseFileButton: document.getElementById("choose-save-file"),
    fileInput: document.getElementById("file-input"),
    folderInput: document.getElementById("folder-input"),
    openFolderButton: document.getElementById("open-save-folder"),
    openFolderLabel: document.getElementById("open-save-folder-label"),
    changeFolderButton: document.getElementById("change-save-folder"),
    replaceButton: document.getElementById("replace-file"),
    fileName: document.getElementById("loaded-file-name"),
    gameBadge: document.getElementById("game-badge"),
    saveVersion: document.getElementById("save-version"),
    runCount: document.getElementById("run-count"),
    tabList: document.getElementById("section-tabs"),
    panel: document.getElementById("editor-panel"),
    panelTitle: document.getElementById("panel-title"),
    panelCount: document.getElementById("panel-count"),
    search: document.getElementById("field-search"),
    clearSearch: document.getElementById("clear-search"),
    editedCount: document.getElementById("edited-count"),
    resetButton: document.getElementById("reset-changes"),
    outputName: document.getElementById("output-name"),
    downloadButton: document.getElementById("download-save"),
    status: document.getElementById("app-status"),
    uploadError: document.getElementById("upload-error"),
    saveFileBrowser: document.getElementById("save-file-browser"),
    saveFolderName: document.getElementById("save-folder-name"),
    saveFileList: document.getElementById("save-file-list"),
    saveFileEmpty: document.getElementById("save-file-empty"),
    openChangesButton: document.getElementById("open-changes"),
    changesDialog: document.getElementById("changes-dialog"),
    closeChangesButton: document.getElementById("close-changes"),
    openSaveLocationsButton: document.getElementById("open-save-locations"),
    saveLocationsDialog: document.getElementById("save-locations-dialog"),
    closeSaveLocationsButton: document.getElementById("close-save-locations"),
  };

  function getAtPath(root, path) {
    return path.split(".").reduce(
      (value, key) => (value == null ? undefined : value[key]),
      root,
    );
  }

  function setAtPath(root, path, value) {
    const parts = path.split(".");
    let target = root;
    parts.forEach((key, index) => {
      if (index === parts.length - 1) {
        target[key] = value;
        return;
      }
      if (target[key] == null || typeof target[key] !== "object") {
        target[key] = Object.create(null);
      }
      target = target[key];
    });
  }

  function valuesMatch(left, right) {
    return Object.is(left, right);
  }

  function recordChange(path, value) {
    if (!state.changedPaths.has(path)) {
      state.changedPaths.set(path, getAtPath(state.document, path));
    }
    const original = state.changedPaths.get(path);
    setAtPath(state.document, path, value);
    if (valuesMatch(original, value)) {
      state.changedPaths.delete(path);
    }
  }

  function applyEffects(field, value) {
    (field.effects || []).forEach((effect) => {
      if (effect.when === "truthy" && !value) return;
      recordChange(effect.path, effect.value);
    });
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function formatKey(value) {
    if (/^\d+(\.\d+)?$/.test(value)) return value;
    return value
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .replace(/^./, (character) => character.toUpperCase());
  }

  function getCatalog() {
    if (!state.document) return null;
    const catalog = HadesEditorCatalog[state.document.game];
    if (HadesFileAccess.isTemporarySaveFileName(state.sourceFileName)) return catalog;
    return {
      ...catalog,
      sections: catalog.sections.filter((section) => section.id !== "current-run"),
    };
  }

  function getActiveSection() {
    return getCatalog().sections.find((section) => section.id === state.activeSection);
  }

  function setStatus(message, type = "neutral") {
    if (state.statusTimer) global.clearTimeout(state.statusTimer);
    elements.status.textContent = message;
    elements.status.dataset.type = type;
    state.statusTimer = null;
    if (message && type !== "error") {
      state.statusTimer = global.setTimeout(() => {
        if (elements.status.textContent === message) elements.status.textContent = "";
      }, 4500);
    }
  }

  function setUploadError(message = "") {
    elements.uploadError.textContent = message;
    elements.uploadError.hidden = !message;
  }

  function openDialog(dialog, initialFocus) {
    if (dialog.open) return;
    state.dialogTrigger = document.activeElement;
    dialog.showModal();
    initialFocus.focus();
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
  }

  function connectDialog(openButton, dialog, closeButton) {
    openButton.addEventListener("click", () => openDialog(dialog, closeButton));
    closeButton.addEventListener("click", () => closeDialog(dialog));
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
    dialog.addEventListener("close", () => {
      if (state.dialogTrigger instanceof HTMLElement) state.dialogTrigger.focus();
      state.dialogTrigger = null;
    });
  }

  function updateChangeSummary() {
    const count = state.changedPaths.size;
    elements.editedCount.textContent = count === 1 ? "1 value edited" : `${count} values edited`;
    elements.resetButton.disabled = count === 0;
  }

  function formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "Unknown size";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatSaveDate(timestamp) {
    const date = new Date(Number(timestamp) * 1000);
    if (!Number.isFinite(date.getTime())) return "Unknown date";
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }

  function formatSaveLocation(location) {
    if (!location) return "Unknown location";
    return formatKey(String(location).replace(/^Location_/, ""));
  }

  async function inspectSaveCandidate(candidate) {
    try {
      const bytes = await candidate.file.slice(0, SAVE_HEADER_READ_SIZE).arrayBuffer();
      return { header: HadesSaveCodec.inspectHeader(bytes) };
    } catch (error) {
      return { error };
    }
  }

  function createSaveFileListItem(candidate, summary) {
    const item = createElement("div", "save-file-list__item");
    item.setAttribute("role", "listitem");

    const button = createElement("button", "save-file-entry");
    button.type = "button";
    button.addEventListener("click", () => loadFile(candidate.file));

    const copy = createElement("span", "save-file-entry__copy");
    const title = createElement("span", "save-file-entry__title");
    title.append(createElement("strong", "", candidate.file.name));
    if (HadesFileAccess.isTemporarySaveFileName(candidate.file.name)) {
      title.append(createElement("span", "save-file-entry__badge", "Active run"));
    }
    copy.append(title);

    if (summary.header) {
      const { game, save_data: saveData } = summary.header;
      const gameLabel = HadesEditorCatalog[game]?.label || game;
      const runLabel = saveData.runs === 1 ? "1 run" : `${saveData.runs} runs`;
      copy.append(
        createElement(
          "span",
          "save-file-entry__meta",
          `${gameLabel} · ${runLabel} · ${formatSaveLocation(saveData.location)}`,
        ),
        createElement(
          "span",
          "save-file-entry__meta",
          `Saved ${formatSaveDate(saveData.timestamp)} · ${formatFileSize(candidate.file.size)}`,
        ),
      );
      button.setAttribute(
        "aria-label",
        `Open ${candidate.file.name}, ${gameLabel}, ${runLabel}, saved ${formatSaveDate(saveData.timestamp)}`,
      );
    } else {
      copy.append(createElement(
        "span",
        "save-file-entry__meta",
        `Header unavailable · ${formatFileSize(candidate.file.size)}`,
      ));
      button.setAttribute("aria-label", `Open ${candidate.file.name}`);
    }

    button.append(copy, createElement("span", "save-file-entry__action", "Open"));
    item.append(button);
    return item;
  }

  async function renderSaveFileList(candidates, folderName) {
    const generation = ++state.saveListGeneration;
    elements.saveFileBrowser.hidden = false;
    elements.saveFolderName.textContent = folderName;
    elements.saveFileEmpty.hidden = true;
    elements.saveFileList.hidden = false;
    elements.saveFileList.setAttribute("aria-busy", "true");
    elements.saveFileList.replaceChildren();

    if (candidates.length === 0) {
      elements.saveFileList.hidden = true;
      elements.saveFileEmpty.hidden = false;
      elements.saveFileList.removeAttribute("aria-busy");
      return;
    }

    const summaries = await Promise.all(candidates.map(inspectSaveCandidate));
    if (generation !== state.saveListGeneration) return;
    const fragment = document.createDocumentFragment();
    candidates.forEach((candidate, index) => {
      fragment.append(createSaveFileListItem(candidate, summaries[index]));
    });
    elements.saveFileList.replaceChildren(fragment);
    elements.saveFileList.removeAttribute("aria-busy");
  }

  function markEdited(container, path) {
    container.classList.toggle("is-edited", state.changedPaths.has(path));
  }

  function markAnyEdited(container, paths) {
    container.classList.toggle(
      "is-edited",
      paths.some((path) => state.changedPaths.has(path)),
    );
  }

  function makeMissingNote() {
    return createElement("span", "field__missing", "Not in save");
  }

  function makeFieldIcon(field) {
    if (!field.icon) return null;
    const icon = createElement("img", "field__icon");
    icon.src = field.icon;
    icon.alt = "";
    icon.width = 70;
    icon.height = 70;
    icon.loading = "lazy";
    icon.decoding = "async";
    return icon;
  }

  function renderNumberField(field, id, path = field.path, label = field.label) {
    const value = getAtPath(state.document, path);
    const row = createElement("div", "field");
    row.dataset.search = `${field.label} ${field.group || ""} ${label}`.toLowerCase();
    markEdited(row, path);

    const labelElement = createElement("label", "field__label");
    labelElement.htmlFor = id;
    const labelCopy = createElement("span", "field__label-copy");
    labelCopy.append(createElement("span", "field__label-text", label));
    const meta = createElement("span", "field__meta");
    if (field.suffix) meta.append(createElement("span", "field__suffix", field.suffix));
    if (value === undefined) meta.append(makeMissingNote());
    labelCopy.append(meta);
    const icon = makeFieldIcon(field);
    labelElement.append(...[icon, labelCopy].filter(Boolean));

    const input = createElement("input", "field__input");
    input.type = "number";
    input.id = id;
    input.inputMode = "decimal";
    if (field.accessibleLabel) input.setAttribute("aria-label", field.accessibleLabel);
    input.step = String(field.step ?? "any");
    if (field.min !== undefined) input.min = String(field.min);
    if (field.max !== undefined) input.max = String(field.max);
    if (typeof value === "number" && Number.isFinite(value)) input.value = String(value);
    input.placeholder = "—";

    input.addEventListener("change", () => {
      if (input.value.trim() === "") return;
      const nextValue = Number(input.value);
      if (!Number.isFinite(nextValue) || !input.checkValidity()) {
        input.reportValidity();
        return;
      }
      recordChange(path, nextValue);
      applyEffects(field, nextValue);
      row.querySelector(".field__missing")?.remove();
      markEdited(row, path);
      updateChangeSummary();
    });

    row.append(labelElement, input);
    return row;
  }

  function renderToggleField(field, id) {
    const value = getAtPath(state.document, field.path);
    const label = createElement("label", "toggle-field");
    label.htmlFor = id;
    label.dataset.search = `${field.label} ${field.group || ""}`.toLowerCase();
    markEdited(label, field.path);

    const input = createElement("input", "toggle-field__input");
    input.type = "checkbox";
    input.id = id;
    input.checked = Boolean(value);
    if (field.accessibleLabel) input.setAttribute("aria-label", field.accessibleLabel);

    const control = createElement("span", "toggle-field__control");
    control.setAttribute("aria-hidden", "true");
    const copy = createElement("span", "toggle-field__copy");
    copy.append(createElement("span", "toggle-field__label", field.label));
    if (value === undefined) copy.append(makeMissingNote());

    input.addEventListener("change", () => {
      const nextValue = field.storedAsByte ? Number(input.checked) : input.checked;
      recordChange(field.path, nextValue);
      applyEffects(field, input.checked);
      copy.querySelector(".field__missing")?.remove();
      markEdited(label, field.path);
      updateChangeSummary();
    });

    label.append(input, control, copy);
    return label;
  }

  function renderObjectField(field, id) {
    const value = getAtPath(state.document, field.path);
    const card = createElement("fieldset", "object-field");
    card.dataset.search = `${field.label} ${field.group || ""}`.toLowerCase();
    const legend = createElement("legend", "object-field__title", field.label);
    card.append(legend);

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      card.append(makeMissingNote());
      return card;
    }

    const excluded = new Set(field.exclude || []);
    const keys = Object.keys(value).filter((key) => {
      const child = value[key];
      return !excluded.has(key) && (typeof child === "number" || typeof child === "boolean");
    });

    if (keys.length === 0) {
      card.append(createElement("span", "field__missing", "No editable values"));
      return card;
    }

    const fields = createElement("div", "object-field__fields");
    keys.forEach((key, index) => {
      const childPath = `${field.path}.${key}`;
      const childId = `${id}-${index}`;
      const childValue = value[key];
      const childField = {
        ...field,
        label: formatKey(key),
        accessibleLabel: `${field.label}: ${formatKey(key)}`,
        path: childPath,
        step: Number.isInteger(childValue) ? 1 : "any",
      };
      const child = typeof childValue === "boolean"
        ? renderToggleField(childField, childId)
        : renderNumberField(childField, childId, childPath, formatKey(key));
      fields.append(child);
    });
    card.append(fields);
    return card;
  }

  function renderArcanaField(field, id) {
    const levelPath = `${field.path}.Level`;
    const unlockedPath = `${field.path}.Unlocked`;
    const levelValue = getAtPath(state.document, levelPath);
    const unlockedValue = getAtPath(state.document, unlockedPath);
    const editedPaths = [levelPath, unlockedPath];
    const card = createElement("fieldset", "arcana-card");
    card.dataset.position = String(field.position);
    markAnyEdited(card, editedPaths);

    const legend = createElement("legend", "visually-hidden", field.label);
    const visual = createElement("div", "arcana-card__visual");
    const art = createElement("img", "arcana-card__art");
    art.src = field.icon;
    art.alt = "";
    art.width = 276;
    art.height = 429;
    art.loading = "lazy";
    art.decoding = "async";
    const grasp = createElement("span", "arcana-card__grasp", String(field.grasp));
    grasp.setAttribute("aria-label", `${field.grasp} Grasp`);
    grasp.title = `${field.grasp} Grasp`;
    visual.append(art, grasp);

    const body = createElement("div", "arcana-card__body");
    body.append(createElement("h3", "arcana-card__name", field.label));
    const controls = createElement("div", "arcana-card__controls");

    const rankLabel = createElement("label", "arcana-card__rank");
    rankLabel.htmlFor = `${id}-rank`;
    rankLabel.append(createElement("span", "arcana-card__control-label", "Rank"));
    const rank = createElement("select", "arcana-card__select");
    rank.id = `${id}-rank`;
    rank.setAttribute("aria-label", `${field.label} rank`);
    const availableLevels = [1, 2, 3];
    if (Number.isInteger(levelValue) && !availableLevels.includes(levelValue)) {
      availableLevels.push(levelValue);
      availableLevels.sort((left, right) => left - right);
    }
    if (!Number.isInteger(levelValue)) {
      const missingOption = createElement("option", "", "—");
      missingOption.value = "";
      missingOption.selected = true;
      missingOption.disabled = true;
      rank.append(missingOption);
    }
    availableLevels.forEach((level) => {
      const option = createElement("option", "", ["I", "II", "III"][level - 1] || String(level));
      option.value = String(level);
      option.selected = level === levelValue;
      rank.append(option);
    });
    rank.addEventListener("change", () => {
      recordChange(levelPath, Number(rank.value));
      markAnyEdited(card, editedPaths);
      updateChangeSummary();
    });
    rankLabel.append(rank);

    const unlockedLabel = createElement("label", "arcana-card__unlock");
    const unlocked = createElement("input", "arcana-card__checkbox");
    unlocked.type = "checkbox";
    unlocked.id = `${id}-unlocked`;
    unlocked.checked = Boolean(unlockedValue);
    unlocked.setAttribute("aria-label", `${field.label} unlocked`);
    unlocked.addEventListener("change", () => {
      recordChange(unlockedPath, unlocked.checked);
      markAnyEdited(card, editedPaths);
      updateChangeSummary();
    });
    unlockedLabel.htmlFor = unlocked.id;
    unlockedLabel.append(unlocked, createElement("span", "", "Unlocked"));

    controls.append(rankLabel, unlockedLabel);
    body.append(controls);
    card.append(legend, visual, body);
    return card;
  }

  function renderField(field, index) {
    const id = `field-${state.activeSection}-${index}`;
    if (field.type === "arcana") return renderArcanaField(field, id);
    if (field.type === "toggle") return renderToggleField(field, id);
    if (field.type === "object") return renderObjectField(field, id);
    return renderNumberField(field, id);
  }

  function getSearchResults() {
    return HadesEditorSearch.searchSections(getCatalog(), state.query);
  }

  function renderSection(results = getSearchResults()) {
    const result = results.find(({ section }) => section.id === state.activeSection);
    const section = result?.section || getActiveSection();
    const visibleFields = result?.fields || [];

    elements.panelTitle.textContent = section.label;
    if (state.query.trim()) {
      elements.panelCount.textContent = visibleFields.length === 1 ? "1 match" : `${visibleFields.length} matches`;
    } else {
      const itemName = section.layout === "arcana" ? "card" : "value";
      elements.panelCount.textContent = section.fields.length === 1
        ? `1 ${itemName}`
        : `${section.fields.length} ${itemName}s`;
    }
    const grid = createElement(
      "div",
      section.layout === "arcana" ? "fields-grid fields-grid--arcana" : "fields-grid",
    );
    let previousGroup = null;

    visibleFields.forEach((field) => {
      if (field.group && field.group !== previousGroup) {
        const heading = createElement("h3", "fields-grid__group", field.group);
        grid.append(heading);
        previousGroup = field.group;
      } else if (!field.group) {
        previousGroup = null;
      }
      const fieldIndex = section.fields.indexOf(field);
      grid.append(renderField(field, fieldIndex));
    });

    if (visibleFields.length === 0) {
      const empty = createElement("p", "empty-state", "No matching values.");
      elements.panel.replaceChildren(empty);
    } else {
      elements.panel.replaceChildren(grid);
    }

    const activeTab = elements.tabList.querySelector('[aria-selected="true"]');
    if (activeTab) elements.panel.setAttribute("aria-labelledby", activeTab.id);
  }

  function syncTabs(results) {
    const hasQuery = Boolean(state.query.trim());
    const hasAnyMatches = results.some(({ fields }) => fields.length > 0);
    results.forEach(({ section, fields }) => {
      const tab = elements.tabList.querySelector(`[data-section="${section.id}"]`);
      const selected = section.id === state.activeSection;
      tab.hidden = hasQuery && hasAnyMatches && fields.length === 0;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.querySelector(".section-tab__count").textContent = String(
        hasQuery ? fields.length : section.fields.length,
      );
    });
  }

  function renderSearchState(focusPanel = false) {
    const results = getSearchResults();
    state.activeSection = HadesEditorSearch.chooseSectionId(results, state.activeSection);
    syncTabs(results);
    renderSection(results);
    elements.panel.scrollTop = 0;
    if (focusPanel) elements.panelTitle.focus();
  }

  function selectSection(sectionId, focusPanel = false) {
    state.activeSection = sectionId;
    renderSearchState(focusPanel);
  }

  function handleTabKeyboard(event) {
    const tabs = Array.from(elements.tabList.querySelectorAll('[role="tab"]'))
      .filter((tab) => !tab.hidden);
    const currentIndex = tabs.indexOf(event.currentTarget);
    let nextIndex = currentIndex;
    if (["ArrowRight", "ArrowDown"].includes(event.key)) nextIndex = (currentIndex + 1) % tabs.length;
    if (["ArrowLeft", "ArrowUp"].includes(event.key)) nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === currentIndex && !["Home", "End"].includes(event.key)) return;
    event.preventDefault();
    tabs[nextIndex].focus();
    selectSection(tabs[nextIndex].dataset.section);
  }

  function renderTabs() {
    const catalog = getCatalog();
    const fragment = document.createDocumentFragment();
    catalog.sections.forEach((section, index) => {
      const button = createElement("button", "section-tab");
      button.type = "button";
      button.id = `tab-${section.id}`;
      button.role = "tab";
      button.dataset.section = section.id;
      button.setAttribute("aria-controls", "editor-panel");
      button.setAttribute("aria-selected", String(index === 0));
      button.tabIndex = index === 0 ? 0 : -1;
      button.append(
        createElement("span", "section-tab__label", section.label),
        createElement("span", "section-tab__count", String(section.fields.length)),
      );
      button.addEventListener("click", () => selectSection(section.id, true));
      button.addEventListener("keydown", handleTabKeyboard);
      fragment.append(button);
    });
    elements.tabList.replaceChildren(fragment);
    state.activeSection = catalog.sections[0].id;
  }

  function showEditor(file) {
    const catalog = getCatalog();
    const saveData = state.document.save_data;
    elements.fileName.textContent = file.name;
    elements.gameBadge.textContent = catalog.label;
    elements.saveVersion.textContent = String(saveData.version);
    elements.runCount.textContent = String(saveData.runs);
    elements.outputName.value = file.name;
    elements.uploadView.hidden = true;
    elements.editorView.hidden = false;
    document.body.classList.add("is-editing");
    elements.search.value = "";
    elements.clearSearch.hidden = true;
    state.query = "";
    renderTabs();
    renderSearchState();
    updateChangeSummary();
    setStatus("");
    document.title = `${file.name} — Hades Save Editor`;
    global.scrollTo({ top: 0, behavior: "auto" });
    elements.panelTitle.focus({ preventScroll: true });
  }

  function showUploadView() {
    if (state.changedPaths.size > 0 && !global.confirm("Discard the current edits and choose another save?")) {
      return;
    }

    state.document = null;
    state.sourceBytes = null;
    state.sourceFileName = "Profile1.sav";
    state.activeSection = null;
    state.changedPaths.clear();
    state.query = "";
    elements.editorView.hidden = true;
    elements.uploadView.hidden = false;
    document.body.classList.remove("is-editing");
    document.title = "Hades Save Editor";
    setStatus("");
    global.scrollTo({ top: 0, behavior: "auto" });
    elements.chooseFileButton.focus({ preventScroll: true });
  }

  async function loadFile(file) {
    if (!file) return false;
    if (state.changedPaths.size > 0 && !global.confirm("Discard the current edits and open another save?")) {
      elements.fileInput.value = "";
      return false;
    }

    setUploadError();
    setStatus("Reading save…");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const documentData = HadesSaveCodec.decode(bytes);
      state.document = documentData;
      state.sourceBytes = bytes;
      state.sourceFileName = file.name;
      state.changedPaths.clear();
      showEditor(file);
      return true;
    } catch (error) {
      const message = error instanceof HadesSaveCodec.SaveFormatError
        ? error.message
        : "The save file could not be read.";
      setUploadError(message);
      if (!state.document) {
        elements.uploadView.hidden = false;
        elements.editorView.hidden = true;
        document.body.classList.remove("is-editing");
        setStatus("");
      } else {
        setStatus(message, "error");
      }
      return false;
    } finally {
      elements.fileInput.value = "";
      elements.dropZone.classList.remove("is-dragging");
    }
  }

  function resetChanges() {
    if (state.changedPaths.size === 0) return;
    if (!global.confirm("Reset all edits made in this session?")) return;
    try {
      state.document = HadesSaveCodec.decode(state.sourceBytes);
      state.changedPaths.clear();
      renderSearchState();
      updateChangeSummary();
      setStatus("All edits were reset.", "success");
    } catch (error) {
      console.error(error);
      setStatus("The original save could not be restored.", "error");
    }
  }

  function normalizedFileName() {
    const entered = elements.outputName.value.trim() || state.sourceFileName;
    return entered.toLowerCase().endsWith(".sav") ? entered : `${entered}.sav`;
  }

  function downloadSave() {
    try {
      const output = HadesSaveCodec.encode(state.document);
      HadesSaveCodec.decode(output);
      const blob = new Blob([output], { type: "application/octet-stream" });
      const url = global.URL.createObjectURL(blob);
      const link = createElement("a");
      link.href = url;
      link.download = normalizedFileName();
      document.body.append(link);
      link.click();
      link.remove();
      global.setTimeout(() => global.URL.revokeObjectURL(url), 30000);
      setStatus("Save validated and downloaded.", "success");
    } catch (error) {
      const message = error instanceof HadesSaveCodec.SaveFormatError
        ? error.message
        : "The edited save could not be generated.";
      setStatus(message, "error");
    }
  }

  function setDirectoryHandle(handle) {
    state.directoryHandle = handle;
    elements.openFolderLabel.textContent = handle ? "Open saved folder" : "Choose save folder";
    elements.changeFolderButton.hidden = !handle;
  }

  function setFileHandle(handle) {
    state.fileHandle = handle;
  }

  function setFolderError(message) {
    setStatus("");
    setUploadError(message);
  }

  async function refreshSaveFiles(directoryHandle) {
    setUploadError();
    setStatus("Reading save folder…");
    const candidates = await HadesFileAccess.listSaveFiles(directoryHandle);
    await renderSaveFileList(candidates, directoryHandle.name);
    const message = candidates.length === 1
      ? "Found 1 save file."
      : `Found ${candidates.length} save files.`;
    setStatus(message, "success");
    return candidates;
  }

  async function chooseSaveFile() {
    if (!HadesFileAccess.supportsOpenFilePicker()) {
      elements.fileInput.click();
      return;
    }

    try {
      const startIn = state.directoryHandle || state.fileHandle || "documents";
      const fileHandle = await HadesFileAccess.pickSaveFile(startIn);
      if (!fileHandle) return;
      setFileHandle(fileHandle);
      await HadesFileAccess.rememberFile(fileHandle);
      await loadFile(await fileHandle.getFile());
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.error(error);
      setFolderError("The selected save file could not be opened.");
    }
  }

  async function openSaveFolder(forcePicker = false) {
    if (!HadesFileAccess.supportsDirectoryPicker()) {
      if ("webkitdirectory" in elements.folderInput) elements.folderInput.click();
      else elements.fileInput.click();
      return;
    }

    try {
      const startIn = state.directoryHandle || state.fileHandle || "documents";
      let directoryHandle = forcePicker ? null : state.directoryHandle;
      if (directoryHandle && !(await HadesFileAccess.requestPermission(directoryHandle))) {
        await HadesFileAccess.clearRememberedDirectory();
        setDirectoryHandle(null);
        setFolderError("Folder access was not granted. Choose the save folder again.");
        return;
      }

      if (!directoryHandle) {
        directoryHandle = await HadesFileAccess.pickDirectory(startIn);
        if (!directoryHandle) return;
        setDirectoryHandle(directoryHandle);
        await HadesFileAccess.rememberDirectory(directoryHandle);
      }

      await refreshSaveFiles(directoryHandle);
    } catch (error) {
      if (error?.name === "AbortError") {
        setStatus("");
        return;
      }
      console.error(error);
      setFolderError("The selected folder could not be read. You can still choose a .sav file directly.");
    }
  }

  async function loadSelectedFolder(files) {
    const candidates = HadesFileAccess.listSelectedSaveFiles(files);
    const folderName = candidates[0]?.relativePath?.split("/")[0] || "Selected folder";
    elements.folderInput.value = "";
    await renderSaveFileList(candidates, folderName);
    const message = candidates.length === 1
      ? "Found 1 save file."
      : `Found ${candidates.length} save files.`;
    setStatus(message, "success");
  }

  async function restoreFileHandles() {
    if (!HadesFileAccess.supportsDirectoryPicker() && !HadesFileAccess.supportsOpenFilePicker()) return;
    const [directoryHandle, fileHandle] = await Promise.all([
      HadesFileAccess.getRememberedDirectory(),
      HadesFileAccess.getRememberedFile(),
    ]);
    if (fileHandle) setFileHandle(fileHandle);
    if (!directoryHandle) return;

    setDirectoryHandle(directoryHandle);
    if ((await HadesFileAccess.queryPermission(directoryHandle)) !== "granted") return;
    try {
      await refreshSaveFiles(directoryHandle);
    } catch (error) {
      console.error(error);
      setFolderError("The remembered save folder could not be read. Open it again to continue.");
    }
  }

  elements.fileInput.addEventListener("change", (event) => loadFile(event.target.files[0]));
  elements.folderInput.addEventListener("change", (event) => loadSelectedFolder(event.target.files));
  elements.chooseFileButton.addEventListener("click", chooseSaveFile);
  elements.openFolderButton.addEventListener("click", () => openSaveFolder());
  elements.changeFolderButton.addEventListener("click", () => openSaveFolder(true));
  elements.replaceButton.addEventListener("click", showUploadView);
  elements.resetButton.addEventListener("click", resetChanges);
  elements.downloadButton.addEventListener("click", downloadSave);
  connectDialog(elements.openChangesButton, elements.changesDialog, elements.closeChangesButton);
  connectDialog(
    elements.openSaveLocationsButton,
    elements.saveLocationsDialog,
    elements.closeSaveLocationsButton,
  );

  elements.search.addEventListener("input", () => {
    state.query = elements.search.value;
    elements.clearSearch.hidden = state.query.trim().length === 0;
    renderSearchState();
  });

  elements.clearSearch.addEventListener("click", () => {
    elements.search.value = "";
    state.query = "";
    elements.clearSearch.hidden = true;
    renderSearchState();
    elements.search.focus();
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("is-dragging");
    });
  });

  elements.dropZone.addEventListener("drop", (event) => loadFile(event.dataTransfer.files[0]));

  global.addEventListener("beforeunload", (event) => {
    if (state.changedPaths.size === 0) return;
    event.preventDefault();
    event.returnValue = "";
  });

  restoreFileHandles();

  global.HadesSaveEditor = Object.freeze({ getAtPath, setAtPath });
})(window);

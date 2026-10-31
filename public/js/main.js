/* global HadesCheatLimits, HadesEditorCatalog, HadesEditorSearch, HadesFieldLogic, HadesFileAccess, HadesSaveCodec */

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
    panelCountBase: "",
    explorer: { path: [], filter: "", limit: 100 },
    pendingEdit: null,
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
    cheatDialog: document.getElementById("cheat-dialog"),
    cheatList: document.getElementById("cheat-dialog-list"),
    cheatConfirmButton: document.getElementById("cheat-dialog-confirm"),
    cheatCancelButton: document.getElementById("cheat-dialog-cancel"),
  };

  function getAtPath(root, path) {
    return path.split(".").reduce(
      (value, key) => (value == null ? undefined : value[key]),
      root,
    );
  }

  // `undefined` removes the key. The save format has no "undefined".
  function setAtPath(root, path, value) {
    const parts = path.split(".");
    let target = root;
    for (let index = 0; index < parts.length; index += 1) {
      const key = parts[index];
      if (index === parts.length - 1) {
        if (value === undefined) delete target[key];
        else target[key] = value;
        return;
      }
      if (target[key] == null || typeof target[key] !== "object") {
        if (value === undefined) return;
        target[key] = Object.create(null);
      }
      target = target[key];
    }
  }

  function readValue(path) {
    return getAtPath(state.document, path);
  }

  function valuesMatch(left, right) {
    return Object.is(left, right);
  }

  // The first ancestor of `path` that setAtPath would create or replace.
  function firstMissingAncestor(path) {
    const parts = path.split(".");
    for (let index = 1; index < parts.length; index += 1) {
      const prefix = parts.slice(0, index).join(".");
      const value = getAtPath(state.document, prefix);
      if (value == null || typeof value !== "object") return { path: prefix, value };
    }
    return null;
  }

  function recordChange(path, value) {
    const edit = state.pendingEdit;
    if (edit && !edit.writes.has(path)) {
      edit.writes.set(path, { value: getAtPath(state.document, path), created: firstMissingAncestor(path) });
    }
    if (!state.changedPaths.has(path)) {
      state.changedPaths.set(path, getAtPath(state.document, path));
    }
    const original = state.changedPaths.get(path);
    setAtPath(state.document, path, value);
    if (valuesMatch(original, value)) {
      state.changedPaths.delete(path);
    }
  }

  // What an unchecked toggle writes. Set-like tables drop the key instead.
  function offValue(field) {
    return field.removeWhenOff ? undefined : false;
  }

  // `mirror` effects follow the field on and off. Others only apply when on.
  function applyEffects(field, active) {
    (field.effects || []).forEach((effect) => {
      if (effect.mirror) {
        recordChange(effect.path, active ? true : offValue(field));
        return;
      }
      if (effect.when === "truthy" && !active) return;
      recordChange(effect.path, effect.value);
    });
  }

  // ---------- Hades II cheat limits ----------

  function currentViolations() {
    return HadesCheatLimits.findViolations(state.document.game, getAtPath(state.document, "save_data.luabin.0"));
  }

  // Runs `apply`, which makes one edit through recordChange. If the edit
  // newly crosses a limit the game checks, asks first. Resolves to false
  // when the user undoes the edit.
  async function runEdit(apply) {
    const before = currentViolations();
    const edit = { writes: new Map() };
    state.pendingEdit = edit;
    try {
      apply();
    } finally {
      state.pendingEdit = null;
    }
    const added = HadesCheatLimits.newViolations(before, currentViolations());
    if (added.length === 0 || await askAboutCheatLimits(added)) return true;
    [...edit.writes.entries()].reverse().forEach(([path, previous]) => {
      if (previous.created) setAtPath(state.document, previous.created.path, previous.created.value);
      recordChange(path, previous.value);
    });
    return false;
  }

  function formatValue(value) {
    return typeof value === "number" ? value.toLocaleString() : String(value);
  }

  function askAboutCheatLimits(violations) {
    const dialog = elements.cheatDialog;
    const items = violations.map((violation) => {
      const item = createElement("li");
      item.append(
        createElement("strong", "", `${violation.label}: ${formatValue(violation.value)}`),
        createElement("span", "", ` (flagged at ${violation.limitText}) `),
        createElement("code", "", violation.path),
      );
      return item;
    });
    elements.cheatList.replaceChildren(...items);
    return new Promise((resolve) => {
      const trigger = document.activeElement;
      const choose = (keep) => () => dialog.close(keep ? "keep" : "undo");
      const onKeep = choose(true);
      const onUndo = choose(false);
      dialog.returnValue = "";
      elements.cheatConfirmButton.addEventListener("click", onKeep);
      elements.cheatCancelButton.addEventListener("click", onUndo);
      dialog.addEventListener("close", () => {
        elements.cheatConfirmButton.removeEventListener("click", onKeep);
        elements.cheatCancelButton.removeEventListener("click", onUndo);
        if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
        resolve(dialog.returnValue === "keep");
      }, { once: true });
      dialog.showModal();
      elements.cheatCancelButton.focus();
    });
  }

  // Redraws the panel after an undone edit, keeping the scroll position.
  function refreshAfterUndo(focusId) {
    const scrollY = global.scrollY;
    renderSection();
    updateChangeSummary();
    global.scrollTo({ top: scrollY, behavior: "auto" });
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
    setStatus("The change was undone.");
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
    updatePanelCount();
  }

  // Panel header count, plus a live total such as Fear or Grasp.
  function updatePanelCount(base = state.panelCountBase) {
    state.panelCountBase = base;
    const section = state.document && getActiveSection();
    const summary = section ? HadesFieldLogic.sectionSummary(section, readValue) : "";
    elements.panelCount.textContent = summary ? `${base} · ${summary}` : base;
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
      const runLabel = saveData.runs === undefined
        ? `version ${saveData.version}`
        : saveData.runs === 1 ? "1 run" : `${saveData.runs} runs`;
      copy.append(
        createElement(
          "span",
          "save-file-entry__meta",
          `${gameLabel} · ${runLabel} · ${formatSaveLocation(saveData.location)}`,
        ),
        createElement(
          "span",
          "save-file-entry__meta",
          `${saveData.timestamp === undefined ? "Old save" : `Saved ${formatSaveDate(saveData.timestamp)}`} · ${formatFileSize(candidate.file.size)}`,
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
      runEdit(() => {
        recordChange(path, nextValue);
        applyEffects(field, nextValue);
      }).then((kept) => {
        if (!kept) return refreshAfterUndo(input.id);
        row.querySelector(".field__missing")?.remove();
        markEdited(row, path);
        updateChangeSummary();
      });
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
    if (field.description) {
      const description = createElement("span", "toggle-field__description", field.description);
      description.id = `${id}-description`;
      input.setAttribute("aria-describedby", description.id);
      copy.append(description);
    }
    // For set-like tables a missing key just means "off".
    if (value === undefined && !field.removeWhenOff) copy.append(makeMissingNote());

    input.addEventListener("change", () => {
      let nextValue = input.checked;
      if (field.storedAsByte) nextValue = Number(input.checked);
      else if (!input.checked) nextValue = offValue(field);
      runEdit(() => {
        recordChange(field.path, nextValue);
        applyEffects(field, input.checked);
      }).then((kept) => {
        if (!kept) return refreshAfterUndo(input.id);
        copy.querySelector(".field__missing")?.remove();
        markEdited(label, field.path);
        updateChangeSummary();
      });
    });

    if (field.description) label.classList.add("toggle-field--described");
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
      runEdit(() => recordChange(levelPath, Number(rank.value))).then((kept) => {
        if (!kept) return refreshAfterUndo(rank.id);
        markAnyEdited(card, editedPaths);
        updateChangeSummary();
      });
    });
    rankLabel.append(rank);

    const unlockedLabel = createElement("label", "arcana-card__unlock");
    const unlocked = createElement("input", "arcana-card__checkbox");
    unlocked.type = "checkbox";
    unlocked.id = `${id}-unlocked`;
    unlocked.checked = Boolean(unlockedValue);
    unlocked.setAttribute("aria-label", `${field.label} unlocked`);
    unlocked.addEventListener("change", () => {
      runEdit(() => recordChange(unlockedPath, unlocked.checked)).then((kept) => {
        if (!kept) return refreshAfterUndo(unlocked.id);
        markAnyEdited(card, editedPaths);
        updateChangeSummary();
      });
    });
    unlockedLabel.htmlFor = unlocked.id;
    unlockedLabel.append(unlocked, createElement("span", "", "Unlocked"));

    controls.append(rankLabel, unlockedLabel);
    body.append(controls);
    card.append(legend, visual, body);
    return card;
  }

  // Picks one option: aspect ranks, familiar upgrades, vows, Grasp, badges.
  // Up to six options show as a segmented control, more as a select.
  function renderLevelField(field, id) {
    const paths = HadesFieldLogic.levelPaths(field);
    const level = HadesFieldLogic.currentLevel(field, readValue);
    const row = createElement("div", "field field--level");
    row.dataset.search = `${field.label} ${field.group || ""}`.toLowerCase();
    markAnyEdited(row, paths);

    const header = createElement("div", "field__label");
    const copy = createElement("span", "field__label-copy");
    const title = createElement("span", "field__label-text", field.label);
    title.id = `${id}-label`;
    const meta = createElement("span", "field__meta field__meta--inline");
    if (field.tag) meta.append(createElement("span", "field__tag", field.tag));
    const points = field.points ? createElement("span", "field__points") : null;
    if (points) meta.append(points);
    if (!field.levels && level === undefined) meta.append(makeMissingNote());
    copy.append(title, meta);
    const icon = makeFieldIcon(field);
    header.append(...[icon, copy].filter(Boolean));

    const showPoints = (value) => {
      if (!points) return;
      const fear = HadesFieldLogic.pointsAt(field.points, value);
      points.textContent = `${fear} Fear`;
      points.classList.toggle("is-active", fear > 0);
    };
    showPoints(level || 0);

    const commit = (value, focusId) => {
      runEdit(() => {
        HadesFieldLogic.levelWrites(field, value).forEach((write) => recordChange(write.path, write.value));
        applyEffects(field, value > 0);
      }).then((kept) => {
        if (!kept) return refreshAfterUndo(focusId);
        row.querySelector(".field__missing")?.remove();
        markAnyEdited(row, paths);
        showPoints(value);
        updateChangeSummary();
      });
    };

    let control;
    if (field.options.length <= 6) {
      control = createElement("div", "segmented");
      control.setAttribute("role", "radiogroup");
      control.setAttribute("aria-labelledby", title.id);
      field.options.forEach((option, index) => {
        const optionLabel = createElement("label", "segmented__option");
        const input = createElement("input", "segmented__input");
        input.type = "radio";
        input.name = id;
        input.id = `${id}-${index}`;
        input.value = String(option.value);
        input.checked = option.value === level;
        input.addEventListener("change", () => {
          if (input.checked) commit(option.value, input.id);
        });
        optionLabel.htmlFor = input.id;
        optionLabel.append(input, createElement("span", "segmented__text", option.label));
        control.append(optionLabel);
      });
    } else {
      control = createElement("select", "field__select");
      control.id = id;
      control.setAttribute("aria-labelledby", title.id);
      if (level === undefined || !field.options.some((option) => option.value === level)) {
        const placeholder = createElement("option", "", level === undefined ? "—" : String(level));
        placeholder.value = "";
        placeholder.selected = true;
        placeholder.disabled = true;
        control.append(placeholder);
      }
      field.options.forEach((option) => {
        const element = createElement("option", "", option.label);
        element.value = String(option.value);
        element.selected = option.value === level;
        control.append(element);
      });
      control.addEventListener("change", () => commit(Number(control.value), control.id));
    }

    row.append(header, control);
    return row;
  }

  function renderField(field, index) {
    const id = `field-${state.activeSection}-${index}`;
    if (field.type === "level") return renderLevelField(field, id);
    if (field.type === "arcana") return renderArcanaField(field, id);
    if (field.type === "toggle") return renderToggleField(field, id);
    if (field.type === "object") return renderObjectField(field, id);
    return renderNumberField(field, id);
  }

  function getSearchResults() {
    return HadesEditorSearch.searchSections(getCatalog(), state.query);
  }

  function renderSectionNote(section) {
    const note = createElement("p", "section-note", section.description);
    if (section.tone === "warning") note.classList.add("section-note--warning");
    return note;
  }

  function renderFieldsGrid(fields, section, className = "fields-grid", indexOf = (field) => section.fields.indexOf(field)) {
    const grid = createElement("div", className);
    let previousGroup = null;
    fields.forEach((field) => {
      if (field.group && field.group !== previousGroup) {
        grid.append(createElement("h3", "fields-grid__group", field.group));
        previousGroup = field.group;
      } else if (!field.group) {
        previousGroup = null;
      }
      grid.append(renderField(field, indexOf(field)));
    });
    return grid;
  }

  function renderSection(results = getSearchResults()) {
    const result = results.find(({ section }) => section.id === state.activeSection);
    const section = result?.section || getActiveSection();
    const visibleFields = result?.fields || [];
    const hasQuery = Boolean(state.query.trim());

    elements.panelTitle.textContent = section.label;
    if (section.layout === "explorer") {
      renderExplorer(section, hasQuery ? visibleFields : null);
      return;
    }

    if (hasQuery) {
      updatePanelCount(visibleFields.length === 1 ? "1 match" : `${visibleFields.length} matches`);
    } else {
      const itemName = section.layout === "arcana" ? "card" : "value";
      updatePanelCount(section.fields.length === 1 ? `1 ${itemName}` : `${section.fields.length} ${itemName}s`);
    }

    const content = createElement("div", "section-body");
    if (section.description) content.append(renderSectionNote(section));
    if (section.toolbar?.length && !hasQuery) {
      content.append(renderFieldsGrid(
        section.toolbar,
        section,
        "fields-grid fields-grid--toolbar",
        (field) => `toolbar-${section.toolbar.indexOf(field)}`,
      ));
    }

    if (visibleFields.length === 0) {
      content.append(createElement("p", "empty-state", "No matching values."));
    } else {
      content.append(renderFieldsGrid(
        visibleFields,
        section,
        section.layout === "arcana" ? "fields-grid fields-grid--arcana" : "fields-grid",
      ));
    }
    elements.panel.replaceChildren(content);

    const activeTab = elements.tabList.querySelector('[aria-selected="true"]');
    if (activeTab) elements.panel.setAttribute("aria-labelledby", activeTab.id);
  }

  // ---------- Advanced view: browse and edit any value in the save ----------

  const LUA_ROOT = ["save_data", "luabin", "0"];
  const HEADER_PATH = ["save_data"];
  // Header values shown but not edited: the format itself, engine data the
  // game ignores, and values the editor copies from the game data on
  // download (HadesSaveCodec.syncHeader), the same way the game does.
  const LOCKED_HEADER_KEYS = new Set([
    "version", "version_flags", "notable_lua_data", "luabin",
    "location", "runs", "accumulated_meta_points", "active_shrine_points",
    "meta_upgrade_level", "cosmetics_points", "hard_mode",
  ]);
  const EXPLORER_PAGE = 100;

  function samePath(left, right) {
    return left.length === right.length && left.every((part, index) => part === right[index]);
  }

  function explorerNote(section, parent, key) {
    const notes = section.notes || {};
    if (samePath(parent, LUA_ROOT)) return notes.root?.[key];
    if (samePath(parent, [...LUA_ROOT, "GameState"])) return notes.GameState?.[key];
    if (samePath(parent, HEADER_PATH)) return notes.header?.[key];
    return undefined;
  }

  function explorerEntries(section, path) {
    if (path.length === 0) {
      const root = getAtPath(state.document, LUA_ROOT.join(".")) || {};
      return [
        { key: "Header", path: HEADER_PATH, note: "Outer save details, like the version and run count." },
        ...HadesFieldLogic.sortedKeys(root).map((key) => ({
          key,
          path: [...LUA_ROOT, key],
          note: explorerNote(section, LUA_ROOT, key),
        })),
      ];
    }
    const node = getAtPath(state.document, path.join("."));
    if (!node || typeof node !== "object") return [];
    return HadesFieldLogic.sortedKeys(node)
      .filter((key) => !(samePath(path, HEADER_PATH) && key === "luabin"))
      .map((key) => ({
        key,
        path: [...path, key],
        note: explorerNote(section, path, key),
        locked: isLockedPath([...path, key]),
      }));
  }

  // Everything below a locked header key is locked too.
  function isLockedPath(path) {
    return path[0] === "save_data" && path[1] !== "luabin"
      && (LOCKED_HEADER_KEYS.has(path[1]) || /^legacy_/.test(path[1] || ""));
  }

  function explorerCrumbs(path) {
    const crumbs = [{ label: "Save", path: [] }];
    const inLua = path.length > LUA_ROOT.length && samePath(path.slice(0, LUA_ROOT.length), LUA_ROOT);
    const base = inLua ? LUA_ROOT : HEADER_PATH;
    if (!inLua && path.length) crumbs.push({ label: "Header", path: HEADER_PATH });
    path.slice(base.length).forEach((part, index) => {
      crumbs.push({ label: part, path: path.slice(0, base.length + index + 1) });
    });
    return crumbs;
  }

  function openExplorerPath(path) {
    state.explorer = { path, filter: "", limit: EXPLORER_PAGE };
    if (state.query.trim()) {
      elements.search.value = "";
      state.query = "";
      elements.clearSearch.hidden = true;
      renderSearchState();
    } else {
      renderSection();
    }
    elements.panel.querySelector(".explorer__crumb[aria-current]")?.focus();
  }

  function hasEditsBelow(path) {
    const prefix = `${path.join(".")}.`;
    for (const changed of state.changedPaths.keys()) {
      if (changed.startsWith(prefix)) return true;
    }
    return false;
  }

  function renderExplorerValue(entry, row) {
    const pathText = entry.path.join(".");
    const value = entry.path.length ? getAtPath(state.document, pathText) : undefined;
    const kind = entry.key === "Header" && samePath(entry.path, HEADER_PATH)
      ? "table"
      : HadesFieldLogic.valueKind(value);
    const editable = !entry.locked && entry.path.every(HadesFieldLogic.canEditKey);
    const label = `${entry.key} value`;

    const commit = (next) => {
      runEdit(() => recordChange(pathText, next)).then((kept) => {
        if (!kept) return refreshAfterUndo();
        row.classList.toggle("is-edited", state.changedPaths.has(pathText));
        updateChangeSummary();
      });
    };

    if (kind === "table") {
      const size = entry.key === "Header" && samePath(entry.path, HEADER_PATH)
        ? Object.keys(value || {}).length - 1
        : Object.keys(value).length;
      const open = createElement("button", "explorer-row__open");
      open.type = "button";
      open.setAttribute("aria-label", `Open ${entry.key}, ${size} entries`);
      open.append(
        createElement("span", "", size === 1 ? "1 entry" : `${size} entries`),
        createElement("span", "explorer-row__chevron", "›"),
      );
      open.addEventListener("click", () => openExplorerPath(entry.path));
      if (hasEditsBelow(entry.path)) row.classList.add("has-edits");
      return open;
    }
    if (kind === "nil") return createElement("span", "explorer-row__static", value === null ? "nil" : "Not in save");
    if (!editable) {
      const text = Array.isArray(value) ? `${value.length} items` : String(value);
      return createElement("span", "explorer-row__static", text);
    }

    if (kind === "boolean") {
      const wrapper = createElement("label", "explorer-switch");
      const input = createElement("input", "toggle-field__input");
      input.type = "checkbox";
      input.checked = value;
      input.setAttribute("aria-label", label);
      const control = createElement("span", "toggle-field__control");
      control.setAttribute("aria-hidden", "true");
      const text = createElement("span", "explorer-switch__text", value ? "true" : "false");
      input.addEventListener("change", () => {
        text.textContent = input.checked ? "true" : "false";
        commit(input.checked);
      });
      wrapper.append(input, control, text);
      return wrapper;
    }

    const input = createElement("input", "field__input explorer-row__input");
    input.setAttribute("aria-label", label);
    input.spellcheck = false;
    if (kind === "number") {
      input.type = "number";
      input.step = "any";
      input.inputMode = "decimal";
      input.value = String(value);
      input.addEventListener("change", () => {
        const next = Number(input.value);
        if (input.value.trim() === "" || !Number.isFinite(next)) {
          input.value = String(getAtPath(state.document, pathText));
          return;
        }
        commit(next);
      });
    } else {
      input.type = "text";
      input.value = value;
      input.addEventListener("change", () => commit(input.value));
    }
    return input;
  }

  function renderExplorerRows(section, list, entries) {
    const filter = state.explorer.filter.trim().toLowerCase();
    const matches = filter
      ? entries.filter((entry) => `${entry.key} ${entry.note || ""}`.toLowerCase().includes(filter))
      : entries;
    const shown = matches.slice(0, state.explorer.limit);
    const fragment = document.createDocumentFragment();

    shown.forEach((entry) => {
      const row = createElement("div", "explorer-row");
      row.setAttribute("role", "listitem");
      if (entry.path.length) row.classList.toggle("is-edited", state.changedPaths.has(entry.path.join(".")));
      const keyCell = createElement("div", "explorer-row__key");
      keyCell.append(createElement("code", "explorer-row__name", entry.key));
      if (entry.note) keyCell.append(createElement("span", "explorer-row__note", entry.note));
      row.append(keyCell, renderExplorerValue(entry, row));
      fragment.append(row);
    });

    if (matches.length === 0) {
      fragment.append(createElement("p", "empty-state", "No matching keys."));
    }
    list.replaceChildren(fragment);

    const more = list.parentElement.querySelector(".explorer__more");
    const remaining = matches.length - shown.length;
    more.hidden = remaining <= 0;
    more.textContent = `Show ${Math.min(remaining, EXPLORER_PAGE)} more of ${remaining}`;
    updatePanelCount(filter
      ? `${matches.length} of ${entries.length} entries`
      : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`);
  }

  function renderExplorer(section, searchFields) {
    const container = createElement("div", "explorer");
    if (section.description) container.append(renderSectionNote(section));

    let entries;
    const bar = createElement("div", "explorer__bar");
    const crumbs = createElement("nav", "explorer__crumbs");
    crumbs.setAttribute("aria-label", "Location in the save");

    if (searchFields) {
      // Global search: matching GameState keys, wherever the browser is.
      const parent = [...LUA_ROOT, "GameState"];
      entries = searchFields.map((field) => ({
        key: field.label,
        path: [...parent, field.label],
        note: field.note,
      }));
      crumbs.append(createElement("span", "explorer__crumb explorer__crumb--static", "Search results in GameState"));
    } else {
      const path = state.explorer.path;
      entries = explorerEntries(section, path);
      const trail = explorerCrumbs(path);
      trail.forEach((crumb, index) => {
        if (index > 0) crumbs.append(createElement("span", "explorer__separator", "/"));
        const current = index === trail.length - 1;
        const element = createElement(current ? "span" : "button", "explorer__crumb", crumb.label);
        if (current) {
          element.setAttribute("aria-current", "location");
          element.tabIndex = -1;
        } else {
          element.type = "button";
          element.addEventListener("click", () => openExplorerPath(crumb.path));
        }
        crumbs.append(element);
      });
    }

    const filter = createElement("input", "explorer__filter");
    filter.type = "search";
    filter.placeholder = "Filter this list";
    filter.autocomplete = "off";
    filter.setAttribute("aria-label", "Filter keys in this list");
    filter.value = state.explorer.filter;
    bar.append(crumbs, filter);

    const list = createElement("div", "explorer__list");
    list.setAttribute("role", "list");
    const more = createElement("button", "button button--quiet explorer__more");
    more.type = "button";
    more.addEventListener("click", () => {
      state.explorer.limit += EXPLORER_PAGE;
      renderExplorerRows(section, list, entries);
    });
    filter.addEventListener("input", () => {
      state.explorer.filter = filter.value;
      state.explorer.limit = EXPLORER_PAGE;
      renderExplorerRows(section, list, entries);
    });

    container.append(bar, list, more);
    elements.panel.replaceChildren(container);
    renderExplorerRows(section, list, entries);

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
      const count = tab.querySelector(".section-tab__count");
      count.textContent = String(hasQuery ? fields.length : section.fields.length);
      // The Advanced list is for search only, so its size means nothing at rest.
      count.hidden = section.layout === "explorer" && !hasQuery;
    });
  }

  function renderSearchState(focusPanel = false) {
    const results = getSearchResults();
    state.activeSection = HadesEditorSearch.chooseSectionId(results, state.activeSection, state.query);
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
      if (section.layout === "explorer") button.querySelector(".section-tab__count").hidden = true;
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
    elements.runCount.textContent = saveData.runs === undefined ? "—" : String(saveData.runs);
    elements.outputName.value = file.name;
    elements.uploadView.hidden = true;
    elements.editorView.hidden = false;
    document.body.classList.add("is-editing");
    elements.search.value = "";
    elements.clearSearch.hidden = true;
    state.query = "";
    state.explorer = { path: [], filter: "", limit: 100 };
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

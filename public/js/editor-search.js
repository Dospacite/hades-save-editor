(function attachEditorSearch(global) {
  "use strict";

  function normalize(value) {
    return String(value || "").trim().toLocaleLowerCase();
  }

  function fieldText(field) {
    const pathParts = String(field.path || field.levels?.[0]?.[0] || "").split(".");
    const key = pathParts[pathParts.length - 1];
    return normalize([
      field.label,
      field.group,
      field.search,
      key,
    ].filter(Boolean).join(" "));
  }

  function searchSections(catalog, value) {
    const query = normalize(value);
    return catalog.sections.map((section) => {
      const sectionMatches = query && normalize(section.label).includes(query);
      const fields = !query || sectionMatches
        ? section.fields
        : section.fields.filter((field) => fieldText(field).includes(query));
      return { section, fields };
    });
  }

  // A browse-only section (the Advanced tab) stays selected without a search.
  function chooseSectionId(results, activeSection, query = "") {
    const activeResult = results.find((result) => result.section.id === activeSection);
    if (activeResult?.fields.length) return activeSection;
    if (activeResult?.section.layout === "explorer" && !normalize(query)) return activeSection;
    return results.find((result) => result.fields.length)?.section.id
      || activeSection
      || results[0]?.section.id
      || null;
  }

  global.HadesEditorSearch = Object.freeze({
    chooseSectionId,
    fieldText,
    normalize,
    searchSections,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);

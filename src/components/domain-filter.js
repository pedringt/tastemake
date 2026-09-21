import { domainFilters } from "../data/catalog.js";

export function itemMatchesDomain(item, filter) {
  return filter === "all" || item.domains?.includes(filter);
}

export function renderDomainFilter({ selected, scope, label }) {
  return `
    <div class="domain-filter" role="group" aria-label="${label}">
      ${domainFilters.map((filter) => `
        <button
          class="domain-filter-button ${selected === filter.id ? "is-active" : ""}"
          type="button"
          data-domain-filter="${filter.id}"
          data-filter-scope="${scope}"
          aria-pressed="${selected === filter.id}"
        >${filter.label}</button>
      `).join("")}
    </div>`;
}

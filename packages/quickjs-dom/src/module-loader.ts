const MAX_MODULES = 1000;

export class ModuleLoader {
  readonly modules = new Map<string, string | Error>();
  readonly lazyModules: string[] = [];
  readonly lazyAsked = new Set<string>();

  private readonly mapImports: [string, string][] = [];
  private readonly mapScopes: [string, [string, string][]][] = [];
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  addImportMap(json: string): void {
    try {
      const map = JSON.parse(json) as { imports?: unknown; scopes?: Record<string, unknown> };
      this.mapImports.push(...this.mapEntries(map.imports));
      for (const [scope, entries] of Object.entries(map.scopes ?? {})) {
        this.mapScopes.push([new URL(scope, this.baseUrl).href, this.mapEntries(entries)]);
      }
    } catch {
      // an invalid import map is ignored, as a browser does
    }
  }

  resolve(base: string, specifier: string): string {
    let name = specifier;
    // the keys of an import map that are URLs match the specifier once it is resolved
    if ((this.mapImports.length || this.mapScopes.length) && /^(\.{0,2}\/|[a-z][a-z0-9+.-]*:)/i.test(specifier)) {
      try {
        name = new URL(specifier, /^https?:/.test(base) ? base : this.baseUrl).href;
      } catch {
        name = specifier;
      }
    }
    if (this.mapImports.length || this.mapScopes.length) {
      const scopes = this.mapScopes
        .filter(([s]) => s === base || (s.endsWith("/") && base.startsWith(s)))
        .sort((a, b) => b[0].length - a[0].length);
      for (const [, entries] of scopes) {
        const hit = this.mapped(entries, name);
        if (hit) return hit;
      }
      const hit = this.mapped(this.mapImports, name);
      if (hit) return hit;
    }
    // a bare specifier that no import map knows is an error in a browser, not a path on the page
    if (!/^(\.{0,2}\/|[a-z][a-z0-9+.-]*:)/i.test(name)) return name;
    try {
      // code that is not a module of a URL (an inline script, the engine's own) resolves against the page
      // (a loader's retry marks the URL with ?r=N: it is the same module)
      return new URL(name, /^https?:/.test(base) ? base : this.baseUrl).href.replace(/[?&]r=\d+$/, "");
    } catch {
      return name;
    }
  }

  askLazy(base: string): void {
    if (/^https?:/.test(base) && !this.lazyAsked.has(base) && this.lazyAsked.size < MAX_MODULES) {
      this.lazyAsked.add(base);
      this.lazyModules.push(base);
    }
  }

  private mapEntries(value: unknown): [string, string][] {
    return value && typeof value === "object"
      ? Object.entries(value as Record<string, unknown>).flatMap(([key, to]): [string, string][] => {
          try {
            return typeof to === "string"
              ? [[/^(\.{0,2}\/|[a-z][a-z0-9+.-]*:)/i.test(key) ? new URL(key, this.baseUrl).href : key, new URL(to, this.baseUrl).href]]
              : [];
          } catch {
            return [];
          }
        })
      : [];
  }

  private mapped(entries: [string, string][], name: string): string | undefined {
    let best: [string, string] | undefined;
    for (const e of entries) {
      if (e[0] === name) return e[1];
      if (e[0].endsWith("/") && name.startsWith(e[0]) && (!best || e[0].length > best[0].length)) best = e;
    }
    return best && best[1] + name.slice(best[0].length);
  }
}

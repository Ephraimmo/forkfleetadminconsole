// Rendered when SSR itself has crashed, so it cannot import the React logo or the stylesheet.
// The flame and the two hex values are inlined on purpose — keep them in sync with
// src/components/hearth-logo.tsx (HEARTH_FLAME_PATH) and public/favicon.svg.
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>This page didn't load — Hearth Admin</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.5 Inter, system-ui, -apple-system, sans-serif; background: #fcfaf7; color: #1c1917; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      .brand { padding: 0; display: inline-flex; align-items: center; gap: 0.5rem; margin-bottom: 2rem; color: #1c1917; font-weight: 900; font-size: 1.125rem; letter-spacing: -0.02em; }
      .brand svg { width: 2rem; height: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #4b5563; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.5rem 1rem; border-radius: 0.375rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #fb4500; color: #fcfaf7; }
      .secondary { background: #fff; color: #1c1917; border-color: #e5ded3; }
    </style>
  </head>
  <body>
    <div class="card">
      <a class="brand" href="/" aria-label="Hearth Admin — home">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="7" fill="#fb4500"/>
          <g transform="translate(16 16) scale(0.78) translate(-16 -16)">
            <path fill="#fcfaf7" fill-rule="evenodd" clip-rule="evenodd"
              d="M16 4C20.5 10 25 13.5 25 19A9 9 0 0 1 7 19C7 13.5 11.5 10 16 4ZM16 13C18 16 20 17.8 20 20.5A4 4 0 0 1 12 20.5C12 17.8 14 16 16 13Z"/>
          </g>
        </svg>
        <span aria-hidden="true">Hearth</span>
      </a>
      <h1>This page didn't load</h1>
      <p>Something went wrong on our end. You can try refreshing or head back home.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Try again</button>
        <a class="secondary" href="/">Go home</a>
      </div>
    </div>
  </body>
</html>`;
}

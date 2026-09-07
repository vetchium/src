# Vetchium Admin UI

The tenant administrator portal is a React application built with Vite,
TypeScript, Ant Design, TanStack Query, React Router, and react-i18next.

Use Node.js 22.13.0 or newer.

## Development

Install dependencies and start the development server:

```sh
npm install
npm run dev
```

The development server forwards `/api` requests to `http://localhost:8080`,
which is the default the admin API already listens on:

```sh
go run ./backend/cmd/admin-api
```

Set `LISTEN_ADDRESS` on the API to move it, and change the Vite proxy target to
match.

The container reads `VETCHIUM_DEFAULT_LANGUAGE` at startup. Set it to `en-US`,
`ta`, or `de-DE` as the fallback locale. A user's saved preference takes
precedence, followed by the closest supported locale from the browser's BCP 47
language preferences.

Run `npm run format`, `npm run typecheck`, and `npm run build` before handing
off a change.

# Vetchium Hub UI

The Hub user portal is a React application built with Vite, strict TypeScript,
Ant Design, TanStack Query, React Router, and react-i18next.

Use Node.js 22.13.0 or newer.

## Development

Install dependencies and start the development server:

```sh
npm install
npm run dev
```

The development server forwards `/api` requests to `http://localhost:8081`.
Every API listens on `:8080` by default, so start the Hub API on the port this
portal expects. That leaves `:8080` free for the admin portal's API and lets
both portals run at once:

```sh
LISTEN_ADDRESS=:8081 go run ./backend/cmd/hub-api
```

The container reads `VETCHIUM_DEFAULT_LANGUAGE` at startup. Set it to `en-US`,
`ta`, or `de-DE` as the fallback locale. A saved preference takes precedence,
followed by the closest supported locale from the browser's BCP 47 language
preferences. This supported set belongs to the Hub portal and may differ from
other portals.

Run `npm run format`, `npm run typecheck`, and `npm run build` before handing
off a change.

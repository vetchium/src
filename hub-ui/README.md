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
Change the Vite proxy target when running the Hub API elsewhere.

The container reads `VETCHIUM_DEFAULT_LANGUAGE` at startup. Set it to `en-US`,
`ta`, or `de-DE` to choose the initial locale for browsers without a locally
saved preference. A saved browser preference takes precedence.

Run `npm run format`, `npm run typecheck`, and `npm run build` before handing
off a change.

# Vetchium Admin UI

The tenant administrator portal is a React application built with Vite,
TypeScript, Ant Design, TanStack Query, React Router, react-i18next, and Ajv.

## Development

Install dependencies and start the development server:

```sh
npm install
npm run dev
```

The development server forwards `/api` requests to `http://localhost:8080`.
Change the Vite proxy target when running the admin API elsewhere.

The container reads `VETCHIUM_DEFAULT_LANGUAGE` at startup. Set it to `en-US`,
`ta`, or `de_DE` to choose the initial locale for browsers without a locally
saved preference. A user's saved browser preference takes precedence.

Run `npm run format`, `npm run typecheck`, and `npm run build` before handing
off a change.

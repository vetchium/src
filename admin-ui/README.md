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

Run `npm run format`, `npm run typecheck`, and `npm run build` before handing
off a change.

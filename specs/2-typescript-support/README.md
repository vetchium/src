Status: IN_PROGRESS
Authors: @psankar
Dependencies: None

## Acceptance Criteria

- Ability to document APIs in typespec format, which will be the authoritative spec for the endpoints, request and response bodies, response codes
- Ability to have the typescript and golang libraries compliant to the above spec and use them from the api-server and ui code respectively

## Scope

- Developers should be able to create API specifications using [typespec](https://typespec.io/) under the [typespec](./typespec)
- Whatever is written in the .tsp files should be considered the contract. The front end and back end developers must agree to this contract. They can write the corresponding .ts and .go files along with the .tsp files. The backend developers are responsible for the .go files and the frontend developers are responsible for the .ts files.
- The developers should be able to navigate through the sources using an IDE. So there must be enough support for `Go to definition` or `Find usages` from the `.go` and `.ts` files.
- Frontend Developers should be able to run `npm run dev` or `bun dev` for the front end code without relying on docker compose. Currently we have only one frontend program under `hub-ui` but we will soon get more programs and some of them may use bun, yarn, etc. So the libraries that we generate should be good enough to work with most standard tools.
- Backend developers should be able to run the go programs without relying on docker compose.
- The generation of docker containers for the frontend and backend must include the incorporation of the latest typespec based `.ts` and `.go` files too in the source tree.

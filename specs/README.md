This directory contains the functional and technical specifications for every task that needs to be done on the Vetchium project.

If you have a large feature to implement, break it into a bunch of specifications. Each specification should be completable in about a day or two.

Every spec should have the following sections:

- Status: One of (DRAFT, READY, IN_PROGRESS, COMPLETED, REJECTED)
- Authors: List of authors
- Dependencies: List of other XYZ-Specification.md files that this depends on
- Acceptance Criteria
- Scope: The functional and non-functional requirements

Do not AI generate the XYZ-Specification.md files with a lot of [Slop](https://en.wikipedia.org/wiki/AI_slop). They should be readable by both humans and LLMs. Manually type these files as much as possible. The spec files should be concise, precise, imperative and not have any unnecessary fillers.

The Spec files should be so complete, that if we pass a spec file to a coding AI, it should be able to generate all the code and tests needed, with minimal human interaction.

The [Glossary](./Glossary.md) file should contain the definition of any entity that can be referred on the spec files.

The [Ideas](./Ideas.md) file has the list of potential features that can be implemented.

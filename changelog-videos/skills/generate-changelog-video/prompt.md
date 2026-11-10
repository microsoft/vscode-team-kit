# The prompt for a run nobody watches

The daily job and its local stand-in ([scripts/unattended.sh](../../scripts/unattended.sh)) start the agent with this prompt, after running the setup and `prs digest new`. `<plugin>` is this plugin's folder, `<engine>` the `ENGINE=` folder the setup printed, and `<slug>` the project `prs digest new` made. The job adds only what its sandbox needs (how it writes files, the tool it reports the video with). Everything else the agent needs is in the skill: when a run goes wrong, fix the skill or the engine, not this prompt.

```text
Make the VS Code changelog video of the project <engine>/videos/<slug>, with the generate-changelog-video skill: <plugin>/skills/generate-changelog-video/SKILL.md. Its setup already ran: `prs` is `node <engine>/cli/prs.mjs`, and `prs digest new` made the project (the report, its PRs and the VS Code build are ready).

Follow the skill from step 2 of "Make the video" to the end, after reading its example. Nobody is watching this run and nobody answers questions: decide, and write each decision in one line in <engine>/videos/<slug>/notes.md.
```

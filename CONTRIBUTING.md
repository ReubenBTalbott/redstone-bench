# Contributing

The full guide is a skill any coding agent can follow: [`.claude/skills/contribute/SKILL.md`](.claude/skills/contribute/SKILL.md)
(also linked at `.agents/skills/contribute` for Codex). Short version: set up a vanilla 26.3 server as the judge,
add a runner for your agent CLI with no network and no outside files, run all 16 tasks per setting, export,
and open a PR with the exported data plus a tarball of the raw runs so the maintainer can replay every attempt.

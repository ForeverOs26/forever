@AGENTS.md

# Claude Code specifics

The shared contract above is authoritative. Only Claude-specific mechanics live here.

- **Do not enter plan mode, and do not call `ExitPlanMode`,** when the prompt
  already authorizes the full lifecycle (`AGENTS.md` §1). Plan in thinking.
- **Use one read-only verifier subagent** after implementation, so exploration
  and review do not pollute the implementation context. Give it the branch, the
  base SHA and the complete diff, and require one consolidated P0/P1 list.
  Then apply at most one corrective pass (`AGENTS.md` §6).
- **Auto-memory is background context, not authority.** Repository files and
  `git`/`gh` output win. Verify any remembered path, flag or command still
  exists before relying on it.
- **Run long checks in the background.** `npm run verify:ci` takes roughly ten
  minutes here; the full Vitest suite alone takes about six.
- **Windows shells.** Both PowerShell 5.1 and Git Bash are available and take
  different syntax. Write files with the Write/Edit tools, not shell
  heredocs — scripted writes have silently converted LF to CRLF and produced
  hundreds of bogus lint errors.

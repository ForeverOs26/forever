# Draft project imports

## Ordinary project import

1. Prepare a progressive payload at `forever-data/projects/<project>/progressive/payload.json`.
2. Validate it locally:
   `powershell -NoProfile -File scripts/import/Import-ForeverProjectDraft.ps1 -Project <project> -ValidateOnly`.
3. Double-click `Import Forever Project Draft.cmd`.
4. Select the project key or enter a payload path.
5. Enter the database password once in the visible PowerShell window.
6. Receive `IMPORTED AS DRAFT` after the one atomic transaction and short post-commit check.
7. Publish later as a separate action.

The launcher reads non-secret connection settings from `FOREVER_IMPORT_HOST`,
`FOREVER_IMPORT_PORT`, `FOREVER_IMPORT_DATABASE`, `FOREVER_IMPORT_USER`, and
`FOREVER_IMPORT_SSLROOTCERT`. It uses `PGSSLMODE=verify-full` and the supplied
official CA. It never stores a password, a connection URI, or the payload in a
command-line argument.

## Platform maintenance

Migrations, RPC changes, RLS changes, and repair of existing data are platform
maintenance. They require their own review and validation. An ordinary draft
project import does not run platform preflight, postflight, migration
certification, or recertification.

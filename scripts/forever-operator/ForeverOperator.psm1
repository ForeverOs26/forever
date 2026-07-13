Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-JsonFile {
  param([string]$Path, [string]$Label)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label not found: $Path" }
  try { Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json }
  catch { throw "Malformed $Label at ${Path}: $($_.Exception.Message)" }
}

function Assert-NoControlCharacters {
  param([string]$Value, [string]$Label)
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value -match '[\x00-\x1F\x7F]') { throw "Malformed task file: $Label contains control characters or is empty" }
}

function Assert-Task {
  param($Task)
  $required = 'schemaVersion','taskId','title','patchPath','expectedBaseCommit','allowedPaths','forbiddenPaths','riskOverride','branchName','commitMessage','createPullRequest','allowAutomaticMerge','validationProfile'
  foreach ($name in $required) { if (-not $Task.PSObject.Properties.Name.Contains($name)) { throw "Malformed task file: missing '$name'" } }
  if ($Task.schemaVersion -ne '0.1') { throw 'Malformed task file: unsupported schemaVersion' }
  if ($Task.taskId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$') { throw 'Malformed task file: invalid taskId' }
  Assert-NoControlCharacters ([string]$Task.title) 'title'
  Assert-NoControlCharacters ([string]$Task.commitMessage) 'commitMessage'
  if ($Task.title.Length -gt 160 -or $Task.commitMessage.Length -gt 200) { throw 'Malformed task file: title or commitMessage is too long' }
  if (("$($Task.title)`n$($Task.commitMessage)") -match 'gh[pousr]_[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|(?i)(api[_-]?key|access[_-]?token|password|service[_-]?role[_-]?key)\s*[:=]|https?://(www\.)?claude\.ai/(chat|share)/') { throw 'Malformed task file: title or commitMessage contains sensitive data' }
  if ($Task.commitMessage -match '(?i)claude\.ai/(chat|share)|claude session') { throw 'Malformed task file: unsafe commitMessage' }
  if ($Task.expectedBaseCommit -notmatch '^[0-9a-fA-F]{40}$') { throw 'Malformed task file: expectedBaseCommit must be a full 40-character SHA' }
  if (@($Task.allowedPaths).Count -eq 0) { throw 'Malformed task file: allowedPaths must not be empty' }
  foreach ($pattern in @($Task.allowedPaths) + @($Task.forbiddenPaths)) {
    if ([string]::IsNullOrWhiteSpace($pattern) -or $pattern -match '[\x00-\x1F\x7F]' -or [IO.Path]::IsPathRooted($pattern) -or $pattern -match '(^|/)\.\.(/|$)') { throw "Malformed task file: unsafe path pattern '$pattern'" }
  }
  $branch = [string]$Task.branchName
  if ($branch.StartsWith('-') -or $branch -notmatch '^[A-Za-z0-9][A-Za-z0-9._/-]{1,127}$' -or $branch -match '(^|/)(\.|\.\.|@\{|HEAD)(/|$)|\.\.|//|\.lock$|[~^:?*\[\\\s]' -or $branch.EndsWith('/') -or $branch.EndsWith('.')) { throw 'Malformed task file: unsafe branchName' }
  if ($branch -in @('main','master')) { throw 'Malformed task file: protected branchName' }
  if ($Task.patchPath.StartsWith('-') -or $Task.patchPath -match '[\x00-\x1F\x7F]') { throw 'Malformed task file: unsafe patchPath' }
  if ($Task.riskOverride -and $Task.riskOverride.ToString().ToUpperInvariant() -notin @('LOW','MEDIUM','HIGH')) { throw 'riskOverride must be LOW, MEDIUM, HIGH, or null' }
}

function Assert-Configuration {
  param($Config)
  if ($Config.repositoryRoot -ne '..') { throw "repositoryRoot must be '..' relative to .forever-factory" }
  foreach ($name in 'patchInbox','worktreeRoot','reportRoot','logRoot','stateRoot') {
    $value = [string]$Config.$name
    if ($value -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$' -or $value.StartsWith('-')) { throw "Unsafe configuration path: $name" }
  }
  if ($Config.defaultBranch -notmatch '^[A-Za-z0-9][A-Za-z0-9._/-]*$' -or $Config.defaultBranch.StartsWith('-')) { throw 'Unsafe defaultBranch' }
  if ($Config.githubRepository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' -or $Config.githubRepository.StartsWith('-')) { throw 'Unsafe githubRepository' }
  foreach ($profile in $Config.validationProfiles.PSObject.Properties) {
    foreach ($validation in @($profile.Value)) {
      if ($validation.name -notmatch '^[a-z0-9-]+$' -or $validation.executable -notmatch '^[A-Za-z0-9._-]+$' -or $validation.executable.StartsWith('-')) { throw "Unsafe validation entry in profile '$($profile.Name)'" }
      foreach ($argument in @($validation.arguments)) { if ($argument -match '[\x00-\x1F\x7F]') { throw 'Validation arguments contain control characters' } }
    }
  }
}

function Resolve-ContainedPath {
  param([string]$Path, [string]$Root, [string]$Label, [switch]$AllowRoot)
  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\','/')
  $candidate = if ([IO.Path]::IsPathRooted($Path)) { [IO.Path]::GetFullPath($Path) } else { [IO.Path]::GetFullPath((Join-Path $rootFull $Path)) }
  $prefix = $rootFull + [IO.Path]::DirectorySeparatorChar
  if ((-not $AllowRoot -and $candidate.Equals($rootFull,[StringComparison]::OrdinalIgnoreCase)) -or (-not $candidate.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -and -not ($AllowRoot -and $candidate.Equals($rootFull,[StringComparison]::OrdinalIgnoreCase)))) { throw "$Label must stay inside $rootFull" }
  $candidate
}

function Assert-NoReparseTraversal {
  param([string]$Path,[string]$Boundary,[string]$Label)
  $current=[IO.Path]::GetFullPath($Path);$limit=[IO.Path]::GetFullPath($Boundary).TrimEnd('\','/')
  while($current.StartsWith($limit,[StringComparison]::OrdinalIgnoreCase)){
    if(Test-Path -LiteralPath $current){$item=Get-Item -LiteralPath $current -Force;if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne 0){throw "$Label crosses a reparse point: $current"}}
    if($current.Equals($limit,[StringComparison]::OrdinalIgnoreCase)){break};$parent=Split-Path $current -Parent;if(-not$parent-or$parent-eq$current){break};$current=$parent
  }
}

function Test-GlobMatch {
  param([string]$Path, [string[]]$Patterns)
  $normalized = $Path.Replace('\','/')
  foreach ($pattern in $Patterns) {
    $rx = [regex]::Escape($pattern.Replace('\','/')).Replace('\*\*','.*').Replace('\*','[^/]*').Replace('\?','.')
    if ($normalized -match "^$rx$") { return $true }
  }
  $false
}

function ConvertTo-WindowsArgument {
  param([AllowEmptyString()][string]$Value)
  if ($Value -notmatch '[\s"]') { return $Value }
  $builder = [Text.StringBuilder]::new(); [void]$builder.Append('"'); $slashes = 0
  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq '\') { $slashes++; continue }
    if ($character -eq '"') { [void]$builder.Append(('\' * ($slashes * 2 + 1))); [void]$builder.Append('"'); $slashes=0; continue }
    if ($slashes) { [void]$builder.Append(('\' * $slashes)); $slashes=0 }
    [void]$builder.Append($character)
  }
  if ($slashes) { [void]$builder.Append(('\' * ($slashes * 2))) }
  [void]$builder.Append('"'); $builder.ToString()
}

function ConvertTo-SafeCommandDisplay {
  param([string]$Executable,[string[]]$Arguments)
  $parts = @($Executable) + @($Arguments | ForEach-Object { "'" + ($_.Replace("'","''")) + "'" })
  $parts -join ' '
}

function Protect-Output {
  param([string]$Value)
  $Value -replace '(?im)((?:api[_-]?key|access[_-]?token|password|secret|service[_-]?role[_-]?key|github[_-]?token)\s*[:=]\s*)\S+','$1[REDACTED]' -replace 'gh[pousr]_[A-Za-z0-9_]{20,}','[REDACTED_GITHUB_TOKEN]' -replace '-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----','[REDACTED_PRIVATE_KEY]'
}

function Invoke-Native {
  param([string]$Executable,[string[]]$Arguments=@(),[string]$WorkingDirectory,[int]$TimeoutSeconds=1800,[switch]$AllowFailure,[string]$LogPath)
  if ($Executable -notmatch '^[A-Za-z0-9._-]+$' -or $Executable.StartsWith('-')) { throw "Unsafe executable name: $Executable" }
  if($Executable -in @('npm.cmd','npx.cmd')){
    $command=Get-Command $Executable -CommandType Application -ErrorAction Stop;$nodeRoot=Split-Path $command.Source;$cliName=if($Executable-eq'npm.cmd'){'npm-cli.js'}else{'npx-cli.js'};$cli=Join-Path $nodeRoot "node_modules\npm\bin\$cliName";$node=Join-Path $nodeRoot 'node.exe'
    if(-not(Test-Path -LiteralPath $node -PathType Leaf)-or-not(Test-Path -LiteralPath $cli -PathType Leaf)){throw "Unable to resolve structured $Executable runtime"};$Arguments=@($cli)+@($Arguments);$Executable=$node
  }
  $started=Get-Date; $display=Protect-Output (ConvertTo-SafeCommandDisplay $Executable $Arguments)
  $psi=New-Object Diagnostics.ProcessStartInfo
  $encodedArguments = @($Arguments | ForEach-Object { ConvertTo-WindowsArgument ([string]$_) })
  $psi.FileName=$Executable; $psi.Arguments=($encodedArguments -join ' '); $psi.WorkingDirectory=$WorkingDirectory
  $psi.UseShellExecute=$false; $psi.CreateNoWindow=$true; $psi.RedirectStandardOutput=$true; $psi.RedirectStandardError=$true
  $process=New-Object Diagnostics.Process; $process.StartInfo=$psi
  try {
    if (-not $process.Start()) { throw "Unable to start: $Executable" }
    $stdoutTask=$process.StandardOutput.ReadToEndAsync(); $stderrTask=$process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds*1000)) { try{$process.Kill()}catch{}; throw "Command timed out after $TimeoutSeconds seconds: $display" }
    $stdout=$stdoutTask.Result; $stderr=$stderrTask.Result; $combined=(($stdout,$stderr)-join [Environment]::NewLine).Trim(); $redacted=Protect-Output $combined
    if ($LogPath) { "[$($started.ToString('o'))] $display`n$redacted" | Add-Content -LiteralPath $LogPath }
    $summary=(($redacted -split "`r?`n" | Where-Object { $_ } | Select-Object -Last 1)-join '')
    $result=[pscustomobject]@{Executable=$Executable;Arguments=@($Arguments);Command=$display;StartTime=$started.ToString('o');DurationSeconds=[math]::Round(((Get-Date)-$started).TotalSeconds,2);ExitCode=$process.ExitCode;Summary=$summary;Output=$redacted}
    if ($process.ExitCode -ne 0 -and -not $AllowFailure) { throw "Command failed ($($process.ExitCode)): $display`n$redacted" }
    $result
  } finally { $process.Dispose() }
}

function Get-PatchMetadata {
  param([string]$PatchPath,[string[]]$ForbiddenPaths,[string[]]$AllowedPaths,[bool]$AllowBinary)
  if (-not (Test-Path -LiteralPath $PatchPath -PathType Leaf)) { throw "Patch not found: $PatchPath" }
  $bytes=[IO.File]::ReadAllBytes($PatchPath); if(-not $bytes.Length){throw 'Malformed patch: file is empty'};if($bytes -contains 0){throw 'Malformed patch: NUL byte found'}
  $text=[Text.Encoding]::UTF8.GetString($bytes);if($text -notmatch '(?m)^diff --git a/(.+) b/(.+)$'){throw 'Malformed patch: no git diff headers found'}
  if(-not $AllowBinary -and $text -match '(?m)^(GIT binary patch|Binary files .* differ)$'){throw 'Binary patch payloads are not allowed'}
  $files=@([regex]::Matches($text,'(?m)^diff --git a/(.+) b/(.+)$')|ForEach-Object{$_.Groups[2].Value}|Sort-Object -Unique)
  foreach($file in $files){if($file.StartsWith('-') -or $file -match '(^|/)\.\.?(/|$)' -or [IO.Path]::IsPathRooted($file)){throw "Unsafe patch path: $file"};if(Test-GlobMatch $file $ForbiddenPaths){throw "Forbidden path modified: $file"};if($AllowedPaths.Count -and -not(Test-GlobMatch $file $AllowedPaths)){throw "File outside approved task scope: $file"}}
  $from=[regex]::Match($text,'(?m)^From ([0-9a-f]{40}) ').Groups[1].Value;$base=[regex]::Match($text,'(?m)^base-commit: ([0-9a-f]{40})$').Groups[1].Value
  [pscustomobject]@{Path=$PatchPath;Filename=[IO.Path]::GetFileName($PatchPath);Sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $PatchPath).Hash.ToLowerInvariant();Timestamp=(Get-Item -LiteralPath $PatchPath).LastWriteTimeUtc.ToString('o');SourceCommit=if($from){$from}else{$null};DeclaredBaseCommit=if($base){$base}else{$null};Files=$files;Text=$text}
}

function Get-Risk {
  param([string[]]$Files,[string]$Text,$Override)
  $automatic=if($Files|Where-Object{$_ -match '^(supabase/migrations/|\.github/workflows/|supabase/config\.toml$|src/.+(auth|payment|billing)|package-lock\.json$)'}){'HIGH'}elseif(([regex]::Matches($Text,'(?m)^-(?!--)')).Count -gt 500){'HIGH'}elseif(-not($Files|Where-Object{$_ -notmatch '^(docs/|.*\.(md|test\.[cm]?[jt]sx?|spec\.[cm]?[jt]sx?)$)'})){'LOW'}elseif($Files|Where-Object{$_ -match '^src/'}){'MEDIUM'}else{'LOW'}
  if(-not $Override){return $automatic};$requested=$Override.ToString().ToUpperInvariant();if($requested -notin @('LOW','MEDIUM','HIGH')){throw 'riskOverride must be LOW, MEDIUM, HIGH, or null'}
  $rank=@{LOW=1;MEDIUM=2;HIGH=3};if($rank[$requested] -gt $rank[$automatic]){$requested}else{$automatic}
}

function Test-Security {
  param([string]$Root,[string[]]$Files,[int64]$MaximumFileBytes)
  $rules=[ordered]@{'environment-file'='(^|/)\.env($|\.)';'private-key'='-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----';'github-token'='gh[pousr]_[A-Za-z0-9_]{20,}';'api-key-assignment'='(?i)(api[_-]?key|access[_-]?token|password|service[_-]?role[_-]?key)\s*[:=]\s*["'']?[A-Za-z0-9_\-\.]{16,}';'claude-session-url'='https?://(www\.)?claude\.ai/(chat|share)/';'client-personal-data'='(?i)(passport|national[_ -]?id|credit[_ -]?card)\s*[:=]\s*\S+'}
  $findings=@();foreach($file in $Files){$path=Resolve-ContainedPath $file $Root 'Changed file';if(-not(Test-Path -LiteralPath $path -PathType Leaf)){continue};$item=Get-Item -LiteralPath $path;if($item.Length -gt $MaximumFileBytes){$findings+=[pscustomobject]@{File=$file;Rule='unexpected-large-file'};continue};$content=Get-Content -Raw -LiteralPath $path -ErrorAction SilentlyContinue;foreach($entry in $rules.GetEnumerator()){if($file.Replace('\','/') -match $entry.Value -or $content -match $entry.Value){$findings+=[pscustomobject]@{File=$file;Rule=$entry.Key}}}}
  @($findings|Sort-Object File,Rule -Unique)
}

function Invoke-ValidationProfile {
  param($Profile,[string[]]$ChangedFiles,[string]$Worktree,[int]$Timeout,[string]$LogPath,[int]$LintBaseline)
  $results=@();foreach($validation in @($Profile)){
    $arguments=@($validation.arguments);$files=@()
    if($validation.name -eq 'changed-file-lint'){$files=@($ChangedFiles|Where-Object{$_ -match '\.(js|jsx|ts|tsx|mjs|cjs)$'});if(-not $files.Count){$results+=[pscustomobject]@{Name=$validation.name;Status='passed';Detail="no changed lint-supported files; repository baseline: $LintBaseline"};continue};$arguments+=@('--')+$files}
    $native=Invoke-Native $validation.executable $arguments $Worktree $Timeout -AllowFailure -LogPath $LogPath;$status=if($native.ExitCode -eq 0){'passed'}else{'failed'};$detail=if($validation.name -eq 'changed-file-lint'){"$status for $($files.Count) changed file(s); repository baseline: $LintBaseline"}else{$status}
    $results+=[pscustomobject]@{Name=$validation.name;Status=$status;Detail=$detail;Native=$native};if($native.ExitCode -ne 0){throw "Validation failed: $($validation.name)"}
  };$results
}

function Get-CheckOutcome {
  param($Check)
  foreach($name in 'conclusion','state','status'){if($Check.PSObject.Properties.Name -contains $name -and $Check.$name){return $Check.$name.ToString().ToUpperInvariant()}}
  'PENDING'
}

function Test-AutomaticMergeEligibility {
  param($Report,$Task,$Config,$PullRequest,$Protection)
  $reasons=@();if($Report.Risk -ne 'LOW'){$reasons+='risk is not LOW'};if(-not[bool]$Config.autoMerge -or -not[bool]$Task.allowAutomaticMerge){$reasons+='automatic merge is not explicitly enabled'}
  if($PullRequest.baseRefName -ne $Config.defaultBranch){$reasons+='PR base mismatch'};if($PullRequest.headRefName -ne $Task.branchName){$reasons+='PR head mismatch'};if($PullRequest.headRefOid -ne $Report.Commit){$reasons+='PR head SHA mismatch'};if($PullRequest.mergeable -ne 'MERGEABLE'){$reasons+='PR is not mergeable'}
  $checks=@($PullRequest.statusCheckRollup);if(-not $checks.Count){$reasons+='required checks do not exist'}elseif($checks|Where-Object{(Get-CheckOutcome $_) -ne 'SUCCESS'}){$reasons+='checks are not all successful'}
  if(-not $Protection){$reasons+='branch protection could not be verified'}else{
    $requiredReviews=0;if($Protection.PSObject.Properties.Name -contains 'required_pull_request_reviews' -and $Protection.required_pull_request_reviews){$requiredReviews=[int]$Protection.required_pull_request_reviews.required_approving_review_count};if($requiredReviews -gt 0 -and $PullRequest.reviewDecision -ne 'APPROVED'){$reasons+='required approvals are not satisfied'}
    $requiredNames=@();if($Protection.PSObject.Properties.Name -contains 'required_status_checks' -and $Protection.required_status_checks){$statusPolicy=$Protection.required_status_checks;if($statusPolicy.PSObject.Properties.Name -contains 'contexts'){$requiredNames+=@($statusPolicy.contexts)};if($statusPolicy.PSObject.Properties.Name -contains 'checks'){$requiredNames+=@($statusPolicy.checks|ForEach-Object{$_.context})}};$observed=@($checks|ForEach-Object{if($_.PSObject.Properties.Name -contains 'name'){$_.name}elseif($_.PSObject.Properties.Name -contains 'context'){$_.context}});foreach($required in ($requiredNames|Sort-Object -Unique)){if($required -notin $observed){$reasons+="required check missing: $required"}}
  }
  [pscustomobject]@{Eligible=($reasons.Count -eq 0);Reasons=$reasons}
}

function Invoke-GitHubOperation {
  param([string]$Action,$Data,[scriptblock]$Adapter,[string]$Worktree,[string]$LogPath,[int]$Timeout)
  if($Adapter){return & $Adapter $Action $Data}
  switch($Action){
    'auth'{Invoke-Native 'gh.exe' @('auth','status','--hostname','github.com') $Worktree $Timeout -LogPath $LogPath|Out-Null;return $true}
    'push'{Invoke-Native 'git.exe' @('push','--set-upstream','origin','--',$Data.Branch) $Worktree $Timeout -LogPath $LogPath|Out-Null;return $true}
    'find-pr'{$r=Invoke-Native 'gh.exe' @('pr','list','--repo',$Data.Repository,'--head',$Data.Branch,'--json','url','--jq','.[0].url') $Worktree $Timeout -AllowFailure -LogPath $LogPath;return $r.Summary}
    'create-pr'{$r=Invoke-Native 'gh.exe' @('pr','create','--repo',$Data.Repository,'--base',$Data.Base,'--head',$Data.Branch,'--title',$Data.Title,'--body-file',$Data.BodyFile) $Worktree $Timeout -LogPath $LogPath;return $r.Summary}
    'inspect-pr'{$pr=(Invoke-Native 'gh.exe' @('pr','view',$Data.PullRequest,'--repo',$Data.Repository,'--json','baseRefName,headRefName,headRefOid,mergeable,reviewDecision,statusCheckRollup') $Worktree $Timeout -LogPath $LogPath).Output|ConvertFrom-Json;$protectionResult=Invoke-Native 'gh.exe' @('api',"repos/$($Data.Repository)/branches/$($Data.Base)/protection") $Worktree $Timeout -AllowFailure -LogPath $LogPath;$protection=if($protectionResult.ExitCode -eq 0){$protectionResult.Output|ConvertFrom-Json}else{$null};return [pscustomobject]@{PullRequest=$pr;Protection=$protection}}
    'merge'{Invoke-Native 'gh.exe' @('pr','merge',$Data.PullRequest,'--repo',$Data.Repository,'--merge','--delete-branch') $Worktree $Timeout -LogPath $LogPath|Out-Null;return $true}
  }
}

function Wait-GitHubPullRequest {
  param($Data,[scriptblock]$Adapter,[string]$Worktree,[string]$LogPath,[int]$Timeout,[int]$PollSeconds)
  $deadline=(Get-Date).AddSeconds($Timeout)
  do{
    $inspection=Invoke-GitHubOperation 'inspect-pr' $Data $Adapter $Worktree $LogPath ([math]::Min($Timeout,120));$checks=@($inspection.PullRequest.statusCheckRollup)
    if($checks.Count -and -not($checks|Where-Object{(Get-CheckOutcome $_) -in @('PENDING','QUEUED','IN_PROGRESS','REQUESTED','WAITING')})){return $inspection}
    if((Get-Date)-ge$deadline){throw 'Required GitHub checks did not reach a terminal state before timeout'}
    Start-Sleep -Seconds ([math]::Min([math]::Max($PollSeconds,1),60))
  }while($true)
}

function Write-OperatorReport {
  param($Report,[string]$ReportRoot)
  $json=Resolve-ContainedPath "$($Report.TaskId).json" $ReportRoot 'JSON report';$md=Resolve-ContainedPath "$($Report.TaskId).md" $ReportRoot 'Markdown report';$Report|ConvertTo-Json -Depth 15|Set-Content -LiteralPath $json -Encoding utf8
  @('# FOREVER OPERATOR REPORT','',"Task: $($Report.Task)","Task ID: $($Report.TaskId)","Patch: $($Report.Patch)","Patch SHA-256: $($Report.PatchSha256)","Expected base commit: $($Report.ExpectedBaseCommit)","Actual base commit: $($Report.ActualBaseCommit)","Branch: $($Report.Branch)","Risk: $($Report.Risk)","Files changed: $($Report.FilesChanged)","Insertions: $($Report.Insertions)","Deletions: $($Report.Deletions)","Security scan: $($Report.SecurityScan)","Typecheck: $($Report.Typecheck)","Tests: $($Report.Tests)","Lint: $($Report.Lint)","Build: $($Report.Build)","Git diff check: $($Report.GitDiffCheck)","Commit: $($Report.Commit)","Push: $($Report.Push)","Pull Request: $($Report.PullRequest)","GitHub checks: $($Report.GitHubChecks)","Merge: $($Report.Merge)","Final status: $($Report.FinalStatus)","Stop reason: $($Report.StopReason)","Decision required: $($Report.DecisionRequired)","Recommended next action: $($Report.RecommendedNextAction)")|Set-Content -LiteralPath $md -Encoding utf8
}

function Invoke-ForeverOperator {
  [CmdletBinding()]param([string]$TaskFile,[string]$Mode,[string]$ConfigFile,[scriptblock]$GitHubAdapter,[switch]$SkipFetch)
  $requestedMode=$Mode
  $configPath=[IO.Path]::GetFullPath($ConfigFile);$configDir=Split-Path $configPath;$config=Read-JsonFile $configPath 'configuration';Assert-Configuration $config
  $repo=[IO.Path]::GetFullPath((Join-Path $configDir '..'));$taskCandidate=if([IO.Path]::IsPathRooted($TaskFile)){$TaskFile}else{[IO.Path]::GetFullPath($TaskFile)};$taskPath=Resolve-ContainedPath $taskCandidate $configDir 'Task file';Assert-NoReparseTraversal $taskPath $configDir 'Task file';$task=Read-JsonFile $taskPath 'task file';Assert-Task $task;if($Mode-eq'resume'){$Mode=if([bool]$task.createPullRequest){'create-pr'}else{'validate-only'}}
  $inbox=Resolve-ContainedPath $config.patchInbox $configDir 'Patch inbox';$patch=Resolve-ContainedPath $task.patchPath $configDir 'Patch path';if(-not $patch.StartsWith(($inbox.TrimEnd('\','/')+'\'),[StringComparison]::OrdinalIgnoreCase)){throw "Patch path must stay inside configured inbox: $inbox"};Assert-NoReparseTraversal $patch $configDir 'Patch path'
  $worktreeRoot=Resolve-ContainedPath $config.worktreeRoot $configDir 'Worktree root';$reportRoot=Resolve-ContainedPath $config.reportRoot $configDir 'Report root';$logRoot=Resolve-ContainedPath $config.logRoot $configDir 'Log root';$stateRoot=Resolve-ContainedPath $config.stateRoot $configDir 'State root'
  foreach($dir in @($worktreeRoot,$reportRoot,$logRoot,$stateRoot)){New-Item -ItemType Directory -Force -Path $dir|Out-Null;Assert-NoReparseTraversal $dir $configDir 'Operator runtime path'}
  $worktree=Resolve-ContainedPath $task.taskId $worktreeRoot 'Task worktree';$statePath=Resolve-ContainedPath "$($task.taskId).json" $stateRoot 'Task state';$logPath=Resolve-ContainedPath "$($task.taskId).log" $logRoot 'Task log'
  $report=[ordered]@{Task=$task.title;TaskId=$task.taskId;Attempt=1;Patch=$patch;PatchSha256=$null;ExpectedBaseCommit=$task.expectedBaseCommit;ActualBaseCommit=$null;Branch=$task.branchName;Risk=$null;FilesChanged=0;Insertions=0;Deletions=0;SecurityScan='not run';Typecheck='not run';Tests='not run';Lint="not run; repository baseline: $($config.lintBaseline.errorCount)";Build='not run';GitDiffCheck='not run';Commit='not created';Push='not pushed';PullRequest='not created';GitHubChecks='not run';Merge='not merged';FinalStatus='running';StopReason=$null;DecisionRequired='none';RecommendedNextAction=$null;Commands=@()}
  try{
    if($Mode -eq 'cleanup'){if(Test-Path -LiteralPath $worktree){Invoke-Native 'git.exe' @('worktree','remove','--force','--',$worktree) $repo 120 -LogPath $logPath|Out-Null};Invoke-Native 'git.exe' @('worktree','prune') $repo 120 -LogPath $logPath|Out-Null;$exists=Invoke-Native 'git.exe' @('show-ref','--verify',"refs/heads/$($task.branchName)") $repo 60 -AllowFailure -LogPath $logPath;if($exists.ExitCode -eq 0){Invoke-Native 'git.exe' @('branch','-D','--',$task.branchName) $repo 60 -LogPath $logPath|Out-Null};$report.FinalStatus='cleaned';return [pscustomobject]$report}
    if(Test-Path -LiteralPath $statePath){$previous=Read-JsonFile $statePath 'task state';$report.Attempt=if($previous.Attempt){[int]$previous.Attempt+1}else{2};if($previous.FinalStatus -eq 'merged'){throw 'Task was already merged; merge will never be repeated'};if($previous.FinalStatus -in @('pr-created','validated','dry-run-complete') -and $requestedMode -ne'resume' -and $Mode -notin @('create-pr','full-safe-cycle')){throw "Task already completed checkpoint '$($previous.FinalStatus)'"};if($report.Attempt -gt [int]$config.maximumRetryCount){throw "Maximum retry count ($($config.maximumRetryCount)) exceeded"}}
    $meta=Get-PatchMetadata $patch (@($config.protectedPaths)+@($task.forbiddenPaths)) @($task.allowedPaths) ([bool]$config.binaryPatchesAllowed);$report.PatchSha256=$meta.Sha256;$report.FilesChanged=$meta.Files.Count;$report.Risk=Get-Risk $meta.Files $meta.Text $task.riskOverride
    if((Invoke-Native 'git.exe' @('status','--porcelain') $repo 60 -LogPath $logPath).Output){throw 'Primary repository contains unrelated local changes'}
    if((Invoke-Native 'git.exe' @('cat-file','-e',"$($task.expectedBaseCommit)^{commit}") $repo 60 -AllowFailure -LogPath $logPath).ExitCode){throw 'Expected base commit does not exist'};$report.ActualBaseCommit=(Invoke-Native 'git.exe' @('rev-parse','--verify',$task.expectedBaseCommit) $repo 60 -LogPath $logPath).Summary
    if($meta.DeclaredBaseCommit -and $meta.DeclaredBaseCommit -ne $task.expectedBaseCommit){throw 'Patch declared base commit differs from expected base commit'}
    if(-not $SkipFetch -and $Mode -ne 'dry-run'){Invoke-Native 'git.exe' @('fetch','--prune','origin') $repo 300 -LogPath $logPath|Out-Null};$remoteDefault=(Invoke-Native 'git.exe' @('rev-parse','--verify',"origin/$($config.defaultBranch)") $repo 60 -LogPath $logPath).Summary;if((Invoke-Native 'git.exe' @('merge-base','--is-ancestor',$task.expectedBaseCommit,$remoteDefault) $repo 60 -AllowFailure -LogPath $logPath).ExitCode){throw 'Default branch moved incompatibly with expected base commit'}
    if(Test-Path -LiteralPath $worktree){throw "Stale worktree exists: $worktree"};if((Invoke-Native 'git.exe' @('show-ref','--verify',"refs/heads/$($task.branchName)") $repo 60 -AllowFailure -LogPath $logPath).ExitCode -eq 0){throw 'Task branch already exists; use resume or cleanup'}
    Invoke-Native 'git.exe' @('worktree','add','-b',$task.branchName,'--',$worktree,$task.expectedBaseCommit) $repo 120 -LogPath $logPath|Out-Null;Invoke-Native 'git.exe' @('apply','--check','--',$patch) $worktree 120 -LogPath $logPath|Out-Null;Invoke-Native 'git.exe' @('apply','--index','--',$patch) $worktree 120 -LogPath $logPath|Out-Null
    $security=@(Test-Security $worktree $meta.Files ([int64]$config.security.maximumFileBytes));if($security.Count){$report.SecurityScan='blocked: '+(($security|ForEach-Object{"$($_.File) [$($_.Rule)]"})-join ', ');throw 'Possible secret or sensitive data detected'};$report.SecurityScan='passed'
    foreach($line in ((Invoke-Native 'git.exe' @('diff','--cached','--numstat','--') $worktree 60 -LogPath $logPath).Output -split "`r?`n")){$parts=$line-split"`t";if($parts.Count-ge 2){if($parts[0]-match'^\d+$'){$report.Insertions+=[int]$parts[0]};if($parts[1]-match'^\d+$'){$report.Deletions+=[int]$parts[1]}}}
    $profile=$config.validationProfiles.PSObject.Properties[$task.validationProfile].Value;if(-not $profile){throw "Unknown validation profile: $($task.validationProfile)"};$validations=@(Invoke-ValidationProfile $profile $meta.Files $worktree ([int]$config.timeouts.commandSeconds) $logPath ([int]$config.lintBaseline.errorCount));foreach($v in $validations){if($v.Native){$report.Commands+=$v.Native};switch($v.Name){'typecheck'{$report.Typecheck=$v.Detail};'tests'{$report.Tests=$v.Detail};'changed-file-lint'{$report.Lint=$v.Detail};'build'{$report.Build=$v.Detail};'git-diff-check'{$report.GitDiffCheck=$v.Detail}}}
    if($Mode -eq 'dry-run'){$report.FinalStatus='dry-run-complete';return [pscustomobject]$report};if($Mode -eq 'validate-only'){$report.FinalStatus='validated';return [pscustomobject]$report};if($report.Risk -eq 'HIGH' -and -not[bool]$config.highRiskPullRequestsAllowed){throw 'HIGH-risk patch stopped before push by policy'}
    $name=(Invoke-Native 'git.exe' @('config','user.name') $worktree 30 -AllowFailure -LogPath $logPath).Summary;$email=(Invoke-Native 'git.exe' @('config','user.email') $worktree 30 -AllowFailure -LogPath $logPath).Summary;if(-not$name-or-not$email){throw 'Git author name and email must be configured'};if(Test-Path -LiteralPath (Join-Path $worktree $meta.Filename)){throw 'Generated patch file would be included in commit'}
    Invoke-Native 'git.exe' @('commit','-m',$task.commitMessage,'--') $worktree 120 -LogPath $logPath|Out-Null;$report.Commit=(Invoke-Native 'git.exe' @('rev-parse','HEAD') $worktree 60 -LogPath $logPath).Summary
    $secondSecurity=@(Test-Security $worktree $meta.Files ([int64]$config.security.maximumFileBytes));if($secondSecurity.Count){throw 'Possible secret or sensitive data detected before push'}
    if($Mode -in @('create-pr','full-safe-cycle','resume')){Invoke-GitHubOperation 'auth' @{} $GitHubAdapter $worktree $logPath 60|Out-Null;if(-not $GitHubAdapter){$remote=(Invoke-Native 'git.exe' @('remote','get-url','origin') $worktree 30 -LogPath $logPath).Summary;if($remote -notmatch "(?i)([:/])$([regex]::Escape($config.githubRepository))(\.git)?$"){throw 'Git remote does not match configured GitHub repository'}};Invoke-GitHubOperation 'push' @{Branch=$task.branchName} $GitHubAdapter $worktree $logPath 300|Out-Null;$report.Push='pushed'
      if([bool]$task.createPullRequest){$body=Resolve-ContainedPath '.forever-operator-pr-body.md' $worktree 'PR body';@("Patch SHA-256: $($report.PatchSha256)","Base commit: $($report.ActualBaseCommit)","Risk: $($report.Risk)","Files changed: $($report.FilesChanged)")|Set-Content -LiteralPath $body;$pr=Invoke-GitHubOperation 'find-pr' @{Repository=$config.githubRepository;Branch=$task.branchName} $GitHubAdapter $worktree $logPath 60;if(-not$pr){$pr=Invoke-GitHubOperation 'create-pr' @{Repository=$config.githubRepository;Base=$config.defaultBranch;Branch=$task.branchName;Title=$task.title;BodyFile=$body} $GitHubAdapter $worktree $logPath 120};Remove-Item -LiteralPath $body -Force;$report.PullRequest=$pr;$inspection=Wait-GitHubPullRequest @{Repository=$config.githubRepository;Base=$config.defaultBranch;PullRequest=$pr} $GitHubAdapter $worktree $logPath ([int]$config.timeouts.githubChecksSeconds) ([int]$config.timeouts.githubPollSeconds);$eligibility=Test-AutomaticMergeEligibility ([pscustomobject]$report) $task $config $inspection.PullRequest $inspection.Protection;$report.GitHubChecks=if(@($inspection.PullRequest.statusCheckRollup).Count -and -not($inspection.PullRequest.statusCheckRollup|Where-Object{(Get-CheckOutcome $_)-ne'SUCCESS'})){'passed and explicitly inspected'}else{'not satisfied'}
        if($eligibility.Eligible){$head=(Invoke-GitHubOperation 'inspect-pr' @{Repository=$config.githubRepository;Base=$config.defaultBranch;PullRequest=$pr} $GitHubAdapter $worktree $logPath 60).PullRequest;if($head.headRefOid-ne$report.Commit){throw 'Task branch changed before merge'};Invoke-GitHubOperation 'merge' @{Repository=$config.githubRepository;PullRequest=$pr} $GitHubAdapter $worktree $logPath 180|Out-Null;$report.Merge='merged';$report.FinalStatus='merged'}else{$report.Merge='not merged: '+($eligibility.Reasons-join'; ');$report.FinalStatus='pr-created';if($report.Risk-ne'LOW'){$report.DecisionRequired='Owner approval required'}}
      }else{$report.FinalStatus='validated'}};$report.RecommendedNextAction=if($report.FinalStatus-eq'pr-created'){'Review and approve the Pull Request'}else{'None'};[pscustomobject]$report
  }catch{$report.FinalStatus='stopped';$report.StopReason=$_.Exception.Message;$report.RecommendedNextAction='Correct the stop reason, then run resume';[pscustomobject]$report}
  finally{$report|ConvertTo-Json -Depth 15|Set-Content -LiteralPath $statePath -Encoding utf8;Write-OperatorReport ([pscustomobject]$report) $reportRoot;if(Test-Path -LiteralPath $worktree){try{Invoke-Native 'git.exe' @('worktree','remove','--force','--',$worktree) $repo 120 -AllowFailure -LogPath $logPath|Out-Null;Invoke-Native 'git.exe' @('worktree','prune') $repo 60 -AllowFailure -LogPath $logPath|Out-Null}catch{}};if($report.Commit-eq'not created' -and $report.FinalStatus-ne'pr-created'){try{Invoke-Native 'git.exe' @('branch','-D','--',$task.branchName) $repo 60 -AllowFailure -LogPath $logPath|Out-Null}catch{}}}
}

Export-ModuleMember -Function Assert-Task,Assert-Configuration,Resolve-ContainedPath,Test-GlobMatch,Invoke-Native,Get-PatchMetadata,Get-Risk,Test-Security,Invoke-ValidationProfile,Test-AutomaticMergeEligibility,Invoke-ForeverOperator

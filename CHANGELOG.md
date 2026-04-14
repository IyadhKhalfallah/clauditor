# Changelog

## [1.30.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.29.1...v1.30.0) (2026-04-14)


### Features

* **init:** add `clauditor init` to wire AI tool into team knowledge ([#123](https://github.com/IyadhKhalfallah/clauditor/issues/123)) ([2a4620b](https://github.com/IyadhKhalfallah/clauditor/commit/2a4620b2012576b74e8e48defb682c93609308d7))

## [1.29.1](https://github.com/IyadhKhalfallah/clauditor/compare/v1.29.0...v1.29.1) (2026-04-12)


### Bug Fixes

* clearer error when clauditor login runs outside a git repo ([#120](https://github.com/IyadhKhalfallah/clauditor/issues/120)) ([85352b1](https://github.com/IyadhKhalfallah/clauditor/commit/85352b1087e7f27cfe50eeb50e7eff1f4e19c4ce))

## [1.29.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.28.0...v1.29.0) (2026-04-12)


### Features

* project picker in login flow + credential leak fix ([#119](https://github.com/IyadhKhalfallah/clauditor/issues/119)) ([4ad1c48](https://github.com/IyadhKhalfallah/clauditor/commit/4ad1c48270832ca22f281e2ff119c6289a21de44))


### Bug Fixes

* download tarball to file instead of bash variable ([#116](https://github.com/IyadhKhalfallah/clauditor/issues/116)) ([186925e](https://github.com/IyadhKhalfallah/clauditor/commit/186925eeb2bf59d830272e314ef15ee06d37a9e2))

## [1.28.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.27.1...v1.28.0) (2026-04-11)


### Features

* auto-memory sync + structured handoff learnings ([#113](https://github.com/IyadhKhalfallah/clauditor/issues/113)) ([bf2c6d3](https://github.com/IyadhKhalfallah/clauditor/commit/bf2c6d3689c2cf7bf4060ae6a8fce89e88356b62))
* hub v2 — sync, hooks, reliability, production hardening ([#115](https://github.com/IyadhKhalfallah/clauditor/issues/115)) ([bc9dabf](https://github.com/IyadhKhalfallah/clauditor/commit/bc9dabff25c79ea0a7ac374465468f54e7d5edf2))


### Bug Fixes

* data quality improvements — remove noise, stop pushing file_activity ([#111](https://github.com/IyadhKhalfallah/clauditor/issues/111)) ([714a046](https://github.com/IyadhKhalfallah/clauditor/commit/714a046e5584625307ef363da7ee1e4a8b8de327))
* skip npm publish when version already exists ([#114](https://github.com/IyadhKhalfallah/clauditor/issues/114)) ([8d36664](https://github.com/IyadhKhalfallah/clauditor/commit/8d36664366c34c28f60aac1fbdcf445765b7beed))

## [1.27.1](https://github.com/IyadhKhalfallah/clauditor/compare/v1.27.0...v1.27.1) (2026-04-08)


### Bug Fixes

* push error fixes to hub, not just errors ([#109](https://github.com/IyadhKhalfallah/clauditor/issues/109)) ([468a3b8](https://github.com/IyadhKhalfallah/clauditor/commit/468a3b8a4532d212cb29d13b2da0c9cd1f3580e5))

## [1.27.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.26.0...v1.27.0) (2026-04-08)


### Features

* clauditor login — browser + device flow authentication ([#108](https://github.com/IyadhKhalfallah/clauditor/issues/108)) ([27d7ac9](https://github.com/IyadhKhalfallah/clauditor/commit/27d7ac93e2480fd519c85f10e632dd6edc983835))


### Bug Fixes

* verify npm tarball version before updating homebrew formula ([#106](https://github.com/IyadhKhalfallah/clauditor/issues/106)) ([3e7790d](https://github.com/IyadhKhalfallah/clauditor/commit/3e7790dc232591fd3e4ccbe8186deb585968bf44))

## [1.26.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.25.2...v1.26.0) (2026-04-08)


### Features

* add --claude-dir flag to install and uninstall ([#104](https://github.com/IyadhKhalfallah/clauditor/issues/104)) ([474dc35](https://github.com/IyadhKhalfallah/clauditor/commit/474dc3506195d3011ecfeeaa4d0c1827a206f932)), closes [#103](https://github.com/IyadhKhalfallah/clauditor/issues/103)

## [1.25.2](https://github.com/IyadhKhalfallah/clauditor/compare/v1.25.1...v1.25.2) (2026-04-08)


### Bug Fixes

* record intermediate commands as the fix, not the succeeding command ([#102](https://github.com/IyadhKhalfallah/clauditor/issues/102)) ([951c6d6](https://github.com/IyadhKhalfallah/clauditor/commit/951c6d681507c9853d5ab399d13fb3910ff630d6))
* scrub secrets from local error index, not just hub push ([#100](https://github.com/IyadhKhalfallah/clauditor/issues/100)) ([17751b2](https://github.com/IyadhKhalfallah/clauditor/commit/17751b287e920b3a02190afd1a757f56a250b388))

## [1.25.1](https://github.com/IyadhKhalfallah/clauditor/compare/v1.25.0...v1.25.1) (2026-04-07)


### Bug Fixes

* remove language-dependent categories, rename to structural coverage ([#98](https://github.com/IyadhKhalfallah/clauditor/issues/98)) ([c283851](https://github.com/IyadhKhalfallah/clauditor/commit/c2838514770f13cb58f8bd172286eca9a34b4a9f))

## [1.25.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.24.0...v1.25.0) (2026-04-07)


### Features

* handoff quality measurement — information loss scoring ([#92](https://github.com/IyadhKhalfallah/clauditor/issues/92)) ([ec2a5ec](https://github.com/IyadhKhalfallah/clauditor/commit/ec2a5ec709b7d69f322887a1e57a263371de6c15))
* knowledge quality + optional hub sync ([#90](https://github.com/IyadhKhalfallah/clauditor/issues/90)) ([da0165f](https://github.com/IyadhKhalfallah/clauditor/commit/da0165f58687c16a2aa233de09e7d9ab496807ca))
* secret scrubbing before hub push ([#97](https://github.com/IyadhKhalfallah/clauditor/issues/97)) ([a830f2c](https://github.com/IyadhKhalfallah/clauditor/commit/a830f2cd232136ecd7b4a693e9cc182d714b0042))
* structured handoff template for session rotation ([#93](https://github.com/IyadhKhalfallah/clauditor/issues/93)) ([9c3d5f7](https://github.com/IyadhKhalfallah/clauditor/commit/9c3d5f727369a048601d113c5df8329cb46e683b))


### Bug Fixes

* extract reasoning only from work turns, not meta-discussion ([#94](https://github.com/IyadhKhalfallah/clauditor/issues/94)) ([adc738e](https://github.com/IyadhKhalfallah/clauditor/commit/adc738e4fb7e4101ff3688657f62d09f400f103e))
* skip tiny transcripts in handoff-report auto-detection ([#95](https://github.com/IyadhKhalfallah/clauditor/issues/95)) ([138daf7](https://github.com/IyadhKhalfallah/clauditor/commit/138daf7ad385fcd55cfd03f14e48aab8697167eb))

## [1.24.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.23.0...v1.24.0) (2026-04-06)


### Features

* auto-register missing hooks on npm upgrade (respects audit-only) ([#78](https://github.com/IyadhKhalfallah/clauditor/issues/78)) ([f712540](https://github.com/IyadhKhalfallah/clauditor/commit/f712540f037e68b328180f49fddf45ea26518350))
* project memory — error index, file tracker, error prevention ([#77](https://github.com/IyadhKhalfallah/clauditor/issues/77)) ([cf6bc4d](https://github.com/IyadhKhalfallah/clauditor/commit/cf6bc4dd4654fc3100b746d2a96ad828721b5d1a))


### Bug Fixes

* cross-project session handoffs + error logging ([#83](https://github.com/IyadhKhalfallah/clauditor/issues/83)) ([f30524b](https://github.com/IyadhKhalfallah/clauditor/commit/f30524b46421e2a9b00f6c9bf03c2d5398511db2))
* don't block "continue" in existing sessions ([#81](https://github.com/IyadhKhalfallah/clauditor/issues/81)) ([a995c52](https://github.com/IyadhKhalfallah/clauditor/commit/a995c527f87805c55e063d47b86da41ae87138a5))

## [1.23.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.22.3...v1.23.0) (2026-04-05)


### Features

* capture Claude's rotation handoff via Stop hook with marker ([#75](https://github.com/IyadhKhalfallah/clauditor/issues/75)) ([cd3880a](https://github.com/IyadhKhalfallah/clauditor/commit/cd3880aba57d9d3da78e9a86fa65fb385bffa5a5))


### Bug Fixes

* add defensive fallbacks in calibration and comprehensive tests ([#74](https://github.com/IyadhKhalfallah/clauditor/issues/74)) ([99e7238](https://github.com/IyadhKhalfallah/clauditor/commit/99e72380deb2cea6c3cbe95982b6fa5702fc5281))
* resolve failing quota-report tests with proper homedir redirection and timezone handling ([#72](https://github.com/IyadhKhalfallah/clauditor/issues/72)) ([5e6ebe3](https://github.com/IyadhKhalfallah/clauditor/commit/5e6ebe38371850d3708b480b11d9ba92a3a8cc86))

## [1.22.3](https://github.com/IyadhKhalfallah/clauditor/compare/v1.22.2...v1.22.3) (2026-04-04)


### Bug Fixes

* show copyable prompts with shortened file paths in continue block ([#67](https://github.com/IyadhKhalfallah/clauditor/issues/67)) ([f023706](https://github.com/IyadhKhalfallah/clauditor/commit/f023706b334ac04c8436987d8931e9c17c954651))

## [1.22.2](https://github.com/IyadhKhalfallah/clauditor/compare/v1.22.1...v1.22.2) (2026-04-04)


### Bug Fixes

* extract meaningful descriptions from handoff files ([#65](https://github.com/IyadhKhalfallah/clauditor/issues/65)) ([6437d95](https://github.com/IyadhKhalfallah/clauditor/commit/6437d95a1816566c29303217c7665de4a52f245b))

## [1.22.1](https://github.com/IyadhKhalfallah/clauditor/compare/v1.22.0...v1.22.1) (2026-04-04)


### Bug Fixes

* use exit code 2 for continue-prompt block (works in VS Code) ([#63](https://github.com/IyadhKhalfallah/clauditor/issues/63)) ([c9b919f](https://github.com/IyadhKhalfallah/clauditor/commit/c9b919fe93351cc0bd24e2c0962947b02583ba58))

## [1.22.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.21.0...v1.22.0) (2026-04-04)


### Features

* block on "continue" prompts with handoff context ([#62](https://github.com/IyadhKhalfallah/clauditor/issues/62)) ([5a46d09](https://github.com/IyadhKhalfallah/clauditor/commit/5a46d095376efab717d98286700768332cd467a9))


### Bug Fixes

* make session handoff acknowledgment impossible to ignore ([#60](https://github.com/IyadhKhalfallah/clauditor/issues/60)) ([87721c5](https://github.com/IyadhKhalfallah/clauditor/commit/87721c592d87e6d95727ea4e3a52dbe12871ca96))

## [1.21.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.20.0...v1.21.0) (2026-04-04)


### Features

* per-session handoff storage with multi-session choice ([#58](https://github.com/IyadhKhalfallah/clauditor/issues/58)) ([6795ada](https://github.com/IyadhKhalfallah/clauditor/commit/6795adad80ba5157a7174cf6481cfab43361fff3))

## [1.20.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.19.0...v1.20.0) (2026-04-04)


### Features

* capture Claude's own session summary via PostCompact hook ([#56](https://github.com/IyadhKhalfallah/clauditor/issues/56)) ([469190a](https://github.com/IyadhKhalfallah/clauditor/commit/469190a63e8e2d24e072eca2789a9feddc04c8c5))

## [1.19.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.18.2...v1.19.0) (2026-04-04)


### Features

* capture Claude's own session summary via PostCompact hook ([#54](https://github.com/IyadhKhalfallah/clauditor/issues/54)) ([45ec3a9](https://github.com/IyadhKhalfallah/clauditor/commit/45ec3a9ee778c37668d87356f97725ecbae75306))

## [1.18.2](https://github.com/IyadhKhalfallah/clauditor/compare/v1.18.1...v1.18.2) (2026-04-04)


### Bug Fixes

* make Claude explicitly acknowledge session handoff on start ([#52](https://github.com/IyadhKhalfallah/clauditor/issues/52)) ([e680463](https://github.com/IyadhKhalfallah/clauditor/commit/e680463a78ee45042f802e47dbadba08a0613200))
* persist hook state to disk, fix race conditions, deduplicate shared code ([#51](https://github.com/IyadhKhalfallah/clauditor/issues/51)) ([05f25b2](https://github.com/IyadhKhalfallah/clauditor/commit/05f25b28ac451835f0d0bdbf80aaf014976970a8))

## [1.18.1](https://github.com/IyadhKhalfallah/clauditor/compare/v1.18.0...v1.18.1) (2026-04-04)


### Bug Fixes

* skip meta messages in handoff, fix HEREDOC commit parsing ([0fab65c](https://github.com/IyadhKhalfallah/clauditor/commit/0fab65c9c2a560e6cb7c4adb6d000987575532bc))
* skip meta messages in handoff, fix HEREDOC commit parsing ([0f40770](https://github.com/IyadhKhalfallah/clauditor/commit/0f407700f8047a5295d24766b23abbb0a888473f))

## [1.18.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.17.0...v1.18.0) (2026-04-04)


### Features

* add `clauditor time` — analyze token usage by hour of day ([c45babf](https://github.com/IyadhKhalfallah/clauditor/commit/c45babfcf292bf877eae858f8c26d3828d683d34))
* add cache hit ratio to share output ([92de206](https://github.com/IyadhKhalfallah/clauditor/commit/92de206b0d41e81329ea6a5e1f918d571eaa5a92))
* add cache hit ratio to share output and session reports ([dfccb3f](https://github.com/IyadhKhalfallah/clauditor/commit/dfccb3fbe8bd2341749cab70edab3cec4b03c190))
* add clauditor time — peak vs off-peak token analysis ([66832d0](https://github.com/IyadhKhalfallah/clauditor/commit/66832d0d9755b07fd59699b68a6b53e54f1e3e16))
* append ready-to-post tweet to GitHub releases ([e5389ae](https://github.com/IyadhKhalfallah/clauditor/commit/e5389aeadd2ebf7a5c9c55c65cbb803e5965784e))
* append tweet draft to GitHub releases ([03475d3](https://github.com/IyadhKhalfallah/clauditor/commit/03475d3777e867f1f1de2f193a82fbd8ee43957c))
* capture last assistant message in session handoff ([f67723e](https://github.com/IyadhKhalfallah/clauditor/commit/f67723e3afde5640772d9ae0e49f63eb755429dc))
* detect buggy Claude Code versions (2.1.69-2.1.89) ([b10b092](https://github.com/IyadhKhalfallah/clauditor/commit/b10b092e7004aea44bd032ab4d23fa3115b31fcf))
* rich context summary on session rotation ([4ba9d70](https://github.com/IyadhKhalfallah/clauditor/commit/4ba9d704455bdd2d20c5299fe010b3e6dce4825c))
* rich context summary on session rotation ([8aa544f](https://github.com/IyadhKhalfallah/clauditor/commit/8aa544fea0e0c0be4f2ac989f9a922fc26d2215c))
* version-aware cache bug warnings ([86bb08a](https://github.com/IyadhKhalfallah/clauditor/commit/86bb08a6746a39d5992540a45479de02fda3688a))

## [1.17.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.16.0...v1.17.0) (2026-04-03)


### Features

* support npx installation — detect npx and register hooks with n… ([f4ffe78](https://github.com/IyadhKhalfallah/clauditor/commit/f4ffe78d31441e35ea1288bf66a0d8cf658b8c01))
* support npx installation — detect npx and register hooks with npx prefix ([c39b3da](https://github.com/IyadhKhalfallah/clauditor/commit/c39b3da0a399c2ce22fe62d6e5956a93de2ed643))

## [1.16.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.15.0...v1.16.0) (2026-04-03)


### Features

* add `clauditor share` command, default to report, fix double-block ([7171d2e](https://github.com/IyadhKhalfallah/clauditor/commit/7171d2e18aec14669119322d4697ed9848fa500b))
* add `clauditor share` command, default to report, fix double-block ([e8e921b](https://github.com/IyadhKhalfallah/clauditor/commit/e8e921bee35b8af6848fc85344925c2fb043f3c4))

## [1.15.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.14.0...v1.15.0) (2026-04-03)


### Features

* show clauditor impact in report and dashboard ([8cb64ab](https://github.com/IyadhKhalfallah/clauditor/commit/8cb64abb5a2342909a90a7eda295f5abb5bd274d))
* show clauditor impact in report and dashboard ([fcad8d6](https://github.com/IyadhKhalfallah/clauditor/commit/fcad8d6f5bee76c1dafb270399d9734aa8e6df78))


### Bug Fixes

* add missing fields to early return in computeQuotaBrief ([975ad8d](https://github.com/IyadhKhalfallah/clauditor/commit/975ad8d5c4e0fabfa5f61b0e4dc62bee58ce769a))

## [1.14.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.13.2...v1.14.0) (2026-04-03)


### Features

* add quota report command and brief panel in dashboard ([5c2efd4](https://github.com/IyadhKhalfallah/clauditor/commit/5c2efd4c65a63d99ba583932f4b0dbe3a65997da))
* add quota report command and brief panel in dashboard ([0ff1a19](https://github.com/IyadhKhalfallah/clauditor/commit/0ff1a1974451985595718cf6e900968cb169115f))


### Bug Fixes

* improve block message to be user-friendly instead of Claude-dire… ([6b70db9](https://github.com/IyadhKhalfallah/clauditor/commit/6b70db9addc3c7c0c2a55fe80b3ad5ab945c0da6))
* improve block message to be user-friendly instead of Claude-directed ([babb5c8](https://github.com/IyadhKhalfallah/clauditor/commit/babb5c8162ddfba4950fc00dd93b49b604533698))

## [1.13.2](https://github.com/IyadhKhalfallah/clauditor/compare/v1.13.1...v1.13.2) (2026-04-03)


### Bug Fixes

* re-block every 2x waste increase, fix false context warning on Opus ([33bbb23](https://github.com/IyadhKhalfallah/clauditor/commit/33bbb23a2da209e52b77bae8f8fd88960230c545))
* update checker was suggesting downgrades — use semver comparison ([e44446c](https://github.com/IyadhKhalfallah/clauditor/commit/e44446cf51b2ecd14fef88aab3b83f6f34a921b6))

## [1.13.1](https://github.com/IyadhKhalfallah/clauditor/compare/v1.13.0...v1.13.1) (2026-04-03)


### Bug Fixes

* realistic rotation cost in calibration (30 turns, not 5) ([ba7a562](https://github.com/IyadhKhalfallah/clauditor/commit/ba7a562dede56e7afa408442dbab0102758af79f))

## [1.13.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.12.1...v1.13.0) (2026-04-03)


### Features

* auto-calibrate rotation threshold from user's own session history ([a717d11](https://github.com/IyadhKhalfallah/clauditor/commit/a717d11eff031c56eb28c50e9f9cf65a6d397f72))
* auto-check for updates on CLI commands (cached 24h, skipped for hooks) ([6c48ca0](https://github.com/IyadhKhalfallah/clauditor/commit/6c48ca0fa65eccb062d44356ccb6d794e5754331))

## [1.12.1](https://github.com/IyadhKhalfallah/clauditor/compare/v1.12.0...v1.12.1) (2026-04-02)


### Bug Fixes

* single config file at ~/.clauditor/config.json ([c1a34e7](https://github.com/IyadhKhalfallah/clauditor/commit/c1a34e7d8f9230cc37c64d47d6df073f327deef2))

## [1.12.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.11.1...v1.12.0) (2026-04-02)


### Features

* save session state to ~/.clauditor/ instead of CLAUDE.md ([cb9abd5](https://github.com/IyadhKhalfallah/clauditor/commit/cb9abd5294f1be3a33fd3df36c1f360f4e782720))


### Bug Fixes

* suppress cache warmup false alarm, fix session status icons ([fb0f3e3](https://github.com/IyadhKhalfallah/clauditor/commit/fb0f3e3b92d40598f411b96c1b47117407ef3037))

## [1.11.1](https://github.com/IyadhKhalfallah/clauditor/compare/v1.11.0...v1.11.1) (2026-04-02)


### Bug Fixes

* use exit code 2 for PostToolUse block — stronger than decision block ([5381a85](https://github.com/IyadhKhalfallah/clauditor/commit/5381a855e174d6dfec083e4c941caffd20462a46))

## [1.11.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.10.0...v1.11.0) (2026-04-02)


### Features

* PostToolUse block for autonomous sessions ([d154a68](https://github.com/IyadhKhalfallah/clauditor/commit/d154a6822d824e7eb72efa25539dabe91b809576))

## [1.10.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.9.1...v1.10.0) (2026-04-02)


### Features

* UserPromptSubmit block + PreCompact + waste factor dashboard ([e2361a7](https://github.com/IyadhKhalfallah/clauditor/commit/e2361a70a04f2485d962ba910d15b4ad86fa8b72))


### Bug Fixes

* extract branch from most recent user record, not first ([dab6861](https://github.com/IyadhKhalfallah/clauditor/commit/dab6861394a56a41dafd59891bf684ca6e4f7f84))

## [1.9.1](https://github.com/IyadhKhalfallah/clauditor/compare/v1.9.0...v1.9.1) (2026-04-02)


### Bug Fixes

* use 12h window for session counter instead of midnight cutoff ([400e7b7](https://github.com/IyadhKhalfallah/clauditor/commit/400e7b7d09a8596638cefbe02876a2957862674c))

## [1.9.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.8.0...v1.9.0) (2026-04-02)


### Features

* redesign dashboard — one bar, one number, no contradictions ([a69e03f](https://github.com/IyadhKhalfallah/clauditor/commit/a69e03f933cf173fbf5b8aee915572ed563b4a20))

## [1.8.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.7.3...v1.8.0) (2026-04-02)


### Features

* configurable session rotation with CLAUDE.md write opt-out ([b35cbf5](https://github.com/IyadhKhalfallah/clauditor/commit/b35cbf523666c34feecae0ccffe0139d979ee154))


### Bug Fixes

* remove debug logging from session state writer ([eed24d6](https://github.com/IyadhKhalfallah/clauditor/commit/eed24d6d340c7561027fe5eae2a9c478090aca9f))

## [1.7.3](https://github.com/IyadhKhalfallah/clauditor/compare/v1.7.2...v1.7.3) (2026-04-02)


### Bug Fixes

* add error logging to session state writer for debugging write failures ([742c70e](https://github.com/IyadhKhalfallah/clauditor/commit/742c70e14365527bba92cb7a36ead3b3344a5498))

## [1.7.2](https://github.com/IyadhKhalfallah/clauditor/compare/v1.7.1...v1.7.2) (2026-04-02)


### Bug Fixes

* use imported readdirSync instead of require() in ESM hook ([967cfc5](https://github.com/IyadhKhalfallah/clauditor/commit/967cfc53efd8aa84a2ed159086b998dc7cf83f22))

## [1.7.1](https://github.com/IyadhKhalfallah/clauditor/compare/v1.7.0...v1.7.1) (2026-04-02)


### Bug Fixes

* write session state to CLAUDE.md directly instead of asking Claude ([f1d3b4c](https://github.com/IyadhKhalfallah/clauditor/commit/f1d3b4c4c9a4396456af673a7e1dab735ba13d9e))

## [1.7.1](https://github.com/IyadhKhalfallah/clauditor/compare/v1.7.0...v1.7.1) (2026-04-02)


### Bug Fixes

* write session state to CLAUDE.md directly instead of asking Claude ([f1d3b4c](https://github.com/IyadhKhalfallah/clauditor/commit/f1d3b4c4c9a4396456af673a7e1dab735ba13d9e))

## [1.7.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.6.0...v1.7.0) (2026-04-02)


### Features

* show tokens/turn and rotation status in dashboard ([2a3c158](https://github.com/IyadhKhalfallah/clauditor/commit/2a3c1586973743550ca7c8673efc17ece94feb94))

## [1.6.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.5.0...v1.6.0) (2026-04-02)


### Features

* session rotation — the core value of clauditor ([62737e5](https://github.com/IyadhKhalfallah/clauditor/commit/62737e54d832b2e21048e3e4af1f5f46785466fb))

## [1.5.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.4.1...v1.5.0) (2026-04-02)


### Features

* auto-nudge /save-skill after productive sessions ([7c02bde](https://github.com/IyadhKhalfallah/clauditor/commit/7c02bdefecffc970415bbef1dd5688d80ddaaa20))
* clauditor sessions — see where your tokens went ([b7516a3](https://github.com/IyadhKhalfallah/clauditor/commit/b7516a3f907561888f5f017026bdaf26da34a4b1))
* install /save-skill — users say "save what we did" and Claude writes the skill ([0a5a300](https://github.com/IyadhKhalfallah/clauditor/commit/0a5a30019dffba0bf0af82759601a289f3bb6e18))
* token spike detector — catches "limit hit in 20 min" in real-time ([efd268f](https://github.com/IyadhKhalfallah/clauditor/commit/efd268f39dd4ecc41611e0e78a21540108a9760f))


### Bug Fixes

* 68% cache at turn 58 showed 'warming up' instead of degraded ([09c6ca2](https://github.com/IyadhKhalfallah/clauditor/commit/09c6ca2a0d873249c551e55c67e80fff35616c5b))
* detect cache drops (98% → 68%) not just full degradation ([8c94091](https://github.com/IyadhKhalfallah/clauditor/commit/8c94091eb27328beea4d8b550a80c08ef8a1ebe3))
* don't recommend /clear for temporary cache dips ([f4dd1b2](https://github.com/IyadhKhalfallah/clauditor/commit/f4dd1b280d5a1af8a40fb6aab21eb4197e17b1b1))

## [1.4.1](https://github.com/IyadhKhalfallah/clauditor/compare/v1.4.0...v1.4.1) (2026-04-02)


### Bug Fixes

* skill suggestions show real commands, not generic patterns ([a324c93](https://github.com/IyadhKhalfallah/clauditor/commit/a324c938709eb591e421d61a5d0672422171638d))

## [1.4.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.3.0...v1.4.0) (2026-04-02)


### Features

* add activity log — track and display every action clauditor takes ([669806c](https://github.com/IyadhKhalfallah/clauditor/commit/669806c67031a14805e81fcd2f6b3749a0062a67))
* add impact tracker — lifetime KPIs across all sessions ([d9b2c51](https://github.com/IyadhKhalfallah/clauditor/commit/d9b2c514539c9e6098c04d0f4131d3202ff3dc28))
* add resume anomaly detection, quota burn rate, and quota-aware memory audit ([0df13b8](https://github.com/IyadhKhalfallah/clauditor/commit/0df13b84ec62c286fe1b67abe518ed2b4254ff22))
* add SessionStart hook, repeated-edit detector, and richer KPIs ([f745248](https://github.com/IyadhKhalfallah/clauditor/commit/f745248e335fbbb886c377fd1b06fd7431ca3836))
* auto-save session context to CLAUDE.md before compaction ([0d62984](https://github.com/IyadhKhalfallah/clauditor/commit/0d62984c05728be191fb3cd4b0eed5a23ba42dfe))
* create clauditor — session health monitoring for Claude Code ([e59ba78](https://github.com/IyadhKhalfallah/clauditor/commit/e59ba784fda5f8917d17b8ed4cc268a6c93dd0f3))
* post-error guidance — catch failing commands at attempt 1 ([5cf5ea5](https://github.com/IyadhKhalfallah/clauditor/commit/5cf5ea5728fb0d9b3011dec80241b71ae9bc8103))
* richer impact KPIs — all provable from JSONL data ([6bb52bf](https://github.com/IyadhKhalfallah/clauditor/commit/6bb52bff8639adcb430d38de5091e019b4ce6e1c))
* show subagent task description instead of cryptic IDs ([dd2e8e5](https://github.com/IyadhKhalfallah/clauditor/commit/dd2e8e5be9412e1db132f83c006264abaa6724b3))
* skill suggestion — detect repeating workflows, suggest as skills ([5cc9674](https://github.com/IyadhKhalfallah/clauditor/commit/5cc967414940c7742f1fe4193c0ae1ece33d3822))
* split impact into "actions taken" vs "issues detected" ([ee2c51b](https://github.com/IyadhKhalfallah/clauditor/commit/ee2c51bfb1f944d87be148462ca44d3df72141b5))


### Bug Fixes

* clear terminal before Ink renders to prevent duplicate frames ([e6933b8](https://github.com/IyadhKhalfallah/clauditor/commit/e6933b8bfd68555acbf66fee7f4c4f745b87f3f3))
* clear terminal on TUI mount to prevent duplicate rendering ([0678a9e](https://github.com/IyadhKhalfallah/clauditor/commit/0678a9e25b658abfdae7fc7f8a3bc36336a42076))
* compute totalTurnsMonitored from all sessions, not just new ones ([a73dd11](https://github.com/IyadhKhalfallah/clauditor/commit/a73dd11feec02883c95904866ec0872daca16303))
* count degraded cache sessions in impact tracker, not just broken ([5001c18](https://github.com/IyadhKhalfallah/clauditor/commit/5001c180a5953649c5f12047535818fe00178e69))
* enable polling mode for file watching — FSEvents unreliable on macOS ([874c403](https://github.com/IyadhKhalfallah/clauditor/commit/874c4039f681abddfee6f48485abf17948032367))
* include subagent ID in parentheses before task description ([2f8f2d5](https://github.com/IyadhKhalfallah/clauditor/commit/2f8f2d599946f1aefef99c17a889863353b8047a))
* model-aware context limits and smarter burn rate classification ([47c70a4](https://github.com/IyadhKhalfallah/clauditor/commit/47c70a402e213843109f54281b1412006290d59a))
* only flag burn rate when cache is also degraded ([4941803](https://github.com/IyadhKhalfallah/clauditor/commit/494180380bcffc38c60def15999970559a57a0f6))
* read version from package.json instead of hardcoding ([0ee518c](https://github.com/IyadhKhalfallah/clauditor/commit/0ee518ca44c346222c30c1da54a445c486d9ac1d))
* remove unreliable time estimates, label cost as API-only ([fbd912d](https://github.com/IyadhKhalfallah/clauditor/commit/fbd912d9db6fca84be0ef4a207577e2ad2b45818))
* use platform-aware path handling for Windows compatibility ([ac778d2](https://github.com/IyadhKhalfallah/clauditor/commit/ac778d2422f3ec25282cdd44209a5ff788546b6c))
* watch directory directly instead of glob — chokidar v4 glob broken ([8680917](https://github.com/IyadhKhalfallah/clauditor/commit/868091758c9661121b07aabc814145d22e9f8520))
* wire up q key and ctrl+c to quit the TUI ([39159d3](https://github.com/IyadhKhalfallah/clauditor/commit/39159d333424465dd2d7e34b60040aa0298fb8c4))


### Performance Improvements

* incremental JSONL parsing — only read new lines on file change ([a941dbe](https://github.com/IyadhKhalfallah/clauditor/commit/a941dbe9cc7995b425ce696ccdbf8bd78547e052))

## [1.3.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.2.1...v1.3.0) (2026-04-02)


### Features

* split impact into "actions taken" vs "issues detected" ([ee2c51b](https://github.com/IyadhKhalfallah/clauditor/commit/ee2c51bfb1f944d87be148462ca44d3df72141b5))

## [1.2.1](https://github.com/IyadhKhalfallah/clauditor/compare/v1.2.0...v1.2.1) (2026-04-02)


### Bug Fixes

* compute totalTurnsMonitored from all sessions, not just new ones ([a73dd11](https://github.com/IyadhKhalfallah/clauditor/commit/a73dd11feec02883c95904866ec0872daca16303))

## [1.2.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.1.3...v1.2.0) (2026-04-02)


### Features

* add SessionStart hook, repeated-edit detector, and richer KPIs ([f745248](https://github.com/IyadhKhalfallah/clauditor/commit/f745248e335fbbb886c377fd1b06fd7431ca3836))
* auto-save session context to CLAUDE.md before compaction ([0d62984](https://github.com/IyadhKhalfallah/clauditor/commit/0d62984c05728be191fb3cd4b0eed5a23ba42dfe))
* richer impact KPIs — all provable from JSONL data ([6bb52bf](https://github.com/IyadhKhalfallah/clauditor/commit/6bb52bff8639adcb430d38de5091e019b4ce6e1c))
* show subagent task description instead of cryptic IDs ([dd2e8e5](https://github.com/IyadhKhalfallah/clauditor/commit/dd2e8e5be9412e1db132f83c006264abaa6724b3))


### Bug Fixes

* include subagent ID in parentheses before task description ([2f8f2d5](https://github.com/IyadhKhalfallah/clauditor/commit/2f8f2d599946f1aefef99c17a889863353b8047a))

## [1.1.3](https://github.com/IyadhKhalfallah/clauditor/compare/v1.1.2...v1.1.3) (2026-04-02)


### Bug Fixes

* enable polling mode for file watching — FSEvents unreliable on macOS ([874c403](https://github.com/IyadhKhalfallah/clauditor/commit/874c4039f681abddfee6f48485abf17948032367))
* only flag burn rate when cache is also degraded ([4941803](https://github.com/IyadhKhalfallah/clauditor/commit/494180380bcffc38c60def15999970559a57a0f6))
* watch directory directly instead of glob — chokidar v4 glob broken ([8680917](https://github.com/IyadhKhalfallah/clauditor/commit/868091758c9661121b07aabc814145d22e9f8520))

## [1.1.2](https://github.com/IyadhKhalfallah/clauditor/compare/v1.1.1...v1.1.2) (2026-04-02)


### Bug Fixes

* clear terminal before Ink renders to prevent duplicate frames ([e6933b8](https://github.com/IyadhKhalfallah/clauditor/commit/e6933b8bfd68555acbf66fee7f4c4f745b87f3f3))
* clear terminal on TUI mount to prevent duplicate rendering ([0678a9e](https://github.com/IyadhKhalfallah/clauditor/commit/0678a9e25b658abfdae7fc7f8a3bc36336a42076))
* use platform-aware path handling for Windows compatibility ([ac778d2](https://github.com/IyadhKhalfallah/clauditor/commit/ac778d2422f3ec25282cdd44209a5ff788546b6c))


### Performance Improvements

* incremental JSONL parsing — only read new lines on file change ([a941dbe](https://github.com/IyadhKhalfallah/clauditor/commit/a941dbe9cc7995b425ce696ccdbf8bd78547e052))

## [1.1.1](https://github.com/IyadhKhalfallah/clauditor/compare/v1.1.0...v1.1.1) (2026-04-02)


### Bug Fixes

* count degraded cache sessions in impact tracker, not just broken ([5001c18](https://github.com/IyadhKhalfallah/clauditor/commit/5001c180a5953649c5f12047535818fe00178e69))

## [1.1.0](https://github.com/IyadhKhalfallah/clauditor/compare/v1.0.3...v1.1.0) (2026-04-02)


### Features

* add activity log — track and display every action clauditor takes ([669806c](https://github.com/IyadhKhalfallah/clauditor/commit/669806c67031a14805e81fcd2f6b3749a0062a67))
* add impact tracker — lifetime KPIs across all sessions ([d9b2c51](https://github.com/IyadhKhalfallah/clauditor/commit/d9b2c514539c9e6098c04d0f4131d3202ff3dc28))

## [1.0.3](https://github.com/IyadhKhalfallah/clauditor/compare/v1.0.2...v1.0.3) (2026-04-02)


### Bug Fixes

* remove unreliable time estimates, label cost as API-only ([fbd912d](https://github.com/IyadhKhalfallah/clauditor/commit/fbd912d9db6fca84be0ef4a207577e2ad2b45818))

## [1.0.2](https://github.com/IyadhKhalfallah/clauditor/compare/v1.0.1...v1.0.2) (2026-04-02)


### Bug Fixes

* model-aware context limits and smarter burn rate classification ([47c70a4](https://github.com/IyadhKhalfallah/clauditor/commit/47c70a402e213843109f54281b1412006290d59a))
* wire up q key and ctrl+c to quit the TUI ([39159d3](https://github.com/IyadhKhalfallah/clauditor/commit/39159d333424465dd2d7e34b60040aa0298fb8c4))

## [1.0.1](https://github.com/IyadhKhalfallah/clauditor/compare/v1.0.0...v1.0.1) (2026-04-02)


### Bug Fixes

* read version from package.json instead of hardcoding ([0ee518c](https://github.com/IyadhKhalfallah/clauditor/commit/0ee518ca44c346222c30c1da54a445c486d9ac1d))

## 1.0.0 (2026-04-02)


### Features

* add resume anomaly detection, quota burn rate, and quota-aware memory audit ([0df13b8](https://github.com/IyadhKhalfallah/clauditor/commit/0df13b84ec62c286fe1b67abe518ed2b4254ff22))
* create clauditor — session health monitoring for Claude Code ([e59ba78](https://github.com/IyadhKhalfallah/clauditor/commit/e59ba784fda5f8917d17b8ed4cc268a6c93dd0f3))

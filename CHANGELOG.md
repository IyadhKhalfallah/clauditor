# Changelog

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
